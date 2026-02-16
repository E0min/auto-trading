'use strict';

/**
 * Backtest performance metrics calculator.
 *
 * All monetary / percentage values are returned as strings using mathUtils
 * for arithmetic to avoid floating-point issues. Integer counters (totalTrades,
 * wins, losses, consecutiveWins, consecutiveLosses, avgHoldTime) are plain numbers.
 *
 * Expected inputs:
 *   - trades: Array of { entryTime, exitTime, entryPrice, exitPrice, side, pnl, fee, qty }
 *   - equityCurve: Array of { ts, equity, cash }
 *   - initialCapital: string
 */

const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  isZero,
  max,
  min,
  toFixed,
  abs,
  pctChange,
} = require('../utils/mathUtils');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the square root of a string number.
 * mathUtils doesn't expose sqrt, so we do it via parseFloat and return a string.
 *
 * @param {string} val
 * @returns {string}
 */
function sqrt(val) {
  const n = parseFloat(val);
  if (n < 0) return '0.00000000';
  return Math.sqrt(n).toFixed(8);
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interval → periods per year mapping (for Sharpe annualisation)
// ---------------------------------------------------------------------------

const PERIODS_PER_YEAR = Object.freeze({
  '1m': 525600,
  '3m': 175200,
  '5m': 105120,
  '15m': 35040,
  '30m': 17520,
  '1H': 8760,
  '4H': 2190,
  '6H': 1460,
  '12H': 730,
  '1D': 365,
  '1W': 52,
});

/**
 * Get the number of periods per year for a given kline interval.
 * Falls back to 365 (daily) for unknown intervals.
 *
 * @param {string} interval — e.g. '1H', '5m', '1D'
 * @returns {number}
 */
function _getPeriodsPerYear(interval) {
  return PERIODS_PER_YEAR[interval] || 365;
}

/**
 * Compute comprehensive backtest performance metrics.
 *
 * @param {Object} params
 * @param {Array<Object>} params.trades        — executed trades
 * @param {Array<Object>} params.equityCurve   — equity snapshots
 * @param {string}        params.initialCapital — starting capital (string)
 * @param {string}        [params.interval]     — kline interval for Sharpe annualisation (e.g. '1H')
 * @returns {Object} metrics with all monetary values as strings
 */
function computeMetrics({ trades, equityCurve, initialCapital, interval, totalFundingCost }) {
  const totalTrades = trades.length;

  // -- Edge case: no trades ------------------------------------------------
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: '0.00',
      totalPnl: '0.00',
      totalReturn: '0.00',
      avgWin: '0.00',
      avgLoss: '0.00',
      largestWin: '0.00',
      largestLoss: '0.00',
      profitFactor: '0.00',
      maxDrawdown: '0.00',
      maxDrawdownPercent: '0.00',
      sharpeRatio: '0.00',
      sortinoRatio: '0.00',
      calmarRatio: '0.00',
      avgHoldTime: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      totalFees: '0.00',
      totalFundingCost: '0.00',
      finalEquity: initialCapital,
    };
  }

  // -- Win / loss classification -------------------------------------------
  const winTrades = [];
  const lossTrades = [];

  for (const t of trades) {
    if (isGreaterThan(t.pnl, '0')) {
      winTrades.push(t);
    } else {
      lossTrades.push(t);
    }
  }

  const wins = winTrades.length;
  const losses = lossTrades.length;

  // Win rate
  const winRate = toFixed(divide(multiply(String(wins), '100'), String(totalTrades), 4), 2);

  // -- PnL aggregates ------------------------------------------------------
  let totalPnl = '0';
  let totalFees = '0';
  let sumWins = '0';
  let sumLosses = '0';
  let largestWin = '0';
  let largestLoss = '0';

  for (const t of trades) {
    totalPnl = add(totalPnl, t.pnl);
    totalFees = add(totalFees, t.fee);
  }

  for (const t of winTrades) {
    sumWins = add(sumWins, t.pnl);
    largestWin = max(largestWin, t.pnl);
  }

  for (const t of lossTrades) {
    sumLosses = add(sumLosses, abs(t.pnl));
    // For largest loss, track the most negative value (largest absolute loss)
    const absLoss = abs(t.pnl);
    if (isGreaterThan(absLoss, abs(largestLoss))) {
      largestLoss = t.pnl; // keep original sign
    }
  }

  // Total return as percentage
  const totalReturn = isZero(initialCapital)
    ? '0.00'
    : toFixed(pctChange(initialCapital, add(initialCapital, totalPnl)), 2);

  // Average win / loss
  const avgWin = wins > 0 ? toFixed(divide(sumWins, String(wins)), 2) : '0.00';
  const avgLoss = losses > 0
    ? toFixed(divide(sumLosses, String(losses)), 2)
    : '0.00';

  // Profit factor: sum of wins / sum of losses
  const profitFactor = (isZero(sumLosses))
    ? (isZero(sumWins) ? '0.00' : '999.99')
    : toFixed(divide(sumWins, sumLosses), 2);

  // -- Consecutive wins / losses -------------------------------------------
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  for (const t of trades) {
    if (isGreaterThan(t.pnl, '0')) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > consecutiveWins) consecutiveWins = currentWinStreak;
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > consecutiveLosses) consecutiveLosses = currentLossStreak;
    }
  }

  // -- Average hold time ---------------------------------------------------
  let totalHoldTime = 0;
  for (const t of trades) {
    const holdTime = Number(t.exitTime) - Number(t.entryTime);
    totalHoldTime += holdTime;
  }
  const avgHoldTime = totalTrades > 0 ? Math.round(totalHoldTime / totalTrades) : 0;

  // -- Max drawdown from equity curve --------------------------------------
  let maxDrawdown = '0';
  let maxDrawdownPercent = '0';
  let peak = initialCapital;

  for (const point of equityCurve) {
    const equity = point.equity;

    // Update peak
    if (isGreaterThan(equity, peak)) {
      peak = equity;
    }

    // Current drawdown (absolute)
    const drawdown = subtract(peak, equity);

    if (isGreaterThan(drawdown, maxDrawdown)) {
      maxDrawdown = drawdown;

      // Drawdown as percentage of peak
      if (!isZero(peak)) {
        maxDrawdownPercent = toFixed(
          multiply(divide(drawdown, peak), '100'),
          2,
        );
      }
    }
  }

  // -- Sharpe ratio (annualised, scaled by interval periods/year, risk-free = 0) --
  let sharpeRatio = '0.00';
  const periodsPerYear = _getPeriodsPerYear(interval);

  // Declare meanReturn and periodReturns in outer scope for Sortino reuse
  let meanReturn = '0';
  let periodReturns = [];

  if (equityCurve.length >= 2) {
    // Compute per-period returns from equity curve
    for (let i = 1; i < equityCurve.length; i++) {
      const prevEquity = equityCurve[i - 1].equity;
      const currEquity = equityCurve[i].equity;

      if (!isZero(prevEquity)) {
        const ret = pctChange(prevEquity, currEquity);
        periodReturns.push(ret);
      }
    }

    if (periodReturns.length > 0) {
      // Mean per-period return
      let sumReturns = '0';
      for (const r of periodReturns) {
        sumReturns = add(sumReturns, r);
      }
      meanReturn = divide(sumReturns, String(periodReturns.length));

      // Standard deviation of per-period returns
      let sumSquaredDiff = '0';
      for (const r of periodReturns) {
        const diff = subtract(r, meanReturn);
        const squaredDiff = multiply(diff, diff);
        sumSquaredDiff = add(sumSquaredDiff, squaredDiff);
      }
      const variance = divide(sumSquaredDiff, String(periodReturns.length));
      const stdDev = sqrt(variance);

      // Annualise: sharpe = (mean * sqrt(periodsPerYear)) / stdDev
      if (!isZero(stdDev)) {
        const sqrtPeriods = sqrt(String(periodsPerYear));
        const annualisedReturn = multiply(meanReturn, sqrtPeriods);
        sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
      }
    }
  }

  // -- Sortino ratio (annualised, downside deviation only, MAR = 0) --
  let sortinoRatio = '0.00';

  if (periodReturns.length > 0 && !isZero(meanReturn)) {
    let sumSquaredDownside = '0';
    for (const r of periodReturns) {
      if (isLessThan(r, '0')) {
        sumSquaredDownside = add(sumSquaredDownside, multiply(r, r));
      }
    }
    // Downside deviation: sqrt(sum(min(r,0)^2) / N) where N = total periods
    const downsideVariance = divide(sumSquaredDownside, String(periodReturns.length));
    const downsideDeviation = sqrt(downsideVariance);

    if (!isZero(downsideDeviation)) {
      const sqrtPeriods = sqrt(String(periodsPerYear));
      const annualisedReturn = multiply(meanReturn, sqrtPeriods);
      sortinoRatio = toFixed(divide(annualisedReturn, downsideDeviation), 2);
    } else {
      // No downside = all returns positive
      sortinoRatio = isGreaterThan(meanReturn, '0') ? '999.99' : '0.00';
    }
  }

  // -- Calmar ratio (totalReturn / maxDrawdownPercent) --
  const calmarRatio = !isZero(maxDrawdownPercent)
    ? toFixed(divide(totalReturn, maxDrawdownPercent), 2)
    : '0.00';

  // -- Final equity --------------------------------------------------------
  const finalEquity = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : add(initialCapital, totalPnl);

  // -- Assemble result -----------------------------------------------------
  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalPnl: toFixed(totalPnl, 2),
    totalReturn,
    avgWin,
    avgLoss,
    largestWin: toFixed(largestWin, 2),
    largestLoss: toFixed(largestLoss, 2),
    profitFactor,
    maxDrawdown: toFixed(maxDrawdown, 2),
    maxDrawdownPercent,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    avgHoldTime,
    consecutiveWins,
    consecutiveLosses,
    totalFees: toFixed(totalFees, 2),
    totalFundingCost: toFixed(totalFundingCost || '0', 2), // R11-T7
    finalEquity: toFixed(finalEquity, 2),
  };
}

module.exports = { computeMetrics };
