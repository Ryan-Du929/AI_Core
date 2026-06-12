#!/usr/bin/env node
/**
 * generate_stock_data.js — 產生模擬台股歷史日 K 線資料
 * ====================================================
 * 生成 3 年（約 750 個交易日）的 daily kbar，包含 open/high/low/close/volume。
 * 寫入 shared/data/stock_history/ 下每個股票一個 JSON 檔。
 *
 * Usage: node scripts/generate_stock_data.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'shared', 'data', 'stock_history');

// 股票清單：code -> { name, basePrice, volatility }
const STOCKS = {
  '2330': { name: '台積電', base: 500, vol: 0.25, trend: 0.0003 },
  '2317': { name: '鴻海', base: 150, vol: 0.20, trend: 0.0002 },
  '2454': { name: '聯發科', base: 800, vol: 0.28, trend: 0.0003 },
  '2303': { name: '聯電', base: 50, vol: 0.22, trend: 0.0001 },
  '2382': { name: '廣達', base: 250, vol: 0.30, trend: 0.0004 },
  '3711': { name: '日月光', base: 120, vol: 0.20, trend: 0.0002 },
  '3008': { name: '大立光', base: 2000, vol: 0.22, trend: 0.0001 },
  '3231': { name: '緯創', base: 100, vol: 0.28, trend: 0.0002 },
  '2376': { name: '技嘉', base: 250, vol: 0.30, trend: 0.0003 },
};

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function fmtDate(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function generateKbars(code, info, tradingDays = 750) {
  const { base, vol, trend } = info;
  const rand = seededRandom(code.split('').reduce((a,c) => a + c.charCodeAt(0), 42));
  const prices = [];
  
  // Start from 3 years ago
  const startYear = 2023;
  const startMonth = 6;  // June 2023
  let y = startYear, m = startMonth, d = 1;
  let currentPrice = base;
  const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
  
  let count = 0;
  while (count < tradingDays) {
    // Advance to next weekday
    const date = new Date(y, m, d);
    const dayOfWeek = date.getDay();
    
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Weekend, skip trading day
      d++;
      if (d > daysInMonth[m]) {
        d = 1;
        m++;
        if (m > 11) { m = 0; y++; }
      }
      continue;
    }
    
    // Skip some holidays roughly (Jan 1, Feb around CNY, Oct 10)
    const isNewYear = (m === 0 && d === 1);
    const isCNY = (m === 1 && d >= 8 && d <= 12);
    const isNationalDay = (m === 9 && d === 10);
    if (isNewYear || isCNY || isNationalDay) {
      d++;
      if (d > daysInMonth[m]) {
        d = 1; m++;
        if (m > 11) { m = 0; y++; }
      }
      continue;
    }
    
    // Generate price movement
    const drift = trend + (rand() - 0.5) * 0.02;
    const shock = (rand() - 0.5) * vol * 0.04;
    const change = currentPrice * (drift + shock);
    const open = Math.round(currentPrice * 100) / 100;
    
    // Intraday movement
    const range = open * vol * 0.03 * rand();
    const direction = rand() > 0.5 ? 1 : -1;
    const close = Math.round((open + change + (rand() - 0.5) * range * 0.5) * 100) / 100;
    const high = Math.round(Math.max(open, close) + range * rand() * 100) / 100;
    const low = Math.round(Math.min(open, close) - range * rand() * 100) / 100;
    
    const volume = Math.round(base * 1000000 * (0.5 + rand()) * (0.5 + rand()));
    
    prices.push({
      date: fmtDate(y, m, d),
      open: Math.max(open, 1),
      high: Math.max(high, open, close, 1),
      low: Math.max(Math.min(low, open, close), 1),
      close: Math.max(close, 1),
      volume: Math.max(volume, 1000),
    });
    
    currentPrice = close;
    count++;
    
    d++;
    if (d > daysInMonth[m]) {
      d = 1;
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }
  
  return prices;
}

// Main
function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  for (const [code, info] of Object.entries(STOCKS)) {
    console.log(`Generating ${code} ${info.name}...`);
    const kbars = generateKbars(code, info);
    const filePath = path.join(OUTPUT_DIR, `${code}.json`);
    const payload = {
      code,
      name: info.name,
      generated: new Date().toISOString(),
      tradingDays: kbars.length,
      data: kbars,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`  → ${filePath} (${kbars.length} days)`);
  }
  console.log('\n✅ 所有股票資料已產生');
}

main();