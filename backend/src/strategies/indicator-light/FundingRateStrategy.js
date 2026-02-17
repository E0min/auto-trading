'use strict';

/**
 * FundingRateStrategy — Funding Rate Contrarian strategy.
 *
 * Exploits extreme funding-rate imbalances by entering positions contrary to
 * the prevailing crowd bias. When funding is deeply negative (shorts paying
 * longs) the strategy opens longs anticipating a short-squeeze, and vice
 * versa when funding is extremely positive.
 *
 * Key features:
 *  - 8-hour funding-settlement cycle awareness
 *  - Open-interest (OI) confirmation
 *  - Half-Kelly position sizing
 *  - TP +3% / SL -2% / 24-hour time limit
 *  - Partial exit on funding-rate normalisation
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
  isZero,
} = require('../../utils/mathUtils');
const { SIGNAL_ACTIONS, MARKET_REGIMES } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

const log = createLogger('FundingRateStrategy');

class FundingRateStrategy extends StrategyBase {
  // ---------------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------------

  static metadata = {
    name: 'FundingRateStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'low',
    maxConcurrentPositions: 2,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 60000,
    gracePeriodMs: 300000,
    warmupCandles: 1,
    volatilityPreference: 'neutral',
    description: '펀딩비 역발상 + OI 분석 + 켈리 공식',
    defaultConfig: {
      longFundingThreshold: '-0.01',
      shortFundingThreshold: '0.03',
      consecutivePeriods: 3,
      oiChangeThreshold: '5',
      positionSizePercent: '5',
      tpPercent: '3',
      slPercent: '2',
      maxHoldHours: 24,
    },
  };

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param {object} config — strategy-specific overrides
   */
  constructor(config = {}) {
    const merged = { ...FundingRateStrategy.metadata.defaultConfig, ...config };
    super('FundingRateStrategy', merged);

    // --- Configuration -------------------------------------------------------
    this._longFundingThreshold = merged.longFundingThreshold;   // e.g. '-0.01'
    this._shortFundingThreshold = merged.shortFundingThreshold; // e.g. '0.03'
    this._consecutivePeriods = merged.consecutivePeriods;       // e.g. 3
    this._oiChangeThreshold = merged.oiChangeThreshold;         // e.g. '5' (%)
    this._positionSizePercent = merged.positionSizePercent;     // e.g. '5' (%)
    this._tpPercent = merged.tpPercent;                         // e.g. '3' (%)
    this._slPercent = merged.slPercent;                         // e.g. '2' (%)
    this._maxHoldHours = merged.maxHoldHours;                   // e.g. 24

    /** Maximum number of history entries to retain */
    this._maxHistory = 250;

    log.info('FundingRateStrategy instantiated', { config: merged });
  }

  // ---------------------------------------------------------------------------
  // Per-symbol state (SymbolState pattern)
  // ---------------------------------------------------------------------------

  /**
   * @override
   * @returns {object} default per-symbol state
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      fundingRateHistory: [],
      oiHistory: [],
      priceHistory: [],
      entryTime: null,
      partialExitDone: false,
    };
  }

  // ---------------------------------------------------------------------------
  // StrategyBase overrides
  // ---------------------------------------------------------------------------

  /**
   * Called on every incoming ticker update.
   *
   * Responsibilities:
   *  1. Store the latest price.
   *  2. If the ticker carries a fundingRate, push to history.
   *  3. If the ticker carries openInterest, push to history.
   *  4. When a position is open, monitor TP / SL / time-limit / funding
   *     normalisation.
   *
   * @param {object} ticker
   */
  onTick(ticker) {
    if (!this._active) return;

    // --- Store latest price ---------------------------------------------------
    if (ticker.lastPrice || ticker.last) {
      this._s().latestPrice = String(ticker.lastPrice || ticker.last);
    }

    // --- Funding rate ingestion -----------------------------------------------
    if (ticker.fundingRate !== undefined && ticker.fundingRate !== null) {
      this._s().fundingRateHistory.push({
        rate: String(ticker.fundingRate),
        timestamp: new Date(),
      });

      // Trim to last ~21 entries (7 days x 3 settlements per day)
      if (this._s().fundingRateHistory.length > 63) {
        this._s().fundingRateHistory = this._s().fundingRateHistory.slice(-63);
      }

      log.debug('Funding rate recorded', {
        rate: ticker.fundingRate,
        historyLen: this._s().fundingRateHistory.length,
      });
    }

    // --- Open-interest ingestion ----------------------------------------------
    if (ticker.openInterest !== undefined && ticker.openInterest !== null) {
      this._s().oiHistory.push({
        oi: String(ticker.openInterest),
        timestamp: new Date(),
      });

      if (this._s().oiHistory.length > this._maxHistory) {
        this._s().oiHistory = this._s().oiHistory.slice(-this._maxHistory);
      }
    }

    // --- Position monitoring (exit logic) -------------------------------------
    if (this._s().positionSide && this._s().entryPrice && this._s().latestPrice) {
      this._checkExitConditions();
    }
  }

  /**
   * Called on every incoming kline (candlestick) update.
   *
   * Responsibilities:
   *  1. Push close price into _priceHistory and compute SMA(20).
   *  2. Evaluate funding-rate entry conditions.
   *  3. Evaluate OI conditions.
   *  4. Calculate confidence and generate entry signals.
   *
   * @param {object} kline
   */
  onKline(kline) {
    if (!this._active) return;

    // --- Price history --------------------------------------------------------
    const close = String(kline.close || kline.c);
    if (!close || isZero(close)) return;

    this._s().priceHistory.push(close);
    if (this._s().priceHistory.length > this._maxHistory) {
      this._s().priceHistory = this._s().priceHistory.slice(-this._maxHistory);
    }

    // Need at least 20 candles to compute SMA(20)
    if (this._s().priceHistory.length < 20) return;

    // --- SMA(20) calculation --------------------------------------------------
    const sma20 = this._calculateSMA(20);
    if (!sma20) return;

    // --- Skip entry evaluation if already in a position -----------------------
    if (this._s().positionSide) return;

    // --- Funding rate analysis ------------------------------------------------
    if (this._s().fundingRateHistory.length < this._consecutivePeriods) return;

    const latestFunding = this._s().fundingRateHistory[this._s().fundingRateHistory.length - 1].rate;
    const direction = this._getConsecutiveFundingDirection();
    const oiChange = this._getOiChange24h();

    const currentPrice = this._s().latestPrice || close;

    // --- Long entry evaluation ------------------------------------------------
    if (
      direction === 'negative' &&
      isLessThanOrEqual(latestFunding, this._longFundingThreshold) &&
      oiChange !== null &&
      isGreaterThan(oiChange, this._oiChangeThreshold) &&
      this._isPriceNearSMA(currentPrice, sma20) &&
      this._isLongRegime()
    ) {
      const confidence = this._calculateLongConfidence(latestFunding, oiChange);
      const qty = this._calculatePositionSize(currentPrice);

      this._s().lastSignal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: qty,
        suggestedPrice: currentPrice,
        stopLossPrice: multiply(currentPrice, subtract('1', divide(this._slPercent, '100'))),
        confidence,
        leverage: '3',
        marketContext: {
          fundingRate: latestFunding,
          oiChange24h: oiChange,
          sma20,
          regime: this.getEffectiveRegime(),
          strategy: 'FundingRateStrategy',
          reason: '펀딩비 극단적 음수 — 숏스퀴즈 기대',
        },
      };

      this.emitSignal(this._s().lastSignal);
      this._s().positionSide = 'long';
      this._s().entryPrice = currentPrice;
      this._s().entryTime = new Date();
      this._s().partialExitDone = false;

      log.trade('Long entry signal generated', {
        fundingRate: latestFunding,
        oiChange,
        confidence,
        price: currentPrice,
      });

      return;
    }

    // --- Short entry evaluation -----------------------------------------------
    if (
      direction === 'positive' &&
      isGreaterThanOrEqual(latestFunding, this._shortFundingThreshold) &&
      oiChange !== null &&
      isGreaterThan(oiChange, this._oiChangeThreshold) &&
      this._isPriceNearSMA(currentPrice, sma20) &&
      this._isShortRegime()
    ) {
      const confidence = this._calculateShortConfidence(latestFunding, oiChange);
      const qty = this._calculatePositionSize(currentPrice);

      this._s().lastSignal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: qty,
        suggestedPrice: currentPrice,
        stopLossPrice: multiply(currentPrice, add('1', divide(this._slPercent, '100'))),
        confidence,
        leverage: '3',
        marketContext: {
          fundingRate: latestFunding,
          oiChange24h: oiChange,
          sma20,
          regime: this.getEffectiveRegime(),
          strategy: 'FundingRateStrategy',
          reason: '펀딩비 극단적 양수 — 롱스퀴즈 기대',
        },
      };

      this.emitSignal(this._s().lastSignal);
      this._s().positionSide = 'short';
      this._s().entryPrice = currentPrice;
      this._s().entryTime = new Date();
      this._s().partialExitDone = false;

      log.trade('Short entry signal generated', {
        fundingRate: latestFunding,
        oiChange,
        confidence,
        price: currentPrice,
      });
    }
  }

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

  /**
   * Called when funding data is received from FundingDataService (T2-4).
   * Updates _fundingRateHistory and _oiHistory with dedicated polling data.
   *
   * @param {{ symbol: string, fundingRate: string|null, openInterest: string|null, timestamp: number }} data
   */
  onFundingUpdate(data) {
    if (!this.hasSymbol(data.symbol)) return; // Only process relevant symbols

    const s = this._s(data.symbol);

    if (data.fundingRate !== null && data.fundingRate !== undefined) {
      s.fundingRateHistory.push({
        rate: String(data.fundingRate),
        timestamp: new Date(data.timestamp || Date.now()),
      });
      // Trim history
      while (s.fundingRateHistory.length > this._maxHistory) {
        s.fundingRateHistory.shift();
      }
    }

    if (data.openInterest !== null && data.openInterest !== undefined) {
      s.oiHistory.push({
        oi: String(data.openInterest),
        timestamp: new Date(data.timestamp || Date.now()),
      });
      while (s.oiHistory.length > this._maxHistory) {
        s.oiHistory.shift();
      }
    }
  }

  /**
   * Return the most recent signal or null.
   * @returns {object|null}
   */
  getSignal() {
    return this._s().lastSignal;
  }

  // ---------------------------------------------------------------------------
  // Exit condition checks
  // ---------------------------------------------------------------------------

  /**
   * Evaluate TP / SL / time-limit / funding-normalisation for the open
   * position and emit close signals as needed.
   * @private
   */
  _checkExitConditions() {
    const price = this._s().latestPrice;
    const entry = this._s().entryPrice;
    const side = this._s().positionSide;

    // --- Take-Profit ----------------------------------------------------------
    if (side === 'long') {
      const tpPrice = multiply(entry, add('1', divide(this._tpPercent, '100')));
      if (isGreaterThan(price, tpPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'TP +' + this._tpPercent + '% 도달');
        return;
      }
    } else if (side === 'short') {
      const tpPrice = multiply(entry, subtract('1', divide(this._tpPercent, '100')));
      if (isLessThan(price, tpPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'TP +' + this._tpPercent + '% 도달 (숏)');
        return;
      }
    }

    // --- Stop-Loss ------------------------------------------------------------
    if (side === 'long') {
      const slPrice = multiply(entry, subtract('1', divide(this._slPercent, '100')));
      if (isLessThan(price, slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_LONG, 'SL -' + this._slPercent + '% 도달');
        return;
      }
    } else if (side === 'short') {
      const slPrice = multiply(entry, add('1', divide(this._slPercent, '100')));
      if (isGreaterThan(price, slPrice)) {
        this._emitClose(SIGNAL_ACTIONS.CLOSE_SHORT, 'SL -' + this._slPercent + '% 도달 (숏)');
        return;
      }
    }

    // --- 24-hour time limit ---------------------------------------------------
    if (this._s().entryTime) {
      const elapsed = Date.now() - this._s().entryTime.getTime();
      const limitMs = this._maxHoldHours * 60 * 60 * 1000;

      if (elapsed >= limitMs) {
        const action = side === 'long'
          ? SIGNAL_ACTIONS.CLOSE_LONG
          : SIGNAL_ACTIONS.CLOSE_SHORT;
        this._emitClose(action, this._maxHoldHours + '시간 시간 제한 초과');
        return;
      }
    }

    // --- Funding rate normalisation (partial exit — 50%) ----------------------
    if (!this._s().partialExitDone && this._s().fundingRateHistory.length > 0) {
      const latestRate = this._s().fundingRateHistory[this._s().fundingRateHistory.length - 1].rate;

      if (side === 'long' && isGreaterThanOrEqual(latestRate, '0')) {
        // Funding has normalised for a long (was negative, now >= 0)
        this._emitPartialClose(
          SIGNAL_ACTIONS.CLOSE_LONG,
          '펀딩비 정상화 (0% 이상 회복) — 50% 부분 익절',
        );
        return;
      }

      if (side === 'short' && isLessThanOrEqual(latestRate, '0')) {
        // Funding has normalised for a short (was positive, now <= 0)
        this._emitPartialClose(
          SIGNAL_ACTIONS.CLOSE_SHORT,
          '펀딩비 정상화 (0% 이하 회복) — 50% 부분 익절',
        );
        return;
      }
    }
  }

  /**
   * Emit a full close signal and reset position state.
   * @private
   * @param {string} action
   * @param {string} reason
   */
  _emitClose(action, reason) {
    this._s().lastSignal = {
      action,
      symbol: this.getCurrentSymbol(),
      category: this._category,
      suggestedPrice: this._s().latestPrice,
      reduceOnly: true,
      confidence: '1.0000',
      leverage: '3',
      marketContext: {
        strategy: 'FundingRateStrategy',
        reason,
        entryPrice: this._s().entryPrice,
        exitPrice: this._s().latestPrice,
      },
    };

    this.emitSignal(this._s().lastSignal);

    log.trade('Close signal generated', {
      action,
      reason,
      entryPrice: this._s().entryPrice,
      exitPrice: this._s().latestPrice,
    });

    // Reset position state
    this._s().positionSide = null;
    this._s().entryPrice = null;
    this._s().entryTime = null;
    this._s().partialExitDone = false;
  }

  /**
   * Emit a partial close (50%) signal — funding normalisation exit.
   * @private
   * @param {string} action
   * @param {string} reason
   */
  _emitPartialClose(action, reason) {
    this._s().lastSignal = {
      action,
      symbol: this.getCurrentSymbol(),
      category: this._category,
      suggestedPrice: this._s().latestPrice,
      suggestedQty: '50%',
      reduceOnly: true,
      confidence: '0.8000',
      leverage: '3',
      marketContext: {
        strategy: 'FundingRateStrategy',
        reason,
        partialExit: true,
        entryPrice: this._s().entryPrice,
        currentPrice: this._s().latestPrice,
      },
    };

    this.emitSignal(this._s().lastSignal);
    this._s().partialExitDone = true;

    log.trade('Partial close signal generated (50%)', {
      action,
      reason,
      entryPrice: this._s().entryPrice,
      currentPrice: this._s().latestPrice,
    });
  }

  /**
   * Reset position tracking state after full exit.
   * @private
   */
  _resetPosition() {
    const s = this._s();
    s.positionSide = null;
    s.entryPrice = null;
    s.entryTime = null;
    s.partialExitDone = false;
  }

  // ---------------------------------------------------------------------------
  // Funding rate analysis helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the last N funding rates are all the same sign.
   *
   * @returns {'positive'|'negative'|null}
   *   - 'positive' — all last N rates > 0
   *   - 'negative' — all last N rates < 0
   *   - null       — mixed or insufficient data
   * @private
   */
  _getConsecutiveFundingDirection() {
    const n = this._consecutivePeriods;
    if (this._s().fundingRateHistory.length < n) return null;

    const recent = this._s().fundingRateHistory.slice(-n);

    const allNegative = recent.every((entry) => isLessThan(entry.rate, '0'));
    if (allNegative) return 'negative';

    const allPositive = recent.every((entry) => isGreaterThan(entry.rate, '0'));
    if (allPositive) return 'positive';

    return null;
  }

  /**
   * Calculate the percentage change in open interest over the past 24 hours.
   *
   * @returns {string|null} — percentage change (e.g. "7.5000") or null if
   *                          insufficient data
   * @private
   */
  _getOiChange24h() {
    if (this._s().oiHistory.length < 2) return null;

    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;

    // Find the earliest entry that is at or before ~24h ago
    let oldest = null;
    for (let i = 0; i < this._s().oiHistory.length; i++) {
      if (this._s().oiHistory[i].timestamp.getTime() <= cutoff) {
        oldest = this._s().oiHistory[i];
      } else {
        break;
      }
    }

    // If no entry is 24h old yet, use the earliest available
    if (!oldest) {
      oldest = this._s().oiHistory[0];
    }

    const latest = this._s().oiHistory[this._s().oiHistory.length - 1];

    if (isZero(oldest.oi)) return null;

    // pctChange = ((new - old) / |old|) * 100
    const diff = subtract(latest.oi, oldest.oi);
    const pct = multiply(divide(diff, oldest.oi), '100');
    return toFixed(pct, 4);
  }

  // ---------------------------------------------------------------------------
  // Kelly formula
  // ---------------------------------------------------------------------------

  /**
   * Calculate the Kelly fraction for position sizing.
   *
   * Kelly formula: f* = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin
   * We apply half-Kelly for safety: f* / 2
   *
   * @param {string} winRate  — probability of winning (0..1)
   * @param {string} avgWin   — average win amount
   * @param {string} avgLoss  — average loss amount (positive number)
   * @returns {string} — kelly fraction (0..1), clamped to [0, 1]
   * @private
   */
  _calculateKellyFraction(winRate, avgWin, avgLoss) {
    if (isZero(avgWin)) return '0';

    // f* = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin
    const winComponent = multiply(winRate, avgWin);
    const lossRate = subtract('1', winRate);
    const lossComponent = multiply(lossRate, avgLoss);
    const numerator = subtract(winComponent, lossComponent);
    const kelly = divide(numerator, avgWin);

    // Clamp to [0, 1]
    if (isLessThan(kelly, '0')) return '0';
    if (isGreaterThan(kelly, '1')) return '1';

    // Half-Kelly for safety
    return divide(kelly, '2');
  }

  // ---------------------------------------------------------------------------
  // Position sizing
  // ---------------------------------------------------------------------------

  /**
   * Calculate suggested position quantity.
   *
   * Uses half-Kelly with a cap at positionSizePercent (default 5%) of
   * notional equity. Since we do not know the account equity inside the
   * strategy, we express the quantity as a percentage string that the
   * OrderManager / RiskEngine can interpret.
   *
   * @param {string} currentPrice
   * @returns {string} — position-size percentage of equity (e.g. "2.50")
   * @private
   */
  _calculatePositionSize(currentPrice) {
    // Default Kelly inputs — conservative estimates for a contrarian strategy
    const winRate = '0.55';
    const avgWin = this._tpPercent;   // +3%
    const avgLoss = this._slPercent;  // -2%

    const kellyFraction = this._calculateKellyFraction(winRate, avgWin, avgLoss);

    // Convert to percentage and cap at _positionSizePercent
    const kellyPercent = multiply(kellyFraction, '100');

    if (isGreaterThan(kellyPercent, this._positionSizePercent)) {
      return this._positionSizePercent;
    }

    if (isLessThan(kellyPercent, '1')) {
      return '1';   // Minimum 1% to avoid dust positions
    }

    return toFixed(kellyPercent, 2);
  }

  // ---------------------------------------------------------------------------
  // SMA calculation
  // ---------------------------------------------------------------------------

  /**
   * Calculate Simple Moving Average over the last `period` close prices.
   *
   * @param {number} period
   * @returns {string|null}
   * @private
   */
  _calculateSMA(period) {
    if (this._s().priceHistory.length < period) return null;

    const slice = this._s().priceHistory.slice(-period);
    let sum = '0';
    for (let i = 0; i < slice.length; i++) {
      sum = add(sum, slice[i]);
    }
    return divide(sum, String(period));
  }

  // ---------------------------------------------------------------------------
  // Condition helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if the current price is within 3% of SMA(20).
   * "부근" = within a 3% band above or below.
   *
   * @param {string} price
   * @param {string} sma
   * @returns {boolean}
   * @private
   */
  _isPriceNearSMA(price, sma) {
    const lowerBound = multiply(sma, '0.97');
    const upperBound = multiply(sma, '1.03');
    return (
      isGreaterThanOrEqual(price, lowerBound) &&
      isLessThanOrEqual(price, upperBound)
    );
  }

  /**
   * Check if the current market regime favours a long entry.
   * Long regime: TRENDING_DOWN or VOLATILE (fear / capitulation).
   *
   * @returns {boolean}
   * @private
   */
  _isLongRegime() {
    return (
      this.getEffectiveRegime() === null ||
      this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN ||
      this.getEffectiveRegime() === MARKET_REGIMES.VOLATILE
    );
  }

  /**
   * Check if the current market regime favours a short entry.
   * Short regime: TRENDING_UP or VOLATILE (greed / euphoria).
   *
   * @returns {boolean}
   * @private
   */
  _isShortRegime() {
    return (
      this.getEffectiveRegime() === null ||
      this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP ||
      this.getEffectiveRegime() === MARKET_REGIMES.VOLATILE
    );
  }

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------

  /**
   * Calculate confidence for a long entry.
   * Base = 50, bonuses for extreme funding and high OI change.
   *
   * @param {string} fundingRate
   * @param {string} oiChange
   * @returns {string} — confidence 0–100
   * @private
   */
  _calculateLongConfidence(fundingRate, oiChange) {
    let confidence = 0.50;

    // Extreme negative funding (<= -0.03) bonus
    if (isLessThanOrEqual(fundingRate, '-0.03')) {
      confidence += 0.20;
    }

    // High OI change (> 10%) bonus
    if (isGreaterThan(oiChange, '10')) {
      confidence += 0.10;
    }

    // Volatile regime bonus
    if (this.getEffectiveRegime() === MARKET_REGIMES.VOLATILE) {
      confidence += 0.10;
    }

    return toFixed(String(Math.min(confidence, 0.95)), 4);
  }

  /**
   * Calculate confidence for a short entry.
   * Base = 50, bonuses for extreme funding and high OI change.
   *
   * @param {string} fundingRate
   * @param {string} oiChange
   * @returns {string} — confidence 0–100
   * @private
   */
  _calculateShortConfidence(fundingRate, oiChange) {
    let confidence = 0.50;

    // Extreme positive funding (>= +0.06) bonus
    if (isGreaterThanOrEqual(fundingRate, '0.06')) {
      confidence += 0.20;
    }

    // High OI change (> 10%) bonus
    if (isGreaterThan(oiChange, '10')) {
      confidence += 0.10;
    }

    // Volatile regime bonus
    if (this.getEffectiveRegime() === MARKET_REGIMES.VOLATILE) {
      confidence += 0.10;
    }

    return toFixed(String(Math.min(confidence, 0.95)), 4);
  }

}

// ---------------------------------------------------------------------------
// Registry self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('FundingRateStrategy', FundingRateStrategy);

module.exports = FundingRateStrategy;
