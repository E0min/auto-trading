'use strict';

/**
 * FibonacciRetracementStrategy — Pure Price-Action Fibonacci Retracement
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, RANGING
 * Core concept: Identifies significant swing highs/lows, computes Fibonacci
 * retracement levels, and enters on bounces from the golden zone (0.382-0.618).
 *
 * Fibonacci Levels (from swing range):
 *   - Retracement: 0.236, 0.382, 0.500, 0.618, 0.786
 *   - Extension:   1.272, 1.618 (take-profit targets)
 *
 * Swing Detection:
 *   - Scans last swingPeriod bars for the most significant high/low
 *   - Upswing (bullish):   swing low precedes swing high chronologically
 *   - Downswing (bearish): swing high precedes swing low
 *   - Minimum swing size: minSwingAtr x ATR
 *
 * Entry Long:  upswing + price in golden zone + bullish candle + above 0.786
 * Entry Short: downswing + price in golden zone + bearish candle + below 0.786
 *
 * Exit Long:  TP1 = swing high (50%), TP2 = 1.272 ext, SL = 0.786 - buffer
 * Exit Short: TP1 = swing low (50%),  TP2 = 1.272 ext, SL = 0.786 + buffer
 * Trailing:   activated after TP1 hit, trails at trailingDistanceAtr x ATR
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
  max: mathMax,
  min: mathMin,
} = require('../../utils/mathUtils');
const { atr } = require('../../utils/indicators');
const { createLogger } = require('../../utils/logger');

const log = createLogger('FibonacciRetracementStrategy');

class FibonacciRetracementStrategy extends StrategyBase {
  static metadata = {
    name: 'FibonacciRetracementStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'ranging'],
    riskLevel: 'low',
    maxConcurrentPositions: 2,
    cooldownMs: 180000,
    gracePeriodMs: 600000,
    warmupCandles: 30,
    volatilityPreference: 'neutral',
    maxSymbolsPerStrategy: 3,
    description: '피보나치 되돌림 — 골든 존(0.382-0.618) 바운스 + ATR 기반 리스크 관리',
    docs: {
      summary: '최근 50봉의 가장 큰 스윙 고점/저점을 찾아 피보나치 되돌림 레벨(0.236~0.786)과 확장 레벨(1.272, 1.618)을 계산하고, 골든 존(0.382~0.618)에서 반등/반락 시 진입하는 전략. TP1(스윙 극값)에서 50% 부분 청산 후 트레일링으로 나머지를 관리한다.',
      timeframe: {
        primary: '1m',
        effective: '1m (50봉 = 약 50분 스윙)',
        note: '1분봉 50봉 기준 스윙을 분석하므로 단기 조정 구간에서의 되돌림을 포착한다.',
      },
      entry: {
        long: [
          '상승 스윙(저점→고점) 감지 후 되돌림 발생',
          '현재가가 골든 존(0.382~0.618 사이)에 위치',
          '양봉(close > open) 확인 — 반등 캔들',
          '저가가 0.786 레벨 위에 위치 (무효화 미발생)',
          '레짐이 TRENDING_UP 또는 RANGING',
        ],
        short: [
          '하락 스윙(고점→저점) 감지 후 되돌림 발생',
          '현재가가 골든 존(0.382~0.618 사이)에 위치',
          '음봉(close < open) 확인 — 반락 캔들',
          '고가가 0.786 레벨 아래에 위치 (무효화 미발생)',
          '레짐이 TRENDING_DOWN 또는 RANGING',
        ],
      },
      exit: {
        takeProfit: 'TP1: 스윙 극값(50% 부분 청산), TP2: 1.272 확장 레벨(전량 청산)',
        stopLoss: '0.786 무효화 레벨 - 0.5×ATR 버퍼',
        trailing: 'TP1 도달 후 자동 활성화, 2×ATR 간격으로 추적',
        indicator: null,
      },
      indicators: ['ATR(14)', 'Fibonacci Levels(0.236~1.618)'],
      riskReward: {
        typicalRR: '1:2~3 (0.786 손절 → 스윙 극값/1.272 확장)',
        maxDrawdownPerTrade: '골든존~0.786 거리 + 0.5×ATR',
        avgHoldingPeriod: '수십 분 ~ 수 시간',
      },
      strengths: [
        '피보나치 골든 존은 기관 트레이더도 많이 참고하는 레벨',
        'TP1 부분 청산 + TP2 전량 청산으로 수익 극대화',
        '0.786 무효화 레벨로 명확한 손절 기준 제공',
      ],
      weaknesses: [
        '스윙 방향 판단이 잘못되면 골든 존 진입 자체가 역추세 매매가 됨',
        '최소 3×ATR 이상의 스윙이 필요하므로 저변동성 구간에서는 신호 없음',
        '1분봉 기준 피보나치 레벨은 상위 타임프레임 대비 신뢰도가 낮음',
      ],
      bestFor: '명확한 상승/하락 스윙 이후 되돌림 구간에서 골든 존 바운스를 노리는 매매',
      warnings: [
        '최소 50봉의 히스토리 필요',
        '스윙 크기가 3×ATR 미만이면 무시됨',
      ],
      difficulty: 'intermediate',
    },
    defaultConfig: {
      swingPeriod: 50,              // Lookback bars for swing detection
      atrPeriod: 14,                // ATR calculation period
      minSwingAtr: '3',             // Minimum swing size in ATR multiples
      fibEntryLow: '0.382',         // Lower bound of golden zone
      fibEntryHigh: '0.618',        // Upper bound of golden zone
      fibInvalidation: '0.786',     // Invalidation / stop level
      fibExtension: '1.272',        // TP2 extension target
      slBuffer: '0.5',              // ATR multiplier beyond invalidation level
      trailingActivationAtr: '2',   // Activate trailing after reclaiming swing extreme
      trailingDistanceAtr: '2',     // Trail distance in ATR multiples
      positionSizePercent: '3',     // Position size as % of equity
      leverage: '2',
    },
  };

  /** @param {object} config — strategy configuration overrides */
  constructor(config = {}) {
    const merged = { ...FibonacciRetracementStrategy.metadata.defaultConfig, ...config };
    super('FibonacciRetracementStrategy', merged);

    /** @type {number} max kline data points to keep */
    this._maxHistory = 200;
  }

  /**
   * Override: create per-symbol state with all position/indicator fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {Array<{high:string, low:string, close:string, open:string}>} */
      klineHistory: [],

      /** @type {string|null} stop loss price */
      stopPrice: null,

      /** @type {string|null} TP1 — swing extreme */
      tp1Price: null,

      /** @type {string|null} TP2 — 1.272 extension */
      tp2Price: null,

      /** @type {boolean} whether TP1 partial (50%) exit has been taken */
      partialTaken: false,

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

      /** @type {{ price: string, index: number }|null} */
      swingHigh: null,

      /** @type {{ price: string, index: number }|null} */
      swingLow: null,

      /** @type {'up'|'down'|null} current swing direction */
      swingDirection: null,

      /** @type {object|null} computed Fibonacci levels */
      fibLevels: null,
    };
  }

  // --------------------------------------------------------------------------
  // Swing detection
  // --------------------------------------------------------------------------

  /**
   * Find the most significant swing high and low within the swingPeriod
   * lookback window. Direction is determined by chronological order:
   *   - low before high → 'up' (bullish)
   *   - high before low → 'down' (bearish)
   *
   * @returns {{ swingHigh: {price:string,index:number}|null, swingLow: {price:string,index:number}|null, direction: 'up'|'down'|null }}
   */
  _findSignificantSwing() {
    const s = this._s();
    const { swingPeriod } = this.config;
    const len = s.klineHistory.length;
    if (len < swingPeriod) {
      return { swingHigh: null, swingLow: null, direction: null };
    }

    const startIdx = len - swingPeriod;
    let highestPrice = s.klineHistory[startIdx].high;
    let highestIdx = startIdx;
    let lowestPrice = s.klineHistory[startIdx].low;
    let lowestIdx = startIdx;

    for (let i = startIdx + 1; i < len; i++) {
      const bar = s.klineHistory[i];
      if (isGreaterThan(bar.high, highestPrice)) {
        highestPrice = bar.high;
        highestIdx = i;
      }
      if (isLessThan(bar.low, lowestPrice)) {
        lowestPrice = bar.low;
        lowestIdx = i;
      }
    }

    const swingHigh = { price: highestPrice, index: highestIdx };
    const swingLow = { price: lowestPrice, index: lowestIdx };

    let direction = null;
    if (lowestIdx < highestIdx) direction = 'up';
    else if (highestIdx < lowestIdx) direction = 'down';

    return { swingHigh, swingLow, direction };
  }

  // --------------------------------------------------------------------------
  // Fibonacci level computation
  // --------------------------------------------------------------------------

  /**
   * Compute all Fibonacci retracement and extension levels.
   *
   * Bullish (upswing): retracement measured from high downward.
   *   fib_0.382 = high - 0.382 × range
   * Bearish (downswing): retracement measured from low upward.
   *   fib_0.382 = low + 0.382 × range
   *
   * @param {string} swingHighPrice
   * @param {string} swingLowPrice
   * @param {'up'|'down'} direction
   * @returns {object} all computed fib levels
   */
  _computeFibLevels(swingHighPrice, swingLowPrice, direction) {
    const range = subtract(swingHighPrice, swingLowPrice);
    const fibRatios = ['0.236', '0.382', '0.500', '0.618', '0.786'];
    const extRatios = ['1.272', '1.618'];
    const levels = {};

    if (direction === 'up') {
      for (const r of fibRatios) levels[`fib_${r}`] = subtract(swingHighPrice, multiply(r, range));
      for (const r of extRatios) levels[`ext_${r}`] = add(swingLowPrice, multiply(r, range));
    } else {
      for (const r of fibRatios) levels[`fib_${r}`] = add(swingLowPrice, multiply(r, range));
      for (const r of extRatios) levels[`ext_${r}`] = subtract(swingHighPrice, multiply(r, range));
    }

    levels.swingHigh = swingHighPrice;
    levels.swingLow = swingLowPrice;
    levels.range = range;
    levels.direction = direction;
    return levels;
  }

  // --------------------------------------------------------------------------
  // Golden zone check
  // --------------------------------------------------------------------------

  /**
   * Check if price is within the 0.382–0.618 golden zone.
   * Uses mathMin/mathMax to handle both directions uniformly.
   *
   * @param {string} price
   * @param {'up'|'down'} direction
   * @returns {boolean}
   */
  _isInGoldenZone(price, direction) {
    const s = this._s();
    if (!s.fibLevels) return false;
    const fib382 = s.fibLevels['fib_0.382'];
    const fib618 = s.fibLevels['fib_0.618'];
    const zoneLow = mathMin(fib382, fib618);
    const zoneHigh = mathMax(fib382, fib618);
    return !isLessThan(price, zoneLow) && !isGreaterThan(price, zoneHigh);
  }

  // --------------------------------------------------------------------------
  // Confidence calculation
  // --------------------------------------------------------------------------

  /**
   * Signal confidence based on fib proximity and regime alignment.
   *
   * Base: 0.55
   * Fib bonus: 0.618 → +0.20 | 0.500 → +0.15 | 0.382 → +0.10
   * Regime bonus: trending in favour → +0.10
   *
   * @param {string} price
   * @param {'up'|'down'} direction
   * @returns {number} 0.50–1.00
   */
  _calcConfidence(price, direction) {
    const s = this._s();
    let conf = 0.55;
    if (!s.fibLevels) return conf;

    const dist382 = parseFloat(abs(subtract(price, s.fibLevels['fib_0.382'])));
    const dist500 = parseFloat(abs(subtract(price, s.fibLevels['fib_0.500'])));
    const dist618 = parseFloat(abs(subtract(price, s.fibLevels['fib_0.618'])));
    const minDist = Math.min(dist382, dist500, dist618);

    if (minDist === dist618) conf += 0.20;
    else if (minDist === dist500) conf += 0.15;
    else conf += 0.10;

    const regime = this.getEffectiveRegime();
    if (direction === 'up' && regime === MARKET_REGIMES.TRENDING_UP) conf += 0.10;
    else if (direction === 'down' && regime === MARKET_REGIMES.TRENDING_DOWN) conf += 0.10;

    return Math.min(conf, 1.0);
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / TP / trailing stop checks
  // --------------------------------------------------------------------------

  /**
   * Real-time exit checks on every ticker update:
   *   1. Hard stop loss (0.786 level +/- slBuffer × ATR)
   *   2. TP2 full exit (1.272 extension)
   *   3. TP1 partial exit (50% at swing extreme), activates trailing
   *   4. Trailing stop ratchet check
   *
   * @param {object} ticker — { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;
    const s = this._s();
    const sym = this.getCurrentSymbol();

    if (ticker && ticker.lastPrice !== undefined) {
      s.latestPrice = String(ticker.lastPrice);
    }
    if (s.entryPrice === null || s.positionSide === null) return;
    if (s.latestPrice === null) return;

    const price = s.latestPrice;

    // --- Hard stop loss ---
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'fib_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice, fibLevels: s.fibLevels,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'fib_stop_loss', {
          entryPrice: s.entryPrice, stopPrice: s.stopPrice, fibLevels: s.fibLevels,
        });
        this._resetPosition();
        return;
      }
    }

    // --- TP2: full exit at 1.272 extension ---
    if (s.tp2Price !== null) {
      if (s.positionSide === 'long' && isGreaterThan(price, s.tp2Price)) {
        this._emitCloseSignal('long', price, 'fib_tp2_extension', {
          entryPrice: s.entryPrice, tp2Price: s.tp2Price,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isLessThan(price, s.tp2Price)) {
        this._emitCloseSignal('short', price, 'fib_tp2_extension', {
          entryPrice: s.entryPrice, tp2Price: s.tp2Price,
        });
        this._resetPosition();
        return;
      }
    }

    // --- TP1: partial exit (50%) at swing extreme ---
    if (s.tp1Price !== null && !s.partialTaken) {
      if (s.positionSide === 'long' && isGreaterThan(price, s.tp1Price)) {
        this._emitCloseSignal('long', price, 'fib_tp1_swing_high', {
          entryPrice: s.entryPrice, tp1Price: s.tp1Price, partialPercent: '50',
        });
        s.partialTaken = true;
        s.trailingActive = true;
        s.highestSinceEntry = price;
        this._updateTrailingStop();
        log.info('TP1 hit, trailing activated (long)', {
          symbol: sym, trailingStop: s.trailingStopPrice,
        });
        return;
      }
      if (s.positionSide === 'short' && isLessThan(price, s.tp1Price)) {
        this._emitCloseSignal('short', price, 'fib_tp1_swing_low', {
          entryPrice: s.entryPrice, tp1Price: s.tp1Price, partialPercent: '50',
        });
        s.partialTaken = true;
        s.trailingActive = true;
        s.lowestSinceEntry = price;
        this._updateTrailingStop();
        log.info('TP1 hit, trailing activated (short)', {
          symbol: sym, trailingStop: s.trailingStopPrice,
        });
        return;
      }
    }

    // --- Trailing stop ---
    if (s.trailingActive && s.trailingStopPrice !== null) {
      if (s.positionSide === 'long') {
        if (s.highestSinceEntry === null || isGreaterThan(price, s.highestSinceEntry)) {
          s.highestSinceEntry = price;
          this._updateTrailingStop();
        }
        if (isLessThan(price, s.trailingStopPrice)) {
          this._emitCloseSignal('long', price, 'fib_trailing_stop', {
            entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice,
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
          this._emitCloseSignal('short', price, 'fib_trailing_stop', {
            entryPrice: s.entryPrice, trailingStopPrice: s.trailingStopPrice,
          });
          this._resetPosition();
          return;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * Kline handler — entry signal generation workflow:
   *   1. Push kline data and trim history
   *   2. Compute ATR
   *   3. Position open → update extreme trackers, skip entries
   *   4. No position → find swings, compute fib, check golden zone bounce
   *
   * @param {object} kline — { high, low, close, open }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;
    const open = kline && kline.open !== undefined ? String(kline.open) : close;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    // 1. Push and trim
    s.klineHistory.push({ high, low, close, open });
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // 2. Minimum data check
    const { swingPeriod, atrPeriod } = this.config;
    const minRequired = Math.max(swingPeriod, atrPeriod + 1);
    if (s.klineHistory.length < minRequired) {
      log.debug('Not enough data', { have: s.klineHistory.length, need: minRequired });
      return;
    }

    // 3. Compute ATR
    const currentAtr = atr(s.klineHistory, atrPeriod);
    if (currentAtr === null) return;
    s.latestAtr = currentAtr;

    // 4. Position open: update extreme trackers only
    if (s.positionSide !== null && s.entryPrice !== null) {
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
      return; // No new entries while position open
    }

    // 5. No position — swing detection and fib bounce check

    // 5a. Find significant swings
    const { swingHigh, swingLow, direction } = this._findSignificantSwing();
    if (!swingHigh || !swingLow || direction === null) {
      log.debug('No valid swing', { swingHigh, swingLow, direction });
      return;
    }

    // 5b. Validate swing size (>= minSwingAtr × ATR)
    const swingRange = subtract(swingHigh.price, swingLow.price);
    const minSwingSize = multiply(this.config.minSwingAtr, currentAtr);
    if (isLessThan(swingRange, minSwingSize)) {
      log.debug('Swing too small', { swingRange, minSwingSize, atr: currentAtr });
      return;
    }

    // 5c. Update state and compute fib levels
    s.swingHigh = swingHigh;
    s.swingLow = swingLow;
    s.swingDirection = direction;
    s.fibLevels = this._computeFibLevels(swingHigh.price, swingLow.price, direction);

    const regime = this.getEffectiveRegime();
    const price = close;
    const { positionSizePercent, slBuffer, fibInvalidation } = this.config;

    // 5d. Bullish fib bounce -> long entry
    if (direction === 'up') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_UP ||
        regime === MARKET_REGIMES.RANGING;
      if (!regimeOk) return;
      if (!this._isInGoldenZone(price, direction)) return;
      if (!isGreaterThan(close, open)) return; // Bullish candle required

      const fib786 = s.fibLevels[`fib_${fibInvalidation}`];
      if (isLessThan(low, fib786)) return; // Invalidated

      const slDistance = multiply(slBuffer, currentAtr);
      const slPrice = subtract(fib786, slDistance);
      const riskPerUnit = subtract(price, slPrice);
      const tp1 = s.fibLevels.swingHigh;
      const tp2 = s.fibLevels['ext_1.272'];
      const conf = this._calcConfidence(price, direction);

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
        reason: 'fib_golden_zone_bounce_long',
        marketContext: {
          swingHigh: swingHigh.price, swingLow: swingLow.price,
          swingDirection: direction, fibLevels: s.fibLevels,
          tp1, tp2, slPrice, atr: currentAtr, riskPerUnit, regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'long';
      s.stopPrice = slPrice;
      s.tp1Price = tp1;
      s.tp2Price = tp2;
      s.partialTaken = false;
      s.highestSinceEntry = high;
      s.lowestSinceEntry = null;
      s.trailingActive = false;
      s.trailingStopPrice = null;

      s.lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // 5e. Bearish fib bounce -> short entry
    if (direction === 'down') {
      const regimeOk = regime === null ||
        regime === MARKET_REGIMES.TRENDING_DOWN ||
        regime === MARKET_REGIMES.RANGING;
      if (!regimeOk) return;
      if (!this._isInGoldenZone(price, direction)) return;
      if (!isLessThan(close, open)) return; // Bearish candle required

      const fib786 = s.fibLevels[`fib_${fibInvalidation}`];
      if (isGreaterThan(high, fib786)) return; // Invalidated

      const slDistance = multiply(slBuffer, currentAtr);
      const slPrice = add(fib786, slDistance);
      const riskPerUnit = subtract(slPrice, price);
      const tp1 = s.fibLevels.swingLow;
      const tp2 = s.fibLevels['ext_1.272'];
      const conf = this._calcConfidence(price, direction);

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
        reason: 'fib_golden_zone_bounce_short',
        marketContext: {
          swingHigh: swingHigh.price, swingLow: swingLow.price,
          swingDirection: direction, fibLevels: s.fibLevels,
          tp1, tp2, slPrice, atr: currentAtr, riskPerUnit, regime,
        },
      };

      s.entryPrice = price;
      s.positionSide = 'short';
      s.stopPrice = slPrice;
      s.tp1Price = tp1;
      s.tp2Price = tp2;
      s.partialTaken = false;
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

  /** @param {object} fill — fill data from the exchange */
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

  /** @returns {object|null} most recent signal */
  getSignal() {
    return this._s().lastSignal;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a close signal.
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
      marketContext: { ...context, currentPrice: price, atr: s.latestAtr },
    };
    s.lastSignal = signal;
    this.emitSignal(signal);
  }

  /**
   * Update trailing stop price. Ratchets only — longs move up, shorts down.
   */
  _updateTrailingStop() {
    const s = this._s();
    if (s.latestAtr === null) return;
    const trailDist = multiply(this.config.trailingDistanceAtr, s.latestAtr);

    if (s.positionSide === 'long' && s.highestSinceEntry !== null) {
      const newStop = subtract(s.highestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isGreaterThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
      }
    } else if (s.positionSide === 'short' && s.lowestSinceEntry !== null) {
      const newStop = add(s.lowestSinceEntry, trailDist);
      if (s.trailingStopPrice === null || isLessThan(newStop, s.trailingStopPrice)) {
        s.trailingStopPrice = newStop;
      }
    }
  }

  /**
   * Reset all position-tracking state after a full exit.
   */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
    s.stopPrice = null;
    s.tp1Price = null;
    s.tp2Price = null;
    s.partialTaken = false;
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
registry.register('FibonacciRetracementStrategy', FibonacciRetracementStrategy);

module.exports = FibonacciRetracementStrategy;
