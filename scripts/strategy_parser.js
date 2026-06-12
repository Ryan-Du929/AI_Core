#!/usr/bin/env node
/**
 * strategy_parser.js — 自然語言策略解析器
 * ==========================================
 * 將中文自然語言描述的交易策略解析為結構化物件。
 * 零 npm 依賴，純文字處理。
 *
 * Usage:
 *   const parser = require('./strategy_parser.js');
 *   const strategy = parser.parse('當5日均線突破20日均線時買入，跌破時賣出');
 *
 * 支援語法：
 *   - MA 交叉：5日均線突破/跌破 10/20/60日均線
 *   - RSI：RSI 低於/高於 30/70
 *   - KD 黃金交叉/死亡交叉
 *   - MACD 柱由負轉正/由正轉負
 *   - 布林通道：突破/跌破 上軌/下軌
 *   - 連續N天上漲/下跌且成交量放大N倍
 *   - 複合條件：股價高於 60日均線 且 RSI > 50
 */

"use strict";

// ============================================================
// 指標名稱對照表
// ============================================================
const INDICATOR_MAP = {
  '5日均線': 'MA5',
  '5日線': 'MA5',
  'ma5': 'MA5',
  'MA5': 'MA5',
  '10日均線': 'MA10',
  '10日線': 'MA10',
  'ma10': 'MA10',
  'MA10': 'MA10',
  '20日均線': 'MA20',
  '20日線': 'MA20',
  'ma20': 'MA20',
  'MA20': 'MA20',
  '60日均線': 'MA60',
  '60日線': 'MA60',
  'ma60': 'MA60',
  'MA60': 'MA60',
  'rsi': 'RSI',
  'RSI': 'RSI',
  'kd': 'KD',
  'KD': 'KD',
  'macd': 'MACD',
  'MACD': 'MACD',
  '布林上軌': 'Bollinger_Upper',
  '布林下軌': 'Bollinger_Lower',
  '布林通道上軌': 'Bollinger_Upper',
  '布林通道下軌': 'Bollinger_Lower',
  '布林': 'Bollinger_Middle',
  '成交量': 'Volume',
  '量': 'Volume',
  '股價': 'Price',
};

// ============================================================
// 條件運算類型
// ============================================================
const CONDITION_TYPES = {
  CROSSOVER: 'crossover',       // 突破/黃金交叉
  CROSSUNDER: 'crossunder',     // 跌破/死亡交叉
  GREATER_THAN: 'gt',           // 大於/高於
  LESS_THAN: 'lt',              // 小於/低於
  CROSS_POSITIVE: 'cross_positive',  // 由負轉正
  CROSS_NEGATIVE: 'cross_negative',  // 由正轉負
  CONSECUTIVE: 'consecutive',   // 連續N天
};

// ============================================================
// 動作類型
// ============================================================
const ACTIONS = {
  BUY: 'buy',
  SELL: 'sell',
  HOLD: 'hold',
  CLOSE: 'close',
};

// ============================================================
// 輔助函數
// ============================================================

/**
 * 從文字中擷取數字
 */
function extractNumber(text) {
  const match = text.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * 從文字中提取連續天數（如「連續3天」 → 3）
 */
function extractConsecutiveDays(text) {
  const match = text.match(/連續(\d+)天/);
  return match ? parseInt(match[1]) : null;
}

/**
 * 從文字中提取倍數（如「放大1.5倍」 → 1.5）
 */
function extractMultiplier(text) {
  const match = text.match(/放大(\d+\.?\d*)倍/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * 檢測文字中是否包含特定關鍵字
 */
function hasKeyword(text, keywords) {
  for (const kw of keywords) {
    if (text.includes(kw)) return true;
  }
  return false;
}

/**
 * 找到文字中第一個匹配的指標
 */
function findIndicator(text) {
  // 按名稱長度排序，優先匹配較長/更精確的名稱
  const sorted = Object.keys(INDICATOR_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (text.includes(key)) {
      return { name: INDICATOR_MAP[key], matched: key };
    }
  }
  return null;
}

/**
 * 找到文字中所有匹配的指標
 */
function findAllIndicators(text) {
  const results = [];
  const sorted = Object.keys(INDICATOR_MAP).sort((a, b) => b.length - a.length);
  const covered = new Set();
  
  for (const key of sorted) {
    if (covered.has(INDICATOR_MAP[key])) continue;
    let pos = text.indexOf(key);
    while (pos !== -1) {
      // Check not already covered by a longer match
      results.push({ name: INDICATOR_MAP[key], matched: key, pos });
      covered.add(INDICATOR_MAP[key]);
      pos = text.indexOf(key, pos + 1);
    }
  }
  
  return results.sort((a, b) => a.pos - b.pos);
}

// ============================================================
// 策略解析主函數
// ============================================================

/**
 * 解析交易策略文字
 * @param {string} text - 中文策略描述
 * @param {object} [options] - 選項
 * @param {string} [options.name] - 策略名稱（自動產生若無）
 * @returns {object} 策略物件
 */
function parse(text, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('策略描述文字不得為空');
  }

  const conditions = [];
  const cleaned = text
    .replace(/當/g, ' ')
    .replace(/時/g, ' ')
    .replace(/，/g, ' ')
    .replace(/。/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 先拆分成「買入/賣出/持有/平倉」條件組
  // 通常輸入格式為：「(條件1)時買入，(條件2)時賣出」
  // 或更複雜的複合條件

  // ============================================================
  // Parser Step 1: 分割買入/賣出/持有條件
  // ============================================================
  const buySellSegments = splitByAction(cleaned);
  
  for (const seg of buySellSegments) {
    const conds = parseConditionSegment(seg.text, seg.action);
    conditions.push(...conds);
  }

  if (conditions.length === 0) {
    throw new Error(`無法解析策略文字: "${text}"`);
  }

  // 自動產生策略名稱
  const name = options.name || generateStrategyName(conditions);

  return {
    name,
    description: text,
    conditions,
  };
}

/**
 * 依照動作分割文字段落
 */
function splitByAction(text) {
  const segments = [];
  
  // 模式1: ...買入... 且/但 ...賣出... (多動作用詞)
  // 先用關鍵詞切分
  const actionMarkers = [
    { keyword: '買入', action: ACTIONS.BUY, position: 'entry' },
    { keyword: '買進', action: ACTIONS.BUY, position: 'entry' },
    { keyword: '做多', action: ACTIONS.BUY, position: 'entry' },
    { keyword: '賣出', action: ACTIONS.SELL, position: 'exit' },
    { keyword: '賣掉', action: ACTIONS.SELL, position: 'exit' },
    { keyword: '做空', action: ACTIONS.SELL, position: 'entry' },  // 做空是 entry（反向）
    { keyword: '持有', action: ACTIONS.HOLD, position: 'hold' },
    { keyword: '平倉', action: ACTIONS.CLOSE, position: 'exit' },
    { keyword: '出場', action: ACTIONS.CLOSE, position: 'exit' },
  ];

  // 找所有動作出現位置
  const markers = [];
  for (const marker of actionMarkers) {
    let idx = text.indexOf(marker.keyword);
    while (idx !== -1) {
      markers.push({ ...marker, index: idx });
      idx = text.indexOf(marker.keyword, idx + 1);
    }
  }

  // 按位置排序
  markers.sort((a, b) => a.index - b.index);

  if (markers.length === 0) {
    // 如果完全沒找到動作關鍵字，預設為 buy
    segments.push({ text, action: ACTIONS.BUY, position: 'entry' });
    return segments;
  }

  // 分割文本：每個 marker 前面的部分是該動作的條件
  let lastEnd = 0;
  for (const marker of markers) {
    if (marker.index < lastEnd) continue;
    
    // 條件部分從上一個 marker 結尾到這個 marker
    const conditionText = text.slice(lastEnd, marker.index).trim();
    if (conditionText) {
      segments.push({ text: conditionText, action: marker.action, position: marker.position });
    }
    lastEnd = marker.index + marker.keyword.length;
  }

  // 如果最後還有殘餘文字且沒有動作匹配
  // 或者 markers 只有一個，但也許有「且/也」連接更多
  if (segments.length === 0) {
    segments.push({ text, action: ACTIONS.BUY, position: 'entry' });
  }

  return segments;
}

/**
 * 解析單一條件段落，回傳條件陣列
 * 支援 context 傳遞 — 若此段落無指標名稱，繼承上一個段落的指標
 */
let _lastIndicatorContext = null;

function parseConditionSegment(text, action) {
  _lastIndicatorContext = null;
  const conditions = [];
  text = text.trim();
  if (!text) return conditions;

  // ============================================================
  // 1. 檢查是否為複合條件（含「且/與/和」）
  // ============================================================
  const subConditions = splitCompoundConditions(text);

  for (const sub of subConditions) {
    const cond = parseSingleCondition(sub, action, _lastIndicatorContext);
    if (cond) {
      conditions.push(cond);
      // 記錄此條件的指標供下一個條件繼承
      if (cond.indicator1) _lastIndicatorContext = cond.indicator1;
      if (cond.indicator2) _lastIndicatorContext = cond.indicator2;
    }
  }

  return conditions;
}

/**
 * 分割複合條件（含「且/或/與/並且」）
 */
function splitCompoundConditions(text) {
  // 嘗試用「且」「並且」「與」「和」「或」分割
  // 但要注意像是「KD」本身含有字母不能誤切，「RSI」也是
  const separators = [
    /\s+且\s+/, /\s+並且\s+/, /\s+與\s+/, /\s+和\s+/, /\s+或\s+/,
    /並且/, /且/, /以及/,
    /\s+且\s+/, /\s+或\s+/,
  ];

  for (const sep of separators) {
    const parts = text.split(sep).map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length >= 2) {
      return parts;
    }
  }

  return [text];
}

/**
 * 解析單一條件
 * @param {string} text - 條件文字
 * @param {string} action - 買賣動作
 * @param {string|null} inheritIndicator - 從上一個條件繼承的指標名稱
 */
function parseSingleCondition(text, action, inheritIndicator) {
  text = text.trim();
  
  // ============================================================
  // 模式: 連續N天上漲/下跌且成交量放大N倍
  // ============================================================
  const consecutiveMatch = text.match(/連續(\d+)天(上漲|下跌|漲|跌)/);
  if (consecutiveMatch) {
    const days = parseInt(consecutiveMatch[1]);
    const direction = consecutiveMatch[2].includes('漲') ? 'up' : 'down';
    
    // 檢查是否有成交量放大
    const volMultiplier = extractMultiplier(text);
    
    return {
      type: CONDITION_TYPES.CONSECUTIVE,
      indicator1: 'Price',
      days,
      direction,
      volumeMultiplier: volMultiplier || null,
      action,
    };
  }

  // ============================================================
  // 模式: MACD 柱由負轉正/由正轉負
  // ============================================================
  if (text.includes('MACD') || text.includes('macd')) {
    if (text.includes('由負轉正') || text.includes('負轉正') || text.includes('由負翻正')) {
      return {
        type: CONDITION_TYPES.CROSS_POSITIVE,
        indicator1: 'MACD',
        indicatorParam: 'histogram',
        action,
      };
    }
    if (text.includes('由正轉負') || text.includes('正轉負') || text.includes('由正翻負')) {
      return {
        type: CONDITION_TYPES.CROSS_NEGATIVE,
        indicator1: 'MACD',
        indicatorParam: 'histogram',
        action,
      };
    }
  }

  // ============================================================
  // 模式: KD 黃金交叉 / 死亡交叉
  // ============================================================
  if ((text.includes('KD') || text.includes('kd')) &&
      (text.includes('黃金交叉') || text.includes('金叉'))) {
    return {
      type: CONDITION_TYPES.CROSSOVER,
      indicator1: 'KD',
      indicator2: 'KD',  // K 線向上突破 D 線
      action,
    };
  }
  if ((text.includes('KD') || text.includes('kd')) &&
      (text.includes('死亡交叉') || text.includes('死叉'))) {
    return {
      type: CONDITION_TYPES.CROSSUNDER,
      indicator1: 'KD',
      indicator2: 'KD',
      action,
    };
  }

  // ============================================================
  // 模式: 布林通道突破/跌破
  // ============================================================
  if ((text.includes('布林') || text.includes('Bollinger')) && 
      (text.includes('突破') || text.includes('上穿'))) {
    if (text.includes('上軌') || text.includes('上緣')) {
      return {
        type: CONDITION_TYPES.CROSSOVER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Upper',
        action,
      };
    }
    // 突破下軌 → 價格從下方突破下軌（buy signal in traditional usage）
    if (text.includes('下軌') || text.includes('下緣')) {
      return {
        type: CONDITION_TYPES.CROSSUNDER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Lower',
        action,
      };
    }
  }
  if ((text.includes('布林') || text.includes('Bollinger')) &&
      (text.includes('跌破') || text.includes('下穿'))) {
    if (text.includes('上軌') || text.includes('上緣')) {
      return {
        type: CONDITION_TYPES.CROSSUNDER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Upper',
        action,
      };
    }
    if (text.includes('下軌') || text.includes('下緣')) {
      return {
        type: CONDITION_TYPES.CROSSOVER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Lower',
        action,
      };
    }
  }
  // 布林通道相關但不含具體軌道的
  if (text.includes('布林') && !text.includes('上軌') && !text.includes('下軌') && !text.includes('中軌')) {
    // fallback: 試著判斷突破/跌破
    if (text.includes('突破')) {
      return {
        type: CONDITION_TYPES.CROSSOVER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Upper',
        action,
      };
    }
    if (text.includes('跌破')) {
      return {
        type: CONDITION_TYPES.CROSSUNDER,
        indicator1: 'Price',
        indicator2: 'Bollinger_Lower',
        action,
      };
    }
  }

  // ============================================================
  // 模式: MA / EMA 突破/跌破（交叉）
  // ============================================================
  const indicators = findAllIndicators(text);
  
  // 檢查突破/跌破/大於/小於關鍵字
  const hasCrossover = hasKeyword(text, ['突破', '上穿', '黃金交叉', '金叉']);
  const hasCrossunder = hasKeyword(text, ['跌破', '下穿', '死亡交叉', '死叉']);
  const hasGreaterThan = hasKeyword(text, ['高於', '大於', '>', '超過']);
  const hasLessThan = hasKeyword(text, ['低於', '小於', '<', '不足']);

  // 上下文繼承：如果當前條件沒有足夠指標，但有繼承的指標
  // 範例：「當5日均線突破20日均線時買入，跌破時賣出」
  // 第二段只有「跌破時」，繼承上一個條件用 MA5 vs MA20
  if (indicators.length < 2 && inheritIndicator && (hasCrossover || hasCrossunder)) {
    const i1 = inheritIndicator;
    const pairMap = { 'MA5': 'MA20', 'MA10': 'MA20', 'MA20': 'MA60', 'MA60': 'MA20' };
    const finalI2 = pairMap[i1] || 'MA20';
    return {
      type: hasCrossover ? CONDITION_TYPES.CROSSOVER : CONDITION_TYPES.CROSSUNDER,
      indicator1: i1,
      indicator2: finalI2,
      action,
    };
  }

  if (indicators.length >= 2 && (hasCrossover || hasCrossunder)) {
    // 兩指標交叉: 取最後兩個 indicator
    const i1 = indicators[indicators.length - 2].name;
    const i2 = indicators[indicators.length - 1].name;
    return {
      type: hasCrossover ? CONDITION_TYPES.CROSSOVER : CONDITION_TYPES.CROSSUNDER,
      indicator1: i1,
      indicator2: i2,
      action,
    };
  }

  // 單指標 + 比較值 或 單指標 + 另一指標
  if (indicators.length >= 1) {
    const ind1 = indicators[0].name;

    // 檢查是否有數值條件 (RSI < 30, > 70 等)
    const value = extractNumber(text);
    
    if (hasGreaterThan && value !== null) {
      return {
        type: CONDITION_TYPES.GREATER_THAN,
        indicator1: ind1,
        value,
        action,
      };
    }
    if (hasLessThan && value !== null) {
      return {
        type: CONDITION_TYPES.LESS_THAN,
        indicator1: ind1,
        value,
        action,
      };
    }

    // 比較型：股價高於 60日均線
    if (hasGreaterThan && indicators.length >= 2) {
      return {
        type: CONDITION_TYPES.GREATER_THAN,
        indicator1: indicators[0].name,
        indicator2: indicators[1].name,
        action,
      };
    }
    if (hasLessThan && indicators.length >= 2) {
      return {
        type: CONDITION_TYPES.LESS_THAN,
        indicator1: indicators[0].name,
        indicator2: indicators[1].name,
        action,
      };
    }

    // 如果只有一個指標 + 數值
    if (value !== null) {
      // 預設判斷方向：較大值的方向
      if (ind1.startsWith('RSI')) {
        // RSI > threshold
        if (value > 50) {
          return {
            type: CONDITION_TYPES.GREATER_THAN,
            indicator1: ind1,
            value,
            action,
          };
        } else {
          return {
            type: CONDITION_TYPES.LESS_THAN,
            indicator1: ind1,
            value,
            action,
          };
        }
      }
    }
  }

  // 如果這裡都解析不到，回退為簡單比較模式
  // 最後手段：對照股價和 MA
  if (text.includes('股價') && hasGreaterThan) {
    const maInd = findIndicator(text.replace('股價', ''));
    if (maInd) {
      return {
        type: CONDITION_TYPES.GREATER_THAN,
        indicator1: 'Price',
        indicator2: maInd.name,
        action,
      };
    }
  }
  if (text.includes('股價') && hasLessThan) {
    const maInd = findIndicator(text.replace('股價', ''));
    if (maInd) {
      return {
        type: CONDITION_TYPES.LESS_THAN,
        indicator1: 'Price',
        indicator2: maInd.name,
        action,
      };
    }
  }

  return null;
}

/**
 * 自動產生策略名稱
 */
function generateStrategyName(conditions) {
  if (conditions.length === 0) return '自訂策略';
  
  const names = [];
  for (const c of conditions) {
    switch (c.type) {
      case CONDITION_TYPES.CROSSOVER:
        if (c.indicator1 === 'KD' && c.indicator2 === 'KD') {
          names.push('KD黃金交叉');
        } else if (c.indicator2 && c.indicator2.startsWith('Bollinger')) {
          names.push(`突破${c.indicator2}`);
        } else if (c.indicator2) {
          names.push(`${c.indicator1}黃金交叉${c.indicator2.substring(0, 4)}`);
        } else {
          names.push(`${c.indicator1}突破`);
        }
        break;
      case CONDITION_TYPES.CROSSUNDER:
        if (c.indicator1 === 'KD' && c.indicator2 === 'KD') {
          names.push('KD死亡交叉');
        } else if (c.indicator2) {
          names.push(`${c.indicator1}死亡交叉${c.indicator2.substring(0, 4)}`);
        } else {
          names.push(`${c.indicator1}跌破`);
        }
        break;
      case CONDITION_TYPES.CROSS_POSITIVE:
        names.push(`${c.indicator1}柱由負轉正`);
        break;
      case CONDITION_TYPES.CROSS_NEGATIVE:
        names.push(`${c.indicator1}柱由正轉負`);
        break;
      case CONDITION_TYPES.GREATER_THAN:
        if (c.indicator2) {
          names.push(`${c.indicator1}高於${c.indicator2}`);
        } else {
          names.push(`${c.indicator1}>${c.value}`);
        }
        break;
      case CONDITION_TYPES.LESS_THAN:
        if (c.indicator2) {
          names.push(`${c.indicator1}低於${c.indicator2}`);
        } else {
          names.push(`${c.indicator1}<${c.value}`);
        }
        break;
      case CONDITION_TYPES.CONSECUTIVE:
        names.push(`連續${c.days}天${c.direction === 'up' ? '上漲' : '下跌'}`);
        if (c.volumeMultiplier) names.push(`量放大${c.volumeMultiplier}倍`);
        break;
      default:
        names.push('其他條件');
    }
  }
  
  return names.join('+') + '策略';
}

// ============================================================
// Module 匯出
// ============================================================
module.exports = {
  parse,
  ACTIONS,
  CONDITION_TYPES,
  INDICATOR_MAP,
};