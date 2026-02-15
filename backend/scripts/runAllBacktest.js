'use strict';

/**
 * Standalone backtest runner — runs all registered strategies against
 * cached BTCUSDT 1H kline data and prints a comparison table.
 *
 * Usage:  node backend/scripts/runAllBacktest.js
 *
 * No MongoDB or server required.
 */

// Suppress noisy strategy logs — only show WARN+
process.env.LOG_LEVEL = 'warn';

const path = require('path');
const fs = require('fs');

// -- Load kline data ---------------------------------------------------------
const KLINE_PATH = path.join(
  __dirname,
  '../data/klines/BTCUSDT_1H_1734969600000_1739318400000.json',
);

if (!fs.existsSync(KLINE_PATH)) {
  console.error('Kline data not found at:', KLINE_PATH);
  process.exit(1);
}

const klines = JSON.parse(fs.readFileSync(KLINE_PATH, 'utf8'));
console.log(`Loaded ${klines.length} klines (BTCUSDT 1H, Dec 2024 ~ Feb 2025)\n`);

// -- Load backtest infrastructure -------------------------------------------
const BacktestEngine = require('../src/backtest/backtestEngine');
const { computeMetrics } = require('../src/backtest/backtestMetrics');
const registry = require('../src/strategies');

// -- All regimes to try ------------------------------------------------------
const ALL_REGIMES = ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet', null];

// -- Strategy list (skip FundingRateStrategy — needs external data) ----------
const STRATEGY_NAMES = registry.list().filter((n) => n !== 'FundingRateStrategy');

// -- Preferred regimes per strategy (try this first, fallback to all) --------
const PREFERRED_REGIME = {
  MomentumStrategy: 'trending_up',
  MeanReversionStrategy: 'ranging',
  TurtleBreakoutStrategy: 'trending_up',
  CandlePatternStrategy: 'volatile',
  SupportResistanceStrategy: 'ranging',
  SwingStructureStrategy: 'trending_up',
  FibonacciRetracementStrategy: 'trending_up',
  GridStrategy: 'ranging',
  MaTrendStrategy: 'trending_up',
  RsiPivotStrategy: 'volatile',
  SupertrendStrategy: 'trending_up',
  BollingerReversionStrategy: 'ranging',
  VwapReversionStrategy: 'ranging',
  MacdDivergenceStrategy: 'trending_down',
  QuietRangeScalpStrategy: 'quiet',
  BreakoutStrategy: 'volatile',
  TrendlineBreakoutStrategy: 'trending_up',
  AdaptiveRegimeStrategy: null,
};

// -- Per-strategy config overrides for backtest (e.g. aggregation adjustments) --
const STRATEGY_CONFIG = {
  // Kline data is already 1H, so skip aggregation (1:1 mapping)
  TrendlineBreakoutStrategy: { aggregationMinutes: 1 },
};

// -- Run single backtest -----------------------------------------------------
const INITIAL_CAPITAL = '10000';

function runSingle(name, regime) {
  const engine = new BacktestEngine({
    strategyName: name,
    strategyConfig: STRATEGY_CONFIG[name] || {},
    symbol: 'BTCUSDT',
    interval: '1H',
    initialCapital: INITIAL_CAPITAL,
    marketRegime: regime,
  });

  const result = engine.run(klines);
  const metrics = computeMetrics({
    trades: result.trades,
    equityCurve: result.equityCurve,
    initialCapital: INITIAL_CAPITAL,
    interval: '1H',
  });

  return { name, regime, metrics, trades: result.trades };
}

// -- Run backtests -----------------------------------------------------------
const results = [];

console.log('=' .repeat(90));
console.log('  BACKTEST — BTCUSDT 1H (Dec 2024 ~ Feb 2025)');
console.log('  Capital: $10,000 | Fee: 0.06% | Slippage: 0.05% | Klines: ' + klines.length);
console.log('=' .repeat(90));
console.log('');

for (const name of STRATEGY_NAMES) {
  // 1st try: preferred regime
  const preferred = PREFERRED_REGIME[name] !== undefined ? PREFERRED_REGIME[name] : null;

  try {
    let best = runSingle(name, preferred);

    // If 0 trades with preferred regime, try all regimes
    if (best.metrics.totalTrades === 0) {
      for (const regime of ALL_REGIMES) {
        if (regime === preferred) continue; // already tried
        try {
          const alt = runSingle(name, regime);
          if (alt.metrics.totalTrades > best.metrics.totalTrades) {
            best = alt;
          }
          // If we found trades, stop searching
          if (best.metrics.totalTrades > 0) break;
        } catch (_) { /* skip */ }
      }
    }

    results.push(best);

    const m = best.metrics;
    const pnlSign = parseFloat(m.totalPnl) >= 0 ? '+' : '';
    const regimeLabel = (best.regime || 'auto').padEnd(14);
    const trades = String(m.totalTrades).padStart(4);

    if (m.totalTrades === 0) {
      console.log(`  [---] ${name.padEnd(30)} | No trades generated (tried all regimes)`);
    } else {
      console.log(
        `  [OK]  ${name.padEnd(30)} | ${regimeLabel} ` +
        `| Trades:${trades} ` +
        `| WR: ${m.winRate.padStart(6)}% ` +
        `| PnL: ${pnlSign}$${m.totalPnl.padStart(10)} ` +
        `| Ret: ${m.totalReturn.padStart(7)}% ` +
        `| MDD: ${m.maxDrawdownPercent.padStart(6)}%`
      );
    }
  } catch (err) {
    console.log(`  [ERR] ${name.padEnd(30)} | ${err.message}`);
    results.push({ name, regime: preferred, error: err.message });
  }
}

// -- Detailed comparison table -----------------------------------------------
const active = results.filter((r) => r.metrics && r.metrics.totalTrades > 0);
active.sort((a, b) => parseFloat(b.metrics.totalReturn) - parseFloat(a.metrics.totalReturn));

const inactive = results.filter((r) => r.metrics && r.metrics.totalTrades === 0);

console.log('\n');
console.log('=' .repeat(120));
console.log('  RANKING TABLE (strategies with trades, sorted by return)');
console.log('=' .repeat(120));
console.log(
  '  ' +
  '#'.padStart(3) + '  ' +
  'Strategy'.padEnd(30) +
  'Regime'.padEnd(15) +
  'Trades'.padStart(7) +
  'Wins'.padStart(6) +
  'WR%'.padStart(8) +
  'Total PnL'.padStart(13) +
  'Return%'.padStart(9) +
  'PF'.padStart(7) +
  'MDD%'.padStart(8) +
  'Sharpe'.padStart(8) +
  'Fees'.padStart(10)
);
console.log('  ' + '-'.repeat(118));

active.forEach((r, i) => {
  const m = r.metrics;
  const pnlSign = parseFloat(m.totalPnl) >= 0 ? '+' : '';
  console.log(
    '  ' +
    String(i + 1).padStart(3) + '  ' +
    r.name.padEnd(30) +
    (r.regime || 'auto').padEnd(15) +
    String(m.totalTrades).padStart(7) +
    String(m.wins).padStart(6) +
    (m.winRate + '%').padStart(8) +
    (pnlSign + '$' + m.totalPnl).padStart(13) +
    (m.totalReturn + '%').padStart(9) +
    m.profitFactor.padStart(7) +
    (m.maxDrawdownPercent + '%').padStart(8) +
    m.sharpeRatio.padStart(8) +
    ('$' + m.totalFees).padStart(10)
  );
});

// Inactive strategies
if (inactive.length > 0) {
  console.log('\n  Strategies with 0 trades (all regimes attempted):');
  for (const r of inactive) {
    console.log(`    - ${r.name}`);
  }
}

// -- Top performers ----------------------------------------------------------
console.log('\n');
console.log('=' .repeat(80));
console.log('  TOP PERFORMERS (min 3 trades)');
console.log('=' .repeat(80));

const qualified = active.filter((r) => r.metrics.totalTrades >= 3);

if (qualified.length > 0) {
  const byReturn = [...qualified].sort(
    (a, b) => parseFloat(b.metrics.totalReturn) - parseFloat(a.metrics.totalReturn),
  );
  const byWinRate = [...qualified].sort(
    (a, b) => parseFloat(b.metrics.winRate) - parseFloat(a.metrics.winRate),
  );
  const byPF = [...qualified].sort(
    (a, b) => parseFloat(b.metrics.profitFactor) - parseFloat(a.metrics.profitFactor),
  );
  const bySharpe = [...qualified].sort(
    (a, b) => parseFloat(b.metrics.sharpeRatio) - parseFloat(a.metrics.sharpeRatio),
  );
  const byMDD = [...qualified].sort(
    (a, b) => parseFloat(a.metrics.maxDrawdownPercent) - parseFloat(b.metrics.maxDrawdownPercent),
  );

  console.log(`  Best Return:        ${byReturn[0].name} (${byReturn[0].metrics.totalReturn}%)`);
  console.log(`  Best Win Rate:      ${byWinRate[0].name} (${byWinRate[0].metrics.winRate}%)`);
  console.log(`  Best Profit Factor: ${byPF[0].name} (${byPF[0].metrics.profitFactor})`);
  console.log(`  Best Sharpe:        ${bySharpe[0].name} (${bySharpe[0].metrics.sharpeRatio})`);
  console.log(`  Lowest MDD:         ${byMDD[0].name} (${byMDD[0].metrics.maxDrawdownPercent}%)`);
}

// -- Save results ------------------------------------------------------------
const outputPath = path.join(__dirname, '../data/bt_all_results.json');
const outputData = {
  timestamp: new Date().toISOString(),
  dataRange: 'BTCUSDT 1H Dec2024~Feb2025',
  klineCount: klines.length,
  initialCapital: INITIAL_CAPITAL,
  results: results.map((r) => ({
    strategy: r.name,
    regime: r.regime,
    ...(r.metrics || { error: r.error }),
  })),
};

fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
console.log(`\n  Results saved to: ${outputPath}\n`);
