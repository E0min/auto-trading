'use strict';

/**
 * CoinSelector — Market-cap-based symbol selection via CoinGecko.
 *
 * Pipeline:
 *   1. Fetch top 100 coins by market cap from CoinGecko
 *   2. Cross-match with Bitget tickers (baseToSymbol mapping)
 *   3. Pre-filter: volume, spread, effective cost
 *   4. Select top 15 by market cap rank
 *   5. Emit COIN_SELECTED event
 *
 * Fallback: if CoinGecko fails, select top 15 by 24h volume.
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, CATEGORIES } = require('../utils/constants');
const {
  add,
  subtract,
  divide,
  multiply,
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
  minVolume24h: '200000',
  /** Maximum spread percent to pass pre-filter */
  maxSpreadPercent: '1.0',
  /** Maximum number of symbols to return */
  maxSymbols: 15,
});

// ---------------------------------------------------------------------------
// CoinSelector class
// ---------------------------------------------------------------------------

class CoinSelector extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   * @param {import('./marketRegime')}     deps.marketRegime
   * @param {import('./coinGeckoClient')}  [deps.coinGeckoClient]
   */
  constructor({ exchangeClient, tickerAggregator, marketRegime, coinGeckoClient, maxEffectiveCost = '0.15' }) {
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
    this._coinGecko = coinGeckoClient || null;
    /** @type {Object} mutable selection criteria */
    this._config = { ...DEFAULT_CONFIG };
    /** @private — max effective cost threshold in % (P12-9) */
    this._maxEffectiveCost = String(maxEffectiveCost);
    /** @private — last scoring details for diagnostics */
    this._lastScoringDetails = null;
    /** @private — last active weight profile */
    this._lastWeightProfile = null;
    /** @private — last selection method used */
    this._lastSelectionMethod = null;
    /** @private — re-entrancy guard for selectCoins() */
    this._selecting = false;
  }

  // =========================================================================
  // Main selection pipeline
  // =========================================================================

  /**
   * Select the most tradable symbols by market cap (CoinGecko).
   * Falls back to volume-based selection if CoinGecko is unavailable.
   *
   * @param {string} [category='USDT-FUTURES']
   * @returns {Promise<Object[]>}
   */
  async selectCoins(category = CATEGORIES.USDT_FUTURES) {
    if (this._selecting) {
      log.warn('selectCoins — already running, skipping re-entrant call');
      return [];
    }
    this._selecting = true;
    try {
      return await this._selectCoinsInner(category);
    } finally {
      this._selecting = false;
    }
  }

  /** @private — inner implementation of selectCoins */
  async _selectCoinsInner(category) {
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

    const { minVolume24h, maxSpreadPercent, maxSymbols } = this._config;

    // ---- Step 1: Build baseToSymbol map from Bitget tickers ----
    const baseToSymbol = new Map();
    for (const ticker of tickers) {
      if (!ticker.symbol || !ticker.symbol.endsWith('USDT')) continue;
      const raw = ticker.symbol.slice(0, -4); // strip "USDT"
      // Handle 1000x symbols: 1000PEPE → pepe, 1000SHIB → shib
      const base = raw.startsWith('1000')
        ? raw.slice(4).toLowerCase()
        : raw.toLowerCase();
      baseToSymbol.set(base, ticker.symbol);
    }

    // ---- Step 2: Pre-filter tickers ----
    const tickerMap = new Map();
    for (const ticker of tickers) {
      if (!ticker.symbol) continue;
      tickerMap.set(ticker.symbol, ticker);
    }

    /**
     * Check if a ticker passes pre-filter (volume, spread, effective cost).
     * @returns {{ pass: boolean, spread?: string }}
     */
    const passesFilter = (ticker) => {
      const vol = ticker.vol24h || '0';
      const bid = ticker.bid || '0';
      const ask = ticker.ask || '0';

      if (isLessThan(vol, minVolume24h)) return { pass: false };

      let spreadPercent = '0';
      try {
        if (isGreaterThan(bid, '0')) {
          const spreadAbs = subtract(ask, bid);
          spreadPercent = multiply(divide(spreadAbs, bid, 8), '100');
        } else {
          return { pass: false };
        }
      } catch (_) {
        return { pass: false };
      }

      if (isGreaterThan(spreadPercent, maxSpreadPercent)) return { pass: false };

      // Effective cost filter
      const TAKER_COMMISSION = '0.06';
      const effectiveCost = add(spreadPercent, TAKER_COMMISSION);
      if (isGreaterThan(effectiveCost, this._maxEffectiveCost)) return { pass: false };

      return { pass: true, spread: toFixed(spreadPercent, 4) };
    };

    // ---- Step 3: Try CoinGecko market cap selection ----
    let selected = [];
    const currentRegime = this._regime.getCurrentRegime();

    if (this._coinGecko) {
      try {
        const topCoins = await this._coinGecko.fetchTopCoins(100);

        if (topCoins.length > 0) {
          selected = this._selectByMarketCap(topCoins, baseToSymbol, tickerMap, passesFilter, currentRegime, maxSymbols);
        }
      } catch (err) {
        log.warn('CoinGecko selection failed, falling back to volume', { error: err.message });
      }
    }

    // ---- Step 4: Fallback — volume-based selection ----
    if (selected.length === 0) {
      selected = this._selectByVolume(tickers, passesFilter, currentRegime, maxSymbols);
      this._lastSelectionMethod = 'volume_fallback';
    } else {
      this._lastSelectionMethod = 'market_cap';
    }

    if (selected.length === 0) {
      log.info('No coins selected after all pipelines');
      return [];
    }

    const selectedSymbols = selected.map((s) => s.symbol);

    // Store diagnostics
    this._lastScoringDetails = selected;
    this._lastWeightProfile = {
      regime: currentRegime,
      method: this._lastSelectionMethod,
      weights: { marketCapRank: 100 },
    };

    log.info('Coin selection complete', {
      method: this._lastSelectionMethod,
      regime: currentRegime,
      selectedCount: selected.length,
      symbols: selectedSymbols,
    });

    // Emit event (backward compatible shape)
    this.emit(MARKET_EVENTS.COIN_SELECTED, {
      symbols: selectedSymbols,
      details: selected,
      ts: Date.now(),
    });

    return selected;
  }

  // =========================================================================
  // Selection strategies
  // =========================================================================

  /**
   * Select coins by market cap rank from CoinGecko data.
   * @private
   */
  _selectByMarketCap(topCoins, baseToSymbol, tickerMap, passesFilter, regime, maxSymbols) {
    const results = [];

    for (const coin of topCoins) {
      if (results.length >= maxSymbols) break;

      const bitgetSymbol = baseToSymbol.get(coin.symbol);
      if (!bitgetSymbol) continue;

      const ticker = tickerMap.get(bitgetSymbol);
      if (!ticker) continue;

      const filterResult = passesFilter(ticker);
      if (!filterResult.pass) continue;

      const rank = parseInt(coin.marketCapRank, 10) || 100;
      const score = toFixed(String(Math.max(0, 100 - rank + 1)), 2);

      results.push({
        symbol: bitgetSymbol,
        score,
        vol24h: ticker.vol24h || '0',
        change24h: ticker.change24h || '0',
        spread: filterResult.spread || '0',
        lastPrice: ticker.lastPrice || '0',
        marketCap: coin.marketCap,
        marketCapRank: coin.marketCapRank,
        regime,
        _factorScores: { marketCapRank: coin.marketCapRank },
      });
    }

    return results;
  }

  /**
   * Fallback: select coins by 24h volume descending.
   * @private
   */
  _selectByVolume(tickers, passesFilter, regime, maxSymbols) {
    const candidates = [];

    for (const ticker of tickers) {
      if (!ticker.symbol) continue;

      const filterResult = passesFilter(ticker);
      if (!filterResult.pass) continue;

      candidates.push({
        symbol: ticker.symbol,
        vol24h: ticker.vol24h || '0',
        change24h: ticker.change24h || '0',
        spread: filterResult.spread || '0',
        lastPrice: ticker.lastPrice || '0',
      });
    }

    // Sort by volume descending
    candidates.sort((a, b) => {
      if (isGreaterThan(a.vol24h, b.vol24h)) return -1;
      if (isLessThan(a.vol24h, b.vol24h)) return 1;
      return 0;
    });

    return candidates.slice(0, maxSymbols).map((c, i) => ({
      symbol: c.symbol,
      score: toFixed(String(Math.max(0, 100 - i)), 2),
      vol24h: c.vol24h,
      change24h: c.change24h,
      spread: c.spread,
      lastPrice: c.lastPrice,
      marketCap: '0',
      marketCapRank: '0',
      regime,
      _factorScores: { marketCapRank: '0' },
    }));
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
   * Return the current method and the weight profile being used.
   * @returns {{ regime: string, method?: string, weights: Object }|null}
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
