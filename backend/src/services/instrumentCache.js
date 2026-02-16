'use strict';

/**
 * InstrumentCache — Caches per-symbol instrument specifications from Bitget.
 *
 * Fetches contract configuration (lot step, min/max qty, tick size) and
 * stores them for fast lookup. Auto-refreshes every 24 hours.
 *
 * All numeric values are stored as Strings to conform to the project's
 * monetary-value convention.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('InstrumentCache');

/** Default auto-refresh interval: 24 hours */
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

class InstrumentCache {
  /**
   * @param {object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   */
  constructor({ exchangeClient }) {
    if (!exchangeClient) throw new Error('InstrumentCache requires exchangeClient');

    this._exchangeClient = exchangeClient;

    /** @type {Map<string, { lotStep: string, minQty: string, maxQty: string, tickSize: string }>} */
    this._instruments = new Map();

    /** @type {number} Last successful refresh timestamp */
    this._lastRefresh = 0;

    /** @type {number} Auto-refresh interval in ms */
    this._refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;

    /** @type {NodeJS.Timeout|null} */
    this._refreshTimer = null;

    /** @type {number} Consecutive refresh failure counter (E12-15) */
    this._consecutiveFailures = 0;
  }

  // =========================================================================
  // Core methods
  // =========================================================================

  /**
   * Fetch instrument configuration from the exchange and populate the cache.
   *
   * Bitget getFuturesContractConfig response fields:
   *   - symbol:         e.g. 'BTCUSDT'
   *   - sizeMultiplier: lot step (minimum size increment)
   *   - minTradeNum:    minimum trade quantity
   *   - maxTradeNum:    maximum trade quantity (per order)
   *   - pricePlace:     price decimal precision (used to derive tick size)
   *   - priceEndStep:   price end step (e.g. '1' or '5')
   *
   * @param {string} [category='USDT-FUTURES'] — product type
   */
  async refresh(category = 'USDT-FUTURES') {
    try {
      log.info('Refreshing instrument cache', { category });

      const response = await this._exchangeClient.getInstruments({ category });
      const instruments = Array.isArray(response?.data) ? response.data : [];

      if (instruments.length === 0) {
        log.warn('Instrument refresh returned empty data', { category });
        return;
      }

      let count = 0;
      for (const inst of instruments) {
        const symbol = inst.symbol;
        if (!symbol) continue;

        // Derive tick size from pricePlace (decimal precision)
        // e.g. pricePlace=2 → tickSize='0.01', pricePlace=1 → tickSize='0.1'
        const pricePlace = parseInt(inst.pricePlace, 10);
        let tickSize = '0.01'; // default
        if (!isNaN(pricePlace) && pricePlace >= 0) {
          tickSize = (1 / Math.pow(10, pricePlace)).toFixed(pricePlace);
        }

        this._instruments.set(symbol, {
          lotStep: String(inst.sizeMultiplier || '1'),
          minQty: String(inst.minTradeNum || '0'),
          maxQty: String(inst.maxTradeNum || '0'),
          tickSize,
        });
        count++;
      }

      this._lastRefresh = Date.now();
      this._consecutiveFailures = 0;

      log.info('Instrument cache refreshed', {
        category,
        instrumentCount: count,
        totalCached: this._instruments.size,
      });
    } catch (err) {
      this._consecutiveFailures++;
      log.error('Instrument cache refresh failed', {
        category,
        error: err.message,
        consecutiveFailures: this._consecutiveFailures,
      });
      if (this._consecutiveFailures >= 3) {
        log.warn('Instrument cache stale — 3+ consecutive refresh failures', {
          consecutiveFailures: this._consecutiveFailures,
          lastRefresh: this._lastRefresh,
          staleDurationMs: Date.now() - this._lastRefresh,
        });
      }
      // Do not throw — cache retains stale data; callers fall back to defaults
    }
  }

  /**
   * Start periodic auto-refresh.
   *
   * @param {string} [category='USDT-FUTURES']
   */
  startAutoRefresh(category = 'USDT-FUTURES') {
    this.stop(); // Clear any existing timer

    this._refreshTimer = setInterval(() => {
      this.refresh(category).catch((err) => {
        log.error('Auto-refresh failed', { error: err.message });
      });
    }, this._refreshIntervalMs);

    // Prevent the timer from keeping the process alive
    if (this._refreshTimer.unref) this._refreshTimer.unref();

    log.info('Auto-refresh started', {
      intervalMs: this._refreshIntervalMs,
      category,
    });
  }

  /**
   * Stop auto-refresh timer and clean up.
   */
  stop() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  /**
   * Get the lot step (size multiplier / minimum size increment) for a symbol.
   *
   * @param {string} symbol — e.g. 'BTCUSDT'
   * @returns {string} lot step, defaults to '1' on cache miss
   */
  getLotStep(symbol) {
    const info = this._instruments.get(symbol);
    if (!info) {
      log.warn('getLotStep — cache miss, using default', { symbol, default: '1' });
      return '1';
    }
    return info.lotStep;
  }

  /**
   * Get the minimum order quantity for a symbol.
   *
   * @param {string} symbol
   * @returns {string} min qty, defaults to '0' on cache miss
   */
  getMinQty(symbol) {
    const info = this._instruments.get(symbol);
    if (!info) {
      log.warn('getMinQty — cache miss, using default', { symbol, default: '0' });
      return '0';
    }
    return info.minQty;
  }

  /**
   * Get the tick size (price precision) for a symbol.
   *
   * @param {string} symbol
   * @returns {string} tick size, defaults to '0.01' on cache miss
   */
  getTickSize(symbol) {
    const info = this._instruments.get(symbol);
    if (!info) {
      log.warn('getTickSize — cache miss, using default', { symbol, default: '0.01' });
      return '0.01';
    }
    return info.tickSize;
  }

  /**
   * Get the full instrument info for a symbol.
   *
   * @param {string} symbol
   * @returns {{ lotStep: string, minQty: string, maxQty: string, tickSize: string }|null}
   */
  getInstrumentInfo(symbol) {
    return this._instruments.get(symbol) || null;
  }

  /**
   * Get cache status for diagnostics.
   *
   * @returns {{ size: number, lastRefresh: number, refreshIntervalMs: number }}
   */
  getStatus() {
    return {
      size: this._instruments.size,
      lastRefresh: this._lastRefresh,
      refreshIntervalMs: this._refreshIntervalMs,
    };
  }
}

module.exports = InstrumentCache;
