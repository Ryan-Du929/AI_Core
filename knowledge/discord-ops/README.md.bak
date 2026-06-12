# 🐛 從零開始：Discord Bot 通訊鍊完全修復實錄

> ⏰ 寫於 2026-06-02 深夜
> 📍 場景：AI Agent 團隊 Lucas × 八雲 × n8n × Docker
> ✍️ 作者：Lucas（踩坑的人）

---

## 這篇文章在講什麼

如果你有一個 Discord Bot，背後接了一串：
```
Discord → gateway.py → n8n → LLM API → Discord
```

然後這串東西**死了**：Bot 不回話、或回兩次、或 DNS 報錯、或環境變數讀不到。

這篇文章就是為了解決這些問題而寫的。全部都是我親身踩過的坑，**每一個都有完整的症狀、診斷方式、和一步一步的操作**。

---

## 📖 目錄

- [第一章：整條鍊是怎麼接的](#第一章整條鍊是怎麼接的)
- [第二章：症狀一覽](#第二章症狀一覽)
- [第三章：Container 突然死了（Crash 修復）](#第三章container-突然死了crash-修復)
- [第四章：API Key 神秘的消失了（環境變數修復）](#第四章api-key-神秘的消失了環境變數修復)
- [第五章：n8n 說找不到 lucas-api（DNS 修復）](#第五章n8n-說找不到-lucas-apidns-修復)
- [第六章：為什麼 Bot 回兩次話（重複訊息修復）](#第六章為什麼-bot-回兩次話重複訊息修復)
- [第七章：緊急 SOP — 下次 Bot 死了怎麼辦](#第七章緊急-sop--下次-bot-死了怎麼辦)
- [附錄：我學到的教訓](#附錄我學到的教訓)

---

## 第一章：整條鍊是怎麼接的

> 如果你不知道你的系統長怎樣，你永遠不知道哪裡斷了。

先畫一張圖。這是我們的架構：

```
你（Discord 使用者）
  │
  ▼
【gateway.py】 ← 在 Windows 上跑，用 discord.py 監聽訊息
  │ 收到訊息 → 打 ✓ 勾勾 → POST 給 n8n
  ▼
【n8n】 ← Docker container，port 5678
  │ Workflow 名稱：Lucas Gateway
  │ Webhook → Parse → 【Lucas AI】 → Format → 【Discord】
  │               (拆內容)  (call API)   (切長文) (送訊息)
  ▼
【lucas_api.js】 ← Docker container，port 3080
  │ Node.js 程式，呼叫 DeepSeek V4 Flash（NVIDIA NIM）
  │ 回傳結果給 n8n
```

**重點記住一句話：** `lucas_api.js` 只負責「想」，不負責「送」。
n8n 負責「把想好的結果送回 Discord」。

如果這句話你記住了，第六章就不會發生。

### 各元件所在位置

| 元件 | 在哪裡跑 | 怎麼啟動 |
|:----|:---------|:---------|
| gateway.py | Windows 主機 | `python gateway.py` |
| n8n | Docker | `docker compose up -d n8n` |
| lucas_api.js | Docker | `docker compose up -d lucas-api` |

---

## 第二章：症狀一覽

有一天你發現 Bot 怪怪的。你可能遇到以下情況之一：

| 症狀 | 你可能看到什麼 | 是哪一章 |
|:----|:-------------|:--------:|
| Bot 完全不回話 | Discord 訊息有打勾但沒回應 | [三] 或 [四] |
| Bot 回了，但回了兩次一樣的 | 每句話收到兩次回覆 | [六] |
| n8n 報錯：DNS server error | n8n workflow 執行失敗 | [五] |
| 測試 API 回「缺少 OPENAI_API_KEY」 | curl 測試時看到的 | [四] |
| Container 重啟了 | 去看 uptime 發現才幾分鐘 | [三] |

如果你是第一次遇到，**建議按順序讀**。如果你很急，直接跳到[第七章](#第七章緊急-sop--下次-bot-死了怎麼辦)。

---

## 第三章：Container 突然死了（Crash 修復）

### 症狀

你在 Discord 跟 Bot 聊天，聊到一半 Bot 突然不回了。你去檢查 container：

```powershell
# Windows PowerShell
docker ps
```

container 在列表裡，但 uptime 顯示才跑了 **5 分鐘**。代表它剛剛被重啟過。

### 發生什麼事

我在 `lucas_api.js` 裡加了一個「短期記憶」功能 — 讓 Bot 記得剛才說過的話。這個功能的程式碼長這樣（**這是錯誤寫法，不要學**）：

```javascript
// ❌ 錯誤示範：這是 crash 的原因
var fs = require("fs");  // ← 這行我忘了寫！

function saveMemory(channelId, userId, role, content) {
  // ↓ 因為上面沒有 require("fs")，這行直接 throw Error
  fs.writeFileSync("/some/path", JSON.stringify(memory));
}
```

看出問題了嗎？**我用了 `fs` 但沒有 `require("fs")`。** 就這一個失誤，導致有人 call 這個 function 時，Node.js 直接報錯 → process crash → container restart。

### 還有兩個問題

1. **同步寫入**：`writeFileSync` 是同步的，意思是檔案沒寫完之前，這支程式不能做別的事。如果寫入失敗（權限不對、路徑不存在），整個 request 就炸了。
2. **相對路徑**：我用的是 `../../memory/`，這個路徑看你從哪個資料夾啟動程式。從不同地方啟動就會找不到。

### 一步一步教你修

#### 第一步：require 所有東西

```javascript
// ✅ 正確做法
const fs = require("fs");           // 檔案系統
const path = require("path");       // 路徑處理
```

只要用到 `readFileSync`、`writeFileSync`、`existsSync`、`mkdirSync`，前面一定要有 `const fs = require("fs")`。沒有的話 Node.js 不會幫你補，直接炸。

#### 第二步：用絕對路徑

不要依賴「我現在在哪個資料夾」，用 `__dirname`：

```javascript
// ✅ 正確做法：__dirname 永遠指向當前 JS 檔案的位置
var MEMORY_DIR = path.resolve(__dirname, "..", "..", "memory", "conversations");
```

`path.resolve(__dirname, ...)` — 這個寫法不管你在哪個目錄執行 `node`，路徑永遠正確。

#### 第三步：非同步寫入 + try/catch

```javascript
// ✅ 正確做法：用 setImmediate 延後寫入，確保不擋主流程
function saveMemoryAsync(channelId, userId, role, content) {
  setImmediate(function () {
    try {
      // 所有檔案操作都在 try 裡面
      var data = JSON.stringify(memory);
      fs.writeFileSync(filePath, data, "utf8");
    } catch (e) {
      // 只記錄錯誤，絕對不 throw
      console.error("⚠️ 記憶寫入失敗: " + e.message);
    }
  });
}
```

**為什麼用 `setImmediate`？** 因為寫檔案需要時間，但使用者不需要等這個時間。先回覆使用者「好了」，然後背景慢慢寫。這樣就算寫檔失敗，也不會影響使用者體驗。

### 驗證修好了沒

```powershell
# 用 Node.js 檢查程式碼有沒有語法錯誤
node -c lucas_api.js
# 應該顯示：✅ Syntax OK

# 重啟 container
docker compose build --no-cache lucas-api
docker compose up -d lucas-api

# 確認啟動成功
docker logs myai-lucas-api-1 --tail 5
# 應該看到：🧠 Lucas API Server v3.1 啟動完成
```

---

## 第四章：API Key 神秘的消失了（環境變數修復）

### 症狀

你去測試 API：

```powershell
Invoke-RestMethod -Uri http://localhost:3080/api/execute `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"prompt":"你好"}'
```

結果回傳：

```json
{"status":"error","data":"伺服器內部錯誤：缺少 OPENAI_API_KEY"}
```

但你明明記得 `.env` 檔案裡有寫 `OPENAI_API_KEY=...`。

### 發生什麼事

`.env` 檔案長這樣（路徑：`agents/eve/.env`）：

```
OPENAI_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_BOT_TOKEN=MTUwNj...
...
```

檔案存在、內容正確、路徑也對。但 `dotenv` 套件就是讀不到某幾個變數。

什麼是 `dotenv`？它是 Node.js 社群最常用的套件，用來讀取 `.env` 檔案的。你只要寫一行：

```javascript
require("dotenv").config();
```

它就會自動找到 `.env`，把裡面的變數全部載入到 `process.env`。

但這個套件有個問題 — 在某些情況下（特殊字元、檔案編碼、換行符號），它會**默默失敗**，不報錯，但變數就是沒載入。

### 一步一步教你修

#### 解法：不要用 dotenv，手動讀

我寫了一個手動讀取 `.env` 的函式，完全繞過 `dotenv` 套件：

```javascript
// 放在 lucas_api.js 最上面（在 require express 之前）
var ENV_PATH = __dirname + "/.env";
try {
  var envContent = require("fs").readFileSync(ENV_PATH, "utf8");
  var envLines = envContent.split("\n");
  for (var ei = 0; ei < envLines.length; ei++) {
    var line = envLines[ei].trim();
    if (!line || line.startsWith("#")) continue;     // 跳過空行和註解
    var eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;                      // 沒有 = 就跳過
    var k = line.slice(0, eqIdx).trim();             // key
    var v = line.slice(eqIdx + 1).trim();            // value
    // 如果值有引號，去掉
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (v.startsWith("\"") && v.endsWith("\"")) v = v.slice(1, -1);
    // 不覆蓋已經存在的環境變數
    if (!process.env[k]) {
      process.env[k] = v;
    }
  }
} catch (ee) {
  console.error("⚠️ 無法讀取 .env 檔案: " + (ee.message || ee));
}
```

**這段程式做了什麼？**
1. 用 `fs.readFileSync` 直接讀取 `.env` 檔案內容（不是靠套件，是 Node.js 內建功能）
2. 一行一行解析，自己找 `=` 符號來分 key 和 value
3. 跳過註解（`#` 開頭的行）和空行
4. 不會覆蓋已經存在的環境變數（怕 docker-compose 有傳入）

#### 如何應用到你自己的程式

如果你是用 Node.js + `.env`，不管你是用 `dotenv` 還是其他套件，只要遇到「檔案存在但讀不到」的問題，都可以用這個方法取代。

把上面這段 code 貼到你程式的開頭，然後把原本的 `require("dotenv").config()` 註解掉或刪掉。

### 驗證修好了沒

```powershell
# 進到 container 裡面看環境變數
docker exec myai-lucas-api-1 env | findstr OPENAI_API_KEY

# 應該看到：
# OPENAI_API_KEY=*** 才對
```

---

## 第五章：n8n 說找不到 lucas-api（DNS 修復）

### 症狀

你打開 n8n 網頁（`http://localhost:5678`），看到 workflow 執行失敗，錯誤訊息：

```
Problem in node 'Lucas AI'
The DNS server returned an error, perhaps the server is offline
```

### 發生什麼事

n8n 的 workflow 裡有一個 HTTP Request node，它要 call `http://lucas-api:3080/api/execute`。

在 Docker 的世界裡，container 可以用 **service name**（也就是 `lucas-api`）來找另一個 container — 但前提是**兩個 container 必須在同一個 Docker network 上**。

問題是：n8n 掛在 `myai-net` 上，而 lucas-api 掛在 `myai_default` 上。這就像兩個人住在不同社區，用對講機叫對方的名字，對方聽不到。

### 一步一步教你修

#### 第一步：確認 container 分別在哪個 network

```powershell
# 看 lucas-api 的 network
docker inspect myai-lucas-api-1 --format "{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}"

# 看 n8n 的 network
docker inspect n8n --format "{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}"
```

如果兩個 NetworkID 不一樣，就是不同 network。

#### 第二步：看有哪些 network 可用

```powershell
docker network ls
```

你可能看到：

```
NETWORK ID     NAME              DRIVER
ab59e71d5f7f   myai-net          bridge
fa6f1e3a41df   myai_default      bridge
```

#### 第三步：把兩個 container 放到同一個 network

```powershell
# 把 lucas-api 也連到 myai-net，並給他一個 alias（別名）
docker network connect myai-net myai-lucas-api-1 --alias lucas-api
```

`--alias lucas-api` 的意思是：在 `myai-net` 這個 network 上，`myai-lucas-api-1` 這個 container 也叫做 `lucas-api`。這樣 n8n 就能用 `lucas-api` 找到它。

#### 第四步：驗證 DNS 解析

```powershell
docker exec n8n ping lucas-api
```

應該看到：

```
PING lucas-api (172.19.0.2): 56 data bytes
64 bytes from 172.19.0.2: seq=0 ttl=42 time=0.084 ms
```

看到 IP 和 `time=` 就代表通了。

### 永久解法：改 docker-compose.yml

每次 `docker compose down` 之後，手動連的 network 會消失。要讓它永遠有效，必須寫進設定檔。

找到你的 `docker-compose.yml`，在每個 service 下面加上 `networks:`：

```yaml
services:
  lucas-api:
    # ... 原本的設定（build, ports, environment 等）
    networks:
      myai-net:
        aliases:
          - lucas-api    # ← 這一行：讓 lucas-api 在 myai-net 上叫這個名字
      default:

  n8n:
    # ... 原本的設定
    networks:
      - myai-net
      - default

# 最底下加上這段
volumes:
  n8n_data:

networks:
  myai-net:
    external: true       # ← 使用已存在的 network，不要自動建立新的
```

改完後：

```powershell
docker compose down
docker compose up -d
```

從此以後，每次啟動兩個 container 都會自動在同一個 network 上。

---

## 第六章：為什麼 Bot 回兩次話（重複訊息修復）

### 症狀

你在 Discord 說了一句「你好」，Bot 回了兩次一模一樣的「你好！有什麼可以幫你的？」。兩個回覆的訊息 ID 不同，代表是**兩次獨立發送**。

### 發生什麼事

這是最常見的一種 bug：**雙重發送**。

看看我們的架構簡化版：

```
n8n workflow:
  Webhook → Lucas AI (HTTP) → Format → Discord (HTTP)  👈 n8n 發送一次
```

n8n 發送一次，對吧？但問題出在 `lucas_api.js` 收到請求後，做了這件事：

```javascript
// lucas_api.js 裡面的邏輯（這是錯誤的）

// 1. 處理請求，得到回覆
var reply = await callLLM(prompt);

// 2. 回傳給 n8n（正確）
return res.json({ status: "success", data: reply });

// 3. ❌ 同時間，自己又發一次 Discord 訊息（多餘的！）
fetch("https://discord.com/api/channels/.../messages", {
  method: "POST",
  body: JSON.stringify({ content: reply }),
});
```

看到了嗎？**n8n 發了一次，Lucas API 自己又發了一次**。總共兩次，使用者看到兩則一樣的回覆。

### 一步一步教你修

#### 第一步：找出所有 Discord 發送程式碼

在你的 `lucas_api.js`（或其他後端程式）裡搜尋：

```javascript
"discord.com/api"
```

或

```javascript
"/channels/"
```

或

```javascript
"messages"
```

找到所有 `fetch(... discord ...)` 的地方。

#### 第二步：全部刪掉

這些程式碼不應該在大腦層。你的大腦只負責「想」，不負責「送」。

刪除後，用 `return res.json(...)` 取代。n8n 拿到 response 後會自己決定要不要發 Discord。

#### 第三步：確認 n8n 是唯一的發送者

在你的 n8n workflow 裡，必須有一個 node 負責發 Discord 訊息。例如：

```
Webhook → Parse → Lucas AI (HTTP) → Format → 【Discord (HTTP)】
                                                         👆 唯一的發送者
```

這個 Discord node 的設定：

- **Method:** POST
- **URL:** `https://discord.com/api/v10/channels/{{channel_id}}/messages`
- **Authentication:** Header Auth（Bot Token）
- **Body:** `{ "content": "{{回覆內容}}" }`

### 驗證修好了沒

去 Discord 說一句話。應該只收到一次回覆。

如果還是兩次：
1. 檢查 gateway.py 有沒有也發 Discord（搜尋 `discord.com/api`）
2. 檢查 n8n workflow 有沒有兩個 Discord node
3. 檢查是否有兩個 active workflow

---

## 第七章：緊急 SOP — 下次 Bot 死了怎麼辦

> 這是最實用的一章。下次 Bot 出問題，照這個順序做。

### Step 0：冷靜

先確認一個問題：是「完全不回話」還是「回得不對」？

- 完全不回話 → 走 SOP A
- 回兩次 → 走第三章
- 回錯內容 → LLM 或 prompt 問題（不屬於本文範圍）

### SOP A：Bot 完全不回話

```
[1] Container 活著嗎？
    → docker ps | findstr lucas-api
    → 沒有？ docker compose up -d lucas-api

[2] Lucas API 健康嗎？
    → curl http://localhost:3080/health
    → 應該回 {"status":"ok","service":"lucas-api"}

[3] API Key 有設定嗎？
    → docker exec myai-lucas-api-1 env | findstr OPENAI_API_KEY
    → 空的？ → 第四章

[4] n8n 活著嗎？
    → docker ps | findstr n8n
    → http://localhost:5678 開得到嗎？

[5] n8n → lucas-api 通嗎？
    → docker exec n8n ping lucas-api
    → DNS error？ → 第五章

[6] n8n workflow 有收到請求嗎？
    → docker logs n8n --tail 20
    → 沒有 log → gateway.py 有在跑嗎？

[7] gateway.py 活著嗎？
    → 在 Windows 上：Get-Process -Name python*
    → 沒有？ python gateway.py
```

### 常用指令快速參考

```powershell
# === Container 操作 ===

# 重建 + 重啟 Lucas API
docker compose build --no-cache lucas-api
docker compose up -d lucas-api

# 看即時 log
docker logs myai-lucas-api-1 --tail 30

# 進 container 看環境變數
docker exec myai-lucas-api-1 env | findstr OPENAI

# 手動測試 API
Invoke-RestMethod -Uri http://localhost:3080/api/execute `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"prompt":"你好"}'

# === Network 操作 ===

# 看 container 在哪個 network
docker inspect myai-lucas-api-1 --format "{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}"

# 連接到指定 network
docker network connect myai-net myai-lucas-api-1 --alias lucas-api

# 測試 DNS
docker exec n8n ping lucas-api

# === n8n 操作 ===

# 匯出 workflow
docker exec n8n n8n export:workflow --id hzEaEJXY6dnbE4gr
```

---

## 附錄：我學到的教訓

### 1. 程式碼的基本功不能忽略

寫檔案要 `require("fs")` — 這是 Node.js 101。但我急著上功能，跳過了基本功。**一個 require 的遺漏，讓整條 Discord 鍊斷了 2 小時。**

### 2. 不要相信套件

`dotenv` 是下載量數千萬的套件，但它還是會在某些邊界情況失敗。**重要的環境變數載入，自己寫 parser 比依賴套件可靠。**

### 3. Docker Network 是容易忽略的坑

「container 之間可以互相連線」不是理所當然的。**兩個 container 要在同一個 user-defined network 上，才能用 service name 互相找到。**

### 4. 單一責任原則

Lucas API 的工作是「想」，不是「送」。**違反單一責任原則（讓 API 同時處理推論和發送），就是重複訊息的來源。**

### 5. 備份很重要

這次 crash 之後，所有未 commit 的程式碼遺失。**養成習慣：任何改動前先 `git add && git commit`。** 重要里程碑做完整備份。

---

### 結語

Discord Bot 從 「完全不回話」到「會回話但回兩次」到「正常回話」，總共修了 4 個問題。每一個問題的根因都很簡單，但它們層層疊加，讓除錯過程像剝洋蔥。

希望這篇文章能幫到你 — 不管是未來的自己，還是正在踩同樣坑的人。

---

*如果你照著操作還是卡住，回去看看第三章的「不要 throw」原則。很多時候問題不是複雜，是有一個小地方漏掉了。深呼吸，重新看一次。* 🧠