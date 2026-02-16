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
    description: '캔들 패턴 가격행동 — Engulfing / Hammer / Star 패턴 + ATR 기반 TP/SL',
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

    // ---- Internal state ----

    /** @type {Array<{open:string, high:string, low:string, close:string}>} kline history */
    this.klineHistory = [];

    /** @type {string|null} latest ticker price */
    this._latestPrice = null;

    /** @type {object|null} most recently generated signal */
    this._lastSignal = null;

    /** @type {string|null} entry price */
    this._entryPrice = null;

    /** @type {'long'|'short'|null} current position direction */
    this._positionSide = null;

    /** @type {string|null} stop loss price */
    this._stopPrice = null;

    /** @type {string|null} take profit price */
    this._tpPrice = null;

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
    this._maxHistory = 100;
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
    const len = this.klineHistory.length;
    if (len < 2) return null;

    const curr = this.klineHistory[len - 1];
    const prev = this.klineHistory[len - 2];

    // ---- 3-candle patterns (need at least 3 bars) ----
    if (len >= 3) {
      const prev2 = this.klineHistory[len - 3];

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
        log.debug('Bullish Engulfing detected', { symbol: this._symbol });
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
        log.debug('Bearish Engulfing detected', { symbol: this._symbol });
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

    log.debug('Hammer detected', { symbol: this._symbol });
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

    log.debug('Shooting Star detected', { symbol: this._symbol });
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

    log.debug('Morning Star detected', { symbol: this._symbol });
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

    log.debug('Evening Star detected', { symbol: this._symbol });
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

    if (ticker && ticker.lastPrice !== undefined) {
      this._latestPrice = String(ticker.lastPrice);
    }

    if (this._entryPrice === null || this._positionSide === null) return;
    if (this._latestPrice === null) return;

    const price = this._latestPrice;

    // --- Hard stop loss ---
    if (this._stopPrice !== null) {
      if (this._positionSide === 'long' && isLessThan(price, this._stopPrice)) {
        this._emitCloseSignal('long', price, 'candle_stop_loss', {
          entryPrice: this._entryPrice,
          stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isGreaterThan(price, this._stopPrice)) {
        this._emitCloseSignal('short', price, 'candle_stop_loss', {
          entryPrice: this._entryPrice,
          stopPrice: this._stopPrice,
        });
        this._resetPosition();
        return;
      }
    }

    // --- Take profit ---
    if (this._tpPrice !== null) {
      if (this._positionSide === 'long' && isGreaterThan(price, this._tpPrice)) {
        this._emitCloseSignal('long', price, 'candle_take_profit', {
          entryPrice: this._entryPrice,
          tpPrice: this._tpPrice,
        });
        this._resetPosition();
        return;
      }
      if (this._positionSide === 'short' && isLessThan(price, this._tpPrice)) {
        this._emitCloseSignal('short', price, 'candle_take_profit', {
          entryPrice: this._entryPrice,
          tpPrice: this._tpPrice,
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

    // 1. Push data and trim
    this.klineHistory.push({ open, high, low, close });
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data for ATR + at least 3 candles for star patterns
    const { atrPeriod } = this.config;
    const minRequired = Math.max(atrPeriod + 1, 3);
    if (this.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', {
        have: this.klineHistory.length,
        need: minRequired,
      });
      return;
    }

    // 3. Compute ATR — volatility confirmation
    const currentAtr = atr(this.klineHistory, atrPeriod);
    if (currentAtr === null || !isGreaterThan(currentAtr, '0')) return;

    this._latestAtr = currentAtr;
    const price = close;
    const {
      tpMultiplier,
      slMultiplier,
      trailingActivationAtr,
      trailingDistanceAtr,
      positionSizePercent,
    } = this.config;

    // 4. If position open: check trailing activation, update extremes, skip new entries
    if (this._positionSide !== null && this._entryPrice !== null) {
      // Update extreme prices from kline data
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
        symbol: this._symbol,
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

      this._entryPrice = price;
      this._positionSide = 'long';
      this._stopPrice = slPrice;
      this._tpPrice = tpPrice;
      this._highestSinceEntry = high;
      this._lowestSinceEntry = null;
      this._trailingActive = false;
      this._trailingStopPrice = null;

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    if (direction === 'short') {
      const slPrice = add(price, multiply(slMultiplier, currentAtr));
      const tpPrice = subtract(price, multiply(tpMultiplier, currentAtr));

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
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

      this._entryPrice = price;
      this._positionSide = 'short';
      this._stopPrice = slPrice;
      this._tpPrice = tpPrice;
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
   * Emit a close signal (TP/SL/trailing).
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
   * Long: trail below highest price. Short: trail above lowest price.
   * Stop은 유리한 방향으로만 이동 (long: 위로만, short: 아래로만).
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
    this._entryPrice = null;
    this._positionSide = null;
    this._stopPrice = null;
    this._tpPrice = null;
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
registry.register('CandlePatternStrategy', CandlePatternStrategy);

module.exports = CandlePatternStrategy;
