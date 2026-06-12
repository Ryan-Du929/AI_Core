// db.js — SQLite 資料庫（sql.js 引擎 + 檔案持久化）
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'trading.db');
const DB_BACKUP_DIR = path.join(__dirname, 'db_backups');

let db = null;
let SQL = null;
let writeQueue = [];
let flushTimer = null;
let backupTimer = null;

// ====== Schema ======
const SCHEMA = `
-- 交易日記
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('long','short')),
  action TEXT NOT NULL CHECK(action IN ('entry','exit','add')),
  price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  pnl REAL DEFAULT 0,
  tags TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 股價歷史（日K）
CREATE TABLE IF NOT EXISTS stock_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 持倉（投資組合）
CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '預設',
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('long','short')),
  entry_price REAL NOT NULL,
  qty INTEGER NOT NULL,
  entry_date TEXT NOT NULL DEFAULT (date('now')),
  note TEXT DEFAULT ''
);

-- 回測結果（未來使用）
CREATE TABLE IF NOT EXISTS backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  initial_capital REAL NOT NULL,
  final_capital REAL NOT NULL,
  total_return REAL NOT NULL,
  max_drawdown REAL DEFAULT 0,
  win_rate REAL DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_stock_prices_symbol ON stock_prices(symbol);
CREATE INDEX IF NOT EXISTS idx_stock_prices_date ON stock_prices(date);
`;

// ====== Initialization ======
async function init() {
  SQL = await initSqlJs();
  
  // Create backup dir
  if (!fs.existsSync(DB_BACKUP_DIR)) {
    fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
  }

  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log(`[DB] Loaded existing database: ${DB_PATH} (${(buffer.length/1024).toFixed(1)} KB)`);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database');
  }

  // Run schema
  db.run(SCHEMA);
  console.log('[DB] Schema initialized');

  // Schedule periodic flush (every 5 seconds if dirty)
  flushTimer = setInterval(flush, 5000);

  // Schedule daily backup at 16:00 UTC (midnight TW)
  scheduleBackup();
}

// ====== Query Helpers ======
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    markDirty();
  } catch (err) {
    console.error('[DB] Run error:', err.message);
    throw err;
  }
}

function get(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

// ====== Persistence ======
let dirty = false;

function markDirty() {
  dirty = true;
}

function flush() {
  if (!dirty || !db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    dirty = false;
  } catch (err) {
    console.error('[DB] Flush error:', err.message);
  }
}

function forceFlush() {
  flush();
}

function scheduleBackup() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(16, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;
  console.log(`[DB] Next backup scheduled at ${next.toISOString()}`);
  setTimeout(() => {
    doBackup();
    scheduleBackup(); // Reschedule
  }, delay);
}

function doBackup() {
  forceFlush();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupPath = path.join(DB_BACKUP_DIR, `trading_${dateStr}.db`);
  try {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[DB] Backup saved: ${backupPath}`);
  } catch (err) {
    console.error('[DB] Backup error:', err.message);
  }
}

// ====== Trades CRUD ======
function addTrade(trade) {
  const { id, date, symbol, direction, action, price, qty = 1, reason = '', note = '', pnl = 0, tags = '' } = trade;
  run(
    `INSERT INTO trades (id, date, symbol, direction, action, price, qty, reason, note, pnl, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, date, symbol, direction, action, price, qty, reason, note, pnl, tags]
  );
  return { id };
}

function getTrades(filters = {}) {
  let sql = 'SELECT * FROM trades WHERE 1=1';
  const params = [];
  if (filters.symbol) { sql += ' AND symbol = ?'; params.push(filters.symbol); }
  if (filters.direction && filters.direction !== 'all') { sql += ' AND direction = ?'; params.push(filters.direction); }
  if (filters.action && filters.action !== 'all') { sql += ' AND action = ?'; params.push(filters.action); }
  if (filters.startDate) { sql += ' AND date >= ?'; params.push(filters.startDate); }
  if (filters.endDate) { sql += ' AND date <= ?'; params.push(filters.endDate); }
  sql += ' ORDER BY date DESC';
  if (filters.limit) sql += ` LIMIT ${parseInt(filters.limit)}`;
  return query(sql, params);
}

function deleteTrade(id) {
  run('DELETE FROM trades WHERE id = ?', [id]);
  return { deleted: true };
}

function getTradeStats() {
  const total = get('SELECT COUNT(*) as count FROM trades');
  const entries = get("SELECT COUNT(*) as count FROM trades WHERE action='entry'");
  const closed = get('SELECT COUNT(*) as count FROM trades WHERE pnl != 0');
  const wins = get('SELECT COUNT(*) as count FROM trades WHERE pnl > 0');
  const losses = get('SELECT COUNT(*) as count FROM trades WHERE pnl < 0');
  const totalPnl = get('SELECT COALESCE(SUM(pnl), 0) as total FROM trades');
  const avgWin = get("SELECT COALESCE(AVG(pnl), 0) as avg FROM trades WHERE pnl > 0");
  const avgLoss = get("SELECT COALESCE(AVG(pnl), 0) as avg FROM trades WHERE pnl < 0");
  
  const winRate = closed.count > 0 ? ((wins.count / closed.count) * 100).toFixed(1) : '—';
  const profitFactor = avgLoss.avg !== 0 ? Math.abs(avgWin.avg / avgLoss.avg).toFixed(2) : '—';

  // Trades per symbol
  const bySymbol = query("SELECT symbol, COUNT(*) as count FROM trades WHERE action='entry' GROUP BY symbol ORDER BY count DESC");

  // Cumulative PnL
  const cumPnl = query('SELECT date, pnl FROM trades WHERE pnl != 0 ORDER BY date ASC');

  return {
    totalTrades: total.count,
    entries: entries.count,
    closedTrades: closed.count,
    wins: wins.count,
    losses: losses.count,
    winRate,
    totalPnl: totalPnl.total,
    avgWin: avgWin.avg,
    avgLoss: avgLoss.avg,
    profitFactor,
    bySymbol,
    cumulativePnl: cumPnl
  };
}

// ====== Stock Prices ======
function upsertStockPrice(row) {
  const existing = get('SELECT id FROM stock_prices WHERE symbol = ? AND date = ?', [row.symbol, row.date]);
  if (existing) {
    run(
      `UPDATE stock_prices SET open=?, high=?, low=?, close=?, volume=? WHERE symbol=? AND date=?`,
      [row.open, row.high, row.low, row.close, row.volume || 0, row.symbol, row.date]
    );
  } else {
    run(
      `INSERT INTO stock_prices (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.symbol, row.date, row.open, row.high, row.low, row.close, row.volume || 0]
    );
  }
}

function getStockPrices(symbol, startDate, endDate, limit = 500) {
  let sql = 'SELECT * FROM stock_prices WHERE symbol = ?';
  const params = [symbol];
  if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
  sql += ' ORDER BY date ASC';
  sql += ` LIMIT ${parseInt(limit)}`;
  return query(sql, params);
}

// ====== Portfolios ======
function addPosition(pos) {
  const { name = '預設', symbol, direction, entry_price, qty, entry_date, note = '' } = pos;
  run(
    `INSERT INTO portfolios (name, symbol, direction, entry_price, qty, entry_date, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, symbol, direction, entry_price, qty, entry_date || new Date().toISOString().slice(0, 10), note]
  );
  return { success: true };
}

function getPositions() {
  return query('SELECT * FROM portfolios ORDER BY entry_date DESC');
}

function deletePosition(id) {
  run('DELETE FROM portfolios WHERE id = ?', [id]);
  return { deleted: true };
}

// ====== Cleanup ======
function close() {
  if (flushTimer) clearInterval(flushTimer);
  if (backupTimer) clearTimeout(backupTimer);
  forceFlush();
  if (db) db.close();
}

module.exports = {
  init, close, forceFlush,
  query, run, get,
  addTrade, getTrades, deleteTrade, getTradeStats,
  upsertStockPrice, getStockPrices,
  addPosition, getPositions, deletePosition
};