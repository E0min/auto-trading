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
const { sma: indicatorSma } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

class QuietRangeScalpStrategy extends StrategyBase {
  static metadata = {
    name: 'QuietRangeScalpStrategy',
    targetRegimes: ['quiet'],
    riskLevel: 'low',
    maxConcurrentPositions: 1,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 30000,
    gracePeriodMs: 900000,
    warmupCandles: 30,
    volatilityPreference: 'low',
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
  }

  // ---------------------------------------------------------------------------
  // Per-symbol state (SymbolState pattern)
  // ---------------------------------------------------------------------------

  /**
   * Override to add strategy-specific per-symbol fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {string[]} ATR values history for SMA */
      atrHistory: [],

      /** @type {boolean} whether half profit has been taken */
      halfProfitTaken: false,
    };
  }

  // -------------------------------------------------------------------------
  // onTick
  // -------------------------------------------------------------------------

  onTick(ticker) {
    if (!this._active) return;
    if (!ticker || ticker.lastPrice === undefined) return;

    const s = this._s();
    const sym = this.getCurrentSymbol();
    s.latestPrice = String(ticker.lastPrice);

    if (s.entryPrice === null || s.positionSide === null) return;

    // Regime change exit — if no longer QUIET, close immediately
    if (this.getEffectiveRegime() !== MARKET_REGIMES.QUIET) {
      const action = s.positionSide === 'long'
        ? SIGNAL_ACTIONS.CLOSE_LONG
        : SIGNAL_ACTIONS.CLOSE_SHORT;
      const signal = {
        action,
        symbol: sym,
        category: this._category,
        suggestedQty: this.config.positionSizePercent,
        suggestedPrice: s.latestPrice,
        reduceOnly: true,
        confidence: '0.9000',
        marketContext: { reason: 'regime_change_exit', regime: this.getEffectiveRegime() },
      };
      s.lastSignal = signal;
      this.emitSignal(signal);
      this._resetPosition();
      return;
    }

    this._checkExitOnTick(s, sym);
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
    const sym = this.getCurrentSymbol();
    const s = this._s();

    const {
      emaPeriod,
      atrPeriod,
      atrSmaPeriod,
      kcMultiplier,
      atrQuietThreshold,
      positionSizePercent,
    } = this.config;

    // --- IndicatorCache-based indicator retrieval ---
    const c = this._indicatorCache;
    const hist = c.getHistory(sym);
    if (!hist) return;

    const minRequired = Math.max(emaPeriod, atrPeriod + 1, atrSmaPeriod);
    if (!hist || hist.closes.length < minRequired) return;

    const emaValue = c.get(sym, 'ema', { period: emaPeriod });
    const atrVal = c.get(sym, 'atr', { period: atrPeriod });
    if (!emaValue || !atrVal) return;

    // ATR SMA: accumulate cache-provided ATR values for SMA computation
    s.atrHistory.push(atrVal);
    if (s.atrHistory.length > 100) {
      s.atrHistory = s.atrHistory.slice(-100);
    }

    // 3. Calculate ATR SMA (volatility baseline)
    if (s.atrHistory.length < atrSmaPeriod) return;
    const atrSmaValue = indicatorSma(s.atrHistory, atrSmaPeriod);
    if (!atrSmaValue) return;

    // 4. Keltner Channel bands
    const band = multiply(atrVal, kcMultiplier);
    const kcUpper = add(emaValue, band);
    const kcLower = subtract(emaValue, band);

    // 5. Quiet filter: ATR <= ATR_SMA * threshold
    const atrThreshold = multiply(atrSmaValue, atrQuietThreshold);
    const isQuiet = isLessThanOrEqual(atrVal, atrThreshold);

    const regime = this.getEffectiveRegime();

    // Check EMA midpoint exit for open positions
    if (s.entryPrice !== null && s.positionSide !== null) {
      if (!s.halfProfitTaken) {
        if (s.positionSide === 'long' && isGreaterThan(close, emaValue)) {
          s.halfProfitTaken = true;
          const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: sym,
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: '0.7000',
            marketContext: { reason: 'ema_midpoint_half_profit', ema: emaValue },
          };
          s.lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
        if (s.positionSide === 'short' && isLessThan(close, emaValue)) {
          s.halfProfitTaken = true;
          const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
          const signal = {
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: sym,
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: '0.7000',
            marketContext: { reason: 'ema_midpoint_half_profit', ema: emaValue },
          };
          s.lastSignal = signal;
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
      atr: atrVal,
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
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        stopLossPrice: multiply(close, subtract('1', divide(this.config.slPercent || '0.8', '100'))),
        confidence,
        marketContext: { ...marketContext, reason: 'kc_lower_touch' },
      };
      s.entryPrice = close;
      s.positionSide = 'long';
      s.halfProfitTaken = false;
      s.lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // Short: price touches Keltner upper band
    if (isGreaterThanOrEqual(close, kcUpper)) {
      const confidence = this._calcConfidence(close, kcUpper, emaValue, 'short');
      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: close,
        stopLossPrice: multiply(close, add('1', divide(this.config.slPercent || '0.8', '100'))),
        confidence,
        marketContext: { ...marketContext, reason: 'kc_upper_touch' },
      };
      s.entryPrice = close;
      s.positionSide = 'short';
      s.halfProfitTaken = false;
      s.lastSignal = signal;
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
    const sym = fill.symbol || this.getCurrentSymbol();
    const s = this._s(sym);

    if (fill.side === 'buy' && s.entryPrice === null) {
      s.entryPrice = price;
    }
    if (fill.side === 'sell' && s.positionSide === 'long') {
      this._resetPosition(sym);
    }
    if (fill.side === 'sell' && s.positionSide === null && s.entryPrice === null) {
      s.entryPrice = price;
      s.positionSide = 'short';
    }
    if (fill.side === 'buy' && s.positionSide === 'short') {
      this._resetPosition(sym);
    }
  }

  getSignal() {
    return this._s().lastSignal;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _checkExitOnTick(s, sym) {
    if (s.entryPrice === null || s.positionSide === null) return;

    const currentPrice = s.latestPrice;
    const { positionSizePercent, tpPercent, slPercent } = this.config;

    if (s.positionSide === 'long') {
      const tpPrice = multiply(s.entryPrice, add('1', divide(tpPercent, '100')));
      const slPrice = multiply(s.entryPrice, subtract('1', divide(slPercent, '100')));

      if (isGreaterThanOrEqual(currentPrice, tpPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          reduceOnly: true,
          confidence: '0.9500',
          marketContext: { reason: 'take_profit', entryPrice: s.entryPrice, tpPrice },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (isLessThanOrEqual(currentPrice, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          reduceOnly: true,
          confidence: '0.9500',
          marketContext: { reason: 'stop_loss', entryPrice: s.entryPrice, slPrice },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
      }
    } else if (s.positionSide === 'short') {
      const tpPrice = multiply(s.entryPrice, subtract('1', divide(tpPercent, '100')));
      const slPrice = multiply(s.entryPrice, add('1', divide(slPercent, '100')));

      if (isLessThanOrEqual(currentPrice, tpPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          reduceOnly: true,
          confidence: '0.9500',
          marketContext: { reason: 'take_profit', entryPrice: s.entryPrice, tpPrice },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
      if (isGreaterThanOrEqual(currentPrice, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: currentPrice,
          reduceOnly: true,
          confidence: '0.9500',
          marketContext: { reason: 'stop_loss', entryPrice: s.entryPrice, slPrice },
        };
        s.lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
      }
    }
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

  _resetPosition(symbol) {
    const s = this._s(symbol);
    s.entryPrice = null;
    s.positionSide = null;
    s.halfProfitTaken = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('QuietRangeScalpStrategy', QuietRangeScalpStrategy);

module.exports = QuietRangeScalpStrategy;
