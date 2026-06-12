# 🤖 Lucas 團隊 — Agent 目錄

> 最後更新: 2026-05-24

---

## 團隊架構

```
Ryan ←→ Discord
         ├── #大廳 → 八雲（祕書、第一線窗口）
         │    ├── 一般需求 → 八雲直接處理
         │    └── 需執行任務 → 轉 Lucas
         ├── #ryan-private → Lucas（團隊首腦、執行者）
         ├── @Lucas tag → Lucas
         └── 其他頻道 → Lucas（預設）

Lucas ←→ shared/queue/ (JSON)
         ↕ shared/results/ (JSON)
         └── 投資顧問 (InvestmentAgent)
         └── 工具開發師 (ToolDevAgent)
         └── 知識管理師 (KnowledgeAgent)
```

---

## Agent 列表

| Agent | ID | 角色 | 狀態 | 檔案位置 |
|-------|-----|------|------|---------|
| **Lucas** 🧠 | `your` | 團隊首腦、任務執行 | ✅ 線上 | `workspace-your/` |
| **八雲** 🌸 | `yakumo` | 祕書、任務協調 | ✅ 線上 | `workspace-your/agents/yakumo/` |
| InvestmentAgent 📊 | — | 投資顧問 | ✅ 實作 | `shared/agents/investment_agent.py` |
| ToolDevAgent 🔧 | — | 工具開發師 | ✅ 實作 | `shared/agents/tool_dev_agent.py` |
| KnowledgeAgent 📚 | — | 知識管理師 | ✅ 實作 | `shared/agents/knowledge_agent.py` |

---

## 各 Agent 檔案結構

### Lucas (`your`)
```
workspace-your/
├── AGENTS.md        → 運作規則（含系統生存約束）
├── SOUL.md          → Persona
├── IDENTITY.md      → 身份描述
├── MEMORY.md        → 長期記憶（包含頻道ID、架構規則）
├── USER.md          → Ryan 資訊
├── TOOLS.md         → 工具筆記
├── HEARTBEAT.md     → 定期任務
├── memory/          → 每日日誌
└── missions.md      → 任務看板
```

### 八雲 (`yakumo`)
```
agents/yakumo/
├── AGENTS.md        → 運作規則
├── SOUL.md          → Persona
├── USER.md          → Ryan 資訊
├── TOOLS.md         → 工具筆記
├── HEARTBEAT.md     → 定期任務
└── memory/          → 每日日誌
```

### 專家 Agents（Python）
```
shared/agents/
├── investment_agent.py     → 投資顧問主程式
├── tool_dev_agent.py       → 工具開發師主程式
├── knowledge_agent.py      → 知識管理師主程式
├── SKILL_investment.md     → 投資顧問技能說明
├── SKILL_tooldev.md        → 工具開發師技能說明
├── SKILL_knowledge.md      → 知識管理師技能說明
└── memory/                 → 各 Agent 記憶檔
```

---

## 通訊協定

所有 Agent 間通訊透過 `shared/queue/` + `shared/results/` JSON 檔案。

詳細規格請見：
- `agents/yakumo/AGENTS.md` — 八雲↔Lucas 通訊協定
- `shared/README.md` — 共享目錄使用說明