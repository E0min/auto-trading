'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const { createLogger } = require('./utils/logger');
const { TRADE_EVENTS, RISK_EVENTS, MARKET_EVENTS } = require('./utils/constants');

// --- Service imports ---
const exchangeClient = require('./services/exchangeClient');
const RiskEngine = require('./services/riskEngine');
const OrderManager = require('./services/orderManager');
const PositionManager = require('./services/positionManager');
const MarketData = require('./services/marketData');
const TickerAggregator = require('./services/tickerAggregator');
const CoinSelector = require('./services/coinSelector');
const MarketRegime = require('./services/marketRegime');
const PerformanceTracker = require('./services/performanceTracker');
const TradeJournal = require('./services/tradeJournal');
const StateRecovery = require('./services/stateRecovery');
const OrphanOrderCleanup = require('./services/orphanOrderCleanup');
const HealthCheck = require('./services/healthCheck');
const BotService = require('./services/botService');
const IndicatorCache = require('./services/indicatorCache');
const PaperEngine = require('./services/paperEngine');
const PaperPositionManager = require('./services/paperPositionManager');
const PaperAccountManager = require('./services/paperAccountManager');
const StrategyRouter = require('./services/strategyRouter');
const SignalFilter = require('./services/signalFilter');
const RegimeParamStore = require('./services/regimeParamStore');
const RegimeEvaluator = require('./services/regimeEvaluator');
const RegimeOptimizer = require('./services/regimeOptimizer');
const SymbolRegimeManager = require('./services/symbolRegimeManager');

// --- Wrapper service imports ---
const scannerService = require('./services/scannerService');
const trackerService = require('./services/trackerService');
const traderService = require('./services/traderService');

// --- Backtest imports ---
const DataFetcher = require('./backtest/dataFetcher');
const backtestStore = require('./backtest/backtestStore');

// --- Route factory imports ---
const createBotRoutes = require('./api/botRoutes');
const createTradeRoutes = require('./api/tradeRoutes');
const createAnalyticsRoutes = require('./api/analyticsRoutes');
const createHealthRoutes = require('./api/healthRoutes');
const createBacktestRoutes = require('./api/backtestRoutes');
const createPaperRoutes = require('./api/paperRoutes');
const createTournamentRoutes = require('./api/tournamentRoutes');
const createRegimeRoutes = require('./api/regimeRoutes');

const log = createLogger('App');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;
const PAPER_TRADING = process.env.PAPER_TRADING === 'true';
const PAPER_INITIAL_BALANCE = process.env.PAPER_INITIAL_BALANCE || '10000';
const PAPER_FEE_RATE = process.env.PAPER_FEE_RATE || '0.0006';
const PAPER_SLIPPAGE_BPS = process.env.PAPER_SLIPPAGE_BPS || '5';
const TOURNAMENT_MODE = process.env.TOURNAMENT_MODE === 'true';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  // 1. Connect to MongoDB
  log.info('Connecting to MongoDB...');
  await connectDB();
  log.info('MongoDB connected');

  // 2. Create service instances with dependency injection
  const riskEngine = new RiskEngine();

  const orderManager = new OrderManager({
    riskEngine,
    exchangeClient,
  });

  const positionManager = new PositionManager({
    exchangeClient,
    riskEngine,
  });

  // 2b. Paper trading services (conditional)
  let paperEngine = null;
  let paperPositionManager = null;

  if (PAPER_TRADING) {
    log.info('Paper trading mode ENABLED', { tournamentMode: TOURNAMENT_MODE });

    paperEngine = new PaperEngine({
      marketData: null, // will be set after marketData is created
      feeRate: PAPER_FEE_RATE,
      slippageBps: PAPER_SLIPPAGE_BPS,
    });

    if (TOURNAMENT_MODE) {
      paperPositionManager = new PaperAccountManager({
        riskEngine,
        initialBalance: PAPER_INITIAL_BALANCE,
        tournamentMode: true,
      });
    } else {
      paperPositionManager = new PaperPositionManager({
        riskEngine,
        initialBalance: PAPER_INITIAL_BALANCE,
      });
    }

    orderManager.setPaperMode(paperEngine, paperPositionManager);
  }

  const marketData = new MarketData({
    exchangeClient,
  });

  const tickerAggregator = new TickerAggregator({
    marketData,
  });

  const regimeParamStore = new RegimeParamStore();

  const marketRegime = new MarketRegime({
    marketData,
    tickerAggregator,
    regimeParamStore,
  });

  const coinSelector = new CoinSelector({
    exchangeClient,
    tickerAggregator,
    marketRegime,
  });

  const performanceTracker = new PerformanceTracker();

  const tradeJournal = new TradeJournal({
    positionManager,
  });

  const stateRecovery = new StateRecovery({
    exchangeClient,
    orderManager,
  });

  const orphanOrderCleanup = new OrphanOrderCleanup({
    exchangeClient,
  });

  const healthCheck = new HealthCheck({
    exchangeClient,
    positionManager,
  });

  // Pipeline modules
  const indicatorCache = new IndicatorCache({ marketData });
  const strategyRouter = new StrategyRouter({ marketRegime });
  const signalFilter = new SignalFilter();

  // Backtest services (needed by regimeOptimizer)
  const dataFetcher = new DataFetcher({ exchangeClient });

  // Regime evaluation and optimization
  const regimeEvaluator = new RegimeEvaluator({ marketRegime, marketData });
  const regimeOptimizer = new RegimeOptimizer({ regimeParamStore, regimeEvaluator, dataFetcher });

  // Per-symbol regime tracking
  const symbolRegimeManager = new SymbolRegimeManager({ marketData });

  // Determine which position manager the rest of the system should use
  const activePositionManager = PAPER_TRADING ? paperPositionManager : positionManager;

  // Link paperEngine.marketData now that marketData exists
  if (PAPER_TRADING && paperEngine) {
    paperEngine.marketData = marketData;
  }

  const botService = new BotService({
    exchangeClient,
    riskEngine,
    orderManager,
    positionManager: PAPER_TRADING ? paperPositionManager : positionManager,
    marketData,
    tickerAggregator,
    coinSelector,
    marketRegime,
    indicatorCache,
    strategyRouter,
    signalFilter,
    paperEngine: PAPER_TRADING ? paperEngine : null,
    paperPositionManager: PAPER_TRADING ? paperPositionManager : null,
    paperMode: PAPER_TRADING,
    regimeEvaluator,
    regimeOptimizer,
    symbolRegimeManager,
  });

  // 3. Initialize wrapper services
  scannerService.init({ coinSelector, marketRegime });
  trackerService.init({ performanceTracker, tradeJournal });
  traderService.init({ orderManager });

  // 4. Create Express app
  const app = express();

  // 5. Middleware
  app.use(express.json());

  // CORS middleware (no external cors package)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // 6. Mount routes
  app.use('/api/bot', createBotRoutes({ botService, riskEngine }));
  app.use('/api/trades', createTradeRoutes({ traderService, positionManager: activePositionManager }));
  app.use('/api/analytics', createAnalyticsRoutes({ trackerService }));
  app.use('/api/health', createHealthRoutes({ healthCheck }));
  app.use('/api/backtest', createBacktestRoutes({ dataFetcher, backtestStore }));

  app.use('/api/regime', createRegimeRoutes({ marketRegime, regimeParamStore, regimeOptimizer, regimeEvaluator }));

  if (PAPER_TRADING) {
    app.use('/api/paper', createPaperRoutes({ paperEngine, paperPositionManager }));
  }

  if (PAPER_TRADING && TOURNAMENT_MODE) {
    app.use('/api/tournament', createTournamentRoutes({ paperAccountManager: paperPositionManager }));
  }

  // 7. Create HTTP server + Socket.io
  const server = http.createServer(app);

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // 8. Forward events to Socket.io

  // Trade events
  orderManager.on(TRADE_EVENTS.ORDER_SUBMITTED, (data) => {
    io.emit('trade:order_submitted', data);
  });

  orderManager.on(TRADE_EVENTS.ORDER_FILLED, (data) => {
    io.emit('trade:order_filled', data);
  });

  orderManager.on(TRADE_EVENTS.ORDER_CANCELLED, (data) => {
    io.emit('trade:order_cancelled', data);
  });

  orderManager.on(TRADE_EVENTS.SIGNAL_GENERATED, (data) => {
    io.emit('trade:signal_generated', data);
  });

  // Position events
  positionManager.on(TRADE_EVENTS.POSITION_UPDATED, (data) => {
    io.emit('trade:position_updated', data);
  });

  // Risk events
  riskEngine.on(RISK_EVENTS.ORDER_VALIDATED, (data) => {
    io.emit('risk:order_validated', data);
  });

  riskEngine.on(RISK_EVENTS.ORDER_REJECTED, (data) => {
    io.emit('risk:order_rejected', data);
  });

  riskEngine.on(RISK_EVENTS.CIRCUIT_BREAK, (data) => {
    io.emit('risk:circuit_break', data);
  });

  riskEngine.on(RISK_EVENTS.CIRCUIT_RESET, (data) => {
    io.emit('risk:circuit_reset', data);
  });

  riskEngine.on(RISK_EVENTS.DRAWDOWN_WARNING, (data) => {
    io.emit('risk:drawdown_warning', data);
  });

  riskEngine.on(RISK_EVENTS.DRAWDOWN_HALT, (data) => {
    io.emit('risk:drawdown_halt', data);
  });

  riskEngine.on(RISK_EVENTS.EXPOSURE_ADJUSTED, (data) => {
    io.emit('risk:exposure_adjusted', data);
  });

  // Market events
  marketData.on(MARKET_EVENTS.TICKER_UPDATE, (data) => {
    io.emit('market:ticker', data);
  });

  marketData.on(MARKET_EVENTS.KLINE_UPDATE, (data) => {
    io.emit('market:kline', data);
  });

  marketData.on(MARKET_EVENTS.BOOK_UPDATE, (data) => {
    io.emit('market:book', data);
  });

  // Market regime events (forwarded from marketRegime)
  marketRegime.on(MARKET_EVENTS.REGIME_CHANGE, (data) => {
    io.emit('market:regime_change', data);
  });

  // Per-symbol regime events
  symbolRegimeManager.on('symbol:regime_change', (data) => {
    io.emit('market:symbol_regime_update', data);
  });

  // Coin selection events
  coinSelector.on(MARKET_EVENTS.COIN_SELECTED, (data) => {
    io.emit('market:coin_selected', data);
  });

  // Strategy router events
  strategyRouter.on('router:regime_switch', (data) => {
    io.emit('router:regime_switch', data);
  });

  // Signal filter events
  signalFilter.on('signal:blocked', (data) => {
    io.emit('signal:blocked', data);
  });

  // Regime optimizer events
  regimeOptimizer.on('optimizer:cycle_complete', (data) => {
    io.emit('regime:optimizer_complete', data);
  });

  // Regime evaluator events
  regimeEvaluator.on('evaluation:complete', (data) => {
    io.emit('regime:evaluation_complete', data);
  });

  // 9. Socket.io connection handler
  io.on('connection', (socket) => {
    log.info('Socket.io client connected', { id: socket.id });

    socket.on('disconnect', (reason) => {
      log.info('Socket.io client disconnected', { id: socket.id, reason });
    });
  });

  // 9b. Tournament leaderboard push (10s interval)
  let leaderboardInterval = null;
  if (PAPER_TRADING && TOURNAMENT_MODE && paperPositionManager) {
    leaderboardInterval = setInterval(() => {
      try {
        const leaderboard = paperPositionManager.getLeaderboard();
        const info = paperPositionManager.getTournamentInfo();
        io.emit('tournament:leaderboard', { tournament: info, leaderboard });
      } catch (err) {
        log.error('Leaderboard push error', { error: err });
      }
    }, 10000);
  }

  // 10. Start HTTP server
  server.listen(PORT, () => {
    log.info(`Server listening on port ${PORT}`, { port: PORT });
  });

  // 11. Graceful shutdown
  const gracefulShutdown = async (signal) => {
    log.info(`Received ${signal} — starting graceful shutdown`);

    // Stop bot if running
    try {
      await botService.stop('server_shutdown');
    } catch (err) {
      log.error('Graceful shutdown — error stopping bot', { error: err });
    }

    // Clear tournament interval
    if (leaderboardInterval) {
      clearInterval(leaderboardInterval);
    }

    // Close HTTP server
    server.close(() => {
      log.info('HTTP server closed');
    });

    // Close Socket.io
    try {
      io.close();
      log.info('Socket.io server closed');
    } catch (err) {
      log.error('Graceful shutdown — error closing Socket.io', { error: err });
    }

    // Disconnect from MongoDB
    try {
      await mongoose.disconnect();
      log.info('MongoDB disconnected');
    } catch (err) {
      log.error('Graceful shutdown — error disconnecting MongoDB', { error: err });
    }

    log.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Expose references for testing or external access
  return {
    app,
    server,
    io,
    botService,
    riskEngine,
    orderManager,
    positionManager: activePositionManager,
    marketData,
    tickerAggregator,
    coinSelector,
    marketRegime,
    performanceTracker,
    tradeJournal,
    stateRecovery,
    orphanOrderCleanup,
    healthCheck,
    paperEngine,
    paperPositionManager,
    paperMode: PAPER_TRADING,
    symbolRegimeManager,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

bootstrap().catch((err) => {
  log.error('Fatal error during bootstrap', { error: err });
  process.exit(1);
});
