'use strict';

/**
 * SupportResistanceStrategy -- Horizontal S/R Level Breakout (지지저항 돌파 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE, RANGING
 * Core concept: Pure price-action strategy that identifies horizontal support
 * and resistance levels from swing highs/lows, then trades breakouts through
 * those levels with retest confirmation.
 *
 * S/R Level Detection:
 *   - Swing high: candle whose high > both neighbours within lookback each side
 *   - Swing low: candle whose low < both neighbours within lookback each side
 *   - Cluster nearby swings within ATR x clusterTolerance into one level
 *   - Keep max maxLevels levels (half supports, half resistances)
 *   - Level strength = touch count (more touches = stronger)
 *
 * Entry Long:  close > resistance + retest within 0.3xATR in last 3 bars + touches >= 2 + not QUIET
 * Entry Short: close < support   + retest within 0.3xATR in last 3 bars + touches >= 2 + not QUIET
 *
 * Exit:
 *   - TP: next S/R level in profit direction (or 3xATR fallback)
 *   - SL: 1.5xATR from entry
 *   - Trailing: after 1.5xATR profit, trail at 2xATR from extreme
 */

const StrategyBase = require('../../services/strategyBase');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const {
  add, subtract, multiply, divide,
  isGreaterThan, isLessThan, isLessThanOrEqual, toFixed, abs,
  max: mathMax, min: mathMin,
} = require('../../utils/mathUtils');
const { atr } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('SupportResistanceStrategy');

class SupportResistanceStrategy extends StrategyBase {
  static metadata = {
    name: 'SupportResistanceStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile', 'ranging'],
    riskLevel: 'medium',
    maxConcurrentPositions: 2,
    cooldownMs: 120000,
    gracePeriodMs: 600000,
    warmupCandles: 30,
    volatilityPreference: 'neutral',
    maxSymbolsPerStrategy: 3,
    description: '지지저항 돌파 -- 수평 S/R 레벨 식별 + 리테스트 확인 후 돌파 진입',
    defaultConfig: {
      lookback: 3,                    // Swing detection lookback (each side)
      atrPeriod: 14,                  // ATR calculation period
      clusterTolerance: '1.0',        // ATR multiplier for clustering nearby levels
      retestTolerance: '0.5',         // ATR multiplier for retest confirmation
      minTouches: 1,                  // Minimum touch count for a valid level
      slMultiplier: '1.5',            // ATR multiplier for stop loss
      defaultTpMultiplier: '3',       // Fallback ATR multiplier when no next level
      trailingActivationAtr: '1.5',   // Activate trailing after N x ATR profit
      trailingDistanceAtr: '2',       // Trail at N x ATR from extreme
      positionSizePercent: '3',       // Fallback position size %
      leverage: '2',                  // Default leverage
      maxLevels: 10,                  // Max S/R levels to track
    },
  };

  /** @param {object} config -- strategy configuration overrides */
  constructor(config = {}) {
    const merged = { ...SupportResistanceStrategy.metadata.defaultConfig, ...config };
    super('SupportResistanceStrategy', merged);

    /** @type {number} max kline data points to keep */
    this._maxHistory = 200;
  }

  /**
   * Override: create per-symbol state with all position/indicator fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {Array<{high:string, low:string, close:string}>} */
      klineHistory: [],

      /** @type {string|null} stop loss price */
      stopPrice: null,

      /** @type {string|null} take profit price */
      tpPrice: null,

      /** @type {boolean} trailing stop activated */
      trailingActive: false,

      /** @type {string|null} trailing stop price */
      trailingStopPrice: null,

      /** @type {string|null} highest price since entry (long) */
      highestSinceEntry: null,

      /** @type {string|null} lowest price since entry (short) */
      lowestSinceEntry: null,

      /** @type {string|null} latest ATR value */
      latestAtr: null,

      /** @type {Array<{price: string, type: 'support'|'resistance', touches: number}>} */
      srLevels: [],
    };
  }

  // --------------------------------------------------------------------------
  // Swing detection helpers
  // --------------------------------------------------------------------------

  /**
   * Find swing high points from kline history.
   * A swing high at index i has high strictly > all highs within lookback each side.
   * @param {number} lookback
   * @returns {Array<{index: number, price: string}>}
   */
  _findSwingHighs(lookback) {
    const s = this._s();
    const result = [];
    const len = s.klineHistory.length;
    for (let i = lookback; i < len - lookback; i++) {
      const h = s.klineHistory[i].high;
      let valid = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (!isGreaterThan(h, s.klineHistory[j].high)) { valid = false; break; }
      }
      if (valid) result.push({ index: i, price: h });
    }
    return result;
  }

  /**
   * Find swing low points from kline history.
   * A swing low at index i has low strictly < all lows within lookback each side.
   * @param {number} lookback
   * @returns {Array<{index: number, price: string}>}
   */
  _findSwingLows(lookback) {
    const s = this._s();
    const result = [];
    const len = s.klineHistory.length;
    for (let i = lookback; i < len - lookback; i++) {
      const l = s.klineHistory[i].low;
      let valid = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (!isLessThan(l, s.klineHistory[j].low)) { valid = false; break; }
      }
      if (valid) result.push({ index: i, price: l });
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Level clustering and classification
  // --------------------------------------------------------------------------

  /**
   * Cluster nearby swing points into consolidated S/R levels.
   * Points within `tolerance` are merged; averaged price, touches = cluster size.
   * @param {Array<{index: number, price: string}>} swings
   * @param {string} tolerance -- max price distance for same cluster
   * @returns {Array<{price: string, touches: number}>}
   */
  _clusterLevels(swings, tolerance) {
    if (swings.length === 0) return [];
    const sorted = [...swings].sort((a, b) => {
      if (isLessThan(a.price, b.price)) return -1;
      if (isGreaterThan(a.price, b.price)) return 1;
      return 0;
    });
    const clusters = [];
    let cur = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const dist = abs(subtract(sorted[i].price, cur[0].price));
      if (isLessThanOrEqual(dist, tolerance)) {
        cur.push(sorted[i]);
      } else {
        clusters.push(this._finalizeCluster(cur));
        cur = [sorted[i]];
      }
    }
    if (cur.length > 0) clusters.push(this._finalizeCluster(cur));
    return clusters;
  }

  /**
   * Reduce a cluster into a single level (averaged price, touches = count).
   * @param {Array<{index: number, price: string}>} cluster
   * @returns {{price: string, touches: number}}
   */
  _finalizeCluster(cluster) {
    let sum = '0';
    for (const p of cluster) sum = add(sum, p.price);
    return { price: toFixed(divide(sum, String(cluster.length)), 8), touches: cluster.length };
  }

  /**
   * Classify levels as support/resistance relative to current price.
   * Keep at most maxLevels/2 of each, preferring highest touch count.
   * @param {Array<{price: string, touches: number}>} levels
   * @param {string} currentPrice
   * @returns {Array<{price: string, type: 'support'|'resistance', touches: number}>}
   */
  _classifyLevels(levels, currentPrice) {
    const sup = [], res = [];
    for (const lv of levels) {
      if (isLessThan(lv.price, currentPrice)) sup.push({ ...lv, type: 'support' });
      else res.push({ ...lv, type: 'resistance' });
    }
    sup.sort((a, b) => b.touches - a.touches);
    res.sort((a, b) => b.touches - a.touches);
    const half = Math.floor(this.config.maxLevels / 2);
    return [...sup.slice(0, half), ...res.slice(0, half)];
  }

  /**
   * Find the nearest S/R level in the profit direction.
   * Long -> nearest resistance above; Short -> nearest support below.
   * @param {'long'|'short'} direction
   * @param {string} currentPrice
   * @returns {{price: string, touches: number}|null}
   */
  _findNextLevel(direction, currentPrice) {
    const s = this._s();
    let best = null, bestDist = null;
    for (const lv of s.srLevels) {
      if (direction === 'long' && isGreaterThan(lv.price, currentPrice)) {
        const d = subtract(lv.price, currentPrice);
        if (bestDist === null || isLessThan(d, bestDist)) { bestDist = d; best = lv; }
      } else if (direction === 'short' && isLessThan(lv.price, currentPrice)) {
        const d = subtract(currentPrice, lv.price);
        if (bestDist === null || isLessThan(d, bestDist)) { bestDist = d; best = lv; }
      }
    }
    return best;
  }

  /**
   * Check whether price retested a level within the last N candles.
   * For long breakout: candle low came within tolerance of level.
   * For short breakout: candle high came within tolerance of level.
   * @param {string} levelPrice
   * @param {'long'|'short'} side
   * @param {string} toleranceDist
   * @param {number} [lookbackCandles=3]
   * @returns {boolean}
   */
  _hasRetestConfirmation(levelPrice, side, toleranceDist, lookbackCandles = 3) {
    const s = this._s();
    const len = s.klineHistory.length;
    const start = Math.max(0, len - 1 - lookbackCandles);
    for (let i = start; i < len; i++) {
      const c = s.klineHistory[i];
      const ref = side === 'long' ? c.low : c.high;
      const dist = abs(subtract(ref, levelPrice));
      if (isLessThanOrEqual(dist, toleranceDist)) return true;
    }
    return false;
  }

  /**
   * Calculate signal confidence. Base 0.55 + touch bonus + strength + regime.
   * @param {{price: string, touches: number}} level
   * @returns {number} 0.50-1.00
   */
  _calcConfidence(level) {
    let conf = 0.55;
    // +0.03 per extra touch above minTouches (cap +0.15)
    conf += Math.min(Math.max(0, level.touches - this.config.minTouches) * 0.03, 0.15);
    // Strength bonus: 5+ touches = max (0-0.10)
    conf += Math.min(level.touches / 5, 1.0) * 0.10;
    // Regime bonus
    if (this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP ||
        this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN) conf += 0.10;
    return Math.min(conf, 1.0);
  }

  // --------------------------------------------------------------------------
  // onTick -- real-time SL / TP / trailing stop checks
  // --------------------------------------------------------------------------

  /**
   * Real-time exit checks: hard SL, TP target, trailing stop.
   * @param {object} ticker -- { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;
    const s = this._s();

    if (ticker && ticker.lastPrice !== undefined) s.latestPrice = String(ticker.lastPrice);
    if (!s.entryPrice || !s.positionSide || !s.latestPrice) return;
    const price = s.latestPrice;

    // --- Hard stop loss ---
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'sr_stop_loss', { entryPrice: s.entryPrice, stopPrice: s.stopPrice });
        this._resetPosition(); return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'sr_stop_loss', { entryPrice: s.entryPrice, stopPrice: s.stopPrice });
        this._resetPosition(); return;
      }
    }

    // --- Take profit ---
    if (s.tpPrice !== null) {
      if (s.positionSide === 'long' && isGreaterThan(price, s.tpPrice)) {
        this._emitCloseSignal('long', price, 'sr_take_profit', { entryPrice: s.entryPrice, tpPrice: s.tpPrice });
        this._resetPosition(); return;
      }
      if (s.positionSide === 'short' && isLessThan(price, s.tpPrice)) {
        this._emitCloseSignal('short', price, 'sr_take_profit', { entryPrice: s.entryPrice, tpPrice: s.tpPrice });
        this._resetPosition(); return;
      }
    }

    // --- Trailing stop ---
    if (s.trailingActive && s.trailingStopPrice !== null) {
      if (s.positionSide === 'long') {
        if (!s.highestSinceEntry || isGreaterThan(price, s.highestSinceEntry)) {
          s.highestSinceEntry = price; this._updateTrailingStop();
        }
        if (isLessThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', { entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice });
          this._resetPosition(); return;
        }
      } else if (s.positionSide === 'short') {
        if (!s.lowestSinceEntry || isLessThan(price, s.lowestSinceEntry)) {
          s.lowestSinceEntry = price; this._updateTrailingStop();
        }
        if (isGreaterThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('short', price, 'trailing_stop', { entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice });
          this._resetPosition(); return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline -- main signal logic
  // --------------------------------------------------------------------------

  /**
   * Process completed kline: build S/R map, manage open position, check entries.
   * @param {object} kline -- { high, low, close }
   */
  onKline(kline) {
    if (!this._active) return;
    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    // 1. Push data and trim
    s.klineHistory.push({ high, low, close });
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // 2. Minimum data check
    const { lookback, atrPeriod } = this.config;
    const minRequired = Math.max(lookback * 2 + 1, atrPeriod + 1);
    if (s.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', { have: s.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(s.klineHistory, atrPeriod);
    if (currentAtr === null) return;
    s.latestAtr = currentAtr;
    const price = close;
    const { clusterTolerance, retestTolerance, minTouches, slMultiplier,
            defaultTpMultiplier, trailingActivationAtr, trailingDistanceAtr,
            positionSizePercent } = this.config;

    // 4. Detect swing highs/lows and build S/R levels
    //    Use previous candle's close for classification so breakouts on
    //    the current candle can be detected.
    const allSwings = [...this._findSwingHighs(lookback), ...this._findSwingLows(lookback)];
    const tolerance = multiply(clusterTolerance, currentAtr);
    const prevClose = s.klineHistory.length >= 2
      ? s.klineHistory[s.klineHistory.length - 2].close
      : price;
    s.srLevels = this._classifyLevels(this._clusterLevels(allSwings, tolerance), prevClose);

    log.debug('S/R levels updated', {
      symbol: sym,
      totalLevels: s.srLevels.length,
      supports: s.srLevels.filter(l => l.type === 'support').length,
      resistances: s.srLevels.filter(l => l.type === 'resistance').length,
    });

    // 5. Position open: update extremes, check trailing activation
    if (s.positionSide !== null && s.entryPrice !== null) {
      if (s.positionSide === 'long') {
        if (!s.highestSinceEntry || isGreaterThan(high, s.highestSinceEntry)) {
          s.highestSinceEntry = high;
          if (s.trailingActive) this._updateTrailingStop();
        }
      } else {
        if (!s.lowestSinceEntry || isLessThan(low, s.lowestSinceEntry)) {
          s.lowestSinceEntry = low;
          if (s.trailingActive) this._updateTrailingStop();
        }
      }
      // Trailing activation check
      if (!s.trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = s.positionSide === 'long'
          ? subtract(price, s.entryPrice)
          : subtract(s.entryPrice, price);
        if (isGreaterThan(profit, actDist)) {
          s.trailingActive = true;
          if (s.positionSide === 'long') s.highestSinceEntry = s.highestSinceEntry || price;
          else s.lowestSinceEntry = s.lowestSinceEntry || price;
          this._updateTrailingStop();
          log.info(`Trailing stop activated (${s.positionSide})`, {
            symbol: sym, trailingStopPrice: s.trailingStopPrice,
          });
        }
      }
      return; // Position open -- no new entries
    }

    // 6. No position: check entry conditions
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.TRENDING_DOWN ||
      regime === MARKET_REGIMES.VOLATILE || regime === MARKET_REGIMES.RANGING;
    if (!regimeOk) return;

    const riskPerUnit = multiply(currentAtr, slMultiplier);
    const retestDist = multiply(retestTolerance, currentAtr);

    // --- Resistance breakout -> Long entry ---
    for (const level of s.srLevels.filter(l => l.type === 'resistance')) {
      if (level.touches < minTouches) continue;
      if (!isGreaterThan(price, level.price)) continue;
      if (!this._hasRetestConfirmation(level.price, 'long', retestDist)) continue;

      const slPrice = subtract(price, riskPerUnit);
      const nextLv = this._findNextLevel('long', price);
      const tpPrice = nextLv ? nextLv.price : add(price, multiply(defaultTpMultiplier, currentAtr));
      const conf = this._calcConfidence(level);
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG, symbol: sym, category: this._category,
        suggestedQty: positionSizePercent, suggestedPrice: price, stopLossPrice: slPrice, riskPerUnit,
        confidence: toFixed(String(conf), 4), leverage: this.config.leverage,
        reason: 'sr_breakout_long',
        marketContext: { brokenLevel: level.price, levelTouches: level.touches,
          tpPrice, slPrice, nextSrLevel: nextLv ? nextLv.price : null,
          atr: currentAtr, riskPerUnit, regime, totalLevels: s.srLevels.length },
      };
      s.entryPrice = price; s.positionSide = 'long';
      s.stopPrice = slPrice; s.tpPrice = tpPrice;
      s.highestSinceEntry = high; s.lowestSinceEntry = null;
      s.trailingActive = false; s.trailingStopPrice = null;
      s.lastSignal = signal; this.emitSignal(signal);
      log.info('Long entry: resistance breakout', {
        symbol: sym, price, brokenLevel: level.price, touches: level.touches, sl: slPrice, tp: tpPrice,
      });
      return;
    }

    // --- Support breakout -> Short entry ---
    for (const level of s.srLevels.filter(l => l.type === 'support')) {
      if (level.touches < minTouches) continue;
      if (!isLessThan(price, level.price)) continue;
      if (!this._hasRetestConfirmation(level.price, 'short', retestDist)) continue;

      const slPrice = add(price, riskPerUnit);
      const nextLv = this._findNextLevel('short', price);
      const tpPrice = nextLv ? nextLv.price : subtract(price, multiply(defaultTpMultiplier, currentAtr));
      const conf = this._calcConfidence(level);
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT, symbol: sym, category: this._category,
        suggestedQty: positionSizePercent, suggestedPrice: price, stopLossPrice: slPrice, riskPerUnit,
        confidence: toFixed(String(conf), 4), leverage: this.config.leverage,
        reason: 'sr_breakout_short',
        marketContext: { brokenLevel: level.price, levelTouches: level.touches,
          tpPrice, slPrice, nextSrLevel: nextLv ? nextLv.price : null,
          atr: currentAtr, riskPerUnit, regime, totalLevels: s.srLevels.length },
      };
      s.entryPrice = price; s.positionSide = 'short';
      s.stopPrice = slPrice; s.tpPrice = tpPrice;
      s.highestSinceEntry = null; s.lowestSinceEntry = low;
      s.trailingActive = false; s.trailingStopPrice = null;
      s.lastSignal = signal; this.emitSignal(signal);
      log.info('Short entry: support breakout', {
        symbol: sym, price, brokenLevel: level.price, touches: level.touches, sl: slPrice, tp: tpPrice,
      });
      return;
    }
  }

  // --------------------------------------------------------------------------
  // onFill / getSignal
  // --------------------------------------------------------------------------

  /** @param {object} fill -- fill data from order manager */
  onFill(fill) {
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    const s = this._s();
    const sym = this.getCurrentSymbol();

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
      this._resetPosition();
    }
  }

  /** @returns {object|null} most recent signal */
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
    const sym = this.getCurrentSymbol();
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action, symbol: sym, category: this._category,
      suggestedQty: this.config.positionSizePercent, suggestedPrice: price,
      reduceOnly: true,
      confidence: toFixed('0.9000', 4), reason,
      marketContext: { ...context, currentPrice: price, atr: s.latestAtr, srLevelCount: s.srLevels.length },
    };
    s.lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price based on extreme price and ATR.
   * Long: highest - trailDist (only moves up). Short: lowest + trailDist (only moves down).
   */
  _updateTrailingStop() {
    const s = this._s();
    if (s.latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, s.latestAtr);
    if (s.positionSide === 'long' && s.highestSinceEntry !== null) {
      const ns = subtract(s.highestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isGreaterThan(ns, s.trailingStopPrice)) s.trailingStopPrice = ns;
    } else if (s.positionSide === 'short' && s.lowestSinceEntry !== null) {
      const ns = add(s.lowestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isLessThan(ns, s.trailingStopPrice)) s.trailingStopPrice = ns;
    }
  }

  /** Reset all position-tracking state after a full exit. */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null; s.positionSide = null;
    s.stopPrice = null; s.tpPrice = null;
    s.trailingActive = false; s.trailingStopPrice = null;
    s.highestSinceEntry = null; s.lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('SupportResistanceStrategy', SupportResistanceStrategy);

module.exports = SupportResistanceStrategy;
