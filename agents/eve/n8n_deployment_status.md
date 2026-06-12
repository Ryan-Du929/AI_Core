# n8n + Lucas API 深夜部署狀態
> 2026-05-28 ~02:00 UTC

## 當前執行中

| 服務 | 狀態 | 細節 |
|------|:----:|------|
| lucas_api.js v3.1 | ✅ 執行中 | localhost:3080 (PID 記錄) |
| n8n (Windows) | ✅ 執行中 | localhost:5678 |
| Discord Relay Bot | ⛔ 待啟用 | 已寫好 discory_relay.js |

## n8n Workflows

### Workflow 1: Lucas AI Agent Router (Active ✅)
**ID:** `6idzs6erfqVI40Pv`
**Webhook:** POST /webhook/discord-in
**流程:** Webhook → Switch (關鍵字) → HTTP Request → Discord Send
**已修正:**
- ✅ URL: 172.17.0.2:3080 → localhost:3080
- ✅ Body: 正確欄位 (prompt, taskId, channel_id, user_name, profile)
- ⬜ Switch: 仍然只認關鍵字 (lucas/hermes)，無頻道路由
- ⬜ Discord Send: 固定頻道 ID，非動態

### Workflow 2: Full Router v2 (Inactive ⛔)
**ID:** `vxh3Vqc8qwwGWZZt`
**11 節點設計完成，因 webhook path 衝突無法啟動**
**包含:**
- Code: Parse Payload (頻道 + 關鍵字 + profile 判定)
- IF: Mentions Lucas (優先路由)
- Switch: Channel Router (ryan-private / 大廳 / fallback)
- Error Handler
- 雙 Discord Send (固定 + 動態頻道)

## 待 Ryan 決定

1. **先 deactivate 舊 workflow，activate 新的？** (會換 webhook path 來避免衝突)
2. **啟動 Discord Relay Bot?** (discord_relay.js 在 container 跑，監聽 Discord → n8n)
3. **修正舊 workflow 的 Switch (加分頻道路由)？**
4. **Hermes 路由 (HTTP Request1) 如何處理？**

## 快速啟動指令

```bash
# 啟動 Discord Relay (在 container 內)
node /home/node/.openclaw/workspace-your/agents/eve/discord_relay.js

# 檢查 lucas_api
curl localhost:3080/health

# 測試端對端
curl -X POST http://localhost:5678/webhook/discord-in \
  -H "Content-Type: application/json" \
  -d '{"content":"test","channel_id":"1506345048625905816","author":{"username":"test"},"message_id":"test123"}'
```

## 已知問題

1. n8n 的 Discord Send node (@jordanburke) 使用固定頻道 → 回應永遠只到同一個頻道
2. 新 workflow 使用動態 channel_id，但需要確認 @jordanburke 的 node 支援
3. HTTP Request1 (Hermes) body 欄位仍為壞的 (全部綁到 content)
