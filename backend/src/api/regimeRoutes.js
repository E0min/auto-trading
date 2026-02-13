'use strict';

/**
 * Regime API routes — /api/regime/*
 *
 * Exposes regime status, parameters, optimization controls, and evaluations.
 */

const { Router } = require('express');
const { createLogger } = require('../utils/logger');

const log = createLogger('RegimeRoutes');

/**
 * Factory function for regime routes.
 *
 * @param {Object} deps
 * @param {import('../services/marketRegime')}    deps.marketRegime
 * @param {import('../services/regimeParamStore')} deps.regimeParamStore
 * @param {import('../services/regimeOptimizer')}  deps.regimeOptimizer
 * @param {import('../services/regimeEvaluator')}  deps.regimeEvaluator
 * @returns {Router}
 */
function createRegimeRoutes({ marketRegime, regimeParamStore, regimeOptimizer, regimeEvaluator }) {
  const router = Router();

  // GET /api/regime/status — current regime + context + params + confidence
  router.get('/status', (req, res) => {
    try {
      const context = marketRegime.getContext();
      res.json({ success: true, data: context });
    } catch (err) {
      log.error('GET /status error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/regime/params — active parameter set
  router.get('/params', (req, res) => {
    try {
      const params = regimeParamStore.getParams();
      res.json({ success: true, data: params });
    } catch (err) {
      log.error('GET /params error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/regime/params/history — optimization history
  router.get('/params/history', (req, res) => {
    try {
      const history = regimeParamStore.getHistory();
      res.json({ success: true, data: history });
    } catch (err) {
      log.error('GET /params/history error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/regime/params — manual parameter update
  router.post('/params', (req, res) => {
    try {
      const params = req.body;
      if (!params || typeof params !== 'object') {
        return res.status(400).json({ success: false, error: 'params object required' });
      }

      // Merge with current params to allow partial updates
      const current = regimeParamStore.getParams();
      const merged = { ...current, ...params };

      // Handle nested weights merge
      if (params.weights) {
        merged.weights = { ...current.weights, ...params.weights };
      }

      regimeParamStore.save(merged, 'manual', { source: 'api' });
      res.json({ success: true, data: regimeParamStore.getParams() });
    } catch (err) {
      log.error('POST /params error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/regime/params/rollback/:v — rollback to previous version
  router.post('/params/rollback/:v', (req, res) => {
    try {
      const index = parseInt(req.params.v, 10);
      if (isNaN(index)) {
        return res.status(400).json({ success: false, error: 'Invalid version index' });
      }

      const restored = regimeParamStore.rollback(index);
      res.json({ success: true, data: restored });
    } catch (err) {
      log.error('POST /params/rollback error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/regime/optimize — trigger manual optimization cycle
  router.post('/optimize', async (req, res) => {
    try {
      const result = await regimeOptimizer.runOptimizationCycle();
      res.json({ success: true, data: result });
    } catch (err) {
      log.error('POST /optimize error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/regime/evaluations — recent regime accuracy evaluations
  router.get('/evaluations', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const evaluations = regimeEvaluator.getRecentEvaluations(limit);
      const accuracy = regimeEvaluator.getAccuracyMetrics();
      const pending = regimeEvaluator.getPendingCount();

      res.json({
        success: true,
        data: {
          evaluations,
          accuracy,
          pendingCount: pending,
        },
      });
    } catch (err) {
      log.error('GET /evaluations error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/regime/optimizer/status — optimizer state
  router.get('/optimizer/status', (req, res) => {
    try {
      const status = regimeOptimizer.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      log.error('GET /optimizer/status error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createRegimeRoutes;
