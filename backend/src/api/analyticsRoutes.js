'use strict';

/**
 * Analytics routes — session stats, equity curve, daily stats, by-strategy, by-symbol.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const router = require('express').Router();
const { createLogger } = require('../utils/logger');

const log = createLogger('AnalyticsRoutes');

/**
 * @param {object} deps
 * @param {import('../services/trackerService')} deps.trackerService
 * @returns {import('express').Router}
 */
module.exports = function createAnalyticsRoutes({ trackerService }) {

  // GET /api/analytics/session/:sessionId — session stats
  router.get('/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const stats = await trackerService.getSessionStats(sessionId);
      res.json({ success: true, data: stats });
    } catch (err) {
      log.error('GET /analytics/session/:sessionId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/analytics/equity-curve/:sessionId — equity curve
  router.get('/equity-curve/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const curve = await trackerService.getEquityCurve(sessionId);
      res.json({ success: true, data: curve });
    } catch (err) {
      log.error('GET /analytics/equity-curve/:sessionId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/analytics/daily/:sessionId — daily stats
  router.get('/daily/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const daily = await trackerService.getDailyStats(sessionId);
      res.json({ success: true, data: daily });
    } catch (err) {
      log.error('GET /analytics/daily/:sessionId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/analytics/by-strategy/:sessionId — stats by strategy
  router.get('/by-strategy/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const stats = await trackerService.getByStrategy(sessionId);
      res.json({ success: true, data: stats });
    } catch (err) {
      log.error('GET /analytics/by-strategy/:sessionId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/analytics/by-symbol/:sessionId — stats by symbol
  router.get('/by-symbol/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const stats = await trackerService.getBySymbol(sessionId);
      res.json({ success: true, data: stats });
    } catch (err) {
      log.error('GET /analytics/by-symbol/:sessionId — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
