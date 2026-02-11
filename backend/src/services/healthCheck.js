'use strict';

/**
 * HealthCheck — comprehensive system health monitoring.
 *
 * Aggregates the health status of every critical subsystem:
 *   - MongoDB connection and latency
 *   - Bitget REST API reachability and latency
 *   - WebSocket connection state
 *   - Position synchronisation state
 *   - Process memory usage
 *
 * Returns a single health report with an overall status derived from
 * the individual check results.
 */

const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');
const { CATEGORIES } = require('../utils/constants');

const log = createLogger('HealthCheck');

// ---------------------------------------------------------------------------
// Memory thresholds (MB)
// ---------------------------------------------------------------------------

const MEMORY_WARNING_THRESHOLD_MB = 500;
const MEMORY_ERROR_THRESHOLD_MB = 1000;

// ---------------------------------------------------------------------------
// HealthCheck class
// ---------------------------------------------------------------------------

class HealthCheck {
  /**
   * @param {object} [deps={}]
   * @param {import('./exchangeClient')} [deps.exchangeClient]  — optional; gracefully degraded if missing
   * @param {import('./positionManager')} [deps.positionManager] — optional; gracefully degraded if missing
   */
  constructor(deps = {}) {
    this.exchangeClient = deps.exchangeClient || null;
    this.positionManager = deps.positionManager || null;
  }

  // =========================================================================
  // Public — Full health check
  // =========================================================================

  /**
   * Run all health checks and return a comprehensive report.
   *
   * @returns {Promise<object>} Health report
   */
  async check() {
    log.debug('check — running health checks');

    const checks = {};

    // Run independent checks in parallel where possible
    const [database, restApi] = await Promise.all([
      this._checkDatabase(),
      this._checkRestApi(),
    ]);

    checks.database = database;
    checks.restApi = restApi;
    checks.websocket = this._checkWebsocket();
    checks.positionSync = this._checkPositionSync();
    checks.memory = this._checkMemory();

    const status = this._deriveOverallStatus(checks);

    const report = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };

    log.info('check — health report generated', {
      status,
      database: checks.database.status,
      restApi: checks.restApi.status,
      websocket: checks.websocket.status,
      positionSync: checks.positionSync.status,
      memory: checks.memory.status,
    });

    return report;
  }

  // =========================================================================
  // Individual checks
  // =========================================================================

  /**
   * Check MongoDB connection and latency.
   *
   * @returns {Promise<{ status: string, latencyMs: number, message: string }>}
   */
  async _checkDatabase() {
    const start = Date.now();

    try {
      const readyState = mongoose.connection.readyState;

      // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
      if (readyState !== 1) {
        const stateNames = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
        const stateName = stateNames[readyState] || `unknown (${readyState})`;

        return {
          status: 'error',
          latencyMs: Date.now() - start,
          message: `MongoDB is not connected (state: ${stateName})`,
        };
      }

      // Ping the database to verify actual connectivity
      await mongoose.connection.db.admin().ping();
      const latencyMs = Date.now() - start;

      return {
        status: 'ok',
        latencyMs,
        message: `MongoDB connected, ping latency ${latencyMs}ms`,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;

      log.error('_checkDatabase — ping failed', { error: err });

      return {
        status: 'error',
        latencyMs,
        message: `MongoDB check failed: ${err.message}`,
      };
    }
  }

  /**
   * Check Bitget REST API reachability by fetching a ticker.
   *
   * @returns {Promise<{ status: string, latencyMs: number, message: string }>}
   */
  async _checkRestApi() {
    if (!this.exchangeClient) {
      return {
        status: 'warning',
        latencyMs: 0,
        message: 'Exchange client not available — REST API check skipped',
      };
    }

    const start = Date.now();

    try {
      await this.exchangeClient.getTickers({
        category: CATEGORIES.USDT_FUTURES,
        symbol: 'BTCUSDT',
      });

      const latencyMs = Date.now() - start;

      return {
        status: 'ok',
        latencyMs,
        message: `Bitget REST API reachable, latency ${latencyMs}ms`,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;

      log.error('_checkRestApi — request failed', { error: err });

      return {
        status: 'error',
        latencyMs,
        message: `Bitget REST API check failed: ${err.message}`,
      };
    }
  }

  /**
   * Check WebSocket connection state.
   *
   * @returns {{ status: string, message: string }}
   */
  _checkWebsocket() {
    if (!this.exchangeClient) {
      return {
        status: 'warning',
        message: 'Exchange client not available — WebSocket check skipped',
      };
    }

    if (this.exchangeClient._wsConnected) {
      return {
        status: 'ok',
        message: 'WebSocket connections are active',
      };
    }

    return {
      status: 'error',
      message: 'WebSocket connections are not active',
    };
  }

  /**
   * Check position synchronisation state.
   *
   * @returns {{ status: string, positionCount: number, message: string }}
   */
  _checkPositionSync() {
    if (!this.positionManager) {
      return {
        status: 'warning',
        positionCount: 0,
        message: 'Position manager not available — position sync check skipped',
      };
    }

    try {
      const positions = this.positionManager.getPositions();
      const positionCount = positions.length;

      return {
        status: 'ok',
        positionCount,
        message: positionCount > 0
          ? `${positionCount} active position(s) tracked`
          : 'No active positions (position manager is running)',
      };
    } catch (err) {
      log.error('_checkPositionSync — failed', { error: err });

      return {
        status: 'warning',
        positionCount: 0,
        message: `Position sync check failed: ${err.message}`,
      };
    }
  }

  /**
   * Check process memory usage.
   *
   * Thresholds:
   *   - Warning: heapUsed > 500 MB
   *   - Error:   heapUsed > 1000 MB
   *
   * @returns {{ status: string, heapUsedMB: number, heapTotalMB: number, rssMB: number, message: string }}
   */
  _checkMemory() {
    const mem = process.memoryUsage();

    const heapUsedMB = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
    const heapTotalMB = Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100;
    const rssMB = Math.round((mem.rss / 1024 / 1024) * 100) / 100;

    let status = 'ok';
    let message = `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB, RSS: ${rssMB}MB`;

    if (heapUsedMB > MEMORY_ERROR_THRESHOLD_MB) {
      status = 'error';
      message = `CRITICAL — heap usage ${heapUsedMB}MB exceeds ${MEMORY_ERROR_THRESHOLD_MB}MB threshold. ${message}`;
    } else if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
      status = 'warning';
      message = `HIGH — heap usage ${heapUsedMB}MB exceeds ${MEMORY_WARNING_THRESHOLD_MB}MB threshold. ${message}`;
    }

    return {
      status,
      heapUsedMB,
      heapTotalMB,
      rssMB,
      message,
    };
  }

  // =========================================================================
  // Overall status derivation
  // =========================================================================

  /**
   * Derive the overall system health status from individual check results.
   *
   * Logic:
   *   - If ANY check has status 'error'   → 'unhealthy'
   *   - If ANY check has status 'warning' → 'degraded'
   *   - Otherwise                          → 'healthy'
   *
   * @param {object} checks — map of check name → { status, ... }
   * @returns {'healthy' | 'degraded' | 'unhealthy'}
   */
  _deriveOverallStatus(checks) {
    let hasError = false;
    let hasWarning = false;

    for (const checkName of Object.keys(checks)) {
      const checkResult = checks[checkName];
      if (checkResult.status === 'error') {
        hasError = true;
      } else if (checkResult.status === 'warning') {
        hasWarning = true;
      }
    }

    if (hasError) return 'unhealthy';
    if (hasWarning) return 'degraded';
    return 'healthy';
  }
}

module.exports = HealthCheck;
