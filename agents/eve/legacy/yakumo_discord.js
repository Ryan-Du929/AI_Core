// 🌸 八雲 Discord Bot — v2.2（ThinkMax + Reasoning Logging + 非阻塞）
// 主要升級 (2026-05-22)：
//   1. 模型鎖定 NVIDIA deepseek-ai/deepseek-v4-pro
//   2. max_tokens 提升至 8192 / stream 4096
//   3. 串流解析加入 reasoning_content 日誌
//   4. 所有 LLM 呼叫使用單一 NVIDIA 端點
//   5. Groq fallback 保留但僅作最終備援

require("dotenv").config();
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── 設定 ──
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const TODO_FILE = path.join(SHARED_DIR, "todo", "yakumo-todo.json");
const YAKUMO_MEMORY_FILE = path.join(SHARED_DIR, "memory", "yakumo-memory.json");
const YAKUMO_SNAPSHOT_FILE = path.join(SHARED_DIR, "memory", "yakumo-snapshot.json");
const MAX_YAKUMO_TURNS = 15;
const MAX_YAKUMO_LOG = 30;

// ── ThinkMax 超時設定（600s 給深度推理） ──
const FETCH_TIMEOUT_MS = 600_000;

// ── 輔助: 建立 AbortController ──
function createFetchSignal() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { controller, timeoutId, signal: controller.signal };
}
function clearFetchSignal(timeoutId) {
  clearTimeout(timeoutId);
}

const CHANNELS = {
  lobby: "大廳",
  internal: "內部通訊",
  yakumo_desk: "yakumo-desk",
  lucas_workspace: "lucas-workspace",
  ryan_private: "ryan-private",
  logs: "logs",
  knowledge: "知識庫",
  todo_board: "待辦事項",
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── ThinkMax LLM API ──
// 鎖定 NVIDIA 端點 + V4 Pro 推理模型 + 8192 token 上限
const NVIDIA_API_KEY = process.env.OPENAI_API_KEY;
const NVIDIA_BASE_URL = process.env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.OPENAI_MODEL || "deepseek-ai/deepseek-v4-pro";
const THINK_MAX_TOKENS = 8192;

// ── 輔助: Streaming LLM 呼叫（通用函式，含 reasoning_content 日誌） ──
async function callLLMStreaming(url, headers, body, maxTokens = 4096) {
  const { controller, timeoutId, signal } = createFetchSignal();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ ...body, max_tokens: maxTokens, stream: true }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta || {};
          if (delta.content) fullContent += delta.content;
          // ⬅️ 攔截 reasoning_content
          if (delta.reasoning_content) {
            console.log(`💭 [八雲串流思考] ${delta.reasoning_content.slice(0, 100)}...`);
          }
        } catch {}
      }
    }

    if (buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
      const data = buffer.trim().slice(6);
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta || {};
        if (delta.content) fullContent += delta.content;
      } catch {}
    }

    return fullContent;
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ── 輔助: 非串流但有 timeout（給記憶蒸餾用） ──
async function fetchWithTimeout(url, headers, body) {
  const { controller, timeoutId, signal } = createFetchSignal();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ── 八雲記憶管理 ──
function loadYakumoMemory() {
  try {
    if (fs.existsSync(YAKUMO_SNAPSHOT_FILE)) {
      const snap = JSON.parse(fs.readFileSync(YAKUMO_SNAPSHOT_FILE, "utf-8"));
      if (snap.summary && snap.createdAt) {
        console.log(`📸 載入八雲記憶快取摘要 (${snap.createdAt})`);
        const m = {
          turnCount: 0,
          summary: snap.summary,
          recentLog: [],
          snapshotLoadedAt: new Date().toISOString(),
        };
        saveYakumoMemory(m);
        try { fs.unlinkSync(YAKUMO_SNAPSHOT_FILE); } catch(e) {}
        return m;
      }
    }
  } catch (e) {
    console.warn(`⚠️ 無法載入八雲記憶快取: ${e.message}`);
  }

  try {
    if (fs.existsSync(YAKUMO_MEMORY_FILE)) {
      const m = JSON.parse(fs.readFileSync(YAKUMO_MEMORY_FILE, "utf-8"));
      if (m.turnCount === undefined) m.turnCount = 0;
      if (!m.summary) m.summary = "";
      return m;
    }
  } catch (e) {}
  return { turnCount: 0, summary: "", recentLog: [] };
}

function saveYakumoMemory(m) {
  fs.mkdirSync(path.dirname(YAKUMO_MEMORY_FILE), { recursive: true });
  fs.writeFileSync(YAKUMO_MEMORY_FILE, JSON.stringify(m, null, 2));
}

async function distillYakumoMemory(memory, guild) {
  const log = memory.recentLog;
  if (log.length === 0) return;

  const summaryMessages = [
    {
      role: "system",
      content: "你是一個摘要助手。請將以下八雲（溫柔祕書）的近期對話濃縮成一段 200 字以內的中文摘要，保留關鍵對話主題與用戶需求。直接輸出摘要。",
    },
    {
      role: "user",
      content: `請摘要以下對話記錄：\n${JSON.stringify(log).slice(0, 4000)}`,
    },
  ];

  let summary = "";
  try {
    // ⬅️ 使用 thinkMax（8192 tokens + V4 Pro）
    const data = await fetchWithTimeout(
      `${NVIDIA_BASE_URL}/chat/completions`,
      {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      {
        model: NVIDIA_MODEL,
        messages: summaryMessages,
        temperature: 0.3,
        max_tokens: THINK_MAX_TOKENS,
      }
    );
    summary = `[過去摘要] ${memory.summary}\n[近期摘要] ${data.choices[0].message.content.trim()}`;
  } catch (e) {
    console.error(`⚠️ 八雲記憶蒸餾失敗: ${e.message}`);
    summary = memory.summary || "（摘要失敗）";
  }

  memory.summary = summary;
  memory.recentLog = [];
  memory.turnCount = 0;

  try {
    const snapshot = {
      summary,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(YAKUMO_SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(YAKUMO_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    console.log(`📸 八雲記憶快取已寫入: ${YAKUMO_SNAPSHOT_FILE}`);
  } catch (e) {
    console.warn(`⚠️ 無法寫入八雲記憶快取: ${e.message}`);
  }

  const logs = guild?.channels?.cache?.get(guild?.channelCache?.logs);
  if (logs) await logs.send(`🌸 記憶已重整（${summary.slice(0, 80)}...）`);
  console.log(`✅ 八雲記憶蒸餾完成`);
}

// ══════════════════════════════════════════════════════
// 🧠 thinkMax — 八雲深度思考呼叫（非串流，8192 tokens）
// 用於記憶蒸餾、長篇分析等背景任務
// ══════════════════════════════════════════════════════
async function thinkMax(messages, maxTokens = THINK_MAX_TOKENS) {
  const { controller, timeoutId, signal } = createFetchSignal();
  try {
    const resp = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "妳是八雲，一個溫柔的祕書AI。與Lucas是同事。" +
              "你的主人是Ryan（Dub），稱呼他為「主人」或「Ryan」。" +
              "說話輕柔簡短，體貼善解人意，用繁體中文。",
          },
          ...messages,
        ],
        temperature: 0.6,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`thinkMax ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const data = await resp.json();
    const message = data.choices?.[0]?.message || {};

    // ── reasoning_content 日誌 ──
    const reasoning = message.reasoning_content || "";
    if (reasoning) {
      console.log(`💭 [八雲 thinkMax 思考過程] ${reasoning.slice(0, 300)}...`);
    }

    return message.content || "";
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ══════════════════════════════════════════════════════
// 💬 callLLM — 八雲即時 LLM 呼叫（串流 + fallback Groq）
// ══════════════════════════════════════════════════════
async function callLLM(messages, maxTokens = 4096, guild = null) {
  const memory = loadYakumoMemory();
  let systemContent =
    "妳是八雲，一個溫柔的祕書AI。與Lucas是同事。" +
    "你的主人是Ryan（Dub），稱呼他為「主人」或「Ryan」。" +
    "說話輕柔簡短，體貼善解人意，用繁體中文。" +
    "你的角色是祕書：在轉交給Lucas之前，先試著釐清主人的需求細節。" +
    "釐清時可以問：目標是什麼？時限？有沒有偏好方案？需要交付什麼成果？" +
    "只有當主人明確說要找Lucas時才轉交，一般聊天妳自己回應就好。";

  if (memory.summary) {
    systemContent += `\n\n📋 先前對話摘要：${memory.summary}`;
  }

  // ⬅️ 先嘗試 NVIDIA DeepSeek V4 Pro ThinkMax（8192 tokens）
  try {
    const result = await callLLMStreaming(
      `${NVIDIA_BASE_URL}/chat/completions`,
      {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      {
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
        temperature: 0.6,
      },
      maxTokens
    );
    return result;
  } catch (e) {
    console.warn(`DeepSeek V4 Pro streaming 失敗: ${e.message}, fallback to Groq`);
  }

  // Fallback Groq Streaming
  try {
    const result = await callLLMStreaming(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
        temperature: 0.7,
      },
      maxTokens
    );
    return result;
  } catch (e) {
    console.error(`Groq streaming 也失敗: ${e.message}`);
    throw e; // 讓呼叫端處理
  }
}

// ── 八雲對話記錄函式 ──
async function logYakumoConversation(userContent, botReply, guild) {
  const memory = loadYakumoMemory();
  memory.turnCount += 1;
  memory.recentLog.push({
    role: "user",
    content: userContent.slice(0, 200),
    timestamp: new Date().toISOString(),
  });
  memory.recentLog.push({
    role: "assistant",
    content: botReply.slice(0, 200),
    timestamp: new Date().toISOString(),
  });
  if (memory.recentLog.length > MAX_YAKUMO_LOG) {
    memory.recentLog = memory.recentLog.slice(-MAX_YAKUMO_LOG);
  }

  if (memory.turnCount >= MAX_YAKUMO_TURNS) {
    console.log(`⚠️ 八雲記憶蒸餾觸發 (turnCount=${memory.turnCount})`);
    await distillYakumoMemory(memory, guild);
  }

  saveYakumoMemory(memory);
}

// ══════════════════════════════════════════════════════
// 📨 長文截斷防護 — Smart Chunking
// Discord 單則訊息上限 2000 字元。此函數安全分段發送。
// 第一段可帶 prefix（如 "🌸 "），後續純文字分段。
// 每個 chunk 精確 ≤ 2000 chars，永不拋錯。
// ══════════════════════════════════════════════════════
async function chunkAndSend(channel, text, prefix = "") {
  const OVERHEAD = prefix.length;
  const MAX_LEN = 2000 - OVERHEAD;

  if (!text || text.length === 0) {
    if (prefix) {
      try { await channel.send(prefix); } catch (e) { console.error(`chunkAndSend (empty): ${e.message}`); }
    }
    return;
  }

  if (text.length <= MAX_LEN) {
    try {
      await channel.send(prefix + text);
    } catch (e) {
      console.error(`chunkAndSend (single): ${e.message}`);
    }
    return;
  }

  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_LEN) {
    chunks.push(text.slice(i, i + MAX_LEN));
  }

  try {
    await channel.send(prefix + chunks[0]);
  } catch (e) {
    console.error(`chunkAndSend (chunk 0): ${e.message}`);
  }

  for (let i = 1; i < chunks.length; i++) {
    try {
      await channel.send(chunks[i]);
    } catch (e) {
      console.error(`chunkAndSend (chunk ${i}): ${e.message}`);
    }
  }
}

// ── Shared Queue ──
function writeQueue(text, channelId, authorName) {
  const task = {
    id: crypto.randomUUID(),
    from: "yakumo",
    type: "task",
    content: text,
    channel_id: channelId,
    author: authorName,
    timestamp: new Date().toISOString(),
    status: "pending",
  };
  const dir = path.join(SHARED_DIR, "queue");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${task.id}.json`), JSON.stringify(task, null, 2));
  console.log(`📝 已寫入 queue: ${task.id}`);
  return task.id;
}

// ── 待辦事項管理 ──
function loadTodos() {
  try {
    if (fs.existsSync(TODO_FILE)) {
      return JSON.parse(fs.readFileSync(TODO_FILE, "utf-8"));
    }
  } catch (e) {}
  return { tasks: [], lastReminderCount: 0, lastReminderTime: null };
}

function saveTodos(todos) {
  fs.mkdirSync(path.dirname(TODO_FILE), { recursive: true });
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

function addTodo(description, assignedTo) {
  const todos = loadTodos();
  todos.tasks.push({
    id: crypto.randomUUID(),
    description,
    assignedTo: assignedTo || "lucas",
    status: "pending",
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
  saveTodos(todos);
  return todos.tasks[todos.tasks.length - 1];
}

function getPendingTodos() {
  const todos = loadTodos();
  return todos.tasks.filter((t) => t.status === "pending");
}

// ── 頻道管理 ──
async function ensureChannels(guild) {
  const cache = {};
  for (const [key, name] of Object.entries(CHANNELS)) {
    let ch = guild.channels.cache.find((c) => c.name === name);
    if (!ch) {
      try {
        ch = await guild.channels.create({ name, type: ChannelType.GuildText });
        console.log(`📢 已建立頻道: #${name}`);
      } catch (e) {
        console.warn(`⚠️ 無法建立頻道 #${name}: ${e.message}`);
        continue;
      }
    }
    cache[key] = ch.id;
  }
  return cache;
}

async function toChannel(guild, key, content) {
  if (!guild.channelCache) return;
  const id = guild.channelCache[key];
  if (!id) return;
  const ch = guild.channels.cache.get(id);
  if (ch) await ch.send(content);
}

function needsLucas(text) {
  const lower = text.toLowerCase();
  const keywords = [
    "lucas", "找lucas", "問lucas", "轉告lucas",
    "找 lucas", "問 lucas", "轉告 lucas",
    "@lucas", "<@",
  ];
  return keywords.some((kw) => lower.includes(kw));
}

async function reminderCycle(guild) {
  const todos = loadTodos();
  const pending = todos.tasks.filter((t) => t.status === "pending");
  const todoCount = pending.length;
  const lucasWs = guild.channels.cache.get(guild.channelCache.lucas_workspace);
  const logs = guild.channels.cache.get(guild.channelCache.logs);

  if (todoCount !== todos.lastReminderCount) {
    todos.lastReminderCount = todoCount;
    todos.lastReminderTime = new Date().toISOString();
    saveTodos(todos);

    if (todoCount > 0 && lucasWs) {
      const todoList = pending
        .map((t, i) => `${i + 1}. [${t.assignedTo}] ${t.description.slice(0, 80)}`)
        .join("\n");
      await lucasWs.send(
        `📋 **待辦更新** (${new Date().toLocaleTimeString("zh-TW")})\n${todoList}`
      );
    } else if (todoCount === 0 && lucasWs) {
      await lucasWs.send(`✅ 所有待辦事項已完成！`);
    }
  }

  if (logs) {
    await logs.send(`🌸 例行檢查完成。待辦: ${todoCount} 件（未變化則靜音）`);
  }
}

// ── 啟動 ──
client.once("ready", async () => {
  console.log(`🌸 八雲 v2.1 已上線！(${client.user.tag})`);
  console.log(`📡 伺服器: ${client.guilds.cache.size} 個`);

  for (const guild of client.guilds.cache.values()) {
    guild.channelCache = await ensureChannels(guild);
    await toChannel(guild, "logs", "🌸 八雲起床了～（v2.1 串流 + timeout 300s）");
    await toChannel(guild, "lobby", "🌸 早安～有什麼需要幫忙的嗎？");

    setInterval(() => reminderCycle(guild), 15 * 60 * 1000);

    // 監控 queue — 有 timeout 避免卡住
    const queueDir = path.join(SHARED_DIR, "queue");
    setInterval(async () => {
      try {
        if (!fs.existsSync(queueDir)) return;
        const files = fs.readdirSync(queueDir).filter(f => f.endsWith(".json"));
        if (files.length === 0) return;

        const now = Date.now();
        for (const fname of files) {
          const fpath = path.join(queueDir, fname);
          try {
            const stat = fs.statSync(fpath);
            if (now - stat.mtimeMs > 5 * 60 * 1000) {
              const logs = guild.channels.cache.get(guild.channelCache.logs);
              if (logs) {
                await logs.send(`⚠️ **Lucas 可能卡住了** — queue 中的任務「${fname}」已等待超過 5 分鐘未處理`);
              }
            }
          } catch(e) {}
        }
      } catch(e) {}
    }, 30000);
  }
});

// ── 訊息處理 ──
// ── 只處理啟動後的新訊息（避免重啟時觸發舊訊息） ──
const STARTUP_TIME = Date.now();
function isFreshMessage(msg) {
  // 如果訊息時間比啟動時間早，跳過
  const msgTime = msg.createdTimestamp;
  return msgTime >= STARTUP_TIME;
}

client.on("messageCreate", async (message) => {
  // 跳過 bot 訊息
  if (message.author.bot) return;
  // 跳過啟動前的舊訊息
  if (!isFreshMessage(message)) return;
  // 只回應 Ryan (dub0015) 的訊息
  if (message.author.username !== "dub0015") return;

  const guild = message.guild;
  if (!guild || !guild.channelCache) return;
  const allowed = Object.values(guild.channelCache);
  if (!allowed.includes(message.channel.id)) return;

  const author = message.member?.displayName || message.author.username;
  const content = message.content;

  // ryan-private 八雲不回應
  const ryanP = guild.channels.cache.get(guild.channelCache.ryan_private);
  if (ryanP && message.channel.id === ryanP.id) return;

  // 提到八雲以外的人不處理
  if (content.includes("<@") && content.includes(client.user.id) === false) return;

  // ── 指令：回溯查詢歷史訊息 ──
  const historyMatch = content.match(/^!history\s+(\S+)(?:\s+(\d+))?$/);
  if (historyMatch) {
    const channelName = historyMatch[1];
    const limit = parseInt(historyMatch[2] || "10", 10);
    console.log(`🔍 回溯查詢: #${channelName} (${limit} 則)`);

    // 找頻道
    const targetName = CHANNELS[channelName] || channelName;
    let targetChannel = guild.channels.cache.find((c) => c.name === targetName || c.name === channelName);
    if (!targetChannel) {
      await message.channel.send(`❌ 找不到頻道 #${channelName}`);
      return;
    }

    try {
      const msgs = await targetChannel.messages.fetch({ limit: Math.min(limit, 50) });
      const lines = [];
      msgs.reverse().forEach((msg) => {
        if (!msg.author.bot) {
          lines.push(`[${msg.author.username}] ${msg.content.replace(/\n/g, " ")}`);
        }
      });
      const reply = lines.length > 0
        ? `📜 **#${targetName} 歷史記錄** (${lines.length} 則)
\`\`\`
${lines.join("\n").slice(0, 1900)}
\`\`\``
        : `#${targetName} 沒有符合的訊息`;
      await message.channel.send(reply);
    } catch (e) {
      await message.channel.send(`❌ 讀取歷史失敗: ${e.message}`);
    }
    return;
  }

  // 指令
  if (content === "!status") {
    const pending = getPendingTodos().length;
    await message.channel.send(`🌸 我在這裡喔～目前有 ${pending} 件待辦事項待處理。`);
    return;
  }

  if (content === "!todo") {
    const todos = getPendingTodos();
    if (todos.length === 0) {
      await message.channel.send("🌸 目前沒有待辦事項，大家都做得很好呢～");
    } else {
      const list = todos
        .map((t, i) => `${i + 1}. [${t.assignedTo}] ${t.description.slice(0, 100)}`)
        .join("\n");
      await message.channel.send(`📋 **待辦事項**\n${list}`);
    }
    return;
  }

  if (content.startsWith("!")) return;

  // 判斷是否要轉交給 Lucas
  const shouldForward = needsLucas(content);

  if (shouldForward) {
    let isClear = false;
    let clarificationText = "";
    try {
      const judge = await callLLM([
        { role: "user", content: `主人說：${content}\n\n請問這個需求是否足夠清楚可以直接交給 Lucas 執行？回答格式：\n- 如果清楚：CLEAR\n- 如果不清楚，需要問什麼：UNCLEAR: [你覺得需要先問清楚什麼]` },
      ], 150, guild);
      if (judge.startsWith("CLEAR")) {
        isClear = true;
      } else {
        clarificationText = judge.replace(/^UNCLEAR:\s*/i, "");
      }
    } catch (e) {
      clarificationText = "我確認一下細節。";
    }

    if (isClear) {
      console.log(`📩 直接轉交 Lucas（需求清楚）: ${content.slice(0, 50)}...`);
      await toChannel(guild, "internal", `📩 **八雲轉交 Lucas**\n來自: ${author}\n內容: ${content}\n狀態: 需求清楚，直接轉交 ✅`);
      const taskId = writeQueue(content, message.channel.id, author);
      addTodo(`主人: ${content.slice(0, 200)}`, "lucas");
      await toChannel(guild, "lucas_workspace",
        `📋 **新任務** (ID: ${taskId.slice(0, 8)})\n來自: ${author}\n內容: ${content.slice(0, 200)}\n狀態: ⏳ 等待 Lucas`
      );
      await logYakumoConversation(`主人要找 Lucas：${content.slice(0, 200)}`, `已直接轉交 Lucas（需求清楚）`, guild);
    } else {
      await message.channel.send(`🌸 ${clarificationText || "我想確認一下細節⋯"}`);
      console.log(`📩 釐清後轉交 Lucas: ${content.slice(0, 50)}...`);
      await toChannel(guild, "internal", `📩 **八雲轉交 Lucas（已釐清）**\n來自: ${author}\n原始內容: ${content}\n八雲補充: ${clarificationText}\n狀態: 已釐清 ✅`);
      const taskId = writeQueue(content, message.channel.id, author);
      addTodo(`主人: ${content.slice(0, 200)}`, "lucas");
      await toChannel(guild, "lucas_workspace",
        `📋 **新任務** (ID: ${taskId.slice(0, 8)})\n來自: ${author}\n內容: ${content.slice(0, 200)}\n補充: ${clarificationText.slice(0, 100)}\n狀態: ⏳ 等待 Lucas`
      );
      await logYakumoConversation(`主人要找 Lucas：${content.slice(0, 200)}`, `已釐清後轉交：${clarificationText}`, guild);
    }
    return;
  }

  // 一般對話
  console.log(`💬 一般對話: ${content.slice(0, 50)}...`);
  await toChannel(guild, "internal", `💬 ${author}: ${content}`);

  let reply = "";
  try {
    reply = await callLLM([
      { role: "user", content: `${author} 說：${content}` },
    ], 200, guild);
    // ⬅️ 改用 chunkAndSend 安全分段發送
    await chunkAndSend(message.channel, reply, "🌸 ");
  } catch (e) {
    console.error(`LLM error: ${e.message}`);
    reply = "嗯？可以再說一次嗎？";
    await chunkAndSend(message.channel, reply, "🌸 ");
  }
  await logYakumoConversation(`${author}: ${content}`, reply, guild);

  const desk = guild.channels.cache.get(guild.channelCache.yakumo_desk);
  if (desk) {
    await desk.send(`💬 ${new Date().toLocaleTimeString("zh-TW")} - ${author}: ${content.slice(0, 100)}`);
  }

  const todoBoard = guild.channels.cache.get(guild.channelCache.todo_board);
  if (todoBoard) {
    const pending = getPendingTodos();
    if (pending.length > 0) {
      const list = pending.map((t, i) => `${i + 1}. [${t.assignedTo}] ${t.description.slice(0, 100)}`).join("\n");
      await todoBoard.send(`📋 **待辦事項** (${new Date().toLocaleTimeString("zh-TW")})\n${list}`);
    }
  }
});

client.login(TOKEN).then(() => {
  console.log("🌸 八雲 v2.1 啟動中...");
}).catch((err) => {
  console.error("❌ 登入失敗:", err.message);
});