'use strict';

/**
 * Backtest REST API routes.
 *
 * Endpoints for running, listing, and inspecting backtest results.
 * The backtest run is executed asynchronously — POST /run returns an ID
 * immediately and the result can be polled via GET /:id.
 */

const { Router } = require('express');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const BacktestEngine = require('../backtest/backtestEngine');
const { computeMetrics } = require('../backtest/backtestMetrics');
const registry = require('../strategies');

const log = createLogger('BacktestRoutes');

/**
 * Factory — creates and returns an Express router with backtest endpoints.
 *
 * @param {Object} deps
 * @param {Object} deps.dataFetcher    — DataFetcher instance
 * @param {Object} deps.backtestStore  — BacktestStore singleton
 * @returns {Router}
 */
function createBacktestRoutes({ dataFetcher, backtestStore, botService }) {
  const router = Router();
  let activeBacktestCount = 0;

  // -------------------------------------------------------------------------
  // POST /run — start a new backtest (async)
  // -------------------------------------------------------------------------
  router.post('/run', (req, res) => {
    try {
      const botRunning = botService && botService.getStatus().running;
      const maxConcurrent = botRunning ? 1 : 2;

      if (activeBacktestCount >= maxConcurrent) {
        return res.status(429).json({
          success: false,
          error: 'Too many backtests running',
        });
      }

      const {
        strategyName,
        strategyConfig,
        symbol,
        interval,
        startTime,
        endTime,
        initialCapital = '10000',
        makerFee = '0.0002',
        takerFee = '0.0006',
        slippage = '0.0005',
        marketRegime = null,
        leverage = '1',
      } = req.body;

      // R14-11: Input validation with proper HTTP status codes (400 instead of 200)
      if (!strategyName || !symbol || !interval || !startTime || !endTime) {
        return res.status(400).json({
          success: false,
          error: 'strategyName, symbol, interval, startTime, endTime 필수',
        });
      }

      if (!registry.has(strategyName)) {
        return res.status(400).json({
          success: false,
          error: `알 수 없는 전략: "${strategyName}"`,
        });
      }

      // R14-11: Validate time range
      const startTs = Number(startTime);
      const endTs = Number(endTime);
      if (isNaN(startTs) || isNaN(endTs) || startTs >= endTs) {
        return res.status(400).json({
          success: false,
          error: 'startTime은 endTime보다 이전이어야 합니다.',
        });
      }
      const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
      if (endTs - startTs > MAX_RANGE_MS) {
        return res.status(400).json({
          success: false,
          error: '백테스트 기간은 최대 1년입니다.',
        });
      }

      // R14-11: Validate initialCapital range
      const capNum = parseFloat(String(initialCapital));
      if (isNaN(capNum) || capNum < 100 || capNum > 10000000) {
        return res.status(400).json({
          success: false,
          error: '초기 자본은 100 ~ 10,000,000 범위여야 합니다.',
        });
      }

      // Validate leverage (P12-3 AD-70)
      const leverageNum = parseInt(leverage, 10);
      if (isNaN(leverageNum) || leverageNum < 1 || leverageNum > 20 || String(leverageNum) !== String(parseInt(leverage, 10))) {
        return res.status(400).json({
          success: false,
          error: '레버리지는 1~20 사이의 정수여야 합니다',
        });
      }

      // Generate unique ID
      const id = crypto.randomBytes(8).toString('hex');

      // Store initial running state
      backtestStore.save(id, {
        status: 'running',
        progress: 0,
        config: {
          strategyName,
          strategyConfig,
          symbol,
          interval,
          startTime: Number(startTime),
          endTime: Number(endTime),
          initialCapital: String(initialCapital),
          makerFee: String(makerFee),
          takerFee: String(takerFee),
          slippage: String(slippage),
          marketRegime,
          leverage: String(leverageNum),
        },
        metrics: null,
        trades: [],
        equityCurve: [],
        error: null,
      });

      // Return ID immediately
      res.json({ success: true, data: { id } });

      activeBacktestCount++;

      // Execute asynchronously
      setImmediate(async () => {
        try {
          log.info('Backtest run started', { id, strategyName, symbol, interval });

          // 1. Fetch klines
          const klines = await dataFetcher.getKlines({
            symbol,
            interval,
            startTime: Number(startTime),
            endTime: Number(endTime),
          });

          // Update progress
          backtestStore.save(id, {
            ...backtestStore.get(id),
            progress: 30,
          });

          // 2. Run engine
          const engine = new BacktestEngine({
            strategyName,
            strategyConfig,
            symbol,
            interval,
            initialCapital: String(initialCapital),
            makerFee: String(makerFee),
            takerFee: String(takerFee),
            slippage: String(slippage),
            marketRegime,
            leverage: String(leverageNum),
          });

          const result = engine.run(klines);

          // Update progress
          backtestStore.save(id, {
            ...backtestStore.get(id),
            progress: 80,
          });

          // 3. Compute metrics
          const metrics = computeMetrics({
            trades: result.trades,
            equityCurve: result.equityCurve,
            initialCapital: String(initialCapital),
            interval: result.config.interval,
            totalFundingCost: result.totalFundingCost, // R11-T7
          });

          // 4. Save completed result
          backtestStore.save(id, {
            status: 'completed',
            progress: 100,
            config: result.config,
            metrics,
            trades: result.trades,
            equityCurve: result.equityCurve,
            error: null,
          });

          log.info('Backtest run completed', {
            id,
            totalTrades: metrics.totalTrades,
            totalReturn: metrics.totalReturn,
          });
        } catch (err) {
          log.error('Backtest run failed', { id, error: err.message });
          const existing = backtestStore.get(id) || {};
          backtestStore.save(id, {
            ...existing,
            status: 'error',
            progress: 0,
            error: err.message,
          });
        } finally {
          activeBacktestCount--;
        }
      });
    } catch (err) {
      log.error('POST /run error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET / — list all backtests (summaries)
  // -------------------------------------------------------------------------
  router.get('/', (_req, res) => {
    try {
      const list = backtestStore.list();
      res.json({ success: true, data: list });
    } catch (err) {
      log.error('GET / error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /strategies — available strategies
  // -------------------------------------------------------------------------
  router.get('/strategies', (_req, res) => {
    try {
      const strategies = registry.listWithMetadata();
      res.json({ success: true, data: strategies });
    } catch (err) {
      log.error('GET /strategies error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:id — full result
  // -------------------------------------------------------------------------
  router.get('/:id', (req, res) => {
    try {
      const result = backtestStore.get(req.params.id);
      if (!result) {
        return res.status(404).json({ success: false, error: '백테스트를 찾을 수 없습니다' });
      }
      res.json({ success: true, data: result });
    } catch (err) {
      log.error('GET /:id error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:id/equity-curve — equity curve with optional downsampling
  // -------------------------------------------------------------------------
  router.get('/:id/equity-curve', (req, res) => {
    try {
      const result = backtestStore.get(req.params.id);
      if (!result) {
        return res.status(404).json({ success: false, error: '백테스트를 찾을 수 없습니다' });
      }

      let curve = result.equityCurve || [];
      const maxPoints = parseInt(req.query.maxPoints, 10);

      // Downsample if requested and curve is larger than maxPoints
      if (maxPoints > 0 && curve.length > maxPoints) {
        curve = _downsample(curve, maxPoints);
      }

      res.json({ success: true, data: curve });
    } catch (err) {
      log.error('GET /:id/equity-curve error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:id/trades — trade list with pagination
  // -------------------------------------------------------------------------
  router.get('/:id/trades', (req, res) => {
    try {
      const result = backtestStore.get(req.params.id);
      if (!result) {
        return res.status(404).json({ success: false, error: '백테스트를 찾을 수 없습니다' });
      }

      const trades = result.trades || [];
      const skip = parseInt(req.query.skip, 10) || 0;
      const limit = parseInt(req.query.limit, 10) || trades.length;

      const page = trades.slice(skip, skip + limit);
      res.json({ success: true, data: page });
    } catch (err) {
      log.error('GET /:id/trades error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /:id — remove a result
  // -------------------------------------------------------------------------
  router.delete('/:id', (req, res) => {
    try {
      const deleted = backtestStore.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: '백테스트를 찾을 수 없습니다' });
      }
      res.json({ success: true, data: { message: '삭제 완료' } });
    } catch (err) {
      log.error('DELETE /:id error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Downsample helper
// ---------------------------------------------------------------------------

/**
 * Reduce an array to at most `maxPoints` entries by evenly sampling.
 * Always includes the first and last points.
 *
 * @param {Array} arr
 * @param {number} maxPoints
 * @returns {Array}
 */
function _downsample(arr, maxPoints) {
  if (arr.length <= maxPoints) return arr;

  const result = [arr[0]];
  const step = (arr.length - 1) / (maxPoints - 1);

  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(i * step);
    result.push(arr[idx]);
  }

  result.push(arr[arr.length - 1]);
  return result;
}

module.exports = createBacktestRoutes;
