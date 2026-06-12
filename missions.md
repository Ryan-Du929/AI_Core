# 🎯 Lucas 任務看板（2026-05-28 更新）

> 系統架構已升級為大一統微服務，任務分類同步重整

---

## ✅ 已完成（Core 建置）

| 任務 | 狀態 | 說明 |
|:----|:----:|:-----|
| T01 清除記憶殘留 | ✅ | memory/ 429 錯誤清理完畢 |
| T02 記憶蒸餾快取 | ✅ | distill-cache 架構就緒 |
| T03 知識管理體系 | ✅ | knowledge/ 目錄 + SOP |
| T04 可視化儀表板 | ✅ | Dashboard / n8n 替代 |
| T05 團隊組織設計 | ✅ | 角色/協定/規則全定義 |
| T06 多模型接入評估 | ✅ | 分層策略 + 路線圖 |
| T07 端到端測試 | ✅ | Bot/Queue/頻道全通 |
| T08 自動備份 | ✅ | auto_backup.py daemon |
| T09 DeepSeek ThinkMax | ✅ | 模型鎖定 + max_tokens |
| T10 跨 Agent 通訊 | ✅ | Webhook/BaseAgent/Skill Tree |
| T11 專家 Agent 實作 | ✅ | Investment/Knowledge/ToolDev |
| T12 Discord Bot 打通 | ✅ | 22 種 task type 路由 |
| T13 維護迭代 | ✅ | 大部分子項目完成 |

## 🔄 當前進行中（大一統微服務遷移）

### M01 — 架構文件歸檔 ✅
- [x] MEMORY.md 更新至大一統架構
- [x] missions.md 重整任務分類
- [ ] 產出完整系統架構圖（備用）

### M02 — Lucas API 強化
- [x] 驗證 n8n → Lucas API 端到端通訊正常
- [x] 確認三支 Python Agent 全部可用（Investment/Knowledge/ToolDev）
- [ ] 升級 error handling 格式統一（符合 gateway.py 期滿）

### M03 — n8n Workflow 穩定化
- [ ] Workflow 1 (Active) 的 Discord Send node credential 驗證
- [ ] 或切換至 Workflow v2（需解決 path 衝突）
- [ ] 加入 error handling 節點

### M04 — 台股看盤 Dashboard
- [x] Dashboard v1 前端完成（HTML/JS 全面板）
- [x] Dashboard server + API proxy 上線（port 8080）
- [ ] 確認從 Windows 瀏覽器可連線
- [ ] 加入技術線圖（Chart.js）

## 📋 待辦優先級

### P0 — 必須先完成（擋住 downstream）
1. **n8n Discord Send credential 驗證** — 確認 gateway.py → n8n → Discord 整條鏈通
2. **Lucas API agent 路徑測試** — ✅ 已完成（三支 agent 正常）

### P1 — 重要但不急
3. **Workflow v2 部署** — 頻道路由 + error handler
4. **KnowledgeAgent pipeline** — 自動從 Discord 頻道擷取知識

### P2 — 有時間再做
5. **lucas_api.js 升級 v3.2** — 更完善的路由、logging、metrics
6. **Dashboard 重新設計** — 整合 n8n + Lucas API 狀態
7. **八雲 OpenClaw agent 整合** — 恢復八雲在 OpenClaw 的角色

## 📌 快速參考

### Lucas API 端點
```
GET  http://172.17.0.3:3080/health
POST http://172.17.0.3:3080/api/execute
  Body: { prompt, taskId?, taskType?, channel_id?, user_name?, profile? }
```

### 關鍵檔案位置
| 檔案 | 路徑 |
|:----|:-----|
| Lucas API | `agents/eve/lucas_api.js` |
| Agent Runner | `agents/eve/agent_runner.js` |
| API 規格 | `agents/eve/API_SPEC.md` |
| Python Agents | `shared/agents/` |
| n8n 設計 | `agents/eve/n8n_workflow_design.md` |
| MEMORY.md | `./MEMORY.md` |