'use strict';

/**
 * MarketRegime — 6-Factor Weighted Scoring Market Classifier.
 *
 * Combines six factors with dynamic weighting to classify the market:
 *   Factor 1: Multi-SMA Trend (EMA-9, SMA-20, SMA-50 alignment)
 *   Factor 2: Adaptive ATR (percentile-based, no fixed thresholds)
 *   Factor 3: ROC Momentum (rate of change)
 *   Factor 4: Market Breadth (volume-weighted advancer/decliner ratio)
 *   Factor 5: Volume Confirmation (volume vs SMA ratio)
 *   Factor 6: Hysteresis (minimum N-candle confirmation)
 *
 * Emits REGIME_CHANGE with confidence score when regime transitions.
 * Supports dynamic parameters via RegimeParamStore (optional dependency).
 *
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, MARKET_REGIMES } = require('../utils/constants');
const {
  add,
  subtract,
  multiply,
  divide,
  abs,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../utils/mathUtils');

const log = createLogger('MarketRegime');

/** Maximum number of regime transitions to store in history */
const MAX_HISTORY = 100;

/** BTC symbol constant */
const BTC_SYMBOL = 'BTCUSDT';

/** All possible regime labels */
const REGIMES = [
  MARKET_REGIMES.TRENDING_UP,
  MARKET_REGIMES.TRENDING_DOWN,
  MARKET_REGIMES.VOLATILE,
  MARKET_REGIMES.RANGING,
  MARKET_REGIMES.QUIET,
];

/** Hardcoded fallback defaults (used when no regimeParamStore) */
const FALLBACK_PARAMS = Object.freeze({
  ema9Period: 9,
  sma20Period: 20,
  sma50Period: 50,
  atrPeriod: 14,
  atrBufferSize: 100,
  atrHighPercentile: 0.75,
  atrLowPercentile: 0.25,
  rocPeriod: 10,
  rocStrongThreshold: 1.5,
  breadthStrongRatio: 0.65,
  breadthVolumeWeight: 0.4,
  volumeSmaPeriod: 20,
  volumeHighRatio: 1.5,
  volumeLowRatio: 0.7,
  hysteresisMinCandles: 10,
  transitionCooldownMs: 300000, // 5 minutes
  weights: {
    multiSmaTrend: 0.19,
    adaptiveAtr: 0.17,
    rocMomentum: 0.16,
    marketBreadth: 0.19,
    volumeConfirmation: 0.14,
    hysteresis: 0.15,
  },
});

// ---------------------------------------------------------------------------
// MarketRegime class
// ---------------------------------------------------------------------------

class MarketRegime extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./marketData')}       deps.marketData
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   * @param {import('./regimeParamStore')} [deps.regimeParamStore] — optional
   */
  constructor({ marketData, tickerAggregator, regimeParamStore }) {
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

    /** @private */
    this._paramStore = regimeParamStore || null;

    /** @type {string} current regime label */
    this._currentRegime = MARKET_REGIMES.QUIET;

    /** @type {number} confidence of current classification (0~1) */
    this._confidence = 0;

    /** @type {Object} last factor scores snapshot */
    this._lastFactorScores = null;

    /** @type {Array<Object>} chronological regime transitions */
    this._regimeHistory = [];

    // --- Buffers ---
    /** @type {string[]} close prices for SMA-20 */
    this._sma20Buffer = [];

    /** @type {string[]} close prices for SMA-50 */
    this._sma50Buffer = [];

    /** @type {string} current EMA-9 value */
    this._ema9 = '0';

    /** @type {boolean} EMA-9 initialized */
    this._ema9Initialized = false;

    /** @type {string[]} candle ranges for ATR */
    this._atrBuffer = [];

    /** @type {number[]} ATR percentile history */
    this._atrPercentileBuffer = [];

    /** @type {string[]} close prices for ROC */
    this._rocBuffer = [];

    /** @type {string[]} volume for Volume SMA */
    this._volumeBuffer = [];

    /** @private latest BTC close price (String) */
    this._btcPrice = '0';

    /** @private latest SMA-20 value (String) */
    this._sma20 = '0';

    /** @private latest SMA-50 value (String) */
    this._sma50 = '0';

    /** @private latest ATR value (String) */
    this._atr = '0';

    /** @private latest aggregate stats snapshot */
    this._latestAggStats = null;

    // --- Hysteresis state ---
    /** @type {string|null} pending regime waiting for confirmation */
    this._pendingRegime = null;

    /** @type {number} consecutive candle count for pending regime */
    this._pendingCount = 0;

    /** @type {number} Timestamp of last regime transition */
    this._lastTransitionTs = 0;

    /** @type {number[]} Timestamps of recent transitions (for frequency tracking) */
    this._transitionTimestamps = [];

    /** @type {boolean} whether the initial regime has been emitted */
    this._initialEmitted = false;

    // Bound handler references
    this._boundOnBtcKline = this._onBtcKline.bind(this);
    this._boundOnAggregateUpdate = this._onAggregateUpdate.bind(this);

    /** @private */
    this._running = false;

    log.info('MarketRegime 6-factor initialised', {
      hasParamStore: !!this._paramStore,
    });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

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

  stop() {
    this._marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, this._boundOnBtcKline);
    this._aggregator.removeListener('aggregate:update', this._boundOnAggregateUpdate);

    this._running = false;
    log.info('MarketRegime stopped');
  }

  // =========================================================================
  // Parameter access
  // =========================================================================

  /**
   * Get current active parameters (from store or fallback).
   * @returns {Object}
   */
  _getParams() {
    if (this._paramStore) {
      return this._paramStore.getParams();
    }
    return { ...FALLBACK_PARAMS, weights: { ...FALLBACK_PARAMS.weights } };
  }

  // =========================================================================
  // Internal handlers
  // =========================================================================

  _onBtcKline(kline) {
    if (!kline || kline.symbol !== BTC_SYMBOL) return;

    try {
      const close = kline.close || '0';
      const high = kline.high || '0';
      const low = kline.low || '0';
      const volume = kline.volume || '0';
      const params = this._getParams();

      this._btcPrice = close;

      // --- SMA-20 buffer ---
      this._sma20Buffer.push(close);
      if (this._sma20Buffer.length > params.sma20Period) {
        this._sma20Buffer.shift();
      }

      // --- SMA-50 buffer ---
      this._sma50Buffer.push(close);
      if (this._sma50Buffer.length > params.sma50Period) {
        this._sma50Buffer.shift();
      }

      // --- EMA-9 ---
      this._updateEma9(close, params.ema9Period);

      // --- ATR buffer ---
      let range = '0';
      try {
        range = abs(subtract(high, low));
      } catch (_) {
        range = '0';
      }
      this._atrBuffer.push(range);
      if (this._atrBuffer.length > params.atrPeriod) {
        this._atrBuffer.shift();
      }

      // --- ROC buffer ---
      this._rocBuffer.push(close);
      if (this._rocBuffer.length > params.rocPeriod + 1) {
        this._rocBuffer.shift();
      }

      // --- Volume buffer ---
      this._volumeBuffer.push(volume);
      if (this._volumeBuffer.length > params.volumeSmaPeriod) {
        this._volumeBuffer.shift();
      }

      // Compute indicators
      this._sma20 = this._computeSma(this._sma20Buffer);
      this._sma50 = this._computeSma(this._sma50Buffer);
      this._atr = this._computeSma(this._atrBuffer);

      // --- ATR percentile buffer ---
      if (this._atr !== '0') {
        const atrPct = parseFloat(this._atr);
        this._atrPercentileBuffer.push(atrPct);
        if (this._atrPercentileBuffer.length > params.atrBufferSize) {
          this._atrPercentileBuffer.shift();
        }
      }

      // Attempt classification
      if (this._latestAggStats) {
        this._classifyWithScoring();
      }
    } catch (err) {
      log.error('_onBtcKline error', { error: err });
    }
  }

  _onAggregateUpdate(stats) {
    if (!stats) return;
    this._latestAggStats = stats;

    if (this._sma20Buffer.length > 0) {
      try {
        this._classifyWithScoring();
      } catch (err) {
        log.error('_onAggregateUpdate classification error', { error: err });
      }
    }
  }

  // =========================================================================
  // EMA computation
  // =========================================================================

  /**
   * Update EMA-9 with a new close price.
   * @param {string} close
   * @param {number} period
   * @private
   */
  _updateEma9(close, period) {
    const closeF = parseFloat(close);
    if (isNaN(closeF)) return;

    if (!this._ema9Initialized) {
      this._ema9 = close;
      this._ema9Initialized = true;
      return;
    }

    const k = 2 / (period + 1);
    const prevEma = parseFloat(this._ema9);
    const newEma = closeF * k + prevEma * (1 - k);
    this._ema9 = toFixed(String(newEma), 8);
  }

  // =========================================================================
  // 6-Factor Scoring Classification
  // =========================================================================

  /**
   * Classify market regime using 6-factor weighted scoring.
   * @private
   */
  _classifyWithScoring() {
    const stats = this._latestAggStats;
    if (!stats) return;

    const btcPrice = this._btcPrice;
    const sma20 = this._sma20;

    if (btcPrice === '0' || sma20 === '0') return;

    const params = this._getParams();
    const w = params.weights;

    // Initialize score accumulator for each regime
    const scores = {};
    for (const r of REGIMES) {
      scores[r] = 0;
    }

    // Factor 1: Multi-SMA Trend
    const f1 = this._scoreMultiSmaTrend(params);
    for (const r of REGIMES) {
      scores[r] += (f1[r] || 0) * w.multiSmaTrend;
    }

    // Factor 2: Adaptive ATR
    const f2 = this._scoreAdaptiveAtr(params);
    for (const r of REGIMES) {
      scores[r] += (f2[r] || 0) * w.adaptiveAtr;
    }

    // Factor 3: ROC Momentum
    const f3 = this._scoreRocMomentum(params);
    for (const r of REGIMES) {
      scores[r] += (f3[r] || 0) * w.rocMomentum;
    }

    // Factor 4: Market Breadth
    const f4 = this._scoreMarketBreadth(params);
    for (const r of REGIMES) {
      scores[r] += (f4[r] || 0) * w.marketBreadth;
    }

    // Factor 5: Volume Confirmation
    const f5 = this._scoreVolumeConfirmation(params);
    for (const r of REGIMES) {
      scores[r] += (f5[r] || 0) * w.volumeConfirmation;
    }

    // Hysteresis bonus: current regime gets a small bonus
    scores[this._currentRegime] += w.hysteresis;

    // Store factor scores for diagnostics
    this._lastFactorScores = { f1, f2, f3, f4, f5 };

    // Find best regime
    let bestRegime = MARKET_REGIMES.QUIET;
    let bestScore = -1;
    let secondBestScore = -1;

    for (const r of REGIMES) {
      if (scores[r] > bestScore) {
        secondBestScore = bestScore;
        bestScore = scores[r];
        bestRegime = r;
      } else if (scores[r] > secondBestScore) {
        secondBestScore = scores[r];
      }
    }

    // Confidence = gap between 1st and 2nd
    const confidence = bestScore > 0
      ? Math.min((bestScore - Math.max(secondBestScore, 0)) / bestScore, 1)
      : 0;

    // Apply hysteresis (Factor 6): require N consecutive candles
    this._applyHysteresis(bestRegime, confidence, scores, params);
  }

  // =========================================================================
  // Factor 1: Multi-SMA Trend
  // =========================================================================

  _scoreMultiSmaTrend(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    const price = parseFloat(this._btcPrice);
    const ema9 = parseFloat(this._ema9);
    const sma20 = parseFloat(this._sma20);
    const sma50 = parseFloat(this._sma50);

    if (price === 0 || sma20 === 0 || sma50 === 0 || ema9 === 0) {
      s[MARKET_REGIMES.QUIET] = 0.5;
      return s;
    }

    // Perfect bull alignment: price > EMA-9 > SMA-20 > SMA-50
    if (price > ema9 && ema9 > sma20 && sma20 > sma50) {
      s[MARKET_REGIMES.TRENDING_UP] = 1.0;
      return s;
    }

    // Perfect bear alignment: price < EMA-9 < SMA-20 < SMA-50
    if (price < ema9 && ema9 < sma20 && sma20 < sma50) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 1.0;
      return s;
    }

    // SMA convergence check: |SMA-20 - SMA-50| / SMA-50 < 1%
    const smaSpread = Math.abs(sma20 - sma50) / sma50;
    if (smaSpread < 0.01) {
      s[MARKET_REGIMES.RANGING] = 0.6;
      s[MARKET_REGIMES.QUIET] = 0.4;
      return s;
    }

    // Partial trend signals
    if (price > sma20 && sma20 > sma50) {
      s[MARKET_REGIMES.TRENDING_UP] = 0.7;
      s[MARKET_REGIMES.VOLATILE] = 0.3;
    } else if (price < sma20 && sma20 < sma50) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.7;
      s[MARKET_REGIMES.VOLATILE] = 0.3;
    } else {
      // Mixed signals
      s[MARKET_REGIMES.VOLATILE] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    }

    return s;
  }

  // =========================================================================
  // Factor 2: Adaptive ATR (percentile-based)
  // =========================================================================

  _scoreAdaptiveAtr(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    if (this._atrPercentileBuffer.length < 10) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    const currentAtr = parseFloat(this._atr);
    if (currentAtr === 0) {
      s[MARKET_REGIMES.QUIET] = 0.5;
      return s;
    }

    // Calculate percentile of current ATR within history
    const sorted = [...this._atrPercentileBuffer].sort((a, b) => a - b);
    let rank = 0;
    for (const v of sorted) {
      if (v <= currentAtr) rank++;
    }
    const percentile = rank / sorted.length;

    if (percentile > params.atrHighPercentile) {
      // High ATR: volatile or trending
      s[MARKET_REGIMES.VOLATILE] = 0.6;
      s[MARKET_REGIMES.TRENDING_UP] = 0.2;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.2;
    } else if (percentile < params.atrLowPercentile) {
      // Low ATR: quiet or ranging
      s[MARKET_REGIMES.QUIET] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
      // Mid-range ATR
      s[MARKET_REGIMES.RANGING] = 0.6;
      s[MARKET_REGIMES.VOLATILE] = 0.2;
      s[MARKET_REGIMES.QUIET] = 0.2;
    }

    return s;
  }

  // =========================================================================
  // Factor 3: ROC Momentum
  // =========================================================================

  _scoreRocMomentum(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    if (this._rocBuffer.length < params.rocPeriod + 1) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    const current = parseFloat(this._rocBuffer[this._rocBuffer.length - 1]);
    const past = parseFloat(this._rocBuffer[0]);

    if (past === 0) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    const roc = ((current - past) / Math.abs(past)) * 100;

    if (roc > params.rocStrongThreshold) {
      s[MARKET_REGIMES.TRENDING_UP] = 1.0;
    } else if (roc < -params.rocStrongThreshold) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 1.0;
    } else if (Math.abs(roc) < 0.5) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      s[MARKET_REGIMES.QUIET] = 0.5;
    } else if (roc > 0) {
      s[MARKET_REGIMES.TRENDING_UP] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    }

    return s;
  }

  // =========================================================================
  // Factor 4: Market Breadth
  // =========================================================================

  _scoreMarketBreadth(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    const stats = this._latestAggStats;
    if (!stats) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    const { advancers = 0, decliners = 0 } = stats;
    const total = advancers + decliners;

    if (total === 0) {
      s[MARKET_REGIMES.QUIET] = 0.5;
      return s;
    }

    const bullRatio = advancers / total;
    const bearRatio = decliners / total;

    if (bullRatio > params.breadthStrongRatio) {
      s[MARKET_REGIMES.TRENDING_UP] = 1.0;
    } else if (bearRatio > params.breadthStrongRatio) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 1.0;
    } else if (Math.abs(bullRatio - 0.5) < 0.05) {
      // Very balanced
      s[MARKET_REGIMES.RANGING] = 0.5;
      s[MARKET_REGIMES.VOLATILE] = 0.5;
    } else if (bullRatio > 0.55) {
      s[MARKET_REGIMES.TRENDING_UP] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    }

    return s;
  }

  // =========================================================================
  // Factor 5: Volume Confirmation
  // =========================================================================

  _scoreVolumeConfirmation(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    if (this._volumeBuffer.length < 2) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    // Current volume = last element
    const currentVol = parseFloat(this._volumeBuffer[this._volumeBuffer.length - 1]);

    // Volume SMA (all elements)
    let volSum = 0;
    for (const v of this._volumeBuffer) {
      volSum += parseFloat(v) || 0;
    }
    const volSma = volSum / this._volumeBuffer.length;

    if (volSma === 0) {
      s[MARKET_REGIMES.QUIET] = 0.5;
      return s;
    }

    const volRatio = currentVol / volSma;

    if (volRatio > params.volumeHighRatio) {
      // High volume: confirms trend or volatility
      s[MARKET_REGIMES.TRENDING_UP] = 0.3;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.3;
      s[MARKET_REGIMES.VOLATILE] = 0.4;
    } else if (volRatio < params.volumeLowRatio) {
      // Low volume: quiet or ranging
      s[MARKET_REGIMES.QUIET] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
      // Normal volume
      s[MARKET_REGIMES.RANGING] = 0.5;
      s[MARKET_REGIMES.TRENDING_UP] = 0.15;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.15;
      s[MARKET_REGIMES.VOLATILE] = 0.1;
      s[MARKET_REGIMES.QUIET] = 0.1;
    }

    return s;
  }

  // =========================================================================
  // Factor 6: Hysteresis
  // =========================================================================

  /**
   * Apply hysteresis: only switch regime after N consecutive candles.
   * @param {string} candidateRegime — best-scoring regime
   * @param {number} confidence — confidence value
   * @param {Object} scores — regime scores
   * @param {Object} params — current parameters
   * @private
   */
  _applyHysteresis(candidateRegime, confidence, scores, params) {
    const minCandles = params.hysteresisMinCandles;

    if (candidateRegime === this._currentRegime) {
      // Same as current — reset pending
      this._pendingRegime = null;
      this._pendingCount = 0;
      this._confidence = confidence;

      // Emit once on first successful classification so frontend gets initial state
      if (!this._initialEmitted) {
        this._initialEmitted = true;
        const context = {
          previous: null,
          current: this._currentRegime,
          confidence: toFixed(String(confidence), 4),
          scores,
          btcPrice: this._btcPrice,
          ema9: this._ema9,
          sma20: this._sma20,
          sma50: this._sma50,
          atr: this._atr,
          advancers: this._latestAggStats?.advancers || 0,
          decliners: this._latestAggStats?.decliners || 0,
          tickerCount: this._latestAggStats?.tickerCount || 0,
          ts: Date.now(),
        };
        this._regimeHistory.push(context);
        this.emit(MARKET_EVENTS.REGIME_CHANGE, context);
        log.info('Initial regime emitted', {
          regime: this._currentRegime,
          confidence: toFixed(String(confidence), 4),
        });
      }
      return;
    }

    if (candidateRegime === this._pendingRegime) {
      // Same candidate as pending — increment counter
      this._pendingCount++;
    } else {
      // Different candidate — restart counter
      this._pendingRegime = candidateRegime;
      this._pendingCount = 1;
    }

    // Check if threshold met
    if (this._pendingCount >= minCandles) {
      // Transition cooldown check (AD-44)
      const cooldownMs = params.transitionCooldownMs || 300000;
      if (Date.now() - this._lastTransitionTs < cooldownMs) {
        log.debug('Regime transition blocked by cooldown', {
          candidate: candidateRegime,
          cooldownMs,
          elapsed: Date.now() - this._lastTransitionTs,
        });
        return; // Stay in current regime, but keep pending state
      }

      const previous = this._currentRegime;
      this._currentRegime = candidateRegime;
      this._confidence = confidence;
      this._pendingRegime = null;
      this._pendingCount = 0;
      this._lastTransitionTs = Date.now();

      // Track transition timestamps for frequency metrics (R7-C1)
      this._transitionTimestamps.push(Date.now());
      // Keep only last hour
      const oneHourAgo = Date.now() - 3600000;
      this._transitionTimestamps = this._transitionTimestamps.filter(ts => ts > oneHourAgo);

      this._initialEmitted = true;

      const context = {
        previous,
        current: candidateRegime,
        confidence: toFixed(String(confidence), 4),
        scores,
        btcPrice: this._btcPrice,
        ema9: this._ema9,
        sma20: this._sma20,
        sma50: this._sma50,
        atr: this._atr,
        advancers: this._latestAggStats?.advancers || 0,
        decliners: this._latestAggStats?.decliners || 0,
        tickerCount: this._latestAggStats?.tickerCount || 0,
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
        to: candidateRegime,
        confidence: toFixed(String(confidence), 4),
        btcPrice: this._btcPrice,
      });
    }
  }

  // =========================================================================
  // Computation helpers
  // =========================================================================

  /**
   * Compute the simple moving average of a buffer of String values.
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

  // =========================================================================
  // Public accessors
  // =========================================================================

  getCurrentRegime() {
    return this._currentRegime;
  }

  getConfidence() {
    return this._confidence;
  }

  getRegimeHistory() {
    return [...this._regimeHistory];
  }

  getContext() {
    return {
      regime: this._currentRegime,
      confidence: toFixed(String(this._confidence), 4),
      ema9: this._ema9,
      sma20: this._sma20,
      sma50: this._sma50,
      atr: this._atr,
      btcPrice: this._btcPrice,
      factorScores: this._lastFactorScores,
      params: this._getParams(),
      aggregateStats: this._latestAggStats ? { ...this._latestAggStats } : null,
      pendingRegime: this._pendingRegime,
      pendingCount: this._pendingCount,
      bufferLengths: {
        sma20: this._sma20Buffer.length,
        sma50: this._sma50Buffer.length,
        atr: this._atrBuffer.length,
        atrPercentile: this._atrPercentileBuffer.length,
        roc: this._rocBuffer.length,
        volume: this._volumeBuffer.length,
      },
      historyLength: this._regimeHistory.length,
      transitionsLastHour: this.getTransitionsLastHour(),
      cooldownStatus: this.getCooldownStatus(),
      lastTransitionTs: this._lastTransitionTs,
      ts: Date.now(),
    };
  }

  /**
   * Get the number of regime transitions in the last hour.
   * @returns {number}
   */
  getTransitionsLastHour() {
    const oneHourAgo = Date.now() - 3600000;
    return this._transitionTimestamps.filter(ts => ts > oneHourAgo).length;
  }

  /**
   * Check if transition cooldown is currently active.
   * @returns {{ active: boolean, remainingMs: number }}
   */
  getCooldownStatus() {
    const params = this._getParams();
    const cooldownMs = params.transitionCooldownMs || 300000;
    const elapsed = Date.now() - this._lastTransitionTs;
    const active = elapsed < cooldownMs && this._lastTransitionTs > 0;
    return {
      active,
      remainingMs: active ? cooldownMs - elapsed : 0,
    };
  }
}

module.exports = MarketRegime;
