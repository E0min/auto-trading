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
const { TRADE_EVENTS, CATEGORIES, MARKET_REGIMES, SIGNAL_ACTIONS } = require('../utils/constants');
const {
  isGreaterThan,
  isLessThan,
  isGreaterThanOrEqual,
  pctChange,
  abs,
} = require('../utils/mathUtils');
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

    /** @type {Map<string, object>} Per-symbol state container — symbol → state object */
    this._symbolStates = new Map();

    /** @type {import('./indicatorCache')|null} */
    this._indicatorCache = null;

    /** @type {{ getEquity: () => string }|null} Account context for equity injection */
    this._accountContext = null;

    // R9-T2: Warm-up tracking — suppress signals until enough klines received
    /** @type {number} Number of klines required before signals are allowed */
    this._warmupCandles = this.constructor.metadata?.warmupCandles || 0;

    this._log = createLogger(`Strategy:${name}`);

    // R10: Trailing stop infrastructure (opt-in via static metadata)
    this._trailingStopEnabled = false;
    this._trailingStopConfig = {
      activationPercent: null,  // profit % before trailing activates (null = immediate)
      callbackPercent: '1',     // trail distance as % from extreme
    };

    // Read trailing stop config from static metadata
    this._initTrailingFromMetadata();
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — sub-classes MUST override these (except onFill)
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   * R11: Auto-invokes trailing stop check for strategies with trailingStop.enabled.
   * Sub-classes should call super.onTick(ticker) if they want automatic trailing stop,
   * or override completely if they manage their own trailing logic.
   *
   * @param {object} ticker
   */
  onTick(ticker) {
    // R11 E11-3: Auto trailing stop check for opt-in strategies
    if (this._trailingStopEnabled && ticker) {
      const price = String(ticker.lastPrice || ticker.last || ticker.price || '');
      if (price && price !== 'undefined' && price !== 'null' && price !== '') {
        const sym = this._currentProcessingSymbol || this._symbol;
        const result = this._checkTrailingStop(price, sym);
        if (result) {
          const trailing = this._s(sym).trailing;
          // Guard: if trailing state already cleared (position already closed), skip
          if (!trailing.positionSide) return;

          const signal = {
            action: result.action,
            symbol: sym,
            category: this._category,
            suggestedPrice: price,
            confidence: '0.90',
            reason: result.reason,
            reduceOnly: true,
            marketContext: {
              entryPrice: trailing.entryPrice,
              exitPrice: price,
              extremePrice: trailing.extremePrice,
              trailingStopType: 'base_auto',
            },
          };

          this.emitSignal(signal);
          this._resetTrailingState(sym);
        }
      }
    }
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
   * Called when an order fill is received.
   * R10: Manages trailing stop state based on fill actions.
   * Sub-classes that override onFill() should call super.onFill(fill).
   *
   * @param {object} fill
   */
  onFill(fill) {
    if (!fill) return;

    const action = fill.action || (fill.signal && fill.signal.action);
    if (!action) return;

    const sym = fill.symbol || this.getCurrentSymbol();
    if (!sym) return;

    if (action === SIGNAL_ACTIONS.OPEN_LONG || action === SIGNAL_ACTIONS.OPEN_SHORT) {
      const entryPrice = fill.price !== undefined ? String(fill.price) : null;
      if (entryPrice) {
        const trailing = this._s(sym).trailing;
        trailing.entryPrice = entryPrice;
        trailing.positionSide = action === SIGNAL_ACTIONS.OPEN_LONG ? 'long' : 'short';
        trailing.extremePrice = entryPrice;
        trailing.activated = false;
      }
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      this._resetTrailingState(sym);
    }
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

    // Initialize per-symbol state
    this._initSymbolState(symbol);

    this._log.info('Strategy activated', { symbol, category, warmupCandles: this._warmupCandles });
  }

  /**
   * Deactivate the strategy. It will ignore subsequent tick/kline events
   * until re-activated.
   */
  deactivate() {
    this._active = false;
    this._symbols.clear();
    this._clearAllSymbolStates();
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
    this._initSymbolState(symbol);
    if (!this._symbol) this._symbol = symbol;
    if (!this._active) this._active = true;
  }

  /**
   * Remove a symbol from this strategy's active set.
   * @param {string} symbol
   */
  removeSymbol(symbol) {
    this._symbols.delete(symbol);
    this._clearSymbolState(symbol);
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

  // ---------------------------------------------------------------------------
  // Per-symbol state container (SymbolState)
  // ---------------------------------------------------------------------------

  /**
   * Access the per-symbol state for the given symbol.
   * Lazily creates state if it doesn't exist yet.
   *
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   * @returns {object} per-symbol state object
   */
  _s(symbol) {
    const sym = symbol || this.getCurrentSymbol();
    if (!sym) {
      throw new Error(`${this.name}._s(): no symbol available`);
    }
    if (!this._symbolStates.has(sym)) {
      this._symbolStates.set(sym, this._createDefaultState());
    }
    return this._symbolStates.get(sym);
  }

  /**
   * Create a default per-symbol state object.
   * Sub-classes SHOULD override this to add strategy-specific fields,
   * calling `const base = super._createDefaultState()` and spreading it.
   *
   * @returns {object} default state
   */
  _createDefaultState() {
    return {
      // Position tracking
      entryPrice: null,
      positionSide: null,
      latestPrice: null,
      lastSignal: null,

      // Warmup tracking (per-symbol)
      receivedCandles: 0,
      warmedUp: this._warmupCandles === 0,

      // Trailing stop (per-symbol)
      trailing: {
        entryPrice: null,
        positionSide: null,
        extremePrice: null,
        activated: false,
      },
    };
  }

  /**
   * Initialize per-symbol state for a symbol.
   * Called by activate() and addSymbol().
   *
   * @param {string} symbol
   * @private
   */
  _initSymbolState(symbol) {
    if (!this._symbolStates.has(symbol)) {
      this._symbolStates.set(symbol, this._createDefaultState());
    }
  }

  /**
   * Clear per-symbol state for a symbol.
   * @param {string} symbol
   */
  _clearSymbolState(symbol) {
    this._symbolStates.delete(symbol);
  }

  /**
   * Clear all per-symbol state.
   * @private
   */
  _clearAllSymbolStates() {
    this._symbolStates.clear();
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

  // ---------------------------------------------------------------------------
  // R9-T2: Warm-up tracking
  // ---------------------------------------------------------------------------

  /**
   * Track an incoming kline for warm-up progress (per-symbol).
   * Called by BotService before onKline() on each kline update.
   *
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   */
  trackKline(symbol) {
    const sym = symbol || this.getCurrentSymbol();
    if (!sym) return;
    const state = this._s(sym);
    if (!state.warmedUp) {
      state.receivedCandles++;
      if (state.receivedCandles >= this._warmupCandles) {
        state.warmedUp = true;
        this._log.info('Warm-up complete', { symbol: sym, candles: state.receivedCandles });
      }
    }
  }

  /**
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   * @returns {boolean} whether the warm-up period is complete
   */
  isWarmedUp(symbol) {
    const sym = symbol || this.getCurrentSymbol();
    if (!sym) return this._warmupCandles === 0;
    if (!this._symbolStates.has(sym)) return this._warmupCandles === 0;
    return this._s(sym).warmedUp;
  }

  /**
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   * @returns {{ warmedUp: boolean, received: number, required: number }}
   */
  getWarmupProgress(symbol) {
    const sym = symbol || this.getCurrentSymbol();
    if (!sym || !this._symbolStates.has(sym)) {
      return { warmedUp: this._warmupCandles === 0, received: 0, required: this._warmupCandles };
    }
    const state = this._s(sym);
    return {
      warmedUp: state.warmedUp,
      received: state.receivedCandles,
      required: this._warmupCandles,
    };
  }

  // ---------------------------------------------------------------------------
  // R10: Trailing stop infrastructure (AD-59)
  // ---------------------------------------------------------------------------

  /**
   * Read trailingStop config from static metadata and initialise if enabled.
   * Called at the end of the constructor.
   * @private
   */
  _initTrailingFromMetadata() {
    const meta = this.constructor.metadata;
    if (!meta || !meta.trailingStop || !meta.trailingStop.enabled) return;

    this._trailingStopEnabled = true;
    if (meta.trailingStop.activationPercent !== undefined) {
      this._trailingStopConfig.activationPercent = String(meta.trailingStop.activationPercent);
    }
    if (meta.trailingStop.callbackPercent !== undefined) {
      this._trailingStopConfig.callbackPercent = String(meta.trailingStop.callbackPercent);
    }

    this._log.debug('Trailing stop enabled from metadata', {
      activationPercent: this._trailingStopConfig.activationPercent,
      callbackPercent: this._trailingStopConfig.callbackPercent,
    });
  }

  /**
   * Check whether the trailing stop should trigger a position close.
   * Uses per-symbol trailing state.
   *
   * @param {string} price — current market price (String)
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   * @returns {{ action: string, reason: string }|null} — close signal info, or null
   */
  _checkTrailingStop(price, symbol) {
    try {
      if (!this._trailingStopEnabled) return null;

      const sym = symbol || this.getCurrentSymbol();
      if (!sym) return null;
      const trailing = this._s(sym).trailing;

      const { entryPrice, positionSide, extremePrice } = trailing;
      if (!entryPrice || !positionSide) return null;

      // Update extreme price
      if (positionSide === 'long') {
        if (extremePrice === null || isGreaterThan(price, extremePrice)) {
          trailing.extremePrice = price;
        }
      } else {
        if (extremePrice === null || isLessThan(price, extremePrice)) {
          trailing.extremePrice = price;
        }
      }

      const currentExtreme = trailing.extremePrice;
      const { activationPercent, callbackPercent } = this._trailingStopConfig;

      // Check activation: profit % must exceed activationPercent
      if (!trailing.activated) {
        if (activationPercent !== null) {
          let profitPct;
          try {
            if (positionSide === 'long') {
              profitPct = pctChange(entryPrice, price);
            } else {
              profitPct = pctChange(price, entryPrice);
            }
          } catch (_) {
            return null;
          }

          if (!isGreaterThanOrEqual(profitPct, activationPercent)) {
            return null;
          }
        }

        trailing.activated = true;
        this._log.debug('Trailing stop activated', {
          symbol: sym, positionSide, entryPrice, price, extremePrice: currentExtreme,
        });
      }

      // Check callback: has price dropped callbackPercent from extreme?
      if (trailing.activated && currentExtreme) {
        let retracement;
        try {
          if (positionSide === 'long') {
            retracement = pctChange(currentExtreme, price);
            if (isGreaterThan(abs(retracement), callbackPercent)) {
              return { action: SIGNAL_ACTIONS.CLOSE_LONG, reason: 'trailing_stop' };
            }
          } else {
            retracement = pctChange(currentExtreme, price);
            if (isGreaterThan(retracement, callbackPercent)) {
              return { action: SIGNAL_ACTIONS.CLOSE_SHORT, reason: 'trailing_stop' };
            }
          }
        } catch (_) {
          return null;
        }
      }

      return null;
    } catch (err) {
      this._log.error('_checkTrailingStop error (fail-safe)', { error: err.message });
      return null;
    }
  }

  /**
   * Reset trailing stop state for a symbol. Called on position close.
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   * @private
   */
  _resetTrailingState(symbol) {
    const sym = symbol || this.getCurrentSymbol();
    if (!sym || !this._symbolStates.has(sym)) return;
    const trailing = this._s(sym).trailing;
    trailing.entryPrice = null;
    trailing.positionSide = null;
    trailing.extremePrice = null;
    trailing.activated = false;
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

    const sym = signalData.symbol || this._currentProcessingSymbol || this._symbol;

    // R9-T2: Suppress signals during warm-up period (per-symbol)
    if (sym && this._symbolStates.has(sym) && !this._s(sym).warmedUp) {
      const state = this._s(sym);
      this._log.debug('Signal suppressed — warming up', {
        symbol: sym,
        received: state.receivedCandles,
        required: this._warmupCandles,
      });
      return;
    }

    const signal = {
      strategy: this.name,
      timestamp: new Date().toISOString(),
      ...signalData,
      symbol: sym,
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
      return { success: false, reason: 'invalid_argument' };
    }

    const snapshot = { ...this.config };
    const merged = { ...this.config, ...newConfig };
    this.config = merged;

    this.emit('config_updated', {
      strategy: this.name,
      previous: snapshot,
      current: merged,
      changedKeys: Object.keys(newConfig),
    });

    this._log.info('Configuration updated', { changedKeys: Object.keys(newConfig) });
    return { success: true, config: merged };
  }
}

module.exports = StrategyBase;
