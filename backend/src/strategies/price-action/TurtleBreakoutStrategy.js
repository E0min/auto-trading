'use strict';

/**
 * TurtleBreakoutStrategy — Donchian Channel Breakout (터틀 트레이딩 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE
 * Core concept: Pure price-action trend-following based on the classic
 * Turtle Trading system by Richard Dennis / William Eckhardt.
 *
 * Donchian Channels:
 *   - Entry channel: 20-bar high / low
 *   - Exit channel:  10-bar high / low
 *
 * Entry Long:
 *   - Price breaks above 20-bar high (Donchian upper)
 *   - 50-bar trend filter: close > 50-bar Donchian midline
 *   - Regime is TRENDING_UP, TRENDING_DOWN, or VOLATILE (not QUIET/RANGING)
 *
 * Entry Short:
 *   - Price breaks below 20-bar low (Donchian lower)
 *   - 50-bar trend filter: close < 50-bar Donchian midline
 *   - Regime is TRENDING_UP, TRENDING_DOWN, or VOLATILE
 *
 * Exit Long:
 *   - Price drops below 10-bar low (exit channel lower)
 *   - OR trailing stop / ATR-based stop hit
 *
 * Exit Short:
 *   - Price rises above 10-bar high (exit channel upper)
 *   - OR trailing stop / ATR-based stop hit
 *
 * Stop Loss: ATR(20) × stopMultiplier (default 2)
 * Position Sizing: passes riskPerUnit = ATR × stopMultiplier to ExposureGuard
 *   so the 2% risk-per-trade rule is applied at the risk-engine level.
 *
 * Trailing Stop: after 2×ATR profit, trail at 2×ATR from highest/lowest
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

const log = createLogger('TurtleBreakoutStrategy');

class TurtleBreakoutStrategy extends StrategyBase {
  static metadata = {
    name: 'TurtleBreakoutStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 300000,
    description: '터틀 트레이딩 — Donchian 채널 돌파 + ATR 기반 2% 리스크 룰',
    defaultConfig: {
      entryChannel: 20,       // Donchian entry channel period (N-bar high/low)
      exitChannel: 10,        // Donchian exit channel period
      trendFilter: 50,        // Long-term Donchian for trend filter
      atrPeriod: 20,          // ATR calculation period
      stopMultiplier: '2',    // ATR × N = stop loss distance
      trailingActivationAtr: '2',  // Activate trailing after N×ATR profit
      trailingDistanceAtr: '2',    // Trail at N×ATR from extreme
      positionSizePercent: '4',    // Fallback position size (ExposureGuard overrides via riskPerUnit)
      leverage: '3',
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...TurtleBreakoutStrategy.metadata.defaultConfig, ...config };
    super('TurtleBreakoutStrategy', merged);

    // ---- Internal state ----

    /** @type {Array<{high:string, low:string, close:string}>} kline history */
    this.klineHistory = [];

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} entry price */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;

    /** @type {string|null} ATR-based stop loss price */
    this._stopPrice = null;

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

    /** @type {number} max data points to keep */
    this._maxHistory = 200;
  }

  // --------------------------------------------------------------------------
  // Donchian Channel helpers — pure price-action, no lagging indicators
  // --------------------------------------------------------------------------

  /**
   * Compute Donchian Channel (N-bar high / low) from kline history.
   * Uses the PREVIOUS N bars (excludes the current/latest bar) so that
   * breakout detection compares the current close against prior range.
   * @param {number} period
   * @returns {{ upper: string, lower: string, mid: string }|null}
   */
  _donchian(period) {
    // Need at least period + 1 bars (period previous + 1 current)
    if (this.klineHistory.length < period + 1) return null;

    const slice = this.klineHistory.slice(-(period + 1), -1);
    let highest = slice[0].high;
    let lowest = slice[0].low;

    for (let i = 1; i < slice.length; i++) {
      if (isGreaterThan(slice[i].high, highest)) highest = slice[i].high;
      if (isLessThan(slice[i].low, lowest)) lowest = slice[i].low;
    }

    const mid = divide(add(highest, lowest), '2');
    return { upper: highest, lower: lowest, mid };
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / trailing stop checks
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }

    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const price = this._latestPrice;

    // --- Hard stop loss (ATR-based) ---
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'atr_stop_loss', {
          entryPrice: this._entryPrice,
          stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'atr_stop_loss', {
          entryPrice: this._entryPrice,
          stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop check ---
    if (this._trailingActive && this._trailingStopPrice !== null) {
      if (this._positionSide === 'long') {
        if (this._highestSinceEntry === null || isGreaterThan(price, this._highestSinceEntry)) {
          this._highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, this._trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
            entryPrice: this._entryPrice,
            trailingStopPrice: this._trailingStopPrice,
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
            entryPrice: this._entryPrice,
            trailingStopPrice: this._trailingStopPrice,
          });
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
   * @param {object} kline — must have { high, low, close }
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

    // 2. Need enough data for the longest channel + ATR
    const { entryChannel, exitChannel, trendFilter, atrPeriod } = this.config;
    const minRequired = Math.max(trendFilter + 1, entryChannel + 1, exitChannel + 1, atrPeriod + 1);
    if (this.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', {
        have: this.klineHistory.length,
        need: minRequired,
      });
      return;
    }

    // 3. Compute Donchian channels and ATR
    const entryDC = this._donchian(entryChannel);
    const exitDC = this._donchian(exitChannel);
    const trendDC = this._donchian(trendFilter);
    const currentAtr = atr(this.klineHistory, atrPeriod);

    if (!entryDC || !exitDC || !trendDC || currentAtr === null) return;

    this._latestAtr = currentAtr;
    const price = close;
    const { stopMultiplier, positionSizePercent, trailingActivationAtr, trailingDistanceAtr } = this.config;

    // 4. If position open: check Donchian exit channel + trailing activation
    if (this._positionSide !== null && this._entryPrice !== null) {
      // Update extreme prices
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

      // Donchian exit channel: 10-bar low for longs, 10-bar high for shorts
      if (this._positionSide === 'long' && isLessThan(price, exitDC.lower)) {
        this._emitCloseSignal('long', price, 'donchian_exit', {
          entryPrice: this._entryPrice,
          exitChannelLower: exitDC.lower,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, exitDC.upper)) {
        this._emitCloseSignal('short', price, 'donchian_exit', {
          entryPrice: this._entryPrice,
          exitChannelUpper: exitDC.upper,
        });
        this._resetPosition();
        return;
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
              symbol: this._symbol,
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        } else if (this._positionSide === 'short') {
          const profit = subtract(this._entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            this._trailingActive = true;
            this._lowestSinceEntry = this._lowestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (short)', {
              symbol: this._symbol,
              trailingStopPrice: this._trailingStopPrice,
            });
          }
        }
      }

      return; // Position open — no new entries
    }

    // 5. No position: check entry conditions

    // Regime filter: only trending or volatile markets
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.TRENDING_UP ||
      regime === MARKET_REGIMES.TRENDING_DOWN ||
      regime === MARKET_REGIMES.VOLATILE;
    if (!regimeOk) return;

    // riskPerUnit = ATR × stopMultiplier → passed to ExposureGuard for 2% rule
    const riskPerUnit = multiply(currentAtr, stopMultiplier);

    // --- Long entry: close breaks above 20-bar high + trend filter (above 50-bar midline) ---
    if (
      isGreaterThan(price, entryDC.upper) &&
      isGreaterThan(price, trendDC.mid)
    ) {
      const slPrice = subtract(price, riskPerUnit);
      const conf = this._calcConfidence(price, entryDC, trendDC, currentAtr);

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'donchian_breakout_long',
        marketContext: {
          entryChannelUpper: entryDC.upper,
          entryChannelLower: entryDC.lower,
          trendMid: trendDC.mid,
          exitChannelLower: exitDC.lower,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'long';
      this._stopPrice = slPrice;
      this._highestSinceEntry = high;
      this._lowestSinceEntry = null;
      this._trailingActive = false;
      this._trailingStopPrice = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // --- Short entry: close breaks below 20-bar low + trend filter (below 50-bar midline) ---
    if (
      isLessThan(price, entryDC.lower) &&
      isLessThan(price, trendDC.mid)
    ) {
      const slPrice = add(price, riskPerUnit);
      const conf = this._calcConfidence(price, entryDC, trendDC, currentAtr);

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: 'donchian_breakout_short',
        marketContext: {
          entryChannelUpper: entryDC.upper,
          entryChannelLower: entryDC.lower,
          trendMid: trendDC.mid,
          exitChannelUpper: exitDC.upper,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          regime,
        },
      };

      this._entryPrice = price;
      this._positionSide = 'short';
      this._stopPrice = slPrice;
      this._highestSinceEntry = null;
      this._lowestSinceEntry = low;
      this._trailingActive = false;
      this._trailingStopPrice = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // --------------------------------------------------------------------------
  // onFill
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  getSignal() {
    return this._lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

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
      marketContext: {
        ...context,
        currentPrice: price,
        atr: this._latestAtr,
      },
    };
    this._lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price based on extreme price and ATR.
   */
  _updateTrailingStop() {
    if (this._latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, this._latestAtr);

    if (this._positionSide === 'long' && this._highestSinceEntry !== null) {
      const newStop = subtract(this._highestSinceEntry, trailDist);
      // Only move stop up, never down
      if (this._trailingStopPrice === null || isGreaterThan(newStop, this._trailingStopPrice)) {
        this._trailingStopPrice = newStop;
      }
    } else if (this._positionSide === 'short' && this._lowestSinceEntry !== null) {
      const newStop = add(this._lowestSinceEntry, trailDist);
      // Only move stop down, never up
      if (this._trailingStopPrice === null || isLessThan(newStop, this._trailingStopPrice)) {
        this._trailingStopPrice = newStop;
      }
    }
  }

  /**
   * Calculate confidence based on breakout strength and trend alignment.
   *
   * @param {string} price
   * @param {object} entryDC — entry Donchian channel
   * @param {object} trendDC — trend filter Donchian channel
   * @param {string} currentAtr
   * @returns {number} confidence 0.50-1.00
   */
  _calcConfidence(price, entryDC, trendDC, currentAtr) {
    let conf = 0.55; // Base

    // Breakout magnitude: how far beyond channel (relative to ATR)
    const channelWidth = subtract(entryDC.upper, entryDC.lower);
    if (isGreaterThan(channelWidth, '0')) {
      const breakoutDist = isGreaterThan(price, entryDC.upper)
        ? subtract(price, entryDC.upper)
        : subtract(entryDC.lower, price);
      const breakoutRatio = parseFloat(divide(breakoutDist, currentAtr));
      conf += Math.min(breakoutRatio * 0.10, 0.15);
    }

    // Trend alignment: distance from trend midline (0-0.15)
    const trendWidth = subtract(trendDC.upper, trendDC.lower);
    if (isGreaterThan(trendWidth, '0')) {
      const distFromMid = abs(subtract(price, trendDC.mid));
      const trendStrength = parseFloat(divide(distFromMid, divide(trendWidth, '2')));
      conf += Math.min(trendStrength * 0.10, 0.15);
    }

    // Regime bonus
    if (this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP || this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN) {
      conf += 0.10;
    }

    return Math.min(conf, 1.0);
  }

  /**
   * Reset all position-tracking state after a full exit.
   */
  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._stopPrice = null;
    this._trailingActive = false;
    this._trailingStopPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('TurtleBreakoutStrategy', TurtleBreakoutStrategy);

module.exports = TurtleBreakoutStrategy;
