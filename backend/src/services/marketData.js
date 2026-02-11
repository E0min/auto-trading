'use strict';

/**
 * MarketData — WebSocket market data pipeline.
 *
 * Subscribes to exchange WebSocket channels, normalises raw events into a
 * consistent shape, caches the latest snapshot per symbol, and re-emits
 * well-typed events that downstream services consume.
 *
 * All monetary / numeric values are represented as String to preserve
 * precision — consumers must use mathUtils for any arithmetic.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, WS_INST_TYPES } = require('../utils/constants');

const log = createLogger('MarketData');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely convert a value to a String.  Returns '0' for nil / NaN.
 * @param {*} val
 * @returns {string}
 */
function toStr(val) {
  if (val === null || val === undefined || val === '') return '0';
  const s = String(val);
  if (s === 'NaN' || s === 'undefined' || s === 'null') return '0';
  return s;
}

/**
 * Map a category constant to the instType string Bitget WS expects.
 * @param {string} category
 * @returns {string}
 */
function categoryToInstType(category) {
  switch (category) {
    case 'USDT-FUTURES':
      return WS_INST_TYPES.PUBLIC_FUTURES; // 'usdt-futures'
    case 'COIN-FUTURES':
      return 'coin-futures';
    case 'USDC-FUTURES':
      return 'usdc-futures';
    case 'SPOT':
      return 'spot';
    default:
      return WS_INST_TYPES.PUBLIC_FUTURES;
  }
}

// ---------------------------------------------------------------------------
// MarketData class
// ---------------------------------------------------------------------------

class MarketData extends EventEmitter {
  /**
   * @param {Object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient — singleton exchange client
   */
  constructor({ exchangeClient }) {
    super();

    if (!exchangeClient) {
      throw new Error('MarketData: exchangeClient dependency is required');
    }

    /** @private */
    this._exchange = exchangeClient;

    /** @type {Set<string>} symbols currently subscribed */
    this._subscribedSymbols = new Set();

    /** @type {Map<string, Object>} symbol → latest normalised ticker */
    this._latestTickers = new Map();

    /** @type {Map<string, Object>} symbol → latest normalised kline */
    this._latestKlines = new Map();

    // Bound handler references so we can cleanly remove them later.
    this._boundHandleTicker = this._handleTicker.bind(this);
    this._boundHandleKline = this._handleKline.bind(this);
    this._boundHandleBook = this._handleBook.bind(this);

    /** @type {boolean} */
    this._running = false;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Attach listeners to the exchangeClient's normalised WS events.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start() {
    if (this._running) {
      log.info('Already running — skipping start');
      return;
    }

    this._exchange.on('ws:ticker', this._boundHandleTicker);
    this._exchange.on('ws:kline', this._boundHandleKline);
    this._exchange.on('ws:book', this._boundHandleBook);

    this._running = true;
    log.info('MarketData started — listening for WS events');
  }

  /**
   * Remove listeners and clear internal caches.
   */
  stop() {
    this._exchange.removeListener('ws:ticker', this._boundHandleTicker);
    this._exchange.removeListener('ws:kline', this._boundHandleKline);
    this._exchange.removeListener('ws:book', this._boundHandleBook);

    this._latestTickers.clear();
    this._latestKlines.clear();
    this._running = false;

    log.info('MarketData stopped — listeners removed, caches cleared');
  }

  // =========================================================================
  // Subscription management
  // =========================================================================

  /**
   * Subscribe to ticker and 1-minute kline channels for the given symbols.
   *
   * @param {string[]} symbols — e.g. ['BTCUSDT', 'ETHUSDT']
   * @param {string}   [category='USDT-FUTURES']
   */
  subscribeSymbols(symbols, category = 'USDT-FUTURES') {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      log.warn('subscribeSymbols called with empty or invalid symbols array');
      return;
    }

    const instType = categoryToInstType(category);
    const topics = [];

    for (const symbol of symbols) {
      if (this._subscribedSymbols.has(symbol)) {
        log.debug(`Already subscribed to ${symbol} — skipping`);
        continue;
      }

      topics.push(
        { topic: 'ticker', payload: { instType, symbol } },
        { topic: 'candle1m', payload: { instType, symbol } },
      );

      this._subscribedSymbols.add(symbol);
    }

    if (topics.length > 0) {
      this._exchange.subscribePublic(topics);
      log.info('Subscribed to symbols', {
        count: topics.length / 2,
        symbols: symbols.filter((s) => this._subscribedSymbols.has(s)),
      });
    }
  }

  /**
   * Unsubscribe from ticker and 1-minute kline channels for the given symbols.
   *
   * @param {string[]} symbols
   * @param {string}   [category='USDT-FUTURES']
   */
  unsubscribeSymbols(symbols, category = 'USDT-FUTURES') {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      log.warn('unsubscribeSymbols called with empty or invalid symbols array');
      return;
    }

    const instType = categoryToInstType(category);
    const topics = [];

    for (const symbol of symbols) {
      if (!this._subscribedSymbols.has(symbol)) {
        log.debug(`Not subscribed to ${symbol} — skipping unsubscribe`);
        continue;
      }

      topics.push(
        { topic: 'ticker', payload: { instType, symbol } },
        { topic: 'candle1m', payload: { instType, symbol } },
      );

      this._subscribedSymbols.delete(symbol);
      this._latestTickers.delete(symbol);
      this._latestKlines.delete(symbol);
    }

    if (topics.length > 0) {
      this._exchange.unsubscribePublic(topics);
      log.info('Unsubscribed from symbols', {
        count: topics.length / 2,
        symbols,
      });
    }
  }

  // =========================================================================
  // Internal WS event handlers
  // =========================================================================

  /**
   * Normalise and cache a ticker update, then emit MARKET_EVENTS.TICKER_UPDATE.
   *
   * Bitget ticker data (from ws:ticker) typically arrives as:
   *   { topic, symbol, instType, ts, data: [{ last, bestBid, bestAsk, high24h, low24h, baseVolume, change24h, ... }] }
   *
   * @param {Object} event — normalised WS event from exchangeClient
   * @private
   */
  _handleTicker(event) {
    try {
      const symbol = event.symbol;
      if (!symbol) {
        log.debug('_handleTicker: event missing symbol — skipping');
        return;
      }

      // data may be an array of ticker objects or a single object
      const raw = Array.isArray(event.data) ? event.data[0] : event.data;
      if (!raw) {
        log.debug('_handleTicker: event has no data payload', { symbol });
        return;
      }

      const normalised = {
        symbol,
        lastPrice: toStr(raw.last ?? raw.lastPr ?? raw.lastPrice ?? raw.price),
        bid: toStr(raw.bestBid ?? raw.bid ?? raw.bidPr ?? raw.bid1),
        ask: toStr(raw.bestAsk ?? raw.ask ?? raw.askPr ?? raw.ask1),
        high24h: toStr(raw.high24h ?? raw.highPrice),
        low24h: toStr(raw.low24h ?? raw.lowPrice),
        vol24h: toStr(raw.baseVolume ?? raw.volume ?? raw.vol24h ?? raw.quoteVolume),
        change24h: toStr(raw.change24h ?? raw.changeUtc24h ?? raw.priceChangePercent),
        ts: event.ts || Date.now(),
      };

      this._latestTickers.set(symbol, normalised);
      this.emit(MARKET_EVENTS.TICKER_UPDATE, normalised);
    } catch (err) {
      log.error('_handleTicker error', { error: err });
    }
  }

  /**
   * Normalise and cache a kline update, then emit MARKET_EVENTS.KLINE_UPDATE.
   *
   * Bitget kline data typically arrives as:
   *   { topic, symbol, instType, ts, data: [[ts, open, high, low, close, volume, turnover]] }
   *
   * @param {Object} event
   * @private
   */
  _handleKline(event) {
    try {
      const symbol = event.symbol;
      if (!symbol) {
        log.debug('_handleKline: event missing symbol — skipping');
        return;
      }

      const raw = event.data;
      if (!raw) {
        log.debug('_handleKline: event has no data payload', { symbol });
        return;
      }

      // data is typically [[ts, open, high, low, close, volume, turnover]]
      // or [{ ts, o, h, l, c, v }]
      let candle;
      if (Array.isArray(raw) && raw.length > 0) {
        const entry = raw[raw.length - 1]; // latest candle
        if (Array.isArray(entry)) {
          // Array format: [ts, open, high, low, close, volume, turnover]
          candle = {
            symbol,
            interval: event.topic || '1m',
            open: toStr(entry[1]),
            high: toStr(entry[2]),
            low: toStr(entry[3]),
            close: toStr(entry[4]),
            volume: toStr(entry[5]),
            ts: entry[0] ? Number(entry[0]) : event.ts || Date.now(),
          };
        } else if (typeof entry === 'object' && entry !== null) {
          // Object format
          candle = {
            symbol,
            interval: event.topic || '1m',
            open: toStr(entry.o ?? entry.open),
            high: toStr(entry.h ?? entry.high),
            low: toStr(entry.l ?? entry.low),
            close: toStr(entry.c ?? entry.close),
            volume: toStr(entry.v ?? entry.volume ?? entry.baseVolume),
            ts: entry.ts ? Number(entry.ts) : event.ts || Date.now(),
          };
        }
      }

      if (!candle) {
        log.debug('_handleKline: could not parse candle data', { symbol });
        return;
      }

      this._latestKlines.set(symbol, candle);
      this.emit(MARKET_EVENTS.KLINE_UPDATE, candle);
    } catch (err) {
      log.error('_handleKline error', { error: err });
    }
  }

  /**
   * Normalise an order-book update and emit MARKET_EVENTS.BOOK_UPDATE.
   *
   * @param {Object} event
   * @private
   */
  _handleBook(event) {
    try {
      const symbol = event.symbol;
      if (!symbol) {
        log.debug('_handleBook: event missing symbol — skipping');
        return;
      }

      const raw = Array.isArray(event.data) ? event.data[0] : event.data;
      if (!raw) {
        log.debug('_handleBook: event has no data payload', { symbol });
        return;
      }

      // Normalise bids and asks into arrays of [price, quantity] string pairs
      const normaliseSide = (entries) => {
        if (!Array.isArray(entries)) return [];
        return entries.map((e) => {
          if (Array.isArray(e)) {
            return [toStr(e[0]), toStr(e[1])];
          }
          return [toStr(e.price ?? e.p), toStr(e.size ?? e.qty ?? e.q)];
        });
      };

      const normalised = {
        symbol,
        bids: normaliseSide(raw.bids ?? raw.b),
        asks: normaliseSide(raw.asks ?? raw.a),
        ts: event.ts || Date.now(),
      };

      this.emit(MARKET_EVENTS.BOOK_UPDATE, normalised);
    } catch (err) {
      log.error('_handleBook error', { error: err });
    }
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  /**
   * Get the latest cached ticker for a symbol.
   * @param {string} symbol
   * @returns {Object|null}
   */
  getLatestTicker(symbol) {
    return this._latestTickers.get(symbol) || null;
  }

  /**
   * Get the latest cached kline for a symbol.
   * @param {string} symbol
   * @returns {Object|null}
   */
  getLatestKline(symbol) {
    return this._latestKlines.get(symbol) || null;
  }

  /**
   * Return all cached tickers as an array.
   * @returns {Object[]}
   */
  getAllTickers() {
    return Array.from(this._latestTickers.values());
  }

  /**
   * Return the set of currently subscribed symbols.
   * @returns {string[]}
   */
  getSubscribedSymbols() {
    return Array.from(this._subscribedSymbols);
  }
}

module.exports = MarketData;
