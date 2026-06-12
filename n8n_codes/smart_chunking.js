// ═══════════════════════════════════════════════════════════
// 📎 Smart Chunking — n8n Code: Format Response 節點
// 功能：Lucas API 回應格式化 + 1900 字安全切分 + 不切句子
// 輸入：$input.first().json (from Lucas API response)
// 輸出：Array of items (每筆一則 Discord 訊息)
// ═══════════════════════════════════════════════════════════

const resp = $input.first().json;
const channel_id = $json.channel_id || '';
let rawMessage = '';

// ── Step 1: 組裝回應字串 ──────────────────────────────
if (resp.status === 'success') {
    rawMessage = resp.data;
    const agentLabel = resp.agent && resp.agent !== 'llm'
        ? `[${resp.agent}] `
        : '';
    const timeLabel = resp.elapsed
        ? ` \`(${Math.round(resp.elapsed / 1000)}s)\``
        : '';
    rawMessage = agentLabel + rawMessage + timeLabel;
} else {
    rawMessage = `❌ 處理失敗：${resp.data || '未知錯誤'}`;
}

// 若無內容則回傳空陣列避免 n8n 報錯
if (!rawMessage || rawMessage.trim() === '') {
    return [{
        json: {
            content: '⚠️ 回覆為空，請稍後再試。',
            channel_id: channel_id,
        }
    }];
}

// ── Step 2: 1900 字安全切分 ──────────────────────────
const MAX_LEN = 1900;
const MAX_LINES = 30;      // 防止無限分段
const LANG_OPENERS = /[（(「『『【《「]/;
const LANG_CLOSERS = /[）)」』】》」]/;

function smartSplit(text, maxLen) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > maxLen) {
        let cut = maxLen;

        // 1️⃣ 從 maxLen 往回找最近的句號（。！？）
        const sentenceEnd = remaining.lastIndexOf('。', cut);
        const exclaimEnd = remaining.lastIndexOf('！', cut);
        const questionEnd = remaining.lastIndexOf('？', cut);
        const newlineEnd = remaining.lastIndexOf('\n', cut);
        const bestEnd = Math.max(sentenceEnd, exclaimEnd, questionEnd, newlineEnd);

        if (bestEnd > maxLen * 0.5) {
            cut = bestEnd + 1; // 包含標點
        } else {
            // 2️⃣ 沒有句號 → 找空格或逗號
            const spaceEnd = remaining.lastIndexOf(' ', cut);
            const commaEnd = remaining.lastIndexOf('，', cut);
            const fallback = Math.max(spaceEnd, commaEnd);

            if (fallback > maxLen * 0.3) {
                cut = fallback + 1;
            }
            // 3️⃣ 如果連空格/逗號都沒有 → 硬切 (但保留 50 字上下文)
        }

        // 檢查是否切在中文括號中間
        const beforeCut = remaining[cut - 1] || '';
        const afterCut = remaining[cut] || '';
        if (LANG_OPENERS.test(beforeCut) && !LANG_CLOSERS.test(afterCut)) {
            // 往前找到括號開啟處
            const openIdx = remaining.lastIndexOf(beforeCut, cut - 1);
            if (openIdx >= 0 && cut - openIdx < 100) {
                cut = openIdx;
            }
        }

        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }

    // 最後一段
    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}

const segments = smartSplit(rawMessage, MAX_LEN);

// ── Step 3: 若有分段，第一段加篇幅提示 ──────────────
const result = [];

if (segments.length > 1) {
    // 第一段：加篇幅提示
    result.push({
        json: {
            content: `📎 1/${segments.length}\n${segments[0]}`,
            channel_id: channel_id,
        }
    });

    // 中間段
    for (let i = 1; i < segments.length; i++) {
        result.push({
            json: {
                content: `📎 ${i+1}/${segments.length}\n${segments[i]}`,
                channel_id: channel_id,
            }
        });
    }
} else {
    // 單一段落，直接輸出
    result.push({
        json: {
            content: segments[0],
            channel_id: channel_id,
        }
    });
}

return result;