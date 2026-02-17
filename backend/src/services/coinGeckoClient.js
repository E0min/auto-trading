'use strict';

/**
 * CoinGeckoClient — Fetches top coins by market cap from CoinGecko API.
 *
 * Uses Node 20 native fetch(), MarketDataCache (TTL 4h), retry with
 * exponential backoff, and stale-data fallback on API failure.
 * All numeric values are returned as String (project convention).
 */

const { createLogger } = require('../utils/logger');
const MarketDataCache = require('../utils/marketDataCache');

const log = createLogger('CoinGeckoClient');

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const CACHE_KEY = 'coingecko:top_coins';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

class CoinGeckoClient {
  constructor() {
    /** @private */
    this._cache = new MarketDataCache();
    /** @private — last successfully fetched data (stale fallback) */
    this._lastFetchedData = null;
  }

  /**
   * Fetch top coins by market cap from CoinGecko.
   *
   * @param {number} [limit=100] — number of coins to fetch (max 250)
   * @returns {Promise<Array<{ id: string, symbol: string, name: string, marketCap: string, marketCapRank: string }>>}
   */
  async fetchTopCoins(limit = 100) {
    // Check cache first
    const cached = this._cache.get(CACHE_KEY);
    if (cached) {
      log.debug('Returning cached CoinGecko data', { count: cached.length });
      return cached;
    }

    // Fetch with retry
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await this._fetchFromApi(limit);
        // Cache the successful result
        this._cache.set(CACHE_KEY, data, CACHE_TTL_MS);
        this._lastFetchedData = data;
        log.info('CoinGecko data fetched successfully', { count: data.length, attempt });
        return data;
      } catch (err) {
        lastError = err;
        log.warn('CoinGecko API request failed', {
          attempt,
          maxRetries: MAX_RETRIES,
          error: err.message,
        });
        if (attempt < MAX_RETRIES) {
          const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          await new Promise((resolve) => {
            const t = setTimeout(resolve, delayMs);
            if (t.unref) t.unref();
          });
        }
      }
    }

    // All retries exhausted — use stale fallback if available
    if (this._lastFetchedData) {
      log.warn('All CoinGecko retries exhausted — returning stale data', {
        staleCount: this._lastFetchedData.length,
        error: lastError?.message,
      });
      return this._lastFetchedData;
    }

    log.error('CoinGecko API unavailable and no stale data', { error: lastError?.message });
    return [];
  }

  /**
   * @param {number} limit
   * @returns {Promise<Array<{ id: string, symbol: string, name: string, marketCap: string, marketCapRank: string }>>}
   * @private
   */
  async _fetchFromApi(limit) {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status}: ${response.statusText}`);
    }

    const raw = await response.json();

    if (!Array.isArray(raw)) {
      throw new Error('CoinGecko response is not an array');
    }

    return raw.map((coin) => ({
      id: coin.id || '',
      symbol: (coin.symbol || '').toLowerCase(),
      name: coin.name || '',
      marketCap: String(coin.market_cap ?? '0'),
      marketCapRank: String(coin.market_cap_rank ?? '0'),
    }));
  }

  /**
   * Stop cache sweep timer and clear cached data.
   */
  destroy() {
    this._cache.destroy();
    this._lastFetchedData = null;
  }
}

module.exports = CoinGeckoClient;
