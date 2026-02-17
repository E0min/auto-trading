'use strict';

/**
 * MaTrendStrategy — Multi-timeframe EMA trend-following strategy with trailing stop.
 *
 * Uses daily EMA(20)/EMA(60), 4h EMA(20)/EMA(50), and 1h EMA(9)/EMA(21) to
 * identify strong trends and enter on pullbacks to the 1h slow EMA. Exits via
 * TP (+4%), SL (-2%), trailing stop (-2% from extreme), or EMA crossover reversal.
 *
 * Bidirectional (Long & Short). Configurable leverage, max position 5% of equity.
 */

const StrategyBase = require('../../services/strategyBase');
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
  max,
  min,
} = require('../../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

const log = createLogger('MaTrendStrategy');

class MaTrendStrategy extends StrategyBase {
  static metadata = {
    name: 'MaTrendStrategy',
    targetRegimes: ['trending_up', 'trending_down'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 300000,
    gracePeriodMs: 300000,
    warmupCandles: 60,
    volatilityPreference: 'neutral',
    trailingStop: { enabled: false, activationPercent: '1.5', callbackPercent: '1.0' },
    description: '멀티타임프레임 EMA 추세추종 + 트레일링 스탑',
    docs: {
      summary: '일봉 EMA(20/30), 4시간봉 EMA(20/50), 1시간봉 EMA(9/21) 3개 타임프레임 정렬 확인 후 1시간 EMA(21) 풀백에서 진입하는 추세추종 전략. 타임스탬프 기반 실제 시간 경계로 상위 타임프레임을 집계한다(AD-13-5).',
      timeframe: '1분봉 수집 → 타임스탬프 기반 1시간/4시간/일봉 자동 집계',
      entry: {
        long: '일봉·4시간·1시간 모두 상승추세(Fast EMA > Slow EMA) + 1시간 저점이 EMA(21) ±1% 내 풀백 + 양봉(close>open) + 거래량 확인',
        short: '일봉·4시간·1시간 모두 하락추세(Fast EMA < Slow EMA) + 1시간 고점이 EMA(21) ±1% 내 랠리 + 음봉(close<open) + 거래량 확인',
        conditions: [
          '일봉 EMA(20) > EMA(30) (롱) 또는 < (숏)',
          '4시간 EMA(20) > EMA(50) (롱) 또는 < (숏)',
          '1시간 EMA(9) > EMA(21) (롱) 또는 < (숏)',
          '1시간 저/고점이 EMA(21) ±1% 이내 (풀백/랠리)',
          '현재 거래량 > 20봉 평균 거래량',
          '레짐: TRENDING_UP (롱) 또는 TRENDING_DOWN (숏)',
        ],
      },
      exit: {
        tp: '+4% (진입가 대비)',
        sl: '-2% (진입가 대비)',
        trailing: '최고/최저가 대비 -2% 하락/상승 시 트레일링 스탑',
        other: [
          '1시간 EMA(9)이 EMA(21)을 역크로스하면 청산',
          '4시간 추세 깨짐(EMA(20) vs EMA(50) 역전) 시 청산',
        ],
      },
      indicators: [
        'EMA(9), EMA(21) — 1시간봉',
        'EMA(20), EMA(50) — 4시간봉',
        'EMA(20), EMA(30) — 일봉',
        '거래량 SMA(20)',
      ],
      riskReward: {
        tp: '+4%',
        sl: '-2%',
        ratio: '2:1',
      },
      strengths: [
        '3개 타임프레임 정렬로 거짓 신호 필터링',
        '풀백 진입으로 유리한 가격에 포지션 확보',
        '트레일링 스탑으로 추세 지속 시 수익 극대화',
        '타임스탬프 기반 집계로 정확한 상위 TF 데이터',
      ],
      weaknesses: [
        '3중 TF 정렬 대기 시간이 길어 신호 빈도 낮음',
        '횡보장에서 잦은 손절 발생 가능',
        '급등락에서 풀백 없이 진입 기회 놓칠 수 있음',
        'EMA 후행 특성으로 추세 전환 초기 반응 지연',
      ],
      bestFor: '명확한 방향성이 있는 추세장(TRENDING_UP/DOWN)에서 풀백 매수/매도 기회 포착',
      warnings: [
        '워밍업 캔들 60봉(약 1시간) 필요 — 시작 직후 신호 없음',
        'EMA 계산에 충분한 1시간/4시간/일봉 데이터 축적 시간 필요',
        '레버리지 기본값 3배 — defaultConfig에서 미지정 시 시그널에 3배 적용',
      ],
      difficulty: 'intermediate',
    },
    defaultConfig: {
      h1FastEma: 9,
      h1SlowEma: 21,
      h4FastEma: 20,
      h4SlowEma: 50,
      dailyFastEma: 20,
      dailySlowEma: 30,
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

    // Maximum history to keep in buffers
    this._maxHistory = 500;
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

      // Aggregated higher-timeframe closes (AD-13-5: timestamp-based)
      h1Closes: [],    // String[] — 1h candle closes
      h1Volumes: [],   // String[] — 1h candle volumes (last 1m close volume)
      h4Closes: [],    // String[] — 4h candle closes
      dailyCloses: [], // String[] — daily candle closes

      // Timestamp-based boundary tracking (replaces count-based h1Count)
      _lastH1Idx: null,     // Math.floor(ts / 3600000)
      _lastH4Idx: null,     // Math.floor(ts / 14400000)
      _lastDailyIdx: null,  // Math.floor(ts / 86400000)
      _prevClose: null,     // Close of previous 1m candle (for period boundary)
      _prevVolume: null,    // Volume of previous 1m candle

      // Latest EMA values (String | null)
      h1Ema9: null,
      h1Ema21: null,
      h4Ema20: null,
      h4Ema50: null,
      dailyEma20: null,
      dailyEma60: null,

      // Trailing stop tracking
      highestSinceEntry: null,
      lowestSinceEntry: null,

      // Last kline data for bounce/drop candle detection
      lastKline: null,
    };
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

    const s = this._s();
    s.latestPrice = price;

    // No position open — nothing to check on tick
    if (!s.entryPrice) return;

    const action = s.lastSignal ? s.lastSignal.action : null;
    const isLong = action === SIGNAL_ACTIONS.OPEN_LONG;
    const isShort = action === SIGNAL_ACTIONS.OPEN_SHORT;

    if (!isLong && !isShort) return;

    // Update trailing stop tracking
    if (isLong) {
      s.highestSinceEntry = s.highestSinceEntry
        ? max(s.highestSinceEntry, price)
        : price;
    } else {
      s.lowestSinceEntry = s.lowestSinceEntry
        ? min(s.lowestSinceEntry, price)
        : price;
    }

    // --- Check trailing stop ---
    if (isLong && s.highestSinceEntry) {
      // trailingStop = highestSinceEntry * (1 - trailingStopPercent / 100)
      const trailFactor = subtract('1', divide(this._trailingStopPercent, '100'));
      const trailingStop = multiply(s.highestSinceEntry, trailFactor);
      if (isLessThanOrEqual(price, trailingStop)) {
        log.trade('Trailing stop hit (long)', {
          price, highest: s.highestSinceEntry, trailingStop,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'trailing_stop');
        return;
      }
    }

    if (isShort && s.lowestSinceEntry) {
      // trailingStop = lowestSinceEntry * (1 + trailingStopPercent / 100)
      const trailFactor = add('1', divide(this._trailingStopPercent, '100'));
      const trailingStop = multiply(s.lowestSinceEntry, trailFactor);
      if (isGreaterThanOrEqual(price, trailingStop)) {
        log.trade('Trailing stop hit (short)', {
          price, lowest: s.lowestSinceEntry, trailingStop,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'trailing_stop');
        return;
      }
    }

    // --- Check TP / SL ---
    if (isLong) {
      // TP: price >= entryPrice * (1 + tpPercent / 100)
      const tpPrice = multiply(s.entryPrice, add('1', divide(this._tpPercent, '100')));
      if (isGreaterThanOrEqual(price, tpPrice)) {
        log.trade('Take profit hit (long)', { price, tp: tpPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'take_profit');
        return;
      }

      // SL: price <= entryPrice * (1 - slPercent / 100)
      const slPrice = multiply(s.entryPrice, subtract('1', divide(this._slPercent, '100')));
      if (isLessThanOrEqual(price, slPrice)) {
        log.trade('Stop loss hit (long)', { price, sl: slPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, price, 'stop_loss');
        return;
      }
    }

    if (isShort) {
      // TP: price <= entryPrice * (1 - tpPercent / 100)
      const tpPrice = multiply(s.entryPrice, subtract('1', divide(this._tpPercent, '100')));
      if (isLessThanOrEqual(price, tpPrice)) {
        log.trade('Take profit hit (short)', { price, tp: tpPrice });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, price, 'take_profit');
        return;
      }

      // SL: price >= entryPrice * (1 + slPercent / 100)
      const slPrice = multiply(s.entryPrice, add('1', divide(this._slPercent, '100')));
      if (isGreaterThanOrEqual(price, slPrice)) {
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
    const sym = this.getCurrentSymbol();
    const s = this._s();

    // ------ 1) Timestamp-based multi-timeframe aggregation (AD-13-5) ------
    // Aggregate 1m candles into 1h/4h/daily using UTC time boundaries
    // instead of count-based (fixes bug where 24 × 1min was treated as daily)
    const ts = kline.ts || Date.now();
    const h1Idx = Math.floor(ts / 3600000);     // hour index
    const h4Idx = Math.floor(ts / 14400000);    // 4-hour index
    const dailyIdx = Math.floor(ts / 86400000); // day index

    let newH1 = false;
    if (s._lastH1Idx !== null && h1Idx !== s._lastH1Idx && s._prevClose !== null) {
      s.h1Closes.push(s._prevClose);
      s.h1Volumes.push(s._prevVolume || '0');
      if (s.h1Closes.length > this._maxHistory) s.h1Closes.splice(0, s.h1Closes.length - this._maxHistory);
      if (s.h1Volumes.length > this._maxHistory) s.h1Volumes.splice(0, s.h1Volumes.length - this._maxHistory);
      newH1 = true;
    }
    s._lastH1Idx = h1Idx;

    let newH4 = false;
    if (s._lastH4Idx !== null && h4Idx !== s._lastH4Idx && s._prevClose !== null) {
      s.h4Closes.push(s._prevClose);
      if (s.h4Closes.length > this._maxHistory) s.h4Closes.splice(0, s.h4Closes.length - this._maxHistory);
      newH4 = true;
    }
    s._lastH4Idx = h4Idx;

    let newDaily = false;
    if (s._lastDailyIdx !== null && dailyIdx !== s._lastDailyIdx && s._prevClose !== null) {
      s.dailyCloses.push(s._prevClose);
      if (s.dailyCloses.length > this._maxHistory) s.dailyCloses.splice(0, s.dailyCloses.length - this._maxHistory);
      newDaily = true;
    }
    s._lastDailyIdx = dailyIdx;

    s._prevClose = close;
    s._prevVolume = volume;

    // ------ 2) Calculate EMAs (only update each TF when new candle added) ------
    this._updateEmas(s, newH1, newH4, newDaily);

    // Store kline for bounce/drop detection
    s.lastKline = { close, volume, high, low, open };

    // ------ 4) Check exit conditions on kline (EMA crossover + 4h trend break) ------
    if (s.entryPrice) {
      const exitSignal = this._checkKlineExit(s, close);
      if (exitSignal) return;
    }

    // ------ 5) Check entry conditions ------
    if (s.entryPrice) return; // Already in position — skip entry logic

    // Need all EMAs calculated to evaluate entry
    if (!s.h1Ema9 || !s.h1Ema21 ||
        !s.h4Ema20 || !s.h4Ema50 ||
        !s.dailyEma20 || !s.dailyEma60) {
      log.debug('Waiting for sufficient data to compute all EMAs');
      return;
    }

    // --- Pullback condition: price within EMA21 +/- 1.0% ---
    const ema21Upper = multiply(s.h1Ema21, '1.01');
    const ema21Lower = multiply(s.h1Ema21, '0.99');

    // --- Volume confirmation: current volume > 20-period average ---
    const volumeConfirm = this._checkVolumeConfirmation(s, volume);

    // --- Daily trend ---
    const dailyUptrend = isGreaterThan(s.dailyEma20, s.dailyEma60);
    const dailyDowntrend = isLessThan(s.dailyEma20, s.dailyEma60);

    // --- 4h trend ---
    const h4Uptrend = isGreaterThan(s.h4Ema20, s.h4Ema50);
    const h4Downtrend = isLessThan(s.h4Ema20, s.h4Ema50);

    // --- 1h short-term trend ---
    const h1Uptrend = isGreaterThan(s.h1Ema9, s.h1Ema21);
    const h1Downtrend = isLessThan(s.h1Ema9, s.h1Ema21);

    // --- Long entry check ---
    // Pullback: h1 low touches EMA21 +/- 0.5%
    const longPullback = !isLessThan(low, ema21Lower) && !isGreaterThan(low, ema21Upper);
    // Bounce candle: close > open (bullish)
    const bounceCandle = isGreaterThan(close, open);

    if (dailyUptrend && h4Uptrend && h1Uptrend &&
        longPullback && bounceCandle && volumeConfirm &&
        (this.getEffectiveRegime() === null || this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP)) {
      log.trade('Long entry signal — multi-TF uptrend + pullback bounce', {
        symbol: sym,
        close,
        h1Ema9: s.h1Ema9,
        h1Ema21: s.h1Ema21,
      });

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
        category: this._category,
        suggestedPrice: close,
        stopLossPrice: multiply(close, subtract('1', divide(this._slPercent, '100'))),
        confidence: '0.75',
        leverage: String(this.config.leverage || '3'),
        positionSizePercent: this._positionSizePercent,
        marketContext: {
          regime: this.getEffectiveRegime(),
          dailyTrend: 'up',
          h4Trend: 'up',
          h1Trend: 'up',
          h1Ema9: s.h1Ema9,
          h1Ema21: s.h1Ema21,
          h4Ema20: s.h4Ema20,
          h4Ema50: s.h4Ema50,
          dailyEma20: s.dailyEma20,
          dailyEma60: s.dailyEma60,
          tp: multiply(close, add('1', divide(this._tpPercent, '100'))),
          sl: multiply(close, subtract('1', divide(this._slPercent, '100'))),
        },
      };

      s.lastSignal = signal;
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
        (this.getEffectiveRegime() === null || this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN)) {
      log.trade('Short entry signal — multi-TF downtrend + rally drop', {
        symbol: sym,
        close,
        h1Ema9: s.h1Ema9,
        h1Ema21: s.h1Ema21,
      });

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
        category: this._category,
        suggestedPrice: close,
        stopLossPrice: multiply(close, add('1', divide(this._slPercent, '100'))),
        confidence: '0.75',
        leverage: String(this.config.leverage || '3'),
        positionSizePercent: this._positionSizePercent,
        marketContext: {
          regime: this.getEffectiveRegime(),
          dailyTrend: 'down',
          h4Trend: 'down',
          h1Trend: 'down',
          h1Ema9: s.h1Ema9,
          h1Ema21: s.h1Ema21,
          h4Ema20: s.h4Ema20,
          h4Ema50: s.h4Ema50,
          dailyEma20: s.dailyEma20,
          dailyEma60: s.dailyEma60,
          tp: multiply(close, subtract('1', divide(this._tpPercent, '100'))),
          sl: multiply(close, add('1', divide(this._slPercent, '100'))),
        },
      };

      s.lastSignal = signal;
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
    super.onFill(fill); // R10: update StrategyBase trailing stop state
    if (!this._active) return;
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);
    const sym = fill.symbol || this.getCurrentSymbol();
    const s = this._s(sym);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.highestSinceEntry = s.entryPrice;
      s.lowestSinceEntry = null;
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.lowestSinceEntry = s.entryPrice;
      s.highestSinceEntry = null;
      log.trade('Short fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      log.trade('Position closed via fill', { symbol: sym });
      this._resetPosition(sym);
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
   * Recalculate EMA values. Each timeframe's EMAs only update when a new
   * candle was aggregated for that timeframe (AD-13-5: timestamp-based).
   *
   * @param {boolean} newH1    — true when a new 1h candle was just added
   * @param {boolean} newH4    — true when a new 4h candle was just added
   * @param {boolean} newDaily — true when a new daily candle was just added
   * @private
   */
  _updateEmas(s, newH1, newH4, newDaily) {
    // --- 1h EMAs (only when new 1h candle added) ---
    if (newH1) {
      const h1Len = s.h1Closes.length;

      if (h1Len >= this._h1FastPeriod) {
        if (s.h1Ema9 !== null) {
          s.h1Ema9 = this._calculateEma(
            s.h1Ema9, s.h1Closes[h1Len - 1], this._h1FastPeriod,
          );
        } else {
          s.h1Ema9 = this._calculateEmaFromArray(s.h1Closes, this._h1FastPeriod);
        }
      }

      if (h1Len >= this._h1SlowPeriod) {
        if (s.h1Ema21 !== null) {
          s.h1Ema21 = this._calculateEma(
            s.h1Ema21, s.h1Closes[h1Len - 1], this._h1SlowPeriod,
          );
        } else {
          s.h1Ema21 = this._calculateEmaFromArray(s.h1Closes, this._h1SlowPeriod);
        }
      }
    }

    // --- 4h EMAs (only when new 4h candle added) ---
    if (newH4) {
      const h4Len = s.h4Closes.length;

      if (h4Len >= this._h4FastPeriod) {
        if (s.h4Ema20 !== null) {
          s.h4Ema20 = this._calculateEma(
            s.h4Ema20, s.h4Closes[h4Len - 1], this._h4FastPeriod,
          );
        } else {
          s.h4Ema20 = this._calculateEmaFromArray(s.h4Closes, this._h4FastPeriod);
        }
      }

      if (h4Len >= this._h4SlowPeriod) {
        if (s.h4Ema50 !== null) {
          s.h4Ema50 = this._calculateEma(
            s.h4Ema50, s.h4Closes[h4Len - 1], this._h4SlowPeriod,
          );
        } else {
          s.h4Ema50 = this._calculateEmaFromArray(s.h4Closes, this._h4SlowPeriod);
        }
      }
    }

    // --- Daily EMAs (only when new daily candle added) ---
    if (newDaily) {
      const dLen = s.dailyCloses.length;

      if (dLen >= this._dailyFastPeriod) {
        if (s.dailyEma20 !== null) {
          s.dailyEma20 = this._calculateEma(
            s.dailyEma20, s.dailyCloses[dLen - 1], this._dailyFastPeriod,
          );
        } else {
          s.dailyEma20 = this._calculateEmaFromArray(s.dailyCloses, this._dailyFastPeriod);
        }
      }

      if (dLen >= this._dailySlowPeriod) {
        if (s.dailyEma60 !== null) {
          s.dailyEma60 = this._calculateEma(
            s.dailyEma60, s.dailyCloses[dLen - 1], this._dailySlowPeriod,
          );
        } else {
          s.dailyEma60 = this._calculateEmaFromArray(s.dailyCloses, this._dailySlowPeriod);
        }
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
  _checkVolumeConfirmation(s, currentVolume) {
    const lookback = 20;
    if (s.h1Volumes.length < 10) return true;  // Pass during warmup
    if (s.h1Volumes.length < lookback) return false;

    // Calculate simple moving average of the last 20 volumes
    let sum = '0';
    const start = s.h1Volumes.length - lookback;
    for (let i = start; i < s.h1Volumes.length; i++) {
      sum = add(sum, s.h1Volumes[i]);
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
  _checkKlineExit(s, close) {
    if (!s.h1Ema9 || !s.h1Ema21) return false;

    const action = s.lastSignal ? s.lastSignal.action : null;
    const isLong = action === SIGNAL_ACTIONS.OPEN_LONG;
    const isShort = action === SIGNAL_ACTIONS.OPEN_SHORT;

    // 1h EMA crossover reversal
    if (isLong && isLessThan(s.h1Ema9, s.h1Ema21)) {
      log.trade('EMA crossover reversal — closing long', {
        h1Ema9: s.h1Ema9, h1Ema21: s.h1Ema21,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'ema_crossover');
      return true;
    }

    if (isShort && isGreaterThan(s.h1Ema9, s.h1Ema21)) {
      log.trade('EMA crossover reversal — closing short', {
        h1Ema9: s.h1Ema9, h1Ema21: s.h1Ema21,
      });
      this._emitExit(SIGNAL_ACTIONS.CLOSE_SHORT, close, 'ema_crossover');
      return true;
    }

    // 4h trend break
    if (s.h4Ema20 && s.h4Ema50) {
      if (isLong && isLessThan(s.h4Ema20, s.h4Ema50)) {
        log.trade('4h trend break — closing long', {
          h4Ema20: s.h4Ema20, h4Ema50: s.h4Ema50,
        });
        this._emitExit(SIGNAL_ACTIONS.CLOSE_LONG, close, 'h4_trend_break');
        return true;
      }

      if (isShort && isGreaterThan(s.h4Ema20, s.h4Ema50)) {
        log.trade('4h trend break — closing short', {
          h4Ema20: s.h4Ema20, h4Ema50: s.h4Ema50,
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
    const sym = this.getCurrentSymbol();
    const s = this._s();
    const signal = {
      action,
      symbol: sym,
      category: this._category,
      suggestedPrice: price,
      confidence: '1.00',
      reason,
      reduceOnly: true,
      marketContext: {
        regime: this.getEffectiveRegime(),
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
    s.highestSinceEntry = null;
    s.lowestSinceEntry = null;
  }
}

// ---------------------------------------------------------------------------
// Register with the global strategy registry
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('MaTrendStrategy', MaTrendStrategy);

module.exports = MaTrendStrategy;
