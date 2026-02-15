'use strict';

const { EventEmitter } = require('events');
const { RISK_EVENTS, DEFAULT_RISK_PARAMS } = require('../utils/constants');
const { isLessThan } = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

const log = createLogger('CircuitBreaker');

/** Absolute cap on rapidLosses array to prevent unbounded memory growth */
const MAX_RAPID_LOSSES = 500;

/**
 * Circuit Breaker — detects consecutive losses and rapid loss clusters,
 * then triggers an automatic trading halt with a cooldown period.
 *
 * Emits:
 *  - RISK_EVENTS.CIRCUIT_BREAK  when the breaker trips
 *  - RISK_EVENTS.CIRCUIT_RESET  when cooldown expires or manual reset
 */
class CircuitBreaker extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.consecutiveLossLimit]  — losses in a row before trip
   * @param {number} [opts.cooldownMinutes]        — minutes to stay tripped
   * @param {number} [opts.rapidLossWindow]        — window in minutes for rapid-loss check
   * @param {number} [opts.rapidLossThreshold]     — losses within window to trigger trip
   */
  constructor({
    consecutiveLossLimit = DEFAULT_RISK_PARAMS.consecutiveLossLimit,
    cooldownMinutes = DEFAULT_RISK_PARAMS.cooldownMinutes,
    rapidLossWindow = 5,
    rapidLossThreshold = 3,
  } = {}) {
    super();

    this.params = {
      consecutiveLossLimit,
      cooldownMinutes,
      rapidLossWindow,
      rapidLossThreshold,
    };

    // Mutable state
    this.consecutiveLosses = 0;
    this.isTripped = false;
    this.tripTime = null;
    this.rapidLosses = []; // Array of timestamps (ms)

    log.info('CircuitBreaker initialised', { params: this.params });
  }

  /**
   * Record a completed trade and evaluate whether to trip.
   *
   * @param {object} trade
   * @param {string} trade.pnl — profit / loss as a string amount
   */
  recordTrade(trade) {
    if (isLessThan(trade.pnl, '0')) {
      // ---------- loss ----------
      this.consecutiveLosses += 1;
      const now = Date.now();
      this.rapidLosses.push(now);

      // In-place trim: remove entries outside the rapid-loss window
      const windowMs = this.params.rapidLossWindow * 60 * 1000;
      const cutoff = now - windowMs;
      while (this.rapidLosses.length > 0 && this.rapidLosses[0] < cutoff) {
        this.rapidLosses.shift();
      }

      // Absolute cap to prevent unbounded memory growth
      if (this.rapidLosses.length > MAX_RAPID_LOSSES) {
        log.warn('rapidLosses exceeded MAX_RAPID_LOSSES, forced trim', { count: this.rapidLosses.length });
        this.rapidLosses = this.rapidLosses.slice(-MAX_RAPID_LOSSES);
      }

      log.warn('Loss recorded', {
        pnl: trade.pnl,
        consecutiveLosses: this.consecutiveLosses,
      });

      // Check 1: consecutive loss limit
      if (this.consecutiveLosses >= this.params.consecutiveLossLimit) {
        this.trip(
          `consecutive_loss_limit (${this.consecutiveLosses}/${this.params.consecutiveLossLimit})`,
        );
        return;
      }

      // Check 2: rapid loss cluster (already trimmed to window above)
      if (this.rapidLosses.length >= this.params.rapidLossThreshold) {
        this.trip(
          `rapid_loss_threshold (${this.rapidLosses.length} losses in ${this.params.rapidLossWindow} min)`,
        );
      }
    } else {
      // ---------- win or break-even ----------
      this.consecutiveLosses = 0;
      log.debug('Win/break-even recorded — consecutive losses reset', {
        pnl: trade.pnl,
      });
    }
  }

  /**
   * Trip the circuit breaker.
   *
   * @param {string} reason — human-readable trip reason
   */
  trip(reason) {
    if (this.isTripped) {
      log.debug('Trip called but breaker already tripped', { reason });
      return;
    }

    this.isTripped = true;
    this.tripTime = Date.now();

    const payload = {
      reason,
      consecutiveLosses: this.consecutiveLosses,
      cooldownMinutes: this.params.cooldownMinutes,
    };

    log.warn('Circuit breaker TRIPPED', payload);
    this.emit(RISK_EVENTS.CIRCUIT_BREAK, payload);
  }

  /**
   * Check whether trading is currently allowed.
   *
   * @returns {{ allowed: boolean, reason?: string, remainingMs?: number }}
   */
  check() {
    if (!this.isTripped) {
      return { allowed: true };
    }

    const cooldownMs = this.params.cooldownMinutes * 60 * 1000;
    const elapsed = Date.now() - this.tripTime;

    if (elapsed >= cooldownMs) {
      // Cooldown expired — auto-reset
      this.reset();
      return { allowed: true };
    }

    const remainingMs = cooldownMs - elapsed;
    return {
      allowed: false,
      reason: 'circuit_breaker_active',
      remainingMs,
    };
  }

  /**
   * Manually (or automatically) reset the breaker to a clean state.
   */
  reset() {
    this.consecutiveLosses = 0;
    this.isTripped = false;
    this.tripTime = null;
    this.rapidLosses = [];

    log.info('Circuit breaker RESET');
    this.emit(RISK_EVENTS.CIRCUIT_RESET, { resetTime: Date.now() });
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
   * Return a snapshot of current state (safe to serialise).
   *
   * @returns {object}
   */
  getStatus() {
    return {
      isTripped: this.isTripped,
      tripTime: this.tripTime,
      consecutiveLosses: this.consecutiveLosses,
      rapidLossCount: this.rapidLosses.length,
      params: { ...this.params },
    };
  }
}

module.exports = CircuitBreaker;
