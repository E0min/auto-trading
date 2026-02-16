'use strict';

/**
 * Tournament routes — leaderboard, strategy details, and lifecycle control.
 *
 * Only mounted when PAPER_TRADING=true and TOURNAMENT_MODE=true.
 */

const { createLogger } = require('../utils/logger');
const { isGreaterThan, isLessThan } = require('../utils/mathUtils');
const Trade = require('../models/Trade');

const log = createLogger('TournamentRoutes');

/**
 * @param {object} deps
 * @param {import('../services/paperAccountManager')} deps.paperAccountManager
 * @returns {import('express').Router}
 */
module.exports = function createTournamentRoutes({ paperAccountManager }) {
  const router = require('express').Router();

  // GET /api/tournament/info — tournament metadata
  router.get('/info', (req, res) => {
    try {
      const info = paperAccountManager.getTournamentInfo();
      res.json({ success: true, data: info });
    } catch (err) {
      log.error('GET /info — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/tournament/start — start tournament
  router.post('/start', (req, res) => {
    try {
      const { strategies, initialBalance } = req.body || {};

      if (initialBalance) {
        paperAccountManager.setInitialBalance(initialBalance);
      }

      const strategyNames = strategies || [];
      if (strategyNames.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'strategies array is required',
        });
      }

      paperAccountManager.startTournament(strategyNames);
      const info = paperAccountManager.getTournamentInfo();

      res.json({ success: true, data: info });
    } catch (err) {
      log.error('POST /start — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/tournament/stop — stop tournament
  router.post('/stop', (req, res) => {
    try {
      paperAccountManager.stopTournament();
      const info = paperAccountManager.getTournamentInfo();
      res.json({ success: true, data: info });
    } catch (err) {
      log.error('POST /stop — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/tournament/reset — reset tournament
  router.post('/reset', async (req, res) => {
    try {
      const { initialBalance, clearTrades } = req.body || {};

      paperAccountManager.resetTournament(initialBalance || undefined);

      // Optionally clear paper trades from MongoDB
      if (clearTrades !== false) {
        const result = await Trade.deleteMany({ 'metadata.paperTrade': true });
        log.info('POST /reset — cleared paper trades', { deletedCount: result.deletedCount });
      }

      res.json({
        success: true,
        data: {
          message: 'Tournament reset',
          info: paperAccountManager.getTournamentInfo(),
        },
      });
    } catch (err) {
      log.error('POST /reset — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/tournament/leaderboard — ranked strategy list
  router.get('/leaderboard', (req, res) => {
    try {
      const leaderboard = paperAccountManager.getLeaderboard();
      const info = paperAccountManager.getTournamentInfo();

      res.json({
        success: true,
        data: {
          tournament: info,
          leaderboard,
        },
      });
    } catch (err) {
      log.error('GET /leaderboard — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/tournament/strategy/:name — strategy details
  router.get('/strategy/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const accountState = paperAccountManager.getStrategyAccountState(name);

      if (!accountState) {
        return res.status(404).json({
          success: false,
          error: `Strategy account not found: ${name}`,
        });
      }

      // Fetch recent trades for this strategy
      let recentTrades = [];
      try {
        recentTrades = await Trade.find({
          strategy: name,
          'metadata.paperTrade': true,
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
      } catch (dbErr) {
        log.warn('GET /strategy/:name — trade query failed', { error: dbErr });
      }

      // Compute win/loss stats (R8-T1-7: use mathUtils instead of parseFloat)
      const closedTrades = recentTrades.filter((t) => t.pnl != null);
      const wins = closedTrades.filter((t) => isGreaterThan(String(t.pnl), '0')).length;
      const losses = closedTrades.filter((t) => isLessThan(String(t.pnl), '0') || String(t.pnl) === '0').length;
      const winRate = closedTrades.length > 0
        ? ((wins / closedTrades.length) * 100).toFixed(1)
        : '0';

      // Get positions for this strategy (R8-T1-8: use public API)
      const positions = paperAccountManager.getStrategyPositions(name);

      res.json({
        success: true,
        data: {
          strategy: name,
          account: accountState,
          positions,
          stats: {
            totalTrades: recentTrades.length,
            wins,
            losses,
            winRate,
          },
          recentTrades: recentTrades.slice(0, 10),
        },
      });
    } catch (err) {
      log.error('GET /strategy/:name — error', { error: err });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
