'use strict';

/**
 * Shared constants and enumerations for the Bitget auto-trading platform.
 * All values are immutable (frozen).
 */

const CATEGORIES = Object.freeze({
  SPOT: 'SPOT',
  USDT_FUTURES: 'USDT-FUTURES',
  COIN_FUTURES: 'COIN-FUTURES',
  USDC_FUTURES: 'USDC-FUTURES',
});

const ORDER_SIDES = Object.freeze({
  BUY: 'buy',
  SELL: 'sell',
});

const ORDER_TYPES = Object.freeze({
  LIMIT: 'limit',
  MARKET: 'market',
});

const POS_SIDES = Object.freeze({
  LONG: 'long',
  SHORT: 'short',
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  OPEN: 'open',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  FAILED: 'failed',
});

const SIGNAL_ACTIONS = Object.freeze({
  OPEN_LONG: 'open_long',
  OPEN_SHORT: 'open_short',
  CLOSE_LONG: 'close_long',
  CLOSE_SHORT: 'close_short',
});

const MARKET_REGIMES = Object.freeze({
  TRENDING_UP: 'trending_up',
  TRENDING_DOWN: 'trending_down',
  RANGING: 'ranging',
  VOLATILE: 'volatile',
  QUIET: 'quiet',
});

const BOT_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPING: 'stopping',
  ERROR: 'error',
});

const RISK_EVENTS = Object.freeze({
  ORDER_VALIDATED: 'risk:order_validated',
  ORDER_REJECTED: 'risk:order_rejected',
  CIRCUIT_BREAK: 'risk:circuit_break',
  CIRCUIT_RESET: 'risk:circuit_reset',
  DRAWDOWN_WARNING: 'risk:drawdown_warning',
  DRAWDOWN_HALT: 'risk:drawdown_halt',
  DRAWDOWN_RESET: 'risk:drawdown_reset',
  EXPOSURE_ADJUSTED: 'risk:exposure_adjusted',
  UNHANDLED_ERROR: 'risk:unhandled_error',
});

const MARKET_EVENTS = Object.freeze({
  TICKER_UPDATE: 'market:ticker',
  KLINE_UPDATE: 'market:kline',
  BOOK_UPDATE: 'market:book',
  REGIME_CHANGE: 'market:regime_change',
  SYMBOL_REGIME_CHANGE: 'symbol:regime_change',
  COIN_SELECTED: 'market:coin_selected',
});

const TRADE_EVENTS = Object.freeze({
  ORDER_SUBMITTED: 'trade:order_submitted',
  ORDER_FILLED: 'trade:order_filled',
  ORDER_CANCELLED: 'trade:order_cancelled',
  POSITION_UPDATED: 'trade:position_updated',
  SIGNAL_GENERATED: 'trade:signal_generated',
  SIGNAL_SKIPPED: 'trade:signal_skipped',
});

const DEFAULT_RISK_PARAMS = Object.freeze({
  maxPositionSizePercent: '5',
  maxTotalExposurePercent: '30',
  maxDailyLossPercent: '3',
  maxDrawdownPercent: '10',
  maxRiskPerTradePercent: '2',   // 2% rule — max loss per single trade as % of equity
  consecutiveLossLimit: 5,
  cooldownMinutes: 30,
});

const WS_INST_TYPES = Object.freeze({
  PUBLIC_FUTURES: 'usdt-futures',
  PRIVATE: 'UTA',
});

const REGIME_EVENTS = Object.freeze({
  OPTIMIZER_CYCLE_START: 'optimizer:cycle_start',
  OPTIMIZER_CYCLE_COMPLETE: 'optimizer:cycle_complete',
  PARAMS_UPDATED: 'params:updated',
  EVALUATION_COMPLETE: 'evaluation:complete',
});

module.exports = {
  CATEGORIES,
  ORDER_SIDES,
  ORDER_TYPES,
  POS_SIDES,
  ORDER_STATUS,
  SIGNAL_ACTIONS,
  MARKET_REGIMES,
  BOT_STATES,
  RISK_EVENTS,
  MARKET_EVENTS,
  TRADE_EVENTS,
  DEFAULT_RISK_PARAMS,
  WS_INST_TYPES,
  REGIME_EVENTS,
};
