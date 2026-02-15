'use strict';

/**
 * Structured JSON logger.
 *
 * Outputs one JSON object per line to stdout/stderr.
 * Supports named prefixes and arbitrary metadata.
 * Automatically attaches traceId from AsyncLocalStorage context when available.
 */

const { getTraceId } = require('./traceContext');

const LOG_LEVELS = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  TRADE: 2,
  WARN: 3,
  ERROR: 4,
});

const LEVEL_NAMES = Object.freeze({
  0: 'DEBUG',
  1: 'INFO',
  2: 'TRADE',
  3: 'WARN',
  4: 'ERROR',
});

/**
 * Resolve the configured minimum log level from the environment variable
 * LOG_LEVEL (case-insensitive). Falls back to INFO when absent or invalid.
 */
function resolveMinLevel() {
  const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
  if (LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  return LOG_LEVELS.INFO;
}

/**
 * Create a logger instance bound to a given prefix.
 *
 * @param {string} prefix — logical component name (e.g. 'RiskService')
 * @param {object} [defaultContext] — key/value pairs merged into every log entry
 * @returns {{ debug, info, trade, warn, error }}
 */
function createLogger(prefix, defaultContext = {}) {
  const minLevel = resolveMinLevel();

  /**
   * Core write function. Builds a JSON payload and writes it to the
   * appropriate stream (stderr for WARN/ERROR, stdout otherwise).
   */
  function write(level, message, meta) {
    if (level < minLevel) return;

    const traceId = getTraceId();

    const entry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      prefix,
      message,
      ...(traceId ? { traceId } : {}),
      ...defaultContext,
      ...meta,
    };

    const line = JSON.stringify(entry);

    if (level >= LOG_LEVELS.WARN) {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    /**
     * DEBUG — verbose diagnostics, hidden in production by default.
     * @param {string} message
     * @param {object} [meta]
     */
    debug(message, meta = {}) {
      write(LOG_LEVELS.DEBUG, message, meta);
    },

    /**
     * INFO — normal operational messages.
     * @param {string} message
     * @param {object} [meta]
     */
    info(message, meta = {}) {
      write(LOG_LEVELS.INFO, message, meta);
    },

    /**
     * TRADE — dedicated level for trade/order activity.
     * @param {string} message
     * @param {object} [meta]
     */
    trade(message, meta = {}) {
      write(LOG_LEVELS.TRADE, message, meta);
    },

    /**
     * WARN — potentially harmful situations.
     * @param {string} message
     * @param {object} [meta]
     */
    warn(message, meta = {}) {
      write(LOG_LEVELS.WARN, message, meta);
    },

    /**
     * ERROR — error events that might still allow the app to run.
     * @param {string} message
     * @param {object} [meta]
     */
    error(message, meta = {}) {
      // If meta contains an Error instance, serialise it properly.
      if (meta instanceof Error) {
        meta = { errorName: meta.name, errorMessage: meta.message, stack: meta.stack };
      } else if (meta.error instanceof Error) {
        const err = meta.error;
        meta = {
          ...meta,
          error: { name: err.name, message: err.message, stack: err.stack },
        };
      }
      write(LOG_LEVELS.ERROR, message, meta);
    },
  };
}

// Default logger instance (prefix: 'App')
const defaultLogger = createLogger('App');

module.exports = {
  LOG_LEVELS,
  createLogger,
  defaultLogger,
};
