'use strict';

/**
 * RegimeEvaluator — Post-hoc accuracy measurement for regime classifications.
 *
 * Listens for REGIME_CHANGE events, records the price at classification time,
 * then checks price after a configurable delay (default 4h) to determine
 * whether the classification was accurate.
 *
 * Emits 'evaluation:complete' when an evaluation finishes.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, MARKET_REGIMES, REGIME_EVENTS } = require('../utils/constants');

const log = createLogger('RegimeEvaluator');

/** How long to wait before evaluating a regime classification (ms) */
const EVALUATION_DELAY_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Check interval for due evaluations */
const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

/** Maximum number of evaluation records to keep */
const MAX_RECORDS = 200;

// Accuracy thresholds (percentage)
const THRESHOLDS = {
  trendMinMove: 0.5,    // trending: price must move >= 0.5%
  volatileMinRange: 1.5, // volatile: price range must be >= 1.5%
  quietMaxMove: 0.3,     // quiet/ranging: price must stay within ±0.3%
};

// ---------------------------------------------------------------------------
// RegimeEvaluator class
// ---------------------------------------------------------------------------

class RegimeEvaluator extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./marketRegime')} deps.marketRegime
   * @param {import('./marketData')}   deps.marketData
   */
  constructor({ marketRegime, marketData }) {
    super();

    if (!marketRegime) throw new Error('RegimeEvaluator: marketRegime is required');
    if (!marketData) throw new Error('RegimeEvaluator: marketData is required');

    this._marketRegime = marketRegime;
    this._marketData = marketData;

    /** @type {Array<Object>} pending evaluation records */
    this._pendingRecords = [];

    /** @type {Array<Object>} completed evaluation records */
    this._completedRecords = [];

    /** @type {Object} per-regime accuracy counters */
    this._accuracy = {};
    for (const r of Object.values(MARKET_REGIMES)) {
      this._accuracy[r] = { correct: 0, total: 0 };
    }

    /** @private latest BTC price tracker */
    this._latestBtcPrice = '0';

    /** @private price high/low tracking during evaluation windows */
    this._priceTracker = new Map();

    this._boundOnRegimeChange = this._onRegimeChange.bind(this);
    this._boundOnKline = this._onKlineUpdate.bind(this);
    this._checkTimer = null;
    this._running = false;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  start() {
    if (this._running) return;

    this._marketRegime.on(MARKET_EVENTS.REGIME_CHANGE, this._boundOnRegimeChange);
    this._marketData.on(MARKET_EVENTS.KLINE_UPDATE, this._boundOnKline);

    this._checkTimer = setInterval(() => {
      this._checkDueEvaluations();
    }, CHECK_INTERVAL_MS);

    this._running = true;
    log.info('RegimeEvaluator started');
  }

  stop() {
    this._marketRegime.removeListener(MARKET_EVENTS.REGIME_CHANGE, this._boundOnRegimeChange);
    this._marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, this._boundOnKline);

    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }

    this._running = false;
    log.info('RegimeEvaluator stopped');
  }

  // =========================================================================
  // Internal handlers
  // =========================================================================

  /**
   * Record a regime change for later evaluation.
   * @param {Object} context — regime change context
   * @private
   */
  _onRegimeChange(context) {
    const record = {
      regime: context.current,
      confidence: context.confidence,
      priceAtClassification: context.btcPrice,
      classifiedAt: Date.now(),
      evaluateAt: Date.now() + EVALUATION_DELAY_MS,
      id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    this._pendingRecords.push(record);

    // Initialize price tracker for this record
    const price = parseFloat(context.btcPrice) || 0;
    this._priceTracker.set(record.id, { high: price, low: price });

    log.debug('Regime evaluation scheduled', {
      regime: record.regime,
      evaluateAt: new Date(record.evaluateAt).toISOString(),
    });
  }

  /**
   * Track BTC price for evaluation windows.
   * @param {Object} kline
   * @private
   */
  _onKlineUpdate(kline) {
    if (!kline || kline.symbol !== 'BTCUSDT') return;

    this._latestBtcPrice = kline.close || '0';
    const high = parseFloat(kline.high) || 0;
    const low = parseFloat(kline.low) || 0;

    // Update high/low for all pending evaluations
    for (const record of this._pendingRecords) {
      const tracker = this._priceTracker.get(record.id);
      if (tracker) {
        if (high > tracker.high) tracker.high = high;
        if (low < tracker.low) tracker.low = low;
      }
    }
  }

  /**
   * Check for evaluations that are due and process them.
   * @private
   */
  _checkDueEvaluations() {
    const now = Date.now();
    const due = [];
    const remaining = [];

    for (const record of this._pendingRecords) {
      if (now >= record.evaluateAt) {
        due.push(record);
      } else {
        remaining.push(record);
      }
    }

    this._pendingRecords = remaining;

    for (const record of due) {
      this._evaluateRegime(record);
    }
  }

  /**
   * Evaluate a single regime classification.
   * @param {Object} record
   * @private
   */
  _evaluateRegime(record) {
    const startPrice = parseFloat(record.priceAtClassification) || 0;
    const endPrice = parseFloat(this._latestBtcPrice) || 0;

    if (startPrice === 0 || endPrice === 0) {
      this._priceTracker.delete(record.id);
      return;
    }

    const tracker = this._priceTracker.get(record.id) || { high: endPrice, low: endPrice };
    const priceChange = ((endPrice - startPrice) / startPrice) * 100;
    const priceRange = ((tracker.high - tracker.low) / startPrice) * 100;

    let correct = false;

    switch (record.regime) {
      case MARKET_REGIMES.TRENDING_UP:
        correct = priceChange >= THRESHOLDS.trendMinMove;
        break;

      case MARKET_REGIMES.TRENDING_DOWN:
        correct = priceChange <= -THRESHOLDS.trendMinMove;
        break;

      case MARKET_REGIMES.VOLATILE:
        correct = priceRange >= THRESHOLDS.volatileMinRange;
        break;

      case MARKET_REGIMES.RANGING:
      case MARKET_REGIMES.QUIET:
        correct = Math.abs(priceChange) <= THRESHOLDS.quietMaxMove;
        break;

      default:
        correct = false;
    }

    // Update accuracy
    if (this._accuracy[record.regime]) {
      this._accuracy[record.regime].total++;
      if (correct) this._accuracy[record.regime].correct++;
    }

    const evaluation = {
      ...record,
      priceAtEvaluation: String(endPrice),
      priceChange: priceChange.toFixed(4),
      priceRange: priceRange.toFixed(4),
      correct,
      evaluatedAt: Date.now(),
    };

    this._completedRecords.push(evaluation);
    while (this._completedRecords.length > MAX_RECORDS) {
      this._completedRecords.shift();
    }

    // Clean up tracker
    this._priceTracker.delete(record.id);

    this.emit(REGIME_EVENTS.EVALUATION_COMPLETE, evaluation);

    log.info('Regime evaluation complete', {
      regime: record.regime,
      correct,
      priceChange: evaluation.priceChange,
      priceRange: evaluation.priceRange,
    });
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Get accuracy metrics per regime.
   * @returns {Object} — { regime: { accuracy: '0.75', correct: N, total: N } }
   */
  getAccuracyMetrics() {
    const result = {};
    for (const [regime, data] of Object.entries(this._accuracy)) {
      result[regime] = {
        accuracy: data.total > 0
          ? (data.correct / data.total).toFixed(4)
          : '0.0000',
        correct: data.correct,
        total: data.total,
      };
    }
    return result;
  }

  /**
   * Get recent completed evaluations.
   * @param {number} [n=20] — number of recent evaluations
   * @returns {Array<Object>}
   */
  getRecentEvaluations(n = 20) {
    return this._completedRecords.slice(-n);
  }

  /**
   * Get count of pending evaluations.
   * @returns {number}
   */
  getPendingCount() {
    return this._pendingRecords.length;
  }
}

module.exports = RegimeEvaluator;
