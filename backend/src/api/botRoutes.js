'use strict';

/**
 * Bot control routes — start, stop, pause, resume, status, risk params, emergency stop.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const router = require('express').Router();
const { createLogger } = require('../utils/logger');
const registry = require('../strategies');

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

  // =========================================================================
  // Trading mode endpoints
  // =========================================================================

  // GET /api/bot/trading-mode — get current trading mode
  router.get('/trading-mode', (req, res) => {
    try {
      const mode = botService.paperMode ? 'paper' : 'live';
      res.json({ success: true, data: { mode } });
    } catch (err) {
      log.error('GET /trading-mode — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/trading-mode — switch trading mode (bot must be stopped)
  router.post('/trading-mode', (req, res) => {
    try {
      const { mode } = req.body || {};
      if (!mode || !['live', 'paper'].includes(mode)) {
        return res.status(400).json({ success: false, error: 'mode must be "live" or "paper"' });
      }
      botService.setTradingMode(mode);
      res.json({ success: true, data: { mode } });
    } catch (err) {
      log.error('POST /trading-mode — error', { error: err });
      const statusCode = err.message.includes('실행 중') ? 400 : 500;
      res.status(statusCode).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // Strategy management endpoints
  // =========================================================================

  // GET /api/bot/strategies — list all registered strategies + active status
  router.get('/strategies', (req, res) => {
    try {
      const allStrategies = registry.listWithMetadata();
      const activeNames = botService.strategies.map((s) => s.name);

      const strategies = allStrategies.map((meta) => ({
        name: meta.name,
        description: meta.description || '',
        defaultConfig: meta.defaultConfig || {},
        targetRegimes: meta.targetRegimes || [],
        riskLevel: meta.riskLevel || 'medium',
        active: activeNames.includes(meta.name),
      }));

      res.json({ success: true, data: { strategies } });
    } catch (err) {
      log.error('GET /strategies — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/strategies/:name/enable — enable a strategy at runtime
  router.post('/strategies/:name/enable', (req, res) => {
    try {
      const { name } = req.params;
      const config = req.body || {};
      const ok = botService.enableStrategy(name, config);

      if (!ok) {
        return res.status(400).json({
          success: false,
          error: `Failed to enable strategy "${name}". Check that the bot is running and the strategy is registered.`,
        });
      }

      res.json({ success: true, data: { name, enabled: true } });
    } catch (err) {
      log.error('POST /strategies/:name/enable — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/strategies/:name/disable — disable a strategy at runtime
  // Body: { mode?: 'immediate' | 'graceful' }  (default: 'immediate')
  router.post('/strategies/:name/disable', (req, res) => {
    try {
      const { name } = req.params;
      const mode = req.body?.mode || 'immediate';
      const ok = botService.disableStrategy(name, { mode });

      if (!ok) {
        return res.status(400).json({
          success: false,
          error: `Failed to disable strategy "${name}". Check that the bot is running and the strategy is active.`,
        });
      }

      res.json({ success: true, data: { name, enabled: false, mode } });
    } catch (err) {
      log.error('POST /strategies/:name/disable — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/bot/strategies/:name/config — update a running strategy's config
  router.put('/strategies/:name/config', (req, res) => {
    try {
      const { name } = req.params;
      const newConfig = req.body;

      if (!newConfig || typeof newConfig !== 'object') {
        return res.status(400).json({ success: false, error: 'Request body must be a valid config object' });
      }

      const strategy = botService.strategies.find((s) => s.name === name);
      if (!strategy) {
        return res.status(404).json({
          success: false,
          error: `Strategy "${name}" is not currently active`,
        });
      }

      strategy.updateConfig(newConfig);
      res.json({ success: true, data: { name, config: strategy.getConfig() } });
    } catch (err) {
      log.error('PUT /strategies/:name/config — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
