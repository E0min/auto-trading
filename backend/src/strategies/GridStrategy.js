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
 */

const StrategyBase = require('../services/strategyBase');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
  abs,
  max,
} = require('../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../utils/constants');
const { createLogger } = require('../utils/logger');

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
    description: 'ATR 기반 그리드 트레이딩 (양방향 헤지)',
    defaultConfig: {
      atrPeriod: 14,
      gridSpacingMultiplier: '0.3',
      gridLevels: 10,
      totalBudgetPercent: '20',
      leverage: 2,
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

    // --- Configuration --------------------------------------------------
    this._atrPeriod = merged.atrPeriod;
    this._gridSpacingMultiplier = merged.gridSpacingMultiplier;
    this._gridLevelCount = merged.gridLevels;
    this._totalBudgetPercent = merged.totalBudgetPercent;
    this._leverage = merged.leverage;

    // --- Internal state -------------------------------------------------
    /** @type {{ high: string, low: string, close: string }[]} */
    this.klineHistory = [];

    /** Grid centre price (string | null). */
    this._basePrice = null;

    /** ATR × multiplier — distance between grid levels (string | null). */
    this._gridSpacing = null;

    /**
     * Array of grid level objects.
     * @type {{ price: string, side: 'long'|'short', level: number, triggered: boolean }[]}
     */
    this._gridLevels = [];

    /** Latest computed ATR value as a string. */
    this._atrValue = null;

    /** Most recent signal payload (consumed by getSignal). */
    this._lastSignal = null;

    /** Latest ticker price as a string. */
    this._latestPrice = null;

    /** Maximum kline history kept (atrPeriod + small buffer). */
    this._maxHistory = this._atrPeriod + 5;

    /** Timestamp of the most recent grid reset. */
    this._lastResetTime = null;

    /**
     * Tracks when the price first moved outside the grid range.
     * Used to decide whether to trigger a reset after sustained out-of-range.
     * @type {Date|null}
     */
    this._outOfRangeStartTime = null;
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

    const price = ticker.lastPr || ticker.last || ticker.price;
    if (!price) return;

    this._latestPrice = price;

    // Nothing to check until grid is built
    if (this._gridLevels.length === 0) return;

    // Only generate signals in RANGING regime
    if (this._marketRegime !== MARKET_REGIMES.RANGING) return;

    // Track out-of-range duration for potential grid reset
    this._trackOutOfRange(price);

    // Scan untriggered levels
    for (let i = 0; i < this._gridLevels.length; i++) {
      const lvl = this._gridLevels[i];
      if (lvl.triggered) continue;

      const hit = this._isLevelHit(price, lvl);
      if (!hit) continue;

      // Mark as triggered
      lvl.triggered = true;

      // Build entry signal
      const entrySignal = this._buildEntrySignal(lvl);
      this._lastSignal = entrySignal;
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
   * 1. Append candle to klineHistory, trim excess.
   * 2. Calculate ATR.
   * 3. If grid not yet initialised OR a reset is warranted, call _initGrid().
   * 4. If regime is not RANGING suppress new grid creation.
   *
   * @param {{ high: string, low: string, close: string }} kline
   */
  onKline(kline) {
    if (!this._active) return;

    // Append candle
    this.klineHistory.push({
      high: kline.high,
      low: kline.low,
      close: kline.close,
    });

    // Trim history to max
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // Need at least atrPeriod + 1 candles to compute ATR
    if (this.klineHistory.length < this._atrPeriod + 1) {
      log.debug('Not enough kline data for ATR', {
        have: this.klineHistory.length,
        need: this._atrPeriod + 1,
      });
      return;
    }

    // Compute ATR
    this._atrValue = this._calculateAtr(this._atrPeriod);

    log.debug('ATR calculated', {
      atr: this._atrValue,
      period: this._atrPeriod,
    });

    // Only operate in RANGING regime
    if (this._marketRegime !== MARKET_REGIMES.RANGING) {
      log.debug('Regime not RANGING — grid signals suppressed', {
        regime: this._marketRegime,
      });
      return;
    }

    // Initialise grid if it has never been built
    if (this._gridLevels.length === 0) {
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
    const signal = this._lastSignal;
    this._lastSignal = null;
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
    const price = this._latestPrice || (this.klineHistory.length > 0
      ? this.klineHistory[this.klineHistory.length - 1].close
      : null);

    if (!price) {
      log.warn('Cannot init grid — no price data available');
      return;
    }

    if (!this._atrValue || isLessThan(this._atrValue, '0')) {
      log.warn('Cannot init grid — ATR not available or invalid', {
        atr: this._atrValue,
      });
      return;
    }

    this._basePrice = price;
    this._gridSpacing = multiply(this._atrValue, this._gridSpacingMultiplier);
    this._gridLevels = [];

    // Buy (OPEN_LONG) levels below base price
    for (let i = 1; i <= this._gridLevelCount; i++) {
      const offset = multiply(this._gridSpacing, String(i));
      const levelPrice = subtract(this._basePrice, offset);
      this._gridLevels.push({
        price: levelPrice,
        side: 'long',
        level: i,
        triggered: false,
      });
    }

    // Sell (OPEN_SHORT) levels above base price
    for (let i = 1; i <= this._gridLevelCount; i++) {
      const offset = multiply(this._gridSpacing, String(i));
      const levelPrice = add(this._basePrice, offset);
      this._gridLevels.push({
        price: levelPrice,
        side: 'short',
        level: i,
        triggered: false,
      });
    }

    this._lastResetTime = new Date();
    this._outOfRangeStartTime = null;

    log.info('Grid initialised', {
      basePrice: this._basePrice,
      gridSpacing: this._gridSpacing,
      levels: this._gridLevels.length,
      atr: this._atrValue,
    });
  }

  /**
   * Calculate the ATR (Average True Range) using String-based arithmetic.
   *
   * TR for each bar = max(H-L, |H-prevC|, |L-prevC|).
   * ATR = simple moving average of TR over `period` bars.
   *
   * @param {number} period — number of bars
   * @returns {string} ATR as a fixed-precision string
   */
  _calculateAtr(period) {
    const history = this.klineHistory;
    const len = history.length;

    if (len < period + 1) {
      return '0';
    }

    let trSum = '0';

    for (let i = len - period; i < len; i++) {
      const curr = history[i];
      const prev = history[i - 1];

      const highLow = subtract(curr.high, curr.low);
      const highPrevClose = abs(subtract(curr.high, prev.close));
      const lowPrevClose = abs(subtract(curr.low, prev.close));

      // TR = max of the three
      const tr = max(highLow, max(highPrevClose, lowPrevClose));
      trSum = add(trSum, tr);
    }

    return divide(trSum, String(period));
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
    if (!this._latestPrice || !this._basePrice || !this._gridSpacing) {
      return false;
    }

    // Enforce minimum interval between resets
    if (this._lastResetTime) {
      const elapsed = Date.now() - this._lastResetTime.getTime();
      if (elapsed < MIN_RESET_INTERVAL_MS) {
        return false;
      }
    }

    // Calculate upper and lower bounds of the grid
    const rangeOffset = multiply(this._gridSpacing, String(this._gridLevelCount));
    const upperBound = add(this._basePrice, rangeOffset);
    const lowerBound = subtract(this._basePrice, rangeOffset);

    const isOutside =
      isGreaterThan(this._latestPrice, upperBound) ||
      isLessThan(this._latestPrice, lowerBound);

    if (!isOutside) {
      // Price came back — clear timer
      this._outOfRangeStartTime = null;
      return false;
    }

    // Price is outside; if this is the first observation, start the timer
    if (!this._outOfRangeStartTime) {
      this._outOfRangeStartTime = new Date();
      return false;
    }

    // Has the price been out of range long enough?
    const outDuration = Date.now() - this._outOfRangeStartTime.getTime();
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
      return isLessThan(price, lvl.price) || price === lvl.price;
    }
    // Sell level is hit when price rises to or above it
    return isGreaterThan(price, lvl.price) || price === lvl.price;
  }

  /**
   * Build the entry signal for a triggered grid level.
   *
   * @param {{ price: string, side: 'long'|'short', level: number }} lvl
   * @returns {object} signal payload
   */
  _buildEntrySignal(lvl) {
    const action =
      lvl.side === 'long'
        ? SIGNAL_ACTIONS.OPEN_LONG
        : SIGNAL_ACTIONS.OPEN_SHORT;

    const suggestedQty = this._calculatePerLevelQty(lvl.price);

    return {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedPrice: lvl.price,
      suggestedQty,
      confidence: '0.70',
      marketContext: {
        strategy: 'GridStrategy',
        basePrice: this._basePrice,
        gridSpacing: this._gridSpacing,
        gridLevel: lvl.level,
        side: lvl.side,
        leverage: this._leverage,
        orderType: 'limit',
        atr: this._atrValue,
        regime: this._marketRegime,
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
    let action;
    let exitPrice;

    if (lvl.side === 'long') {
      action = SIGNAL_ACTIONS.CLOSE_LONG;
      exitPrice = add(lvl.price, this._gridSpacing);
    } else {
      action = SIGNAL_ACTIONS.CLOSE_SHORT;
      exitPrice = subtract(lvl.price, this._gridSpacing);
    }

    const suggestedQty = this._calculatePerLevelQty(lvl.price);

    return {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedPrice: exitPrice,
      suggestedQty,
      confidence: '0.70',
      marketContext: {
        strategy: 'GridStrategy',
        basePrice: this._basePrice,
        gridSpacing: this._gridSpacing,
        gridLevel: lvl.level,
        side: lvl.side === 'long' ? 'close_long' : 'close_short',
        leverage: this._leverage,
        orderType: 'limit',
        reduceOnly: true,
        atr: this._atrValue,
        regime: this._marketRegime,
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
    const equity = this.config.equity || '0';
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
    if (!this._basePrice || !this._gridSpacing) return;

    const rangeOffset = multiply(this._gridSpacing, String(this._gridLevelCount));
    const upperBound = add(this._basePrice, rangeOffset);
    const lowerBound = subtract(this._basePrice, rangeOffset);

    const isOutside =
      isGreaterThan(price, upperBound) || isLessThan(price, lowerBound);

    if (isOutside && !this._outOfRangeStartTime) {
      this._outOfRangeStartTime = new Date();
    } else if (!isOutside) {
      this._outOfRangeStartTime = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Self-register with the strategy registry
// ---------------------------------------------------------------------------
const registry = require('../services/strategyRegistry');
registry.register('GridStrategy', GridStrategy);

module.exports = GridStrategy;
