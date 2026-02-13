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

      if (shouldBeActive && !strategy.isActive()) {
        // Activate — strategy fits current regime
        for (const symbol of this._symbols) {
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
      } else if (!shouldBeActive && strategy.isActive()) {
        // Deactivate — strategy doesn't fit current regime
        strategy.deactivate();
        deactivated.push(strategy.name);

        this.emit('strategy:deactivated', {
          name: strategy.name,
          regime,
          reason: 'regime_mismatch',
        });

        log.info('Strategy deactivated', {
          name: strategy.name,
          regime,
          targetRegimes,
        });
      } else if (shouldBeActive && strategy.isActive()) {
        // Already active — just update regime
        strategy.setMarketRegime(regime);
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
      strategies: this._strategies.map((s) => ({
        name: s.name,
        active: s.isActive(),
        targetRegimes: s.getTargetRegimes(),
        matchesCurrentRegime: s.getTargetRegimes().includes(this._currentRegime),
      })),
      activeCount: this.getActiveStrategies().length,
      totalCount: this._strategies.length,
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
    for (const strategy of this.getActiveStrategies()) {
      strategy.deactivate();
      for (const symbol of symbols) {
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
