#!/bin/bash
# watchdog_bots.sh — 每 N 秒檢查 Bot 是否存活，不在就重啟
# 用法: nohup bash watchdog_bots.sh &
# 或: bash watchdog_bots.sh (單次檢查模式)

BOT_DIR="/home/node/.openclaw/workspace-your/agents/eve"
STATUS_FILE="/home/node/.openclaw/workspace-your/shared/status/bot-status.json"
WATCHDOG_INTERVAL=30  # 秒

mkdir -p "$(dirname "$STATUS_FILE")"

check_and_report() {
  local lucas_alive=false
  local yakumo_alive=false
  
  pgrep -f "lucas_discord.js" > /dev/null 2>&1 && lucas_alive=true
  pgrep -f "yakumo_discord.js" > /dev/null 2>&1 && yakumo_alive=true
  
  # 寫入狀態檔
  cat > "$STATUS_FILE" <<EOF
{
  "lucas": $lucas_alive,
  "yakumo": $yakumo_alive,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid_lucas": $(pgrep -f "lucas_discord.js" 2>/dev/null || echo null),
  "pid_yakumo": $(pgrep -f "yakumo_discord.js" 2>/dev/null || echo null)
}
EOF

  if [ "$lucas_alive" = false ] || [ "$yakumo_alive" = false ]; then
    echo "[$(date)] ⚠️ Bot 異常 — Lucas=$lucas_alive 八雲=$yakumo_alive → 重啟"
    bash "/home/node/.openclaw/workspace-your/start_bots.sh"
    return 1
  fi
  return 0
}

# 單次檢查模式：如果帶 check 參數就跑一次就結束
if [ "$1" = "check" ]; then
  check_and_report
  exit $?
fi

# 循環模式（適合 background）
echo "[$(date)] 🟢 watchdog 啟動 (每 ${WATCHDOG_INTERVAL}s 檢查)"
while true; do
  check_and_report
  sleep "$WATCHDOG_INTERVAL"
done