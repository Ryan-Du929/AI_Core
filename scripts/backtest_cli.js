#!/usr/bin/env node
/**
 * backtest_cli.js — 策略回測 CLI 入口
 * ======================================
 * 從命令列接受參數，執行回測並輸出報告。
 *
 * Usage:
 *   node scripts/backtest_cli.js "2330" "2024-01-01" "2026-06-01" "當5日均線突破20日均線時買入，跌破時賣出"
 *   node scripts/backtest_cli.js "2330" "2024-01-01" "2026-06-01" "RSI低於30時買入，高於70時賣出" --json
 *   node scripts/backtest_cli.js "2330" "2024-01-01" "2026-06-01" "KD黃金交叉買入，死亡交叉賣出" --html
 *
 * 參數:
 *   <股票代碼> <開始日期> <結束日期> "<策略描述>"
 *
 * 選項:
 *   --json    輸出 JSON 格式
 *   --html    輸出 HTML 報告檔案
 *   --capital <金額>   初始資金 (預設 1000000)
 */

"use strict";

const path = require('path');
const fs = require('fs');

const strategyParser = require('./strategy_parser.js');
const backtestEngine = require('./backtest_engine.js');
const backtestReport = require('./backtest_report.js');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 4) {
    console.log(`
📊 策略回測工具

Usage:
  node scripts/backtest_cli.js <代碼> <開始> <結束> "<策略>" [選項]

範例:
  node scripts/backtest_cli.js "2330" "2024-01-01" "2026-06-01" "當5日均線突破20日均線時買入，跌破時賣出"
  node scripts/backtest_cli.js "2330" "2024-01-01" "2026-06-01" "RSI低於30時買入，高於70時賣出" --json

選項:
  --json        輸出 JSON 格式
  --html        輸出 HTML 報告檔案 (自動存為 backtest_report_{股票}.html)
  --capital N   初始資金 (預設 1,000,000)
  --help        顯示此說明
`);
    return;
  }

  const code = args[0];
  const startDate = args[1];
  const endDate = args[2];
  const strategyText = args[3];
  
  const flags = args.slice(4);
  const outputJson = flags.includes('--json');
  const outputHtml = flags.includes('--html');
  const capitalIdx = flags.indexOf('--capital');
  let initialCapital = 1000000;
  if (capitalIdx !== -1 && capitalIdx + 1 < flags.length) {
    initialCapital = parseInt(flags[capitalIdx + 1]) || 1000000;
  }

  if (flags.includes('--help')) {
    // Already printed usage above
    return;
  }

  console.log('📊 策略回測工具');
  console.log('='.repeat(50));
  console.log(`  股票:        ${code}`);
  console.log(`  期間:        ${startDate} ~ ${endDate}`);
  console.log(`  策略:        ${strategyText}`);
  console.log(`  資金:        $${initialCapital.toLocaleString()}`);
  console.log('='.repeat(50));
  console.log('');

  // === Step 1: 解析策略 ===
  console.log('🔍 解析策略...');
  let strategy;
  try {
    strategy = strategyParser.parse(strategyText);
    console.log(`  ✅ 策略名稱: ${strategy.name}`);
    console.log(`  📋 條件數: ${strategy.conditions.length}`);
    strategy.conditions.forEach((c, i) => {
      console.log(`    [${i+1}] ${c.type} | ${c.indicator1}${c.indicator2 ? ' vs ' + c.indicator2 : ''}${c.value !== undefined ? ' = ' + c.value : ''} → ${c.action}`);
    });
  } catch (e) {
    console.error(`  ❌ 策略解析失敗: ${e.message}`);
    process.exit(1);
  }
  console.log('');

  // === Step 2: 執行回測 ===
  console.log('⚙️  執行回測...');
  let result;
  try {
    result = await backtestEngine.runBacktest(code, startDate, endDate, strategy, initialCapital);
    console.log(`  ✅ 回測完成`);
  } catch (e) {
    console.error(`  ❌ 回測失敗: ${e.message}`);
    process.exit(1);
  }
  console.log('');

  // === Step 3: 輸出報告 ===
  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (outputHtml) {
    const html = backtestReport.generateHtmlReport(result);
    const filePath = path.resolve(`backtest_report_${code}.html`);
    fs.writeFileSync(filePath, html, 'utf-8');
    console.log(`  ✅ HTML 報告已儲存: ${filePath}`);
    console.log('  用瀏覽器開啟即可檢視');
  } else {
    const text = backtestReport.generateTextReport(result);
    console.log(text);
  }
}

main().catch(err => {
  console.error('❌ 執行失敗:', err.message);
  process.exit(1);
});