# 📚 KnowledgeAgent v1.0 — 技能說明

> 位置: `shared/agents/knowledge_agent.py`
> 記憶: `shared/memory/knowledge_agent-memory.json`

---

## 定位
Lucas 團隊的知識管理師，負責知識索引、全文搜尋、Lessons Learned 管理。

## 呼叫方式
由 Lucas 透過 file queue 觸發。Task type 前綴：
- `[search]` — FTS5 全文搜尋
- `[learn]` — Lessons Learned 撰寫/儲存
- `[stats]` — 知識統計
- `[review]` — Lessons Learned 審閱
- `[normal]` — 一般對話

## 已實作功能

### FTS5 全文搜尋 ✅
- SQLite FTS5 引擎
- 索引範圍：knowledge/lessons/ + knowledge/skills/
- 支援中英文混合搜尋
- 返回：檔案路徑、匹配段落、相關度分數

### Lessons Learned 儲存 ✅
- 自動分類：技術、流程、溝通、決策
- 含標籤系統
- 每則 lessons 含：日期、作者、標題、分類、標籤、內容

### 知識統計 ✅
- Lessons Learned 總數與分類統計
- 趨勢分析（每月新增量）
- 最近更新列表

### Lessons 審閱 ✅
- 讀取 lessons → AI 審閱 → 提供改善建議
- 標記 outdated → 建議歸檔

## 知識索引範圍（目前）
```
knowledge/
├── lessons/      → Lessons Learned 存放（FTS5 索引中）
├── skills/       → SOP 與技能文件
├── templates/    → 任務/報告模板
└── README.md     → 總索引
```

## 技術棧
- Python 3.11
- SQLite3（FTS5 全文搜尋引擎）
- json（記憶與配置）
- uuid（任務追蹤）