'use strict';

/**
 * SwingStructureStrategy — Pure Price-Action Swing Structure Trend (스윙 구조 추세 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE
 * Core concept: Tracks market structure through swing highs/lows to identify
 * trends, then enters on Break of Structure (BOS) confirmations.
 *
 * Structure Detection:
 *   - Swing highs/lows via 3-bar lookback (middle bar is extreme)
 *   - Uptrend: Higher Highs (HH) + Higher Lows (HL)
 *   - Downtrend: Lower Highs (LH) + Lower Lows (LL)
 *
 * BOS (Break of Structure):
 *   - Bullish BOS: price breaks above most recent swing high in uptrend
 *   - Bearish BOS: price breaks below most recent swing low in downtrend
 *
 * Entry Long:  uptrend (HH+HL) + price > recent swing high + ATR > 0
 *              Regime: TRENDING_UP, VOLATILE, or null
 * Entry Short: downtrend (LH+LL) + price < recent swing low + ATR > 0
 *              Regime: TRENDING_DOWN, VOLATILE, or null
 *
 * Exit Long:  structure violation (price < recent swing low)
 *             SL: swing low - 0.5*ATR | Trailing: 2*ATR profit -> 1.5*ATR trail
 * Exit Short: structure violation (price > recent swing high)
 *             SL: swing high + 0.5*ATR | Trailing: 2*ATR profit -> 1.5*ATR trail
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

const log = createLogger('SwingStructureStrategy');

class SwingStructureStrategy extends StrategyBase {
  static metadata = {
    name: 'SwingStructureStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 300000,
    gracePeriodMs: 600000,
    warmupCandles: 20,
    volatilityPreference: 'high',
    trailingStop: { enabled: false, activationPercent: '1.5', callbackPercent: '1.0' },
    description: '스윙 구조 추세 — HH/HL/LH/LL 구조 분석 + BOS 돌파 진입',
    defaultConfig: {
      swingLookback: 3,              // Bars each side to confirm a swing point
      atrPeriod: 14,                 // ATR calculation period
      slBuffer: '0.5',              // ATR multiplier buffer beyond swing point for SL
      trailingActivationAtr: '2',   // Activate trailing after N×ATR profit
      trailingDistanceAtr: '1.5',   // Trail at N×ATR from extreme
      positionSizePercent: '4',     // Position size as % of equity
      leverage: '3',
    },
  };

  /** @param {object} config — strategy configuration overrides */
  constructor(config = {}) {
    const merged = { ...SwingStructureStrategy.metadata.defaultConfig, ...config };
    super('SwingStructureStrategy', merged);

    /** @type {Array<{high:string, low:string, close:string}>} */
    this.klineHistory = [];
    /** @type {string|null} */ this._latestPrice = null;
    /** @type {object|null} */ this._lastSignal = null;
    /** @type {string|null} */ this._entryPrice = null;
    /** @type {'long'|'short'|null} */ this._positionSide = null;
    /** @type {string|null} */ this._stopPrice = null;
    /** @type {boolean} */ this._trailingActive = false;
    /** @type {string|null} */ this._trailingStopPrice = null;
    /** @type {string|null} */ this._highestSinceEntry = null;
    /** @type {string|null} */ this._lowestSinceEntry = null;
    /** @type {string|null} */ this._latestAtr = null;
    /** @type {Array<{price: string, index: number}>} */ this._swingHighs = [];
    /** @type {Array<{price: string, index: number}>} */ this._swingLows = [];
    /** @type {'uptrend'|'downtrend'|null} */ this._structure = null;
    /** @type {string|null} BOS level that triggered current entry */ this._bosLevel = null;
    /** @type {number} */ this._maxHistory = 200;
    /** @type {number} */ this._maxSwings = 10;
  }

  // --------------------------------------------------------------------------
  // Swing Detection
  // --------------------------------------------------------------------------

  /**
   * Scan klineHistory for swing highs/lows. A swing high has its high greater
   * than all bars within swingLookback on each side. Updates _swingHighs and
   * _swingLows (ascending by index, trimmed to _maxSwings).
   */
  _detectSwings() {
    const lb = this.config.swingLookback;
    const klines = this.klineHistory;
    const len = klines.length;
    if (len < lb * 2 + 1) return;

    const swingHighs = [];
    const swingLows = [];

    for (let i = lb; i < len - lb; i++) {
      let isSwingHigh = true;
      let isSwingLow = true;
      const candidateHigh = klines[i].high;
      const candidateLow = klines[i].low;

      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (!isGreaterThan(candidateHigh, klines[j].high)) isSwingHigh = false;
        if (!isLessThan(candidateLow, klines[j].low)) isSwingLow = false;
        if (!isSwingHigh && !isSwingLow) break;
      }
      if (isSwingHigh) swingHighs.push({ price: candidateHigh, index: i });
      if (isSwingLow) swingLows.push({ price: candidateLow, index: i });
    }

    this._swingHighs = swingHighs.slice(-this._maxSwings);
    this._swingLows = swingLows.slice(-this._maxSwings);
  }

  // --------------------------------------------------------------------------
  // Structure Analysis
  // --------------------------------------------------------------------------

  /**
   * Determine market structure from swing point sequences.
   * Uptrend: HH + HL. Downtrend: LH + LL. Requires >= 2 of each swing type.
   */
  _analyzeStructure() {
    if (this._swingHighs.length < 2 || this._swingLows.length < 2) {
      this._structure = null;
      return;
    }
    const prevSH = this._swingHighs[this._swingHighs.length - 2];
    const lastSH = this._swingHighs[this._swingHighs.length - 1];
    const prevSL = this._swingLows[this._swingLows.length - 2];
    const lastSL = this._swingLows[this._swingLows.length - 1];

    const higherHigh = isGreaterThan(lastSH.price, prevSH.price);
    const higherLow = isGreaterThan(lastSL.price, prevSL.price);
    const lowerHigh = isLessThan(lastSH.price, prevSH.price);
    const lowerLow = isLessThan(lastSL.price, prevSL.price);

    if (higherHigh && higherLow) this._structure = 'uptrend';
    else if (lowerHigh && lowerLow) this._structure = 'downtrend';
    else this._structure = null;
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / trailing stop checks
  // --------------------------------------------------------------------------

  /** @param {object} ticker — must have { lastPrice: string } */
  onTick(ticker) {
    if (!this._active) return;
    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }
    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;
    const price = this._latestPrice;

    // Hard stop loss
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'swing_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice, bosLevel: this._bosLevel,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'swing_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice, bosLevel: this._bosLevel,
        });
        this._resetPosition();
        return;
      }
    }

    // Trailing stop
    if (this._trailingActive && this._trailingStopPrice !== null) {
      if (this._positionSide === 'long') {
        if (this._highestSinceEntry === null || isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
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
          this._emitCloseSignal('short', price, 'trailing_stop', {
            entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — detect swings, analyze structure, check BOS entries/exits
  // --------------------------------------------------------------------------

  /** @param {object} kline — must have { high, low, close } */
  onKline(kline) {
    if (!this._active) return;
    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    // 1. Push data and trim
    this.klineHistory.push({ high, low, close });
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data for swing detection + ATR
    const { swingLookback, atrPeriod } = this.config;
    const minRequired = Math.max(swingLookback * 2 + 1, atrPeriod + 1);
    if (this.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', { have: this.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(this.klineHistory, atrPeriod);
    if (currentAtr === null || !isGreaterThan(currentAtr, '0')) return;
    this._latestAtr = currentAtr;

    // 4. Detect swing points and analyze structure
    this._detectSwings();
    this._analyzeStructure();

    const price = close;
    const { slBuffer, positionSizePercent, trailingActivationAtr, trailingDistanceAtr } = this.config;

    // 5. Position open: check structure violation exit + trailing activation
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

      // Structure violation: long — price breaks below most recent swing low
      if (this._positionSide === 'long' && this._swingLows.length > 0) {
        const recentSL = this._swingLows[this._swingLows.length - 1].price;
        if (isLessThan(price, recentSL)) {
          this._emitCloseSignal('long', price, 'structure_violation', {
            entryPrice: this._entryPrice, swingLow: recentSL, bosLevel: this._bosLevel,
          });
          this._resetPosition();
          return;
        }
      }
      // Structure violation: short — price breaks above most recent swing high
      if (this._positionSide === 'short' && this._swingHighs.length > 0) {
        const recentSH = this._swingHighs[this._swingHighs.length - 1].price;
        if (isGreaterThan(price, recentSH)) {
          this._emitCloseSignal('short', price, 'structure_violation', {
            entryPrice: this._entryPrice, swingHigh: recentSH, bosLevel: this._bosLevel,
          });
          this._resetPosition();
          return;
        }
      }

      // Trailing activation: after N×ATR profit
      if (!this._trailingActive) {
        const activationDist = multiply(trailingActivationAtr, currentAtr);
        if (this._positionSide === 'long') {
          const profit = subtract(price, this._entryPrice);
          if (isGreaterThan(profit, activationDist)) {
            this._trailingActive = true;
            this._highestSinceEntry = this._highestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (long)', {
              symbol: this._symbol, trailingStopPrice: this._trailingStopPrice,
            });
          }
        } else if (this._positionSide === 'short') {
          const profit = subtract(this._entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            this._trailingActive = true;
            this._lowestSinceEntry = this._lowestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (short)', {
              symbol: this._symbol, trailingStopPrice: this._trailingStopPrice,
            });
          }
        }
      }
      return; // Position open — no new entries
    }

    // 6. No position: check BOS entry conditions
    if (this._structure === null) return;
    if (this._swingHighs.length < 2 || this._swingLows.length < 2) return;
    const regime = this.getEffectiveRegime();

    // --- BOS Long: uptrend + price breaks above most recent swing high ---
    if (this._structure === 'uptrend') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE;
      if (!regimeOk) return;

      const recentSH = this._swingHighs[this._swingHighs.length - 1].price;
      const recentSL = this._swingLows[this._swingLows.length - 1].price;

      if (isGreaterThan(price, recentSH)) {
        const slDistance = multiply(slBuffer, currentAtr);
        const slPrice = subtract(recentSL, slDistance);
        const riskPerUnit = subtract(price, slPrice);
        const conf = this._calcConfidence(this._structure);
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: price,
          stopLossPrice: slPrice, riskPerUnit, confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage, reason: 'bos_bullish',
          marketContext: {
            structure: this._structure, bosLevel: recentSH,
            swingHigh: recentSH, swingLow: recentSL,
            atr: currentAtr, riskPerUnit, slPrice, regime,
          },
        };
        this._entryPrice = price;
        this._positionSide = 'long';
        this._stopPrice = slPrice;
        this._bosLevel = recentSH;
        this._highestSinceEntry = high;
        this._lowestSinceEntry = null;
        this._trailingActive = false;
        this._trailingStopPrice = null;
        this._lastSignal = signal;
        this.emitSignal(signal);
        return;
      }
    }

    // --- BOS Short: downtrend + price breaks below most recent swing low ---
    if (this._structure === 'downtrend') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE;
      if (!regimeOk) return;

      const recentSH = this._swingHighs[this._swingHighs.length - 1].price;
      const recentSL = this._swingLows[this._swingLows.length - 1].price;

      if (isLessThan(price, recentSL)) {
        const slDistance = multiply(slBuffer, currentAtr);
        const slPrice = add(recentSH, slDistance);
        const riskPerUnit = subtract(slPrice, price);
        const conf = this._calcConfidence(this._structure);
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: price,
          stopLossPrice: slPrice, riskPerUnit, confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage, reason: 'bos_bearish',
          marketContext: {
            structure: this._structure, bosLevel: recentSL,
            swingHigh: recentSH, swingLow: recentSL,
            atr: currentAtr, riskPerUnit, slPrice, regime,
          },
        };
        this._entryPrice = price;
        this._positionSide = 'short';
        this._stopPrice = slPrice;
        this._bosLevel = recentSL;
        this._highestSinceEntry = null;
        this._lowestSinceEntry = low;
        this._trailingActive = false;
        this._trailingStopPrice = null;
        this._lastSignal = signal;
        this.emitSignal(signal);
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // onFill / getSignal
  // --------------------------------------------------------------------------

  /** @param {object} fill — fill data from the exchange */
  onFill(fill) {
    super.onFill(fill); // R10: update StrategyBase trailing stop state
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

  /** @returns {object|null} most recently generated signal */
  getSignal() { return this._lastSignal; }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a close signal for the given position side.
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} reason
   * @param {object} context
   */
  _emitCloseSignal(side, price, reason, context) {
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action, symbol: this._symbol, category: this._category,
      suggestedQty: this.config.positionSizePercent, suggestedPrice: price,
      reduceOnly: true,
      confidence: toFixed('0.9000', 4), reason,
      marketContext: { ...context, currentPrice: price, atr: this._latestAtr, structure: this._structure },
    };
    this._lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price. For longs trail below highest, for shorts
   * trail above lowest. Stop only moves in favourable direction.
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
   * Calculate confidence from structure clarity and regime alignment.
   * Base 0.55, +depth bonus (max 0.15), +clarity bonus (max 0.10),
   * +regime alignment bonus (0.10). Capped at 1.0.
   * @param {'uptrend'|'downtrend'} structure
   * @returns {number} 0.50-1.00
   */
  _calcConfidence(structure) {
    let conf = 0.55;

    // Structure depth: additional confirming swing points beyond required 2
    if (this._swingHighs.length >= 3 && this._swingLows.length >= 3) {
      let depthBonus = 0;
      const shLen = this._swingHighs.length;
      const slLen = this._swingLows.length;
      if (structure === 'uptrend') {
        if (isGreaterThan(this._swingHighs[shLen - 2].price, this._swingHighs[shLen - 3].price)) depthBonus += 0.05;
        if (isGreaterThan(this._swingLows[slLen - 2].price, this._swingLows[slLen - 3].price)) depthBonus += 0.05;
      } else if (structure === 'downtrend') {
        if (isLessThan(this._swingHighs[shLen - 2].price, this._swingHighs[shLen - 3].price)) depthBonus += 0.05;
        if (isLessThan(this._swingLows[slLen - 2].price, this._swingLows[slLen - 3].price)) depthBonus += 0.05;
      }
      conf += Math.min(depthBonus, 0.15);
    }

    // Swing separation clarity relative to ATR
    if (this._latestAtr !== null && this._swingHighs.length >= 2 && this._swingLows.length >= 2) {
      const highDiff = abs(subtract(
        this._swingHighs[this._swingHighs.length - 1].price,
        this._swingHighs[this._swingHighs.length - 2].price
      ));
      const lowDiff = abs(subtract(
        this._swingLows[this._swingLows.length - 1].price,
        this._swingLows[this._swingLows.length - 2].price
      ));
      const avgDiff = divide(add(highDiff, lowDiff), '2');
      const clarityRatio = parseFloat(divide(avgDiff, this._latestAtr));
      conf += Math.min(clarityRatio * 0.05, 0.10);
    }

    // Regime alignment
    if (structure === 'uptrend' && this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP) conf += 0.10;
    else if (structure === 'downtrend' && this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN) conf += 0.10;

    return Math.min(conf, 1.0);
  }

  /** Reset all position-tracking state after a full exit. */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._stopPrice = null;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
    this._bosLevel = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('SwingStructureStrategy', SwingStructureStrategy);

module.exports = SwingStructureStrategy;
