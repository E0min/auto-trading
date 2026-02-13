'use strict';

/**
 * SymbolRegimeManager — Manages per-symbol regime trackers.
 *
 * Listens to KLINE_UPDATE events from MarketData, routes klines to the
 * appropriate SymbolRegimeTracker, and emits 'symbol:regime_change' events
 * when a symbol's regime transitions.
 *
 * BTCUSDT is excluded — its regime is handled by the global MarketRegime.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS } = require('../utils/constants');
const SymbolRegimeTracker = require('./symbolRegimeTracker');

const log = createLogger('SymbolRegimeManager');

/** Event name for per-symbol regime changes */
const SYMBOL_REGIME_CHANGE = 'symbol:regime_change';

class SymbolRegimeManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./marketData')} deps.marketData
   */
  constructor({ marketData }) {
    super();

    if (!marketData) {
      throw new Error('SymbolRegimeManager: marketData dependency is required');
    }

    /** @private */
    this._marketData = marketData;

    /** @type {Map<string, SymbolRegimeTracker>} */
    this._trackers = new Map();

    /** @private */
    this._running = false;

    /** @private */
    this._boundOnKline = this._onKline.bind(this);

    log.info('SymbolRegimeManager initialised');
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start tracking regimes for the given symbols.
   * @param {string[]} symbols — symbols to track (BTCUSDT is auto-excluded)
   */
  start(symbols = []) {
    if (this._running) {
      log.info('Already running — skipping start');
      return;
    }

    // Create trackers for non-BTC symbols
    for (const symbol of symbols) {
      if (symbol === 'BTCUSDT') continue;
      this.addSymbol(symbol);
    }

    // Listen to all kline updates
    this._marketData.on(MARKET_EVENTS.KLINE_UPDATE, this._boundOnKline);
    this._running = true;

    log.info('SymbolRegimeManager started', {
      trackedSymbols: [...this._trackers.keys()],
    });
  }

  /**
   * Stop all tracking and clean up.
   */
  stop() {
    if (!this._running) return;

    this._marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, this._boundOnKline);
    this._trackers.clear();
    this._running = false;

    log.info('SymbolRegimeManager stopped');
  }

  // =========================================================================
  // Symbol management
  // =========================================================================

  /**
   * Add a symbol to track.
   * @param {string} symbol
   */
  addSymbol(symbol) {
    if (symbol === 'BTCUSDT') {
      log.debug('addSymbol — BTCUSDT excluded (handled by global MarketRegime)');
      return;
    }

    if (this._trackers.has(symbol)) {
      log.debug('addSymbol — tracker already exists', { symbol });
      return;
    }

    this._trackers.set(symbol, new SymbolRegimeTracker(symbol));
    log.info('Symbol tracker added', { symbol });
  }

  /**
   * Remove a symbol from tracking.
   * @param {string} symbol
   */
  removeSymbol(symbol) {
    if (this._trackers.delete(symbol)) {
      log.info('Symbol tracker removed', { symbol });
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  /**
   * Get the current regime for a specific symbol.
   * @param {string} symbol
   * @returns {{ regime: string, confidence: number, warmedUp: boolean } | null}
   */
  getSymbolRegime(symbol) {
    const tracker = this._trackers.get(symbol);
    if (!tracker) return null;

    return {
      regime: tracker.getCurrentRegime(),
      confidence: tracker.getConfidence(),
      warmedUp: tracker.isWarmedUp(),
    };
  }

  /**
   * Get regimes for all tracked symbols.
   * @returns {Object<string, { regime: string, confidence: number, warmedUp: boolean }>}
   */
  getAllRegimes() {
    const result = {};
    for (const [symbol, tracker] of this._trackers) {
      result[symbol] = {
        regime: tracker.getCurrentRegime(),
        confidence: tracker.getConfidence(),
        warmedUp: tracker.isWarmedUp(),
      };
    }
    return result;
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Handle incoming kline and route to the appropriate tracker.
   * @param {object} kline — { symbol, close, high, low, volume, ... }
   * @private
   */
  _onKline(kline) {
    if (!kline || !kline.symbol) return;

    const tracker = this._trackers.get(kline.symbol);
    if (!tracker) return;

    try {
      const result = tracker.processKline(kline);

      if (result.changed) {
        const payload = {
          symbol: kline.symbol,
          previous: result.previous,
          current: result.current,
          confidence: result.confidence,
          ts: Date.now(),
        };

        this.emit(SYMBOL_REGIME_CHANGE, payload);
      }
    } catch (err) {
      log.error('_onKline error', { symbol: kline.symbol, error: err });
    }
  }
}

module.exports = SymbolRegimeManager;
