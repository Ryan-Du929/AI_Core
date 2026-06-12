// market.js — 行情資料來源抽象層
// 預設用 Yahoo Finance，預留 Shioaji 接口
const https = require('https');
const http = require('http');
const db = require('../db');

// ====== Configuration ======
const CONFIG = {
  source: 'yahoo', // 'yahoo' | 'shioaji'
  shioajiHost: 'localhost',
  shioajiPort: 8080,
};

// ====== Yahoo Finance ======
async function yahooFetchStockPrice(symbol) {
  // symbol e.g. "2330.TW"
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const r = j.chart.result[0];
          const q = r.indicators.quote[0];
          const ts = r.timestamp;
          const latestIdx = ts.length - 1;
          resolve({
            symbol: symbol.replace('.TW', '').replace('.tw', ''),
            date: new Date(ts[latestIdx] * 1000).toISOString().slice(0, 10),
            open: q.open[latestIdx],
            high: q.high[latestIdx],
            low: q.low[latestIdx],
            close: q.close[latestIdx],
            volume: q.volume[latestIdx] || 0,
            name: r.meta.symbol,
          });
        } catch (e) {
          reject(new Error('Yahoo parse error: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

async function yahooFetchHistory(symbol, range = '1y', interval = '1d') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const r = j.chart.result[0];
          const q = r.indicators.quote[0];
          const cleanSymbol = symbol.replace('.TW', '').replace('.tw', '');
          const rows = r.timestamp.map((t, i) => ({
            symbol: cleanSymbol,
            date: new Date(t * 1000).toISOString().slice(0, 10),
            open: q.open[i],
            high: q.high[i],
            low: q.low[i],
            close: q.close[i],
            volume: q.volume[i] || 0,
          })).filter(row => row.open != null);
          resolve({ symbol: cleanSymbol, data: rows });
        } catch (e) {
          reject(new Error('Yahoo history parse error: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

// ====== Shioaji Local Server ======
function shioajiRequest(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: CONFIG.shioajiHost,
      port: CONFIG.shioajiPort,
      path: path,
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Shioaji parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// ====== Unified API ======
async function getQuote(symbol) {
  if (CONFIG.source === 'shioaji') {
    const result = await shioajiRequest(`/api/v1/market/snapshots/${symbol}`);
    return result;
  }
  // Yahoo Finance — 台股 symbol 要加 .TW
  const twSymbol = symbol.includes('.') ? symbol : `${symbol}.TW`;
  return await yahooFetchStockPrice(twSymbol);
}

async function getHistory(symbol, range = '1y', interval = '1d') {
  if (CONFIG.source === 'shioaji') {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    return await shioajiRequest(`/api/v1/market/kbars/${symbol}?start_date=${startDate}&end_date=${endDate}`);
  }
  const twSymbol = symbol.includes('.') ? symbol : `${symbol}.TW`;
  return await yahooFetchHistory(twSymbol, range, interval);
}

async function fetchAndStoreHistory(symbol, range = '1y') {
  try {
    const result = await getHistory(symbol, range);
    if (result.data) {
      let count = 0;
      for (const row of result.data) {
        db.upsertStockPrice(row);
        count++;
      }
      console.log(`[Market] Stored ${count} bars for ${symbol}`);
      return { symbol, stored: count };
    }
    return { error: 'No data returned' };
  } catch (err) {
    return { error: err.message };
  }
}

function setSource(source) {
  if (source === 'yahoo' || source === 'shioaji') {
    CONFIG.source = source;
    return { source };
  }
  return { error: 'Invalid source. Use "yahoo" or "shioaji"' };
}

module.exports = { getQuote, getHistory, fetchAndStoreHistory, setSource, yahooFetchStockPrice, yahooFetchHistory };