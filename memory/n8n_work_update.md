# n8n + lucas_api 深夜工作進度 (2026-05-28)

## 完成事項

### 1. lucas_api.js v3.1
- ✅ 啟動成功（PID 記錄）
- ✅ Health check 正常
- ✅ LLM 推理正常（DeepSeek V4 Pro via NVIDIA NIM）
- ✅ Investment Agent 測試通過（台積電 2330 股價查詢）
- ⬜ KnowledgeAgent 待確認
- ⬜ ToolDevAgent 待確認

### 2. n8n API 連線
- ✅ API key 驗證成功
- ✅ 從 container 可連到 Windows 本機 n8n（192.168.3.2:5678）
- ✅ Workflow 讀取/更新成功

### 3. Workflow 更新
- ✅ 名稱：My workflow → Lucas AI Agent Router
- ✅ HTTP Request URL：172.17.0.2:3080 → localhost:3080
- ✅ Body 欄位修正：prompt, taskId, channel_id, user_name, profile
- ⬜ Switch 路由邏輯需要強化（目前只認關鍵字）
- ⬜ Discord Send 需要改為動態頻道

## 已知問題

### 🔴 Discord → n8n 觸發層缺失
Workflow 是 Webhook node，需要外部 POST 才能觸發。
目前缺少 Discord Bot 來監聽訊息並轉發到 n8n webhook。

**解決方案**：寫 `discord_relay.js`（極簡版，只轉發不處理）

### 🟡 HTTP Request1 (Hermes)
第二條路由指向 host.docker.internal:8000（Hermes 服務），
body 欄位 mapping 也是壞的（全綁到 content）。

### 🟡 頻道路由
Switch 只做關鍵字判斷（lucas/hermes），
沒有做頻道判斷（#ryan-private / #大廳）。
lucas_api 的 profile 參數已準備好，但 n8n 端還沒設定頻道 → profile 的對應。

## 下一步

Ryan 醒來後需要：
1. 確認是否要跑 `discord_relay.js`（我從 container 跑，連到 Discord 並轉發到 n8n）
2. 修正 Discord Send 節點改動態 channel_id
3. 新增頻道路由節點
