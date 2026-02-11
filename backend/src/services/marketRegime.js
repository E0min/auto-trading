'use strict';

/**
 * MarketRegime — Classifies the current market state.
 *
 * Combines BTC price action (SMA-20, ATR-14) with broad market breadth
 * (advancers vs. decliners) to emit a regime classification:
 *   TRENDING_UP | TRENDING_DOWN | VOLATILE | RANGING | QUIET
 *
 * Downstream strategy modules use the regime to adjust position sizing,
 * entry filters, or disable trading entirely during unfavourable conditions.
 *
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, MARKET_REGIMES } = require('../utils/constants');
const {
  add,
  subtract,
  divide,
  abs,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../utils/mathUtils');

const log = createLogger('MarketRegime');

/** Number of close prices to keep for SMA calculation */
const SMA_PERIOD = 20;

/** Number of candles used for ATR approximation */
const ATR_PERIOD = 14;

/** Maximum number of regime transitions to store in history */
const MAX_HISTORY = 100;

/** BTC symbol constant */
const BTC_SYMBOL = 'BTCUSDT';

// ---------------------------------------------------------------------------
// MarketRegime class
// ---------------------------------------------------------------------------

class MarketRegime extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./marketData')}       deps.marketData
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   */
  constructor({ marketData, tickerAggregator }) {
    super();

    if (!marketData) {
      throw new Error('MarketRegime: marketData dependency is required');
    }
    if (!tickerAggregator) {
      throw new Error('MarketRegime: tickerAggregator dependency is required');
    }

    /** @private */
    this._marketData = marketData;

    /** @private */
    this._aggregator = tickerAggregator;

    /** @type {string} current regime label */
    this._currentRegime = MARKET_REGIMES.QUIET;

    /** @type {Array<Object>} chronological regime transitions */
    this._regimeHistory = [];

    /**
     * Rolling buffer of BTC close prices for SMA calculation.
     * Each entry is a String.
     * @type {string[]}
     */
    this._smaBuffer = [];

    /**
     * Rolling buffer of BTC candle ranges (|high - low|) for ATR approx.
     * Each entry is a String.
     * @type {string[]}
     */
    this._atrBuffer = [];

    /** @private latest BTC close price (String) */
    this._btcPrice = '0';

    /** @private latest SMA-20 value (String) */
    this._sma20 = '0';

    /** @private latest ATR-14 approximation (String) */
    this._atr14 = '0';

    /** @private latest aggregate stats snapshot */
    this._latestAggStats = null;

    // Bound handler references
    this._boundOnBtcKline = this._onBtcKline.bind(this);
    this._boundOnAggregateUpdate = this._onAggregateUpdate.bind(this);

    /** @private */
    this._running = false;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start listening for BTC klines and aggregate breadth updates.
   */
  start() {
    if (this._running) {
      log.info('Already running — skipping start');
      return;
    }

    this._marketData.on(MARKET_EVENTS.KLINE_UPDATE, this._boundOnBtcKline);
    this._aggregator.on('aggregate:update', this._boundOnAggregateUpdate);

    this._running = true;
    log.info('MarketRegime started');
  }

  /**
   * Stop listening and reset transient state (regime and history are preserved).
   */
  stop() {
    this._marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, this._boundOnBtcKline);
    this._aggregator.removeListener('aggregate:update', this._boundOnAggregateUpdate);

    this._running = false;
    log.info('MarketRegime stopped');
  }

  // =========================================================================
  // Internal handlers
  // =========================================================================

  /**
   * Process a kline update. Only BTC klines are used for regime analysis.
   *
   * @param {Object} kline — normalised kline from MarketData
   * @private
   */
  _onBtcKline(kline) {
    if (!kline || kline.symbol !== BTC_SYMBOL) return;

    try {
      const close = kline.close || '0';
      const high = kline.high || '0';
      const low = kline.low || '0';

      this._btcPrice = close;

      // --- SMA buffer ---
      this._smaBuffer.push(close);
      if (this._smaBuffer.length > SMA_PERIOD) {
        this._smaBuffer.shift();
      }

      // --- ATR buffer (|high - low| per candle) ---
      let range = '0';
      try {
        range = abs(subtract(high, low));
      } catch (_) {
        range = '0';
      }
      this._atrBuffer.push(range);
      if (this._atrBuffer.length > ATR_PERIOD) {
        this._atrBuffer.shift();
      }

      // Compute SMA-20
      this._sma20 = this._computeSma(this._smaBuffer);

      // Compute ATR-14 approximation (average true range ≈ average |high-low|)
      this._atr14 = this._computeAverage(this._atrBuffer);

      // Attempt classification (only meaningful when we also have aggregate data)
      if (this._latestAggStats) {
        this._classify();
      }
    } catch (err) {
      log.error('_onBtcKline error', { error: err });
    }
  }

  /**
   * Handle aggregate breadth update from TickerAggregator.
   *
   * @param {Object} stats
   * @private
   */
  _onAggregateUpdate(stats) {
    if (!stats) return;
    this._latestAggStats = stats;

    // Re-classify if we have BTC price data
    if (this._smaBuffer.length > 0) {
      try {
        this._classify();
      } catch (err) {
        log.error('_onAggregateUpdate classification error', { error: err });
      }
    }
  }

  // =========================================================================
  // Regime classification
  // =========================================================================

  /**
   * Classify the current market regime based on:
   *   - BTC price vs SMA-20 (trend bias)
   *   - ATR-14 level (volatility)
   *   - Aggregate advancers vs decliners (breadth)
   *
   * Emits MARKET_EVENTS.REGIME_CHANGE when the regime changes.
   *
   * @private
   */
  _classify() {
    const stats = this._latestAggStats;
    if (!stats) return;

    const btcPrice = this._btcPrice;
    const sma20 = this._sma20;
    const atr14 = this._atr14;

    // Guard: not enough data to classify
    if (btcPrice === '0' || sma20 === '0') return;

    // --- Trend bias from SMA ---
    // Determine directional bias: price above SMA → bullish, below → bearish
    const priceAboveSma = isGreaterThan(btcPrice, sma20);

    // --- ATR relative to price (as percentage) ---
    // atrPercent = (atr14 / btcPrice) * 100
    let atrPercent = '0';
    try {
      atrPercent = toFixed(divide(atr14, btcPrice, 8), 4);
      // Convert to percentage: multiply by 100
      atrPercent = toFixed(String(parseFloat(atrPercent) * 100), 4);
    } catch (_) {
      atrPercent = '0';
    }

    // Thresholds (ATR% of BTC price)
    const HIGH_ATR_THRESHOLD = '0.8';  // > 0.8% → volatile
    const LOW_ATR_THRESHOLD = '0.2';   // < 0.2% → quiet

    const isHighAtr = isGreaterThan(atrPercent, HIGH_ATR_THRESHOLD);
    const isLowAtr = isLessThan(atrPercent, LOW_ATR_THRESHOLD);

    // --- Breadth bias ---
    const { advancers = 0, decliners = 0, tickerCount = 0 } = stats;
    const total = advancers + decliners;

    // Strong directional breadth: > 65% in one direction
    let strongBull = false;
    let strongBear = false;

    if (total > 0) {
      const bullRatio = advancers / total;
      const bearRatio = decliners / total;
      strongBull = bullRatio > 0.65;
      strongBear = bearRatio > 0.65;
    }

    // --- Combined classification ---
    let newRegime = MARKET_REGIMES.QUIET;

    if (isHighAtr && (priceAboveSma || strongBull) && !strongBear) {
      newRegime = MARKET_REGIMES.TRENDING_UP;
    } else if (isHighAtr && (!priceAboveSma || strongBear) && !strongBull) {
      newRegime = MARKET_REGIMES.TRENDING_DOWN;
    } else if (isHighAtr) {
      // High ATR but no clear directional consensus
      newRegime = MARKET_REGIMES.VOLATILE;
    } else if (isLowAtr) {
      newRegime = MARKET_REGIMES.QUIET;
    } else {
      // Medium ATR, no strong trend
      newRegime = MARKET_REGIMES.RANGING;
    }

    // --- Emit on change ---
    if (newRegime !== this._currentRegime) {
      const previous = this._currentRegime;
      this._currentRegime = newRegime;

      const context = {
        previous,
        current: newRegime,
        btcPrice,
        sma20,
        atr14,
        atrPercent,
        advancers,
        decliners,
        tickerCount,
        ts: Date.now(),
      };

      // Store in history
      this._regimeHistory.push(context);
      if (this._regimeHistory.length > MAX_HISTORY) {
        this._regimeHistory.shift();
      }

      this.emit(MARKET_EVENTS.REGIME_CHANGE, context);

      log.info('Regime changed', {
        from: previous,
        to: newRegime,
        btcPrice,
        sma20,
        atrPercent,
        advancers,
        decliners,
      });
    }
  }

  // =========================================================================
  // Computation helpers
  // =========================================================================

  /**
   * Compute the simple moving average of a buffer of String values.
   *
   * @param {string[]} buffer
   * @returns {string}
   * @private
   */
  _computeSma(buffer) {
    if (!buffer || buffer.length === 0) return '0';

    let sum = '0';
    for (const val of buffer) {
      sum = add(sum, val);
    }

    try {
      return divide(sum, String(buffer.length), 8);
    } catch (_) {
      return '0';
    }
  }

  /**
   * Compute the average of a buffer of String values.
   *
   * @param {string[]} buffer
   * @returns {string}
   * @private
   */
  _computeAverage(buffer) {
    return this._computeSma(buffer);
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  /**
   * Return the current regime label.
   * @returns {string}
   */
  getCurrentRegime() {
    return this._currentRegime;
  }

  /**
   * Return the full regime transition history.
   * @returns {Object[]}
   */
  getRegimeHistory() {
    return [...this._regimeHistory];
  }

  /**
   * Return a snapshot of the current regime context for diagnostics.
   * @returns {Object}
   */
  getContext() {
    return {
      regime: this._currentRegime,
      sma20: this._sma20,
      atr14: this._atr14,
      btcPrice: this._btcPrice,
      aggregateStats: this._latestAggStats ? { ...this._latestAggStats } : null,
      smaBufferLength: this._smaBuffer.length,
      atrBufferLength: this._atrBuffer.length,
      historyLength: this._regimeHistory.length,
      ts: Date.now(),
    };
  }
}

module.exports = MarketRegime;
