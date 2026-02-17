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
 *
 * Per-symbol state via StrategyBase SymbolState pattern.
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
    maxSymbolsPerStrategy: 3,
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

    /** @type {number} */ this._maxHistory = 200;
    /** @type {number} */ this._maxSwings = 10;
  }

  // --------------------------------------------------------------------------
  // SymbolState — per-symbol state defaults
  // --------------------------------------------------------------------------

  /** @override */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      klineHistory: [],
      swingHighs: [],
      swingLows: [],
      structure: null,
      bosLevel: null,
      stopPrice: null,
      trailingActive: false,
      trailingStopPrice: null,
      highestSinceEntry: null,
      lowestSinceEntry: null,
      latestAtr: null,
    };
  }

  // --------------------------------------------------------------------------
  // Swing Detection
  // --------------------------------------------------------------------------

  /**
   * Scan klineHistory for swing highs/lows. A swing high has its high greater
   * than all bars within swingLookback on each side. Updates swingHighs and
   * swingLows (ascending by index, trimmed to _maxSwings).
   */
  _detectSwings() {
    const s = this._s();
    const lb = this.config.swingLookback;
    const klines = s.klineHistory;
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

    s.swingHighs = swingHighs.slice(-this._maxSwings);
    s.swingLows = swingLows.slice(-this._maxSwings);
  }

  // --------------------------------------------------------------------------
  // Structure Analysis
  // --------------------------------------------------------------------------

  /**
   * Determine market structure from swing point sequences.
   * Uptrend: HH + HL. Downtrend: LH + LL. Requires >= 2 of each swing type.
   */
  _analyzeStructure() {
    const s = this._s();
    if (s.swingHighs.length < 2 || s.swingLows.length < 2) {
      s.structure = null;
      return;
    }
    const prevSH = s.swingHighs[s.swingHighs.length - 2];
    const lastSH = s.swingHighs[s.swingHighs.length - 1];
    const prevSL = s.swingLows[s.swingLows.length - 2];
    const lastSL = s.swingLows[s.swingLows.length - 1];

    const higherHigh = isGreaterThan(lastSH.price, prevSH.price);
    const higherLow = isGreaterThan(lastSL.price, prevSL.price);
    const lowerHigh = isLessThan(lastSH.price, prevSH.price);
    const lowerLow = isLessThan(lastSL.price, prevSL.price);

    if (higherHigh && higherLow) s.structure = 'uptrend';
    else if (lowerHigh && lowerLow) s.structure = 'downtrend';
    else s.structure = null;
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / trailing stop checks
  // --------------------------------------------------------------------------

  /** @param {object} ticker — must have { lastPrice: string } */
  onTick(ticker) {
    if (!this._active) return;
    const s = this._s();
    if (ticker && ticker.lastPrice !== undefined) {
      s.latestPrice = String(ticker.lastPrice);
    }
    if (s.entryPrice === null || s.positionSide === null) return;
    if (s.latestPrice === null) return;
    const price = s.latestPrice;

    // Hard stop loss
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'swing_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice, bosLevel: s.bosLevel,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'swing_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice, bosLevel: s.bosLevel,
        });
        this._resetPosition();
        return;
      }
    }

    // Trailing stop
    if (s.trailingActive && s.trailingStopPrice !== null) {
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(price, s.highestSinceEntry)) {
          s.highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
            entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      } else if (s.positionSide === 'short') {
        if (s.lowestSinceEntry === null || isLessThan(price, s.lowestSinceEntry)) {
          s.lowestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isGreaterThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('short', price, 'trailing_stop', {
            entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice,
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
    const s = this._s();
    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    // 1. Push data and trim
    s.klineHistory.push({ high, low, close });
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data for swing detection + ATR
    const { swingLookback, atrPeriod } = this.config;
    const minRequired = Math.max(swingLookback * 2 + 1, atrPeriod + 1);
    if (s.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', { have: s.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(s.klineHistory, atrPeriod);
    if (currentAtr === null || !isGreaterThan(currentAtr, '0')) return;
    s.latestAtr = currentAtr;

    // 4. Detect swing points and analyze structure
    this._detectSwings();
    this._analyzeStructure();

    const price = close;
    const symbol = this.getCurrentSymbol();
    const { slBuffer, positionSizePercent, trailingActivationAtr, trailingDistanceAtr } = this.config;

    // 5. Position open: check structure violation exit + trailing activation
    if (s.positionSide !== null && s.entryPrice !== null) {
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(high, s.highestSinceEntry)) {
          s.highestSinceEntry = high;
          if (s.trailingActive) this._updateTrailingStop();
        }
      } else {
        if (s.lowestSinceEntry === null || isLessThan(low, s.lowestSinceEntry)) {
          s.lowestSinceEntry = low;
          if (s.trailingActive) this._updateTrailingStop();
        }
      }

      // Structure violation: long — price breaks below most recent swing low
      if (s.positionSide === 'long' && s.swingLows.length > 0) {
        const recentSL = s.swingLows[s.swingLows.length - 1].price;
        if (isLessThan(price, recentSL)) {
          this._emitCloseSignal('long', price, 'structure_violation', {
            entryPrice: s.entryPrice, swingLow: recentSL, bosLevel: s.bosLevel,
          });
          this._resetPosition();
          return;
        }
      }
      // Structure violation: short — price breaks above most recent swing high
      if (s.positionSide === 'short' && s.swingHighs.length > 0) {
        const recentSH = s.swingHighs[s.swingHighs.length - 1].price;
        if (isGreaterThan(price, recentSH)) {
          this._emitCloseSignal('short', price, 'structure_violation', {
            entryPrice: s.entryPrice, swingHigh: recentSH, bosLevel: s.bosLevel,
          });
          this._resetPosition();
          return;
        }
      }

      // Trailing activation: after N×ATR profit
      if (!s.trailingActive) {
        const activationDist = multiply(trailingActivationAtr, currentAtr);
        if (s.positionSide === 'long') {
          const profit = subtract(price, s.entryPrice);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.highestSinceEntry = s.highestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (long)', {
              symbol, trailingStopPrice: s.trailingStopPrice,
            });
          }
        } else if (s.positionSide === 'short') {
          const profit = subtract(s.entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.lowestSinceEntry = s.lowestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (short)', {
              symbol, trailingStopPrice: s.trailingStopPrice,
            });
          }
        }
      }
      return; // Position open — no new entries
    }

    // 6. No position: check BOS entry conditions
    if (s.structure === null) return;
    if (s.swingHighs.length < 2 || s.swingLows.length < 2) return;
    const regime = this.getEffectiveRegime();

    // --- BOS Long: uptrend + price breaks above most recent swing high ---
    if (s.structure === 'uptrend') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE;
      if (!regimeOk) return;

      const recentSH = s.swingHighs[s.swingHighs.length - 1].price;
      const recentSL = s.swingLows[s.swingLows.length - 1].price;

      if (isGreaterThan(price, recentSH)) {
        const slDistance = multiply(slBuffer, currentAtr);
        const slPrice = subtract(recentSL, slDistance);
        const riskPerUnit = subtract(price, slPrice);
        const conf = this._calcConfidence(s.structure);
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: price,
          stopLossPrice: slPrice, riskPerUnit, confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage, reason: 'bos_bullish',
          marketContext: {
            structure: s.structure, bosLevel: recentSH,
            swingHigh: recentSH, swingLow: recentSL,
            atr: currentAtr, riskPerUnit, slPrice, regime,
          },
        };
        s.entryPrice = price;
        s.positionSide = 'long';
        s.stopPrice = slPrice;
        s.bosLevel = recentSH;
        s.highestSinceEntry = high;
        s.lowestSinceEntry = null;
        s.trailingActive = false;
        s.trailingStopPrice = null;
        s.lastSignal = signal;
        this.emitSignal(signal);
        return;
      }
    }

    // --- BOS Short: downtrend + price breaks below most recent swing low ---
    if (s.structure === 'downtrend') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE;
      if (!regimeOk) return;

      const recentSH = s.swingHighs[s.swingHighs.length - 1].price;
      const recentSL = s.swingLows[s.swingLows.length - 1].price;

      if (isLessThan(price, recentSL)) {
        const slDistance = multiply(slBuffer, currentAtr);
        const slPrice = add(recentSH, slDistance);
        const riskPerUnit = subtract(slPrice, price);
        const conf = this._calcConfidence(s.structure);
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: price,
          stopLossPrice: slPrice, riskPerUnit, confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage, reason: 'bos_bearish',
          marketContext: {
            structure: s.structure, bosLevel: recentSL,
            swingHigh: recentSH, swingLow: recentSL,
            atr: currentAtr, riskPerUnit, slPrice, regime,
          },
        };
        s.entryPrice = price;
        s.positionSide = 'short';
        s.stopPrice = slPrice;
        s.bosLevel = recentSL;
        s.highestSinceEntry = null;
        s.lowestSinceEntry = low;
        s.trailingActive = false;
        s.trailingStopPrice = null;
        s.lastSignal = signal;
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
    const s = this._s();
    const action = fill.action || (fill.signal && fill.signal.action);
    const symbol = this.getCurrentSymbol();

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Short fill recorded', { entry: s.entryPrice, symbol });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: s.positionSide, symbol });
      this._resetPosition();
    }
  }

  /** @returns {object|null} most recently generated signal */
  getSignal() { return this._s().lastSignal; }

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
    const s = this._s();
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action, symbol: this.getCurrentSymbol(), category: this._category,
      suggestedQty: this.config.positionSizePercent, suggestedPrice: price,
      reduceOnly: true,
      confidence: toFixed('0.9000', 4), reason,
      marketContext: { ...context, currentPrice: price, atr: s.latestAtr, structure: s.structure },
    };
    s.lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price. For longs trail below highest, for shorts
   * trail above lowest. Stop only moves in favourable direction.
   */
  _updateTrailingStop() {
    const s = this._s();
    if (s.latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, s.latestAtr);
    if (s.positionSide === 'long' && s.highestSinceEntry !== null) {
      const newStop = subtract(s.highestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isGreaterThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
      }
    } else if (s.positionSide === 'short' && s.lowestSinceEntry !== null) {
      const newStop = add(s.lowestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isLessThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
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
    const s = this._s();
    let conf = 0.55;

    // Structure depth: additional confirming swing points beyond required 2
    if (s.swingHighs.length >= 3 && s.swingLows.length >= 3) {
      let depthBonus = 0;
      const shLen = s.swingHighs.length;
      const slLen = s.swingLows.length;
      if (structure === 'uptrend') {
        if (isGreaterThan(s.swingHighs[shLen - 2].price, s.swingHighs[shLen - 3].price)) depthBonus += 0.05;
        if (isGreaterThan(s.swingLows[slLen - 2].price, s.swingLows[slLen - 3].price)) depthBonus += 0.05;
      } else if (structure === 'downtrend') {
        if (isLessThan(s.swingHighs[shLen - 2].price, s.swingHighs[shLen - 3].price)) depthBonus += 0.05;
        if (isLessThan(s.swingLows[slLen - 2].price, s.swingLows[slLen - 3].price)) depthBonus += 0.05;
      }
      conf += Math.min(depthBonus, 0.15);
    }

    // Swing separation clarity relative to ATR
    if (s.latestAtr !== null && s.swingHighs.length >= 2 && s.swingLows.length >= 2) {
      const highDiff = abs(subtract(
        s.swingHighs[s.swingHighs.length - 1].price,
        s.swingHighs[s.swingHighs.length - 2].price
      ));
      const lowDiff = abs(subtract(
        s.swingLows[s.swingLows.length - 1].price,
        s.swingLows[s.swingLows.length - 2].price
      ));
      const avgDiff = divide(add(highDiff, lowDiff), '2');
      const clarityRatio = parseFloat(divide(avgDiff, s.latestAtr));
      conf += Math.min(clarityRatio * 0.05, 0.10);
    }

    // Regime alignment
    if (structure === 'uptrend' && this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP) conf += 0.10;
    else if (structure === 'downtrend' && this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN) conf += 0.10;

    return Math.min(conf, 1.0);
  }

  /** Reset all position-tracking state after a full exit. */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
    s.stopPrice = null;
    s.trailingActive = false;
    s.trailingStopPrice = null;
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
    s.bosLevel = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('SwingStructureStrategy', SwingStructureStrategy);

module.exports = SwingStructureStrategy;
