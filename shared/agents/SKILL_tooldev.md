# 🔧 ToolDevAgent v1.0 — 技能說明

> 位置: `shared/agents/tool_dev_agent.py`
> 記憶: `shared/memory/tool_dev_agent-memory.json`

---

## 定位
Lucas 團隊的工具開發師，負責腳本產生、Pipeline 設計、Code Review、Bug 修復。

## 呼叫方式
由 Lucas 透過 file queue 觸發。Task type 前綴：
- `[tool]` — 工具/腳本產生
- `[pipeline]` — Pipeline 設計
- `[fix]` — Bug 診斷與修復
- `[review]` — Code Review
- `[normal]` — 一般對話

## 已實作功能

### 腳本產生器 ✅
支援三種模板：

1. **Scraper（爬蟲腳本）**
   - 參數：url, selector, output_format, schedule
   - 產出：完整 Python 腳本 + README

2. **Monitor（監控腳本）**
   - 參數：check_interval, alert_type, target, threshold
   - 產出：監控腳本 + 警報設置

3. **Script（一般腳本）**
   - 參數：language, purpose, inputs, outputs
   - 產出：可執行腳本

### Pipeline 設計 ✅
- 多步驟任務的 Pipeline 架構設計
- 含步驟列表、相依關係、資料流
- 輸出 pipeline JSON + 執行順序

### Fix 診斷 ✅
- 讀取錯誤訊息/Log → 分析根因 → 建議修復方案
- 支援：Python、Node.js、Shell

### Review Checklist ✅
- 程式碼審閱清單產出（security、performance、readability、error_handling）

## 技術棧
- Python 3.11
- json（模板與配置）
- uuid（任務追蹤）
- 無外部依賴（純標準函式庫）