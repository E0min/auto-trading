'use strict';

/**
 * OrderManager — manages the full lifecycle of exchange orders.
 *
 * Every order submission MUST flow through submitOrder() which delegates
 * to the RiskEngine for validation before forwarding to the exchange.
 * WebSocket events from the exchange are consumed to keep Trade documents
 * in sync with actual exchange state.
 *
 * Emits:
 *   - TRADE_EVENTS.ORDER_SUBMITTED
 *   - TRADE_EVENTS.ORDER_FILLED
 *   - TRADE_EVENTS.ORDER_CANCELLED
 *   - TRADE_EVENTS.SIGNAL_GENERATED
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const {
  TRADE_EVENTS,
  ORDER_STATUS,
  SIGNAL_ACTIONS,
  CATEGORIES,
} = require('../utils/constants');
const Trade = require('../models/Trade');
const Signal = require('../models/Signal');

const log = createLogger('OrderManager');

// ---------------------------------------------------------------------------
// Bitget WS order status → internal ORDER_STATUS mapping
// ---------------------------------------------------------------------------

const WS_STATUS_MAP = Object.freeze({
  'new': ORDER_STATUS.OPEN,
  'live': ORDER_STATUS.OPEN,
  'partial-fill': ORDER_STATUS.PARTIALLY_FILLED,
  'partially_filled': ORDER_STATUS.PARTIALLY_FILLED,
  'full-fill': ORDER_STATUS.FILLED,
  'filled': ORDER_STATUS.FILLED,
  'cancelled': ORDER_STATUS.CANCELLED,
  'canceled': ORDER_STATUS.CANCELLED,
  'rejected': ORDER_STATUS.REJECTED,
});

// ---------------------------------------------------------------------------
// Action → side/posSide/reduceOnly mapping
// ---------------------------------------------------------------------------

const ACTION_MAP = Object.freeze({
  [SIGNAL_ACTIONS.OPEN_LONG]: { side: 'buy', posSide: 'long', reduceOnly: false },
  [SIGNAL_ACTIONS.OPEN_SHORT]: { side: 'sell', posSide: 'short', reduceOnly: false },
  [SIGNAL_ACTIONS.CLOSE_LONG]: { side: 'sell', posSide: 'long', reduceOnly: true },
  [SIGNAL_ACTIONS.CLOSE_SHORT]: { side: 'buy', posSide: 'short', reduceOnly: true },
});

// ---------------------------------------------------------------------------
// Terminal statuses — orders that can no longer change
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set([
  ORDER_STATUS.FILLED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REJECTED,
  ORDER_STATUS.FAILED,
]);

// ---------------------------------------------------------------------------
// OrderManager class
// ---------------------------------------------------------------------------

class OrderManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./riskEngine')} deps.riskEngine
   * @param {import('./exchangeClient')} deps.exchangeClient
   */
  constructor({ riskEngine, exchangeClient }) {
    super();

    if (!riskEngine) throw new Error('OrderManager requires riskEngine');
    if (!exchangeClient) throw new Error('OrderManager requires exchangeClient');

    this.riskEngine = riskEngine;
    this.exchangeClient = exchangeClient;

    /** @type {Map<string, Promise>} Per-symbol lock promises (T0-5) */
    this._symbolLocks = new Map();

    /** @type {Map<string, string>} Per-symbol leverage cache (AD-36) */
    this._leverageCache = new Map();

    /** @type {boolean} Paper trading mode flag */
    this._paperMode = false;

    /** @type {import('./paperEngine')|null} */
    this._paperEngine = null;

    /** @type {import('./paperPositionManager')|null} */
    this._paperPositionManager = null;

    /** @type {Function|null} Bound handler for paper:fill event (for cleanup) */
    this._paperFillHandler = null;

    // Bind WS handlers
    this._handleWsOrderUpdate = this._handleWsOrderUpdate.bind(this);
    this._handleWsFillUpdate = this._handleWsFillUpdate.bind(this);

    // Listen to private WS events from the exchange client
    this.exchangeClient.on('ws:order', this._handleWsOrderUpdate);
    this.exchangeClient.on('ws:fill', this._handleWsFillUpdate);

    log.info('OrderManager initialised');
  }

  // =========================================================================
  // Paper mode setup
  // =========================================================================

  /**
   * Enable paper trading mode. Orders will be routed to PaperEngine
   * instead of the exchange.
   *
   * @param {import('./paperEngine')} paperEngine
   * @param {import('./paperPositionManager')} paperPositionManager
   */
  setPaperMode(paperEngine, paperPositionManager) {
    // Remove previous listener if exists (prevent accumulation)
    if (this._paperEngine && this._paperFillHandler) {
      this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
    }

    this._paperMode = true;
    this._paperEngine = paperEngine;
    this._paperPositionManager = paperPositionManager;

    // Create and store handler reference for cleanup
    this._paperFillHandler = (fill) => {
      this._handlePaperFill(fill).catch((err) => {
        log.error('setPaperMode — error handling paper fill', { error: err });
      });
    };
    this._paperEngine.on('paper:fill', this._paperFillHandler);

    log.info('OrderManager — paper trading mode enabled');
  }

  /**
   * Switch back to live trading mode. Clears paper engine references.
   */
  setLiveMode() {
    if (this._paperEngine && this._paperFillHandler) {
      this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
      this._paperFillHandler = null;
    }
    this._paperMode = false;
    this._paperEngine = null;
    this._paperPositionManager = null;
    log.info('OrderManager — live trading mode enabled');
  }

  // =========================================================================
  // Public — Order submission (the ONLY entry point for new orders)
  // =========================================================================

  /**
   * Submit a new order with per-symbol mutex serialisation (T0-5).
   * Ensures only one order per symbol is in-flight at a time.
   *
   * @param {object} signal
   * @returns {Promise<object|null>} Trade document if submitted, null if rejected
   */
  async submitOrder(signal) {
    const { symbol } = signal;
    const LOCK_TIMEOUT_MS = 30000;

    const prev = this._symbolLocks.get(symbol) || Promise.resolve();
    let releaseLock;
    const current = new Promise((resolve) => { releaseLock = resolve; });
    this._symbolLocks.set(symbol, current);

    try {
      // Wait for previous order with timeout
      await Promise.race([
        prev,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Lock timeout')), LOCK_TIMEOUT_MS)
        ),
      ]);
      return await this._submitOrderInternal(signal);
    } catch (err) {
      if (err.message === 'Lock timeout') {
        log.error('submitOrder — lock timeout, skipping', { symbol });
        return null;
      }
      throw err;
    } finally {
      releaseLock();
      if (this._symbolLocks.get(symbol) === current) {
        this._symbolLocks.delete(symbol);
      }
    }
  }

  /**
   * Internal order submission — validates through RiskEngine then submits.
   *
   * @param {object} signal
   * @param {string} signal.symbol       — e.g. 'BTCUSDT'
   * @param {string} signal.action       — one of SIGNAL_ACTIONS
   * @param {string} signal.qty          — desired quantity (String)
   * @param {string} [signal.price]      — limit price (String); omit for market
   * @param {string} [signal.orderType]  — 'limit' | 'market' (default 'market')
   * @param {string} [signal.category]   — product type (default 'USDT-FUTURES')
   * @param {string} [signal.strategy]   — strategy name
   * @param {string} [signal.sessionId]  — bot session id
   * @param {number} [signal.confidence] — signal confidence 0-1
   * @param {object} [signal.marketContext] — snapshot of market data at signal time
   * @param {string} [signal.takeProfitPrice] — TP trigger price (String)
   * @param {string} [signal.stopLossPrice]   — SL trigger price (String)
   * @returns {Promise<object|null>} Trade document if submitted, null if rejected
   * @private
   */
  async _submitOrderInternal(signal) {
    const {
      symbol,
      action,
      qty,
      price,
      orderType = 'market',
      category = CATEGORIES.USDT_FUTURES,
      strategy = 'unknown',
      sessionId,
      confidence,
      marketContext,
      takeProfitPrice,
      stopLossPrice,
    } = signal;

    log.info('submitOrder — received signal', { symbol, action, qty, price, orderType, strategy });

    // Resolve side/posSide from action
    const actionMapping = ACTION_MAP[action];
    if (!actionMapping) {
      log.error('submitOrder — unknown action', { action });
      return null;
    }

    // ------------------------------------------------------------------
    // Step 1: Risk validation
    // ------------------------------------------------------------------

    // AD-34: Inject market price for risk validation
    let riskPrice = price;
    if (!riskPrice || riskPrice === '0') {
      riskPrice = signal.suggestedPrice || signal.price || '0';
    }

    let riskResult;
    try {
      riskResult = this.riskEngine.validateOrder({
        symbol,
        side: actionMapping.side,
        qty,
        price: riskPrice,
        category,
        reduceOnly: actionMapping.reduceOnly,
      });
    } catch (err) {
      log.error('submitOrder — riskEngine.validateOrder threw', { error: err });
      // Save signal as rejected due to internal error
      try {
        await Signal.create({
          strategy,
          symbol,
          action,
          category,
          suggestedQty: qty,
          suggestedPrice: price,
          confidence,
          riskApproved: false,
          rejectReason: `Risk validation error: ${err.message}`,
          marketContext,
          sessionId,
        });
      } catch (dbErr) {
        log.error('submitOrder — failed to save rejected signal', { error: dbErr });
      }
      return null;
    }

    // ------------------------------------------------------------------
    // Step 2: Handle rejection
    // ------------------------------------------------------------------
    if (!riskResult.approved) {
      log.warn('submitOrder — order rejected by risk engine', {
        symbol,
        action,
        reason: riskResult.rejectReason,
      });

      try {
        const rejectedSignal = await Signal.create({
          strategy,
          symbol,
          action,
          category,
          suggestedQty: qty,
          suggestedPrice: price,
          confidence,
          riskApproved: false,
          rejectReason: riskResult.rejectReason,
          marketContext,
          sessionId,
        });

        this.emit(TRADE_EVENTS.SIGNAL_GENERATED, {
          signal: rejectedSignal.toObject(),
          approved: false,
          rejectReason: riskResult.rejectReason,
        });
      } catch (dbErr) {
        log.error('submitOrder — failed to save rejected signal', { error: dbErr });
      }

      return null;
    }

    // ------------------------------------------------------------------
    // Step 3: Build order and submit (paper or exchange)
    // ------------------------------------------------------------------
    const finalQty = riskResult.adjustedQty || qty;
    const clientOid = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ----------------------------------------------------------------
    // PAPER TRADING PATH
    // ----------------------------------------------------------------
    if (this._paperMode) {
      return this._submitPaperOrder({
        clientOid,
        symbol,
        category,
        side: actionMapping.side,
        posSide: actionMapping.posSide,
        orderType,
        qty: finalQty,
        price,
        reduceOnly: actionMapping.reduceOnly,
        strategy,
        sessionId,
        action,
        confidence,
        marketContext,
        takeProfitPrice,
        stopLossPrice,
        originalQty: qty,
      });
    }

    // ----------------------------------------------------------------
    // LIVE TRADING PATH
    // ----------------------------------------------------------------

    // AD-36: Set leverage per-signal with cache
    if (signal.leverage && !actionMapping.reduceOnly) {
      const cachedLev = this._leverageCache.get(symbol);
      if (cachedLev !== String(signal.leverage)) {
        try {
          await this.exchangeClient.setLeverage({
            symbol, category, leverage: signal.leverage,
          });
          this._leverageCache.set(symbol, String(signal.leverage));
        } catch (err) {
          log.warn('submitOrder — failed to set leverage (continuing with current)', {
            symbol, leverage: signal.leverage, error: err.message,
          });
        }
      }
    }

    const orderParams = {
      category,
      symbol,
      side: actionMapping.side,
      orderType,
      qty: finalQty,
      posSide: actionMapping.posSide,
      clientOid,
      reduceOnly: actionMapping.reduceOnly,
    };

    if (price) orderParams.price = price;
    if (takeProfitPrice) orderParams.takeProfitPrice = takeProfitPrice;
    if (stopLossPrice) orderParams.stopLossPrice = stopLossPrice;

    let exchangeResponse;
    try {
      exchangeResponse = await this.exchangeClient.placeOrder(orderParams);
    } catch (err) {
      log.error('submitOrder — exchange placeOrder failed', {
        symbol,
        clientOid,
        error: err,
      });

      // Save trade as failed
      try {
        const failedTrade = await Trade.create({
          orderId: clientOid, // use clientOid as placeholder
          clientOid,
          symbol,
          category,
          side: actionMapping.side,
          posSide: actionMapping.posSide,
          orderType,
          qty: finalQty,
          price: price || undefined,
          status: ORDER_STATUS.FAILED,
          signalId: undefined,
          sessionId,
          strategy,
          reduceOnly: actionMapping.reduceOnly,
          takeProfitPrice,
          stopLossPrice,
          metadata: { error: err.message },
        });

        await Signal.create({
          strategy,
          symbol,
          action,
          category,
          suggestedQty: qty,
          suggestedPrice: price,
          confidence,
          riskApproved: true,
          rejectReason: `Exchange error: ${err.message}`,
          marketContext,
          sessionId,
        });

        return failedTrade;
      } catch (dbErr) {
        log.error('submitOrder — failed to save failed trade', { error: dbErr });
        return null;
      }
    }

    // ------------------------------------------------------------------
    // Step 4: Persist Trade + Signal, emit events
    // ------------------------------------------------------------------
    const orderId = exchangeResponse?.data?.orderId || clientOid;

    let trade;
    try {
      trade = await Trade.create({
        orderId,
        clientOid,
        symbol,
        category,
        side: actionMapping.side,
        posSide: actionMapping.posSide,
        orderType,
        qty: finalQty,
        price: price || undefined,
        status: ORDER_STATUS.OPEN,
        sessionId,
        strategy,
        reduceOnly: actionMapping.reduceOnly,
        takeProfitPrice,
        stopLossPrice,
      });
    } catch (dbErr) {
      log.error('submitOrder — failed to save trade to DB', { error: dbErr });
      return null;
    }

    try {
      const savedSignal = await Signal.create({
        strategy,
        symbol,
        action,
        category,
        suggestedQty: qty,
        suggestedPrice: price,
        confidence,
        riskApproved: true,
        resultOrderId: orderId,
        marketContext,
        sessionId,
      });

      // Link signal to trade
      trade.signalId = savedSignal._id;
      await trade.save();
    } catch (dbErr) {
      log.error('submitOrder — failed to save signal to DB', { error: dbErr });
      // Trade is already saved — continue
    }

    log.trade('submitOrder — order submitted successfully', {
      orderId,
      clientOid,
      symbol,
      side: actionMapping.side,
      posSide: actionMapping.posSide,
      qty: finalQty,
      price,
      orderType,
    });

    this.emit(TRADE_EVENTS.ORDER_SUBMITTED, {
      trade: trade.toObject(),
    });

    return trade;
  }

  // =========================================================================
  // Public — Cancel order
  // =========================================================================

  /**
   * Cancel an existing order.
   *
   * @param {object} params
   * @param {string} params.symbol    — trading pair
   * @param {string} [params.orderId] — exchange order id
   * @param {string} [params.clientOid] — client order id
   * @param {string} [params.category] — product type (default 'USDT-FUTURES')
   * @returns {Promise<object|null>} updated Trade or null on failure
   */
  async cancelOrder({ symbol, orderId, clientOid, category = CATEGORIES.USDT_FUTURES }) {
    log.info('cancelOrder — requesting cancellation', { symbol, orderId, clientOid });

    // Paper mode: cancel via PaperEngine
    if (this._paperMode && this._paperEngine) {
      const cancelOid = clientOid || orderId;
      if (cancelOid) {
        this._paperEngine.cancelOrder(cancelOid);
      }
    } else {
      try {
        await this.exchangeClient.cancelOrder({ category, symbol, orderId, clientOid });
      } catch (err) {
        log.error('cancelOrder — exchange cancelOrder failed', {
          symbol,
          orderId,
          clientOid,
          error: err,
        });
        throw err;
      }
    }

    // Update trade in DB
    let trade;
    try {
      const query = {};
      if (orderId) query.orderId = orderId;
      else if (clientOid) query.clientOid = clientOid;
      else {
        log.error('cancelOrder — no orderId or clientOid provided');
        return null;
      }

      trade = await Trade.findOneAndUpdate(
        query,
        { status: ORDER_STATUS.CANCELLED },
        { new: true }
      );

      if (!trade) {
        log.warn('cancelOrder — trade not found in DB', { orderId, clientOid });
        return null;
      }
    } catch (dbErr) {
      log.error('cancelOrder — failed to update trade in DB', { error: dbErr });
      return null;
    }

    log.trade('cancelOrder — order cancelled', {
      orderId: trade.orderId,
      clientOid: trade.clientOid,
      symbol: trade.symbol,
    });

    this.emit(TRADE_EVENTS.ORDER_CANCELLED, {
      trade: trade.toObject(),
    });

    return trade;
  }

  // =========================================================================
  // Paper trading — Order submission
  // =========================================================================

  /**
   * Submit an order through the paper trading engine.
   *
   * Market orders are filled instantly. Limit orders are queued and filled
   * when the price condition is met (handled via paper:fill event).
   *
   * @param {object} params
   * @returns {Promise<object|null>} Trade document
   * @private
   */
  async _submitPaperOrder(params) {
    const {
      clientOid, symbol, category, side, posSide, orderType, qty,
      price, reduceOnly, strategy, sessionId, action, confidence,
      marketContext, takeProfitPrice, stopLossPrice, originalQty,
    } = params;

    const orderParams = {
      clientOid,
      symbol,
      side,
      posSide,
      qty,
      price,
      reduceOnly,
      strategy,
    };

    let fill = null;

    if (orderType === 'market') {
      // Instant fill via PaperEngine
      fill = this._paperEngine.matchMarketOrder(orderParams);

      if (!fill) {
        log.warn('_submitPaperOrder — market order failed (no price)', { symbol });
        return null;
      }
    } else {
      // Queue limit order
      this._paperEngine.submitLimitOrder(orderParams);
    }

    // Determine status and fill fields
    const isFilled = fill !== null;
    const status = isFilled ? ORDER_STATUS.FILLED : ORDER_STATUS.OPEN;
    const filledQty = isFilled ? fill.qty : '0';
    const avgFilledPrice = isFilled ? fill.fillPrice : undefined;
    const fee = isFilled ? fill.fee : '0';

    // Get entry price for close orders (for PnL calc)
    let entryPriceMeta;
    if (reduceOnly && this._paperPositionManager) {
      const pos = this._paperPositionManager.getPosition(symbol, posSide, strategy);
      if (pos) entryPriceMeta = pos.entryPrice;
    }

    // Persist Trade to MongoDB
    let trade;
    try {
      trade = await Trade.create({
        orderId: `paper_${clientOid}`,
        clientOid,
        symbol,
        category,
        side,
        posSide,
        orderType,
        qty,
        price: price || undefined,
        filledQty,
        avgFilledPrice,
        fee,
        status,
        sessionId,
        strategy,
        reduceOnly,
        takeProfitPrice,
        stopLossPrice,
        metadata: {
          paperTrade: true,
          entryPrice: entryPriceMeta,
        },
      });
    } catch (dbErr) {
      log.error('_submitPaperOrder — failed to save trade', { error: dbErr });
      return null;
    }

    // Persist Signal
    try {
      const savedSignal = await Signal.create({
        strategy,
        symbol,
        action,
        category,
        suggestedQty: originalQty,
        suggestedPrice: price,
        confidence,
        riskApproved: true,
        resultOrderId: trade.orderId,
        marketContext,
        sessionId,
      });
      trade.signalId = savedSignal._id;
      await trade.save();
    } catch (dbErr) {
      log.error('_submitPaperOrder — failed to save signal', { error: dbErr });
    }

    // Process fill through PaperPositionManager if market order
    if (isFilled && this._paperPositionManager) {
      const { pnl } = this._paperPositionManager.onFill(fill);

      if (pnl !== null) {
        trade.pnl = pnl;
        await trade.save().catch((err) => {
          log.error('_submitPaperOrder — failed to save PnL', { pnl, error: err.message });
        });
        this.riskEngine.recordTrade({ pnl });
      }

      log.trade('_submitPaperOrder — fill processed', {
        symbol, side, reduceOnly, pnl,
      });

      this.emit(TRADE_EVENTS.ORDER_FILLED, {
        trade: trade.toObject(),
        pnl,
      });
    }

    log.trade('_submitPaperOrder — paper order processed', {
      orderId: trade.orderId,
      clientOid,
      symbol,
      side,
      orderType,
      status,
      fillPrice: avgFilledPrice,
    });

    this.emit(TRADE_EVENTS.ORDER_SUBMITTED, {
      trade: trade.toObject(),
    });

    return trade;
  }

  // =========================================================================
  // Paper trading — Deferred limit order fill handler
  // =========================================================================

  /**
   * Handle fills from PaperEngine for limit orders that were queued.
   * Updates the Trade document and processes position changes.
   *
   * @param {object} fill — from PaperEngine 'paper:fill' event
   * @private
   */
  async _handlePaperFill(fill) {
    try {
      const trade = await Trade.findOne({ clientOid: fill.clientOid });
      if (!trade) {
        log.warn('_handlePaperFill — no matching trade', { clientOid: fill.clientOid });
        return;
      }

      // Update trade to FILLED
      trade.status = ORDER_STATUS.FILLED;
      trade.filledQty = fill.qty;
      trade.avgFilledPrice = fill.fillPrice;
      trade.fee = fill.fee;
      await trade.save();

      // Process through PaperPositionManager
      if (this._paperPositionManager) {
        const { pnl } = this._paperPositionManager.onFill(fill);

        if (pnl !== null) {
          trade.pnl = pnl;
          await trade.save();
          this.riskEngine.recordTrade({ pnl });
        }

        this.emit(TRADE_EVENTS.ORDER_FILLED, {
          trade: trade.toObject(),
          pnl,
        });
      }

      log.trade('_handlePaperFill — limit order filled', {
        clientOid: fill.clientOid,
        symbol: fill.symbol,
        fillPrice: fill.fillPrice,
      });
    } catch (err) {
      log.error('_handlePaperFill — error', { error: err });
    }
  }

  // =========================================================================
  // WebSocket — Order update handler
  // =========================================================================

  /**
   * Handle WebSocket order update events from the exchange.
   * Updates Trade documents in the database to reflect current exchange state.
   *
   * @param {object} event — normalised WS event { topic, symbol, data, ts }
   * @private
   */
  async _handleWsOrderUpdate(event) {
    const updates = Array.isArray(event.data) ? event.data : [event.data];

    for (const update of updates) {
      try {
        const exchangeOrderId = update.orderId || update.ordId;
        const exchangeClientOid = update.clientOid || update.clientOrdId || update.clOrdId;

        if (!exchangeOrderId && !exchangeClientOid) {
          log.debug('_handleWsOrderUpdate — skipping update without identifiers', { update });
          continue;
        }

        // Find the matching trade
        const query = {};
        if (exchangeOrderId) query.orderId = exchangeOrderId;
        else query.clientOid = exchangeClientOid;

        const trade = await Trade.findOne(query);
        if (!trade) {
          log.debug('_handleWsOrderUpdate — no matching trade found', {
            orderId: exchangeOrderId,
            clientOid: exchangeClientOid,
          });
          continue;
        }

        // Skip updates for trades already in a terminal state
        if (TERMINAL_STATUSES.has(trade.status)) {
          log.debug('_handleWsOrderUpdate — trade already terminal', {
            orderId: trade.orderId,
            status: trade.status,
          });
          continue;
        }

        // Map exchange status to internal status
        const rawStatus = (update.status || update.state || '').toLowerCase();
        const newStatus = WS_STATUS_MAP[rawStatus];

        if (!newStatus) {
          log.debug('_handleWsOrderUpdate — unknown exchange status', {
            rawStatus,
            orderId: exchangeOrderId,
          });
          continue;
        }

        // Build update fields
        const updateFields = { status: newStatus };

        const wsFilledQty = update.filledQty || update.accFillSz || update.baseVolume;
        if (wsFilledQty) {
          updateFields.filledQty = String(wsFilledQty);
        }

        const wsAvgPrice = update.avgFilledPrice || update.avgPx || update.priceAvg;
        if (wsAvgPrice) {
          updateFields.avgFilledPrice = String(wsAvgPrice);
        }

        const wsFee = update.fee || update.totalFee;
        if (wsFee) {
          updateFields.fee = String(wsFee);
        }

        // Persist update
        const updatedTrade = await Trade.findOneAndUpdate(
          query,
          { $set: updateFields },
          { new: true }
        );

        log.trade('_handleWsOrderUpdate — trade updated', {
          orderId: updatedTrade.orderId,
          oldStatus: trade.status,
          newStatus,
          filledQty: updateFields.filledQty,
          avgFilledPrice: updateFields.avgFilledPrice,
        });

        // If fully filled, calculate PnL for close orders and record trade
        if (newStatus === ORDER_STATUS.FILLED) {
          await this._handleOrderFilled(updatedTrade);
        }
      } catch (err) {
        log.error('_handleWsOrderUpdate — error processing update', { error: err });
      }
    }
  }

  // =========================================================================
  // WebSocket — Fill update handler
  // =========================================================================

  /**
   * Handle WebSocket fill events from the exchange.
   * Updates filledQty and avgFilledPrice on the matching Trade.
   *
   * @param {object} event — normalised WS event { topic, symbol, data, ts }
   * @private
   */
  async _handleWsFillUpdate(event) {
    const fills = Array.isArray(event.data) ? event.data : [event.data];

    for (const fill of fills) {
      try {
        const exchangeOrderId = fill.orderId || fill.ordId;
        const exchangeClientOid = fill.clientOid || fill.clientOrdId || fill.clOrdId;

        if (!exchangeOrderId && !exchangeClientOid) {
          log.debug('_handleWsFillUpdate — skipping fill without identifiers');
          continue;
        }

        const query = {};
        if (exchangeOrderId) query.orderId = exchangeOrderId;
        else query.clientOid = exchangeClientOid;

        const trade = await Trade.findOne(query);
        if (!trade) {
          log.debug('_handleWsFillUpdate — no matching trade found', {
            orderId: exchangeOrderId,
            clientOid: exchangeClientOid,
          });
          continue;
        }

        // Update fill data
        const updateFields = {};

        const fillQty = fill.fillQty || fill.fillSz || fill.lastFillQty;
        const fillPrice = fill.fillPrice || fill.fillPx || fill.lastFillPrice;
        const fillFee = fill.fee || fill.fillFee;

        if (fillQty && fillPrice) {
          // Compute new weighted average price and accumulated quantity
          const prevFilledQty = trade.filledQty || '0';
          const prevAvgPrice = trade.avgFilledPrice || '0';

          const newTotalQty = math.add(prevFilledQty, String(fillQty));
          updateFields.filledQty = newTotalQty;

          // Weighted average: (prevQty * prevAvg + fillQty * fillPrice) / newTotalQty
          if (!math.isZero(newTotalQty)) {
            const prevNotional = math.multiply(prevFilledQty, prevAvgPrice);
            const fillNotional = math.multiply(String(fillQty), String(fillPrice));
            const totalNotional = math.add(prevNotional, fillNotional);
            updateFields.avgFilledPrice = math.divide(totalNotional, newTotalQty);
          }
        }

        if (fillFee) {
          const prevFee = trade.fee || '0';
          updateFields.fee = math.add(prevFee, math.abs(String(fillFee)));
        }

        if (Object.keys(updateFields).length > 0) {
          await Trade.findOneAndUpdate(query, { $set: updateFields });

          log.trade('_handleWsFillUpdate — fill recorded', {
            orderId: trade.orderId,
            fillQty,
            fillPrice,
            totalFilledQty: updateFields.filledQty,
            avgFilledPrice: updateFields.avgFilledPrice,
          });
        }
      } catch (err) {
        log.error('_handleWsFillUpdate — error processing fill', { error: err });
      }
    }
  }

  // =========================================================================
  // Internal — Post-fill processing
  // =========================================================================

  /**
   * Called when a trade transitions to FILLED status.
   * For close (reduceOnly) orders, calculates PnL and records in riskEngine.
   *
   * @param {object} trade — Mongoose Trade document
   * @private
   */
  async _handleOrderFilled(trade) {
    try {
      let pnl = null;

      // Calculate PnL for close orders (reduceOnly)
      if (trade.reduceOnly && trade.avgFilledPrice && trade.filledQty) {
        // Attempt to find the corresponding opening trade for PnL calculation
        // For close_long: PnL = (exitPrice - entryPrice) * qty
        // For close_short: PnL = (entryPrice - exitPrice) * qty
        // Since we may not always have the entry price readily available,
        // we rely on the exchange-reported PnL if present, or compute from metadata.
        if (trade.metadata?.entryPrice) {
          const entryPrice = trade.metadata.entryPrice;
          const exitPrice = trade.avgFilledPrice;
          const filledQty = trade.filledQty;

          if (trade.posSide === 'long') {
            // Long close: profit when exit > entry
            pnl = math.multiply(math.subtract(exitPrice, entryPrice), filledQty);
          } else {
            // Short close: profit when entry > exit
            pnl = math.multiply(math.subtract(entryPrice, exitPrice), filledQty);
          }

          // Subtract fee
          if (trade.fee && !math.isZero(trade.fee)) {
            pnl = math.subtract(pnl, trade.fee);
          }
        }
      }

      // Persist PnL if calculated
      if (pnl !== null) {
        await Trade.findByIdAndUpdate(trade._id, { $set: { pnl } });

        // Record trade with riskEngine for circuit breaker tracking
        this.riskEngine.recordTrade({ pnl });

        log.trade('_handleOrderFilled — PnL calculated', {
          orderId: trade.orderId,
          symbol: trade.symbol,
          pnl,
          posSide: trade.posSide,
        });
      }

      this.emit(TRADE_EVENTS.ORDER_FILLED, {
        trade: trade.toObject(),
        pnl,
      });
    } catch (err) {
      log.error('_handleOrderFilled — error processing filled trade', { error: err });
    }
  }

  // =========================================================================
  // Public — Queries
  // =========================================================================

  /**
   * Get all open (non-terminal) trades, optionally filtered by session.
   *
   * @param {string} [sessionId] — bot session id filter
   * @returns {Promise<Array>}
   */
  async getOpenTrades(sessionId) {
    try {
      const query = {
        status: {
          $nin: [
            ORDER_STATUS.FILLED,
            ORDER_STATUS.CANCELLED,
            ORDER_STATUS.REJECTED,
            ORDER_STATUS.FAILED,
          ],
        },
      };
      if (sessionId) query.sessionId = sessionId;

      const trades = await Trade.find(query).sort({ createdAt: -1 }).lean();
      return trades;
    } catch (err) {
      log.error('getOpenTrades — query failed', { error: err });
      return [];
    }
  }

  /**
   * Get historical trades with optional filters.
   *
   * @param {object} [filters]
   * @param {string} [filters.sessionId] — bot session filter
   * @param {string} [filters.symbol]    — symbol filter
   * @param {number} [filters.limit=50]  — max results
   * @param {number} [filters.skip=0]    — pagination offset
   * @returns {Promise<Array>}
   */
  async getTradeHistory({ sessionId, symbol, strategy, limit = 50, skip = 0 } = {}) {
    try {
      const query = {};
      if (sessionId) query.sessionId = sessionId;
      if (symbol) query.symbol = symbol;
      if (strategy) query.strategy = strategy;

      const trades = await Trade.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return trades;
    } catch (err) {
      log.error('getTradeHistory — query failed', { error: err });
      return [];
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Remove WS event listeners and clear locks.
   * Call when shutting down the OrderManager.
   * R14-16: Also clear _symbolLocks to prevent stale lock references.
   */
  destroy() {
    this.exchangeClient.removeListener('ws:order', this._handleWsOrderUpdate);
    this.exchangeClient.removeListener('ws:fill', this._handleWsFillUpdate);
    this._symbolLocks.clear(); // R14-16
    this._leverageCache.clear();
    log.info('OrderManager destroyed — WS listeners + locks cleared');
  }
}

module.exports = OrderManager;
