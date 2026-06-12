#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日台股收盤行情擷取 — 抓取「全部上市櫃股票」
============================================
- 從 TWSE 公開 API 取得所有股票代碼，過濾掉權證/ETF（代碼5開頭或含英文字母）
- 用 shioaji 一次批次查詢全部合約的 snapshots
- 每日 13:35 UTC+8 自動執行（或手動）

輸出:
  shared/data/stock_history/{YYYY-MM-DD}.json  — 每日完整資料
  shared/data/stock_history/latest.json          — 最新行情（overwrite）

環境變數:
  SHIOAJI_API_KEY=xxx
  SHIOAJI_SECRET_KEY=xxx
"""

import os
import sys
import json
import time
import logging
import requests
import shioaji as sj
from datetime import datetime, timezone, timedelta
from pathlib import Path

# === 設定 ===

TZ_TW = timezone(timedelta(hours=8))

# 日誌設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("fetch_daily")

# 輸出路徑
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "shared" / "data" / "stock_history"
ENV_PATH = BASE_DIR / ".env"

# HTTP 請求 timeout
HTTP_TIMEOUT = 30

# TWSE 公開 API — 所有股票日均價（含代碼與名稱）
TWSE_STOCK_LIST_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL"


def load_env():
    """從 .env 載入 API Key"""
    api_key = os.environ.get("SHIOAJI_API_KEY")
    secret_key = os.environ.get("SHIOAJI_SECRET_KEY")

    if not api_key or not secret_key:
        if ENV_PATH.exists():
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k == "SHIOAJI_API_KEY":
                            api_key = v
                        elif k == "SHIOAJI_SECRET_KEY":
                            secret_key = v

    if not api_key or not secret_key:
        log.error("找不到 SHIOAJI_API_KEY / SHIOAJI_SECRET_KEY，請設定環境變數或 .env")
        sys.exit(1)

    return api_key, secret_key


def fetch_stock_list():
    """
    從 TWSE Open API 取得所有股票列表，過濾掉：
    - 代碼以數字 5 開頭（ETF）
    - 代碼包含英文字母（權證、ETN 等特殊商品）
    - 代碼長度不是 4 碼（非標準上市櫃股票）
    回傳 list of dict: [{"code": "2330", "name": "台積電"}, ...]
    """
    log.info("📡 從 TWSE API 取得股票清單...")
    try:
        resp = requests.get(TWSE_STOCK_LIST_URL, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error(f"❌ 無法取得股票清單: {e}")
        return []

    stocks = []
    skipped = {"letter": 0, "starts5": 0, "length": 0, "empty_code": 0}

    for item in data:
        code = str(item.get("Code", "")).strip()
        name = item.get("Name", "").strip()

        if not code or not name:
            skipped["empty_code"] += 1
            continue

        # 過濾：代碼含英文字母（權證、ETN 等）
        if not code.isdigit():
            skipped["letter"] += 1
            continue

        # 過濾：代碼以 5 開頭（ETF、ETN）
        if code[0] == "5":
            skipped["starts5"] += 1
            continue

        # 過濾：非 4 碼
        # 上市股票一般為 4 碼，上櫃為 4-6 碼
        # 保留 4 碼（上市）+ 6 碼（上櫃）但過濾特殊長度
        if len(code) > 6 or len(code) < 4:
            skipped["length"] += 1
            continue

        stocks.append({"code": code, "name": name})

    log.info(
        f"📋 取得 {len(stocks)} 支股票 "
        f"(跳過: 含字母={skipped['letter']}, 5開頭={skipped['starts5']}, "
        f"非標準長度={skipped['length']}, 空代碼={skipped['empty_code']})"
    )
    return stocks


def resolve_contracts(api, stock_list):
    """
    從 shioaji 合約樹中取得各股票的 Contract 物件。
    回傳 dict: {code: contract_object}
    找不到合約的股票會被跳過並記錄。
    """
    contracts = {}
    skipped = []
    total = len(stock_list)

    # 嘗試從 TSE 與 OTC 兩個交易所取得
    # api.Contracts.Stocks 可以透過 dict-like access 取得
    for i, s in enumerate(stock_list):
        code = s["code"]
        try:
            contract = api.Contracts.Stocks[code]
            if contract:
                contracts[code] = contract
            else:
                skipped.append(code)
        except (KeyError, AttributeError):
            skipped.append(code)

        if (i + 1) % 100 == 0:
            log.info(f"  🔍 合約解析進度: {i + 1}/{total}")

    if skipped:
        log.warning(f"  ⚠️ 跳過 {len(skipped)} 支無合約股票 (e.g. {skipped[:5]}...)")

    return contracts


def fetch_snapshots(api, contracts_dict):
    """
    批次查詢 snapshots。
    api.snapshots() 接受 contract 列表，一次批次回傳。
    """
    contract_list = list(contracts_dict.values())
    log.info(f"📸 批次查詢 {len(contract_list)} 支股票的 snapshots...")

    try:
        snapshots = api.snapshots(contract_list)
    except Exception as e:
        log.error(f"❌ snapshot 查詢失敗: {e}")
        return []

    if not snapshots:
        log.warning("⚠️ 無回傳資料")
        return []

    results = []
    for s in snapshots:
        code = getattr(s, "code", "")
        timestamp_ns = getattr(s, "ts", None)

        if timestamp_ns:
            # shioaji 的 ts 是奈秒
            if timestamp_ns > 1e15:
                ts_iso = datetime.fromtimestamp(
                    timestamp_ns / 1_000_000_000, tz=TZ_TW
                ).isoformat()
            else:
                ts_iso = datetime.fromtimestamp(timestamp_ns, tz=TZ_TW).isoformat()
        else:
            ts_iso = datetime.now(TZ_TW).isoformat()

        results.append({
            "code": code,
            "name": contracts_dict.get(code, sj.Stock()).name
            if hasattr(contracts_dict.get(code), "name")
            else "",
            "close": getattr(s, "close", None),
            "open": getattr(s, "open", None),
            "high": getattr(s, "high", None),
            "low": getattr(s, "low", None),
            "volume": getattr(s, "total_volume", None),
            "change": getattr(s, "change_price", None),
            "change_pct": getattr(s, "change_rate", None),
            "timestamp": ts_iso,
        })

    return results


def save_outputs(date_str, results, errors):
    """寫入每日 JSON 與 latest.json"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 每日完整檔案
    daily_payload = {
        "date": date_str,
        "fetched_at": datetime.now(TZ_TW).isoformat(),
        "count": len(results),
        "errors": errors,
        "stocks": results,
    }
    daily_path = OUTPUT_DIR / f"{date_str}.json"
    with open(daily_path, "w", encoding="utf-8") as f:
        json.dump(daily_payload, f, ensure_ascii=False, indent=2)
    log.info(f"✅ 已寫入: {daily_path}")

    # latest.json（給 dashboard 快速讀取）
    latest_payload = {
        "last_updated": datetime.now(TZ_TW).isoformat(),
        "stocks": {s["code"]: s for s in results},
    }
    latest_path = OUTPUT_DIR / "latest.json"
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(latest_payload, f, ensure_ascii=False, indent=2)
    log.info(f"✅ 已更新: {latest_path}")


def main():
    now = datetime.now(TZ_TW)
    date_str = now.strftime("%Y-%m-%d")

    log.info(f"{'='*50}")
    log.info(f"📊 每日台股收盤行情擷取 — {date_str}")
    log.info(f"⏰ {now.strftime('%H:%M:%S')} UTC+8")
    log.info(f"{'='*50}")

    # 1. 載入 API Key
    api_key, secret_key = load_env()

    # 2. 取得股票清單
    stock_list = fetch_stock_list()
    if not stock_list:
        log.error("❌ 無法取得股票清單，結束")
        return 1

    # 3. 登入 shioaji
    log.info("🔑 登入永豐 shioaji API...")
    api = sj.Shioaji()
    try:
        api.login(api_key=api_key, secret_key=secret_key, contracts_timeout=30000)
        log.info("✅ 登入成功")
    except Exception as e:
        log.error(f"❌ 登入失敗: {e}")
        return 1

    # 等待合約載入完成
    try:
        api.fetch_contracts(contract_download=True)
    except Exception:
        pass  # 非必要，contarcts 可能在 login 時已載入

    log.info("📦 合約載入狀態: %s", api.Contracts.status)

    # 4. 解析合約
    contracts = resolve_contracts(api, stock_list)
    if not contracts:
        log.error("❌ 無有效合約，結束")
        api.logout()
        return 1

    # 5. 批次查詢 snapshots
    results = fetch_snapshots(api, contracts)
    log.info(f"📈 成功取得 {len(results)} 筆行情資料")

    # 找出有合約但 snapshots 回傳空的股票
    codes_with_data = {s["code"] for s in results}
    errors = [c for c in contracts if c not in codes_with_data]

    # 6. 輸出
    save_outputs(date_str, results, errors)

    # 7. 登出
    api.logout()
    log.info("🔌 已登出")

    log.info(f"📊 完成: 成功 {len(results)} 筆")
    if errors:
        log.warning(f"⚠️ 失敗 {len(errors)} 筆")

    return 0


if __name__ == "__main__":
    sys.exit(main())