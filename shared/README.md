# Shared — 八雲 ↔ Lucas 通訊目錄

## 目錄結構
```
shared/
├── queue/      # 八雲 → Lucas 的新任務
│   └── *.json
├── results/    # Lucas → 八雲 的處理結果
│   └── *.json
└── status/     # 各自的狀態更新
    ├── lucas.json
    └── yakumo.json
```

## queue/ 格式
```json
{
  "id": "uuid",
  "from": "yakumo",
  "type": "task|query|reminder",
  "content": "Ryan 說：...",
  "timestamp": "2026-05-19T04:00:00Z",
  "status": "pending|processing|done"
}
```

## results/ 格式
```json
{
  "id": "uuid (對應 queue)",
  "from": "lucas",
  "content": "處理結果...",
  "timestamp": "2026-05-19T04:05:00Z"
}
```

## status/ 格式
```json
{
  "agent": "lucas",
  "status": "idle|thinking|interrupted",
  "lastUpdated": "..."
}
```
