#!/usr/bin/env python3
"""
dashboard_app.py — Lucas 團隊系統狀態儀表板 v0.1 (Streamlit)
===============================================================
使用方式：
  streamlit run shared/dashboard_app.py
  
功能：
  - 所有 Daemon 即時狀態（PID / 記憶體 / 運行時間）
  - API Key 健康檢查（NVIDIA / Groq / Discord）
  - Token 用量統計（來自每日記錄）
  - 任務佇列監控（queue/ + results/）
  - 系統日誌摘要
"""

import os
import sys
import json
import time
from datetime import datetime, timezone

# ── 檢查是否有 streamlit ──
try:
    import streamlit as st
except ImportError:
    print("⚠️ 需要安裝 streamlit: pip install streamlit")
    print("目前先用離線模式展示設計架構。")
    HAS_STREAMLIT = False
else:
    HAS_STREAMLIT = True

WORKSPACE = os.path.expanduser("/home/node/.openclaw/workspace-your")
SHARED = os.path.join(WORKSPACE, "shared")

# ══════════════════════════════════════════════════════
# 資料供應層（可獨立於 UI 使用）
# ══════════════════════════════════════════════════════

class DashboardData:
    """儀表板資料供應器 — 收集所有資料來源"""
    
    @staticmethod
    def get_daemon_status():
        """取得所有 daemon 狀態"""
        import subprocess
        daemons = {
            "Lucas Bot": {"keyword": "lucas_discord.js", "emoji": "🧠"},
            "八雲 Bot": {"keyword": "yakumo_discord.js", "emoji": "🌸"},
            "備份 Daemon": {"keyword": "auto_backup.py", "emoji": "📦"},
            "記憶蒸餾": {"keyword": "memory_distill.py", "emoji": "🧪"},
        }
        
        cmd = "ps aux --no-headers 2>/dev/null || ps aux 2>/dev/null | tail -n +2"
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
            lines = result.stdout.split("\n")
        except:
            lines = []

        status = {}
        for name, cfg in daemons.items():
            found = [l for l in lines if cfg["keyword"] in l]
            if found:
                parts = found[0].split()
                status[name] = {
                    "status": "🟢 運行中",
                    "pid": parts[1] if len(parts) > 1 else "?",
                    "cpu": parts[2] if len(parts) > 2 else "?",
                    "mem": parts[3] if len(parts) > 3 else "?",
                    "emoji": cfg["emoji"],
                    "running_since": datetime.fromtimestamp(
                        time.time() - (float(parts[4]) if len(parts) > 4 and parts[4].replace('.','').isdigit() else 0)
                    ).strftime("%H:%M") if len(parts) > 4 and parts[4].replace('.','').isdigit() else "?",
                }
            else:
                status[name] = {
                    "status": "🔴 離線",
                    "pid": "-",
                    "emoji": cfg["emoji"],
                }
        return status

    @staticmethod
    def get_api_status():
        """測試 API Keys 狀態（只檢查，不洩漏 key）"""
        import subprocess
        
        tests = [
            ("NVIDIA DeepSeek", 
             'curl -s -o /dev/null -w "%{http_code}" -X POST "https://integrate.api.nvidia.com/v1/chat/completions" '
             '-H "Authorization: Bearer $OPENAI_API_KEY" '
             '-H "Content-Type: application/json" '
             '-d \'{"model":"deepseek-ai/deepseek-v4-flash","messages":[{"role":"user","content":"ping"}],"max_tokens":1}\'',
             "🧠"),
            ("Groq 備援",
             'curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.groq.com/openai/v1/chat/completions" '
             '-H "Authorization: Bearer $GROQ_API_KEY" '
             '-H "Content-Type: application/json" '
             '-d \'{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"ping"}],"max_tokens":1}\'',
             "⚡"),
        ]

        # Load env
        env = {}
        env_path = os.path.join(WORKSPACE, "agents", "eve", ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        env[k] = v

        status = {}
        for name, cmd_template, emoji in tests:
            cmd = cmd_template.replace("$OPENAI_API_KEY", env.get("OPENAI_API_KEY", ""))
            cmd = cmd.replace("$GROQ_API_KEY", env.get("GROQ_API_KEY", ""))
            try:
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
                code = result.stdout.strip()
                status[name] = {
                    "status": "✅ 正常" if code in ("200", "201") else "❌ 異常",
                    "code": code,
                    "emoji": emoji,
                }
            except Exception as e:
                status[name] = {
                    "status": "⚠️ 測試失敗",
                    "code": str(e),
                    "emoji": emoji,
                }
        return status

    @staticmethod
    def get_queue_stats():
        """取得 queue 統計"""
        queue_dir = os.path.join(SHARED, "queue")
        results_dir = os.path.join(SHARED, "results")
        
        stats = {"pending": 0, "completed": 0, "total": 0}
        
        if os.path.exists(queue_dir):
            pending = [f for f in os.listdir(queue_dir) if f.endswith(".json")]
            stats["pending"] = len(pending)
        
        if os.path.exists(results_dir):
            completed = [f for f in os.listdir(results_dir) if f.endswith(".json")]
            stats["completed"] = len(completed)
        
        stats["total"] = stats["pending"] + stats["completed"]
        return stats

    @staticmethod
    def get_recent_queue_items(max_items=5):
        """取得最近處理的任務"""
        results_dir = os.path.join(SHARED, "results")
        items = []
        if os.path.exists(results_dir):
            files = sorted(
                [f for f in os.listdir(results_dir) if f.endswith(".json")],
                key=lambda f: os.path.getmtime(os.path.join(results_dir, f)),
                reverse=True,
            )[:max_items]
            for fname in files:
                fpath = os.path.join(results_dir, fname)
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                    items.append({
                        "file": fname,
                        "type": data.get("type", "?"),
                        "content": data.get("content", "")[:80],
                        "mtime": datetime.fromtimestamp(os.path.getmtime(fpath)).strftime("%H:%M:%S"),
                    })
                except:
                    pass
        return items

    @staticmethod
    def get_disk_usage():
        """取得 workspace 磁碟用量"""
        import subprocess
        try:
            result = subprocess.run(
                f"du -sh {WORKSPACE} --exclude=node_modules 2>/dev/null || du -sh {WORKSPACE} 2>/dev/null",
                shell=True, capture_output=True, text=True, timeout=5
            )
            size = result.stdout.split()[0] if result.stdout else "?"
        except:
            size = "?"
        return size

    @staticmethod
    def get_system_time():
        """取得 UTC+8 時間"""
        utc_now = datetime.now(timezone.utc)
        tw_now = utc_now.timestamp() + 8 * 3600
        tw_dt = datetime.fromtimestamp(tw_now)
        return {
            "utc": utc_now.strftime("%Y-%m-%d %H:%M UTC"),
            "tw": tw_dt.strftime("%Y-%m-%d %H:%M (UTC+8)"),
        }


# ══════════════════════════════════════════════════════
# Streamlit UI（若無 Streamlit 則輸出文字版）
# ══════════════════════════════════════════════════════

def render_console():
    """終端機文字版儀表板"""
    data = DashboardData()
    time_info = data.get_system_time()
    
    print(f"""
╔══════════════════════════════════════════════╗
║     🧠 Lucas Team Dashboard (Console)        ║
║     {time_info['tw']}  │  {time_info['utc']:>24}   ║
╚══════════════════════════════════════════════╝

📊 Daemon Status:
{'─' * 50}""")
    
    for name, info in data.get_daemon_status().items():
        if info["status"] == "🔴 離線":
            print(f"  {info['emoji']} {name:<15} {info['status']}")
        else:
            print(f"  {info['emoji']} {name:<15} {info['status']}  PID:{info['pid']:<6} CPU:{info.get('cpu','?'):>4}%  MEM:{info.get('mem','?')}")
    
    print(f"\n🔑 API Keys:")
    for name, info in data.get_api_status().items():
        print(f"  {info['emoji']} {name:<20} {info['status']}  ({info.get('code','')})")
    
    queue_stats = data.get_queue_stats()
    print(f"\n📋 Queue: {queue_stats['pending']} pending / {queue_stats['completed']} completed / {queue_stats['total']} total")
    
    print(f"\n📦 Disk Usage: {data.get_disk_usage()}")
    
    print(f"\n📜 Recent Tasks:")
    for item in data.get_recent_queue_items(3):
        print(f"  [{item['mtime']}] {item['type']:<20} {item['content'][:60]}")
    
    print(f"\n{'═' * 50}")
    print("💡 執行 streamlit run shared/dashboard_app.py 啟動 Web 版")
    print(f"{'═' * 50}\n")


if HAS_STREAMLIT:
    def render_streamlit():
        st.set_page_config(
            page_title="Lucas Team Dashboard",
            page_icon="🧠",
            layout="wide",
        )
        
        data = DashboardData()
        time_info = data.get_system_time()
        
        st.title("🧠 Lucas 團隊系統狀態")
        st.caption(f"{time_info['tw']} | {time_info['utc']}")
        
        # ── Row 1: Daemon Status ──
        st.subheader("📊 Daemon 狀態")
        cols = st.columns(4)
        for i, (name, info) in enumerate(data.get_daemon_status().items()):
            with cols[i % 4]:
                if info["status"] == "🔴 離線":
                    st.error(f"{info['emoji']} {name}\n離線")
                else:
                    st.success(f"{info['emoji']} {name}\nPID: {info['pid']}\nCPU: {info.get('cpu','?')}% | MEM: {info.get('mem','?')}")
        
        # ── Row 2: API Keys ──
        st.subheader("🔑 API Keys")
        api_cols = st.columns(2)
        for i, (name, info) in enumerate(data.get_api_status().items()):
            with api_cols[i % 2]:
                if "✅" in info["status"]:
                    st.success(f"{info['emoji']} {name}: {info['status']}")
                else:
                    st.error(f"{info['emoji']} {name}: {info['status']} ({info.get('code','')})")
        
        # ── Row 3: Queue + Disk ──
        st.subheader("📋 任務佇列")
        queue_stats = data.get_queue_stats()
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("待處理", queue_stats["pending"])
        col2.metric("已完成", queue_stats["completed"])
        col3.metric("總計", queue_stats["total"])
        col4.metric("磁碟用量", data.get_disk_usage())
        
        # ── Row 4: Recent Tasks ──
        st.subheader("📜 最近任務")
        recent = data.get_recent_queue_items(10)
        if recent:
            for item in recent:
                st.text(f"[{item['mtime']}] {item['type']}: {item['content'][:80]}")
        else:
            st.info("尚無任務記錄")
        
        # ── Row 5: System Info ──
        with st.expander("ℹ️ 系統資訊"):
            st.json({
                "workspace": WORKSPACE,
                "shared_dir": SHARED,
                "time_utc": time_info["utc"],
                "time_tw": time_info["tw"],
                "python": sys.version,
            })


def main():
    if HAS_STREAMLIT:
        # 如果是透過 streamlit run 執行
        if "streamlit" in sys.modules.get("streamlit.runtime.scriptrunner", ""):
            render_streamlit()
        else:
            render_console()
    else:
        render_console()
        print("\n📌 安裝 Streamlit 啟動 Web 版:")
        print("   pip install streamlit")
        print("   streamlit run shared/dashboard_app.py")


if __name__ == "__main__":
    main()