@echo off
chcp 65001 >nul
title Lucas 團隊啟動器

echo ==========================================
echo 🚀 Lucas 團隊啟動器
echo 時間: %DATE% %TIME%
echo ==========================================
echo.

:: ── 第一步：啟動背景 daemon ──
echo 📡 啟動背景服務（八雲、Lucas、備份、蒸餾）...
docker exec ChiefAgent bash /home/node/.openclaw/workspace-your/startup_daemons.sh
echo.

:: ── 第二步：啟動 OpenClaw ──
echo 🧠 啟動 OpenClaw...
docker exec -it ChiefAgent openclaw

echo.
echo ❌ OpenClaw 已關閉
pause