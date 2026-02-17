'use strict';

/**
 * GridStrategy — ATR-based bidirectional grid trading strategy.
 *
 * Places buy (OPEN_LONG) limit orders below the base price and
 * sell (OPEN_SHORT) limit orders above it.  When a grid level is
 * hit, the strategy emits a signal for that level and queues the
 * opposite (take-profit) exit order one grid spacing away.
 *
 * Active ONLY when MarketRegime === RANGING.  Deactivates on
 * TRENDING_UP / TRENDING_DOWN, BTC 5 % sudden moves, or when
 * unrealised loss exceeds 3 % of equity.
 *
 * Per-symbol state via StrategyBase SymbolState pattern.
 */

const StrategyBase = require('../../services/strategyBase');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  isGreaterThanOrEqual,
  isLessThanOrEqual,
  toFixed,
  abs,
  max,
} = require('../../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

const log = createLogger('GridStrategy');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimum elapsed time (ms) between grid resets — 1 hour.
 */
const MIN_RESET_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How long (ms) price may stay outside the grid range before triggering a
 * reset — 30 minutes.
 */
const OUT_OF_RANGE_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

class GridStrategy extends StrategyBase {
  /**
   * Metadata exposed to the registry / UI.
   */
  static metadata = {
    name: 'GridStrategy',
    targetRegimes: ['ranging'],
    riskLevel: 'low',
    maxConcurrentPositions: 3,
    cooldownMs: 30000,
    gracePeriodMs: 180000,
    warmupCandles: 1,
    volatilityPreference: 'low',
    maxSymbolsPerStrategy: 2,
    description: 'ATR 기반 그리드 트레이딩 (양방향 헤지)',
    defaultConfig: {
      atrPeriod: 14,
      gridSpacingMultiplier: '0.3',
      gridLevels: 10,
      totalBudgetPercent: '20',
      leverage: 2,
      maxDrawdownPercent: '3',
    },
  };

  /**
   * @param {object} config
   * @param {number}  [config.atrPeriod=14]                — ATR look-back period
   * @param {string}  [config.gridSpacingMultiplier='0.3']  — ATR multiplier for grid spacing
   * @param {number}  [config.gridLevels=10]                — levels above AND below base price
   * @param {string}  [config.totalBudgetPercent='20']      — % of equity allocated to grid
   * @param {number}  [config.leverage=2]                   — leverage for grid orders
   */
  constructor(config = {}) {
    const merged = { ...GridStrategy.metadata.defaultConfig, ...config };
    super('GridStrategy', merged);

    // --- Configuration (shared across symbols) ---
    this._atrPeriod = merged.atrPeriod;
    this._gridSpacingMultiplier = merged.gridSpacingMultiplier;
    this._gridLevelCount = merged.gridLevels;
    this._totalBudgetPercent = merged.totalBudgetPercent;
    this._leverage = merged.leverage;
    this._maxDrawdownPercent = merged.maxDrawdownPercent;
  }

  // -----------------------------------------------------------------------
  // SymbolState — per-symbol state defaults
  // -----------------------------------------------------------------------

  /** @override */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      basePrice: null,
      gridSpacing: null,
      gridLevels: [],
      atrValue: null,
      lastResetTime: null,
      outOfRangeStartTime: null,
    };
  }

  // -----------------------------------------------------------------------
  // StrategyBase overrides
  // -----------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   *
   * 1. Store latest price.
   * 2. If the grid is initialised, check whether any untriggered level has
   *    been hit.  When a level is hit emit the entry signal **and** queue
   *    the opposite take-profit signal on the next call.
   *
   * @param {{ lastPr: string, ts?: string }} ticker
   */
  onTick(ticker) {
    if (!this._active) return;

    const price = ticker.lastPrice || ticker.last || ticker.price;
    if (!price) return;

    const s = this._s();
    const symbol = this.getCurrentSymbol();
    s.latestPrice = price;

    // Nothing to check until grid is built
    if (s.gridLevels.length === 0) return;

    // Only generate signals in RANGING regime (allow null for backtest)
    if (this.getEffectiveRegime() !== null && this.getEffectiveRegime() !== MARKET_REGIMES.RANGING) return;

    // Track out-of-range duration for potential grid reset
    this._trackOutOfRange(price);

    // Check grid-wide drawdown stop-loss
    if (this._checkGridDrawdownSL(price)) return;

    // Scan untriggered levels
    for (let i = 0; i < s.gridLevels.length; i++) {
      const lvl = s.gridLevels[i];
      if (lvl.triggered) continue;

      const hit = this._isLevelHit(price, lvl);
      if (!hit) continue;

      // Mark as triggered
      lvl.triggered = true;

      // Build entry signal
      const entrySignal = this._buildEntrySignal(lvl);
      s.lastSignal = entrySignal;
      this.emitSignal(entrySignal);

      log.trade('Grid level hit', {
        level: lvl.level,
        side: lvl.side,
        price: lvl.price,
        currentPrice: price,
      });

      // Immediately emit the opposite take-profit signal
      const exitSignal = this._buildExitSignal(lvl);
      this.emitSignal(exitSignal);

      log.trade('Grid exit order queued', {
        level: lvl.level,
        side: exitSignal.action,
        exitPrice: exitSignal.suggestedPrice,
      });

      // Only process one level per tick to avoid signal flooding
      break;
    }
  }

  /**
   * Called on every incoming kline (candlestick) update.
   *
   * 1. Read kline history and ATR from IndicatorCache.
   * 2. If grid not yet initialised OR a reset is warranted, call _initGrid().
   * 3. If regime is not RANGING suppress new grid creation.
   *
   * @param {{ high: string, low: string, close: string }} kline
   */
  onKline(kline) {
    if (!this._active) return;

    const s = this._s();
    const symbol = this.getCurrentSymbol();
    const c = this._indicatorCache;
    const hist = c.getHistory(symbol);
    if (!hist || hist.klines.length < this._atrPeriod + 1) {
      log.debug('Not enough kline data for ATR', {
        have: hist ? hist.klines.length : 0,
        need: this._atrPeriod + 1,
      });
      return;
    }
    s.atrValue = c.get(symbol, 'atr', { period: this._atrPeriod });

    log.debug('ATR calculated', {
      atr: s.atrValue,
      period: this._atrPeriod,
    });

    // Only operate in RANGING regime (allow null for backtest)
    if (this.getEffectiveRegime() !== null && this.getEffectiveRegime() !== MARKET_REGIMES.RANGING) {
      log.debug('Regime not RANGING — grid signals suppressed', {
        regime: this.getEffectiveRegime(),
      });
      return;
    }

    // Initialise grid if it has never been built
    if (s.gridLevels.length === 0) {
      this._initGrid();
      return;
    }

    // Check if a grid reset is needed
    if (this._shouldResetGrid()) {
      log.info('Grid reset triggered');
      this._initGrid();
    }
  }

  /**
   * Return the most recent signal or null.
   * @returns {object|null}
   */
  getSignal() {
    const s = this._s();
    const signal = s.lastSignal;
    s.lastSignal = null;
    return signal;
  }

  // -----------------------------------------------------------------------
  // Grid lifecycle helpers
  // -----------------------------------------------------------------------

  /**
   * Initialise (or re-initialise) the grid centred on the latest price.
   *
   * Creates `_gridLevelCount` buy levels below the base and
   * `_gridLevelCount` sell levels above it (20 levels total by default).
   */
  _initGrid() {
    const s = this._s();
    const symbol = this.getCurrentSymbol();
    const c = this._indicatorCache;
    const hist = c ? c.getHistory(symbol) : null;

    const price = s.latestPrice || (hist && hist.klines.length > 0
      ? hist.klines[hist.klines.length - 1].close
      : null);

    if (!price) {
      log.warn('Cannot init grid — no price data available');
      return;
    }

    if (!s.atrValue || isLessThan(s.atrValue, '0')) {
      log.warn('Cannot init grid — ATR not available or invalid', {
        atr: s.atrValue,
      });
      return;
    }

    s.basePrice = price;
    s.gridSpacing = multiply(s.atrValue, this._gridSpacingMultiplier);

    // Validate minimum grid spacing: at least 0.1% of base price to avoid
    // excessively dense grids where slippage/commissions would erode profits.
    const minSpacing = multiply(price, '0.001');
    if (isLessThan(s.gridSpacing, minSpacing)) {
      log.warn('Grid spacing too dense — adjusting to min 0.1% of price', {
        original: s.gridSpacing,
        minSpacing,
        basePrice: price,
      });
      s.gridSpacing = minSpacing;
    }

    s.gridLevels = [];

    // Buy (OPEN_LONG) levels below base price
    for (let i = 1; i <= this._gridLevelCount; i++) {
      const offset = multiply(s.gridSpacing, String(i));
      const levelPrice = subtract(s.basePrice, offset);
      s.gridLevels.push({
        price: levelPrice,
        side: 'long',
        level: i,
        triggered: false,
      });
    }

    // Sell (OPEN_SHORT) levels above base price
    for (let i = 1; i <= this._gridLevelCount; i++) {
      const offset = multiply(s.gridSpacing, String(i));
      const levelPrice = add(s.basePrice, offset);
      s.gridLevels.push({
        price: levelPrice,
        side: 'short',
        level: i,
        triggered: false,
      });
    }

    s.lastResetTime = new Date();
    s.outOfRangeStartTime = null;

    log.info('Grid initialised', {
      basePrice: s.basePrice,
      gridSpacing: s.gridSpacing,
      levels: s.gridLevels.length,
      atr: s.atrValue,
    });
  }

  /**
   * Determine whether the grid should be reset.
   *
   * A reset is triggered when:
   *   1. The price has been outside the grid range for longer than
   *      OUT_OF_RANGE_THRESHOLD_MS (30 min).
   *   2. At least MIN_RESET_INTERVAL_MS (1 h) has elapsed since the last
   *      reset.
   *
   * @returns {boolean}
   */
  _shouldResetGrid() {
    const s = this._s();
    if (!s.latestPrice || !s.basePrice || !s.gridSpacing) {
      return false;
    }

    // Enforce minimum interval between resets
    if (s.lastResetTime) {
      const elapsed = Date.now() - s.lastResetTime.getTime();
      if (elapsed < MIN_RESET_INTERVAL_MS) {
        return false;
      }
    }

    // Calculate upper and lower bounds of the grid
    const rangeOffset = multiply(s.gridSpacing, String(this._gridLevelCount));
    const upperBound = add(s.basePrice, rangeOffset);
    const lowerBound = subtract(s.basePrice, rangeOffset);

    const isOutside =
      isGreaterThan(s.latestPrice, upperBound) ||
      isLessThan(s.latestPrice, lowerBound);

    if (!isOutside) {
      // Price came back — clear timer
      s.outOfRangeStartTime = null;
      return false;
    }

    // Price is outside; if this is the first observation, start the timer
    if (!s.outOfRangeStartTime) {
      s.outOfRangeStartTime = new Date();
      return false;
    }

    // Has the price been out of range long enough?
    const outDuration = Date.now() - s.outOfRangeStartTime.getTime();
    return outDuration >= OUT_OF_RANGE_THRESHOLD_MS;
  }

  // -----------------------------------------------------------------------
  // Signal helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether the current price has reached a grid level.
   *
   * For long levels (below base) the price must drop to or below the level.
   * For short levels (above base) the price must rise to or above the level.
   *
   * @param {string} price   — current market price
   * @param {{ price: string, side: 'long'|'short' }} lvl — grid level
   * @returns {boolean}
   */
  _isLevelHit(price, lvl) {
    if (lvl.side === 'long') {
      // Buy level is hit when price drops to or below it
      return isLessThanOrEqual(price, lvl.price);
    }
    // Sell level is hit when price rises to or above it
    return isGreaterThanOrEqual(price, lvl.price);
  }

  /**
   * Build the entry signal for a triggered grid level.
   *
   * @param {{ price: string, side: 'long'|'short', level: number }} lvl
   * @returns {object} signal payload
   */
  _buildEntrySignal(lvl) {
    const s = this._s();
    const symbol = this.getCurrentSymbol();
    const action =
      lvl.side === 'long'
        ? SIGNAL_ACTIONS.OPEN_LONG
        : SIGNAL_ACTIONS.OPEN_SHORT;

    const suggestedQty = this._calculatePerLevelQty(lvl.price);

    return {
      action,
      symbol,
      category: this._category,
      suggestedPrice: lvl.price,
      suggestedQty,
      confidence: '0.70',
      marketContext: {
        strategy: 'GridStrategy',
        basePrice: s.basePrice,
        gridSpacing: s.gridSpacing,
        gridLevel: lvl.level,
        side: lvl.side,
        leverage: this._leverage,
        orderType: 'limit',
        atr: s.atrValue,
        regime: this.getEffectiveRegime(),
      },
    };
  }

  /**
   * Build the take-profit exit signal for a triggered grid level.
   *
   * Long entry at price P → exit (CLOSE_LONG) at P + gridSpacing.
   * Short entry at price P → exit (CLOSE_SHORT) at P - gridSpacing.
   *
   * @param {{ price: string, side: 'long'|'short', level: number }} lvl
   * @returns {object} signal payload
   */
  _buildExitSignal(lvl) {
    const s = this._s();
    const symbol = this.getCurrentSymbol();
    let action;
    let exitPrice;

    if (lvl.side === 'long') {
      action = SIGNAL_ACTIONS.CLOSE_LONG;
      exitPrice = add(lvl.price, s.gridSpacing);
    } else {
      action = SIGNAL_ACTIONS.CLOSE_SHORT;
      exitPrice = subtract(lvl.price, s.gridSpacing);
    }

    const suggestedQty = this._calculatePerLevelQty(lvl.price);

    return {
      action,
      symbol,
      category: this._category,
      suggestedPrice: exitPrice,
      suggestedQty,
      reduceOnly: true,
      confidence: '0.70',
      marketContext: {
        strategy: 'GridStrategy',
        basePrice: s.basePrice,
        gridSpacing: s.gridSpacing,
        gridLevel: lvl.level,
        side: lvl.side === 'long' ? 'close_long' : 'close_short',
        leverage: this._leverage,
        orderType: 'limit',
        reduceOnly: true,
        atr: s.atrValue,
        regime: this.getEffectiveRegime(),
      },
    };
  }

  /**
   * Compute the quantity for a single grid level.
   *
   * Formula:
   *   totalBudget = equity × (totalBudgetPercent / 100)
   *   perLevelQty = totalBudget / (gridLevels × 2) / price
   *
   * When equity is unknown we fall back to '0' (the risk engine will
   * re-size later).
   *
   * @param {string} price — limit price for the level
   * @returns {string} quantity as a fixed-precision string
   */
  _calculatePerLevelQty(price) {
    const equity = this.getEquity();
    if (equity === '0' || !price || price === '0') {
      return '0';
    }

    const budgetFraction = divide(this._totalBudgetPercent, '100');
    const totalBudget = multiply(equity, budgetFraction);
    const totalLevels = String(this._gridLevelCount * 2);
    const perLevelBudget = divide(totalBudget, totalLevels);
    const qty = divide(perLevelBudget, price);

    return toFixed(qty, 8);
  }

  /**
   * Track how long the price has been outside the grid range.
   * Used by _shouldResetGrid() to decide on grid re-initialisation.
   *
   * @param {string} price — latest market price
   */
  _trackOutOfRange(price) {
    const s = this._s();
    if (!s.basePrice || !s.gridSpacing) return;

    const rangeOffset = multiply(s.gridSpacing, String(this._gridLevelCount));
    const upperBound = add(s.basePrice, rangeOffset);
    const lowerBound = subtract(s.basePrice, rangeOffset);

    const isOutside =
      isGreaterThan(price, upperBound) || isLessThan(price, lowerBound);

    if (isOutside && !s.outOfRangeStartTime) {
      s.outOfRangeStartTime = new Date();
    } else if (!isOutside) {
      s.outOfRangeStartTime = null;
    }
  }

  /**
   * Check if the aggregate unrealised PnL of all triggered grid levels
   * exceeds the maximum drawdown threshold.
   *
   * For each triggered level we estimate PnL:
   *   - Long level: (currentPrice - levelPrice) per unit
   *   - Short level: (levelPrice - currentPrice) per unit
   *
   * If total estimated drawdown exceeds maxDrawdownPercent of basePrice,
   * emit CLOSE_LONG and CLOSE_SHORT signals for all triggered levels and
   * reset the grid.
   *
   * @param {string} price — current market price
   * @returns {boolean} true if SL was triggered and grid was cleared
   */
  _checkGridDrawdownSL(price) {
    const s = this._s();
    const symbol = this.getCurrentSymbol();
    if (!s.basePrice || !this._maxDrawdownPercent) return false;

    const triggered = s.gridLevels.filter(l => l.triggered);
    if (triggered.length === 0) return false;

    // Sum up per-level PnL as a fraction of base price
    let totalPnl = '0';
    for (const lvl of triggered) {
      if (lvl.side === 'long') {
        // Long: profit when price rises above level
        totalPnl = add(totalPnl, subtract(price, lvl.price));
      } else {
        // Short: profit when price drops below level
        totalPnl = add(totalPnl, subtract(lvl.price, price));
      }
    }

    // Convert total PnL to percentage of base price
    const pnlPercent = multiply(divide(totalPnl, s.basePrice), '100');

    // If loss exceeds threshold, close all positions
    const threshold = subtract('0', this._maxDrawdownPercent); // e.g. '-3'
    if (isLessThan(pnlPercent, threshold)) {
      log.trade('Grid drawdown SL triggered — closing all positions', {
        pnlPercent,
        threshold: this._maxDrawdownPercent,
        triggeredLevels: triggered.length,
        currentPrice: price,
      });

      // Emit close signals for all triggered levels
      const hasLong = triggered.some(l => l.side === 'long');
      const hasShort = triggered.some(l => l.side === 'short');

      if (hasLong) {
        const closeSignal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol,
          category: this._category,
          suggestedPrice: price,
          confidence: '1.0000',
          reduceOnly: true,
          marketContext: {
            strategy: 'GridStrategy',
            reason: 'grid_drawdown_sl',
            pnlPercent,
            maxDrawdownPercent: this._maxDrawdownPercent,
          },
        };
        this.emitSignal(closeSignal);
      }

      if (hasShort) {
        const closeSignal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol,
          category: this._category,
          suggestedPrice: price,
          confidence: '1.0000',
          reduceOnly: true,
          marketContext: {
            strategy: 'GridStrategy',
            reason: 'grid_drawdown_sl',
            pnlPercent,
            maxDrawdownPercent: this._maxDrawdownPercent,
          },
        };
        this.emitSignal(closeSignal);
      }

      // Reset grid entirely
      s.gridLevels = [];
      s.basePrice = null;
      s.gridSpacing = null;
      s.outOfRangeStartTime = null;

      return true;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Self-register with the strategy registry
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('GridStrategy', GridStrategy);

module.exports = GridStrategy;
