'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const { createLogger } = require('./utils/logger');
const { TRADE_EVENTS, RISK_EVENTS, MARKET_EVENTS } = require('./utils/constants');
const { generateTraceId, runWithTrace } = require('./utils/traceContext');
const { register, createHttpMiddleware } = require('./utils/metrics');

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
const InstrumentCache = require('./services/instrumentCache');
const PaperEngine = require('./services/paperEngine');
const PaperPositionManager = require('./services/paperPositionManager');
const PaperAccountManager = require('./services/paperAccountManager');
const StrategyRouter = require('./services/strategyRouter');
const SignalFilter = require('./services/signalFilter');
const RegimeParamStore = require('./services/regimeParamStore');
const RegimeEvaluator = require('./services/regimeEvaluator');
const RegimeOptimizer = require('./services/regimeOptimizer');
const SymbolRegimeManager = require('./services/symbolRegimeManager');
const FundingDataService = require('./services/fundingDataService');
const CoinGeckoClient = require('./services/coinGeckoClient');
const CustomStrategyStore = require('./services/customStrategyStore');

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
const createRiskRoutes = require('./api/riskRoutes');
const { createRateLimiter, stopCleanup } = require('./middleware/rateLimiter');

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

/**
 * Validate required environment variables before bootstrap.
 * In paper trading mode, exchange API keys are not required.
 * @throws {Error} if any required env vars are missing
 */
function validateEnv() {
  const isPaper = process.env.PAPER_TRADING === 'true';
  const required = isPaper ? [] : ['BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_PASSPHRASE'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}. Set PAPER_TRADING=true for paper mode.`);
  }
}

async function bootstrap() {
  // 0. Validate environment variables (E11-11)
  validateEnv();

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

  const coinGeckoClient = new CoinGeckoClient();
  const coinSelector = new CoinSelector({
    exchangeClient,
    tickerAggregator,
    marketRegime,
    coinGeckoClient,
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
  const instrumentCache = new InstrumentCache({ exchangeClient });
  const strategyRouter = new StrategyRouter({ marketRegime });
  const signalFilter = new SignalFilter();

  // Backtest services (needed by regimeOptimizer)
  const dataFetcher = new DataFetcher({ exchangeClient });

  // Regime evaluation and optimization
  const regimeEvaluator = new RegimeEvaluator({ marketRegime, marketData });
  const regimeOptimizer = new RegimeOptimizer({ regimeParamStore, regimeEvaluator, dataFetcher });

  // Per-symbol regime tracking
  const symbolRegimeManager = new SymbolRegimeManager({ marketData });

  // Funding data polling service (T2-4)
  const fundingDataService = new FundingDataService({ exchangeClient });

  // Custom strategy store (file-based)
  const customStrategyStore = new CustomStrategyStore();

  // R14-9 (AD-14-5): Auto-register saved custom strategies into the registry at startup
  // This enables backtest and bot enableStrategy for custom strategies after server restart
  {
    const CustomRuleStrategy = require('./strategies/custom/CustomRuleStrategy');
    const strategyRegistry = require('./strategies');
    const savedCustomStrategies = customStrategyStore.list();
    for (const def of savedCustomStrategies) {
      const strategyName = `Custom_${def.id}`;
      try {
        if (!strategyRegistry.has(strategyName)) {
          const metadata = CustomRuleStrategy._buildMetadata(def);
          const StrategyClass = class extends CustomRuleStrategy {
            static metadata = metadata;
            constructor(config = {}) { super(def, config); }
          };
          strategyRegistry.register(strategyName, StrategyClass);
          log.info('Auto-registered custom strategy', { strategyName });
        }
      } catch (err) {
        log.error('Failed to auto-register custom strategy (skipping)', {
          strategyName,
          error: err.message,
        });
      }
    }
    if (savedCustomStrategies.length > 0) {
      log.info(`Auto-registered ${savedCustomStrategies.length} custom strategies at startup`);
    }
  }

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
    instrumentCache,
    strategyRouter,
    signalFilter,
    paperEngine: PAPER_TRADING ? paperEngine : null,
    paperPositionManager: PAPER_TRADING ? paperPositionManager : null,
    paperMode: PAPER_TRADING,
    regimeEvaluator,
    regimeOptimizer,
    symbolRegimeManager,
    fundingDataService,
    stateRecovery,          // R8-T2-6
    orphanOrderCleanup,     // R8-T2-6
  });

  // 3. Initialize wrapper services
  scannerService.init({ coinSelector, marketRegime });
  trackerService.init({ performanceTracker, tradeJournal });
  traderService.init({ orderManager });

  // 4. Create Express app
  const app = express();

  // 5. Middleware
  app.use(express.json({ limit: '1mb' }));

  // CORS middleware (no external cors package)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trace-Id');
    res.header('Access-Control-Expose-Headers', 'X-Trace-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // 5a. Trace context middleware (T3-7) — propagate traceId through async call chain
  app.use((req, res, next) => {
    const traceId = req.headers['x-trace-id'] || generateTraceId();
    res.setHeader('X-Trace-Id', traceId);
    runWithTrace(traceId, () => next());
  });

  // 5b. HTTP metrics middleware (T3-5) — record request duration and counts
  app.use(createHttpMiddleware());

  // 5c. Prometheus /metrics endpoint (T3-5)
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // 5d. API Key authentication (T3-2)
  const { createApiKeyAuth } = require('./middleware/apiKeyAuth');
  app.use(createApiKeyAuth());

  // 5e. Rate limiters (T2-7)
  const criticalLimiter = createRateLimiter({
    windowMs: 60000,
    max: 10,
    keyPrefix: 'critical',
    message: '봇 제어/주문 API는 분당 10회로 제한됩니다.',
  });
  const standardLimiter = createRateLimiter({
    windowMs: 60000,
    max: 60,
    keyPrefix: 'standard',
    message: '데이터 조회 API는 분당 60회로 제한됩니다.',
  });
  const heavyLimiter = createRateLimiter({
    windowMs: 60000,
    max: 3,
    keyPrefix: 'heavy',
    message: '백테스트 실행은 분당 3회로 제한됩니다.',
  });

  // 5f. Apply per-path rate limiters for critical operations
  //     Bot control endpoints
  app.post('/api/bot/start', criticalLimiter);
  app.post('/api/bot/stop', criticalLimiter);
  app.put('/api/bot/risk-params', criticalLimiter);
  //     Trade order endpoint
  app.post('/api/trades/order', criticalLimiter);
  //     Backtest run (heavy)
  app.post('/api/backtest/run', heavyLimiter);
  //     Standard data-query limiters (applied at router level)
  app.use('/api/bot/status', standardLimiter);
  app.use('/api/trades', standardLimiter);
  app.use('/api/analytics', standardLimiter);
  app.use('/api/risk', standardLimiter);
  app.use('/api/regime', standardLimiter);
  //     /api/bot/emergency-stop — NO rate limit (safety)
  //     /api/health — NO rate limit (monitoring)

  // 6. Mount routes
  app.use('/api/bot', createBotRoutes({ botService, riskEngine, customStrategyStore }));
  app.use('/api/trades', createTradeRoutes({ traderService, positionManager: activePositionManager, botService }));
  app.use('/api/analytics', createAnalyticsRoutes({ trackerService }));
  app.use('/api/health', createHealthRoutes({ healthCheck, exchangeClient }));
  app.use('/api/backtest', createBacktestRoutes({ dataFetcher, backtestStore, botService }));

  app.use('/api/regime', createRegimeRoutes({ marketRegime, regimeParamStore, regimeOptimizer, regimeEvaluator, coinSelector, strategyRouter }));
  app.use('/api/risk', createRiskRoutes({ riskEngine }));

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

  riskEngine.on(RISK_EVENTS.DRAWDOWN_RESET, (data) => {
    io.emit('risk:drawdown_reset', data);
  });

  // Market events (throttled to 1 emit per symbol per second)
  const _lastTickerEmit = new Map();
  const TICKER_THROTTLE_MS = 1000;
  const TICKER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  marketData.on(MARKET_EVENTS.TICKER_UPDATE, (data) => {
    const now = Date.now();
    const lastEmit = _lastTickerEmit.get(data.symbol) || 0;
    if (now - lastEmit < TICKER_THROTTLE_MS) return;
    _lastTickerEmit.set(data.symbol, now);
    io.emit('market:ticker', data);
  });

  // R8-T1-6: Periodic cleanup of stale _lastTickerEmit entries
  const _tickerCleanupTimer = setInterval(() => {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    for (const [symbol, ts] of _lastTickerEmit) {
      if (now - ts > staleThreshold) {
        _lastTickerEmit.delete(symbol);
      }
    }
  }, TICKER_CLEANUP_INTERVAL_MS);
  if (_tickerCleanupTimer.unref) _tickerCleanupTimer.unref();

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

  // 11. Graceful shutdown (T0-4: unified handler with duplicate-shutdown guard)
  let isShuttingDown = false;

  const safeShutdown = async (reason) => {
    if (isShuttingDown) {
      log.warn('safeShutdown — already shutting down, ignoring', { reason });
      return;
    }
    isShuttingDown = true;
    log.info(`safeShutdown — starting (reason: ${reason})`);

    // Force exit after 10s if graceful shutdown hangs
    const forceExitTimer = setTimeout(() => {
      log.error('safeShutdown — force exit after 10s timeout');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    // 1. Notify frontend before closing
    try { io.emit(RISK_EVENTS.UNHANDLED_ERROR, { type: reason, timestamp: new Date().toISOString() }); } catch (_) {}

    // 2. Stop bot if running (saves session, closes WS)
    try {
      await botService.stop('server_shutdown');
    } catch (err) {
      log.error('safeShutdown — error stopping bot', { error: err });
    }

    // 3. Clear tournament interval and rate-limiter cleanup
    if (leaderboardInterval) {
      clearInterval(leaderboardInterval);
    }
    stopCleanup();

    // 4. Close HTTP server
    server.close(() => {
      log.info('HTTP server closed');
    });

    // 5. Flush — wait 500ms for pending writes
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 6. Disconnect from MongoDB
    try {
      await mongoose.disconnect();
      log.info('MongoDB disconnected');
    } catch (err) {
      log.error('safeShutdown — error disconnecting MongoDB', { error: err });
    }

    // 7. Close Socket.io LAST (so frontend receives all events)
    try {
      io.close();
      log.info('Socket.io server closed');
    } catch (err) {
      log.error('safeShutdown — error closing Socket.io', { error: err });
    }

    log.info('safeShutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => safeShutdown('SIGTERM'));
  process.on('SIGINT', () => safeShutdown('SIGINT'));

  // T0-4: unhandledRejection — log + alert, process continues
  process.on('unhandledRejection', (reason, promise) => {
    log.error('UNHANDLED REJECTION — process will continue', {
      reason: String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    try {
      io.emit(RISK_EVENTS.UNHANDLED_ERROR, {
        type: 'unhandledRejection',
        reason: String(reason),
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}
  });

  // T0-4: uncaughtException — graceful shutdown
  process.on('uncaughtException', (error) => {
    log.error('UNCAUGHT EXCEPTION — shutting down', {
      error: error.message,
      stack: error.stack,
    });
    safeShutdown('uncaughtException');
  });

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
