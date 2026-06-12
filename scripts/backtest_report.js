#!/usr/bin/env node
/**
 * backtest_report.js — 回測績效報告產生器
 * ==========================================
 * 將 backtest_engine.js 的回測結果轉換為易讀的文字報告 + JSON 輸出
 *
 * Usage:
 *   const report = require('./backtest_report.js');
 *   const text = report.generateTextReport(backtestResult);
 *   const html = report.generateHtmlReport(backtestResult);
 */

"use strict";

/**
 * 產生純文字報告
 * @param {object} result - backtest_engine.runBacktest() 的回傳結果
 * @returns {string} 文字報告
 */
function generateTextReport(result) {
  const lines = [];
  const sep = '='.repeat(60);
  const sep2 = '-'.repeat(60);

  lines.push(sep);
  lines.push('  📊 策略回測報告');
  lines.push(sep);
  
  // === 基本資訊 ===
  lines.push('');
  lines.push('📋 基本資訊');
  lines.push(sep2);
  lines.push(`  策略名稱:    ${result.strategy}`);
  lines.push(`  策略描述:    ${result.description}`);
  lines.push(`  股票:        ${result.code}`);
  lines.push(`  回測期間:    ${result.period.start} ~ ${result.period.end}`);
  lines.push(`  初始資金:    ${formatMoney(result.initialCapital)}`);
  
  // === 績效指標 ===
  lines.push('');
  lines.push('📈 績效指標');
  lines.push(sep2);
  lines.push(`  最終資金:          ${formatMoney(result.finalCapital)}`);
  lines.push(`  總報酬率:          ${formatPct(result.totalReturn)}`);
  lines.push(`  年化報酬率:        ${formatPct(result.annualizedReturn)}`);
  lines.push(`  最大回撤 (MDD):    ${formatPct(result.maxDrawdown)}`);
  lines.push(`  夏普比率:          ${result.sharpeRatio}`);
  lines.push(`  勝率:              ${formatPct(result.winRate)}`);
  lines.push(`  盈虧比:            ${result.profitFactor === Infinity ? '∞' : result.profitFactor}`);
  lines.push(`  總交易次數:        ${result.totalTrades}`);
  lines.push(`  買賣循環次數:      ${result.totalBuySellCycles}`);
  lines.push(`  平均持有天數:      ${result.avgHoldDays} 天`);
  lines.push(`  最大連續虧損:      ${result.maxConsecutiveLosses} 次`);

  // === 策略條件 ===
  lines.push('');
  lines.push('🔍 策略條件');
  lines.push(sep2);
  if (result.conditions && result.conditions.length > 0) {
    for (const cond of result.conditions) {
      lines.push(`  - 類型: ${cond.type}`);
      if (cond.indicator1) lines.push(`    Indicator 1: ${cond.indicator1}`);
      if (cond.indicator2) lines.push(`    Indicator 2: ${cond.indicator2}`);
      if (cond.value !== undefined) lines.push(`    閥值: ${cond.value}`);
      lines.push(`    動作: ${cond.action}`);
      lines.push('');
    }
  } else {
    lines.push('  (無條件資訊)');
  }

  // === 指標統計 ===
  lines.push('📉 參考指標統計');
  lines.push(sep2);
  if (result.indicatorStats) {
    for (const [name, stats] of Object.entries(result.indicatorStats)) {
      lines.push(`  ${name}:`);
      lines.push(`    最新: ${stats.current} | 平均: ${stats.mean}`);
      lines.push(`    範圍: ${stats.min} ~ ${stats.max}`);
      lines.push(`    標準差: ${stats.stdDev}`);
      lines.push('');
    }
  }

  // === 交易明細 ===
  lines.push('📝 交易明細');
  lines.push(sep2);
  if (result.trades && result.trades.length > 0) {
    for (let i = 0; i < result.trades.length; i++) {
      const t = result.trades[i];
      if (t.type === 'buy') {
        lines.push(`  [${i+1}] ${t.date} 買入`);
        lines.push(`      價格: ${formatMoney(t.price)} | 張數: ${t.shares / 1000}`);
        lines.push(`      成本: ${formatMoney(t.cost)} | 餘額: ${formatMoney(t.cash_after)}`);
        lines.push(`      原因: ${t.reason}`);
      } else {
        const emoji = t.profit > 0 ? '✅' : '❌';
        lines.push(`  [${i+1}] ${t.date} ${t.type === 'close' ? '強制平倉' : '賣出'} ${emoji}`);
        lines.push(`      價格: ${formatMoney(t.price)} | 張數: ${t.shares / 1000}`);
        lines.push(`      收入: ${formatMoney(t.revenue)}`);
        if (t.profit !== undefined) {
          lines.push(`      損益: ${formatMoney(t.profit)} (${formatPct(t.profit_pct)})`);
        }
        lines.push(`      餘額: ${formatMoney(t.cash_after)}`);
        lines.push(`      原因: ${t.reason}`);
      }
      lines.push('');
    }
  } else {
    lines.push('  (無交易紀錄 — 策略可能未觸發任何訊號)');
  }

  lines.push(sep);
  return lines.join('\n');
}

/**
 * 產生 HTML 報告
 * @param {object} result - 回測結果
 * @returns {string} HTML 字串
 */
function generateHtmlReport(result) {
  // 簡單的 HTML 報告，可嵌入 Dashboard
  let tradeRows = '';
  if (result.trades) {
    for (const t of result.trades) {
      const cls = t.profit > 0 ? 'win' : t.profit < 0 ? 'loss' : 'neutral';
      tradeRows += `<tr class="${cls}">
        <td>${t.date}</td>
        <td>${t.type === 'buy' ? '買入' : t.type === 'close' ? '平倉' : '賣出'}</td>
        <td>${formatMoney(t.price)}</td>
        <td>${t.shares ? (t.shares/1000) : '-'}</td>
        <td>${t.profit !== undefined ? formatMoney(t.profit) : '-'}</td>
        <td>${t.profit_pct !== undefined ? formatPct(t.profit_pct) : '-'}</td>
        <td><small>${t.reason || ''}</small></td>
      </tr>`;
    }
  }

  let indicatorRows = '';
  if (result.indicatorStats) {
    for (const [name, stats] of Object.entries(result.indicatorStats)) {
      indicatorRows += `<tr>
        <td>${name}</td>
        <td>${stats.current}</td>
        <td>${stats.mean}</td>
        <td>${stats.min}</td>
        <td>${stats.max}</td>
        <td>${stats.stdDev}</td>
      </tr>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><title>回測報告 - ${result.code} ${result.strategy}</title>
<style>
body{font-family:sans-serif;max-width:960px;margin:20px auto;padding:20px;background:#f5f5f5;color:#333}
h1{color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:10px}
h2{color:#16213e;margin-top:30px}
.card{background:#fff;border-radius:8px;padding:20px;margin:15px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:15px}
.item{background:#f8f9fa;padding:12px;border-radius:6px;text-align:center}
.item .label{font-size:12px;color:#666}
.item .value{font-size:20px;font-weight:bold;color:#1a1a2e}
.item .value.green{color:#27ae60}
.item .value.red{color:#e74c3c}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
th{background:#1a1a2e;color:#fff;padding:10px 8px;text-align:left}
td{padding:8px;border-bottom:1px solid #eee}
tr.win{background:#e8f8e8}
tr.loss{background:#fde8e8}
tr.neutral{background:#f0f0f0}
small{color:#888}
</style>
</head><body>
<h1>📊 回測報告: ${result.code}</h1>
<div class="card">
  <p><strong>策略:</strong> ${result.strategy}</p>
  <p><strong>期間:</strong> ${result.period.start} ~ ${result.period.end}</p>
  <p><strong>初始資金:</strong> ${formatMoney(result.initialCapital)}</p>
</div>

<h2>📈 績效指標</h2>
<div class="card">
<div class="grid">
  <div class="item"><div class="label">最終資金</div><div class="value">${formatMoney(result.finalCapital)}</div></div>
  <div class="item"><div class="label ${result.totalReturn >= 0 ? 'green' : 'red'}">總報酬率</div><div class="value ${result.totalReturn >= 0 ? 'green' : 'red'}">${formatPct(result.totalReturn)}</div></div>
  <div class="item"><div class="label">年化報酬率</div><div class="value">${formatPct(result.annualizedReturn)}</div></div>
  <div class="item"><div class="label ${result.maxDrawdown > 20 ? 'red' : ''}">最大回撤</div><div class="value ${result.maxDrawdown > 20 ? 'red' : ''}">${formatPct(result.maxDrawdown)}</div></div>
  <div class="item"><div class="label">夏普比率</div><div class="value">${result.sharpeRatio}</div></div>
  <div class="item"><div class="label">勝率</div><div class="value">${formatPct(result.winRate)}</div></div>
  <div class="item"><div class="label">盈虧比</div><div class="value">${result.profitFactor === Infinity ? '∞' : result.profitFactor}</div></div>
  <div class="item"><div class="label">交易次數</div><div class="value">${result.totalTrades}</div></div>
</div>
</div>

<h2>📉 參考指標統計</h2>
<div class="card">
<table>
<tr><th>指標</th><th>最新</th><th>平均</th><th>最小</th><th>最大</th><th>標準差</th></tr>
${indicatorRows || '<tr><td colspan="6">無資料</td></tr>'}
</table>
</div>

<h2>📝 交易明細</h2>
<div class="card">
<table>
<tr><th>日期</th><th>動作</th><th>價格</th><th>張數</th><th>損益</th><th>報酬率</th><th>原因</th></tr>
${tradeRows || '<tr><td colspan="7">無交易紀錄</td></tr>'}
</table>
</div>
</body></html>`;
}

// ===== 輔助函數 =====

function formatMoney(val) {
  if (val === undefined || val === null) return 'N/A';
  return '$' + Math.round(val).toLocaleString('en-US');
}

function formatPct(val) {
  if (val === undefined || val === null) return 'N/A';
  const sign = val >= 0 ? '+' : '';
  return sign + val.toFixed(2) + '%';
}

// ===== 匯出 =====
module.exports = {
  generateTextReport,
  generateHtmlReport,
};