'use strict';

/**
 * PaperEngine — virtual order matching engine for paper trading.
 *
 * Accepts market and limit orders, simulates fills with configurable
 * slippage and fee rates, and emits 'paper:fill' events.
 *
 * Market orders fill instantly at the current ticker price ± slippage.
 * Limit orders are stored in a pending map and checked on each ticker update.
 *
 * Emits:
 *   - 'paper:fill'  { clientOid, symbol, side, posSide, qty, fillPrice, fee, filledAt }
 *   - 'paper:sl_triggered'  { symbol, posSide, triggerPrice, fillPrice }
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');

const log = createLogger('PaperEngine');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FEE_RATE = '0.0006';    // 0.06% taker fee
const DEFAULT_SLIPPAGE_BPS = '5';     // 5 basis points = 0.05%

// ---------------------------------------------------------------------------
// PaperEngine class
// ---------------------------------------------------------------------------

class PaperEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./marketData')} opts.marketData — for reading latest prices
   * @param {string} [opts.feeRate]      — fee rate as decimal string (e.g. '0.0006')
   * @param {string} [opts.slippageBps]  — slippage in basis points (e.g. '5')
   */
  constructor({ marketData, feeRate, slippageBps } = {}) {
    super();

    this.marketData = marketData || null;
    this.feeRate = feeRate || DEFAULT_FEE_RATE;
    this.slippageBps = slippageBps || DEFAULT_SLIPPAGE_BPS;

    /**
     * Pending limit orders keyed by clientOid.
     * @type {Map<string, object>}
     */
    this._pendingOrders = new Map();

    /**
     * Latest ticker prices keyed by symbol.
     * @type {Map<string, string>}
     */
    this._lastPrices = new Map();

    /**
     * Pending stop-loss orders keyed by `${symbol}:${posSide}`.
     * Each entry: { symbol, posSide, triggerPrice, qty, strategy, createdAt }
     * LONG SL triggers when lastPrice <= triggerPrice.
     * SHORT SL triggers when lastPrice >= triggerPrice.
     * @type {Map<string, object>}
     */
    this._pendingSLOrders = new Map();

    /**
     * Pending take-profit orders keyed by `${symbol}:${posSide}`.
     * Each entry: { symbol, posSide, triggerPrice, qty, strategy, createdAt }
     * LONG TP triggers when lastPrice >= triggerPrice.
     * SHORT TP triggers when lastPrice <= triggerPrice.
     * @type {Map<string, object>}
     */
    this._pendingTPOrders = new Map();

    log.info('PaperEngine initialised', {
      feeRate: this.feeRate,
      slippageBps: this.slippageBps,
    });
  }

  // =========================================================================
  // Market order — instant fill
  // =========================================================================

  /**
   * Match a market order immediately at the current price ± slippage.
   *
   * @param {object} params
   * @param {string} params.clientOid
   * @param {string} params.symbol
   * @param {string} params.side       — 'buy' | 'sell'
   * @param {string} params.posSide    — 'long' | 'short'
   * @param {string} params.qty        — order quantity (String)
   * @param {boolean} [params.reduceOnly]
   * @param {string} [params.strategy]
   * @returns {object|null} fill object or null if no price available
   */
  matchMarketOrder(params) {
    const { clientOid, symbol, side, posSide, qty, reduceOnly, strategy } = params;

    const lastPrice = this._lastPrices.get(symbol);
    if (!lastPrice) {
      log.warn('matchMarketOrder — no price available for symbol', { symbol });
      return null;
    }

    const fillPrice = this._applySlippage(lastPrice, side);
    const fill = this._createFill({
      clientOid,
      symbol,
      side,
      posSide,
      qty,
      fillPrice,
      reduceOnly,
      strategy,
    });

    log.trade('matchMarketOrder — market order filled', {
      clientOid,
      symbol,
      side,
      qty,
      fillPrice,
      fee: fill.fee,
    });

    // NOTE: Do NOT emit 'paper:fill' here for market orders.
    // Market fills are processed inline by _submitPaperOrder.
    // Only limit order fills (from onTickerUpdate) should emit this event.
    return fill;
  }

  // =========================================================================
  // Limit order — deferred matching
  // =========================================================================

  /**
   * Submit a limit order. The order is stored and checked on each ticker update.
   *
   * @param {object} params
   * @param {string} params.clientOid
   * @param {string} params.symbol
   * @param {string} params.side       — 'buy' | 'sell'
   * @param {string} params.posSide    — 'long' | 'short'
   * @param {string} params.qty
   * @param {string} params.price      — limit price
   * @param {boolean} [params.reduceOnly]
   * @param {string} [params.strategy]
   * @returns {object} the pending order object
   */
  submitLimitOrder(params) {
    const { clientOid, symbol, side, posSide, qty, price, reduceOnly, strategy } = params;

    const order = {
      clientOid,
      symbol,
      side,
      posSide,
      qty,
      price,
      reduceOnly: reduceOnly || false,
      strategy,
      createdAt: new Date(),
    };

    this._pendingOrders.set(clientOid, order);

    log.info('submitLimitOrder — limit order queued', {
      clientOid,
      symbol,
      side,
      price,
      qty,
    });

    return order;
  }

  // =========================================================================
  // Ticker-driven limit order matching
  // =========================================================================

  /**
   * Called on each ticker update. Checks all pending limit orders for
   * the given symbol and fills those whose conditions are met.
   *
   * Limit buy fills when lastPrice <= order.price.
   * Limit sell fills when lastPrice >= order.price.
   *
   * @param {string} symbol
   * @param {object} ticker — { lastPrice, ... }
   */
  onTickerUpdate(symbol, ticker) {
    const lastPrice = ticker.lastPrice || ticker.last || ticker.price;
    if (!lastPrice) return;

    // Update cached price
    this._lastPrices.set(symbol, String(lastPrice));

    // E11-7: Clean up stale pending orders (>30min) and enforce size limit
    this._cleanupStaleOrders();

    // Check pending limit orders for this symbol
    for (const [clientOid, order] of this._pendingOrders) {
      if (order.symbol !== symbol) continue;

      let shouldFill = false;

      if (order.side === 'buy' && !math.isGreaterThan(String(lastPrice), order.price)) {
        shouldFill = true;
      } else if (order.side === 'sell' && !math.isLessThan(String(lastPrice), order.price)) {
        shouldFill = true;
      }

      if (shouldFill) {
        this._pendingOrders.delete(clientOid);

        // Limit orders fill at the limit price (no slippage)
        const fill = this._createFill({
          clientOid: order.clientOid,
          symbol: order.symbol,
          side: order.side,
          posSide: order.posSide,
          qty: order.qty,
          fillPrice: order.price,
          reduceOnly: order.reduceOnly,
          strategy: order.strategy,
        });

        log.trade('onTickerUpdate — limit order filled', {
          clientOid,
          symbol,
          side: order.side,
          price: order.price,
          qty: order.qty,
          fee: fill.fee,
        });

        this.emit('paper:fill', fill);
      }
    }

    // Check pending stop-loss triggers for this symbol (SL has priority over TP)
    this._checkStopLossTriggers(symbol, String(lastPrice));

    // R11-T11: Check pending take-profit triggers for this symbol
    this._checkTakeProfitTriggers(symbol, String(lastPrice));
  }

  /**
   * Check all pending SL orders for the given symbol and trigger
   * those whose conditions are met.
   *
   * LONG SL triggers when lastPrice <= triggerPrice (sell to close).
   * SHORT SL triggers when lastPrice >= triggerPrice (buy to close).
   *
   * @param {string} symbol
   * @param {string} lastPrice
   * @private
   */
  _checkStopLossTriggers(symbol, lastPrice) {
    for (const [key, sl] of this._pendingSLOrders) {
      if (sl.symbol !== symbol) continue;

      let triggered = false;

      // LONG position SL: triggers when price falls to or below triggerPrice
      if (sl.posSide === 'long' && !math.isGreaterThan(lastPrice, sl.triggerPrice)) {
        triggered = true;
      }
      // SHORT position SL: triggers when price rises to or above triggerPrice
      else if (sl.posSide === 'short' && !math.isLessThan(lastPrice, sl.triggerPrice)) {
        triggered = true;
      }

      if (triggered) {
        this._pendingSLOrders.delete(key);

        // SL fills as a market order at trigger price with slippage
        const closeSide = sl.posSide === 'long' ? 'sell' : 'buy';
        const fillPrice = this._applySlippage(sl.triggerPrice, closeSide);

        const fill = this._createFill({
          clientOid: `sl_${sl.symbol}_${sl.posSide}_${Date.now()}`,
          symbol: sl.symbol,
          side: closeSide,
          posSide: sl.posSide,
          qty: sl.qty,
          fillPrice,
          reduceOnly: true,
          strategy: sl.strategy,
        });

        // Mark fill as SL-triggered for downstream handling
        fill.reason = 'stop_loss_triggered';
        fill.triggerPrice = sl.triggerPrice;

        log.trade('_checkStopLossTriggers — SL triggered', {
          symbol: sl.symbol,
          posSide: sl.posSide,
          triggerPrice: sl.triggerPrice,
          fillPrice,
          qty: sl.qty,
        });

        this.emit('paper:fill', fill);
        this.emit('paper:sl_triggered', {
          symbol: sl.symbol,
          posSide: sl.posSide,
          triggerPrice: sl.triggerPrice,
          fillPrice,
        });
      }
    }
  }

  /**
   * Check all pending TP orders for the given symbol and trigger
   * those whose conditions are met (R11-T11 AD-68).
   *
   * LONG TP triggers when lastPrice >= triggerPrice (sell to close).
   * SHORT TP triggers when lastPrice <= triggerPrice (buy to close).
   *
   * @param {string} symbol
   * @param {string} lastPrice
   * @private
   */
  _checkTakeProfitTriggers(symbol, lastPrice) {
    for (const [key, tp] of this._pendingTPOrders) {
      if (tp.symbol !== symbol) continue;

      let triggered = false;

      // LONG position TP: triggers when price rises to or above triggerPrice
      if (tp.posSide === 'long' && !math.isLessThan(lastPrice, tp.triggerPrice)) {
        triggered = true;
      }
      // SHORT position TP: triggers when price falls to or below triggerPrice
      else if (tp.posSide === 'short' && !math.isGreaterThan(lastPrice, tp.triggerPrice)) {
        triggered = true;
      }

      if (triggered) {
        this._pendingTPOrders.delete(key);
        // Also remove the associated SL order since position is being closed
        this._pendingSLOrders.delete(key);

        // TP fills as a market order at trigger price with slippage
        const closeSide = tp.posSide === 'long' ? 'sell' : 'buy';
        const fillPrice = this._applySlippage(tp.triggerPrice, closeSide);

        const fill = this._createFill({
          clientOid: `tp_${tp.symbol}_${tp.posSide}_${Date.now()}`,
          symbol: tp.symbol,
          side: closeSide,
          posSide: tp.posSide,
          qty: tp.qty,
          fillPrice,
          reduceOnly: true,
          strategy: tp.strategy,
        });

        // Mark fill as TP-triggered for downstream handling
        fill.reason = 'take_profit_triggered';
        fill.triggerPrice = tp.triggerPrice;

        log.trade('_checkTakeProfitTriggers — TP triggered', {
          symbol: tp.symbol,
          posSide: tp.posSide,
          triggerPrice: tp.triggerPrice,
          fillPrice,
          qty: tp.qty,
        });

        this.emit('paper:fill', fill);
        this.emit('paper:tp_triggered', {
          symbol: tp.symbol,
          posSide: tp.posSide,
          triggerPrice: tp.triggerPrice,
          fillPrice,
        });
      }
    }
  }

  /**
   * Clean up stale pending limit orders older than 30 minutes.
   * Also enforces a max size of 50 orders (FIFO eviction).
   * @private
   */
  _cleanupStaleOrders() {
    const now = Date.now();
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

    // Remove stale orders (>30min)
    for (const [clientOid, order] of this._pendingOrders) {
      const createdAt = order.createdAt instanceof Date ? order.createdAt.getTime() : now;
      if (now - createdAt > STALE_THRESHOLD_MS) {
        this._pendingOrders.delete(clientOid);
        log.info('_cleanupStaleOrders — stale order removed', { clientOid, symbol: order.symbol, ageMs: now - createdAt });
        this.emit('paper:orderCancelled', { clientOid, symbol: order.symbol, reason: 'stale_timeout' });
      }
    }

    // Enforce max size of 50 (FIFO)
    const MAX_PENDING = 50;
    if (this._pendingOrders.size > MAX_PENDING) {
      const excess = this._pendingOrders.size - MAX_PENDING;
      let removed = 0;
      for (const [clientOid, order] of this._pendingOrders) {
        if (removed >= excess) break;
        this._pendingOrders.delete(clientOid);
        log.info('_cleanupStaleOrders — excess order evicted (FIFO)', { clientOid, symbol: order.symbol });
        this.emit('paper:orderCancelled', { clientOid, symbol: order.symbol, reason: 'max_pending_exceeded' });
        removed++;
      }
    }
  }

  // =========================================================================
  // Cancel
  // =========================================================================

  /**
   * Cancel a pending limit order.
   *
   * @param {string} clientOid
   * @returns {boolean} true if the order was found and cancelled
   */
  cancelOrder(clientOid) {
    const existed = this._pendingOrders.has(clientOid);
    this._pendingOrders.delete(clientOid);

    if (existed) {
      log.info('cancelOrder — limit order cancelled', { clientOid });
    } else {
      log.warn('cancelOrder — order not found in pending', { clientOid });
    }

    return existed;
  }

  // =========================================================================
  // Exchange-side Stop Loss simulation
  // =========================================================================

  /**
   * Register a stop-loss trigger for a filled entry order.
   * Called after a market/limit order fill when the original signal
   * carried a `stopLossPrice`.
   *
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.posSide    — 'long' | 'short'
   * @param {string} params.triggerPrice — price at which SL triggers
   * @param {string} params.qty        — quantity to close
   * @param {string} [params.strategy]
   */
  registerStopLoss({ symbol, posSide, triggerPrice, qty, strategy }) {
    if (!symbol || !posSide || !triggerPrice || !qty) {
      log.warn('registerStopLoss — missing required params', { symbol, posSide, triggerPrice, qty });
      return;
    }

    const key = `${symbol}:${posSide}`;
    this._pendingSLOrders.set(key, {
      symbol,
      posSide,
      triggerPrice: String(triggerPrice),
      qty: String(qty),
      strategy: strategy || 'unknown',
      createdAt: new Date(),
    });

    log.info('registerStopLoss — SL trigger registered', {
      symbol,
      posSide,
      triggerPrice,
      qty,
    });
  }

  /**
   * Cancel a pending stop-loss trigger (e.g. when position is closed normally).
   *
   * @param {string} symbol
   * @param {string} posSide — 'long' | 'short'
   * @returns {boolean} true if a pending SL was found and removed
   */
  cancelStopLoss(symbol, posSide) {
    const key = `${symbol}:${posSide}`;
    const existed = this._pendingSLOrders.has(key);
    this._pendingSLOrders.delete(key);

    if (existed) {
      log.info('cancelStopLoss — SL trigger cancelled', { symbol, posSide });
    }

    return existed;
  }

  /**
   * Get all pending stop-loss orders.
   * @returns {Array<object>}
   */
  getPendingSLOrders() {
    return Array.from(this._pendingSLOrders.values());
  }

  // =========================================================================
  // Exchange-side Take Profit simulation (R11-T11 AD-68)
  // =========================================================================

  /**
   * Register a take-profit trigger for a filled entry order.
   * Called after a market/limit order fill when the original signal
   * carried a `takeProfitPrice`.
   *
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.posSide    — 'long' | 'short'
   * @param {string} params.triggerPrice — price at which TP triggers
   * @param {string} params.qty        — quantity to close
   * @param {string} [params.strategy]
   */
  registerTakeProfit({ symbol, posSide, triggerPrice, qty, strategy }) {
    if (!symbol || !posSide || !triggerPrice || !qty) {
      log.warn('registerTakeProfit — missing required params', { symbol, posSide, triggerPrice, qty });
      return;
    }

    const key = `${symbol}:${posSide}`;
    this._pendingTPOrders.set(key, {
      symbol,
      posSide,
      triggerPrice: String(triggerPrice),
      qty: String(qty),
      strategy: strategy || 'unknown',
      createdAt: new Date(),
    });

    log.info('registerTakeProfit — TP trigger registered', {
      symbol,
      posSide,
      triggerPrice,
      qty,
    });
  }

  /**
   * Cancel a pending take-profit trigger (e.g. when position is closed normally).
   *
   * @param {string} symbol
   * @param {string} posSide — 'long' | 'short'
   * @returns {boolean} true if a pending TP was found and removed
   */
  cancelTakeProfit(symbol, posSide) {
    const key = `${symbol}:${posSide}`;
    const existed = this._pendingTPOrders.has(key);
    this._pendingTPOrders.delete(key);

    if (existed) {
      log.info('cancelTakeProfit — TP trigger cancelled', { symbol, posSide });
    }

    return existed;
  }

  /**
   * Get all pending take-profit orders.
   * @returns {Array<object>}
   */
  getPendingTPOrders() {
    return Array.from(this._pendingTPOrders.values());
  }

  // =========================================================================
  // Reset
  // =========================================================================

  /**
   * Reset all pending orders, SL triggers, and cached prices.
   * Called on bot stop to ensure clean state for next start.
   */
  reset() {
    const pendingCount = this._pendingOrders.size;
    const slCount = this._pendingSLOrders.size;
    const tpCount = this._pendingTPOrders.size;
    this._pendingOrders.clear();
    this._pendingSLOrders.clear();
    this._pendingTPOrders.clear();
    this._lastPrices.clear();
    log.info('PaperEngine reset', { clearedOrders: pendingCount, clearedSL: slCount, clearedTP: tpCount });
  }

  // =========================================================================
  // Queries
  // =========================================================================

  /**
   * Get all pending limit orders.
   * @returns {Array<object>}
   */
  getPendingOrders() {
    return Array.from(this._pendingOrders.values());
  }

  /**
   * Get the latest cached price for a symbol.
   * @param {string} symbol
   * @returns {string|null}
   */
  getLastPrice(symbol) {
    return this._lastPrices.get(symbol) || null;
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Apply slippage to a price based on the order side.
   * Buy orders fill slightly higher; sell orders fill slightly lower.
   *
   * slippage = price × (slippageBps / 10000)
   *
   * @param {string} price
   * @param {string} side — 'buy' | 'sell'
   * @returns {string} adjusted price
   * @private
   */
  _applySlippage(price, side) {
    const slippageFactor = math.divide(this.slippageBps, '10000');
    const slippageAmount = math.multiply(price, slippageFactor);

    if (side === 'buy') {
      return math.add(price, slippageAmount);
    } else {
      return math.subtract(price, slippageAmount);
    }
  }

  /**
   * Create a fill object with fee calculation.
   *
   * @param {object} params
   * @param {string} params.clientOid
   * @param {string} params.symbol
   * @param {string} params.side
   * @param {string} params.posSide
   * @param {string} params.qty
   * @param {string} params.fillPrice
   * @param {boolean} [params.reduceOnly]
   * @param {string} [params.strategy]
   * @returns {object} fill
   * @private
   */
  _createFill({ clientOid, symbol, side, posSide, qty, fillPrice, reduceOnly, strategy }) {
    // fee = qty × fillPrice × feeRate
    const notional = math.multiply(qty, fillPrice);
    const fee = math.multiply(notional, this.feeRate);

    return {
      clientOid,
      symbol,
      side,
      posSide,
      qty,
      fillPrice,
      fee,
      notional,
      reduceOnly: reduceOnly || false,
      strategy: strategy || 'unknown',
      filledAt: new Date(),
    };
  }
}

module.exports = PaperEngine;
