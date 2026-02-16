'use strict';

/**
 * In-memory backtest result store.
 *
 * Stores completed backtest results in a Map keyed by unique run ID.
 * Exported as a singleton so all consumers share the same data.
 *
 * Results contain potentially large arrays (equityCurve, trades) which are
 * stored in full for individual lookups but excluded from the list() summary
 * to keep memory usage reasonable when many backtests have been run.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('BacktestStore');

/** Maximum number of stored results before FIFO eviction (AD-49) */
const MAX_STORED_RESULTS = 50;

class BacktestStore {
  constructor() {
    /** @type {Map<string, Object>} */
    this._results = new Map();
  }

  /**
   * Store a backtest result under the given id.
   *
   * A `createdAt` timestamp is automatically attached to the result.
   * If the store exceeds MAX_STORED_RESULTS, the oldest entry is evicted (FIFO).
   *
   * @param {string} id     — unique backtest run identifier
   * @param {Object} result — full backtest result (config, metrics, trades, equityCurve, etc.)
   */
  save(id, result) {
    const entry = {
      ...result,
      id,
      createdAt: result.createdAt || Date.now(),
    };
    this._results.set(id, entry);
    log.info('Result saved', { id, tradesCount: result.trades?.length });

    // FIFO eviction when over limit (R8-T0-2)
    while (this._results.size > MAX_STORED_RESULTS) {
      const oldestKey = this._results.keys().next().value;
      this._results.delete(oldestKey);
      log.info('Evicted oldest backtest result (FIFO)', { evictedId: oldestKey, storeSize: this._results.size });
    }
  }

  /**
   * Retrieve a full backtest result by id.
   *
   * @param {string} id
   * @returns {Object|null} the full result or null if not found
   */
  get(id) {
    return this._results.get(id) || null;
  }

  /**
   * Return an array of result summaries (lightweight).
   *
   * Excludes `equityCurve` and `trades` arrays to avoid excessive memory
   * consumption when listing many results.
   *
   * @returns {Array<{ id: string, config: Object, metrics: Object, status: string, createdAt: number }>}
   */
  list() {
    const summaries = [];
    for (const [id, entry] of this._results) {
      summaries.push({
        id,
        config: entry.config,
        metrics: entry.metrics,
        status: entry.status,
        createdAt: entry.createdAt,
      });
    }
    return summaries;
  }

  /**
   * Delete a backtest result by id.
   *
   * @param {string} id
   * @returns {boolean} true if the entry existed and was deleted
   */
  delete(id) {
    const existed = this._results.delete(id);
    if (existed) {
      log.info('Result deleted', { id });
    } else {
      log.debug('Delete called for non-existent id', { id });
    }
    return existed;
  }

  /**
   * Check whether a result with the given id exists.
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._results.has(id);
  }

  /**
   * Remove all stored results.
   */
  clear() {
    const count = this._results.size;
    this._results.clear();
    log.info('Store cleared', { deletedCount: count });
  }

  /**
   * Return the number of stored results.
   *
   * @returns {number}
   */
  count() {
    return this._results.size;
  }
}

module.exports = new BacktestStore();
