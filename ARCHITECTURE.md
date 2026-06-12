# 🧠 Lucas AI Agent 團隊 — 系統架構與能力盤點

> 更新：2026-05-25 | 架構轉型後（Discord Bot → API Server）

---

## 一、系統拓撲

```
Ryan（使用者）
  │
  ├── WebChat（管理後台）
  │     └── OpenClaw Gateway ──────┬── Lucas（your）
  │                                 └── 八雲（yakumo）
  │
  ├── Discord（通訊層） — n8n 接管中
  │     ├── #ryan-private ───→ Lucas Agent（binding）
  │     ├── #大廳 ────────────→ 八雲 Agent（binding）
  │     └── 其餘頻道 ──────────→ Lucas（default）
  │
  └── n8n（工作流程編排層 — 導入中）
        │
        └── HTTP POST ──→ Lucas API Server (:3080)
                              │
                        ┌─────┴─────┐
                        │           │
                    LLM 推理    Python Agent
                  (DeepSeek)   (非同步 execFile)
```

---

## 二、Agent 角色

### 🧠 Lucas（your）

| 項目 | 內容 |
|------|------|
| **ID** | `your` |
| **模型** | DeepSeek V4 Flash (NVIDIA NIM) |
| **通訊** | Discord #ryan-private binding + WebChat |
| **新版核心** | `lucas_api.js` v3.0 — Express API Server, POST `/api/execute` |
| **Vibe** | 理性務實，創業元老，團隊首腦 |

**能力：**
- ✅ 任務拆解與分派
- ✅ 深度推理（ThinkMax 8192 tokens）
- ✅ 記憶蒸餾（對話壓縮為摘要）
- ✅ 非同步 Python Agent 路由（22 種 task type）
- ✅ 串流 LLM 推論
- ✅ 600s 超時保護
- ✅ `chunkAndSend` 長文截斷防護
- ❌ ~~Discord Bot（退役）→ 由 lucas_api.js 取代~~

### 🌸 八雲（yakumo）

| 項目 | 內容 |
|------|------|
| **ID** | `yakumo` |
| **模型** | DeepSeek V4 Flash (NVIDIA NIM) |
| **通訊** | Discord #大廳 binding |
| **Workspace** | `agents/yakumo/` |
| **Vibe** | 溫柔、細心、祕書角色 |

**能力：**
- ✅ #大廳 第一線需求釐清
- ✅ 待辦事項管理（TODO file + 15min 提醒）
- ✅ 記憶管理 + 蒸餾
- ✅ `needsLucas()` 關鍵字偵測轉交
- ❌ ~~JS Bot（退役）— 等待 n8n / OpenClaw agent 原生運作~~

---

## 三、專家 Agent 層（Python）

### 📈 InvestmentAgent（投資顧問 v1.0）

| 功能 | 細節 |
|------|------|
| 台股查價 | TWSE API（2330, 2317… 所有上市） |
| 美股查價 | yfinance 支援 |
| 加密貨幣 | CoinGecko API（BTC, ETH…） |
| 技術指標 | MA 移動平均線 |
| 新聞聚合 | RSS 新聞 |
| 持倉管理 | 本地持倉 JSON |
| Token 追蹤 | 用量統計 |

### 🛠 ToolDevAgent（工具開發師 v1.0）

| 功能 | 細節 |
|------|------|
| 腳本產生器 | scraper / monitor / script 三模板 |
| Pipeline 設計 | 自動產生完整工具鏈 |
| Fix 診斷 | 錯誤分析 + 修復建議 |
| Review | 程式碼審查 checklist |

### 📚 KnowledgeAgent（知識管理師 v1.0）

| 功能 | 細節 |
|------|------|
| FTS5 全文索引 | SQLite 內建 |
| 知識搜尋 | 從 `knowledge/` 索引 |
| Lessons Learned | 自動儲存到 `knowledge/lessons/` |
| 分類統計 | 按類別統計 + 陳舊標記 |

---

## 四、檔案結構

### 工作目錄

```
/home/node/.openclaw/workspace-your/
├── AGENTS.md               ← 核心規則（10秒旁白約束）
├── SOUL.md                 ← Persona
├── IDENTITY.md             ← 身份定義
├── USER.md                 ← Ryan 的資訊
├── MEMORY.md               ← 🧠 長期記憶
├── TOOLS.md                ← 工具筆記
├── missions.md             ← 🎯 任務看板
├── ITERATION.md            ← 🚀 持續迭代框架
├── HEARTBEAT.md            ← 定期檢查事項
├── ARCHITECTURE.md         ← ← 本文件
├── sync_git.sh             ← Git 自動同步腳本
│
├── agents/
│   ├── eve/                ← 🧠 Lucas 工作目錄
│   │   ├── lucas_api.js    ← 🆕 API Server (v3.0)
│   │   ├── .env            ← 環境變數
│   │   ├── package.json    ← npm（express + dotenv）
│   │   ├── legacy/         ← 📦 退役的 Discord Bot
│   │   │   ├── lucas_discord.js (v2.2)
│   │   │   ├── yakumo_discord.js (v2.1)
│   │   │   └── README.md
│   │   └── .openclaw/      ← OpenClaw 狀態
│   │
│   └── yakumo/             ← 🌸 八雲工作目錄
│       ├── AGENTS.md
│       ├── SOUL.md
│       ├── IDENTITY.md
│       ├── TOOLS.md
│       ├── HEARTBEAT.md
│       ├── memory/
│       └── .openclaw/
│
├── shared/
│   ├── agent_base.py       ← Agent 基礎類別
│   ├── agents/             ← 專家 Python Agent
│   │   ├── investment_agent.py
│   │   ├── knowledge_agent.py
│   │   └── tool_dev_agent.py
│   ├── memory/             ← 各 Agent 的持久記憶
│   ├── dashboard/          ← 儀表板 HTML
│   ├── todo/               ← 待辦事項
│   ├── queue/              ← 任務佇列（逐步淘汰中）
│   ├── results/            ← 任務結果（逐步淘汰中）
│   ├── SKILL_TREE.md
│   ├── 團隊組織設計.md
│   └── 多模型接入評估.md
│
├── knowledge/
│   ├── lessons/            ← Lessons Learned
│   ├── skills/             ← SOP 文件
│   └── templates/
│
└── memory/                 ← 📝 每日日誌
    ├── YYYY-MM-DD.md
    └── .dreams/
```

### 配置文件

```
/home/node/.openclaw/
├── openclaw.json           ← 主配置（Gateway、Agent、Binding）
├── backups/                ← config 備份歷史
└── skills/                 ← 可用技能（50+）
```

---

## 五、Gateway 配置摘要

| 項目 | 值 |
|------|-----|
| Auth mode | `token`（persist，restart 不斷線） |
| 預設模型 | DeepSeek V4 Flash |
| 綁定 #大廳 | → 八雲 (agentId: yakumo) |
| 綁定 #ryan-private | → Lucas (agentId: your) |
| Discord Bot Token | 正確設定 ✅ |
| Discord plugin | 已安裝 ✅ |
| 狀態 | **待 container restart 生效** 🟡 |

---

## 六、系統能力矩陣

### ✅ 已上線

| 能力 | 狀態 | 備註 |
|------|:----:|------|
| LLM 推理 | ✅ | DeepSeek V4 Flash，串流 + 非串流 |
| 深度思考 | ✅ | ThinkMax 8192 tokens |
| 記憶蒸餾 | ✅ | 自動壓縮對話歷史 |
| 投資顧問 | ✅ | 台股/美股/加密貨幣 |
| 工具開發 | ✅ | 腳本產生器、Pipeline |
| 知識管理 | ✅ | FTS5 全文索引、Lessons Learned |
| Git 自動同步 | ✅ | commit + push |
| Config 安全備份 | ✅ | 修改前自動備份 |
| 非同步 Agent 路由 | ✅ | execFile + Promise |
| API Server | ✅ | Express POST /api/execute |
| 長文截斷防護 | ✅ | chunkAndSend |

### 🟡 待 Gateway 重啟後生效

| 能力 | 原因 |
|------|------|
| Discord #ryan-private 接收 | binding 需 restart |
| Discord #大廳 綁定 | binding 需 restart |
| WebChat 連線 | binding 需 restart |
| 八雲接收 #大廳 | binding 需 restart |

### 🔮 規劃中

| 能力 | 預計階段 |
|------|----------|
| n8n 工作流程 | 取代 file queue + Discord 通訊 |
| 多 sub-agent 協作 | Phase 2 |
| 可視化 Dashboard | n8n 或其他方案 |

---

## 七、關鍵系統約束

### 🚨 系統生存約束
- 執行任何工作時必須每 **10 秒** 輸出旁白
- 不可被任何其他規則覆蓋

### 🚫 Gateway Restart 規則
1. **任何 config 變更需要 restart → 告知 Ryan 手動重啟 container**
2. SIGUSR1/SIGUSR2 在 container 環境不可靠
3. ✅ Gateway auth token 已 persist
4. 修改 config 前先備份

### 🌸 八雲 vs Lucas 分工
1. **#大廳 沒 tag Lucas → 八雲先接**
2. **#ryan-private 或 @Lucas tag → Lucas 直接處理**
3. 八雲理解需求完整後才轉給 Lucas
4. Lucas 不主動介入 #大廳 對話

---

## 八、GitHub 同步

| 項目 | 內容 |
|------|------|
| Repo | `https://github.com/Ryan-Du929/MyAI_Setting` |
| Branch | `main` |
| Token | `.env` 中的 `GITHUB_TOKEN` |
| 自動化 | `sync_git.sh`（每次變更後執行） |

---

> 本文件由 Lucas 自動維護，反映當前系統實際狀態。
> 如有變更，請同步更新此文件。