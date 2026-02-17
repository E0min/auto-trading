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
 *
 * Per-symbol state via StrategyBase SymbolState pattern.
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
    gracePeriodMs: 600000,
    warmupCandles: 30,
    volatilityPreference: 'neutral',
    maxSymbolsPerStrategy: 3,
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

    /** @type {number} max aggregated bars to keep */
    this._maxBars = 250;
  }

  // --------------------------------------------------------------------------
  // SymbolState — per-symbol state defaults
  // --------------------------------------------------------------------------

  /** @override */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      // Aggregation state
      aggBars: [],
      currentBar: null,
      barCount: 0,
      // Trendline state
      resistanceLine: null,
      supportLine: null,
      // ATR
      latestAtr: null,
      // Position state
      stopPrice: null,
      trailingActive: false,
      trailingStopPrice: null,
      highestSinceEntry: null,
      lowestSinceEntry: null,
      trendlineFrozen: false,
    };
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
    const s = this._s();
    const symbol = this.getCurrentSymbol();
    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;

    // --- Aggregate 1-min klines into N-min bars ---
    if (s.currentBar === null) {
      s.currentBar = { open, high, low, close };
      s.barCount = 1;
    } else {
      if (isGreaterThan(high, s.currentBar.high)) s.currentBar.high = high;
      if (isLessThan(low, s.currentBar.low)) s.currentBar.low = low;
      s.currentBar.close = close;
      s.barCount++;
    }

    // Not a complete aggregated bar yet
    if (s.barCount < this.config.aggregationMinutes) return;

    // --- Bar complete: push and reset ---
    s.aggBars.push({ ...s.currentBar });
    if (s.aggBars.length > this._maxBars) {
      s.aggBars = s.aggBars.slice(-this._maxBars);
    }
    s.currentBar = null;
    s.barCount = 0;

    // --- Minimum data check ---
    const { atrPeriod, pivotLeftBars, pivotRightBars } = this.config;
    const minRequired = Math.max(pivotLeftBars + pivotRightBars + 1, atrPeriod + 1);
    if (s.aggBars.length < minRequired) {
      log.debug('Not enough aggregated bars', {
        have: s.aggBars.length, need: minRequired,
      });
      return;
    }

    // --- Compute ATR on aggregated bars ---
    const currentAtr = atr(s.aggBars, atrPeriod);
    if (currentAtr === null) return;
    s.latestAtr = currentAtr;

    // --- Skip trendline recalculation while in position ---
    if (s.trendlineFrozen) {
      log.debug('Trendlines frozen (position open)', { symbol });
      return;
    }

    // --- Detect pivots on aggregated highs / lows ---
    const highs = s.aggBars.map(b => b.high);
    const lows = s.aggBars.map(b => b.low);
    const pivots = findPivots(highs, pivotLeftBars, pivotRightBars);
    const pivotLows = findPivots(lows, pivotLeftBars, pivotRightBars);

    const currentIndex = s.aggBars.length - 1;

    // --- Find trendlines ---
    const lines = findTrendlines(
      pivots.highs, pivotLows.lows, currentIndex,
      { minPivotDistance: this.config.minPivotDistance, maxPivotAge: this.config.maxPivotAge },
    );

    s.resistanceLine = lines.resistance;
    s.supportLine = lines.support;

    log.debug('Trendlines updated', {
      symbol,
      hasResistance: !!s.resistanceLine,
      hasSupport: !!s.supportLine,
      atr: currentAtr,
      bars: s.aggBars.length,
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
    const s = this._s();
    if (ticker && ticker.lastPrice !== undefined) s.latestPrice = String(ticker.lastPrice);
    if (!s.latestPrice || !s.latestAtr) return;

    const price = s.latestPrice;
    const currentAtr = s.latestAtr;
    const symbol = this.getCurrentSymbol();

    // === Position open: manage exit ===
    if (s.positionSide !== null && s.entryPrice !== null) {
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
    if (s.resistanceLine) {
      const projected = s.resistanceLine.projected;
      const breakoutThreshold = add(projected, breakoutBuffer);

      if (isGreaterThan(price, breakoutThreshold)) {
        const slPrice = subtract(projected, slBuffer);
        const riskPerUnit = subtract(price, slPrice);
        const conf = this._calcConfidence('long', regime);

        const signal = {
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol,
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
            trendlineSlope: s.resistanceLine.slope,
            pivot1: s.resistanceLine.pivot1,
            pivot2: s.resistanceLine.pivot2,
            slPrice,
            atr: currentAtr,
            riskPerUnit,
            regime,
          },
        };

        this._enterPosition('long', price, slPrice);
        s.lastSignal = signal;
        this.emitSignal(signal);
        log.info('Long entry: resistance trendline breakout', {
          symbol, price, projected, sl: slPrice,
        });
        return;
      }
    }

    // --- Ascending support breakout → SHORT ---
    if (s.supportLine) {
      const projected = s.supportLine.projected;
      const breakoutThreshold = subtract(projected, breakoutBuffer);

      if (isLessThan(price, breakoutThreshold)) {
        const slPrice = add(projected, slBuffer);
        const riskPerUnit = subtract(slPrice, price);
        const conf = this._calcConfidence('short', regime);

        const signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol,
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
            trendlineSlope: s.supportLine.slope,
            pivot1: s.supportLine.pivot1,
            pivot2: s.supportLine.pivot2,
            slPrice,
            atr: currentAtr,
            riskPerUnit,
            regime,
          },
        };

        this._enterPosition('short', price, slPrice);
        s.lastSignal = signal;
        this.emitSignal(signal);
        log.info('Short entry: support trendline breakout', {
          symbol, price, projected, sl: slPrice,
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
    const s = this._s();
    const action = fill.action || (fill.signal && fill.signal.action);
    const symbol = this.getCurrentSymbol();

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.trendlineFrozen = true;
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.trendlineFrozen = true;
      log.trade('Short fill recorded', { entry: s.entryPrice, symbol });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: s.positionSide, symbol });
      this._resetPosition();
    }
  }

  /** @returns {object|null} */
  getSignal() {
    return this._s().lastSignal;
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
    const s = this._s();
    const symbol = this.getCurrentSymbol();

    // --- Hard stop loss ---
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'trendline_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'trendline_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop logic ---
    const { trailingActivationAtr, trailingDistanceAtr } = this.config;

    if (s.positionSide === 'long') {
      // Update highest price
      if (!s.highestSinceEntry || isGreaterThan(price, s.highestSinceEntry)) {
        s.highestSinceEntry = price;
        if (s.trailingActive) this._updateTrailingStop();
      }

      // Check trailing activation
      if (!s.trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = subtract(price, s.entryPrice);
        if (isGreaterThan(profit, actDist)) {
          s.trailingActive = true;
          s.highestSinceEntry = s.highestSinceEntry || price;
          this._updateTrailingStop();
          log.info('Trailing stop activated (long)', {
            symbol, trailingStopPrice: s.trailingStopPrice,
          });
        }
      }

      // Check trailing stop hit
      if (s.trailingActive && s.trailingStopPrice !== null) {
        if (isLessThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
            entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    } else if (s.positionSide === 'short') {
      // Update lowest price
      if (!s.lowestSinceEntry || isLessThan(price, s.lowestSinceEntry)) {
        s.lowestSinceEntry = price;
        if (s.trailingActive) this._updateTrailingStop();
      }

      // Check trailing activation
      if (!s.trailingActive) {
        const actDist = multiply(trailingActivationAtr, currentAtr);
        const profit = subtract(s.entryPrice, price);
        if (isGreaterThan(profit, actDist)) {
          s.trailingActive = true;
          s.lowestSinceEntry = s.lowestSinceEntry || price;
          this._updateTrailingStop();
          log.info('Trailing stop activated (short)', {
            symbol, trailingStopPrice: s.trailingStopPrice,
          });
        }
      }

      // Check trailing stop hit
      if (s.trailingActive && s.trailingStopPrice !== null) {
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
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Enter a position: set state and freeze trendlines.
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} slPrice
   */
  _enterPosition(side, price, slPrice) {
    const s = this._s();
    s.entryPrice = price;
    s.positionSide = side;
    s.stopPrice = slPrice;
    s.trailingActive = false;
    s.trailingStopPrice = null;
    s.trendlineFrozen = true;

    if (side === 'long') {
      s.highestSinceEntry = price;
      s.lowestSinceEntry = null;
    } else {
      s.highestSinceEntry = null;
      s.lowestSinceEntry = price;
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
    const s = this._s();
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action,
      symbol: this.getCurrentSymbol(),
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      confidence: toFixed('0.9000', 4),
      reduceOnly: true,
      reason,
      marketContext: { ...context, currentPrice: price, atr: s.latestAtr },
    };
    s.lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price (only ratchets in the favorable direction).
   */
  _updateTrailingStop() {
    const s = this._s();
    if (s.latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, s.latestAtr);

    if (s.positionSide === 'long' && s.highestSinceEntry !== null) {
      const ns = subtract(s.highestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isGreaterThan(ns, s.trailingStopPrice)) {
        s.trailingStopPrice = ns;
      }
    } else if (s.positionSide === 'short' && s.lowestSinceEntry !== null) {
      const ns = add(s.lowestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isLessThan(ns, s.trailingStopPrice)) {
        s.trailingStopPrice = ns;
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
    const s = this._s();
    let conf = 0.60;

    // Regime alignment bonus
    if (side === 'long' && regime === MARKET_REGIMES.TRENDING_UP) conf += 0.15;
    else if (side === 'short' && regime === MARKET_REGIMES.TRENDING_DOWN) conf += 0.15;
    else if (regime === MARKET_REGIMES.VOLATILE) conf += 0.05;

    // Slope steepness bonus (steeper = stronger breakout signal)
    const line = side === 'long' ? s.resistanceLine : s.supportLine;
    if (line && s.latestAtr) {
      const slopeAbs = abs(line.slope);
      // Normalize slope by ATR: steeper relative to volatility = higher confidence
      const normalizedSlope = parseFloat(divide(slopeAbs, s.latestAtr));
      if (normalizedSlope > 0.01) conf += Math.min(normalizedSlope * 5, 0.15);
    }

    return Math.min(conf, 1.0);
  }

  /** Reset all position-tracking state after exit. */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
    s.stopPrice = null;
    s.trailingActive = false;
    s.trailingStopPrice = null;
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
    s.trendlineFrozen = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('TrendlineBreakoutStrategy', TrendlineBreakoutStrategy);

module.exports = TrendlineBreakoutStrategy;
