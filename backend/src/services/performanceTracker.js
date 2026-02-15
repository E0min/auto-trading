'use strict';

/**
 * PerformanceTracker — performance analytics engine.
 *
 * Computes comprehensive trading statistics, equity curves, daily breakdowns,
 * per-strategy and per-symbol analysis, Sharpe ratio, and max drawdown from
 * persisted Trade and Snapshot data. All monetary values are String-typed and
 * arithmetic is performed through mathUtils to avoid floating-point issues.
 */

const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const Trade = require('../models/Trade');
const Snapshot = require('../models/Snapshot');
const { ORDER_STATUS } = require('../utils/constants');

const log = createLogger('PerformanceTracker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the maximum consecutive streak of a boolean predicate across
 * an ordered array of trades.
 *
 * @param {Array<object>} trades — trades sorted chronologically
 * @param {function(object): boolean} predicate
 * @returns {number}
 */
function maxStreak(trades, predicate) {
  let best = 0;
  let current = 0;

  for (const trade of trades) {
    if (predicate(trade)) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }

  return best;
}

/**
 * Compute the standard deviation of an array of String values.
 *
 * @param {string[]} values
 * @param {string} mean
 * @returns {string}
 */
function stdDev(values, mean) {
  if (values.length <= 1) return '0';

  let sumSquaredDiff = '0';
  for (const v of values) {
    const diff = math.subtract(v, mean);
    const squared = math.multiply(diff, diff);
    sumSquaredDiff = math.add(sumSquaredDiff, squared);
  }

  // Population std dev (n - 1 for sample)
  const variance = math.divide(sumSquaredDiff, String(values.length - 1));
  // sqrt via parseFloat → Math.sqrt → toFixed
  const varianceNum = parseFloat(variance);
  return Math.sqrt(varianceNum < 0 ? 0 : varianceNum).toFixed(8);
}

/**
 * Compute extended metrics for a group of trades (strategy or symbol).
 *
 * @param {{ trades: number, wins: number, losses: number, totalPnl: string, winPnls: string[], lossPnls: string[], allPnls: string[] }} data
 * @param {string} sessionTotalPnl — overall session PnL for contribution calculation
 * @returns {object}
 */
function computeExtendedMetrics(data, sessionTotalPnl) {
  const decided = data.wins + data.losses;
  const winRate = decided > 0
    ? math.multiply(math.divide(String(data.wins), String(decided)), '100')
    : '0';

  // avgPnl: total PnL / trade count
  const avgPnl = data.trades > 0
    ? math.divide(data.totalPnl, String(data.trades))
    : '0';

  // Sum of winning and losing PnL
  let totalWinPnl = '0';
  for (const p of data.winPnls) {
    totalWinPnl = math.add(totalWinPnl, p);
  }

  let totalLossPnl = '0';
  for (const p of data.lossPnls) {
    totalLossPnl = math.add(totalLossPnl, p);
  }

  // avgWin / avgLoss
  const avgWin = data.wins > 0
    ? math.divide(totalWinPnl, String(data.wins))
    : '0';

  const avgLoss = data.losses > 0
    ? math.divide(totalLossPnl, String(data.losses))
    : '0';

  // profitFactor: sum(wins) / |sum(losses)|
  let profitFactor;
  const absLoss = math.abs(totalLossPnl);
  if (data.losses === 0 && data.wins > 0) {
    profitFactor = 'Infinity';
  } else if (data.wins === 0) {
    profitFactor = '0';
  } else if (math.isGreaterThan(absLoss, '0')) {
    profitFactor = math.divide(math.abs(totalWinPnl), absLoss);
  } else {
    profitFactor = '0';
  }

  // expectancy: (winRate% / 100 * avgWin) + ((1 - winRate% / 100) * avgLoss)
  let expectancy = '0';
  if (decided > 0) {
    const winRateDecimal = math.divide(winRate, '100');
    const lossRateDecimal = math.subtract('1', winRateDecimal);
    const winComponent = math.multiply(winRateDecimal, avgWin);
    const lossComponent = math.multiply(lossRateDecimal, avgLoss);
    expectancy = math.add(winComponent, lossComponent);
  }

  // largestWin / largestLoss
  let largestWin = '0';
  for (const p of data.winPnls) {
    largestWin = math.max(largestWin, p);
  }

  let largestLoss = '0';
  for (const p of data.lossPnls) {
    largestLoss = math.min(largestLoss, p);
  }

  // pnlContribution: group totalPnl / session totalPnl * 100
  let pnlContribution = '0';
  if (!math.isZero(sessionTotalPnl)) {
    pnlContribution = math.multiply(
      math.divide(data.totalPnl, sessionTotalPnl),
      '100'
    );
  }

  return {
    trades: data.trades,
    wins: data.wins,
    losses: data.losses,
    totalPnl: data.totalPnl,
    winRate,
    avgPnl,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    largestWin,
    largestLoss,
    pnlContribution,
  };
}

// ---------------------------------------------------------------------------
// PerformanceTracker class
// ---------------------------------------------------------------------------

class PerformanceTracker {
  constructor() {
    log.info('PerformanceTracker initialised');
  }

  // =========================================================================
  // getSessionStats
  // =========================================================================

  /**
   * Return comprehensive session statistics derived from all trades
   * belonging to the given session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getSessionStats(sessionId) {
    log.debug('getSessionStats — computing', { sessionId });

    const trades = await Trade.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean();

    const totalTrades = trades.length;

    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: '0',
        totalPnl: '0',
        avgWin: '0',
        avgLoss: '0',
        profitFactor: '0',
        avgHoldTime: 0,
        largestWin: '0',
        largestLoss: '0',
        consecutiveWins: 0,
        consecutiveLosses: 0,
      };
    }

    // Classify trades
    const winningTrades = [];
    const losingTrades = [];

    for (const trade of trades) {
      const pnl = trade.pnl || '0';
      if (math.isGreaterThan(pnl, '0')) {
        winningTrades.push(trade);
      } else if (math.isLessThan(pnl, '0')) {
        losingTrades.push(trade);
      }
      // Trades with pnl == 0 are neither wins nor losses
    }

    const wins = winningTrades.length;
    const losses = losingTrades.length;

    // Win rate — wins / (wins + losses), expressed as a percentage string
    const decidedTrades = wins + losses;
    const winRate = decidedTrades > 0
      ? math.multiply(math.divide(String(wins), String(decidedTrades)), '100')
      : '0';

    // Total PnL
    let totalPnl = '0';
    for (const trade of trades) {
      totalPnl = math.add(totalPnl, trade.pnl || '0');
    }

    // Sum of winning PnL and losing PnL (for averages and profit factor)
    let totalWinPnl = '0';
    for (const t of winningTrades) {
      totalWinPnl = math.add(totalWinPnl, t.pnl || '0');
    }

    let totalLossPnl = '0';
    for (const t of losingTrades) {
      totalLossPnl = math.add(totalLossPnl, t.pnl || '0');
    }

    // Average win / loss
    const avgWin = wins > 0
      ? math.divide(totalWinPnl, String(wins))
      : '0';

    const avgLoss = losses > 0
      ? math.divide(totalLossPnl, String(losses))
      : '0';

    // Profit factor = |totalWins| / |totalLosses|
    const absLoss = math.abs(totalLossPnl);
    const profitFactor = math.isGreaterThan(absLoss, '0')
      ? math.divide(math.abs(totalWinPnl), absLoss)
      : '0';

    // Average hold time (ms) — time between createdAt and updatedAt
    // (updatedAt reflects the last status change, typically the fill)
    let totalHoldTime = 0;
    let holdTimeCount = 0;
    for (const trade of trades) {
      if (trade.createdAt && trade.updatedAt) {
        const created = new Date(trade.createdAt).getTime();
        const updated = new Date(trade.updatedAt).getTime();
        const diff = updated - created;
        if (diff >= 0) {
          totalHoldTime += diff;
          holdTimeCount += 1;
        }
      }
    }
    const avgHoldTime = holdTimeCount > 0
      ? Math.round(totalHoldTime / holdTimeCount)
      : 0;

    // Largest win / loss
    let largestWin = '0';
    for (const t of winningTrades) {
      largestWin = math.max(largestWin, t.pnl || '0');
    }

    let largestLoss = '0';
    for (const t of losingTrades) {
      largestLoss = math.min(largestLoss, t.pnl || '0');
    }

    // Consecutive streaks
    const consecutiveWins = maxStreak(trades, (t) => math.isGreaterThan(t.pnl || '0', '0'));
    const consecutiveLosses = maxStreak(trades, (t) => math.isLessThan(t.pnl || '0', '0'));

    const stats = {
      totalTrades,
      wins,
      losses,
      winRate,
      totalPnl,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldTime,
      largestWin,
      largestLoss,
      consecutiveWins,
      consecutiveLosses,
    };

    log.info('getSessionStats — done', {
      sessionId,
      totalTrades,
      wins,
      losses,
      totalPnl,
    });

    return stats;
  }

  // =========================================================================
  // getEquityCurve
  // =========================================================================

  /**
   * Return the equity curve for a session, derived from periodic snapshots.
   *
   * @param {string} sessionId
   * @param {number} [limit=200]
   * @returns {Promise<Array<{ timestamp: Date, equity: string, unrealizedPnl: string, positionCount: number }>>}
   */
  async getEquityCurve(sessionId, limit = 200) {
    log.debug('getEquityCurve — querying', { sessionId, limit });

    const snapshots = await Snapshot.find({ sessionId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const curve = snapshots.map((snap) => ({
      timestamp: snap.createdAt,
      equity: snap.equity || '0',
      unrealizedPnl: snap.unrealizedPnl || '0',
      positionCount: Array.isArray(snap.positions) ? snap.positions.length : 0,
    }));

    log.debug('getEquityCurve — done', { sessionId, points: curve.length });

    return curve;
  }

  // =========================================================================
  // getDailyStats
  // =========================================================================

  /**
   * Return daily aggregated statistics for the past N days.
   *
   * @param {string} sessionId
   * @param {number} [days=30]
   * @returns {Promise<Array<{ date: string, trades: number, pnl: string, wins: number, losses: number }>>}
   */
  async getDailyStats(sessionId, days = 30) {
    log.debug('getDailyStats — computing', { sessionId, days });

    const since = new Date();
    since.setDate(since.getDate() - days);

    const trades = await Trade.find({
      sessionId,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: 1 })
      .lean();

    // Group by date (YYYY-MM-DD)
    /** @type {Map<string, { trades: number, pnl: string, wins: number, losses: number }>} */
    const dayMap = new Map();

    for (const trade of trades) {
      const dateStr = new Date(trade.createdAt).toISOString().slice(0, 10);
      let entry = dayMap.get(dateStr);

      if (!entry) {
        entry = { trades: 0, pnl: '0', wins: 0, losses: 0 };
        dayMap.set(dateStr, entry);
      }

      entry.trades += 1;

      const pnl = trade.pnl || '0';
      entry.pnl = math.add(entry.pnl, pnl);

      if (math.isGreaterThan(pnl, '0')) {
        entry.wins += 1;
      } else if (math.isLessThan(pnl, '0')) {
        entry.losses += 1;
      }
    }

    // Convert to sorted array
    const result = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        trades: data.trades,
        pnl: data.pnl,
        wins: data.wins,
        losses: data.losses,
      }));

    log.debug('getDailyStats — done', { sessionId, daysWithTrades: result.length });

    return result;
  }

  // =========================================================================
  // getByStrategy
  // =========================================================================

  /**
   * Return per-strategy statistics for a session with extended metrics.
   *
   * @param {string} sessionId
   * @returns {Promise<Object<string, {
   *   trades: number, wins: number, losses: number, totalPnl: string, winRate: string,
   *   avgPnl: string, profitFactor: string, avgWin: string, avgLoss: string,
   *   expectancy: string, largestWin: string, largestLoss: string, pnlContribution: string
   * }>>}
   */
  async getByStrategy(sessionId) {
    log.debug('getByStrategy — computing', { sessionId });

    const trades = await Trade.find({ sessionId }).lean();

    /** @type {Object<string, { trades: number, wins: number, losses: number, totalPnl: string, winPnls: string[], lossPnls: string[], allPnls: string[] }>} */
    const strategyMap = {};

    // Overall session totalPnl for pnlContribution
    let sessionTotalPnl = '0';

    for (const trade of trades) {
      const strategyName = trade.strategy || 'unknown';
      let entry = strategyMap[strategyName];

      if (!entry) {
        entry = { trades: 0, wins: 0, losses: 0, totalPnl: '0', winPnls: [], lossPnls: [], allPnls: [] };
        strategyMap[strategyName] = entry;
      }

      entry.trades += 1;

      const pnl = trade.pnl || '0';
      entry.totalPnl = math.add(entry.totalPnl, pnl);
      entry.allPnls.push(pnl);
      sessionTotalPnl = math.add(sessionTotalPnl, pnl);

      if (math.isGreaterThan(pnl, '0')) {
        entry.wins += 1;
        entry.winPnls.push(pnl);
      } else if (math.isLessThan(pnl, '0')) {
        entry.losses += 1;
        entry.lossPnls.push(pnl);
      }
    }

    // Compute extended metrics for each strategy
    const result = {};
    for (const [name, data] of Object.entries(strategyMap)) {
      result[name] = computeExtendedMetrics(data, sessionTotalPnl);
    }

    log.debug('getByStrategy — done', { sessionId, strategies: Object.keys(result) });

    return result;
  }

  // =========================================================================
  // getBySymbol
  // =========================================================================

  /**
   * Return per-symbol statistics for a session with extended metrics.
   *
   * @param {string} sessionId
   * @returns {Promise<Object<string, {
   *   trades: number, wins: number, losses: number, totalPnl: string, winRate: string,
   *   avgPnl: string, profitFactor: string, avgWin: string, avgLoss: string,
   *   expectancy: string, largestWin: string, largestLoss: string, pnlContribution: string
   * }>>}
   */
  async getBySymbol(sessionId) {
    log.debug('getBySymbol — computing', { sessionId });

    const trades = await Trade.find({ sessionId }).lean();

    /** @type {Object<string, { trades: number, wins: number, losses: number, totalPnl: string, winPnls: string[], lossPnls: string[], allPnls: string[] }>} */
    const symbolMap = {};

    // Overall session totalPnl for pnlContribution
    let sessionTotalPnl = '0';

    for (const trade of trades) {
      const sym = trade.symbol || 'unknown';
      let entry = symbolMap[sym];

      if (!entry) {
        entry = { trades: 0, wins: 0, losses: 0, totalPnl: '0', winPnls: [], lossPnls: [], allPnls: [] };
        symbolMap[sym] = entry;
      }

      entry.trades += 1;

      const pnl = trade.pnl || '0';
      entry.totalPnl = math.add(entry.totalPnl, pnl);
      entry.allPnls.push(pnl);
      sessionTotalPnl = math.add(sessionTotalPnl, pnl);

      if (math.isGreaterThan(pnl, '0')) {
        entry.wins += 1;
        entry.winPnls.push(pnl);
      } else if (math.isLessThan(pnl, '0')) {
        entry.losses += 1;
        entry.lossPnls.push(pnl);
      }
    }

    // Compute extended metrics for each symbol
    const result = {};
    for (const [sym, data] of Object.entries(symbolMap)) {
      result[sym] = computeExtendedMetrics(data, sessionTotalPnl);
    }

    log.debug('getBySymbol — done', { sessionId, symbols: Object.keys(result) });

    return result;
  }

  // =========================================================================
  // getSharpeRatio
  // =========================================================================

  /**
   * Calculate the annualised Sharpe ratio for a session.
   *
   * Sharpe = (meanDailyReturn - riskFreeRate) / stdDev(dailyReturns) * sqrt(365)
   *
   * @param {string} sessionId
   * @param {string} [riskFreeRate='0'] — annualised risk-free rate as decimal (e.g. '0.05' for 5%)
   * @returns {Promise<string>}
   */
  async getSharpeRatio(sessionId, riskFreeRate = '0') {
    log.debug('getSharpeRatio — computing', { sessionId, riskFreeRate });

    // Get daily PnL values
    const dailyStats = await this.getDailyStats(sessionId, 365);

    if (dailyStats.length < 2) {
      log.debug('getSharpeRatio — insufficient data', { days: dailyStats.length });
      return '0';
    }

    const dailyPnls = dailyStats.map((d) => d.pnl);

    // Mean daily return
    let totalDailyPnl = '0';
    for (const pnl of dailyPnls) {
      totalDailyPnl = math.add(totalDailyPnl, pnl);
    }
    const meanReturn = math.divide(totalDailyPnl, String(dailyPnls.length));

    // Daily risk-free rate (annualised / 365)
    const dailyRiskFree = math.divide(riskFreeRate, '365');

    // Standard deviation of daily returns
    const sd = stdDev(dailyPnls, meanReturn);

    if (sd === '0' || math.isLessThan(sd, '0.00000001')) {
      log.debug('getSharpeRatio — stdDev is zero, returning 0');
      return '0';
    }

    // Sharpe = (meanReturn - dailyRiskFree) / sd * sqrt(365)
    const excessReturn = math.subtract(meanReturn, dailyRiskFree);
    const ratio = math.divide(excessReturn, sd);
    const sqrtDays = Math.sqrt(365).toFixed(8);
    const annualisedSharpe = math.multiply(ratio, sqrtDays);

    log.info('getSharpeRatio — done', {
      sessionId,
      sharpe: annualisedSharpe,
      meanReturn,
      stdDev: sd,
    });

    return annualisedSharpe;
  }

  // =========================================================================
  // getMaxDrawdown
  // =========================================================================

  /**
   * Calculate maximum drawdown from equity curve snapshots.
   *
   * @param {string} sessionId
   * @returns {Promise<{ maxDrawdown: string, maxDrawdownPercent: string, peakEquity: string, troughEquity: string, peakDate: Date|null, troughDate: Date|null }>}
   */
  async getMaxDrawdown(sessionId) {
    log.debug('getMaxDrawdown — computing', { sessionId });

    const snapshots = await Snapshot.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean();

    const defaultResult = {
      maxDrawdown: '0',
      maxDrawdownPercent: '0',
      peakEquity: '0',
      troughEquity: '0',
      peakDate: null,
      troughDate: null,
    };

    if (snapshots.length === 0) {
      log.debug('getMaxDrawdown — no snapshots found');
      return defaultResult;
    }

    let peak = snapshots[0].equity || '0';
    let peakDate = snapshots[0].createdAt;

    let maxDrawdown = '0';         // absolute drawdown amount
    let maxDrawdownPercent = '0';  // percentage drawdown
    let bestPeakEquity = peak;
    let worstTroughEquity = peak;
    let bestPeakDate = peakDate;
    let worstTroughDate = peakDate;

    for (const snap of snapshots) {
      const equity = snap.equity || '0';

      // Update peak if equity exceeds it
      if (math.isGreaterThan(equity, peak)) {
        peak = equity;
        peakDate = snap.createdAt;
      }

      // Calculate drawdown from current peak
      const drawdown = math.subtract(peak, equity);

      if (math.isGreaterThan(drawdown, maxDrawdown)) {
        maxDrawdown = drawdown;
        bestPeakEquity = peak;
        worstTroughEquity = equity;
        bestPeakDate = peakDate;
        worstTroughDate = snap.createdAt;

        // Percentage drawdown relative to peak
        if (math.isGreaterThan(peak, '0')) {
          maxDrawdownPercent = math.multiply(
            math.divide(drawdown, peak),
            '100'
          );
        }
      }
    }

    const result = {
      maxDrawdown,
      maxDrawdownPercent,
      peakEquity: bestPeakEquity,
      troughEquity: worstTroughEquity,
      peakDate: bestPeakDate,
      troughDate: worstTroughDate,
    };

    log.info('getMaxDrawdown — done', {
      sessionId,
      maxDrawdown,
      maxDrawdownPercent,
    });

    return result;
  }
}

module.exports = PerformanceTracker;
