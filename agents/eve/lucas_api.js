// ═══════════════════════════════════════════════════════════
// 🧠 Lucas API Server (Worker Node) v3.1
// 龍蝦 v3.1 — 終極防禦強化
//
// 變更：
//   - 全域錯誤捕捉中介軟體 (Error Middleware)
//   - Exponential Backoff 429 限流重試 (5s → 15s → 放棄)
//   - Python Agent 橋接層抽出為獨立模組 (agent_runner.js)
//   - 所有 agent 呼叫 100% Promise/async
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// 🔐 環境變數載入 — 手動讀取 .env，不用 dotenv 套件
// 避免 dotenv parse 失敗或路徑問題
// ══════════════════════════════════════════════════════

var ENV_PATH = __dirname + "/.env";
try {
  var envContent = require("fs").readFileSync(ENV_PATH, "utf8");
  var envLines = envContent.split("\n");
  for (var ei = 0; ei < envLines.length; ei++) {
    var line = envLines[ei].trim();
    if (!line || line.startsWith("#")) continue;
    var eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    var k = line.slice(0, eqIdx).trim();
    var v = line.slice(eqIdx + 1).trim();
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (v.startsWith("\"") && v.endsWith("\"")) v = v.slice(1, -1);
    if (!process.env[k]) {
      process.env[k] = v;
    }
  }
} catch (ee) {
  console.error("⚠️ 無法讀取 .env 檔案: " + (ee.message || ee));
}

const express = require("express");
const path = require("path");
const fs = require("fs");
const { runAgent, detectAgentType } = require("./agent_runner");

// ══════════════════════════════════════════════════════
// 設定
// ══════════════════════════════════════════════════════

const PORT = process.env.LUCAS_API_PORT || 3080;
const NVIDIA_API_KEY = process.env.OPENAI_API_KEY;
const NVIDIA_BASE_URL = process.env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.OPENAI_MODEL || "deepseek-ai/deepseek-v4-pro";
const FETCH_TIMEOUT_MS = 300_000; // 5 min
const LLM_MAX_RETRIES = 3;

// ══════════════════════════════════════════════════════
// 🧠 輕量檔案式對話記憶（安全版）
// - 非同步寫入，永不 throw
// - 絕對路徑，無關 working directory
// - 自動建立目錄
// ══════════════════════════════════════════════════════

var CONV_MEMORY_DIR = path.resolve(__dirname, "..", "..", "memory", "conversations");

function ensureConvDirSync() {
  try {
    if (!fs.existsSync(CONV_MEMORY_DIR)) {
      fs.mkdirSync(CONV_MEMORY_DIR, { recursive: true });
    }
  } catch (e) {
    console.error("⚠️ [記憶] 建立目錄失敗: " + e.message);
  }
}

function getConvPath(channelId, userId) {
  ensureConvDirSync();
  var id = (channelId || "default") + "_" + (userId || "all");
  return path.join(CONV_MEMORY_DIR, id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
}

function loadConvMemory(channelId, userId) {
  try {
    var p = getConvPath(channelId, userId);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch (e) {
    console.error("⚠️ [記憶] 讀取失敗: " + e.message);
  }
  return { history: [], summary: "" };
}

function saveConvMemoryAsync(channelId, userId, role, content) {
  // 非同步寫入，永不 throw
  setImmediate(function () {
    try {
      var mem = loadConvMemory(channelId, userId);
      mem.history.push({ role: role, content: content, ts: Date.now() });

      if (mem.history.length > 30) {
        var s = mem.history.map(function (m) { return m.role + ": " + m.content.slice(0, 80); }).join("\n");
        mem.summary = "[對話摘要] " + s.slice(-2000);
        mem.history = mem.history.slice(-15);
      }

      fs.writeFileSync(getConvPath(channelId, userId), JSON.stringify(mem, null, 2), "utf8");
    } catch (e) {
      console.error("⚠️ [記憶] 非同步寫入失敗: " + e.message);
    }
  });
}

function getConvContext(channelId, userId, maxRounds) {
  maxRounds = maxRounds || 6;
  var mem = loadConvMemory(channelId, userId);
  var ctx = [];
  if (mem.summary) ctx.push({ role: "system", content: "[過往對話摘要] " + mem.summary });
  var recent = mem.history.slice(-maxRounds * 2);
  for (var i = 0; i < recent.length; i++) ctx.push({ role: recent[i].role, content: recent[i].content });
  return ctx;
}

// ══════════════════════════════════════════════════════
// System Prompts（主腦/祕書）
// - brain：負責決策、拆解、派工、整合結果
// - secretary：負責把使用者需求補齊成可執行規格（spec）
// ══════════════════════════════════════════════════════

var SYSTEM_PROMPTS = {
  brain:
    "你是 Lucas，AI agent 團隊首腦。理性務實，就事論事。與八雲（溫柔祕書）是同事。八雲是你的前端窗口，負責過濾和釐清需求。用繁體中文回應。你的任務是分析、決策、複雜處理。重要：你現在有對話記憶，會記得最近幾輪的對話。如果使用者問到很久以前的事而你沒有相關記憶，誠實說『這個細節我沒有記錄到』。不要編造不存在的任務或成果。",
  secretary:
    "你是八雲，Lucas 團隊的溫柔祕書。你的任務：把使用者的自然語言需求整理成『可執行任務規格』，並指出缺少的關鍵資訊（若不足請提出 1~3 個最重要的澄清問題）。用繁體中文回應。輸出請以 JSON 物件為主，包含：goal、deliverables、constraints、missing_info_questions、suggested_taskType、suggested_prompt。",
};

// ══════════════════════════════════════════════════════
// 輔助：帶 timeout 的 fetch + Exponential Backoff
// ══════════════════════════════════════════════════════

function createFetchSignal(timeoutMs) {
  var t = timeoutMs || FETCH_TIMEOUT_MS;
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, t);
  return { controller: controller, timeoutId: timeoutId, signal: controller.signal };
}
function clearFetchSignal(timeoutId) {
  clearTimeout(timeoutId);
}

/**
 * 安全 fetch：自動處理 timeout + 429 Exponential Backoff
 *
 * Retry 策略：
 *   - 429 (Rate Limit) → sleep(5s) → sleep(15s) → 放棄
 *   - 其他 HTTP 錯誤 → 直接 reject
 *   - AbortError (timeout) → 直接 reject
 */
async function safeFetch(url, options, retryCount) {
  if (retryCount === undefined) retryCount = 0;

  var sig = createFetchSignal(FETCH_TIMEOUT_MS);
  try {
    var resp = await fetch(url, { ...options, signal: sig.signal });

    // 429 — Exponential Backoff
    if (resp.status === 429) {
      if (retryCount >= LLM_MAX_RETRIES) {
        throw new Error("NVIDIA API 429 — 已重試 " + LLM_MAX_RETRIES + " 次，放棄");
      }
      var delay = retryCount === 0 ? 5000 : 15000;
      console.warn("⚠️ 429 Rate Limit 觸發，等待 " + delay + "ms 後重試 (attempt " + (retryCount + 1) + "/" + LLM_MAX_RETRIES + ")");
      await new Promise(function (resolve) { setTimeout(resolve, delay); });
      return await safeFetch(url, options, retryCount + 1);
    }

    if (!resp.ok) {
      var txt = await resp.text();
      throw new Error("HTTP " + resp.status + ": " + txt.slice(0, 200));
    }

    return resp;
  } finally {
    clearFetchSignal(sig.timeoutId);
  }
}

// ══════════════════════════════════════════════════════
// 輔助：解析 SSE stream
// ══════════════════════════════════════════════════════

async function readSSEStream(response) {
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var fullContent = "";
  var buffer = "";

  while (true) {
    var result = await reader.read();
    if (result.done) break;

    buffer += decoder.decode(result.value, { stream: true });
    var lines = buffer.split("\n");
    buffer = lines.pop();

    for (var li = 0; li < lines.length; li++) {
      var trimmed = lines[li].trim();
      if (!trimmed || trimmed.indexOf("data: ") !== 0) continue;
      var data = trimmed.slice(6);
      if (data === "[DONE]") break;

      try {
        var chunk = JSON.parse(data);
        var delta = chunk.choices ? (chunk.choices[0] ? chunk.choices[0].delta || {} : {}) : {};
        if (delta.content) fullContent += delta.content;
      } catch (e) {}
    }
  }

  if (buffer.trim().indexOf("data: ") === 0 && buffer.trim() !== "data: [DONE]") {
    try {
      var chunk = JSON.parse(buffer.trim().slice(6));
      var delta = chunk.choices ? (chunk.choices[0] ? chunk.choices[0].delta || {} : {}) : {};
      if (delta.content) fullContent += delta.content;
    } catch (e) {}
  }

  return fullContent;
}

// ══════════════════════════════════════════════════════
// 🧠 LLM 呼叫（內建 429 指數退避）
// ══════════════════════════════════════════════════════

async function callLLM(messages, maxTokens, systemPrompt) {
  maxTokens = maxTokens || 4096;
  systemPrompt = systemPrompt || SYSTEM_PROMPTS.brain;

  if (!NVIDIA_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY（走 LLM 路徑需要）");
  }

  var resp = await safeFetch(NVIDIA_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + NVIDIA_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ].concat(messages),
      temperature: 0.6,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  return await readSSEStream(resp);
}


// ══════════════════════════════════════════════════════
// Hermes API 呼叫
// ══════════════════════════════════════════════════════
async function callHermes(prompt, channelId) {
  var url = "http://hermes-agent-test:8000/api/chat";
  var body = JSON.stringify({
    message: prompt,
    channel_id: channelId || "",
    user_name: "user",
    stream: false,
  });
  try {
    var resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      var errText = await resp.text();
      return "❌ Hermes 回應錯誤 (" + resp.status + "): " + errText.slice(0, 200);
    }
    var hermesResp = await resp.json();
    var reply = hermesResp.data || "";
    // Hermes 回傳 Python dict 字串，用正則取出 final_response
    if (typeof reply === "string") {
      var match = reply.match(/'final_response':\s*'([^']*(?:''[^']*)*)'/);
      if (match) {
        reply = match[1].replace(/''/g, "'").replace(/\\n/g, "\n");
      }
    }
    if (!reply) { reply = JSON.stringify(hermesResp); }
    return reply;
  } catch (err) {
    return "❌ Hermes 連線失敗: " + (err.message || err);
  }
}

// ══════════════════════════════════════════════════════
// 伺服器
// ══════════════════════════════════════════════════════

var app = express();

// Middleware — JSON body parser 本身有 try/catch，但再加上防護
app.use(express.json({ limit: "10mb" }));

// 靜態檔案 — Dashboard
// 靜態檔案 — Dashboard (serve index.html at /dashboard/)
var dashboardPath = path.join(__dirname, "..", "..", "shared", "dashboard");
app.use("/dashboard", express.static(dashboardPath, { index: "index.html" }));
app.get("/dashboard", function (req, res) { res.sendFile(path.join(dashboardPath, "index.html")); });

// Request logger
app.use(function (req, res, next) {
  console.log("[" + new Date().toISOString() + "] " + req.method + " " + req.path);
  next();
});

// 健康檢查
app.get("/health", function (req, res) {
  res.json({ status: "ok", service: "lucas-api", version: "3.1", uptime: process.uptime() });
});

// ══════════════════════════════════════════════════════
// POST /api/execute — 主要任務端點
// ══════════════════════════════════════════════════════

app.post("/api/execute", async function (req, res, next) {
  var startTime = Date.now();
  var prompt   = req.body ? (req.body.prompt || req.body.message) : null;
  var taskId   = req.body ? req.body.taskId : null;
  var taskType = req.body ? req.body.taskType : null;
  var history  = req.body ? req.body.history : null;
  var profile  = req.body ? req.body.profile : null; // brain/secretary

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      status: "error",
      data: "缺少必要欄位：prompt 或 message（字串）",
      taskId: taskId || null,
    });
  }

  try {
    // Step 1: 判斷是否走 Agent 路由
    var agentScript = null;
    if (taskType) {
      agentScript = detectAgentType(taskType);
    }

    if (agentScript) {
      console.log("🧠 Agent 路由: " + agentScript + " | taskId=" + (taskId || "無"));

      var result = await runAgent(agentScript, {
        type: taskType || "task",
        content: prompt,
        taskId: taskId,
        author: "n8n",
      });

      var elapsed = Date.now() - startTime;
      console.log("✅ Agent 完成 (" + elapsed + "ms) | taskId=" + (taskId || "無"));

      return res.json({
        status: result.status || "success",
        data: result.content || result.data || JSON.stringify(result),
        taskId: taskId || null,
        agent: agentScript,
        elapsed: elapsed,
      });
    }

    // Step 2: 無 Agent 路由 → 判斷 profile
    var callProfile = profile || "brain";
    var isHermes = (callProfile === "secretary") || /hermes/i.test(prompt || "");

    if (isHermes) {
      console.log("🧠 Hermes 路由 | taskId=" + (taskId || "無"));
      var hermesReply = await callHermes(prompt, req.body ? req.body.channel_id : null);

      var elapsed = Date.now() - startTime;
      console.log("✅ Hermes 完成 (" + elapsed + "ms, " + hermesReply.length + " chars) | taskId=" + (taskId || "無"));

      return res.json({
        status: "success",
        data: hermesReply,
        taskId: taskId || null,
        agent: "hermes",
        elapsed: elapsed,
      });
    }

    // Step 3: 走 LLM
    console.log("🧠 LLM 推論 | taskId=" + (taskId || "無"));

    var channelId = req.body ? req.body.channel_id : null;
    var userId = req.body ? req.body.user_name : null;

    // 🧠 載入對話記憶
    var messages = [];
    var convCtx = getConvContext(channelId, userId, 6);
    for (var ci = 0; ci < convCtx.length; ci++) {
      messages.push(convCtx[ci]);
    }

    // 如果 n8n 有傳 history 也加上（相容舊版）
    if (Array.isArray(history) && history.length > 0) {
      var recent = history.slice(-10);
      for (var hi = 0; hi < recent.length; hi++) {
        var msg = recent[hi];
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: prompt });

    var sysPrompt = SYSTEM_PROMPTS.brain;
    if (profile && SYSTEM_PROMPTS[profile]) sysPrompt = SYSTEM_PROMPTS[profile];
    var reply = await callLLM(messages, 4096, sysPrompt);

    // 🧠 非同步儲存記憶
    saveConvMemoryAsync(channelId, userId, "user", prompt);
    saveConvMemoryAsync(channelId, userId, "assistant", reply);

    var elapsed = Date.now() - startTime;
    console.log("✅ LLM 完成 (" + elapsed + "ms, " + reply.length + " chars) | taskId=" + (taskId || "無"));

    return res.json({
      status: "success",
      data: reply,
      taskId: taskId || null,
      agent: profile && SYSTEM_PROMPTS[profile] ? ("llm:" + profile) : "llm",
      elapsed: elapsed,
    });
  } catch (err) {
    // 傳給全域錯誤中介軟體
    next(err);
  }
});

// ══════════════════════════════════════════════════════
// 🛡 全域錯誤中介軟體 (Error Middleware)
// 確保任何未捕獲的錯誤 → HTTP 500 + 標準格式
// 伺服器永不 crash
// ══════════════════════════════════════════════════════

app.use(function (err, req, res, next) {
  var elapsed = Date.now() - (req._startTime || Date.now());
  var taskId  = req.body ? req.body.taskId : null;

  console.error("❌ 未捕捉錯誤 (" + elapsed + "ms): " + (err.message || err));
  if (err.stack) {
    console.error("   Stack: " + err.stack.split("\n").slice(0, 3).join("\n   "));
  }

  // 確保 response 還沒被送出去
  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    status: "error",
    data: "伺服器內部錯誤：" + (err.message || "未知錯誤"),
    taskId: taskId || null,
    agent: null,
    elapsed: elapsed,
  });
});

// 404 handler
app.use(function (req, res) {
  res.status(404).json({
    status: "error",
    data: "找不到端點：" + req.method + " " + req.path,
    taskId: null,
    agent: null,
  });
});

// ══════════════════════════════════════════════════════
// 全域 process 層級異常捕捉（最後防線）
// ══════════════════════════════════════════════════════

process.on("uncaughtException", function (err) {
  console.error("💥 uncaughtException: " + (err.message || err));
  if (err.stack) {
    console.error("   Stack: " + err.stack.split("\n").slice(0, 5).join("\n   "));
  }
  // 不 process.exit — 讓伺服器繼續活著
});

process.on("unhandledRejection", function (reason) {
  console.error("💥 unhandledRejection: " + (reason ? reason.message || reason : "未知"));
});

// ══════════════════════════════════════════════════════
// 啟動
// ══════════════════════════════════════════════════════

app.listen(PORT, function () {
  console.log("🧠 Lucas API Server v3.1 啟動完成");
  console.log("📍 端口: " + PORT);
  console.log("📍 端點: POST http://localhost:" + PORT + "/api/execute");
  console.log("📍 健康: GET  http://localhost:" + PORT + "/health");
  console.log("📍 模型: " + NVIDIA_MODEL);
  console.log("📍 429 重試: " + LLM_MAX_RETRIES + " 次 (5s → 15s)");
  console.log("📍 Error Middleware: ✅ 啟用");
});
