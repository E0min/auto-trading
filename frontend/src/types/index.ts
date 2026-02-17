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
  paperMode?: boolean;
  tradingMode?: 'live' | 'paper';
  paperAccount?: AccountState;
  regime?: MarketRegimeData;
  symbolRegimes?: Record<string, SymbolRegimeEntry>;
}

export type GraceState = 'active' | 'grace_period' | 'inactive';

export interface StrategyInfo {
  name: string;
  active: boolean;
  graceState?: GraceState;
  graceExpiresAt?: string | null;
  symbol: string;
  symbols: string[];     // T0-3: all active symbols
  targetRegimes: string[];
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
  stopLossPrice?: string;
  strategy?: string | null;
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
  positionSizePercent?: string;  // T0-2: original percentage
  resolvedQty?: string;          // T0-2: resolved absolute quantity
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
export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'quiet' | 'unknown';

export interface MarketRegimeData {
  regime: MarketRegime;
  confidence: number;
  timestamp: string;
  transitionsLastHour?: number;
  cooldownStatus?: {
    active: boolean;
    remainingMs: number;
  };
  lastTransitionTs?: string;
}

export interface SymbolRegimeEntry {
  regime: MarketRegime;
  confidence: number;
  warmedUp: boolean;
}

// Strategy parameter metadata (for tuning UI)
export interface ParamMeta {
  field: string;
  label: string;
  type: 'integer' | 'percent' | 'decimal' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  group?: 'signal' | 'indicator' | 'risk' | 'sizing';
  description?: string;
}

// Strategy docs metadata (from backend strategy files)
export interface StrategyDocs {
  summary: string;
  timeframe: string;
  entry: {
    long: string;
    short: string;
    conditions?: string[];
  };
  exit: {
    tp: string;
    sl: string;
    trailing: string;
    other?: string[];
  };
  indicators: string[];
  riskReward: {
    tp: string;
    sl: string;
    ratio: string;
  };
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
  warnings: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

// Strategy runtime info (when bot is running)
export interface StrategyRuntime {
  currentConfig: Record<string, unknown> | null;
  assignedSymbols: string[];
}

// Strategy list item (from GET /api/bot/strategies)
export interface StrategyListItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  targetRegimes: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  active: boolean;
  graceState?: GraceState;
  graceExpiresAt?: string | null;
  paramMeta?: ParamMeta[];
  // R13-7: additional metadata
  docs?: StrategyDocs | null;
  maxConcurrentPositions?: number;
  cooldownMs?: number;
  warmupCandles?: number;
  volatilityPreference?: 'high' | 'low' | 'neutral';
  maxSymbolsPerStrategy?: number;
  runtime?: StrategyRuntime;
}

// Tournament types
export interface TournamentInfo {
  tournamentId: string | null;
  running: boolean;
  startedAt: string | null;
  strategyCount: number;
  initialBalance: string;
}

export interface LeaderboardEntry {
  rank: number;
  strategy: string;
  equity: string;
  pnl: string;
  pnlPercent: string;
  unrealizedPnl: string;
  positionCount: number;
}

export interface StrategyDetail {
  strategy: string;
  account: AccountState;
  positions: Position[];
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: string;
  };
  recentTrades: Trade[];
}

// Strategy stats (from GET /api/trades/strategy-stats/:name)
export interface StrategyStats {
  strategy: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  totalPnl: string;
  recentTrades: Trade[];
  recentSignals: Signal[];
}

// Performance analytics types
export interface StrategyPerformanceEntry {
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRate: string;
}

export interface SymbolPerformanceEntry {
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRate: string;
}

export interface DailyPerformanceEntry {
  date: string;
  trades: number;
  pnl: string;
  wins: number;
  losses: number;
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
  _id: string;
  sessionId?: string;
  eventType: 'circuit_break' | 'circuit_reset' | 'drawdown_warning' | 'drawdown_halt' |
             'exposure_adjusted' | 'order_rejected' | 'equity_insufficient' | 'emergency_stop' |
             'process_error';
  severity: 'info' | 'warning' | 'critical';
  source: string;
  symbol?: string;
  reason: string;
  details?: Record<string, unknown>;
  riskSnapshot?: {
    equity: string;
    drawdownPercent?: string;
    consecutiveLosses?: number;
    isCircuitBroken?: boolean;
    isDrawdownHalted?: boolean;
    openPositionCount?: number;
    peakEquity?: string;
  };
  acknowledged: boolean;
  acknowledgedAt?: string;
  createdAt: string;
  timestamp?: string;
}

// --- Market Intelligence types ---

export interface RegimeHistoryEntry {
  previous: MarketRegime | null;
  current: MarketRegime;
  confidence: number;
  scores: Record<string, number>;
  btcPrice: number;
  ema9: number;
  sma20: number;
  sma50: number;
  atr: number;
  advancers?: number;
  decliners?: number;
  tickerCount?: number;
  ts: number;
}

export interface CoinFactorScores {
  volume?: number;
  spreadInv?: number;
  openInterest?: number;
  fundingInv?: number;
  momentum?: number;
  volatility?: number;
  volMomentum?: number;
  marketCapRank?: number;
  [key: string]: number | undefined;
}

export interface ScoredCoin {
  symbol: string;
  score: string;
  vol24h: string;
  change24h: string;
  spread: string;
  lastPrice: string;
  openInterest?: string;
  fundingRate?: string;
  volatility?: string;
  regime?: string;
  marketCap?: string;
  marketCapRank?: string;
  _factorScores: CoinFactorScores;
}

export interface WeightProfile {
  regime: string;
  method?: string;
  weights: CoinFactorScores;
}

export interface CoinScoringData {
  coins: ScoredCoin[];
  weightProfile: WeightProfile | null;
}

export interface StrategyRoutingEntry {
  name: string;
  active: boolean;
  graceState?: GraceState;
  graceExpiresAt?: string | null;
  targetRegimes: string[];
  matchesCurrentRegime: boolean;
}

export interface StrategyRoutingData {
  running: boolean;
  currentRegime: string | null;
  strategies: StrategyRoutingEntry[];
  activeCount: number;
  totalCount: number;
  gracePeriodCount?: number;
  gracePeriods?: Record<string, { expiresAt: string; remainingMs: number }>;
  regimeBreakdown: Record<string, { active: string[]; inactive: string[] }>;
}

export interface RegimeContext {
  regime: MarketRegime;
  confidence: number;
  factorScores?: Record<string, number>;
  ema9?: number;
  sma20?: number;
  sma50?: number;
  atr?: number;
  btcPrice?: number;
  aggregateStats?: {
    advancers: number;
    decliners: number;
    tickerCount: number;
  };
  pendingRegime?: string | null;
  pendingCount?: number;
  hysteresisMinCandles?: number;
  historyLength?: number;
  transitionsLastHour?: number;
  cooldownStatus?: {
    active: boolean;
    remainingMs: number;
  };
  lastTransitionTs?: string;
}

// Grace period socket event payloads
export interface GraceStartedEvent {
  strategy: string;
  graceExpiresAt: string;
  reason: string;
  previousRegime: string;
  newRegime: string;
}

export interface GraceCancelledEvent {
  strategy: string;
  reason: string;
}

export interface StrategyDeactivatedEvent {
  strategy: string;
  reason: string;
}

// Extended RiskStatus with optional sub-engine detail fields
export interface RiskStatusExtended extends RiskStatus {
  drawdownMonitor: RiskStatus['drawdownMonitor'] & {
    params?: { maxDrawdownPercent?: string };
    drawdownPercent?: string;
  };
  circuitBreaker: RiskStatus['circuitBreaker'] & {
    consecutiveLosses?: number;
    consecutiveLossLimit?: number;
    params?: { consecutiveLossLimit?: number };
  };
}

// Legacy RiskEvent compat (for useSocket inline events that lack full schema)
export interface RiskEventLegacy {
  reason: string;
  timestamp: string;
  currentDrawdown?: string;
  maxDrawdown?: string;
  totalExposure?: string;
  maxExposure?: string;
}
