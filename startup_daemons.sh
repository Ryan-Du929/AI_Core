#!/bin/bash
# startup_daemons.sh — 啟動所有背景服務
# 位置: /home/node/.openclaw/workspace-your/startup_daemons.sh
# 使用: bash startup_daemons.sh
# 被 .bashrc 自動呼叫（登入時執行）

WORKSPACE="/home/node/.openclaw/workspace-your"
cd "$WORKSPACE" || { echo "❌ 無法進入工作目錄"; exit 1; }

echo "=========================================="
echo "🚀 Lucas 團隊服務啟動腳本"
echo "時間: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "=========================================="

# ── 1. Yakumo 八雲祕書 Bot ──
if ! ps aux | grep -v grep | grep -q "yakumo_discord.js"; then
  cd agents/eve && nohup node yakumo_discord.js >> yakumo_bot.log 2>&1 &
  echo "🟢 八雲 (PID $!)"
  cd "$WORKSPACE"
else
  echo "⏭️  八雲 已在執行中"
fi

# ── 2. Lucas Bot ──
if ! ps aux | grep -v grep | grep -q "lucas_discord.js"; then
  cd agents/eve && nohup node lucas_discord.js >> lucas_bot.log 2>&1 &
  echo "🟢 Lucas (PID $!)"
  cd "$WORKSPACE"
else
  echo "⏭️  Lucas 已在執行中"
fi

# ── 3. 自動備份 ──
if ! ps aux | grep -v grep | grep -q "auto_backup.py"; then
  nohup python3 -u auto_backup.py --daemon --interval 2 >> auto_backup.log 2>&1 &
  echo "🟢 自動備份 (PID $!)"
else
  echo "⏭️  自動備份 已在執行中"
fi

# ── 4. 記憶蒸餾 ──
if ! ps aux | grep -v grep | grep -q "memory_distill.py"; then
  nohup python3 -u memory_distill.py --daemon --interval 600 >> memory_distill.log 2>&1 &
  echo "🟢 記憶蒸餾 (PID $!)"
else
  echo "⏭️  記憶蒸餾 已在執行中"
fi

echo "=========================================="
echo "✅ 啟動完成"
echo "=========================================="