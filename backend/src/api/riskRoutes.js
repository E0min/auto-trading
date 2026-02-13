'use strict';

const { Router } = require('express');
const RiskEvent = require('../models/RiskEvent');
const { createLogger } = require('../utils/logger');

const log = createLogger('RiskRoutes');

/**
 * Factory for /api/risk routes.
 *
 * @param {object} deps
 * @param {import('../services/riskEngine')} deps.riskEngine
 * @returns {Router}
 */
function createRiskRoutes({ riskEngine }) {
  const router = Router();

  // GET /api/risk/events — list risk events with optional filters
  router.get('/events', async (req, res) => {
    try {
      const { acknowledged, limit = 50, eventType } = req.query;
      const query = {};

      if (acknowledged !== undefined) {
        query.acknowledged = acknowledged === 'true';
      }
      if (eventType) {
        query.eventType = eventType;
      }

      const events = await RiskEvent.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(parseInt(limit, 10) || 50, 200))
        .lean();

      res.json({ success: true, data: events });
    } catch (err) {
      log.error('GET /events — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/risk/events/unacknowledged — shortcut for unresolved events
  router.get('/events/unacknowledged', async (req, res) => {
    try {
      const events = await RiskEvent.getUnacknowledged();
      res.json({ success: true, data: events });
    } catch (err) {
      log.error('GET /events/unacknowledged — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/risk/events/:id/acknowledge — acknowledge a risk event
  router.put('/events/:id/acknowledge', async (req, res) => {
    try {
      const event = await RiskEvent.acknowledge(req.params.id);
      if (!event) {
        return res.status(404).json({ success: false, error: 'Event not found' });
      }
      res.json({ success: true, data: event });
    } catch (err) {
      log.error('PUT /events/:id/acknowledge — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/risk/drawdown/reset — manually reset drawdown tracking
  router.post('/drawdown/reset', (req, res) => {
    try {
      const { type } = req.body || {};

      if (type === 'daily') {
        riskEngine.resetDaily();
      } else if (type === 'full') {
        riskEngine.resetDrawdown();
      } else {
        return res.status(400).json({
          success: false,
          error: 'type 필수: "daily" 또는 "full"',
        });
      }

      const status = riskEngine.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      log.error('POST /drawdown/reset — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/risk/status — current risk engine state
  router.get('/status', (req, res) => {
    try {
      const status = riskEngine.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      log.error('GET /status — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createRiskRoutes;
