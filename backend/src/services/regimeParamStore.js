'use strict';

/**
 * RegimeParamStore — Persistent storage for MarketRegime 6-factor parameters.
 *
 * Stores active parameters and optimization history in a local JSON file.
 * Supports save, load, rollback, and history retrieval.
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('../utils/logger');

const log = createLogger('RegimeParamStore');

const STORE_PATH = path.join(__dirname, '../../data/regime_params.json');
const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Default parameters (18 params + weights)
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS = Object.freeze({
  // Trend detection
  ema9Period: 9,
  sma20Period: 20,
  sma50Period: 50,

  // Volatility
  atrPeriod: 14,
  atrBufferSize: 100,
  atrHighPercentile: 0.75,
  atrLowPercentile: 0.25,

  // Momentum
  rocPeriod: 10,
  rocStrongThreshold: 1.5,

  // Market breadth
  breadthStrongRatio: 0.65,
  breadthVolumeWeight: 0.4,

  // Volume
  volumeSmaPeriod: 20,
  volumeHighRatio: 1.5,
  volumeLowRatio: 0.7,

  // Hysteresis
  hysteresisMinCandles: 10,
  transitionCooldownMs: 300000,

  // Factor weights (sum = 1.0)
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
// RegimeParamStore class
// ---------------------------------------------------------------------------

class RegimeParamStore {
  constructor() {
    this._data = null;
    this._load();
    log.info('RegimeParamStore loaded', {
      hasActiveParams: !!this._data.activeParams,
      historyLength: this._data.history.length,
    });
  }

  /**
   * Load stored data from JSON file or initialize with defaults.
   * @private
   */
  _load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        this._data = JSON.parse(raw);
        if (!this._data.activeParams) {
          this._data.activeParams = { ...DEFAULT_PARAMS, weights: { ...DEFAULT_PARAMS.weights } };
        }
        if (!Array.isArray(this._data.history)) {
          this._data.history = [];
        }
        return;
      }
    } catch (err) {
      log.warn('Failed to load regime params file, using defaults', { error: err.message });
    }

    this._data = {
      version: 1,
      activeParams: { ...DEFAULT_PARAMS, weights: { ...DEFAULT_PARAMS.weights } },
      history: [],
      lastOptimized: null,
    };
  }

  /**
   * Persist current data to disk.
   * @private
   */
  _persist() {
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STORE_PATH, JSON.stringify(this._data, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to persist regime params', { error: err.message });
    }
  }

  /**
   * Return the current active parameter set.
   * @returns {Object}
   */
  getParams() {
    return { ...this._data.activeParams, weights: { ...this._data.activeParams.weights } };
  }

  /**
   * Save new parameters with score and metadata.
   * @param {Object} params — new parameter set
   * @param {string} score — fitness score
   * @param {Object} [metadata={}] — additional metadata
   */
  save(params, score, metadata = {}) {
    // Push current active to history before replacing
    this._data.history.push({
      params: { ...this._data.activeParams, weights: { ...this._data.activeParams.weights } },
      score: String(score),
      timestamp: Date.now(),
      ...metadata,
    });

    // Trim history
    while (this._data.history.length > MAX_HISTORY) {
      this._data.history.shift();
    }

    // Set new active params
    this._data.activeParams = { ...params, weights: { ...params.weights } };
    this._data.lastOptimized = Date.now();

    this._persist();

    log.info('Regime params saved', { score, historyLength: this._data.history.length });
  }

  /**
   * Return optimization history (most recent last).
   * @returns {Array<Object>}
   */
  getHistory() {
    return this._data.history.map((h) => ({
      ...h,
      params: { ...h.params, weights: { ...h.params.weights } },
    }));
  }

  /**
   * Rollback to a previous parameter set by history index.
   * @param {number} index — index in the history array
   * @returns {Object} — the restored parameter set
   */
  rollback(index) {
    if (index < 0 || index >= this._data.history.length) {
      throw new Error(`RegimeParamStore.rollback: invalid index ${index}, history length ${this._data.history.length}`);
    }

    const target = this._data.history[index];

    // Save current before rollback
    this._data.history.push({
      params: { ...this._data.activeParams, weights: { ...this._data.activeParams.weights } },
      score: 'rollback',
      timestamp: Date.now(),
      reason: `rolled back to index ${index}`,
    });

    while (this._data.history.length > MAX_HISTORY) {
      this._data.history.shift();
    }

    this._data.activeParams = { ...target.params, weights: { ...target.params.weights } };
    this._data.lastOptimized = Date.now();

    this._persist();

    log.info('Regime params rolled back', { index, score: target.score });
    return this.getParams();
  }

  /**
   * Return hardcoded default parameters.
   * @returns {Object}
   */
  getDefaults() {
    return { ...DEFAULT_PARAMS, weights: { ...DEFAULT_PARAMS.weights } };
  }

  /**
   * Return timestamp of last optimization.
   * @returns {number|null}
   */
  getLastOptimized() {
    return this._data.lastOptimized;
  }
}

module.exports = RegimeParamStore;
