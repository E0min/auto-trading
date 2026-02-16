'use strict';

/**
 * OrphanOrderCleanup — periodic detection and cancellation of orphan orders.
 *
 * An "orphan order" is an open order on the exchange that has no
 * corresponding Trade document in the database. This can happen when:
 *
 *   - An order was placed via the exchange UI or another tool
 *   - The bot crashed between placing an order and persisting the Trade
 *   - A manual intervention left stale orders on the exchange
 *
 * The cleanup runs on a configurable interval (default: 5 minutes) and
 * cancels any orphan orders to prevent unintended exposure.
 */

const { createLogger } = require('../utils/logger');
const { CATEGORIES } = require('../utils/constants');
const Trade = require('../models/Trade');

const log = createLogger('OrphanOrderCleanup');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default cleanup interval: 5 minutes */
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** R8-T2-6: Minimum order age (ms) before orphan candidacy — avoids cancelling recent orders
 *  whose Trade records may not be persisted to DB yet */
const MIN_ORPHAN_AGE_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// OrphanOrderCleanup class
// ---------------------------------------------------------------------------

class OrphanOrderCleanup {
  /**
   * @param {object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   */
  constructor({ exchangeClient }) {
    if (!exchangeClient) throw new Error('OrphanOrderCleanup requires exchangeClient');

    this.exchangeClient = exchangeClient;

    /** @type {NodeJS.Timeout|null} */
    this._interval = null;

    /** @type {number} Cleanup interval in milliseconds */
    this._cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS;

    /** @type {string} Current product category */
    this._category = CATEGORIES.USDT_FUTURES;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Start the periodic orphan order cleanup.
   *
   * Performs an initial cleanup immediately, then schedules recurring
   * cleanups at the configured interval.
   *
   * @param {string} [category='USDT-FUTURES'] — product type
   */
  start(category = CATEGORIES.USDT_FUTURES) {
    this._category = category;

    log.info('start — orphan order cleanup starting', {
      category,
      intervalMs: this._cleanupIntervalMs,
    });

    // Run initial cleanup (fire and forget — errors are logged internally)
    this.cleanup(this._category).catch((err) => {
      log.error('start — initial cleanup failed', { error: err });
    });

    // Schedule periodic cleanup
    this._interval = setInterval(async () => {
      try {
        await this.cleanup(this._category);
      } catch (err) {
        log.error('periodic cleanup — failed', { error: err });
      }
    }, this._cleanupIntervalMs);
    if (this._interval.unref) this._interval.unref();

    log.info('start — orphan order cleanup scheduled');
  }

  /**
   * Stop the periodic cleanup.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      log.info('stop — orphan order cleanup stopped');
    }
  }

  // =========================================================================
  // Core — Cleanup logic
  // =========================================================================

  /**
   * Detect and cancel orphan orders on the exchange.
   *
   * For each open order on the exchange, checks whether a matching Trade
   * document exists in the database (by orderId). Orders with no match
   * are considered orphans and are cancelled.
   *
   * @param {string} category — product type
   * @returns {Promise<{ orphansFound: number, orphansCancelled: number, errors: Array<string> }>}
   */
  async cleanup(category) {
    log.info('cleanup — scanning for orphan orders', { category });

    const errors = [];
    let orphansFound = 0;
    let orphansCancelled = 0;

    // ----- Step 1: Fetch all open orders from exchange -----
    let exchangeOrders;
    try {
      const response = await this.exchangeClient.getOpenOrders({ category });
      exchangeOrders = Array.isArray(response?.data?.entrustedList)
        ? response.data.entrustedList
        : [];
    } catch (err) {
      const msg = `Failed to fetch open orders from exchange: ${err.message}`;
      log.error(msg, { error: err });
      return { orphansFound: 0, orphansCancelled: 0, errors: [msg] };
    }

    if (exchangeOrders.length === 0) {
      log.debug('cleanup — no open orders on exchange');
      return { orphansFound: 0, orphansCancelled: 0, errors: [] };
    }

    log.info('cleanup — open orders found on exchange', { count: exchangeOrders.length });

    // ----- Step 2: Check each order against DB -----
    for (const order of exchangeOrders) {
      const orderId = order.orderId || order.ordId;
      if (!orderId) continue;

      // R8-T2-6: Skip orders younger than MIN_ORPHAN_AGE_MS — DB sync may be incomplete
      const cTime = Number(order.cTime || order.ctime || order.createTime || 0);
      const ageMs = cTime ? Date.now() - cTime : Infinity;
      if (ageMs < MIN_ORPHAN_AGE_MS) {
        log.debug('cleanup — skipping recent order (age < threshold)', {
          orderId,
          ageMs,
          thresholdMs: MIN_ORPHAN_AGE_MS,
        });
        continue;
      }

      const symbol = order.symbol || order.instId || 'unknown';
      const side = order.side || 'unknown';
      const qty = String(order.size || order.qty || order.sz || '0');
      const price = order.price || order.px || 'N/A';

      try {
        // Look up by orderId in the database
        const matchingTrade = await Trade.findOne({ orderId });

        if (!matchingTrade) {
          // ----- Orphan detected -----
          orphansFound++;

          log.warn('cleanup — orphan order detected', {
            orderId,
            symbol,
            side,
            qty,
            price: String(price),
          });

          // ----- Step 3: Cancel the orphan order -----
          try {
            await this.exchangeClient.cancelOrder({
              category,
              symbol,
              orderId,
            });

            orphansCancelled++;

            log.info('cleanup — orphan order cancelled', {
              orderId,
              symbol,
              side,
              qty,
            });
          } catch (cancelErr) {
            const msg = `Failed to cancel orphan order ${orderId}: ${cancelErr.message}`;
            log.error(msg, {
              orderId,
              symbol,
              error: cancelErr,
            });
            errors.push(msg);
          }
        }
      } catch (dbErr) {
        const msg = `Failed to query DB for order ${orderId}: ${dbErr.message}`;
        log.error(msg, { orderId, error: dbErr });
        errors.push(msg);
      }
    }

    log.info('cleanup — complete', {
      orphansFound,
      orphansCancelled,
      errorCount: errors.length,
    });

    return { orphansFound, orphansCancelled, errors };
  }
}

module.exports = OrphanOrderCleanup;
