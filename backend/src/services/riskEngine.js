'use strict';

const { EventEmitter } = require('events');
const { RISK_EVENTS, DEFAULT_RISK_PARAMS } = require('../utils/constants');
const { createLogger } = require('../utils/logger');
const CircuitBreaker = require('./circuitBreaker');
const ExposureGuard = require('./exposureGuard');
const DrawdownMonitor = require('./drawdownMonitor');

const log = createLogger('RiskEngine');

/**
 * Central Risk Engine — the single gateway through which every order MUST
 * pass before it reaches the exchange adapter.
 *
 * Aggregates three sub-engines:
 *  1. CircuitBreaker  – consecutive / rapid loss detection
 *  2. DrawdownMonitor – peak-drawdown & daily loss tracking
 *  3. ExposureGuard   – position-size & total-exposure limits
 *
 * All RISK_EVENTS emitted by sub-engines are re-emitted on this instance
 * so consumers only need to listen to a single EventEmitter.
 *
 * Emits (directly):
 *  - RISK_EVENTS.ORDER_VALIDATED
 *  - RISK_EVENTS.ORDER_REJECTED
 */
class RiskEngine extends EventEmitter {
  constructor() {
    super();

    // ---- Instantiate sub-engines with shared defaults ----
    this.circuitBreaker = new CircuitBreaker({
      consecutiveLossLimit: DEFAULT_RISK_PARAMS.consecutiveLossLimit,
      cooldownMinutes: DEFAULT_RISK_PARAMS.cooldownMinutes,
    });

    this.exposureGuard = new ExposureGuard({
      maxPositionSizePercent: DEFAULT_RISK_PARAMS.maxPositionSizePercent,
      maxTotalExposurePercent: DEFAULT_RISK_PARAMS.maxTotalExposurePercent,
    });

    this.drawdownMonitor = new DrawdownMonitor({
      maxDrawdownPercent: DEFAULT_RISK_PARAMS.maxDrawdownPercent,
      maxDailyLossPercent: DEFAULT_RISK_PARAMS.maxDailyLossPercent,
    });

    // ---- Internal account state ----
    this.accountState = {
      equity: '0',
      positions: [],
    };

    // ---- Forward sub-engine events ----
    this._forwardEvents(this.circuitBreaker, [
      RISK_EVENTS.CIRCUIT_BREAK,
      RISK_EVENTS.CIRCUIT_RESET,
    ]);
    this._forwardEvents(this.drawdownMonitor, [
      RISK_EVENTS.DRAWDOWN_WARNING,
      RISK_EVENTS.DRAWDOWN_HALT,
    ]);
    this._forwardEvents(this.exposureGuard, [
      RISK_EVENTS.EXPOSURE_ADJUSTED,
    ]);

    log.info('RiskEngine initialised');
  }

  /**
   * Re-emit specified events from a source emitter on this instance.
   *
   * @param {EventEmitter} source
   * @param {string[]} events
   * @private
   */
  _forwardEvents(source, events) {
    for (const event of events) {
      source.on(event, (payload) => {
        this.emit(event, payload);
      });
    }
  }

  /**
   * Validate an order through the full risk chain.
   * Order of checks matters:
   *   1. Circuit Breaker (hard halt)
   *   2. Drawdown Monitor (hard halt)
   *   3. Exposure Guard   (may adjust qty or reject)
   *
   * @param {object} order — { symbol, side, qty, price, category }
   * @returns {{ approved: boolean, adjustedQty?: string, rejectReason?: string }}
   */
  validateOrder(order) {
    // ---- Step 0: Equity guard (T0-6 defense-in-depth) ----
    if (!this.accountState.equity || this.accountState.equity === '0') {
      const result = { approved: false, rejectReason: 'equity_not_initialized' };
      log.warn('Order REJECTED — equity not initialised', { symbol: order.symbol });
      this.emit(RISK_EVENTS.ORDER_REJECTED, {
        order,
        reason: 'equity_not_initialized',
        source: 'risk_engine',
      });
      return result;
    }

    // ---- Step 1: Circuit Breaker ----
    const cbResult = this.circuitBreaker.check();
    if (!cbResult.allowed) {
      const result = { approved: false, rejectReason: cbResult.reason };
      log.warn('Order REJECTED by CircuitBreaker', {
        symbol: order.symbol,
        reason: cbResult.reason,
        remainingMs: cbResult.remainingMs,
      });
      this.emit(RISK_EVENTS.ORDER_REJECTED, {
        order,
        reason: cbResult.reason,
        source: 'circuit_breaker',
      });
      return result;
    }

    // ---- Step 2: Drawdown Monitor ----
    const ddResult = this.drawdownMonitor.check();
    if (!ddResult.allowed) {
      const result = { approved: false, rejectReason: ddResult.reason };
      log.warn('Order REJECTED by DrawdownMonitor', {
        symbol: order.symbol,
        reason: ddResult.reason,
        drawdownPercent: ddResult.drawdownPercent,
        dailyPnlPercent: ddResult.dailyPnlPercent,
      });
      this.emit(RISK_EVENTS.ORDER_REJECTED, {
        order,
        reason: ddResult.reason,
        source: 'drawdown_monitor',
      });
      return result;
    }

    // ---- Step 3: Exposure Guard ----
    const egResult = this.exposureGuard.validateOrder(order, this.accountState);
    if (!egResult.approved) {
      const result = { approved: false, rejectReason: egResult.reason };
      log.warn('Order REJECTED by ExposureGuard', {
        symbol: order.symbol,
        reason: egResult.reason,
      });
      this.emit(RISK_EVENTS.ORDER_REJECTED, {
        order,
        reason: egResult.reason,
        source: 'exposure_guard',
      });
      return result;
    }

    // ---- All checks passed ----
    const result = { approved: true };
    if (egResult.adjustedQty) {
      result.adjustedQty = egResult.adjustedQty;
    }

    log.info('Order VALIDATED', {
      symbol: order.symbol,
      adjustedQty: result.adjustedQty || null,
    });
    this.emit(RISK_EVENTS.ORDER_VALIDATED, {
      order,
      adjustedQty: result.adjustedQty || null,
    });

    return result;
  }

  /**
   * Record a completed trade (for circuit breaker loss tracking).
   *
   * @param {object} trade — must include at least { pnl: string }
   */
  recordTrade(trade) {
    this.circuitBreaker.recordTrade(trade);
  }

  /**
   * Update the internal account state used by exposure checks and
   * drawdown monitoring.
   *
   * @param {object} state
   * @param {string} state.equity
   * @param {Array}  state.positions
   */
  updateAccountState({ equity, positions }) {
    if (equity !== undefined) {
      this.accountState.equity = equity;
      this.drawdownMonitor.updateEquity(equity);
    }
    if (positions !== undefined) {
      this.accountState.positions = positions;
    }
  }

  /**
   * Hot-update parameters, routing each param to the appropriate sub-engine.
   *
   * @param {object} newParams — key/value map of param names to new values
   */
  updateParams(newParams) {
    const cbParams = {};
    const egParams = {};
    const ddParams = {};

    for (const [key, value] of Object.entries(newParams)) {
      switch (key) {
        case 'consecutiveLossLimit':
        case 'cooldownMinutes':
        case 'rapidLossWindow':
        case 'rapidLossThreshold':
          cbParams[key] = value;
          break;
        case 'maxPositionSizePercent':
        case 'maxTotalExposurePercent':
          egParams[key] = value;
          break;
        case 'maxDrawdownPercent':
        case 'maxDailyLossPercent':
          ddParams[key] = value;
          break;
        default:
          log.warn('Unknown risk param ignored', { key, value });
      }
    }

    if (Object.keys(cbParams).length > 0) {
      this.circuitBreaker.updateParams(cbParams);
    }
    if (Object.keys(egParams).length > 0) {
      this.exposureGuard.updateParams(egParams);
    }
    if (Object.keys(ddParams).length > 0) {
      this.drawdownMonitor.updateParams(ddParams);
    }
  }

  /**
   * Reset the daily loss baseline (typically called at 00:00 UTC).
   */
  resetDaily() {
    this.drawdownMonitor.resetDaily();
  }

  /**
   * Full reset of drawdown tracking with a new equity baseline.
   * Lifts any drawdown-related halt and resets peak/daily values.
   *
   * @param {string} [equity] — new equity baseline; defaults to current accountState.equity
   */
  resetDrawdown(equity) {
    const resetEquity = equity || this.accountState.equity;
    this.drawdownMonitor.resetAll(resetEquity);

    log.warn('Drawdown monitor manually reset', { equity: resetEquity });
    this.emit(RISK_EVENTS.DRAWDOWN_RESET, {
      equity: resetEquity,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Return a combined status snapshot from all sub-engines.
   *
   * @returns {object}
   */
  getStatus() {
    return {
      circuitBreaker: this.circuitBreaker.getStatus(),
      exposureGuard: this.exposureGuard.getStatus(),
      drawdownMonitor: this.drawdownMonitor.getStatus(),
      accountState: {
        equity: this.accountState.equity,
        positionCount: this.accountState.positions.length,
      },
    };
  }

  /**
   * Emergency stop — immediately trip the circuit breaker and halt the
   * drawdown monitor regardless of current state.
   */
  emergencyStop() {
    log.error('EMERGENCY STOP triggered');
    this.circuitBreaker.trip('emergency_stop');
    this.drawdownMonitor.halt('emergency_stop');
  }
}

module.exports = RiskEngine;
