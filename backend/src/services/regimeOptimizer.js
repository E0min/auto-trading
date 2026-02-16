'use strict';

/**
 * RegimeOptimizer — Periodic parameter auto-optimization for MarketRegime.
 *
 * Every 6 hours, generates 20 parameter variations, evaluates each via
 * a simplified backtest using MaTrendStrategy, and selects the best-performing
 * parameter set. Parameters are EMA-blended with the current set to prevent
 * abrupt changes, then saved to RegimeParamStore.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_REGIMES, REGIME_EVENTS } = require('../utils/constants');
const BacktestEngine = require('../backtest/backtestEngine');
const { computeMetrics } = require('../backtest/backtestMetrics');

const log = createLogger('RegimeOptimizer');

/** Optimization cycle interval (ms) — 6 hours */
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Number of parameter variations to test per cycle */
const NUM_VARIATIONS = 20;

/** EMA blending factor (0~1, lower = more conservative) */
const BLEND_FACTOR = 0.3;

/** Lookback period for backtest data (7 days in ms) */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Strategy used for fitness evaluation */
const EVAL_STRATEGY = 'MaTrendStrategy';

/** Parameter ranges for perturbation [min, max] */
const PARAM_RANGES = {
  ema9Period:         [7, 12],
  sma20Period:        [15, 30],
  sma50Period:        [40, 60],
  atrPeriod:          [10, 20],
  atrBufferSize:      [80, 150],
  atrHighPercentile:  [0.65, 0.85],
  atrLowPercentile:   [0.15, 0.35],
  rocPeriod:          [5, 20],
  rocStrongThreshold: [1.0, 3.0],
  breadthStrongRatio: [0.60, 0.75],
  breadthVolumeWeight:[0.2, 0.6],
  volumeSmaPeriod:    [15, 30],
  volumeHighRatio:    [1.3, 2.0],
  volumeLowRatio:     [0.5, 0.8],
  hysteresisMinCandles:[5, 20],
  transitionCooldownMs:[120000, 600000],
};

// ---------------------------------------------------------------------------
// RegimeOptimizer class
// ---------------------------------------------------------------------------

class RegimeOptimizer extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./regimeParamStore')} deps.regimeParamStore
   * @param {import('./regimeEvaluator')}  deps.regimeEvaluator
   * @param {import('../backtest/dataFetcher')} deps.dataFetcher
   */
  constructor({ regimeParamStore, regimeEvaluator, dataFetcher }) {
    super();

    if (!regimeParamStore) throw new Error('RegimeOptimizer: regimeParamStore is required');
    if (!regimeEvaluator) throw new Error('RegimeOptimizer: regimeEvaluator is required');
    if (!dataFetcher) throw new Error('RegimeOptimizer: dataFetcher is required');

    this._paramStore = regimeParamStore;
    this._evaluator = regimeEvaluator;
    this._dataFetcher = dataFetcher;

    this._timer = null;
    this._running = false;
    this._optimizing = false;
    this._lastRun = null;
    this._nextRun = null;
    this._bestScore = null;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  start() {
    if (this._running) return;

    this._running = true;
    this._nextRun = Date.now() + CYCLE_INTERVAL_MS;

    this._timer = setInterval(async () => {
      if (!this._optimizing) {
        try {
          await this.runOptimizationCycle();
        } catch (err) {
          log.error('Optimization cycle failed', { error: err.message });
        }
      }
    }, CYCLE_INTERVAL_MS);

    log.info('RegimeOptimizer started', {
      nextRun: new Date(this._nextRun).toISOString(),
      intervalHours: CYCLE_INTERVAL_MS / 3600000,
    });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    log.info('RegimeOptimizer stopped');
  }

  // =========================================================================
  // Main optimization cycle
  // =========================================================================

  /**
   * Execute a full optimization cycle.
   * @returns {Promise<Object>} — optimization result summary
   */
  async runOptimizationCycle() {
    if (this._optimizing) {
      log.warn('Optimization already in progress — skipping');
      return { skipped: true };
    }

    this._optimizing = true;
    const startTime = Date.now();

    this.emit(REGIME_EVENTS.OPTIMIZER_CYCLE_START, { ts: startTime });
    log.info('Optimization cycle starting');

    try {
      // 1. Fetch 7-day BTC 1H candles
      const endTime = Date.now();
      const lookbackStart = endTime - LOOKBACK_MS;

      let klines;
      try {
        klines = await this._dataFetcher.getKlines({
          symbol: 'BTCUSDT',
          interval: '1H',
          startTime: lookbackStart,
          endTime,
        });
      } catch (err) {
        log.error('Failed to fetch klines for optimization', { error: err.message });
        this._optimizing = false;
        return { error: 'data_fetch_failed' };
      }

      if (!klines || klines.length < 50) {
        log.warn('Insufficient kline data for optimization', { count: klines?.length || 0 });
        this._optimizing = false;
        return { error: 'insufficient_data' };
      }

      // 2. Get current params and generate variations
      const currentParams = this._paramStore.getParams();
      const variations = this._generateVariations(currentParams);

      // 3. Evaluate current params as baseline
      const baselineScore = await this._evaluateVariation(currentParams, klines);

      // 4. Evaluate all variations
      const results = [];
      for (const variation of variations) {
        try {
          const score = await this._evaluateVariation(variation, klines);
          results.push({ params: variation, score });
        } catch (err) {
          log.debug('Variation evaluation failed', { error: err.message });
        }
      }

      // 5. Find best variation
      let bestResult = { params: currentParams, score: baselineScore };
      for (const r of results) {
        if (r.score > bestResult.score) {
          bestResult = r;
        }
      }

      // 6. Only update if improvement found
      if (bestResult.score > baselineScore) {
        // EMA blend with current params
        const blendedParams = this._blendParams(currentParams, bestResult.params, BLEND_FACTOR);

        this._paramStore.save(blendedParams, bestResult.score.toFixed(4), {
          baseline: baselineScore.toFixed(4),
          improvement: (bestResult.score - baselineScore).toFixed(4),
          variationsTested: results.length,
          klinesUsed: klines.length,
        });

        log.info('Parameters optimized', {
          baseline: baselineScore.toFixed(4),
          bestScore: bestResult.score.toFixed(4),
          improvement: (bestResult.score - baselineScore).toFixed(4),
        });

        this.emit(REGIME_EVENTS.PARAMS_UPDATED, {
          score: bestResult.score.toFixed(4),
          baseline: baselineScore.toFixed(4),
        });
      } else {
        log.info('No improvement found, keeping current params', {
          baseline: baselineScore.toFixed(4),
          bestVariation: bestResult.score.toFixed(4),
        });
      }

      this._lastRun = Date.now();
      this._nextRun = this._lastRun + CYCLE_INTERVAL_MS;
      this._bestScore = bestResult.score;
      this._optimizing = false;

      const summary = {
        baseline: baselineScore.toFixed(4),
        bestScore: bestResult.score.toFixed(4),
        improved: bestResult.score > baselineScore,
        variationsTested: results.length,
        durationMs: Date.now() - startTime,
        ts: Date.now(),
      };

      this.emit(REGIME_EVENTS.OPTIMIZER_CYCLE_COMPLETE, summary);
      log.info('Optimization cycle complete', summary);

      return summary;
    } catch (err) {
      this._optimizing = false;
      log.error('Optimization cycle error', { error: err.message });
      throw err;
    }
  }

  // =========================================================================
  // Variation generation
  // =========================================================================

  /**
   * Generate N parameter variations from the base params.
   * @param {Object} baseParams
   * @returns {Array<Object>}
   */
  _generateVariations(baseParams) {
    const variations = [];

    for (let i = 0; i < NUM_VARIATIONS; i++) {
      const variation = {};

      // Perturb each numeric parameter
      for (const [key, range] of Object.entries(PARAM_RANGES)) {
        const baseVal = baseParams[key];
        if (Number.isInteger(baseVal)) {
          variation[key] = this._perturbInt(baseVal, range[0], range[1]);
        } else {
          variation[key] = this._perturbFloat(baseVal, range[0], range[1]);
        }
      }

      // Perturb weights and normalize
      const weights = {};
      for (const [key, val] of Object.entries(baseParams.weights)) {
        weights[key] = this._perturbFloat(val, 0.05, 0.40);
      }
      variation.weights = this._normalizeWeights(weights);

      // Carry over non-perturbed params
      variation.atrBufferSize = variation.atrBufferSize || baseParams.atrBufferSize;

      variations.push(variation);
    }

    return variations;
  }

  /**
   * Perturb an integer value within ±20% and clamp to range.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _perturbInt(value, min, max) {
    const delta = Math.max(1, Math.round(value * 0.2));
    const perturbed = value + Math.round((Math.random() * 2 - 1) * delta);
    return Math.min(max, Math.max(min, perturbed));
  }

  /**
   * Perturb a float value within ±20% and clamp to range.
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  _perturbFloat(value, min, max) {
    const delta = value * 0.2;
    const perturbed = value + (Math.random() * 2 - 1) * delta;
    return Math.min(max, Math.max(min, parseFloat(perturbed.toFixed(4))));
  }

  /**
   * Normalize weights so they sum to 1.0.
   * @param {Object} weights
   * @returns {Object}
   */
  _normalizeWeights(weights) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sum === 0) return weights;

    const normalized = {};
    for (const [key, val] of Object.entries(weights)) {
      normalized[key] = parseFloat((val / sum).toFixed(4));
    }

    // Fix rounding to ensure exact sum = 1.0
    const keys = Object.keys(normalized);
    const normSum = Object.values(normalized).reduce((a, b) => a + b, 0);
    const diff = 1.0 - normSum;
    if (keys.length > 0) {
      normalized[keys[0]] = parseFloat((normalized[keys[0]] + diff).toFixed(4));
    }

    return normalized;
  }

  // =========================================================================
  // Variation evaluation
  // =========================================================================

  /**
   * Evaluate a parameter variation using backtest.
   * @param {Object} params — regime parameters
   * @param {Array} klines — historical kline data
   * @returns {Promise<number>} — fitness score
   */
  async _evaluateVariation(params, klines) {
    try {
      const engine = new BacktestEngine({
        strategyName: EVAL_STRATEGY,
        symbol: 'BTCUSDT',
        interval: '1H',
        initialCapital: '10000',
      });

      const result = engine.run(klines);
      const metrics = computeMetrics({
        trades: result.trades,
        equityCurve: result.equityCurve,
        initialCapital: '10000',
      });

      // Fitness function
      const sharpe = parseFloat(metrics.sharpeRatio) || 0;
      const pf = parseFloat(metrics.profitFactor) || 0;
      const winRate = parseFloat(metrics.winRate) || 0;
      const maxDD = parseFloat(metrics.maxDrawdownPercent) || 0;

      const fitness = sharpe + 0.5 * pf + 0.3 * (winRate / 100) - 0.2 * (maxDD / 100);

      return fitness;
    } catch (err) {
      log.debug('Evaluation failed', { error: err.message });
      return -999;
    }
  }

  // =========================================================================
  // EMA Blending
  // =========================================================================

  /**
   * Blend two parameter sets using EMA-style blending.
   * result = current * (1 - factor) + optimized * factor
   * @param {Object} current
   * @param {Object} optimized
   * @param {number} factor — blending factor (0~1)
   * @returns {Object}
   */
  _blendParams(current, optimized, factor) {
    const blended = {};

    for (const key of Object.keys(PARAM_RANGES)) {
      const cVal = current[key];
      const oVal = optimized[key];

      if (Number.isInteger(cVal)) {
        blended[key] = Math.round(cVal * (1 - factor) + oVal * factor);
      } else {
        blended[key] = parseFloat((cVal * (1 - factor) + oVal * factor).toFixed(4));
      }
    }

    // Blend weights
    const weights = {};
    for (const key of Object.keys(current.weights)) {
      const cW = current.weights[key] || 0;
      const oW = optimized.weights[key] || 0;
      weights[key] = parseFloat((cW * (1 - factor) + oW * factor).toFixed(4));
    }
    blended.weights = this._normalizeWeights(weights);

    // Preserve atrBufferSize
    blended.atrBufferSize = blended.atrBufferSize || current.atrBufferSize;

    return blended;
  }

  // =========================================================================
  // Status
  // =========================================================================

  /**
   * Get optimizer status.
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this._running,
      optimizing: this._optimizing,
      lastRun: this._lastRun,
      nextRun: this._nextRun,
      bestScore: this._bestScore ? this._bestScore.toFixed(4) : null,
    };
  }
}

module.exports = RegimeOptimizer;
