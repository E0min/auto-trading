'use strict';

/**
 * CoinSelector — Dynamic symbol selection based on tradability criteria.
 *
 * Analyses all available tickers (from TickerAggregator or direct REST fetch)
 * and returns the most tradable symbols filtered by volume, spread, and
 * change-percent thresholds.
 *
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, CATEGORIES } = require('../utils/constants');
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
// Default selection config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = Object.freeze({
  /** Minimum 24-hour volume (quote currency) */
  minVolume24h: '1000000',
  /** Maximum spread as a percentage of bid price */
  maxSpreadPercent: '0.5',
  /** Minimum absolute 24h change percent to qualify as "moving" */
  minChangePercent: '1',
  /** Maximum absolute 24h change percent (avoid blow-up / illiquid spikes) */
  maxChangePercent: '20',
  /** Maximum number of symbols to return */
  maxSymbols: 10,
});

// ---------------------------------------------------------------------------
// CoinSelector class
// ---------------------------------------------------------------------------

class CoinSelector extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   */
  constructor({ exchangeClient, tickerAggregator }) {
    super();

    if (!exchangeClient) {
      throw new Error('CoinSelector: exchangeClient dependency is required');
    }
    if (!tickerAggregator) {
      throw new Error('CoinSelector: tickerAggregator dependency is required');
    }

    /** @private */
    this._exchange = exchangeClient;

    /** @private */
    this._aggregator = tickerAggregator;

    /** @type {Object} mutable selection criteria */
    this._config = { ...DEFAULT_CONFIG };
  }

  // =========================================================================
  // Main selection
  // =========================================================================

  /**
   * Select the most tradable symbols based on the current configuration.
   *
   * Flow:
   *   1. Collect tickers from aggregator (fallback: REST fetch)
   *   2. Filter by volume, spread, and change criteria
   *   3. Sort by volume descending
   *   4. Return top N symbols
   *
   * @param {string} [category='USDT-FUTURES']
   * @returns {Promise<Object[]>} Array of { symbol, vol24h, change24h, spread }
   */
  async selectCoins(category = CATEGORIES.USDT_FUTURES) {
    let tickers = this._aggregator.getAllTickers();

    // Fallback: if aggregator has no data yet, fetch from REST.
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

    const {
      minVolume24h,
      maxSpreadPercent,
      minChangePercent,
      maxChangePercent,
      maxSymbols,
    } = this._config;

    // ----- Filter -----
    const candidates = [];

    for (const ticker of tickers) {
      // Skip tickers with missing essential data
      if (!ticker.symbol) continue;

      const vol = ticker.vol24h || '0';
      const change = ticker.change24h || '0';
      const bid = ticker.bid || '0';
      const ask = ticker.ask || '0';

      // Volume filter
      if (!isGreaterThan(vol, minVolume24h) && vol !== minVolume24h) {
        // vol < minVolume24h  (we allow equal)
        if (isLessThan(vol, minVolume24h)) continue;
      }

      // Spread filter — only if bid is non-zero to avoid division by zero
      let spreadPercent = '0';
      try {
        if (isGreaterThan(bid, '0')) {
          const spreadAbs = subtract(ask, bid);
          spreadPercent = multiply(divide(spreadAbs, bid, 8), '100');
        } else {
          // Cannot compute spread — skip this ticker
          continue;
        }
      } catch (_) {
        continue;
      }

      if (isGreaterThan(spreadPercent, maxSpreadPercent)) continue;

      // Change filter — absolute value must be within [minChangePercent, maxChangePercent]
      const absChange = abs(change);
      if (isLessThan(absChange, minChangePercent)) continue;
      if (isGreaterThan(absChange, maxChangePercent)) continue;

      candidates.push({
        symbol: ticker.symbol,
        vol24h: vol,
        change24h: change,
        spread: toFixed(spreadPercent, 4),
        lastPrice: ticker.lastPrice || '0',
      });
    }

    // ----- Sort by volume descending -----
    candidates.sort((a, b) => {
      if (isGreaterThan(a.vol24h, b.vol24h)) return -1;
      if (isLessThan(a.vol24h, b.vol24h)) return 1;
      return 0;
    });

    // ----- Take top N -----
    const selected = candidates.slice(0, maxSymbols);

    const selectedSymbols = selected.map((s) => s.symbol);

    log.info('Coin selection complete', {
      candidateCount: candidates.length,
      selectedCount: selected.length,
      symbols: selectedSymbols,
    });

    // Emit event
    this.emit(MARKET_EVENTS.COIN_SELECTED, {
      symbols: selectedSymbols,
      details: selected,
      ts: Date.now(),
    });

    return selected;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update filter criteria. Partial updates are merged.
   *
   * @param {Object} newConfig
   * @param {string} [newConfig.minVolume24h]
   * @param {string} [newConfig.maxSpreadPercent]
   * @param {string} [newConfig.minChangePercent]
   * @param {string} [newConfig.maxChangePercent]
   * @param {number} [newConfig.maxSymbols]
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
