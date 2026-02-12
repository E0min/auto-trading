'use strict';

/**
 * RsiPivotStrategy — RSI + Pivot Point reversal strategy (Long Only).
 *
 * Entry : BTC drops below Pivot S1, altcoin RSI(14) <= 30, altcoin also dropping.
 * Exit  : TP +2 %, SL -2 %, RSI >= 70, or Pivot R1 reached.
 * Regime: TRENDING_DOWN or VOLATILE only.
 * Leverage: 3x, max position 5 % of equity.
 *
 * All price values are Strings; arithmetic via mathUtils.
 */

const StrategyBase = require('../services/strategyBase');
const {
  SIGNAL_ACTIONS,
  MARKET_REGIMES,
} = require('../utils/constants');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
} = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

class RsiPivotStrategy extends StrategyBase {
  // -------------------------------------------------------------------------
  // Static metadata
  // -------------------------------------------------------------------------

  static metadata = {
    name: 'RsiPivotStrategy',
    description: 'RSI + Pivot 역추세 (롱 전용)',
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
   * @param {object} opts
   * @param {number} [opts.rsiPeriod=14]
   * @param {number} [opts.rsiOversold=30]
   * @param {number} [opts.rsiOverbought=70]
   * @param {number} [opts.leverage=3]
   * @param {string} [opts.positionSizePercent='5']
   * @param {string} [opts.tpPercent='2']
   * @param {string} [opts.slPercent='2']
   */
  constructor({
    rsiPeriod = 14,
    rsiOversold = 30,
    rsiOverbought = 70,
    leverage = 3,
    positionSizePercent = '5',
    tpPercent = '2',
    slPercent = '2',
  } = {}) {
    super('RsiPivotStrategy', {
      rsiPeriod,
      rsiOversold,
      rsiOverbought,
      leverage,
      positionSizePercent,
      tpPercent,
      slPercent,
    });

    this._log = createLogger('RsiPivotStrategy');

    // Internal state --------------------------------------------------------

    /** @type {string[]} close prices (15 min candle) as Strings */
    this.priceHistory = [];

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {string|null} entry price of current position (null = no position) */
    this._entryPrice = null;

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

    /** Maximum number of close prices kept in memory */
    this._maxHistory = rsiPeriod + 50;
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
    if (this._entryPrice !== null) {
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

    // 1. Push close to price history, trim to max length ----------------------
    this.priceHistory.push(close);
    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }

    // 2. Track daily candles for pivot calculation ----------------------------
    this._aggregateDailyCandle(kline);

    const {
      rsiPeriod,
      rsiOversold,
      rsiOverbought,
      positionSizePercent,
      tpPercent,
      slPercent,
    } = this.config;

    // Need at least rsiPeriod + 1 prices for RSI
    if (this.priceHistory.length < rsiPeriod + 1) {
      this._log.debug('Not enough data yet', {
        have: this.priceHistory.length,
        needRsi: rsiPeriod + 1,
      });
      return;
    }

    // 3. Calculate RSI --------------------------------------------------------
    const rsi = this._calculateRsi(rsiPeriod);

    // 4. Evaluate exit signals first (position is open) -----------------------
    if (this._entryPrice !== null) {
      // RSI overbought exit
      if (isGreaterThan(rsi, String(rsiOverbought)) || rsi === String(rsiOverbought)) {
        const confidence = this._rsiConfidence(parseFloat(rsi), rsiOverbought, 'overbought');
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence,
          marketContext: { rsi, price: close, regime: this._marketRegime, reason: 'rsi_overbought' },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        return;
      }

      // Pivot R1 exit
      if (this._pivotData !== null && isGreaterThan(close, this._pivotData.r1)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence: '0.7500',
          marketContext: { rsi, price: close, pivotR1: this._pivotData.r1, regime: this._marketRegime, reason: 'pivot_r1_reached' },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        return;
      }

      // TP / SL check on kline close as well
      this._checkExitOnTick(close);

      // If position is open, do not generate entry signals (no averaging down)
      return;
    }

    // 5. Entry signal logic (no position) -------------------------------------
    const regime = this._marketRegime;

    // Only enter during TRENDING_DOWN or VOLATILE regimes
    if (regime !== MARKET_REGIMES.TRENDING_DOWN && regime !== MARKET_REGIMES.VOLATILE) {
      this._log.debug('Skipping entry — regime not suitable for reversal', { regime });
      return;
    }

    // Need pivot data to check S1
    if (this._pivotData === null) {
      this._log.debug('Skipping entry — pivot data not available yet');
      return;
    }

    // Entry conditions:
    // a) Price near or below Pivot S1 (BTC proxy: we check the traded altcoin
    //    against its own pivot S1 — the BTC correlation filter is handled
    //    externally by CoinSelector / BotService).
    // b) RSI <= oversold
    const belowS1 = isLessThan(close, this._pivotData.s1) || close === this._pivotData.s1;
    const rsiOversoldMet = isLessThan(rsi, String(rsiOversold)) || rsi === String(rsiOversold);

    if (belowS1 && rsiOversoldMet) {
      const confidence = this._rsiConfidence(parseFloat(rsi), rsiOversold, 'oversold');
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        confidence,
        marketContext: {
          rsi,
          price: close,
          pivotS1: this._pivotData.s1,
          pivotPP: this._pivotData.pp,
          regime,
        },
      };
      this._lastSignal = signal;
      this.emitSignal(signal);
    }
  }

  // -------------------------------------------------------------------------
  // onFill — record entry price when our order is filled
  // -------------------------------------------------------------------------

  /**
   * @param {object} fill — { side, price, ... }
   */
  onFill(fill) {
    if (!fill) return;

    const price = fill.price !== undefined ? String(fill.price) : null;
    if (price === null) return;

    // If this is a long entry fill, record the entry price
    if (fill.side === 'buy' && this._entryPrice === null) {
      this._entryPrice = price;
      this._log.trade('Entry price recorded', { entryPrice: this._entryPrice });
    }

    // If this is a close (sell), clear the entry price
    if (fill.side === 'sell' && this._entryPrice !== null) {
      this._log.trade('Position closed', { entryPrice: this._entryPrice, exitPrice: price });
      this._entryPrice = null;
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
   * Emits a CLOSE_LONG signal when triggered.
   *
   * @param {string} currentPrice
   */
  _checkExitOnTick(currentPrice) {
    if (this._entryPrice === null) return;

    const { positionSizePercent, tpPercent, slPercent } = this.config;

    // TP price = entryPrice * (1 + tpPercent / 100)
    const tpMultiplier = add('1', divide(tpPercent, '100'));
    const tpPrice = multiply(this._entryPrice, tpMultiplier);

    // SL price = entryPrice * (1 - slPercent / 100)
    const slMultiplier = subtract('1', divide(slPercent, '100'));
    const slPrice = multiply(this._entryPrice, slMultiplier);

    let signal = null;

    // Take-profit hit
    if (isGreaterThan(currentPrice, tpPrice) || currentPrice === tpPrice) {
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: currentPrice,
        confidence: '0.9500',
        marketContext: {
          price: currentPrice,
          entryPrice: this._entryPrice,
          tpPrice,
          regime: this._marketRegime,
          reason: 'take_profit',
        },
      };
    }
    // Stop-loss hit
    else if (isLessThan(currentPrice, slPrice) || currentPrice === slPrice) {
      signal = {
        action: SIGNAL_ACTIONS.CLOSE_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: currentPrice,
        confidence: '0.9500',
        marketContext: {
          price: currentPrice,
          entryPrice: this._entryPrice,
          slPrice,
          regime: this._marketRegime,
          reason: 'stop_loss',
        },
      };
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
    const ts = kline.timestamp ? new Date(Number(kline.timestamp)) : new Date();
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
   * Compute RSI over the last `period` price changes.
   * Same approach as MomentumStrategy._calculateRsi (String-based).
   *
   * @param {number} period
   * @returns {string} RSI as a String (0-100)
   */
  _calculateRsi(period) {
    const prices = this.priceHistory;
    const len = prices.length;

    // We need period + 1 prices to get period changes
    const startIdx = len - period - 1;
    let sumGain = '0';
    let sumLoss = '0';

    for (let i = startIdx; i < len - 1; i++) {
      const diff = subtract(prices[i + 1], prices[i]);
      if (isGreaterThan(diff, '0')) {
        sumGain = add(sumGain, diff);
      } else if (isLessThan(diff, '0')) {
        // losses stored as positive values
        sumLoss = add(sumLoss, subtract('0', diff));
      }
    }

    const avgGain = divide(sumGain, String(period));
    const avgLoss = divide(sumLoss, String(period));

    // If avgLoss is zero, RSI = 100
    if (!isGreaterThan(avgLoss, '0')) {
      return '100';
    }

    // If avgGain is zero, RSI = 0
    if (!isGreaterThan(avgGain, '0')) {
      return '0';
    }

    const rs = divide(avgGain, avgLoss);
    // RSI = 100 - (100 / (1 + RS))
    const onePlusRs = add('1', rs);
    const rsiDenom = divide('100', onePlusRs);
    const rsi = subtract('100', rsiDenom);

    return toFixed(rsi, 4);
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

const registry = require('../services/strategyRegistry');
registry.register('RsiPivotStrategy', RsiPivotStrategy);

module.exports = RsiPivotStrategy;
