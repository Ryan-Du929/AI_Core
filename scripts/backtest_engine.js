#!/usr/bin/env node
/**
 * backtest_engine.js — 核心回測引擎
 * ===================================
 * 載入歷史 KBar 資料 → 計算技術指標 → 根據策略條件模擬交易 → 輸出交易紀錄
 *
 * Usage:
 *   const engine = require('./backtest_engine.js');
 *   const result = await engine.runBacktest('2330', '2024-01-01', '2026-06-01', strategyObj, 1000000);
 *
 * strategyObj: 由 strategy_parser.js 產生的結構化策略物件
 *   參考: { name, description, conditions: [{ type, indicator1, indicator2, action, value, ... }] }
 */

"use strict";

const path = require('path');
const fs = require('fs');
const indicators = require('./indicators.js');

// ===== 設定 =====
const KBAR_DIR = path.resolve(__dirname, '..', 'shared', 'data', 'stock_history', 'kbars');

// 交易成本
const COMMISSION_RATE = 0.001425;   // 手續費 0.1425%
const TAX_RATE = 0.003;             // 證交稅 0.3%（賣出時）

// ===== 核心回測 =====

/**
 * 執行回測
 * @param {string} code - 股票代碼 (ex: "2330")
 * @param {string} startDate - 開始日期 (ex: "2024-01-01")
 * @param {string} endDate - 結束日期 (ex: "2026-06-01")
 * @param {object} strategy - 策略物件 (from strategy_parser.js)
 * @param {number} initialCapital - 初始資金 (預設 1,000,000)
 * @returns {object} 回測結果
 */
async function runBacktest(code, startDate, endDate, strategy, initialCapital = 1000000) {
  // 1. 載入資料
  const kbar = await loadKbar(code);
  if (!kbar || !kbar.data || kbar.data.length === 0) {
    throw new Error(`找不到 ${code} 的 KBar 資料`);
  }

  // 2. 過濾日期範圍
  const filtered = filterByDate(kbar.data, startDate, endDate);
  if (filtered.length < 30) {
    throw new Error(`${code} 在 ${startDate}~${endDate} 範圍內資料不足 (${filtered.length} 筆)`);
  }

  // 3. 計算所有需要的技術指標
  const prices = filtered.map(d => d.close);
  const highs = filtered.map(d => d.high);
  const lows = filtered.map(d => d.low);

  const indicatorCache = computeIndicators(prices, highs, lows);

  // 4. 逐日模擬交易
  const trades = [];
  const equity = [{ date: filtered[0].date, value: initialCapital, cash: initialCapital, holdings: 0 }];

  let cash = initialCapital;
  let position = 0; // 持有股數
  let entryPrice = 0;
  let activeConditions = {}; // 記錄哪些條件曾經觸發過

  // 找出策略需要的條件
  const conditions = strategy.conditions || [];

  for (let i = 1; i < filtered.length; i++) {
    const day = filtered[i];
    const prevDay = filtered[i - 1];

    // 檢查每個條件
    let signals = checkConditions(conditions, i, filtered, indicatorCache, activeConditions);
    
    // 執行動作（一個交易日只執行一個動作，買入優先於賣出）
    let actionTaken = null;

    for (const signal of signals) {
      if (signal.action === 'buy' || signal.action === 'close') {
        // 買入訊號：用全部現金買入
        if (cash > 1000 && actionTaken !== 'sell') {
          const buyPrice = day.close;
          const shares = Math.floor(cash / buyPrice / 1000) * 1000; // 以張為單位
          if (shares >= 1000) {
            const cost = shares * buyPrice;
            const commission = Math.round(cost * COMMISSION_RATE);
            const totalCost = cost + commission;
            
            if (totalCost <= cash) {
              position += shares;
              cash -= totalCost;
              entryPrice = buyPrice;
              
              trades.push({
                date: day.date,
                type: 'buy',
                price: buyPrice,
                shares,
                cost: totalCost,
                cash_after: cash,
                reason: signal.reason,
              });
              actionTaken = 'buy';
            }
          }
        }
      }
      
      if (signal.action === 'sell' || signal.action === 'close') {
        // 賣出訊號：全部賣出
        if (position > 0 && actionTaken !== 'buy') {
          const sellPrice = day.close;
          const revenue = position * sellPrice;
          const commission = Math.round(revenue * COMMISSION_RATE);
          const tax = Math.round(revenue * TAX_RATE);
          const netRevenue = revenue - commission - tax;
          
          trades.push({
            date: day.date,
            type: 'sell',
            price: sellPrice,
            shares: position,
            revenue: netRevenue,
            profit: netRevenue - (position * entryPrice),
            profit_pct: ((netRevenue / (position * entryPrice)) - 1) * 100,
            cash_after: cash + netRevenue,
            reason: signal.reason,
          });
          
          cash += netRevenue;
          position = 0;
          actionTaken = 'sell';
        }
      }
    }

    // 更新權益曲線
    const holdingsValue = position * day.close;
    equity.push({
      date: day.date,
      value: cash + holdingsValue,
      cash,
      holdings: position,
      price: day.close,
    });
  }

  // 回測結束時強制平倉
  if (position > 0) {
    const lastDay = filtered[filtered.length - 1];
    const sellPrice = lastDay.close;
    const revenue = position * sellPrice;
    const commission = Math.round(revenue * COMMISSION_RATE);
    const tax = Math.round(revenue * TAX_RATE);
    const netRevenue = revenue - commission - tax;
    
    trades.push({
      date: lastDay.date,
      type: 'close',
      price: sellPrice,
      shares: position,
      revenue: netRevenue,
      profit: netRevenue - (position * entryPrice),
      profit_pct: ((netRevenue / (position * entryPrice)) - 1) * 100,
      cash_after: cash + netRevenue,
      reason: '回測結束平倉',
    });
    
    cash += netRevenue;
    position = 0;
  }

  // 5. 計算績效指標
  const report = computeReport(filtered, trades, equity, initialCapital, startDate, endDate);

  return {
    code,
    strategy: strategy.name,
    description: strategy.description,
    conditions: strategy.conditions,
    period: { start: startDate, end: endDate },
    initialCapital,
    finalCapital: Math.round(cash),
    ...report,
    trades,
    equity,
    indicatorStats: computeIndicatorStats(indicatorCache, prices),
  };
}

// ===== 資料載入 =====

function loadKbar(code) {
  const filePath = path.join(KBAR_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function filterByDate(data, startDate, endDate) {
  return data.filter(d => d.date >= startDate && d.date <= endDate);
}

// ===== 指標計算 =====

function computeIndicators(prices, highs, lows) {
  const cache = {};
  
  // MA 系列
  cache.MA5 = indicators.calcMA(prices, 5);
  cache.MA10 = indicators.calcMA(prices, 10);
  cache.MA20 = indicators.calcMA(prices, 20);
  cache.MA60 = indicators.calcMA(prices, 60);
  
  // EMA
  cache.EMA12 = indicators.calcEMA(prices, 12);
  cache.EMA26 = indicators.calcEMA(prices, 26);
  
  // RSI
  cache.RSI14 = indicators.calcRSI(prices, 14);
  
  // MACD
  cache.MACD = indicators.calcMACD(prices);
  
  // KD
  cache.KD = indicators.calcKD(highs, lows, prices);
  
  // Bollinger
  cache.Bollinger = indicators.calcBollinger(prices);
  
  return cache;
}

// ===== 條件檢查 =====

function getIndicatorValueAt(indicatorCache, indicatorName, index) {
  // Map indicator name to cache key
  const keyMap = {
    'MA5': 'MA5', 'MA10': 'MA10', 'MA20': 'MA20', 'MA60': 'MA60',
    'RSI': 'RSI14',
    'MACD': 'MACD',
    'Volume': null, // 特殊處理
    'Price': null,
    'Bollinger_Upper': 'Bollinger',
    'Bollinger_Lower': 'Bollinger',
    'Bollinger_Middle': 'Bollinger',
  };
  
  if (indicatorName === 'Price') {
    return null; // 由 caller 提供
  }
  if (indicatorName === 'Volume') {
    return null;
  }
  
  const key = keyMap[indicatorName] || indicatorName;
  const data = indicatorCache[key];
  
  if (!data) return null;
  
  if (indicatorName === 'KD') {
    // KD 需要特殊處理：取 K 值
    return data.k?.[index]?.value;
  }
  if (indicatorName === 'Bollinger_Upper') {
    return data.upper?.[index]?.value;
  }
  if (indicatorName === 'Bollinger_Lower') {
    return data.lower?.[index]?.value;
  }
  if (indicatorName === 'Bollinger_Middle') {
    return data.middle?.[index]?.value;
  }
  if (indicatorName === 'MACD') {
    return data.macd?.[index]?.value;
  }
  
  // Array of {value, index}
  if (Array.isArray(data)) {
    return data[index]?.value;
  }
  
  return null;
}

function checkConditions(conditions, i, kbar, indicatorCache, activeConditions) {
  const signals = [];
  const day = kbar[i];
  const prevDay = kbar[i - 1];
  
  for (const cond of conditions) {
    let triggered = false;
    let reason = '';
    
    switch (cond.type) {
      case 'crossover': {
        // 突破 / 黃金交叉
        const val1 = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const val2 = getIndicatorValueForCheck(cond.indicator2, i, kbar, indicatorCache);
        const prevVal1 = getIndicatorValueForCheck(cond.indicator1, i - 1, kbar, indicatorCache);
        const prevVal2 = getIndicatorValueForCheck(cond.indicator2, i - 1, kbar, indicatorCache);
        
        if (val1 !== null && val2 !== null && prevVal1 !== null && prevVal2 !== null) {
          if (prevVal1 <= prevVal2 && val1 > val2) {
            triggered = true;
            reason = `${cond.indicator1}(${val1.toFixed(1)}) 突破 ${cond.indicator2}(${val2.toFixed(1)})`;
          }
        }
        break;
      }
      
      case 'crossunder': {
        // 跌破 / 死亡交叉
        const val1 = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const val2 = getIndicatorValueForCheck(cond.indicator2, i, kbar, indicatorCache);
        const prevVal1 = getIndicatorValueForCheck(cond.indicator1, i - 1, kbar, indicatorCache);
        const prevVal2 = getIndicatorValueForCheck(cond.indicator2, i - 1, kbar, indicatorCache);
        
        if (val1 !== null && val2 !== null && prevVal1 !== null && prevVal2 !== null) {
          if (prevVal1 >= prevVal2 && val1 < val2) {
            triggered = true;
            reason = `${cond.indicator1}(${val1.toFixed(1)}) 跌破 ${cond.indicator2}(${val2.toFixed(1)})`;
          }
        }
        break;
      }
      
      case 'gt': {
        // 大於 / 高於
        const val1 = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const threshold = cond.value !== undefined ? cond.value :
          getIndicatorValueForCheck(cond.indicator2, i, kbar, indicatorCache);
        
        if (val1 !== null && threshold !== null) {
          if (val1 > threshold) {
            triggered = true;
            reason = `${cond.indicator1}(${val1.toFixed(1)}) > ${threshold.toFixed(1)}`;
          }
        }
        break;
      }
      
      case 'lt': {
        // 小於 / 低於
        const val1 = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const threshold = cond.value !== undefined ? cond.value :
          getIndicatorValueForCheck(cond.indicator2, i, kbar, indicatorCache);
        
        if (val1 !== null && threshold !== null) {
          if (val1 < threshold) {
            triggered = true;
            reason = `${cond.indicator1}(${val1.toFixed(1)}) < ${threshold.toFixed(1)}`;
          }
        }
        break;
      }
      
      case 'cross_positive': {
        // 由負轉正 (如 MACD 柱)
        const val = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const prevVal = getIndicatorValueForCheck(cond.indicator1, i - 1, kbar, indicatorCache);
        
        if (val !== null && prevVal !== null && prevVal < 0 && val >= 0) {
          triggered = true;
          reason = `${cond.indicator1} 由負轉正 (${prevVal.toFixed(1)} → ${val.toFixed(1)})`;
        }
        break;
      }
      
      case 'cross_negative': {
        // 由正轉負
        const val = getIndicatorValueForCheck(cond.indicator1, i, kbar, indicatorCache);
        const prevVal = getIndicatorValueForCheck(cond.indicator1, i - 1, kbar, indicatorCache);
        
        if (val !== null && prevVal !== null && prevVal > 0 && val <= 0) {
          triggered = true;
          reason = `${cond.indicator1} 由正轉負 (${prevVal.toFixed(1)} → ${val.toFixed(1)})`;
        }
        break;
      }
      
      case 'consecutive': {
        // 連續N天上漲/下跌 (含成交量)
        let met = true;
        for (let j = i - cond.days + 1; j <= i; j++) {
          if (j < 1) { met = false; break; }
          if (cond.direction === 'up' && kbar[j].close <= kbar[j-1].close) { met = false; break; }
          if (cond.direction === 'down' && kbar[j].close >= kbar[j-1].close) { met = false; break; }
        }
        if (met && cond.volumeMultiplier) {
          // 檢查成交量
          const avgVol = kbar.slice(i - cond.days - 10, i - cond.days)
            .reduce((s, d) => s + d.volume, 0) / 10;
          if (kbar[i].volume < avgVol * cond.volumeMultiplier) {
            met = false;
          }
        }
        if (met) {
          triggered = true;
          reason = `連續${cond.days}天${cond.direction === 'up' ? '上漲' : '下跌'}`;
          if (cond.volumeMultiplier) reason += `(量${cond.volumeMultiplier}倍)`;
        }
        break;
      }
    }
    
    if (triggered) {
      signals.push({
        action: cond.action,
        position: cond.position || 'entry',
        reason,
        conditionType: cond.type,
      });
    }
  }
  
  return signals;
}

function getIndicatorValueForCheck(indicatorName, index, kbar, indicatorCache) {
  if (indicatorName === 'Price') {
    return kbar[index]?.close ?? null;
  }
  if (indicatorName === 'Volume') {
    return kbar[index]?.volume ?? null;
  }
  // KD special: indicator1='KD', indicator2='KD' means K crossing D
  if (indicatorName === 'KD') {
    // 回傳 K 值或 D 值？這裡比較的是 K 和 D 的關係
    // 讓 caller 自行處理
    return null;
  }
  return getIndicatorValueAt(indicatorCache, indicatorName, index);
}

// ===== 績效計算 =====

function computeReport(kbar, trades, equity, initialCapital, startDate, endDate) {
  const finalValue = equity[equity.length - 1].value;
  const totalReturn = (finalValue - initialCapital) / initialCapital * 100;
  
  // 年化報酬率
  const days = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
  const years = days / 365;
  const annualizedReturn = years > 0 ? (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100 : 0;
  
  // 最大回撤 (MDD)
  let peak = initialCapital;
  let maxDrawdown = 0;
  let drawdownStart = equity[0].date;
  let drawdownEnd = equity[0].date;
  let currentDrawdownStart = equity[0].date;
  
  for (const e of equity) {
    if (e.value > peak) {
      peak = e.value;
      currentDrawdownStart = e.date;
    }
    const dd = (peak - e.value) / peak * 100;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      drawdownStart = currentDrawdownStart;
      drawdownEnd = e.date;
    }
  }
  
  // 勝率
  const closedTrades = trades.filter(t => t.type === 'sell' || t.type === 'close');
  const winningTrades = closedTrades.filter(t => t.profit > 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length * 100) : 0;
  
  // 盈虧比
  const totalProfit = closedTrades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0);
  const totalLoss = closedTrades.filter(t => t.profit < 0).reduce((s, t) => s + Math.abs(t.profit), 0);
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
  
  // 夏普比率 (Sharpe Ratio)
  let sharpeRatio = 0;
  if (equity.length > 1) {
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i].value - equity[i-1].value) / equity[i-1].value);
    }
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const riskFreeRate = 0.02 / 252; // 2% 年化無風險利率換算為日
    sharpeRatio = stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev * Math.sqrt(252) : 0;
  }
  
  // 平均持有天數
  let totalHoldDays = 0;
  let holdCount = 0;
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].type === 'buy' && i + 1 < trades.length) {
      const buyDate = new Date(trades[i].date);
      const sellDate = new Date(trades[i + 1].date);
      const holdDays = Math.round((sellDate - buyDate) / (1000 * 60 * 60 * 24));
      totalHoldDays += holdDays;
      holdCount++;
      i++; // skip the sell we just used
    }
  }
  const avgHoldDays = holdCount > 0 ? Math.round(totalHoldDays / holdCount) : 0;
  
  // 最大連續虧損
  let maxConsecutiveLosses = 0;
  let currentLosses = 0;
  for (const t of closedTrades) {
    if (t.profit < 0) {
      currentLosses++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
    } else {
      currentLosses = 0;
    }
  }
  
  return {
    totalReturn: Math.round(totalReturn * 100) / 100,
    annualizedReturn: Math.round(annualizedReturn * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    drawdownPeriod: { start: drawdownStart, end: drawdownEnd },
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    totalTrades: closedTrades.length,
    avgHoldDays,
    maxConsecutiveLosses,
    totalBuySellCycles: holdCount,
  };
}

// ===== 指標統計 =====

function computeIndicatorStats(indicatorCache, prices) {
  const stats = {};
  
  for (const [name, data] of Object.entries(indicatorCache)) {
    if (!data) continue;
    
    // Extract values
    let values = [];
    if (name === 'MACD') {
      values = data.histogram.filter(v => v.value !== null).map(v => v.value);
    } else if (name === 'KD') {
      values = data.k.filter(v => v.value !== null).map(v => v.value);
    } else if (name === 'Bollinger') {
      stats['Bollinger_Upper'] = calcStats(data.upper.filter(v => v.value !== null).map(v => v.value));
      stats['Bollinger_Middle'] = calcStats(data.middle.filter(v => v.value !== null).map(v => v.value));
      stats['Bollinger_Lower'] = calcStats(data.lower.filter(v => v.value !== null).map(v => v.value));
      continue;
    } else if (Array.isArray(data)) {
      values = data.filter(v => v.value !== null).map(v => v.value);
    }
    
    if (values.length > 0) {
      stats[name] = calcStats(values);
    }
  }
  
  // 收盤價統計
  if (prices.length > 0) {
    stats['Close_Price'] = calcStats(prices);
  }
  
  return stats;
}

function calcStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const mean = sum / values.length;
  
  // 中位數
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  
  // 標準差
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    min: Math.round(Math.min(...values) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    current: Math.round(values[values.length - 1] * 100) / 100,
    count: values.length,
  };
}

// ===== 匯出 =====
module.exports = {
  runBacktest,
  computeReport,
  computeIndicatorStats,
  computeIndicators,
};