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

    /** @type {Set<string>} All symbols assigned to this strategy (T0-3) */
    this._symbols = new Set();

    /** @type {string|null} Symbol currently being processed in onTick/onKline (T0-3) */
    this._currentProcessingSymbol = null;

    /** @type {Map<string, string>} Per-symbol regime overrides */
    this._symbolRegimes = new Map();

    /** @type {import('./indicatorCache')|null} */
    this._indicatorCache = null;

    /** @type {{ getEquity: () => string }|null} Account context for equity injection */
    this._accountContext = null;

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
    this._symbols.add(symbol);
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
    this._symbols.clear();
    this._log.info('Strategy deactivated', { symbol: this._symbol });
  }

  // ---------------------------------------------------------------------------
  // T0-3: Multi-symbol management (Set-based)
  // ---------------------------------------------------------------------------

  /**
   * Add a symbol to this strategy's active set.
   * @param {string} symbol
   */
  addSymbol(symbol) {
    this._symbols.add(symbol);
    if (!this._symbol) this._symbol = symbol;
  }

  /**
   * Remove a symbol from this strategy's active set.
   * @param {string} symbol
   */
  removeSymbol(symbol) {
    this._symbols.delete(symbol);
    if (this._symbols.size === 0) {
      this._active = false;
      this._symbol = null;
    } else if (this._symbol === symbol) {
      this._symbol = this._symbols.values().next().value;
    }
  }

  /**
   * Check if this strategy handles the given symbol.
   * @param {string} symbol
   * @returns {boolean}
   */
  hasSymbol(symbol) {
    return this._symbols.has(symbol);
  }

  /**
   * Get all symbols assigned to this strategy.
   * @returns {string[]}
   */
  getSymbols() {
    return Array.from(this._symbols);
  }

  /**
   * Set the symbol currently being processed (for onTick/onKline context).
   * Used by the router; cleared via try-finally.
   * @param {string|null} symbol
   */
  _setCurrentProcessingSymbol(symbol) {
    this._currentProcessingSymbol = symbol;
  }

  /**
   * Get the symbol currently being processed, falling back to _symbol.
   * @returns {string|null}
   */
  getCurrentSymbol() {
    return this._currentProcessingSymbol || this._symbol;
  }

  /**
   * @returns {boolean} whether the strategy is currently active
   */
  isActive() {
    return this._active;
  }

  /**
   * Inject the shared IndicatorCache instance.
   * Called by BotService during strategy creation.
   *
   * @param {import('./indicatorCache')} cache
   */
  setIndicatorCache(cache) {
    this._indicatorCache = cache;
  }

  /**
   * Inject account context for equity access via DI.
   * Called by BotService / BacktestEngine after strategy creation.
   *
   * @param {{ getEquity: () => string }} context
   */
  setAccountContext(context) {
    this._accountContext = context;
  }

  /**
   * Get current equity from injected account context, falling back
   * to config.equity.
   *
   * @returns {string} equity value
   */
  getEquity() {
    if (this._accountContext && typeof this._accountContext.getEquity === 'function') {
      return this._accountContext.getEquity();
    }
    return this.config.equity || '0';
  }

  /**
   * Called when funding rate data is received from FundingDataService.
   * Override in strategies that need funding data.
   *
   * @param {{ symbol: string, fundingRate: string|null, openInterest: string|null, timestamp: number }} data
   */
  onFundingUpdate(data) {
    // No-op by default; sub-classes may override.
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
   * Set a per-symbol regime override. When a symbol's individual regime
   * differs from the global BTC regime, this value takes precedence.
   *
   * @param {string} symbol — e.g. 'ETHUSDT'
   * @param {string|null} regime — regime label, or null to clear
   */
  setSymbolRegime(symbol, regime) {
    if (regime === null) {
      this._symbolRegimes.delete(symbol);
      return;
    }

    const validRegimes = Object.values(MARKET_REGIMES);
    if (!validRegimes.includes(regime)) {
      this._log.warn('Ignoring unknown symbol regime', { symbol, regime });
      return;
    }

    this._symbolRegimes.set(symbol, regime);
  }

  /**
   * Return the effective regime for this strategy's current symbol.
   * Prefers per-symbol regime; falls back to global BTC regime.
   *
   * @returns {string|null}
   */
  getEffectiveRegime(symbol = null) {
    const target = symbol || this._currentProcessingSymbol || this._symbol;
    if (target && this._symbolRegimes.has(target)) {
      return this._symbolRegimes.get(target);
    }
    return this._marketRegime;
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
      // T0-3: symbol fallback chain
      symbol: signalData.symbol || this._currentProcessingSymbol || this._symbol,
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
   * Return the target regimes from static metadata.
   * Strategies declare their preferred regimes via `static metadata`.
   * @returns {string[]} array of regime strings (e.g. ['trending_up', 'ranging'])
   */
  getTargetRegimes() {
    const meta = this.constructor.metadata;
    if (meta && Array.isArray(meta.targetRegimes)) {
      return meta.targetRegimes;
    }
    // Default: all regimes (backward compatibility)
    return Object.values(MARKET_REGIMES);
  }

  /**
   * Return the full static metadata for this strategy.
   * @returns {object}
   */
  getMetadata() {
    return this.constructor.metadata || { name: this.name, targetRegimes: Object.values(MARKET_REGIMES) };
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
