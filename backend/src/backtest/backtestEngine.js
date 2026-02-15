'use strict';

/**
 * BacktestEngine — core backtesting simulation engine.
 *
 * Replays historical kline data through a registered strategy instance,
 * executing virtual trades with simulated fills, slippage, and fees.
 * Produces a complete trade log, equity curve, and summary statistics.
 *
 * All monetary values are Strings. Arithmetic is performed exclusively
 * through mathUtils to avoid floating-point representation issues.
 *
 * Usage:
 *   const BacktestEngine = require('./backtestEngine');
 *   const engine = new BacktestEngine({
 *     strategyName: 'RsiPivotStrategy',
 *     symbol: 'BTCUSDT',
 *     interval: '1H',
 *     initialCapital: '10000',
 *   });
 *   const result = engine.run(klines);
 */

const { createLogger } = require('../utils/logger');
const { SIGNAL_ACTIONS, TRADE_EVENTS, CATEGORIES } = require('../utils/constants');
const math = require('../utils/mathUtils');
const registry = require('../strategies');
const { computeIndicator } = require('../services/indicatorCache');

const log = createLogger('BacktestEngine');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Percentage of available cash used per trade (strategy-metadata aware) */
const DEFAULT_POSITION_SIZE_PCT = '15';

/** Max kline history kept in the backtest indicator cache */
const BT_MAX_HISTORY = 500;

// ---------------------------------------------------------------------------
// BacktestIndicatorCache — lightweight cache for backtest environments.
// Uses the same shared computeIndicator() logic as the live IndicatorCache
// to ensure identical indicator results.
// ---------------------------------------------------------------------------

class BacktestIndicatorCache {
  constructor() {
    /** @type {Map<string, { klines: Array, closes: string[], highs: string[], lows: string[], volumes: string[], cache: Map }>} */
    this._data = new Map();
  }

  /**
   * Feed a kline into the cache for a given symbol.
   * Normalises values to String (matching IndicatorCache._handleKline).
   *
   * @param {string} symbol
   * @param {object} kline — { close, high, low, open, volume }
   */
  feedKline(symbol, kline) {
    const close = String(kline.close);
    const high = kline.high !== undefined ? String(kline.high) : close;
    const low = kline.low !== undefined ? String(kline.low) : close;
    const open = kline.open !== undefined ? String(kline.open) : close;
    const volume = kline.volume !== undefined ? String(kline.volume) : '0';

    let store = this._data.get(symbol);
    if (!store) {
      store = {
        klines: [],
        closes: [],
        highs: [],
        lows: [],
        volumes: [],
        cache: new Map(),
      };
      this._data.set(symbol, store);
    }

    // Append
    store.klines.push({ high, low, close, open, volume });
    store.closes.push(close);
    store.highs.push(high);
    store.lows.push(low);
    store.volumes.push(volume);

    // Trim to max history
    if (store.klines.length > BT_MAX_HISTORY) {
      const excess = store.klines.length - BT_MAX_HISTORY;
      store.klines.splice(0, excess);
      store.closes.splice(0, excess);
      store.highs.splice(0, excess);
      store.lows.splice(0, excess);
      store.volumes.splice(0, excess);
    }

    // Invalidate cached indicators (same as live IndicatorCache)
    store.cache.clear();
  }

  /**
   * Get a cached indicator value for a symbol.
   * Computes on first call per kline tick, then caches until next feedKline.
   *
   * @param {string} symbol
   * @param {string} indicator
   * @param {object} [params={}]
   * @returns {any}
   */
  get(symbol, indicator, params = {}) {
    const store = this._data.get(symbol);
    if (!store) return null;

    const cacheKey = this._buildCacheKey(indicator, params);
    if (store.cache.has(cacheKey)) {
      return store.cache.get(cacheKey);
    }

    const result = computeIndicator(store, indicator, params);
    store.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get the raw history arrays for a symbol.
   *
   * @param {string} symbol
   * @returns {{ klines, closes, highs, lows, volumes }|null}
   */
  getHistory(symbol) {
    const store = this._data.get(symbol);
    if (!store) return null;
    return {
      klines: store.klines,
      closes: store.closes,
      highs: store.highs,
      lows: store.lows,
      volumes: store.volumes,
    };
  }

  /**
   * Build a deterministic cache key from indicator name and params.
   * @param {string} indicator
   * @param {object} params
   * @returns {string}
   * @private
   */
  _buildCacheKey(indicator, params) {
    const paramStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join(',');
    return `${indicator}|${paramStr}`;
  }
}

// ---------------------------------------------------------------------------
// BacktestEngine
// ---------------------------------------------------------------------------

class BacktestEngine {
  /**
   * @param {Object} opts
   * @param {string}  opts.strategyName   — registered strategy name
   * @param {Object}  [opts.strategyConfig={}] — config overrides merged onto defaults
   * @param {string}  opts.symbol         — e.g. 'BTCUSDT'
   * @param {string}  opts.interval       — e.g. '1H', '5m'
   * @param {string}  opts.initialCapital — starting capital as String (e.g. '10000')
   * @param {string}  [opts.makerFee='0.0002']  — maker fee rate (0.02%)
   * @param {string}  [opts.takerFee='0.0006']  — taker fee rate (0.06%)
   * @param {string}  [opts.slippage='0.0005']  — slippage rate (0.05%)
   * @param {string|null} [opts.marketRegime=null] — optional fixed market regime
   */
  constructor({
    strategyName,
    strategyConfig = {},
    symbol,
    interval,
    initialCapital,
    makerFee = '0.0002',
    takerFee = '0.0006',
    slippage = '0.0005',
    marketRegime = null,
  } = {}) {
    if (!strategyName || typeof strategyName !== 'string') {
      throw new TypeError('BacktestEngine: strategyName must be a non-empty string');
    }
    if (!symbol || typeof symbol !== 'string') {
      throw new TypeError('BacktestEngine: symbol must be a non-empty string');
    }
    if (!interval || typeof interval !== 'string') {
      throw new TypeError('BacktestEngine: interval must be a non-empty string');
    }
    if (!initialCapital || math.isZero(initialCapital)) {
      throw new TypeError('BacktestEngine: initialCapital must be a positive numeric string');
    }
    if (!registry.has(strategyName)) {
      throw new Error(`BacktestEngine: unknown strategy "${strategyName}"`);
    }

    this.strategyName = strategyName;
    this.strategyConfig = strategyConfig;
    this.symbol = symbol;
    this.interval = interval;
    this.initialCapital = String(initialCapital);
    this.makerFee = String(makerFee);
    this.takerFee = String(takerFee);
    this.slippage = String(slippage);
    this.marketRegime = marketRegime;

    // Simulation state (reset on each run)
    this._cash = '0';
    this._position = null;
    this._trades = [];
    this._equityCurve = [];
    this._currentKline = null;
    this._strategy = null;
    this._pendingSignals = [];
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Execute the backtest simulation over an array of historical klines.
   *
   * @param {Array<{ ts: string, open: string, high: string, low: string, close: string, volume: string }>} klines
   *   Kline data sorted ascending by timestamp. Each field is a String.
   * @returns {Object} result — { config, trades, equityCurve, finalEquity, totalTrades }
   */
  run(klines) {
    if (!Array.isArray(klines) || klines.length === 0) {
      throw new Error('BacktestEngine.run: klines must be a non-empty array');
    }

    log.info('Backtest started', {
      strategy: this.strategyName,
      symbol: this.symbol,
      interval: this.interval,
      initialCapital: this.initialCapital,
      klineCount: klines.length,
      marketRegime: this.marketRegime,
    });

    // 1. Initialize simulation state
    this._cash = this.initialCapital;
    this._position = null;
    this._trades = [];
    this._equityCurve = [];
    this._pendingSignals = [];

    // 2. Create and configure strategy instance
    this._strategy = this._createStrategy();

    // 2b. Cache position-size percentage from strategy metadata (T2-3)
    this._positionSizePct = this._getPositionSizePercent();

    // 3. Bind signal listener
    const onSignal = (signal) => {
      this._pendingSignals.push(signal);
    };
    this._strategy.on(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);

    // 4. Main simulation loop
    for (let i = 0; i < klines.length; i++) {
      const kline = klines[i];
      this._currentKline = kline;

      // Clear pending signals before feeding data to strategy
      this._pendingSignals = [];

      // 4a. Feed kline to BacktestIndicatorCache BEFORE strategy processes it
      this._backtestCache.feedKline(this.symbol, kline);

      // 4b. Feed kline to strategy (triggers indicator computation + potential signal)
      try {
        this._strategy.onKline(kline);
      } catch (err) {
        log.error('Strategy.onKline error — skipping kline', {
          ts: kline.ts,
          error: err.message,
        });
      }

      // Process any signals generated by onKline
      this._drainPendingSignals(kline);

      // 4c. Create synthetic ticker and feed to strategy (triggers TP/SL checks)
      const syntheticTicker = {
        symbol: this.symbol,
        lastPrice: kline.close,
        ts: kline.ts,
      };

      try {
        this._strategy.onTick(syntheticTicker);
      } catch (err) {
        log.error('Strategy.onTick error — skipping tick', {
          ts: kline.ts,
          error: err.message,
        });
      }

      // Process any signals generated by onTick
      this._drainPendingSignals(kline);

      // 4d. Record equity snapshot
      this._recordEquitySnapshot(kline);
    }

    // 5. Force-close any remaining open position at last kline's close
    const lastKline = klines[klines.length - 1];
    this._forceClosePosition(lastKline);

    // Record final equity snapshot after force close
    if (this._equityCurve.length > 0) {
      const lastSnapshot = this._equityCurve[this._equityCurve.length - 1];
      // Update if the force close changed things
      lastSnapshot.equity = this._calculateEquity(lastKline);
      lastSnapshot.cash = this._cash;
    }

    // 6. Cleanup
    this._strategy.removeListener(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);
    this._strategy.deactivate();

    const finalEquity = this._equityCurve.length > 0
      ? this._equityCurve[this._equityCurve.length - 1].equity
      : this._cash;

    log.info('Backtest completed', {
      strategy: this.strategyName,
      symbol: this.symbol,
      totalTrades: this._trades.length,
      finalEquity,
      initialCapital: this.initialCapital,
    });

    // 7. Build and return result
    return {
      config: {
        strategyName: this.strategyName,
        symbol: this.symbol,
        interval: this.interval,
        initialCapital: this.initialCapital,
        makerFee: this.makerFee,
        takerFee: this.takerFee,
        slippage: this.slippage,
        marketRegime: this.marketRegime,
      },
      trades: this._trades,
      equityCurve: this._equityCurve,
      finalEquity,
      totalTrades: this._trades.length,
    };
  }

  // =========================================================================
  // Strategy creation
  // =========================================================================

  /**
   * Create and configure the strategy instance from the registry.
   *
   * Merges the strategy's static defaultConfig with any user-supplied
   * overrides, then activates the strategy for the configured symbol.
   *
   * @returns {import('../services/strategyBase')} configured strategy instance
   * @private
   */
  _createStrategy() {
    // Retrieve default config from strategy metadata
    const metadata = registry.getMetadata(this.strategyName);
    const defaultConfig = (metadata && metadata.defaultConfig) ? metadata.defaultConfig : {};

    // Merge: defaults < user overrides
    const mergedConfig = { ...defaultConfig, ...this.strategyConfig };

    log.debug('Creating strategy instance', {
      name: this.strategyName,
      mergedConfig,
    });

    const strategy = registry.create(this.strategyName, mergedConfig);

    // Inject BacktestIndicatorCache so strategies can use indicator cache API
    this._backtestCache = new BacktestIndicatorCache();
    strategy.setIndicatorCache(this._backtestCache);

    // Inject account context so strategies can access backtest equity (T2-5)
    strategy.setAccountContext({
      getEquity: () => this._cash,
    });

    // Activate for the backtest symbol
    strategy.activate(this.symbol);

    // Apply fixed market regime if specified
    if (this.marketRegime) {
      strategy.setMarketRegime(this.marketRegime);
    }

    return strategy;
  }

  /**
   * Determine position-size percentage from strategy metadata (T2-3).
   *
   * Priority:
   *   1. Explicit positionSizePercent in defaultConfig
   *   2. totalBudgetPercent (grid strategies)
   *   3. riskLevel-based fallback
   *   4. DEFAULT_POSITION_SIZE_PCT
   *
   * @returns {string} position-size percentage
   * @private
   */
  _getPositionSizePercent() {
    const metadata = registry.getMetadata(this.strategyName);
    if (!metadata) return DEFAULT_POSITION_SIZE_PCT;

    const config = metadata.defaultConfig || {};

    // Priority 1: explicit positionSizePercent
    if (config.positionSizePercent) return String(config.positionSizePercent);
    // Priority 2: totalBudgetPercent (grid strategies)
    if (config.totalBudgetPercent) return String(config.totalBudgetPercent);
    // Priority 3: riskLevel-based fallback
    switch (metadata.riskLevel) {
      case 'low': return '10';
      case 'medium': return '15';
      case 'high': return '8';
      default: return DEFAULT_POSITION_SIZE_PCT;
    }
  }

  // =========================================================================
  // Signal processing
  // =========================================================================

  /**
   * Process all pending signals that accumulated during the last strategy call.
   *
   * @param {Object} kline — current kline for price reference
   * @private
   */
  _drainPendingSignals(kline) {
    while (this._pendingSignals.length > 0) {
      const signal = this._pendingSignals.shift();
      this._processSignal(signal, kline);
    }
  }

  /**
   * Execute a virtual order based on the strategy signal.
   *
   * Applies slippage to simulate realistic fills and deducts taker fees.
   * Position sizing uses a metadata-based percentage of available cash.
   *
   * @param {Object} signal — { action, symbol, ... }
   * @param {Object} kline  — current kline for price and timestamp
   * @private
   */
  _processSignal(signal, kline) {
    if (!signal || !signal.action) {
      log.warn('Received invalid signal — skipping', { signal });
      return;
    }

    const action = signal.action;

    switch (action) {
      case SIGNAL_ACTIONS.OPEN_LONG:
        this._openLong(kline);
        break;

      case SIGNAL_ACTIONS.OPEN_SHORT:
        this._openShort(kline);
        break;

      case SIGNAL_ACTIONS.CLOSE_LONG:
        this._closeLong(kline);
        break;

      case SIGNAL_ACTIONS.CLOSE_SHORT:
        this._closeShort(kline);
        break;

      default:
        log.warn('Unknown signal action — skipping', { action });
        break;
    }
  }

  // =========================================================================
  // Order execution (virtual)
  // =========================================================================

  /**
   * Open a long position.
   *
   * - Skips if already in a position
   * - Applies upward slippage (unfavorable for buyer)
   * - Uses strategy-metadata-based % of available cash for position sizing
   * - Deducts notional cost + taker fee from cash
   *
   * @param {Object} kline — current kline
   * @private
   */
  _openLong(kline) {
    if (this._position !== null) {
      log.debug('OPEN_LONG skipped — already in position', {
        side: this._position.side,
        ts: kline.ts,
      });
      return;
    }

    if (math.isLessThan(this._cash, '0') || math.isZero(this._cash)) {
      log.debug('OPEN_LONG skipped — insufficient cash', { cash: this._cash });
      return;
    }

    // Fill price: slippage applied upward (worse for buyer)
    const fillPrice = math.multiply(kline.close, math.add('1', this.slippage));

    // Position value: metadata-based % of available cash (T2-3)
    const positionValue = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));

    // Quantity
    const qty = math.divide(positionValue, fillPrice);

    // Taker fee on notional
    const notional = math.multiply(qty, fillPrice);
    const fee = math.multiply(notional, this.takerFee);

    // Deduct from cash: notional + fee
    const totalCost = math.add(notional, fee);
    this._cash = math.subtract(this._cash, totalCost);

    // Record position
    this._position = {
      side: 'long',
      entryPrice: fillPrice,
      qty,
      entryTime: kline.ts,
      fee,
    };

    log.debug('OPEN_LONG executed', {
      fillPrice,
      qty,
      fee,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill (so it can track entry price for TP/SL)
    this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.OPEN_LONG);
  }

  /**
   * Open a short position.
   *
   * - Skips if already in a position
   * - Applies downward slippage (unfavorable for short seller)
   * - Uses strategy-metadata-based % of available cash as margin/collateral
   * - Deducts notional cost + taker fee from cash
   *
   * @param {Object} kline — current kline
   * @private
   */
  _openShort(kline) {
    if (this._position !== null) {
      log.debug('OPEN_SHORT skipped — already in position', {
        side: this._position.side,
        ts: kline.ts,
      });
      return;
    }

    if (math.isLessThan(this._cash, '0') || math.isZero(this._cash)) {
      log.debug('OPEN_SHORT skipped — insufficient cash', { cash: this._cash });
      return;
    }

    // Fill price: slippage applied downward (worse for short seller)
    const fillPrice = math.multiply(kline.close, math.subtract('1', this.slippage));

    // Position value: metadata-based % of available cash (T2-3)
    const positionValue = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));

    // Quantity
    const qty = math.divide(positionValue, fillPrice);

    // Taker fee on notional
    const notional = math.multiply(qty, fillPrice);
    const fee = math.multiply(notional, this.takerFee);

    // Deduct from cash: notional + fee (margin reserved)
    const totalCost = math.add(notional, fee);
    this._cash = math.subtract(this._cash, totalCost);

    // Record position
    this._position = {
      side: 'short',
      entryPrice: fillPrice,
      qty,
      entryTime: kline.ts,
      fee,
    };

    log.debug('OPEN_SHORT executed', {
      fillPrice,
      qty,
      fee,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill
    this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.OPEN_SHORT);
  }

  /**
   * Close an open long position.
   *
   * - Skips if no long position is open
   * - Applies downward slippage (unfavorable for seller)
   * - Adds proceeds (notional - fee) back to cash
   * - Records the completed trade with PnL
   *
   * @param {Object} kline — current kline
   * @private
   */
  _closeLong(kline) {
    if (this._position === null || this._position.side !== 'long') {
      log.debug('CLOSE_LONG skipped — no long position open', { ts: kline.ts });
      return;
    }

    const position = this._position;

    // Fill price: slippage applied downward (worse for seller)
    const fillPrice = math.multiply(kline.close, math.subtract('1', this.slippage));

    // Closing notional
    const closeNotional = math.multiply(position.qty, fillPrice);

    // Closing fee
    const closeFee = math.multiply(closeNotional, this.takerFee);

    // Net proceeds returned to cash
    const netProceeds = math.subtract(closeNotional, closeFee);
    this._cash = math.add(this._cash, netProceeds);

    // PnL = qty * (fillPrice - entryPrice)
    const grossPnl = math.multiply(position.qty, math.subtract(fillPrice, position.entryPrice));

    // Total fees = opening fee + closing fee
    const totalFee = math.add(position.fee, closeFee);

    // Net PnL = gross PnL - total fees
    const netPnl = math.subtract(grossPnl, totalFee);

    // Record trade
    this._trades.push({
      entryTime: position.entryTime,
      exitTime: kline.ts,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      side: 'long',
      qty: position.qty,
      pnl: netPnl,
      fee: totalFee,
    });

    log.debug('CLOSE_LONG executed', {
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      pnl: netPnl,
      fee: totalFee,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill
    this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);

    // Clear position
    this._position = null;
  }

  /**
   * Close an open short position.
   *
   * - Skips if no short position is open
   * - Applies upward slippage (unfavorable for short cover)
   * - Adds proceeds back to cash
   * - Records the completed trade with PnL
   *
   * @param {Object} kline — current kline
   * @private
   */
  _closeShort(kline) {
    if (this._position === null || this._position.side !== 'short') {
      log.debug('CLOSE_SHORT skipped — no short position open', { ts: kline.ts });
      return;
    }

    const position = this._position;

    // Fill price: slippage applied upward (worse for short cover)
    const fillPrice = math.multiply(kline.close, math.add('1', this.slippage));

    // Closing notional
    const closeNotional = math.multiply(position.qty, fillPrice);

    // Closing fee
    const closeFee = math.multiply(closeNotional, this.takerFee);

    // For shorts, when closing we "buy back" at fillPrice.
    // The original notional (at entry) was reserved as collateral.
    // We return: entryNotional + (entryPrice - fillPrice) * qty - closeFee
    // Simplified: entryNotional - closeNotional - closeFee + entryNotional
    // Actually:
    //   When opening short, we deducted: qty * entryPrice + openFee
    //   When closing short, we receive back the margin plus profit (or minus loss):
    //     proceeds = qty * entryPrice + qty * (entryPrice - fillPrice) - closeFee
    //             = qty * (2 * entryPrice - fillPrice) - closeFee
    //   But simpler way: proceeds = entryNotional + grossPnl - closeFee
    const entryNotional = math.multiply(position.qty, position.entryPrice);
    const grossPnl = math.multiply(position.qty, math.subtract(position.entryPrice, fillPrice));
    const netProceeds = math.subtract(math.add(entryNotional, grossPnl), closeFee);
    this._cash = math.add(this._cash, netProceeds);

    // Total fees
    const totalFee = math.add(position.fee, closeFee);

    // Net PnL = gross PnL - total fees
    const netPnl = math.subtract(grossPnl, totalFee);

    // Record trade
    this._trades.push({
      entryTime: position.entryTime,
      exitTime: kline.ts,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      side: 'short',
      qty: position.qty,
      pnl: netPnl,
      fee: totalFee,
    });

    log.debug('CLOSE_SHORT executed', {
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      pnl: netPnl,
      fee: totalFee,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill
    this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.CLOSE_SHORT);

    // Clear position
    this._position = null;
  }

  // =========================================================================
  // Force close
  // =========================================================================

  /**
   * Force-close any open position at the given kline's close price.
   * Called at the end of the simulation to ensure no position is left hanging.
   *
   * @param {Object} kline — last kline in the dataset
   * @private
   */
  _forceClosePosition(kline) {
    if (this._position === null) {
      return;
    }

    log.info('Force-closing open position at end of backtest', {
      side: this._position.side,
      entryPrice: this._position.entryPrice,
      closePrice: kline.close,
      ts: kline.ts,
    });

    if (this._position.side === 'long') {
      this._closeLong(kline);
    } else if (this._position.side === 'short') {
      this._closeShort(kline);
    }
  }

  // =========================================================================
  // Equity tracking
  // =========================================================================

  /**
   * Record an equity snapshot for the current kline.
   *
   * Equity = cash + unrealized PnL of open position.
   *
   * @param {Object} kline — current kline
   * @private
   */
  _recordEquitySnapshot(kline) {
    const equity = this._calculateEquity(kline);

    this._equityCurve.push({
      ts: kline.ts,
      equity,
      cash: this._cash,
    });
  }

  /**
   * Calculate total equity at the given kline.
   *
   * For no position: equity = cash
   * For long:  unrealized = qty * (currentPrice - entryPrice)
   * For short: unrealized = qty * (entryPrice - currentPrice)
   * equity = cash + unrealized (but we also need to add back the notional
   *          that was deducted when opening, so we compute mark-to-market value)
   *
   * More precisely:
   *   When opening, cash was reduced by (notional + fee).
   *   The position's current value is qty * currentPrice (for long).
   *   So total equity = cash + qty * currentPrice (which naturally includes
   *   the unrealized PnL relative to entry since cash was reduced by entry cost).
   *
   * For short:
   *   Cash was reduced by (entryNotional + fee).
   *   Current value of short = entryNotional + (entryPrice - currentPrice) * qty
   *                          = qty * (2 * entryPrice - currentPrice)
   *   But simpler: value = entryNotional + unrealizedPnl
   *   equity = cash + entryNotional + unrealizedPnl
   *
   * @param {Object} kline — current kline with close price
   * @returns {string} total equity as String
   * @private
   */
  _calculateEquity(kline) {
    if (this._position === null) {
      return this._cash;
    }

    const currentPrice = kline.close;
    const position = this._position;

    if (position.side === 'long') {
      // Mark-to-market value of the long position
      const positionMtm = math.multiply(position.qty, currentPrice);
      return math.add(this._cash, positionMtm);
    }

    // Short position
    // Unrealized PnL = qty * (entryPrice - currentPrice)
    const unrealizedPnl = math.multiply(
      position.qty,
      math.subtract(position.entryPrice, currentPrice),
    );
    // The entry notional was deducted from cash, so add back entry notional + unrealized
    const entryNotional = math.multiply(position.qty, position.entryPrice);
    return math.add(this._cash, math.add(entryNotional, unrealizedPnl));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Notify the strategy of a simulated fill event so it can update
   * internal state (e.g. entry price tracking for TP/SL).
   *
   * @param {'buy'|'sell'} side
   * @param {string} price — fill price
   * @param {string} action — SIGNAL_ACTIONS value (open_long, close_long, etc.)
   * @private
   */
  _notifyFill(side, price, action) {
    if (typeof this._strategy.onFill === 'function') {
      try {
        this._strategy.onFill({ side, price, action, symbol: this.symbol });
      } catch (err) {
        log.error('Strategy.onFill error', { side, price, action, symbol: this.symbol, error: err.message });
      }
    }
  }
}

module.exports = BacktestEngine;
