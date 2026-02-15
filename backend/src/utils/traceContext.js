'use strict';

/**
 * AsyncLocalStorage-based trace context for request-scoped traceIds.
 *
 * Provides automatic propagation of traceId through async call chains
 * without manual threading. The logger integrates with getTraceId() to
 * auto-attach traceIds to every log entry within a traced context.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

/**
 * Singleton AsyncLocalStorage instance.
 * Store shape: { traceId: string }
 */
const traceStorage = new AsyncLocalStorage();

/**
 * Generate a new trace ID.
 * Format: `trc_` + 12 hex characters (48-bit entropy).
 *
 * @returns {string} e.g. "trc_a1b2c3d4e5f6"
 */
function generateTraceId() {
  return 'trc_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Execute a function within a trace context.
 *
 * @param {string} traceId — the trace ID to propagate
 * @param {function} fn — the function to execute within the context
 * @returns {*} the return value of fn
 */
function runWithTrace(traceId, fn) {
  return traceStorage.run({ traceId }, fn);
}

/**
 * Retrieve the current trace ID from the async context.
 *
 * @returns {string|null} the traceId if within a traced context, null otherwise
 */
function getTraceId() {
  return traceStorage.getStore()?.traceId || null;
}

module.exports = {
  traceStorage,
  generateTraceId,
  runWithTrace,
  getTraceId,
};
