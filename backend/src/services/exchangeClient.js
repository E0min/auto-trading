'use strict';

/**
 * Unified exchange facade — THE ONLY module that touches bitget-api SDK directly.
 *
 * Every other service in this codebase MUST interact with the exchange through
 * this module. It wraps the Bitget REST and WebSocket SDKs behind a clean,
 * event-driven interface with:
 *
 *   - Automatic retry with exponential backoff for REST calls
 *   - Structured logging of every request / response
 *   - Normalised WebSocket events emitted on a single EventEmitter
 *   - Granular error classification (rate_limit | auth_error | network_error | api_error)
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const {
  getRestClient,
  getWsPublicClient,
  getWsPrivateClient,
  getWsApiClient,
  getWsKeyMap,
} = require('../config/bitget');

const log = createLogger('ExchangeClient');

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Well-known Bitget rate-limit error codes */
const RATE_LIMIT_CODES = new Set(['429', '40014', '40015', '43011', '43012']);

/** Well-known Bitget authentication error codes */
const AUTH_ERROR_CODES = new Set(['40001', '40002', '40003', '40004', '40005', '40006', '40007', '40008', '40009', '40010', '30011']);

/**
 * Classify an error into one of the known categories so callers can decide
 * whether to retry, re-authenticate, or surface the error.
 *
 * @param {Error} error
 * @returns {'rate_limit' | 'auth_error' | 'network_error' | 'api_error'}
 */
function _classifyError(error) {
  // Network-level failures (no response from server)
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'EAI_AGAIN' ||
    error.code === 'EPIPE' ||
    error.message?.includes('socket hang up') ||
    error.message?.includes('network') ||
    error.message?.includes('fetch failed')
  ) {
    return 'network_error';
  }

  // Bitget API errors are typically surfaced as an object with a `code` field
  const code = String(error.code ?? error.statusCode ?? error.body?.code ?? '');

  if (RATE_LIMIT_CODES.has(code) || error.status === 429) {
    return 'rate_limit';
  }

  if (AUTH_ERROR_CODES.has(code) || error.status === 401 || error.status === 403) {
    return 'auth_error';
  }

  return 'api_error';
}

// ---------------------------------------------------------------------------
// ExchangeClient class
// ---------------------------------------------------------------------------

class ExchangeClient extends EventEmitter {
  constructor() {
    super();

    /** @type {boolean} Whether WebSocket connections have been initialised */
    this._wsConnected = false;
  }

  // =========================================================================
  // REST — Private helpers
  // =========================================================================

  /**
   * Generic retry wrapper with exponential backoff.
   *
   * On each failure the method:
   *   1. Classifies the error
   *   2. Logs the failure
   *   3. Emits a 'rest:error' event
   *   4. Waits before retrying (unless the error is non-retryable)
   *
   * Non-retryable errors (auth_error) are thrown immediately.
   *
   * @param {() => Promise<*>} fn        — async function to execute
   * @param {string}           label     — human-readable label for logs
   * @param {number}           [maxRetries=3] — maximum number of attempts
   * @returns {Promise<*>}
   */
  async _withRetry(fn, label, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.debug(`${label} — attempt ${attempt}/${maxRetries}`);
        const result = await fn();
        log.debug(`${label} — success`, { attempt });
        return result;
      } catch (error) {
        lastError = error;
        const errorType = _classifyError(error);
        const meta = {
          label,
          attempt,
          maxRetries,
          errorType,
          errorMessage: error.message,
          code: error.code ?? error.body?.code,
        };

        log.warn(`${label} — failed (${errorType})`, meta);
        this.emit('rest:error', { label, error, errorType, attempt });

        // Auth errors are not transient — do not retry.
        if (errorType === 'auth_error') {
          log.error(`${label} — non-retryable auth error, aborting`, meta);
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s ...
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt - 1) * 1000;
          log.info(`${label} — retrying in ${delayMs}ms`, { attempt, delayMs });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    log.error(`${label} — all ${maxRetries} attempts failed`, {
      errorMessage: lastError?.message,
    });
    throw lastError;
  }

  // =========================================================================
  // REST — Public methods
  // =========================================================================

  /**
   * Fetch account balances.
   *
   * @param {string} [category] — optional product type filter
   * @returns {Promise<Object>} raw balance response from Bitget
   */
  async getBalances(category) {
    const label = 'getBalances';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = category ? { productType: category } : undefined;
      log.info(label, { category });
      const response = await restClient.getFuturesAccountAssets(params);
      log.debug(`${label} — response received`, {
        dataLength: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Submit a new order.
   *
   * @param {Object} params
   * @param {string} params.category   — product type (e.g. 'USDT-FUTURES')
   * @param {string} params.symbol     — trading pair (e.g. 'BTCUSDT')
   * @param {string} params.side       — 'buy' | 'sell'
   * @param {string} params.orderType  — 'limit' | 'market'
   * @param {string} params.qty        — order quantity (String)
   * @param {string} [params.price]    — limit price (String)
   * @param {string} [params.posSide]  — position side: 'long' | 'short'
   * @param {string} [params.clientOid] — custom client order id
   * @param {boolean} [params.reduceOnly] — reduce-only flag
   * @param {string} [params.takeProfitPrice] — take profit trigger price (String)
   * @param {string} [params.stopLossPrice]   — stop loss trigger price (String)
   * @returns {Promise<Object>} order submission response
   */
  async placeOrder({
    category,
    symbol,
    side,
    orderType,
    qty,
    price,
    posSide,
    clientOid,
    reduceOnly,
    takeProfitPrice,
    stopLossPrice,
  }) {
    const label = 'placeOrder';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const orderParams = {
        productType: category,
        symbol,
        side,
        orderType,
        size: qty,
      };

      if (price !== undefined) orderParams.price = String(price);
      if (posSide !== undefined) orderParams.tradeSide = posSide;
      if (clientOid !== undefined) orderParams.clientOid = clientOid;
      if (reduceOnly !== undefined) orderParams.reduceOnly = reduceOnly ? 'yes' : 'no';
      if (takeProfitPrice !== undefined) orderParams.presetStopSurplusPrice = String(takeProfitPrice);
      if (stopLossPrice !== undefined) orderParams.presetStopLossPrice = String(stopLossPrice);

      log.trade(`${label} — submitting`, {
        symbol,
        side,
        orderType,
        qty,
        price,
        posSide,
        reduceOnly,
      });

      const response = await restClient.futuresSubmitOrder(orderParams);

      log.trade(`${label} — submitted`, {
        symbol,
        orderId: response?.data?.orderId,
        clientOid: response?.data?.clientOid,
      });

      return response;
    }, label);
  }

  /**
   * Cancel an existing order.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} params.symbol   — trading pair
   * @param {string} [params.orderId]  — exchange order id
   * @param {string} [params.clientOid] — client order id
   * @returns {Promise<Object>}
   */
  async cancelOrder({ category, symbol, orderId, clientOid }) {
    const label = 'cancelOrder';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = {
        productType: category,
        symbol,
      };
      if (orderId !== undefined) params.orderId = orderId;
      if (clientOid !== undefined) params.clientOid = clientOid;

      log.trade(`${label} — requesting`, { symbol, orderId, clientOid });
      const response = await restClient.futuresCancelOrder(params);
      log.trade(`${label} — done`, { symbol, orderId, clientOid });
      return response;
    }, label);
  }

  /**
   * Cancel all open orders, optionally filtered by symbol.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} [params.symbol] — optional symbol filter
   * @returns {Promise<Object>}
   */
  async cancelAllOrders({ category, symbol }) {
    const label = 'cancelAllOrders';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };
      if (symbol !== undefined) params.symbol = symbol;

      log.trade(`${label} — requesting`, { category, symbol });
      const response = await restClient.futuresCancelAllOrders(params);
      log.trade(`${label} — done`, { category, symbol });
      return response;
    }, label);
  }

  /**
   * Get current open positions.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} [params.symbol] — optional symbol filter
   * @returns {Promise<Object>}
   */
  async getCurrentPositions({ category, symbol }) {
    const label = 'getCurrentPositions';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };
      if (symbol !== undefined) params.symbol = symbol;

      log.info(label, { category, symbol });
      const response = await restClient.getFuturesPositions(params);
      log.debug(`${label} — response received`, {
        positionCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Get unfilled (open) orders.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} [params.symbol] — optional symbol filter
   * @returns {Promise<Object>}
   */
  async getOpenOrders({ category, symbol }) {
    const label = 'getOpenOrders';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };
      if (symbol !== undefined) params.symbol = symbol;

      log.info(label, { category, symbol });
      const response = await restClient.getFuturesOpenOrders(params);
      log.debug(`${label} — response received`, {
        orderCount: Array.isArray(response?.data?.entrustedList) ? response.data.entrustedList.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Get details for a specific order.
   *
   * @param {Object} params
   * @param {string} params.category    — product type
   * @param {string} [params.orderId]   — exchange order id
   * @param {string} [params.clientOid] — client order id
   * @returns {Promise<Object>}
   */
  async getOrderInfo({ category, orderId, clientOid }) {
    const label = 'getOrderInfo';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };
      if (orderId !== undefined) params.orderId = orderId;
      if (clientOid !== undefined) params.clientOid = clientOid;

      log.info(label, { category, orderId, clientOid });
      const response = await restClient.getFuturesOrder(params);
      log.debug(`${label} — response received`);
      return response;
    }, label);
  }

  /**
   * Get ticker(s) — latest price data.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} [params.symbol] — optional single symbol
   * @returns {Promise<Object>}
   */
  async getTickers({ category, symbol }) {
    const label = 'getTickers';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };
      if (symbol !== undefined) params.symbol = symbol;

      log.debug(label, { category, symbol });
      const response = await restClient.getFuturesAllTickers(params);
      log.debug(`${label} — response received`, {
        tickerCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Get candlestick / kline data.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @param {string} params.symbol   — trading pair
   * @param {string} params.interval — kline granularity (e.g. '1m', '5m', '1H')
   * @param {number} [params.limit]  — number of candles to retrieve
   * @returns {Promise<Object>}
   */
  async getCandles({ category, symbol, interval, limit }) {
    const label = 'getCandles';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = {
        productType: category,
        symbol,
        granularity: interval,
      };
      if (limit !== undefined) params.limit = String(limit);

      log.debug(label, { category, symbol, interval, limit });
      const response = await restClient.getFuturesHistoricCandles(params);
      log.debug(`${label} — response received`, {
        candleCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Get available instruments / trading pairs.
   *
   * @param {Object} params
   * @param {string} params.category — product type
   * @returns {Promise<Object>}
   */
  async getInstruments({ category }) {
    const label = 'getInstruments';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { productType: category };

      log.info(label, { category });
      const response = await restClient.getFuturesContractConfig(params);
      log.debug(`${label} — response received`, {
        instrumentCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return response;
    }, label);
  }

  /**
   * Get open interest for a symbol.
   *
   * @param {Object} params
   * @param {string} params.symbol   — trading pair (e.g. 'BTCUSDT')
   * @param {string} params.category — product type
   * @returns {Promise<Object>}
   */
  async getOpenInterest({ symbol, category }) {
    const label = 'getOpenInterest';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { symbol, productType: category };

      log.debug(label, { symbol, category });
      const response = await restClient.getFuturesOpenInterest(params);
      log.debug(`${label} — response received`, { symbol });
      return response;
    }, label);
  }

  /**
   * Get current funding rate for a symbol.
   *
   * @param {Object} params
   * @param {string} params.symbol   — trading pair (e.g. 'BTCUSDT')
   * @param {string} params.category — product type
   * @returns {Promise<Object>}
   */
  async getFundingRate({ symbol, category }) {
    const label = 'getFundingRate';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { symbol, productType: category };

      log.debug(label, { symbol, category });
      const response = await restClient.getFuturesCurrentFundingRate(params);
      log.debug(`${label} — response received`, { symbol });
      return response;
    }, label);
  }

  /**
   * Get order book depth for a symbol.
   *
   * @param {Object} params
   * @param {string} params.symbol   — trading pair (e.g. 'BTCUSDT')
   * @param {string} params.category — product type
   * @param {number} [params.limit]  — depth limit
   * @returns {Promise<Object>}
   */
  async getOrderBookDepth({ symbol, category, limit }) {
    const label = 'getOrderBookDepth';
    const restClient = getRestClient();

    return this._withRetry(async () => {
      const params = { symbol, productType: category };
      if (limit !== undefined) params.limit = String(limit);

      log.debug(label, { symbol, category, limit });
      const response = await restClient.getFuturesMergeDepth(params);
      log.debug(`${label} — response received`, { symbol });
      return response;
    }, label);
  }

  // =========================================================================
  // WebSocket — Connection management
  // =========================================================================

  /**
   * Initialise both public and private WebSocket connections and attach
   * event handlers that normalise raw SDK events into a consistent format
   * emitted on this EventEmitter.
   *
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  connectWebsockets() {
    if (this._wsConnected) {
      log.info('WebSockets already connected — skipping');
      return;
    }

    const wsPublic = getWsPublicClient();
    const wsPrivate = getWsPrivateClient();

    // ------------------------------------------------------------------
    // Public WebSocket events
    // ------------------------------------------------------------------

    wsPublic.on('open', (data) => {
      log.info('WS public — connection opened', { wsKey: data.wsKey });
    });

    wsPublic.on('reconnected', (data) => {
      log.info('WS public — reconnected', { wsKey: data?.wsKey });
    });

    wsPublic.on('exception', (data) => {
      log.error('WS public — exception', {
        wsKey: data?.wsKey,
        message: data?.message ?? data?.msg,
      });
    });

    wsPublic.on('close', (data) => {
      log.warn('WS public — connection closed', { wsKey: data?.wsKey });
    });

    wsPublic.on('update', (rawEvent) => {
      this._handlePublicWsUpdate(rawEvent);
    });

    // ------------------------------------------------------------------
    // Private WebSocket events
    // ------------------------------------------------------------------

    wsPrivate.on('open', (data) => {
      log.info('WS private — connection opened', { wsKey: data.wsKey });
    });

    wsPrivate.on('reconnected', (data) => {
      log.info('WS private — reconnected', { wsKey: data?.wsKey });
    });

    wsPrivate.on('authenticated', (data) => {
      log.info('WS private — authenticated', { wsKey: data?.wsKey });
    });

    wsPrivate.on('exception', (data) => {
      log.error('WS private — exception', {
        wsKey: data?.wsKey,
        message: data?.message ?? data?.msg,
      });
    });

    wsPrivate.on('close', (data) => {
      log.warn('WS private — connection closed', { wsKey: data?.wsKey });
    });

    wsPrivate.on('update', (rawEvent) => {
      this._handlePrivateWsUpdate(rawEvent);
    });

    this._wsConnected = true;
    log.info('WebSocket event handlers registered');
  }

  /**
   * Subscribe to one or more public WebSocket topics.
   *
   * @param {Array<{ topic: string, payload: { instType: string, symbol: string } }>} topics
   * @example
   *   subscribePublic([
   *     { topic: 'ticker', payload: { instType: 'usdt-futures', symbol: 'BTCUSDT' } },
   *   ]);
   */
  subscribePublic(topics) {
    const wsPublic = getWsPublicClient();
    const WS_KEY_MAP = getWsKeyMap();

    log.info('Subscribing to public topics', {
      count: topics.length,
      topics: topics.map((t) => `${t.topic}:${t.payload?.symbol ?? '*'}`),
    });

    for (const topic of topics) {
      wsPublic.subscribe(topic, WS_KEY_MAP.v3Public);
    }
  }

  /**
   * Subscribe to one or more private WebSocket topics.
   *
   * @param {Array<{ topic: string, payload: { instType: string } }>} topics
   * @example
   *   subscribePrivate([
   *     { topic: 'order', payload: { instType: 'UTA' } },
   *     { topic: 'position', payload: { instType: 'UTA' } },
   *   ]);
   */
  subscribePrivate(topics) {
    const wsPrivate = getWsPrivateClient();
    const WS_KEY_MAP = getWsKeyMap();

    log.info('Subscribing to private topics', {
      count: topics.length,
      topics: topics.map((t) => t.topic),
    });

    for (const topic of topics) {
      wsPrivate.subscribe(topic, WS_KEY_MAP.v3Private);
    }
  }

  /**
   * Unsubscribe from one or more public WebSocket topics.
   *
   * @param {Array<{ topic: string, payload: { instType: string, symbol: string } }>} topics
   */
  unsubscribePublic(topics) {
    const wsPublic = getWsPublicClient();
    const WS_KEY_MAP = getWsKeyMap();

    log.info('Unsubscribing from public topics', {
      count: topics.length,
      topics: topics.map((t) => `${t.topic}:${t.payload?.symbol ?? '*'}`),
    });

    for (const topic of topics) {
      wsPublic.unsubscribe(topic, WS_KEY_MAP.v3Public);
    }
  }

  /**
   * Gracefully close all WebSocket connections.
   */
  closeWebsockets() {
    log.info('Closing all WebSocket connections');

    try {
      const wsPublic = getWsPublicClient();
      wsPublic.closeAll(true);
    } catch (err) {
      log.warn('Error closing public WS', { errorMessage: err.message });
    }

    try {
      const wsPrivate = getWsPrivateClient();
      wsPrivate.closeAll(true);
    } catch (err) {
      log.warn('Error closing private WS', { errorMessage: err.message });
    }

    this._wsConnected = false;
    log.info('All WebSocket connections closed');
  }

  // =========================================================================
  // WebSocket — Internal event normalisers
  // =========================================================================

  /**
   * Normalise a raw WebSocket event into a consistent structure.
   *
   * @param {Object} rawEvent — raw event from bitget-api SDK
   * @returns {{ topic: string, symbol: string|null, instType: string|null, ts: number, data: * }}
   */
  _normalizeWsEvent(rawEvent) {
    const arg = rawEvent?.arg ?? {};
    return {
      topic: arg.channel ?? arg.topic ?? rawEvent?.topic ?? 'unknown',
      symbol: arg.instId ?? arg.symbol ?? null,
      instType: arg.instType ?? null,
      ts: rawEvent?.ts ? Number(rawEvent.ts) : Date.now(),
      data: rawEvent?.data ?? rawEvent,
      wsKey: rawEvent?.wsKey ?? null,
    };
  }

  /**
   * Route a public WS update to the correct normalised event.
   *
   * @param {Object} rawEvent
   * @private
   */
  _handlePublicWsUpdate(rawEvent) {
    const normalised = this._normalizeWsEvent(rawEvent);

    switch (normalised.topic) {
      case 'ticker':
      case 'tickers':
        this.emit('ws:ticker', normalised);
        break;

      case 'candle':
      case 'candle1m':
      case 'candle5m':
      case 'candle15m':
      case 'candle30m':
      case 'candle1H':
      case 'candle4H':
      case 'candle1D':
      case 'candle1W':
        this.emit('ws:kline', normalised);
        break;

      case 'books':
      case 'books5':
      case 'books15':
        this.emit('ws:book', normalised);
        break;

      default:
        log.debug('WS public — unhandled topic', { topic: normalised.topic });
        this.emit('ws:public', normalised);
        break;
    }
  }

  /**
   * Route a private WS update to the correct normalised event.
   *
   * @param {Object} rawEvent
   * @private
   */
  _handlePrivateWsUpdate(rawEvent) {
    const normalised = this._normalizeWsEvent(rawEvent);

    switch (normalised.topic) {
      case 'order':
      case 'orders':
        this.emit('ws:order', normalised);
        break;

      case 'position':
      case 'positions':
        this.emit('ws:position', normalised);
        break;

      case 'account':
        this.emit('ws:account', normalised);
        break;

      case 'fill':
        this.emit('ws:fill', normalised);
        break;

      default:
        log.debug('WS private — unhandled topic', { topic: normalised.topic });
        this.emit('ws:private', normalised);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Module exports a single shared ExchangeClient instance.
 * All services import the same instance and listen on its events.
 */
module.exports = new ExchangeClient();
