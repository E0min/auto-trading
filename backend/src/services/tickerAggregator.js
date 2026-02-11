'use strict';

/**
 * TickerAggregator — Aggregates all ticker data into a market overview.
 *
 * Listens to MarketData TICKER_UPDATE events, maintains a live map of every
 * ticker, and periodically recomputes aggregate statistics (advancers/decliners,
 * total volume, average change, top movers, volatility index).
 *
 * All monetary / numeric values are represented as String.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS } = require('../utils/constants');
const {
  add,
  subtract,
  divide,
  abs,
  toFixed,
  isGreaterThan,
  isLessThan,
} = require('../utils/mathUtils');

const log = createLogger('TickerAggregator');

/** Minimum interval (ms) between aggregate recalculations. */
const RECALC_DEBOUNCE_MS = 2000;

// ---------------------------------------------------------------------------
// TickerAggregator class
// ---------------------------------------------------------------------------

class TickerAggregator extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./marketData')} deps.marketData
   */
  constructor({ marketData }) {
    super();

    if (!marketData) {
      throw new Error('TickerAggregator: marketData dependency is required');
    }

    /** @private */
    this._marketData = marketData;

    /** @type {Map<string, Object>} symbol → latest normalised ticker */
    this._tickers = new Map();

    /** @type {Object} latest aggregate statistics */
    this._aggregateStats = {};

    /** @private debounce timer id */
    this._recalcTimer = null;

    /** @private timestamp of last recalculation */
    this._lastRecalcTs = 0;

    // Bound handler reference for clean removal.
    this._boundOnTickerUpdate = this._onTickerUpdate.bind(this);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start listening for ticker updates from MarketData.
   */
  start() {
    this._marketData.on(MARKET_EVENTS.TICKER_UPDATE, this._boundOnTickerUpdate);
    log.info('TickerAggregator started');
  }

  /**
   * Stop listening and clear internal state.
   */
  stop() {
    this._marketData.removeListener(MARKET_EVENTS.TICKER_UPDATE, this._boundOnTickerUpdate);

    if (this._recalcTimer !== null) {
      clearTimeout(this._recalcTimer);
      this._recalcTimer = null;
    }

    this._tickers.clear();
    this._aggregateStats = {};

    log.info('TickerAggregator stopped');
  }

  // =========================================================================
  // Internal handlers
  // =========================================================================

  /**
   * Handle an incoming ticker update from MarketData.
   *
   * @param {Object} data — normalised ticker from MarketData
   * @private
   */
  _onTickerUpdate(data) {
    if (!data || !data.symbol) return;

    this._tickers.set(data.symbol, data);

    // Debounced recalculation: schedule at most once per RECALC_DEBOUNCE_MS.
    const now = Date.now();
    if (now - this._lastRecalcTs >= RECALC_DEBOUNCE_MS) {
      // Enough time has elapsed — recalculate immediately.
      this._lastRecalcTs = now;
      this._doRecalculate();
    } else if (this._recalcTimer === null) {
      // Schedule a deferred recalculation.
      const delay = RECALC_DEBOUNCE_MS - (now - this._lastRecalcTs);
      this._recalcTimer = setTimeout(() => {
        this._recalcTimer = null;
        this._lastRecalcTs = Date.now();
        this._doRecalculate();
      }, delay);
    }
  }

  /**
   * Wrapper around _recalculate that catches errors so one bad tick
   * never kills the aggregation loop.
   * @private
   */
  _doRecalculate() {
    try {
      this._recalculate();
    } catch (err) {
      log.error('Aggregate recalculation failed', { error: err });
    }
  }

  /**
   * Recompute all aggregate statistics from the current ticker map.
   *
   * Emits 'aggregate:update' with the computed stats object.
   * @private
   */
  _recalculate() {
    const tickers = Array.from(this._tickers.values());
    const count = tickers.length;

    if (count === 0) {
      this._aggregateStats = {
        advancers: 0,
        decliners: 0,
        unchanged: 0,
        totalVolume: '0',
        avgChange: '0',
        maxGainer: null,
        maxLoser: null,
        volatilityIndex: '0',
        tickerCount: 0,
        ts: Date.now(),
      };
      this.emit('aggregate:update', this._aggregateStats);
      return;
    }

    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let totalVolume = '0';
    let changeSum = '0';

    // Track extremes
    let maxGainer = null;
    let maxGainerChange = '-999999';
    let maxLoser = null;
    let maxLoserChange = '999999';

    // Collect change24h values for volatility calculation
    const changeValues = [];

    for (const ticker of tickers) {
      const change = ticker.change24h || '0';
      const vol = ticker.vol24h || '0';

      // Count advancers / decliners / unchanged
      if (isGreaterThan(change, '0')) {
        advancers++;
      } else if (isLessThan(change, '0')) {
        decliners++;
      } else {
        unchanged++;
      }

      // Accumulate volume
      totalVolume = add(totalVolume, vol);

      // Accumulate change for average
      changeSum = add(changeSum, change);

      // Track max gainer
      if (isGreaterThan(change, maxGainerChange)) {
        maxGainerChange = change;
        maxGainer = { symbol: ticker.symbol, change24h: change };
      }

      // Track max loser
      if (isLessThan(change, maxLoserChange)) {
        maxLoserChange = change;
        maxLoser = { symbol: ticker.symbol, change24h: change };
      }

      changeValues.push(change);
    }

    // Average change
    let avgChange = '0';
    try {
      avgChange = divide(changeSum, String(count), 4);
    } catch (_) {
      // division by zero guard — count is > 0 so this should not happen
      avgChange = '0';
    }

    // Volatility index: mean absolute deviation of change24h values.
    // MAD = (1/N) * SUM(|xi - mean|)
    let madSum = '0';
    for (const c of changeValues) {
      const deviation = abs(subtract(c, avgChange));
      madSum = add(madSum, deviation);
    }
    let volatilityIndex = '0';
    try {
      volatilityIndex = divide(madSum, String(count), 4);
    } catch (_) {
      volatilityIndex = '0';
    }

    this._aggregateStats = {
      advancers,
      decliners,
      unchanged,
      totalVolume: toFixed(totalVolume, 2),
      avgChange: toFixed(avgChange, 4),
      maxGainer,
      maxLoser,
      volatilityIndex: toFixed(volatilityIndex, 4),
      tickerCount: count,
      ts: Date.now(),
    };

    this.emit('aggregate:update', this._aggregateStats);
    log.debug('Aggregate stats recalculated', {
      tickerCount: count,
      advancers,
      decliners,
      avgChange: this._aggregateStats.avgChange,
    });
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  /**
   * Return the current aggregate statistics.
   * @returns {Object}
   */
  getStats() {
    return this._aggregateStats;
  }

  /**
   * Return the cached ticker for a specific symbol.
   * @param {string} symbol
   * @returns {Object|null}
   */
  getTicker(symbol) {
    return this._tickers.get(symbol) || null;
  }

  /**
   * Return all cached tickers as an array.
   * @returns {Object[]}
   */
  getAllTickers() {
    return Array.from(this._tickers.values());
  }

  /**
   * Return the top N movers by absolute change24h (descending).
   *
   * @param {number} [n=5]
   * @returns {Object[]}
   */
  getTopMovers(n = 5) {
    const tickers = Array.from(this._tickers.values());

    if (tickers.length === 0) return [];

    // Sort by absolute change24h descending
    tickers.sort((a, b) => {
      const absA = parseFloat(abs(a.change24h || '0'));
      const absB = parseFloat(abs(b.change24h || '0'));
      return absB - absA;
    });

    return tickers.slice(0, Math.min(n, tickers.length));
  }
}

module.exports = TickerAggregator;
