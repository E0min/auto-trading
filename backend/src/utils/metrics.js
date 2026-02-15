'use strict';

/**
 * Prometheus metrics module.
 *
 * Provides a singleton prom-client registry with pre-defined metrics for
 * HTTP, trading, risk, and system observability. Exports individual metric
 * objects for direct instrumentation from any service, plus a factory for
 * Express HTTP middleware.
 */

const {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} = require('prom-client');

// ---------------------------------------------------------------------------
// Singleton registry
// ---------------------------------------------------------------------------

const register = new Registry();

// Collect default Node.js metrics (GC, event-loop lag, memory, CPU, etc.)
collectDefaultMetrics({ register });

// ---------------------------------------------------------------------------
// HTTP metrics
// ---------------------------------------------------------------------------

const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Trading metrics
// ---------------------------------------------------------------------------

const tradingOrdersTotal = new Counter({
  name: 'trading_orders_total',
  help: 'Total number of trading orders',
  labelNames: ['side', 'strategy', 'status'],
  registers: [register],
});

const tradingPnlPerTrade = new Histogram({
  name: 'trading_pnl_per_trade',
  help: 'PnL distribution per trade in USD',
  buckets: [-100, -50, -20, -10, -5, 0, 5, 10, 20, 50, 100],
  registers: [register],
});

const tradingPositionsOpen = new Gauge({
  name: 'trading_positions_open',
  help: 'Current number of open positions',
  registers: [register],
});

const tradingFillLatencySeconds = new Histogram({
  name: 'trading_fill_latency_seconds',
  help: 'Latency from order submission to fill in seconds',
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const tradingSlippageBps = new Histogram({
  name: 'trading_slippage_bps',
  help: 'Order slippage in basis points',
  buckets: [1, 5, 10, 20, 50, 100],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Risk metrics
// ---------------------------------------------------------------------------

const riskEventsTotal = new Counter({
  name: 'risk_events_total',
  help: 'Total number of risk events',
  labelNames: ['event_type', 'severity'],
  registers: [register],
});

const riskCircuitBreakerTripsTotal = new Counter({
  name: 'risk_circuit_breaker_trips_total',
  help: 'Total number of circuit breaker trips',
  registers: [register],
});

const riskDrawdownPercent = new Gauge({
  name: 'risk_drawdown_percent',
  help: 'Current drawdown percentage',
  labelNames: ['type'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// System metrics
// ---------------------------------------------------------------------------

const botUptimeSeconds = new Gauge({
  name: 'bot_uptime_seconds',
  help: 'Time since bot start in seconds',
  registers: [register],
});

const exchangeApiCallsTotal = new Counter({
  name: 'exchange_api_calls_total',
  help: 'Total number of exchange API calls',
  labelNames: ['method', 'status'],
  registers: [register],
});

const exchangeApiLatencySeconds = new Histogram({
  name: 'exchange_api_latency_seconds',
  help: 'Exchange API call latency in seconds',
  labelNames: ['method'],
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const wsReconnectionsTotal = new Counter({
  name: 'ws_reconnections_total',
  help: 'Total number of WebSocket reconnections',
  registers: [register],
});

// ---------------------------------------------------------------------------
// HTTP middleware factory
// ---------------------------------------------------------------------------

/**
 * Normalize an Express route path for metric labels.
 * Replaces dynamic :param segments with `:id` and strips trailing slashes.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function normalizeRoute(req) {
  // Prefer the matched Express route pattern (e.g. /api/bot/:id)
  if (req.route && req.route.path) {
    const basePath = req.baseUrl || '';
    return basePath + req.route.path;
  }

  // Fallback: normalise the raw URL
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return path.replace(/\/[0-9a-fA-F]{24}/g, '/:id')    // MongoDB ObjectIds
             .replace(/\/\d+/g, '/:id')                  // Numeric IDs
             .replace(/\/trc_[0-9a-f]+/g, '/:id')        // Trace IDs
             .replace(/\/$/, '') || '/';
}

/**
 * Create Express middleware that records HTTP request duration and counts.
 *
 * @returns {function} Express middleware
 */
function createHttpMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSec = durationNs / 1e9;

      const route = normalizeRoute(req);
      const method = req.method;
      const statusCode = String(res.statusCode);

      httpRequestDurationSeconds.observe(
        { method, route, status_code: statusCode },
        durationSec
      );
      httpRequestsTotal.inc(
        { method, route, status_code: statusCode }
      );
    });

    next();
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  register,

  // HTTP
  httpRequestDurationSeconds,
  httpRequestsTotal,

  // Trading
  tradingOrdersTotal,
  tradingPnlPerTrade,
  tradingPositionsOpen,
  tradingFillLatencySeconds,
  tradingSlippageBps,

  // Risk
  riskEventsTotal,
  riskCircuitBreakerTripsTotal,
  riskDrawdownPercent,

  // System
  botUptimeSeconds,
  exchangeApiCallsTotal,
  exchangeApiLatencySeconds,
  wsReconnectionsTotal,

  // Middleware
  createHttpMiddleware,
};
