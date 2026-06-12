#!/usr/bin/env node
/**
 * indicators.js — 純 JS 技術指標計算庫
 * =====================================
 * 零 npm 依賴，僅用標準 Math。
 * 所有函數接受價格陣列（numbers），回傳每個點的數值。
 * 支援：MA, EMA, RSI, MACD, KD, Bollinger Bands, SMA (alias)
 *
 * Usage:
 *   const ind = require('./indicators.js');
 *   const ma20 = ind.calcMA(prices, 20);
 */

"use strict";

/**
 * 簡單移動平均線 (SMA / MA)
 * @param {number[]} prices — 價格陣列（oldest → newest）
 * @param {number} period — 週期（如 5, 10, 20, 60）
 * @returns {Array<{value: number|null, index: number}>} — 每個 index 對應的 MA 值
 */
function calcMA(prices, period) {
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push({ value: null, index: i });
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += prices[j];
      }
      result.push({ value: sum / period, index: i });
    }
  }
  return result;
}

/**
 * 指數移動平均線 (EMA)
 * @param {number[]} prices — 價格陣列
 * @param {number} period — 週期
 * @returns {Array<{value: number|null, index: number}>}
 */
function calcEMA(prices, period) {
  const result = [];
  const multiplier = 2 / (period + 1);

  // 第一個 EMA = SMA
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push({ value: null, index: i });
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[j];
      }
      result.push({ value: sum / period, index: i });
    } else {
      const prevEMA = result[i - 1].value;
      const ema = (prices[i] - prevEMA) * multiplier + prevEMA;
      result.push({ value: ema, index: i });
    }
  }
  return result;
}

/**
 * 相對強弱指標 (RSI)
 * @param {number[]} prices — 價格陣列
 * @param {number} [period=14] — 週期（預設 14）
 * @returns {Array<{value: number|null, index: number}>}
 */
function calcRSI(prices, period = 14) {
  const result = [];

  // 需至少 period+1 筆才能算出第一個值
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      result.push({ value: null, index: i });
      continue;
    }

    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = prices[j] - prices[j - 1];
      if (diff > 0) gains += diff;
      else losses -= diff; // losses 為正值
    }

    if (losses === 0) {
      result.push({ value: 100, index: i });
    } else {
      const rs = gains / losses;
      const rsi = 100 - (100 / (1 + rs));
      result.push({ value: rsi, index: i });
    }
  }
  return result;
}

/**
 * MACD（指數平滑異同移動平均線）
 * @param {number[]} prices — 價格陣列
 * @param {number} [fast=12] — 快線週期
 * @param {number} [slow=26] — 慢線週期
 * @param {number} [signal=9] — 信號線週期
 * @returns {{ macd: Array, signal: Array, histogram: Array }}
 *   每個欄位都是 { value, index } 陣列，value 可能為 null
 */
function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);

  // MACD 線 = EMA(fast) - EMA(slow)
  const macdLine = [];
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i].value === null || emaSlow[i].value === null) {
      macdLine.push({ value: null, index: i });
    } else {
      macdLine.push({ value: emaFast[i].value - emaSlow[i].value, index: i });
    }
  }

  // 信號線 = EMA of MACD
  const macdValues = macdLine.map(m => m.value !== null ? m.value : 0);
  // 找到第一個非 null 的位置
  let firstValid = -1;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i].value !== null) {
      firstValid = i;
      break;
    }
  }

  const signalLine = [];
  if (firstValid === -1) {
    // 全部為 null
    for (let i = 0; i < prices.length; i++) {
      signalLine.push({ value: null, index: i });
    }
  } else {
    // 從 firstValid 開始計算 EMA
    const validMacd = [];
    for (let i = firstValid; i < macdLine.length; i++) {
      validMacd.push(macdLine[i].value);
    }
    const emaSignal = calcEMA(validMacd, signal);

    // 重組，前面補 null
    for (let i = 0; i < prices.length; i++) {
      if (i < firstValid) {
        signalLine.push({ value: null, index: i });
      } else {
        const idx = i - firstValid;
        if (idx < emaSignal.length) {
          signalLine.push({ value: emaSignal[idx].value, index: i });
        } else {
          signalLine.push({ value: null, index: i });
        }
      }
    }
  }

  // 柱狀圖 = MACD 線 - 信號線
  const histogram = [];
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i].value === null || signalLine[i].value === null) {
      histogram.push({ value: null, index: i });
    } else {
      histogram.push({ value: macdLine[i].value - signalLine[i].value, index: i });
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * KD 隨機指標 (Stochastic Oscillator)
 * @param {number[]} high — 最高價陣列
 * @param {number[]} low — 最低價陣列
 * @param {number[]} close — 收盤價陣列
 * @param {number} [period=9] — RSV 週期
 * @param {number} [k_smooth=3] — K 值平滑
 * @param {number} [d_smooth=3] — D 值平滑
 * @returns {{ k: Array, d: Array }}
 */
function calcKD(high, low, close, period = 9, k_smooth = 3, d_smooth = 3) {
  const len = Math.min(high.length, low.length, close.length);

  // 計算 RSV = (收盤價 - 最近 period 最低) / (最近 period 最高 - 最近 period 最低) * 100
  const rsv = [];
  for (let i = 0; i < len; i++) {
    if (i < period - 1) {
      rsv.push(null);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (high[j] > highest) highest = high[j];
        if (low[j] < lowest) lowest = low[j];
      }
      const range = highest - lowest;
      if (range === 0) {
        rsv.push(50);
      } else {
        rsv.push(((close[i] - lowest) / range) * 100);
      }
    }
  }

  // K = SMA(RSV, k_smooth), D = SMA(K, d_smooth)
  const kValues = [];
  for (let i = 0; i < len; i++) {
    if (rsv[i] === null) {
      kValues.push(null);
    } else if (i === period - 1) {
      // 第一個 K = 第一個 RSV (當 k_smooth=1) 或 前 k_smooth 個 RSV 平均
      if (k_smooth <= 1) {
        kValues.push(rsv[i]);
      } else {
        let sum = 0;
        const start = Math.max(period - 1, i - k_smooth + 1);
        for (let j = start; j <= i; j++) {
          sum += rsv[j];
        }
        kValues.push(sum / (i - start + 1));
      }
    } else {
      // K(t) = (k_smooth-1)/k_smooth * K(t-1) + 1/k_smooth * RSV(t)
      const prevK = kValues[i - 1];
      if (prevK === null) {
        kValues.push(rsv[i]);
      } else {
        kValues.push(((k_smooth - 1) / k_smooth) * prevK + (1 / k_smooth) * rsv[i]);
      }
    }
  }

  // D = SMA(K, d_smooth)
  const dValues = [];
  for (let i = 0; i < len; i++) {
    if (kValues[i] === null) {
      dValues.push(null);
    } else {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - d_smooth + 1); j <= i; j++) {
        if (kValues[j] !== null) {
          sum += kValues[j];
          count++;
        }
      }
      dValues.push(count > 0 ? sum / count : null);
    }
  }

  // 轉為 { value, index } 格式
  const kResult = kValues.map((v, i) => ({ value: v, index: i }));
  const dResult = dValues.map((v, i) => ({ value: v, index: i }));

  return { k: kResult, d: dResult };
}

/**
 * 布林通道 (Bollinger Bands)
 * @param {number[]} prices — 價格陣列
 * @param {number} [period=20] — 週期
 * @param {number} [multiplier=2] — 標準差倍數
 * @returns {{ upper: Array, middle: Array, lower: Array }}
 */
function calcBollinger(prices, period = 20, multiplier = 2) {
  const middle = calcMA(prices, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < prices.length; i++) {
    if (middle[i].value === null) {
      upper.push({ value: null, index: i });
      lower.push({ value: null, index: i });
    } else {
      // 計算標準差
      let sumSqDiff = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = prices[j] - middle[i].value;
        sumSqDiff += diff * diff;
      }
      const stdDev = Math.sqrt(sumSqDiff / period);
      upper.push({ value: middle[i].value + multiplier * stdDev, index: i });
      lower.push({ value: middle[i].value - multiplier * stdDev, index: i });
    }
  }

  return { upper, middle, lower };
}

/**
 * SMA — calcMA 的別名（易用性）
 */
const calcSMA = calcMA;

// === Node.js 匯出 ===
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calcMA,
    calcSMA,
    calcEMA,
    calcRSI,
    calcMACD,
    calcKD,
    calcBollinger,
  };
}