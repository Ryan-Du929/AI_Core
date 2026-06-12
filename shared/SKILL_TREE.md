# 🧠 Lucas 團隊 — 專家技能樹 (Skill Tree) v1.0
> 建立於 2026-05-22 | 設計：Lucas

---

## 總覽

本文件定義 Lucas 團隊未來三位專家的技能框架。
每位專家繼承 `BaseAgent`，擁有獨立記憶、任務處理 pipeline、Token 追蹤與通訊介面。
所有實作位於 `shared/agents/`，設定集中在 `shared/agent_config/`。

```
Lucas (Dispatcher)
 ├── 投資顧問 (InvestmentAgent)
 ├── 工具開發師 (ToolDevAgent)
 └── 知識管理師 (KnowledgeAgent)
```

---

## 1️⃣ 投資顧問 (InvestmentAgent)

**定位：** 財務、股市、加密貨幣分析與決策支援

### 核心職責
- 即時股價/加密貨幣行情查詢與技術分析
- 投資組合風險評估與再平衡建議
- 市場新聞摘要與事件驅動分析
- 定期產出技術分析報告

### 技能樹

```
InvestmentAgent/
├── data/                         # 資料層
│   ├── market.py                 # 行情擷取（實時 + 歷史）
│   ├── news.py                   # 新聞聚合與情緒分析
│   └── portfolio.py              # 持倉管理
├── analysis/                     # 分析層
│   ├── technical.py              # 技術指標（MA, RSI, MACD, Bollinger）
│   ├── fundamental.py            # 基本面（P/E, EPS, 營收）
│   └── sentiment.py              # 情緒分析（News NLP）
├── reports/                      # 報告層
│   ├── daily_summary.py          # 每日市場摘要
│   ├── alert.py                  # 價格/波動率警報
│   └── rebalance.py              # 再平衡建議
├── config.yaml                   # API Keys, 關注清單
└── SKILL.md                      # Agent 技能說明
```

### 技術需求
| 技能 | 重要性 | 實作方式 |
|------|--------|----------|
| 股票 API | ★★★★★ | Yahoo Finance (yfinance) / TWSE Open Data |
| 加密貨幣 API | ★★★★☆ | Binance / CoinGecko REST API |
| 技術指標計算 | ★★★★☆ | TA-Lib / pandas + numpy |
| 情緒分析 | ★★★☆☆ | DeepSeek / 自訂 sentiment model |
| 排程任務 | ★★★★☆ | cron / APScheduler（定時產報表） |
| 資料存儲 | ★★★☆☆ | JSON 檔案 / 後期升級 SQLite |

### API 預先串接
1. **台灣證券交易所 (TWSE)** — 每日股價, 三大法人買賣超
2. **Yahoo Finance** — 國際股市, 技術指標資料
3. **CoinGecko / Binance** — 加密貨幣即時價格
4. **Google News / RSS** — 財經新聞串流
5. **DeepSeek API** — 情緒分析與報告生成

---

## 2️⃣ 工具開發師 (ToolDevAgent)

**定位：** 內部工具、腳本、自動化 pipeline 開發

### 核心職責
- 開發與維護團隊自動化腳本
- 建立 Data pipeline（擷取 → 處理 → 儲存）
- 開發 CLI 小工具供團隊使用
- 整合外部 API 與服務
- 部署與監控（Docker / Render / cron）

### 技能樹

```
ToolDevAgent/
├── pipeline/                     # 資料處理 pipeline
│   ├── scraper/                  # 網頁爬蟲
│   │   ├── base.py              # 通用爬蟲基底
│   │   ├── twse.py              # TWSE 爬蟲
│   │   └── news.py              # 新聞爬蟲
│   ├── transform/                # ETL 轉換
│   │   ├── clean.py             # 資料清洗
│   │   └── aggregate.py         # 聚合計算
│   └── storage/                  # 儲存層
│       ├── json_store.py        # JSON 檔案儲存
│       └── sqlite_store.py      # SQLite 儲存（後期）
├── tools/                        # CLI 工具
│   ├── backup.py                 # 備份管理
│   ├── monitor.py                # 服務監控
│   └── notify.py                 # 通知工具（Discord / Email）
├── integration/                  # 第三方整合
│   ├── discord_bridge.py         # Discord Bot 功能擴充
│   ├── line_bot.py               # LINE Bot 橋接
│   └── github_sync.py            # GitHub 自動同步強化
├── deploy/                       # 部署工具
│   ├── dockerfile.py             # Docker 映像生成
│   └── render_deploy.py          # Render 部署腳本
└── SKILL.md
```

### 技術需求
| 技能 | 重要性 | 實作方式 |
|------|--------|----------|
| Python 程式設計 | ★★★★★ | 標準庫 + requests/httpx |
| 網頁爬蟲 | ★★★★☆ | BeautifulSoup / Playwright |
| 資料庫操作 | ★★★★☆ | SQLite (初期) → PostgreSQL (後期) |
| REST API 開發 | ★★★★☆ | FastAPI (後期微服務) |
| Docker | ★★★☆☆ | Container 化部署 |
| Git 自動化 | ★★★☆☆ | GitPython / shell hooks |

### 預期產出
1. **自動 TWSE 每日股價爬蟲** → 存 JSON → 供投資顧問分析
2. **服務健康監控工具** → 檢查所有 daemon 狀態，異常通知
3. **Discord Bot 功能擴充** → Slash command / Modal / Button
4. **資料批次處理 pipeline** → 定時 ETL 任務

---

## 3️⃣ 知識管理師 (KnowledgeAgent)

**定位：** 團隊知識庫、學習記錄、技術文件管理

### 核心職責
- 團隊知識庫自動擷取與分類
- 學習記錄管理（Lessons Learned）
- 技術文件版本管理與索引
- 跨 Agent 知識共享介面（參考八雲的 queue 模式）

### 技能樹

```
KnowledgeAgent/
├── extraction/                   # 知識擷取
│   ├── from_discord.py           # 從 Discord 頻道自動擷取
│   ├── from_files.py             # 從 workspace 檔案掃描
│   └── from_conversations.py     # 從 Agent 對話蒸餾
├── classification/               # 知識分類
│   ├── tagger.py                 # 自動標籤（規則 + LLM）
│   ├── dedup.py                  # 去重與相似度比對
│   └── indexer.py                # 全文索引（for 搜尋）
├── storage/                      # 儲存層
│   ├── knowledge_base.py         # 知識庫核心 CRUD
│   ├── search.py                 # 語意搜尋引擎
│   └── export.py                 # 導出（Markdown / JSON / HTML）
├── lifecycle/                    # 生命週期管理
│   ├── review_scheduler.py       # 定期審閱排程
│   ├── archive.py                # 歸檔舊知識
│   └── stats.py                  # 知識庫統計
├── knowledge/                    # 實際知識存放目錄
│   ├── lessons/                  # Lessons Learned
│   ├── skills/                   # 技能說明
│   ├── templates/                # 模板
│   └── archive/                  # 已歸檔
└── SKILL.md
```

### 技術需求
| 技能 | 重要性 | 實作方式 |
|------|--------|----------|
| NLP 基礎 | ★★★★☆ | LLM prompt engineering + keyword |
| 全文搜尋 | ★★★★☆ | Whoosh / SQLite FTS5 |
| 文件壓縮/清洗 | ★★★☆☆ | Markdown parsing |
| 分類器設計 | ★★★☆☆ | 規則引擎 + LLM fallback |
| diff/git 操作 | ★★★☆☆ | 檔案版本比較 |

### 預期產出
1. **Discord 自動知識擷取** → 從 #知識庫 / #logs 提煉知識點
2. **知識搜尋引擎** → 關鍵字 + 語意混合搜尋
3. **定時知識審閱提醒** → 標記過期知識，提醒更新
4. **跨 Agent 知識同步** → 知識變更 → 通知相關 Agent

---

## 4️⃣ 實作路徑圖

```
Phase 1 (Current)     Phase 2 (Next)             Phase 3 (Future)
┌──────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│  Lucas    │    │  InvestmentAgent    │    │  Agent Dashboard    │
│  + 八雲   │───▶│  - Stock scraper    │───▶│  - Streamlit UI     │
│  Queue    │    │  - Tech analysis    │    │  - Token tracking   │
│  Base     │    │  - Daily report     │    │  - Real-time monitor│
│  Agent    │    ├─────────────────────┤    ├─────────────────────┤
│           │    │  ToolDevAgent       │    │  Agent Mesh Network │
│           │───▶│  - Pipeline tools   │───▶│  - Auto-discovery   │
│           │    │  - Service monitor  │    │  - Gossip protocol  │
│           │    │  - Discord expand   │    │  - Self-healing     │
│           │    ├─────────────────────┤    ├─────────────────────┤
│           │    │  KnowledgeAgent     │    │  External Integrate │
│           │───▶│  - Discord extract  │───▶│  - LINE Bot bridge  │
│           │    │  - Full-text search │    │  - Twitter monitor  │
│           │    │  - Lifecycle mgmt   │    │  - Email agent      │
└──────────┘    └─────────────────────┘    └─────────────────────┘
      ▲                  ▲                           ▲
      │                  │                           │
  NOW              1-2 週後                   3-4 週後
```

---

## 5️⃣ 共通基礎設施

所有專家共享：

| 元件 | 檔案 | 說明 |
|------|------|------|
| Base Agent | `shared/agent_base.py` | 統一生命週期、記憶、通訊 |
| Webhook Report | `shared/webhook_report.py` | Embed + Chunk + Backoff |
| Memory Distill | `memory_distill.py` | 記憶蒸餾引擎 |
| Auto Backup | `auto_backup.py` | 自動備份 daemon |
| Token Tracker | BaseAgent.get_token_report() | 用量監控 |
| Queue Protocol | `shared/queue/` + `shared/results/` | Agent 間通訊 |
| Mission Board | `missions.md` | 任務看板 |

---

## 6️⃣ 風險與待解問題

| 風險 | 影響 | 緩解方案 |
|------|------|----------|
| API 費用超支 | Token 用量不受控 | 加入 Token 上限 + 警報 |
| 單點故障 (Lucas) | 所有 Agent 依賴 Lucas | Dispatcher 可獨立運作 |
| 記憶爆炸 | JSON 檔案過大 | 定期蒸餾 + 自動歸檔 |
| 外部 API 變更 | TWSE/Binance 改版 | 抽象層隔離 + 錯誤處理 |
| 時區問題 | 台灣 UTC+8 vs API UTC | 統一 UTC 儲存，顯示時轉換 |

---

*本文件由 Lucas 於 2026-05-22 00:45 UTC 建立*
*將持續迭代更新*