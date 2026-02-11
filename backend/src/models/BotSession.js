'use strict';

const mongoose = require('mongoose');
const { BOT_STATES } = require('../utils/constants');

const botStateValues = Object.values(BOT_STATES);

/**
 * BotSession schema — represents a single execution session of the trading bot.
 *
 * Captures configuration at start time, accumulates runtime stats, and
 * records the reason for stopping.
 */
const statsSubSchema = new mongoose.Schema(
  {
    totalTrades: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    totalPnl: { type: String, default: '0' },
    maxDrawdown: { type: String, default: '0' },
    peakEquity: { type: String, default: '0' },
  },
  {
    _id: false,
  }
);

const botSessionSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: botStateValues,
      default: BOT_STATES.IDLE,
    },
    startedAt: {
      type: Date,
    },
    stoppedAt: {
      type: Date,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
    },
    strategies: {
      type: [String],
      default: [],
    },
    symbols: {
      type: [String],
      default: [],
    },
    stats: {
      type: statsSubSchema,
      default: () => ({}),
    },
    stopReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const BotSession = mongoose.model('BotSession', botSessionSchema);

module.exports = BotSession;
