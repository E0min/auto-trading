'use strict';

/**
 * StrategyRouter — Regime-aware strategy activation controller.
 *
 * Listens to MarketRegime changes and automatically activates/deactivates
 * strategies based on their declared `targetRegimes` metadata.
 *
 * Pipeline position:
 *   MarketRegime → StrategyRouter → (active strategies only) → SignalFilter → OrderManager
 *
 * Strategies whose `targetRegimes` include the current regime are activated.
 * Strategies whose `targetRegimes` do NOT include the current regime are
 * deactivated (paused — they retain their internal state for when the regime
 * returns).
 *
 * Emits:
 *   - 'strategy:activated'   { name, regime }
 *   - 'strategy:deactivated' { name, regime, reason }
 *   - 'router:regime_switch' { previous, current, activated[], deactivated[] }
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { MARKET_EVENTS, MARKET_REGIMES } = require('../utils/constants');

const log = createLogger('StrategyRouter');

class StrategyRouter extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./marketRegime')} deps.marketRegime
   */
  constructor({ marketRegime }) {
    super();

    if (!marketRegime) throw new Error('StrategyRouter requires marketRegime');

    this._marketRegime = marketRegime;

    /** @type {Array<import('./strategyBase')>} All managed strategy instances */
    this._strategies = [];

    /** @type {string[]} Currently selected symbols */
    this._symbols = [];

    /** @type {string} Current product category */
    this._category = 'USDT-FUTURES';

    /** @type {string|null} Current regime */
    this._currentRegime = null;

    /** @type {boolean} Whether the router is active */
    this._running = false;

    /** @type {Map<string, { timer: NodeJS.Timeout, expiresAt: number }>} Grace period timers per strategy */
    this._gracePeriods = new Map();

    /** @type {number} Default grace period in ms (5 minutes) */
    this._graceMs = 300000;

    // Bound handler
    this._boundOnRegimeChange = this._onRegimeChange.bind(this);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start the router — begin listening to regime changes.
   * @param {Array<import('./strategyBase')>} strategies — all strategy instances
   * @param {string[]} symbols — currently selected symbols
   * @param {string} [category='USDT-FUTURES']
   */
  start(strategies, symbols, category = 'USDT-FUTURES') {
    this._strategies = strategies;
    this._symbols = symbols;
    this._category = category;
    this._running = true;

    // Get initial regime
    this._currentRegime = this._marketRegime.getCurrentRegime();

    // Listen for future regime changes
    this._marketRegime.on(MARKET_EVENTS.REGIME_CHANGE, this._boundOnRegimeChange);

    // Perform initial routing based on current regime
    this._routeStrategies(this._currentRegime);

    log.info('StrategyRouter started', {
      regime: this._currentRegime,
      strategyCount: strategies.length,
      symbolCount: symbols.length,
    });
  }

  /**
   * Stop the router.
   */
  stop() {
    this._running = false;

    // Clear all grace period timers (R7-B4 — cleanup on stop)
    for (const [name, entry] of this._gracePeriods) {
      clearTimeout(entry.timer);
    }
    this._gracePeriods.clear();

    this._marketRegime.removeListener(MARKET_EVENTS.REGIME_CHANGE, this._boundOnRegimeChange);
    log.info('StrategyRouter stopped');
  }

  // =========================================================================
  // Regime change handler
  // =========================================================================

  /**
   * @param {object} context — { previous, current, ... }
   * @private
   */
  _onRegimeChange(context) {
    if (!this._running) return;

    const { previous, current } = context;
    this._currentRegime = current;

    log.info('Regime changed — re-routing strategies', { previous, current });

    this._routeStrategies(current, previous);
  }

  // =========================================================================
  // Core routing logic
  // =========================================================================

  /**
   * Activate/deactivate strategies based on the given regime.
   *
   * @param {string} regime — current regime
   * @param {string} [previousRegime] — previous regime (for logging)
   * @private
   */
  _routeStrategies(regime, previousRegime) {
    const activated = [];
    const deactivated = [];

    for (const strategy of this._strategies) {
      const targetRegimes = strategy.getTargetRegimes();
      const shouldBeActive = targetRegimes.includes(regime);

      if (shouldBeActive) {
        // Cancel any pending grace period if regime came back (R7-B1)
        if (this._gracePeriods.has(strategy.name)) {
          this._cancelGracePeriod(strategy.name, 'regime_returned');
        }

        if (!strategy.isActive()) {
          // Activate — strategy fits current regime
          // T0-3 Phase 1: 1 symbol per strategy to prevent internal state contamination
          const symbol = this._symbols[0];
          if (symbol) {
            strategy.activate(symbol, this._category);
          }
          strategy.setMarketRegime(regime);
          activated.push(strategy.name);

          this.emit('strategy:activated', { name: strategy.name, regime });

          log.info('Strategy activated', {
            name: strategy.name,
            regime,
            targetRegimes,
          });
        } else {
          // Already active — just update regime
          strategy.setMarketRegime(regime);
        }
      } else if (!shouldBeActive && strategy.isActive()) {
        // Start grace period instead of immediate deactivation (R7-B1, AD-41)
        if (!this._gracePeriods.has(strategy.name)) {
          this._startGracePeriod(strategy, regime);
        }
        deactivated.push(strategy.name);
      }
    }

    this.emit('router:regime_switch', {
      previous: previousRegime || null,
      current: regime,
      activated,
      deactivated,
      activeCount: this.getActiveStrategies().length,
      totalCount: this._strategies.length,
    });

    log.info('Routing complete', {
      regime,
      activated: activated.length,
      deactivated: deactivated.length,
      active: this.getActiveStrategies().map((s) => s.name),
    });
  }

  // =========================================================================
  // Grace Period Management (R7-B1, AD-41)
  // =========================================================================

  /**
   * Start a grace period for a strategy.
   * During grace: strategy stays active but OPEN signals are blocked.
   * After grace expires: strategy is deactivated.
   *
   * @param {import('./strategyBase')} strategy
   * @param {string} regime — current regime that triggered the grace
   * @private
   */
  _startGracePeriod(strategy, regime) {
    const name = strategy.name;

    // Get grace period duration from strategy metadata or fallback (AD-42)
    const meta = strategy.getMetadata();
    const graceMs = meta.gracePeriodMs != null ? meta.gracePeriodMs : this._graceMs;

    // AdaptiveRegime has 0ms grace — deactivate immediately
    if (graceMs <= 0) {
      strategy.deactivate();
      this.emit('strategy:deactivated', { name, regime, reason: 'regime_mismatch' });
      log.info('Strategy deactivated (no grace period)', { name, regime });
      return;
    }

    const expiresAt = Date.now() + graceMs;

    const timer = setTimeout(() => {
      // Race condition guard: Map.delete FIRST, then check _running (R7-B4)
      this._gracePeriods.delete(name);

      if (!this._running) return;

      // Find strategy — it may have been removed
      const strat = this._strategies.find(s => s.name === name);
      if (!strat) return;

      // Deactivate the strategy
      strat.deactivate();

      this.emit('strategy:deactivated', {
        name,
        regime: this._currentRegime,
        reason: 'grace_period_expired',
      });

      log.info('Grace period expired — strategy deactivated', {
        name,
        graceMs,
        regime: this._currentRegime,
      });
    }, graceMs);

    // Prevent timer from keeping the process alive (R7-B1)
    if (timer.unref) timer.unref();

    this._gracePeriods.set(name, { timer, expiresAt });

    this.emit('strategy:grace_started', {
      name,
      regime,
      graceMs,
      expiresAt,
    });

    log.info('Grace period started', { name, graceMs, expiresAt: new Date(expiresAt).toISOString() });
  }

  /**
   * Cancel a grace period for a strategy (e.g., regime returned).
   * @param {string} name — strategy name
   * @param {string} reason — cancellation reason
   */
  cancelGracePeriod(name, reason = 'manual') {
    this._cancelGracePeriod(name, reason);
  }

  /**
   * @param {string} name
   * @param {string} reason
   * @private
   */
  _cancelGracePeriod(name, reason) {
    const entry = this._gracePeriods.get(name);
    if (!entry) return;

    clearTimeout(entry.timer);
    this._gracePeriods.delete(name);

    this.emit('strategy:grace_cancelled', { name, reason });

    log.info('Grace period cancelled', { name, reason });
  }

  /**
   * Get names of strategies currently in grace period.
   * @returns {string[]}
   */
  getGracePeriodStrategies() {
    return Array.from(this._gracePeriods.keys());
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  /**
   * Get all currently active strategies.
   * @returns {Array<import('./strategyBase')>}
   */
  getActiveStrategies() {
    return this._strategies.filter((s) => s.isActive());
  }

  /**
   * Get all inactive (paused) strategies.
   * @returns {Array<import('./strategyBase')>}
   */
  getInactiveStrategies() {
    return this._strategies.filter((s) => !s.isActive());
  }

  /**
   * Get routing status for diagnostics.
   * @returns {object}
   */
  getStatus() {
    return {
      running: this._running,
      currentRegime: this._currentRegime,
      strategies: this._strategies.map((s) => {
        const graceEntry = this._gracePeriods.get(s.name);
        return {
          name: s.name,
          active: s.isActive(),
          targetRegimes: s.getTargetRegimes(),
          matchesCurrentRegime: s.getTargetRegimes().includes(this._currentRegime),
          graceState: graceEntry ? 'grace_period' : (s.isActive() ? 'active' : 'inactive'),
          graceExpiresAt: graceEntry ? graceEntry.expiresAt : null,
        };
      }),
      activeCount: this.getActiveStrategies().length,
      totalCount: this._strategies.length,
      gracePeriodCount: this._gracePeriods.size,
      gracePeriods: Object.fromEntries(
        Array.from(this._gracePeriods.entries()).map(([name, entry]) => [
          name,
          { expiresAt: entry.expiresAt, remainingMs: Math.max(0, entry.expiresAt - Date.now()) },
        ])
      ),
    };
  }

  /**
   * Get a summary of which strategies are active per regime (for UI).
   * @returns {object} { regime: string, active: string[], inactive: string[] }
   */
  getRegimeBreakdown() {
    const allRegimes = Object.values(MARKET_REGIMES);
    const breakdown = {};

    for (const regime of allRegimes) {
      const active = [];
      const inactive = [];
      for (const s of this._strategies) {
        if (s.getTargetRegimes().includes(regime)) {
          active.push(s.name);
        } else {
          inactive.push(s.name);
        }
      }
      breakdown[regime] = { active, inactive };
    }

    return breakdown;
  }

  /**
   * Force re-route (e.g. after adding/removing strategies at runtime).
   */
  refresh() {
    if (this._currentRegime) {
      this._routeStrategies(this._currentRegime);
    }
  }

  /**
   * Update symbols list (e.g. after coin re-selection).
   * @param {string[]} symbols
   */
  updateSymbols(symbols) {
    this._symbols = symbols;

    // Re-activate active strategies on new symbols
    // T0-3 Phase 1: 1 symbol per strategy
    for (const strategy of this.getActiveStrategies()) {
      strategy.deactivate();
      const symbol = symbols[0];
      if (symbol) {
        strategy.activate(symbol, this._category);
      }
      strategy.setMarketRegime(this._currentRegime);
    }

    log.info('Symbols updated — strategies re-activated', {
      symbolCount: symbols.length,
    });
  }
}

module.exports = StrategyRouter;
