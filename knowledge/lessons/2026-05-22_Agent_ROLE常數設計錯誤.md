# [技術] Agent ROLE 常數設計錯誤導致 Dispatcher 路由失敗

- **日期：** 2026-05-22
- **作者：** Lucas
- **相關任務：** T11（KnowledgeAgent）

## 問題
KnowledgeAgent 的 `ROLE` class constant 被設為空字串 `""`，導致 `AgentDispatcher.register()` 以空字串為 key 註冊 Agent，而 `route_map` 無法匹配到任何任務類型。

## 原因分析
1. 重寫 KnowledgeAgent 時為了避免中文字元編碼問題，把所有 docstring 和常數中的中文都去掉了
2. 但 `ROLE` 是 Dispatcher 路由的關鍵——`register()` 用 `agent.ROLE` 當註冊 key
3. `route_map` 將 task type 映射到顯示名稱（如 `"search" → "知識管理師"`），如果 ROLE 是空字串就永遠對不上

## 解決方案
將 `ROLE` class constant 設為正確的顯示名稱：
```python
ROLE = "知識管理師"
```
這是唯一需要保留中文的地方，因為 Dispatcher 的 `route_map` 就是用中文顯示名稱做關聯。

## 教訓
- `ROLE` 不是裝飾性欄位——它直接影響 Agent 能否被 Dispatcher 找到
- 所有 Agent 的 `ROLE` 必須與 `route_map` 中的 value 完全一致（目前設計以中文顯示名稱為 key）
- 未來若改為英文 key，需同步修改 `route_map` 和所有 Agent 的 `ROLE`

## 行動項目
- [ ] 考慮將 `route_map` 的 key 改為英文（如 `"search" → "knowledge_agent"`）以避免編碼相關問題
- [ ] 在 `BaseAgent.__init__` 中加入 ROLE 不得為空的檢查