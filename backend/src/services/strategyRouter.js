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

    /** @type {Map<string, string>} Per-symbol scores from CoinSelector (AD-55) */
    this._symbolScores = new Map();

    /** @type {Map<string, string[]>} Strategy name → assigned symbols (multi-symbol) */
    this._strategySymbolMap = new Map();

    /** @type {boolean} Guard flag — blocks signal emission during symbol reassignment (AD-55) */
    this._symbolUpdateInProgress = false;

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
          // Activate — strategy fits current regime (multi-symbol)
          const symbols = this._strategySymbolMap.get(strategy.name) || [this._symbols[0]].filter(Boolean);
          if (symbols.length > 0) {
            // Activate with first symbol, then addSymbol for the rest
            strategy.activate(symbols[0], this._category);
            for (let i = 1; i < symbols.length; i++) {
              strategy.addSymbol(symbols[i]);
            }
          }
          strategy.setMarketRegime(regime);
          activated.push(strategy.name);

          this.emit('strategy:activated', { name: strategy.name, regime, symbols });

          log.info('Strategy activated', {
            name: strategy.name,
            regime,
            symbols,
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
  // Symbol Assignment (AD-55, R8-T2-1)
  // =========================================================================

  /**
   * Assign each strategy a single symbol based on volatilityPreference
   * and CoinSelector scores.
   *
   * Rules:
   *   - 'high' preference → top-scored symbol (highest volatility score)
   *   - 'low'  preference → bottom-scored symbol (lowest volatility score)
   *   - 'neutral'         → round-robin across available symbols
   *   - maxStrategiesPerSymbol = max(3, ceil(strategies / symbols))
   *   - Strategies with open positions keep their existing symbol assignment
   *
   * @param {string[]} symbols — selected symbols
   * @param {Array<{ symbol: string, score: string }>} scores — scored coins from CoinSelector
   * @param {Function} [hasOpenPosition] — callback(strategyName) → boolean
   */
  assignSymbols(symbols, scores, hasOpenPosition) {
    if (!symbols || symbols.length === 0) {
      log.warn('assignSymbols — no symbols provided');
      return;
    }

    this._symbolUpdateInProgress = true;

    try {
      // Build symbol → score map (descending order preserved)
      this._symbolScores.clear();
      for (const entry of scores) {
        this._symbolScores.set(entry.symbol, entry.score);
      }

      // Sort symbols by score descending
      const sortedDesc = [...symbols].sort((a, b) => {
        const sa = parseFloat(this._symbolScores.get(a) || '0');
        const sb = parseFloat(this._symbolScores.get(b) || '0');
        return sb - sa;
      });

      // Sort symbols by score ascending (for 'low' preference)
      const sortedAsc = [...sortedDesc].reverse();

      // maxStrategiesPerSymbol: how many strategies can share one symbol
      const maxPerSymbol = Math.max(3, Math.ceil((this._strategies.length * 3) / symbols.length));

      // Track assignments per symbol
      const assignmentCounts = new Map();
      for (const sym of symbols) {
        assignmentCounts.set(sym, 0);
      }

      // newMap: strategy name → string[] (multiple symbols)
      const newMap = new Map();

      // Phase 1: Preserve existing symbols for strategies with open positions
      for (const strategy of this._strategies) {
        const currentSymbols = this._strategySymbolMap.get(strategy.name) || [];
        if (currentSymbols.length > 0 && hasOpenPosition && hasOpenPosition(strategy.name)) {
          const preserved = currentSymbols.filter(s => symbols.includes(s));
          if (preserved.length > 0) {
            newMap.set(strategy.name, [...preserved]);
            for (const sym of preserved) {
              assignmentCounts.set(sym, (assignmentCounts.get(sym) || 0) + 1);
            }
            log.debug('assignSymbols — preserved mapping (open position)', {
              strategy: strategy.name, symbols: preserved,
            });
          }
        }
      }

      // Phase 2: Assign multiple symbols per strategy by volatilityPreference
      let neutralIdx = 0;

      for (const strategy of this._strategies) {
        const meta = strategy.getMetadata();
        const maxSymbols = meta.maxSymbolsPerStrategy || 3;
        const pref = meta.volatilityPreference || 'neutral';

        // Get already-preserved symbols for this strategy
        const existing = newMap.get(strategy.name) || [];
        const needed = maxSymbols - existing.length;
        if (needed <= 0) continue;

        const assigned = [...existing];
        const assignedSet = new Set(assigned);

        // Pick symbol list based on preference
        let candidateList;
        if (pref === 'high') {
          candidateList = sortedDesc;
        } else if (pref === 'low') {
          candidateList = sortedAsc;
        } else {
          // Round-robin: build a rotated list
          candidateList = [];
          for (let i = 0; i < symbols.length; i++) {
            candidateList.push(symbols[(neutralIdx + i) % symbols.length]);
          }
        }

        for (const sym of candidateList) {
          if (assigned.length >= maxSymbols) break;
          if (assignedSet.has(sym)) continue;
          if ((assignmentCounts.get(sym) || 0) >= maxPerSymbol) continue;

          assigned.push(sym);
          assignedSet.add(sym);
          assignmentCounts.set(sym, (assignmentCounts.get(sym) || 0) + 1);
        }

        // Fallback: if no symbols were assigned, force-assign the first one
        if (assigned.length === 0) {
          const fallback = symbols[0];
          assigned.push(fallback);
          assignmentCounts.set(fallback, (assignmentCounts.get(fallback) || 0) + 1);
          log.warn('assignSymbols — forced fallback', { strategy: strategy.name, symbol: fallback });
        }

        newMap.set(strategy.name, assigned);

        // Advance round-robin pointer for neutral strategies
        if (pref === 'neutral') {
          neutralIdx = (neutralIdx + assigned.length) % symbols.length;
        }
      }

      this._strategySymbolMap = newMap;

      log.info('assignSymbols — multi-symbol assignment complete', {
        maxPerSymbol,
        assignments: Object.fromEntries(
          Array.from(newMap.entries()).map(([k, v]) => [k, v.join(',')])
        ),
        counts: Object.fromEntries(assignmentCounts),
      });

      // Re-activate already-active strategies on their new assigned symbols
      for (const strategy of this.getActiveStrategies()) {
        const assignedSymbols = this._strategySymbolMap.get(strategy.name) || [];
        const currentSymbols = strategy.getSymbols();
        const currentSet = new Set(currentSymbols);
        const newSet = new Set(assignedSymbols);

        // Check if symbol sets differ
        const sameSet = currentSet.size === newSet.size && [...currentSet].every(s => newSet.has(s));
        if (!sameSet && assignedSymbols.length > 0) {
          strategy.deactivate();
          strategy.activate(assignedSymbols[0], this._category);
          for (let i = 1; i < assignedSymbols.length; i++) {
            strategy.addSymbol(assignedSymbols[i]);
          }
          strategy.setMarketRegime(this._currentRegime);
          log.info('assignSymbols — strategy re-activated on new symbols', {
            name: strategy.name, symbols: assignedSymbols,
          });
        }
      }
    } finally {
      this._symbolUpdateInProgress = false;
    }
  }

  /**
   * Check if symbol update is in progress (signal emission guard).
   * @returns {boolean}
   */
  isSymbolUpdateInProgress() {
    return this._symbolUpdateInProgress;
  }

  /**
   * Get the primary assigned symbol for a strategy (backward compat).
   * @param {string} strategyName
   * @returns {string|null}
   */
  getAssignedSymbol(strategyName) {
    const syms = this._strategySymbolMap.get(strategyName);
    return syms && syms.length > 0 ? syms[0] : null;
  }

  /**
   * Get all assigned symbols for a strategy.
   * @param {string} strategyName
   * @returns {string[]}
   */
  getAssignedSymbols(strategyName) {
    return this._strategySymbolMap.get(strategyName) || [];
  }

  /**
   * Get all symbol assignments.
   * @returns {Object<string, string[]>}
   */
  getSymbolAssignments() {
    return Object.fromEntries(this._strategySymbolMap);
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
          assignedSymbols: this._strategySymbolMap.get(s.name) || [],
          volatilityPreference: (s.getMetadata().volatilityPreference) || 'neutral',
          targetRegimes: s.getTargetRegimes(),
          matchesCurrentRegime: s.getTargetRegimes().includes(this._currentRegime),
          graceState: graceEntry ? 'grace_period' : (s.isActive() ? 'active' : 'inactive'),
          graceExpiresAt: graceEntry ? graceEntry.expiresAt : null,
          // R9-T2: Warm-up state (per-symbol)
          warmupState: typeof s.isWarmedUp === 'function'
            ? (s.isWarmedUp() ? 'ready' : 'warming_up')
            : 'unknown',
          warmupProgress: typeof s.getWarmupProgress === 'function'
            ? s.getWarmupProgress()
            : { warmedUp: true, received: 0, required: 0 },
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
   * If assignSymbols() was called prior, uses per-strategy assignment;
   * otherwise falls back to first symbol.
   * @param {string[]} symbols
   */
  updateSymbols(symbols) {
    this._symbols = symbols;

    // Re-activate active strategies on their assigned (or fallback) symbols
    for (const strategy of this.getActiveStrategies()) {
      const assignedSymbols = this._strategySymbolMap.get(strategy.name) || [symbols[0]].filter(Boolean);
      strategy.deactivate();
      if (assignedSymbols.length > 0) {
        strategy.activate(assignedSymbols[0], this._category);
        for (let i = 1; i < assignedSymbols.length; i++) {
          strategy.addSymbol(assignedSymbols[i]);
        }
      }
      strategy.setMarketRegime(this._currentRegime);
    }

    log.info('Symbols updated — strategies re-activated', {
      symbolCount: symbols.length,
    });
  }
}

module.exports = StrategyRouter;
