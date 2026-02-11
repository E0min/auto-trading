'use strict';

/**
 * StateRecovery — crash recovery service.
 *
 * Compares the current state in the database (Trade documents) against
 * the live state on the exchange (open orders, positions) and reconciles
 * any discrepancies that may have arisen during a crash or unexpected
 * shutdown.
 *
 * Typical discrepancies:
 *   - An order was filled/cancelled on the exchange while the bot was down
 *     → DB still shows 'pending' or 'open'.
 *   - An order was placed externally (e.g. via the exchange UI)
 *     → No matching Trade record in the DB.
 */

const { createLogger } = require('../utils/logger');
const { ORDER_STATUS, CATEGORIES } = require('../utils/constants');
const Trade = require('../models/Trade');

const log = createLogger('StateRecovery');

// ---------------------------------------------------------------------------
// Status mapping — Bitget REST order status → internal ORDER_STATUS
// ---------------------------------------------------------------------------

const REST_STATUS_MAP = Object.freeze({
  'new': ORDER_STATUS.OPEN,
  'live': ORDER_STATUS.OPEN,
  'init': ORDER_STATUS.PENDING,
  'partial-fill': ORDER_STATUS.PARTIALLY_FILLED,
  'partially_filled': ORDER_STATUS.PARTIALLY_FILLED,
  'full-fill': ORDER_STATUS.FILLED,
  'filled': ORDER_STATUS.FILLED,
  'cancelled': ORDER_STATUS.CANCELLED,
  'canceled': ORDER_STATUS.CANCELLED,
  'rejected': ORDER_STATUS.REJECTED,
});

// ---------------------------------------------------------------------------
// DB statuses that are considered "active" (non-terminal)
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.OPEN,
  ORDER_STATUS.PARTIALLY_FILLED,
];

// ---------------------------------------------------------------------------
// StateRecovery class
// ---------------------------------------------------------------------------

class StateRecovery {
  /**
   * @param {object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./orderManager')}   deps.orderManager
   */
  constructor({ exchangeClient, orderManager }) {
    if (!exchangeClient) throw new Error('StateRecovery requires exchangeClient');
    if (!orderManager) throw new Error('StateRecovery requires orderManager');

    this.exchangeClient = exchangeClient;
    this.orderManager = orderManager;
  }

  // =========================================================================
  // Public — Main recovery entry point
  // =========================================================================

  /**
   * Execute the full state recovery flow.
   *
   * 1. Reconcile orders (DB vs exchange open orders)
   * 2. Reconcile positions (fetch exchange positions for awareness)
   * 3. Return a summary report
   *
   * @param {string} [category='USDT-FUTURES'] — product type
   * @returns {Promise<{ reconciledOrders: number, reconciledPositions: number, errors: Array<string> }>}
   */
  async recover(category = CATEGORIES.USDT_FUTURES) {
    log.info('Starting state recovery...', { category });

    const errors = [];
    let reconciledOrders = 0;
    let reconciledPositions = 0;

    // ----- Step 1: Reconcile orders -----
    try {
      reconciledOrders = await this.reconcileOrders(category);
    } catch (err) {
      const msg = `Order reconciliation failed: ${err.message}`;
      log.error(msg, { error: err });
      errors.push(msg);
    }

    // ----- Step 2: Reconcile positions -----
    try {
      const positionData = await this.reconcilePositions(category);
      reconciledPositions = positionData.length;
    } catch (err) {
      const msg = `Position reconciliation failed: ${err.message}`;
      log.error(msg, { error: err });
      errors.push(msg);
    }

    // ----- Step 3: Summary -----
    log.info('State recovery complete', {
      reconciledOrders,
      reconciledPositions,
      errorCount: errors.length,
      errors,
    });

    return { reconciledOrders, reconciledPositions, errors };
  }

  // =========================================================================
  // Order reconciliation
  // =========================================================================

  /**
   * Compare DB active trades against exchange open orders and resolve
   * discrepancies.
   *
   * Cases handled:
   *   1. DB trade exists but NO matching exchange order
   *      → The order was cancelled/filled externally. Mark as 'cancelled' in DB.
   *   2. Exchange order exists but NO matching DB trade
   *      → The order was placed outside the bot. Create a new Trade record.
   *   3. Both exist
   *      → Update the DB trade with the exchange order's latest status and filledQty.
   *
   * @param {string} category — product type
   * @returns {Promise<number>} count of reconciled items
   */
  async reconcileOrders(category) {
    log.info('reconcileOrders — starting', { category });

    // Fetch open orders from exchange
    const exchangeResponse = await this.exchangeClient.getOpenOrders({ category });
    const exchangeOrders = Array.isArray(exchangeResponse?.data?.entrustedList)
      ? exchangeResponse.data.entrustedList
      : [];

    log.info('reconcileOrders — exchange open orders fetched', {
      count: exchangeOrders.length,
    });

    // Build a lookup map: orderId → exchange order
    const exchangeOrderMap = new Map();
    for (const order of exchangeOrders) {
      const orderId = order.orderId || order.ordId;
      if (orderId) {
        exchangeOrderMap.set(orderId, order);
      }
    }

    // Fetch active trades from DB
    const dbTrades = await Trade.find({
      status: { $in: ACTIVE_STATUSES },
    });

    log.info('reconcileOrders — active DB trades fetched', {
      count: dbTrades.length,
    });

    // Track which exchange orders have a matching DB trade
    const matchedExchangeOrderIds = new Set();
    let reconciledCount = 0;

    // ----- Case 1 & 3: Iterate DB trades -----
    for (const trade of dbTrades) {
      const exchangeOrder = exchangeOrderMap.get(trade.orderId);

      if (!exchangeOrder) {
        // Case 1: DB trade has no matching exchange order
        // → Order was cancelled/filled/expired externally
        try {
          await Trade.findByIdAndUpdate(trade._id, {
            $set: { status: ORDER_STATUS.CANCELLED },
          });

          log.warn('reconcileOrders — DB trade marked as cancelled (no matching exchange order)', {
            orderId: trade.orderId,
            symbol: trade.symbol,
            previousStatus: trade.status,
          });

          reconciledCount++;
        } catch (err) {
          log.error('reconcileOrders — failed to update DB trade', {
            orderId: trade.orderId,
            error: err,
          });
        }
      } else {
        // Case 3: Both exist — update DB trade with latest exchange state
        matchedExchangeOrderIds.add(trade.orderId);

        try {
          const updateFields = {};

          // Map exchange status
          const rawStatus = (exchangeOrder.status || exchangeOrder.state || '').toLowerCase();
          const mappedStatus = REST_STATUS_MAP[rawStatus];
          if (mappedStatus && mappedStatus !== trade.status) {
            updateFields.status = mappedStatus;
          }

          // Update filledQty if available
          const exchangeFilledQty = exchangeOrder.filledQty
            || exchangeOrder.accFillSz
            || exchangeOrder.baseVolume;
          if (exchangeFilledQty !== undefined) {
            updateFields.filledQty = String(exchangeFilledQty);
          }

          // Update avgFilledPrice if available
          const exchangeAvgPrice = exchangeOrder.avgFilledPrice
            || exchangeOrder.avgPx
            || exchangeOrder.priceAvg;
          if (exchangeAvgPrice !== undefined) {
            updateFields.avgFilledPrice = String(exchangeAvgPrice);
          }

          if (Object.keys(updateFields).length > 0) {
            await Trade.findByIdAndUpdate(trade._id, { $set: updateFields });

            log.info('reconcileOrders — DB trade updated from exchange state', {
              orderId: trade.orderId,
              symbol: trade.symbol,
              updates: updateFields,
            });

            reconciledCount++;
          }
        } catch (err) {
          log.error('reconcileOrders — failed to sync DB trade with exchange', {
            orderId: trade.orderId,
            error: err,
          });
        }
      }
    }

    // ----- Case 2: Exchange orders with no matching DB trade -----
    for (const order of exchangeOrders) {
      const orderId = order.orderId || order.ordId;
      if (!orderId) continue;

      if (!matchedExchangeOrderIds.has(orderId)) {
        try {
          const symbol = order.symbol || order.instId || '';
          const side = (order.side || '').toLowerCase();
          const posSide = (order.tradeSide || order.posSide || order.holdSide || '').toLowerCase() || undefined;
          const orderType = (order.orderType || order.ordType || '').toLowerCase();
          const qty = String(order.size || order.qty || order.sz || '0');
          const price = order.price || order.px ? String(order.price || order.px) : undefined;
          const clientOid = order.clientOid || order.clientOrdId || order.clOrdId || undefined;

          const rawStatus = (order.status || order.state || '').toLowerCase();
          const mappedStatus = REST_STATUS_MAP[rawStatus] || ORDER_STATUS.OPEN;

          const filledQty = order.filledQty || order.accFillSz || order.baseVolume;
          const avgFilledPrice = order.avgFilledPrice || order.avgPx || order.priceAvg;

          await Trade.create({
            orderId,
            clientOid,
            symbol,
            category,
            side: side || undefined,
            posSide,
            orderType: orderType || undefined,
            qty,
            price,
            filledQty: filledQty ? String(filledQty) : '0',
            avgFilledPrice: avgFilledPrice ? String(avgFilledPrice) : undefined,
            status: mappedStatus,
            metadata: { source: 'state_recovery', recoveredAt: new Date().toISOString() },
          });

          log.warn('reconcileOrders — created DB trade for orphan exchange order', {
            orderId,
            symbol,
            side,
            qty,
            status: mappedStatus,
          });

          reconciledCount++;
        } catch (err) {
          log.error('reconcileOrders — failed to create DB trade for exchange order', {
            orderId,
            error: err,
          });
        }
      }
    }

    log.info('reconcileOrders — complete', { reconciledCount });
    return reconciledCount;
  }

  // =========================================================================
  // Position reconciliation
  // =========================================================================

  /**
   * Fetch current positions from the exchange and log them.
   *
   * Positions do not require DB reconciliation because they are
   * continuously synced by the PositionManager at runtime. This method
   * exists to provide awareness of the current position state after
   * a crash recovery.
   *
   * @param {string} category — product type
   * @returns {Promise<Array<object>>} raw position data from the exchange
   */
  async reconcilePositions(category) {
    log.info('reconcilePositions — fetching exchange positions', { category });

    const response = await this.exchangeClient.getCurrentPositions({ category });
    const positions = Array.isArray(response?.data) ? response.data : [];

    if (positions.length === 0) {
      log.info('reconcilePositions — no open positions on exchange');
    } else {
      for (const pos of positions) {
        const symbol = pos.symbol || pos.instId || 'unknown';
        const holdSide = pos.holdSide || pos.posSide || pos.side || 'unknown';
        const qty = pos.total || pos.holdAmount || pos.available || pos.size || pos.pos || '0';
        const unrealizedPnl = pos.unrealizedPL || pos.unrealizedPnl || pos.achievedProfits || pos.upl || '0';

        log.info('reconcilePositions — open position detected', {
          symbol,
          holdSide,
          qty: String(qty),
          unrealizedPnl: String(unrealizedPnl),
        });
      }
    }

    log.info('reconcilePositions — complete', { positionCount: positions.length });
    return positions;
  }
}

module.exports = StateRecovery;
