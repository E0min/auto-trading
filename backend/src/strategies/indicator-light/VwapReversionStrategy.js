'use strict';

/**
 * VwapReversionStrategy — VWAP 회귀 전략
 *
 * When price deviates significantly from VWAP, expect reversion to the mean.
 *
 * Target regimes: RANGING (primary), QUIET (secondary)
 *
 * Entry Long:
 *   - Price is below VWAP - 1.5 * ATR
 *   - RSI(14) < 35
 *   - Volume > Volume SMA(20) * 1.2
 *   - Bullish candle (close > open)
 *
 * Entry Short:
 *   - Price is above VWAP + 1.5 * ATR
 *   - RSI(14) > 65
 *   - Volume > Volume SMA(20) * 1.2
 *   - Bearish candle (close < open)
 *
 * Exit:
 *   - TP1: VWAP level (close 50%)
 *   - TP2: VWAP + 0.5 * ATR overshoot (close remaining 50%)
 *   - SL: 2 * ATR from entry
 *   - Time limit: 48 candles without TP → close
 *
 * Risk:
 *   - Position 3%, Leverage 2x
 *   - Split entry: 60% initial + 40% add-on (if price drops 0.5*ATR more)
 *
 * VWAP session resets every 96 candles (~1 day of 15-min candles).
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
const { sma: smafn, vwap } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('VwapReversionStrategy');

// ==========================================================================
// VwapReversionStrategy
// ==========================================================================

class VwapReversionStrategy extends StrategyBase {
  static metadata = {
    name: 'VwapReversionStrategy',
    targetRegimes: ['ranging', 'quiet'],
    riskLevel: 'low',
    maxConcurrentPositions: 2,
    cooldownMs: 60000,
    gracePeriodMs: 300000,
    description: 'VWAP 회귀 전략 — 가격이 VWAP에서 크게 이탈했을 때 회귀를 기대',
    defaultConfig: {
      rsiPeriod: 14,
      atrPeriod: 14,
      vwapDeviationMult: '1.5',
      volumeSmaPeriod: 20,
      volumeThresholdMult: '1.2',
      positionSizePercent: '3',
      leverage: '2',
      slAtrMult: '2',
      tp1Target: 'vwap',       // close 50% at VWAP
      tp2AtrMult: '0.5',       // close remaining 50% at VWAP + 0.5*ATR
      maxHoldCandles: 48,
      addOnAtrMult: '0.5',     // add-on entry if price drops 0.5*ATR more
      initialSizeRatio: '0.6', // 60% initial
      addOnSizeRatio: '0.4',   // 40% add-on
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...VwapReversionStrategy.metadata.defaultConfig, ...config };
    super('VwapReversionStrategy', merged);

    // ------------------------------------------------------------------
    // Internal state
    // ------------------------------------------------------------------

    /** @type {Array<{high:string, low:string, close:string, volume:string}>} current VWAP session klines */
    this._sessionKlines = [];

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {string|null} entry price for current position */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;

    /** @type {number} candles since entry (for time limit) */
    this._candlesSinceEntry = 0;

    /** @type {boolean} whether first TP (VWAP level) was hit */
    this._tp1Hit = false;

    /** @type {boolean} whether add-on entry was made */
    this._addOnDone = false;

    /** @type {number} total candle counter */
    this._klineCount = 0;

    /** @type {number} kline count at session start */
    this._sessionStartKline = 0;
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check SL if position is open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }

    // Only check SL when we have a position
    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const price = this._latestPrice;
    const entry = this._entryPrice;

    // Compute current ATR for SL calculation via IndicatorCache
    const atrVal = this._indicatorCache
      ? this._indicatorCache.get(this._symbol, 'atr', { period: this.config.atrPeriod })
      : null;
    if (atrVal === null) return;

    const slDistance = multiply(this.config.slAtrMult, atrVal);

    if (this._positionSide === 'long') {
      const slPrice = subtract(entry, slDistance);
      if (isLessThan(price, slPrice)) {
        log.trade('Stop loss hit (long)', { price, entry, slPrice });
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
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
      const slPrice = add(entry, slDistance);
      if (isGreaterThan(price, slPrice)) {
        log.trade('Stop loss hit (short)', { price, entry, slPrice });
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
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
   * @param {object} kline — { close, high, low, open, volume }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;
    const volume = kline && kline.volume !== undefined ? String(kline.volume) : '0';

    // 1. Get shared history from IndicatorCache
    const c = this._indicatorCache;
    const hist = c.getHistory(this._symbol);
    if (!hist) return;

    // 2. Session reset check (every 96 candles = ~1 day of 15-min candles)
    this._klineCount += 1;

    if (this._klineCount - this._sessionStartKline >= 96) {
      this._sessionKlines = [];
      this._sessionStartKline = this._klineCount;
    }

    // Push current kline to session
    this._sessionKlines.push({ high, low, close, volume });

    // 3. Calculate indicators
    const { rsiPeriod, atrPeriod, volumeSmaPeriod } = this.config;

    // Need enough data for indicators
    const minRequired = Math.max(rsiPeriod + 1, atrPeriod + 1, volumeSmaPeriod);
    if (hist.closes.length < minRequired || this._sessionKlines.length < 2) {
      log.debug('Not enough data yet', {
        have: hist.closes.length,
        need: minRequired,
        sessionKlines: this._sessionKlines.length,
      });
      return;
    }

    // VWAP from session klines (strategy-specific, NOT from cache)
    const vwapVal = vwap(this._sessionKlines);
    if (vwapVal === null) return;

    // RSI via IndicatorCache
    const rsiVal = c.get(this._symbol, 'rsi', { period: rsiPeriod });
    if (rsiVal === null) return;

    // ATR via IndicatorCache
    const atrVal = c.get(this._symbol, 'atr', { period: atrPeriod });
    if (atrVal === null) return;

    // Volume SMA — cache's sma uses close prices, so compute from raw volumes
    const volSma = smafn(hist.volumes, volumeSmaPeriod);
    if (volSma === null) return;

    const {
      vwapDeviationMult,
      volumeThresholdMult,
      positionSizePercent,
      slAtrMult,
      tp2AtrMult,
      maxHoldCandles,
      addOnAtrMult,
      initialSizeRatio,
      addOnSizeRatio,
    } = this.config;

    // Deviation thresholds
    const deviationBand = multiply(vwapDeviationMult, atrVal);
    const lowerBand = subtract(vwapVal, deviationBand);
    const upperBand = add(vwapVal, deviationBand);

    // Volume threshold
    const volumeThreshold = multiply(volSma, volumeThresholdMult);
    const volumeSufficient = isGreaterThan(volume, volumeThreshold);

    // Price deviation from VWAP
    const deviation = subtract(close, vwapVal);

    const regime = this.getEffectiveRegime();

    const marketContext = {
      vwap: vwapVal,
      atr: atrVal,
      rsi: rsiVal,
      deviation,
      lowerBand,
      upperBand,
      volume,
      volumeThreshold,
      regime,
    };

    // 4. If position open: manage TP1, TP2, time limit, add-on
    if (this._entryPrice !== null && this._positionSide !== null) {
      this._candlesSinceEntry += 1;

      // --- Time limit check ---
      if (this._candlesSinceEntry >= maxHoldCandles) {
        log.trade('Time limit reached — closing position', {
          candles: this._candlesSinceEntry, maxHoldCandles,
        });
        const closeAction = this._positionSide === 'long'
          ? SIGNAL_ACTIONS.CLOSE_LONG
          : SIGNAL_ACTIONS.CLOSE_SHORT;
        const signal = {
          action: closeAction,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence: toFixed('0.7000', 4),
          reason: 'time_limit',
          marketContext,
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }

      // --- TP1: VWAP level (close 50%) ---
      if (!this._tp1Hit) {
        let tp1Triggered = false;

        if (this._positionSide === 'long' && isGreaterThan(close, vwapVal)) {
          tp1Triggered = true;
        } else if (this._positionSide === 'short' && isLessThan(close, vwapVal)) {
          tp1Triggered = true;
        }

        if (tp1Triggered) {
          this._tp1Hit = true;
          const halfQty = toFixed(multiply(positionSizePercent, '0.5'), 4);
          const closeAction = this._positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;

          log.trade('TP1 hit — VWAP reached, closing 50%', { vwap: vwapVal, close });
          const signal = {
            action: closeAction,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            confidence: toFixed('0.8000', 4),
            reason: 'tp1_vwap',
            marketContext,
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
      }

      // --- TP2: VWAP + 0.5*ATR overshoot (close remaining 50%) ---
      if (this._tp1Hit) {
        const overshoot = multiply(tp2AtrMult, atrVal);
        let tp2Triggered = false;

        if (this._positionSide === 'long') {
          const tp2Level = add(vwapVal, overshoot);
          if (isGreaterThan(close, tp2Level)) {
            tp2Triggered = true;
          }
        } else if (this._positionSide === 'short') {
          const tp2Level = subtract(vwapVal, overshoot);
          if (isLessThan(close, tp2Level)) {
            tp2Triggered = true;
          }
        }

        if (tp2Triggered) {
          log.trade('TP2 hit — VWAP overshoot, closing remaining', { close });
          const closeAction = this._positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          const signal = {
            action: closeAction,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            confidence: toFixed('0.8500', 4),
            reason: 'tp2_vwap_overshoot',
            marketContext,
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          return;
        }
      }

      // --- Add-on entry check (if price drops 0.5*ATR more from entry) ---
      if (!this._addOnDone) {
        const addOnDistance = multiply(addOnAtrMult, atrVal);

        if (this._positionSide === 'long') {
          const addOnLevel = subtract(this._entryPrice, addOnDistance);
          if (isLessThan(close, addOnLevel)) {
            this._addOnDone = true;
            const addOnQty = toFixed(multiply(positionSizePercent, addOnSizeRatio), 4);
            const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

            log.trade('Add-on entry (long) — price dropped further', { close, addOnLevel });
            const signal = {
              action: SIGNAL_ACTIONS.OPEN_LONG,
              symbol: this._symbol,
              category: this._category,
              suggestedQty: addOnQty,
              suggestedPrice: close,
              confidence,
              leverage: this.config.leverage,
              reason: 'vwap_reversion_long_addon',
              marketContext,
            };
            this._lastSignal = signal;
            this.emitSignal(signal);
            return;
          }
        } else if (this._positionSide === 'short') {
          const addOnLevel = add(this._entryPrice, addOnDistance);
          if (isGreaterThan(close, addOnLevel)) {
            this._addOnDone = true;
            const addOnQty = toFixed(multiply(positionSizePercent, addOnSizeRatio), 4);
            const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

            log.trade('Add-on entry (short) — price rallied further', { close, addOnLevel });
            const signal = {
              action: SIGNAL_ACTIONS.OPEN_SHORT,
              symbol: this._symbol,
              category: this._category,
              suggestedQty: addOnQty,
              suggestedPrice: close,
              confidence,
              leverage: this.config.leverage,
              reason: 'vwap_reversion_short_addon',
              marketContext,
            };
            this._lastSignal = signal;
            this.emitSignal(signal);
            return;
          }
        }
      }

      // Position open but no exit/add-on triggered — done for this kline
      return;
    }

    // 5. No position: check entry conditions (RANGING or QUIET regimes only)
    if (regime !== null && regime !== MARKET_REGIMES.RANGING && regime !== MARKET_REGIMES.QUIET) {
      return;
    }

    // --- Long entry ---
    const priceBelowLower = isLessThan(close, lowerBand);
    const rsiOversold = isLessThan(rsiVal, '35');
    const bullishCandle = isGreaterThan(close, open);

    if (priceBelowLower && rsiOversold && volumeSufficient && bullishCandle) {
      const sizePercent = toFixed(multiply(positionSizePercent, initialSizeRatio), 4);
      const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

      log.trade('Long entry — VWAP reversion', {
        symbol: this._symbol, close, vwap: vwapVal, rsi: rsiVal, deviation,
      });

      this._entryPrice = close;
      this._positionSide = 'long';
      this._candlesSinceEntry = 0;
      this._tp1Hit = false;
      this._addOnDone = false;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: close,
        stopLossPrice: subtract(close, multiply(slAtrMult, atrVal)),
        confidence,
        leverage: this.config.leverage,
        reason: 'vwap_reversion_long',
        marketContext,
      };
      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // --- Short entry ---
    const priceAboveUpper = isGreaterThan(close, upperBand);
    const rsiOverbought = isGreaterThan(rsiVal, '65');
    const bearishCandle = isLessThan(close, open);

    if (priceAboveUpper && rsiOverbought && volumeSufficient && bearishCandle) {
      const sizePercent = toFixed(multiply(positionSizePercent, initialSizeRatio), 4);
      const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

      log.trade('Short entry — VWAP reversion', {
        symbol: this._symbol, close, vwap: vwapVal, rsi: rsiVal, deviation,
      });

      this._entryPrice = close;
      this._positionSide = 'short';
      this._candlesSinceEntry = 0;
      this._tp1Hit = false;
      this._addOnDone = false;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: close,
        stopLossPrice: add(close, multiply(slAtrMult, atrVal)),
        confidence,
        leverage: this.config.leverage,
        reason: 'vwap_reversion_short',
        marketContext,
      };
      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
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
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate a confidence score based on RSI extremity, VWAP deviation, and ATR.
   *
   * @param {string} rsiVal
   * @param {string} deviation — price - VWAP
   * @param {string} atrVal
   * @returns {string} confidence 0.00-1.00
   */
  _calcConfidence(rsiVal, deviation, atrVal) {
    const rsiNum = parseFloat(rsiVal);
    const devNum = Math.abs(parseFloat(deviation));
    const atrNum = parseFloat(atrVal);

    // RSI component: further from 50 = higher confidence (0-0.4)
    const rsiDistance = Math.abs(rsiNum - 50) / 50;
    const rsiScore = rsiDistance * 0.4;

    // Deviation component: larger deviation from VWAP relative to ATR = higher confidence (0-0.35)
    const devRatio = atrNum > 0 ? Math.min(devNum / (atrNum * 3), 1) : 0;
    const devScore = devRatio * 0.35;

    // Base confidence + components
    const confidence = Math.min(0.3 + rsiScore + devScore, 1);
    return toFixed(String(confidence), 4);
  }

  /**
   * Reset all position-related state after full exit.
   * @private
   */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._candlesSinceEntry = 0;
    this._tp1Hit = false;
    this._addOnDone = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('VwapReversionStrategy', VwapReversionStrategy);

module.exports = VwapReversionStrategy;
