# n8n Workflow 設計文件 — Lucas AI Agent Team

> 最後更新：2026-05-28 01:00 UTC
> 作者：Lucas 🧠

---

## 現有 workflow 分析

### 當前架構

```
Discord → (外部 Bot) → POST Webhook → n8n Switch → HTTP Request → Discord Send
```

### 當前節點

| 節點 | 類型 | 問題 |
|------|------|------|
| Webhook | n8n-nodes-base.webhook | ✅ OK |
| Switch | n8n-nodes-base.switch | 🔴 只認關鍵字 lucas/hermes，不認頻道 |
| HTTP Request | n8n-nodes-base.httpRequest | 🔴 URL 指向舊 container IP（172.17.0.2），缺少 taskId/taskType/history/channel_id/user_name 正確欄位 |
| HTTP Request1 | n8n-nodes-base.httpRequest | 🔴 指向 host.docker.internal:8000（Hermes？），同樣欄位問題 |
| Discord Send | @jordanburke/n8n-nodes-discord.discord | 🟡 自訂 node，需確認 credential |
| Discord Send1 | @jordanburke/n8n-nodes-discord.discord | 🟡 同上 |

### 主要問題

1. **IP 錯誤** — `http://172.17.0.2:3080` 是舊 container IP，新 container 是 `172.17.0.3`
2. **欄位映射錯誤** — prompt、user_name、channel_id 全都綁到 `$json.body.content`
3. **無錯誤處理** — HTTP Request 失敗時不會 retry 或記錄
4. **Switch 路由邏輯不完整** — 只認關鍵字，沒有頻道路由
5. **lucas_api 回應處理不完整** — 沒有解析 `status`、`data`、`agent`、`elapsed` 等欄位

---

## 完整重構設計

### Target Architecture

```
Discord Event (via n8n Discord Trigger Node 或外部 Bot Webhook)
  │
  ├─ [Set: Parse Payload]
  │    └─ 從 payload 取出 content, channel_id, author, message_id
  │
  ├─ [Switch: Route by Channel]
  │    ├─ #ryan-private (1506345048625905816) → profile: brain
  │    ├─ #大廳 (1506239471325020327)       → profile: secretary
  │    ├─ #lucas-workspace → profile: brain
  │    └─ default → profile: brain
  │
  ├─ [IF: contains @Lucas or lucas keyword]
  │    └─ override profile to brain
  │
  ├─ [HTTP Request: lucas_api]
  │    └─ POST http://host.docker.internal:3080/api/execute
  │       Body: { prompt, taskId, taskType, history, profile, channel_id, user_name }
  │
  ├─ [Set: Format Response]
  │    └─ 組合回覆字串（含 agent 名稱、耗時）
  │
  ├─ [Discord Send: Reply]
  │    └─ 發送到原始頻道
  │
  └─ [Error Handler]
       └─ 錯誤記錄 + 用戶友善錯誤訊息
```

### 節點詳細規格

#### 1. Webhook (Trigger)

```
Method: POST
Path: /discord-in
Respond: Respond to Webhook
Options: Response Data Success Code = 200
```

#### 2. Set: Parse Discord Payload

```javascript
// Code node to extract fields
const body = $input.first().json.body || $input.first().json;

return {
  content: body.content || body.message?.content || '',
  channel_id: body.channel_id || body.message?.channel_id || '',
  author_id: body.author?.id || body.author?.username || body.message?.author?.id || '',
  message_id: body.id || body.message?.id || '',
  timestamp: new Date().toISOString()
};
```

#### 3. IF/Switch: Keyword Check

```
Conditions (任何符合):
  - content contains "lucas" (case-insensitive)
  - content contains "@Lucas" (case-insensitive)

Output:
  - True → Force brain profile
  - False → Use channel-based routing
```

#### 4. Switch: Channel Router

```
Route 0: channel_id === "1506345048625905816" → #ryan-private → profile: brain
Route 1: channel_id === "1506239471325020327" → #大廳 → profile: secretary
Route 2: default → profile: brain
```

#### 5. HTTP Request: lucas_api

```
URL: http://host.docker.internal:3080/api/execute
Method: POST
Body (JSON):
{
  "prompt": "{{ $json.content }}",
  "taskId": "n8n-{{ $json.timestamp }}-{{ $json.message_id }}",
  "taskType": "",  // 可選，留空讓 LLM 判斷
  "channel_id": "{{ $json.channel_id }}",
  "user_name": "{{ $json.author_id }}",
  "history": []  // 可選
}
```

#### 6. Set: Format Response

```javascript
const response = $input.first().json;
let message = '';

if (response.status === 'success') {
  message = response.data;
  const agentLabel = response.agent === 'llm' ? '' : `[${response.agent}] `;
  const timeLabel = response.elapsed ? ` (${Math.round(response.elapsed/1000)}s)` : '';
  message = agentLabel + message + timeLabel;
} else {
  message = `❌ 處理失敗：${response.data || '未知錯誤'}`;
}

return { formatted: message };
```

#### 7. Discord Send

```
Channel ID: {{ $json.channel_id }}  (使用原始頻道而非寫死)
Content: {{ $json.formatted }}
```

#### 8. Error Handler (Catch)

```
On error:
  - 記錄錯誤到 console/log
  - 回覆用戶：「抱歉，處理時發生錯誤，請稍後再試」
```

---

## Workflow JSON Export

待 n8n API key 可用後，直接透過 API 上傳新 workflow。

目前需要確認：
1. ⬜ 確認 `host.docker.internal:3080` 是否可從 n8n 連到 lucas_api
2. ⬜ 確認 Discord Send node 的 credential 設定
3. ⬜ Discord → n8n 的觸發方式（n8n Discord Trigger node 或外部 Bot Webhook）

---

## 替代方案：n8n 原生 Discord Trigger

如果 n8n 可以直接用 Discord Bot 觸發（透過 n8n Discord node 的 trigger 功能），就不需要外部 Bot。

但目前 workflow 用的是 Webhook node 表示外部已經有一個 Discord Bot 在轉發訊息到 n8n。這條路徑需要澄清。