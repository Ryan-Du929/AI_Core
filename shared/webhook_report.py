#!/usr/bin/env python3
"""
webhook_report.py — Discord Webhook 報告模組 v1.0
=====================================================
功能：
  1. 支援 Embed 結構化訊息
  2. 長文本自動 chunk（每塊 1900 字）
  3. 長篇報告自動存檔 + 附檔傳送
  4. Exponential Backoff 重試機制
  5. 無 Webhook URL 時 fallback 到 JSON 檔案供 Lucas Bot polling

使用方式：
  python3 webhook_report.py --webhook URL --title "標題" --body "內容"
  python3 webhook_report.py --webhook URL --embed '{"title":"...","fields":[...]}'
  python3 webhook_report.py --file report.md --title "週報" --section status
"""

import os
import sys
import json
import time
import uuid
import hashlib
import urllib.request
import urllib.error
import argparse
from datetime import datetime, timezone

# ── 設定 ──
WORKSPACE = os.path.expanduser("/home/node/.openclaw/workspace-your")
SHARED_DIR = os.path.join(WORKSPACE, "shared")
QUEUE_DIR = os.path.join(SHARED_DIR, "queue")
RESULTS_DIR = os.path.join(SHARED_DIR, "results")
ARCHIVE_DIR = os.path.join(SHARED_DIR, "reports")

MAX_CHUNK_LEN = 1900  # Discord 文字上限 2000，預留安全邊際
MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024  # 8 MB
RETRY_MAX = 5
RETRY_BASE = 1  # 秒


# ══════════════════════════════════════════════════════
# 1. Embed 建構器
# ══════════════════════════════════════════════════════

def make_embed(
    title="",
    description="",
    color=0x00FF88,
    fields=None,
    footer=None,
    timestamp=None,
):
    """建立 Discord Embed 字典"""
    embed = {"color": color}

    if title:
        embed["title"] = title[:256]  # Discord 上限
    if description:
        embed["description"] = description[:4096]
    if fields:
        embed["fields"] = []
        for f in fields:
            embed["fields"].append({
                "name": str(f.get("name", ""))[:256],
                "value": str(f.get("value", ""))[:1024],
                "inline": f.get("inline", False),
            })
    if footer:
        embed["footer"] = {"text": str(footer)[:2048]}
    if timestamp:
        embed["timestamp"] = timestamp
    else:
        embed["timestamp"] = datetime.now(timezone.utc).isoformat()

    return embed


def color_status(status):
    """根據狀態回傳顏色：success=綠, warning=黃, error=紅, info=藍"""
    return {
        "success": 0x00FF88,
        "warning": 0xFFAA00,
        "error": 0xFF4444,
        "info": 0x4488FF,
        "system": 0xAA88FF,
    }.get(status, 0x888888)


# ══════════════════════════════════════════════════════
# 2. 文字 Chunking
# ══════════════════════════════════════════════════════

def chunk_text(text, max_len=MAX_CHUNK_LEN):
    """將長文字切成 chunks，保留可讀性（以換行為邊界）"""
    if not text or len(text) <= max_len:
        return [text] if text else []

    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break

        # 往前找換行邊界
        split_at = text.rfind("\n", 0, max_len)
        if split_at == -1:
            split_at = text.rfind(" ", 0, max_len)
        if split_at == -1:
            split_at = max_len

        chunks.append(text[:split_at])
        text = text[split_at:].lstrip()

    return chunks


# ══════════════════════════════════════════════════════
# 3. 檔案儲存（長報告 → 附件）
# ══════════════════════════════════════════════════════

def save_report_file(content, prefix="report", ext="md"):
    """將長內容存為實體檔案，回傳檔案路徑"""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    fname = f"{prefix}_{ts}.{ext}"
    fpath = os.path.join(ARCHIVE_DIR, fname)
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  📄 報告已存檔: {fpath} ({len(content)} 字)")
    return fpath


# ══════════════════════════════════════════════════════
# 4. Webhook HTTP POST（含 Exponential Backoff）
# ══════════════════════════════════════════════════════

def send_webhook(webhook_url, payload, is_multipart=False, file_path=None):
    """
    發送 Webhook POST，支援重試與退避。
    回傳 (success: bool, status_code: int|None, error: str|None)
    """
    if not webhook_url:
        return False, None, "No webhook URL provided"

    # 確保 webhook_url 格式正確
    webhook_url = webhook_url.strip()

    for attempt in range(1, RETRY_MAX + 1):
        try:
            if is_multipart and file_path:
                # ── multipart/form-data 附檔模式 ──
                boundary = "----" + hashlib.md5(str(time.time()).encode()).hexdigest()
                data = _build_multipart(payload, file_path, boundary)
                req = urllib.request.Request(
                    webhook_url,
                    data=data,
                    headers={
                        "Content-Type": f"multipart/form-data; boundary={boundary}",
                        "User-Agent": "Lucas-Webhook/1.0",
                    },
                    method="POST",
                )
            else:
                # ── JSON 模式（Embed / 純文字） ──
                body = json.dumps(payload).encode()
                req = urllib.request.Request(
                    webhook_url,
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "Lucas-Webhook/1.0",
                    },
                    method="POST",
                )

            with urllib.request.urlopen(req, timeout=30) as resp:
                status = resp.status
                if 200 <= status < 300:
                    print(f"  ✅ Webhook 傳送成功 (attempt {attempt}, status {status})")
                    return True, status, None
                elif status == 429:
                    retry_after = _parse_retry_after(resp)
                    print(f"  ⏳ 429 速率限制，等待 {retry_after}s (attempt {attempt})")
                    time.sleep(retry_after)
                    continue
                elif status == 400:
                    err_body = resp.read().decode()[:200]
                    print(f"  ❌ 400 Bad Request: {err_body}")
                    return False, status, f"Bad Request: {err_body}"
                else:
                    print(f"  ⚠️ 未知狀態 {status} (attempt {attempt})")
                    if attempt < RETRY_MAX:
                        _backoff_wait(attempt)
                    continue

        except urllib.error.HTTPError as e:
            status = e.code
            body = e.read().decode()[:200]
            if status == 429:
                retry_after = _parse_retry_after_headers(e.headers)
                print(f"  ⏳ HTTP 429，等待 {retry_after}s (attempt {attempt})")
                time.sleep(retry_after)
                continue
            elif status == 400:
                print(f"  ❌ HTTP 400: {body}")
                return False, status, f"Bad Request: {body}"
            elif status == 413:
                print(f"  ❌ HTTP 413 Payload Too Large — 建議改用附檔模式")
                return False, status, "Payload Too Large (413)"
            else:
                print(f"  ⚠️ HTTP {status}: {body} (attempt {attempt})")
                if attempt < RETRY_MAX:
                    _backoff_wait(attempt)
                continue

        except urllib.error.URLError as e:
            print(f"  ⚠️ 連線錯誤: {e.reason} (attempt {attempt})")
            if attempt < RETRY_MAX:
                _backoff_wait(attempt)
            continue

        except Exception as e:
            print(f"  ⚠️ 未知錯誤: {e} (attempt {attempt})")
            if attempt < RETRY_MAX:
                _backoff_wait(attempt)
            continue

    print(f"  ❌ 已達最大重試次數 ({RETRY_MAX})，放棄")
    return False, None, "Max retries exceeded"


def _build_multipart(payload, file_path, boundary):
    """建構 multipart/form-data 請求主體 (含檔案附件)"""
    import email.utils

    CRLF = b"\r\n"
    lines = []

    # JSON payload part
    if payload:
        json_str = json.dumps(payload)
        lines.append(f"--{boundary}{CRLF}")
        lines.append(f'Content-Disposition: form-data; name="payload_json"{CRLF}')
        lines.append(f"Content-Type: application/json{CRLF}{CRLF}")
        lines.append(f"{json_str}{CRLF}")

    # File attachment part
    if file_path and os.path.exists(file_path):
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        fname = os.path.basename(file_path)
        mime = _guess_mime(fname)
        lines.append(f"--{boundary}{CRLF}")
        lines.append(f'Content-Disposition: form-data; name="file"; filename="{fname}"{CRLF}')
        lines.append(f"Content-Type: {mime}{CRLF}{CRLF}")
        # file_bytes 直接附在後面
        data = b"".join(
            [s.encode() if isinstance(s, str) else s for s in lines]
        )
        data += file_bytes + CRLF
        data += f"--{boundary}--{CRLF}".encode()
    else:
        lines.append(f"--{boundary}--{CRLF}")
        data = "".join(lines).encode()

    return data


def _guess_mime(fname):
    ext = os.path.splitext(fname)[1].lower()
    return {
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".json": "application/json",
        ".html": "text/html",
        ".csv": "text/csv",
        ".py": "text/x-python",
        ".js": "text/javascript",
    }.get(ext, "application/octet-stream")


def _parse_retry_after(resp):
    """從 HTTPResponse 讀取 Retry-After header"""
    try:
        return int(resp.headers.get("Retry-After", "5"))
    except (ValueError, AttributeError):
        return 5


def _parse_retry_after_headers(headers):
    try:
        return int(headers.get("Retry-After", "5"))
    except (ValueError, AttributeError):
        return 5


def _backoff_wait(attempt):
    """指數退避：1s, 2s, 4s, 8s"""
    wait = RETRY_BASE * (2 ** (attempt - 1))
    print(f"  💤 等待 {wait}s 後重試...")
    time.sleep(wait)


# ══════════════════════════════════════════════════════
# 5. Queue fallback（無 Webhook 時寫入 Lucas Bot queue）
# ══════════════════════════════════════════════════════

def write_queue(embeds, content_text=""):
    """無 Webhook 時，寫入 queue 讓 Lucas Bot 代發到 Discord"""
    os.makedirs(QUEUE_DIR, exist_ok=True)
    msg_id = str(uuid.uuid4())
    queue_item = {
        "id": msg_id,
        "type": "discord_report",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "embeds": embeds,
        "content": content_text,
        "status": "pending",
    }
    fname = f"{msg_id}.json"
    fpath = os.path.join(QUEUE_DIR, fname)
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(queue_item, f, indent=2, ensure_ascii=False)
    print(f"  📝 已寫入 queue: {fname}")
    return fpath


# ══════════════════════════════════════════════════════
# 6. 高層 API：完整報告流程
# ══════════════════════════════════════════════════════

def send_report(
    webhook_url=None,
    title="系統報告",
    body="",
    status="info",
    fields=None,
    file_path=None,
    section=None,
    fallback_to_queue=True,
):
    """
    完整報告流程：
    1. 建立 Embed
    2. 若 body 過長 → 存檔 + 附檔傳送
    3. 若 body 中等 → chunk（多條 Embed）
    4. Exponential backoff
    5. 無 Webhook → queue fallback
    """
    result = {"sent": False, "method": None, "chunks": 0, "error": None}

    # ── 主 Embed ──
    embed = make_embed(
        title=title,
        description="",
        color=color_status(status),
        fields=fields or [],
        footer=f"Lucas Report System • {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    # ── 決定傳送策略 ──
    body_len = len(body) if body else 0
    payloads = []

    if file_path and os.path.exists(file_path) and body_len < 100:
        # 策略 A：有實體檔案 + 短文描述 → 附檔傳送
        payloads = [{
            "embeds": [embed],
            "content": body[:MAX_CHUNK_LEN] if body else None,
        }]
        result["method"] = "file_attachment"
    elif body_len > MAX_CHUNK_LEN:
        # 策略 B：長文 → 存檔 + chunk 文字
        saved_path = save_report_file(body, prefix=title[:20], ext="md")
        chunks = chunk_text(body)

        # 第一個 chunk 帶 Embed
        first_embed = dict(embed)
        first_embed["description"] = chunks[0] if chunks else ""
        first = {"embeds": [first_embed]}
        if len(chunks) > 1:
            first["content"] = f"📄 完整報告已存檔，共 {body_len} 字 | 第 1/{len(chunks)} 頁"
        payloads = [first]

        # 後續 chunks 用純文字
        for i, chunk in enumerate(chunks[1:], 2):
            payloads.append({
                "content": f"📄 續 {i}/{len(chunks)}\n{chunk}",
            })

        # 同時附上檔案
        payloads[0]["attachments"] = [{"file_path": saved_path}]
        result["method"] = "chunked"
    else:
        # 策略 C：短文 → 直接放入 Embed description
        embed["description"] = body[:4096]
        payloads = [{"embeds": [embed]}]
        result["method"] = "embed"

    # ── 發送 ──
    if webhook_url:
        for i, payload in enumerate(payloads):
            use_file = file_path and i == 0 and os.path.exists(file_path)
            ok, code, err = send_webhook(webhook_url, payload, is_multipart=use_file, file_path=file_path)
            if not ok:
                result["error"] = err
                break
            result["chunks"] = i + 1
        result["sent"] = ok
    else:
        # ── fallback: queue ──
        for i, payload in enumerate(payloads):
            embeds_list = payload.get("embeds", [embed])
            content_text = payload.get("content", "")
            write_queue(embeds_list, content_text)
        result["sent"] = True
        result["method"] = "queue_fallback"

    return result


# ══════════════════════════════════════════════════════
# 7. CLI 介面
# ══════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Discord Webhook 報告模組")
    parser.add_argument("--webhook", help="Discord Webhook URL")
    parser.add_argument("--title", default="系統報告", help="報告標題")
    parser.add_argument("--body", default="", help="報告主文")
    parser.add_argument("--file", help="要附上的檔案路徑")
    parser.add_argument("--status", choices=["success", "warning", "error", "info", "system"], default="info")
    parser.add_argument("--embed-json", help="直接傳入 Embed JSON（覆蓋自動建構）")
    parser.add_argument("--section", help="報告區塊標籤（供後續過濾）")
    parser.add_argument("--queue-only", action="store_true", help="強制使用 queue fallback")

    args = parser.parse_args()

    # 讀取檔案內容作為 body
    body = args.body
    if args.file and not body:
        if os.path.exists(args.file):
            with open(args.file, "r", encoding="utf-8") as f:
                body = f.read()

    print(f"\n📤 開始傳送報告: {args.title}")
    print(f"   body: {len(body)} 字")

    result = send_report(
        webhook_url=None if args.queue_only else args.webhook,
        title=args.title,
        body=body,
        status=args.status,
        file_path=args.file if args.file and os.path.exists(args.file) else None,
        fallback_to_queue=True,
    )

    print(f"\n📊 傳送結果:")
    print(f"   成功: {result['sent']}")
    print(f"   方式: {result['method']}")
    print(f"   chunks: {result['chunks']}")
    if result["error"]:
        print(f"   錯誤: {result['error']}")

    return 0 if result["sent"] else 1


if __name__ == "__main__":
    sys.exit(main())