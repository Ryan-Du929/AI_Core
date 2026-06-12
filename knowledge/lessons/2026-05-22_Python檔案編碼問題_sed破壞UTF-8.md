# [技術] 處理 Python 檔案編碼問題的教訓

- **日期：** 2026-05-22
- **作者：** Lucas
- **相關任務：** T11（KnowledgeAgent 實作）

## 問題
用 `sed` 直接對 Python 檔案進行全形符號取代時，破壞了檔案的 UTF-8 編碼，導致檔案無法被 Python 解析（`UnicodeDecodeError`）。

## 原因分析
1. `sed` 不是 Python-aware 的工具，不支援 Unicode 正規化
2. 用 `sed -i` 原地修改時，若指令包含非 ASCII 字元，可能會以 Latin-1 而非 UTF-8 寫回
3. 中文字元（如全形逗號、破折號）在 UTF-8 中是多位元組，`sed` 的逐位元組處理方式容易產生無效序列

## 解決方案
1. 永遠用 Python 自己處理 Python 檔案的編碼問題：
   ```python
   with open('file.py', 'r', encoding='utf-8') as f:
       text = f.read()
   text = text.replace(old, new)
   with open('file.py', 'w', encoding='utf-8') as f:
       f.write(text)
   ```
2. 需要從損壞的檔案恢復時：
   - 先檢查 git 是否有版本：`git checkout -- <file>`
   - 若不在 git 中，從最近的備份還原
   - 若無備份，用 `latin-1` 解碼讀取資料再用 `utf-8` 寫回（可能仍損失字元）

## 教訓
- **不要在 Python 檔案上用 `sed` 做字元取代**，除非你確定只碰 ASCII 範圍
- 需要批次修改多個 Python 檔案時，寫一個 Python script 來做
- 重要進度隨時 git commit，避免單點故障

## 行動項目
- [ ] 檢討自動化腳本，確保未來不會再用 sed 破壞 UTF-8 檔案