# API_SPEC.md — Docker 內網 API 座標（正式版）

> ⚠️ **強制規則**：n8n 容器內呼叫 API 時，**絕對不能**使用 `localhost` 或 `127.0.0.1`。  
> 原因：n8n 與目標服務跑在不同容器，`localhost` 只指向本容器，連不到隔壁。
>
> 必須使用 **Docker 內部 DNS 名稱**（service name）或 **固定內網 IP**。

---

## 🧠 Lucas API（主腦推論引擎）

| 欄位 | 值 |
|------|----|
| **Service Name** | `myai-lucas-api-1` |
| **Port** | `3080` |
| **Docker 內部 URL** | `http://myai-lucas-api-1:3080` |
| **內網 IP（Fallback）** | `172.17.0.3` |
| **Fallback URL** | `http://172.17.0.3:3080` |
| **端點** | `POST /api/execute` |
| **健康檢查** | `GET /health` |
| **支援 Profile** | `brain`（Lucas 主腦）, `secretary`（八雲祕書） |
| **Timeout 建議** | 120,000 ms |

### n8n HTTP Request 節點設定

```
Method: POST
URL: http://myai-lucas-api-1:3080/api/execute
Send Body: true
Timeout: 120000

Body Parameters:
  - prompt    → {{ $json.content }}
  - taskId    → {{ $json.taskId }}
  - channel_id → {{ $json.channel_id }}
  - user_name → {{ $json.author_name }}
  - profile   → {{ $json.profile }}
```

### Response 格式
```json
{
  "status": "success",
  "data": "回覆內容...",
  "taskId": "n8n-...",
  "agent": "llm:brain",
  "elapsed": 12345
}
```

---

## 🦅 Hermes API（外掛重裝腦）

| 欄位 | 值 |
|------|----|
| **Service Name** | `hermes-agent-test` |
| **Port** | `8000` |
| **Docker 內部 URL** | `http://hermes-agent-test:8000` |
| **內網 IP（Fallback）** | `172.17.0.4` |
| **Fallback URL** | `http://172.17.0.4:8000` |
| **端點** | `POST /api/chat` |
| **Timeout 建議** | 60,000 ms |

### n8n HTTP Request 節點設定

```
Method: POST
URL: http://hermes-agent-test:8000/api/chat
Send Body: true
Timeout: 60000

Body Parameters:
  - user_name → {{ $json.author_name }}
  - message   → {{ $json.content }}
```

### Response 格式
```json
{
  "response": "回覆內容..."
}
```

> ⚠️ **Hermes API 規格限制**：只接受 `user_name` 與 `message` 兩個欄位。  
> 不要送 `taskId`、`channel_id`、`profile` 等額外欄位 → Hermes 會忽略但最好遵守規格。

---

## 🔀 Routing Summary

| 來源頻道 | 提及 Lucas？ | 指派對象 | API URL |
|---------|:----------:|:---------:|---------|
| #ryan-private | 不限 | Lucas 🧠 | `http://myai-lucas-api-1:3080/api/execute` |
| #大廳 | 否 | 八雲（Groq NLU）→ 派單 | 依 NLU 結果 |
| #大廳 | 是 | Lucas 🧠 | `http://myai-lucas-api-1:3080/api/execute` |
| 其他頻道 | 不限 | Lucas 🧠 | `http://myai-lucas-api-1:3080/api/execute` |
| NLU 結果 = lucas | — | Lucas 🧠 | `http://myai-lucas-api-1:3080/api/execute` |
| NLU 結果 = hermes | — | Hermes 🦅 | `http://hermes-agent-test:8000/api/chat` |

---

## 🐳 Docker Compose Service Names 確認方式

若 container 名稱有異動，可透過以下指令查詢：

```bash
# 列出所有 container 的名稱
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"

# 查特定 service 的 IP
docker inspect <container_name> | grep IPAddress
```

> 當前已知 service names（2026-05-29 快照）：
> - **Lucas API container:** `myai-lucas-api-1`
> - **Hermes container:** `hermes-agent-test`
> - **n8n container:** `n8n`（或 `myai-n8n-1`，視 compose 設定）

---

*⚠️ 嚴禁任何 n8n 節點使用 localhost:3080 或 localhost:8000 → 那只會連到 n8n 自己，不是目標服務。*