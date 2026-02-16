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

/** Absolute cap on concurrent positions regardless of strategy metadata */
const ABSOLUTE_MAX_POSITIONS = 10;

/** Max kline history kept in the backtest indicator cache */
const BT_MAX_HISTORY = 500;

/** Default funding rate for backtest simulation (0.01% = 0.0001) — R8-T2-3 */
const DEFAULT_FUNDING_RATE = '0.0001';

/** Funding settlement interval in milliseconds (8 hours) — R8-T2-3 */
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

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
   * @param {string}  [opts.fundingRate='0.0001'] — simulated funding rate per settlement (R8-T2-3)
   * @param {string}  [opts.leverage='1'] — leverage multiplier (1-20, P12-3 AD-70)
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
    fundingRate = DEFAULT_FUNDING_RATE,
    leverage = '1',
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
    this.fundingRate = String(fundingRate);
    this.leverage = String(leverage);

    // Simulation state (reset on each run)
    this._cash = '0';
    /** @type {Map<string, {side: string, entryPrice: string, qty: string, entryTime: string, fee: string}>} */
    this._positions = new Map();
    this._nextPositionId = 1;
    this._trades = [];
    this._equityCurve = [];
    this._currentKline = null;
    this._strategy = null;
    this._pendingSignals = [];
    /** @type {number|null} Last funding settlement timestamp (ms) — R8-T2-3 */
    this._lastFundingTs = null;
    /** @type {Map<string, string>} Per-position accumulated funding PnL — R8-T2-3 */
    this._accumulatedFundings = new Map();
    /** @type {number} Max concurrent positions (set during run()) */
    this._maxPositions = 1;
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
    this._positions = new Map();
    this._nextPositionId = 1;
    this._trades = [];
    this._equityCurve = [];
    this._pendingSignals = [];
    this._lastFundingTs = null;
    this._accumulatedFundings = new Map();
    this._totalFundingCost = '0'; // R11-T7: Track total funding cost for metrics
    this._equitySampleInterval = Math.max(1, Math.floor(klines.length / 10000)); // E12-11
    this._klineIndex = 0;
    this._totalKlines = klines.length;

    // 2. Create and configure strategy instance
    this._strategy = this._createStrategy();

    // 2b. Cache position-size percentage from strategy metadata (T2-3)
    this._positionSizePct = this._getPositionSizePercent();

    // 2c. Cache max concurrent positions from strategy metadata (AD-60)
    this._maxPositions = this._getMaxConcurrentPositions();

    // 3. Bind signal listener
    const onSignal = (signal) => {
      this._pendingSignals.push(signal);
    };
    this._strategy.on(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);

    // 4. Main simulation loop
    for (let i = 0; i < klines.length; i++) {
      const kline = klines[i];
      this._currentKline = kline;
      this._klineIndex = i;

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

      // 4d. Apply simulated funding settlement every 8 hours (R8-T2-3)
      this._applyFundingIfDue(kline);

      // 4e. Record equity snapshot
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
    const result = {
      config: {
        strategyName: this.strategyName,
        symbol: this.symbol,
        interval: this.interval,
        initialCapital: this.initialCapital,
        makerFee: this.makerFee,
        takerFee: this.takerFee,
        slippage: this.slippage,
        marketRegime: this.marketRegime,
        fundingRate: this.fundingRate,
        leverage: this.leverage,
      },
      trades: this._trades,
      equityCurve: this._equityCurve,
      finalEquity,
      totalTrades: this._trades.length,
      totalFundingCost: this._totalFundingCost, // R11-T7
    };

    // P12-3 AD-70: Add leverage warning
    if (math.isGreaterThan(this.leverage, '1')) {
      result.leverageWarning = `레버리지 ${this.leverage}x 적용 (강제 청산 미시뮬레이션)`;
    }

    return result;
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

    // Inject account context so strategies can access backtest equity (T2-5, R11-T6)
    // R11-T6: Include unrealized PnL in equity calculation
    strategy.setAccountContext({
      getEquity: () => {
        if (this._currentKline) {
          return this._calculateEquity(this._currentKline);
        }
        return this._cash;
      },
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

  /**
   * Determine max concurrent positions from strategy metadata (AD-60).
   *
   * Falls back to 1 (single-position mode) if metadata is unavailable.
   * Capped at ABSOLUTE_MAX_POSITIONS to prevent runaway position counts.
   *
   * @returns {number}
   * @private
   */
  _getMaxConcurrentPositions() {
    const metadata = registry.getMetadata(this.strategyName);
    const maxPos = (metadata && metadata.maxConcurrentPositions) || 1;
    return Math.min(maxPos, ABSOLUTE_MAX_POSITIONS);
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
    if (this._positions.size >= this._maxPositions) {
      log.debug('OPEN_LONG skipped — max positions reached', {
        current: this._positions.size,
        max: this._maxPositions,
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

    // Margin-based sizing (P12-3 AD-70): margin = cash * pct, positionValue = margin * leverage
    const margin = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));
    const positionValue = math.multiply(margin, this.leverage);

    // Quantity
    const qty = math.divide(positionValue, fillPrice);

    // Taker fee on notional
    const notional = math.multiply(qty, fillPrice);
    const fee = math.multiply(notional, this.takerFee);

    // Deduct from cash: margin + fee (only margin, not full notional)
    const totalCost = math.add(margin, fee);
    if (math.isGreaterThan(totalCost, this._cash)) {
      log.debug('OPEN_LONG skipped — insufficient cash for margin + fee', { cash: this._cash, totalCost });
      return;
    }
    this._cash = math.subtract(this._cash, totalCost);

    // Record position with unique ID
    const posId = `pos_${this._nextPositionId++}`;
    this._positions.set(posId, {
      side: 'long',
      entryPrice: fillPrice,
      qty,
      entryTime: kline.ts,
      fee,
      margin,
    });
    this._accumulatedFundings.set(posId, '0');

    log.debug('OPEN_LONG executed', {
      posId,
      fillPrice,
      qty,
      fee,
      margin,
      leverage: this.leverage,
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
    if (this._positions.size >= this._maxPositions) {
      log.debug('OPEN_SHORT skipped — max positions reached', {
        current: this._positions.size,
        max: this._maxPositions,
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

    // Margin-based sizing (P12-3 AD-70): margin = cash * pct, positionValue = margin * leverage
    const margin = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));
    const positionValue = math.multiply(margin, this.leverage);

    // Quantity
    const qty = math.divide(positionValue, fillPrice);

    // Taker fee on notional
    const notional = math.multiply(qty, fillPrice);
    const fee = math.multiply(notional, this.takerFee);

    // Deduct from cash: margin + fee (only margin, not full notional)
    const totalCost = math.add(margin, fee);
    if (math.isGreaterThan(totalCost, this._cash)) {
      log.debug('OPEN_SHORT skipped — insufficient cash for margin + fee', { cash: this._cash, totalCost });
      return;
    }
    this._cash = math.subtract(this._cash, totalCost);

    // Record position with unique ID
    const posId = `pos_${this._nextPositionId++}`;
    this._positions.set(posId, {
      side: 'short',
      entryPrice: fillPrice,
      qty,
      entryTime: kline.ts,
      fee,
      margin,
    });
    this._accumulatedFundings.set(posId, '0');

    log.debug('OPEN_SHORT executed', {
      posId,
      fillPrice,
      qty,
      fee,
      margin,
      leverage: this.leverage,
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
    // FIFO: find the oldest long position (Map iteration order = insertion order)
    let targetId = null;
    for (const [id, pos] of this._positions) {
      if (pos.side === 'long') { targetId = id; break; }
    }
    if (!targetId) {
      log.debug('CLOSE_LONG skipped — no long position open', { ts: kline.ts });
      return;
    }

    const position = this._positions.get(targetId);

    // Fill price: slippage applied downward (worse for seller)
    const fillPrice = math.multiply(kline.close, math.subtract('1', this.slippage));

    // Closing notional
    const closeNotional = math.multiply(position.qty, fillPrice);

    // Closing fee
    const closeFee = math.multiply(closeNotional, this.takerFee);

    // PnL = qty * (fillPrice - entryPrice)
    const grossPnl = math.multiply(position.qty, math.subtract(fillPrice, position.entryPrice));

    // Net proceeds: margin + grossPnl - closeFee (margin-based, P12-3 AD-70)
    const netProceeds = math.subtract(math.add(position.margin, grossPnl), closeFee);
    this._cash = math.add(this._cash, netProceeds);

    // Total fees = opening fee + closing fee
    const totalFee = math.add(position.fee, closeFee);

    // Net PnL = gross PnL - total fees
    const netPnl = math.subtract(grossPnl, totalFee);

    // Capture accumulated funding for the position (R8-T2-3)
    const fundingPnl = this._accumulatedFundings.get(targetId) || '0';

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
      fundingPnl,
    });

    log.debug('CLOSE_LONG executed', {
      posId: targetId,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      pnl: netPnl,
      fee: totalFee,
      fundingPnl,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill
    this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);

    // Remove position from maps
    this._positions.delete(targetId);
    this._accumulatedFundings.delete(targetId);
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
    // FIFO: find the oldest short position (Map iteration order = insertion order)
    let targetId = null;
    for (const [id, pos] of this._positions) {
      if (pos.side === 'short') { targetId = id; break; }
    }
    if (!targetId) {
      log.debug('CLOSE_SHORT skipped — no short position open', { ts: kline.ts });
      return;
    }

    const position = this._positions.get(targetId);

    // Fill price: slippage applied upward (worse for short cover)
    const fillPrice = math.multiply(kline.close, math.add('1', this.slippage));

    // Closing notional
    const closeNotional = math.multiply(position.qty, fillPrice);

    // Closing fee
    const closeFee = math.multiply(closeNotional, this.takerFee);

    // Margin-based close (P12-3 AD-70): return margin + grossPnl - closeFee
    const grossPnl = math.multiply(position.qty, math.subtract(position.entryPrice, fillPrice));
    const netProceeds = math.subtract(math.add(position.margin, grossPnl), closeFee);
    this._cash = math.add(this._cash, netProceeds);

    // Total fees
    const totalFee = math.add(position.fee, closeFee);

    // Net PnL = gross PnL - total fees
    const netPnl = math.subtract(grossPnl, totalFee);

    // Capture accumulated funding for the position (R8-T2-3)
    const fundingPnl = this._accumulatedFundings.get(targetId) || '0';

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
      fundingPnl,
    });

    log.debug('CLOSE_SHORT executed', {
      posId: targetId,
      entryPrice: position.entryPrice,
      exitPrice: fillPrice,
      pnl: netPnl,
      fee: totalFee,
      fundingPnl,
      cash: this._cash,
      ts: kline.ts,
    });

    // Notify strategy of the fill
    this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.CLOSE_SHORT);

    // Remove position from maps
    this._positions.delete(targetId);
    this._accumulatedFundings.delete(targetId);
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
    if (this._positions.size === 0) {
      return;
    }

    log.info('Force-closing all open positions at end of backtest', {
      count: this._positions.size,
      closePrice: kline.close,
      ts: kline.ts,
    });

    // Snapshot the keys to avoid mutation during iteration
    const openIds = [...this._positions.keys()];
    for (const id of openIds) {
      const pos = this._positions.get(id);
      if (!pos) continue;
      if (pos.side === 'long') {
        this._closeLong(kline);
      } else {
        this._closeShort(kline);
      }
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
    // E12-11: Sample equityCurve to prevent memory issues with long backtests
    const isFirst = this._klineIndex === 0;
    const isLast = this._klineIndex === this._totalKlines - 1;
    const isOnInterval = this._klineIndex % this._equitySampleInterval === 0;

    if (!isFirst && !isLast && !isOnInterval) return;

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
    let equity = this._cash;

    for (const [, pos] of this._positions) {
      // Margin-based equity (P12-3 AD-70): equity = cash + margin + unrealizedPnl
      let unrealizedPnl;
      if (pos.side === 'long') {
        unrealizedPnl = math.multiply(pos.qty, math.subtract(kline.close, pos.entryPrice));
      } else {
        unrealizedPnl = math.multiply(pos.qty, math.subtract(pos.entryPrice, kline.close));
      }
      equity = math.add(equity, math.add(pos.margin, unrealizedPnl));
    }

    return equity;
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

  // =========================================================================
  // Funding simulation (R8-T2-3)
  // =========================================================================

  /**
   * Apply simulated funding settlement every 8 hours to open positions.
   * Formula: fundingPnl = positionSize * fundingRate * -1
   *   (long payer = negative, short receiver = positive in positive funding)
   *
   * R11-T7: Now deducts/adds funding to cash and tracks total funding cost.
   *
   * @param {Object} kline — current kline with ts field
   * @private
   */
  _applyFundingIfDue(kline) {
    if (this._positions.size === 0) return;
    if (math.isZero(this.fundingRate)) return;

    const ts = parseInt(kline.ts, 10);
    if (isNaN(ts)) return;

    // Initialize last funding timestamp on first call
    if (this._lastFundingTs === null) {
      this._lastFundingTs = ts;
      return;
    }

    // Check if 8 hours have elapsed since last funding settlement
    if (ts - this._lastFundingTs < FUNDING_INTERVAL_MS) return;

    // Apply funding — may apply multiple times if gap is > 8h
    while (this._lastFundingTs + FUNDING_INTERVAL_MS <= ts) {
      this._lastFundingTs += FUNDING_INTERVAL_MS;

      // Apply funding to each open position
      for (const [posId, position] of this._positions) {
        const markPrice = kline.close;
        const posSize = math.multiply(position.qty, markPrice);

        // For longs in positive funding: payer (negative)
        // For shorts in positive funding: receiver (positive)
        // Formula: fundingPnl = positionSize * fundingRate * -1 (from long perspective)
        // For short: the sign naturally flips because short profits from positive funding
        let fundingPnl;
        if (position.side === 'long') {
          fundingPnl = math.multiply(math.multiply(posSize, this.fundingRate), '-1');
        } else {
          // Short position receives funding in positive funding rate environment
          fundingPnl = math.multiply(posSize, this.fundingRate);
        }

        const accumulated = this._accumulatedFundings.get(posId) || '0';
        this._accumulatedFundings.set(posId, math.add(accumulated, fundingPnl));

        // R11-T7: Apply funding to cash (positive = receive, negative = pay)
        this._cash = math.add(this._cash, fundingPnl);
        // Prevent negative cash (defensive)
        if (math.isLessThan(this._cash, '0')) {
          this._cash = '0';
        }

        // R11-T7: Track total funding cost (absolute cost regardless of direction)
        // Negative fundingPnl = cost to the account
        if (math.isLessThan(fundingPnl, '0')) {
          this._totalFundingCost = math.add(this._totalFundingCost, math.abs(fundingPnl));
        }

        log.debug('Funding settlement applied', {
          posId,
          side: position.side,
          fundingRate: this.fundingRate,
          posSize,
          fundingPnl,
          accumulatedFunding: this._accumulatedFundings.get(posId),
          cash: this._cash,
          ts: this._lastFundingTs,
        });
      }
    }
  }
}

module.exports = BacktestEngine;
