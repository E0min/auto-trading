'use strict';

/**
 * AdaptiveRegimeStrategy — 장세 적응형 멀티전략.
 *
 * Automatically switches trading mode when the market regime changes:
 *
 * | Regime         | Mode            | Long Entry                              | Short Entry                              |
 * |----------------|-----------------|-----------------------------------------|------------------------------------------|
 * | TRENDING_UP    | Trend-following | EMA9>EMA21 + RSI 40-50 pullback + ADX>25| None                                     |
 * | TRENDING_DOWN  | Trend-following | None                                    | EMA9<EMA21 + RSI 50-60 rally + ADX>25    |
 * | RANGING        | Mean-reversion  | Price < BB lower + RSI<35               | Price > BB upper + RSI>65                |
 * | VOLATILE       | Momentum        | RSI<25 oversold bounce + volume surge   | RSI>75 overbought rejection + volume surge|
 * | QUIET          | Wait            | None (data accumulation only)           | None                                     |
 *
 * Dynamic TP/SL/trailing based on ATR per regime.
 * Position sizing and leverage vary by regime.
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
  max,
  min,
} = require('../../utils/mathUtils');
const { emaStep } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('AdaptiveRegimeStrategy');

class AdaptiveRegimeStrategy extends StrategyBase {
  static metadata = {
    name: 'AdaptiveRegimeStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 120000,
    description: '장세 적응형 멀티전략 — 시장 국면에 따라 자동으로 매매 모드 전환',
    defaultConfig: {
      emaPeriodFast: 9,
      emaPeriodSlow: 21,
      rsiPeriod: 14,
      atrPeriod: 14,
      adxPeriod: 14,
      bbPeriod: 20,
      bbStdDev: 2,
      trendPositionSizePercent: '3',
      rangePositionSizePercent: '2',
      volatilePositionSizePercent: '4',
      trendLeverage: '3',
      rangeLeverage: '2',
      volatileLeverage: '3',
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...AdaptiveRegimeStrategy.metadata.defaultConfig, ...config };
    super('AdaptiveRegimeStrategy', merged);

    // Indicator periods
    this._emaPeriodFast = merged.emaPeriodFast;
    this._emaPeriodSlow = merged.emaPeriodSlow;
    this._rsiPeriod = merged.rsiPeriod;
    this._atrPeriod = merged.atrPeriod;
    this._adxPeriod = merged.adxPeriod;
    this._bbPeriod = merged.bbPeriod;
    this._bbStdDev = merged.bbStdDev;

    // Risk params per regime
    this._trendPositionSizePercent = merged.trendPositionSizePercent;
    this._rangePositionSizePercent = merged.rangePositionSizePercent;
    this._volatilePositionSizePercent = merged.volatilePositionSizePercent;
    this._trendLeverage = merged.trendLeverage;
    this._rangeLeverage = merged.rangeLeverage;
    this._volatileLeverage = merged.volatileLeverage;

    // EMA values (String | null) — incremental, kept across klines
    this._emaFast = null;
    this._emaSlow = null;

    // Signal / position state
    this._lastSignal = null;
    this._latestPrice = null;
    this._entryPrice = null;
    this._positionSide = null;    // 'long' | 'short' | null
    this._entryRegime = null;     // regime when position was opened

    // Trailing stop tracking
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }

  // ---------------------------------------------------------------------------
  // onTick — real-time price; regime incompatibility + SL + trailing stop
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   * @param {object} ticker — { lastPrice, ... }
   */
  onTick(ticker) {
    if (!this._active) return;

    const price = String(ticker.lastPrice || ticker.last || ticker.price);
    if (!price || price === 'undefined' || price === 'null') return;

    this._latestPrice = price;

    // No position open — nothing to monitor
    if (!this._entryPrice || !this._positionSide) return;

    const isLong = this._positionSide === 'long';
    const isShort = this._positionSide === 'short';

    // Update trailing extremes
    if (isLong) {
      this._highestSinceEntry = this._highestSinceEntry
        ? max(this._highestSinceEntry, price)
        : price;
    } else {
      this._lowestSinceEntry = this._lowestSinceEntry
        ? min(this._lowestSinceEntry, price)
        : price;
    }

    // --- 1) Regime incompatibility check ---
    const regime = this.getEffectiveRegime();
    if (isLong && regime === MARKET_REGIMES.TRENDING_DOWN) {
      log.trade('Regime incompatibility — closing long in TRENDING_DOWN', {
        symbol: this._symbol, price, regime,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'regime_incompatible');
      return;
    }
    if (isShort && regime === MARKET_REGIMES.TRENDING_UP) {
      log.trade('Regime incompatibility — closing short in TRENDING_UP', {
        symbol: this._symbol, price, regime,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'regime_incompatible');
      return;
    }

    // Need ATR for dynamic SL / trailing — require indicator cache
    const atrVal = this._indicatorCache.get(this._symbol, 'atr', { period: this._atrPeriod });
    if (!atrVal) return;

    // --- 2) Dynamic stop-loss check ---
    const slMultiplier = this._isTrendRegime(this._entryRegime) ? '1.5' : '0.8';
    const slDistance = multiply(atrVal, slMultiplier);

    if (isLong) {
      const slPrice = subtract(this._entryPrice, slDistance);
      if (isLessThan(price, slPrice)) {
        log.trade('Dynamic SL hit (long)', { price, slPrice, atr: atrVal });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'stop_loss');
        return;
      }
    }
    if (isShort) {
      const slPrice = add(this._entryPrice, slDistance);
      if (isGreaterThan(price, slPrice)) {
        log.trade('Dynamic SL hit (short)', { price, slPrice, atr: atrVal });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'stop_loss');
        return;
      }
    }

    // --- 3) Trailing stop (trend regimes only) ---
    if (this._isTrendRegime(this._entryRegime)) {
      const trailDistance = multiply(atrVal, '1');

      if (isLong && this._highestSinceEntry) {
        const trailingStop = subtract(this._highestSinceEntry, trailDistance);
        if (isLessThan(price, trailingStop)) {
          log.trade('Trailing stop hit (long)', {
            price, highest: this._highestSinceEntry, trailingStop,
          });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'trailing_stop');
          return;
        }
      }

      if (isShort && this._lowestSinceEntry) {
        const trailingStop = add(this._lowestSinceEntry, trailDistance);
        if (isGreaterThan(price, trailingStop)) {
          log.trade('Trailing stop hit (short)', {
            price, lowest: this._lowestSinceEntry, trailingStop,
          });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'trailing_stop');
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // onKline — indicator calculation, TP check, entry logic
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming kline (candlestick) update.
   * @param {object} kline — { close, high, low, volume }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = String(kline.close);
    const high = String(kline.high);
    const low = String(kline.low);
    const volume = String(kline.volume || '0');

    // ------ 1) Check if enough data for all indicators ------
    const minRequired = Math.max(
      this._bbPeriod,
      this._rsiPeriod + 1,
      this._adxPeriod * 2 + 1,
      this._emaPeriodSlow,
    );
    const hist = this._indicatorCache.getHistory(this._symbol);
    if (!hist || hist.closes.length < minRequired) {
      log.debug('Warming up — not enough data', {
        have: hist ? hist.closes.length : 0, need: minRequired,
      });
      return;
    }

    // ------ 2) Calculate all indicators via IndicatorCache ------
    const c = this._indicatorCache;

    // EMA fast/slow (incremental when available, seed from cache)
    if (this._emaFast !== null) {
      this._emaFast = emaStep(this._emaFast, close, this._emaPeriodFast);
    } else {
      this._emaFast = c.get(this._symbol, 'ema', { period: this._emaPeriodFast });
    }

    if (this._emaSlow !== null) {
      this._emaSlow = emaStep(this._emaSlow, close, this._emaPeriodSlow);
    } else {
      this._emaSlow = c.get(this._symbol, 'ema', { period: this._emaPeriodSlow });
    }

    const rsiVal = c.get(this._symbol, 'rsi', { period: this._rsiPeriod });
    const adxVal = c.get(this._symbol, 'adx', { period: this._adxPeriod });
    const atrVal = c.get(this._symbol, 'atr', { period: this._atrPeriod });
    const bb = c.get(this._symbol, 'bb', { period: this._bbPeriod, stdDev: this._bbStdDev });

    // If any critical indicator is null, skip
    if (!this._emaFast || !this._emaSlow || !rsiVal || !adxVal || !atrVal || !bb) {
      log.debug('One or more indicators returned null — skipping');
      return;
    }

    // Volume surge check (pass current candle's volume for comparison)
    const volumeSurge = this._checkVolumeSurge();

    const regime = this.getEffectiveRegime();

    // ------ 3) If position open, check dynamic TP ------
    if (this._entryPrice && this._positionSide) {
      const tpMultiplier = this._isTrendRegime(this._entryRegime) ? '2' : '1';
      const tpDistance = multiply(atrVal, tpMultiplier);

      if (this._positionSide === 'long') {
        const tpPrice = add(this._entryPrice, tpDistance);
        if (isGreaterThan(close, tpPrice)) {
          log.trade('Dynamic TP hit (long)', { close, tpPrice, atr: atrVal });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'take_profit');
          return;
        }
      }

      if (this._positionSide === 'short') {
        const tpPrice = subtract(this._entryPrice, tpDistance);
        if (isLessThan(close, tpPrice)) {
          log.trade('Dynamic TP hit (short)', { close, tpPrice, atr: atrVal });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, close, 'take_profit');
          return;
        }
      }
    }

    // ------ 4) If no position, check entry based on current regime ------
    if (this._entryPrice) return; // Already in position — skip entry

    // Early exit if regime is null — AdaptiveRegime fundamentally depends on knowing the regime
    if (regime === null) return;

    const marketContext = {
      regime,
      emaFast: this._emaFast,
      emaSlow: this._emaSlow,
      rsi: rsiVal,
      adx: adxVal,
      atr: atrVal,
      bb,
      volumeSurge,
    };

    let signal = null;

    if (regime === MARKET_REGIMES.TRENDING_UP) {
      signal = this._checkTrendUpEntry(close, rsiVal, adxVal, marketContext);
    } else if (regime === MARKET_REGIMES.TRENDING_DOWN) {
      signal = this._checkTrendDownEntry(close, rsiVal, adxVal, marketContext);
    } else if (regime === MARKET_REGIMES.RANGING) {
      signal = this._checkRangingEntry(close, rsiVal, bb, marketContext);
    } else if (regime === MARKET_REGIMES.VOLATILE) {
      signal = this._checkVolatileEntry(close, rsiVal, volumeSurge, marketContext);
    }
    // QUIET regime — no entry, data accumulation only

    if (signal) {
      this._lastSignal = signal;
      this.emitSignal(signal);
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
   * Updates position tracking when an open or close signal is filled.
   *
   * @param {object} fill
   */
  onFill(fill) {
    if (!this._active) return;
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

  // ---------------------------------------------------------------------------
  // Entry checks per regime
  // ---------------------------------------------------------------------------

  /**
   * TRENDING_UP entry: EMA9 > EMA21 + RSI 40-50 pullback + ADX > 25
   * @returns {object|null}
   */
  _checkTrendUpEntry(price, rsiVal, adxVal, marketContext) {
    const emaFastAboveSlow = isGreaterThan(this._emaFast, this._emaSlow);
    const rsiPullback = isGreaterThan(rsiVal, '40') && isLessThan(rsiVal, '50');
    const adxStrong = isGreaterThan(adxVal, '25');

    if (emaFastAboveSlow && rsiPullback && adxStrong) {
      const confidence = this._calcConfidence(adxVal, rsiVal, false);

      log.trade('Trend-up long entry', {
        symbol: this._symbol, price, rsi: rsiVal, adx: adxVal,
      });

      this._entryPrice = price;
      this._positionSide = 'long';
      this._entryRegime = MARKET_REGIMES.TRENDING_UP;
      this._highestSinceEntry = price;
      this._lowestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._trendPositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: subtract(price, multiply(marketContext.atr, '1.5')),
        confidence,
        leverage: this._trendLeverage,
        reason: 'trend_up_pullback_entry',
        marketContext,
      };
    }

    return null;
  }

  /**
   * TRENDING_DOWN entry: EMA9 < EMA21 + RSI 50-60 rally + ADX > 25
   * @returns {object|null}
   */
  _checkTrendDownEntry(price, rsiVal, adxVal, marketContext) {
    const emaFastBelowSlow = isLessThan(this._emaFast, this._emaSlow);
    const rsiRally = isGreaterThan(rsiVal, '50') && isLessThan(rsiVal, '60');
    const adxStrong = isGreaterThan(adxVal, '25');

    if (emaFastBelowSlow && rsiRally && adxStrong) {
      const confidence = this._calcConfidence(adxVal, rsiVal, false);

      log.trade('Trend-down short entry', {
        symbol: this._symbol, price, rsi: rsiVal, adx: adxVal,
      });

      this._entryPrice = price;
      this._positionSide = 'short';
      this._entryRegime = MARKET_REGIMES.TRENDING_DOWN;
      this._lowestSinceEntry = price;
      this._highestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._trendPositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: add(price, multiply(marketContext.atr, '1.5')),
        confidence,
        leverage: this._trendLeverage,
        reason: 'trend_down_rally_entry',
        marketContext,
      };
    }

    return null;
  }

  /**
   * RANGING entry: Long if price < BB lower + RSI < 35; Short if price > BB upper + RSI > 65
   * @returns {object|null}
   */
  _checkRangingEntry(price, rsiVal, bb, marketContext) {
    // Long: price below BB lower band and RSI oversold
    if (isLessThan(price, bb.lower) && isLessThan(rsiVal, '35')) {
      const confidence = this._calcConfidence(null, rsiVal, false);

      log.trade('Ranging mean-reversion long entry', {
        symbol: this._symbol, price, rsi: rsiVal, bbLower: bb.lower,
      });

      this._entryPrice = price;
      this._positionSide = 'long';
      this._entryRegime = MARKET_REGIMES.RANGING;
      this._highestSinceEntry = price;
      this._lowestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._rangePositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: subtract(price, multiply(marketContext.atr, '0.8')),
        confidence,
        leverage: this._rangeLeverage,
        reason: 'ranging_mean_reversion_long',
        marketContext,
      };
    }

    // Short: price above BB upper band and RSI overbought
    if (isGreaterThan(price, bb.upper) && isGreaterThan(rsiVal, '65')) {
      const confidence = this._calcConfidence(null, rsiVal, false);

      log.trade('Ranging mean-reversion short entry', {
        symbol: this._symbol, price, rsi: rsiVal, bbUpper: bb.upper,
      });

      this._entryPrice = price;
      this._positionSide = 'short';
      this._entryRegime = MARKET_REGIMES.RANGING;
      this._lowestSinceEntry = price;
      this._highestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._rangePositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: add(price, multiply(marketContext.atr, '0.8')),
        confidence,
        leverage: this._rangeLeverage,
        reason: 'ranging_mean_reversion_short',
        marketContext,
      };
    }

    return null;
  }

  /**
   * VOLATILE entry: Long if RSI < 25 + volume surge; Short if RSI > 75 + volume surge
   * @returns {object|null}
   */
  _checkVolatileEntry(price, rsiVal, volumeSurge, marketContext) {
    // Long: oversold bounce with volume confirmation
    if (isLessThan(rsiVal, '25') && volumeSurge) {
      const confidence = this._calcConfidence(null, rsiVal, true);

      log.trade('Volatile momentum long entry', {
        symbol: this._symbol, price, rsi: rsiVal, volumeSurge,
      });

      this._entryPrice = price;
      this._positionSide = 'long';
      this._entryRegime = MARKET_REGIMES.VOLATILE;
      this._highestSinceEntry = price;
      this._lowestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._volatilePositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: subtract(price, multiply(marketContext.atr, '0.8')),
        confidence,
        leverage: this._volatileLeverage,
        reason: 'volatile_oversold_bounce',
        marketContext,
      };
    }

    // Short: overbought rejection with volume confirmation
    if (isGreaterThan(rsiVal, '75') && volumeSurge) {
      const confidence = this._calcConfidence(null, rsiVal, true);

      log.trade('Volatile momentum short entry', {
        symbol: this._symbol, price, rsi: rsiVal, volumeSurge,
      });

      this._entryPrice = price;
      this._positionSide = 'short';
      this._entryRegime = MARKET_REGIMES.VOLATILE;
      this._lowestSinceEntry = price;
      this._highestSinceEntry = null;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._volatilePositionSizePercent,
        suggestedPrice: price,
        stopLossPrice: add(price, multiply(marketContext.atr, '0.8')),
        confidence,
        leverage: this._volatileLeverage,
        reason: 'volatile_overbought_rejection',
        marketContext,
      };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether the current (latest) volume exceeds the 20-period SMA * 1.5.
   * Uses the last element of the IndicatorCache volume history as the current candle.
   * @returns {boolean}
   */
  _checkVolumeSurge() {
    const hist = this._indicatorCache.getHistory(this._symbol);
    if (!hist) return false;

    const volumes = hist.volumes;
    const lookback = 20;
    if (volumes.length < lookback + 1) return false;

    const currentVolume = volumes[volumes.length - 1];

    // Average the 20 volumes BEFORE the current one
    const start = volumes.length - lookback - 1;
    const end = volumes.length - 1;
    let sum = '0';
    for (let i = start; i < end; i++) {
      sum = add(sum, volumes[i]);
    }
    const avgVolume = divide(sum, String(lookback));
    const threshold = multiply(avgVolume, '1.5');

    return isGreaterThan(currentVolume, threshold);
  }

  /**
   * Calculate confidence score.
   * Base 0.5, ADX > 30: +0.15, ADX > 40: +0.25, RSI extreme: +0.1, Volume surge: +0.1
   * Cap at 0.95.
   *
   * @param {string|null} adxVal
   * @param {string} rsiVal
   * @param {boolean} volumeSurge
   * @returns {string} confidence as String with 4 decimals
   */
  _calcConfidence(adxVal, rsiVal, volumeSurge) {
    let confidence = 0.5;

    // ADX bonus
    if (adxVal !== null) {
      if (isGreaterThan(adxVal, '40')) {
        confidence += 0.25;
      } else if (isGreaterThan(adxVal, '30')) {
        confidence += 0.15;
      }
    }

    // RSI in extreme zone (< 30 or > 70)
    if (isLessThan(rsiVal, '30') || isGreaterThan(rsiVal, '70')) {
      confidence += 0.1;
    }

    // Volume surge bonus
    if (volumeSurge) {
      confidence += 0.1;
    }

    // Cap at 0.95
    confidence = Math.min(confidence, 0.95);

    return toFixed(String(confidence), 4);
  }

  /**
   * Check whether a regime is a trend regime.
   * @param {string|null} regime
   * @returns {boolean}
   */
  _isTrendRegime(regime) {
    return regime === MARKET_REGIMES.TRENDING_UP ||
           regime === MARKET_REGIMES.TRENDING_DOWN;
  }

  /**
   * Emit an exit (close) signal and reset position tracking.
   * @param {string} action — SIGNAL_ACTIONS.CLOSE_LONG or CLOSE_SHORT
   * @param {string} price  — current price
   * @param {string} reason — human-readable exit reason
   * @private
   */
  _emitExit(action, price, reason) {
    // Determine suggestedQty based on the regime under which the position was opened
    let suggestedQty = this._trendPositionSizePercent;
    if (this._entryRegime === MARKET_REGIMES.RANGING) {
      suggestedQty = this._rangePositionSizePercent;
    } else if (this._entryRegime === MARKET_REGIMES.VOLATILE) {
      suggestedQty = this._volatilePositionSizePercent;
    }

    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedQty,
      suggestedPrice: price,
      confidence: '1.0000',
      reason,
      reduceOnly: true,
      marketContext: {
        regime: this.getEffectiveRegime(),
        entryRegime: this._entryRegime,
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
    this._positionSide = null;
    this._entryRegime = null;
    this._highestSinceEntry = null;
    this._lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the global strategy registry
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('AdaptiveRegimeStrategy', AdaptiveRegimeStrategy);

module.exports = AdaptiveRegimeStrategy;
