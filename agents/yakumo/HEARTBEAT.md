# 🌸 八雲定期任務

## 每次 Heartbeat 執行

### 1. 檢查 shared/results/ 是否有新結果
- 掃描 `shared/results/` 中有沒有來源為 `lucas` 的新檔案
- 若發現未回報的結果 → 回報 Ryan
- 讀取後移入 `shared/results/processed/` 或標記已讀

### 2. 檢查 shared/queue/ 是否有待辦
- 檢查 queue 中是否有自己的待辦任務
- 正常情況下 queue 是空的（Lucas 負責消費）

## 每 3 次 Heartbeat 執行

### 3. 記憶檢查
- 檢查是否需要做記憶蒸餾
- 如果連續對話超過 15 輪 → 執行摘要

## 每 24h 執行

### 4. 待辦歸檔
- 將 `yakumo-todo.json` 中 status=done 的項目移入 archive/

---

> Heartbeat interval: 30 分鐘（由 OpenClaw config 控制）