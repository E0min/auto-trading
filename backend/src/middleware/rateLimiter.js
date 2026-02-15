'use strict';

/**
 * In-memory sliding-window rate limiter middleware.
 *
 * Uses per-IP timestamp arrays to implement a sliding window counter.
 * Supports multiple limiter instances with independent configurations
 * (e.g. stricter limits for bot-control vs. data-query endpoints).
 *
 * Includes a self-cleaning timer that prunes stale entries every 60 seconds.
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('RateLimiter');

/** @type {Map<string, { timestamps: number[] }>} */
const _store = new Map();

const CLEANUP_INTERVAL = 60_000;
let _cleanupTimer = null;

/**
 * Start the periodic cleanup timer (idempotent).
 */
function startCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _store) {
      if (entry.timestamps.length === 0 ||
          entry.timestamps[entry.timestamps.length - 1] < now - 120_000) {
        _store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  _cleanupTimer.unref();
}

/**
 * Stop the cleanup timer and clear the store.
 * Should be called during graceful shutdown.
 */
function stopCleanup() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

/**
 * Create a rate-limiter Express middleware with the given configuration.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowMs=60000] — sliding window duration in milliseconds
 * @param {number} [opts.max=100]        — max requests allowed in the window
 * @param {string} [opts.keyPrefix='global'] — namespace prefix for store keys
 * @param {string} [opts.message]        — error message returned on 429
 * @returns {Function} Express middleware (req, res, next)
 */
function createRateLimiter({
  windowMs = 60_000,
  max = 100,
  keyPrefix = 'global',
  message = '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
} = {}) {
  startCleanup();

  return (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${clientIp}`;
    const now = Date.now();

    let entry = _store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      _store.set(key, entry);
    }

    // Remove timestamps outside the current window
    const cutoff = now - windowMs;
    while (entry.timestamps.length > 0 && entry.timestamps[0] <= cutoff) {
      entry.timestamps.shift();
    }

    if (entry.timestamps.length >= max) {
      log.warn('Rate limit exceeded', { key, count: entry.timestamps.length, max });
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    entry.timestamps.push(now);
    next();
  };
}

module.exports = { createRateLimiter, stopCleanup };
