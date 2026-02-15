'use strict';

/**
 * SignalFilter — Signal quality gate between strategies and OrderManager.
 *
 * Pipeline position:
 *   Strategy.emitSignal() → SignalFilter.filter() → OrderManager.submitOrder()
 *
 * Filters applied:
 *   1. Cooldown — enforces minimum time between signals per strategy
 *   2. Duplicate — blocks identical (strategy + symbol + action) within window
 *   3. Max concurrent positions — per strategy limit
 *   4. Same-symbol conflict — prevents opposing signals on same symbol
 *
 * Emits:
 *   - 'signal:passed'   { signal }
 *   - 'signal:blocked'  { signal, reason }
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { isLessThan } = require('../utils/mathUtils');

const log = createLogger('SignalFilter');

/** Default cooldown if strategy metadata doesn't specify */
const DEFAULT_COOLDOWN_MS = 60000;

/** Window for duplicate detection */
const DUPLICATE_WINDOW_MS = 5000;

/** Default max concurrent positions per strategy */
const DEFAULT_MAX_CONCURRENT = 2;

class SignalFilter extends EventEmitter {
  constructor() {
    super();

    /**
     * Last signal timestamp per strategy.
     * @type {Map<string, number>}
     */
    this._lastSignalTime = new Map();

    /**
     * Recent signal fingerprints for duplicate detection.
     * Each entry: { fingerprint, timestamp }
     * @type {Array<{ fingerprint: string, ts: number }>}
     */
    this._recentSignals = [];

    /**
     * Current open position count per strategy.
     * Must be updated externally via updatePositionCount().
     * @type {Map<string, number>}
     */
    this._positionCounts = new Map();

    /**
     * Active signal tracking per symbol — tracks which strategies have
     * open signals on which symbols to prevent conflicts.
     * Key: symbol, Value: Set of "strategy:action" entries
     * @type {Map<string, Set<string>>}
     */
    this._activeSignals = new Map();

    /**
     * Strategy metadata cache (cooldownMs, maxConcurrentPositions).
     * @type {Map<string, { cooldownMs: number, maxConcurrentPositions: number }>}
     */
    this._strategyMeta = new Map();

    /** Total signals processed */
    this._stats = { total: 0, passed: 0, blocked: 0 };

    log.info('SignalFilter initialised');
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Register strategy metadata for filtering. Called during bot startup.
   * @param {string} name — strategy name
   * @param {object} meta — { cooldownMs, maxConcurrentPositions }
   */
  registerStrategy(name, meta = {}) {
    this._strategyMeta.set(name, {
      cooldownMs: meta.cooldownMs || DEFAULT_COOLDOWN_MS,
      maxConcurrentPositions: meta.maxConcurrentPositions || DEFAULT_MAX_CONCURRENT,
      minConfidence: meta.minConfidence || this._getDefaultMinConfidence(meta.riskLevel),
    });
  }

  /**
   * Update position count for a strategy (called when positions change).
   * @param {string} strategy
   * @param {number} count
   */
  updatePositionCount(strategy, count) {
    this._positionCounts.set(strategy, count);
  }

  // =========================================================================
  // Core filter
  // =========================================================================

  /**
   * Filter a signal through all checks.
   *
   * @param {object} signal — { strategy, symbol, action, ... }
   * @returns {{ passed: boolean, reason: string|null }}
   */
  filter(signal) {
    this._stats.total++;

    const { strategy, symbol, action } = signal;
    const now = Date.now();

    // Clean up stale entries periodically
    this._cleanup(now);

    // --- Filter 1: Cooldown ---
    const cooldownResult = this._checkCooldown(strategy, now);
    if (!cooldownResult.passed) {
      this._block(signal, cooldownResult.reason);
      return cooldownResult;
    }

    // --- Filter 2: Duplicate detection ---
    const dupeResult = this._checkDuplicate(strategy, symbol, action, now);
    if (!dupeResult.passed) {
      this._block(signal, dupeResult.reason);
      return dupeResult;
    }

    // --- Filter 3: Max concurrent positions ---
    const concurrentResult = this._checkMaxConcurrent(strategy, action);
    if (!concurrentResult.passed) {
      this._block(signal, concurrentResult.reason);
      return concurrentResult;
    }

    // --- Filter 4: Same-symbol conflict ---
    const conflictResult = this._checkSymbolConflict(strategy, symbol, action);
    if (!conflictResult.passed) {
      this._block(signal, conflictResult.reason);
      return conflictResult;
    }

    // --- Filter 5: Confidence threshold (T2-2) ---
    const confidenceResult = this._checkConfidence(strategy, signal.confidence);
    if (!confidenceResult.passed) {
      this._block(signal, confidenceResult.reason);
      return confidenceResult;
    }

    // All checks passed
    this._pass(signal, strategy, symbol, action, now);
    return { passed: true, reason: null };
  }

  // =========================================================================
  // Individual filter checks
  // =========================================================================

  /**
   * Check cooldown — minimum time between signals per strategy.
   * @private
   */
  _checkCooldown(strategy, now) {
    const meta = this._strategyMeta.get(strategy);
    const cooldownMs = meta ? meta.cooldownMs : DEFAULT_COOLDOWN_MS;
    const lastTime = this._lastSignalTime.get(strategy) || 0;
    const elapsed = now - lastTime;

    if (elapsed < cooldownMs) {
      const remainingMs = cooldownMs - elapsed;
      return {
        passed: false,
        reason: `cooldown: ${strategy} must wait ${Math.ceil(remainingMs / 1000)}s (${cooldownMs}ms cooldown)`,
      };
    }

    return { passed: true, reason: null };
  }

  /**
   * Check for duplicate signals — same strategy+symbol+action within window.
   * @private
   */
  _checkDuplicate(strategy, symbol, action, now) {
    const fingerprint = `${strategy}:${symbol}:${action}`;
    const cutoff = now - DUPLICATE_WINDOW_MS;

    const isDupe = this._recentSignals.some(
      (entry) => entry.fingerprint === fingerprint && entry.ts > cutoff
    );

    if (isDupe) {
      return {
        passed: false,
        reason: `duplicate: ${fingerprint} within ${DUPLICATE_WINDOW_MS}ms window`,
      };
    }

    return { passed: true, reason: null };
  }

  /**
   * Check max concurrent positions per strategy.
   * Only applies to OPEN signals (close signals always pass).
   * @private
   */
  _checkMaxConcurrent(strategy, action) {
    // Close signals always pass
    if (action.startsWith('close_')) {
      return { passed: true, reason: null };
    }

    const meta = this._strategyMeta.get(strategy);
    const maxConcurrent = meta ? meta.maxConcurrentPositions : DEFAULT_MAX_CONCURRENT;
    const currentCount = this._positionCounts.get(strategy) || 0;

    if (currentCount >= maxConcurrent) {
      return {
        passed: false,
        reason: `max_concurrent: ${strategy} has ${currentCount}/${maxConcurrent} positions`,
      };
    }

    return { passed: true, reason: null };
  }

  /**
   * Check for conflicting signals on the same symbol.
   * Prevents: two different strategies opening opposing positions on the same symbol.
   * @private
   */
  _checkSymbolConflict(strategy, symbol, action) {
    // Close signals always pass
    if (action.startsWith('close_')) {
      return { passed: true, reason: null };
    }

    const activeSet = this._activeSignals.get(symbol);
    if (!activeSet || activeSet.size === 0) {
      return { passed: true, reason: null };
    }

    // Determine the "opposite" direction
    const isLong = action === 'open_long';
    const oppositeAction = isLong ? 'open_short' : 'open_long';

    // Check if any OTHER strategy has an active opposite signal on this symbol
    for (const entry of activeSet) {
      const [otherStrategy, otherAction] = entry.split(':');
      if (otherStrategy !== strategy && otherAction === oppositeAction) {
        return {
          passed: false,
          reason: `conflict: ${symbol} has opposing ${otherAction} from ${otherStrategy}`,
        };
      }
    }

    return { passed: true, reason: null };
  }

  /**
   * Return a default minimum confidence threshold based on risk level.
   * @param {string|undefined} riskLevel
   * @returns {string}
   * @private
   */
  _getDefaultMinConfidence(riskLevel) {
    switch (riskLevel) {
      case 'low': return '0.50';
      case 'high': return '0.60';
      case 'medium':
      default: return '0.55';
    }
  }

  /**
   * Check signal confidence against strategy's minimum threshold.
   * Signals without confidence values pass through (backward compatible).
   * @param {string} strategy
   * @param {string|number|undefined} confidence
   * @returns {{ passed: boolean, reason: string|null }}
   * @private
   */
  _checkConfidence(strategy, confidence) {
    const meta = this._strategyMeta.get(strategy);
    const minConfidence = meta ? (meta.minConfidence || '0.55') : '0.55';

    if (confidence === undefined || confidence === null) {
      return { passed: true, reason: null };
    }

    const confStr = String(confidence);
    if (isLessThan(confStr, minConfidence)) {
      return {
        passed: false,
        reason: `low_confidence: ${strategy} confidence ${confStr} < threshold ${minConfidence}`,
      };
    }
    return { passed: true, reason: null };
  }

  // =========================================================================
  // Internal bookkeeping
  // =========================================================================

  /**
   * Record a passed signal.
   * @private
   */
  _pass(signal, strategy, symbol, action, now) {
    this._stats.passed++;

    // Update cooldown tracker
    this._lastSignalTime.set(strategy, now);

    // Add to recent signals (for duplicate detection)
    this._recentSignals.push({
      fingerprint: `${strategy}:${symbol}:${action}`,
      ts: now,
    });

    // Track active signal on symbol (for open signals only)
    if (action.startsWith('open_')) {
      if (!this._activeSignals.has(symbol)) {
        this._activeSignals.set(symbol, new Set());
      }
      this._activeSignals.get(symbol).add(`${strategy}:${action}`);
    }

    // Remove tracking on close signals
    if (action.startsWith('close_')) {
      const activeSet = this._activeSignals.get(symbol);
      if (activeSet) {
        // Remove the matching open signal
        const matchingOpen = action === 'close_long' ? 'open_long' : 'open_short';
        activeSet.delete(`${strategy}:${matchingOpen}`);
        if (activeSet.size === 0) {
          this._activeSignals.delete(symbol);
        }
      }
    }

    this.emit('signal:passed', { signal });

    log.debug('Signal passed all filters', {
      strategy,
      symbol,
      action,
    });
  }

  /**
   * Record a blocked signal.
   * @private
   */
  _block(signal, reason) {
    this._stats.blocked++;

    this.emit('signal:blocked', { signal, reason });

    log.info('Signal blocked', {
      strategy: signal.strategy,
      symbol: signal.symbol,
      action: signal.action,
      reason,
    });
  }

  /**
   * Clean up stale entries.
   * @private
   */
  _cleanup(now) {
    // Prune recentSignals older than duplicate window
    const cutoff = now - DUPLICATE_WINDOW_MS * 2;
    this._recentSignals = this._recentSignals.filter((entry) => entry.ts > cutoff);
  }

  // =========================================================================
  // Public accessors
  // =========================================================================

  /**
   * Get filter statistics.
   * @returns {{ total: number, passed: number, blocked: number, passRate: string }}
   */
  getStats() {
    const passRate = this._stats.total > 0
      ? ((this._stats.passed / this._stats.total) * 100).toFixed(1)
      : '0';

    return { ...this._stats, passRate };
  }

  /**
   * Get full filter status for diagnostics.
   * @returns {object}
   */
  getStatus() {
    const strategies = {};
    for (const [name, meta] of this._strategyMeta) {
      strategies[name] = {
        ...meta,
        lastSignalTime: this._lastSignalTime.get(name) || null,
        positionCount: this._positionCounts.get(name) || 0,
      };
    }

    return {
      stats: this.getStats(),
      strategies,
      activeSignals: Object.fromEntries(
        Array.from(this._activeSignals.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
    };
  }

  /**
   * Reset all state (e.g. on bot restart).
   */
  reset() {
    this._lastSignalTime.clear();
    this._recentSignals = [];
    this._positionCounts.clear();
    this._activeSignals.clear();
    this._stats = { total: 0, passed: 0, blocked: 0 };

    log.info('SignalFilter reset');
  }
}

module.exports = SignalFilter;
