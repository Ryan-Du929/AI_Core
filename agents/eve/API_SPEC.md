# 📡 Lucas API v3.1 — n8n 介接說明書 (API SPEC)

> 更新：2026-05-25 | 最後版本：v3.1

---

## Base URL

```
http://<lucas-api-host>:3080
```

| 環境 | URL |
|------|-----|
| 本機開發 | `http://localhost:3080` |
| Docker / Render | 依部署設定 |

---

## 端點一覽

| 方法 | 路徑 | 說明 |
|:----:|------|------|
| `GET` | `/health` | 健康檢查（無需認證） |
| `POST` | `/api/execute` | 主要任務執行端點 |

---

## 1. GET /health

### Request

無 body，無 header 要求。

### Response

```json
{
  "status": "ok",
  "service": "lucas-api",
  "version": "3.1",
  "uptime": 3600.5
}
```

| 欄位 | 型態 | 說明 |
|------|:----:|------|
| `status` | string | `"ok"` 代表正常 |
| `service` | string | 服務名稱 |
| `version` | string | API 版本號 |
| `uptime` | number | 啟動以來的秒數 |

---

## 2. POST /api/execute

### Headers

| Header | 值 | 必填 |
|--------|:---:|:----:|
| `Content-Type` | `application/json` | ✅ 是 |

> 目前無 API Key 認證（若需要對外網暴露，建議放在反向代理後方、或自行在 Express 加入驗證中介層）

### Request Body

```json
{
  "prompt": "幫我查台積電2330股價",
  "taskId": "n8n-workflow-001",
  "taskType": "price",
  "history": [
    { "role": "user", "content": "今天股票怎麼樣" },
    { "role": "assistant", "content": "我可以幫你查詢，請提供股號" }
  ]
}
```

#### 欄位說明

| 欄位 | 型態 | 必填 | 說明 |
|------|:----:|:----:|------|
| `prompt` | string | **是** | 使用者的提問或任務內容 |
| `taskId` | string | 否 | 追蹤用 ID，建議傳入 n8n 的 workflow/node ID |
| `taskType` | string | 否 | **Agent 路由用**。不傳則走 LLM 推理。支援值見下表 |
| `history` | array | 否 | 對話歷史。每項需有 `role`（user/assistant）和 `content` |
| `profile` | string | 否 | **LLM 路徑的角色設定**：`brain`（預設）或 `secretary`。有 `taskType` 命中 Python agent 時不使用此欄位 |

#### 支援的 taskType 值

| taskType | 路由至 | 用途 |
|----------|--------|------|
| `price` / `quote` / `investment` | InvestmentAgent | 股價查詢、投資分析 |
| `technical` | InvestmentAgent | 技術指標 |
| `news` | InvestmentAgent | 新聞聚合 |
| `portfolio` / `report` | InvestmentAgent | 持倉管理、報告 |
| `search` / `extract` / `knowledge` | KnowledgeAgent | 知識庫搜尋 |
| `save_lesson` / `classify` / `stats` | KnowledgeAgent | Lessons Learned |
| `new_tool` / `tool_dev` | ToolDevAgent | 工具腳本產生 |
| `pipeline` / `scraper` / `monitor` | ToolDevAgent | Pipeline 設計 |
| `fix` / `integration` | ToolDevAgent | 修復診斷 |
| *(不傳或無對應)* | **LLM 推理** | 一般對話 |

---

### Response — 成功

```json
{
  "status": "success",
  "data": "2330 台積電\n日期: 2026-05-22\n收盤價: 2255.00\n月均價: 2249.00",
  "taskId": "n8n-workflow-001",
  "agent": "investment_agent.py",
  "elapsed": 1027
}
```

| 欄位 | 型態 | 說明 |
|------|:----:|------|
| `status` | string | `"success"` |
| `data` | string | LLM 回覆或 Agent 結果文字（可能很長，**不受 2000 字限制**） |
| `taskId` | string/null | 與 request 相同，追蹤用 |
| `agent` | string | 實際處理的 agent：`"llm"` 或 `"investment_agent.py"` 等 |
| `elapsed` | number | 處理耗時（毫秒） |

---

### Response — 錯誤

#### 400 — 參數錯誤

```json
{
  "status": "error",
  "data": "缺少必要欄位：prompt（字串）",
  "taskId": null,
  "agent": null
}
```

#### 429 — 限流（由 Lucas API 內部處理）

> Lucas API 會自動重試，最多 3 次（5s → 15s → 放棄）。
> 若 3 次後仍 429，回傳 500。

#### 500 — 伺服器錯誤

```json
{
  "status": "error",
  "data": "伺服器內部錯誤：NVIDIA API 429 — 已重試 3 次，放棄",
  "taskId": "n8n-workflow-001",
  "agent": null,
  "elapsed": 32050
}
```

> **保證**：伺服器永不 crash。所有未捕捉錯誤經 Error Middleware 攔截為 HTTP 500。

---

## LLM Provider 設定（NVIDIA NIM / Groq）

Lucas API 使用 OpenAI 相容的 ChatCompletions 介面，環境變數命名沿用 `OPENAI_*`：

| 變數 | 用途 | 預設 |
|------|------|------|
| `OPENAI_API_KEY` | LLM API Key | （無，必填） |
| `OPENAI_BASE_URL` | OpenAI 相容 base url | `https://integrate.api.nvidia.com/v1` |
| `OPENAI_MODEL` | model id | `deepseek-ai/deepseek-v4-pro` |

NVIDIA NIM（建議）：

```env
OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
OPENAI_API_KEY=<your_nvidia_nim_key>
OPENAI_MODEL=deepseek-ai/deepseek-v4-pro
```

Groq（OpenAI 相容端點；用 Groq key 填到 `OPENAI_API_KEY`）：

```env
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=<your_groq_key>
OPENAI_MODEL=llama-3.3-70b-versatile
```

---

## 主腦 / 祕書（profile）用法

### profile=brain（預設）

不傳 `profile` 時，LLM 會以「Lucas 主腦」身份回覆（決策、拆解、整合）。

### profile=secretary（需求補齊）

`profile=secretary` 時，LLM 會以「八雲祕書」身份回覆，偏向把需求整理成可執行規格（並在資訊不足時提出 1~3 個關鍵澄清問題）。

範例：

```json
{
  "prompt": "幫我做一個每週投資報告，包含持倉、績效、下週策略",
  "taskId": "n8n-demo-002",
  "profile": "secretary"
}
```

---

### Response — 404（端點不存在）

```json
{
  "status": "error",
  "data": "找不到端點：POST /api/wrong-path",
  "taskId": null,
  "agent": null
}
```

---

## n8n 設定教學

### HTTP Request Node 配置

```
Method: POST
URL: http://localhost:3080/api/execute
Authentication: None (或 Bearer Token — 未來啟用時)
```

### Body (JSON) 範例 — 從 n8n 變數動態帶入

```json
{
  "prompt": "{{ $json.message }}",
  "taskId": "{{ $json.taskId }}",
  "taskType": "{{ $json.taskType }}",
  "history": "{{ $json.history }}"
}
```

### 處理 Response

```javascript
// n8n Function Node 範例
const body = $input.first().json;
if (body.status === "success") {
  return [{ reply: body.data }];
} else {
  throw new Error(body.data);
}
```

---

## 速率限制與穩定性

| 項目 | 數值 |
|------|:----:|
| Request body 上限 | 10 MB |
| LLM timeout | 300 秒（5 分鐘） |
| Agent timeout | 60 秒（1 分鐘） |
| 429 重試策略 | 指數退避：5s → 15s → 放棄 |
| 單一 agent 重試次數 | 3 次上限 |

---

## 版本歷程

| 版本 | 日期 | 變更 |
|:----:|:----:|------|
| v3.1 | 2026-05-25 | Error Middleware、429 exponential backoff、agent_runner.js 分離 |
| v3.0 | 2026-05-25 | 初始 API 版本（Discord Bot → API Server 轉型） |

---

> 有問題請找 Ryan 或 Lucas。
