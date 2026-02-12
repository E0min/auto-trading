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

const StrategyBase = require('../services/strategyBase');
const {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isLessThan,
  toFixed,
  abs,
} = require('../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../utils/constants');
const { createLogger } = require('../utils/logger');

const log = createLogger('SupertrendStrategy');

class SupertrendStrategy extends StrategyBase {
  static metadata = {
    name: 'SupertrendStrategy',
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

    // Configuration
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

    // Kline history: { high, low, close, volume } — all Strings
    this.klineHistory = [];
    this._maxHistory = Math.max(
      this._macdSlow + this._macdSignal,
      this._atrPeriod,
      this._volOscLong,
    ) + 50; // extra buffer for warm-up

    // ATR values
    this._atrValues = [];

    // Supertrend state
    this._supertrendDir = null;   // 'UP' | 'DOWN' | null
    this._prevSupertrendDir = null;
    this._upperBand = null;
    this._lowerBand = null;
    this._prevUpperBand = null;
    this._prevLowerBand = null;

    // MACD state
    this._macdLine = null;
    this._signalLine = null;
    this._histogram = null;
    this._prevMacdLine = null;
    this._prevSignalLine = null;

    // EMA accumulators for MACD (kept across klines)
    this._fastEmaValue = null;
    this._slowEmaValue = null;
    this._signalEmaValue = null;
    this._fastEmaCount = 0;
    this._slowEmaCount = 0;
    this._signalEmaCount = 0;

    // Volume Oscillator state
    this._volOsc = null;
    this._volShortEmaValue = null;
    this._volLongEmaValue = null;
    this._volShortEmaCount = 0;
    this._volLongEmaCount = 0;

    // Signal / position state
    this._lastSignal = null;
    this._entryPrice = null;
    this._latestPrice = null;
    this._positionSide = null; // 'long' | 'short' | null
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

    this._latestPrice = String(ticker.lastPrice);

    // Check TP/SL only when we have an open position
    if (this._positionSide && this._entryPrice) {
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

    // Store candle
    this.klineHistory.push({
      high: String(kline.high),
      low: String(kline.low),
      close: String(kline.close),
      volume: String(kline.volume),
    });

    // Trim history
    if (this.klineHistory.length > this._maxHistory) {
      this.klineHistory = this.klineHistory.slice(-this._maxHistory);
    }

    // Need at least macdSlow + macdSignal candles for MACD, atrPeriod+1 for ATR
    const minCandles = Math.max(this._macdSlow + this._macdSignal, this._atrPeriod + 1, this._volOscLong);
    if (this.klineHistory.length < minCandles) {
      log.debug('onKline: not enough history', {
        have: this.klineHistory.length,
        need: minCandles,
      });
      return;
    }

    // Update latest price from close
    this._latestPrice = String(kline.close);

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
    return this._lastSignal;
  }

  /**
   * Handle order fills — track entry price and position side.
   * @param {object} fill
   */
  onFill(fill) {
    if (!fill) return;

    if (fill.action === SIGNAL_ACTIONS.OPEN_LONG) {
      this._positionSide = 'long';
      this._entryPrice = String(fill.price || this._latestPrice);
      log.trade('Long position opened', { entry: this._entryPrice, symbol: this._symbol });
    } else if (fill.action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._positionSide = 'short';
      this._entryPrice = String(fill.price || this._latestPrice);
      log.trade('Short position opened', { entry: this._entryPrice, symbol: this._symbol });
    } else if (
      fill.action === SIGNAL_ACTIONS.CLOSE_LONG ||
      fill.action === SIGNAL_ACTIONS.CLOSE_SHORT
    ) {
      log.trade('Position closed', { side: this._positionSide, symbol: this._symbol });
      this._positionSide = null;
      this._entryPrice = null;
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
    if (!this._entryPrice || !this._latestPrice) return;

    const tpThreshold = divide(this._tpPercent, '100', 8);
    const slThreshold = divide(this._slPercent, '100', 8);

    if (this._positionSide === 'long') {
      // Long: TP when price rises by tpPercent, SL when it drops by slPercent
      const pnlRatio = divide(subtract(this._latestPrice, this._entryPrice), this._entryPrice, 8);

      if (isGreaterThan(pnlRatio, tpThreshold)) {
        log.trade('Long TP hit', {
          entry: this._entryPrice,
          current: this._latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'tp_hit', '0.95');
        return;
      }

      // SL: pnlRatio < -slThreshold
      const negSl = subtract('0', slThreshold);
      if (isLessThan(pnlRatio, negSl)) {
        log.trade('Long SL hit', {
          entry: this._entryPrice,
          current: this._latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'sl_hit', '0.99');
        return;
      }
    } else if (this._positionSide === 'short') {
      // Short: TP when price drops by tpPercent, SL when it rises by slPercent
      const pnlRatio = divide(subtract(this._entryPrice, this._latestPrice), this._entryPrice, 8);

      if (isGreaterThan(pnlRatio, tpThreshold)) {
        log.trade('Short TP hit', {
          entry: this._entryPrice,
          current: this._latestPrice,
          pnlRatio,
        });
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'tp_hit', '0.95');
        return;
      }

      const negSl = subtract('0', slThreshold);
      if (isLessThan(pnlRatio, negSl)) {
        log.trade('Short SL hit', {
          entry: this._entryPrice,
          current: this._latestPrice,
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
    const len = this.klineHistory.length;
    if (len < period + 1) return;

    const trValues = [];
    for (let i = len - period; i < len; i++) {
      const candle = this.klineHistory[i];
      const prevCandle = this.klineHistory[i - 1];

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
    const atr = divide(sum, String(trValues.length), 8);

    this._atrValues.push(atr);
    if (this._atrValues.length > this._maxHistory) {
      this._atrValues = this._atrValues.slice(-this._maxHistory);
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
    if (this._atrValues.length < 1) return;

    const latestAtr = this._atrValues[this._atrValues.length - 1];
    const candle = this.klineHistory[this.klineHistory.length - 1];

    const midPoint = divide(add(candle.high, candle.low), '2', 8);
    const atrComponent = multiply(this._supertrendMultiplier, latestAtr);

    let basicUpperBand = add(midPoint, atrComponent);
    let basicLowerBand = subtract(midPoint, atrComponent);

    // Final bands use the tighter (more conservative) value compared to previous
    let finalUpperBand = basicUpperBand;
    if (this._prevUpperBand !== null) {
      // If previous upper band is smaller AND previous close was below previous upper band,
      // keep the smaller (tighter) upper band
      const prevCandle = this.klineHistory[this.klineHistory.length - 2];
      if (
        isLessThan(this._prevUpperBand, basicUpperBand) &&
        isLessThan(prevCandle.close, this._prevUpperBand)
      ) {
        finalUpperBand = this._prevUpperBand;
      }
    }

    let finalLowerBand = basicLowerBand;
    if (this._prevLowerBand !== null) {
      // If previous lower band is larger AND previous close was above previous lower band,
      // keep the larger (tighter) lower band
      const prevCandle = this.klineHistory[this.klineHistory.length - 2];
      if (
        isGreaterThan(this._prevLowerBand, basicLowerBand) &&
        isGreaterThan(prevCandle.close, this._prevLowerBand)
      ) {
        finalLowerBand = this._prevLowerBand;
      }
    }

    // Determine direction
    this._prevSupertrendDir = this._supertrendDir;

    if (this._supertrendDir === null) {
      // Initial direction based on close vs bands
      this._supertrendDir = isGreaterThan(candle.close, finalUpperBand) ? 'UP' : 'DOWN';
    } else if (this._supertrendDir === 'UP') {
      // Stay UP unless close drops below lower band
      if (isLessThan(candle.close, finalLowerBand)) {
        this._supertrendDir = 'DOWN';
      }
    } else if (this._supertrendDir === 'DOWN') {
      // Stay DOWN unless close rises above upper band
      if (isGreaterThan(candle.close, finalUpperBand)) {
        this._supertrendDir = 'UP';
      }
    }

    // Store bands for next iteration
    this._prevUpperBand = finalUpperBand;
    this._prevLowerBand = finalLowerBand;

    log.debug('Supertrend computed', {
      direction: this._supertrendDir,
      prevDirection: this._prevSupertrendDir,
      upperBand: finalUpperBand,
      lowerBand: finalLowerBand,
      atr: latestAtr,
    });
  }

  /**
   * Calculate MACD using incremental EMA approach.
   *
   * MACD Line = EMA(fast) - EMA(slow)
   * Signal Line = EMA(MACD Line, signalPeriod)
   * Histogram = MACD Line - Signal Line
   */
  _computeMacd() {
    const closes = this.klineHistory.map((c) => c.close);

    // We need at least macdSlow candles for the slow EMA
    if (closes.length < this._macdSlow) return;

    // Calculate full EMA series for fast and slow, then derive MACD
    const fastEma = this._calculateEma(closes, this._macdFast);
    const slowEma = this._calculateEma(closes, this._macdSlow);

    if (!fastEma || !slowEma) return;

    // MACD line values = fast EMA - slow EMA (aligned from slowEma start)
    // slowEma is shorter than fastEma, so we align from the end
    const slowStart = closes.length - slowEma.length;
    const macdValues = [];

    for (let i = 0; i < slowEma.length; i++) {
      const fastIdx = i + slowStart - (closes.length - fastEma.length);
      if (fastIdx >= 0 && fastIdx < fastEma.length) {
        macdValues.push(subtract(fastEma[fastIdx], slowEma[i]));
      }
    }

    if (macdValues.length < this._macdSignal) return;

    // Signal line = EMA of MACD values
    const signalEma = this._calculateEma(macdValues, this._macdSignal);
    if (!signalEma || signalEma.length === 0) return;

    // Store previous values
    this._prevMacdLine = this._macdLine;
    this._prevSignalLine = this._signalLine;

    // Latest values
    this._macdLine = macdValues[macdValues.length - 1];
    this._signalLine = signalEma[signalEma.length - 1];
    this._histogram = subtract(this._macdLine, this._signalLine);

    log.debug('MACD computed', {
      macdLine: this._macdLine,
      signalLine: this._signalLine,
      histogram: this._histogram,
    });
  }

  /**
   * Calculate Volume Oscillator.
   *
   * VolOsc = ((shortEMA - longEMA) / longEMA) * 100
   */
  _computeVolumeOscillator() {
    const volumes = this.klineHistory.map((c) => c.volume);

    if (volumes.length < this._volOscLong) return;

    const shortEma = this._calculateEma(volumes, this._volOscShort);
    const longEma = this._calculateEma(volumes, this._volOscLong);

    if (!shortEma || !longEma || shortEma.length === 0 || longEma.length === 0) return;

    const latestShort = shortEma[shortEma.length - 1];
    const latestLong = longEma[longEma.length - 1];

    // Avoid division by zero
    if (latestLong === '0' || latestLong === '0.00000000') {
      this._volOsc = '0';
      return;
    }

    this._volOsc = multiply(
      divide(subtract(latestShort, latestLong), latestLong, 8),
      '100',
    );

    log.debug('Volume Oscillator computed', { volOsc: this._volOsc });
  }

  // ---------------------------------------------------------------------------
  // Signal evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate all indicator states and emit entry/exit signals.
   */
  _evaluateSignal() {
    // Need all indicators ready
    if (
      this._supertrendDir === null ||
      this._macdLine === null ||
      this._signalLine === null ||
      this._histogram === null ||
      this._volOsc === null
    ) {
      return;
    }

    // ---- Check exit conditions for existing positions ----
    if (this._positionSide === 'long') {
      this._evaluateLongExit();
      return; // Don't open new positions while one is active
    }

    if (this._positionSide === 'short') {
      this._evaluateShortExit();
      return; // Don't open new positions while one is active
    }

    // ---- Volume Oscillator filter: <= 0 blocks ALL entries ----
    if (!isGreaterThan(this._volOsc, '0')) {
      log.debug('Volume Oscillator <= 0, skipping entry', { volOsc: this._volOsc });
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
    // Supertrend reversal: was UP, now DOWN
    if (
      this._supertrendDir === 'DOWN' &&
      this._prevSupertrendDir === 'UP'
    ) {
      log.trade('Long exit: Supertrend reversal (UP -> DOWN)', { symbol: this._symbol });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'supertrend_reversal', '0.90');
      return;
    }

    // MACD dead cross: MACD was above signal, now below
    if (
      this._prevMacdLine !== null &&
      this._prevSignalLine !== null &&
      isGreaterThan(this._prevMacdLine, this._prevSignalLine) &&
      isLessThan(this._macdLine, this._signalLine)
    ) {
      log.trade('Long exit: MACD dead cross', { symbol: this._symbol });
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
    // Supertrend reversal: was DOWN, now UP
    if (
      this._supertrendDir === 'UP' &&
      this._prevSupertrendDir === 'DOWN'
    ) {
      log.trade('Short exit: Supertrend reversal (DOWN -> UP)', { symbol: this._symbol });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'supertrend_reversal', '0.90');
      return;
    }

    // MACD golden cross: MACD was below signal, now above
    if (
      this._prevMacdLine !== null &&
      this._prevSignalLine !== null &&
      isLessThan(this._prevMacdLine, this._prevSignalLine) &&
      isGreaterThan(this._macdLine, this._signalLine)
    ) {
      log.trade('Short exit: MACD golden cross', { symbol: this._symbol });
      this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'macd_reversal', '0.80');
      return;
    }
  }

  /**
   * Evaluate entry conditions for both long and short.
   */
  _evaluateEntry() {
    const regime = this._marketRegime;

    // ---- Long entry ----
    // Supertrend turns UP (was DOWN, now UP)
    // + MACD golden cross (macdLine > signalLine, histogram > 0)
    // + Volume Oscillator > 0 (already checked)
    // + Regime: TRENDING_UP or VOLATILE
    if (
      this._supertrendDir === 'UP' &&
      this._prevSupertrendDir === 'DOWN' &&
      isGreaterThan(this._macdLine, this._signalLine) &&
      isGreaterThan(this._histogram, '0') &&
      (regime === MARKET_REGIMES.TRENDING_UP || regime === MARKET_REGIMES.VOLATILE)
    ) {
      const confidence = this._calculateConfidence('long');

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._calculateQty(),
        suggestedPrice: this._latestPrice,
        confidence,
        leverage: '5',
        marketContext: {
          supertrendDir: this._supertrendDir,
          macdLine: this._macdLine,
          signalLine: this._signalLine,
          histogram: this._histogram,
          volOsc: this._volOsc,
          regime,
          tpPercent: this._tpPercent,
          slPercent: this._slPercent,
        },
      };

      log.trade('Long entry signal', {
        symbol: this._symbol,
        confidence,
        regime,
      });

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }

    // ---- Short entry ----
    // Supertrend turns DOWN (was UP, now DOWN)
    // + MACD dead cross (macdLine < signalLine, histogram < 0)
    // + Volume Oscillator > 0 (already checked)
    // + Regime: TRENDING_DOWN or VOLATILE
    if (
      this._supertrendDir === 'DOWN' &&
      this._prevSupertrendDir === 'UP' &&
      isLessThan(this._macdLine, this._signalLine) &&
      isLessThan(this._histogram, '0') &&
      (regime === MARKET_REGIMES.TRENDING_DOWN || regime === MARKET_REGIMES.VOLATILE)
    ) {
      const confidence = this._calculateConfidence('short');

      const signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this._symbol,
        category: this._category,
        suggestedQty: this._calculateQty(),
        suggestedPrice: this._latestPrice,
        confidence,
        leverage: '5',
        marketContext: {
          supertrendDir: this._supertrendDir,
          macdLine: this._macdLine,
          signalLine: this._signalLine,
          histogram: this._histogram,
          volOsc: this._volOsc,
          regime,
          tpPercent: this._tpPercent,
          slPercent: this._slPercent,
        },
      };

      log.trade('Short entry signal', {
        symbol: this._symbol,
        confidence,
        regime,
      });

      this._lastSignal = signal;
      this.emitSignal(signal);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // EMA & ATR helpers (String-based)
  // ---------------------------------------------------------------------------

  /**
   * Calculate EMA series over an array of string-valued prices.
   *
   * Returns an array of EMA values (strings) starting from index (period - 1).
   * The first EMA value is the SMA of the first `period` elements.
   *
   * @param {string[]} prices — array of price strings
   * @param {number} period — EMA period
   * @returns {string[]|null} — array of EMA values, or null if insufficient data
   */
  _calculateEma(prices, period) {
    if (!prices || prices.length < period) return null;

    const result = [];
    const k = divide('2', String(period + 1), 8); // smoothing factor = 2 / (period + 1)

    // First value: SMA of the first `period` prices
    let sum = '0';
    for (let i = 0; i < period; i++) {
      sum = add(sum, prices[i]);
    }
    let ema = divide(sum, String(period), 8);
    result.push(ema);

    // Subsequent values: EMA = price * k + prevEMA * (1 - k)
    const oneMinusK = subtract('1', k);
    for (let i = period; i < prices.length; i++) {
      ema = add(multiply(prices[i], k), multiply(ema, oneMinusK));
      result.push(ema);
    }

    return result;
  }

  /**
   * Calculate ATR from klineHistory.
   * This is an alternative method that returns the ATR directly.
   *
   * @param {number} period
   * @returns {string|null} — ATR value or null
   */
  _calculateAtr(period) {
    const len = this.klineHistory.length;
    if (len < period + 1) return null;

    const trValues = [];
    for (let i = len - period; i < len; i++) {
      const candle = this.klineHistory[i];
      const prevCandle = this.klineHistory[i - 1];

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
    let score = 0;

    // Supertrend direction alignment (base condition, always true at entry)
    score += 30;

    // MACD histogram strength
    const histAbs = abs(this._histogram);
    if (isGreaterThan(histAbs, '0')) score += 20;
    if (isGreaterThan(histAbs, '0.5')) score += 10;

    // Volume Oscillator strength
    if (isGreaterThan(this._volOsc, '0')) score += 15;
    if (isGreaterThan(this._volOsc, '10')) score += 10;

    // Market regime alignment
    const regime = this._marketRegime;
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
    const signal = {
      action,
      symbol: this._symbol,
      category: this._category,
      suggestedQty: this._positionSizePercent,
      suggestedPrice: this._latestPrice,
      confidence,
      marketContext: {
        reason,
        entryPrice: this._entryPrice,
        exitPrice: this._latestPrice,
        supertrendDir: this._supertrendDir,
        macdLine: this._macdLine,
        signalLine: this._signalLine,
        histogram: this._histogram,
        volOsc: this._volOsc,
        regime: this._marketRegime,
      },
    };

    this._lastSignal = signal;
    this.emitSignal(signal);
  }
}

// ---------------------------------------------------------------------------
// Registry registration
// ---------------------------------------------------------------------------
const registry = require('../services/strategyRegistry');
registry.register('SupertrendStrategy', SupertrendStrategy);

module.exports = SupertrendStrategy;
