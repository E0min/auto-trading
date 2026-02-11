'use strict';

/**
 * Bot control routes — start, stop, pause, resume, status, risk params, emergency stop.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const router = require('express').Router();
const { createLogger } = require('../utils/logger');

const log = createLogger('BotRoutes');

/**
 * @param {object} deps
 * @param {import('../services/botService')} deps.botService
 * @param {import('../services/riskEngine')} deps.riskEngine
 * @returns {import('express').Router}
 */
module.exports = function createBotRoutes({ botService, riskEngine }) {

  // POST /api/bot/start — start bot with optional config body
  router.post('/start', async (req, res) => {
    try {
      const config = req.body || {};
      const session = await botService.start(config);
      res.json({ success: true, data: session });
    } catch (err) {
      log.error('POST /start — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/stop — stop bot
  router.post('/stop', async (req, res) => {
    try {
      const session = await botService.stop('user_stop');
      res.json({ success: true, data: session });
    } catch (err) {
      log.error('POST /stop — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/pause — pause bot
  router.post('/pause', async (req, res) => {
    try {
      const session = await botService.pause();
      res.json({ success: true, data: session });
    } catch (err) {
      log.error('POST /pause — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/resume — resume bot
  router.post('/resume', async (req, res) => {
    try {
      const session = await botService.resume();
      res.json({ success: true, data: session });
    } catch (err) {
      log.error('POST /resume — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/bot/status — get bot status
  router.get('/status', async (req, res) => {
    try {
      const status = botService.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      log.error('GET /status — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/bot/risk-params — update risk params
  router.put('/risk-params', async (req, res) => {
    try {
      const { params } = req.body;
      if (!params || typeof params !== 'object') {
        return res.status(400).json({ success: false, error: 'Missing or invalid "params" in request body' });
      }
      riskEngine.updateParams(params);
      const status = riskEngine.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      log.error('PUT /risk-params — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/emergency-stop — emergency stop
  router.post('/emergency-stop', async (req, res) => {
    try {
      const session = await botService.emergencyStop();
      res.json({ success: true, data: session });
    } catch (err) {
      log.error('POST /emergency-stop — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
