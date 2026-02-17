'use strict';

/**
 * CandlePatternStrategy — Pure Price-Action Candlestick Pattern Trading (캔들 패턴 가격행동 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE, RANGING
 * Core concept: Detects classic Japanese candlestick reversal patterns from raw
 * OHLC data without any lagging indicators. ATR is used only for volatility
 * confirmation and dynamic TP/SL placement.
 *
 * Patterns detected:
 *   1. Bullish Engulfing — current bullish body fully engulfs previous bearish body → OPEN_LONG
 *   2. Bearish Engulfing — current bearish body fully engulfs previous bullish body → OPEN_SHORT
 *   3. Hammer (bullish)  — small body at top, lower shadow >= 2× body            → OPEN_LONG
 *   4. Shooting Star (bearish) — small body at bottom, upper shadow >= 2× body    → OPEN_SHORT
 *   5. Morning Star (3-candle) — bearish + small body + bullish                   → OPEN_LONG
 *   6. Evening Star (3-candle) — bullish + small body + bearish                   → OPEN_SHORT
 *
 * Entry conditions:
 *   - Pattern detected on latest completed kline(s)
 *   - ATR(14) > 0 — confirms volatility is present
 *   - Regime filter: allow TRENDING_UP, TRENDING_DOWN, VOLATILE, RANGING (not QUIET)
 *
 * Exit conditions:
 *   - Take Profit:  2 × ATR from entry price
 *   - Stop Loss:    1.5 × ATR from entry price
 *   - Trailing Stop: after 1×ATR profit, trail at 1.5×ATR from extreme price
 *
 * Position sizing: passes positionSizePercent to ExposureGuard.
 * All prices are String-based using mathUtils for safe arithmetic.
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
  isGreaterThanOrEqual,
  toFixed,
  abs,
  max: mathMax,
  min: mathMin,
} = require('../../utils/mathUtils');
const { atr } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('CandlePatternStrategy');

class CandlePatternStrategy extends StrategyBase {
  static metadata = {
    name: 'CandlePatternStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile', 'ranging'],
    riskLevel: 'medium',
    maxConcurrentPositions: 2,
    cooldownMs: 60000,
    gracePeriodMs: 600000,
    warmupCandles: 5,
    volatilityPreference: 'neutral',
    maxSymbolsPerStrategy: 3,
    description: '캔들 패턴 가격행동 — Engulfing / Hammer / Star 패턴 + ATR 기반 TP/SL',
    docs: {
      summary: '6가지 클래식 일본식 캔들스틱 반전 패턴(Engulfing, Hammer, Shooting Star, Morning/Evening Star)을 감지하여 진입하는 순수 가격행동 전략. ATR로 변동성을 확인하고 동적 TP/SL을 설정한다. 3-candle 패턴을 2-candle 및 1-candle 패턴보다 우선 검사한다.',
      timeframe: {
        primary: '1m',
        effective: '1m',
        note: '1분봉 기준으로 캔들 패턴을 감지하므로 매우 단기 반전 신호를 포착한다.',
      },
      entry: {
        long: [
          'Bullish Engulfing: 이전 음봉 body를 현재 양봉이 완전히 감쌈',
          'Hammer: 작은 body 상단 위치, 하단 그림자 >= 2배 body',
          'Morning Star: 큰 음봉 + 작은 body + 큰 양봉 (3봉 패턴)',
          'ATR(14) > 0 확인 (변동성 존재)',
          '레짐이 QUIET이 아닐 것',
        ],
        short: [
          'Bearish Engulfing: 이전 양봉 body를 현재 음봉이 완전히 감쌈',
          'Shooting Star: 작은 body 하단 위치, 상단 그림자 >= 2배 body',
          'Evening Star: 큰 양봉 + 작은 body + 큰 음봉 (3봉 패턴)',
          'ATR(14) > 0 확인 (변동성 존재)',
          '레짐이 QUIET이 아닐 것',
        ],
      },
      exit: {
        takeProfit: 'ATR(14) × 2 (진입가 대비)',
        stopLoss: 'ATR(14) × 1.5 (진입가 대비)',
        trailing: '1×ATR 수익 후 활성화, 최고/최저가에서 1.5×ATR 간격으로 추적',
        indicator: null,
      },
      indicators: ['ATR(14)'],
      riskReward: {
        typicalRR: '1:1.3 (SL 1.5×ATR : TP 2×ATR)',
        maxDrawdownPerTrade: 'ATR × 1.5 (약 1~3%)',
        avgHoldingPeriod: '수 분 ~ 수십 분',
      },
      strengths: [
        '후행 지표 없이 OHLC 데이터만으로 반전 신호 포착',
        'Morning/Evening Star 3봉 패턴은 신뢰도 높은 반전 신호',
        '거의 모든 시장 레짐(QUIET 제외)에서 작동 가능',
      ],
      weaknesses: [
        '1분봉 캔들 패턴은 노이즈가 많아 거짓 신호 빈번',
        'Hammer/Shooting Star 단일 캔들 패턴의 승률이 상대적으로 낮음',
        '강한 추세 시 반전 패턴이 무효화될 수 있음',
      ],
      bestFor: '추세 중 일시적 조정 후 반전 포인트를 캔들 형태로 포착하는 단기 매매',
      warnings: [
        '1분봉 기준이므로 수수료/슬리피지 비중이 클 수 있음',
        '동시 2포지션까지 허용되므로 리스크 관리 주의',
      ],
      difficulty: 'beginner',
    },
    defaultConfig: {
      atrPeriod: 14,                   // ATR 계산 기간
      tpMultiplier: '2',               // Take Profit = ATR × N
      slMultiplier: '1.5',             // Stop Loss = ATR × N
      trailingActivationAtr: '1',      // N×ATR 수익 후 trailing 활성화
      trailingDistanceAtr: '1.5',      // Trailing stop = extreme - N×ATR
      positionSizePercent: '3',        // 포지션 사이즈 (ExposureGuard 전달)
      leverage: '2',                   // 레버리지
      minBodyRatio: '0.3',            // 패턴 감지용 최소 body/fullRange 비율
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...CandlePatternStrategy.metadata.defaultConfig, ...config };
    super('CandlePatternStrategy', merged);

    /** @type {number} max data points to keep */
    this._maxHistory = 100;
  }

  /**
   * Override: create per-symbol state with all position/indicator fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {Array<{open:string, high:string, low:string, close:string}>} kline history */
      klineHistory: [],

      /** @type {string|null} stop loss price */
      stopPrice: null,

      /** @type {string|null} take profit price */
      tpPrice: null,

      /** @type {boolean} trailing stop activated */
      trailingActive: false,

      /** @type {string|null} trailing stop price */
      trailingStopPrice: null,

      /** @type {string|null} highest price since entry (long) */
      highestSinceEntry: null,

      /** @type {string|null} lowest price since entry (short) */
      lowestSinceEntry: null,

      /** @type {string|null} latest ATR value */
      latestAtr: null,
    };
  }

  // --------------------------------------------------------------------------
  // Candle anatomy helpers — pure price-action measurements
  // --------------------------------------------------------------------------

  /**
   * 캔들 body 크기 (|close - open|).
   * @param {{open:string, close:string}} candle
   * @returns {string}
   */
  _bodySize(candle) {
    return abs(subtract(candle.close, candle.open));
  }

  /**
   * 캔들 upper shadow (고가 - max(시가, 종가)).
   * @param {{open:string, high:string, close:string}} candle
   * @returns {string}
   */
  _upperShadow(candle) {
    return subtract(candle.high, mathMax(candle.open, candle.close));
  }

  /**
   * 캔들 lower shadow (min(시가, 종가) - 저가).
   * @param {{open:string, low:string, close:string}} candle
   * @returns {string}
   */
  _lowerShadow(candle) {
    return subtract(mathMin(candle.open, candle.close), candle.low);
  }

  /**
   * 양봉 여부 (close > open).
   * @param {{open:string, close:string}} candle
   * @returns {boolean}
   */
  _isBullish(candle) {
    return isGreaterThan(candle.close, candle.open);
  }

  /**
   * 음봉 여부 (close < open).
   * @param {{open:string, close:string}} candle
   * @returns {boolean}
   */
  _isBearish(candle) {
    return isLessThan(candle.close, candle.open);
  }

  /**
   * 캔들 전체 범위 (high - low).
   * @param {{high:string, low:string}} candle
   * @returns {string}
   */
  _fullRange(candle) {
    return subtract(candle.high, candle.low);
  }

  // --------------------------------------------------------------------------
  // Pattern detection — returns { pattern, direction } or null
  // --------------------------------------------------------------------------

  /**
   * 최근 캔들에서 패턴 감지. 6가지 클래식 캔들 패턴을 순서대로 확인한다.
   * 3-candle 패턴(Morning/Evening Star)을 먼저 검사하고,
   * 2-candle 패턴(Engulfing)을 그 다음, 1-candle 패턴(Hammer/Shooting Star)을 마지막으로 검사.
   *
   * @returns {{ pattern: string, direction: 'long'|'short' }|null}
   */
  _detectPattern() {
    const s = this._s();
    const sym = this.getCurrentSymbol();
    const len = s.klineHistory.length;
    if (len < 2) return null;

    const curr = s.klineHistory[len - 1];
    const prev = s.klineHistory[len - 2];

    // ---- 3-candle patterns (need at least 3 bars) ----
    if (len >= 3) {
      const prev2 = s.klineHistory[len - 3];

      // Morning Star (3-candle bullish reversal)
      // 1st: 큰 음봉, 2nd: 작은 body (doji/spinning top), 3rd: 큰 양봉
      const morningStarResult = this._checkMorningStar(prev2, prev, curr);
      if (morningStarResult) return morningStarResult;

      // Evening Star (3-candle bearish reversal)
      // 1st: 큰 양봉, 2nd: 작은 body, 3rd: 큰 음봉
      const eveningStarResult = this._checkEveningStar(prev2, prev, curr);
      if (eveningStarResult) return eveningStarResult;
    }

    // ---- 2-candle patterns ----

    // Bullish Engulfing: 이전 음봉의 body를 현재 양봉이 완전히 감싸는 패턴
    if (this._isBearish(prev) && this._isBullish(curr)) {
      const prevBodyHigh = prev.open;   // bearish: open > close
      const prevBodyLow = prev.close;
      const currBodyHigh = curr.close;  // bullish: close > open
      const currBodyLow = curr.open;

      if (isGreaterThan(currBodyHigh, prevBodyHigh) && isLessThan(currBodyLow, prevBodyLow)) {
        log.debug('Bullish Engulfing detected', { symbol: sym });
        return { pattern: 'bullish_engulfing', direction: 'long' };
      }
    }

    // Bearish Engulfing: 이전 양봉의 body를 현재 음봉이 완전히 감싸는 패턴
    if (this._isBullish(prev) && this._isBearish(curr)) {
      const prevBodyHigh = prev.close;  // bullish: close > open
      const prevBodyLow = prev.open;
      const currBodyHigh = curr.open;   // bearish: open > close
      const currBodyLow = curr.close;

      if (isGreaterThan(currBodyHigh, prevBodyHigh) && isLessThan(currBodyLow, prevBodyLow)) {
        log.debug('Bearish Engulfing detected', { symbol: sym });
        return { pattern: 'bearish_engulfing', direction: 'short' };
      }
    }

    // ---- 1-candle patterns ----

    // Hammer (bullish): small body at top, long lower shadow, small upper shadow
    const hammerResult = this._checkHammer(curr);
    if (hammerResult) return hammerResult;

    // Shooting Star (bearish): small body at bottom, long upper shadow, small lower shadow
    const shootingStarResult = this._checkShootingStar(curr);
    if (shootingStarResult) return shootingStarResult;

    return null;
  }

  /**
   * Hammer 패턴 확인 (bullish reversal).
   * 조건: body가 상단에 위치, lower shadow >= 2× body, upper shadow < body
   *
   * @param {{open:string, high:string, low:string, close:string}} candle
   * @returns {{ pattern: string, direction: 'long' }|null}
   */
  _checkHammer(candle) {
    const body = this._bodySize(candle);
    const range = this._fullRange(candle);
    const lower = this._lowerShadow(candle);
    const upper = this._upperShadow(candle);

    // 캔들 범위가 0이면 패턴 불가
    if (!isGreaterThan(range, '0')) return null;

    // body가 너무 크면 hammer가 아님 — body/range <= minBodyRatio 조건 확인
    // (hammer는 작은 body를 가져야 함)
    if (isGreaterThan(divide(body, range), this.config.minBodyRatio)) return null;

    // lower shadow >= 2 × body
    const doubleBody = multiply(body, '2');
    if (!isGreaterThanOrEqual(lower, doubleBody)) return null;

    // upper shadow < body (작은 윗꼬리)
    if (!isLessThan(upper, body)) return null;

    log.debug('Hammer detected', { symbol: this.getCurrentSymbol() });
    return { pattern: 'hammer', direction: 'long' };
  }

  /**
   * Shooting Star 패턴 확인 (bearish reversal).
   * 조건: body가 하단에 위치, upper shadow >= 2× body, lower shadow < body
   *
   * @param {{open:string, high:string, low:string, close:string}} candle
   * @returns {{ pattern: string, direction: 'short' }|null}
   */
  _checkShootingStar(candle) {
    const body = this._bodySize(candle);
    const range = this._fullRange(candle);
    const upper = this._upperShadow(candle);
    const lower = this._lowerShadow(candle);

    // 캔들 범위가 0이면 패턴 불가
    if (!isGreaterThan(range, '0')) return null;

    // body가 너무 크면 shooting star가 아님
    if (isGreaterThan(divide(body, range), this.config.minBodyRatio)) return null;

    // upper shadow >= 2 × body
    const doubleBody = multiply(body, '2');
    if (!isGreaterThanOrEqual(upper, doubleBody)) return null;

    // lower shadow < body (작은 아래꼬리)
    if (!isLessThan(lower, body)) return null;

    log.debug('Shooting Star detected', { symbol: this.getCurrentSymbol() });
    return { pattern: 'shooting_star', direction: 'short' };
  }

  /**
   * Morning Star 패턴 확인 (3-candle bullish reversal).
   * 조건:
   *   - 1st candle: 큰 음봉 (body > minBodyRatio × range)
   *   - 2nd candle: 작은 body (doji/spinning top)
   *   - 3rd candle: 큰 양봉, body가 1st candle body의 50% 이상 회복
   *
   * @param {object} first  — 첫 번째 캔들
   * @param {object} second — 두 번째 캔들 (small body)
   * @param {object} third  — 세 번째 캔들
   * @returns {{ pattern: string, direction: 'long' }|null}
   */
  _checkMorningStar(first, second, third) {
    // 1st: 음봉이어야 함
    if (!this._isBearish(first)) return null;

    // 3rd: 양봉이어야 함
    if (!this._isBullish(third)) return null;

    const firstBody = this._bodySize(first);
    const secondBody = this._bodySize(second);
    const thirdBody = this._bodySize(third);
    const firstRange = this._fullRange(first);

    // 1st candle must have significant body
    if (!isGreaterThan(firstRange, '0')) return null;
    if (!isGreaterThan(divide(firstBody, firstRange), this.config.minBodyRatio)) return null;

    // 2nd candle: small body — body가 1st candle body의 50% 미만
    const halfFirstBody = divide(firstBody, '2');
    if (!isLessThan(secondBody, halfFirstBody)) return null;

    // 3rd candle: body가 1st candle body의 50% 이상 (significant recovery)
    if (!isGreaterThan(thirdBody, halfFirstBody)) return null;

    log.debug('Morning Star detected', { symbol: this.getCurrentSymbol() });
    return { pattern: 'morning_star', direction: 'long' };
  }

  /**
   * Evening Star 패턴 확인 (3-candle bearish reversal).
   * 조건:
   *   - 1st candle: 큰 양봉
   *   - 2nd candle: 작은 body
   *   - 3rd candle: 큰 음봉, body가 1st candle body의 50% 이상 회복
   *
   * @param {object} first  — 첫 번째 캔들
   * @param {object} second — 두 번째 캔들 (small body)
   * @param {object} third  — 세 번째 캔들
   * @returns {{ pattern: string, direction: 'short' }|null}
   */
  _checkEveningStar(first, second, third) {
    // 1st: 양봉이어야 함
    if (!this._isBullish(first)) return null;

    // 3rd: 음봉이어야 함
    if (!this._isBearish(third)) return null;

    const firstBody = this._bodySize(first);
    const secondBody = this._bodySize(second);
    const thirdBody = this._bodySize(third);
    const firstRange = this._fullRange(first);

    // 1st candle must have significant body
    if (!isGreaterThan(firstRange, '0')) return null;
    if (!isGreaterThan(divide(firstBody, firstRange), this.config.minBodyRatio)) return null;

    // 2nd candle: small body — body가 1st candle body의 50% 미만
    const halfFirstBody = divide(firstBody, '2');
    if (!isLessThan(secondBody, halfFirstBody)) return null;

    // 3rd candle: body가 1st candle body의 50% 이상 (significant decline)
    if (!isGreaterThan(thirdBody, halfFirstBody)) return null;

    log.debug('Evening Star detected', { symbol: this.getCurrentSymbol() });
    return { pattern: 'evening_star', direction: 'short' };
  }

  // --------------------------------------------------------------------------
  // onTick — real-time hard SL / TP / trailing stop checks
  // --------------------------------------------------------------------------

  /**
   * Tick마다 호출. 포지션이 열려 있을 때 SL, TP, trailing stop을 실시간으로 확인한다.
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    const s = this._s();

    if (ticker && ticker.lastPrice !== undefined) {
      s.latestPrice = String(ticker.lastPrice);
    }

    if (s.entryPrice === null || s.positionSide === null) return;
    if (s.latestPrice === null) return;

    const price = s.latestPrice;

    // --- Hard stop loss ---
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'candle_stop_loss', {
          entryPrice: s.entryPrice,
          stopPrice: s.stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'candle_stop_loss', {
          entryPrice: s.entryPrice,
          stopPrice: s.stopPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Take profit ---
    if (s.tpPrice !== null) {
      if (s.positionSide === 'long' && isGreaterThan(price, s.tpPrice)) {
        this._emitCloseSignal('long', price, 'candle_take_profit', {
          entryPrice: s.entryPrice,
          tpPrice: s.tpPrice,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isLessThan(price, s.tpPrice)) {
        this._emitCloseSignal('short', price, 'candle_take_profit', {
          entryPrice: s.entryPrice,
          tpPrice: s.tpPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Trailing stop check ---
    if (s.trailingActive && s.trailingStopPrice !== null) {
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(price, s.highestSinceEntry)) {
          s.highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'trailing_stop', {
            entryPrice: s.entryPrice,
            trailingStopPrice: s.trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      } else if (s.positionSide === 'short') {
        if (s.lowestSinceEntry === null || isLessThan(price, s.lowestSinceEntry)) {
          s.lowestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isGreaterThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('short', price, 'trailing_stop', {
            entryPrice: s.entryPrice,
            trailingStopPrice: s.trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic: push data, compute ATR, detect patterns
  // --------------------------------------------------------------------------

  /**
   * Kline 완성 시 호출. klineHistory에 push 후 ATR 계산, 패턴 감지, 시그널 발생.
   * 포지션이 열려 있으면 trailing activation만 확인하고 신규 진입 신호는 무시한다.
   *
   * @param {object} kline — must have { open, high, low, close }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const open = kline && kline.open !== undefined ? String(kline.open) : close;
    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    // 1. Push data and trim
    s.klineHistory.push({ open, high, low, close });
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data for ATR + at least 3 candles for star patterns
    const { atrPeriod } = this.config;
    const minRequired = Math.max(atrPeriod + 1, 3);
    if (s.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', {
        have: s.klineHistory.length,
        need: minRequired,
      });
      return;
    }

    // 3. Compute ATR — volatility confirmation
    const currentAtr = atr(s.klineHistory, atrPeriod);
    if (currentAtr === null || !isGreaterThan(currentAtr, '0')) return;

    s.latestAtr = currentAtr;
    const price = close;
    const {
      tpMultiplier,
      slMultiplier,
      trailingActivationAtr,
      trailingDistanceAtr,
      positionSizePercent,
    } = this.config;

    // 4. If position open: check trailing activation, update extremes, skip new entries
    if (s.positionSide !== null && s.entryPrice !== null) {
      // Update extreme prices from kline data
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(high, s.highestSinceEntry)) {
          s.highestSinceEntry = high;
          if (s.trailingActive) this._updateTrailingStop();
        }
      } else {
        if (s.lowestSinceEntry === null || isLessThan(low, s.lowestSinceEntry)) {
          s.lowestSinceEntry = low;
          if (s.trailingActive) this._updateTrailingStop();
        }
      }

      // Trailing activation: after N×ATR profit
      if (!s.trailingActive) {
        const activationDist = multiply(trailingActivationAtr, currentAtr);
        if (s.positionSide === 'long') {
          const profit = subtract(price, s.entryPrice);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.highestSinceEntry = s.highestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (long)', {
              symbol: sym,
              trailingStopPrice: s.trailingStopPrice,
            });
          }
        } else if (s.positionSide === 'short') {
          const profit = subtract(s.entryPrice, price);
          if (isGreaterThan(profit, activationDist)) {
            s.trailingActive = true;
            s.lowestSinceEntry = s.lowestSinceEntry || price;
            this._updateTrailingStop();
            log.info('Trailing stop activated (short)', {
              symbol: sym,
              trailingStopPrice: s.trailingStopPrice,
            });
          }
        }
      }

      return; // Position open — no new entries
    }

    // 5. No position: regime filter + pattern detection

    // Regime filter: allow trending, volatile, ranging — reject QUIET
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.TRENDING_UP ||
      regime === MARKET_REGIMES.TRENDING_DOWN ||
      regime === MARKET_REGIMES.VOLATILE ||
      regime === MARKET_REGIMES.RANGING;
    if (!regimeOk) return;

    // 6. Detect candlestick pattern
    const detected = this._detectPattern();
    if (detected === null) return;

    const { pattern, direction } = detected;
    const riskPerUnit = multiply(slMultiplier, currentAtr);
    const conf = this._calcConfidence(pattern);

    // 7. Emit entry signal based on detected pattern direction
    if (direction === 'long') {
      const slPrice = subtract(price, multiply(slMultiplier, currentAtr));
      const tpPrice = add(price, multiply(tpMultiplier, currentAtr));

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: slPrice,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: `candle_pattern_long_${pattern}`,
        marketContext: {
          pattern,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          tpPrice,
          regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'long';
      s.stopPrice = slPrice;
      s.tpPrice = tpPrice;
      s.highestSinceEntry = high;
      s.lowestSinceEntry = null;
      s.trailingActive = false;
      s.trailingStopPrice = null;

      s.lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    if (direction === 'short') {
      const slPrice = add(price, multiply(slMultiplier, currentAtr));
      const tpPrice = subtract(price, multiply(tpMultiplier, currentAtr));

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        stopLossPrice: slPrice,
        riskPerUnit,
        confidence: toFixed(String(conf), 4),
        leverage: this.config.leverage,
        reason: `candle_pattern_short_${pattern}`,
        marketContext: {
          pattern,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          tpPrice,
          regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'short';
      s.stopPrice = slPrice;
      s.tpPrice = tpPrice;
      s.highestSinceEntry = null;
      s.lowestSinceEntry = low;
      s.trailingActive = false;
      s.trailingStopPrice = null;

      s.lastSignal = signal;
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

    const s = this._s();
    const sym = this.getCurrentSymbol();

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      log.trade('Short fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { side: s.positionSide, symbol: sym });
      this._resetPosition();
    }
  }

  // --------------------------------------------------------------------------
  // getSignal
  // --------------------------------------------------------------------------

  getSignal() {
    return this._s().lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a close signal (TP/SL/trailing).
   * @param {'long'|'short'} side
   * @param {string} price
   * @param {string} reason
   * @param {object} context
   */
  _emitCloseSignal(side, price, reason, context) {
    const s = this._s();
    const sym = this.getCurrentSymbol();
    const action = side === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
    const signal = {
      action,
      symbol: sym,
      category: this._category,
      suggestedQty: this.config.positionSizePercent,
      suggestedPrice: price,
      reduceOnly: true,
      confidence: toFixed('0.9000', 4),
      reason,
      marketContext: {
        ...context,
        currentPrice: price,
        atr: s.latestAtr,
      },
    };
    s.lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price based on extreme price and ATR.
   * Long: trail below highest price. Short: trail above lowest price.
   * Stop은 유리한 방향으로만 이동 (long: 위로만, short: 아래로만).
   */
  _updateTrailingStop() {
    const s = this._s();
    if (s.latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, s.latestAtr);

    if (s.positionSide === 'long' && s.highestSinceEntry !== null) {
      const newStop = subtract(s.highestSinceEntry, trailDist);
      // Only move stop up, never down
      if (s.trailingStopPrice === null || isGreaterThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
      }
    } else if (s.positionSide === 'short' && s.lowestSinceEntry !== null) {
      const newStop = add(s.lowestSinceEntry, trailDist);
      // Only move stop down, never up
      if (s.trailingStopPrice === null || isLessThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
      }
    }
  }

  /**
   * Calculate confidence score based on the detected pattern type and market regime.
   *
   * Base confidence: 0.55
   * Pattern bonuses:
   *   - Engulfing (bullish/bearish): +0.15
   *   - Morning/Evening Star:        +0.20
   *   - Hammer/Shooting Star:        +0.10
   * Regime bonus:
   *   - TRENDING_UP / TRENDING_DOWN:  +0.10
   *   - VOLATILE:                     +0.05
   *
   * @param {string} pattern — detected pattern name
   * @returns {number} confidence 0.50-1.00
   */
  _calcConfidence(pattern) {
    let conf = 0.55; // Base confidence

    // Pattern-specific bonus
    if (pattern === 'bullish_engulfing' || pattern === 'bearish_engulfing') {
      conf += 0.15;
    } else if (pattern === 'morning_star' || pattern === 'evening_star') {
      conf += 0.20;
    } else if (pattern === 'hammer' || pattern === 'shooting_star') {
      conf += 0.10;
    }

    // Regime bonus — trending markets favor reversal patterns after pullback
    if (
      this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP ||
      this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN
    ) {
      conf += 0.10;
    } else if (this.getEffectiveRegime() === MARKET_REGIMES.VOLATILE) {
      conf += 0.05;
    }

    return Math.min(conf, 1.0);
  }

  /**
   * Reset all position-tracking state after a full exit.
   * 포지션 청산 후 모든 내부 상태를 초기화한다.
   */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
    s.stopPrice = null;
    s.tpPrice = null;
    s.trailingActive = false;
    s.trailingStopPrice = null;
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('CandlePatternStrategy', CandlePatternStrategy);

module.exports = CandlePatternStrategy;
