'use strict';

/**
 * Historical kline data fetcher with local JSON file caching.
 *
 * Uses the Bitget V3 REST API directly (via getRestClient) for paginated
 * historical candle fetches with startTime/endTime support, which the
 * exchangeClient.getCandles() wrapper does not provide.
 *
 * Cached data is stored under backend/data/klines/{symbol}_{interval}_{start}_{end}.json
 */

const path = require('path');
const fs = require('fs').promises;
const { getRestClient } = require('../config/bitget');
const { createLogger } = require('../utils/logger');

const log = createLogger('DataFetcher');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum candles the Bitget V3 API returns per single request */
const MAX_CANDLES_PER_PAGE = 200;

/** Default number of extra candles fetched before startTime for indicator warm-up */
const DEFAULT_WARMUP_BARS = 200;

/** Delay between paginated API requests to respect rate limits (ms) */
const RATE_LIMIT_DELAY_MS = 100;

/** Base directory for cached kline JSON files */
const CACHE_DIR = path.join(__dirname, '../../data/klines');

/** Mapping of interval strings to their duration in milliseconds */
const INTERVAL_MS = Object.freeze({
  '1m':  60000,
  '5m':  300000,
  '15m': 900000,
  '30m': 1800000,
  '1H':  3600000,
  '4H':  14400000,
  '1D':  86400000,
  '1W':  604800000,
});

// ---------------------------------------------------------------------------
// DataFetcher class
// ---------------------------------------------------------------------------

class DataFetcher {
  /**
   * @param {Object} deps
   * @param {Object} deps.exchangeClient — injected for DI consistency (not
   *   used for candle fetches because it lacks startTime/endTime support)
   */
  constructor({ exchangeClient } = {}) {
    /** @type {Object} */
    this._exchangeClient = exchangeClient;

    /** @type {number} Number of extra bars to fetch before startTime */
    this.warmupBars = DEFAULT_WARMUP_BARS;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Fetch historical klines for the given symbol and interval.
   *
   * The method transparently handles:
   *   1. Warm-up period — fetches extra bars before startTime for indicator init
   *   2. Caching — reads from / writes to local JSON files
   *   3. Pagination — the Bitget API returns at most 200 candles per request
   *
   * @param {Object} params
   * @param {string} params.symbol    — e.g. 'BTCUSDT'
   * @param {string} params.interval  — e.g. '1m', '5m', '1H', '4H', '1D'
   * @param {number} params.startTime — inclusive start timestamp (ms)
   * @param {number} params.endTime   — inclusive end timestamp (ms)
   * @returns {Promise<Array<{ ts: string, open: string, high: string, low: string, close: string, volume: string }>>}
   *   Normalised kline array sorted by ts ascending
   */
  async getKlines({ symbol, interval, startTime, endTime }) {
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) {
      throw new Error(`DataFetcher.getKlines: unsupported interval "${interval}"`);
    }

    // Step 1 — Calculate warm-up adjusted start time
    const warmupMs = this.warmupBars * intervalMs;
    const adjustedStart = startTime - warmupMs;

    log.info('getKlines requested', {
      symbol,
      interval,
      startTime,
      endTime,
      adjustedStart,
      warmupBars: this.warmupBars,
    });

    // Step 2 — Check cache
    const cachePath = this._getCachePath(symbol, interval, adjustedStart, endTime);
    const cached = await this._loadFromCache(cachePath);
    if (cached) {
      log.info('Returning cached klines', { symbol, interval, count: cached.length });
      return cached;
    }

    // Step 3 — Fetch from API with pagination
    log.info('Cache miss — fetching from API', { symbol, interval });
    const klines = await this._fetchFromApi({
      symbol,
      interval,
      startTime: adjustedStart,
      endTime,
    });

    // Step 4 — Save to cache
    await this._saveToCache(cachePath, klines);

    log.info('Klines fetched and cached', { symbol, interval, count: klines.length });
    return klines;
  }

  // =========================================================================
  // Cache helpers
  // =========================================================================

  /**
   * Build a deterministic cache file path for the given parameters.
   *
   * @param {string} symbol
   * @param {string} interval
   * @param {number} startTime
   * @param {number} endTime
   * @returns {string} absolute file path
   */
  _getCachePath(symbol, interval, startTime, endTime) {
    const filename = `${symbol}_${interval}_${startTime}_${endTime}.json`;
    return path.join(CACHE_DIR, filename);
  }

  /**
   * Attempt to read a cached kline JSON file.
   *
   * @param {string} cachePath — absolute path to the cache file
   * @returns {Promise<Array|null>} parsed array or null if not cached
   */
  async _loadFromCache(cachePath) {
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        log.debug('Cache hit', { cachePath, count: data.length });
        return data;
      }
      return null;
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.debug('Cache file not found', { cachePath });
        return null;
      }
      log.warn('Failed to read cache file', { cachePath, error: err.message });
      return null;
    }
  }

  /**
   * Write kline data to a JSON cache file. Creates the cache directory if
   * it does not exist.
   *
   * @param {string} cachePath — absolute path to the target file
   * @param {Array} data — kline array to persist
   * @returns {Promise<void>}
   */
  async _saveToCache(cachePath, data) {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(data), 'utf-8');
      log.debug('Cache saved', { cachePath, count: data.length });
    } catch (err) {
      log.warn('Failed to write cache file', { cachePath, error: err.message });
    }
  }

  // =========================================================================
  // API fetch with pagination
  // =========================================================================

  /**
   * Fetch candles from Bitget REST API with backward pagination.
   *
   * The API returns candles in descending order (newest first) when using
   * endTime. We paginate backward from endTime toward startTime, collecting
   * all pages, then reverse and deduplicate to produce an ascending array.
   *
   * @param {Object} params
   * @param {string} params.symbol
   * @param {string} params.interval
   * @param {number} params.startTime
   * @param {number} params.endTime
   * @returns {Promise<Array<{ ts: string, open: string, high: string, low: string, close: string, volume: string }>>}
   */
  async _fetchFromApi({ symbol, interval, startTime, endTime }) {
    const restClient = getRestClient();
    const granularity = interval;
    const allCandles = [];
    let currentEndTime = endTime;
    let pageCount = 0;

    log.info('Starting paginated fetch', { symbol, interval, startTime, endTime });

    while (currentEndTime > startTime) {
      pageCount++;
      log.debug(`Fetching page ${pageCount}`, {
        symbol,
        interval,
        currentEndTime,
        startTime,
      });

      try {
        const response = await restClient.getFuturesHistoricCandles({
          productType: 'USDT-FUTURES',
          symbol,
          granularity,
          startTime: String(startTime),
          endTime: String(currentEndTime),
          limit: String(MAX_CANDLES_PER_PAGE),
        });

        const rawCandles = response?.data;

        if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
          log.debug('No more candles returned, stopping pagination', { pageCount });
          break;
        }

        // Normalise raw arrays into objects
        const normalised = rawCandles.map((c) => this._normalizeCandle(c));
        allCandles.push(...normalised);

        log.debug(`Page ${pageCount} received`, { count: rawCandles.length });

        // If fewer than max returned, we've reached the end of available data
        if (rawCandles.length < MAX_CANDLES_PER_PAGE) {
          log.debug('Received fewer than max candles, pagination complete', { pageCount });
          break;
        }

        // Move endTime backward: use the oldest candle's timestamp minus 1ms
        // to avoid duplicates on the boundary
        const timestamps = normalised.map((c) => Number(c.ts));
        const oldestTs = Math.min(...timestamps);
        currentEndTime = oldestTs - 1;

        // Rate limit delay between pages
        await this._delay(RATE_LIMIT_DELAY_MS);
      } catch (err) {
        log.error('API fetch error during pagination', {
          symbol,
          interval,
          pageCount,
          error: err.message,
        });
        throw err;
      }
    }

    // Deduplicate by timestamp and sort ascending
    const deduped = this._deduplicateAndSort(allCandles);

    log.info('Paginated fetch complete', {
      symbol,
      interval,
      totalPages: pageCount,
      totalCandles: deduped.length,
    });

    return deduped;
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Normalise a raw Bitget candle array into a keyed object.
   *
   * Bitget response format: [ts, open, high, low, close, volCoin, volUsdt]
   * All values are stored as strings.
   *
   * @param {Array} raw — single candle from API response
   * @returns {{ ts: string, open: string, high: string, low: string, close: string, volume: string }}
   */
  _normalizeCandle(raw) {
    return {
      ts:     String(raw[0]),
      open:   String(raw[1]),
      high:   String(raw[2]),
      low:    String(raw[3]),
      close:  String(raw[4]),
      volume: String(raw[5]),
    };
  }

  /**
   * Remove duplicate candles (by timestamp) and sort ascending by ts.
   *
   * @param {Array} candles — unsorted candle array with potential duplicates
   * @returns {Array} deduplicated and sorted array
   */
  _deduplicateAndSort(candles) {
    const seen = new Map();
    for (const candle of candles) {
      // Keep the first occurrence for each timestamp
      if (!seen.has(candle.ts)) {
        seen.set(candle.ts, candle);
      }
    }
    const unique = Array.from(seen.values());
    unique.sort((a, b) => Number(a.ts) - Number(b.ts));
    return unique;
  }

  /**
   * Simple delay helper for rate limiting.
   *
   * @param {number} ms — milliseconds to wait
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = DataFetcher;
