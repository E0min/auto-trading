'use strict';

/**
 * MaTrendStrategy — Multi-timeframe EMA trend-following strategy with trailing stop.
 *
 * Uses daily EMA(20)/EMA(60), 4h EMA(20)/EMA(50), and 1h EMA(9)/EMA(21) to
 * identify strong trends and enter on pullbacks to the 1h slow EMA. Exits via
 * TP (+4%), SL (-2%), trailing stop (-2% from extreme), or EMA crossover reversal.
 *
 * Bidirectional (Long & Short). Leverage 3x, max position 5% of equity.
 */

const StrategyBase = require('../../services/strategyBase');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
  max,
  min,
} = require('../../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

const log = createLogger('MaTrendStrategy');

class MaTrendStrategy extends StrategyBase {
  static metadata = {
    name: 'MaTrendStrategy',
    description: '멀티타임프레임 EMA 추세추종 + 트레일링 스탑',
    defaultConfig: {
      h1FastEma: 9,
      h1SlowEma: 21,
      h4FastEma: 20,
      h4SlowEma: 50,
      dailyFastEma: 20,
      dailySlowEma: 60,
      trailingStopPercent: '2',
      positionSizePercent: '5',
      tpPercent: '4',
      slPercent: '2',
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...MaTrendStrategy.metadata.defaultConfig, ...config };
    super('MaTrendStrategy', merged);

    // EMA periods
    this._h1FastPeriod = merged.h1FastEma;
    this._h1SlowPeriod = merged.h1SlowEma;
    this._h4FastPeriod = merged.h4FastEma;
    this._h4SlowPeriod = merged.h4SlowEma;
    this._dailyFastPeriod = merged.dailyFastEma;
    this._dailySlowPeriod = merged.dailySlowEma;

    // Risk / sizing params
    this._trailingStopPercent = merged.trailingStopPercent;
    this._positionSizePercent = merged.positionSizePercent;
    this._tpPercent = merged.tpPercent;
    this._slPercent = merged.slPercent;

    // Price / volume buffers (1h candles)
    this._h1Closes = [];   // String[]
    this._h1Volumes = [];  // String[]

    // Aggregated higher-timeframe closes
    this._h4Closes = [];   // String[] — built from every 4 h1 candles
    this._dailyCloses = []; // String[] — built from every 24 h1 candles

    // Aggregation counter (how many h1 candles received since start)
    this._h1Count = 0;

    // Latest EMA values (String | null)
    this._h1Ema9 = null;
    this._h1Ema21 = null;
    this._h4Ema20 = null;
    this._h4Ema50 = null;
    this._dailyEma20 = null;
    this._dailyEma60 = null;

    // Signal state
    this._lastSignal = null;
    this._latestPrice = null;
    this._entryPrice = null;

    // Trailing stop tracking
    this._highestSinceEntry = null; // String — tracks highest price since long entry
    this._lowestSinceEntry = null;  // String — tracks lowest price since short entry

    // Maximum history to keep in buffers
    this._maxHistory = 500;

    // Last kline data for bounce/drop candle detection
    this._lastKline = null;
  }

  // ---------------------------------------------------------------------------
  // onTick — real-time price updates; trailing stop + TP/SL checks
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   * If a position is open, updates trailing stop tracking and checks exit conditions.
   *
   * @param {object} ticker — { lastPrice, ... }
   */
  onTick(ticker) {
    if (!this._active) return;

    const price = String(ticker.lastPrice || ticker.last || ticker.price);
    if (!price || price === 'undefined' || price === 'null') return;

    this._latestPrice = price;

    // No position open — nothing to check on tick
    if (!this._entryPrice) return;

    const action = this._lastSignal ? this._lastSignal.action : null;
    const isLong = action === SIGNAL_ACTIONS.OPEN_LONG;
    const isShort = action === SIGNAL_ACTIONS.OPEN_SHORT;

    if (!isLong && !isShort) return;

    // Update trailing stop tracking
    if (isLong) {
      this._highestSinceEntry = this._highestSinceEntry
        ? max(this._highestSinceEntry, price)
        : price;
    } else {
      this._lowestSinceEntry = this._lowestSinceEntry
        ? min(this._lowestSinceEntry, price)
        : price;
    }

    // --- Check trailing stop ---
    if (isLong && this._highestSinceEntry) {
      // trailingStop = highestSinceEntry * (1 - trailingStopPercent / 100)
      const trailFactor = subtract('1', divide(this._trailingStopPercent, '100'));
      const trailingStop = multiply(this._highestSinceEntry, trailFactor);
      if (isLessThan(price, trailingStop) || price === trailingStop) {
        log.trade('Trailing stop hit (long)', {
          price, highest: this._highestSinceEntry, trailingStop,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'trailing_stop');
        return;
      }
    }

    if (isShort && this._lowestSinceEntry) {
      // trailingStop = lowestSinceEntry * (1 + trailingStopPercent / 100)
      const trailFactor = add('1', divide(this._trailingStopPercent, '100'));
      const trailingStop = multiply(this._lowestSinceEntry, trailFactor);
      if (isGreaterThan(price, trailingStop) || price === trailingStop) {
        log.trade('Trailing stop hit (short)', {
          price, lowest: this._lowestSinceEntry, trailingStop,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'trailing_stop');
        return;
      }
    }

    // --- Check TP / SL ---
    if (isLong) {
      // TP: price >= entryPrice * (1 + tpPercent / 100)
      const tpPrice = multiply(this._entryPrice, add('1', divide(this._tpPercent, '100')));
      if (isGreaterThan(price, tpPrice) || price === tpPrice) {
        log.trade('Take profit hit (long)', { price, tp: tpPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'take_profit');
        return;
      }

      // SL: price <= entryPrice * (1 - slPercent / 100)
      const slPrice = multiply(this._entryPrice, subtract('1', divide(this._slPercent, '100')));
      if (isLessThan(price, slPrice) || price === slPrice) {
        log.trade('Stop loss hit (long)', { price, sl: slPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'stop_loss');
        return;
      }
    }

    if (isShort) {
      // TP: price <= entryPrice * (1 - tpPercent / 100)
      const tpPrice = multiply(this._entryPrice, subtract('1', divide(this._tpPercent, '100')));
      if (isLessThan(price, tpPrice) || price === tpPrice) {
        log.trade('Take profit hit (short)', { price, tp: tpPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'take_profit');
        return;
      }

      // SL: price >= entryPrice * (1 + slPercent / 100)
      const slPrice = multiply(this._entryPrice, add('1', divide(this._slPercent, '100')));
      if (isGreaterThan(price, slPrice) || price === slPrice) {
        log.trade('Stop loss hit (short)', { price, sl: slPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'stop_loss');
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // onKline — candlestick close; EMA computation & signal generation
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming kline (candlestick) update.
   * Aggregates 1h candles into 4h/daily, computes all EMAs, and generates signals.
   *
   * @param {object} kline — { close, volume, high, low, open }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = String(kline.close);
    const volume = String(kline.volume);
    const high = String(kline.high);
    const low = String(kline.low);
    const open = kline.open !== undefined ? String(kline.open) : close;

    // ------ 1) Push to 1h buffers and trim ------
    this._h1Closes.push(close);
    this._h1Volumes.push(volume);

    if (this._h1Closes.length > this._maxHistory) {
      this._h1Closes.splice(0, this._h1Closes.length - this._maxHistory);
    }
    if (this._h1Volumes.length > this._maxHistory) {
      this._h1Volumes.splice(0, this._h1Volumes.length - this._maxHistory);
    }

    // ------ 2) Increment aggregation counter ------
    this._h1Count += 1;

    // Aggregate to 4h (every 4 candles)
    if (this._h1Count % 4 === 0) {
      this._h4Closes.push(close);
      if (this._h4Closes.length > this._maxHistory) {
        this._h4Closes.splice(0, this._h4Closes.length - this._maxHistory);
      }
    }

    // Aggregate to daily (every 24 candles)
    if (this._h1Count % 24 === 0) {
      this._dailyCloses.push(close);
      if (this._dailyCloses.length > this._maxHistory) {
        this._dailyCloses.splice(0, this._dailyCloses.length - this._maxHistory);
      }
    }

    // ------ 3) Calculate all EMAs ------
    this._updateEmas();

    // Store kline for bounce/drop detection
    this._lastKline = { close, volume, high, low, open };

    // ------ 4) Check exit conditions on kline (EMA crossover + 4h trend break) ------
    if (this._entryPrice) {
      const exitSignal = this._checkKlineExit(close);
      if (exitSignal) return;
    }

    // ------ 5) Check entry conditions ------
    if (this._entryPrice) return; // Already in position — skip entry logic

    // Need all EMAs calculated to evaluate entry
    if (!this._h1Ema9 || !this._h1Ema21 ||
        !this._h4Ema20 || !this._h4Ema50 ||
        !this._dailyEma20 || !this._dailyEma60) {
      log.debug('Waiting for sufficient data to compute all EMAs');
      return;
    }

    // --- Pullback condition: price within EMA21 +/- 0.5% ---
    const ema21Upper = multiply(this._h1Ema21, '1.005');
    const ema21Lower = multiply(this._h1Ema21, '0.995');

    // --- Volume confirmation: current volume > 20-period average ---
    const volumeConfirm = this._checkVolumeConfirmation(volume);

    // --- Daily trend ---
    const dailyUptrend = isGreaterThan(this._dailyEma20, this._dailyEma60);
    const dailyDowntrend = isLessThan(this._dailyEma20, this._dailyEma60);

    // --- 4h trend ---
    const h4Uptrend = isGreaterThan(this._h4Ema20, this._h4Ema50);
    const h4Downtrend = isLessThan(this._h4Ema20, this._h4Ema50);

    // --- 1h short-term trend ---
    const h1Uptrend = isGreaterThan(this._h1Ema9, this._h1Ema21);
    const h1Downtrend = isLessThan(this._h1Ema9, this._h1Ema21);

    // --- Long entry check ---
    // Pullback: h1 low touches EMA21 +/- 0.5%
    const longPullback = !isLessThan(low, ema21Lower) && !isGreaterThan(low, ema21Upper);
    // Bounce candle: close > open (bullish)
    const bounceCandle = isGreaterThan(close, open);

    if (dailyUptrend && h4Uptrend && h1Uptrend &&
        longPullback && bounceCandle && volumeConfirm &&
        this._marketRegime === MARKET_REGIMES.TRENDING_UP) {
      log.trade('Long entry signal — multi-TF uptrend + pullback bounce', {
        symbol: this._symbol,
        close,
        h1Ema9: this._h1Ema9,
        h1Ema21: this._h1Ema21,
      });

      this._entryPrice = close;
      this._highestSinceEntry = close;
      this._lowestSinceEntry = null;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedPrice: close,
        confidence: '0.75',
        leverage: '3',
        positionSizePercent: this._positionSizePercent,
        marketContext: {
          regime: this._marketRegime,
          dailyTrend: 'up',
          h4Trend: 'up',
          h1Trend: 'up',
          h1Ema9: this._h1Ema9,
          h1Ema21: this._h1Ema21,
          h4Ema20: this._h4Ema20,
          h4Ema50: this._h4Ema50,
          dailyEma20: this._dailyEma20,
          dailyEma60: this._dailyEma60,
          tp: multiply(close, add('1', divide(this._tpPercent, '100'))),
          sl: multiply(close, subtract('1', divide(this._slPercent, '100'))),
        },
      };

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // --- Short entry check ---
    // Rally: h1 high touches EMA21 +/- 0.5%
    const shortRally = !isLessThan(high, ema21Lower) && !isGreaterThan(high, ema21Upper);
    // Drop candle: close < open (bearish)
    const dropCandle = isLessThan(close, open);

    if (dailyDowntrend && h4Downtrend && h1Downtrend &&
        shortRally && dropCandle && volumeConfirm &&
        this._marketRegime === MARKET_REGIMES.TRENDING_DOWN) {
      log.trade('Short entry signal — multi-TF downtrend + rally drop', {
        symbol: this._symbol,
        close,
        h1Ema9: this._h1Ema9,
        h1Ema21: this._h1Ema21,
      });

      this._entryPrice = close;
      this._lowestSinceEntry = close;
      this._highestSinceEntry = null;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedPrice: close,
        confidence: '0.75',
        leverage: '3',
        positionSizePercent: this._positionSizePercent,
        marketContext: {
          regime: this._marketRegime,
          dailyTrend: 'down',
          h4Trend: 'down',
          h1Trend: 'down',
          h1Ema9: this._h1Ema9,
          h1Ema21: this._h1Ema21,
          h4Ema20: this._h4Ema20,
          h4Ema50: this._h4Ema50,
          dailyEma20: this._dailyEma20,
          dailyEma60: this._dailyEma60,
          tp: multiply(close, subtract('1', divide(this._tpPercent, '100'))),
          sl: multiply(close, add('1', divide(this._slPercent, '100'))),
        },
      };

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // getSignal
  // ---------------------------------------------------------------------------

  /**
   * Return the most recent signal or null if none is pending.
   * @returns {object|null}
   */
  getSignal() {
    return this._lastSignal;
  }

  // ---------------------------------------------------------------------------
  // onFill — handle fill events to reset/update position state
  // ---------------------------------------------------------------------------

  /**
   * Called when an order fill is received.
   * Resets position tracking when a close signal is filled.
   *
   * @param {object} fill
   */
  onFill(fill) {
    if (!this._active) return;

    const action = fill.action || (fill.signal && fill.signal.action);
    if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      this._resetPosition();
    }
  }

  // ---------------------------------------------------------------------------
  // EMA calculations (String-based)
  // ---------------------------------------------------------------------------

  /**
   * Single-step EMA update.
   * Formula: EMA = price * k + prevEma * (1 - k)  where k = 2 / (period + 1)
   *
   * @param {string} prevEma — previous EMA value
   * @param {string} price   — current price
   * @param {number} period  — EMA period
   * @returns {string} — updated EMA value
   */
  _calculateEma(prevEma, price, period) {
    // k = 2 / (period + 1)
    const k = divide('2', String(period + 1));
    // EMA = price * k + prevEma * (1 - k)
    const oneMinusK = subtract('1', k);
    return add(multiply(price, k), multiply(prevEma, oneMinusK));
  }

  /**
   * Calculate EMA over a full array of prices (for initialization).
   * Uses SMA of the first `period` values as the seed, then iterates.
   *
   * @param {string[]} prices — array of price strings
   * @param {number} period   — EMA period
   * @returns {string|null} — latest EMA value, or null if insufficient data
   */
  _calculateEmaFromArray(prices, period) {
    if (prices.length < period) return null;

    // SMA seed from the first `period` values
    let sum = '0';
    for (let i = 0; i < period; i++) {
      sum = add(sum, prices[i]);
    }
    let ema = divide(sum, String(period));

    // Iterate remaining prices through the single-step EMA
    for (let i = period; i < prices.length; i++) {
      ema = this._calculateEma(ema, prices[i], period);
    }

    return ema;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Recalculate all EMA values from current buffers.
   * Uses incremental update if a previous EMA exists, otherwise computes from full array.
   * @private
   */
  _updateEmas() {
    const h1Len = this._h1Closes.length;

    // --- 1h EMAs (update incrementally when possible) ---
    if (h1Len >= this._h1FastPeriod) {
      if (this._h1Ema9 !== null) {
        this._h1Ema9 = this._calculateEma(
          this._h1Ema9, this._h1Closes[h1Len - 1], this._h1FastPeriod,
        );
      } else {
        this._h1Ema9 = this._calculateEmaFromArray(this._h1Closes, this._h1FastPeriod);
      }
    }

    if (h1Len >= this._h1SlowPeriod) {
      if (this._h1Ema21 !== null) {
        this._h1Ema21 = this._calculateEma(
          this._h1Ema21, this._h1Closes[h1Len - 1], this._h1SlowPeriod,
        );
      } else {
        this._h1Ema21 = this._calculateEmaFromArray(this._h1Closes, this._h1SlowPeriod);
      }
    }

    // --- 4h EMAs ---
    const h4Len = this._h4Closes.length;

    if (h4Len >= this._h4FastPeriod) {
      if (this._h4Ema20 !== null) {
        this._h4Ema20 = this._calculateEma(
          this._h4Ema20, this._h4Closes[h4Len - 1], this._h4FastPeriod,
        );
      } else {
        this._h4Ema20 = this._calculateEmaFromArray(this._h4Closes, this._h4FastPeriod);
      }
    }

    if (h4Len >= this._h4SlowPeriod) {
      if (this._h4Ema50 !== null) {
        this._h4Ema50 = this._calculateEma(
          this._h4Ema50, this._h4Closes[h4Len - 1], this._h4SlowPeriod,
        );
      } else {
        this._h4Ema50 = this._calculateEmaFromArray(this._h4Closes, this._h4SlowPeriod);
      }
    }

    // --- Daily EMAs ---
    const dLen = this._dailyCloses.length;

    if (dLen >= this._dailyFastPeriod) {
      if (this._dailyEma20 !== null) {
        this._dailyEma20 = this._calculateEma(
          this._dailyEma20, this._dailyCloses[dLen - 1], this._dailyFastPeriod,
        );
      } else {
        this._dailyEma20 = this._calculateEmaFromArray(this._dailyCloses, this._dailyFastPeriod);
      }
    }

    if (dLen >= this._dailySlowPeriod) {
      if (this._dailyEma60 !== null) {
        this._dailyEma60 = this._calculateEma(
          this._dailyEma60, this._dailyCloses[dLen - 1], this._dailySlowPeriod,
        );
      } else {
        this._dailyEma60 = this._calculateEmaFromArray(this._dailyCloses, this._dailySlowPeriod);
      }
    }
  }

  /**
   * Check whether the current volume exceeds the 20-period average.
   *
   * @param {string} currentVolume
   * @returns {boolean}
   * @private
   */
  _checkVolumeConfirmation(currentVolume) {
    const lookback = 20;
    if (this._h1Volumes.length < lookback) return false;

    // Calculate simple moving average of the last 20 volumes
    let sum = '0';
    const start = this._h1Volumes.length - lookback;
    for (let i = start; i < this._h1Volumes.length; i++) {
      sum = add(sum, this._h1Volumes[i]);
    }
    const avgVolume = divide(sum, String(lookback));

    return isGreaterThan(currentVolume, avgVolume);
  }

  /**
   * Check kline-based exit conditions: EMA crossover reversal and 4h trend break.
   *
   * @param {string} close — current candle close price
   * @returns {boolean} — true if an exit signal was emitted
   * @private
   */
  _checkKlineExit(close) {
    if (!this._h1Ema9 || !this._h1Ema21) return false;

    const action = this._lastSignal ? this._lastSignal.action : null;
    const isLong = action === SIGNAL_ACTIONS.OPEN_LONG;
    const isShort = action === SIGNAL_ACTIONS.OPEN_SHORT;

    // 1h EMA crossover reversal
    if (isLong && isLessThan(this._h1Ema9, this._h1Ema21)) {
      log.trade('EMA crossover reversal — closing long', {
        h1Ema9: this._h1Ema9, h1Ema21: this._h1Ema21,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'ema_crossover');
      return true;
    }

    if (isShort && isGreaterThan(this._h1Ema9, this._h1Ema21)) {
      log.trade('EMA crossover reversal — closing short', {
        h1Ema9: this._h1Ema9, h1Ema21: this._h1Ema21,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, close, 'ema_crossover');
      return true;
    }

    // 4h trend break
    if (this._h4Ema20 && this._h4Ema50) {
      if (isLong && isLessThan(this._h4Ema20, this._h4Ema50)) {
        log.trade('4h trend break — closing long', {
          h4Ema20: this._h4Ema20, h4Ema50: this._h4Ema50,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'h4_trend_break');
        return true;
      }

      if (isShort && isGreaterThan(this._h4Ema20, this._h4Ema50)) {
        log.trade('4h trend break — closing short', {
          h4Ema20: this._h4Ema20, h4Ema50: this._h4Ema50,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, close, 'h4_trend_break');
        return true;
      }
    }

    return false;
  }

  /**
   * Emit an exit (close) signal and reset position tracking.
   *
   * @param {string} action — SIGNAL_ACTIONS.CLOSE_LONG or CLOSE_SHORT
   * @param {string} price  — current price
   * @param {string} reason — human-readable exit reason
   * @private
   */
  _emitExit(action, price, reason) {
    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedPrice: price,
      confidence: '1.00',
      reason,
      reduceOnly: true,
      marketContext: {
        regime: this._marketRegime,
        entryPrice: this._entryPrice,
        exitPrice: price,
        highestSinceEntry: this._highestSinceEntry,
        lowestSinceEntry: this._lowestSinceEntry,
      },
    };

    this._lastSignal = signal;
    this.emitSignal(signal);
    this._resetPosition();
  }

  /**
   * Reset all position-related state.
   * @private
   */
  _resetPosition() {
    this._entryPrice = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the global strategy registry
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('MaTrendStrategy', MaTrendStrategy);

module.exports = MaTrendStrategy;
