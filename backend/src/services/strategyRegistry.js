'use strict';

/**
 * StrategyRegistry — singleton registry for trading strategy classes.
 *
 * Strategies register themselves (name + class reference). BotService uses
 * the registry to create instances dynamically based on config, eliminating
 * the need for hard-coded switch-case blocks.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('StrategyRegistry');

class StrategyRegistry {
  constructor() {
    /** @type {Map<string, { StrategyClass: Function, metadata: object }>} */
    this._strategies = new Map();
  }

  /**
   * Register a strategy class under a given name.
   *
   * @param {string}   name           — unique strategy identifier
   * @param {Function} StrategyClass  — constructor (must extend StrategyBase)
   */
  register(name, StrategyClass) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('StrategyRegistry.register: name must be a non-empty string');
    }
    if (typeof StrategyClass !== 'function') {
      throw new TypeError('StrategyRegistry.register: StrategyClass must be a constructor');
    }

    const metadata = StrategyClass.metadata || { name, description: '' };
    this._strategies.set(name, { StrategyClass, metadata });
    log.info('Strategy registered', { name });
  }

  /**
   * Create an instance of a registered strategy.
   *
   * @param {string} name   — registered strategy name
   * @param {object} [config={}] — passed to the strategy constructor
   * @returns {import('./strategyBase')} strategy instance
   */
  create(name, config = {}) {
    const entry = this._strategies.get(name);
    if (!entry) {
      throw new Error(`StrategyRegistry.create: unknown strategy "${name}"`);
    }
    return new entry.StrategyClass(config);
  }

  /**
   * List all registered strategy names.
   * @returns {string[]}
   */
  list() {
    return Array.from(this._strategies.keys());
  }

  /**
   * Check whether a strategy name is registered.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._strategies.has(name);
  }

  /**
   * Get metadata for a registered strategy.
   *
   * @param {string} name
   * @returns {object|null} — { name, description, defaultConfig, ... }
   */
  getMetadata(name) {
    const entry = this._strategies.get(name);
    return entry ? { ...entry.metadata } : null;
  }

  /**
   * Get metadata for all registered strategies.
   * @returns {object[]}
   */
  listWithMetadata() {
    const result = [];
    for (const [name, entry] of this._strategies) {
      result.push({ name, ...entry.metadata });
    }
    return result;
  }
}

// Singleton instance
const registry = new StrategyRegistry();

module.exports = registry;
