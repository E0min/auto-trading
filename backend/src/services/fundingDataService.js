'use strict';

/**
 * FundingDataService — periodic poller for funding-rate and open-interest data.
 *
 * Polls the exchange for each tracked symbol and emits FUNDING_UPDATE events
 * so that strategies (e.g. FundingRateStrategy) can consume live funding data
 * without depending on ticker payloads that may not carry these fields.
 *
 * Lifecycle:
 *   - Created in app.js bootstrap and injected into BotService.
 *   - Started when the bot starts (with the selected symbol list).
 *   - Stopped when the bot stops.
 */

const EventEmitter = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, CATEGORIES } = require('../utils/constants');

const log = createLogger('FundingDataService');

const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INTER_CALL_DELAY = 100; // 100ms between API calls to prevent burst

class FundingDataService extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./exchangeClient')} opts.exchangeClient — singleton exchange facade
   * @param {number} [opts.pollInterval=300000] — polling interval in milliseconds
   */
  constructor({ exchangeClient, pollInterval = DEFAULT_POLL_INTERVAL } = {}) {
    super();
    this._exchangeClient = exchangeClient;
    this._pollInterval = pollInterval;
    this._timer = null;
    this._symbols = [];
    this._running = false;
    /** @type {Map<string, { fundingRate: string|null, openInterest: string|null, nextSettlement: string|null, timestamp: number }>} */
    this._cache = new Map();
  }

  /**
   * Start polling for the given set of symbols.
   *
   * @param {string[]} [symbols=[]] — symbols to poll (e.g. ['BTCUSDT', 'ETHUSDT'])
   */
  start(symbols = []) {
    if (this._running) return;
    this._symbols = [...symbols];
    this._running = true;
    log.info('FundingDataService started', { symbols: this._symbols.length, intervalMs: this._pollInterval });

    // Initial poll
    this._poll().catch(err => log.error('Initial funding poll failed', { error: err.message }));

    this._timer = setInterval(() => {
      this._poll().catch(err => log.error('Funding poll failed', { error: err.message }));
    }, this._pollInterval);
    this._timer.unref();
  }

  /**
   * Stop polling and clear timers.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    log.info('FundingDataService stopped');
  }

  /**
   * Update the symbol list at runtime (e.g. when coins are re-selected).
   *
   * @param {string[]} symbols
   */
  updateSymbols(symbols) {
    this._symbols = [...symbols];
    log.info('FundingDataService symbols updated', { count: symbols.length });
  }

  /**
   * Get cached funding data for a symbol.
   *
   * @param {string} symbol
   * @returns {{ fundingRate: string|null, openInterest: string|null, timestamp: number }|null}
   */
  getCache(symbol) {
    return this._cache.get(symbol) || null;
  }

  /**
   * Poll all tracked symbols for funding rate and open interest.
   * @private
   */
  async _poll() {
    if (!this._running || this._symbols.length === 0) return;

    for (let idx = 0; idx < this._symbols.length; idx++) {
      if (!this._running) break;
      const symbol = this._symbols[idx];

      try {
        const category = CATEGORIES.USDT_FUTURES;

        const [fundingResult, oiResult] = await Promise.all([
          this._exchangeClient.getFundingRate({ symbol, category }).catch(err => {
            log.warn('getFundingRate failed', { symbol, error: err.message });
            return null;
          }),
          this._exchangeClient.getOpenInterest({ symbol, category }).catch(err => {
            log.warn('getOpenInterest failed', { symbol, error: err.message });
            return null;
          }),
        ]);

        const data = {
          symbol,
          fundingRate: fundingResult?.data?.fundingRate || fundingResult?.fundingRate || null,
          nextSettlement: fundingResult?.data?.nextSettleTime || null,
          openInterest: oiResult?.data?.amount || oiResult?.amount || null,
          timestamp: Date.now(),
        };

        this._cache.set(symbol, data);

        if (data.fundingRate !== null || data.openInterest !== null) {
          this.emit(MARKET_EVENTS.FUNDING_UPDATE, data);
        }
      } catch (err) {
        log.error('Funding data fetch error', { symbol, error: err.message });
      }

      // Inter-call delay to prevent burst (skip after last symbol)
      if (idx < this._symbols.length - 1) {
        await new Promise(resolve => setTimeout(resolve, INTER_CALL_DELAY));
      }
    }
  }
}

module.exports = FundingDataService;
