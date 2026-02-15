'use strict';

/**
 * TrendlineBreakoutStrategy -- Trendline Breakout (추세선 돌파 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE
 * Core concept: Connect two recent pivots to form a trendline, then enter
 * when price breaks through the trendline in real-time. Stop loss is placed
 * just beyond the trendline → short SL = high R:R.
 *
 * Trendline construction:
 *   - Resistance: two most recent pivot highs (any slope — covers
 *     descending channels AND ascending wedges / ending diagonals)
 *     → price breaks ABOVE → LONG
 *   - Support: two most recent pivot lows (any slope)
 *     → price breaks BELOW → SHORT
 *
 * Aggregation:
 *   Raw 1-min klines are aggregated into N-min bars (default 60 = 1H).
 *   Pivot detection and ATR are computed on aggregated bars.
 *
 * Position management:
 *   - SL: trendline projected price ∓ slBufferAtr × ATR
 *   - Trailing: activates after trailingActivationAtr × ATR profit,
 *     trails at trailingDistanceAtr × ATR from extreme
 *   - Trendlines are FROZEN while in a position (no recalculation)
 */

const StrategyBase = require('../../services/strategyBase');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const {
  add, subtract, multiply, divide,
  isGreaterThan, isLessThan, toFixed, abs,
} = require('../../utils/mathUtils');
const { atr, findPivots, findTrendlines } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('TrendlineBreakoutStrategy');

class TrendlineBreakoutStrategy extends StrategyBase {
  static metadata = {
    name: 'TrendlineBreakoutStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 120000,
    description: '추세선 돌파 -- 피봇 2개 연결 추세선 돌파 시 추격 진입, 짧은 손절 = 높은 손익비',
    defaultConfig: {
      aggregationMinutes: 60,           // Aggregation bar size (minutes)
      pivotLeftBars: 5,                 // Pivot detection: left bars
      pivotRightBars: 3,                // Pivot detection: right bars
      minPivotDistance: 5,              // Min bar distance between two pivots
      maxPivotAge: 100,                 // Max age of pivots in bars
      breakoutBufferAtr: '0.1',         // Min breakout distance (ATR multiple)
      slBufferAtr: '1.0',              // SL buffer beyond trendline (ATR multiple)
      atrPeriod: 14,                    // ATR calculation period
      trailingActivationAtr: '1.5',     // Trailing activation threshold (ATR multiple)
      trailingDistanceAtr: '1.5',       // Trailing distance from extreme (ATR multiple)
      positionSizePercent: '3',         // Position size (% of equity)
      leverage: '3',                    // Leverage
    },
  };

  /** @param {object} config */
  constructor(config = {}) {
    const merged = { ...TrendlineBreakoutStrategy.metadata.defaultConfig, ...config };
    super('TrendlineBreakoutStrategy', merged);

    // --- Aggregation state ---
    /** @type {Array<{high:string, low:string, close:string, open:string}>} aggregated bars */
    this._aggBars = [];
    /** @type {{high:string, low:string, close:string, open:string}|null} current building bar */
    this._currentBar = null;
    /** @type {number} 1-min klines accumulated in current bar */
    this._barCount = 0;
    /** @type {number} max aggregated bars to keep */
    this._maxBars = 250;

    // --- Trendline state ---
    /** @type {{pivot1, pivot2, slope:string, projected:string}|null} */
    this._resistanceLine = null;
    /** @type {{pivot1, pivot2, slope:string, projected:string}|null} */
    this._supportLine = null;

    // --- ATR ---
    /** @type {string|null} */
    this._latestAtr = null;

    // --- Tick state ---
    /** @type {string|null} */
    this._latestPrice = null;
    /** @type {object|null} */
    this._lastSignal = null;

    // --- Position state ---
    /** @type {string|null} */
    this._entryPrice = null;
    /** @type {'long'|'short'|null} */
    this._positionSide = null;
    /** @type {string|null} */
    this._stopPrice = null;
    /** @type {boolean} */
    this._trailingActive = false;
    /** @type {string|null} */
    this._trailingStopPrice = null;
    /** @type {string|null} */
    this._highestSinceEntry = null;
    /** @type {string|null} */
    this._lowestSinceEntry = null;
    /** @type {boolean} freeze trendlines while in position */
    this._trendlineFrozen = false;
  }

  // --------------------------------------------------------------------------
  // onKline -- 1-min kline aggregation → pivot + trendline + ATR
  // --------------------------------------------------------------------------

  /**
   * Process 1-min klines. Aggregate into N-min bars; on bar completion,
   * detect pivots, compute trendlines, and update ATR.
   * @param {object} kline -- { open, high, low, close }
   */
  onKline(kline) {
    if (!this._active) return;
    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;

    // --- Aggregate 1-min klines into N-min bars ---
    if (this._currentBar === null) {
      this._currentBar = { open, high, low, close };
      this._barCount = 1;
    } else {
      if (isGreaterThan(high, this._currentBar.high)) this._currentBar.high = high;
      if (isLessThan(low, this._currentBar.low)) this._currentBar.low = low;
      this._currentBar.close = close;
      this._barCount++;
    }

    // Not a complete aggregated bar yet
    if (this._barCount < this.config.aggregationMinutes) return;

    // --- Bar complete: push and reset ---
    this._aggBars.push({ ...this._currentBar });
    if (this._aggBars.length > this._maxBars) {
      this._aggBars = this._aggBars.slice(-this._maxBars);
    }
    this._currentBar = null;
    this._barCount = 0;

    // --- Minimum data check ---
    const { atrPeriod, pivotLeftBars, pivotRightBars } = this.config;
    const minRequired = Math.max(pivotLeftBars + pivotRightBars + 1, atrPeriod + 1);
    if (this._aggBars.length < minRequired) {
      log.debug('Not enough aggregated bars', {
        have: this._aggBars.length, need: minRequired,
      });
      return;
    }

    // --- Compute ATR on aggregated bars ---
    const currentAtr = atr(this._aggBars, atrPeriod);
    if (currentAtr === null) return;
    this._latestAtr = currentAtr;

    // --- Skip trendline recalculation while in position ---
    if (this._trendlineFrozen) {
      log.debug('Trendlines frozen (position open)', { symbol: this._symbol });
      return;
    }

    // --- Detect pivots on aggregated highs / lows ---
    const highs = this._aggBars.map(b => b.high);
    const lows = this._aggBars.map(b => b.low);
    const pivots = findPivots(highs, pivotLeftBars, pivotRightBars);
    const pivotLows = findPivots(lows, pivotLeftBars, pivotRightBars);

    const currentIndex = this._aggBars.length - 1;

    // --- Find trendlines ---
    const lines = findTrendlines(
      pivots.highs, pivotLows.lows, currentIndex,
      { minPivotDistance: this.config.minPivotDistance, maxPivotAge: this.config.maxPivotAge },
    );

    this._resistanceLine = lines.resistance;
    this._supportLine = lines.support;

    log.debug('Trendlines updated', {
      symbol: this._symbol,
      hasResistance: !!this._resistanceLine,
      hasSupport: !!this._supportLine,
      atr: currentAtr,
      bars: this._aggBars.length,
    });
  }

  // --------------------------------------------------------------------------
  // onTick -- real-time breakout detection + SL / trailing management
  // --------------------------------------------------------------------------

  /**
   * Real-time tick handler: detect trendline breakout for entry,
   * manage SL and trailing stop for exits.
   * @param {object} ticker -- { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;
    if (ticker && ticker.lastPrice !== undefined) this._latestPrice = String(ticker.lastPrice);
    if (!this._latestPrice || !this._latestAtr) return;

    const price = this._latestPrice;
    const currentAtr = this._latestAtr;

    // === Position open: manage exit ===
    if (this._positionSide !== null && this._entryPrice !== null) {
      this._manageExit(price, currentAtr);
      return;
    }

    // === No position: check for breakout entry ===
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.TRENDING_UP ||
      regime === MARKET_REGIMES.TRENDING_DOWN ||
      regime === MARKET_REGIMES.VOLATILE;
    if (!regimeOk) return;

    const breakoutBuffer = multiply(this.config.breakoutBufferAtr, currentAtr);
    const slBuffer = multiply(this.config.slBufferAtr, currentAtr);

    // --- Descending resistance breakout → LONG ---
    if (this._resistanceLine) {
      const projected = this._resistanceLine.projected;
      const breakoutThreshold = add(projected, breakoutBuffer);

      if (isGreaterThan(price, breakoutThreshold)) {
        const slPrice = subtract(projected, slBuffer);
        const riskPerUnit = subtract(price, slPrice);
        const conf = this._calcConfidence('long', regime);

        const signal = {
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
          suggestedPrice: price,
          stopLossPrice: slPrice,
          riskPerUnit,
          confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage,
          reason: 'trendline_breakout_long',
          marketContext: {
            trendlineProjected: projected,
            trendlineSlope: this._resistanceLine.slope,
            pivot1: this._resistanceLine.pivot1,
            pivot2: this._resistanceLine.pivot2,
            slPrice,
            atr: currentAtr,
            riskPerUnit,
            regime,
          },
        };

        this._enterPosition('long', price, slPrice);
        this._lastSignal = signal;
        this.emitSignal(signal);
        log.info('Long entry: resistance trendline breakout', {
          symbol: this._symbol, price, projected, sl: slPrice,
        });
        return;
      }
    }

    // --- Ascending support breakout → SHORT ---
    if (this._supportLine) {
      const projected = this._supportLine.projected;
      const breakoutThreshold = subtract(projected, breakoutBuffer);

      if (isLessThan(price, breakoutThreshold)) {
        const slPrice = add(projected, slBuffer);
        const riskPerUnit = subtract(slPrice, price);
        const conf = this._calcConfidence('short', regime);

        const signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
          suggestedPrice: price,
          stopLossPrice: slPrice,
          riskPerUnit,
          confidence: toFixed(String(conf), 4),
          leverage: this.config.leverage,
          reason: 'trendline_breakout_short',
          marketContext: {
            trendlineProjected: projected,
            trendlineSlope: this._supportLine.slope,
            pivot1: this._supportLine.pivot1,
            pivot2: this._supportLine.pivot2,
            slPrice,
            atr: currentAtr,
            riskPerUnit,
            regime,
          },
        };

        this._enterPosition('short', price, slPrice);
        this._lastSignal = signal;
        this.emitSignal(signal);
        log.info('Short entry: support trendline breakout', {
          symbol: this._symbol, price, projected, sl: slPrice,
        });
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // onFill / getSignal
  // --------------------------------------------------------------------------

  /** @param {object} fill */
  onFill(fill) {
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      this._positionSide = 'long';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      this._trendlineFrozen = true;
      log.trade('Long fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._positionSide = 'short';
      if (fill.price !== undefined) this._entryPrice = String(fill.price);
      this._trendlineFrozen = true;
      log.trade('Short fill recorded', { entry: this._entryPrice, symbol: this._symbol });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: this._positionSide, symbol: this._symbol });
      this._resetPosition();
    }
  }

  /** @returns {object|null} */
  getSignal() {
    return this._lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private: exit management
  // --------------------------------------------------------------------------

  /**
   * Manage SL and trailing stop while in a position.
   * @param {string} price
   * @param {string} currentAtr
   */
  _manageExit(price, currentAtr) {
    // --- Hard stop loss ---
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'trendline_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'trendline_stop_loss', {
          entryPrice: this._entryPrice, stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop logic ---
    const { trailingActivationAtr, trailingDistanceAtr } = this.config;

    if (this._positionSide === 'long') {
      // Update highest price
      if (!this._highestSinceEntry || isGreaterThan(price, this._highestSinceEntry)) {
        this._highestSinceEntry = price;
        if (this._trailingActive) this._updateTrailingStop();
      }

      // Check trailing activation
      if (!this._trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = subtract(price, this._entryPrice);
        if (isGreaterThan(profit, actDist)) {
          this._trailingActive = true;
          this._highestSinceEntry = this._highestSinceEntry || price;
          this._updateTrailingStop();
          log.info('Trailing stop activated (long)', {
            symbol: this._symbol, trailingStopPrice: this._trailingStopPrice,
          });
        }
      }

      // Check trailing stop hit
      if (this._trailingActive && this._trailingStopPrice !== null) {
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
            entryPrice: this._entryPrice, trailingStopPrice: this._trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    } else if (this._positionSide === 'short') {
      // Update lowest price
      if (!this._lowestSinceEntry || isLessThan(price, this._lowestSinceEntry)) {
        this._lowestSinceEntry = price;
        if (this._trailingActive) this._updateTrailingStop();
      }

      // Check trailing activation
      if (!this._trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = subtract(this._entryPrice, price);
        if (isGreaterThan(profit, actDist)) {
          this._trailingActive = true;
          this._lowestSinceEntry = this._lowestSinceEntry || price;
          this._updateTrailingStop();
          log.info('Trailing stop activated (short)', {
            symbol: this._symbol, trailingStopPrice: this._trailingStopPrice,
          });
        }
      }

      // Check trailing stop hit
      if (this._trailingActive && this._trailingStopPrice !== null) {
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
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Enter a position: set state and freeze trendlines.
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} slPrice
   */
  _enterPosition(side, price, slPrice) {
    this._entryPrice = price;
    this._positionSide = side;
    this._stopPrice = slPrice;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._trendlineFrozen = true;

    if (side === 'long') {
      this._highestSinceEntry = price;
      this._lowestSinceEntry = null;
    } else {
      this._highestSinceEntry = null;
      this._lowestSinceEntry = price;
    }
  }

  /**
   * Emit a close signal.
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} reason
   * @param {object} context
   */
  _emitCloseSignal(side, price, reason, context) {
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      confidence: toFixed('0.9000', 4),
      reason,
      marketContext: { ...context, currentPrice: price, atr: this._latestAtr },
    };
    this._lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price (only ratchets in the favorable direction).
   */
  _updateTrailingStop() {
    if (this._latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, this._latestAtr);

    if (this._positionSide === 'long' && this._highestSinceEntry !== null) {
      const ns = subtract(this._highestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isGreaterThan(ns, this._trailingStopPrice)) {
        this._trailingStopPrice = ns;
      }
    } else if (this._positionSide === 'short' && this._lowestSinceEntry !== null) {
      const ns = add(this._lowestSinceEntry, trailDist);
      if (this._trailingStopPrice === null || isLessThan(ns, this._trailingStopPrice)) {
        this._trailingStopPrice = ns;
      }
    }
  }

  /**
   * Calculate signal confidence.
   * Base 0.60 + regime bonus + slope steepness bonus.
   * @param {'long'|'short'} side
   * @param {string|null} regime
   * @returns {number}
   */
  _calcConfidence(side, regime) {
    let conf = 0.60;

    // Regime alignment bonus
    if (side === 'long' && regime === MARKET_REGIMES.TRENDING_UP) conf += 0.15;
    else if (side === 'short' && regime === MARKET_REGIMES.TRENDING_DOWN) conf += 0.15;
    else if (regime === MARKET_REGIMES.VOLATILE) conf += 0.05;

    // Slope steepness bonus (steeper = stronger breakout signal)
    const line = side === 'long' ? this._resistanceLine : this._supportLine;
    if (line && this._latestAtr) {
      const slopeAbs = abs(line.slope);
      // Normalize slope by ATR: steeper relative to volatility = higher confidence
      const normalizedSlope = parseFloat(divide(slopeAbs, this._latestAtr));
      if (normalizedSlope > 0.01) conf += Math.min(normalizedSlope * 5, 0.15);
    }

    return Math.min(conf, 1.0);
  }

  /** Reset all position-tracking state after exit. */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._stopPrice = null;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
    this._trendlineFrozen = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('TrendlineBreakoutStrategy', TrendlineBreakoutStrategy);

module.exports = TrendlineBreakoutStrategy;
