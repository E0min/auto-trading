'use strict';

/**
 * PositionManager — real-time position and account state synchronization.
 *
 * Maintains an in-memory mirror of exchange positions and account balances
 * through a combination of periodic REST polling and real-time WebSocket
 * events. Feeds updated state into the RiskEngine so exposure and drawdown
 * checks always use fresh data.
 *
 * Emits:
 *   - TRADE_EVENTS.POSITION_UPDATED
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const { TRADE_EVENTS, CATEGORIES } = require('../utils/constants');

const log = createLogger('PositionManager');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Interval for REST reconciliation (ms) */
const RECONCILIATION_INTERVAL_MS = 30_000;

/** Interval for daily-reset check (ms) */
const DAILY_RESET_CHECK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// PositionManager class
// ---------------------------------------------------------------------------

class PositionManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./riskEngine')}     deps.riskEngine
   */
  constructor({ exchangeClient, riskEngine }) {
    super();

    if (!exchangeClient) throw new Error('PositionManager requires exchangeClient');
    if (!riskEngine) throw new Error('PositionManager requires riskEngine');

    this.exchangeClient = exchangeClient;
    this.riskEngine = riskEngine;

    /** @type {string} Product type used for REST calls */
    this._category = CATEGORIES.USDT_FUTURES;

    /** @type {Map<string, object>} Keyed by `${symbol}:${posSide}` */
    this._positions = new Map();

    /** @type {{ equity: string, availableBalance: string, unrealizedPnl: string }} */
    this._accountState = {
      equity: '0',
      availableBalance: '0',
      unrealizedPnl: '0',
    };

    /** @type {NodeJS.Timeout|null} */
    this._reconciliationInterval = null;

    /** @type {NodeJS.Timeout|null} */
    this._dailyResetInterval = null;

    /** @type {string|null} ISO date of last daily reset (YYYY-MM-DD) */
    this._lastResetDate = null;

    /** @type {boolean} */
    this._running = false;

    // Bind WS handlers
    this._handleWsPositionUpdate = this._handleWsPositionUpdate.bind(this);
    this._handleWsAccountUpdate = this._handleWsAccountUpdate.bind(this);

    // Attach WS listeners
    this.exchangeClient.on('ws:position', this._handleWsPositionUpdate);
    this.exchangeClient.on('ws:account', this._handleWsAccountUpdate);

    log.info('PositionManager initialised');
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start position tracking.
   * Performs initial REST sync and starts periodic reconciliation / daily reset checks.
   *
   * @param {string} [category='USDT-FUTURES'] — product type to track
   */
  async start(category = CATEGORIES.USDT_FUTURES) {
    if (this._running) {
      log.warn('start — already running, ignoring duplicate call');
      return;
    }

    this._category = category;
    this._running = true;

    log.info('start — beginning position sync', { category });

    // Initial REST sync (best-effort — don't crash if exchange is unreachable)
    try {
      await this.syncPositions();
    } catch (err) {
      log.error('start — initial syncPositions failed', { error: err });
    }

    try {
      await this.syncAccount();
    } catch (err) {
      log.error('start — initial syncAccount failed', { error: err });
    }

    // Periodic reconciliation
    this._reconciliationInterval = setInterval(async () => {
      try {
        await this.syncPositions();
        await this.syncAccount();
      } catch (err) {
        log.error('reconciliation — sync failed', { error: err });
      }
    }, RECONCILIATION_INTERVAL_MS);

    // Daily reset check
    this._dailyResetInterval = setInterval(() => {
      try {
        this._checkDailyReset();
      } catch (err) {
        log.error('dailyResetCheck — failed', { error: err });
      }
    }, DAILY_RESET_CHECK_INTERVAL_MS);

    log.info('start — PositionManager running', {
      category,
      reconciliationIntervalMs: RECONCILIATION_INTERVAL_MS,
      dailyResetCheckIntervalMs: DAILY_RESET_CHECK_INTERVAL_MS,
    });
  }

  /**
   * Stop position tracking and clear all intervals.
   */
  stop() {
    if (!this._running) {
      log.warn('stop — not running, ignoring');
      return;
    }

    if (this._reconciliationInterval) {
      clearInterval(this._reconciliationInterval);
      this._reconciliationInterval = null;
    }

    if (this._dailyResetInterval) {
      clearInterval(this._dailyResetInterval);
      this._dailyResetInterval = null;
    }

    this._running = false;
    log.info('stop — PositionManager stopped');
  }

  // =========================================================================
  // REST — Position sync
  // =========================================================================

  /**
   * Fetch current positions from the exchange via REST and reconcile
   * with the internal positions Map.
   */
  async syncPositions() {
    log.debug('syncPositions — fetching from exchange', { category: this._category });

    const response = await this.exchangeClient.getCurrentPositions({
      category: this._category,
    });

    const rawPositions = Array.isArray(response?.data) ? response.data : [];

    // Rebuild positions map from the authoritative REST response
    this._positions.clear();

    for (const raw of rawPositions) {
      const entry = this._parsePositionEntry(raw);
      if (entry && !math.isZero(entry.qty)) {
        const key = `${entry.symbol}:${entry.posSide}`;
        this._positions.set(key, entry);
      }
    }

    const positionsArray = this.getPositions();

    log.info('syncPositions — done', {
      positionCount: positionsArray.length,
      symbols: positionsArray.map((p) => `${p.symbol}:${p.posSide}`),
    });

    // Emit event
    this.emit(TRADE_EVENTS.POSITION_UPDATED, { positions: positionsArray });

    // Feed riskEngine
    this.riskEngine.updateAccountState({ positions: positionsArray });
  }

  // =========================================================================
  // REST — Account sync
  // =========================================================================

  /**
   * Fetch account balances from the exchange via REST and update
   * internal account state.
   */
  async syncAccount() {
    log.debug('syncAccount — fetching from exchange');

    const response = await this.exchangeClient.getBalances(this._category);

    // Bitget response structure may vary; handle common shapes
    const rawAccounts = Array.isArray(response?.data) ? response.data : [];

    if (rawAccounts.length === 0) {
      log.debug('syncAccount — no account data returned');
      return;
    }

    // Use the first account entry (or USDT-specific one if present)
    const account = rawAccounts[0];

    const equity = String(account.equity ?? account.accountEquity ?? account.usdtEquity ?? '0');
    const availableBalance = String(
      account.available ?? account.availableBalance ?? account.crossMaxAvailable ?? '0'
    );
    const unrealizedPnl = String(account.unrealizedPL ?? account.unrealizedPnl ?? account.crossedUnPnl ?? '0');

    this._accountState = {
      equity,
      availableBalance,
      unrealizedPnl,
    };

    log.info('syncAccount — done', {
      equity,
      availableBalance,
      unrealizedPnl,
    });

    // Feed riskEngine with updated equity
    this.riskEngine.updateAccountState({ equity });
  }

  // =========================================================================
  // WebSocket — Position update handler
  // =========================================================================

  /**
   * Handle real-time position updates from the exchange WS.
   *
   * @param {object} event — normalised WS event { topic, data, ts }
   * @private
   */
  _handleWsPositionUpdate(event) {
    try {
      const updates = Array.isArray(event.data) ? event.data : [event.data];

      for (const raw of updates) {
        const entry = this._parsePositionEntry(raw);
        if (!entry) continue;

        const key = `${entry.symbol}:${entry.posSide}`;

        if (math.isZero(entry.qty)) {
          // Position closed — remove from map
          this._positions.delete(key);
          log.trade('_handleWsPositionUpdate — position closed', {
            symbol: entry.symbol,
            posSide: entry.posSide,
          });
        } else {
          this._positions.set(key, entry);
          log.trade('_handleWsPositionUpdate — position updated', {
            symbol: entry.symbol,
            posSide: entry.posSide,
            qty: entry.qty,
            unrealizedPnl: entry.unrealizedPnl,
          });
        }
      }

      const positionsArray = this.getPositions();

      this.emit(TRADE_EVENTS.POSITION_UPDATED, { positions: positionsArray });

      // Feed riskEngine
      this.riskEngine.updateAccountState({ positions: positionsArray });
    } catch (err) {
      log.error('_handleWsPositionUpdate — error', { error: err });
    }
  }

  // =========================================================================
  // WebSocket — Account update handler
  // =========================================================================

  /**
   * Handle real-time account balance updates from the exchange WS.
   *
   * @param {object} event — normalised WS event { topic, data, ts }
   * @private
   */
  _handleWsAccountUpdate(event) {
    try {
      const updates = Array.isArray(event.data) ? event.data : [event.data];

      for (const raw of updates) {
        const equity = raw.equity ?? raw.accountEquity ?? raw.usdtEquity;
        const availableBalance = raw.available ?? raw.availableBalance ?? raw.crossMaxAvailable;
        const unrealizedPnl = raw.unrealizedPL ?? raw.unrealizedPnl ?? raw.crossedUnPnl;

        if (equity !== undefined) {
          this._accountState.equity = String(equity);
        }
        if (availableBalance !== undefined) {
          this._accountState.availableBalance = String(availableBalance);
        }
        if (unrealizedPnl !== undefined) {
          this._accountState.unrealizedPnl = String(unrealizedPnl);
        }
      }

      log.debug('_handleWsAccountUpdate — account state updated', {
        equity: this._accountState.equity,
        availableBalance: this._accountState.availableBalance,
        unrealizedPnl: this._accountState.unrealizedPnl,
      });

      // Feed riskEngine with updated equity
      this.riskEngine.updateAccountState({ equity: this._accountState.equity });
    } catch (err) {
      log.error('_handleWsAccountUpdate — error', { error: err });
    }
  }

  // =========================================================================
  // Daily reset
  // =========================================================================

  /**
   * Check if we have crossed midnight UTC since the last daily reset.
   * If so, call riskEngine.resetDaily() to clear daily loss counters.
   *
   * @private
   */
  _checkDailyReset() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const todayDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

    if (utcHour === 0 && this._lastResetDate !== todayDate) {
      log.info('_checkDailyReset — midnight UTC detected, resetting daily risk counters', {
        todayDate,
        lastResetDate: this._lastResetDate,
      });

      this.riskEngine.resetDaily();
      this._lastResetDate = todayDate;
    }
  }

  // =========================================================================
  // Public — Accessors
  // =========================================================================

  /**
   * Get all current positions as an array.
   *
   * @returns {Array<object>}
   */
  getPositions() {
    return Array.from(this._positions.values());
  }

  /**
   * Get a snapshot of the current account state.
   *
   * @returns {{ equity: string, availableBalance: string, unrealizedPnl: string }}
   */
  getAccountState() {
    return { ...this._accountState };
  }

  /**
   * Get a specific position by symbol and posSide.
   *
   * @param {string} symbol  — e.g. 'BTCUSDT'
   * @param {string} posSide — 'long' | 'short'
   * @returns {object|null}
   */
  getPosition(symbol, posSide) {
    const key = `${symbol}:${posSide}`;
    return this._positions.get(key) || null;
  }

  // =========================================================================
  // Internal — Position entry parser
  // =========================================================================

  /**
   * Normalise a raw position object (from REST or WS) into the internal format.
   *
   * @param {object} raw
   * @returns {object|null}
   * @private
   */
  _parsePositionEntry(raw) {
    if (!raw) return null;

    const symbol = raw.symbol || raw.instId;
    if (!symbol) return null;

    const posSide = (raw.holdSide || raw.posSide || raw.side || 'long').toLowerCase();

    return {
      symbol,
      posSide,
      qty: String(raw.total || raw.holdAmount || raw.available || raw.size || raw.pos || '0'),
      entryPrice: String(raw.openPriceAvg || raw.averageOpenPrice || raw.entryPrice || raw.avgPx || '0'),
      markPrice: String(raw.markPrice || raw.marketPrice || '0'),
      unrealizedPnl: String(raw.unrealizedPL || raw.unrealizedPnl || raw.achievedProfits || raw.upl || '0'),
      leverage: String(raw.leverage || '1'),
      marginMode: raw.marginMode || raw.marginCoin ? 'crossed' : 'crossed',
      liquidationPrice: String(raw.liquidationPrice || raw.liqPx || '0'),
      updatedAt: new Date(),
    };
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Remove WS event listeners and stop all intervals.
   * Call when shutting down the PositionManager.
   */
  destroy() {
    this.stop();
    this.exchangeClient.removeListener('ws:position', this._handleWsPositionUpdate);
    this.exchangeClient.removeListener('ws:account', this._handleWsAccountUpdate);
    log.info('PositionManager destroyed — WS listeners removed');
  }
}

module.exports = PositionManager;
