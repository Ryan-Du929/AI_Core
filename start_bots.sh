#!/bin/bash
# start_bots.sh v3 — 明確 export，不 source .env

BOT_DIR="/home/node/.openclaw/workspace-your/agents/eve"
cd "$BOT_DIR"

# kill 舊的
pkill -f "lucas_discord.js" 2>/dev/null
pkill -f "yakumo_discord.js" 2>/dev/null
sleep 2

# 從 .env 讀取特定變數（用 grep 避開衝突）
DISCORD_BOT_TOKEN_LUCAS=$(grep '^DISCORD_BOT_TOKEN_LUCAS=' .env | cut -d= -f2-)
DISCORD_BOT_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' .env | cut -d= -f2-)
GROQ_API_KEY=$(grep '^GROQ_API_KEY=' .env | cut -d= -f2-)
OPENAI_API_KEY=$(grep '^OPENAI_API_KEY=' .env | cut -d= -f2-)
OPENAI_BASE_URL=$(grep '^OPENAI_BASE_URL=' .env | cut -d= -f2-)
OPENAI_MODEL=$(grep '^OPENAI_MODEL=' .env | cut -d= -f2-)

export DISCORD_BOT_TOKEN_LUCAS
export DISCORD_BOT_TOKEN
export GROQ_API_KEY
export OPENAI_API_KEY
export OPENAI_BASE_URL
export OPENAI_MODEL

nohup node lucas_discord.js >> lucas_bot.log 2>&1 &
echo "Lucas PID: $!"

nohup node yakumo_discord.js >> yakumo_bot.log 2>&1 &
echo "八雲 PID: $!"

echo "✅ Bot 已啟動 (v3)"