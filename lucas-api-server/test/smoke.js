#!/usr/bin/env node
// test/smoke.js — 交易日記 API 冒煙測試
const http = require('http');

const BASE = 'http://localhost:3080';
const TESTS = [];
let passed = 0, failed = 0;

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3080, path, method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function run() {
  console.log('\n🧪 Lucas API Server — Smoke Test\n');

  // 1. Health
  await test('Health check', async () => {
    const r = await request('GET', '/api/health');
    if (r.status !== 200 || !r.body.status === 'ok') throw new Error('Health failed');
  });

  // 2. Add trade
  await test('Add trade', async () => {
    const r = await request('POST', '/api/trades', {
      symbol: 'TEST', direction: 'long', action: 'entry', price: 100, qty: 1, pnl: 0
    });
    if (r.status !== 200 || !r.body.id) throw new Error('No id returned');
  });

  // 3. List trades
  await test('List trades', async () => {
    const r = await request('GET', '/api/trades');
    if (r.status !== 200 || !Array.isArray(r.body.trades)) throw new Error('Not an array');
    if (r.body.trades.length < 1) throw new Error('No trades found');
  });

  // 4. Stats
  await test('Trade stats', async () => {
    const r = await request('GET', '/api/trades/stats');
    if (r.status !== 200 || typeof r.body.totalTrades !== 'number') throw new Error('Invalid stats');
  });

  // 5. Add trade with PnL
  await test('Add trade with PnL', async () => {
    const r = await request('POST', '/api/trades', {
      symbol: 'TEST', direction: 'long', action: 'exit', price: 110, qty: 1, pnl: 1000
    });
    if (r.status !== 200) throw new Error('Failed');
  });

  // 6. Verify stats updated
  await test('Stats updated', async () => {
    const r = await request('GET', '/api/trades/stats');
    if (r.body.totalPnl < 1000) throw new Error('PnL not updated: ' + r.body.totalPnl);
  });

  // 7. Yahoo quote
  await test('Yahoo quote (2330.TW)', async () => {
    const r = await request('GET', '/api/market/quote/2330.TW');
    if (r.status !== 200 || !r.body.close) throw new Error('No quote data: ' + JSON.stringify(r.body));
  });

  // 8. Yahoo history
  await test('Yahoo history (2330.TW 5d)', async () => {
    const r = await request('GET', '/api/market/history/2330.TW?range=5d&interval=1d');
    if (r.status !== 200 || !r.body.data || r.body.data.length === 0) throw new Error('No history data');
  });

  // 9. Fetch and store
  await test('Fetch & store (2330.TW 1mo)', async () => {
    const r = await request('POST', '/api/market/fetch', { symbol: '2330.TW', range: '1mo' });
    if (r.status !== 200 || r.body.stored < 5) throw new Error('Stored < 5 bars: ' + r.body.stored);
  });

  // 10. Query stored prices
  await test('Query stored prices (2330)', async () => {
    const r = await request('GET', '/api/stocks/2330?limit=3');
    if (r.status !== 200 || r.body.prices.length === 0) throw new Error('No stored prices');
  });

  // 11. Frontend serves
  await test('Frontend page', async () => {
    const r = await request('GET', '/');
    if (r.status !== 200 || !r.body.includes('<!DOCTYPE html')) throw new Error('Not serving HTML');
  });

  // 12. Portfolio
  await test('Add portfolio position', async () => {
    const r = await request('POST', '/api/portfolios', {
      symbol: '2330', direction: 'long', entry_price: 2200, qty: 2
    });
    if (r.status !== 200) throw new Error('Failed');
  });

  await test('List portfolios', async () => {
    const r = await request('GET', '/api/portfolios');
    if (r.status !== 200 || !r.body.positions || r.body.positions.length === 0) throw new Error('No positions');
  });

  // Summary
  console.log(`\n📊 結果: ${passed} ✅ / ${failed} ❌ / ${passed + failed} 總共`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});