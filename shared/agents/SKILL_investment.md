# 📊 InvestmentAgent v1.0 — 技能說明

> 位置: `shared/agents/investment_agent.py`
> 記憶: `shared/memory/investment_agent-memory.json`

---

## 定位
Lucas 團隊的投資顧問，負責股市與加密貨幣的行情查詢、技術分析、市場報告。

## 呼叫方式
由 Lucas 透過 file queue 觸發。Lucas 寫入 queue → InvestmentAgent 處理 → 寫回 results。

Task type 前綴：
- `[price]` — 查詢價格
- `[stats]` — 技術指標查詢
- `[search]` — 新聞/資訊搜尋
- `[report]` — 產出完整市場報告
- `[btc]` — 加密貨幣相關
- `[normal]` — 一般對話
- `[tool]` — 工具使用

## 已實作功能

### 台灣股市 ✅
- 即時股價查詢（TWSE Open Data）
- 支援股票代號 + 中文名稱查詢（例如「台積電」→ 2330）
- 技術指標：MA (5/20/60), RSI (14), MACD, Bollinger Bands

### 加密貨幣 ✅
- Bitcoin / Ethereum 即時價格（CoinGecko API）
- BTC 技術指標（MA, RSI, MACD, Bollinger）

### 市場報告 ✅
- 多檔股票 + 加密貨幣一次性報告
- 含收盤價、漲跌幅、技術指標

### 新聞 RSS ✅
- 支援 RSS feed 爬取（新聞摘要）

## 待實作（未來迭代）
- [ ] 美股支援（yfinance / Alpha Vantage）
- [ ] 持倉管理（portfolio.json 讀寫）
- [ ] 再平衡建議
- [ ] 價格警報機制
- [ ] 情緒分析（新聞 NLP）

## 技術棧
- Python 3.11
- requests (TWSE / CoinGecko / RSS)
- pandas + numpy（技術指標計算）
- json（記憶與資料儲存）
- uuid（任務追蹤）