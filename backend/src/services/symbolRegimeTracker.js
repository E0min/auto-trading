'use strict';

/**
 * SymbolRegimeTracker — Per-symbol 5-factor market regime classifier.
 *
 * Classifies a single symbol's regime using:
 *   Factor 1: Multi-SMA Trend (EMA-9, SMA-20, SMA-50)   weight=0.25
 *   Factor 2: Adaptive ATR (percentile-based)             weight=0.22
 *   Factor 3: ROC Momentum                                weight=0.20
 *   Factor 4: Volume Confirmation                         weight=0.18
 *   Factor 5: Hysteresis (3-candle confirm)               weight=0.15
 *
 * NOT an EventEmitter — pure data object.
 * Created and managed by SymbolRegimeManager.
 */

const { createLogger } = require('../utils/logger');
const { MARKET_REGIMES } = require('../utils/constants');
const {
  add,
  subtract,
  divide,
  abs,
  toFixed,
} = require('../utils/mathUtils');

const REGIMES = [
  MARKET_REGIMES.TRENDING_UP,
  MARKET_REGIMES.TRENDING_DOWN,
  MARKET_REGIMES.VOLATILE,
  MARKET_REGIMES.RANGING,
  MARKET_REGIMES.QUIET,
];

/** Default parameters */
const DEFAULT_PARAMS = Object.freeze({
  ema9Period: 9,
  sma20Period: 20,
  sma50Period: 50,
  atrPeriod: 14,
  atrBufferSize: 100,
  atrHighPercentile: 0.75,
  atrLowPercentile: 0.25,
  rocPeriod: 10,
  rocStrongThreshold: 1.5,
  volumeSmaPeriod: 20,
  volumeHighRatio: 1.5,
  volumeLowRatio: 0.7,
  hysteresisMinCandles: 3,
  weights: {
    multiSmaTrend: 0.25,
    adaptiveAtr: 0.22,
    rocMomentum: 0.20,
    volumeConfirmation: 0.18,
    hysteresis: 0.15,
  },
});

class SymbolRegimeTracker {
  /**
   * @param {string} symbol — e.g. 'ETHUSDT'
   */
  constructor(symbol) {
    if (!symbol || typeof symbol !== 'string') {
      throw new Error('SymbolRegimeTracker: symbol is required');
    }

    this._symbol = symbol;
    this._log = createLogger(`SymbolRegime:${symbol}`);

    this._currentRegime = MARKET_REGIMES.QUIET;
    this._confidence = 0;
    this._lastFactorScores = null;
    this._klineCount = 0;

    // --- Buffers ---
    this._sma20Buffer = [];
    this._sma50Buffer = [];
    this._ema9 = '0';
    this._ema9Initialized = false;
    this._atrBuffer = [];
    this._atrPercentileBuffer = [];
    this._rocBuffer = [];
    this._volumeBuffer = [];

    // Computed indicators
    this._lastPrice = '0';
    this._sma20 = '0';
    this._sma50 = '0';
    this._atr = '0';

    // Hysteresis state
    this._pendingRegime = null;
    this._pendingCount = 0;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Process a kline for this symbol.
   * @param {object} kline — { close, high, low, volume }
   * @returns {{ changed: boolean, previous: string|null, current: string, confidence: number }}
   */
  processKline(kline) {
    if (!kline) return { changed: false, previous: null, current: this._currentRegime, confidence: this._confidence };

    const close = kline.close || '0';
    const high = kline.high || '0';
    const low = kline.low || '0';
    const volume = kline.volume || '0';
    const params = DEFAULT_PARAMS;

    this._lastPrice = close;
    this._klineCount++;

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

    // ATR percentile buffer
    if (this._atr !== '0') {
      const atrVal = parseFloat(this._atr);
      this._atrPercentileBuffer.push(atrVal);
      if (this._atrPercentileBuffer.length > params.atrBufferSize) {
        this._atrPercentileBuffer.shift();
      }
    }

    // Need enough data for classification (at least SMA-20 filled)
    if (this._sma20Buffer.length < params.sma20Period) {
      return { changed: false, previous: null, current: this._currentRegime, confidence: this._confidence };
    }

    return this._classify();
  }

  /** @returns {string} current regime label */
  getCurrentRegime() {
    return this._currentRegime;
  }

  /** @returns {number} confidence 0~1 */
  getConfidence() {
    return this._confidence;
  }

  /** @returns {boolean} true if enough klines have been processed for valid classification */
  isWarmedUp() {
    return this._sma20Buffer.length >= DEFAULT_PARAMS.sma20Period;
  }

  /** @returns {object} full diagnostic context */
  getContext() {
    return {
      symbol: this._symbol,
      regime: this._currentRegime,
      confidence: toFixed(String(this._confidence), 4),
      warmedUp: this.isWarmedUp(),
      klineCount: this._klineCount,
      lastPrice: this._lastPrice,
      ema9: this._ema9,
      sma20: this._sma20,
      sma50: this._sma50,
      atr: this._atr,
      factorScores: this._lastFactorScores,
      bufferLengths: {
        sma20: this._sma20Buffer.length,
        sma50: this._sma50Buffer.length,
        atr: this._atrBuffer.length,
        atrPercentile: this._atrPercentileBuffer.length,
        roc: this._rocBuffer.length,
        volume: this._volumeBuffer.length,
      },
    };
  }

  // =========================================================================
  // Classification
  // =========================================================================

  /**
   * Run 5-factor scoring and apply hysteresis.
   * @returns {{ changed: boolean, previous: string|null, current: string, confidence: number }}
   * @private
   */
  _classify() {
    const params = DEFAULT_PARAMS;
    const w = params.weights;
    const price = this._lastPrice;
    const sma20 = this._sma20;

    if (price === '0' || sma20 === '0') {
      return { changed: false, previous: null, current: this._currentRegime, confidence: this._confidence };
    }

    // Initialize score accumulator
    const scores = {};
    for (const r of REGIMES) scores[r] = 0;

    // Factor 1: Multi-SMA Trend
    const f1 = this._scoreMultiSmaTrend();
    for (const r of REGIMES) scores[r] += (f1[r] || 0) * w.multiSmaTrend;

    // Factor 2: Adaptive ATR
    const f2 = this._scoreAdaptiveAtr(params);
    for (const r of REGIMES) scores[r] += (f2[r] || 0) * w.adaptiveAtr;

    // Factor 3: ROC Momentum
    const f3 = this._scoreRocMomentum(params);
    for (const r of REGIMES) scores[r] += (f3[r] || 0) * w.rocMomentum;

    // Factor 4: Volume Confirmation
    const f4 = this._scoreVolumeConfirmation(params);
    for (const r of REGIMES) scores[r] += (f4[r] || 0) * w.volumeConfirmation;

    // Hysteresis bonus: current regime gets a small bonus
    scores[this._currentRegime] += w.hysteresis;

    this._lastFactorScores = { f1, f2, f3, f4 };

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

    // Apply hysteresis
    return this._applyHysteresis(bestRegime, confidence, params);
  }

  // =========================================================================
  // Factor 1: Multi-SMA Trend
  // =========================================================================

  _scoreMultiSmaTrend() {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    const price = parseFloat(this._lastPrice);
    const ema9 = parseFloat(this._ema9);
    const sma20 = parseFloat(this._sma20);
    const sma50 = parseFloat(this._sma50);

    if (price === 0 || sma20 === 0 || sma50 === 0 || ema9 === 0) {
      s[MARKET_REGIMES.QUIET] = 0.5;
      return s;
    }

    // Perfect bull alignment
    if (price > ema9 && ema9 > sma20 && sma20 > sma50) {
      s[MARKET_REGIMES.TRENDING_UP] = 1.0;
      return s;
    }

    // Perfect bear alignment
    if (price < ema9 && ema9 < sma20 && sma20 < sma50) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 1.0;
      return s;
    }

    // SMA convergence
    const smaSpread = Math.abs(sma20 - sma50) / sma50;
    if (smaSpread < 0.01) {
      s[MARKET_REGIMES.RANGING] = 0.6;
      s[MARKET_REGIMES.QUIET] = 0.4;
      return s;
    }

    // Partial trend
    if (price > sma20 && sma20 > sma50) {
      s[MARKET_REGIMES.TRENDING_UP] = 0.7;
      s[MARKET_REGIMES.VOLATILE] = 0.3;
    } else if (price < sma20 && sma20 < sma50) {
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.7;
      s[MARKET_REGIMES.VOLATILE] = 0.3;
    } else {
      s[MARKET_REGIMES.VOLATILE] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    }

    return s;
  }

  // =========================================================================
  // Factor 2: Adaptive ATR
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

    const sorted = [...this._atrPercentileBuffer].sort((a, b) => a - b);
    let rank = 0;
    for (const v of sorted) {
      if (v <= currentAtr) rank++;
    }
    const percentile = rank / sorted.length;

    if (percentile > params.atrHighPercentile) {
      s[MARKET_REGIMES.VOLATILE] = 0.6;
      s[MARKET_REGIMES.TRENDING_UP] = 0.2;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.2;
    } else if (percentile < params.atrLowPercentile) {
      s[MARKET_REGIMES.QUIET] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
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
  // Factor 4: Volume Confirmation
  // =========================================================================

  _scoreVolumeConfirmation(params) {
    const s = {};
    for (const r of REGIMES) s[r] = 0;

    if (this._volumeBuffer.length < 2) {
      s[MARKET_REGIMES.RANGING] = 0.5;
      return s;
    }

    const currentVol = parseFloat(this._volumeBuffer[this._volumeBuffer.length - 1]);
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
      s[MARKET_REGIMES.TRENDING_UP] = 0.3;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.3;
      s[MARKET_REGIMES.VOLATILE] = 0.4;
    } else if (volRatio < params.volumeLowRatio) {
      s[MARKET_REGIMES.QUIET] = 0.6;
      s[MARKET_REGIMES.RANGING] = 0.4;
    } else {
      s[MARKET_REGIMES.RANGING] = 0.5;
      s[MARKET_REGIMES.TRENDING_UP] = 0.15;
      s[MARKET_REGIMES.TRENDING_DOWN] = 0.15;
      s[MARKET_REGIMES.VOLATILE] = 0.1;
      s[MARKET_REGIMES.QUIET] = 0.1;
    }

    return s;
  }

  // =========================================================================
  // Factor 5: Hysteresis
  // =========================================================================

  /**
   * @param {string} candidateRegime
   * @param {number} confidence
   * @param {object} params
   * @returns {{ changed: boolean, previous: string|null, current: string, confidence: number }}
   * @private
   */
  _applyHysteresis(candidateRegime, confidence, params) {
    const minCandles = params.hysteresisMinCandles;

    if (candidateRegime === this._currentRegime) {
      this._pendingRegime = null;
      this._pendingCount = 0;
      this._confidence = confidence;
      return { changed: false, previous: null, current: this._currentRegime, confidence };
    }

    if (candidateRegime === this._pendingRegime) {
      this._pendingCount++;
    } else {
      this._pendingRegime = candidateRegime;
      this._pendingCount = 1;
    }

    if (this._pendingCount >= minCandles) {
      const previous = this._currentRegime;
      this._currentRegime = candidateRegime;
      this._confidence = confidence;
      this._pendingRegime = null;
      this._pendingCount = 0;

      this._log.info('Symbol regime changed', {
        from: previous,
        to: candidateRegime,
        confidence: toFixed(String(confidence), 4),
        price: this._lastPrice,
      });

      return { changed: true, previous, current: candidateRegime, confidence };
    }

    return { changed: false, previous: null, current: this._currentRegime, confidence: this._confidence };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

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
}

module.exports = SymbolRegimeTracker;
