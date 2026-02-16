'use strict';

/**
 * MarketDataCache — TTL-based in-memory cache for market data.
 *
 * Used by CoinSelector to avoid redundant API calls for data that
 * changes slowly (e.g. open interest, funding rate).
 */

const DEFAULT_TTL_MS = 60_000; // 60 seconds

/** Interval for periodic sweep of expired entries (ms) */
const SWEEP_INTERVAL_MS = 60_000;

class MarketDataCache {
  constructor() {
    /** @type {Map<string, { data: *, expiresAt: number }>} */
    this._store = new Map();

    /** @type {NodeJS.Timeout|null} periodic sweep timer */
    this._sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  /**
   * Remove all expired entries from the store.
   * @private
   */
  _sweep() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) {
        this._store.delete(key);
      }
    }
  }

  /**
   * Retrieve a cached value. Returns undefined if missing or expired.
   * @param {string} key
   * @returns {*|undefined}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /**
   * Store a value with an optional TTL.
   * @param {string} key
   * @param {*} data
   * @param {number} [ttlMs=60000]
   */
  set(key, data, ttlMs = DEFAULT_TTL_MS) {
    this._store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Remove a specific key from the cache.
   * @param {string} key
   */
  invalidate(key) {
    this._store.delete(key);
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this._store.clear();
  }

  /**
   * Stop the sweep timer and clear all entries.
   * Call when shutting down the cache.
   */
  destroy() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
    this._store.clear();
  }

  /**
   * Return the number of (possibly expired) entries.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }
}

module.exports = MarketDataCache;
