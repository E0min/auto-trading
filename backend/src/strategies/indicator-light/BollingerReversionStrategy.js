'use strict';

/**
 * BollingerReversionStrategy — BB(20,2) + RSI(14) + Stochastic(14,3) mean reversion
 * with split entries (up to 3 entries: 40%, 30%, 30%).
 *
 * Bidirectional (Long & Short) on 5-minute candles.
 *
 * Entry Long:
 *   - Prev close < BB lower AND current close > BB lower (re-entry into band)
 *   - RSI crosses above 30 from below
 *   - Stochastic %K crosses above %D in oversold zone (<= 20)
 *   - Bandwidth > 2%
 *   - Regime: RANGING or VOLATILE
 *
 * Entry Short:
 *   - Prev close > BB upper AND current close < BB upper
 *   - RSI crosses below 70 from above
 *   - Stochastic %K crosses below %D in overbought zone (>= 80)
 *   - Bandwidth > 2%
 *   - Regime: RANGING or VOLATILE
 *
 * Exit:
 *   - BB middle → half profit (50%)
 *   - BB opposite band → full profit (remaining 50%)
 *   - SL: -4% from average entry price
 *
 * Trending filter:
 *   - No short during TRENDING_UP
 *   - No long during TRENDING_DOWN
 *
 * Leverage: 3x, max position: 5% of equity
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
} = require('../../utils/mathUtils');
const { createLogger } = require('../../utils/logger');

// ==========================================================================
// BollingerReversionStrategy
// ==========================================================================

class BollingerReversionStrategy extends StrategyBase {
  static metadata = {
    name: 'BollingerReversionStrategy',
    targetRegimes: ['ranging', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 2,
    maxSymbolsPerStrategy: 3,
    cooldownMs: 60000,
    gracePeriodMs: 300000,
    warmupCandles: 22,
    volatilityPreference: 'low',
    description: '볼린저밴드 역추세 + RSI + 스토캐스틱 (분할매수)',
    docs: {
      summary: 'BB(20,2) 밴드 재진입 + RSI(14) 크로스 + Stochastic(14,3) 크로스 3중 조건으로 평균 회귀를 포착하는 역추세 전략. 분할 매수(40%/30%/30%, 최대 3회)로 평균 단가를 개선하고, BB 중앙선에서 50% 부분 익절, 반대편 밴드에서 나머지 전량 익절.',
      timeframe: '1분봉 (IndicatorCache 통한 BB/RSI/Stochastic 계산)',
      entry: {
        long: '전봉 close < BB하단 AND 현봉 close > BB하단(재진입) + RSI가 30 아래→위 크로스 + Stochastic %K가 %D 상향 크로스(과매도 ≤20) + Bandwidth > 2%',
        short: '전봉 close > BB상단 AND 현봉 close < BB상단(재진입) + RSI가 70 위→아래 크로스 + Stochastic %K가 %D 하향 크로스(과매수 ≥80) + Bandwidth > 2%',
        conditions: [
          'BB(20,2) 계산 완료',
          'RSI(14) 크로스오버 감지 (전봉 vs 현봉)',
          'Stochastic(14,3) %K/%D 크로스오버 + 극단 영역 확인',
          'Bandwidth > 2% (변동성 충분)',
          'TRENDING_DOWN에서 롱 금지, TRENDING_UP에서 숏 금지',
          '레짐: RANGING 또는 VOLATILE',
          '분할 매수 횟수 < maxEntries(3)',
        ],
      },
      exit: {
        tp: 'BB 중앙선 도달 시 50% 부분 익절 → BB 반대편 밴드 도달 시 나머지 전량 익절',
        sl: '-4% (평균 진입가 대비)',
        trailing: '없음',
        other: [],
      },
      indicators: [
        'Bollinger Bands(20, 2) — 상단/중앙/하단/Bandwidth',
        'RSI(14)',
        'Stochastic(14, 3) — %K, %D',
      ],
      riskReward: {
        tp: 'BB 중앙선(~50%) + BB 반대편(나머지)',
        sl: '-4%',
        ratio: '약 1:1~2:1 (밴드 폭에 따라 변동)',
      },
      strengths: [
        '3중 조건(BB재진입 + RSI크로스 + Stoch크로스)으로 거짓 신호 최소화',
        '분할 매수(40/30/30%)로 평균 단가 개선',
        'BB 중앙선 50% 부분 익절로 안전한 수익 확보',
        'Bandwidth 필터로 좁은 밴드(스퀴즈) 구간 진입 방지',
      ],
      weaknesses: [
        '3중 조건 + 크로스오버 동시 충족이 드물어 신호 매우 적음',
        '강한 추세에서 밴드 외부 체류 시 연속 손절 가능',
        '-4% SL이 다소 넓어 손실 규모가 클 수 있음',
        '분할 매수 시 3차까지 가면 총 노출이 positionSizePercent 전체로 확대',
      ],
      bestFor: '볼린저 밴드 폭이 넓은 횡보/변동성 장세에서 밴드 터치 후 평균 회귀 매매',
      warnings: [
        '워밍업 22봉 필요 — BB(20) + Stochastic 데이터 축적',
        '레버리지 기본값 3배',
        '분할 매수 최대 3회 — 3차 진입 후에도 방향 반전 없으면 -4% SL 피격',
      ],
      difficulty: 'intermediate',
    },
    defaultConfig: {
      bbPeriod: 20,
      bbStdDev: 2,
      rsiPeriod: 14,
      stochPeriod: 14,
      stochSmooth: 3,
      positionSizePercent: '5',
      tpPercent: '4',
      slPercent: '4',
      maxEntries: 3,
    },
  };

  /**
   * @param {object} config
   * @param {number} [config.bbPeriod=20]
   * @param {number} [config.bbStdDev=2]
   * @param {number} [config.rsiPeriod=14]
   * @param {number} [config.stochPeriod=14]
   * @param {number} [config.stochSmooth=3]
   * @param {string} [config.positionSizePercent='5']
   * @param {string} [config.tpPercent='4']
   * @param {string} [config.slPercent='4']
   * @param {number} [config.maxEntries=3]
   */
  constructor(config = {}) {
    const merged = { ...BollingerReversionStrategy.metadata.defaultConfig, ...config };
    super('BollingerReversionStrategy', merged);

    this._log = createLogger('BollingerReversionStrategy');
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
      prevClose: null,
      prevRsi: null,
      prevStochK: null,
      prevStochD: null,
      entryCount: 0,
      halfProfitTaken: false,
    };
  }

  // --------------------------------------------------------------------------
  // onTick — store latest price, check TP/SL if position is open
  // --------------------------------------------------------------------------

  /**
   * @param {object} ticker — must have { lastPrice: string }
   */
  onTick(ticker) {
    if (!this._active) return;

    if (ticker && ticker.lastPrice !== undefined) {
      this._s().latestPrice = String(ticker.lastPrice);
    }

    // Check TP/SL only when we have a position
    if (this._s().entryPrice === null || this._s().positionSide === null) return;
    if (this._s().latestPrice === null) return;

    const { slPercent, positionSizePercent } = this.config;
    const price = this._s().latestPrice;
    const entry = this._s().entryPrice;

    // --- Stop Loss check (-4% from average entry) ---
    if (this._s().positionSide === 'long') {
      const slPrice = subtract(entry, multiply(entry, divide(slPercent, '100')));
      if (isLessThan(price, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
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
      const slPrice = add(entry, multiply(entry, divide(slPercent, '100')));
      if (isGreaterThan(price, slPrice)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
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
   * @param {object} kline — must have { close: string, high: string, low: string }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const {
      bbPeriod,
      bbStdDev,
      rsiPeriod,
      stochPeriod,
      stochSmooth,
      positionSizePercent,
      maxEntries,
    } = this.config;

    // 1. Get history from IndicatorCache for data sufficiency & prevClose
    const c = this._indicatorCache;
    const hist = c.getHistory(this.getCurrentSymbol());
    const minRequired = Math.max(bbPeriod, rsiPeriod + 1, stochPeriod + stochSmooth);

    if (!hist || hist.closes.length < minRequired) {
      this._log.debug('Not enough data yet', {
        have: hist ? hist.closes.length : 0,
        need: minRequired,
      });
      return;
    }

    const prevClose = hist.closes.length > 1 ? hist.closes[hist.closes.length - 2] : null;

    // 2. Calculate indicators via IndicatorCache
    const bb = c.get(this.getCurrentSymbol(), 'bb', { period: bbPeriod, stdDev: bbStdDev });
    const rsi = c.get(this.getCurrentSymbol(), 'rsi', { period: rsiPeriod });
    const stoch = c.get(this.getCurrentSymbol(), 'stochastic', { period: stochPeriod, smooth: stochSmooth });

    // Null checks — cache returns null if insufficient data
    if (bb === null || rsi === null) return;

    const { upper, middle, lower, bandwidth } = bb;

    if (stoch === null) {
      this._s().prevClose = prevClose;
      this._s().prevRsi = rsi;
      return;
    }
    const { k: stochK, d: stochD } = stoch;

    // 5. Crossover detection --------------------------------------------------
    const prevRsi = this._s().prevRsi;
    const prevStochK = this._s().prevStochK;
    const prevStochD = this._s().prevStochD;

    const regime = this.getEffectiveRegime();
    const price = close;

    const marketContext = {
      upper,
      middle,
      lower,
      bandwidth,
      rsi,
      stochK,
      stochD,
      price,
      regime,
    };

    let signal = null;

    // --- TP check for open position on kline (BB middle / BB opposite band) ---
    if (this._s().entryPrice !== null && this._s().positionSide !== null) {
      signal = this._checkTakeProfit(price, middle, upper, lower, positionSizePercent, marketContext);
      if (signal) {
        this._s().lastSignal = signal;
        this.emitSignal(signal);
        // Update previous values before returning
        this._s().prevClose = prevClose;
        this._s().prevRsi = rsi;
        this._s().prevStochK = stochK;
        this._s().prevStochD = stochD;
        return;
      }
    }

    // --- Entry conditions ---
    // Need previous values for crossover detection
    if (prevClose === null || prevRsi === null || prevStochK === null || prevStochD === null) {
      this._s().prevClose = prevClose;
      this._s().prevRsi = rsi;
      this._s().prevStochK = stochK;
      this._s().prevStochD = stochD;
      return;
    }

    // Bandwidth must be > 2%
    const bandwidthSufficient = isGreaterThan(bandwidth, '2');

    // OPEN_LONG conditions:
    //   - prev close < BB lower AND current close > BB lower (re-entry)
    //   - RSI crosses above 30 (prev RSI <= 30, current RSI > 30)
    //   - Stochastic %K crosses above %D in oversold zone (prev %K <= %D, current %K > %D, zone <= 20)
    //   - Bandwidth > 2%
    //   - Regime: RANGING or VOLATILE
    //   - Not TRENDING_DOWN (no long during TRENDING_DOWN)
    if (
      bandwidthSufficient &&
      isLessThan(prevClose, lower) &&
      isGreaterThan(close, lower) &&
      !isGreaterThan(prevRsi, '30') && isGreaterThan(rsi, '30') &&
      !isGreaterThan(prevStochK, prevStochD) && isGreaterThan(stochK, stochD) &&
      !isGreaterThan(prevStochK, '20') &&
      regime !== MARKET_REGIMES.TRENDING_DOWN &&
      (regime === null || regime === MARKET_REGIMES.RANGING || regime === MARKET_REGIMES.VOLATILE) &&
      (this._s().positionSide === null || this._s().positionSide === 'long') &&
      this._s().entryCount < maxEntries
    ) {
      const entryNumber = this._s().entryCount + 1;
      const sizePercent = this._getSplitSize(entryNumber, positionSizePercent);
      const confidence = this._calcConfidence(rsi, stochK, bandwidth);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_LONG,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: price,
        stopLossPrice: subtract(price, multiply(price, divide(this.config.slPercent || '4', '100'))),
        confidence,
        leverage: String(this.config.leverage || '3'),
        entryNumber,
        maxEntries,
        marketContext,
      };

      this._updateEntry(price, 'long');
    }
    // OPEN_SHORT conditions:
    //   - prev close > BB upper AND current close < BB upper (re-entry)
    //   - RSI crosses below 70 (prev RSI >= 70, current RSI < 70)
    //   - Stochastic %K crosses below %D in overbought zone (prev %K >= %D, current %K < %D, zone >= 80)
    //   - Bandwidth > 2%
    //   - Regime: RANGING or VOLATILE
    //   - Not TRENDING_UP (no short during TRENDING_UP)
    else if (
      bandwidthSufficient &&
      isGreaterThan(prevClose, upper) &&
      isLessThan(close, upper) &&
      !isLessThan(prevRsi, '70') && isLessThan(rsi, '70') &&
      !isLessThan(prevStochK, prevStochD) && isLessThan(stochK, stochD) &&
      !isLessThan(prevStochK, '80') &&
      regime !== MARKET_REGIMES.TRENDING_UP &&
      (regime === null || regime === MARKET_REGIMES.RANGING || regime === MARKET_REGIMES.VOLATILE) &&
      (this._s().positionSide === null || this._s().positionSide === 'short') &&
      this._s().entryCount < maxEntries
    ) {
      const entryNumber = this._s().entryCount + 1;
      const sizePercent = this._getSplitSize(entryNumber, positionSizePercent);
      const confidence = this._calcConfidence(rsi, stochK, bandwidth);

      signal = {
        action: SIGNAL_ACTIONS.OPEN_SHORT,
        symbol: this.getCurrentSymbol(),
        category: this._category,
        suggestedQty: sizePercent,
        suggestedPrice: price,
        stopLossPrice: add(price, multiply(price, divide(this.config.slPercent || '4', '100'))),
        confidence,
        leverage: String(this.config.leverage || '3'),
        entryNumber,
        maxEntries,
        marketContext,
      };

      this._updateEntry(price, 'short');
    }

    // 6. Emit if we have a signal
    if (signal) {
      this._s().lastSignal = signal;
      this.emitSignal(signal);
    }

    // 7. Update previous values for next candle
    this._s().prevClose = prevClose;
    this._s().prevRsi = rsi;
    this._s().prevStochK = stochK;
    this._s().prevStochD = stochD;
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
    super.onFill(fill); // R11: update StrategyBase trailing stop state
    if (!this._active) return;
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      this._s().positionSide = 'long';
      if (fill.price !== undefined) this._s().entryPrice = String(fill.price);
      if (this._s().entryCount === 0) this._s().entryCount = 1;
      this._log.trade('Long fill recorded', { entry: this._s().entryPrice, symbol: this.getCurrentSymbol() });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      this._s().positionSide = 'short';
      if (fill.price !== undefined) this._s().entryPrice = String(fill.price);
      if (this._s().entryCount === 0) this._s().entryCount = 1;
      this._log.trade('Short fill recorded', { entry: this._s().entryPrice, symbol: this.getCurrentSymbol() });
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      this._log.trade('Position closed via fill', { side: this._s().positionSide, symbol: this.getCurrentSymbol() });
      this._resetPosition();
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
  // Private helpers — Take Profit
  // --------------------------------------------------------------------------

  /**
   * Check take-profit conditions based on BB levels.
   *
   * @param {string} price
   * @param {string} middle — BB middle band
   * @param {string} upper  — BB upper band
   * @param {string} lower  — BB lower band
   * @param {string} positionSizePercent
   * @param {object} marketContext
   * @returns {object|null} signal or null
   */
  _checkTakeProfit(price, middle, upper, lower, positionSizePercent, marketContext) {
    if (this._s().positionSide === 'long') {
      // Half profit at BB middle
      if (!this._s().halfProfitTaken && isGreaterThan(price, middle)) {
        this._s().halfProfitTaken = true;
        const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
        return {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: halfQty,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.7500', 4),
          reason: 'half_profit_bb_middle',
          marketContext,
        };
      }
      // Full profit at BB upper (opposite band)
      if (this._s().halfProfitTaken && isGreaterThan(price, upper)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_LONG,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.8500', 4),
          reason: 'full_profit_bb_opposite',
          marketContext,
        };
        this._resetPosition();
        return signal;
      }
    } else if (this._s().positionSide === 'short') {
      // Half profit at BB middle
      if (!this._s().halfProfitTaken && isLessThan(price, middle)) {
        this._s().halfProfitTaken = true;
        const halfQty = toFixed(divide(positionSizePercent, '2'), 4);
        return {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: halfQty,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.7500', 4),
          reason: 'half_profit_bb_middle',
          marketContext,
        };
      }
      // Full profit at BB lower (opposite band)
      if (this._s().halfProfitTaken && isLessThan(price, lower)) {
        const signal = {
          action: SIGNAL_ACTIONS.CLOSE_SHORT,
          symbol: this.getCurrentSymbol(),
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: price,
          reduceOnly: true,
          confidence: toFixed('0.8500', 4),
          reason: 'full_profit_bb_opposite',
          marketContext,
        };
        this._resetPosition();
        return signal;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Private helpers — Split Entry
  // --------------------------------------------------------------------------

  /**
   * Get the position size for a given entry number (split entry: 40%, 30%, 30%).
   *
   * @param {number} entryNumber — 1, 2, or 3
   * @param {string} totalSizePercent — total max position size
   * @returns {string} size for this entry as percentage
   */
  _getSplitSize(entryNumber, totalSizePercent) {
    const ratios = ['0.40', '0.30', '0.30'];
    const ratio = ratios[entryNumber - 1] || '0.30';
    return toFixed(multiply(totalSizePercent, ratio), 4);
  }

  /**
   * Update the average entry price and entry count after a new entry.
   *
   * @param {string} price — entry price
   * @param {'long'|'short'} side — position direction
   */
  _updateEntry(price, side) {
    if (this._s().entryCount === 0) {
      this._s().entryPrice = price;
      this._s().positionSide = side;
      this._s().halfProfitTaken = false;
    } else {
      // Weighted average: existing entries' total weight vs new entry weight
      const prevWeight = this._getSplitCumulativeWeight(this._s().entryCount);
      const newWeight = this._getSplitWeight(this._s().entryCount + 1);
      const totalWeight = add(prevWeight, newWeight);

      // avgEntry = (prevAvg * prevWeight + newPrice * newWeight) / totalWeight
      const prevPart = multiply(this._s().entryPrice, prevWeight);
      const newPart = multiply(price, newWeight);
      this._s().entryPrice = divide(add(prevPart, newPart), totalWeight);
    }
    this._s().entryCount += 1;
  }

  /**
   * Get the weight for a specific entry number.
   * @param {number} entryNumber — 1, 2, or 3
   * @returns {string}
   */
  _getSplitWeight(entryNumber) {
    const weights = ['0.40', '0.30', '0.30'];
    return weights[entryNumber - 1] || '0.30';
  }

  /**
   * Get the cumulative weight for entries 1..n.
   * @param {number} n — number of entries already made
   * @returns {string}
   */
  _getSplitCumulativeWeight(n) {
    const weights = ['0.40', '0.30', '0.30'];
    let total = '0';
    for (let i = 0; i < n && i < weights.length; i++) {
      total = add(total, weights[i]);
    }
    return total;
  }

  /**
   * Reset position tracking state after full exit.
   */
  _resetPosition() {
    this._s().entryPrice = null;
    this._s().entryCount = 0;
    this._s().positionSide = null;
    this._s().halfProfitTaken = false;
  }

  // --------------------------------------------------------------------------
  // Private helpers — Confidence
  // --------------------------------------------------------------------------

  /**
   * Calculate a confidence score based on RSI extremity, stochastic position,
   * and bandwidth.
   *
   * @param {string} rsi
   * @param {string} stochK
   * @param {string} bandwidth
   * @returns {string} confidence 0.00-1.00
   */
  _calcConfidence(rsi, stochK, bandwidth) {
    const rsiVal = parseFloat(rsi);
    const stochVal = parseFloat(stochK);
    const bwVal = parseFloat(bandwidth);

    // RSI component: further from 50 = higher confidence (0-0.4)
    const rsiDistance = Math.abs(rsiVal - 50) / 50;
    const rsiScore = rsiDistance * 0.4;

    // Stochastic component: further from 50 = higher confidence (0-0.3)
    const stochDistance = Math.abs(stochVal - 50) / 50;
    const stochScore = stochDistance * 0.3;

    // Bandwidth component: wider band = more room for reversion (0-0.3)
    // Normalize: 2% = 0, 8%+ = max
    const bwNormalized = Math.min(Math.max((bwVal - 2) / 6, 0), 1);
    const bwScore = bwNormalized * 0.3;

    const confidence = Math.min(0.3 + rsiScore + stochScore + bwScore, 1);
    return toFixed(String(confidence), 4);
  }
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

const registry = require('../../services/strategyRegistry');
registry.register('BollingerReversionStrategy', BollingerReversionStrategy);

module.exports = BollingerReversionStrategy;
