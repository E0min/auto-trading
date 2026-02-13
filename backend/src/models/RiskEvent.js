'use strict';

const mongoose = require('mongoose');

/**
 * RiskEvent — persists risk-engine events to MongoDB for audit trail
 * and frontend history. TTL of 30 days via expireAfterSeconds index.
 */
const riskEventSchema = new mongoose.Schema(
  {
    sessionId: { type: String, index: true },
    eventType: {
      type: String,
      required: true,
      enum: [
        'circuit_break',
        'circuit_reset',
        'drawdown_warning',
        'drawdown_halt',
        'exposure_adjusted',
        'order_rejected',
        'equity_insufficient',
        'emergency_stop',
        'process_error',
      ],
    },
    severity: {
      type: String,
      required: true,
      enum: ['info', 'warning', 'critical'],
    },
    source: { type: String, required: true },
    symbol: String,
    reason: { type: String, required: true },
    details: mongoose.Schema.Types.Mixed,
    riskSnapshot: {
      equity: String,
      drawdownPercent: String,
      consecutiveLosses: Number,
      isCircuitBroken: Boolean,
      isDrawdownHalted: Boolean,
      openPositionCount: Number,
      peakEquity: String,
    },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Compound index for filtering by type + resolved state, newest first
riskEventSchema.index({ eventType: 1, acknowledged: 1, createdAt: -1 });

// Session-based queries (analytics)
riskEventSchema.index({ sessionId: 1, createdAt: -1 });

// TTL index — auto-delete after 30 days
riskEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

riskEventSchema.statics.getUnacknowledged = function () {
  return this.find({ acknowledged: false }).sort({ createdAt: -1 }).limit(50);
};

riskEventSchema.statics.acknowledge = function (id) {
  return this.findByIdAndUpdate(
    id,
    { acknowledged: true, acknowledgedAt: new Date() },
    { new: true },
  );
};

module.exports = mongoose.model('RiskEvent', riskEventSchema);
