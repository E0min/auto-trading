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
    maxSymbolsPerStrategy: 3,
    cooldownMs: 120000,
    gracePeriodMs: 0,
    warmupCandles: 43,
    volatilityPreference: 'high',
    trailingStop: { enabled: false, activationPercent: '1.5', callbackPercent: '1.0' },
    description: '장세 적응형 멀티전략 — 시장 국면에 따라 자동으로 매매 모드 전환',
    docs: {
      summary: '시장 레짐(TRENDING_UP/DOWN, RANGING, VOLATILE, QUIET)에 따라 자동으로 매매 모드를 전환하는 적응형 전략. 추세장에서는 EMA+ADX 추세추종, 횡보장에서는 BB 평균회귀, 변동성장에서는 RSI+거래량 모멘텀, QUIET에서는 대기. 레짐별 포지션 사이즈/레버리지/TP/SL 동적 조절.',
      timeframe: '1분봉 (IndicatorCache 통한 EMA/RSI/ADX/ATR/BB 계산)',
      entry: {
        long: [
          'TRENDING_UP: EMA(9) > EMA(21) + RSI 40~50(풀백) + ADX > 25',
          'RANGING: close < BB 하단(20,2) + RSI < 35',
          'VOLATILE: RSI < 25(극과매도) + 거래량 서지(20봉 평균 * 1.5 초과)',
        ].join(' | '),
        short: [
          'TRENDING_DOWN: EMA(9) < EMA(21) + RSI 50~60(랠리) + ADX > 25',
          'RANGING: close > BB 상단(20,2) + RSI > 65',
          'VOLATILE: RSI > 75(극과매수) + 거래량 서지',
        ].join(' | '),
        conditions: [
          '레짐이 null이 아닌 상태 (AdaptiveRegime은 레짐 필수)',
          'QUIET 레짐: 진입 없음 (데이터 축적만)',
          'EMA(9), EMA(21) — 인크리멘탈 업데이트',
          'RSI(14), ADX(14), ATR(14), BB(20,2) 계산 완료',
          '기존 포지션 없음',
        ],
      },
      exit: {
        tp: '추세장: 2*ATR / 횡보·변동성장: 1*ATR (동적)',
        sl: '추세장: 1.5*ATR / 횡보·변동성장: 0.8*ATR (동적)',
        trailing: '추세장(TRENDING)에서만: 최고/최저가 대비 1*ATR 트레일링 스탑',
        other: [
          '레짐 비호환 시 즉시 청산 (롱 보유 중 TRENDING_DOWN, 숏 보유 중 TRENDING_UP)',
        ],
      },
      indicators: [
        'EMA(9), EMA(21) — 추세 방향 + 인크리멘탈',
        'RSI(14) — 과매수/과매도 + 풀백 확인',
        'ADX(14) — 추세 강도',
        'ATR(14) — 동적 TP/SL/트레일링 거리',
        'Bollinger Bands(20, 2) — 횡보장 상/하단',
        '거래량 SMA(20) — 서지 확인',
      ],
      riskReward: {
        tp: '추세: 2*ATR, 횡보/변동성: 1*ATR',
        sl: '추세: 1.5*ATR, 횡보/변동성: 0.8*ATR',
        ratio: '추세 약 1.3:1, 횡보 약 1.25:1',
      },
      strengths: [
        '모든 장세에 자동 적응 — 단일 전략으로 전 시장 커버',
        '레짐별 최적화된 포지션 사이즈/레버리지/TP/SL 자동 조절',
        '레짐 비호환 시 즉시 청산으로 리스크 관리',
        'ATR 기반 동적 TP/SL로 변동성 적응',
      ],
      weaknesses: [
        '레짐 오판 시 잘못된 모드 적용 → 손실 확대',
        '레짐 전환 빈번 시 잦은 포지션 정리/재진입 발생',
        '각 모드의 진입 조건이 개별 전문 전략보다 단순',
        'QUIET 장세에서는 완전 대기 — 수익 기회 없음',
      ],
      bestFor: '시장 국면이 자주 변하는 환경에서 수동 전략 전환 없이 자동 적응 매매를 원하는 경우',
      warnings: [
        'gracePeriodMs: 0 — 레짐 전환 시 즉시 반응 (유예기간 없음)',
        'QUIET 레짐에서는 완전 비활성 (데이터 축적만)',
        'AD-37 적용: 포지션 상태는 onFill() 확인 후에만 반영',
        '레짐별 레버리지: 추세 3배, 횡보 2배, 변동성 3배',
        '레짐별 포지션 사이즈: 추세 3%, 횡보 2%, 변동성 4%',
      ],
      difficulty: 'advanced',
    },
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

      // EMA values (String | null) — incremental, kept across klines
      emaFast: null,
      emaSlow: null,

      // Regime when position was opened
      entryRegime: null,

      // Trailing stop tracking
      highestSinceEntry: null,
      lowestSinceEntry: null,

      // AD-37: Pending entry regime — set at signal time, applied at fill time
      pendingEntryRegime: null,
    };
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

    const s = this._s();
    const sym = this.getCurrentSymbol();
    s.latestPrice = price;

    // No position open — nothing to monitor
    if (!s.entryPrice || !s.positionSide) return;

    const isLong = s.positionSide === 'long';
    const isShort = s.positionSide === 'short';

    // Update trailing extremes
    if (isLong) {
      s.highestSinceEntry = s.highestSinceEntry
        ? max(s.highestSinceEntry, price)
        : price;
    } else {
      s.lowestSinceEntry = s.lowestSinceEntry
        ? min(s.lowestSinceEntry, price)
        : price;
    }

    // --- 1) Regime incompatibility check ---
    const regime = this.getEffectiveRegime();
    if (isLong && regime === MARKET_REGIMES.TRENDING_DOWN) {
      log.trade('Regime incompatibility — closing long in TRENDING_DOWN', {
        symbol: sym, price, regime,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'regime_incompatible');
      return;
    }
    if (isShort && regime === MARKET_REGIMES.TRENDING_UP) {
      log.trade('Regime incompatibility — closing short in TRENDING_UP', {
        symbol: sym, price, regime,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'regime_incompatible');
      return;
    }

    // Need ATR for dynamic SL / trailing — require indicator cache
    const atrVal = this._indicatorCache.get(sym, 'atr', { period: this._atrPeriod });
    if (!atrVal) return;

    // --- 2) Dynamic stop-loss check ---
    const slMultiplier = this._isTrendRegime(s.entryRegime) ? '1.5' : '0.8';
    const slDistance = multiply(atrVal, slMultiplier);

    if (isLong) {
      const slPrice = subtract(s.entryPrice, slDistance);
      if (isLessThan(price, slPrice)) {
        log.trade('Dynamic SL hit (long)', { price, slPrice, atr: atrVal });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'stop_loss');
        return;
      }
    }
    if (isShort) {
      const slPrice = add(s.entryPrice, slDistance);
      if (isGreaterThan(price, slPrice)) {
        log.trade('Dynamic SL hit (short)', { price, slPrice, atr: atrVal });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'stop_loss');
        return;
      }
    }

    // --- 3) Trailing stop (trend regimes only) ---
    if (this._isTrendRegime(s.entryRegime)) {
      const trailDistance = multiply(atrVal, '1');

      if (isLong && s.highestSinceEntry) {
        const trailingStop = subtract(s.highestSinceEntry, trailDistance);
        if (isLessThan(price, trailingStop)) {
          log.trade('Trailing stop hit (long)', {
            price, highest: s.highestSinceEntry, trailingStop,
          });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'trailing_stop');
          return;
        }
      }

      if (isShort && s.lowestSinceEntry) {
        const trailingStop = add(s.lowestSinceEntry, trailDistance);
        if (isGreaterThan(price, trailingStop)) {
          log.trade('Trailing stop hit (short)', {
            price, lowest: s.lowestSinceEntry, trailingStop,
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
    const sym = this.getCurrentSymbol();
    const s = this._s();

    // ------ 1) Check if enough data for all indicators ------
    const minRequired = Math.max(
      this._bbPeriod,
      this._rsiPeriod + 1,
      this._adxPeriod * 2 + 1,
      this._emaPeriodSlow,
    );
    const hist = this._indicatorCache.getHistory(sym);
    if (!hist || hist.closes.length < minRequired) {
      log.debug('Warming up — not enough data', {
        have: hist ? hist.closes.length : 0, need: minRequired,
      });
      return;
    }

    // ------ 2) Calculate all indicators via IndicatorCache ------
    const c = this._indicatorCache;

    // EMA fast/slow (incremental when available, seed from cache)
    if (s.emaFast !== null) {
      s.emaFast = emaStep(s.emaFast, close, this._emaPeriodFast);
    } else {
      s.emaFast = c.get(sym, 'ema', { period: this._emaPeriodFast });
    }

    if (s.emaSlow !== null) {
      s.emaSlow = emaStep(s.emaSlow, close, this._emaPeriodSlow);
    } else {
      s.emaSlow = c.get(sym, 'ema', { period: this._emaPeriodSlow });
    }

    const rsiVal = c.get(sym, 'rsi', { period: this._rsiPeriod });
    const adxVal = c.get(sym, 'adx', { period: this._adxPeriod });
    const atrVal = c.get(sym, 'atr', { period: this._atrPeriod });
    const bb = c.get(sym, 'bb', { period: this._bbPeriod, stdDev: this._bbStdDev });

    // If any critical indicator is null, skip
    if (!s.emaFast || !s.emaSlow || !rsiVal || !adxVal || !atrVal || !bb) {
      log.debug('One or more indicators returned null — skipping');
      return;
    }

    // Volume surge check (pass current candle's volume for comparison)
    const volumeSurge = this._checkVolumeSurge(sym);

    const regime = this.getEffectiveRegime();

    // ------ 3) If position open, check dynamic TP ------
    if (s.entryPrice && s.positionSide) {
      const tpMultiplier = this._isTrendRegime(s.entryRegime) ? '2' : '1';
      const tpDistance = multiply(atrVal, tpMultiplier);

      if (s.positionSide === 'long') {
        const tpPrice = add(s.entryPrice, tpDistance);
        if (isGreaterThan(close, tpPrice)) {
          log.trade('Dynamic TP hit (long)', { close, tpPrice, atr: atrVal });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'take_profit');
          return;
        }
      }

      if (s.positionSide === 'short') {
        const tpPrice = subtract(s.entryPrice, tpDistance);
        if (isLessThan(close, tpPrice)) {
          log.trade('Dynamic TP hit (short)', { close, tpPrice, atr: atrVal });
          this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, close, 'take_profit');
          return;
        }
      }
    }

    // ------ 4) If no position, check entry based on current regime ------
    if (s.entryPrice) return; // Already in position — skip entry

    // Early exit if regime is null — AdaptiveRegime fundamentally depends on knowing the regime
    if (regime === null) return;

    const marketContext = {
      regime,
      emaFast: s.emaFast,
      emaSlow: s.emaSlow,
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
      s.lastSignal = signal;
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
    return this._s().lastSignal;
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
    super.onFill(fill); // R11: update StrategyBase trailing stop state
    if (!this._active) return;
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);
    const fillPrice = fill.price !== undefined ? String(fill.price) : null;
    const sym = fill.symbol || this.getCurrentSymbol();
    const s = this._s(sym);

    // AD-37: Set all position state ONLY on confirmed fill
    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      s.entryPrice = fillPrice || s.latestPrice;
      s.entryRegime = s.pendingEntryRegime || this.getEffectiveRegime();
      s.highestSinceEntry = s.entryPrice;
      s.lowestSinceEntry = null;
      s.pendingEntryRegime = null;
      log.trade('Long fill recorded', { entry: s.entryPrice, regime: s.entryRegime, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      s.entryPrice = fillPrice || s.latestPrice;
      s.entryRegime = s.pendingEntryRegime || this.getEffectiveRegime();
      s.lowestSinceEntry = s.entryPrice;
      s.highestSinceEntry = null;
      s.pendingEntryRegime = null;
      log.trade('Short fill recorded', { entry: s.entryPrice, regime: s.entryRegime, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: s.positionSide, symbol: sym });
      this._resetPosition(sym);
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
    const s = this._s();
    const sym = this.getCurrentSymbol();
    const emaFastAboveSlow = isGreaterThan(s.emaFast, s.emaSlow);
    const rsiPullback = isGreaterThan(rsiVal, '40') && isLessThan(rsiVal, '50');
    const adxStrong = isGreaterThan(adxVal, '25');

    if (emaFastAboveSlow && rsiPullback && adxStrong) {
      const confidence = this._calcConfidence(adxVal, rsiVal, false);

      log.trade('Trend-up long entry', {
        symbol: sym, price, rsi: rsiVal, adx: adxVal,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.TRENDING_UP;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
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
    const s = this._s();
    const sym = this.getCurrentSymbol();
    const emaFastBelowSlow = isLessThan(s.emaFast, s.emaSlow);
    const rsiRally = isGreaterThan(rsiVal, '50') && isLessThan(rsiVal, '60');
    const adxStrong = isGreaterThan(adxVal, '25');

    if (emaFastBelowSlow && rsiRally && adxStrong) {
      const confidence = this._calcConfidence(adxVal, rsiVal, false);

      log.trade('Trend-down short entry', {
        symbol: sym, price, rsi: rsiVal, adx: adxVal,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.TRENDING_DOWN;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
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
    const s = this._s();
    const sym = this.getCurrentSymbol();

    // Long: price below BB lower band and RSI oversold
    if (isLessThan(price, bb.lower) && isLessThan(rsiVal, '35')) {
      const confidence = this._calcConfidence(null, rsiVal, false);

      log.trade('Ranging mean-reversion long entry', {
        symbol: sym, price, rsi: rsiVal, bbLower: bb.lower,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.RANGING;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
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
        symbol: sym, price, rsi: rsiVal, bbUpper: bb.upper,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.RANGING;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
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
    const s = this._s();
    const sym = this.getCurrentSymbol();

    // Long: oversold bounce with volume confirmation
    if (isLessThan(rsiVal, '25') && volumeSurge) {
      const confidence = this._calcConfidence(null, rsiVal, true);

      log.trade('Volatile momentum long entry', {
        symbol: sym, price, rsi: rsiVal, volumeSurge,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.VOLATILE;

      return {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
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
        symbol: sym, price, rsi: rsiVal, volumeSurge,
      });

      // AD-37: Do NOT set position state here — defer to onFill()
      s.pendingEntryRegime = MARKET_REGIMES.VOLATILE;

      return {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
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
  _checkVolumeSurge(sym) {
    const hist = this._indicatorCache.getHistory(sym || this.getCurrentSymbol());
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
    const s = this._s();
    const sym = this.getCurrentSymbol();

    // Determine suggestedQty based on the regime under which the position was opened
    let suggestedQty = this._trendPositionSizePercent;
    if (s.entryRegime === MARKET_REGIMES.RANGING) {
      suggestedQty = this._rangePositionSizePercent;
    } else if (s.entryRegime === MARKET_REGIMES.VOLATILE) {
      suggestedQty = this._volatilePositionSizePercent;
    }

    const signal = {
      action,
      symbol: sym,
      category: this._category,
      suggestedQty,
      suggestedPrice: price,
      confidence: '1.0000',
      reason,
      reduceOnly: true,
      marketContext: {
        regime: this.getEffectiveRegime(),
        entryRegime: s.entryRegime,
        entryPrice: s.entryPrice,
        exitPrice: price,
        highestSinceEntry: s.highestSinceEntry,
        lowestSinceEntry: s.lowestSinceEntry,
      },
    };

    s.lastSignal = signal;
    this.emitSignal(signal);
    this._resetPosition();
  }

  /**
   * Reset all position-related state.
   * @private
   */
  _resetPosition(symbol) {
    const s = this._s(symbol);
    s.entryPrice = null;
    s.positionSide = null;
    s.entryRegime = null;
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
    s.pendingEntryRegime = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the global strategy registry
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('AdaptiveRegimeStrategy', AdaptiveRegimeStrategy);

module.exports = AdaptiveRegimeStrategy;
