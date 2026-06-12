# 🧠 MEMORY.md — Lucas 記憶快照（2026-05-28 更新）

> 全面更新反映大一統微服務架構

## 我的身份
- **名字：** Lucas
- **角色：** AI agent 團隊首腦 + 主腦推論引擎
- **模型：** DeepSeek V4 Flash (NVIDIA NIM)
- **Vibe：** 理性務實，創業元老
- **GitHub：** https://github.com/Ryan-Du929/MyAI_Setting

## 八雲的身份
- **名字：** 八雲
- **角色：** 祕書、任務協調、n8n 總機
- **模型：** DeepSeek V4 Flash (NVIDIA NIM)
- **OpenClaw agent ID：** `yakumo`
- **Workspace：** `agents/yakumo/`
- **Vibe：** 溫和、細心、有條理

## 團隊架構（2026-05-28 大一統微服務版）

```
使用者 (Discord)
  │
  ▼
Python Gateway (gateway.py) ← Windows 主機, discord.py
  │ 秒回 ⏳ + 轉發 payload
  ▼
n8n 總機「八雲」← Docker, Port 5678
  │
  ├── Switch 路由 (關鍵字 / Groq NLU)
  │
  ├──▶ Lucas API (172.17.0.3:3080) — 主腦 Node.js
  │      POST /api/execute
  │      └── agent_runner.js → Python Agent 子行程
  │           ├── investment_agent.py (股價/投資)
  │           ├── knowledge_agent.py (知識庫)
  │           └── tool_dev_agent.py (腳本工具)
  │
  └──▶ Hermes API (172.17.0.4:8000) — 外掛重裝腦 Python
         POST /api/chat
         └── FastAPI + 92 項技能庫
  │
  ▼
n8n Discord Send node → 回覆頻道
```

## 系統分層

| 層級 | 元件 | 語言 | 位置 |
|------|------|:----:|:----:|
| 通訊感知 | gateway.py | Python 🐍 | Windows 主機 |
| 路由編排 | n8n (八雲) | Low-code | Docker Container |
| 推論核心 | lucas_api.js | Node.js 🟢 | Docker (172.17.0.3:3080) |
| 外掛重裝 | Hermes (server.py) | Python 🐍 | Docker (172.17.0.4:8000) |

### 核心設計原則
- **嚴禁破壞解耦**：大腦層絕對禁止引入 Discord 監聽套件
- **全域錯誤捕捉**：所有 API 500 回傳，永不 crash
- **Windows 檔案掛載**：容器 Volume 綁定 E:\Ryan\MyAI\

## Discord 頻道 ID 對照表
| 頻道名稱 | Channel ID |
|---------|-----------|
| #大廳 | 1506239471325020327 |
| #內部通訊 | 1506239473036300310 |
| #yakumo-desk | 1506239474731057192 |
| #lucas-workspace | 1506239475825643613 |
| #logs | 1506239477561950250 |
| #待辦事項 | 1506333474355810524 |
| #ryan-private | 1506345048625905816 |
| #知識庫 | 1506448287979405502 |

## 團隊成員（2026-06-10 更新）
| Agent | ID | 模型 | 角色 |
|-------|:----:|:----:|:----:|
| 🧠 Lucas | `your` | DeepSeek V4 Flash | 首腦 + 主腦推論引擎 |
| 🌸 八雲 | `yakumo` | DeepSeek V4 Flash | 祕書、任務協調 |
| 👁️ 視覺 | `vision` | Llama 4 Maverick (multimodal) | 圖像分析專用 sub-agent |

## 當前運行狀態（2026-06-10）
### ✅ 運行中
- lucas_api.js v3.1 — Express port 3080, PID 2311
- n8n (Windows) — port 5678, Workflow 1 active
- gateway.py (Windows) — Discord 通訊層
- Hermes container — 172.17.0.4:8000

### ⛔ 已停止 / 不需要
- discord_relay.js — 由 gateway.py 取代
- lucas_discord.js / yakumo_discord.js — 退役至 legacy/
- OpenClaw Discord plugin — disabled (enabled: false)

### 📋 n8n Workflows
1. **Lucas AI Agent Router** (Active ✅) — 4+2 nodes, webhook → switch → HTTP → Discord Send
2. **Full Router v2** (Inactive ⛔) — 11 nodes, path conflict, 留作參考

## 任務狀態
- T01~T12 — 全部完成 ✅（核心架構建置）
- T13 — 維護迭代（大部分已勾選，但有些需要在新架構下重新驗證）

## 🔴 重大教訓
### Gateway Restart — 永遠不要自行觸發
1. 任何 config 變更需要 restart → 告知 Ryan 手動重啟 container
2. SIGUSR1/SIGUSR2 在 container 環境會產生新 runtime token
3. ✅ Gateway auth token 已 persist
4. 修改 config 前先備份

## 權限清單
- ✅ GitHub Token (MyAI_Setting + AI_Line_bot)
- ✅ Render API Key
- ✅ LINE Channel Access Token + Secret
- ✅ NVIDIA NIM API Key (DeepSeek V4 Flash + Llama 4 Maverick)
- ✅ Discord Bot Token (由 gateway.py 管理)
- ✅ Groq API Key
- ✅ n8n API Key (Windows 端)