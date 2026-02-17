'use strict';

/**
 * SupertrendStrategy — Supertrend + MACD + Volume Oscillator 추세추종 전략
 *
 * 슈퍼트렌드 지표로 추세 방향을 판단하고, MACD로 모멘텀을 확인한 뒤,
 * Volume Oscillator로 횡보장을 필터링하여 거짓 신호를 제거한다.
 *
 * - 양방향 (Long & Short)
 * - 타임프레임: 1시간봉
 * - 레버리지: 5x, 최대 포지션 비중 5%
 * - TP +3%, SL -2%
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
  abs,
} = require('../../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

const log = createLogger('SupertrendStrategy');

class SupertrendStrategy extends StrategyBase {
  static metadata = {
    name: 'SupertrendStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 180000,
    gracePeriodMs: 300000,
    warmupCandles: 60,
    volatilityPreference: 'neutral',
    maxSymbolsPerStrategy: 3,
    trailingStop: { enabled: false, activationPercent: '1.5', callbackPercent: '1.0' },
    description: '슈퍼트렌드 + MACD 추세추종',
    defaultConfig: {
      atrPeriod: 10,
      supertrendMultiplier: 3,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      volOscShort: 5,
      volOscLong: 20,
      positionSizePercent: '5',
      tpPercent: '3',
      slPercent: '2',
    },
  };

  /**
   * @param {object} config — strategy configuration (merged with defaults)
   */
  constructor(config = {}) {
    const merged = { ...SupertrendStrategy.metadata.defaultConfig, ...config };
    super('SupertrendStrategy', merged);

    // Configuration (shared across symbols)
    this._atrPeriod = merged.atrPeriod;
    this._supertrendMultiplier = String(merged.supertrendMultiplier);
    this._macdFast = merged.macdFast;
    this._macdSlow = merged.macdSlow;
    this._macdSignal = merged.macdSignal;
    this._volOscShort = merged.volOscShort;
    this._volOscLong = merged.volOscLong;
    this._positionSizePercent = merged.positionSizePercent;
    this._tpPercent = merged.tpPercent;
    this._slPercent = merged.slPercent;

    this._maxHistory = Math.max(
      this._macdSlow + this._macdSignal,
      this._atrPeriod,
      this._volOscLong,
    ) + 50; // extra buffer for warm-up
  }

  /**
   * Override: create per-symbol state with all indicator/position fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      // Kline history: { high, low, close, volume } — all Strings
      klineHistory: [],

      // ATR values
      atrValues: [],

      // Supertrend state
      supertrendDir: null,   // 'UP' | 'DOWN' | null
      prevSupertrendDir: null,
      upperBand: null,
      lowerBand: null,
      prevUpperBand: null,
      prevLowerBand: null,

      // MACD state
      macdLine: null,
      signalLine: null,
      histogram: null,
      prevMacdLine: null,
      prevSignalLine: null,

      // EMA accumulators for MACD (kept across klines)
      fastEmaValue: null,
      slowEmaValue: null,
      signalEmaValue: null,
      fastEmaCount: 0,
      slowEmaCount: 0,
      signalEmaCount: 0,

      // MACD seed sum for signal EMA
      macdSeedSum: null,

      // Volume Oscillator state
      volOsc: null,
      volShortEmaValue: null,
      volLongEmaValue: null,
      volShortEmaCount: 0,
      volLongEmaCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   * Stores latest price and checks TP/SL if a position is open.
   *
   * @param {object} ticker — must contain { lastPrice } as String
   */
  onTick(ticker) {
    if (!this._active) return;

    if (!ticker || !ticker.lastPrice) return;

    const s = this._s();
    s.latestPrice = String(ticker.lastPrice);

    // Check TP/SL only when we have an open position
    if (s.positionSide && s.entryPrice) {
      this._checkTpSl();
    }
  }

  /**
   * Called on every incoming kline (candlestick) update.
   *
   * @param {object} kline — must contain { high, low, close, volume } as Strings
   */
  onKline(kline) {
    if (!this._active) return;

    if (!kline || !kline.high || !kline.low || !kline.close || !kline.volume) {
      log.warn('onKline: invalid kline data', { kline });
      return;
    }

    const s = this._s();

    // Store candle
    s.klineHistory.push({
      high: String(kline.high),
      low: String(kline.low),
      close: String(kline.close),
      volume: String(kline.volume),
    });

    // Trim history
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // Need at least macdSlow + macdSignal candles for MACD, atrPeriod+1 for ATR
    const minCandles = Math.max(this._macdSlow + this._macdSignal, this._atrPeriod + 1, this._volOscLong);
    if (s.klineHistory.length < minCandles) {
      log.debug('onKline: not enough history', {
        have: s.klineHistory.length,
        need: minCandles,
      });
      return;
    }

    // Update latest price from close
    s.latestPrice = String(kline.close);

    // ---- Calculate indicators ----
    this._computeAtr(this._atrPeriod);
    this._computeSupertrend();
    this._computeMacd();
    this._computeVolumeOscillator();

    // ---- Evaluate signal logic ----
    this._evaluateSignal();
  }

  /**
   * Return the most recent signal or null.
   * @returns {object|null}
   */
  getSignal() {
    return this._s().lastSignal;
  }

  /**
   * Handle order fills — track entry price and position side.
   * @param {object} fill
   */
  onFill(fill) {
    super.onFill(fill); // R10: update StrategyBase trailing stop state
    if (!fill) return;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    if (fill.action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      s.entryPrice = String(fill.price || s.latestPrice);
      log.trade('Long position opened', { entry: s.entryPrice, symbol: sym });
    } else if (fill.action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      s.entryPrice = String(fill.price || s.latestPrice);
      log.trade('Short position opened', { entry: s.entryPrice, symbol: sym });
    } else if (
      fill.action === SIGNAL_ACTIONS.CLOSE_LONG ||
      fill.action === SIGNAL_ACTIONS.CLOSE_SHORT
    ) {
      log.trade('Position closed', { side: s.positionSide, symbol: sym });
      s.positionSide = null;
      s.entryPrice = null;
    }
  }

  // ---------------------------------------------------------------------------
  // TP / SL check (called from onTick)
  // ---------------------------------------------------------------------------

  /**
   * Check take-profit and stop-loss against the latest price.
   * Emits a close signal when thresholds are breached.
   */
  _checkTpSl() {
    const s = this._s();
    if (!s.entryPrice || !s.latestPrice) return;

    const tpThreshold = divide(this._tpPercent, '100', 8);
    const slThreshold = divide(this._slPercent, '100', 8);

    if (s.positionSide === 'long') {
      // Long: TP when price rises by tpPercent, SL when it drops by slPercent
      const pnlRatio = divide(subtract(s.latestPrice, s.entryPrice), s.entryPrice, 8);

      if (isGreaterThan(pnlRatio, tpThreshold)) {
        log.trade('Long TP hit', {
          entry: s.entryPrice,
          current: s.latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'tp_hit', '0.95');
        return;
      }

      // SL: pnlRatio < -slThreshold
      const negSl = subtract('0', slThreshold);
      if (isLessThan(pnlRatio, negSl)) {
        log.trade('Long SL hit', {
          entry: s.entryPrice,
          current: s.latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'sl_hit', '0.99');
        return;
      }
    } else if (s.positionSide === 'short') {
      // Short: TP when price drops by tpPercent, SL when it rises by slPercent
      const pnlRatio = divide(subtract(s.entryPrice, s.latestPrice), s.entryPrice, 8);

      if (isGreaterThan(pnlRatio, tpThreshold)) {
        log.trade('Short TP hit', {
          entry: s.entryPrice,
          current: s.latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'tp_hit', '0.95');
        return;
      }

      const negSl = subtract('0', slThreshold);
      if (isLessThan(pnlRatio, negSl)) {
        log.trade('Short SL hit', {
          entry: s.entryPrice,
          current: s.latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'sl_hit', '0.99');
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Indicator calculations
  // ---------------------------------------------------------------------------

  /**
   * Calculate ATR (Average True Range) from klineHistory.
   * ATR = SMA of True Range over `period` bars.
   *
   * True Range = max(high - low, |high - prevClose|, |low - prevClose|)
   *
   * @param {number} period
   */
  _computeAtr(period) {
    const s = this._s();
    const len = s.klineHistory.length;
    if (len < period + 1) return;

    const trValues = [];
    for (let i = len - period; i < len; i++) {
      const candle = s.klineHistory[i];
      const prevCandle = s.klineHistory[i - 1];

      const highLow = subtract(candle.high, candle.low);
      const highPrevClose = abs(subtract(candle.high, prevCandle.close));
      const lowPrevClose = abs(subtract(candle.low, prevCandle.close));

      // True Range = max of the three
      let tr = highLow;
      if (isGreaterThan(highPrevClose, tr)) tr = highPrevClose;
      if (isGreaterThan(lowPrevClose, tr)) tr = lowPrevClose;

      trValues.push(tr);
    }

    // ATR = simple average of TR values
    let sum = '0';
    for (const tr of trValues) {
      sum = add(sum, tr);
    }
    const atrVal = divide(sum, String(trValues.length), 8);

    s.atrValues.push(atrVal);
    if (s.atrValues.length > this._maxHistory) {
      s.atrValues = s.atrValues.slice(-this._maxHistory);
    }
  }

  /**
   * Calculate Supertrend direction based on ATR.
   *
   * Upper Band = (high + low) / 2 + (multiplier * ATR)
   * Lower Band = (high + low) / 2 - (multiplier * ATR)
   *
   * Direction is UP when close > upper band (or stays UP while close > lower band).
   * Direction is DOWN when close < lower band (or stays DOWN while close < upper band).
   */
  _computeSupertrend() {
    const s = this._s();
    if (s.atrValues.length < 1) return;

    const latestAtr = s.atrValues[s.atrValues.length - 1];
    const candle = s.klineHistory[s.klineHistory.length - 1];

    const midPoint = divide(add(candle.high, candle.low), '2', 8);
    const atrComponent = multiply(this._supertrendMultiplier, latestAtr);

    let basicUpperBand = add(midPoint, atrComponent);
    let basicLowerBand = subtract(midPoint, atrComponent);

    // Final bands use the tighter (more conservative) value compared to previous
    let finalUpperBand = basicUpperBand;
    if (s.prevUpperBand !== null) {
      // If previous upper band is smaller AND previous close was below previous upper band,
      // keep the smaller (tighter) upper band
      const prevCandle = s.klineHistory[s.klineHistory.length - 2];
      if (
        isLessThan(s.prevUpperBand, basicUpperBand) &&
        isLessThan(prevCandle.close, s.prevUpperBand)
      ) {
        finalUpperBand = s.prevUpperBand;
      }
    }

    let finalLowerBand = basicLowerBand;
    if (s.prevLowerBand !== null) {
      // If previous lower band is larger AND previous close was above previous lower band,
      // keep the larger (tighter) lower band
      const prevCandle = s.klineHistory[s.klineHistory.length - 2];
      if (
        isGreaterThan(s.prevLowerBand, basicLowerBand) &&
        isGreaterThan(prevCandle.close, s.prevLowerBand)
      ) {
        finalLowerBand = s.prevLowerBand;
      }
    }

    // Determine direction
    s.prevSupertrendDir = s.supertrendDir;

    if (s.supertrendDir === null) {
      // Initial direction based on close vs bands
      s.supertrendDir = isGreaterThan(candle.close, finalUpperBand) ? 'UP' : 'DOWN';
    } else if (s.supertrendDir === 'UP') {
      // Stay UP unless close drops below lower band
      if (isLessThan(candle.close, finalLowerBand)) {
        s.supertrendDir = 'DOWN';
      }
    } else if (s.supertrendDir === 'DOWN') {
      // Stay DOWN unless close rises above upper band
      if (isGreaterThan(candle.close, finalUpperBand)) {
        s.supertrendDir = 'UP';
      }
    }

    // Store bands for next iteration
    s.prevUpperBand = finalUpperBand;
    s.prevLowerBand = finalLowerBand;

    log.debug('Supertrend computed', {
      direction: s.supertrendDir,
      prevDirection: s.prevSupertrendDir,
      upperBand: finalUpperBand,
      lowerBand: finalLowerBand,
      atr: latestAtr,
    });
  }

  /**
   * Calculate MACD using incremental O(1) EMA updates.
   *
   * MACD Line = EMA(fast) - EMA(slow)
   * Signal Line = EMA(MACD Line, signalPeriod)
   * Histogram = MACD Line - Signal Line
   */
  _computeMacd() {
    const s = this._s();
    const len = s.klineHistory.length;
    const close = s.klineHistory[len - 1].close;

    // --- Incremental fast EMA ---
    s.fastEmaCount += 1;
    if (s.fastEmaCount < this._macdFast) return;
    if (s.fastEmaValue === null) {
      // SMA seed for first period
      let sum = '0';
      for (let i = len - this._macdFast; i < len; i++) {
        sum = add(sum, s.klineHistory[i].close);
      }
      s.fastEmaValue = divide(sum, String(this._macdFast), 8);
    } else {
      const k = divide('2', String(this._macdFast + 1), 8);
      s.fastEmaValue = add(multiply(close, k), multiply(s.fastEmaValue, subtract('1', k)));
    }

    // --- Incremental slow EMA ---
    s.slowEmaCount += 1;
    if (s.slowEmaCount < this._macdSlow) return;
    if (s.slowEmaValue === null) {
      let sum = '0';
      for (let i = len - this._macdSlow; i < len; i++) {
        sum = add(sum, s.klineHistory[i].close);
      }
      s.slowEmaValue = divide(sum, String(this._macdSlow), 8);
    } else {
      const k = divide('2', String(this._macdSlow + 1), 8);
      s.slowEmaValue = add(multiply(close, k), multiply(s.slowEmaValue, subtract('1', k)));
    }

    // MACD line
    const macdLine = subtract(s.fastEmaValue, s.slowEmaValue);

    // --- Incremental signal EMA ---
    s.signalEmaCount += 1;
    if (s.signalEmaCount < this._macdSignal) {
      // Accumulate MACD values for SMA seed
      if (!s.macdSeedSum) s.macdSeedSum = '0';
      s.macdSeedSum = add(s.macdSeedSum, macdLine);
      return;
    }
    if (s.signalEmaValue === null) {
      // SMA seed from first signal-period MACD values
      if (!s.macdSeedSum) s.macdSeedSum = '0';
      s.macdSeedSum = add(s.macdSeedSum, macdLine);
      s.signalEmaValue = divide(s.macdSeedSum, String(this._macdSignal), 8);
    } else {
      const k = divide('2', String(this._macdSignal + 1), 8);
      s.signalEmaValue = add(multiply(macdLine, k), multiply(s.signalEmaValue, subtract('1', k)));
    }

    // Store previous values
    s.prevMacdLine = s.macdLine;
    s.prevSignalLine = s.signalLine;

    // Latest values
    s.macdLine = macdLine;
    s.signalLine = s.signalEmaValue;
    s.histogram = subtract(s.macdLine, s.signalLine);

    log.debug('MACD computed', {
      macdLine: s.macdLine,
      signalLine: s.signalLine,
      histogram: s.histogram,
    });
  }

  /**
   * Calculate Volume Oscillator using incremental O(1) EMA updates.
   *
   * VolOsc = ((shortEMA - longEMA) / longEMA) * 100
   */
  _computeVolumeOscillator() {
    const s = this._s();
    const len = s.klineHistory.length;
    const volume = s.klineHistory[len - 1].volume;

    // --- Incremental short volume EMA ---
    s.volShortEmaCount += 1;
    if (s.volShortEmaCount < this._volOscShort) return;
    if (s.volShortEmaValue === null) {
      let sum = '0';
      for (let i = len - this._volOscShort; i < len; i++) {
        sum = add(sum, s.klineHistory[i].volume);
      }
      s.volShortEmaValue = divide(sum, String(this._volOscShort), 8);
    } else {
      const k = divide('2', String(this._volOscShort + 1), 8);
      s.volShortEmaValue = add(multiply(volume, k), multiply(s.volShortEmaValue, subtract('1', k)));
    }

    // --- Incremental long volume EMA ---
    s.volLongEmaCount += 1;
    if (s.volLongEmaCount < this._volOscLong) return;
    if (s.volLongEmaValue === null) {
      let sum = '0';
      for (let i = len - this._volOscLong; i < len; i++) {
        sum = add(sum, s.klineHistory[i].volume);
      }
      s.volLongEmaValue = divide(sum, String(this._volOscLong), 8);
    } else {
      const k = divide('2', String(this._volOscLong + 1), 8);
      s.volLongEmaValue = add(multiply(volume, k), multiply(s.volLongEmaValue, subtract('1', k)));
    }

    // Avoid division by zero
    if (s.volLongEmaValue === '0' || s.volLongEmaValue === '0.00000000') {
      s.volOsc = '0';
      return;
    }

    s.volOsc = multiply(
      divide(subtract(s.volShortEmaValue, s.volLongEmaValue), s.volLongEmaValue, 8),
      '100',
    );

    log.debug('Volume Oscillator computed', { volOsc: s.volOsc });
  }

  // ---------------------------------------------------------------------------
  // Signal evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate all indicator states and emit entry/exit signals.
   */
  _evaluateSignal() {
    const s = this._s();

    // Need all indicators ready
    if (
      s.supertrendDir === null ||
      s.macdLine === null ||
      s.signalLine === null ||
      s.histogram === null ||
      s.volOsc === null
    ) {
      return;
    }

    // ---- Check exit conditions for existing positions ----
    if (s.positionSide === 'long') {
      this._evaluateLongExit();
      return; // Don't open new positions while one is active
    }

    if (s.positionSide === 'short') {
      this._evaluateShortExit();
      return; // Don't open new positions while one is active
    }

    // ---- Volume Oscillator filter: <= 0 blocks ALL entries ----
    if (!isGreaterThan(s.volOsc, '0')) {
      log.debug('Volume Oscillator <= 0, skipping entry', { volOsc: s.volOsc });
      return;
    }

    // ---- Check entry conditions ----
    this._evaluateEntry();
  }

  /**
   * Evaluate long exit conditions:
   * 1. Supertrend reversal (UP -> DOWN)
   * 2. MACD dead cross
   */
  _evaluateLongExit() {
    const s = this._s();
    const sym = this.getCurrentSymbol();

    // Supertrend reversal: was UP, now DOWN
    if (
      s.supertrendDir === 'DOWN' &&
      s.prevSupertrendDir === 'UP'
    ) {
      log.trade('Long exit: Supertrend reversal (UP -> DOWN)', { symbol: sym });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'supertrend_reversal', '0.90');
      return;
    }

    // MACD dead cross: MACD was above signal, now below
    if (
      s.prevMacdLine !== null &&
      s.prevSignalLine !== null &&
      isGreaterThan(s.prevMacdLine, s.prevSignalLine) &&
      isLessThan(s.macdLine, s.signalLine)
    ) {
      log.trade('Long exit: MACD dead cross', { symbol: sym });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'macd_reversal', '0.80');
      return;
    }
  }

  /**
   * Evaluate short exit conditions:
   * 1. Supertrend reversal (DOWN -> UP)
   * 2. MACD golden cross
   */
  _evaluateShortExit() {
    const s = this._s();
    const sym = this.getCurrentSymbol();

    // Supertrend reversal: was DOWN, now UP
    if (
      s.supertrendDir === 'UP' &&
      s.prevSupertrendDir === 'DOWN'
    ) {
      log.trade('Short exit: Supertrend reversal (DOWN -> UP)', { symbol: sym });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'supertrend_reversal', '0.90');
      return;
    }

    // MACD golden cross: MACD was below signal, now above
    if (
      s.prevMacdLine !== null &&
      s.prevSignalLine !== null &&
      isLessThan(s.prevMacdLine, s.prevSignalLine) &&
      isGreaterThan(s.macdLine, s.signalLine)
    ) {
      log.trade('Short exit: MACD golden cross', { symbol: sym });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'macd_reversal', '0.80');
      return;
    }
  }

  /**
   * Evaluate entry conditions for both long and short.
   */
  _evaluateEntry() {
    const s = this._s();
    const sym = this.getCurrentSymbol();
    const regime = this.getEffectiveRegime();

    // ---- Long entry ----
    // Supertrend turns UP (was DOWN, now UP)
    // + MACD golden cross (macdLine > signalLine, histogram > 0)
    // + Volume Oscillator > 0 (already checked)
    // + Regime: TRENDING_UP or VOLATILE
    if (
      s.supertrendDir === 'UP' &&
      s.prevSupertrendDir === 'DOWN' &&
      isGreaterThan(s.macdLine, s.signalLine) &&
      isGreaterThan(s.histogram, '0') &&
      (regime === null || regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE)
    ) {
      const confidence = this._calculateConfidence('long');

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: sym,
        category: this._category,
        suggestedQty: this._calculateQty(),
        suggestedPrice: s.latestPrice,
        stopLossPrice: multiply(s.latestPrice, subtract('1', divide(this._slPercent, '100'))),
        confidence,
        leverage: '5',
        marketContext: {
          supertrendDir: s.supertrendDir,
          macdLine: s.macdLine,
          signalLine: s.signalLine,
          histogram: s.histogram,
          volOsc: s.volOsc,
          regime,
          tpPercent: this._tpPercent,
          slPercent: this._slPercent,
        },
      };

      log.trade('Long entry signal', {
        symbol: sym,
        confidence,
        regime,
      });

      s.lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // ---- Short entry ----
    // Supertrend turns DOWN (was UP, now DOWN)
    // + MACD dead cross (macdLine < signalLine, histogram < 0)
    // + Volume Oscillator > 0 (already checked)
    // + Regime: TRENDING_DOWN or VOLATILE
    if (
      s.supertrendDir === 'DOWN' &&
      s.prevSupertrendDir === 'UP' &&
      isLessThan(s.macdLine, s.signalLine) &&
      isLessThan(s.histogram, '0') &&
      (regime === null || regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE)
    ) {
      const confidence = this._calculateConfidence('short');

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: sym,
        category: this._category,
        suggestedQty: this._calculateQty(),
        suggestedPrice: s.latestPrice,
        stopLossPrice: multiply(s.latestPrice, add('1', divide(this._slPercent, '100'))),
        confidence,
        leverage: '5',
        marketContext: {
          supertrendDir: s.supertrendDir,
          macdLine: s.macdLine,
          signalLine: s.signalLine,
          histogram: s.histogram,
          volOsc: s.volOsc,
          regime,
          tpPercent: this._tpPercent,
          slPercent: this._slPercent,
        },
      };

      log.trade('Short entry signal', {
        symbol: sym,
        confidence,
        regime,
      });

      s.lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // EMA & ATR helpers (String-based)
  // ---------------------------------------------------------------------------

  /**
   * Calculate ATR from klineHistory.
   * This is an alternative method that returns the ATR directly.
   *
   * @param {number} period
   * @returns {string|null} — ATR value or null
   */
  _calculateAtr(period) {
    const s = this._s();
    const len = s.klineHistory.length;
    if (len < period + 1) return null;

    const trValues = [];
    for (let i = len - period; i < len; i++) {
      const candle = s.klineHistory[i];
      const prevCandle = s.klineHistory[i - 1];

      const highLow = subtract(candle.high, candle.low);
      const highPrevClose = abs(subtract(candle.high, prevCandle.close));
      const lowPrevClose = abs(subtract(candle.low, prevCandle.close));

      let tr = highLow;
      if (isGreaterThan(highPrevClose, tr)) tr = highPrevClose;
      if (isGreaterThan(lowPrevClose, tr)) tr = lowPrevClose;

      trValues.push(tr);
    }

    let sum = '0';
    for (const tr of trValues) {
      sum = add(sum, tr);
    }

    return divide(sum, String(trValues.length), 8);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate position quantity based on positionSizePercent and leverage.
   * quantity = (equity * positionSizePercent / 100) / (leverage * price)
   *
   * Since we don't have direct access to equity here, we return a suggested
   * percentage-based size that the order manager can use.
   *
   * @returns {string} — suggested quantity as percentage of equity
   */
  _calculateQty() {
    // Return position size percent — the OrderManager/RiskEngine will
    // translate this into an actual quantity using current equity and price.
    return this._positionSizePercent;
  }

  /**
   * Calculate confidence score based on indicator alignment.
   *
   * @param {'long'|'short'} side
   * @returns {string} — confidence between 0 and 1
   */
  _calculateConfidence(side) {
    const s = this._s();
    let score = 0;

    // Supertrend direction alignment (base condition, always true at entry)
    score += 30;

    // MACD histogram strength
    const histAbs = abs(s.histogram);
    if (isGreaterThan(histAbs, '0')) score += 20;
    if (isGreaterThan(histAbs, '0.5')) score += 10;

    // Volume Oscillator strength
    if (isGreaterThan(s.volOsc, '0')) score += 15;
    if (isGreaterThan(s.volOsc, '10')) score += 10;

    // Market regime alignment
    const regime = this.getEffectiveRegime();
    if (side === 'long' && regime === MARKET_REGIMES.TRENDING_UP) score += 15;
    if (side === 'short' && regime === MARKET_REGIMES.TRENDING_DOWN) score += 15;
    if (regime === MARKET_REGIMES.VOLATILE) score += 10;

    // Clamp to [0, 100] and normalize to [0, 1]
    score = Math.min(score, 100);
    return toFixed(String(score / 100), 2);
  }

  /**
   * Emit a close/exit signal.
   *
   * @param {string} action — SIGNAL_ACTIONS.CLOSE_LONG or CLOSE_SHORT
   * @param {string} reason — exit reason (tp_hit, sl_hit, supertrend_reversal, macd_reversal)
   * @param {string} confidence — confidence string
   */
  _emitClose(action, reason, confidence) {
    const s = this._s();
    const sym = this.getCurrentSymbol();

    const signal = {
      action,
      symbol: sym,
      category: this._category,
      suggestedQty: this._positionSizePercent,
      suggestedPrice: s.latestPrice,
      reduceOnly: true,
      confidence,
      marketContext: {
        reason,
        entryPrice: s.entryPrice,
        exitPrice: s.latestPrice,
        supertrendDir: s.supertrendDir,
        macdLine: s.macdLine,
        signalLine: s.signalLine,
        histogram: s.histogram,
        volOsc: s.volOsc,
        regime: this.getEffectiveRegime(),
      },
    };

    s.lastSignal = signal;
    this.emitSignal(signal);
  }
}

// ---------------------------------------------------------------------------
// Registry registration
// ---------------------------------------------------------------------------
const registry = require('../../services/strategyRegistry');
registry.register('SupertrendStrategy', SupertrendStrategy);

module.exports = SupertrendStrategy;
