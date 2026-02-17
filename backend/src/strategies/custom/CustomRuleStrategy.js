'use strict';

/**
 * CustomRuleStrategy — JSON rule-based custom strategy engine.
 *
 * Interprets a user-defined rule definition (CustomStrategyDef) at runtime:
 *   - Reads indicators from the shared IndicatorCache
 *   - Evaluates AND/OR condition groups for entry/exit
 *   - Supports crosses_above / crosses_below via prev-value tracking
 *
 * Registered dynamically by customStrategyStore → strategyRegistry.
 */

const StrategyBase = require('../../services/strategyBase');
const { SIGNAL_ACTIONS } = require('../../utils/constants');
const { createLogger } = require('../../utils/logger');

class CustomRuleStrategy extends StrategyBase {
  /**
   * @param {object} ruleDef — CustomStrategyDef from store
   * @param {object} [configOverrides] — runtime config overrides
   */
  constructor(ruleDef, configOverrides = {}) {
    const config = {
      positionSizePercent: ruleDef.config?.positionSizePercent || '3',
      leverage: ruleDef.config?.leverage || '2',
      tpPercent: ruleDef.config?.tpPercent || '2',
      slPercent: ruleDef.config?.slPercent || '2',
      ...configOverrides,
    };

    super(`Custom_${ruleDef.id}`, config);

    this._ruleDef = ruleDef;
    this._indicatorDefs = ruleDef.indicators || [];
    this._rules = ruleDef.rules || {};
    this._log = createLogger(`Custom_${ruleDef.id}`);
  }

  /**
   * Dynamic metadata for strategyRouter compatibility.
   */
  static _buildMetadata(ruleDef) {
    return {
      name: `Custom_${ruleDef.id}`,
      description: ruleDef.description || '커스텀 전략',
      targetRegimes: ruleDef.targetRegimes || ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet'],
      riskLevel: 'medium',
      maxConcurrentPositions: 1,
      maxSymbolsPerStrategy: 3,
      cooldownMs: 60000,
      gracePeriodMs: 300000,
      warmupCandles: 30,
      volatilityPreference: 'neutral',
      trailingStop: { enabled: false },
      defaultConfig: ruleDef.config || {},
    };
  }

  getMetadata() {
    return CustomRuleStrategy._buildMetadata(this._ruleDef);
  }

  getTargetRegimes() {
    return this._ruleDef.targetRegimes || ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet'];
  }

  // ---------------------------------------------------------------------------
  // Per-symbol state
  // ---------------------------------------------------------------------------

  _createDefaultState() {
    return {
      ...super._createDefaultState(),
      prevValues: {},       // previous kline's resolved values for crosses detection
    };
  }

  // ---------------------------------------------------------------------------
  // onTick — price update; check TP/SL
  // ---------------------------------------------------------------------------

  onTick(ticker) {
    if (!this._active) return;
    if (!ticker || ticker.lastPrice === undefined) return;

    const s = this._s();
    const sym = this.getCurrentSymbol();
    const price = String(ticker.lastPrice);
    s.latestPrice = price;

    if (!s.entryPrice || !s.positionSide) return;

    const { tpPercent, slPercent, positionSizePercent } = this.config;

    // TP/SL check
    const entry = parseFloat(s.entryPrice);
    const cur = parseFloat(price);
    if (!entry || !cur) return;

    const pctChange = ((cur - entry) / entry) * 100;
    const isLong = s.positionSide === 'long';

    const effectivePct = isLong ? pctChange : -pctChange;

    if (effectivePct >= parseFloat(tpPercent)) {
      const action = isLong ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
      this.emitSignal({
        action,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        reduceOnly: true,
        confidence: '0.9500',
        marketContext: { reason: 'take_profit', entryPrice: s.entryPrice, currentPrice: price },
      });
      this._resetPos();
      return;
    }

    if (effectivePct <= -parseFloat(slPercent)) {
      const action = isLong ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT;
      this.emitSignal({
        action,
        symbol: sym,
        category: this._category,
        suggestedQty: positionSizePercent,
        suggestedPrice: price,
        reduceOnly: true,
        confidence: '0.9500',
        marketContext: { reason: 'stop_loss', entryPrice: s.entryPrice, currentPrice: price },
      });
      this._resetPos();
    }
  }

  // ---------------------------------------------------------------------------
  // onKline — main rule evaluation
  // ---------------------------------------------------------------------------

  onKline(kline) {
    if (!this._active) return;
    if (!kline || kline.close === undefined) return;

    const sym = this.getCurrentSymbol();
    const s = this._s();
    const c = this._indicatorCache;
    if (!c) return;

    const close = String(kline.close);
    const open = kline.open !== undefined ? String(kline.open) : close;
    const high = kline.high !== undefined ? String(kline.high) : close;
    const low = kline.low !== undefined ? String(kline.low) : close;
    s.latestPrice = close;

    // 1. Resolve all indicator values
    const values = { close, open, high, low };
    for (const def of this._indicatorDefs) {
      const val = this._getIndicatorValue(c, sym, def);
      if (val === null) return; // insufficient data

      if (typeof val === 'object' && val !== null) {
        // MACD, BB, Stochastic, Keltner → expand sub-fields
        for (const [subKey, subVal] of Object.entries(val)) {
          values[`${def.id}.${subKey}`] = subVal;
        }
        values[def.id] = val;
      } else {
        values[def.id] = val;
      }
    }

    const prevValues = s.prevValues || {};
    const { positionSizePercent } = this.config;

    // 2. Check exit rules if in position
    if (s.entryPrice && s.positionSide) {
      if (s.positionSide === 'long' && this._rules.exitLong) {
        if (this._evaluateRuleGroup(this._rules.exitLong, values, prevValues)) {
          this.emitSignal({
            action: SIGNAL_ACTIONS.CLOSE_LONG,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: '0.8500',
            marketContext: { reason: 'rule_exit', rule: 'exitLong' },
          });
          this._resetPos();
        }
      } else if (s.positionSide === 'short' && this._rules.exitShort) {
        if (this._evaluateRuleGroup(this._rules.exitShort, values, prevValues)) {
          this.emitSignal({
            action: SIGNAL_ACTIONS.CLOSE_SHORT,
            symbol: sym,
            category: this._category,
            suggestedQty: positionSizePercent,
            suggestedPrice: close,
            reduceOnly: true,
            confidence: '0.8500',
            marketContext: { reason: 'rule_exit', rule: 'exitShort' },
          });
          this._resetPos();
        }
      }
    }

    // 3. Check entry rules if no position
    if (!s.entryPrice && !s.positionSide) {
      if (this._rules.entryLong && this._evaluateRuleGroup(this._rules.entryLong, values, prevValues)) {
        s.entryPrice = close;
        s.positionSide = 'long';
        this.emitSignal({
          action: SIGNAL_ACTIONS.OPEN_LONG,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence: '0.8000',
          marketContext: { reason: 'rule_entry', rule: 'entryLong' },
        });
      } else if (this._rules.entryShort && this._evaluateRuleGroup(this._rules.entryShort, values, prevValues)) {
        s.entryPrice = close;
        s.positionSide = 'short';
        this.emitSignal({
          action: SIGNAL_ACTIONS.OPEN_SHORT,
          symbol: sym,
          category: this._category,
          suggestedQty: positionSizePercent,
          suggestedPrice: close,
          confidence: '0.8000',
          marketContext: { reason: 'rule_entry', rule: 'entryShort' },
        });
      }
    }

    // 4. Save current values as prevValues for next kline
    s.prevValues = { ...values };
  }

  getSignal() {
    const s = this._s();
    return s.lastSignal || null;
  }

  // ---------------------------------------------------------------------------
  // Rule evaluation
  // ---------------------------------------------------------------------------

  /**
   * @param {object} group — { operator: 'AND'|'OR', conditions: [...] }
   * @param {object} values — current resolved values
   * @param {object} prevValues — previous kline's resolved values
   * @returns {boolean}
   */
  _evaluateRuleGroup(group, values, prevValues) {
    if (!group || !Array.isArray(group.conditions) || group.conditions.length === 0) {
      return false;
    }

    const op = group.operator || 'AND';

    if (op === 'AND') {
      return group.conditions.every((cond) => this._evaluateCondition(cond, values, prevValues));
    }
    // OR
    return group.conditions.some((cond) => this._evaluateCondition(cond, values, prevValues));
  }

  /**
   * @param {object} cond — { left, comparison, right }
   * @param {object} values
   * @param {object} prevValues
   * @returns {boolean}
   */
  _evaluateCondition(cond, values, prevValues) {
    const leftVal = this._resolveValue(cond.left, values);
    const rightVal = this._resolveValue(cond.right, values);

    if (leftVal === null || leftVal === undefined || rightVal === null || rightVal === undefined) {
      return false;
    }

    const l = parseFloat(String(leftVal));
    const r = parseFloat(String(rightVal));

    if (isNaN(l) || isNaN(r)) return false;

    switch (cond.comparison) {
      case '>':  return l > r;
      case '<':  return l < r;
      case '>=': return l >= r;
      case '<=': return l <= r;
      case 'crosses_above': {
        const prevL = this._resolveValue(cond.left, prevValues);
        const prevR = this._resolveValue(cond.right, prevValues);
        if (prevL === null || prevL === undefined || prevR === null || prevR === undefined) return false;
        const pl = parseFloat(String(prevL));
        const pr = parseFloat(String(prevR));
        if (isNaN(pl) || isNaN(pr)) return false;
        return pl <= pr && l > r;
      }
      case 'crosses_below': {
        const prevL = this._resolveValue(cond.left, prevValues);
        const prevR = this._resolveValue(cond.right, prevValues);
        if (prevL === null || prevL === undefined || prevR === null || prevR === undefined) return false;
        const pl = parseFloat(String(prevL));
        const pr = parseFloat(String(prevR));
        if (isNaN(pl) || isNaN(pr)) return false;
        return pl >= pr && l < r;
      }
      default:
        return false;
    }
  }

  /**
   * Resolve a value reference:
   *   - 'close'/'open'/'high'/'low' → price
   *   - 'indicatorId' → cached indicator value
   *   - 'indicatorId.subfield' → MACD/BB/etc subfield
   *   - number → constant
   */
  _resolveValue(ref, values) {
    if (ref === null || ref === undefined) return null;

    // Numeric constant
    if (typeof ref === 'number') return ref;

    const str = String(ref);

    // Try as a number string
    const numVal = parseFloat(str);
    if (!isNaN(numVal) && str === String(numVal)) return numVal;

    // Dotted subfield: "macd1.macdLine"
    if (str.includes('.') && values[str] !== undefined) {
      return values[str];
    }

    // Direct lookup
    if (values[str] !== undefined) {
      const v = values[str];
      // If it's an object (e.g. raw MACD), not directly usable as number
      if (typeof v === 'object' && v !== null) return null;
      return v;
    }

    // Finally try as pure number
    if (!isNaN(numVal)) return numVal;

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _getIndicatorValue(cache, symbol, def) {
    const typeMap = {
      rsi: 'rsi',
      ema: 'ema',
      sma: 'sma',
      macd: 'macd',
      bb: 'bb',
      atr: 'atr',
      adx: 'adx',
      stochastic: 'stochastic',
      vwap: 'vwap',
      keltner: 'keltner',
    };

    const indicator = typeMap[def.type];
    if (!indicator) return null;

    return cache.get(symbol, indicator, def.params || {});
  }

  _resetPos() {
    const s = this._s();
    s.entryPrice = null;
    s.positionSide = null;
  }
}

module.exports = CustomRuleStrategy;
