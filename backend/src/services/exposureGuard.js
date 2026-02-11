'use strict';

const { EventEmitter } = require('events');
const { RISK_EVENTS, DEFAULT_RISK_PARAMS } = require('../utils/constants');
const {
  multiply,
  divide,
  add,
  isGreaterThan,
  abs,
} = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

const log = createLogger('ExposureGuard');

/**
 * Exposure Guard — limits individual position size and total portfolio
 * exposure as a percentage of account equity.
 *
 * If an order exceeds the single-position limit the quantity is automatically
 * reduced (approved with adjustedQty).  If total exposure would exceed the
 * portfolio-wide limit the order is outright rejected.
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
  } = {}) {
    super();

    this.params = {
      maxPositionSizePercent,
      maxTotalExposurePercent,
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
    const effectivePrice = order.price || '1';

    // ---- 1. Single-position size check ----
    const orderValue = multiply(order.qty, effectivePrice);
    // positionSizePercent = (orderValue / equity) * 100
    const positionSizePercent = multiply(divide(orderValue, equity), '100');

    if (isGreaterThan(positionSizePercent, this.params.maxPositionSizePercent)) {
      // Calculate the maximum allowed order value
      const maxAllowedValue = multiply(
        equity,
        divide(this.params.maxPositionSizePercent, '100'),
      );
      const adjustedQty = divide(maxAllowedValue, effectivePrice);

      const payload = {
        symbol: order.symbol,
        originalQty: order.qty,
        adjustedQty,
        positionSizePercent,
        maxPositionSizePercent: this.params.maxPositionSizePercent,
      };

      log.warn('Order quantity reduced to comply with position-size limit', payload);
      this.emit(RISK_EVENTS.EXPOSURE_ADJUSTED, payload);

      return {
        approved: true,
        adjustedQty,
        reason: 'qty_reduced_position_limit',
      };
    }

    // ---- 2. Total exposure check ----
    // Sum existing position notional values
    let totalExistingExposure = '0';
    for (const pos of accountState.positions) {
      const posValue = abs(multiply(pos.qty, pos.markPrice));
      totalExistingExposure = add(totalExistingExposure, posValue);
    }

    const totalExposure = add(totalExistingExposure, orderValue);
    const totalExposurePercent = multiply(divide(totalExposure, equity), '100');

    if (isGreaterThan(totalExposurePercent, this.params.maxTotalExposurePercent)) {
      log.warn('Order rejected — total exposure would exceed limit', {
        symbol: order.symbol,
        orderValue,
        totalExposurePercent,
        maxTotalExposurePercent: this.params.maxTotalExposurePercent,
      });

      return {
        approved: false,
        reason: 'total_exposure_exceeded',
      };
    }

    // ---- All clear ----
    log.debug('Order passed exposure checks', {
      symbol: order.symbol,
      positionSizePercent,
      totalExposurePercent,
    });

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
