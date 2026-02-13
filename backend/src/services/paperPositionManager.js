'use strict';

/**
 * PaperPositionManager — virtual position and balance tracker for paper trading.
 *
 * Maintains in-memory positions and a virtual USDT balance.
 * Provides the same interface as PositionManager (getPositions, getAccountState)
 * so that the rest of the system (API routes, analytics, frontend) works unchanged.
 *
 * Emits:
 *   - TRADE_EVENTS.POSITION_UPDATED
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const { TRADE_EVENTS } = require('../utils/constants');

const log = createLogger('PaperPositionManager');

const DEFAULT_INITIAL_BALANCE = '10000';

// ---------------------------------------------------------------------------
// PaperPositionManager class
// ---------------------------------------------------------------------------

class PaperPositionManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./riskEngine')} opts.riskEngine
   * @param {string} [opts.initialBalance] — starting USDT balance (String)
   */
  constructor({ riskEngine, initialBalance } = {}) {
    super();

    this.riskEngine = riskEngine || null;
    this._initialBalance = initialBalance || DEFAULT_INITIAL_BALANCE;

    /**
     * Virtual balance in USDT.
     * @type {string}
     */
    this._balance = this._initialBalance;

    /**
     * Open positions keyed by "symbol:posSide".
     * @type {Map<string, object>}
     */
    this._positions = new Map();

    log.info('PaperPositionManager initialised', {
      initialBalance: this._initialBalance,
    });
  }

  // =========================================================================
  // Fill processing
  // =========================================================================

  /**
   * Process a fill from PaperEngine. Creates / increases / reduces positions
   * and updates the virtual balance accordingly.
   *
   * @param {object} fill — from PaperEngine 'paper:fill' event
   * @param {string} fill.clientOid
   * @param {string} fill.symbol
   * @param {string} fill.side       — 'buy' | 'sell'
   * @param {string} fill.posSide    — 'long' | 'short'
   * @param {string} fill.qty
   * @param {string} fill.fillPrice
   * @param {string} fill.fee
   * @param {boolean} fill.reduceOnly
   * @returns {{ pnl: string|null, position: object|null }}
   */
  onFill(fill) {
    const { symbol, side, posSide, qty, fillPrice, fee, reduceOnly, strategy } = fill;
    const key = `${symbol}:${posSide}`;

    // Deduct fee from balance
    this._balance = math.subtract(this._balance, fee);

    let pnl = null;
    let position = null;

    if (reduceOnly) {
      // Closing (reduce) — calculate PnL and reduce/remove position
      pnl = this._closePosition(key, qty, fillPrice, posSide);
      position = this._positions.get(key) || null;
    } else {
      // Opening — create or increase position
      position = this._openPosition(key, {
        symbol,
        posSide,
        qty,
        entryPrice: fillPrice,
        strategy,
      });
    }

    // Emit position update
    const positionsArray = this.getPositions();
    this.emit(TRADE_EVENTS.POSITION_UPDATED, { positions: positionsArray });

    // Feed riskEngine if available
    if (this.riskEngine) {
      this.riskEngine.updateAccountState({
        positions: positionsArray,
        equity: this.getEquity(),
      });
    }

    log.trade('onFill — processed', {
      symbol,
      side,
      posSide,
      qty,
      fillPrice,
      fee,
      pnl,
      balance: this._balance,
      reduceOnly,
    });

    return { pnl, position };
  }

  // =========================================================================
  // Open position (create or add)
  // =========================================================================

  /**
   * @param {string} key — "symbol:posSide"
   * @param {object} params
   * @returns {object} position
   * @private
   */
  _openPosition(key, { symbol, posSide, qty, entryPrice, strategy }) {
    const existing = this._positions.get(key);

    if (existing) {
      // Increase position — weighted average entry price
      const oldNotional = math.multiply(existing.qty, existing.entryPrice);
      const newNotional = math.multiply(qty, entryPrice);
      const totalQty = math.add(existing.qty, qty);
      const avgEntryPrice = math.divide(math.add(oldNotional, newNotional), totalQty);

      existing.qty = totalQty;
      existing.entryPrice = avgEntryPrice;
      existing.updatedAt = new Date();
      if (strategy) existing.strategy = strategy;

      log.info('_openPosition — increased', { key, totalQty, avgEntryPrice });
      return existing;
    }

    // New position
    const position = {
      symbol,
      posSide,
      qty,
      entryPrice,
      markPrice: entryPrice,
      unrealizedPnl: '0',
      leverage: '1',
      marginMode: 'crossed',
      liquidationPrice: '0',
      strategy: strategy || null,
      updatedAt: new Date(),
    };

    this._positions.set(key, position);
    log.info('_openPosition — created', { key, qty, entryPrice, strategy });
    return position;
  }

  // =========================================================================
  // Close position (reduce or remove)
  // =========================================================================

  /**
   * @param {string} key
   * @param {string} closeQty
   * @param {string} closePrice
   * @param {string} posSide
   * @returns {string|null} realised PnL (String) or null
   * @private
   */
  _closePosition(key, closeQty, closePrice, posSide) {
    const position = this._positions.get(key);
    if (!position) {
      log.warn('_closePosition — no position found', { key });
      return null;
    }

    const entryPrice = position.entryPrice;
    let pnl;

    if (posSide === 'long') {
      // Long close: profit when exit > entry
      pnl = math.multiply(math.subtract(closePrice, entryPrice), closeQty);
    } else {
      // Short close: profit when entry > exit
      pnl = math.multiply(math.subtract(entryPrice, closePrice), closeQty);
    }

    // Credit PnL to balance
    this._balance = math.add(this._balance, pnl);

    // Reduce or remove position
    const remainingQty = math.subtract(position.qty, closeQty);

    if (math.isZero(remainingQty) || math.isLessThan(remainingQty, '0')) {
      // Fully closed
      this._positions.delete(key);
      log.info('_closePosition — fully closed', { key, pnl });
    } else {
      position.qty = remainingQty;
      position.updatedAt = new Date();
      log.info('_closePosition — partially closed', { key, remainingQty, pnl });
    }

    return pnl;
  }

  // =========================================================================
  // Mark price update (unrealized PnL)
  // =========================================================================

  /**
   * Update the mark price for a symbol and recalculate unrealized PnL.
   *
   * @param {string} symbol
   * @param {string} price — current market price
   */
  updateMarkPrice(symbol, price) {
    for (const [key, position] of this._positions) {
      if (position.symbol !== symbol) continue;

      position.markPrice = price;

      if (position.posSide === 'long') {
        position.unrealizedPnl = math.multiply(
          math.subtract(price, position.entryPrice),
          position.qty
        );
      } else {
        position.unrealizedPnl = math.multiply(
          math.subtract(position.entryPrice, price),
          position.qty
        );
      }

      position.updatedAt = new Date();
    }
  }

  // =========================================================================
  // Public accessors (PositionManager-compatible interface)
  // =========================================================================

  /**
   * Get all current positions as an array.
   * @returns {Array<object>}
   */
  getPositions() {
    return Array.from(this._positions.values());
  }

  /**
   * Get a specific position.
   * @param {string} symbol
   * @param {string} posSide
   * @returns {object|null}
   */
  getPosition(symbol, posSide) {
    return this._positions.get(`${symbol}:${posSide}`) || null;
  }

  /**
   * Get a snapshot of the virtual account state.
   * @returns {{ equity: string, availableBalance: string, unrealizedPnl: string }}
   */
  getAccountState() {
    const totalUnrealizedPnl = this._calcTotalUnrealizedPnl();
    const equity = math.add(this._balance, totalUnrealizedPnl);

    return {
      equity,
      availableBalance: this._balance,
      unrealizedPnl: totalUnrealizedPnl,
    };
  }

  /**
   * Get equity as a single string value.
   * @returns {string}
   */
  getEquity() {
    return math.add(this._balance, this._calcTotalUnrealizedPnl());
  }

  /**
   * Get raw balance (without unrealized PnL).
   * @returns {string}
   */
  getBalance() {
    return this._balance;
  }

  // =========================================================================
  // Reset
  // =========================================================================

  /**
   * Reset the paper account — clear all positions and restore initial balance.
   * @param {string} [initialBalance] — override initial balance
   */
  reset(initialBalance) {
    if (initialBalance) {
      this._initialBalance = initialBalance;
    }

    this._balance = this._initialBalance;
    this._positions.clear();

    log.info('reset — paper account reset', { initialBalance: this._initialBalance });

    this.emit(TRADE_EVENTS.POSITION_UPDATED, { positions: [] });
  }

  // =========================================================================
  // PositionManager lifecycle compatibility (no-op for paper)
  // =========================================================================

  async start() {
    log.info('start — PaperPositionManager ready (no-op)');
  }

  stop() {
    log.info('stop — PaperPositionManager stopped (no-op)');
  }

  destroy() {
    log.info('destroy — PaperPositionManager destroyed (no-op)');
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Calculate total unrealized PnL across all positions.
   * @returns {string}
   * @private
   */
  _calcTotalUnrealizedPnl() {
    let total = '0';
    for (const position of this._positions.values()) {
      total = math.add(total, position.unrealizedPnl || '0');
    }
    return total;
  }
}

module.exports = PaperPositionManager;
