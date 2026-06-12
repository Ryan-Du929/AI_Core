#!/usr/bin/env node
/**
 * fetch_historical_data.js — 從 TWSE 公開 API 抓取歷史 KBar
 * ==========================================================
 * 抓取指定股票過去 N 年的日 K 線，寫入 shared/data/stock_history/kbars/{code}.json
 *
 * Usage:
 *   node scripts/fetch_historical_data.js 2330          # 單支
 *   node scripts/fetch_historical_data.js --all          # 全部 watchlist
 *   node scripts/fetch_historical_data.js --watchlist    # 預設清單
 *
 * 資料來源：TWSE 公開 API
 *   - 上市: https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=2330
 *   - 上櫃: https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?d=YYYYMM&stkno=2330
 *
 * 為了簡化，先以上市股票為主。
 */

"use strict";

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ===== 設定 =====
const OUTPUT_DIR = path.resolve(__dirname, '..', 'shared', 'data', 'stock_history', 'kbars');
const WATCHLIST = ['2330', '2317', '2454', '2303', '2382', '3711', '3008', '3231', '2376'];
const YEARS_BACK = 3;
const REQUEST_DELAY_MS = 300; // 避免被 ban

// 台灣日期：民國年轉西元年
function twDateToISO(twDateStr) {
  // TWSE format: "113/01/02" (民國113=2024)
  const parts = twDateStr.split('/');
  if (parts.length === 3) {
    const year = parseInt(parts[0]) + 1911;
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return twDateStr;
}

// HTTP GET (支援 https 與 http)
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

// 抓取單一月份資料
async function fetchMonthData(code, year, month) {
  const dateStr = `${year}${String(month).padStart(2, '0')}01`;
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${code}`;
  
  try {
    const data = await httpGet(url);
    if (data && data.stat === 'OK' && data.data) {
      const records = data.data.map(item => ({
        date: twDateToISO(item[0]),
        shares: parseInt(item[1]?.replace(/,/g, '') || '0'),  // 成交股數
        turnover: parseInt(item[2]?.replace(/,/g, '') || '0'), // 成交金額
        open: parseFloat(item[3]?.replace(/,/g, '') || '0'),
        high: parseFloat(item[4]?.replace(/,/g, '') || '0'),
        low: parseFloat(item[5]?.replace(/,/g, '') || '0'),
        close: parseFloat(item[6]?.replace(/,/g, '') || '0'),
        change: parseFloat(item[7]?.replace(/,/g, '') || '0'),
        volume: parseInt(item[8]?.replace(/,/g, '') || '0'),   // 成交筆數
      }));
      return records;
    }
    return [];
  } catch (e) {
    console.error(`  ❌ ${code} ${year}/${month}: ${e.message}`);
    return [];
  }
}

// 抓取單支股票完整歷史
async function fetchStockHistory(code, years = YEARS_BACK) {
  const now = new Date();
  const startYear = now.getFullYear() - years;
  
  console.log(`\n📈 抓取 ${code} 歷史資料 (${startYear}~${now.getFullYear()})...`);
  
  const allRecords = [];
  
  for (let year = startYear; year <= now.getFullYear(); year++) {
    const startMonth = (year === startYear) ? 1 : 1;
    const endMonth = (year === now.getFullYear()) ? now.getMonth() + 1 : 12;
    
    for (let month = startMonth; month <= endMonth; month++) {
      process.stdout.write(`  📅 ${year}/${String(month).padStart(2, '0')}...`);
      const records = await fetchMonthData(code, year, month);
      console.log(` ${records.length} 筆`);
      allRecords.push(...records);
      
      // 避免過度請求
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
  }
  
  // 按日期排序（由舊到新）
  allRecords.sort((a, b) => a.date.localeCompare(b.date));
  
  console.log(`  ✅ ${code}: 共 ${allRecords.length} 筆交易日資料`);
  
  // 寫入檔案
  const filePath = path.join(OUTPUT_DIR, `${code}.json`);
  const payload = {
    code,
    updatedAt: new Date().toISOString(),
    count: allRecords.length,
    from: allRecords[0]?.date,
    to: allRecords[allRecords.length - 1]?.date,
    data: allRecords,
  };
  
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  
  return allRecords;
}

// 主程式
async function main() {
  const args = process.argv.slice(2);
  let stocks = [];
  
  if (args.includes('--all') || args.includes('--watchlist')) {
    stocks = WATCHLIST;
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    stocks = args.filter(a => !a.startsWith('--'));
  } else {
    stocks = WATCHLIST;
    console.log('ℹ️  未指定股票代碼，使用預設 watchlist');
  }
  
  console.log(`📊 開始抓取 ${stocks.length} 支股票的歷史日 K 線`);
  console.log(`📁 輸出目錄: ${OUTPUT_DIR}`);
  
  for (const code of stocks) {
    try {
      await fetchStockHistory(code);
    } catch (e) {
      console.error(`❌ ${code} 失敗: ${e.message}`);
    }
  }
  
  console.log('\n✅ 全部完成');
}

main().catch(console.error);