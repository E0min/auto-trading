// Bot status types
export type BotState = 'idle' | 'running' | 'paused' | 'stopping' | 'error';

export interface BotStatus {
  running: boolean;
  sessionId: string | null;
  status: BotState;
  strategies: StrategyInfo[];
  symbols: string[];
  registeredStrategies: string[];
  riskStatus: RiskStatus;
}

export interface StrategyInfo {
  name: string;
  active: boolean;
  symbol: string;
  config: Record<string, unknown>;
  lastSignal: Signal | null;
}

// Risk types
export interface RiskStatus {
  circuitBreaker: {
    tripped: boolean;
    reason: string | null;
    trippedAt: string | null;
  };
  exposureGuard: {
    totalExposure: string;
    maxExposure: string;
    utilizationPercent: string;
  };
  drawdownMonitor: {
    currentDrawdown: string;
    maxDrawdown: string;
    halted: boolean;
    peakEquity: string;
  };
  accountState: {
    equity: string;
    positionCount: number;
  };
}

// Trade types
export type TradeStatus = 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'failed';
export type TradeSide = 'buy' | 'sell';
export type PosSide = 'long' | 'short';

export interface Trade {
  _id: string;
  orderId: string;
  clientOid: string;
  symbol: string;
  category: string;
  side: TradeSide;
  posSide: PosSide;
  orderType: 'limit' | 'market';
  qty: string;
  price: string;
  filledQty: string;
  avgFilledPrice: string;
  fee: string;
  status: TradeStatus;
  signalId: string;
  sessionId: string;
  strategy: string;
  reduceOnly: boolean;
  takeProfitPrice: string;
  stopLossPrice: string;
  pnl: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Position types
export interface Position {
  symbol: string;
  posSide: PosSide;
  qty: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
  liquidationPrice: string;
  margin: string;
}

// Account types
export interface AccountState {
  equity: string;
  availableBalance: string;
  unrealizedPnl: string;
}

// Signal types
export type SignalAction = 'open_long' | 'open_short' | 'close_long' | 'close_short';

export interface Signal {
  _id: string;
  strategy: string;
  symbol: string;
  action: SignalAction;
  category: string;
  suggestedQty: string;
  suggestedPrice: string;
  confidence: number;
  riskApproved: boolean | null;
  rejectReason: string | null;
  marketContext: Record<string, unknown>;
  resultOrderId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

// Analytics types
export interface EquityPoint {
  timestamp: string;
  equity: string;
  unrealizedPnl: string;
}

export interface SessionStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  maxDrawdown: string;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  profitFactor: string;
  sharpeRatio: string;
}

// Health types
export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  services: Record<string, { status: string; latency?: number }>;
  timestamp: string;
}

// Market types
export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';

export interface MarketRegimeData {
  regime: MarketRegime;
  confidence: number;
  timestamp: string;
}

// Strategy list item (from GET /api/bot/strategies)
export interface StrategyListItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  active: boolean;
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// Socket event payloads
export interface OrderSubmittedEvent {
  orderId: string;
  symbol: string;
  side: TradeSide;
  qty: string;
}

export interface OrderFilledEvent {
  orderId: string;
  filledQty: string;
  avgFilledPrice: string;
}

export interface RiskEvent {
  reason: string;
  timestamp: string;
  currentDrawdown?: string;
  maxDrawdown?: string;
  totalExposure?: string;
  maxExposure?: string;
}
