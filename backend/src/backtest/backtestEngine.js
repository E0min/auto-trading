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

const log = createLogger('BacktestEngine');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Percentage of available cash used per trade (backtest simplification) */
const DEFAULT_POSITION_SIZE_PCT = '95';

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

      // 4a. Feed kline to strategy (triggers indicator computation + potential signal)
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

      // 4b. Create synthetic ticker and feed to strategy (triggers TP/SL checks)
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

      // 4c. Record equity snapshot
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

    // Activate for the backtest symbol
    strategy.activate(this.symbol);

    // Apply fixed market regime if specified
    if (this.marketRegime) {
      strategy.setMarketRegime(this.marketRegime);
    }

    return strategy;
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
   * Position sizing uses a fixed percentage (95%) of available cash.
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
   * - Uses 95% of available cash for position sizing
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

    // Position value: 95% of available cash
    const positionValue = math.multiply(this._cash, math.divide(DEFAULT_POSITION_SIZE_PCT, '100'));

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
    this._notifyFill('buy', fillPrice);
  }

  /**
   * Open a short position.
   *
   * - Skips if already in a position
   * - Applies downward slippage (unfavorable for short seller)
   * - Uses 95% of available cash as margin/collateral
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

    // Position value: 95% of available cash
    const positionValue = math.multiply(this._cash, math.divide(DEFAULT_POSITION_SIZE_PCT, '100'));

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
    this._notifyFill('sell', fillPrice);
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
    this._notifyFill('sell', fillPrice);

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
    this._notifyFill('buy', fillPrice);

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
   * @private
   */
  _notifyFill(side, price) {
    if (typeof this._strategy.onFill === 'function') {
      try {
        this._strategy.onFill({ side, price });
      } catch (err) {
        log.error('Strategy.onFill error', { side, price, error: err.message });
      }
    }
  }
}

module.exports = BacktestEngine;
