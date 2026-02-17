'use strict';

/**
 * TurtleBreakoutStrategy — Donchian Channel Breakout (터틀 트레이딩 전략)
 *
 * Target regimes: TRENDING_UP, TRENDING_DOWN, VOLATILE
 * Core concept: Pure price-action trend-following based on the classic
 * Turtle Trading system by Richard Dennis / William Eckhardt.
 *
 * Donchian Channels:
 *   - Entry channel: 20-bar high / low
 *   - Exit channel:  10-bar high / low
 *
 * Entry Long:
 *   - Price breaks above 20-bar high (Donchian upper)
 *   - 50-bar trend filter: close > 50-bar Donchian midline
 *   - Regime is TRENDING_UP, TRENDING_DOWN, or VOLATILE (not QUIET/RANGING)
 *
 * Entry Short:
 *   - Price breaks below 20-bar low (Donchian lower)
 *   - 50-bar trend filter: close < 50-bar Donchian midline
 *   - Regime is TRENDING_UP, TRENDING_DOWN, or VOLATILE
 *
 * Exit Long:
 *   - Price drops below 10-bar low (exit channel lower)
 *   - OR trailing stop / ATR-based stop hit
 *
 * Exit Short:
 *   - Price rises above 10-bar high (exit channel upper)
 *   - OR trailing stop / ATR-based stop hit
 *
 * Stop Loss: ATR(20) × stopMultiplier (default 2)
 * Position Sizing: passes riskPerUnit = ATR × stopMultiplier to ExposureGuard
 *   so the 2% risk-per-trade rule is applied at the risk-engine level.
 *
 * Trailing Stop: after 2×ATR profit, trail at 2×ATR from highest/lowest
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

const log = createLogger('TurtleBreakoutStrategy');

class TurtleBreakoutStrategy extends StrategyBase {
  static metadata = {
    name: 'TurtleBreakoutStrategy',
    targetRegimes: ['trending_up', 'trending_down', 'volatile'],
    riskLevel: 'medium',
    maxConcurrentPositions: 1,
    cooldownMs: 300000,
    gracePeriodMs: 600000,
    warmupCandles: 51,
    volatilityPreference: 'high',
    maxSymbolsPerStrategy: 3,
    trailingStop: { enabled: false, activationPercent: '2.0', callbackPercent: '1.5' },
    description: '터틀 트레이딩 — Donchian 채널 돌파 + ATR 기반 2% 리스크 룰',
    docs: {
      summary: '리처드 데니스의 터틀 트레이딩 시스템을 구현한 순수 가격행동 추세추종 전략. Donchian 채널(20봉) 돌파로 진입하고, 10봉 채널 이탈 또는 ATR 기반 트레일링 스탑으로 청산한다. 50봉 Donchian 중간선을 추세 필터로 사용하여 추세 방향과 일치하는 돌파만 진입한다.',
      timeframe: {
        primary: '1m',
        effective: '1m (약 20~50분 단위 채널)',
        note: '1분봉 기준 20봉/50봉 Donchian 채널 계산. 실질적으로 단기 추세 돌파를 포착한다.',
      },
      entry: {
        long: [
          '종가가 20봉 Donchian 상단(이전 20봉 최고가)을 돌파',
          '종가가 50봉 Donchian 중간선 위에 위치 (추세 필터)',
          '시장 레짐이 TRENDING_UP, TRENDING_DOWN, VOLATILE 중 하나',
        ],
        short: [
          '종가가 20봉 Donchian 하단(이전 20봉 최저가)을 하향 돌파',
          '종가가 50봉 Donchian 중간선 아래에 위치 (추세 필터)',
          '시장 레짐이 TRENDING_UP, TRENDING_DOWN, VOLATILE 중 하나',
        ],
      },
      exit: {
        takeProfit: '10봉 Donchian 채널 반대편 돌파 시 청산 (롱: 10봉 최저가 하회, 숏: 10봉 최고가 상회)',
        stopLoss: 'ATR(20) × 2 거리에 고정 손절 설정',
        trailing: '2×ATR 수익 달성 후 활성화, 최고/최저가에서 2×ATR 간격으로 추적',
        indicator: null,
      },
      indicators: ['Donchian Channel(20)', 'Donchian Channel(10)', 'Donchian Channel(50)', 'ATR(20)'],
      riskReward: {
        typicalRR: '1:2~3',
        maxDrawdownPerTrade: 'ATR × 2 (약 2~4%)',
        avgHoldingPeriod: '수십 분 ~ 수 시간',
      },
      strengths: [
        '순수 가격행동 기반으로 후행 지표 의존 없음',
        'ATR 기반 동적 손절로 변동성에 적응',
        '50봉 추세 필터로 역추세 진입 방지',
      ],
      weaknesses: [
        '횡보장(RANGING/QUIET)에서 빈번한 거짓 돌파 발생',
        '진입 후 즉시 반전 시 ATR × 2 손실 발생 가능',
        '추세가 짧을 경우 Donchian 채널 청산이 늦어질 수 있음',
      ],
      bestFor: '변동성이 높고 명확한 추세가 형성된 시장에서 채널 돌파를 따라가는 추세추종 매매',
      warnings: [
        'QUIET/RANGING 레짐에서는 자동으로 비활성화됨',
        '레버리지 3배 적용되므로 연속 손실 시 드로다운 주의',
      ],
      difficulty: 'beginner',
    },
    defaultConfig: {
      entryChannel: 20,       // Donchian entry channel period (N-bar high/low)
      exitChannel: 10,        // Donchian exit channel period
      trendFilter: 50,        // Long-term Donchian for trend filter
      atrPeriod: 20,          // ATR calculation period
      stopMultiplier: '2',    // ATR × N = stop loss distance
      trailingActivationAtr: '2',  // Activate trailing after N×ATR profit
      trailingDistanceAtr: '2',    // Trail at N×ATR from extreme
      positionSizePercent: '4',    // Fallback position size (ExposureGuard overrides via riskPerUnit)
      leverage: '3',
    },
  };

  /**
   * @param {object} config — strategy configuration overrides
   */
  constructor(config = {}) {
    const merged = { ...TurtleBreakoutStrategy.metadata.defaultConfig, ...config };
    super('TurtleBreakoutStrategy', merged);

    /** @type {number} max data points to keep */
    this._maxHistory = 200;
  }

  /**
   * Override: create per-symbol state with all position/indicator fields.
   * @returns {object}
   */
  _createDefaultState() {
    return {
      ...super._createDefaultState(),

      /** @type {Array<{high:string, low:string, close:string}>} kline history */
      klineHistory: [],

      /** @type {string|null} ATR-based stop loss price */
      stopPrice: null,

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

      /** @type {string|null} pending stop price from signal */
      pendingStopPrice: null,

      /** @type {string|null} pending entry high */
      pendingEntryHigh: null,

      /** @type {string|null} pending entry low */
      pendingEntryLow: null,
    };
  }

  // --------------------------------------------------------------------------
  // Donchian Channel helpers — pure price-action, no lagging indicators
  // --------------------------------------------------------------------------

  /**
   * Compute Donchian Channel (N-bar high / low) from kline history.
   * Uses the PREVIOUS N bars (excludes the current/latest bar) so that
   * breakout detection compares the current close against prior range.
   * @param {number} period
   * @returns {{ upper: string, lower: string, mid: string }|null}
   */
  _donchian(period) {
    const s = this._s();
    // Need at least period + 1 bars (period previous + 1 current)
    if (s.klineHistory.length < period + 1) return null;

    const slice = s.klineHistory.slice(-(period + 1), -1);
    let highest = slice[0].high;
    let lowest = slice[0].low;

    for (let i = 1; i < slice.length; i++) {
      if (isGreaterThan(slice[i].high, highest)) highest = slice[i].high;
      if (isLessThan(slice[i].low, lowest)) lowest = slice[i].low;
    }

    const mid = divide(add(highest, lowest), '2');
    return { upper: highest, lower: lowest, mid };
  }

  // --------------------------------------------------------------------------
  // onTick — real-time SL / trailing stop checks
  // --------------------------------------------------------------------------

  /**
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

    // --- Hard stop loss (ATR-based) ---
    if (s.stopPrice !== null) {
      if (s.positionSide === 'long' && isLessThan(price, s.stopPrice)) {
        this._emitCloseSignal('long', price, 'atr_stop_loss', {
          entryPrice: s.entryPrice,
          stopPrice: s.stopPrice,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, s.stopPrice)) {
        this._emitCloseSignal('short', price, 'atr_stop_loss', {
          entryPrice: s.entryPrice,
          stopPrice: s.stopPrice,
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
  // onKline — main signal logic
  // --------------------------------------------------------------------------

  /**
   * @param {object} kline — must have { high, low, close }
   */
  onKline(kline) {
    if (!this._active) return;

    const close = kline && kline.close !== undefined ? String(kline.close) : null;
    if (close === null) return;

    const high = kline && kline.high !== undefined ? String(kline.high) : close;
    const low = kline && kline.low !== undefined ? String(kline.low) : close;

    const s = this._s();
    const sym = this.getCurrentSymbol();

    // 1. Push data and trim
    s.klineHistory.push({ high, low, close });
    if (s.klineHistory.length > this._maxHistory) {
      s.klineHistory = s.klineHistory.slice(-this._maxHistory);
    }

    // 2. Need enough data for the longest channel + ATR
    const { entryChannel, exitChannel, trendFilter, atrPeriod } = this.config;
    const minRequired = Math.max(trendFilter + 1, entryChannel + 1, exitChannel + 1, atrPeriod + 1);
    if (s.klineHistory.length < minRequired) {
      log.debug('Not enough data yet', {
        have: s.klineHistory.length,
        need: minRequired,
      });
      return;
    }

    // 3. Compute Donchian channels and ATR
    const entryDC = this._donchian(entryChannel);
    const exitDC = this._donchian(exitChannel);
    const trendDC = this._donchian(trendFilter);
    const currentAtr = atr(s.klineHistory, atrPeriod);

    if (!entryDC || !exitDC || !trendDC || currentAtr === null) return;

    s.latestAtr = currentAtr;
    const price = close;
    const { stopMultiplier, positionSizePercent, trailingActivationAtr, trailingDistanceAtr } = this.config;

    // 4. If position open: check Donchian exit channel + trailing activation
    if (s.positionSide !== null && s.entryPrice !== null) {
      // Update extreme prices
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

      // Donchian exit channel: 10-bar low for longs, 10-bar high for shorts
      if (s.positionSide === 'long' && isLessThan(price, exitDC.lower)) {
        this._emitCloseSignal('long', price, 'donchian_exit', {
          entryPrice: s.entryPrice,
          exitChannelLower: exitDC.lower,
        });
        this._resetPosition();
        return;
      }
      if (s.positionSide === 'short' && isGreaterThan(price, exitDC.upper)) {
        this._emitCloseSignal('short', price, 'donchian_exit', {
          entryPrice: s.entryPrice,
          exitChannelUpper: exitDC.upper,
        });
        this._resetPosition();
        return;
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

    // 5. No position: check entry conditions

    // Regime filter: only trending or volatile markets
    const regime = this.getEffectiveRegime();
    const regimeOk = regime === null ||
      regime === MARKET_REGIMES.TRENDING_UP ||
      regime === MARKET_REGIMES.TRENDING_DOWN ||
      regime === MARKET_REGIMES.VOLATILE;
    if (!regimeOk) return;

    // riskPerUnit = ATR × stopMultiplier → passed to ExposureGuard for 2% rule
    const riskPerUnit = multiply(currentAtr, stopMultiplier);

    // --- Long entry: close breaks above 20-bar high + trend filter (above 50-bar midline) ---
    if (
      isGreaterThan(price, entryDC.upper) &&
      isGreaterThan(price, trendDC.mid)
    ) {
      const slPrice = subtract(price, riskPerUnit);
      const conf = this._calcConfidence(price, entryDC, trendDC, currentAtr);

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
        reason: 'donchian_breakout_long',
        marketContext: {
          entryChannelUpper: entryDC.upper,
          entryChannelLower: entryDC.lower,
          trendMid: trendDC.mid,
          exitChannelLower: exitDC.lower,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          regime,
        },
      };

      s.lastSignal = signal;
      // Store pending stop price and kline data for onFill to pick up
      s.pendingStopPrice = slPrice;
      s.pendingEntryHigh = high;
      s.pendingEntryLow = low;
      this.emitSignal(signal);
      return;
    }

    // --- Short entry: close breaks below 20-bar low + trend filter (below 50-bar midline) ---
    if (
      isLessThan(price, entryDC.lower) &&
      isLessThan(price, trendDC.mid)
    ) {
      const slPrice = add(price, riskPerUnit);
      const conf = this._calcConfidence(price, entryDC, trendDC, currentAtr);

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
        reason: 'donchian_breakout_short',
        marketContext: {
          entryChannelUpper: entryDC.upper,
          entryChannelLower: entryDC.lower,
          trendMid: trendDC.mid,
          exitChannelUpper: exitDC.upper,
          atr: currentAtr,
          riskPerUnit,
          slPrice,
          regime,
        },
      };

      s.lastSignal = signal;
      // Store pending stop price and kline data for onFill to pick up
      s.pendingStopPrice = slPrice;
      s.pendingEntryHigh = high;
      s.pendingEntryLow = low;
      this.emitSignal(signal);
      return;
    }
  }

  // --------------------------------------------------------------------------
  // onFill
  // --------------------------------------------------------------------------

  onFill(fill) {
    super.onFill(fill); // R10: update StrategyBase trailing stop state
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    const s = this._s();
    const sym = this.getCurrentSymbol();

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
      s.positionSide = 'long';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.stopPrice = s.pendingStopPrice || null;
      s.highestSinceEntry = s.pendingEntryHigh || s.entryPrice;
      s.lowestSinceEntry = null;
      s.trailingActive = false;
      s.trailingStopPrice = null;
      s.pendingStopPrice = null;
      s.pendingEntryHigh = null;
      s.pendingEntryLow = null;
      log.trade('Long fill recorded', { entry: s.entryPrice, symbol: sym });
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
      s.positionSide = 'short';
      if (fill.price !== undefined) s.entryPrice = String(fill.price);
      s.stopPrice = s.pendingStopPrice || null;
      s.highestSinceEntry = null;
      s.lowestSinceEntry = s.pendingEntryLow || s.entryPrice;
      s.trailingActive = false;
      s.trailingStopPrice = null;
      s.pendingStopPrice = null;
      s.pendingEntryHigh = null;
      s.pendingEntryLow = null;
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
   * Calculate confidence based on breakout strength and trend alignment.
   *
   * @param {string} price
   * @param {object} entryDC — entry Donchian channel
   * @param {object} trendDC — trend filter Donchian channel
   * @param {string} currentAtr
   * @returns {number} confidence 0.50-1.00
   */
  _calcConfidence(price, entryDC, trendDC, currentAtr) {
    let conf = 0.55; // Base

    // Breakout magnitude: how far beyond channel (relative to ATR)
    const channelWidth = subtract(entryDC.upper, entryDC.lower);
    if (isGreaterThan(channelWidth, '0')) {
      const breakoutDist = isGreaterThan(price, entryDC.upper)
        ? subtract(price, entryDC.upper)
        : subtract(entryDC.lower, price);
      const breakoutRatio = parseFloat(divide(breakoutDist, currentAtr));
      conf += Math.min(breakoutRatio * 0.10, 0.15);
    }

    // Trend alignment: distance from trend midline (0-0.15)
    const trendWidth = subtract(trendDC.upper, trendDC.lower);
    if (isGreaterThan(trendWidth, '0')) {
      const distFromMid = abs(subtract(price, trendDC.mid));
      const trendStrength = parseFloat(divide(distFromMid, divide(trendWidth, '2')));
      conf += Math.min(trendStrength * 0.10, 0.15);
    }

    // Regime bonus
    if (this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_UP || this.getEffectiveRegime() === MARKET_REGIMES.TRENDING_DOWN) {
      conf += 0.10;
    }

    return Math.min(conf, 1.0);
  }

  /**
   * Reset all position-tracking state after a full exit.
   */
  _resetPosition() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
    s.stopPrice = null;
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
registry.register('TurtleBreakoutStrategy', TurtleBreakoutStrategy);

module.exports = TurtleBreakoutStrategy;
