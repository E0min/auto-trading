'use strict';

const { EventEmitter } = require('events');
const { RISK_EVENTS, DEFAULT_RISK_PARAMS } = require('../utils/constants');
const {
  multiply,
  divide,
  add,
  isGreaterThan,
  isLessThan,
  abs,
  min,
} = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

const log = createLogger('ExposureGuard');

/**
 * Exposure Guard — limits individual position size and total portfolio
 * exposure as a percentage of account equity.
 *
 * Three-tier validation:
 *  1. Risk-per-trade (2% rule) — if order includes `riskPerUnit` (e.g. ATR-based
 *     stop distance), caps qty so max loss ≤ maxRiskPerTradePercent of equity.
 *  2. Single-position size — caps order value to maxPositionSizePercent of equity.
 *  3. Total exposure — rejects if portfolio exposure would exceed limit.
 *
 * Emits:
 *  - RISK_EVENTS.EXPOSURE_ADJUSTED  when an order's quantity is reduced
 */
class ExposureGuard extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.maxPositionSizePercent]  — max single-position value as % of equity
   * @param {string} [opts.maxTotalExposurePercent] — max total exposure as % of equity
   */
  constructor({
    maxPositionSizePercent = DEFAULT_RISK_PARAMS.maxPositionSizePercent,
    maxTotalExposurePercent = DEFAULT_RISK_PARAMS.maxTotalExposurePercent,
    maxRiskPerTradePercent = DEFAULT_RISK_PARAMS.maxRiskPerTradePercent || '2',
  } = {}) {
    super();

    this.params = {
      maxPositionSizePercent,
      maxTotalExposurePercent,
      maxRiskPerTradePercent,
    };

    log.info('ExposureGuard initialised', { params: this.params });
  }

  /**
   * Validate an order against exposure limits.
   *
   * @param {object} order
   * @param {string} order.symbol
   * @param {string} order.side
   * @param {string} order.qty        — desired quantity (string)
   * @param {string} [order.price]    — limit price (string); omit for market orders
   * @param {string} [order.category]
   * @param {string} [order.riskPerUnit] — stop-loss distance per unit (e.g. ATR×2).
   *   When provided, the 2% risk-per-trade rule is applied:
   *   maxQty = (equity × maxRiskPerTradePercent / 100) / riskPerUnit
   *
   * @param {object} accountState
   * @param {string} accountState.equity            — total equity (string)
   * @param {Array}  accountState.positions          — current open positions
   * @param {string} accountState.positions[].symbol
   * @param {string} accountState.positions[].qty
   * @param {string} accountState.positions[].markPrice
   * @param {string} accountState.positions[].unrealizedPnl
   *
   * @returns {{ approved: boolean, adjustedQty?: string, reason?: string }}
   */
  validateOrder(order, accountState) {
    const equity = accountState.equity;

    // T0-6: Guard against equity=0 / null / undefined to prevent division by zero
    if (!equity || equity === '0' || equity === 0) {
      log.warn('Order rejected — equity not initialised', { symbol: order.symbol, equity });
      return { approved: false, reason: 'equity_not_initialized', adjustedQty: '0' };
    }

    const effectivePrice = order.price || '1';
    let qty = order.qty;

    // ---- 0. Risk-per-trade check (2% rule) ----
    // If the order carries riskPerUnit (ATR-based stop distance), enforce
    // that the maximum potential loss does not exceed maxRiskPerTradePercent
    // of equity. This overrides the requested qty if it's too large.
    if (order.riskPerUnit && isGreaterThan(order.riskPerUnit, '0')) {
      const maxRiskAmount = multiply(equity, divide(this.params.maxRiskPerTradePercent, '100'));
      const riskBasedMaxQty = divide(maxRiskAmount, order.riskPerUnit);

      if (isGreaterThan(qty, riskBasedMaxQty)) {
        const payload = {
          symbol: order.symbol,
          originalQty: qty,
          adjustedQty: riskBasedMaxQty,
          riskPerUnit: order.riskPerUnit,
          maxRiskAmount,
          maxRiskPerTradePercent: this.params.maxRiskPerTradePercent,
        };

        log.warn('Order quantity reduced by 2% risk-per-trade rule', payload);
        this.emit(RISK_EVENTS.EXPOSURE_ADJUSTED, payload);

        qty = riskBasedMaxQty;
      }
    }

    // ---- 1. Single-position size check ----
    const orderValue = multiply(qty, effectivePrice);
    // positionSizePercent = (orderValue / equity) * 100
    const positionSizePercent = multiply(divide(orderValue, equity), '100');

    if (isGreaterThan(positionSizePercent, this.params.maxPositionSizePercent)) {
      // Calculate the maximum allowed order value
      const maxAllowedValue = multiply(
        equity,
        divide(this.params.maxPositionSizePercent, '100'),
      );
      qty = divide(maxAllowedValue, effectivePrice);

      const payload = {
        symbol: order.symbol,
        originalQty: order.qty,
        adjustedQty: qty,
        positionSizePercent,
        maxPositionSizePercent: this.params.maxPositionSizePercent,
      };

      log.warn('Order quantity reduced to comply with position-size limit', payload);
      this.emit(RISK_EVENTS.EXPOSURE_ADJUSTED, payload);
    }

    // ---- 2. Total exposure check ----
    // Sum existing position notional values
    const finalOrderValue = multiply(qty, effectivePrice);
    let totalExistingExposure = '0';
    for (const pos of accountState.positions) {
      const posValue = abs(multiply(pos.qty, pos.markPrice));
      totalExistingExposure = add(totalExistingExposure, posValue);
    }

    const totalExposure = add(totalExistingExposure, finalOrderValue);
    const totalExposurePercent = multiply(divide(totalExposure, equity), '100');

    if (isGreaterThan(totalExposurePercent, this.params.maxTotalExposurePercent)) {
      log.warn('Order rejected — total exposure would exceed limit', {
        symbol: order.symbol,
        orderValue: finalOrderValue,
        totalExposurePercent,
        maxTotalExposurePercent: this.params.maxTotalExposurePercent,
      });

      return {
        approved: false,
        reason: 'total_exposure_exceeded',
      };
    }

    // ---- All clear ----
    const finalSizePercent = multiply(divide(finalOrderValue, equity), '100');
    log.debug('Order passed exposure checks', {
      symbol: order.symbol,
      positionSizePercent: finalSizePercent,
      totalExposurePercent,
    });

    // Return adjustedQty if any check reduced the qty
    if (qty !== order.qty) {
      return { approved: true, adjustedQty: qty, reason: 'qty_adjusted_by_risk_limits' };
    }

    return { approved: true };
  }

  /**
   * Hot-update parameters without recreating the instance.
   *
   * @param {object} newParams
   */
  updateParams(newParams) {
    const prev = { ...this.params };
    Object.assign(this.params, newParams);
    log.info('Params updated', { prev, current: this.params });
  }

  /**
   * Return a snapshot of current parameters (safe to serialise).
   *
   * @returns {object}
   */
  getStatus() {
    return {
      params: { ...this.params },
    };
  }
}

module.exports = ExposureGuard;
