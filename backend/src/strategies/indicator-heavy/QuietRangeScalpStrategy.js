'use strict';

/**
 * QuietRangeScalpStrategy — QUIET 장세 전용 스캘핑 전략
 *
 * 변동성이 극도로 낮은 QUIET 장세에서 Keltner Channel 상/하단 터치 시
 * 역방향 진입하여 작은 수익을 반복 누적한다.
 *
 * 진입 조건:
 *   - MarketRegime === QUIET
 *   - ATR(14)이 20봉 ATR 최저 수준 (ATR ≤ ATR SMA * 0.7)
 *   - Long : 가격이 Keltner 하단 터치 (close ≤ EMA - ATR * kcMultiplier)
 *   - Short: 가격이 Keltner 상단 터치 (close ≥ EMA + ATR * kcMultiplier)
 *
 * 청산:
 *   - TP: +1.2%  (좁은 레인지에서 빠른 이익 확정)
 *   - SL: -0.8%  (슬리피지/수수료 반영한 손절)
 *   - EMA 중앙 복귀 시 부분 익절 (50%)
 *   - 장세 전환 시 즉시 청산
 *
 * 타임프레임: 5분봉
 * 레버리지: 2x, 최대 포지션 비중 3%
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
  min,
} = require('../../utils/mathUtils');
const { emaFromArray, sma: indicatorSma } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

class QuietRangeScalpStrategy extends StrategyBase {
  static metadata = {
    name: 'QuietRangeScalpStrategy',
    description: 'QUIET 장세 Keltner Channel 스캘핑 (양방향)',
    defaultConfig: {
      emaPeriod: 20,
      atrPeriod: 14,
      atrSmaPeriod: 20,
      kcMultiplier: '1.5',
      atrQuietThreshold: '0.7',
      leverage: 2,
      positionSizePercent: '3',
      tpPercent: '1.2',
      slPercent: '0.8',
    },
  };

  constructor(config = {}) {
    const merged = { ...QuietRangeScalpStrategy.metadata.defaultConfig, ...config };
    super('QuietRangeScalpStrategy', merged);

    this._log = createLogger('QuietRangeScalpStrategy');

    /** @type {string[]} close prices */
    this.priceHistory = [];
    /** @type {string[]} high prices */
    this._highHistory = [];
    /** @type {string[]} low prices */
    this._lowHistory = [];
    /** @type {string[]} ATR values history for SMA */
    this._atrHistory = [];

    this._latestPrice = null;
    this._entryPrice = null;
    /** @type {'long'|'short'|null} */
    this._positionSide = null;
    this._halfProfitTaken = false;
    this._lastSignal = null;

    this._maxHistory = Math.max(merged.emaPeriod, merged.atrPeriod, merged.atrSmaPeriod) + 20;
  }

  // -------------------------------------------------------------------------
  // onTick
  // -------------------------------------------------------------------------

  onTick(ticker) {
    if (!this._active) return;
    if (!ticker || ticker.lastPrice === undefined) return;

    this._latestPrice = String(ticker.lastPrice);

    if (this._entryPrice === null || this._positionSide === null) return;

    // Regime change exit — if no longer QUIET, close immediately
    if (this._marketRegime !== MARKET_REGIMES.QUIET) {
      const action = this._positionSide === 'long'
        ? SIGNAL_ACTIONS.CLOSE_LONG
        : SIGNAL_ACTIONS.CLOSE_SHORT;
      const signal = {
        action,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this.config.positionSizePercent,
        suggestedPrice: this._latestPrice,
        confidence: '0.9000',
        marketContext: { reason: 'regime_change_exit', regime: this._marketRegime },
      };
      this._lastSignal = signal;
      this.emitSignal(signal);
      this._resetPosition();
      return;
    }

    this._checkExitOnTick(this._latestPrice);
  }

  // -------------------------------------------------------------------------
  // onKline — main logic (5-min candles)
  // -------------------------------------------------------------------------

  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    this.priceHistory.push(close);
    this._highHistory.push(high);
    this._lowHistory.push(low);

    if (this.priceHistory.length > this._maxHistory) {
      this.priceHistory = this.priceHistory.slice(-this._maxHistory);
    }
    if (this._highHistory.length > this._maxHistory) {
      this._highHistory = this._highHistory.slice(-this._maxHistory);
    }
    if (this._lowHistory.length > this._maxHistory) {
      this._lowHistory = this._lowHistory.slice(-this._maxHistory);
    }

    const {
      emaPeriod,
      atrPeriod,
      atrSmaPeriod,
      kcMultiplier,
      atrQuietThreshold,
      positionSizePercent,
    } = this.config;

    const minRequired = Math.max(emaPeriod, atrPeriod + 1, atrSmaPeriod);
    if (this.priceHistory.length < minRequired) return;

    // 1. Calculate EMA (SMA-seeded, from full price history)
    const emaValue = emaFromArray(this.priceHistory, emaPeriod);
    if (!emaValue) return;

    // 2. Calculate ATR
    const atr = this._calculateAtr(atrPeriod);
    this._atrHistory.push(atr);
    if (this._atrHistory.length > this._maxHistory) {
      this._atrHistory = this._atrHistory.slice(-this._maxHistory);
    }

    // 3. Calculate ATR SMA (volatility baseline)
    if (this._atrHistory.length < atrSmaPeriod) return;
    const atrSmaValue = indicatorSma(this._atrHistory, atrSmaPeriod);
    if (!atrSmaValue) return;

    // 4. Keltner Channel bands
    const band = multiply(atr, kcMultiplier);
    const kcUpper = add(emaValue, band);
    const kcLower = subtract(emaValue, band);

    // 5. Quiet filter: ATR ≤ ATR_SMA * threshold
    const atrThreshold = multiply(atrSmaValue, atrQuietThreshold);
    const isQuiet = isLessThanOrEqual(atr, atrThreshold);

    const regime = this._marketRegime;

    // Check EMA midpoint exit for open positions
    if (this._entryPrice !== null && this._positionSide !== null) {
      if (!this._halfProfitTaken) {
        if (this._positionSide === 'long' && isGreaterThan(close, emaValue)) {
          this._halfProfitTaken = true;
          const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            confidence: '0.7000',
            marketContext: { reason: 'ema_midpoint_half_profit', ema: emaValue },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
        if (this._positionSide === 'short' && isLessThan(close, emaValue)) {
          this._halfProfitTaken = true;
          const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: this._symbol,
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            confidence: '0.7000',
            marketContext: { reason: 'ema_midpoint_half_profit', ema: emaValue },
          };
          this._lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
      }
      // Don't open new positions while one is open
      return;
    }

    // 6. Entry conditions — QUIET only
    if (regime !== null && regime !== MARKET_REGIMES.QUIET) return;
    if (!isQuiet) return;

    const marketContext = {
      ema: emaValue,
      atr,
      atrSma: atrSmaValue,
      kcUpper,
      kcLower,
      regime,
      isQuiet,
    };

    // Long: price touches Keltner lower band
    if (isLessThanOrEqual(close, kcLower)) {
      const confidence = this._calcConfidence(close, kcLower, emaValue, 'long');
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        confidence,
        marketContext: { ...marketContext, reason: 'kc_lower_touch' },
      };
      this._entryPrice = close;
      this._positionSide = 'long';
      this._halfProfitTaken = false;
      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // Short: price touches Keltner upper band
    if (isGreaterThanOrEqual(close, kcUpper)) {
      const confidence = this._calcConfidence(close, kcUpper, emaValue, 'short');
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        confidence,
        marketContext: { ...marketContext, reason: 'kc_upper_touch' },
      };
      this._entryPrice = close;
      this._positionSide = 'short';
      this._halfProfitTaken = false;
      this._lastSignal = signal;
      this.emitSignal(signal);
    }
  }

  // -------------------------------------------------------------------------
  // onFill
  // -------------------------------------------------------------------------

  onFill(fill) {
    if (!fill) return;
    const price = fill.price !== undefined ? String(fill.price) : null;
    if (price === null) return;

    if (fill.side === 'buy' && this._entryPrice === null) {
      this._entryPrice = price;
    }
    if (fill.side === 'sell' && this._positionSide === 'long') {
      this._resetPosition();
    }
    if (fill.side === 'sell' && this._positionSide === null && this._entryPrice === null) {
      this._entryPrice = price;
      this._positionSide = 'short';
    }
    if (fill.side === 'buy' && this._positionSide === 'short') {
      this._resetPosition();
    }
  }

  getSignal() {
    return this._lastSignal;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _checkExitOnTick(currentPrice) {
    if (this._entryPrice === null || this._positionSide === null) return;

    const { positionSizePercent, tpPercent, slPercent } = this.config;

    if (this._positionSide === 'long') {
      const tpPrice = multiply(this._entryPrice, add('1', divide(tpPercent, '100')));
      const slPrice = multiply(this._entryPrice, subtract('1', divide(slPercent, '100')));

      if (isGreaterThanOrEqual(currentPrice, tpPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { reason: 'take_profit', entryPrice: this._entryPrice, tpPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (isLessThanOrEqual(currentPrice, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { reason: 'stop_loss', entryPrice: this._entryPrice, slPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
      }
    } else if (this._positionSide === 'short') {
      const tpPrice = multiply(this._entryPrice, subtract('1', divide(tpPercent, '100')));
      const slPrice = multiply(this._entryPrice, add('1', divide(slPercent, '100')));

      if (isLessThanOrEqual(currentPrice, tpPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { reason: 'take_profit', entryPrice: this._entryPrice, tpPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (isGreaterThanOrEqual(currentPrice, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this._symbol,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          confidence: '0.9500',
          marketContext: { reason: 'stop_loss', entryPrice: this._entryPrice, slPrice },
        };
        this._lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
      }
    }
  }

  /**
   * Calculate ATR (Average True Range) over the given period.
   * TR = max(high - low, |high - prevClose|, |low - prevClose|)
   * ATR = SMA(TR, period)
   */
  _calculateAtr(period) {
    const len = this.priceHistory.length;
    if (len < period + 1) return '0';

    const trValues = [];
    for (let i = len - period; i < len; i++) {
      const high = this._highHistory[i] || this.priceHistory[i];
      const low = this._lowHistory[i] || this.priceHistory[i];
      const prevClose = this.priceHistory[i - 1];

      const hl = subtract(high, low);
      const hpc = subtract(high, prevClose);
      const lpc = subtract(low, prevClose);
      const absHpc = isLessThan(hpc, '0') ? subtract('0', hpc) : hpc;
      const absLpc = isLessThan(lpc, '0') ? subtract('0', lpc) : lpc;

      // TR = max of hl, absHpc, absLpc
      let tr = hl;
      if (isGreaterThan(absHpc, tr)) tr = absHpc;
      if (isGreaterThan(absLpc, tr)) tr = absLpc;

      trValues.push(tr);
    }

    return indicatorSma(trValues, trValues.length);
  }

  _calcConfidence(price, bandLevel, emaValue, direction) {
    // Confidence based on how far past the band the price has gone
    const distFromBand = subtract(bandLevel, price);
    const absDist = isLessThan(distFromBand, '0') ? subtract('0', distFromBand) : distFromBand;
    const channelWidth = subtract(emaValue, bandLevel);
    const absWidth = isLessThan(channelWidth, '0') ? subtract('0', channelWidth) : channelWidth;

    if (!isGreaterThan(absWidth, '0')) return '0.5000';

    const ratio = parseFloat(divide(absDist, absWidth));
    const confidence = Math.min(0.5 + ratio * 0.4, 0.9);
    return toFixed(String(confidence), 4);
  }

  _resetPosition() {
    this._entryPrice = null;
    this._positionSide = null;
    this._halfProfitTaken = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('QuietRangeScalpStrategy', QuietRangeScalpStrategy);

module.exports = QuietRangeScalpStrategy;
