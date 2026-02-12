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

const log = createLogger('App');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;

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

  const marketData = new MarketData({
    exchangeClient,
  });

  const tickerAggregator = new TickerAggregator({
    marketData,
  });

  const coinSelector = new CoinSelector({
    exchangeClient,
    tickerAggregator,
  });

  const marketRegime = new MarketRegime({
    marketData,
    tickerAggregator,
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

  const botService = new BotService({
    exchangeClient,
    riskEngine,
    orderManager,
    positionManager,
    marketData,
    tickerAggregator,
    coinSelector,
    marketRegime,
  });

  // 3. Initialize wrapper services
  scannerService.init({ coinSelector, marketRegime });
  trackerService.init({ performanceTracker, tradeJournal });
  traderService.init({ orderManager });

  // 3b. Backtest services
  const dataFetcher = new DataFetcher({ exchangeClient });

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
  app.use('/api/trades', createTradeRoutes({ traderService, positionManager }));
  app.use('/api/analytics', createAnalyticsRoutes({ trackerService }));
  app.use('/api/health', createHealthRoutes({ healthCheck }));
  app.use('/api/backtest', createBacktestRoutes({ dataFetcher, backtestStore }));

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

  // Coin selection events
  coinSelector.on(MARKET_EVENTS.COIN_SELECTED, (data) => {
    io.emit('market:coin_selected', data);
  });

  // 9. Socket.io connection handler
  io.on('connection', (socket) => {
    log.info('Socket.io client connected', { id: socket.id });

    socket.on('disconnect', (reason) => {
      log.info('Socket.io client disconnected', { id: socket.id, reason });
    });
  });

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
    positionManager,
    marketData,
    tickerAggregator,
    coinSelector,
    marketRegime,
    performanceTracker,
    tradeJournal,
    stateRecovery,
    orphanOrderCleanup,
    healthCheck,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

bootstrap().catch((err) => {
  log.error('Fatal error during bootstrap', { error: err });
  process.exit(1);
});
