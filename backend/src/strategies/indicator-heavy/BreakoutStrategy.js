'use strict';

/**
 * BreakoutStrategy — BB Squeeze Breakout Strategy (스퀴즈 돌파 전략)
 *
 * Target regimes: QUIET (primary), RANGING (secondary)
 * Core concept: When Bollinger Bands contract inside Keltner Channel (squeeze),
 * a breakout is imminent. Enter on the breakout with volume/ATR confirmation.
 *
 * Squeeze detection:
 *   BB upper < KC upper AND BB lower > KC lower
 *
 * Entry Long (upward breakout):
 *   - Squeeze maintained >= 6 candles
 *   - Price breaks above BB upper (close > BB upper)
 *   - Volume > Volume SMA(20) * 2 (volume explosion)
 *   - ATR > ATR SMA(20) * 1.5 (volatility expansion)
 *   - EMA(9) slope positive (current > previous)
 *
 * Entry Short (downward breakout): Mirror conditions
 *
 * Exit:
 *   - TP: 3 * ATR
 *   - SL: Opposite BB band at squeeze time
 *   - Trailing: After 1*ATR profit, trail at 1.5*ATR
 *   - Failure: If price re-enters BB range within 3 candles, close
 *
 * Position: 4% of equity, Leverage: 3x
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
} = require('../../utils/mathUtils');
const { sma } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('BreakoutStrategy');

class BreakoutStrategy extends StrategyBase {
  static metadata = {
    name: 'BreakoutStrategy',
    targetRegimes: ['quiet', 'ranging'],
    riskLevel: 'high',
    maxConcurrentPositions: 1,
    cooldownMs: 300000,
    gracePeriodMs: 900000,
    warmupCandles: 30,
    volatilityPreference: 'high',
    trailingStop: { enabled: false, activationPercent: '2.0', callbackPercent: '1.5' },
    description: 'BB 스퀴즈 돌파 전략 — 볼린저밴드가 켈트너채널 안으로 수축 후 돌파 진입',
    defaultConfig: {
      bbPeriod: 20,
      bbStdDev: 2,
      kcEmaPeriod: 20,
      kcAtrPeriod: 10,
      kcMult: 1.5,
      atrPeriod: 14,
      emaSlopePeriod: 9,
      volumeSmaPeriod: 20,
      minSqueezeCandles: 6,
      volumeBreakoutMult: '2',
      atrBreakoutMult: '1.5',
      positionSizePercent: '4',
      leverage: '3',
      tpAtrMult: '3',
      trailingActivationAtr: '1',
      trailingDistanceAtr: '1.5',
      failureCandles: 3,
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...BreakoutStrategy.metadata.defaultConfig, ...config };
    super('BreakoutStrategy', merged);

    // Internal state ----------------------------------------------------------

    /** @type {string[]} ATR values as Strings (to compute ATR SMA) */
    this._atrHistory = [];

    /** @type {number} consecutive candles where BB is inside KC */
    this._squeezeCount = 0;

    /** @type {string|null} opposite BB band when squeeze was active (SL reference) */
    this._squeezeOppositeBand = null;

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {string|null} entry price for the current position */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;

    /** @type {number} candles elapsed since entry (for failure check) */
    this._candlesSinceEntry = 0;

    /** @type {boolean} whether trailing stop has been activated */
    this._trailingActive = false;

    /** @type {string|null} current trailing stop price */
    this._trailingStopPrice = null;

    /** @type {string|null} highest price since entry (long positions) */
    this._highestSinceEntry = null;

    /** @type {string|null} lowest price since entry (short positions) */
    this._lowestSinceEntry = null;

    /** @type {string|null} previous EMA(9) value for slope detection */
    this._prevEma9 = null;
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check SL / trailing stop if position open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }

    // Only check exits when we have a position
    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const price = this._latestPrice;
    const { positionSizePercent } = this.config;

    // --- Stop Loss: opposite BB band at squeeze time ---
    if (this._squeezeOppositeBand !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._squeezeOppositeBand)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss_opposite_band',
          marketContext: {
            entryPrice: this._entryPrice,
            currentPrice: price,
            slPrice: this._squeezeOppositeBand,
          },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._squeezeOppositeBand)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss_opposite_band',
          marketContext: {
            entryPrice: this._entryPrice,
            currentPrice: price,
            slPrice: this._squeezeOppositeBand,
          },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop check ---
    if (this._trailingActive && this._trailingStopPrice !== null) {
      if (this._positionSide === 'long') {
        // Update highest price seen
        if (this._highestSinceEntry === null || isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price;
          // Recalculate trailing stop
          const latestAtr = this._getLatestAtr();
          if (latestAtr !== null) {
            const trailDist = multiply(this.config.trailingDistanceAtr, latestAtr);
            this._trailingStopPrice = subtract(this._highestSinceEntry, trailDist);
          }
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8500', 4),
            reason: 'trailing_stop',
            marketContext: {
              entryPrice: this._entryPrice,
              currentPrice: price,
              trailingStopPrice: this._trailingStopPrice,
            },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          return;
        }
      } else if (this._positionSide === 'short') {
        // Update lowest price seen
        if (this._lowestSinceEntry === null || isLessThan(price, this._lowestSinceEntry)) {
          this._lowestSinceEntry = price;
          // Recalculate trailing stop
          const latestAtr = this._getLatestAtr();
          if (latestAtr !== null) {
            const trailDist = multiply(this.config.trailingDistanceAtr, latestAtr);
            this._trailingStopPrice = add(this._lowestSinceEntry, trailDist);
          }
        }
        if (isGreaterThan(price, this._trailingStopPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8500', 4),
            reason: 'trailing_stop',
            marketContext: {
              entryPrice: this._entryPrice,
              currentPrice: price,
              trailingStopPrice: this._trailingStopPrice,
            },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
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
   * @param {object} kline — must have { high, low, close, volume }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const volume = kline && kline.volume !== undefined ? String(kline.volume) : '0';

    // 1. Need enough data -----------------------------------------------------
    const {
      bbPeriod,
      bbStdDev,
      kcEmaPeriod,
      kcAtrPeriod,
      kcMult,
      atrPeriod,
      emaSlopePeriod,
      volumeSmaPeriod,
      minSqueezeCandles,
      volumeBreakoutMult,
      atrBreakoutMult,
      positionSizePercent,
      tpAtrMult,
      trailingActivationAtr,
      trailingDistanceAtr,
      failureCandles,
    } = this.config;

    const minRequired = Math.max(bbPeriod, kcEmaPeriod, kcAtrPeriod + 1, atrPeriod + 1, emaSlopePeriod, volumeSmaPeriod);

    const hist = this._indicatorCache ? this._indicatorCache.getHistory(this._symbol) : null;
    if (!hist || hist.closes.length < minRequired) {
      log.debug('Not enough data yet', {
        have: hist ? hist.closes.length : 0,
        need: minRequired,
      });
      return;
    }

    // 2. Compute indicators via IndicatorCache --------------------------------
    const c = this._indicatorCache;
    const bb = c.get(this._symbol, 'bb', { period: bbPeriod, stdDev: bbStdDev });
    if (bb === null) return;

    const kc = c.get(this._symbol, 'keltner', { emaPeriod: kcEmaPeriod, atrPeriod: kcAtrPeriod, mult: kcMult });
    if (kc === null) return;

    const currentAtr = c.get(this._symbol, 'atr', { period: atrPeriod });
    if (currentAtr === null) return;

    // Store ATR for ATR SMA computation
    this._atrHistory.push(currentAtr);
    if (this._atrHistory.length > 200) {
      this._atrHistory = this._atrHistory.slice(-200);
    }

    const volumeSma = hist ? sma(hist.volumes, volumeSmaPeriod) : null;
    const atrSma = sma(this._atrHistory, volumeSmaPeriod); // ATR SMA over 20 periods

    const currentEma9 = c.get(this._symbol, 'ema', { period: emaSlopePeriod });

    // 3. Check squeeze: BB inside KC? -----------------------------------------
    const isSqueeze = isLessThan(bb.upper, kc.upper) && isGreaterThan(bb.lower, kc.lower);

    if (isSqueeze) {
      this._squeezeCount += 1;
      // Track opposite band during squeeze for SL reference
      // For long breakout upward: SL = BB lower at squeeze time
      // For short breakout downward: SL = BB upper at squeeze time
      // We store the lower band (for potential long) and update as needed
      this._squeezeOppositeBand = bb.lower; // will be re-assigned on entry based on direction
    } else {
      // Reset squeeze count if not in squeeze and no position
      if (this._positionSide === null) {
        this._squeezeCount = 0;
      }
    }

    const price = close;

    // 4. If position open: check failure, TP, trailing activation -------------
    if (this._positionSide !== null && this._entryPrice !== null) {
      this._candlesSinceEntry += 1;

      // Update extreme prices
      if (this._positionSide === 'long') {
        if (this._highestSinceEntry === null || isGreaterThan(high, this._highestSinceEntry)) {
          this._highestSinceEntry = high;
        }
      } else {
        if (this._lowestSinceEntry === null || isLessThan(low, this._lowestSinceEntry)) {
          this._lowestSinceEntry = low;
        }
      }

      // Failure check: price re-enters BB range within failureCandles candles
      if (this._candlesSinceEntry <= failureCandles) {
        const reEnteredBB = isGreaterThan(price, bb.lower) && isLessThan(price, bb.upper);
        if (reEnteredBB) {
          const closeAction = this._positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          const signal = {
            action: closeAction,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8000', 4),
            reason: 'breakout_failure',
            marketContext: {
              entryPrice: this._entryPrice,
              currentPrice: price,
              candlesSinceEntry: this._candlesSinceEntry,
              bbUpper: bb.upper,
              bbLower: bb.lower,
            },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(currentEma9);
          return;
        }
      }

      // TP check: 3 * ATR from entry
      const tpDistance = multiply(tpAtrMult, currentAtr);
      if (this._positionSide === 'long') {
        const tpPrice = add(this._entryPrice, tpDistance);
        if (isGreaterThan(price, tpPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.9000', 4),
            reason: 'take_profit',
            marketContext: {
              entryPrice: this._entryPrice,
              currentPrice: price,
              tpPrice,
              atr: currentAtr,
            },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(currentEma9);
          return;
        }
      } else if (this._positionSide === 'short') {
        const tpPrice = subtract(this._entryPrice, tpDistance);
        if (isLessThan(price, tpPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.9000', 4),
            reason: 'take_profit',
            marketContext: {
              entryPrice: this._entryPrice,
              currentPrice: price,
              tpPrice,
              atr: currentAtr,
            },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(currentEma9);
          return;
        }
      }

      // Trailing activation: after 1*ATR profit, trail at 1.5*ATR
      if (!this._trailingActive) {
        const activationDist = multiply(trailingActivationAtr, currentAtr);
        if (this._positionSide === 'long') {
          const profit = subtract(price, this._entryPrice);
          if (isGreaterThan(profit, activationDist)) {
            this._trailingActive = true;
            this._highestSinceEntry = this._highestSinceEntry || price;
            const trailDist = multiply(trailingDistanceAtr, currentAtr);
            this._trailingStopPrice = subtract(this._highestSinceEntry, trailDist);
            log.info('Trailing stop activated (long)', {
              symbol: this._symbol,
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        } else if (this._positionSide === 'short') {
          const profit = subtract(this._entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            this._trailingActive = true;
            this._lowestSinceEntry = this._lowestSinceEntry || price;
            const trailDist = multiply(trailingDistanceAtr, currentAtr);
            this._trailingStopPrice = add(this._lowestSinceEntry, trailDist);
            log.info('Trailing stop activated (short)', {
              symbol: this._symbol,
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        }
      }

      this._updatePrevEma9(currentEma9);
      return;
    }

    // 5. No position: check breakout entry conditions -------------------------
    if (this._squeezeCount < minSqueezeCandles) {
      this._updatePrevEma9(currentEma9);
      return;
    }

    // Need volume SMA and ATR SMA for breakout confirmation
    if (volumeSma === null || atrSma === null || currentEma9 === null) {
      this._updatePrevEma9(currentEma9);
      return;
    }

    // EMA slope check requires previous EMA9
    if (this._prevEma9 === null) {
      this._updatePrevEma9(currentEma9);
      return;
    }

    // Regime filter: QUIET (primary), RANGING (secondary)
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.QUIET ||
      regime === MARKET_REGIMES.RANGING;
    if (!regimeOk) {
      this._updatePrevEma9(currentEma9);
      return;
    }

    // Volume explosion: volume > volumeSMA * volumeBreakoutMult
    const volumeThreshold = multiply(volumeSma, volumeBreakoutMult);
    const volumeOk = isGreaterThan(volume, volumeThreshold);

    // ATR expansion: ATR > atrSMA * atrBreakoutMult
    const atrThreshold = multiply(atrSma, atrBreakoutMult);
    const atrOk = isGreaterThan(currentAtr, atrThreshold);

    // EMA(9) slope
    const emaSlopePositive = isGreaterThan(currentEma9, this._prevEma9);
    const emaSlopeNegative = isLessThan(currentEma9, this._prevEma9);

    // --- Long breakout: close > BB upper ---
    if (
      isGreaterThan(price, bb.upper) &&
      volumeOk &&
      atrOk &&
      emaSlopePositive
    ) {
      const conf = this._calcConfidence(volumeSma, volume, atrSma, currentAtr);
      // SL = BB lower band at squeeze time (opposite band for long)
      this._squeezeOppositeBand = bb.lower;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: this._squeezeOppositeBand,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'squeeze_breakout_long',
        marketContext: {
          bbUpper: bb.upper,
          bbLower: bb.lower,
          kcUpper: kc.upper,
          kcLower: kc.lower,
          squeezeCandles: this._squeezeCount,
          volume,
          volumeSma,
          atr: currentAtr,
          atrSma,
          ema9: currentEma9,
          regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'long';
      this._candlesSinceEntry = 0;
      this._trailingActive = false;
      this._trailingStopPrice = null;
      this._highestSinceEntry = high;
      this._lowestSinceEntry = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      this._updatePrevEma9(currentEma9);
      return;
    }

    // --- Short breakout: close < BB lower ---
    if (
      isLessThan(price, bb.lower) &&
      volumeOk &&
      atrOk &&
      emaSlopeNegative
    ) {
      const conf = this._calcConfidence(volumeSma, volume, atrSma, currentAtr);
      // SL = BB upper band at squeeze time (opposite band for short)
      this._squeezeOppositeBand = bb.upper;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: this._squeezeOppositeBand,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'squeeze_breakout_short',
        marketContext: {
          bbUpper: bb.upper,
          bbLower: bb.lower,
          kcUpper: kc.upper,
          kcLower: kc.lower,
          squeezeCandles: this._squeezeCount,
          volume,
          volumeSma,
          atr: currentAtr,
          atrSma,
          ema9: currentEma9,
          regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'short';
      this._candlesSinceEntry = 0;
      this._trailingActive = false;
      this._trailingStopPrice = null;
      this._highestSinceEntry = null;
      this._lowestSinceEntry = low;

      this._lastSignal = signal;
      this.emitSignal(signal);
      this._updatePrevEma9(currentEma9);
      return;
    }

    this._updatePrevEma9(currentEma9);
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
    super.onFill(fill); // R11: update StrategyBase trailing stop state
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
   * Get the latest ATR value from history.
   * @returns {string|null}
   */
  _getLatestAtr() {
    if (this._atrHistory.length === 0) return null;
    return this._atrHistory[this._atrHistory.length - 1];
  }

  /**
   * Update previous EMA(9) for slope detection on the next candle.
   * @param {string|null} currentEma9
   */
  _updatePrevEma9(currentEma9) {
    this._prevEma9 = currentEma9;
  }

  /**
   * Calculate confidence score based on volume and ATR breakout strength.
   *
   * @param {string} volumeSma
   * @param {string} volume
   * @param {string} atrSma
   * @param {string} currentAtr
   * @returns {number} confidence 0.50-1.00
   */
  _calcConfidence(volumeSma, volume, atrSma, currentAtr) {
    // Volume component: how much volume exceeds threshold (0-0.25)
    const volRatio = parseFloat(divide(volume, volumeSma));
    const volScore = Math.min((volRatio - 2) / 4, 1) * 0.25;

    // ATR component: how much ATR exceeds threshold (0-0.25)
    const atrRatio = parseFloat(divide(currentAtr, atrSma));
    const atrScore = Math.min((atrRatio - 1.5) / 2, 1) * 0.25;

    // Squeeze duration component: longer squeeze = higher conviction (0-0.20)
    const squeezeScore = Math.min(this._squeezeCount / 20, 1) * 0.20;

    const confidence = Math.min(0.50 + Math.max(volScore, 0) + Math.max(atrScore, 0) + squeezeScore, 1);
    return confidence;
  }

  /**
   * Reset all position-tracking state after a full exit.
   */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._candlesSinceEntry = 0;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
    this._squeezeCount = 0;
    this._squeezeOppositeBand = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('BreakoutStrategy', BreakoutStrategy);

module.exports = BreakoutStrategy;
