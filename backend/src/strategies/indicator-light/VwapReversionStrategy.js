'use strict';

/**
 * VwapReversionStrategy — VWAP 회귀 전략
 *
 * When price deviates significantly from VWAP, expect reversion to the mean.
 *
 * Target regimes: RANGING (primary), QUIET (secondary)
 *
 * Entry Long:
 *   - Price is below VWAP - 1.5 * ATR
 *   - RSI(14) < 35
 *   - Volume > Volume SMA(20) * 1.2
 *   - Bullish candle (close > open)
 *
 * Entry Short:
 *   - Price is above VWAP + 1.5 * ATR
 *   - RSI(14) > 65
 *   - Volume > Volume SMA(20) * 1.2
 *   - Bearish candle (close < open)
 *
 * Exit:
 *   - TP1: VWAP level (close 50%)
 *   - TP2: VWAP + 0.5 * ATR overshoot (close remaining 50%)
 *   - SL: 2 * ATR from entry
 *   - Time limit: 48 candles without TP → close
 *
 * Risk:
 *   - Position 3%, Leverage 2x
 *   - Split entry: 60% initial + 40% add-on (if price drops 0.5*ATR more)
 *
 * VWAP session resets every 96 candles (~1 day of 15-min candles).
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
  toFixed,
  abs,
} = require('../../utils/mathUtils');
const { sma: smafn, vwap } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('VwapReversionStrategy');

// ==========================================================================
// VwapReversionStrategy
// ==========================================================================

class VwapReversionStrategy extends StrategyBase {
  static metadata = {
    name: 'VwapReversionStrategy',
    targetRegimes: ['ranging', 'quiet'],
    riskLevel: 'low',
    maxConcurrentPositions: 2,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 60000,
    gracePeriodMs: 300000,
    warmupCandles: 20,
    volatilityPreference: 'low',
    description: 'VWAP 회귀 전략 — 가격이 VWAP에서 크게 이탈했을 때 회귀를 기대',
    docs: {
      summary: '세션 VWAP(96봉 주기 리셋) 대비 가격 이탈 시 평균 회귀를 기대하는 전략. RSI(14) + 거래량 서지 + 캔들 방향 4중 확인 후 진입. TP1(VWAP 50%) + TP2(VWAP+0.5*ATR 나머지) 분할 익절, 추가 진입(0.5*ATR 추가 이탈 시 40%) 지원.',
      timeframe: '1분봉 (세션 VWAP 96봉 ≈ 약 1.5시간 주기 리셋)',
      entry: {
        long: '가격 < VWAP - 1.5*ATR(14) + RSI(14) < 35 + 거래량 > SMA(20)*1.2 + 양봉(close>open)',
        short: '가격 > VWAP + 1.5*ATR(14) + RSI(14) > 65 + 거래량 > SMA(20)*1.2 + 음봉(close<open)',
        conditions: [
          '세션 VWAP 계산 완료 (세션 내 2봉 이상)',
          'RSI(14) 과매도(< 35) 또는 과매수(> 65)',
          '거래량 > 20봉 SMA * 1.2 (서지 확인)',
          '양봉/음봉 확인 (방향 전환 시작)',
          '레짐: RANGING 또는 QUIET',
          '초기 진입 60%, 추가 진입 40% (addOn)',
        ],
      },
      exit: {
        tp: 'TP1: VWAP 도달 시 50% 부분 익절 → TP2: VWAP + 0.5*ATR 오버슈트 시 나머지 전량 익절',
        sl: '2 * ATR(14) (진입가 대비)',
        trailing: '없음',
        other: [
          '48봉 시간 제한 초과 시 강제 청산',
          '추가 진입: 진입가에서 0.5*ATR 추가 이탈 시 40% 물량 추가 매수/매도',
        ],
      },
      indicators: [
        'VWAP (세션 96봉 주기 리셋)',
        'RSI(14)',
        'ATR(14)',
        '거래량 SMA(20)',
      ],
      riskReward: {
        tp: 'VWAP 회귀(~1~2*ATR) + 오버슈트(+0.5*ATR)',
        sl: '2*ATR',
        ratio: '약 0.75:1~1.25:1 (VWAP 거리에 따라 변동)',
      },
      strengths: [
        'VWAP 기반 객관적 평균가 대비 이탈 측정',
        '4중 조건(VWAP 이탈+RSI+거래량+캔들)으로 신뢰도 높은 진입',
        '분할 익절(TP1 50%, TP2 나머지)로 안정적 수익 확보',
        '추가 진입(addOn)으로 평균 단가 개선 가능',
      ],
      weaknesses: [
        '96봉 세션 리셋 시 VWAP 재계산으로 레벨 변동',
        '강한 추세에서 VWAP 회귀 실패 가능',
        '48봉 시간 제한이 짧아 회귀 완료 전 청산될 수 있음',
        'SL 2*ATR이 좁은 변동성 구간에서는 과도할 수 있음',
      ],
      bestFor: 'RANGING/QUIET 장세에서 VWAP 대비 과도 이탈 후 평균 회귀를 기대하는 단기 트레이딩',
      warnings: [
        '레버리지 기본값 2배 — 역추세 전략으로 보수적 설정',
        '포지션 사이즈 기본값 3% — 추가 진입 포함 시 최대 3%',
        'VWAP 계산에 utils/indicators의 vwap 함수 사용 — 세션 klines 기반',
      ],
      difficulty: 'intermediate',
    },
    defaultConfig: {
      rsiPeriod: 14,
      atrPeriod: 14,
      vwapDeviationMult: '1.5',
      volumeSmaPeriod: 20,
      volumeThresholdMult: '1.2',
      positionSizePercent: '3',
      leverage: '2',
      slAtrMult: '2',
      tp1Target: 'vwap',       // close 50% at VWAP
      tp2AtrMult: '0.5',       // close remaining 50% at VWAP + 0.5*ATR
      maxHoldCandles: 48,
      addOnAtrMult: '0.5',     // add-on entry if price drops 0.5*ATR more
      initialSizeRatio: '0.6', // 60% initial
      addOnSizeRatio: '0.4',   // 40% add-on
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...VwapReversionStrategy.metadata.defaultConfig, ...config };
    super('VwapReversionStrategy', merged);

  }

  // --------------------------------------------------------------------------
  // Per-symbol state (SymbolState pattern)
  // --------------------------------------------------------------------------

  /**
   * @override
   * @returns {object} default per-symbol state
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      sessionKlines: [],
      klineCount: 0,
      sessionStartKline: 0,
      candlesSinceEntry: 0,
      tp1Hit: false,
      addOnDone: false,
    };
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check SL if position is open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._s().latestPrice = String(ticker.lastPrice);
    }

    // Only check SL when we have a position
    if (this._s().entryPrice === null || this._s().positionSide === null) return;
    if (this._s().latestPrice === null) return;

    const price = this._s().latestPrice;
    const entry = this._s().entryPrice;

    // Compute current ATR for SL calculation via IndicatorCache
    const atrVal = this._indicatorCache
      ? this._indicatorCache.get(this.getCurrentSymbol(), 'atr', { period: this.config.atrPeriod })
      : null;
    if (atrVal === null) return;

    const slDistance = multiply(this.config.slAtrMult, atrVal);

    if (this._s().positionSide === 'long') {
      const slPrice = subtract(entry, slDistance);
      if (isLessThan(price, slPrice)) {
        log.trade('Stop loss hit (long)', { price, entry, slPrice });
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss',
          marketContext: { entryPrice: entry, currentPrice: price, slPrice },
        };
        this._s().lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    } else if (this._s().positionSide === 'short') {
      const slPrice = add(entry, slDistance);
      if (isGreaterThan(price, slPrice)) {
        log.trade('Stop loss hit (short)', { price, entry, slPrice });
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: this.config.positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.9500', 4),
          reason: 'stop_loss',
          marketContext: { entryPrice: entry, currentPrice: price, slPrice },
        };
        this._s().lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} kline — { close, high, low, open, volume }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;
    const volume = kline && kline.volume !== undefined ? String(kline.volume) : '0';

    // 1. Get shared history from IndicatorCache
    const c = this._indicatorCache;
    const hist = c.getHistory(this.getCurrentSymbol());
    if (!hist) return;

    // 2. Session reset check (every 96 candles = ~1 day of 15-min candles)
    this._s().klineCount += 1;

    if (this._s().klineCount - this._s().sessionStartKline >= 96) {
      this._s().sessionKlines = [];
      this._s().sessionStartKline = this._s().klineCount;
    }

    // Push current kline to session
    this._s().sessionKlines.push({ high, low, close, volume });

    // 3. Calculate indicators
    const { rsiPeriod, atrPeriod, volumeSmaPeriod } = this.config;

    // Need enough data for indicators
    const minRequired = Math.max(rsiPeriod + 1, atrPeriod + 1, volumeSmaPeriod);
    if (hist.closes.length < minRequired || this._s().sessionKlines.length < 2) {
      log.debug('Not enough data yet', {
        have: hist.closes.length,
        need: minRequired,
        sessionKlines: this._s().sessionKlines.length,
      });
      return;
    }

    // VWAP from session klines (strategy-specific, NOT from cache)
    const vwapVal = vwap(this._s().sessionKlines);
    if (vwapVal === null) return;

    // RSI via IndicatorCache
    const rsiVal = c.get(this.getCurrentSymbol(), 'rsi', { period: rsiPeriod });
    if (rsiVal === null) return;

    // ATR via IndicatorCache
    const atrVal = c.get(this.getCurrentSymbol(), 'atr', { period: atrPeriod });
    if (atrVal === null) return;

    // Volume SMA — cache's sma uses close prices, so compute from raw volumes
    const volSma = smafn(hist.volumes, volumeSmaPeriod);
    if (volSma === null) return;

    const {
      vwapDeviationMult,
      volumeThresholdMult,
      positionSizePercent,
      slAtrMult,
      tp2AtrMult,
      maxHoldCandles,
      addOnAtrMult,
      initialSizeRatio,
      addOnSizeRatio,
    } = this.config;

    // Deviation thresholds
    const deviationBand = multiply(vwapDeviationMult, atrVal);
    const lowerBand = subtract(vwapVal, deviationBand);
    const upperBand = add(vwapVal, deviationBand);

    // Volume threshold
    const volumeThreshold = multiply(volSma, volumeThresholdMult);
    const volumeSufficient = isGreaterThan(volume, volumeThreshold);

    // Price deviation from VWAP
    const deviation = subtract(close, vwapVal);

    const regime = this.getEffectiveRegime();

    const marketContext = {
      vwap: vwapVal,
      atr: atrVal,
      rsi: rsiVal,
      deviation,
      lowerBand,
      upperBand,
      volume,
      volumeThreshold,
      regime,
    };

    // 4. If position open: manage TP1, TP2, time limit, add-on
    if (this._s().entryPrice !== null && this._s().positionSide !== null) {
      this._s().candlesSinceEntry += 1;

      // --- Time limit check ---
      if (this._s().candlesSinceEntry >= maxHoldCandles) {
        log.trade('Time limit reached — closing position', {
          candles: this._s().candlesSinceEntry, maxHoldCandles,
        });
        const closeAction = this._s().positionSide === 'long'
          ? SIGNAL_ACTIONS.CLOSE_LONG
          : SIGNAL_ACTIONS.CLOSE_SHORT;
        const signal = {
          action: closeAction,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          reduceOnly: true,
          confidence: toFixed('0.7000', 4),
          reason: 'time_limit',
          marketContext,
        };
        this._s().lastSignal = signal;
        this.emitSignal(signal);
        this._resetPosition();
        return;
      }

      // --- TP1: VWAP level (close 50%) ---
      if (!this._s().tp1Hit) {
        let tp1Triggered = false;

        if (this._s().positionSide === 'long' && isGreaterThan(close, vwapVal)) {
          tp1Triggered = true;
        } else if (this._s().positionSide === 'short' && isLessThan(close, vwapVal)) {
          tp1Triggered = true;
        }

        if (tp1Triggered) {
          this._s().tp1Hit = true;
          const halfQty = toFixed(multiply(positionSizePercent, '0.5'), 4);
          const closeAction = this._s().positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;

          log.trade('TP1 hit — VWAP reached, closing 50%', { vwap: vwapVal, close });
          const signal = {
            action: closeAction,
            symbol: this.getCurrentSymbol(),
            category: this._category,
            suggestedQty: halfQty,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: toFixed('0.8000', 4),
            reason: 'tp1_vwap',
            marketContext,
          };
          this._s().lastSignal = signal;
          this.emitSignal(signal);
          return;
        }
      }

      // --- TP2: VWAP + 0.5*ATR overshoot (close remaining 50%) ---
      if (this._s().tp1Hit) {
        const overshoot = multiply(tp2AtrMult, atrVal);
        let tp2Triggered = false;

        if (this._s().positionSide === 'long') {
          const tp2Level = add(vwapVal, overshoot);
          if (isGreaterThan(close, tp2Level)) {
            tp2Triggered = true;
          }
        } else if (this._s().positionSide === 'short') {
          const tp2Level = subtract(vwapVal, overshoot);
          if (isLessThan(close, tp2Level)) {
            tp2Triggered = true;
          }
        }

        if (tp2Triggered) {
          log.trade('TP2 hit — VWAP overshoot, closing remaining', { close });
          const closeAction = this._s().positionSide === 'long'
            ? SIGNAL_ACTIONS.CLOSE_LONG
            : SIGNAL_ACTIONS.CLOSE_SHORT;
          const signal = {
            action: closeAction,
            symbol: this.getCurrentSymbol(),
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: toFixed('0.8500', 4),
            reason: 'tp2_vwap_overshoot',
            marketContext,
          };
          this._s().lastSignal = signal;
          this.emitSignal(signal);
          this._resetPosition();
          return;
        }
      }

      // --- Add-on entry check (if price drops 0.5*ATR more from entry) ---
      if (!this._s().addOnDone) {
        const addOnDistance = multiply(addOnAtrMult, atrVal);

        if (this._s().positionSide === 'long') {
          const addOnLevel = subtract(this._s().entryPrice, addOnDistance);
          if (isLessThan(close, addOnLevel)) {
            this._s().addOnDone = true;
            const addOnQty = toFixed(multiply(positionSizePercent, addOnSizeRatio), 4);
            const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

            log.trade('Add-on entry (long) — price dropped further', { close, addOnLevel });
            const signal = {
              action: SIGNAL_ACTIONS.OPEN_LONG,
              symbol: this.getCurrentSymbol(),
              category: this._category,
              suggestedQty: addOnQty,
              suggestedPrice: close,
              confidence,
              leverage: this.config.leverage,
              reason: 'vwap_reversion_long_addon',
              marketContext,
            };
            this._s().lastSignal = signal;
            this.emitSignal(signal);
            return;
          }
        } else if (this._s().positionSide === 'short') {
          const addOnLevel = add(this._s().entryPrice, addOnDistance);
          if (isGreaterThan(close, addOnLevel)) {
            this._s().addOnDone = true;
            const addOnQty = toFixed(multiply(positionSizePercent, addOnSizeRatio), 4);
            const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

            log.trade('Add-on entry (short) — price rallied further', { close, addOnLevel });
            const signal = {
              action: SIGNAL_ACTIONS.OPEN_SHORT,
              symbol: this.getCurrentSymbol(),
              category: this._category,
              suggestedQty: addOnQty,
              suggestedPrice: close,
              confidence,
              leverage: this.config.leverage,
              reason: 'vwap_reversion_short_addon',
              marketContext,
            };
            this._s().lastSignal = signal;
            this.emitSignal(signal);
            return;
          }
        }
      }

      // Position open but no exit/add-on triggered — done for this kline
      return;
    }

    // 5. No position: check entry conditions (RANGING or QUIET regimes only)
    if (regime !== null && regime !== MARKET_REGIMES.RANGING && regime !== MARKET_REGIMES.QUIET) {
      return;
    }

    // --- Long entry ---
    const priceBelowLower = isLessThan(close, lowerBand);
    const rsiOversold = isLessThan(rsiVal, '35');
    const bullishCandle = isGreaterThan(close, open);

    if (priceBelowLower && rsiOversold && volumeSufficient && bullishCandle) {
      const sizePercent = toFixed(multiply(positionSizePercent, initialSizeRatio), 4);
      const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

      log.trade('Long entry — VWAP reversion', {
        symbol: this.getCurrentSymbol(), close, vwap: vwapVal, rsi: rsiVal, deviation,
      });

      this._s().entryPrice = close;
      this._s().positionSide = 'long';
      this._s().candlesSinceEntry = 0;
      this._s().tp1Hit = false;
      this._s().addOnDone = false;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: close,
        stopLossPrice: subtract(close, multiply(slAtrMult, atrVal)),
        confidence,
        leverage: this.config.leverage,
        reason: 'vwap_reversion_long',
        marketContext,
      };
      this._s().lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // --- Short entry ---
    const priceAboveUpper = isGreaterThan(close, upperBand);
    const rsiOverbought = isGreaterThan(rsiVal, '65');
    const bearishCandle = isLessThan(close, open);

    if (priceAboveUpper && rsiOverbought && volumeSufficient && bearishCandle) {
      const sizePercent = toFixed(multiply(positionSizePercent, initialSizeRatio), 4);
      const confidence = this._calcConfidence(rsiVal, deviation, atrVal);

      log.trade('Short entry — VWAP reversion', {
        symbol: this.getCurrentSymbol(), close, vwap: vwapVal, rsi: rsiVal, deviation,
      });

      this._s().entryPrice = close;
      this._s().positionSide = 'short';
      this._s().candlesSinceEntry = 0;
      this._s().tp1Hit = false;
      this._s().addOnDone = false;

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: close,
        stopLossPrice: add(close, multiply(slAtrMult, atrVal)),
        confidence,
        leverage: this.config.leverage,
        reason: 'vwap_reversion_short',
        marketContext,
      };
      this._s().lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  /**
   * @returns {object|null}
   */
  getSignal() {
    return this._s().lastSignal;
  }

  // --------------------------------------------------------------------------
  // onFill — handle fill events to update position state
  // --------------------------------------------------------------------------

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
      this._s().positionSide = 'long';
      if (fill.price !== undefined) this._s().entryPrice = String(fill.price);
      log.trade('Long fill recorded', { entry: this._s().entryPrice, symbol: this.getCurrentSymbol() });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._s().positionSide = 'short';
      if (fill.price !== undefined) this._s().entryPrice = String(fill.price);
      log.trade('Short fill recorded', { entry: this._s().entryPrice, symbol: this.getCurrentSymbol() });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: this._s().positionSide, symbol: this.getCurrentSymbol() });
      this._resetPosition();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate a confidence score based on RSI extremity, VWAP deviation, and ATR.
   *
   * @param {string} rsiVal
   * @param {string} deviation — price - VWAP
   * @param {string} atrVal
   * @returns {string} confidence 0.00-1.00
   */
  _calcConfidence(rsiVal, deviation, atrVal) {
    const rsiNum = parseFloat(rsiVal);
    const devNum = Math.abs(parseFloat(deviation));
    const atrNum = parseFloat(atrVal);

    // RSI component: further from 50 = higher confidence (0-0.4)
    const rsiDistance = Math.abs(rsiNum - 50) / 50;
    const rsiScore = rsiDistance * 0.4;

    // Deviation component: larger deviation from VWAP relative to ATR = higher confidence (0-0.35)
    const devRatio = atrNum > 0 ? Math.min(devNum / (atrNum * 3), 1) : 0;
    const devScore = devRatio * 0.35;

    // Base confidence + components
    const confidence = Math.min(0.3 + rsiScore + devScore, 1);
    return toFixed(String(confidence), 4);
  }

  /**
   * Reset all position-related state after full exit.
   * @private
   */
  _resetPosition() {
    this._s().entryPrice = null;
    this._s().positionSide = null;
    this._s().candlesSinceEntry = 0;
    this._s().tp1Hit = false;
    this._s().addOnDone = false;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('VwapReversionStrategy', VwapReversionStrategy);

module.exports = VwapReversionStrategy;
