'use strict';

/**
 * Health routes — comprehensive health check and simple ping.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('HealthRoutes');

/**
 * @param {object} deps
 * @param {import('../services/healthCheck')} deps.healthCheck
 * @returns {import('express').Router}
 */
module.exports = function createHealthRoutes({ healthCheck }) {
  const router = require('express').Router();

  // GET /api/health — full health check
  router.get('/', async (req, res) => {
    try {
      const report = await healthCheck.check();

      // Set HTTP status based on overall health
      const statusCode = report.status === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json({ success: true, data: report });
    } catch (err) {
      log.error('GET /health — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/ping — simple ping
  router.get('/ping', async (req, res) => {
    res.json({ pong: true, timestamp: new Date().toISOString() });
  });

  return router;
};
