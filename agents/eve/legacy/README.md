# 🗂️ Legacy — 退役的 Discord Bot

這些檔案是從 `agents/eve/` 遷移過來的舊版 Discord JS Bot，於 2026-05-25 退役。

## 退役原因

全面轉型為純後端 API 伺服器（`lucas_api.js`），由 n8n 接管通訊層。

## 檔案清單

| 檔案 | 說明 | 最後版本 |
|------|------|---------|
| `lucas_discord.js` | Lucas Discord Bot | v2.2 (ThinkMax + Agent Router) |
| `yakumo_discord.js` | 八雲 Discord Bot | v2.1 (ThinkMax + Groq fallback) |
| `lucas_bot.log` | Lucas 執行日誌 | 最後更新 2026-05-23 |
| `yakumo_bot.log` | 八雲執行日誌 | 最後更新 2026-05-23 |

## 如何還原

```bash
cp agents/eve/legacy/lucas_discord.js agents/eve/lucas_discord.js
cp agents/eve/legacy/yakumo_discord.js agents/eve/yakumo_discord.js
# 確保 package.json 有 discord.js 依賴
npm install discord.js
```

## 備份留存理由

保留原始碼以備未來參考架構、路由邏輯、串流實作等用途。