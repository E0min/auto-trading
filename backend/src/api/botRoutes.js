'use strict';

/**
 * Bot control routes — start, stop, pause, resume, status, risk params, emergency stop.
 *
 * Factory function receives service dependencies and returns an Express router.
 */

const { createLogger } = require('../utils/logger');
const registry = require('../strategies');
const { getParamMeta } = require('../services/strategyParamMeta');
const { validateStrategyConfig } = require('../services/strategyConfigValidator');
const CustomRuleStrategy = require('../strategies/custom/CustomRuleStrategy');

const log = createLogger('BotRoutes');

/**
 * @param {object} deps
 * @param {import('../services/botService')} deps.botService
 * @param {import('../services/riskEngine')} deps.riskEngine
 * @param {import('../services/customStrategyStore')} [deps.customStrategyStore]
 * @returns {import('express').Router}
 */
module.exports = function createBotRoutes({ botService, riskEngine, customStrategyStore }) {
  const router = require('express').Router();

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
  // Body: { mode: 'live' | 'paper', force?: boolean }
  // R8-T2-5: force=true skips open-position warning when switching live → paper
  router.post('/trading-mode', (req, res) => {
    try {
      const { mode, force } = req.body || {};
      if (!mode || !['live', 'paper'].includes(mode)) {
        return res.status(400).json({ success: false, error: 'mode must be "live" or "paper"' });
      }
      botService.setTradingMode(mode, { force: force === true });
      res.json({ success: true, data: { mode } });
    } catch (err) {
      log.error('POST /trading-mode — error', { error: err });
      const statusCode = err.message.includes('실행 중') || err.message.includes('라이브 포지션') ? 400 : 500;
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
      const isRunning = botService._running;
      const router_ = botService.strategyRouter;

      const strategies = allStrategies.map((meta) => {
        const entry = {
          name: meta.name,
          description: meta.description || '',
          defaultConfig: meta.defaultConfig || {},
          targetRegimes: meta.targetRegimes || [],
          riskLevel: meta.riskLevel || 'medium',
          active: activeNames.includes(meta.name),
          paramMeta: getParamMeta(meta.name) || [],
          // R13-7: additional metadata fields
          docs: meta.docs || null,
          maxConcurrentPositions: meta.maxConcurrentPositions || 1,
          cooldownMs: meta.cooldownMs || 0,
          warmupCandles: meta.warmupCandles || 0,
          volatilityPreference: meta.volatilityPreference || 'neutral',
          maxSymbolsPerStrategy: meta.maxSymbolsPerStrategy || 1,
        };

        // R13-7: runtime info when bot is running
        if (isRunning) {
          const instance = botService.strategies.find((s) => s.name === meta.name);
          entry.runtime = {
            currentConfig: instance ? instance.getConfig() : null,
            assignedSymbols: router_ ? router_.getAssignedSymbols(meta.name) : [],
          };
        }

        return entry;
      });

      // Append custom strategies
      if (customStrategyStore) {
        const customDefs = customStrategyStore.list();
        for (const def of customDefs) {
          const cName = `Custom_${def.id}`;
          const entry = {
            name: cName,
            description: def.description || '커스텀 전략',
            defaultConfig: def.config || {},
            targetRegimes: def.targetRegimes || [],
            riskLevel: 'medium',
            active: activeNames.includes(cName),
            paramMeta: [],
            customId: def.id,
            customDef: def,
            // R13-7: additional metadata fields
            docs: null,
            maxConcurrentPositions: 1,
            cooldownMs: 0,
            warmupCandles: 0,
            volatilityPreference: 'neutral',
            maxSymbolsPerStrategy: 1,
          };

          // R13-7: runtime info when bot is running
          if (isRunning) {
            const instance = botService.strategies.find((s) => s.name === cName);
            entry.runtime = {
              currentConfig: instance ? instance.getConfig() : null,
              assignedSymbols: router_ ? router_.getAssignedSymbols(cName) : [],
            };
          }

          strategies.push(entry);
        }
      }

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

      const { valid, errors } = validateStrategyConfig(name, newConfig);
      if (!valid) {
        return res.status(400).json({
          success: false,
          error: 'Config validation failed',
          validationErrors: errors,
        });
      }

      strategy.updateConfig(newConfig);
      res.json({ success: true, data: { name, config: strategy.getConfig() } });
    } catch (err) {
      log.error('PUT /strategies/:name/config — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // Custom strategy CRUD endpoints
  // =========================================================================

  // GET /api/bot/custom-strategies — list all custom strategies
  router.get('/custom-strategies', (req, res) => {
    try {
      if (!customStrategyStore) {
        return res.json({ success: true, data: [] });
      }
      const list = customStrategyStore.list();
      res.json({ success: true, data: list });
    } catch (err) {
      log.error('GET /custom-strategies — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/bot/custom-strategies — create a new custom strategy
  router.post('/custom-strategies', (req, res) => {
    try {
      if (!customStrategyStore) {
        return res.status(500).json({ success: false, error: 'Custom strategy store not available' });
      }

      const def = req.body;
      if (!def || !def.name) {
        return res.status(400).json({ success: false, error: '전략 이름은 필수입니다.' });
      }
      if (!def.indicators || !Array.isArray(def.indicators)) {
        return res.status(400).json({ success: false, error: '지표 정의가 필요합니다.' });
      }
      if (!def.rules || typeof def.rules !== 'object') {
        return res.status(400).json({ success: false, error: '규칙 정의가 필요합니다.' });
      }

      const saved = customStrategyStore.save(def);

      // Register dynamically in strategy registry
      const strategyName = `Custom_${saved.id}`;
      if (!registry.has(strategyName)) {
        const metadata = CustomRuleStrategy._buildMetadata(saved);
        const StrategyClass = class extends CustomRuleStrategy {
          static metadata = metadata;
          constructor(config = {}) { super(saved, config); }
        };
        registry.register(strategyName, StrategyClass);
      }

      res.json({ success: true, data: saved });
    } catch (err) {
      log.error('POST /custom-strategies — error', { error: err });
      res.status(err.message.includes('최대') ? 400 : 500).json({ success: false, error: err.message });
    }
  });

  // PUT /api/bot/custom-strategies/:id — update an existing custom strategy
  router.put('/custom-strategies/:id', (req, res) => {
    try {
      if (!customStrategyStore) {
        return res.status(500).json({ success: false, error: 'Custom strategy store not available' });
      }

      const { id } = req.params;
      const def = req.body;

      if (!def || typeof def !== 'object') {
        return res.status(400).json({ success: false, error: 'Request body must be a valid definition object' });
      }

      const updated = customStrategyStore.update(id, def);
      res.json({ success: true, data: updated });
    } catch (err) {
      log.error('PUT /custom-strategies/:id — error', { error: err });
      res.status(err.message.includes('찾을 수 없') ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/bot/custom-strategies/:id — delete a custom strategy
  router.delete('/custom-strategies/:id', (req, res) => {
    try {
      if (!customStrategyStore) {
        return res.status(500).json({ success: false, error: 'Custom strategy store not available' });
      }

      const { id } = req.params;
      const deleted = customStrategyStore.delete(id);

      if (!deleted) {
        return res.status(404).json({ success: false, error: `커스텀 전략 "${id}"을(를) 찾을 수 없습니다.` });
      }

      res.json({ success: true, data: { id, deleted: true } });
    } catch (err) {
      log.error('DELETE /custom-strategies/:id — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
