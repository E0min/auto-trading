'use strict';

/**
 * BollingerReversionStrategy — BB(20,2) + RSI(14) + Stochastic(14,3) mean reversion
 * with split entries (up to 3 entries: 40%, 30%, 30%).
 *
 * Bidirectional (Long & Short) on 5-minute candles.
 *
 * Entry Long:
 *   - Prev close < BB lower AND current close > BB lower (re-entry into band)
 *   - RSI crosses above 30 from below
 *   - Stochastic %K crosses above %D in oversold zone (<= 20)
 *   - Bandwidth > 2%
 *   - Regime: RANGING or VOLATILE
 *
 * Entry Short:
 *   - Prev close > BB upper AND current close < BB upper
 *   - RSI crosses below 70 from above
 *   - Stochastic %K crosses below %D in overbought zone (>= 80)
 *   - Bandwidth > 2%
 *   - Regime: RANGING or VOLATILE
 *
 * Exit:
 *   - BB middle → half profit (50%)
 *   - BB opposite band → full profit (remaining 50%)
 *   - SL: -4% from average entry price
 *
 * Trending filter:
 *   - No short during TRENDING_UP
 *   - No long during TRENDING_DOWN
 *
 * Leverage: 3x, max position: 5% of equity
 */

const StrategyBase = require('../../services/strategyBase');
const {
  SIGNAL_ACTIONS,
  MARKET_REGIMES,
} = require('../../utils/constants');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../../utils/mathUtils');
const { createLogger } = require('../../utils/logger');

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
// BollingerReversionStrategy
// ==========================================================================

class BollingerReversionStrategy extends StrategyBase {
  static metadata = {
    name: 'BollingerReversionStrategy',
    description: '볼린저밴드 역추세 + RSI + 스토캐스틱 (분할매수)',
    defaultConfig: {
      bbPeriod: 20,
      bbStdDev: 2,
      rsiPeriod: 14,
      stochPeriod: 14,
      stochSmooth: 3,
      positionSizePercent: '5',
      tpPercent: '4',
      slPercent: '4',
      maxEntries: 3,
    },
  };

  /**
   * @param {object} config
   * @param {number} [config.bbPeriod=20]
   * @param {number} [config.bbStdDev=2]
   * @param {number} [config.rsiPeriod=14]
   * @param {number} [config.stochPeriod=14]
   * @param {number} [config.stochSmooth=3]
   * @param {string} [config.positionSizePercent='5']
   * @param {string} [config.tpPercent='4']
   * @param {string} [config.slPercent='4']
   * @param {number} [config.maxEntries=3]
   */
  constructor(config = {}) {
    const merged = { ...BollingerReversionStrategy.metadata.defaultConfig, ...config };
    super('BollingerReversionStrategy', merged);

    this._log = createLogger('BollingerReversionStrategy');

    // Internal state ----------------------------------------------------------

    /** @type {string[]} close prices as Strings */
    this.priceHistory = [];
    /** @type {string[]} high prices as Strings (for stochastic) */
    this._highHistory = [];
    /** @type {string[]} low prices as Strings (for stochastic) */
    this._lowHistory = [];

    /** @type {string|null} previous candle close */
    this._prevClose = null;
    /** @type {string|null} previous RSI value */
    this._prevRsi = null;
    /** @type {string|null} previous Stochastic %K */
    this._prevStochK = null;
    /** @type {string|null} previous Stochastic %D */
    this._prevStochD = null;

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;
    /** @type {string|null} latest ticker price */
    this._latestPrice = null;
    /** @type {string|null} average entry price for current position */
    this._entryPrice = null;
    /** @type {number} number of entries made into current position (0-3) */
    this._entryCount = 0;
    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;
    /** @type {boolean} whether half profit has been taken */
    this._halfProfitTaken = false;

    /** @type {string[]} raw %K values for smoothing into %D */
    this._rawStochKValues = [];

    // Maximum number of prices we keep in memory
    this._maxHistory = Math.max(merged.bbPeriod, merged.rsiPeriod, merged.stochPeriod) + merged.stochSmooth + 10;
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check TP/SL if position is open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }

    // Check TP/SL only when we have a position
    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const { slPercent, positionSizePercent } = this.config;
    const price = this._latestPrice;
    const entry = this._entryPrice;

    // --- Stop Loss check (-4% from average entry) ---
    if (this._positionSide === 'long') {
      const slPrice = subtract(entry, multiply(entry, divide(slPercent, '100')));
      if (isLessThan(price, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss',
          marketContext: { entryPrice: entry, currentPrice: price, slPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    } else if (this._positionSide === 'short') {
      const slPrice = add(entry, multiply(entry, divide(slPercent, '100')));
      if (isGreaterThan(price, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss',
          marketContext: { entryPrice: entry, currentPrice: price, slPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { close: string, high: string, low: string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    // 1. Record previous close before pushing new one (for crossover detection)
    const prevClose = this.priceHistory.length > 0
      ? this.priceHistory[this.priceHistory.length - 1]
      : null;

    // Push close, high, low to their respective histories and trim
    this.priceHistory.push(close);
    this._highHistory.push(high);
    this._lowHistory.push(low);

    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }
    if (this._highHistory.length > this._maxHistory) {
      this._highHistory = this._highHistory.slice(-this._maxHistory);
    }
    if (this._lowHistory.length > this._maxHistory) {
      this._lowHistory = this._lowHistory.slice(-this._maxHistory);
    }

    const {
      bbPeriod,
      bbStdDev,
      rsiPeriod,
      stochPeriod,
      stochSmooth,
      positionSizePercent,
      maxEntries,
    } = this.config;

    // Need enough data for all indicators
    const minRequired = Math.max(bbPeriod, rsiPeriod + 1, stochPeriod + stochSmooth);
    if (this.priceHistory.length < minRequired) {
      this._log.debug('Not enough data yet', {
        have: this.priceHistory.length,
        need: minRequired,
      });
      return;
    }

    // 2. Calculate Bollinger Bands (20, 2) ------------------------------------
    const bb = this._calculateBB(bbPeriod, bbStdDev);
    const { upper, middle, lower, bandwidth } = bb;

    // 3. Calculate RSI (14) ---------------------------------------------------
    const rsi = this._calculateRsi(rsiPeriod);

    // 4. Calculate Stochastic (14, 3) -----------------------------------------
    const stoch = this._calculateStochastic(stochPeriod, stochSmooth, close);
    if (stoch === null) {
      this._prevClose = prevClose;
      this._prevRsi = rsi;
      return;
    }
    const { k: stochK, d: stochD } = stoch;

    // 5. Crossover detection --------------------------------------------------
    const prevRsi = this._prevRsi;
    const prevStochK = this._prevStochK;
    const prevStochD = this._prevStochD;

    const regime = this._marketRegime;
    const price = close;

    const marketContext = {
      upper,
      middle,
      lower,
      bandwidth,
      rsi,
      stochK,
      stochD,
      price,
      regime,
    };

    let signal = null;

    // --- TP check for open position on kline (BB middle / BB opposite band) ---
    if (this._entryPrice !== null && this._positionSide !== null) {
      signal = this._checkTakeProfit(price, middle, upper, lower, positionSizePercent, marketContext);
      if (signal) {
        this._lastSignal = signal;
        this.emitSignal(signal);
        // Update previous values before returning
        this._prevClose = prevClose;
        this._prevRsi = rsi;
        this._prevStochK = stochK;
        this._prevStochD = stochD;
        return;
      }
    }

    // --- Entry conditions ---
    // Need previous values for crossover detection
    if (prevClose === null || prevRsi === null || prevStochK === null || prevStochD === null) {
      this._prevClose = prevClose;
      this._prevRsi = rsi;
      this._prevStochK = stochK;
      this._prevStochD = stochD;
      return;
    }

    // Bandwidth must be > 2%
    const bandwidthSufficient = isGreaterThan(bandwidth, '2');

    // OPEN_LONG conditions:
    //   - prev close < BB lower AND current close > BB lower (re-entry)
    //   - RSI crosses above 30 (prev RSI <= 30, current RSI > 30)
    //   - Stochastic %K crosses above %D in oversold zone (prev %K <= %D, current %K > %D, zone <= 20)
    //   - Bandwidth > 2%
    //   - Regime: RANGING or VOLATILE
    //   - Not TRENDING_DOWN (no long during TRENDING_DOWN)
    if (
      bandwidthSufficient &&
      isLessThan(prevClose, lower) &&
      isGreaterThan(close, lower) &&
      !isGreaterThan(prevRsi, '30') && isGreaterThan(rsi, '30') &&
      !isGreaterThan(prevStochK, prevStochD) && isGreaterThan(stochK, stochD) &&
      !isGreaterThan(prevStochK, '20') &&
      regime !== MARKET_REGIMES.TRENDING_DOWN &&
      (regime === null || regime === MARKET_REGIMES.RANGING || regime === MARKET_REGIMES.VOLATILE) &&
      (this._positionSide === null || this._positionSide === 'long') &&
      this._entryCount < maxEntries
    ) {
      const entryNumber = this._entryCount + 1;
      const sizePercent = this._getSplitSize(entryNumber, positionSizePercent);
      const confidence = this._calcConfidence(rsi, stochK, bandwidth);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: price,
        confidence,
        leverage: '3',
        entryNumber,
        maxEntries,
        marketContext,
      };

      this._updateEntry(price, 'long');
    }
    // OPEN_SHORT conditions:
    //   - prev close > BB upper AND current close < BB upper (re-entry)
    //   - RSI crosses below 70 (prev RSI >= 70, current RSI < 70)
    //   - Stochastic %K crosses below %D in overbought zone (prev %K >= %D, current %K < %D, zone >= 80)
    //   - Bandwidth > 2%
    //   - Regime: RANGING or VOLATILE
    //   - Not TRENDING_UP (no short during TRENDING_UP)
    else if (
      bandwidthSufficient &&
      isGreaterThan(prevClose, upper) &&
      isLessThan(close, upper) &&
      !isLessThan(prevRsi, '70') && isLessThan(rsi, '70') &&
      !isLessThan(prevStochK, prevStochD) && isLessThan(stochK, stochD) &&
      !isLessThan(prevStochK, '80') &&
      regime !== MARKET_REGIMES.TRENDING_UP &&
      (regime === null || regime === MARKET_REGIMES.RANGING || regime === MARKET_REGIMES.VOLATILE) &&
      (this._positionSide === null || this._positionSide === 'short') &&
      this._entryCount < maxEntries
    ) {
      const entryNumber = this._entryCount + 1;
      const sizePercent = this._getSplitSize(entryNumber, positionSizePercent);
      const confidence = this._calcConfidence(rsi, stochK, bandwidth);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: price,
        confidence,
        leverage: '3',
        entryNumber,
        maxEntries,
        marketContext,
      };

      this._updateEntry(price, 'short');
    }

    // 6. Emit if we have a signal
    if (signal) {
      this._lastSignal = signal;
      this.emitSignal(signal);
    }

    // 7. Update previous values for next candle
    this._prevClose = prevClose;
    this._prevRsi = rsi;
    this._prevStochK = stochK;
    this._prevStochD = stochD;
  }

  // --------------------------------------------------------------------------
  // onFill — handle fill events to update position state
  // --------------------------------------------------------------------------

  /**
   * Called when an order fill is received.
   * Updates position tracking when an open or close signal is filled.
   *
   * @param {object} fill
   */
  onFill(fill) {
    if (!this._active) return;
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      this._positionSide = 'long';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      if (this._entryCount === 0) this._entryCount = 1;
      this._log.trade('Long fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._positionSide = 'short';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      if (this._entryCount === 0) this._entryCount = 1;
      this._log.trade('Short fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      this._log.trade('Position closed via fill', { side: this._positionSide, symbol: this._symbol });
      this._resetPosition();
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
  // Private helpers — Bollinger Bands
  // --------------------------------------------------------------------------

  /**
   * Calculate Bollinger Bands.
   *
   * @param {number} period  — SMA period (default 20)
   * @param {number} numStdDev — number of standard deviations (default 2)
   * @returns {{ upper: string, middle: string, lower: string, bandwidth: string }}
   */
  _calculateBB(period, numStdDev) {
    const slice = this.priceHistory.slice(-period);
    const middle = mean(slice);
    const sd = stdDev(slice, middle);

    const bandWidth = multiply(String(numStdDev), sd);
    const upper = add(middle, bandWidth);
    const lower = subtract(middle, bandWidth);

    // Bandwidth = (upper - lower) / middle * 100
    const diff = subtract(upper, lower);
    const bandwidth = isGreaterThan(middle, '0')
      ? toFixed(multiply(divide(diff, middle), '100'), 4)
      : '0';

    return { upper, middle, lower, bandwidth };
  }

  // --------------------------------------------------------------------------
  // Private helpers — RSI
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

  // --------------------------------------------------------------------------
  // Private helpers — Stochastic
  // --------------------------------------------------------------------------

  /**
   * Calculate Stochastic %K and %D.
   *
   * %K = (close - lowestLow(period)) / (highestHigh(period) - lowestLow(period)) * 100
   * %D = SMA(%K, smooth)
   *
   * @param {number} period — lookback period for highest high / lowest low
   * @param {number} smooth — smoothing period for %D (SMA of %K)
   * @param {string} close  — current close price
   * @returns {{ k: string, d: string }|null} — null if not enough data for %D
   */
  _calculateStochastic(period, smooth, close) {
    const highSlice = this._highHistory.slice(-period);
    const lowSlice = this._lowHistory.slice(-period);

    if (highSlice.length < period || lowSlice.length < period) {
      return null;
    }

    // Find highest high and lowest low over the period
    let highestHigh = highSlice[0];
    for (let i = 1; i < highSlice.length; i++) {
      if (isGreaterThan(highSlice[i], highestHigh)) {
        highestHigh = highSlice[i];
      }
    }

    let lowestLow = lowSlice[0];
    for (let i = 1; i < lowSlice.length; i++) {
      if (isLessThan(lowSlice[i], lowestLow)) {
        lowestLow = lowSlice[i];
      }
    }

    // %K = (close - lowestLow) / (highestHigh - lowestLow) * 100
    const range = subtract(highestHigh, lowestLow);
    let rawK;
    if (!isGreaterThan(range, '0')) {
      rawK = '50'; // If high == low, neutral
    } else {
      rawK = toFixed(multiply(divide(subtract(close, lowestLow), range), '100'), 4);
    }

    // Accumulate raw %K values for %D smoothing
    this._rawStochKValues.push(rawK);
    if (this._rawStochKValues.length > this._maxHistory) {
      this._rawStochKValues = this._rawStochKValues.slice(-this._maxHistory);
    }

    // %D = SMA of last `smooth` %K values
    if (this._rawStochKValues.length < smooth) {
      return null;
    }

    const kSlice = this._rawStochKValues.slice(-smooth);
    const d = mean(kSlice);

    return { k: rawK, d: toFixed(d, 4) };
  }

  // --------------------------------------------------------------------------
  // Private helpers — Take Profit
  // --------------------------------------------------------------------------

  /**
   * Check take-profit conditions based on BB levels.
   *
   * @param {string} price
   * @param {string} middle — BB middle band
   * @param {string} upper  — BB upper band
   * @param {string} lower  — BB lower band
   * @param {string} positionSizePercent
   * @param {object} marketContext
   * @returns {object|null} signal or null
   */
  _checkTakeProfit(price, middle, upper, lower, positionSizePercent, marketContext) {
    if (this._positionSide === 'long') {
      // Half profit at BB middle
      if (!this._halfProfitTaken && isGreaterThan(price, middle)) {
        this._halfProfitTaken = true;
        const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
        return {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: halfQty,
          suggestedPrice: price,
          confidence: toFixed('0.7500', 4),
          reason: 'half_profit_bb_middle',
          marketContext,
        };
      }
      // Full profit at BB upper (opposite band)
      if (this._halfProfitTaken && isGreaterThan(price, upper)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          confidence: toFixed('0.8500', 4),
          reason: 'full_profit_bb_opposite',
          marketContext,
        };
        this._resetPosition();
        return signal;
      }
    } else if (this._positionSide === 'short') {
      // Half profit at BB middle
      if (!this._halfProfitTaken && isLessThan(price, middle)) {
        this._halfProfitTaken = true;
        const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
        return {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: halfQty,
          suggestedPrice: price,
          confidence: toFixed('0.7500', 4),
          reason: 'half_profit_bb_middle',
          marketContext,
        };
      }
      // Full profit at BB lower (opposite band)
      if (this._halfProfitTaken && isLessThan(price, lower)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          confidence: toFixed('0.8500', 4),
          reason: 'full_profit_bb_opposite',
          marketContext,
        };
        this._resetPosition();
        return signal;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Private helpers — Split Entry
  // --------------------------------------------------------------------------

  /**
   * Get the position size for a given entry number (split entry: 40%, 30%, 30%).
   *
   * @param {number} entryNumber — 1, 2, or 3
   * @param {string} totalSizePercent — total max position size
   * @returns {string} size for this entry as percentage
   */
  _getSplitSize(entryNumber, totalSizePercent) {
    const ratios = ['0.40', '0.30', '0.30'];
    const ratio = ratios[entryNumber - 1] || '0.30';
    return toFixed(multiply(totalSizePercent, ratio), 4);
  }

  /**
   * Update the average entry price and entry count after a new entry.
   *
   * @param {string} price — entry price
   * @param {'long'|'short'} side — position direction
   */
  _updateEntry(price, side) {
    if (this._entryCount === 0) {
      this._entryPrice = price;
      this._positionSide = side;
      this._halfProfitTaken = false;
    } else {
      // Weighted average: existing entries' total weight vs new entry weight
      const prevWeight = this._getSplitCumulativeWeight(this._entryCount);
      const newWeight = this._getSplitWeight(this._entryCount + 1);
      const totalWeight = add(prevWeight, newWeight);

      // avgEntry = (prevAvg * prevWeight + newPrice * newWeight) / totalWeight
      const prevPart = multiply(this._entryPrice, prevWeight);
      const newPart = multiply(price, newWeight);
      this._entryPrice = divide(add(prevPart, newPart), totalWeight);
    }
    this._entryCount += 1;
  }

  /**
   * Get the weight for a specific entry number.
   * @param {number} entryNumber — 1, 2, or 3
   * @returns {string}
   */
  _getSplitWeight(entryNumber) {
    const weights = ['0.40', '0.30', '0.30'];
    return weights[entryNumber - 1] || '0.30';
  }

  /**
   * Get the cumulative weight for entries 1..n.
   * @param {number} n — number of entries already made
   * @returns {string}
   */
  _getSplitCumulativeWeight(n) {
    const weights = ['0.40', '0.30', '0.30'];
    let total = '0';
    for (let i = 0; i < n && i < weights.length; i++) {
      total = add(total, weights[i]);
    }
    return total;
  }

  /**
   * Reset position tracking state after full exit.
   */
  _resetPosition() {
    this._entryPrice = null;
    this._entryCount = 0;
    this._positionSide = null;
    this._halfProfitTaken = false;
  }

  // --------------------------------------------------------------------------
  // Private helpers — Confidence
  // --------------------------------------------------------------------------

  /**
   * Calculate a confidence score based on RSI extremity, stochastic position,
   * and bandwidth.
   *
   * @param {string} rsi
   * @param {string} stochK
   * @param {string} bandwidth
   * @returns {string} confidence 0.00-1.00
   */
  _calcConfidence(rsi, stochK, bandwidth) {
    const rsiVal = parseFloat(rsi);
    const stochVal = parseFloat(stochK);
    const bwVal = parseFloat(bandwidth);

    // RSI component: further from 50 = higher confidence (0-0.4)
    const rsiDistance = Math.abs(rsiVal - 50) / 50;
    const rsiScore = rsiDistance * 0.4;

    // Stochastic component: further from 50 = higher confidence (0-0.3)
    const stochDistance = Math.abs(stochVal - 50) / 50;
    const stochScore = stochDistance * 0.3;

    // Bandwidth component: wider band = more room for reversion (0-0.3)
    // Normalize: 2% = 0, 8%+ = max
    const bwNormalized = Math.min(Math.max((bwVal - 2) / 6, 0), 1);
    const bwScore = bwNormalized * 0.3;

    const confidence = Math.min(0.3 + rsiScore + stochScore + bwScore, 1);
    return toFixed(String(confidence), 4);
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('BollingerReversionStrategy', BollingerReversionStrategy);

module.exports = BollingerReversionStrategy;
