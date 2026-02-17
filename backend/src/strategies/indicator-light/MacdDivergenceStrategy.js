'use strict';

/**
 * MacdDivergenceStrategy — MACD 다이버전스 역추세 전략
 *
 * 가격과 MACD 히스토그램 사이의 다이버전스를 감지하여 추세 전환을 포착한다.
 *
 * - 양방향 (Long & Short)
 * - 롱: 상승 다이버전스 AND 히스토그램 영점 상향 돌파 AND RSI < 45
 * - 숏: 하락 다이버전스 AND 히스토그램 영점 하향 돌파 AND RSI > 55
 * - TP: EMA(50) 도달, SL: 스윙 저/고점 (최대 2.5*ATR)
 * - 트레일링: 1*ATR 수익 후 1.5*ATR 간격으로 추적
 * - 실패 감지: 진입 후 5캔들 이내 히스토그램 방향 반전 시 즉시 청산
 * - 레버리지: 2x, 포지션 비중 2% (역추세 = 보수적)
 *
 * All price values are Strings; arithmetic via mathUtils.
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
  abs,
} = require('../../utils/mathUtils');
const {
  findPivots,
  detectDivergence,
} = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

class MacdDivergenceStrategy extends StrategyBase {
  // -------------------------------------------------------------------------
  // Static metadata
  // -------------------------------------------------------------------------

  static metadata = {
    name: 'MacdDivergenceStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile', 'ranging'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 120000,
    gracePeriodMs: 300000,
    warmupCandles: 35,
    volatilityPreference: 'neutral',
    trailingStop: { enabled: false, activationPercent: '1.0', callbackPercent: '0.8' },
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
  }

  // -------------------------------------------------------------------------
  // Per-symbol state (SymbolState pattern)
  // -------------------------------------------------------------------------

  /**
   * @override
   * @returns {object} default per-symbol state
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      prevHistogram: '0',
      candlesSinceEntry: 0,
      entryHistogramSign: 0,
      trailingActive: false,
      trailingStopPrice: null,
      trailingDistance: null,
      highestSinceEntry: null,
      lowestSinceEntry: null,
      slPrice: null,
    };
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

    this._s().latestPrice = String(ticker.lastPrice);

    // No position open — nothing to check
    if (this._s().entryPrice === null || this._s().positionSide === null) return;

    const price = this._s().latestPrice;

    // Check hard SL
    if (this._s().positionSide === 'long' && this._s().slPrice) {
      if (isLessThan(price, this._s().slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'stop_loss', '0.9500');
        return;
      }
    } else if (this._s().positionSide === 'short' && this._s().slPrice) {
      if (isGreaterThan(price, this._s().slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'stop_loss', '0.9500');
        return;
      }
    }

    // Check trailing stop
    if (this._s().trailingActive && this._s().trailingStopPrice) {
      if (this._s().positionSide === 'long') {
        // Update highest since entry
        if (isGreaterThan(price, this._s().highestSinceEntry)) {
          this._s().highestSinceEntry = price;
          this._s().trailingStopPrice = subtract(
            this._s().highestSinceEntry,
            this._s().trailingDistance,
          );
        }
        if (isLessThan(price, this._s().trailingStopPrice)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'trailing_stop', '0.8500');
          return;
        }
      } else if (this._s().positionSide === 'short') {
        // Update lowest since entry
        if (isLessThan(price, this._s().lowestSinceEntry)) {
          this._s().lowestSinceEntry = price;
          this._s().trailingStopPrice = add(
            this._s().lowestSinceEntry,
            this._s().trailingDistance,
          );
        }
        if (isGreaterThan(price, this._s().trailingStopPrice)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'trailing_stop', '0.8500');
          return;
        }
      }
    }

    // Update highest/lowest since entry
    if (this._s().positionSide === 'long' && this._s().highestSinceEntry) {
      if (isGreaterThan(price, this._s().highestSinceEntry)) {
        this._s().highestSinceEntry = price;
      }
    } else if (this._s().positionSide === 'short' && this._s().lowestSinceEntry) {
      if (isLessThan(price, this._s().lowestSinceEntry)) {
        this._s().lowestSinceEntry = price;
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

    // 1. Need enough data ---------------------------------------------------
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

    const c = this._indicatorCache;
    const hist = c.getHistory(this.getCurrentSymbol());
    const minRequired = macdSlow + macdSignal + pivotLeftBars + pivotRightBars + 5;
    if (!hist || hist.closes.length < minRequired) {
      this._log.debug('Not enough data yet', {
        have: hist ? hist.closes.length : 0,
        need: minRequired,
      });
      return;
    }

    // 2. Compute indicators via cache ---------------------------------------
    const histogramArray = c.get(this.getCurrentSymbol(), 'macdHistogram', { fast: macdFast, slow: macdSlow, signal: macdSignal });
    if (!histogramArray || histogramArray.length === 0) return;

    const currentHistogram = histogramArray[histogramArray.length - 1];
    const rsiValue = c.get(this.getCurrentSymbol(), 'rsi', { period: rsiPeriod });
    const atrValue = c.get(this.getCurrentSymbol(), 'atr', { period: atrPeriod });
    const ema50 = c.get(this.getCurrentSymbol(), 'ema', { period: emaTpPeriod });

    if (rsiValue === null || atrValue === null) return;

    // 3. If position is open ------------------------------------------------
    if (this._s().entryPrice !== null && this._s().positionSide !== null) {
      this._s().candlesSinceEntry += 1;

      // 3a. Failure check: histogram reverses direction within N candles
      if (this._s().candlesSinceEntry <= maxCandlesForFailure) {
        const currentSign = isGreaterThan(currentHistogram, '0') ? 1 : -1;
        if (this._s().entryHistogramSign !== 0 && currentSign !== this._s().entryHistogramSign) {
          this._log.trade('Failure exit — histogram reversed within maxCandlesForFailure', {
            candlesSinceEntry: this._s().candlesSinceEntry,
            entryHistogramSign: this._s().entryHistogramSign,
            currentHistogram,
          });

          const closeAction = this._s().positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          this._emitClose(closeAction, 'histogram_reversal_failure', '0.9000');
          return;
        }
      }

      // 3b. Take-profit check: price reaches EMA(50)
      if (ema50 !== null) {
        if (this._s().positionSide === 'long' && isGreaterThan(close, ema50)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'tp_ema50', '0.8000');
          return;
        }
        if (this._s().positionSide === 'short' && isLessThan(close, ema50)) {
          this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'tp_ema50', '0.8000');
          return;
        }
      }

      // 3c. Activate trailing stop if profit > 1*ATR
      if (!this._s().trailingActive && atrValue !== null) {
        const activationDistance = multiply(trailingActivationAtr, atrValue);
        this._s().trailingDistance = multiply(trailingDistanceAtr, atrValue);

        if (this._s().positionSide === 'long') {
          const profit = subtract(close, this._s().entryPrice);
          if (isGreaterThan(profit, activationDistance)) {
            this._s().trailingActive = true;
            this._s().highestSinceEntry = close;
            this._s().trailingStopPrice = subtract(close, this._s().trailingDistance);
            this._log.trade('Trailing stop activated (long)', {
              trailingStopPrice: this._s().trailingStopPrice,
            });
          }
        } else if (this._s().positionSide === 'short') {
          const profit = subtract(this._s().entryPrice, close);
          if (isGreaterThan(profit, activationDistance)) {
            this._s().trailingActive = true;
            this._s().lowestSinceEntry = close;
            this._s().trailingStopPrice = add(close, this._s().trailingDistance);
            this._log.trade('Trailing stop activated (short)', {
              trailingStopPrice: this._s().trailingStopPrice,
            });
          }
        }
      }

      // Store previous histogram for next candle
      this._s().prevHistogram = currentHistogram;
      return;
    }

    // 4. No position — check for new entry signal ---------------------------
    const regime = this.getEffectiveRegime();
    const prevHist = this._s().prevHistogram;

    // Build pivot data for divergence detection
    const pricePivots = findPivots(hist.closes, pivotLeftBars, pivotRightBars);
    const histPivots = findPivots(histogramArray, pivotLeftBars, pivotRightBars);

    let signal = null;

    // ---- Long entry (bullish divergence) ----
    // 1. Bullish divergence: price lower low + MACD histogram higher low
    // 2. Histogram crosses from negative to positive
    // 3. RSI < 40
    // 4. Regime: TRENDING_DOWN or VOLATILE
    const bullishDiv = detectDivergence(pricePivots.lows, histPivots.lows, 'bullish');
    const histCrossUp = isLessThan(prevHist, '0') && !isLessThan(currentHistogram, '0');
    const rsiBelow45 = isLessThan(rsiValue, '45');
    const regimeLong = regime === null || regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE || regime === MARKET_REGIMES.RANGING;

    if (bullishDiv && histCrossUp && rsiBelow45 && regimeLong) {
      // Calculate SL from recent swing low, capped at slAtrMult * ATR
      const swingLow = this._findRecentSwingLow(pivotLeftBars);
      const maxSlDistance = multiply(slAtrMult, atrValue);
      const rawSlDistance = subtract(close, swingLow);
      const slDistance = isGreaterThan(rawSlDistance, maxSlDistance) ? maxSlDistance : rawSlDistance;
      const slPrice = subtract(close, slDistance);

      const confidence = this._calcConfidence(rsiValue, currentHistogram, bullishDiv);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        stopLossPrice: slPrice,
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

      this._s().entryPrice = close;
      this._s().positionSide = 'long';
      this._s().slPrice = slPrice;
      this._s().candlesSinceEntry = 0;
      this._s().entryHistogramSign = 1;
      this._s().trailingActive = false;
      this._s().trailingStopPrice = null;
      this._s().highestSinceEntry = close;
      this._s().lowestSinceEntry = close;
      this._s().trailingDistance = multiply(trailingDistanceAtr, atrValue);

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
      const rsiAbove55 = isGreaterThan(rsiValue, '55');
      const regimeShort = regime === null || regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE || regime === MARKET_REGIMES.RANGING;

      if (bearishDiv && histCrossDown && rsiAbove55 && regimeShort) {
        // Calculate SL from recent swing high, capped at slAtrMult * ATR
        const swingHigh = this._findRecentSwingHigh(pivotLeftBars);
        const maxSlDistance = multiply(slAtrMult, atrValue);
        const rawSlDistance = subtract(swingHigh, close);
        const slDistance = isGreaterThan(rawSlDistance, maxSlDistance) ? maxSlDistance : rawSlDistance;
        const slPrice = add(close, slDistance);

        const confidence = this._calcConfidence(rsiValue, currentHistogram, bearishDiv);

        signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          stopLossPrice: slPrice,
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

        this._s().entryPrice = close;
        this._s().positionSide = 'short';
        this._s().slPrice = slPrice;
        this._s().candlesSinceEntry = 0;
        this._s().entryHistogramSign = -1;
        this._s().trailingActive = false;
        this._s().trailingStopPrice = null;
        this._s().highestSinceEntry = close;
        this._s().lowestSinceEntry = close;
        this._s().trailingDistance = multiply(trailingDistanceAtr, atrValue);

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
      this._s().lastSignal = signal;
      this.emitSignal(signal);
    }

    // Store previous histogram for next candle
    this._s().prevHistogram = currentHistogram;
  }

  // -------------------------------------------------------------------------
  // onFill — record entry / exit
  // -------------------------------------------------------------------------

  /**
   * @param {object} fill — { side, price, action, ... }
   */
  onFill(fill) {
    super.onFill(fill); // R10: update StrategyBase trailing stop state
    if (!fill) return;

    const price = fill.price !== undefined ? String(fill.price) : null;
    if (price === null) return;

    if (fill.side === 'buy' && this._s().positionSide === 'long' && this._s().entryPrice !== null) {
      this._s().entryPrice = price;
      this._log.trade('Long entry fill recorded', { entryPrice: price });
    } else if (fill.side === 'sell' && this._s().positionSide === 'short' && this._s().entryPrice !== null) {
      this._s().entryPrice = price;
      this._log.trade('Short entry fill recorded', { entryPrice: price });
    }

    // Position closed
    if (
      (fill.side === 'sell' && this._s().positionSide === 'long') ||
      (fill.side === 'buy' && this._s().positionSide === 'short')
    ) {
      this._log.trade('Position closed via fill', {
        side: this._s().positionSide,
        entryPrice: this._s().entryPrice,
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
    return this._s().lastSignal;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Find the most recent swing low from cache history.
   *
   * @param {number} lookback — number of bars to look back
   * @returns {string} — swing low price
   */
  _findRecentSwingLow(lookback) {
    const hist = this._indicatorCache.getHistory(this.getCurrentSymbol());
    const lows = hist ? hist.lows : [];
    if (lows.length === 0) return this._s().latestPrice || '0';

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
   * Find the most recent swing high from cache history.
   *
   * @param {number} lookback — number of bars to look back
   * @returns {string} — swing high price
   */
  _findRecentSwingHigh(lookback) {
    const hist = this._indicatorCache.getHistory(this.getCurrentSymbol());
    const highs = hist ? hist.highs : [];
    if (highs.length === 0) return this._s().latestPrice || '0';

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
    const regime = this.getEffectiveRegime();
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
    const price = this._s().latestPrice || '0';

    const signal = {
      action,
      symbol: this.getCurrentSymbol(),
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      reduceOnly: true,
      confidence,
      reason,
      marketContext: {
        entryPrice: this._s().entryPrice,
        exitPrice: price,
        positionSide: this._s().positionSide,
        candlesSinceEntry: this._s().candlesSinceEntry,
        trailingActive: this._s().trailingActive,
        regime: this.getEffectiveRegime(),
      },
    };

    this._s().lastSignal = signal;
    this.emitSignal(signal);
    this._resetPosition();
  }

  /**
   * Reset all position tracking state.
   */
  _resetPosition() {
    this._s().entryPrice = null;
    this._s().positionSide = null;
    this._s().slPrice = null;
    this._s().candlesSinceEntry = 0;
    this._s().entryHistogramSign = 0;
    this._s().trailingActive = false;
    this._s().trailingStopPrice = null;
    this._s().trailingDistance = null;
    this._s().highestSinceEntry = null;
    this._s().lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the strategy registry
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('MacdDivergenceStrategy', MacdDivergenceStrategy);

module.exports = MacdDivergenceStrategy;
