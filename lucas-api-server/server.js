// server.js — Lucas API Server v1.0（交易日記 + 行情 + 回測預留）
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const market = require('./services/market');

const PORT = process.env.PORT || 3080;
const app = express();

// ====== Middleware ======
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ====== Static Files ======
app.use(express.static(path.join(__dirname, '..', 'trading-diary')));

// ====== API Routes ======

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), source: 'lucas-api-server' });
});

// ----- Trades -----
app.get('/api/trades', (req, res) => {
  try {
    const trades = db.getTrades(req.query);
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trades', (req, res) => {
  try {
    const trade = req.body;
    if (!trade.id) trade.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!trade.date) trade.date = new Date().toISOString();
    if (!trade.symbol || !trade.direction || !trade.action || !trade.price) {
      return res.status(400).json({ error: 'Missing required fields: symbol, direction, action, price' });
    }
    const result = db.addTrade(trade);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trades/:id', (req, res) => {
  try {
    const result = db.deleteTrade(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trades/stats', (req, res) => {
  try {
    const stats = db.getTradeStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Stock Prices -----
app.get('/api/stocks/:symbol', (req, res) => {
  try {
    let symbol = req.params.symbol;
    // 標準化 symbol: 去掉 .TW 後綴
    symbol = symbol.replace(/\.TW$/i, '');
    const { startDate, endDate, limit } = req.query;
    const prices = db.getStockPrices(symbol, startDate, endDate, limit);
    res.json({ symbol, prices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Market Data (live) -----
app.get('/api/market/quote/:symbol', async (req, res) => {
  try {
    const result = await market.getQuote(req.params.symbol);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/market/history/:symbol', async (req, res) => {
  try {
    const { range, interval } = req.query;
    const result = await market.getHistory(req.params.symbol, range || '1y', interval || '1d');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/market/fetch', async (req, res) => {
  try {
    const { symbol, range } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const result = await market.fetchAndStoreHistory(symbol, range || '1y');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Portfolios -----
app.get('/api/portfolios', (req, res) => {
  try {
    const positions = db.getPositions();
    res.json({ positions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/portfolios', (req, res) => {
  try {
    const pos = req.body;
    if (!pos.symbol || !pos.direction || !pos.entry_price || !pos.qty) {
      return res.status(400).json({ error: 'Missing required fields: symbol, direction, entry_price, qty' });
    }
    const result = db.addPosition(pos);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/portfolios/:id', (req, res) => {
  try {
    const result = db.deletePosition(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Config -----
app.post('/api/config/market-source', (req, res) => {
  const { source } = req.body;
  const result = market.setSource(source);
  res.json(result);
});

// ====== Start ======
async function start() {
  // Initialize database
  await db.init();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Lucas API Server running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Trading Diary: http://localhost:${PORT}/`);
    console.log(`⚕️  Health: http://localhost:${PORT}/api/health`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

start().catch(err => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});