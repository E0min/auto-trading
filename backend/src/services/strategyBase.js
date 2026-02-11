'use strict';

/**
 * Abstract base class for all trading strategies.
 *
 * Provides a standardised lifecycle (activate / deactivate), market-regime
 * awareness and a signal-emission API built on top of EventEmitter.
 *
 * Sub-classes MUST override onTick(), onKline() and getSignal().
 * onFill() is optional and defaults to a no-op.
 */

const { EventEmitter } = require('events');
const { TRADE_EVENTS, CATEGORIES, MARKET_REGIMES } = require('../utils/constants');
const { createLogger } = require('../utils/logger');

class StrategyBase extends EventEmitter {
  /**
   * @param {string} name   — human-readable strategy identifier
   * @param {object} config — strategy-specific configuration
   */
  constructor(name, config = {}) {
    super();

    if (new.target === StrategyBase) {
      throw new TypeError('StrategyBase is abstract and cannot be instantiated directly');
    }

    if (!name || typeof name !== 'string') {
      throw new TypeError('StrategyBase: name must be a non-empty string');
    }

    this.name = name;
    this.config = { ...config };
    this._active = false;
    this._symbol = null;
    this._category = CATEGORIES.USDT_FUTURES;
    this._marketRegime = null;

    this._log = createLogger(`Strategy:${name}`);
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — sub-classes MUST override these (except onFill)
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   * @param {object} ticker
   */
  onTick(ticker) {
    throw new Error(
      `${this.name}: onTick() is abstract and must be implemented by the sub-class`,
    );
  }

  /**
   * Called on every incoming kline (candlestick) update.
   * @param {object} kline
   */
  onKline(kline) {
    throw new Error(
      `${this.name}: onKline() is abstract and must be implemented by the sub-class`,
    );
  }

  /**
   * Called when an order fill is received. Optional — default is a no-op.
   * @param {object} fill
   */
  onFill(fill) {
    // No-op by default; sub-classes may override.
  }

  /**
   * Return the most recent signal or null if none is pending.
   * @returns {object|null} signal — { action, symbol, category, suggestedQty, suggestedPrice, confidence, marketContext }
   */
  getSignal() {
    throw new Error(
      `${this.name}: getSignal() is abstract and must be implemented by the sub-class`,
    );
  }

  // ---------------------------------------------------------------------------
  // Concrete lifecycle methods
  // ---------------------------------------------------------------------------

  /**
   * Activate the strategy for a given symbol and category.
   *
   * @param {string} symbol   — e.g. 'BTCUSDT'
   * @param {string} category — one of CATEGORIES values (default USDT-FUTURES)
   */
  activate(symbol, category = CATEGORIES.USDT_FUTURES) {
    if (!symbol || typeof symbol !== 'string') {
      throw new TypeError('StrategyBase.activate: symbol must be a non-empty string');
    }

    this._symbol = symbol;
    this._category = category;
    this._active = true;

    this._log.info('Strategy activated', { symbol, category });
  }

  /**
   * Deactivate the strategy. It will ignore subsequent tick/kline events
   * until re-activated.
   */
  deactivate() {
    this._active = false;
    this._log.info('Strategy deactivated', { symbol: this._symbol });
  }

  /**
   * @returns {boolean} whether the strategy is currently active
   */
  isActive() {
    return this._active;
  }

  /**
   * Update the current market regime (set by the MarketRegime service).
   *
   * @param {string} regime — one of MARKET_REGIMES values
   */
  setMarketRegime(regime) {
    const validRegimes = Object.values(MARKET_REGIMES);
    if (regime !== null && !validRegimes.includes(regime)) {
      this._log.warn('Ignoring unknown market regime', { regime });
      return;
    }

    const previous = this._marketRegime;
    this._marketRegime = regime;

    if (previous !== regime) {
      this._log.debug('Market regime updated', { previous, current: regime });
    }
  }

  /**
   * Emit a trading signal through the EventEmitter.
   *
   * The event name is TRADE_EVENTS.SIGNAL_GENERATED and the payload is
   * augmented with the strategy name.
   *
   * @param {object} signalData — { action, symbol, category, suggestedQty, suggestedPrice, confidence, marketContext }
   */
  emitSignal(signalData) {
    if (!signalData || typeof signalData !== 'object') {
      this._log.warn('emitSignal called with invalid signalData', { signalData });
      return;
    }

    const signal = {
      strategy: this.name,
      timestamp: new Date().toISOString(),
      ...signalData,
    };

    this._log.trade('Signal generated', {
      action: signal.action,
      symbol: signal.symbol,
      confidence: signal.confidence,
    });

    this.emit(TRADE_EVENTS.SIGNAL_GENERATED, signal);
  }

  // ---------------------------------------------------------------------------
  // Accessors / config helpers
  // ---------------------------------------------------------------------------

  /**
   * @returns {string} strategy name
   */
  getName() {
    return this.name;
  }

  /**
   * @returns {object} a shallow copy of the current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Merge new configuration keys into the existing config.
   *
   * @param {object} newConfig
   */
  updateConfig(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') {
      this._log.warn('updateConfig called with invalid argument', { newConfig });
      return;
    }

    Object.assign(this.config, newConfig);
    this._log.info('Configuration updated', { config: this.config });
  }
}

module.exports = StrategyBase;
