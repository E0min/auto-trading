'use strict';

const mongoose = require('mongoose');
const { CATEGORIES, ORDER_SIDES, ORDER_TYPES, POS_SIDES, ORDER_STATUS } = require('../utils/constants');

const categoryValues = Object.values(CATEGORIES);
const orderSideValues = Object.values(ORDER_SIDES);
const orderTypeValues = Object.values(ORDER_TYPES);
const posSideValues = Object.values(POS_SIDES);
const orderStatusValues = Object.values(ORDER_STATUS);

/**
 * Trade schema — tracks the full lifecycle of an exchange order.
 *
 * All monetary fields (qty, price, fee, pnl, etc.) are stored as
 * String to prevent floating-point precision loss.
 */
const tradeSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    clientOid: {
      type: String,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: categoryValues,
    },
    side: {
      type: String,
      enum: orderSideValues,
    },
    posSide: {
      type: String,
      enum: posSideValues,
    },
    orderType: {
      type: String,
      enum: orderTypeValues,
    },
    qty: {
      type: String,
      required: true,
    },
    price: {
      type: String,
    },
    filledQty: {
      type: String,
      default: '0',
    },
    avgFilledPrice: {
      type: String,
    },
    fee: {
      type: String,
      default: '0',
    },
    status: {
      type: String,
      enum: orderStatusValues,
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    signalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Signal',
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BotSession',
    },
    strategy: {
      type: String,
    },
    reduceOnly: {
      type: Boolean,
      default: false,
    },
    takeProfitPrice: {
      type: String,
    },
    stopLossPrice: {
      type: String,
    },
    pnl: {
      type: String,
    },
    fundingPnl: {
      type: String,
      default: '0',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying trades within a session ordered by time
tradeSchema.index({ sessionId: 1, createdAt: -1 });

const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;
