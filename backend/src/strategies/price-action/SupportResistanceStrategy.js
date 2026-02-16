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

    /** @type {Array<{high:string, low:string, close:string}>} */
    this.klineHistory = [];
    /** @type {string|null} latest ticker price */
    this._latestPrice = null;
    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;
    /** @type {string|null} entry price */
    this._entryPrice = null;
    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;
    /** @type {string|null} stop loss price */
    this._stopPrice = null;
    /** @type {string|null} take profit price */
    this._tpPrice = null;
    /** @type {boolean} trailing stop activated */
    this._trailingActive = false;
    /** @type {string|null} trailing stop price */
    this._trailingStopPrice = null;
    /** @type {string|null} highest price since entry (long) */
    this._highestSinceEntry = null;
    /** @type {string|null} lowest price since entry (short) */
    this._lowestSinceEntry = null;
    /** @type {string|null} latest ATR value */
    this._latestAtr = null;
    /** @type {Array<{price: string, type: 'support'|'resistance', touches: number}>} */
    this._srLevels = [];
    /** @type {number} max kline data points to keep */
    this._maxHistory = 200;
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
    const result = [];
    const len = this.klineHistory.length;
    for (let i = lookback; i < len - lookback; i++) {
      const h = this.klineHistory[i].high;
      let valid = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (!isGreaterThan(h, this.klineHistory[j].high)) { valid = false; break; }
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
    const result = [];
    const len = this.klineHistory.length;
    for (let i = lookback; i < len - lookback; i++) {
      const l = this.klineHistory[i].low;
      let valid = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (!isLessThan(l, this.klineHistory[j].low)) { valid = false; break; }
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
    let best = null, bestDist = null;
    for (const lv of this._srLevels) {
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
    const len = this.klineHistory.length;
    const start = Math.max(0, len - 1 - lookbackCandles);
    for (let i = start; i < len; i++) {
      const c = this.klineHistory[i];
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
    if (ticker && ticker.lastPrice !== undefined) this._latestPrice = String(ticker.lastPrice);
    if (!this._entryPrice || !this._positionSide || !this._latestPrice) return;
    const price = this._latestPrice;

    // --- Hard stop loss ---
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'sr_stop_loss', { entryPrice: this._entryPrice, stopPrice: this._stopPrice });
        this._resetPosition(); return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'sr_stop_loss', { entryPrice: this._entryPrice, stopPrice: this._stopPrice });
        this._resetPosition(); return;
      }
    }

    // --- Take profit ---
    if (this._tpPrice !== null) {
      if (this._positionSide === 'long' && isGreaterThan(price, this._tpPrice)) {
        this._emitCloseSignal('long', price, 'sr_take_profit', { entryPrice: this._entryPrice, tpPrice: this._tpPrice });
        this._resetPosition(); return;
      }
      if (this._positionSide === 'short' && isLessThan(price, this._tpPrice)) {
        this._emitCloseSignal('short', price, 'sr_take_profit', { entryPrice: this._entryPrice, tpPrice: this._tpPrice });
        this._resetPosition(); return;
      }
    }

    // --- Trailing stop ---
    if (this._trailingActive && this._trailingStopPrice !== null) {
      if (this._positionSide === 'long') {
        if (!this._highestSinceEntry || isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price; this._updateTrailingStop();
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', { entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice });
          this._resetPosition(); return;
        }
      } else if (this._positionSide === 'short') {
        if (!this._lowestSinceEntry || isLessThan(price, this._lowestSinceEntry)) {
          this._lowestSinceEntry = price; this._updateTrailingStop();
        }
        if (isGreaterThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('short', price, 'trailing_stop', { entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice });
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

    // 1. Push data and trim
    this.klineHistory.push({ high, low, close });
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // 2. Minimum data check
    const { lookback, atrPeriod } = this.config;
    const minRequired = Math.max(lookback * 2 + 1, atrPeriod + 1);
    if (this.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', { have: this.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(this.klineHistory, atrPeriod);
    if (currentAtr === null) return;
    this._latestAtr = currentAtr;
    const price = close;
    const { clusterTolerance, retestTolerance, minTouches, slMultiplier,
            defaultTpMultiplier, trailingActivationAtr, trailingDistanceAtr,
            positionSizePercent } = this.config;

    // 4. Detect swing highs/lows and build S/R levels
    //    Use previous candle's close for classification so breakouts on
    //    the current candle can be detected.
    const allSwings = [...this._findSwingHighs(lookback), ...this._findSwingLows(lookback)];
    const tolerance = multiply(clusterTolerance, currentAtr);
    const prevClose = this.klineHistory.length >= 2
      ? this.klineHistory[this.klineHistory.length - 2].close
      : price;
    this._srLevels = this._classifyLevels(this._clusterLevels(allSwings, tolerance), prevClose);

    log.debug('S/R levels updated', {
      symbol: this._symbol,
      totalLevels: this._srLevels.length,
      supports: this._srLevels.filter(l => l.type === 'support').length,
      resistances: this._srLevels.filter(l => l.type === 'resistance').length,
    });

    // 5. Position open: update extremes, check trailing activation
    if (this._positionSide !== null && this._entryPrice !== null) {
      if (this._positionSide === 'long') {
        if (!this._highestSinceEntry || isGreaterThan(high, this._highestSinceEntry)) {
          this._highestSinceEntry = high;
          if (this._trailingActive) this._updateTrailingStop();
        }
      } else {
        if (!this._lowestSinceEntry || isLessThan(low, this._lowestSinceEntry)) {
          this._lowestSinceEntry = low;
          if (this._trailingActive) this._updateTrailingStop();
        }
      }
      // Trailing activation check
      if (!this._trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = this._positionSide === 'long'
          ? subtract(price, this._entryPrice)
          : subtract(this._entryPrice, price);
        if (isGreaterThan(profit, actDist)) {
          this._trailingActive = true;
          if (this._positionSide === 'long') this._highestSinceEntry = this._highestSinceEntry || price;
          else this._lowestSinceEntry = this._lowestSinceEntry || price;
          this._updateTrailingStop();
          log.info(`Trailing stop activated (${this._positionSide})`, {
            symbol: this._symbol, trailingStopPrice: this._trailingStopPrice,
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
    for (const level of this._srLevels.filter(l => l.type === 'resistance')) {
      if (level.touches < minTouches) continue;
      if (!isGreaterThan(price, level.price)) continue;
      if (!this._hasRetestConfirmation(level.price, 'long', retestDist)) continue;

      const slPrice = subtract(price, riskPerUnit);
      const nextLv = this._findNextLevel('long', price);
      const tpPrice = nextLv ? nextLv.price : add(price, multiply(defaultTpMultiplier, currentAtr));
      const conf = this._calcConfidence(level);
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG, symbol: this._symbol, category: this._category,
        suggestedQty: positionSizePercent, suggestedPrice: price, stopLossPrice: slPrice, riskPerUnit,
        confidence: toFixed(String(conf), 4), leverage: this.config.leverage,
        reason: 'sr_breakout_long',
        marketContext: { brokenLevel: level.price, levelTouches: level.touches,
          tpPrice, slPrice, nextSrLevel: nextLv ? nextLv.price : null,
          atr: currentAtr, riskPerUnit, regime, totalLevels: this._srLevels.length },
      };
      this._entryPrice = price; this._positionSide = 'long';
      this._stopPrice = slPrice; this._tpPrice = tpPrice;
      this._highestSinceEntry = high; this._lowestSinceEntry = null;
      this._trailingActive = false; this._trailingStopPrice = null;
      this._lastSignal = signal; this.emitSignal(signal);
      log.info('Long entry: resistance breakout', {
        symbol: this._symbol, price, brokenLevel: level.price, touches: level.touches, sl: slPrice, tp: tpPrice,
      });
      return;
    }

    // --- Support breakout -> Short entry ---
    for (const level of this._srLevels.filter(l => l.type === 'support')) {
      if (level.touches < minTouches) continue;
      if (!isLessThan(price, level.price)) continue;
      if (!this._hasRetestConfirmation(level.price, 'short', retestDist)) continue;

      const slPrice = add(price, riskPerUnit);
      const nextLv = this._findNextLevel('short', price);
      const tpPrice = nextLv ? nextLv.price : subtract(price, multiply(defaultTpMultiplier, currentAtr));
      const conf = this._calcConfidence(level);
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT, symbol: this._symbol, category: this._category,
        suggestedQty: positionSizePercent, suggestedPrice: price, stopLossPrice: slPrice, riskPerUnit,
        confidence: toFixed(String(conf), 4), leverage: this.config.leverage,
        reason: 'sr_breakout_short',
        marketContext: { brokenLevel: level.price, levelTouches: level.touches,
          tpPrice, slPrice, nextSrLevel: nextLv ? nextLv.price : null,
          atr: currentAtr, riskPerUnit, regime, totalLevels: this._srLevels.length },
      };
      this._entryPrice = price; this._positionSide = 'short';
      this._stopPrice = slPrice; this._tpPrice = tpPrice;
      this._highestSinceEntry = null; this._lowestSinceEntry = low;
      this._trailingActive = false; this._trailingStopPrice = null;
      this._lastSignal = signal; this.emitSignal(signal);
      log.info('Short entry: support breakout', {
        symbol: this._symbol, price, brokenLevel: level.price, touches: level.touches, sl: slPrice, tp: tpPrice,
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

  /** @returns {object|null} most recent signal */
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
      confidence: toFixed('0.9000', 4), reason,
      marketContext: { ...context, currentPrice: price, atr: this._latestAtr, srLevelCount: this._srLevels.length },
    };
    this._lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price based on extreme price and ATR.
   * Long: highest - trailDist (only moves up). Short: lowest + trailDist (only moves down).
   */
  _updateTrailingStop() {
    if (this._latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, this._latestAtr);
    if (this._positionSide === 'long' && this._highestSinceEntry !== null) {
      const ns = subtract(this._highestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isGreaterThan(ns, this._trailingStopPrice)) this._trailingStopPrice = ns;
    } else if (this._positionSide === 'short' && this._lowestSinceEntry !== null) {
      const ns = add(this._lowestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isLessThan(ns, this._trailingStopPrice)) this._trailingStopPrice = ns;
    }
  }

  /** Reset all position-tracking state after a full exit. */
  _resetPosition() {
    this._entryPrice = null; this._positionSide = null;
    this._stopPrice = null; this._tpPrice = null;
    this._trailingActive = false; this._trailingStopPrice = null;
    this._highestSinceEntry = null; this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('SupportResistanceStrategy', SupportResistanceStrategy);

module.exports = SupportResistanceStrategy;
