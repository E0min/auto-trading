'use strict';

const mongoose = require('mongoose');
const { SIGNAL_ACTIONS } = require('../utils/constants');

const signalActionValues = Object.values(SIGNAL_ACTIONS);

/**
 * Signal schema — records strategy-generated trading signals.
 *
 * Each signal captures the strategy recommendation, market context at
 * the time of generation, and the outcome (approved/rejected, resulting order).
 */
const signalSchema = new mongoose.Schema(
  {
    strategy: {
      type: String,
      required: true,
    },
    symbol: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: signalActionValues,
      required: true,
    },
    category: {
      type: String,
    },
    suggestedQty: {
      type: String,
    },
    suggestedPrice: {
      type: String,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    riskApproved: {
      type: Boolean,
      default: null,
    },
    rejectReason: {
      type: String,
    },
    marketContext: {
      type: mongoose.Schema.Types.Mixed,
    },
    resultOrderId: {
      type: String,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BotSession',
    },
  },
  {
    timestamps: true,
  }
);

// E11-5: Compound indexes for common query patterns
signalSchema.index({ sessionId: 1, createdAt: -1 });
signalSchema.index({ strategy: 1, createdAt: -1 });
signalSchema.index({ symbol: 1, createdAt: -1 });

const Signal = mongoose.model('Signal', signalSchema);

module.exports = Signal;
