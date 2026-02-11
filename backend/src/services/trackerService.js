'use strict';

/**
 * TrackerService — wrapper around PerformanceTracker + TradeJournal.
 *
 * Provides a thin facade for the analytics API routes.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('TrackerService');

/** @type {import('./performanceTracker')|null} */
let _performanceTracker = null;

/** @type {import('./tradeJournal')|null} */
let _tradeJournal = null;

const trackerService = {
  /**
   * Initialize with dependency references.
   *
   * @param {object} deps
   * @param {import('./performanceTracker')} deps.performanceTracker
   * @param {import('./tradeJournal')}       deps.tradeJournal
   */
  init({ performanceTracker, tradeJournal }) {
    if (!performanceTracker) throw new Error('trackerService.init: performanceTracker is required');
    if (!tradeJournal) throw new Error('trackerService.init: tradeJournal is required');

    _performanceTracker = performanceTracker;
    _tradeJournal = tradeJournal;

    log.info('TrackerService initialised');
  },

  /**
   * Get aggregated session statistics.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getSessionStats(sessionId) {
    if (!_performanceTracker) throw new Error('trackerService not initialised — call init() first');
    return _performanceTracker.getSessionStats(sessionId);
  },

  /**
   * Get the equity curve for a session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getEquityCurve(sessionId) {
    if (!_performanceTracker) throw new Error('trackerService not initialised — call init() first');
    return _performanceTracker.getEquityCurve(sessionId);
  },

  /**
   * Get daily breakdown statistics for a session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getDailyStats(sessionId) {
    if (!_performanceTracker) throw new Error('trackerService not initialised — call init() first');
    return _performanceTracker.getDailyStats(sessionId);
  },

  /**
   * Get statistics grouped by strategy for a session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getByStrategy(sessionId) {
    if (!_performanceTracker) throw new Error('trackerService not initialised — call init() first');
    return _performanceTracker.getByStrategy(sessionId);
  },

  /**
   * Get statistics grouped by symbol for a session.
   *
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getBySymbol(sessionId) {
    if (!_performanceTracker) throw new Error('trackerService not initialised — call init() first');
    return _performanceTracker.getBySymbol(sessionId);
  },
};

module.exports = trackerService;
