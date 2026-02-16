'use strict';

/**
 * FibonacciRetracementStrategy — Pure Price-Action Fibonacci Retracement
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, RANGING
 * Core concept: Identifies significant swing highs/lows, computes Fibonacci
 * retracement levels, and enters on bounces from the golden zone (0.382-0.618).
 *
 * Fibonacci Levels (from swing range):
 *   - Retracement: 0.236, 0.382, 0.500, 0.618, 0.786
 *   - Extension:   1.272, 1.618 (take-profit targets)
 *
 * Swing Detection:
 *   - Scans last swingPeriod bars for the most significant high/low
 *   - Upswing (bullish):   swing low precedes swing high chronologically
 *   - Downswing (bearish): swing high precedes swing low
 *   - Minimum swing size: minSwingAtr x ATR
 *
 * Entry Long:  upswing + price in golden zone + bullish candle + above 0.786
 * Entry Short: downswing + price in golden zone + bearish candle + below 0.786
 *
 * Exit Long:  TP1 = swing high (50%), TP2 = 1.272 ext, SL = 0.786 - buffer
 * Exit Short: TP1 = swing low (50%),  TP2 = 1.272 ext, SL = 0.786 + buffer
 * Trailing:   activated after TP1 hit, trails at trailingDistanceAtr x ATR
 */

const StrategyBase = require('../../services/strategyBase');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
  abs,
  max: mathMax,
  min: mathMin,
} = require('../../utils/mathUtils');
const { atr } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('FibonacciRetracementStrategy');

class FibonacciRetracementStrategy extends StrategyBase {
  static metadata = {
    name: 'FibonacciRetracementStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'ranging'],
    riskLevel: 'low',
    maxConcurrentPositions: 2,
    cooldownMs: 180000,
    gracePeriodMs: 600000,
    warmupCandles: 30,
    volatilityPreference: 'neutral',
    description: '피보나치 되돌림 — 골든 존(0.382-0.618) 바운스 + ATR 기반 리스크 관리',
    defaultConfig: {
      swingPeriod: 50,              // Lookback bars for swing detection
      atrPeriod: 14,                // ATR calculation period
      minSwingAtr: '3',             // Minimum swing size in ATR multiples
      fibEntryLow: '0.382',         // Lower bound of golden zone
      fibEntryHigh: '0.618',        // Upper bound of golden zone
      fibInvalidation: '0.786',     // Invalidation / stop level
      fibExtension: '1.272',        // TP2 extension target
      slBuffer: '0.5',              // ATR multiplier beyond invalidation level
      trailingActivationAtr: '2',   // Activate trailing after reclaiming swing extreme
      trailingDistanceAtr: '2',     // Trail distance in ATR multiples
      positionSizePercent: '3',     // Position size as % of equity
      leverage: '2',
    },
  };

  /** @param {object} config — strategy configuration overrides */
  constructor(config = {}) {
    const merged = { ...FibonacciRetracementStrategy.metadata.defaultConfig, ...config };
    super('FibonacciRetracementStrategy', merged);

    // ---- Internal state ----
    /** @type {Array<{high:string, low:string, close:string, open:string}>} */
    this.klineHistory = [];
    /** @type {string|null} latest ticker price */
    this._latestPrice = null;
    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;
    /** @type {string|null} entry price */
    this._entryPrice = null;
    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;
    /** @type {string|null} stop loss price */
    this._stopPrice = null;
    /** @type {string|null} TP1 — swing extreme */
    this._tp1Price = null;
    /** @type {string|null} TP2 — 1.272 extension */
    this._tp2Price = null;
    /** @type {boolean} whether TP1 partial (50%) exit has been taken */
    this._partialTaken = false;
    /** @type {boolean} trailing stop activated */
    this._trailingActive = false;
    /** @type {string|null} trailing stop price */
    this._trailingStopPrice = null;
    /** @type {string|null} highest price since entry (long) */
    this._highestSinceEntry = null;
    /** @type {string|null} lowest price since entry (short) */
    this._lowestSinceEntry = null;
    /** @type {string|null} latest ATR value */
    this._latestAtr = null;
    /** @type {{ price: string, index: number }|null} */
    this._swingHigh = null;
    /** @type {{ price: string, index: number }|null} */
    this._swingLow = null;
    /** @type {'up'|'down'|null} current swing direction */
    this._swingDirection = null;
    /** @type {object|null} computed Fibonacci levels */
    this._fibLevels = null;
    /** @type {number} max kline data points to keep */
    this._maxHistory = 200;
  }

  // --------------------------------------------------------------------------
  // Swing detection
  // --------------------------------------------------------------------------

  /**
   * Find the most significant swing high and low within the swingPeriod
   * lookback window. Direction is determined by chronological order:
   *   - low before high → 'up' (bullish)
   *   - high before low → 'down' (bearish)
   *
   * @returns {{ swingHigh: {price:string,index:number}|null, swingLow: {price:string,index:number}|null, direction: 'up'|'down'|null }}
   */
  _findSignificantSwing() {
    const { swingPeriod } = this.config;
    const len = this.klineHistory.length;
    if (len < swingPeriod) {
      return { swingHigh: null, swingLow: null, direction: null };
    }

    const startIdx = len - swingPeriod;
    let highestPrice = this.klineHistory[startIdx].high;
    let highestIdx = startIdx;
    let lowestPrice = this.klineHistory[startIdx].low;
    let lowestIdx = startIdx;

    for (let i = startIdx + 1; i < len; i++) {
      const bar = this.klineHistory[i];
      if (isGreaterThan(bar.high, highestPrice)) {
        highestPrice = bar.high;
        highestIdx = i;
      }
      if (isLessThan(bar.low, lowestPrice)) {
        lowestPrice = bar.low;
        lowestIdx = i;
      }
    }

    const swingHigh = { price: highestPrice, index: highestIdx };
    const swingLow = { price: lowestPrice, index: lowestIdx };

    let direction = null;
    if (lowestIdx < highestIdx) direction = 'up';
    else if (highestIdx < lowestIdx) direction = 'down';

    return { swingHigh, swingLow, direction };
  }

  // --------------------------------------------------------------------------
  // Fibonacci level computation
  // --------------------------------------------------------------------------

  /**
   * Compute all Fibonacci retracement and extension levels.
   *
   * Bullish (upswing): retracement measured from high downward.
   *   fib_0.382 = high - 0.382 × range
   * Bearish (downswing): retracement measured from low upward.
   *   fib_0.382 = low + 0.382 × range
   *
   * @param {string} swingHighPrice
   * @param {string} swingLowPrice
   * @param {'up'|'down'} direction
   * @returns {object} all computed fib levels
   */
  _computeFibLevels(swingHighPrice, swingLowPrice, direction) {
    const range = subtract(swingHighPrice, swingLowPrice);
    const fibRatios = ['0.236', '0.382', '0.500', '0.618', '0.786'];
    const extRatios = ['1.272', '1.618'];
    const levels = {};

    if (direction === 'up') {
      for (const r of fibRatios) levels[`fib_${r}`] = subtract(swingHighPrice, multiply(r, range));
      for (const r of extRatios) levels[`ext_${r}`] = add(swingLowPrice, multiply(r, range));
    } else {
      for (const r of fibRatios) levels[`fib_${r}`] = add(swingLowPrice, multiply(r, range));
      for (const r of extRatios) levels[`ext_${r}`] = subtract(swingHighPrice, multiply(r, range));
    }

    levels.swingHigh = swingHighPrice;
    levels.swingLow = swingLowPrice;
    levels.range = range;
    levels.direction = direction;
    return levels;
  }

  // --------------------------------------------------------------------------
  // Golden zone check
  // --------------------------------------------------------------------------

  /**
   * Check if price is within the 0.382–0.618 golden zone.
   * Uses mathMin/mathMax to handle both directions uniformly.
   *
   * @param {string} price
   * @param {'up'|'down'} direction
   * @returns {boolean}
   */
  _isInGoldenZone(price, direction) {
    if (!this._fibLevels) return false;
    const fib382 = this._fibLevels['fib_0.382'];
    const fib618 = this._fibLevels['fib_0.618'];
    const zoneLow = mathMin(fib382, fib618);
    const zoneHigh = mathMax(fib382, fib618);
    return !isLessThan(price, zoneLow) && !isGreaterThan(price, zoneHigh);
  }

  // --------------------------------------------------------------------------
  // Confidence calculation
  // --------------------------------------------------------------------------

  /**
   * Signal confidence based on fib proximity and regime alignment.
   *
   * Base: 0.55
   * Fib bonus: 0.618 → +0.20 | 0.500 → +0.15 | 0.382 → +0.10
   * Regime bonus: trending in favour → +0.10
   *
   * @param {string} price
   * @param {'up'|'down'} direction
   * @returns {number} 0.50–1.00
   */
  _calcConfidence(price, direction) {
    let conf = 0.55;
    if (!this._fibLevels) return conf;

    const dist382 = parseFloat(abs(subtract(price, this._fibLevels['fib_0.382'])));
    const dist500 = parseFloat(abs(subtract(price, this._fibLevels['fib_0.500'])));
    const dist618 = parseFloat(abs(subtract(price, this._fibLevels['fib_0.618'])));
    const minDist = Math.min(dist382, dist500, dist618);

    if (minDist === dist618) conf += 0.20;
    else if (minDist === dist500) conf += 0.15;
    else conf += 0.10;

    const regime = this.getEffectiveRegime();
    if (direction === 'up' && regime === MARKET_REGIMES.TRENDING_UP) conf += 0.10;
    else if (direction === 'down' && regime === MARKET_REGIMES.TRENDING_DOWN) conf += 0.10;

    return Math.min(conf, 1.0);
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / TP / trailing stop checks
  // --------------------------------------------------------------------------

  /**
   * Real-time exit checks on every ticker update:
   *   1. Hard stop loss (0.786 level +/- slBuffer × ATR)
   *   2. TP2 full exit (1.272 extension)
   *   3. TP1 partial exit (50% at swing extreme), activates trailing
   *   4. Trailing stop ratchet check
   *
   * @param {object} ticker — { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;
    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }
    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const price = this._latestPrice;

    // --- Hard stop loss ---
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'fib_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice, fibLevels: this._fibLevels,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'fib_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice, fibLevels: this._fibLevels,
        });
        this._resetPosition();
        return;
      }
    }

    // --- TP2: full exit at 1.272 extension ---
    if (this._tp2Price !== null) {
      if (this._positionSide === 'long' && isGreaterThan(price, this._tp2Price)) {
        this._emitCloseSignal('long', price, 'fib_tp2_extension', {
          entryPrice: this._entryPrice, tp2Price: this._tp2Price,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isLessThan(price, this._tp2Price)) {
        this._emitCloseSignal('short', price, 'fib_tp2_extension', {
          entryPrice: this._entryPrice, tp2Price: this._tp2Price,
        });
        this._resetPosition();
        return;
      }
    }

    // --- TP1: partial exit (50%) at swing extreme ---
    if (this._tp1Price !== null && !this._partialTaken) {
      if (this._positionSide === 'long' && isGreaterThan(price, this._tp1Price)) {
        this._emitCloseSignal('long', price, 'fib_tp1_swing_high', {
          entryPrice: this._entryPrice, tp1Price: this._tp1Price, partialPercent: '50',
        });
        this._partialTaken = true;
        this._trailingActive = true;
        this._highestSinceEntry = price;
        this._updateTrailingStop();
        log.info('TP1 hit, trailing activated (long)', {
          symbol: this._symbol, trailingStop: this._trailingStopPrice,
        });
        return;
      }
      if (this._positionSide === 'short' && isLessThan(price, this._tp1Price)) {
        this._emitCloseSignal('short', price, 'fib_tp1_swing_low', {
          entryPrice: this._entryPrice, tp1Price: this._tp1Price, partialPercent: '50',
        });
        this._partialTaken = true;
        this._trailingActive = true;
        this._lowestSinceEntry = price;
        this._updateTrailingStop();
        log.info('TP1 hit, trailing activated (short)', {
          symbol: this._symbol, trailingStop: this._trailingStopPrice,
        });
        return;
      }
    }

    // --- Trailing stop ---
    if (this._trailingActive && this._trailingStopPrice !== null) {
      if (this._positionSide === 'long') {
        if (this._highestSinceEntry === null || isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'fib_trailing_stop', {
            entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      } else if (this._positionSide === 'short') {
        if (this._lowestSinceEntry === null || isLessThan(price, this._lowestSinceEntry)) {
          this._lowestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isGreaterThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('short', price, 'fib_trailing_stop', {
            entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * Kline handler — entry signal generation workflow:
   *   1. Push kline data and trim history
   *   2. Compute ATR
   *   3. Position open → update extreme trackers, skip entries
   *   4. No position → find swings, compute fib, check golden zone bounce
   *
   * @param {object} kline — { high, low, close, open }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;

    // 1. Push and trim
    this.klineHistory.push({ high, low, close, open });
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // 2. Minimum data check
    const { swingPeriod, atrPeriod } = this.config;
    const minRequired = Math.max(swingPeriod, atrPeriod + 1);
    if (this.klineHistory.length < minRequired) {
      log.debug('Not enough data', { have: this.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(this.klineHistory, atrPeriod);
    if (currentAtr === null) return;
    this._latestAtr = currentAtr;

    // 4. Position open: update extreme trackers only
    if (this._positionSide !== null && this._entryPrice !== null) {
      if (this._positionSide === 'long') {
        if (this._highestSinceEntry === null || isGreaterThan(high, this._highestSinceEntry)) {
          this._highestSinceEntry = high;
          if (this._trailingActive) this._updateTrailingStop();
        }
      } else {
        if (this._lowestSinceEntry === null || isLessThan(low, this._lowestSinceEntry)) {
          this._lowestSinceEntry = low;
          if (this._trailingActive) this._updateTrailingStop();
        }
      }
      return; // No new entries while position open
    }

    // 5. No position — swing detection and fib bounce check

    // 5a. Find significant swings
    const { swingHigh, swingLow, direction } = this._findSignificantSwing();
    if (!swingHigh || !swingLow || direction === null) {
      log.debug('No valid swing', { swingHigh, swingLow, direction });
      return;
    }

    // 5b. Validate swing size (>= minSwingAtr × ATR)
    const swingRange = subtract(swingHigh.price, swingLow.price);
    const minSwingSize = multiply(this.config.minSwingAtr, currentAtr);
    if (isLessThan(swingRange, minSwingSize)) {
      log.debug('Swing too small', { swingRange, minSwingSize, atr: currentAtr });
      return;
    }

    // 5c. Update state and compute fib levels
    this._swingHigh = swingHigh;
    this._swingLow = swingLow;
    this._swingDirection = direction;
    this._fibLevels = this._computeFibLevels(swingHigh.price, swingLow.price, direction);

    const regime = this.getEffectiveRegime();
    const price = close;
    const { positionSizePercent, slBuffer, fibInvalidation } = this.config;

    // 5d. Bullish fib bounce → long entry
    if (direction === 'up') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_UP ||
        regime === MARKET_REGIMES.RANGING;
      if (!regimeOk) return;
      if (!this._isInGoldenZone(price, direction)) return;
      if (!isGreaterThan(close, open)) return; // Bullish candle required

      const fib786 = this._fibLevels[`fib_${fibInvalidation}`];
      if (isLessThan(low, fib786)) return; // Invalidated

      const slDistance = multiply(slBuffer, currentAtr);
      const slPrice = subtract(fib786, slDistance);
      const riskPerUnit = subtract(price, slPrice);
      const tp1 = this._fibLevels.swingHigh;
      const tp2 = this._fibLevels['ext_1.272'];
      const conf = this._calcConfidence(price, direction);

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: slPrice,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'fib_golden_zone_bounce_long',
        marketContext: {
          swingHigh: swingHigh.price, swingLow: swingLow.price,
          swingDirection: direction, fibLevels: this._fibLevels,
          tp1, tp2, slPrice, atr: currentAtr, riskPerUnit, regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'long';
      this._stopPrice = slPrice;
      this._tp1Price = tp1;
      this._tp2Price = tp2;
      this._partialTaken = false;
      this._highestSinceEntry = high;
      this._lowestSinceEntry = null;
      this._trailingActive = false;
      this._trailingStopPrice = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // 5e. Bearish fib bounce → short entry
    if (direction === 'down') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_DOWN ||
        regime === MARKET_REGIMES.RANGING;
      if (!regimeOk) return;
      if (!this._isInGoldenZone(price, direction)) return;
      if (!isLessThan(close, open)) return; // Bearish candle required

      const fib786 = this._fibLevels[`fib_${fibInvalidation}`];
      if (isGreaterThan(high, fib786)) return; // Invalidated

      const slDistance = multiply(slBuffer, currentAtr);
      const slPrice = add(fib786, slDistance);
      const riskPerUnit = subtract(slPrice, price);
      const tp1 = this._fibLevels.swingLow;
      const tp2 = this._fibLevels['ext_1.272'];
      const conf = this._calcConfidence(price, direction);

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: slPrice,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'fib_golden_zone_bounce_short',
        marketContext: {
          swingHigh: swingHigh.price, swingLow: swingLow.price,
          swingDirection: direction, fibLevels: this._fibLevels,
          tp1, tp2, slPrice, atr: currentAtr, riskPerUnit, regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'short';
      this._stopPrice = slPrice;
      this._tp1Price = tp1;
      this._tp2Price = tp2;
      this._partialTaken = false;
      this._highestSinceEntry = null;
      this._lowestSinceEntry = low;
      this._trailingActive = false;
      this._trailingStopPrice = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // --------------------------------------------------------------------------
  // onFill
  // --------------------------------------------------------------------------

  /** @param {object} fill — fill data from the exchange */
  onFill(fill) {
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      this._positionSide = 'long';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      log.trade('Long fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._positionSide = 'short';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      log.trade('Short fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: this._positionSide, symbol: this._symbol });
      this._resetPosition();
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  /** @returns {object|null} most recent signal */
  getSignal() {
    return this._lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a close signal.
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} reason
   * @param {object} context
   */
  _emitCloseSignal(side, price, reason, context) {
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      reduceOnly: true,
      confidence: toFixed('0.9000', 4),
      reason,
      marketContext: { ...context, currentPrice: price, atr: this._latestAtr },
    };
    this._lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price. Ratchets only — longs move up, shorts down.
   */
  _updateTrailingStop() {
    if (this._latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, this._latestAtr);

    if (this._positionSide === 'long' && this._highestSinceEntry !== null) {
      const newStop = subtract(this._highestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isGreaterThan(newStop, this._trailingStopPrice)) {
        this._trailingStopPrice = newStop;
      }
    } else if (this._positionSide === 'short' && this._lowestSinceEntry !== null) {
      const newStop = add(this._lowestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isLessThan(newStop, this._trailingStopPrice)) {
        this._trailingStopPrice = newStop;
      }
    }
  }

  /**
   * Reset all position-tracking state after a full exit.
   */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._stopPrice = null;
    this._tp1Price = null;
    this._tp2Price = null;
    this._partialTaken = false;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('FibonacciRetracementStrategy', FibonacciRetracementStrategy);

module.exports = FibonacciRetracementStrategy;
