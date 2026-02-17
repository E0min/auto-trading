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
    maxSymbolsPerStrategy: 3,
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
  }

  // ---------------------------------------------------------------------------
  // Per-symbol state (SymbolState pattern)
  // ---------------------------------------------------------------------------

  /**
   * Override to add strategy-specific per-symbol fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {string[]} ATR values as Strings (to compute ATR SMA) */
      atrHistory: [],

      /** @type {number} consecutive candles where BB is inside KC */
      squeezeCount: 0,

      /** @type {string|null} opposite BB band when squeeze was active (SL reference) */
      squeezeOppositeBand: null,

      /** @type {number} candles elapsed since entry (for failure check) */
      candlesSinceEntry: 0,

      /** @type {boolean} whether trailing stop has been activated */
      trailingActive: false,

      /** @type {string|null} current trailing stop price */
      trailingStopPrice: null,

      /** @type {string|null} highest price since entry (long positions) */
      highestSinceEntry: null,

      /** @type {string|null} lowest price since entry (short positions) */
      lowestSinceEntry: null,

      /** @type {string|null} previous EMA(9) value for slope detection */
      prevEma9: null,
    };
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check SL / trailing stop if position open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    if (ticker && ticker.lastPrice !== undefined) {
      s.latestPrice = String(ticker.lastPrice);
    }

    // Only check exits when we have a position
    if (s.entryPrice === null || s.positionSide === null) return;
    if (s.latestPrice === null) return;

    const price = s.latestPrice;
    const { positionSizePercent } = this.config;

    // --- Stop Loss: opposite BB band at squeeze time ---
    if (s.squeezeOppositeBand !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.squeezeOppositeBand)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss_opposite_band',
          marketContext: {
            entryPrice: s.entryPrice,
            currentPrice: price,
            slPrice: s.squeezeOppositeBand,
          },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.squeezeOppositeBand)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss_opposite_band',
          marketContext: {
            entryPrice: s.entryPrice,
            currentPrice: price,
            slPrice: s.squeezeOppositeBand,
          },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop check ---
    if (s.trailingActive && s.trailingStopPrice !== null) {
      if (s.positionSide === 'long') {
        // Update highest price seen
        if (s.highestSinceEntry === null || isGreaterThan(price, s.highestSinceEntry)) {
          s.highestSinceEntry = price;
          // Recalculate trailing stop
          const latestAtr = this._getLatestAtr(s);
          if (latestAtr !== null) {
            const trailDist = multiply(this.config.trailingDistanceAtr, latestAtr);
            s.trailingStopPrice = subtract(s.highestSinceEntry, trailDist);
          }
        }
        if (isLessThan(price, s.trailingStopPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8500', 4),
            reason: 'trailing_stop',
            marketContext: {
              entryPrice: s.entryPrice,
              currentPrice: price,
              trailingStopPrice: s.trailingStopPrice,
            },
          };
          s.lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          return;
        }
      } else if (s.positionSide === 'short') {
        // Update lowest price seen
        if (s.lowestSinceEntry === null || isLessThan(price, s.lowestSinceEntry)) {
          s.lowestSinceEntry = price;
          // Recalculate trailing stop
          const latestAtr = this._getLatestAtr(s);
          if (latestAtr !== null) {
            const trailDist = multiply(this.config.trailingDistanceAtr, latestAtr);
            s.trailingStopPrice = add(s.lowestSinceEntry, trailDist);
          }
        }
        if (isGreaterThan(price, s.trailingStopPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8500', 4),
            reason: 'trailing_stop',
            marketContext: {
              entryPrice: s.entryPrice,
              currentPrice: price,
              trailingStopPrice: s.trailingStopPrice,
            },
          };
          s.lastSignal = signal;
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
    const sym = this.getCurrentSymbol();
    const s = this._s();

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

    const hist = this._indicatorCache ? this._indicatorCache.getHistory(sym) : null;
    if (!hist || hist.closes.length < minRequired) {
      log.debug('Not enough data yet', {
        have: hist ? hist.closes.length : 0,
        need: minRequired,
      });
      return;
    }

    // 2. Compute indicators via IndicatorCache --------------------------------
    const c = this._indicatorCache;
    const bb = c.get(sym, 'bb', { period: bbPeriod, stdDev: bbStdDev });
    if (bb === null) return;

    const kc = c.get(sym, 'keltner', { emaPeriod: kcEmaPeriod, atrPeriod: kcAtrPeriod, mult: kcMult });
    if (kc === null) return;

    const currentAtr = c.get(sym, 'atr', { period: atrPeriod });
    if (currentAtr === null) return;

    // Store ATR for ATR SMA computation
    s.atrHistory.push(currentAtr);
    if (s.atrHistory.length > 200) {
      s.atrHistory = s.atrHistory.slice(-200);
    }

    const volumeSma = hist ? sma(hist.volumes, volumeSmaPeriod) : null;
    const atrSma = sma(s.atrHistory, volumeSmaPeriod); // ATR SMA over 20 periods

    const currentEma9 = c.get(sym, 'ema', { period: emaSlopePeriod });

    // 3. Check squeeze: BB inside KC? -----------------------------------------
    const isSqueeze = isLessThan(bb.upper, kc.upper) && isGreaterThan(bb.lower, kc.lower);

    if (isSqueeze) {
      s.squeezeCount += 1;
      // Track opposite band during squeeze for SL reference
      s.squeezeOppositeBand = bb.lower; // will be re-assigned on entry based on direction
    } else {
      // Reset squeeze count if not in squeeze and no position
      if (s.positionSide === null) {
        s.squeezeCount = 0;
      }
    }

    const price = close;

    // 4. If position open: check failure, TP, trailing activation -------------
    if (s.positionSide !== null && s.entryPrice !== null) {
      s.candlesSinceEntry += 1;

      // Update extreme prices
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(high, s.highestSinceEntry)) {
          s.highestSinceEntry = high;
        }
      } else {
        if (s.lowestSinceEntry === null || isLessThan(low, s.lowestSinceEntry)) {
          s.lowestSinceEntry = low;
        }
      }

      // Failure check: price re-enters BB range within failureCandles candles
      if (s.candlesSinceEntry <= failureCandles) {
        const reEnteredBB = isGreaterThan(price, bb.lower) && isLessThan(price, bb.upper);
        if (reEnteredBB) {
          const closeAction = s.positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          const signal = {
            action: closeAction,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.8000', 4),
            reason: 'breakout_failure',
            marketContext: {
              entryPrice: s.entryPrice,
              currentPrice: price,
              candlesSinceEntry: s.candlesSinceEntry,
              bbUpper: bb.upper,
              bbLower: bb.lower,
            },
          };
          s.lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(s, currentEma9);
          return;
        }
      }

      // TP check: 3 * ATR from entry
      const tpDistance = multiply(tpAtrMult, currentAtr);
      if (s.positionSide === 'long') {
        const tpPrice = add(s.entryPrice, tpDistance);
        if (isGreaterThan(price, tpPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.9000', 4),
            reason: 'take_profit',
            marketContext: {
              entryPrice: s.entryPrice,
              currentPrice: price,
              tpPrice,
              atr: currentAtr,
            },
          };
          s.lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(s, currentEma9);
          return;
        }
      } else if (s.positionSide === 'short') {
        const tpPrice = subtract(s.entryPrice, tpDistance);
        if (isLessThan(price, tpPrice)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: price,
            reduceOnly: true,
            confidence: toFixed('0.9000', 4),
            reason: 'take_profit',
            marketContext: {
              entryPrice: s.entryPrice,
              currentPrice: price,
              tpPrice,
              atr: currentAtr,
            },
          };
          s.lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          this._updatePrevEma9(s, currentEma9);
          return;
        }
      }

      // Trailing activation: after 1*ATR profit, trail at 1.5*ATR
      if (!s.trailingActive) {
        const activationDist = multiply(trailingActivationAtr, currentAtr);
        if (s.positionSide === 'long') {
          const profit = subtract(price, s.entryPrice);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.highestSinceEntry = s.highestSinceEntry || price;
            const trailDist = multiply(trailingDistanceAtr, currentAtr);
            s.trailingStopPrice = subtract(s.highestSinceEntry, trailDist);
            log.info('Trailing stop activated (long)', {
              symbol: sym,
              trailingStopPrice: s.trailingStopPrice,
            });
          }
        } else if (s.positionSide === 'short') {
          const profit = subtract(s.entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.lowestSinceEntry = s.lowestSinceEntry || price;
            const trailDist = multiply(trailingDistanceAtr, currentAtr);
            s.trailingStopPrice = add(s.lowestSinceEntry, trailDist);
            log.info('Trailing stop activated (short)', {
              symbol: sym,
              trailingStopPrice: s.trailingStopPrice,
            });
          }
        }
      }

      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // 5. No position: check breakout entry conditions -------------------------
    if (s.squeezeCount < minSqueezeCandles) {
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // Need volume SMA and ATR SMA for breakout confirmation
    if (volumeSma === null || atrSma === null || currentEma9 === null) {
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // EMA slope check requires previous EMA9
    if (s.prevEma9 === null) {
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // Regime filter: QUIET (primary), RANGING (secondary)
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.QUIET ||
      regime === MARKET_REGIMES.RANGING;
    if (!regimeOk) {
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // Volume explosion: volume > volumeSMA * volumeBreakoutMult
    const volumeThreshold = multiply(volumeSma, volumeBreakoutMult);
    const volumeOk = isGreaterThan(volume, volumeThreshold);

    // ATR expansion: ATR > atrSMA * atrBreakoutMult
    const atrThreshold = multiply(atrSma, atrBreakoutMult);
    const atrOk = isGreaterThan(currentAtr, atrThreshold);

    // EMA(9) slope
    const emaSlopePositive = isGreaterThan(currentEma9, s.prevEma9);
    const emaSlopeNegative = isLessThan(currentEma9, s.prevEma9);

    // --- Long breakout: close > BB upper ---
    if (
      isGreaterThan(price, bb.upper) &&
      volumeOk &&
      atrOk &&
      emaSlopePositive
    ) {
      const conf = this._calcConfidence(s, volumeSma, volume, atrSma, currentAtr);
      // SL = BB lower band at squeeze time (opposite band for long)
      s.squeezeOppositeBand = bb.lower;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: s.squeezeOppositeBand,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'squeeze_breakout_long',
        marketContext: {
          bbUpper: bb.upper,
          bbLower: bb.lower,
          kcUpper: kc.upper,
          kcLower: kc.lower,
          squeezeCandles: s.squeezeCount,
          volume,
          volumeSma,
          atr: currentAtr,
          atrSma,
          ema9: currentEma9,
          regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'long';
      s.candlesSinceEntry = 0;
      s.trailingActive = false;
      s.trailingStopPrice = null;
      s.highestSinceEntry = high;
      s.lowestSinceEntry = null;

      s.lastSignal = signal;
      this.emitSignal(signal);
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    // --- Short breakout: close < BB lower ---
    if (
      isLessThan(price, bb.lower) &&
      volumeOk &&
      atrOk &&
      emaSlopeNegative
    ) {
      const conf = this._calcConfidence(s, volumeSma, volume, atrSma, currentAtr);
      // SL = BB upper band at squeeze time (opposite band for short)
      s.squeezeOppositeBand = bb.upper;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: s.squeezeOppositeBand,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'squeeze_breakout_short',
        marketContext: {
          bbUpper: bb.upper,
          bbLower: bb.lower,
          kcUpper: kc.upper,
          kcLower: kc.lower,
          squeezeCandles: s.squeezeCount,
          volume,
          volumeSma,
          atr: currentAtr,
          atrSma,
          ema9: currentEma9,
          regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'short';
      s.candlesSinceEntry = 0;
      s.trailingActive = false;
      s.trailingStopPrice = null;
      s.highestSinceEntry = null;
      s.lowestSinceEntry = low;

      s.lastSignal = signal;
      this.emitSignal(signal);
      this._updatePrevEma9(s, currentEma9);
      return;
    }

    this._updatePrevEma9(s, currentEma9);
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
    const sym = fill.symbol || this.getCurrentSymbol();
    const s = this._s(sym);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Short fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: s.positionSide, symbol: sym });
      this._resetPosition(sym);
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this._s().lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Get the latest ATR value from history.
   * @returns {string|null}
   */
  _getLatestAtr(s) {
    if (s.atrHistory.length === 0) return null;
    return s.atrHistory[s.atrHistory.length - 1];
  }

  /**
   * Update previous EMA(9) for slope detection on the next candle.
   * @param {object} s — per-symbol state
   * @param {string|null} currentEma9
   */
  _updatePrevEma9(s, currentEma9) {
    s.prevEma9 = currentEma9;
  }

  /**
   * Calculate confidence score based on volume and ATR breakout strength.
   *
   * @param {object} s — per-symbol state
   * @param {string} volumeSma
   * @param {string} volume
   * @param {string} atrSma
   * @param {string} currentAtr
   * @returns {number} confidence 0.50-1.00
   */
  _calcConfidence(s, volumeSma, volume, atrSma, currentAtr) {
    // Volume component: how much volume exceeds threshold (0-0.25)
    const volRatio = parseFloat(divide(volume, volumeSma));
    const volScore = Math.min((volRatio - 2) / 4, 1) * 0.25;

    // ATR component: how much ATR exceeds threshold (0-0.25)
    const atrRatio = parseFloat(divide(currentAtr, atrSma));
    const atrScore = Math.min((atrRatio - 1.5) / 2, 1) * 0.25;

    // Squeeze duration component: longer squeeze = higher conviction (0-0.20)
    const squeezeScore = Math.min(s.squeezeCount / 20, 1) * 0.20;

    const confidence = Math.min(0.50 + Math.max(volScore, 0) + Math.max(atrScore, 0) + squeezeScore, 1);
    return confidence;
  }

  /**
   * Reset all position-tracking state after a full exit.
   * @param {string} [symbol] — defaults to getCurrentSymbol()
   */
  _resetPosition(symbol) {
    const s = this._s(symbol);
    s.entryPrice = null;
    s.positionSide = null;
    s.candlesSinceEntry = 0;
    s.trailingActive = false;
    s.trailingStopPrice = null;
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
    s.squeezeCount = 0;
    s.squeezeOppositeBand = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('BreakoutStrategy', BreakoutStrategy);

module.exports = BreakoutStrategy;
