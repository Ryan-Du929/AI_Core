// 🧠 Lucas Discord Bot v2.2 — DeepSeek ThinkMax + Reasoning Logging + 非阻塞 Queue
// 主要升級 (2026-05-22)：
//   1. 模型鎖定 NVIDIA deepseek-ai/deepseek-v4-pro (更強推理)
//   2. max_tokens 提升至 8192 容納深度思考
//   3. 串流解析加入 reasoning_content 日誌
//   4. 新增 thinkMax() 非串流版 (8192 tokens, 長推理)
//   5. 所有 fetch() 搭載 AbortController 300s

require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TOKEN = process.env.DISCORD_BOT_TOKEN_LUCAS;
const NVIDIA_API_KEY = process.env.OPENAI_API_KEY;
const NVIDIA_BASE_URL = process.env.OPENAI_BASE_URL || "https://integrate.api.nvidia.com/v1";

// ── ThinkMax 模型設定：使用 NVIDIA 上最強的 DeepSeek 推理模型 ──
const NVIDIA_MODEL = process.env.OPENAI_MODEL || "deepseek-ai/deepseek-v4-pro";
const DEFAULT_MAX_TOKENS = 8192; // 容納深度思考

const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const QUEUE_DIR = path.join(SHARED_DIR, "queue");
const RESULTS_DIR = path.join(SHARED_DIR, "results");
const MEMORY_FILE = path.join(SHARED_DIR, "memory", "lucas-memory.json");
const SNAPSHOT_FILE = path.join(SHARED_DIR, "memory", "lucas-snapshot.json");

// ── 超時設定 ──
// ThinkMax 需要更長時間，設為 600 秒
const FETCH_TIMEOUT_MS = 600_000;

// ── 記憶蒸餾設定 ──
const MAX_TURNS = 10;
const MAX_HISTORY = 30;

// ── 輔助: 建立 AbortController 與 timeout ──
function createFetchSignal() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { controller, timeoutId, signal: controller.signal };
}
function clearFetchSignal(timeoutId) {
  clearTimeout(timeoutId);
}

// ══════════════════════════════════════════════════════
// 🧠 ThinkMax — 深度思考呼叫（非串流，8192 tokens，V4 Pro）
// 用於需要長時間推理的任務：程式設計、架構分析、報告撰寫
// ══════════════════════════════════════════════════════
async function thinkMax(messages, maxTokens = DEFAULT_MAX_TOKENS) {
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
              "你是 Lucas，AI agent 團隊首腦。理性務實，就事論事。" +
              "與八雲（溫柔祕書）是同事。八雲是你的前端窗口，負責過濾和釐清需求。" +
              "用繁體中文回應。你的任務是分析、決策、複雜處理。" +
              "你不需要第一時間回覆，專注在把任務做好。",
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
      throw new Error(`ThinkMax ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const data = await resp.json();
    const message = data.choices?.[0]?.message || {};
    
    // ── 解析 reasoning_content（若模型支援） ──
    const reasoning = message.reasoning_content || "";
    if (reasoning) {
      console.log(`💭 [ThinkMax 思考過程] ${reasoning.slice(0, 500)}...`);
    } else {
      console.log(`💭 [ThinkMax] 使用 ${NVIDIA_MODEL}，reasoning_reported=no`);
    }
    
    // ── Token 用量日誌 ──
    const usage = data.usage || {};
    if (usage.total_tokens) {
      console.log(`📊 [ThinkMax] tokens: input=${usage.prompt_tokens} output=${usage.completion_tokens} total=${usage.total_tokens}`);
    }
    
    return message.content || "";
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ══════════════════════════════════════════════════════
// 💬 thinkStreaming — 即時回覆（串流模式）
// 用於 @Lucas 即時對話、一般任務回覆
// ══════════════════════════════════════════════════════
async function thinkStreaming(messages, maxTokens = 4096) {
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
              "你是 Lucas，AI agent 團隊首腦。理性務實，就事論事。" +
              "與八雲（溫柔祕書）是同事。八雲是你的前端窗口，負責過濾和釐清需求。" +
              "用繁體中文回應。你的任務是分析、決策、複雜處理。" +
              "你不需要第一時間回覆，專注在把任務做好。",
          },
          ...messages,
        ],
        temperature: 0.6,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`DeepSeek ${resp.status}: ${txt.slice(0, 200)}`);
    }

    // 解析 SSE 串流，同時收集 reasoning_content
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let fullReasoning = "";
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
          
          // 收集 content
          if (delta.content) {
            fullContent += delta.content;
          }
          
          // ⬅️ 攔截 reasoning_content（若模型支援串流思考）
          if (delta.reasoning_content) {
            fullReasoning += delta.reasoning_content;
          }
        } catch {
          // 忽略非標準 chunk
        }
      }
    }

    // 處理 buffer 中剩餘資料
    if (buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
      const data = buffer.trim().slice(6);
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta || {};
        if (delta.content) fullContent += delta.content;
        if (delta.reasoning_content) fullReasoning += delta.reasoning_content;
      } catch {}
    }

    // ── 思考過程日誌 ──
    if (fullReasoning) {
      console.log(`💭 [Streaming 思考過程] ${fullReasoning.slice(0, 300)}...`);
    }

    return fullContent;
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ── 輔助: 非串流呼叫（給記憶蒸餾等背景任務用） ──
// 使用相同的 V4 Pro + 8192 token 上限
async function fetchWithTimeout(body) {
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
        ...body,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`DeepSeek ${resp.status}: ${txt.slice(0, 200)}`);
    }
    
    const data = await resp.json();
    
    // ── reasoning_content 日誌 ──
    const msg = data.choices?.[0]?.message || {};
    const reasoning = msg.reasoning_content || "";
    if (reasoning) {
      console.log(`💭 [fetchWithTimeout 思考過程] ${reasoning.slice(0, 300)}...`);
    }
    
    return data;
  } finally {
    clearFetchSignal(timeoutId);
  }
}

// ── 記憶 ──
function loadMemory() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8"));
      if (snap.summary && snap.createdAt) {
        console.log(`📸 載入記憶快取摘要 (${snap.createdAt})`);
        const m = {
          conversations: [
            {
              role: "system",
              content: `這是我們先前的記憶摘要，請基於此繼續工作：${snap.summary}`,
              timestamp: snap.createdAt,
            },
          ],
          facts: snap.facts || [],
          turnCount: 0,
          snapshotLoadedAt: new Date().toISOString(),
        };
        saveMemory(m);
        try { fs.unlinkSync(SNAPSHOT_FILE); } catch(e) {}
        return m;
      }
    }
  } catch (e) {
    console.warn(`⚠️ 無法載入記憶快取: ${e.message}`);
  }

  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const m = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      if (m.turnCount === undefined) m.turnCount = 0;
      return m;
    }
  } catch (e) {}
  return { conversations: [], facts: [], turnCount: 0 };
}
function saveMemory(m) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(m, null, 2));
}

// ── 記憶蒸餾（有 timeout） ──
async function distillMemory(memory) {
  const history = memory.conversations;
  if (history.length === 0) return "（無歷史對話）";

  const summaryMessages = [
    {
      role: "system",
      content: "你是一個摘要助手。請將使用者的對話濃縮成 500 字以內的中文摘要，保留重要參數與未完成任務。直接輸出摘要，不要額外說明。",
    },
    {
      role: "user",
      content: `請摘要以下對話：\n${JSON.stringify(history).slice(0, 6000)}`,
    },
  ];

  let summary = "";
  try {
    const data = await fetchWithTimeout({
      model: NVIDIA_MODEL,
      messages: summaryMessages,
      temperature: 0.3,
      max_tokens: 500,
    });
    summary = data.choices[0].message.content.trim();
  } catch (e) {
    console.error(`⚠️ 記憶蒸餾失敗: ${e.message}`);
    summary = `[摘要失敗] 共 ${history.length} 條訊息。`;
  }

  try {
    const snapshot = {
      summary,
      createdAt: new Date().toISOString(),
      facts: memory.facts || [],
    };
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    console.log(`📸 記憶快取已寫入: ${SNAPSHOT_FILE}`);
  } catch (e) {
    console.warn(`⚠️ 無法寫入記憶快取: ${e.message}`);
  }

  memory.conversations = [
    {
      role: "system",
      content: `這是我們先前的記憶摘要，請基於此繼續工作：${summary}`,
      timestamp: new Date().toISOString(),
    },
  ];
  memory.turnCount = 0;

  console.log(`✅ 記憶蒸餾完成，共 ${history.length} 條壓縮為摘要`);
  return summary;
}

// ══════════════════════════════════════════════════════
// 📨 長文截斷防護 — Smart Chunking
// Discord 單則訊息上限 2000 字元。此函數安全分段發送：
// - 第一段可帶 prefix（如 "🧠 Lucas："）
// - 後續純文字分段
// - 每個 chunk 精確 ≤ 2000 chars
// - 永不拋錯：catch 內 console.error + 繼續下一段
// ══════════════════════════════════════════════════════
async function chunkAndSend(channel, text, prefix = "") {
  const OVERHEAD = prefix.length;
  const MAX_LEN = 2000 - OVERHEAD;

  // 空內容直接跳過
  if (!text || text.length === 0) {
    if (prefix) {
      try { await channel.send(prefix); } catch (e) { console.error(`chunkAndSend (empty): ${e.message}`); }
    }
    return;
  }

  // 單段內就放得下
  if (text.length <= MAX_LEN) {
    try {
      await channel.send(prefix + text);
    } catch (e) {
      console.error(`chunkAndSend (single): ${e.message}`);
    }
    return;
  }

  // 需要分段：第一段帶 prefix，後續純文字
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_LEN) {
    chunks.push(text.slice(i, i + MAX_LEN));
  }

  // 依序發送，每段獨立 try/catch
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

// ══════════════════════════════════════════════════════
// Agent 路由：將任務轉發給專家 Agent（Python）
// ══════════════════════════════════════════════════════

// Agent 路由表：taskType → Python 模組路徑
const AGENT_ROUTES = {
  // 投資顧問
  "price":        "shared/agents/investment_agent.py",
  "quote":        "shared/agents/investment_agent.py",
  "technical":    "shared/agents/investment_agent.py",
  "news":         "shared/agents/investment_agent.py",
  "portfolio":    "shared/agents/investment_agent.py",
  "report":       "shared/agents/investment_agent.py",
  "investment":   "shared/agents/investment_agent.py",
  // 知識管理師
  "search":       "shared/agents/knowledge_agent.py",
  "extract":      "shared/agents/knowledge_agent.py",
  "classify":     "shared/agents/knowledge_agent.py",
  "save_lesson":  "shared/agents/knowledge_agent.py",
  "stats":        "shared/agents/knowledge_agent.py",
  "knowledge":    "shared/agents/knowledge_agent.py",
  // 工具開發師
  "new_tool":     "shared/agents/tool_dev_agent.py",
  "pipeline":     "shared/agents/tool_dev_agent.py",
  "scraper":      "shared/agents/tool_dev_agent.py",
  "integration":  "shared/agents/tool_dev_agent.py",
  "monitor":      "shared/agents/tool_dev_agent.py",
  "fix":          "shared/agents/tool_dev_agent.py",
  "tool_dev":     "shared/agents/tool_dev_agent.py",
};

// Agent 類型映射：taskType → agent type (for dispatcher routing)
const AGENT_TYPE_MAP = {
  "price": "price", "quote": "quote", "technical": "technical",
  "news": "news", "portfolio": "portfolio", "report": "report",
  "investment": "investment",
  "search": "search", "extract": "extract", "classify": "classify",
  "save_lesson": "save_lesson", "stats": "stats", "knowledge": "knowledge",
  "new_tool": "new_tool", "pipeline": "pipeline", "scraper": "scraper",
  "integration": "integration", "monitor": "monitor", "fix": "fix",
  "tool_dev": "tool_dev",
};

/**
 * 從任務內容中偵測適合的 Agent task type。
 * 回傳 type 字串，無法判斷則回傳 null。
 */

// ── Queue 任務處理單元（非阻塞 — 每個任務獨立執行） ──

function detectAgentType(content) {
  const c = content.toLowerCase();

  // 投資顧問
  if (/報告|快報|market|report|市場摘要/.test(c)) return "report";
  if (/投資組合|portfolio|holdings|持倉/.test(c)) return "portfolio";
  if (/新聞|news/.test(c)) return "news";
  if (/股價|價格|stock|price|收盤|漲跌|2330|台積電|台積|鴻海|聯發科|聯發|bitcoin|btc|eth|以太|加密|加密貨幣|匯率|多少錢|報價|行情|比特幣/.test(c)) return "price";

  // 知識管理師
  if (/搜尋|search|找一下|查一下|lesson|教訓|learn|記錄|保存|存起來|save|store/.test(c)) return "search";
  if (/分類|classify/.test(c)) return "classify";
  if (/統計|stats|知識庫/.test(c)) return "stats";
  if (/審閱|review/.test(c)) return "review";
  if (/擷取|extract|知識/.test(c)) return "extract";

  // 工具開發師
  if (/寫一個|create|script|爬蟲|scraper|crawl|監控|monitor|fix|修復|bug|腳本|產生|generate|開發|工具|自動化|pipeline/.test(c)) return "new_tool";

  return null;
}

function tryCallAgent(taskType, content) {
  if (!AGENT_ROUTES[taskType] || taskType === "task") {
    const detected = detectAgentType(content);
    if (detected) {
      console.log("Agent detect: " + content.slice(0, 40) + " -> " + detected);
      taskType = detected;
    } else {
      return null;
    }
  }

  const agentFile = AGENT_ROUTES[taskType];
  if (!agentFile) return null;

  const agentType = AGENT_TYPE_MAP[taskType] || taskType;
  const workspace = "/home/node/.openclaw/workspace-your";
  const script = path.join(workspace, agentFile);

  if (!fs.existsSync(script)) {
    console.error("Agent script not found: " + script);
    return null;
  }

  try {
    const contentEscaped = JSON.stringify(content);
    const pythonCode = [
      "import sys",
      'sys.path.insert(0, "' + workspace + '")',
      "from shared.agents import init_agents",
      "d = init_agents()",
      'result = d.route({"type": "' + agentType + '", "content": ' + contentEscaped + ', "author": "lucas-router"})',
      'print(result["content"])',
      "d.stop_all()",
    ].join("\n");

    const output = execFileSync("python3", ["-c", pythonCode], {
      timeout: 30000,
      maxBuffer: 1024 * 100,
      encoding: "utf-8",
    });

    const lines = output.split("\n").filter(l => !l.startsWith("[") && l.trim());
    return lines.join("\n") || "(Agent no response)";
  } catch (e) {
    console.error("Agent error: " + e.message);
    return null;
  }
}

async function processQueueTask(fname, memory, guild) {
  const fpath = path.join(QUEUE_DIR, fname);
  let task;
  try {
    task = JSON.parse(fs.readFileSync(fpath, "utf-8"));
  } catch (e) {
    // 檔案損毀或消失，直接移除
    try { fs.unlinkSync(fpath); } catch {}
    return;
  }

  const author = task.author || "Ryan";
  const content = task.content || "";
  const channelId = task.channel_id;
  const skipLLM = task.skipLLM === true;
  const taskType = task.type || "task";

  console.log(`🧠 處理 queue: ${fname} — ${author}: ${content.slice(0, 60)}${skipLLM ? ' [跳過LLM]' : ''} [type=${taskType}]`);

  // ── type: "discuss" — lucas-workspace 訊息，只寫入 results 不發 Discord ──
  if (taskType === "discuss") {
    console.log(`💬 lucas-workspace 訊息: ${content.slice(0, 100)}`);
    const result = {
      id: fname.replace(".json", ""),
      from: "Ryan",
      type: "workspace_message",
      content: content.replace("[lucas-workspace] ", ""),
      timestamp: new Date().toISOString(),
    };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, fname), JSON.stringify(result, null, 2));
    try { fs.unlinkSync(fpath); } catch {}
    console.log(`✅ lucas-workspace 訊息已存檔: ${fname}`);
    return;
  }

  // ── type: "discord_report" — Embed 報告，直接發送到頻道 ──
  if (taskType === "discord_report") {
    console.log(`📤 discord_report: ${task.title || '無標題'}`);
    const reportChannelName = task.channel || "lucas-workspace";
    const embeds = task.embeds || [];
    const content = task.content || "";

    if (guild) {
      // ── 除錯：列出快取中所有可用頻道名稱 ──
      const cacheKeys = guild.channelCache?.allChannels ? Object.keys(guild.channelCache.allChannels) : [];
      console.log(`📡 頻道快取有 ${cacheKeys.length} 個頻道: ${cacheKeys.slice(0, 5).join(', ')}${cacheKeys.length > 5 ? '...' : ''}`);
      
      // ── 多層頻道尋找 ──
      let targetChannel = null;
      
      // 1. 從 allChannels 快取找
      if (guild.channelCache?.allChannels?.[reportChannelName]) {
        const id = guild.channelCache.allChannels[reportChannelName];
        targetChannel = guild.channels.cache.get(id);
        console.log(`🔍 快取找到 #${reportChannelName} (id=${id})`);
      }
      
      // 2. 即時精確比對（名稱或 ID）
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find((c) => c.name === reportChannelName);
        if (targetChannel) console.log(`🔍 精確比對找到 #${reportChannelName} (id=${targetChannel.id})`);
      }
      
      // 3. 模糊比對
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find((c) =>
          c.isTextBased && c.isTextBased() &&
          (c.name.includes(reportChannelName) || reportChannelName.includes(c.name))
        );
        if (targetChannel) console.log(`🔍 模糊比對找到: #${targetChannel.name}`);
      }
      
      // 4. 最後手段：拿第一個文字頻道
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find((c) => c.isTextBased && c.isTextBased());
        if (targetChannel) console.log(`🔍 使用第一個文字頻道 #${targetChannel.name} 作為 fallback`);
      }

      if (targetChannel && targetChannel.isTextBased()) {
        try {
          // 發送 Embed（支援長文本 chunk）
          const textChunks = task.textChunks || [];
          if (embeds.length > 0) {
            await targetChannel.send({ content: content.slice(0, 2000) || null, embeds: embeds.slice(0, 10) });
          } else if (content) {
            // 純文字自動 chunk
            const MAX_DISCORD = 2000;
            for (let i = 0; i < content.length; i += MAX_DISCORD) {
              await targetChannel.send(content.slice(i, i + MAX_DISCORD));
            }
          }
          // 後續文字 chunks
          for (const chunk of textChunks) {
            await targetChannel.send(chunk.slice(0, 2000));
          }
          console.log(`✅ 報告已發送到 #${reportChannelName}`);
        } catch (e) {
          console.error(`❌ 發送報告失敗: ${e.message}`);
        }
      } else {
        console.warn(`⚠️ 找不到頻道 #${reportChannelName}（已嘗試快取、精確、模糊比對）`);
      }
    }

    // 寫入 results
    const result = {
      id: fname.replace(".json", ""),
      from: "lucas",
      type: "discord_report",
      content: content.slice(0, 500),
      author,
      timestamp: new Date().toISOString(),
      status: "done",
    };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, fname), JSON.stringify(result, null, 2));
    try { fs.unlinkSync(fpath); } catch {}
    return;
  }

  // ── type: "fetch" — 從 Discord 讀取頻道訊息 ──
  if (taskType === "fetch") {
    const targetChannelName = task.fetchChannel || "待辦事項";
    const limit = task.fetchLimit || 10;
    let reply = `❌ 找不到頻道 #${targetChannelName}`;

    if (guild && guild.channelCache?.allChannels) {
      const targetId = guild.channelCache.allChannels[targetChannelName];
      if (targetId) {
        try {
          const channel = guild.channels.cache.get(targetId);
          if (channel && channel.isTextBased()) {
            const msgs = await channel.messages.fetch({ limit });
            const lines = [];
            msgs.reverse().forEach((msg) => {
              if (!msg.author.bot || msg.author.id === client.user.id) {
                lines.push(`[${msg.author.username}] ${msg.content.replace(/\n/g, " ")}`);
              }
            });
            reply = `📡 頻道 #${targetChannelName} 最新 ${msgs.size} 則訊息：\n\n${lines.join("\n")}`;
          }
        } catch (e) {
          reply = `❌ 讀取頻道失敗: ${e.message}`;
        }
      }
    }

    // 直接寫入 results 檔案，不進 LLM
    const result = {
      id: fname.replace(".json", ""),
      from: "lucas",
      type: "fetch_result",
      content: reply,
      author,
      channel_name: targetChannelName,
      timestamp: new Date().toISOString(),
    };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, fname), JSON.stringify(result, null, 2));
    try { fs.unlinkSync(fpath); } catch {}
    console.log(`✅ 完成 fetch: #${targetChannelName} (${reply.length} chars)`);
    return;
  }

  let reply;

  // ── Agent 路由：檢查是否可交由專家 Agent 處理 ──
  const agentResult = tryCallAgent(taskType, content);
  if (agentResult !== null) {
    reply = agentResult;
    console.log(`🤖 Agent 路由成功: ${taskType} → ${reply.slice(0, 60)}`);
  } else if (skipLLM) {
    reply = task.predefinedReply || "（預設回應，無 LLM 處理）";
  } else {
    const recent = memory.conversations.slice(-10);
    const msgs = [
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `來自 ${author} 的訊息：${content}` },
    ];

    try {
      reply = await thinkStreaming(msgs);
    } catch (e) {
      console.error(`DeepSeek error: ${e.message}`);
      reply = `抱歉，處理時發生錯誤：${e.message}`;
    }
  }

  // 記錄記憶
  memory.conversations.push(
    { role: "user", content: `${author}: ${content}`, timestamp: new Date().toISOString() },
    { role: "assistant", content: reply, timestamp: new Date().toISOString() }
  );
  memory.turnCount += 1;
  if (memory.conversations.length > MAX_HISTORY) {
    memory.conversations = memory.conversations.slice(-MAX_HISTORY);
  }
  saveMemory(memory);

  // 寫入 results
  const result = {
    id: fname.replace(".json", ""),
    from: "lucas",
    type: "task_response",
    content: reply,
    author,
    channel_id: channelId,
    timestamp: new Date().toISOString(),
    status: "done",
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, fname), JSON.stringify(result, null, 2));

  // 移除 queue 檔案（只在處理成功後刪除）
  try { fs.unlinkSync(fpath); } catch {}

  // ⬅️ 改用 chunkAndSend 安全分段發送
  if (guild) {
    const ryanP = guild.channels.cache.get(guild.channelCache?.ryan_private);
    if (ryanP) {
      const prefix = `✅ **任務完成**\n來自: ${author}\n任務: ${content.slice(0, 200)}\n\n🧠 Lucas：`;
      await chunkAndSend(ryanP, reply, prefix);
    }

    const lucasWs = guild.channels.cache.get(guild.channelCache?.lucas_workspace);
    if (lucasWs) {
      const prefix = `✅ **任務完成**\n來自: ${author}\n摘要: `;
      await chunkAndSend(lucasWs, reply.slice(0, 1600), prefix);
    }
  }

  console.log(`✅ 完成: ${fname}`);
}

// ── Client ──
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", async () => {
  console.log(`🧠 Lucas v2.2 上線！(${client.user.tag})`);

  for (const guild of client.guilds.cache.values()) {
    const lobby = guild.channels.cache.find((c) => c.name === "大廳");
    const internal = guild.channels.cache.find((c) => c.name === "內部通訊");
    const logs = guild.channels.cache.find((c) => c.name === "logs");
    const lucasWs = guild.channels.cache.find((c) => c.name === "lucas-workspace");
    const ryanP = guild.channels.cache.find((c) => c.name === "ryan-private");
    // 快取所有頻道以供 fetch 用
    const allChannels = {};
    guild.channels.cache.forEach((ch) => {
      if (ch.isTextBased && ch.isTextBased()) {
        allChannels[ch.name] = ch.id;
      }
    });
    guild.channelCache = { lobby, internal, logs, lucasWs, ryan_private: ryanP?.id, allChannels };

    if (logs) await logs.send("🧠 Lucas v2.2 上線（ThinkMax + V4 Pro + 頻道修復）");
    console.log(`📡 快取了 ${Object.keys(allChannels).length} 個文字頻道`);
  }

  // ── 啟動時檢查記憶狀態 ──
  try {
    const memory = loadMemory();
    const distillCachePath = path.join(SHARED_DIR, "memory", "lucas-distill-cache.json");
    let shouldDistill = false;
    if (fs.existsSync(distillCachePath)) {
      const cache = JSON.parse(fs.readFileSync(distillCachePath, "utf-8"));
      // 如果 turnCount 超過門檻或上次蒸餾超過 24h
      if (memory.turnCount >= 3 && memory.turnCount > (cache.turnCountAtLastDistill || 0)) {
        shouldDistill = true;
        console.log(`⚠️ 啟動檢查：記憶需蒸餾 (turnCount=${memory.turnCount})`);
      }
    } else if (memory.turnCount >= 5) {
      shouldDistill = true;
    }
    if (shouldDistill) {
      await distillMemory(memory);
      saveMemory(memory);
    }
  } catch (e) {
    console.warn(`⚠️ 啟動記憶檢查失敗: ${e.message}`);
  }

  // ── 非阻塞式背景 queue polling（含去重機制） ──
  // 記錄正在處理的檔案，避免重複處理
  const processingSet = new Set();
  setInterval(async () => {
    try {
      const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith(".json"));
      if (files.length === 0) return;

      // 過濾掉已在處理中的檔案
      const newFiles = files.filter((f) => !processingSet.has(f));
      if (newFiles.length === 0) return;

      // 標記為處理中
      for (const f of newFiles) processingSet.add(f);

      const memory = loadMemory();

      // 記憶蒸餾檢查 — 只做一次，不卡 per-task
      if (memory.turnCount >= MAX_TURNS) {
        console.log(`⚠️ 記憶蒸餾觸發 (turnCount=${memory.turnCount})`);
        await distillMemory(memory);
      }

      // ⬅️ 非阻塞：收集所有 guild 參考後，用 allSettled 平行處理
      const guildRef = client.guilds.cache.values().next().value || null;

      const taskPromises = newFiles.map((fname) =>
        processQueueTask(fname, memory, guildRef)
          .catch((err) => console.error(`❌ 任務 ${fname} 失敗:`, err.message))
          .finally(() => processingSet.delete(fname))
      );

      // ⬅️ 關鍵：allSettled 確保一個任務失敗不會影響其他任務
      const results = await Promise.allSettled(taskPromises);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.warn(`⚠️ ${failed.length}/${newFiles.length} 個任務失敗`);
      }
    } catch (e) {
      console.error(`Queue polling error: ${e.message}`);
    }
  }, 10000);
});

// ── 只處理啟動後的新訊息（避免重啟時觸發舊訊息） ──
const STARTUP_TIME = Date.now();
function isFreshMessage(msg) {
  // 如果訊息時間比啟動時間早，跳過
  return msg.createdTimestamp >= STARTUP_TIME;
}

// ── 訊息處理（#大廳 @Lucas 即時回應 + #lucas-workspace 轉 queue） ──
client.on("messageCreate", async (message) => {
  // 跳過 bot 與啟動前的舊訊息
  if (message.author.bot) return;
  if (!isFreshMessage(message)) return;
  // 只回應 Ryan (dub0015) 的訊息
  if (message.author.username !== "dub0015") return;
  if (message.author.id === client.user.id) return;

  const guild = message.guild;
  if (!guild || !guild.channelCache) return;

  const content = message.content;
  const author = message.member?.displayName || message.author.username;

  // ── 指令：回溯查詢歷史訊息 ──
  const historyMatch = content.match(/^!history\s+(\S+)(?:\s+(\d+))?$/);
  if (historyMatch) {
    const channelName = historyMatch[1];
    const limit = parseInt(historyMatch[2] || "10", 10);
    console.log(`🔍 回溯查詢: #${channelName} (${limit} 則)`);

    let targetChannel = guild.channels.cache.find((c) => c.name === channelName);
    if (!targetChannel && guild.channelCache?.allChannels?.[channelName]) {
      targetChannel = guild.channels.cache.get(guild.channelCache.allChannels[channelName]);
    }
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
        ? `📜 **#${channelName} 歷史記錄** (${lines.length} 則)
\`\`\`
${lines.join("\n").slice(0, 1900)}
\`\`\``
        : `#${channelName} 沒有符合的訊息`;
      await message.channel.send(reply);
    } catch (e) {
      await message.channel.send(`❌ 讀取歷史失敗: ${e.message}`);
    }
    return;
  }

  // ── 情境 1: #lucas-workspace — 直接轉 queue 給我（OpenClaw 主體） ──
  const wsChannel = guild.channelCache.lucasWs;
  if (wsChannel) {
    console.log(`🔍 訊息頻道ID: ${message.channel.id}, lucas-workspace ID: ${wsChannel.id}, 比對: ${message.channel.id === wsChannel.id}`);
  }
  if (wsChannel && message.channel.id === wsChannel.id) {
    const queueItem = {
      id: `workspace-${Date.now()}`,
      from: "Ryan",
      to: "lucas",
      type: "discuss",
      skipLLM: true,
      author: "Ryan",
      content: `[lucas-workspace] ${content}`,
      predefinedReply: `已收到你在 #lucas-workspace 的訊息，Lucas 已開始處理。`,
      timestamp: new Date().toISOString(),
    };
    const fname = `lucas-workspace-${Date.now()}.json`;
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.writeFileSync(path.join(QUEUE_DIR, fname), JSON.stringify(queueItem, null, 2));

    // 給一個即時確認
    if (message.channel.isTextBased()) {
      try { await message.channel.sendTyping(); } catch {}
    }
    console.log(`📩 #lucas-workspace → queue: ${content.slice(0, 60)}`);
    return;
  }

  // ── 情境 2: #大廳 @Lucas 即時回應（串流模式） ──
  const lobby = guild.channelCache.lobby;
  if (!lobby || message.channel.id !== lobby.id) return;
  if (!message.mentions.has(client.user)) return;

  const thinking = await message.channel.send("🧠 **Lucas**：讓我想一下⋯");

  try {
    const memory = loadMemory();

    // 記憶蒸餾檢查
    if (memory.turnCount >= MAX_TURNS) {
      console.log(`⚠️ [@Lucas] 記憶蒸餾觸發 (turnCount=${memory.turnCount})`);
      await distillMemory(memory);
      await thinking.edit("🧠 **Lucas**：記憶已重整，請重新發送⋯");
      return;
    }

    const recent = memory.conversations.slice(-10);
    const msgs = [
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `${author} 說：${content}` },
    ];
    const reply = await thinkStreaming(msgs, 512);
    memory.conversations.push(
      { role: "user", content: `${author}: ${content}`, timestamp: new Date().toISOString() },
      { role: "assistant", content: reply, timestamp: new Date().toISOString() }
    );
    memory.turnCount += 1;
    if (memory.conversations.length > MAX_HISTORY) {
      memory.conversations = memory.conversations.slice(-MAX_HISTORY);
    }
    saveMemory(memory);
    // ⬅️ 改用 chunkAndSend 安全分段發送（取代單一 edit）
    // edit 有 2000 字限制，且不可多段。改用先 delete 再 send。
    try { await thinking.delete(); } catch {}
    await chunkAndSend(message.channel, reply, "🧠 **Lucas**：");
  } catch (e) {
    console.error(`[@Lucas] 錯誤: ${e.message}`);
    const errMsg = "🧠 **Lucas**：處理時發生錯誤，請稍後再試。";
    try {
      await message.channel.send(errMsg);
    } catch {}

  }
});

client.login(TOKEN).catch((e) => console.error("❌ Login:", e.message));