// sinopac.js — 永豐 Shioaji API 行情橋接
// 透過 Python shioaji SDK 登入並抓取行情資料
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const PYTHON = '/usr/bin/python3';
const SCRIPTS_DIR = path.join(__dirname, 'services');

// ====== 執行 Python 腳本 ======
function runPython(scriptName, args = [], timeout = 30000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script not found: ${scriptPath}`));
    }
    
    const child = execFile(PYTHON, [scriptPath, ...args], {
      timeout,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed && err.signal === 'SIGTERM') {
          return reject(new Error(`Script timeout after ${timeout}ms: ${scriptName}`));
        }
        return reject(new Error(`Python error: ${stderr.slice(0, 500)}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Invalid JSON output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

// ====== 安裝 Python 相依 ======
let depsInstalled = false;

async function ensureDeps() {
  if (depsInstalled) return true;
  
  // Check if shioaji is available
  try {
    await runPython('check_deps.py', [], 10000);
    depsInstalled = true;
    console.log('[SinoPac] Dependencies OK');
    return true;
  } catch (err) {
    console.log('[SinoPac] Dependencies missing, attempting install...');
    return false;
  }
}

// ====== Public API ======
async function login() {
  try {
    const result = await runPython('login.py', [], 15000);
    console.log(`[SinoPac] Logged in: ${result.accounts ? result.accounts.length + ' accounts' : 'OK'}`);
    return result;
  } catch (err) {
    console.error('[SinoPac] Login failed:', err.message);
    return { error: err.message };
  }
}

async function getSnapshot(symbols) {
  // symbols: comma-separated, e.g. "2330,2317,2454"
  try {
    const result = await runPython('snapshot.py', [symbols], 15000);
    if (result.data) {
      // Save to DB
      for (const row of result.data) {
        db.upsertStockPrice({
          symbol: row.code,
          date: new Date().toISOString().slice(0, 10),
          open: row.open || 0,
          high: row.high || 0,
          low: row.low || 0,
          close: row.close || 0,
          volume: row.volume || 0
        });
      }
    }
    return result;
  } catch (err) {
    console.error('[SinoPac] Snapshot error:', err.message);
    return { error: err.message };
  }
}

async function getKBars(symbol, startDate, endDate) {
  // Get daily K-bars
  try {
    const result = await runPython('kbars.py', [symbol, startDate, endDate], 30000);
    if (result.data) {
      for (const row of result.data) {
        db.upsertStockPrice(row);
      }
    }
    return result;
  } catch (err) {
    console.error('[SinoPac] KBars error:', err.message);
    return { error: err.message };
  }
}

async function getUsage() {
  try {
    return await runPython('usage.py', [], 10000);
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { ensureDeps, login, getSnapshot, getKBars, getUsage };