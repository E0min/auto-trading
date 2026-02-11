'use strict';

/**
 * TradeJournal — periodic snapshot recording and trade journal.
 *
 * Records periodic account snapshots at a configurable interval, persisting
 * equity, balance, positions, and open order counts to the Snapshot collection.
 * Also generates daily journal entries summarising trading activity.
 */

const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const Trade = require('../models/Trade');
const Snapshot = require('../models/Snapshot');
const BotSession = require('../models/BotSession');
const { ORDER_STATUS } = require('../utils/constants');

const log = createLogger('TradeJournal');

// ---------------------------------------------------------------------------
// TradeJournal class
// ---------------------------------------------------------------------------

class TradeJournal {
  /**
   * @param {object} deps
   * @param {import('./positionManager')} deps.positionManager
   */
  constructor({ positionManager }) {
    if (!positionManager) {
      throw new Error('TradeJournal requires positionManager');
    }

    this.positionManager = positionManager;

    /** @type {NodeJS.Timeout|null} */
    this._snapshotInterval = null;

    /** @type {number} Snapshot interval in milliseconds (default 1 minute) */
    this._snapshotIntervalMs = 60000;

    /** @type {string|null} Currently active session ID */
    this._sessionId = null;

    log.info('TradeJournal initialised');
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start periodic snapshot recording for the given session.
   *
   * @param {string} sessionId
   */
  start(sessionId) {
    if (this._snapshotInterval) {
      log.warn('start — already running, stopping previous interval first');
      this.stop();
    }

    this._sessionId = sessionId;

    log.info('start — beginning periodic snapshot recording', {
      sessionId,
      intervalMs: this._snapshotIntervalMs,
    });

    // Take an immediate snapshot at start
    this.recordSnapshot(sessionId).catch((err) => {
      log.error('start — initial snapshot failed', { error: err });
    });

    // Start periodic snapshots
    this._snapshotInterval = setInterval(async () => {
      try {
        await this.recordSnapshot(sessionId);
      } catch (err) {
        log.error('periodic snapshot — failed', { error: err });
      }
    }, this._snapshotIntervalMs);
  }

  /**
   * Stop periodic snapshot recording.
   */
  stop() {
    if (this._snapshotInterval) {
      clearInterval(this._snapshotInterval);
      this._snapshotInterval = null;
      log.info('stop — snapshot recording stopped', { sessionId: this._sessionId });
    }

    this._sessionId = null;
  }

  // =========================================================================
  // recordSnapshot
  // =========================================================================

  /**
   * Record a single account snapshot to the database.
   *
   * 1. Reads current account state from positionManager
   * 2. Reads current positions from positionManager
   * 3. Counts open orders for the session
   * 4. Persists a Snapshot document
   * 5. Updates BotSession.stats with latest totals
   *
   * @param {string} sessionId
   * @returns {Promise<object>} The saved Snapshot document
   */
  async recordSnapshot(sessionId) {
    log.debug('recordSnapshot — recording', { sessionId });

    // 1. Get current account state and positions
    const accountState = this.positionManager.getAccountState();
    const positions = this.positionManager.getPositions();

    // 2. Count open orders for this session
    const openStatuses = [
      ORDER_STATUS.PENDING,
      ORDER_STATUS.OPEN,
      ORDER_STATUS.PARTIALLY_FILLED,
    ];

    const openOrderCount = await Trade.countDocuments({
      sessionId,
      status: { $in: openStatuses },
    });

    // 3. Build position sub-documents for the snapshot
    const positionDocs = positions.map((pos) => ({
      symbol: pos.symbol,
      posSide: pos.posSide,
      qty: pos.qty || '0',
      entryPrice: pos.entryPrice || '0',
      markPrice: pos.markPrice || '0',
      unrealizedPnl: pos.unrealizedPnl || '0',
      leverage: pos.leverage || '1',
    }));

    // 4. Create and save Snapshot document
    const snapshot = new Snapshot({
      sessionId,
      equity: accountState.equity || '0',
      availableBalance: accountState.availableBalance || '0',
      unrealizedPnl: accountState.unrealizedPnl || '0',
      positions: positionDocs,
      openOrderCount,
    });

    const savedSnapshot = await snapshot.save();

    log.debug('recordSnapshot — saved', {
      sessionId,
      snapshotId: savedSnapshot._id.toString(),
      equity: savedSnapshot.equity,
      positionCount: positionDocs.length,
      openOrderCount,
    });

    // 5. Update BotSession.stats with latest totals
    try {
      await this._updateSessionStats(sessionId);
    } catch (err) {
      log.error('recordSnapshot — failed to update session stats', { error: err });
    }

    return savedSnapshot;
  }

  // =========================================================================
  // getRecentSnapshots
  // =========================================================================

  /**
   * Retrieve the most recent snapshots for a session.
   *
   * @param {string} sessionId
   * @param {number} [limit=60]
   * @returns {Promise<Array<object>>}
   */
  async getRecentSnapshots(sessionId, limit = 60) {
    log.debug('getRecentSnapshots — querying', { sessionId, limit });

    const snapshots = await Snapshot.find({ sessionId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    log.debug('getRecentSnapshots — done', { sessionId, count: snapshots.length });

    return snapshots;
  }

  // =========================================================================
  // generateJournalEntry
  // =========================================================================

  /**
   * Generate a daily journal entry summarising trading activity for a
   * specific date.
   *
   * @param {string} sessionId
   * @param {Date|string} date — the date to generate the journal for (YYYY-MM-DD or Date)
   * @returns {Promise<object>} Journal entry object
   */
  async generateJournalEntry(sessionId, date) {
    const dateStr = typeof date === 'string'
      ? date
      : date.toISOString().slice(0, 10);

    log.debug('generateJournalEntry — generating', { sessionId, date: dateStr });

    // Define start and end of day (UTC)
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    // 1. Get all trades for the date
    const trades = await Trade.find({
      sessionId,
      createdAt: { $gte: dayStart, $lte: dayEnd },
    })
      .sort({ createdAt: 1 })
      .lean();

    // 2. Get snapshots for the date (first and last)
    const snapshots = await Snapshot.find({
      sessionId,
      createdAt: { $gte: dayStart, $lte: dayEnd },
    })
      .sort({ createdAt: 1 })
      .lean();

    const firstSnapshot = snapshots.length > 0 ? snapshots[0] : null;
    const lastSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

    // 3. Compute daily summary
    const startEquity = firstSnapshot ? (firstSnapshot.equity || '0') : '0';
    const endEquity = lastSnapshot ? (lastSnapshot.equity || '0') : '0';

    // Daily PnL from equity difference
    const dailyPnlFromEquity = (firstSnapshot && lastSnapshot)
      ? math.subtract(endEquity, startEquity)
      : '0';

    // Daily PnL from trade PnLs
    let tradePnl = '0';
    let wins = 0;
    let losses = 0;

    for (const trade of trades) {
      const pnl = trade.pnl || '0';
      tradePnl = math.add(tradePnl, pnl);

      if (math.isGreaterThan(pnl, '0')) {
        wins += 1;
      } else if (math.isLessThan(pnl, '0')) {
        losses += 1;
      }
    }

    // Identify notable events
    const notableEvents = [];

    // Largest single win
    let largestWin = '0';
    let largestWinTrade = null;
    for (const trade of trades) {
      const pnl = trade.pnl || '0';
      if (math.isGreaterThan(pnl, largestWin)) {
        largestWin = pnl;
        largestWinTrade = trade;
      }
    }

    if (largestWinTrade && math.isGreaterThan(largestWin, '0')) {
      notableEvents.push({
        type: 'largest_win',
        symbol: largestWinTrade.symbol,
        pnl: largestWin,
        time: largestWinTrade.createdAt,
      });
    }

    // Largest single loss
    let largestLoss = '0';
    let largestLossTrade = null;
    for (const trade of trades) {
      const pnl = trade.pnl || '0';
      if (math.isLessThan(pnl, largestLoss)) {
        largestLoss = pnl;
        largestLossTrade = trade;
      }
    }

    if (largestLossTrade && math.isLessThan(largestLoss, '0')) {
      notableEvents.push({
        type: 'largest_loss',
        symbol: largestLossTrade.symbol,
        pnl: largestLoss,
        time: largestLossTrade.createdAt,
      });
    }

    // Collect unique symbols and strategies traded
    const symbolsTraded = [...new Set(trades.map((t) => t.symbol).filter(Boolean))];
    const strategiesUsed = [...new Set(trades.map((t) => t.strategy).filter(Boolean))];

    const journalEntry = {
      sessionId,
      date: dateStr,
      startEquity,
      endEquity,
      dailyPnl: dailyPnlFromEquity,
      tradePnl,
      totalTrades: trades.length,
      wins,
      losses,
      winRate: (wins + losses) > 0
        ? math.multiply(math.divide(String(wins), String(wins + losses)), '100')
        : '0',
      symbolsTraded,
      strategiesUsed,
      snapshotCount: snapshots.length,
      notableEvents,
      trades: trades.map((t) => ({
        orderId: t.orderId,
        symbol: t.symbol,
        side: t.side,
        posSide: t.posSide,
        strategy: t.strategy,
        qty: t.qty,
        price: t.price,
        pnl: t.pnl || '0',
        status: t.status,
        time: t.createdAt,
      })),
    };

    log.info('generateJournalEntry — done', {
      sessionId,
      date: dateStr,
      totalTrades: trades.length,
      dailyPnl: dailyPnlFromEquity,
    });

    return journalEntry;
  }

  // =========================================================================
  // Internal — Session stats updater
  // =========================================================================

  /**
   * Recalculate and persist cumulative session stats on the BotSession document.
   *
   * @param {string} sessionId
   * @private
   */
  async _updateSessionStats(sessionId) {
    const trades = await Trade.find({ sessionId }).lean();

    let totalPnl = '0';
    let wins = 0;
    let losses = 0;

    for (const trade of trades) {
      const pnl = trade.pnl || '0';
      totalPnl = math.add(totalPnl, pnl);

      if (math.isGreaterThan(pnl, '0')) {
        wins += 1;
      } else if (math.isLessThan(pnl, '0')) {
        losses += 1;
      }
    }

    // Get latest equity from the most recent snapshot
    const latestSnapshot = await Snapshot.findOne({ sessionId })
      .sort({ createdAt: -1 })
      .lean();

    // Get peak equity from all snapshots
    const allSnapshots = await Snapshot.find({ sessionId })
      .select('equity')
      .lean();

    let peakEquity = '0';
    for (const snap of allSnapshots) {
      const eq = snap.equity || '0';
      if (math.isGreaterThan(eq, peakEquity)) {
        peakEquity = eq;
      }
    }

    // Calculate max drawdown
    let maxDrawdown = '0';
    let runningPeak = '0';
    const sortedSnapshots = await Snapshot.find({ sessionId })
      .sort({ createdAt: 1 })
      .select('equity')
      .lean();

    for (const snap of sortedSnapshots) {
      const equity = snap.equity || '0';
      if (math.isGreaterThan(equity, runningPeak)) {
        runningPeak = equity;
      }
      const drawdown = math.subtract(runningPeak, equity);
      if (math.isGreaterThan(drawdown, maxDrawdown)) {
        maxDrawdown = drawdown;
      }
    }

    await BotSession.findByIdAndUpdate(sessionId, {
      $set: {
        'stats.totalTrades': trades.length,
        'stats.wins': wins,
        'stats.losses': losses,
        'stats.totalPnl': totalPnl,
        'stats.maxDrawdown': maxDrawdown,
        'stats.peakEquity': peakEquity,
      },
    });

    log.debug('_updateSessionStats — updated', {
      sessionId,
      totalTrades: trades.length,
      wins,
      losses,
      totalPnl,
      peakEquity,
      maxDrawdown,
    });
  }
}

module.exports = TradeJournal;
