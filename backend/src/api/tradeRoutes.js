'use strict';

/**
 * Trade / order routes — trade history, open trades, manual orders, positions, signals.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const router = require('express').Router();
const { createLogger } = require('../utils/logger');
const Signal = require('../models/Signal');

const log = createLogger('TradeRoutes');

/**
 * @param {object} deps
 * @param {import('../services/traderService')} deps.traderService
 * @param {import('../services/positionManager')} deps.positionManager
 * @returns {import('express').Router}
 */
module.exports = function createTradeRoutes({ traderService, positionManager }) {

  // GET /api/trades — get trade history
  router.get('/', async (req, res) => {
    try {
      const { sessionId, symbol, limit, skip } = req.query;
      const filters = {};
      if (sessionId) filters.sessionId = sessionId;
      if (symbol) filters.symbol = symbol;
      if (limit) filters.limit = parseInt(limit, 10);
      if (skip) filters.skip = parseInt(skip, 10);

      const trades = await traderService.getTradeHistory(filters);
      res.json({ success: true, data: trades });
    } catch (err) {
      log.error('GET /trades — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/trades/open — get open trades
  router.get('/open', async (req, res) => {
    try {
      const { sessionId } = req.query;
      const trades = await traderService.getOpenTrades(sessionId);
      res.json({ success: true, data: trades });
    } catch (err) {
      log.error('GET /trades/open — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/trades/order — manual order submission
  router.post('/order', async (req, res) => {
    try {
      const signal = req.body;
      if (!signal || !signal.symbol || !signal.action) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: symbol, action',
        });
      }
      const trade = await traderService.submitOrder(signal);
      res.json({ success: true, data: trade });
    } catch (err) {
      log.error('POST /trades/order — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/trades/order/:orderId — cancel order
  router.delete('/order/:orderId', async (req, res) => {
    try {
      const { orderId } = req.params;
      const { symbol, category } = req.query;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: 'Missing required query parameter: symbol',
        });
      }

      const trade = await traderService.cancelOrder({
        orderId,
        symbol,
        category: category || undefined,
      });
      res.json({ success: true, data: trade });
    } catch (err) {
      log.error('DELETE /trades/order/:orderId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/positions — get current positions
  router.get('/positions', async (req, res) => {
    try {
      const positions = positionManager.getPositions();
      const accountState = positionManager.getAccountState();
      res.json({ success: true, data: { positions, accountState } });
    } catch (err) {
      log.error('GET /positions — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/signals — get signals from DB
  router.get('/signals', async (req, res) => {
    try {
      const { sessionId, limit } = req.query;
      const query = {};
      if (sessionId) query.sessionId = sessionId;

      const maxLimit = limit ? parseInt(limit, 10) : 50;

      const signals = await Signal.find(query)
        .sort({ createdAt: -1 })
        .limit(maxLimit)
        .lean();

      res.json({ success: true, data: signals });
    } catch (err) {
      log.error('GET /signals — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
