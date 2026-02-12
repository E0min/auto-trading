'use strict';

/**
 * MacdDivergenceStrategy — MACD 다이버전스 역추세 전략
 *
 * 가격과 MACD 히스토그램 사이의 다이버전스를 감지하여 추세 전환을 포착한다.
 *
 * - 양방향 (Long & Short)
 * - 롱: 상승 다이버전스 + 히스토그램 영점 상향 돌파 + RSI < 40
 * - 숏: 하락 다이버전스 + 히스토그램 영점 하향 돌파 + RSI > 60
 * - TP: EMA(50) 도달, SL: 스윙 저/고점 (최대 2.5*ATR)
 * - 트레일링: 1*ATR 수익 후 1.5*ATR 간격으로 추적
 * - 실패 감지: 진입 후 5캔들 이내 히스토그램 방향 반전 시 즉시 청산
 * - 레버리지: 2x, 포지션 비중 2% (역추세 = 보수적)
 *
 * All price values are Strings; arithmetic via mathUtils.
 */

const StrategyBase = require('../services/strategyBase');
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
  abs,
} = require('../utils/mathUtils');
const {
  rsi,
  atr,
  macdHistogramArray,
  emaFromArray,
  findPivots,
  detectDivergence,
} = require('../utils/indicators');
const { createLogger } = require('../utils/logger');

class MacdDivergenceStrategy extends StrategyBase {
  // -------------------------------------------------------------------------
  // Static metadata
  // -------------------------------------------------------------------------

  static metadata = {
    name: 'MacdDivergenceStrategy',
    description: 'MACD 다이버전스 역추세 전략',
    defaultConfig: {
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      rsiPeriod: 14,
      atrPeriod: 14,
      emaTpPeriod: 50,
      pivotLeftBars: 3,
      pivotRightBars: 3,
      positionSizePercent: '2',
      leverage: '2',
      slAtrMult: '2.5',
      trailingActivationAtr: '1',
      trailingDistanceAtr: '1.5',
      maxCandlesForFailure: 5,
    },
  };

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * @param {object} config — strategy configuration (merged with defaults)
   */
  constructor(config = {}) {
    const merged = { ...MacdDivergenceStrategy.metadata.defaultConfig, ...config };
    super('MacdDivergenceStrategy', merged);

    this._log = createLogger('MacdDivergenceStrategy');

    // Internal state --------------------------------------------------------

    /** @type {string[]} close prices as Strings */
    this.priceHistory = [];

    /** @type {Array<{high:string, low:string, close:string}>} kline data for ATR */
    this.klineHistory = [];

    /** @type {string[]} high prices as Strings */
    this._highHistory = [];

    /** @type {string[]} low prices as Strings */
    this._lowHistory = [];

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {string|null} entry price of current position */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;

    /** @type {string} previous MACD histogram value for crossover detection */
    this._prevHistogram = '0';

    /** @type {number} candles elapsed since entry */
    this._candlesSinceEntry = 0;

    /** @type {number} sign of histogram at entry: 1 = positive, -1 = negative */
    this._entryHistogramSign = 0;

    /** @type {boolean} whether trailing stop is active */
    this._trailingActive = false;

    /** @type {string|null} current trailing stop price */
    this._trailingStopPrice = null;

    /** @type {string|null} highest price since entry (for long trailing) */
    this._highestSinceEntry = null;

    /** @type {string|null} lowest price since entry (for short trailing) */
    this._lowestSinceEntry = null;

    /** Maximum number of close prices kept in memory */
    this._maxHistory = 100;
  }

  // -------------------------------------------------------------------------
  // onTick — real-time ticker updates
  // -------------------------------------------------------------------------

  /**
   * Store the latest price and, if a position is open, check SL and
   * trailing stop conditions in real-time.
   *
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (!ticker || ticker.lastPrice === undefined) return;

    this._latestPrice = String(ticker.lastPrice);

    // No position open — nothing to check
    if (this._entryPrice === null || this._positionSide === null) return;

    const price = this._latestPrice;

    // Check hard SL
    if (this._positionSide === 'long' && this._slPrice) {
      if (isLessThan(price, this._slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'stop_loss', '0.9500');
        return;
      }
    } else if (this._positionSide === 'short' && this._slPrice) {
      if (isGreaterThan(price, this._slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'stop_loss', '0.9500');
        return;
      }
    }

    // Check trailing stop
    if (this._trailingActive && this._trailingStopPrice) {
      if (this._positionSide === 'long') {
        // Update highest since entry
        if (isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price;
          this._trailingStopPrice = subtract(
            this._highestSinceEntry,
            this._trailingDistance,
          );
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'trailing_stop', '0.8500');
          return;
        }
      } else if (this._positionSide === 'short') {
        // Update lowest since entry
        if (isLessThan(price, this._lowestSinceEntry)) {
          this._lowestSinceEntry = price;
          this._trailingStopPrice = add(
            this._lowestSinceEntry,
            this._trailingDistance,
          );
        }
        if (isGreaterThan(price, this._trailingStopPrice)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'trailing_stop', '0.8500');
          return;
        }
      }
    }

    // Update highest/lowest since entry
    if (this._positionSide === 'long' && this._highestSinceEntry) {
      if (isGreaterThan(price, this._highestSinceEntry)) {
        this._highestSinceEntry = price;
      }
    } else if (this._positionSide === 'short' && this._lowestSinceEntry) {
      if (isLessThan(price, this._lowestSinceEntry)) {
        this._lowestSinceEntry = price;
      }
    }
  }

  // -------------------------------------------------------------------------
  // onKline — main signal logic
  // -------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { close: string, high?: string, low?: string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    // 1. Push data to histories and trim ------------------------------------
    this.priceHistory.push(close);
    this._highHistory.push(high);
    this._lowHistory.push(low);
    this.klineHistory.push({ high, low, close });

    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }
    if (this._highHistory.length > this._maxHistory) {
      this._highHistory = this._highHistory.slice(-this._maxHistory);
    }
    if (this._lowHistory.length > this._maxHistory) {
      this._lowHistory = this._lowHistory.slice(-this._maxHistory);
    }
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data ---------------------------------------------------
    const {
      macdFast,
      macdSlow,
      macdSignal,
      rsiPeriod,
      atrPeriod,
      emaTpPeriod,
      pivotLeftBars,
      pivotRightBars,
      maxCandlesForFailure,
      positionSizePercent,
      slAtrMult,
      trailingActivationAtr,
      trailingDistanceAtr,
    } = this.config;

    const minRequired = macdSlow + macdSignal + pivotLeftBars + pivotRightBars + 5;
    if (this.priceHistory.length < minRequired) {
      this._log.debug('Not enough data yet', {
        have: this.priceHistory.length,
        need: minRequired,
      });
      return;
    }

    // 3. Compute indicators -------------------------------------------------
    const histogramArray = macdHistogramArray(this.priceHistory, macdFast, macdSlow, macdSignal);
    if (histogramArray.length === 0) return;

    const currentHistogram = histogramArray[histogramArray.length - 1];
    const rsiValue = rsi(this.priceHistory, rsiPeriod);
    const atrValue = atr(this.klineHistory, atrPeriod);
    const ema50 = emaFromArray(this.priceHistory, emaTpPeriod);

    if (rsiValue === null || atrValue === null) return;

    // 4. If position is open ------------------------------------------------
    if (this._entryPrice !== null && this._positionSide !== null) {
      this._candlesSinceEntry += 1;

      // 4a. Failure check: histogram reverses direction within N candles
      if (this._candlesSinceEntry <= maxCandlesForFailure) {
        const currentSign = isGreaterThan(currentHistogram, '0') ? 1 : -1;
        if (this._entryHistogramSign !== 0 && currentSign !== this._entryHistogramSign) {
          this._log.trade('Failure exit — histogram reversed within maxCandlesForFailure', {
            candlesSinceEntry: this._candlesSinceEntry,
            entryHistogramSign: this._entryHistogramSign,
            currentHistogram,
          });

          const closeAction = this._positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          this._emitClose(closeAction, 'histogram_reversal_failure', '0.9000');
          return;
        }
      }

      // 4b. Take-profit check: price reaches EMA(50)
      if (ema50 !== null) {
        if (this._positionSide === 'long' && isGreaterThan(close, ema50)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'tp_ema50', '0.8000');
          return;
        }
        if (this._positionSide === 'short' && isLessThan(close, ema50)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'tp_ema50', '0.8000');
          return;
        }
      }

      // 4c. Activate trailing stop if profit > 1*ATR
      if (!this._trailingActive && atrValue !== null) {
        const activationDistance = multiply(trailingActivationAtr, atrValue);
        this._trailingDistance = multiply(trailingDistanceAtr, atrValue);

        if (this._positionSide === 'long') {
          const profit = subtract(close, this._entryPrice);
          if (isGreaterThan(profit, activationDistance)) {
            this._trailingActive = true;
            this._highestSinceEntry = close;
            this._trailingStopPrice = subtract(close, this._trailingDistance);
            this._log.trade('Trailing stop activated (long)', {
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        } else if (this._positionSide === 'short') {
          const profit = subtract(this._entryPrice, close);
          if (isGreaterThan(profit, activationDistance)) {
            this._trailingActive = true;
            this._lowestSinceEntry = close;
            this._trailingStopPrice = add(close, this._trailingDistance);
            this._log.trade('Trailing stop activated (short)', {
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        }
      }

      // Store previous histogram for next candle
      this._prevHistogram = currentHistogram;
      return;
    }

    // 5. No position — check for new entry signal ---------------------------
    const regime = this._marketRegime;
    const prevHist = this._prevHistogram;

    // Build pivot data for divergence detection
    const pricePivots = findPivots(this.priceHistory, pivotLeftBars, pivotRightBars);
    const histPivots = findPivots(histogramArray, pivotLeftBars, pivotRightBars);

    let signal = null;

    // ---- Long entry (bullish divergence) ----
    // 1. Bullish divergence: price lower low + MACD histogram higher low
    // 2. Histogram crosses from negative to positive
    // 3. RSI < 40
    // 4. Regime: TRENDING_DOWN or VOLATILE
    const bullishDiv = detectDivergence(pricePivots.lows, histPivots.lows, 'bullish');
    const histCrossUp = isLessThan(prevHist, '0') && !isLessThan(currentHistogram, '0');
    const rsiBelow40 = isLessThan(rsiValue, '40');
    const regimeLong = regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE;

    if (bullishDiv && histCrossUp && rsiBelow40 && regimeLong) {
      // Calculate SL from recent swing low, capped at slAtrMult * ATR
      const swingLow = this._findRecentSwingLow(pivotLeftBars);
      const maxSlDistance = multiply(slAtrMult, atrValue);
      const rawSlDistance = subtract(close, swingLow);
      const slDistance = isGreaterThan(rawSlDistance, maxSlDistance) ? maxSlDistance : rawSlDistance;
      const slPrice = subtract(close, slDistance);

      const confidence = this._calcConfidence(rsiValue, currentHistogram, bullishDiv);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        confidence: toFixed(String(confidence), 4),
        leverage: this.config.leverage,
        reason: 'macd_bullish_divergence',
        marketContext: {
          macdHistogram: currentHistogram,
          rsi: rsiValue,
          divergenceType: 'bullish',
          regime,
          atr: atrValue,
          ema50: ema50,
          slPrice,
        },
      };

      this._entryPrice = close;
      this._positionSide = 'long';
      this._slPrice = slPrice;
      this._candlesSinceEntry = 0;
      this._entryHistogramSign = 1;
      this._trailingActive = false;
      this._trailingStopPrice = null;
      this._highestSinceEntry = close;
      this._lowestSinceEntry = close;
      this._trailingDistance = multiply(trailingDistanceAtr, atrValue);

      this._log.trade('Bullish divergence entry', {
        price: close,
        slPrice,
        rsi: rsiValue,
        histogram: currentHistogram,
      });
    }

    // ---- Short entry (bearish divergence) ----
    // 1. Bearish divergence: price higher high + MACD histogram lower high
    // 2. Histogram crosses from positive to negative
    // 3. RSI > 60
    // 4. Regime: TRENDING_UP or VOLATILE
    if (signal === null) {
      const bearishDiv = detectDivergence(pricePivots.highs, histPivots.highs, 'bearish');
      const histCrossDown = isGreaterThan(prevHist, '0') && !isGreaterThan(currentHistogram, '0');
      const rsiAbove60 = isGreaterThan(rsiValue, '60');
      const regimeShort = regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE;

      if (bearishDiv && histCrossDown && rsiAbove60 && regimeShort) {
        // Calculate SL from recent swing high, capped at slAtrMult * ATR
        const swingHigh = this._findRecentSwingHigh(pivotLeftBars);
        const maxSlDistance = multiply(slAtrMult, atrValue);
        const rawSlDistance = subtract(swingHigh, close);
        const slDistance = isGreaterThan(rawSlDistance, maxSlDistance) ? maxSlDistance : rawSlDistance;
        const slPrice = add(close, slDistance);

        const confidence = this._calcConfidence(rsiValue, currentHistogram, bearishDiv);

        signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence: toFixed(String(confidence), 4),
          leverage: this.config.leverage,
          reason: 'macd_bearish_divergence',
          marketContext: {
            macdHistogram: currentHistogram,
            rsi: rsiValue,
            divergenceType: 'bearish',
            regime,
            atr: atrValue,
            ema50: ema50,
            slPrice,
          },
        };

        this._entryPrice = close;
        this._positionSide = 'short';
        this._slPrice = slPrice;
        this._candlesSinceEntry = 0;
        this._entryHistogramSign = -1;
        this._trailingActive = false;
        this._trailingStopPrice = null;
        this._highestSinceEntry = close;
        this._lowestSinceEntry = close;
        this._trailingDistance = multiply(trailingDistanceAtr, atrValue);

        this._log.trade('Bearish divergence entry', {
          price: close,
          slPrice,
          rsi: rsiValue,
          histogram: currentHistogram,
        });
      }
    }

    // Emit signal if generated
    if (signal) {
      this._lastSignal = signal;
      this.emitSignal(signal);
    }

    // Store previous histogram for next candle
    this._prevHistogram = currentHistogram;
  }

  // -------------------------------------------------------------------------
  // onFill — record entry / exit
  // -------------------------------------------------------------------------

  /**
   * @param {object} fill — { side, price, action, ... }
   */
  onFill(fill) {
    if (!fill) return;

    const price = fill.price !== undefined ? String(fill.price) : null;
    if (price === null) return;

    if (fill.side === 'buy' && this._positionSide === 'long' && this._entryPrice !== null) {
      this._entryPrice = price;
      this._log.trade('Long entry fill recorded', { entryPrice: price });
    } else if (fill.side === 'sell' && this._positionSide === 'short' && this._entryPrice !== null) {
      this._entryPrice = price;
      this._log.trade('Short entry fill recorded', { entryPrice: price });
    }

    // Position closed
    if (
      (fill.side === 'sell' && this._positionSide === 'long') ||
      (fill.side === 'buy' && this._positionSide === 'short')
    ) {
      this._log.trade('Position closed via fill', {
        side: this._positionSide,
        entryPrice: this._entryPrice,
        exitPrice: price,
      });
      this._resetPosition();
    }
  }

  // -------------------------------------------------------------------------
  // getSignal
  // -------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this._lastSignal;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Find the most recent swing low from lowHistory.
   *
   * @param {number} lookback — number of bars to look back
   * @returns {string} — swing low price
   */
  _findRecentSwingLow(lookback) {
    const lows = this._lowHistory;
    if (lows.length === 0) return this._latestPrice || '0';

    const start = Math.max(0, lows.length - lookback * 3);
    let lowest = lows[start];
    for (let i = start + 1; i < lows.length; i++) {
      if (isLessThan(lows[i], lowest)) {
        lowest = lows[i];
      }
    }
    return lowest;
  }

  /**
   * Find the most recent swing high from highHistory.
   *
   * @param {number} lookback — number of bars to look back
   * @returns {string} — swing high price
   */
  _findRecentSwingHigh(lookback) {
    const highs = this._highHistory;
    if (highs.length === 0) return this._latestPrice || '0';

    const start = Math.max(0, highs.length - lookback * 3);
    let highest = highs[start];
    for (let i = start + 1; i < highs.length; i++) {
      if (isGreaterThan(highs[i], highest)) {
        highest = highs[i];
      }
    }
    return highest;
  }

  /**
   * Calculate confidence score based on RSI extremity and histogram strength.
   *
   * @param {string} rsiValue — current RSI
   * @param {string} histogram — current MACD histogram
   * @param {boolean} divergenceDetected — whether divergence was confirmed
   * @returns {number} confidence 0.0-1.0
   */
  _calcConfidence(rsiValue, histogram, divergenceDetected) {
    let score = 0;

    // Divergence confirmed = base confidence (0.3)
    if (divergenceDetected) score += 0.3;

    // RSI extremity component (0-0.3)
    const rsiVal = parseFloat(rsiValue);
    if (rsiVal < 40) {
      // Bullish: lower RSI = more extreme
      const distance = Math.max(0, 40 - rsiVal);
      score += (distance / 40) * 0.3;
    } else if (rsiVal > 60) {
      // Bearish: higher RSI = more extreme
      const distance = Math.max(0, rsiVal - 60);
      score += (distance / 40) * 0.3;
    }

    // Histogram near zero crossing = confirmation (0-0.2)
    const histAbs = parseFloat(abs(histogram));
    // Smaller absolute histogram near zero = stronger crossover confirmation
    const crossoverStrength = Math.max(0, 1 - histAbs * 10);
    score += crossoverStrength * 0.2;

    // Market regime alignment (0.1)
    const regime = this._marketRegime;
    if (regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.TRENDING_UP) {
      score += 0.1;
    } else if (regime === MARKET_REGIMES.VOLATILE) {
      score += 0.05;
    }

    return Math.min(Math.max(score, 0.1), 1.0);
  }

  /**
   * Emit a close signal and reset position state.
   *
   * @param {string} action — SIGNAL_ACTIONS.CLOSE_LONG or CLOSE_SHORT
   * @param {string} reason — exit reason
   * @param {string} confidence — confidence string
   */
  _emitClose(action, reason, confidence) {
    const price = this._latestPrice || '0';

    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      confidence,
      reason,
      marketContext: {
        entryPrice: this._entryPrice,
        exitPrice: price,
        positionSide: this._positionSide,
        candlesSinceEntry: this._candlesSinceEntry,
        trailingActive: this._trailingActive,
        regime: this._marketRegime,
      },
    };

    this._lastSignal = signal;
    this.emitSignal(signal);
    this._resetPosition();
  }

  /**
   * Reset all position tracking state.
   */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._slPrice = null;
    this._candlesSinceEntry = 0;
    this._entryHistogramSign = 0;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._trailingDistance = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the strategy registry
// ---------------------------------------------------------------------------

const registry = require('../services/strategyRegistry');
registry.register('MacdDivergenceStrategy', MacdDivergenceStrategy);

module.exports = MacdDivergenceStrategy;
