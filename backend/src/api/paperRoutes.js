'use strict';

/**
 * Paper trading routes — status, positions, and reset for the virtual account.
 *
 * Only mounted when PAPER_TRADING=true.
 */

const { createLogger } = require('../utils/logger');
const Trade = require('../models/Trade');

const log = createLogger('PaperRoutes');

/**
 * @param {object} deps
 * @param {import('../services/paperEngine')} deps.paperEngine
 * @param {import('../services/paperPositionManager')} deps.paperPositionManager
 * @returns {import('express').Router}
 */
module.exports = function createPaperRoutes({ paperEngine, paperPositionManager }) {
  const router = require('express').Router();

  // GET /api/paper/status — mode + balance + position summary
  router.get('/status', (req, res) => {
    try {
      const accountState = paperPositionManager.getAccountState();
      const positions = paperPositionManager.getPositions();
      const pendingOrders = paperEngine.getPendingOrders();

      res.json({
        success: true,
        data: {
          paperMode: true,
          account: accountState,
          positionCount: positions.length,
          pendingOrderCount: pendingOrders.length,
        },
      });
    } catch (err) {
      log.error('GET /status — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/paper/positions — current virtual positions
  router.get('/positions', (req, res) => {
    try {
      const positions = paperPositionManager.getPositions();
      res.json({ success: true, data: positions });
    } catch (err) {
      log.error('GET /positions — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/paper/orders — pending limit orders
  router.get('/orders', (req, res) => {
    try {
      const orders = paperEngine.getPendingOrders();
      res.json({ success: true, data: orders });
    } catch (err) {
      log.error('GET /orders — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/paper/reset — reset balance, positions, and optionally trades
  router.post('/reset', async (req, res) => {
    try {
      const { initialBalance, clearTrades } = req.body || {};

      // Reset position manager
      paperPositionManager.reset(initialBalance || undefined);

      // Clear pending orders in paper engine
      for (const order of paperEngine.getPendingOrders()) {
        paperEngine.cancelOrder(order.clientOid);
      }

      // Optionally clear paper trades from MongoDB
      if (clearTrades !== false) {
        const result = await Trade.deleteMany({ 'metadata.paperTrade': true });
        log.info('POST /reset — cleared paper trades', { deletedCount: result.deletedCount });
      }

      const accountState = paperPositionManager.getAccountState();

      res.json({
        success: true,
        data: {
          message: 'Paper account reset',
          account: accountState,
        },
      });
    } catch (err) {
      log.error('POST /reset — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
