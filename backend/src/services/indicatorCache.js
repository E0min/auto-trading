'use strict';

/**
 * IndicatorCache — shared kline history + indicator caching per symbol.
 *
 * Listens to KLINE_UPDATE events from MarketData, maintains per-symbol
 * kline/close/high/low/volume histories (max 500), and caches indicator
 * results that are invalidated on each new kline arrival.
 *
 * Strategies call `get(symbol, indicator, params)` instead of computing
 * indicators themselves, eliminating redundant O(n) recalculations when
 * 18 strategies share the same symbol.
 */

const { MARKET_EVENTS } = require('../utils/constants');
const {
  rsi,
  atr,
  adx,
  bollingerBands,
  emaFromArray,
  sma,
  macd,
  macdHistogramArray,
  stochastic,
  vwap,
  keltnerChannel,
} = require('../utils/indicators');
const { createLogger } = require('../utils/logger');

const log = createLogger('IndicatorCache');

const MAX_HISTORY = 500;

class IndicatorCache {
  /**
   * @param {object} deps
   * @param {import('./marketData')} deps.marketData — event source for KLINE_UPDATE
   */
  constructor({ marketData }) {
    if (!marketData) throw new Error('IndicatorCache requires marketData');

    this.marketData = marketData;

    /**
     * Per-symbol data store.
     * @type {Map<string, {
     *   klines: Array<{high:string, low:string, close:string, open:string, volume:string}>,
     *   closes: string[],
     *   highs: string[],
     *   lows: string[],
     *   volumes: string[],
     *   cache: Map<string, any>
     * }>}
     */
    this._data = new Map();

    /** @type {Function|null} bound listener for cleanup */
    this._onKline = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start listening to KLINE_UPDATE events.
   * Must be called BEFORE strategies start receiving klines so that the
   * cache is populated first (event registration order matters).
   */
  start() {
    this._onKline = (kline) => this._handleKline(kline);
    this.marketData.on(MARKET_EVENTS.KLINE_UPDATE, this._onKline);
    log.info('IndicatorCache started');
  }

  /**
   * Stop listening and clear all cached data.
   */
  stop() {
    if (this._onKline) {
      this.marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, this._onKline);
      this._onKline = null;
    }
    this._data.clear();
    log.info('IndicatorCache stopped');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a cached indicator value for a symbol. Computes on first call
   * per kline tick, then returns cached result until the next kline.
   *
   * @param {string} symbol — e.g. 'BTCUSDT'
   * @param {string} indicator — one of: rsi, atr, adx, bb, ema, sma, macd,
   *                              macdHistogram, stochastic, vwap, keltner
   * @param {object} [params={}] — indicator-specific parameters
   * @returns {any} indicator result or null if insufficient data
   */
  get(symbol, indicator, params = {}) {
    const store = this._data.get(symbol);
    if (!store) return null;

    const cacheKey = this._buildCacheKey(indicator, params);

    if (store.cache.has(cacheKey)) {
      return store.cache.get(cacheKey);
    }

    const result = this._compute(store, indicator, params);
    store.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get the shared history arrays for a symbol.
   * Strategies that need raw kline data (e.g. Donchian, custom calcs)
   * can use this instead of maintaining their own arrays.
   *
   * @param {string} symbol
   * @returns {{ klines, closes, highs, lows, volumes }|null}
   */
  getHistory(symbol) {
    const store = this._data.get(symbol);
    if (!store) return null;
    return {
      klines: store.klines,
      closes: store.closes,
      highs: store.highs,
      lows: store.lows,
      volumes: store.volumes,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal — kline ingestion
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming kline event. Appends to the symbol's history
   * arrays and invalidates the indicator cache for that symbol.
   *
   * @param {object} kline — { symbol, close, high, low, open, volume }
   * @private
   */
  _handleKline(kline) {
    if (!kline || !kline.symbol) return;

    const symbol = kline.symbol;
    const close = String(kline.close);
    const high = kline.high !== undefined ? String(kline.high) : close;
    const low = kline.low !== undefined ? String(kline.low) : close;
    const open = kline.open !== undefined ? String(kline.open) : close;
    const volume = kline.volume !== undefined ? String(kline.volume) : '0';

    let store = this._data.get(symbol);
    if (!store) {
      store = {
        klines: [],
        closes: [],
        highs: [],
        lows: [],
        volumes: [],
        cache: new Map(),
      };
      this._data.set(symbol, store);
    }

    // Append
    store.klines.push({ high, low, close, open, volume });
    store.closes.push(close);
    store.highs.push(high);
    store.lows.push(low);
    store.volumes.push(volume);

    // Trim to MAX_HISTORY
    if (store.klines.length > MAX_HISTORY) {
      const excess = store.klines.length - MAX_HISTORY;
      store.klines.splice(0, excess);
      store.closes.splice(0, excess);
      store.highs.splice(0, excess);
      store.lows.splice(0, excess);
      store.volumes.splice(0, excess);
    }

    // Invalidate all cached indicators for this symbol
    store.cache.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal — indicator computation
  // ---------------------------------------------------------------------------

  /**
   * Build a deterministic cache key from indicator name and params.
   * @param {string} indicator
   * @param {object} params
   * @returns {string}
   * @private
   */
  _buildCacheKey(indicator, params) {
    const paramStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join(',');
    return `${indicator}|${paramStr}`;
  }

  /**
   * Compute an indicator from the symbol's history store.
   *
   * @param {object} store — the symbol's data store
   * @param {string} indicator
   * @param {object} params
   * @returns {any}
   * @private
   */
  _compute(store, indicator, params) {
    const { klines, closes, highs, lows, volumes } = store;

    switch (indicator) {
      case 'rsi':
        return rsi(closes, params.period || 14);

      case 'atr':
        return atr(klines, params.period || 14);

      case 'adx':
        return adx(klines, params.period || 14);

      case 'bb':
        return bollingerBands(closes, params.period || 20, params.stdDev || 2);

      case 'ema':
        return emaFromArray(closes, params.period || 9);

      case 'sma':
        return sma(closes, params.period || 20);

      case 'macd':
        return macd(closes, params.fast || 12, params.slow || 26, params.signal || 9);

      case 'macdHistogram':
        return macdHistogramArray(closes, params.fast || 12, params.slow || 26, params.signal || 9);

      case 'stochastic':
        return stochastic(highs, lows, closes, params.period || 14, params.smooth || 3);

      case 'vwap':
        return vwap(klines);

      case 'keltner':
        return keltnerChannel(
          closes,
          klines,
          params.emaPeriod || 20,
          params.atrPeriod || 10,
          params.mult || 1.5,
        );

      default:
        log.warn('Unknown indicator requested', { indicator });
        return null;
    }
  }
}

module.exports = IndicatorCache;
