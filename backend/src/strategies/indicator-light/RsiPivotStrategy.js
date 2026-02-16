'use strict';

/**
 * RsiPivotStrategy — RSI + Pivot Point reversal strategy (Bidirectional).
 *
 * Long  : Price <= Pivot S1 + RSI <= 30 → regime: TRENDING_DOWN or VOLATILE.
 * Short : Price >= Pivot R1 + RSI >= 70 → regime: TRENDING_UP or VOLATILE.
 * Exit  : TP +2 %, SL -2 %, RSI cross, or Pivot level reached.
 * Leverage: 3x, max position 5 % of equity.
 *
 * All price values are Strings; arithmetic via mathUtils.
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
  isGreaterThanOrEqual,
  isLessThanOrEqual,
  toFixed,
} = require('../../utils/mathUtils');
const { createLogger } = require('../../utils/logger');

class RsiPivotStrategy extends StrategyBase {
  // -------------------------------------------------------------------------
  // Static metadata
  // -------------------------------------------------------------------------

  static metadata = {
    name: 'RsiPivotStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile', 'ranging'],
    riskLevel: 'medium',
    maxConcurrentPositions: 2,
    cooldownMs: 60000,
    gracePeriodMs: 300000,
    description: 'RSI + Pivot 역추세 (양방향)',
    defaultConfig: {
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      leverage: 3,
      positionSizePercent: '5',
      tpPercent: '2',
      slPercent: '2',
    },
  };

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * @param {object} config
   * @param {number} [config.rsiPeriod=14]
   * @param {number} [config.rsiOversold=30]
   * @param {number} [config.rsiOverbought=70]
   * @param {number} [config.leverage=3]
   * @param {string} [config.positionSizePercent='5']
   * @param {string} [config.tpPercent='2']
   * @param {string} [config.slPercent='2']
   */
  constructor(config = {}) {
    const merged = { ...RsiPivotStrategy.metadata.defaultConfig, ...config };
    super('RsiPivotStrategy', merged);

    this._log = createLogger('RsiPivotStrategy');

    // Internal state --------------------------------------------------------

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {string|null} entry price of current position (null = no position) */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position side */
    this._positionSide = null;

    /**
     * Pivot levels derived from the previous daily candle.
     * @type {{ pp: string, s1: string, s2: string, r1: string, r2: string }|null}
     */
    this._pivotData = null;

    /**
     * Array of daily candle objects used for pivot calculation.
     * Each entry: { high: string, low: string, close: string, date: string }
     * @type {Array<{ high: string, low: string, close: string, date: string }>}
     */
    this._dailyCandles = [];

    /**
     * Accumulator for aggregating intraday klines into a daily candle.
     * @type {{ high: string, low: string, open: string, close: string, date: string }|null}
     */
    this._currentDayCandle = null;
  }

  // -------------------------------------------------------------------------
  // onTick — real-time ticker updates
  // -------------------------------------------------------------------------

  /**
   * Store the latest price and, if a position is open, check TP / SL
   * conditions in real-time (faster reaction than waiting for next kline).
   *
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (!ticker || ticker.lastPrice === undefined) return;

    this._latestPrice = String(ticker.lastPrice);

    // If we have an open position, evaluate TP / SL on every tick
    if (this._entryPrice !== null && this._positionSide !== null) {
      this._checkExitOnTick(this._latestPrice);
    }
  }

  // -------------------------------------------------------------------------
  // onKline — main signal logic (15-min candles)
  // -------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { close: string, high?: string, low?: string, timestamp?: number|string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    // 1. Track daily candles for pivot calculation ----------------------------
    this._aggregateDailyCandle(kline);

    const {
      rsiPeriod,
      rsiOversold,
      rsiOverbought,
      positionSizePercent,
      tpPercent,
      slPercent,
    } = this.config;

    // 2. Check IndicatorCache for sufficient history -------------------------
    const c = this._indicatorCache;
    const hist = c.getHistory(this._symbol);
    if (!hist || hist.closes.length < rsiPeriod + 1) {
      this._log.debug('Not enough data yet', {
        have: hist ? hist.closes.length : 0,
        needRsi: rsiPeriod + 1,
      });
      return;
    }

    // 3. Calculate RSI via IndicatorCache ------------------------------------
    const rsi = c.get(this._symbol, 'rsi', { period: rsiPeriod });

    // 4. Evaluate exit signals first (position is open) -----------------------
    if (this._entryPrice !== null && this._positionSide !== null) {
      if (this._positionSide === 'long') {
        // RSI overbought exit (long)
        if (isGreaterThanOrEqual(rsi, String(rsiOverbought))) {
          const confidence = this._rsiConfidence(parseFloat(rsi), rsiOverbought, 'overbought');
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            confidence,
            marketContext: { rsi, price: close, regime: this.getEffectiveRegime(), reason: 'rsi_overbought' },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }

        // Pivot R1 exit (long)
        if (this._pivotData !== null && isGreaterThan(close, this._pivotData.r1)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            confidence: '0.7500',
            marketContext: { rsi, price: close, pivotR1: this._pivotData.r1, regime: this.getEffectiveRegime(), reason: 'pivot_r1_reached' },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
      }

      if (this._positionSide === 'short') {
        // RSI oversold exit (short)
        if (isLessThanOrEqual(rsi, String(rsiOversold))) {
          const confidence = this._rsiConfidence(parseFloat(rsi), rsiOversold, 'oversold');
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            confidence,
            marketContext: { rsi, price: close, regime: this.getEffectiveRegime(), reason: 'rsi_oversold' },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }

        // Pivot S1 exit (short)
        if (this._pivotData !== null && isLessThan(close, this._pivotData.s1)) {
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            confidence: '0.7500',
            marketContext: { rsi, price: close, pivotS1: this._pivotData.s1, regime: this.getEffectiveRegime(), reason: 'pivot_s1_reached' },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
      }

      // TP / SL check on kline close as well
      this._checkExitOnTick(close);

      // If position is open, do not generate entry signals (no averaging down)
      return;
    }

    // 5. Entry signal logic (no position) -------------------------------------
    const regime = this.getEffectiveRegime();

    // Need pivot data
    if (this._pivotData === null) {
      this._log.debug('Skipping entry — pivot data not available yet');
      return;
    }

    // --- Long entry: TRENDING_DOWN or VOLATILE + below S1 + RSI oversold ---
    if (regime === null || regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE || regime === MARKET_REGIMES.RANGING) {
      const belowS1 = isLessThanOrEqual(close, this._pivotData.s1);
      const rsiOversoldMet = isLessThanOrEqual(rsi, String(rsiOversold));

      if (belowS1 && rsiOversoldMet) {
        const confidence = this._rsiConfidence(parseFloat(rsi), rsiOversold, 'oversold');
        const slPercent = this.config.slPercent || '2';
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          stopLossPrice: multiply(close, subtract('1', divide(slPercent, '100'))),
          confidence,
          marketContext: {
            rsi,
            price: close,
            pivotS1: this._pivotData.s1,
            pivotPP: this._pivotData.pp,
            regime,
          },
        };
        // AD-37: Do NOT set _positionSide/_entryPrice here — defer to onFill()
        this._lastSignal = signal;
        this.emitSignal(signal);
        return;
      }
    }

    // --- Short entry: TRENDING_UP or VOLATILE + above R1 + RSI overbought ---
    if (regime === null || regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE || regime === MARKET_REGIMES.RANGING) {
      const aboveR1 = isGreaterThanOrEqual(close, this._pivotData.r1);
      const rsiOverboughtMet = isGreaterThanOrEqual(rsi, String(rsiOverbought));

      if (aboveR1 && rsiOverboughtMet) {
        const confidence = this._rsiConfidence(parseFloat(rsi), rsiOverbought, 'overbought');
        const slPercent = this.config.slPercent || '2';
        const signal = {
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          stopLossPrice: multiply(close, add('1', divide(slPercent, '100'))),
          confidence,
          marketContext: {
            rsi,
            price: close,
            pivotR1: this._pivotData.r1,
            pivotPP: this._pivotData.pp,
            regime,
          },
        };
        // AD-37: Do NOT set _positionSide/_entryPrice here — defer to onFill()
        this._lastSignal = signal;
        this.emitSignal(signal);
      }
    }
  }

  // -------------------------------------------------------------------------
  // onFill — record entry price when our order is filled
  // -------------------------------------------------------------------------

  /**
   * @param {object} fill — { side, price, action, ... }
   */
  onFill(fill) {
    if (!fill) return;

    const price = fill.price !== undefined ? String(fill.price) : null;
    if (price === null) return;

    const action = fill.action || '';

    // AD-37: Open fills — set position state ONLY on confirmed fill
    if (action === SIGNAL_ACTIONS.OPEN_LONG || (fill.side === 'buy' && !this._positionSide)) {
      this._entryPrice = price;
      this._positionSide = 'long';
      this._log.trade('Long entry recorded', { entryPrice: this._entryPrice });
      return;
    }
    if (action === SIGNAL_ACTIONS.OPEN_SHORT || (fill.side === 'sell' && !this._positionSide)) {
      this._entryPrice = price;
      this._positionSide = 'short';
      this._log.trade('Short entry recorded', { entryPrice: this._entryPrice });
      return;
    }

    // Close fills
    if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      this._log.trade('Position closed', { side: this._positionSide, entryPrice: this._entryPrice, exitPrice: price });
      this._entryPrice = null;
      this._positionSide = null;
    }
  }

  // -------------------------------------------------------------------------
  // getSignal
  // -------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this._lastSignal;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Check TP / SL exit conditions based on the current price.
   * Supports both long and short positions.
   *
   * @param {string} currentPrice
   */
  _checkExitOnTick(currentPrice) {
    if (this._entryPrice === null || this._positionSide === null) return;

    const { positionSizePercent, tpPercent, slPercent } = this.config;
    let signal = null;

    if (this._positionSide === 'long') {
      const tpPrice = multiply(this._entryPrice, add('1', divide(tpPercent, '100')));
      const slPrice = multiply(this._entryPrice, subtract('1', divide(slPercent, '100')));

      if (isGreaterThanOrEqual(currentPrice, tpPrice)) {
        signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { price: currentPrice, entryPrice: this._entryPrice, tpPrice, regime: this.getEffectiveRegime(), reason: 'take_profit' },
        };
      } else if (isLessThanOrEqual(currentPrice, slPrice)) {
        signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { price: currentPrice, entryPrice: this._entryPrice, slPrice, regime: this.getEffectiveRegime(), reason: 'stop_loss' },
        };
      }
    } else if (this._positionSide === 'short') {
      const tpPrice = multiply(this._entryPrice, subtract('1', divide(tpPercent, '100')));
      const slPrice = multiply(this._entryPrice, add('1', divide(slPercent, '100')));

      if (isLessThanOrEqual(currentPrice, tpPrice)) {
        signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { price: currentPrice, entryPrice: this._entryPrice, tpPrice, regime: this.getEffectiveRegime(), reason: 'take_profit' },
        };
      } else if (isGreaterThanOrEqual(currentPrice, slPrice)) {
        signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol, category: this._category,
          suggestedQty: positionSizePercent, suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { price: currentPrice, entryPrice: this._entryPrice, slPrice, regime: this.getEffectiveRegime(), reason: 'stop_loss' },
        };
      }
    }

    if (signal) {
      this._lastSignal = signal;
      this.emitSignal(signal);
    }
  }

  /**
   * Aggregate 15-min klines into daily candles for pivot calculation.
   *
   * When a new day begins (date string changes), the previous day's candle
   * is finalised and pivot levels are recalculated.
   *
   * @param {object} kline — { high, low, close, open, timestamp }
   */
  _aggregateDailyCandle(kline) {
    // Derive the date string from the kline timestamp (or fall back to now)
    const ts = (kline.ts || kline.timestamp) ? new Date(Number(kline.ts || kline.timestamp)) : new Date();
    const dateStr = ts.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    const high = kline.high !== undefined ? String(kline.high) : null;
    const low = kline.low !== undefined ? String(kline.low) : null;
    const close = String(kline.close);
    const open = kline.open !== undefined ? String(kline.open) : null;

    if (this._currentDayCandle === null) {
      // First kline ever — start accumulating
      this._currentDayCandle = {
        date: dateStr,
        high: high || close,
        low: low || close,
        open: open || close,
        close,
      };
      return;
    }

    if (this._currentDayCandle.date === dateStr) {
      // Same day — update running high / low / close
      if (high !== null && isGreaterThan(high, this._currentDayCandle.high)) {
        this._currentDayCandle.high = high;
      }
      if (low !== null && isLessThan(low, this._currentDayCandle.low)) {
        this._currentDayCandle.low = low;
      }
      this._currentDayCandle.close = close;
    } else {
      // New day — finalise the previous daily candle
      this._dailyCandles.push({
        high: this._currentDayCandle.high,
        low: this._currentDayCandle.low,
        close: this._currentDayCandle.close,
        date: this._currentDayCandle.date,
      });

      // Keep only the last 5 daily candles (we only need 1, but keep a buffer)
      if (this._dailyCandles.length > 5) {
        this._dailyCandles = this._dailyCandles.slice(-5);
      }

      // Recalculate pivot from the completed daily candle
      const prevDay = this._dailyCandles[this._dailyCandles.length - 1];
      this._pivotData = this._calculatePivot(prevDay.high, prevDay.low, prevDay.close);

      this._log.info('Daily pivot recalculated', {
        date: prevDay.date,
        ...this._pivotData,
      });

      // Start new day accumulator
      this._currentDayCandle = {
        date: dateStr,
        high: high || close,
        low: low || close,
        open: open || close,
        close,
      };
    }
  }

  /**
   * Calculate standard pivot points from a daily OHLC candle.
   *
   * PP = (H + L + C) / 3
   * S1 = (2 * PP) - H
   * S2 = PP - (H - L)
   * R1 = (2 * PP) - L
   * R2 = PP + (H - L)
   *
   * @param {string} dailyHigh
   * @param {string} dailyLow
   * @param {string} dailyClose
   * @returns {{ pp: string, s1: string, s2: string, r1: string, r2: string }}
   */
  _calculatePivot(dailyHigh, dailyLow, dailyClose) {
    // PP = (H + L + C) / 3
    const sum = add(add(dailyHigh, dailyLow), dailyClose);
    const pp = divide(sum, '3');

    // Range = H - L
    const range = subtract(dailyHigh, dailyLow);

    // S1 = (2 * PP) - H
    const s1 = subtract(multiply('2', pp), dailyHigh);

    // S2 = PP - (H - L)
    const s2 = subtract(pp, range);

    // R1 = (2 * PP) - L
    const r1 = subtract(multiply('2', pp), dailyLow);

    // R2 = PP + (H - L)
    const r2 = add(pp, range);

    return {
      pp: toFixed(pp, 8),
      s1: toFixed(s1, 8),
      s2: toFixed(s2, 8),
      r1: toFixed(r1, 8),
      r2: toFixed(r2, 8),
    };
  }

  /**
   * Map RSI extremity to a confidence score between 0 and 1.
   * The further from the threshold, the higher the confidence.
   *
   * @param {number} rsiVal     — current RSI (float)
   * @param {number} threshold  — boundary value (e.g. 30 or 70)
   * @param {'oversold'|'overbought'} direction
   * @returns {string} confidence as String, 0.00-1.00
   */
  _rsiConfidence(rsiVal, threshold, direction) {
    let distance;

    if (direction === 'oversold') {
      // lower RSI = more extreme = higher confidence
      distance = Math.max(0, threshold - rsiVal);
    } else {
      // higher RSI = more extreme = higher confidence
      distance = Math.max(0, rsiVal - threshold);
    }

    // Normalize: 0-30 distance maps to 0.3-1.0 confidence
    const maxDistance = 30;
    const normalized = Math.min(distance / maxDistance, 1);
    const confidence = 0.3 + normalized * 0.7;

    return toFixed(String(Math.min(confidence, 1)), 4);
  }
}

// ---------------------------------------------------------------------------
// Register with the strategy registry
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('RsiPivotStrategy', RsiPivotStrategy);

module.exports = RsiPivotStrategy;
