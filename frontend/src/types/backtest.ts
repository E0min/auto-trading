// Backtest configuration sent to POST /api/backtest/run
export interface BacktestConfig {
  strategyName: string;
  strategyConfig?: Record<string, unknown>;
  symbol: string;
  interval: string;
  startTime: number; // epoch ms
  endTime: number;   // epoch ms
  initialCapital: string;
  makerFee?: string;
  takerFee?: string;
  slippage?: string;
  leverage?: string;
  marketRegime?: string | null;
}

// A single backtest trade
export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: string;
  exitPrice: string;
  side: 'long' | 'short';
  qty: string;
  pnl: string;
  fee: string;
}

// A single equity curve point
export interface BacktestEquityPoint {
  ts: number;
  equity: string;
  cash: string;
  unrealizedPnl?: string;
}

// Performance metrics
export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  totalPnl: string;
  totalReturn: string;
  avgWin: string;
  avgLoss: string;
  largestWin: string;
  largestLoss: string;
  profitFactor: string;
  maxDrawdown: string;
  maxDrawdownPercent: string;
  sharpeRatio: string;
  sortinoRatio: string;
  calmarRatio: string;
  avgHoldTime: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  totalFees: string;
  totalFundingCost?: string;
  finalEquity: string;
}

// Full backtest result (from GET /api/backtest/:id)
export interface BacktestResult {
  id: string;
  status: 'running' | 'completed' | 'error';
  progress?: number;
  config: BacktestConfig;
  metrics: BacktestMetrics | null;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  error?: string;
  createdAt: string;
}

// Summary item for list view (no equityCurve/trades)
export interface BacktestSummary {
  id: string;
  status: 'running' | 'completed' | 'error';
  config: BacktestConfig;
  metrics: BacktestMetrics | null;
  createdAt: string;
}

// Strategy list item from GET /api/backtest/strategies
export interface BacktestStrategyItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
}
