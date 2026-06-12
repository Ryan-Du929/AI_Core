#!/usr/bin/env python3
"""
auto_backup.py — 自動定期備份模組
====================================
功能：
  1. 每 N 小時自動將工作目錄下的重要檔案打包為 timestamp zip
  2. Daemon Thread 背景執行，不阻塞主程式
  3. 只保留最近 KEEP_COUNT 份備份，舊的自動刪除
  4. 每次備份後寫入 backup_log.json 記錄

使用方式：
  python3 auto_backup.py            # Daemon 模式（每 6 小時備份）
  python3 auto_backup.py --once     # 單次備份
  python3 auto_backup.py --interval 2  # 自訂間隔（小時）
"""

import os
import sys
import json
import time
import zipfile
import threading
import glob
from datetime import datetime, timezone

# ── 設定 ──────────────────────────────────────────────
WORKSPACE = os.path.expanduser("/home/node/.openclaw/workspace-your")
BACKUP_DIR = os.path.join(WORKSPACE, "backups")
LOG_FILE = os.path.join(BACKUP_DIR, "backup_log.json")
DEFAULT_INTERVAL_HOURS = 6
KEEP_COUNT = 5

# 要備份的檔案/目錄（相對於 WORKSPACE）
BACKUP_PATHS = [
    "MEMORY.md",
    "missions.md",
    "SOUL.md",
    "AGENTS.md",
    "USER.md",
    "IDENTITY.md",
    "TOOLS.md",
    "knowledge/",
    "memory/",
    "shared/memory/",
    "shared/todo/",
    "shared/results/",
    "shared/queue/",
    "shared/dashboard/",
    "shared/團隊組織設計.md",
    "shared/多模型接入評估.md",
    "shared/webhook_report.py",
    "shared/agent_base.py",
    "shared/dashboard_app.py",
    "shared/SKILL_TREE.md",
    "agents/eve/lucas_discord.js",
    "agents/eve/yakumo_discord.js",
    "agents/eve/.env",
    "start_bots.sh",
    "watchdog_bots.sh",
    "HEARTBEAT.md",
]

# ── 核心功能 ──────────────────────────────────────────

def get_timestamp():
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

def create_backup():
    """建立一次備份，回傳 (zip_path, file_count, size_bytes)"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = get_timestamp()
    zip_name = f"{ts}.zip"
    zip_path = os.path.join(BACKUP_DIR, zip_name)

    added = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path in BACKUP_PATHS:
            abs_path = os.path.join(WORKSPACE, rel_path)
            if not os.path.exists(abs_path):
                continue
            if os.path.isfile(abs_path):
                zf.write(abs_path, rel_path)
                added += 1
            elif os.path.isdir(abs_path):
                for root, dirs, files in os.walk(abs_path):
                    # 跳過 node_modules
                    dirs[:] = [d for d in dirs if d != "node_modules" and not d.startswith("__pycache__")]
                    for fname in files:
                        fpath = os.path.join(root, fname)
                        arcname = os.path.relpath(fpath, WORKSPACE)
                        # 跳過 .log 和過大的檔案
                        if fname.endswith(".log") or fname.endswith(".zip"):
                            continue
                        try:
                            if os.path.getsize(fpath) > 10 * 1024 * 1024:  # >10MB
                                continue
                            zf.write(fpath, arcname)
                            added += 1
                        except:
                            pass

    size = os.path.getsize(zip_path)
    return zip_path, added, size


def rotate_backups():
    """只保留最近 KEEP_COUNT 份，刪除舊的"""
    backups = sorted(glob.glob(os.path.join(BACKUP_DIR, "*.zip")))
    while len(backups) > KEEP_COUNT:
        old = backups.pop(0)
        try:
            os.remove(old)
            print(f"  🗑️ 刪除舊備份: {os.path.basename(old)}")
        except:
            pass


def log_backup(zip_name, file_count, size):
    """寫入備份記錄"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "zip": zip_name,
        "files": file_count,
        "size_bytes": size,
        "size_mb": round(size / (1024 * 1024), 2),
    }
    logs = []
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, "r") as f:
                logs = json.load(f)
        except:
            logs = []
    logs.append(record)
    # 只保留最近 20 筆記錄
    logs = logs[-20:]
    with open(LOG_FILE, "w") as f:
        json.dump(logs, f, indent=2, ensure_ascii=False)
    return record


def run_backup():
    """執行一次完整的備份流程"""
    print(f"\n📦 [{get_timestamp()}] 開始備份...")
    try:
        zip_path, count, size = create_backup()
        zip_name = os.path.basename(zip_path)
        print(f"  ✅ 備份完成: {zip_name} ({count} 個檔案, {size/1024:.1f} KB)")
        rotate_backups()
        record = log_backup(zip_name, count, size)
        print(f"  📝 記錄寫入: {json.dumps(record)}")
        return True
    except Exception as e:
        print(f"  ❌ 備份失敗: {e}")
        return False


def backup_loop(interval_hours):
    """背景迴圈：每隔 interval_hours 備份一次"""
    print(f"🔄 備份排程啟動 — 每 {interval_hours} 小時執行一次")
    run_backup()  # 啟動後立即備份一次
    while True:
        time.sleep(interval_hours * 3600)
        run_backup()


def start_daemon(interval_hours=DEFAULT_INTERVAL_HOURS):
    """以 Daemon Thread 啟動背景備份"""
    thread = threading.Thread(target=backup_loop, args=(interval_hours,), daemon=True)
    thread.start()
    print(f"🧵 Daemon thread 已啟動 (間隔 {interval_hours}h)")
    return thread


# ── CLI ────────────────────────────────────────────────
if __name__ == "__main__":
    if "--once" in sys.argv:
        run_backup()
    elif "--interval" in sys.argv:
        idx = sys.argv.index("--interval")
        hours = float(sys.argv[idx + 1]) if len(sys.argv) > idx + 1 else DEFAULT_INTERVAL_HOURS
        start_daemon(hours)
        # 保持主執行緒存活
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            print("\n🛑 備份程式終止")
    elif "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
    else:
        # 預設：Daemon 模式，每 6 小時
        start_daemon(DEFAULT_INTERVAL_HOURS)
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            print("\n🛑 備份程式終止")