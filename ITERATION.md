# 🚀 持續迭代框架（Iteration Framework）

> 最後更新：2026-05-25
> 即使 Ryan 沒說話，Lucas 也自動推進這些工作

---

## 每次 Heartbeat 執行

### 1. 檢查 Gateway 是否需要重啟
- 檢查 openclaw.json 有沒有 pending 的 config 變更
- 若 Discord 還沒連上 → 提示 Ryan

### 2. 知識庫增量優化
- 掃描 memory/*.md 有無新 lessons 可萃取
- 掃描 knowledge/ 有無檔案可索引
- 若發現可優化的知識文件 → 直接更新

### 3. 檢查 missions.md 待辦
- 看有沒有可以獨自推進的子任務

### 4. GitHub 同步
- 若有檔案變更 → commit + push

### 5. 架構持續改善
- 掃描 agents/ 和 shared/ 目錄結構
- 發現空缺或可優化的部分 → 直接補上

---

## 每週執行

### 1. 記憶蒸餾
- 回顧最近 7 天的 memory/*.md
- 萃取重要決策和 lessons → 更新 MEMORY.md

### 2. 知識歸檔
- knowledge/lessons/ 過舊的 → 移入 archive/

### 3. 專家 Agents 測試
- 測試 InvestmentAgent / ToolDevAgent / KnowledgeAgent
- 修正 import 或 bug

---

## 當前迭代目標（自動推進）

### [x] 1. 確認 agent_base.py import 正常 ✅
- 從 workspace root import 完全正常
- `python3 -c "from shared.agents import init_agents"` 通過
- 三位專家全部成功啟動

### [x] 2. 建立 Lucas 的 Heartbeat 工作清單 ✅
- HEARTBEAT.md 已有完整檢查項目
- 每次 Heartbeat 自動掃描共享目錄、GitHub 同步、任務看板

### [x] 3. 補上八雲的 memory/ 目錄初始檔案 ✅
- agents/yakumo/memory/ 已建立
- 已補齊 05/22、05/23、05/24 三日日誌

### [x] 4. GitHub 同步腳本已運作 ✅
- HEARTBEAT.md / MEMORY.md / ITERATION.md 已更新
- 所有新檔案已 commit + push 到 GitHub
- 3 個 SKILL.md 文件已建立
- 八雲 memory/ 初始日誌已建立
- 八雲祕書 SOP 已建立

### [x] 5. 更新 GitHub 同步腳本 ✅
- sync_git.sh 已有完整 add -A + commit + push 邏輯
- 定期執行確保所有新增檔案被追蹤

---

## 每次推進後

完成任一項後：
1. 更新本檔案狀態（[ ] → [x]）
2. 寫入 memory/ 日誌
3. Git commit + push