// ═══════════════════════════════════════════════════════════
// 📡 Discord Relay Bot v2 — 轉發 + 回覆
//
// 監聽 Discord 訊息 → POST n8n webhook
// n8n 回傳 lucas_api 回應 → 用同一 Discord session 回覆
//
// 啟動：node discord_relay.js
// ═══════════════════════════════════════════════════════════

require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");

// ══════════════════════════════════════════════════════
// 設定
// ══════════════════════════════════════════════════════

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN_LUCAS;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "http://192.168.3.2:5678/webhook/discord-in";

if (!DISCORD_TOKEN) {
  console.error("❌ 缺少 DISCORD_BOT_TOKEN_LUCAS");
  process.exit(1);
}

// ══════════════════════════════════════════════════════
// Discord Client
// ══════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ══════════════════════════════════════════════════════
// 訊息事件
// ══════════════════════════════════════════════════════

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const channelName = message.channel.name || message.channelId;
  const payload = {
    content: message.content,
    channel_id: message.channel.id,
    message_id: message.id,
    author: {
      id: message.author.id,
      username: message.author.username,
      globalName: message.author.globalName,
    },
    guild_id: message.guild?.id,
    timestamp: message.createdTimestamp,
  };

  console.log(`📨 [#${channelName}] ${message.author.username}: ${message.content.slice(0, 80)}`);

  try {
    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      // n8n 回傳 lucas_api 的回應
      const text = await resp.text();
      console.log(`✅ n8n 回應 (${resp.status}): ${text.slice(0, 100)}`);

      // 嘗試解析 JSON 回應
      let replyContent = null;
      try {
        const json = JSON.parse(text);
        if (json.data) replyContent = json.data;
      } catch (e) {
        // 不是 JSON，可能是純文字回應
        if (text && text !== '{"message":"Workflow was started"}') {
          replyContent = text;
        }
      }

      // 如果有回應內容就回覆 Discord
      if (replyContent) {
        // 判斷是否要分段（Discord 限制 2000 字）
        if (replyContent.length > 1900) {
          const chunks = [];
          for (let i = 0; i < replyContent.length; i += 1900) {
            chunks.push(replyContent.slice(i, i + 1900));
          }
          for (const chunk of chunks) {
            await message.channel.send(chunk);
          }
        } else {
          await message.channel.send(replyContent);
        }
        console.log(`✅ 已回覆 #${channelName}`);
      } else {
        console.log(`⏳ n8n 已接收，無立即回覆內容`);
      }
    } else {
      const errText = await resp.text();
      console.warn(`⚠️ n8n 錯誤 ${resp.status}: ${errText.slice(0, 100)}`);
      await message.channel.send(`❌ 處理失敗（${resp.status}），請稍後再試。`);
    }
  } catch (err) {
    console.error(`❌ 轉發失敗: ${err.message}`);
    try {
      await message.channel.send(`❌ 系統錯誤，請稍後再試。`);
    } catch (e) {}
  }
});

// ══════════════════════════════════════════════════════
// 啟動
// ══════════════════════════════════════════════════════

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Discord Relay v2 已上線 (${c.user.tag})`);
  console.log(`📍 轉發目標: ${N8N_WEBHOOK_URL}`);
  console.log(`📍 回覆模式: ✅ 啟用 (同 session 直接回覆)`);
});

client.login(DISCORD_TOKEN).catch((err) => {
  console.error("❌ Discord 登入失敗:", err.message);
  process.exit(1);
});