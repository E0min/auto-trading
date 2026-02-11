'use strict';

const mongoose = require('mongoose');

/**
 * Snapshot schema — periodic account and position snapshots.
 *
 * Snapshots are taken at regular intervals to track equity curves,
 * balance changes, and position exposure over time. A TTL index
 * automatically purges records older than 90 days.
 */
const positionSubSchema = new mongoose.Schema(
  {
    symbol: { type: String },
    posSide: { type: String },
    qty: { type: String },
    entryPrice: { type: String },
    markPrice: { type: String },
    unrealizedPnl: { type: String },
    leverage: { type: String },
  },
  {
    _id: false,
  }
);

const snapshotSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BotSession',
      index: true,
    },
    equity: {
      type: String,
      required: true,
    },
    availableBalance: {
      type: String,
    },
    unrealizedPnl: {
      type: String,
    },
    positions: {
      type: [positionSubSchema],
      default: [],
    },
    openOrderCount: {
      type: Number,
    },
    dailyPnl: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index — automatically delete snapshots after 90 days
const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;
snapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_IN_SECONDS });

// Compound index for querying snapshots within a session ordered by time
snapshotSchema.index({ sessionId: 1, createdAt: -1 });

const Snapshot = mongoose.model('Snapshot', snapshotSchema);

module.exports = Snapshot;
