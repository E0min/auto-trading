'use strict';

/**
 * TraderService — wrapper around OrderManager.
 *
 * Provides a thin facade for the trade API routes.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('TraderService');

/** @type {import('./orderManager')|null} */
let _orderManager = null;

const traderService = {
  /**
   * Initialize with dependency references.
   *
   * @param {object} deps
   * @param {import('./orderManager')} deps.orderManager
   */
  init({ orderManager }) {
    if (!orderManager) throw new Error('traderService.init: orderManager is required');

    _orderManager = orderManager;

    log.info('TraderService initialised');
  },

  /**
   * Submit a new order via the OrderManager.
   *
   * @param {object} signal — order signal parameters
   * @returns {Promise<object|null>}
   */
  async submitOrder(signal) {
    if (!_orderManager) throw new Error('traderService not initialised — call init() first');
    return _orderManager.submitOrder(signal);
  },

  /**
   * Cancel an existing order.
   *
   * @param {object} params — { symbol, orderId, clientOid, category }
   * @returns {Promise<object|null>}
   */
  async cancelOrder(params) {
    if (!_orderManager) throw new Error('traderService not initialised — call init() first');
    return _orderManager.cancelOrder(params);
  },

  /**
   * Get all open (non-terminal) trades.
   *
   * @param {string} [sessionId]
   * @returns {Promise<Array>}
   */
  async getOpenTrades(sessionId) {
    if (!_orderManager) throw new Error('traderService not initialised — call init() first');
    return _orderManager.getOpenTrades(sessionId);
  },

  /**
   * Get historical trades with optional filters.
   *
   * @param {object} [filters] — { sessionId, symbol, limit, skip }
   * @returns {Promise<Array>}
   */
  async getTradeHistory(filters) {
    if (!_orderManager) throw new Error('traderService not initialised — call init() first');
    return _orderManager.getTradeHistory(filters);
  },
};

module.exports = traderService;
