'use strict';

/**
 * Shared indicator library — pure functions, all String-based.
 *
 * Every function accepts and returns String values (or arrays of Strings)
 * to maintain the project convention of avoiding floating-point arithmetic
 * on monetary values.  Internally uses mathUtils for all calculations.
 */

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
} = require('./mathUtils');

// ---------------------------------------------------------------------------
// Basic aggregation helpers
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
 * Arithmetic mean of a String array.
 * @param {string[]} arr
 * @returns {string}
 */
function mean(arr) {
  if (arr.length === 0) return '0';
  return divide(sumStrings(arr), String(arr.length));
}

/**
 * Population standard deviation of a String array.
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
  return toFixed(String(Math.sqrt(parseFloat(variance))), 8);
}

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

/**
 * Simple Moving Average over the last `period` values.
 * @param {string[]} prices
 * @param {number}   period
 * @returns {string|null} — null if not enough data
 */
function sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return mean(slice);
}

/**
 * EMA computed from a full array (SMA-seeded).
 * Returns the final EMA value.
 * @param {string[]} prices
 * @param {number}   period
 * @returns {string|null}
 */
function emaFromArray(prices, period) {
  if (prices.length < period) return null;
  // Seed with SMA of first `period` values
  let ema = mean(prices.slice(0, period));
  const k = divide('2', String(period + 1));
  for (let i = period; i < prices.length; i++) {
    ema = emaStep(ema, prices[i], period, k);
  }
  return ema;
}

/**
 * Single incremental EMA step.
 * @param {string} prevEma
 * @param {string} price
 * @param {number} period
 * @param {string} [k] — pre-computed multiplier (2 / (period + 1))
 * @returns {string}
 */
function emaStep(prevEma, price, period, k) {
  if (!k) {
    k = divide('2', String(period + 1));
  }
  // EMA = price * k + prevEma * (1 - k)
  const oneMinusK = subtract('1', k);
  return add(multiply(price, k), multiply(prevEma, oneMinusK));
}

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

/**
 * Relative Strength Index with selectable smoothing method.
 *
 * Default is Wilder's smoothing (exponential), which is the industry standard.
 * Pass `{ smoothing: 'sma' }` in opts to use the legacy Cutler's RSI (SMA-based).
 *
 * @param {string[]} prices — at least period + 1 values
 * @param {number}   period — default 14
 * @param {object}   [opts={}]
 * @param {string}   [opts.smoothing='wilder'] — 'wilder' (default) or 'sma'
 * @returns {string|null} RSI as String (0–100)
 */
function rsi(prices, period = 14, opts = {}) {
  const smoothing = opts.smoothing || 'wilder';

  if (prices.length < period + 1) return null;

  if (smoothing === 'sma') {
    // Legacy Cutler's RSI
    return _rsiCutler(prices, period);
  }

  // --- Wilder's RSI ---
  // 1. Seed with SMA of first period changes
  let avgGain = '0';
  let avgLoss = '0';

  for (let i = 0; i < period; i++) {
    const diff = subtract(prices[i + 1], prices[i]);
    if (isGreaterThan(diff, '0')) {
      avgGain = add(avgGain, diff);
    } else if (isLessThan(diff, '0')) {
      avgLoss = add(avgLoss, abs(diff));
    }
  }

  avgGain = divide(avgGain, String(period));
  avgLoss = divide(avgLoss, String(period));

  // 2. Wilder smoothing over remaining prices
  const pMinus1 = String(period - 1);
  const pStr = String(period);

  for (let i = period + 1; i < prices.length; i++) {
    const diff = subtract(prices[i], prices[i - 1]);
    let currentGain = '0';
    let currentLoss = '0';

    if (isGreaterThan(diff, '0')) {
      currentGain = diff;
    } else if (isLessThan(diff, '0')) {
      currentLoss = abs(diff);
    }

    avgGain = divide(add(multiply(avgGain, pMinus1), currentGain), pStr);
    avgLoss = divide(add(multiply(avgLoss, pMinus1), currentLoss), pStr);
  }

  if (!isGreaterThan(avgLoss, '0')) return '100';
  if (!isGreaterThan(avgGain, '0')) return '0';

  const rs = divide(avgGain, avgLoss);
  const rsiVal = subtract('100', divide('100', add('1', rs)));
  return toFixed(rsiVal, 4);
}

/**
 * Cutler's RSI — SMA-based (legacy implementation).
 * Uses only the last `period` price changes.
 *
 * @param {string[]} prices
 * @param {number}   period
 * @returns {string|null}
 * @private
 */
function _rsiCutler(prices, period) {
  if (prices.length < period + 1) return null;

  const startIdx = prices.length - period - 1;
  let sumGain = '0';
  let sumLoss = '0';

  for (let i = startIdx; i < prices.length - 1; i++) {
    const diff = subtract(prices[i + 1], prices[i]);
    if (isGreaterThan(diff, '0')) {
      sumGain = add(sumGain, diff);
    } else if (isLessThan(diff, '0')) {
      sumLoss = add(sumLoss, abs(diff));
    }
  }

  const avgGain = divide(sumGain, String(period));
  const avgLoss = divide(sumLoss, String(period));

  if (!isGreaterThan(avgLoss, '0')) return '100';
  if (!isGreaterThan(avgGain, '0')) return '0';

  const rs = divide(avgGain, avgLoss);
  const rsiVal = subtract('100', divide('100', add('1', rs)));
  return toFixed(rsiVal, 4);
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

/**
 * Bollinger Bands.
 * @param {string[]} prices
 * @param {number}   period   — default 20
 * @param {number}   numStdDev — default 2
 * @returns {{ upper: string, middle: string, lower: string, bandwidth: string }|null}
 */
function bollingerBands(prices, period = 20, numStdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const middle = mean(slice);
  const sd = stdDev(slice, middle);
  const bandWidth = multiply(String(numStdDev), sd);
  const upper = add(middle, bandWidth);
  const lower = subtract(middle, bandWidth);
  const diff = subtract(upper, lower);
  const bandwidth = isGreaterThan(middle, '0')
    ? toFixed(multiply(divide(diff, middle), '100'), 4)
    : '0';
  return { upper, middle, lower, bandwidth };
}

// ---------------------------------------------------------------------------
// ATR (Average True Range)
// ---------------------------------------------------------------------------

/**
 * ATR from kline history.
 * @param {Array<{high:string, low:string, close:string}>} klines
 * @param {number} period — default 14
 * @returns {string|null}
 */
function atr(klines, period = 14) {
  if (klines.length < period + 1) return null;

  const slice = klines.slice(-(period + 1));
  let sumTr = '0';

  for (let i = 1; i < slice.length; i++) {
    const high = slice[i].high;
    const low = slice[i].low;
    const prevClose = slice[i - 1].close;

    const hl = subtract(high, low);
    const hpc = abs(subtract(high, prevClose));
    const lpc = abs(subtract(low, prevClose));

    const tr = mathMax(hl, mathMax(hpc, lpc));
    sumTr = add(sumTr, tr);
  }

  return divide(sumTr, String(period));
}

// ---------------------------------------------------------------------------
// Stochastic Oscillator
// ---------------------------------------------------------------------------

/**
 * Stochastic %K (raw) and %D (smoothed SMA).
 * @param {string[]} highs
 * @param {string[]} lows
 * @param {string[]} closes
 * @param {number}   period — default 14
 * @param {number}   smooth — %D smoothing, default 3
 * @returns {{ k: string, d: string }|null}
 */
function stochastic(highs, lows, closes, period = 14, smooth = 3) {
  if (highs.length < period + smooth - 1) return null;

  // Compute raw %K for each of the last `smooth` windows
  const rawKs = [];
  for (let s = smooth - 1; s >= 0; s--) {
    const endIdx = highs.length - s;
    const startIdx = endIdx - period;
    if (startIdx < 0) return null;

    const hSlice = highs.slice(startIdx, endIdx);
    const lSlice = lows.slice(startIdx, endIdx);
    const close = closes[endIdx - 1];

    let hh = hSlice[0];
    let ll = lSlice[0];
    for (let i = 1; i < hSlice.length; i++) {
      if (isGreaterThan(hSlice[i], hh)) hh = hSlice[i];
      if (isLessThan(lSlice[i], ll)) ll = lSlice[i];
    }

    const range = subtract(hh, ll);
    const rawK = !isGreaterThan(range, '0')
      ? '50'
      : toFixed(multiply(divide(subtract(close, ll), range), '100'), 4);
    rawKs.push(rawK);
  }

  const k = rawKs[rawKs.length - 1];
  const d = mean(rawKs);
  return { k, d: toFixed(d, 4) };
}

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

/**
 * MACD from close prices.
 * @param {string[]} closes
 * @param {number}   fast   — default 12
 * @param {number}   slow   — default 26
 * @param {number}   signal — default 9
 * @returns {{ macdLine: string, signalLine: string, histogram: string }|null}
 */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;

  const fastEma = emaFromArray(closes, fast);
  const slowEma = emaFromArray(closes, slow);
  if (fastEma === null || slowEma === null) return null;

  // Build MACD line array for signal EMA
  const macdValues = [];
  // We need at least `slow + signal` candles. Build full MACD line history.
  // Compute EMA arrays step by step
  let fEma = mean(closes.slice(0, fast));
  let sEma = mean(closes.slice(0, slow));
  const fk = divide('2', String(fast + 1));
  const sk = divide('2', String(slow + 1));

  for (let i = fast; i < closes.length; i++) {
    fEma = emaStep(fEma, closes[i], fast, fk);
  }

  // Rebuild slow EMA and track MACD values from when slow EMA starts
  sEma = mean(closes.slice(0, slow));
  fEma = mean(closes.slice(0, fast));

  // Advance fast EMA to the point where slow starts
  for (let i = fast; i < slow; i++) {
    fEma = emaStep(fEma, closes[i], fast, fk);
  }

  macdValues.push(subtract(fEma, sEma));

  for (let i = slow; i < closes.length; i++) {
    fEma = emaStep(fEma, closes[i], fast, fk);
    sEma = emaStep(sEma, closes[i], slow, sk);
    macdValues.push(subtract(fEma, sEma));
  }

  if (macdValues.length < signal) return null;

  // Signal line = EMA of MACD values
  const sigEma = emaFromArray(macdValues, signal);
  if (sigEma === null) return null;

  const macdLine = macdValues[macdValues.length - 1];
  const histogram = subtract(macdLine, sigEma);

  return {
    macdLine: toFixed(macdLine, 8),
    signalLine: toFixed(sigEma, 8),
    histogram: toFixed(histogram, 8),
  };
}

/**
 * Build full MACD histogram array (for divergence detection).
 * @param {string[]} closes
 * @param {number}   fast
 * @param {number}   slow
 * @param {number}   signal
 * @returns {string[]} array of histogram values, aligned with closes from index (slow-1)
 */
function macdHistogramArray(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return [];

  const fk = divide('2', String(fast + 1));
  const sk = divide('2', String(slow + 1));
  const sigK = divide('2', String(signal + 1));

  let fEma = mean(closes.slice(0, fast));
  let sEma = mean(closes.slice(0, slow));

  // Advance fast EMA to where slow EMA starts
  for (let i = fast; i < slow; i++) {
    fEma = emaStep(fEma, closes[i], fast, fk);
  }

  const macdValues = [];
  macdValues.push(subtract(fEma, sEma));

  for (let i = slow; i < closes.length; i++) {
    fEma = emaStep(fEma, closes[i], fast, fk);
    sEma = emaStep(sEma, closes[i], slow, sk);
    macdValues.push(subtract(fEma, sEma));
  }

  if (macdValues.length < signal) return [];

  // Build signal EMA
  let sigEma = mean(macdValues.slice(0, signal));
  const histograms = [];
  histograms.push(subtract(macdValues[signal - 1], sigEma));

  for (let i = signal; i < macdValues.length; i++) {
    sigEma = emaStep(sigEma, macdValues[i], signal, sigK);
    histograms.push(subtract(macdValues[i], sigEma));
  }

  return histograms;
}

// ---------------------------------------------------------------------------
// ADX (Average Directional Index)
// ---------------------------------------------------------------------------

/**
 * ADX — measures trend strength (0–100).
 * @param {Array<{high:string, low:string, close:string}>} klines
 * @param {number} period — default 14
 * @returns {string|null}
 */
function adx(klines, period = 14) {
  // Need at least 2*period + 1 klines for stable ADX
  if (klines.length < 2 * period + 1) return null;

  const trValues = [];
  const plusDmValues = [];
  const minusDmValues = [];

  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevHigh = klines[i - 1].high;
    const prevLow = klines[i - 1].low;
    const prevClose = klines[i - 1].close;

    // True Range
    const hl = subtract(high, low);
    const hpc = abs(subtract(high, prevClose));
    const lpc = abs(subtract(low, prevClose));
    trValues.push(mathMax(hl, mathMax(hpc, lpc)));

    // Directional Movement
    const upMove = subtract(high, prevHigh);
    const downMove = subtract(prevLow, low);

    if (isGreaterThan(upMove, downMove) && isGreaterThan(upMove, '0')) {
      plusDmValues.push(upMove);
    } else {
      plusDmValues.push('0');
    }

    if (isGreaterThan(downMove, upMove) && isGreaterThan(downMove, '0')) {
      minusDmValues.push(downMove);
    } else {
      minusDmValues.push('0');
    }
  }

  if (trValues.length < 2 * period) return null;

  // Smoothed TR, +DM, -DM using Wilder's smoothing (first sum, then subtract/add)
  let smoothTr = sumStrings(trValues.slice(0, period));
  let smoothPlusDm = sumStrings(plusDmValues.slice(0, period));
  let smoothMinusDm = sumStrings(minusDmValues.slice(0, period));

  const dxValues = [];

  for (let i = period; i < trValues.length; i++) {
    smoothTr = add(subtract(smoothTr, divide(smoothTr, String(period))), trValues[i]);
    smoothPlusDm = add(subtract(smoothPlusDm, divide(smoothPlusDm, String(period))), plusDmValues[i]);
    smoothMinusDm = add(subtract(smoothMinusDm, divide(smoothMinusDm, String(period))), minusDmValues[i]);

    // +DI and -DI
    const plusDi = isGreaterThan(smoothTr, '0')
      ? multiply(divide(smoothPlusDm, smoothTr), '100')
      : '0';
    const minusDi = isGreaterThan(smoothTr, '0')
      ? multiply(divide(smoothMinusDm, smoothTr), '100')
      : '0';

    // DX = |+DI - -DI| / (+DI + -DI) * 100
    const diSum = add(plusDi, minusDi);
    const diDiff = abs(subtract(plusDi, minusDi));
    const dx = isGreaterThan(diSum, '0')
      ? multiply(divide(diDiff, diSum), '100')
      : '0';
    dxValues.push(dx);
  }

  if (dxValues.length < period) return null;

  // ADX = SMA of last `period` DX values
  const adxSlice = dxValues.slice(-period);
  return toFixed(mean(adxSlice), 4);
}

// ---------------------------------------------------------------------------
// VWAP (Volume-Weighted Average Price)
// ---------------------------------------------------------------------------

/**
 * VWAP from kline history (session-based, caller defines session window).
 * @param {Array<{high:string, low:string, close:string, volume:string}>} klines
 * @returns {string|null}
 */
function vwap(klines) {
  if (klines.length === 0) return null;

  let cumTPV = '0'; // cumulative (typical price * volume)
  let cumVol = '0'; // cumulative volume

  for (const k of klines) {
    // Typical Price = (High + Low + Close) / 3
    const tp = divide(add(add(k.high, k.low), k.close), '3');
    const tpv = multiply(tp, k.volume);
    cumTPV = add(cumTPV, tpv);
    cumVol = add(cumVol, k.volume);
  }

  if (!isGreaterThan(cumVol, '0')) return null;
  return toFixed(divide(cumTPV, cumVol), 8);
}

// ---------------------------------------------------------------------------
// Keltner Channel
// ---------------------------------------------------------------------------

/**
 * Keltner Channel.
 * @param {string[]} closes
 * @param {Array<{high:string, low:string, close:string}>} klines — for ATR
 * @param {number} emaPeriod — default 20
 * @param {number} atrPeriod — default 10
 * @param {number} mult      — ATR multiplier, default 1.5
 * @returns {{ upper: string, middle: string, lower: string }|null}
 */
function keltnerChannel(closes, klines, emaPeriod = 20, atrPeriod = 10, mult = 1.5) {
  const middle = emaFromArray(closes, emaPeriod);
  const atrVal = atr(klines, atrPeriod);
  if (middle === null || atrVal === null) return null;

  const band = multiply(String(mult), atrVal);
  const upper = add(middle, band);
  const lower = subtract(middle, band);
  return { upper, middle, lower };
}

// ---------------------------------------------------------------------------
// Pivot detection (for divergence)
// ---------------------------------------------------------------------------

/**
 * Find pivot highs and lows in a data series.
 * A pivot high at index i means data[i] > all neighbours within leftBars/rightBars.
 * A pivot low at index i means data[i] < all neighbours within leftBars/rightBars.
 *
 * @param {string[]} data
 * @param {number}   leftBars  — bars to look left, default 3
 * @param {number}   rightBars — bars to look right, default 3
 * @returns {{ highs: Array<{index:number, value:string}>, lows: Array<{index:number, value:string}> }}
 */
function findPivots(data, leftBars = 3, rightBars = 3) {
  const highs = [];
  const lows = [];

  for (let i = leftBars; i < data.length - rightBars; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (!isGreaterThan(data[i], data[j])) isHigh = false;
      if (!isLessThan(data[i], data[j])) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) highs.push({ index: i, value: data[i] });
    if (isLow) lows.push({ index: i, value: data[i] });
  }

  return { highs, lows };
}

// ---------------------------------------------------------------------------
// Divergence detection
// ---------------------------------------------------------------------------

/**
 * Detect divergence between price pivots and indicator pivots.
 *
 * Bullish divergence: price makes lower low, indicator makes higher low.
 * Bearish divergence: price makes higher high, indicator makes lower high.
 *
 * @param {Array<{index:number, value:string}>} pricePivots — lows for bullish, highs for bearish
 * @param {Array<{index:number, value:string}>} indicatorPivots — corresponding pivots
 * @param {'bullish'|'bearish'} type
 * @returns {boolean}
 */
function detectDivergence(pricePivots, indicatorPivots, type) {
  if (pricePivots.length < 2 || indicatorPivots.length < 2) return false;

  // Use the last two pivots
  const p1 = pricePivots[pricePivots.length - 2];
  const p2 = pricePivots[pricePivots.length - 1];

  // Find corresponding indicator pivots closest in index
  const i1 = _findClosestPivot(indicatorPivots, p1.index);
  const i2 = _findClosestPivot(indicatorPivots, p2.index);

  if (!i1 || !i2 || i1.index === i2.index) return false;

  if (type === 'bullish') {
    // Price: lower low, Indicator: higher low
    return isLessThan(p2.value, p1.value) && isGreaterThan(i2.value, i1.value);
  } else if (type === 'bearish') {
    // Price: higher high, Indicator: lower high
    return isGreaterThan(p2.value, p1.value) && isLessThan(i2.value, i1.value);
  }

  return false;
}

/**
 * Find the pivot closest to a target index.
 * @param {Array<{index:number, value:string}>} pivots
 * @param {number} targetIndex
 * @returns {{index:number, value:string}|null}
 */
function _findClosestPivot(pivots, targetIndex) {
  if (pivots.length === 0) return null;
  let closest = pivots[0];
  let minDist = Math.abs(pivots[0].index - targetIndex);
  for (let i = 1; i < pivots.length; i++) {
    const dist = Math.abs(pivots[i].index - targetIndex);
    if (dist < minDist) {
      minDist = dist;
      closest = pivots[i];
    }
  }
  return closest;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Basic
  sumStrings,
  mean,
  stdDev,
  // Moving averages
  sma,
  emaFromArray,
  emaStep,
  // Oscillators
  rsi,
  stochastic,
  // Bands
  bollingerBands,
  keltnerChannel,
  // Volatility / Trend
  atr,
  adx,
  macd,
  macdHistogramArray,
  // Volume
  vwap,
  // Pivots / Divergence
  findPivots,
  detectDivergence,
};
