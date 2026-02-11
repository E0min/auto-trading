'use strict';

/**
 * Sample trading strategies demonstrating the StrategyBase contract.
 *
 * 1. MomentumStrategy  — RSI + Trend-following (SMA)
 * 2. MeanReversionStrategy — Bollinger Bands for ranging markets
 *
 * All monetary / price arithmetic uses String-based mathUtils so that
 * floating-point precision is handled consistently across the platform.
 */

const StrategyBase = require('./strategyBase');
const {
  SIGNAL_ACTIONS,
  MARKET_REGIMES,
} = require('../utils/constants');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers — pure functions, all String-based
// ---------------------------------------------------------------------------

/**
 * Sum an array of String numbers.
 * @param {string[]} arr
 * @returns {string}
 */
function sumStrings(arr) {
  let total = '0';
  for (const v of arr) {
    total = add(total, v);
  }
  return total;
}

/**
 * Calculate the arithmetic mean of a String array.
 * @param {string[]} arr
 * @returns {string}
 */
function mean(arr) {
  if (arr.length === 0) return '0';
  return divide(sumStrings(arr), String(arr.length));
}

/**
 * Calculate the population standard deviation of a String array.
 * @param {string[]} arr
 * @param {string}   avg — pre-computed mean
 * @returns {string}
 */
function stdDev(arr, avg) {
  if (arr.length === 0) return '0';

  let sumSqDiff = '0';
  for (const v of arr) {
    const diff = subtract(v, avg);
    const sq = multiply(diff, diff);
    sumSqDiff = add(sumSqDiff, sq);
  }

  const variance = divide(sumSqDiff, String(arr.length));
  // sqrt via native Math, then back to String with 8 decimals
  const varianceNum = parseFloat(variance);
  return toFixed(String(Math.sqrt(varianceNum)), 8);
}

// ==========================================================================
// MomentumStrategy
// ==========================================================================

class MomentumStrategy extends StrategyBase {
  /**
   * @param {object} opts
   * @param {number} [opts.rsiPeriod=14]
   * @param {number} [opts.rsiOverbought=70]
   * @param {number} [opts.rsiOversold=30]
   * @param {number} [opts.trendSmaPeriod=20]
   * @param {string} [opts.positionSizePercent='2']
   */
  constructor({
    rsiPeriod = 14,
    rsiOverbought = 70,
    rsiOversold = 30,
    trendSmaPeriod = 20,
    positionSizePercent = '2',
  } = {}) {
    super('MomentumStrategy', {
      rsiPeriod,
      rsiOverbought,
      rsiOversold,
      trendSmaPeriod,
      positionSizePercent,
    });

    this._log = createLogger('MomentumStrategy');

    // Internal state ----------------------------------------------------------
    /** @type {string[]} close prices as Strings */
    this.priceHistory = [];
    /** @type {string[]} computed RSI values */
    this.rsiValues = [];
    /** @type {string[]} computed SMA values */
    this.smaValues = [];
    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;
    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    // Maximum number of prices we keep in memory
    this._maxHistory = Math.max(rsiPeriod, trendSmaPeriod) + 10;
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, no signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { close: string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    // 1. Add close price to history, trim to max length
    this.priceHistory.push(close);
    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }

    const { rsiPeriod, rsiOverbought, rsiOversold, trendSmaPeriod, positionSizePercent } =
      this.config;

    // Need at least rsiPeriod + 1 prices for RSI, and trendSmaPeriod prices for SMA
    if (this.priceHistory.length < rsiPeriod + 1 || this.priceHistory.length < trendSmaPeriod) {
      this._log.debug('Not enough data yet', {
        have: this.priceHistory.length,
        needRsi: rsiPeriod + 1,
        needSma: trendSmaPeriod,
      });
      return;
    }

    // 2. Calculate RSI -------------------------------------------------------
    const rsi = this._calculateRsi(rsiPeriod);
    this.rsiValues.push(rsi);
    if (this.rsiValues.length > this._maxHistory) {
      this.rsiValues = this.rsiValues.slice(-this._maxHistory);
    }

    // 3. Calculate SMA -------------------------------------------------------
    const sma = this._calculateSma(trendSmaPeriod);
    this.smaValues.push(sma);
    if (this.smaValues.length > this._maxHistory) {
      this.smaValues = this.smaValues.slice(-this._maxHistory);
    }

    // 4. Signal logic --------------------------------------------------------
    const price = close;
    const regime = this._marketRegime;
    const rsiNum = parseFloat(rsi);

    let signal = null;

    // OPEN_LONG: RSI oversold, price above SMA, regime is trending-up or ranging
    if (
      isLessThan(rsi, String(rsiOversold)) &&
      isGreaterThan(price, sma) &&
      (regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.RANGING)
    ) {
      const confidence = this._rsiConfidence(rsiNum, rsiOversold, 'oversold');
      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext: { rsi, sma, price, regime },
      };
    }
    // OPEN_SHORT: RSI overbought, price below SMA, regime is trending-down or ranging
    else if (
      isGreaterThan(rsi, String(rsiOverbought)) &&
      isLessThan(price, sma) &&
      (regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.RANGING)
    ) {
      const confidence = this._rsiConfidence(rsiNum, rsiOverbought, 'overbought');
      signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext: { rsi, sma, price, regime },
      };
    }
    // CLOSE_LONG: RSI > 60 — take-profit zone for longs
    else if (isGreaterThan(rsi, '60')) {
      const confidence = this._rsiConfidence(rsiNum, 60, 'overbought');
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext: { rsi, sma, price, regime },
      };
    }
    // CLOSE_SHORT: RSI < 40 — take-profit zone for shorts
    else if (isLessThan(rsi, '40')) {
      const confidence = this._rsiConfidence(rsiNum, 40, 'oversold');
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext: { rsi, sma, price, regime },
      };
    }

    // 5. Emit if we have a signal
    if (signal) {
      this._lastSignal = signal;
      this.emitSignal(signal);
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this._lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Compute RSI over the last `period` price changes.
   *
   * @param {number} period
   * @returns {string} RSI as a String (0-100)
   */
  _calculateRsi(period) {
    const prices = this.priceHistory;
    const len = prices.length;

    // We need period + 1 prices to get period changes
    const startIdx = len - period - 1;
    let sumGain = '0';
    let sumLoss = '0';

    for (let i = startIdx; i < len - 1; i++) {
      const diff = subtract(prices[i + 1], prices[i]);
      if (isGreaterThan(diff, '0')) {
        sumGain = add(sumGain, diff);
      } else if (isLessThan(diff, '0')) {
        // losses stored as positive values
        sumLoss = add(sumLoss, subtract('0', diff));
      }
    }

    const avgGain = divide(sumGain, String(period));
    const avgLoss = divide(sumLoss, String(period));

    // If avgLoss is zero, RSI = 100
    if (!isGreaterThan(avgLoss, '0')) {
      return '100';
    }

    // If avgGain is zero, RSI = 0
    if (!isGreaterThan(avgGain, '0')) {
      return '0';
    }

    const rs = divide(avgGain, avgLoss);
    // RSI = 100 - (100 / (1 + RS))
    const onePlusRs = add('1', rs);
    const rsiDenom = divide('100', onePlusRs);
    const rsi = subtract('100', rsiDenom);

    return toFixed(rsi, 4);
  }

  /**
   * Compute simple moving average over the last `period` prices.
   *
   * @param {number} period
   * @returns {string}
   */
  _calculateSma(period) {
    const slice = this.priceHistory.slice(-period);
    return mean(slice);
  }

  /**
   * Map RSI extremity to a confidence score between 0 and 1.
   *
   * The further from the threshold, the higher the confidence.
   *
   * @param {number} rsiVal     — current RSI (float)
   * @param {number} threshold  — boundary value (e.g. 30 or 70)
   * @param {'oversold'|'overbought'} direction
   * @returns {string} confidence as String, 0.00-1.00
   */
  _rsiConfidence(rsiVal, threshold, direction) {
    let distance;

    if (direction === 'oversold') {
      // lower RSI = more extreme = higher confidence
      distance = Math.max(0, threshold - rsiVal);
    } else {
      // higher RSI = more extreme = higher confidence
      distance = Math.max(0, rsiVal - threshold);
    }

    // Normalize: 0-30 distance maps to 0.3-1.0 confidence
    const maxDistance = 30;
    const normalized = Math.min(distance / maxDistance, 1);
    const confidence = 0.3 + normalized * 0.7;

    return toFixed(String(Math.min(confidence, 1)), 4);
  }
}

// ==========================================================================
// MeanReversionStrategy
// ==========================================================================

class MeanReversionStrategy extends StrategyBase {
  /**
   * @param {object} opts
   * @param {number} [opts.bbPeriod=20]
   * @param {number} [opts.bbStdDev=2]
   * @param {string} [opts.positionSizePercent='2']
   */
  constructor({
    bbPeriod = 20,
    bbStdDev = 2,
    positionSizePercent = '2',
  } = {}) {
    super('MeanReversionStrategy', {
      bbPeriod,
      bbStdDev,
      positionSizePercent,
    });

    this._log = createLogger('MeanReversionStrategy');

    /** @type {string[]} close prices as Strings */
    this.priceHistory = [];
    /** @type {object|null} most recently generated signal */
    this.lastSignal = null;
    /** @type {string|null} previous close price (for crossover detection) */
    this._prevPrice = null;

    // Maximum history retained
    this._maxHistory = bbPeriod + 10;
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, no signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker
   */
  onTick(ticker) {
    // MeanReversion only processes kline data; onTick is intentionally a no-op.
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { close: string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    // 1. Record the previous price before pushing the new one (for crossover)
    const prevPrice = this.priceHistory.length > 0
      ? this.priceHistory[this.priceHistory.length - 1]
      : null;

    // Add close to history, trim to max length
    this.priceHistory.push(close);
    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }

    const { bbPeriod, bbStdDev, positionSizePercent } = this.config;

    // 2. Need at least bbPeriod prices
    if (this.priceHistory.length < bbPeriod) {
      this._log.debug('Not enough data for Bollinger Bands', {
        have: this.priceHistory.length,
        need: bbPeriod,
      });
      return;
    }

    // 3. Calculate Bollinger Bands -------------------------------------------
    const slice = this.priceHistory.slice(-bbPeriod);
    const middle = mean(slice);
    const sd = stdDev(slice, middle);

    const bandWidth = multiply(String(bbStdDev), sd);
    const upper = add(middle, bandWidth);
    const lower = subtract(middle, bandWidth);

    const price = close;
    const regime = this._marketRegime;

    // 4. Only generate signals in ranging or quiet regimes
    if (
      regime !== null &&
      regime !== MARKET_REGIMES.RANGING &&
      regime !== MARKET_REGIMES.QUIET
    ) {
      this._log.debug('Skipping signal — regime not suitable for mean-reversion', {
        regime,
      });
      return;
    }

    const marketContext = {
      upper,
      middle,
      lower,
      price,
      regime,
    };

    let signal = null;

    // OPEN_LONG: price at or below lower band
    if (isLessThan(price, lower) || price === lower) {
      const confidence = this._bandConfidence(price, lower, middle, 'lower');
      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext,
      };
    }
    // OPEN_SHORT: price at or above upper band
    else if (isGreaterThan(price, upper) || price === upper) {
      const confidence = this._bandConfidence(price, upper, middle, 'upper');
      signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext,
      };
    }
    // CLOSE_LONG: price crosses middle from below
    else if (
      prevPrice !== null &&
      isLessThan(prevPrice, middle) &&
      (isGreaterThan(price, middle) || price === middle)
    ) {
      const confidence = toFixed('0.6000', 4);
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext,
      };
    }
    // CLOSE_SHORT: price crosses middle from above
    else if (
      prevPrice !== null &&
      isGreaterThan(prevPrice, middle) &&
      (isLessThan(price, middle) || price === middle)
    ) {
      const confidence = toFixed('0.6000', 4);
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        confidence,
        marketContext,
      };
    }

    // 5. Emit if we have a signal
    if (signal) {
      this.lastSignal = signal;
      this.emitSignal(signal);
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this.lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate confidence based on how far price has penetrated past a band.
   *
   * @param {string} price  — current price
   * @param {string} band   — the band that was breached (upper or lower)
   * @param {string} middle — the middle band (SMA)
   * @param {'upper'|'lower'} side
   * @returns {string} confidence 0.00-1.00
   */
  _bandConfidence(price, band, middle, side) {
    // Distance from band to middle gives us the normalization base
    const bandToMiddle = parseFloat(subtract(band, middle));
    if (bandToMiddle === 0) return toFixed('0.5000', 4);

    let penetration;
    if (side === 'lower') {
      // How far below the lower band
      penetration = parseFloat(subtract(band, price));
    } else {
      // How far above the upper band
      penetration = parseFloat(subtract(price, band));
    }

    // Normalize: 0 penetration = 0.5 confidence, full band-width penetration = 1.0
    const normalized = Math.min(Math.max(penetration / Math.abs(bandToMiddle), 0), 1);
    const confidence = 0.5 + normalized * 0.5;

    return toFixed(String(Math.min(confidence, 1)), 4);
  }
}

module.exports = {
  MomentumStrategy,
  MeanReversionStrategy,
};
