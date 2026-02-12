'use strict';

/**
 * CoinSelector — Multi-factor scoring system for dynamic symbol selection.
 *
 * Evaluates 7 factors per candidate symbol, normalises each via percentile
 * ranking, then applies regime-specific weights to compute a composite score.
 *
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, MARKET_REGIMES, CATEGORIES } = require('../utils/constants');
const MarketDataCache = require('../utils/marketDataCache');
const {
  subtract,
  divide,
  multiply,
  abs,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../utils/mathUtils');

const log = createLogger('CoinSelector');

// ---------------------------------------------------------------------------
// Default pre-filter thresholds
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = Object.freeze({
  /** Minimum 24h volume (quote currency) to pass pre-filter */
  minVolume24h: '500000',
  /** Maximum spread percent to pass pre-filter */
  maxSpreadPercent: '0.8',
  /** Maximum absolute 24h change percent (avoid blow-up) */
  maxChangePercent: '30',
  /** Maximum number of symbols to return */
  maxSymbols: 10,
  /** Max concurrent API calls for enrichment */
  concurrency: 5,
  /** Cache TTL for OI/funding data in milliseconds */
  cacheTtlMs: 60_000,
});

// ---------------------------------------------------------------------------
// Regime-specific weight profiles
// ---------------------------------------------------------------------------

/**
 * Weights per factor for each market regime.
 * All rows sum to 100 for easy interpretation as percentages.
 */
const WEIGHT_PROFILES = Object.freeze({
  [MARKET_REGIMES.TRENDING_UP]: {
    volume: 15, spreadInv: 10, openInterest: 20, fundingInv: 10,
    momentum: 25, volatility: 10, volMomentum: 10,
  },
  [MARKET_REGIMES.TRENDING_DOWN]: {
    volume: 15, spreadInv: 10, openInterest: 20, fundingInv: 10,
    momentum: 25, volatility: 10, volMomentum: 10,
  },
  [MARKET_REGIMES.RANGING]: {
    volume: 20, spreadInv: 20, openInterest: 10, fundingInv: 10,
    momentum: 5, volatility: 15, volMomentum: 20,
  },
  [MARKET_REGIMES.VOLATILE]: {
    volume: 25, spreadInv: 25, openInterest: 10, fundingInv: 5,
    momentum: 10, volatility: 15, volMomentum: 10,
  },
  [MARKET_REGIMES.QUIET]: {
    volume: 20, spreadInv: 25, openInterest: 10, fundingInv: 10,
    momentum: 5, volatility: 10, volMomentum: 20,
  },
  default: {
    volume: 20, spreadInv: 15, openInterest: 15, fundingInv: 10,
    momentum: 15, volatility: 10, volMomentum: 15,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute percentile ranks for an array of numeric-string values.
 * Returns an array of strings in [0, 100].
 *
 * @param {string[]} values
 * @returns {string[]}
 */
function percentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return ['50'];

  // Build sorted indices
  const indexed = values.map((v, i) => ({ val: parseFloat(v) || 0, idx: i }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array(n);
  for (let rank = 0; rank < n; rank++) {
    const pct = (rank / (n - 1)) * 100;
    ranks[indexed[rank].idx] = toFixed(String(pct), 2);
  }
  return ranks;
}

/**
 * Run async tasks with a concurrency limit.
 *
 * @param {Array<() => Promise<*>>} tasks
 * @param {number} limit
 * @returns {Promise<Array<{ ok: boolean, value?: *, error?: Error }>>}
 */
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { ok: true, value: await tasks[idx]() };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// CoinSelector class
// ---------------------------------------------------------------------------

class CoinSelector extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   * @param {import('./marketRegime')}     deps.marketRegime
   */
  constructor({ exchangeClient, tickerAggregator, marketRegime }) {
    super();

    if (!exchangeClient) {
      throw new Error('CoinSelector: exchangeClient dependency is required');
    }
    if (!tickerAggregator) {
      throw new Error('CoinSelector: tickerAggregator dependency is required');
    }
    if (!marketRegime) {
      throw new Error('CoinSelector: marketRegime dependency is required');
    }

    /** @private */
    this._exchange = exchangeClient;
    /** @private */
    this._aggregator = tickerAggregator;
    /** @private */
    this._regime = marketRegime;
    /** @private */
    this._cache = new MarketDataCache();
    /** @type {Object} mutable selection criteria */
    this._config = { ...DEFAULT_CONFIG };
    /** @private — last scoring details for diagnostics */
    this._lastScoringDetails = null;
    /** @private — last active weight profile */
    this._lastWeightProfile = null;
  }

  // =========================================================================
  // Main selection pipeline
  // =========================================================================

  /**
   * Select the most tradable symbols using the multi-factor scoring pipeline.
   *
   * Pipeline:
   *   1. Pre-filter: volume, spread, change thresholds
   *   2. Enrichment: fetch OI/funding for candidates (cached)
   *   3. Factor compute: 7 raw factor values
   *   4. Normalize: percentile rank [0~100]
   *   5. Score: regime-weighted composite score
   *   6. Sort & trim: top N by score
   *   7. Emit: COIN_SELECTED event
   *
   * @param {string} [category='USDT-FUTURES']
   * @returns {Promise<Object[]>}
   */
  async selectCoins(category = CATEGORIES.USDT_FUTURES) {
    // ---- Collect tickers ----
    let tickers = this._aggregator.getAllTickers();

    if (!tickers || tickers.length === 0) {
      log.info('Aggregator empty — fetching tickers via REST', { category });
      try {
        const response = await this._exchange.getTickers({ category });
        const raw = Array.isArray(response?.data) ? response.data : [];
        tickers = raw.map((t) => ({
          symbol: t.symbol ?? t.instId ?? '',
          lastPrice: String(t.last ?? t.lastPr ?? t.lastPrice ?? '0'),
          bid: String(t.bestBid ?? t.bid ?? t.bidPr ?? '0'),
          ask: String(t.bestAsk ?? t.ask ?? t.askPr ?? '0'),
          vol24h: String(t.baseVolume ?? t.volume ?? t.quoteVolume ?? '0'),
          change24h: String(t.change24h ?? t.changeUtc24h ?? t.priceChangePercent ?? '0'),
          high24h: String(t.high24h ?? t.highPr ?? '0'),
          low24h: String(t.low24h ?? t.lowPr ?? '0'),
        }));
      } catch (err) {
        log.error('Failed to fetch tickers via REST', { error: err });
        return [];
      }
    }

    if (tickers.length === 0) {
      log.info('No tickers available for selection');
      return [];
    }

    const { minVolume24h, maxSpreadPercent, maxChangePercent, maxSymbols, concurrency, cacheTtlMs } = this._config;

    // ---- Step 1: Pre-filter ----
    const candidates = [];

    for (const ticker of tickers) {
      if (!ticker.symbol) continue;

      const vol = ticker.vol24h || '0';
      const change = ticker.change24h || '0';
      const bid = ticker.bid || '0';
      const ask = ticker.ask || '0';

      // Volume filter
      if (isLessThan(vol, minVolume24h)) continue;

      // Spread filter
      let spreadPercent = '0';
      try {
        if (isGreaterThan(bid, '0')) {
          const spreadAbs = subtract(ask, bid);
          spreadPercent = multiply(divide(spreadAbs, bid, 8), '100');
        } else {
          continue;
        }
      } catch (_) {
        continue;
      }

      if (isGreaterThan(spreadPercent, maxSpreadPercent)) continue;

      // Change filter — absolute value must be under max
      const absChange = abs(change);
      if (isGreaterThan(absChange, maxChangePercent)) continue;

      candidates.push({
        symbol: ticker.symbol,
        vol24h: vol,
        change24h: change,
        spread: toFixed(spreadPercent, 4),
        lastPrice: ticker.lastPrice || '0',
        bid,
        ask,
        high24h: ticker.high24h || '0',
        low24h: ticker.low24h || '0',
      });
    }

    if (candidates.length === 0) {
      log.info('No candidates passed pre-filter');
      return [];
    }

    // ---- Step 2: Enrichment — fetch OI & funding rate ----
    const enrichmentTasks = candidates.map((c) => () => this._enrichSymbol(c.symbol, category, cacheTtlMs));
    const enrichResults = await runWithConcurrency(enrichmentTasks, concurrency);

    const enrichMap = {};
    for (let i = 0; i < candidates.length; i++) {
      if (enrichResults[i].ok) {
        enrichMap[candidates[i].symbol] = enrichResults[i].value;
      } else {
        enrichMap[candidates[i].symbol] = { openInterest: '0', fundingRate: '0' };
      }
    }

    // ---- Step 3: Factor compute ----
    const currentRegime = this._regime.getCurrentRegime();
    const factorArrays = {
      volume: [],
      spreadInv: [],
      openInterest: [],
      fundingInv: [],
      momentum: [],
      volatility: [],
      volMomentum: [],
    };

    for (const c of candidates) {
      const enrich = enrichMap[c.symbol];

      // F1: Volume (raw)
      factorArrays.volume.push(c.vol24h);

      // F2: Spread inverse (lower spread = better → invert)
      const spreadVal = parseFloat(c.spread) || 0;
      const spreadInv = spreadVal > 0 ? toFixed(String(1 / spreadVal), 8) : '0';
      factorArrays.spreadInv.push(spreadInv);

      // F3: Open Interest
      factorArrays.openInterest.push(enrich.openInterest);

      // F4: Funding Rate inverse (closer to 0 = better → invert absolute)
      const fundingAbs = parseFloat(abs(enrich.fundingRate)) || 0;
      const fundingInv = fundingAbs > 0 ? toFixed(String(1 / fundingAbs), 8) : '0';
      factorArrays.fundingInv.push(fundingInv);

      // F5: Momentum (direction-adjusted by regime)
      const momentumVal = this._adjustMomentum(c.change24h, currentRegime);
      factorArrays.momentum.push(momentumVal);

      // F6: Volatility (intraday range / price)
      let volatility = '0';
      try {
        if (isGreaterThan(c.lastPrice, '0') && isGreaterThan(c.high24h, '0')) {
          const range = subtract(c.high24h, c.low24h);
          volatility = multiply(divide(range, c.lastPrice, 8), '100');
        }
      } catch (_) { /* keep 0 */ }
      factorArrays.volatility.push(volatility);

      // F7: Volume Momentum (same as volume — percentile rank will differentiate)
      factorArrays.volMomentum.push(c.vol24h);
    }

    // ---- Step 4: Normalize — percentile ranks ----
    const normalized = {};
    for (const key of Object.keys(factorArrays)) {
      normalized[key] = percentileRanks(factorArrays[key]);
    }

    // ---- Step 5: Score — regime-weighted composite ----
    const weights = WEIGHT_PROFILES[currentRegime] || WEIGHT_PROFILES.default;
    this._lastWeightProfile = { regime: currentRegime, weights };

    const scored = candidates.map((c, i) => {
      let compositeScore = 0;
      const factorScores = {};

      for (const factor of Object.keys(weights)) {
        const rank = parseFloat(normalized[factor][i]) || 0;
        const w = weights[factor];
        const contribution = (rank * w) / 100;
        compositeScore += contribution;
        factorScores[factor] = toFixed(String(rank), 2);
      }

      return {
        symbol: c.symbol,
        score: toFixed(String(compositeScore), 2),
        vol24h: c.vol24h,
        change24h: c.change24h,
        spread: c.spread,
        lastPrice: c.lastPrice,
        openInterest: enrichMap[c.symbol].openInterest,
        fundingRate: enrichMap[c.symbol].fundingRate,
        volatility: factorArrays.volatility[candidates.indexOf(c)],
        regime: currentRegime,
        _factorScores: factorScores,
      };
    });

    // ---- Step 6: Sort by score descending & trim ----
    scored.sort((a, b) => {
      if (isGreaterThan(a.score, b.score)) return -1;
      if (isLessThan(a.score, b.score)) return 1;
      return 0;
    });

    const selected = scored.slice(0, maxSymbols);
    const selectedSymbols = selected.map((s) => s.symbol);

    // Store diagnostics
    this._lastScoringDetails = scored;

    log.info('Coin selection complete', {
      regime: currentRegime,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      topScore: selected[0]?.score,
      symbols: selectedSymbols,
    });

    // ---- Step 7: Emit event (backward compatible shape) ----
    this.emit(MARKET_EVENTS.COIN_SELECTED, {
      symbols: selectedSymbols,
      details: selected,
      ts: Date.now(),
    });

    return selected;
  }

  // =========================================================================
  // Enrichment helpers
  // =========================================================================

  /**
   * Fetch OI and funding rate for a symbol (cache-first).
   *
   * @param {string} symbol
   * @param {string} category
   * @param {number} ttlMs
   * @returns {Promise<{ openInterest: string, fundingRate: string }>}
   * @private
   */
  async _enrichSymbol(symbol, category, ttlMs) {
    const cacheKey = `enrich:${symbol}`;
    const cached = this._cache.get(cacheKey);
    if (cached) return cached;

    let openInterest = '0';
    let fundingRate = '0';

    try {
      const oiRes = await this._exchange.getOpenInterest({ symbol, category });
      openInterest = String(oiRes?.data?.openInterest ?? oiRes?.data?.amount ?? '0');
    } catch (err) {
      log.debug('Failed to fetch OI', { symbol, error: err.message });
    }

    try {
      const frRes = await this._exchange.getFundingRate({ symbol, category });
      fundingRate = String(frRes?.data?.fundingRate ?? '0');
    } catch (err) {
      log.debug('Failed to fetch funding rate', { symbol, error: err.message });
    }

    const result = { openInterest, fundingRate };
    this._cache.set(cacheKey, result, ttlMs);
    return result;
  }

  /**
   * Adjust momentum value based on current market regime.
   *
   * - trending_up:   raw change (positive = good)
   * - trending_down:  inverted change (negative change = good)
   * - ranging/volatile/quiet: absolute change (movement = opportunity)
   *
   * @param {string} change24h
   * @param {string} regime
   * @returns {string}
   * @private
   */
  _adjustMomentum(change24h, regime) {
    switch (regime) {
      case MARKET_REGIMES.TRENDING_UP:
        return change24h;
      case MARKET_REGIMES.TRENDING_DOWN: {
        const neg = parseFloat(change24h) || 0;
        return toFixed(String(-neg), 4);
      }
      default:
        return abs(change24h);
    }
  }

  // =========================================================================
  // Diagnostics
  // =========================================================================

  /**
   * Return the full scoring breakdown from the last selectCoins() call.
   * @returns {Object[]|null}
   */
  getScoringDetails() {
    return this._lastScoringDetails;
  }

  /**
   * Return the current regime and the weight profile being used.
   * @returns {{ regime: string, weights: Object }|null}
   */
  getActiveWeightProfile() {
    return this._lastWeightProfile;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update filter criteria. Partial updates are merged.
   * @param {Object} newConfig
   */
  updateConfig(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') {
      log.warn('updateConfig called with invalid argument');
      return;
    }

    const prev = { ...this._config };
    Object.assign(this._config, newConfig);
    log.info('CoinSelector config updated', { previous: prev, current: this._config });
  }

  /**
   * Return the current configuration.
   * @returns {Object}
   */
  getConfig() {
    return { ...this._config };
  }
}

module.exports = CoinSelector;
