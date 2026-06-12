#!/bin/bash
# start_chief.sh — 啟動 daemon + OpenClaw 一次完成
# 使用方式: bash start_chief.sh
# 或是: docker exec -it ChiefAgent bash start_chief.sh

WORKSPACE="/home/node/.openclaw/workspace-your"
cd "$WORKSPACE" || exit 1

echo "🚀 啟動背景服務..."
bash "$WORKSPACE/startup_daemons.sh"

echo ""
echo "🧠 啟動 OpenClaw..."
cd /app && node dist/main.js