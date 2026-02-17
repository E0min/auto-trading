'use strict';

const { EventEmitter } = require('events');
const { RISK_EVENTS, DEFAULT_RISK_PARAMS } = require('../utils/constants');
const {
  isGreaterThan,
  pctChange,
  abs,
  multiply,
  divide,
} = require('../utils/mathUtils');
const { createLogger } = require('../utils/logger');

const log = createLogger('DrawdownMonitor');

/**
 * Drawdown Monitor — continuously tracks equity against peak and daily
 * start values.  Halts trading when maximum drawdown or daily loss limits
 * are breached.
 *
 * Emits:
 *  - RISK_EVENTS.DRAWDOWN_WARNING  when drawdown exceeds 50 % of the max limit
 *  - RISK_EVENTS.DRAWDOWN_HALT     when a limit is breached and trading halts
 */
class DrawdownMonitor extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.maxDrawdownPercent]   — max peak-to-trough drawdown %
   * @param {string} [opts.maxDailyLossPercent]  — max intra-day loss %
   */
  constructor({
    maxDrawdownPercent = DEFAULT_RISK_PARAMS.maxDrawdownPercent,
    maxDailyLossPercent = DEFAULT_RISK_PARAMS.maxDailyLossPercent,
  } = {}) {
    super();

    this.params = {
      maxDrawdownPercent,
      maxDailyLossPercent,
    };

    // Mutable state
    this.peakEquity = '0';
    this.currentEquity = '0';
    this.dailyStartEquity = '0';
    this.dailyResetTime = null;
    this.isHalted = false;
    this.haltReason = null;

    // R14-14: Debounce warning emissions (5 min minimum interval)
    this._lastWarningTime = 0;
    this._warningDebounceMs = 5 * 60 * 1000; // 5 minutes

    log.info('DrawdownMonitor initialised', { params: this.params });
  }

  /**
   * Feed a new equity snapshot into the monitor.
   *
   * @param {string} equity — current account equity (string)
   */
  updateEquity(equity) {
    this.currentEquity = equity;

    // Update high-water mark
    if (isGreaterThan(equity, this.peakEquity)) {
      this.peakEquity = equity;
      log.debug('New peak equity', { peakEquity: this.peakEquity });
    }

    // Initialise daily start equity if not yet set
    if (this.dailyStartEquity === '0') {
      this.dailyStartEquity = equity;
      this.dailyResetTime = Date.now();
    }

    // ---- Calculate drawdown from peak ----
    // pctChange returns a signed string; negative means equity dropped
    let drawdownPercent = '0';
    try {
      drawdownPercent = pctChange(this.peakEquity, equity); // e.g. "-5.2500"
    } catch (_) {
      // peakEquity is zero — cannot compute; skip checks
      return;
    }

    const absDrawdown = abs(drawdownPercent);

    // Check max drawdown breach
    if (
      isGreaterThan('0', drawdownPercent) && // drawdown is negative
      isGreaterThan(absDrawdown, this.params.maxDrawdownPercent)
    ) {
      this.halt('max_drawdown_exceeded');
      return;
    }

    // ---- Calculate daily loss ----
    let dailyPnlPercent = '0';
    try {
      dailyPnlPercent = pctChange(this.dailyStartEquity, equity);
    } catch (_) {
      // dailyStartEquity is zero — skip
    }

    const absDailyLoss = abs(dailyPnlPercent);

    // Check daily loss breach
    if (
      isGreaterThan('0', dailyPnlPercent) &&
      isGreaterThan(absDailyLoss, this.params.maxDailyLossPercent)
    ) {
      this.halt('daily_loss_exceeded');
      return;
    }

    // ---- Drawdown warning (50 % of max threshold) ----
    // R14-14: Debounce warnings to at most once per 5 minutes
    const warningThreshold = divide(this.params.maxDrawdownPercent, '2');
    if (
      isGreaterThan('0', drawdownPercent) &&
      isGreaterThan(absDrawdown, warningThreshold)
    ) {
      const now = Date.now();
      if (now - this._lastWarningTime >= this._warningDebounceMs) {
        this._lastWarningTime = now;
        const payload = {
          drawdownPercent,
          warningThreshold,
          maxDrawdownPercent: this.params.maxDrawdownPercent,
        };
        log.warn('Drawdown warning', payload);
        this.emit(RISK_EVENTS.DRAWDOWN_WARNING, payload);
      }
    }
  }

  /**
   * Check whether trading is currently allowed.
   *
   * @returns {{ allowed: boolean, reason?: string, drawdownPercent: string, dailyPnlPercent: string }}
   */
  check() {
    let drawdownPercent = '0';
    try {
      drawdownPercent = pctChange(this.peakEquity, this.currentEquity);
    } catch (_) {
      // peakEquity is zero
    }

    let dailyPnlPercent = '0';
    try {
      dailyPnlPercent = pctChange(this.dailyStartEquity, this.currentEquity);
    } catch (_) {
      // dailyStartEquity is zero
    }

    if (this.isHalted) {
      return {
        allowed: false,
        reason: this.haltReason,
        drawdownPercent,
        dailyPnlPercent,
      };
    }

    return {
      allowed: true,
      drawdownPercent,
      dailyPnlPercent,
    };
  }

  /**
   * Halt all trading due to a drawdown/daily-loss breach.
   *
   * @param {string} reason
   */
  halt(reason) {
    if (this.isHalted) {
      log.debug('Halt called but monitor already halted', { reason });
      return;
    }

    this.isHalted = true;
    this.haltReason = reason;

    const payload = {
      reason,
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      dailyStartEquity: this.dailyStartEquity,
    };

    log.error('Trading HALTED', payload);
    this.emit(RISK_EVENTS.DRAWDOWN_HALT, payload);
  }

  /**
   * Reset the daily loss tracking.  If the halt was caused by a daily loss
   * breach, trading is re-enabled.
   */
  resetDaily() {
    this.dailyStartEquity = this.currentEquity;
    this.dailyResetTime = Date.now();

    if (this.isHalted && this.haltReason === 'daily_loss_exceeded') {
      this.isHalted = false;
      this.haltReason = null;
      log.info('Daily reset — halt lifted (was daily_loss_exceeded)');
    } else {
      log.info('Daily reset', { dailyStartEquity: this.dailyStartEquity });
    }
  }

  /**
   * Full reset with a new equity baseline.
   *
   * @param {string} equity — new baseline equity (string)
   */
  resetAll(equity) {
    this.peakEquity = equity;
    this.currentEquity = equity;
    this.dailyStartEquity = equity;
    this.dailyResetTime = Date.now();
    this.isHalted = false;
    this.haltReason = null;

    log.info('Full reset', { equity });
  }

  // ---------------------------------------------------------------------------
  // R10: State persistence — loadState / getState (AD-58)
  // ---------------------------------------------------------------------------

  /**
   * Hydrate peak equity and daily start equity from a previous session.
   * Called during BotService.start() to restore drawdown tracking across restarts.
   *
   * @param {object} state
   * @param {string} [state.peakEquity]      — persisted peak equity from prior session
   * @param {string} [state.dailyStartEquity] — persisted daily start equity
   */
  loadState({ peakEquity, dailyStartEquity } = {}) {
    if (peakEquity && isGreaterThan(peakEquity, this.peakEquity)) {
      this.peakEquity = peakEquity;
    }

    if (dailyStartEquity && dailyStartEquity !== '0') {
      this.dailyStartEquity = dailyStartEquity;
    }

    log.info('DrawdownMonitor state hydrated', {
      peakEquity: this.peakEquity,
      dailyStartEquity: this.dailyStartEquity,
    });
  }

  /**
   * Return a minimal, serialisable snapshot of state for persistence.
   * Unlike getStatus(), this returns only the fields needed for cross-session
   * restoration (no computed drawdown percentages or params).
   *
   * @returns {{ peakEquity: string, dailyStartEquity: string, currentEquity: string, isHalted: boolean, haltReason: string|null }}
   */
  getState() {
    return {
      peakEquity: this.peakEquity,
      dailyStartEquity: this.dailyStartEquity,
      currentEquity: this.currentEquity,
      isHalted: this.isHalted,
      haltReason: this.haltReason,
    };
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
    let drawdownPercent = '0';
    try {
      drawdownPercent = pctChange(this.peakEquity, this.currentEquity);
    } catch (_) {
      // peakEquity is zero
    }

    let dailyPnlPercent = '0';
    try {
      dailyPnlPercent = pctChange(this.dailyStartEquity, this.currentEquity);
    } catch (_) {
      // dailyStartEquity is zero
    }

    return {
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      drawdownPercent,
      dailyStartEquity: this.dailyStartEquity,
      dailyPnlPercent,
      isHalted: this.isHalted,
      haltReason: this.haltReason,
      dailyResetTime: this.dailyResetTime,
      params: { ...this.params },
    };
  }
}

module.exports = DrawdownMonitor;
