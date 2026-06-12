# Lucas API Server — 交易日記 + 行情系統

## 架構總覽

```
lucas-api-server/          ← API 伺服器
├── server.js              ← Express 入口 (port 3080)
├── db.js                  ← SQLite 資料庫 (sql.js 引擎+檔案持久化)
├── services/
│   ├── market.js          ← 行情抽象層 (預設 Yahoo Finance)
│   └── sinopac.js         ← [預留] 永豐 Shioaji 行情橋接
├── test/
│   └── smoke.js           ← 冒煙測試 13 項
├── trading.db             ← SQLite 資料庫檔案 (自動生成)
├── db_backups/            ← 每日資料庫備份
└── package.json

trading-diary/
└── index.html             ← 前端 SPA (API + localStorage 雙模式)
```

## 資料表設計

| 表 | 用途 | 未來/回測共用 |
|:---|:-----|:-------------|
| `trades` | 交易日記 (進出場/損益/原因/標籤) | ✅ |
| `stock_prices` | 股價歷史 K 線 (日K) | ✅ 回測需用 |
| `portfolios` | 持倉管理 | ✅ |
| `backtest_results` | [預留] 回測結果 | ✅ 新表 |

## API 端點

### 交易日記
| 方法 | 路徑 | 說明 |
|:----|:-----|:-----|
| GET | `/api/trades` | 列出交易 (支援 filter) |
| POST | `/api/trades` | 新增交易 |
| DELETE | `/api/trades/:id` | 刪除交易 |
| GET | `/api/trades/stats` | 統計分析 (勝率/損益/曲線) |

### 行情資料
| 方法 | 路徑 | 說明 |
|:----|:-----|:-----|
| GET | `/api/market/quote/:symbol` | 即時報價 (Yahoo) |
| GET | `/api/market/history/:symbol` | 歷史K線 |
| POST | `/api/market/fetch` | 抓取歷史K線並存入DB |
| GET | `/api/stocks/:symbol` | 從 DB 查詢已存的股價 |

### 投資組合
| 方法 | 路徑 | 說明 |
|:----|:-----|:-----|
| GET | `/api/portfolios` | 持倉列表 |
| POST | `/api/portfolios` | 新增持倉 |
| DELETE | `/api/portfolios/:id` | 刪除持倉 |

## 行情來源切換

目前預設 `yahoo` (Yahoo Finance，免 API Key)。
未來 Windows 端裝好 Shioaji 後可切換：

```bash
curl -X POST http://localhost:3080/api/config/market-source \
  -H "Content-Type: application/json" \
  -d '{"source":"shioaji"}'
```

需同時設定 sinopac.js 的 shioajiHost/Port 指向 Windows 主機 IP。

## 啟用方式

```bash
cd lucas-api-server
npm start
# → http://localhost:3080 (Frontend)
# → http://localhost:3080/api/health (Health)
```

## 資料庫持久化

- 每 5 秒自動 flush 到 `trading.db`
- 每日 UTC 16:00 自動備份到 `db_backups/`
- 支援離線 localStorage fallback (前端自動切換)