import type {
  BotStatus,
  StrategyListItem,
  Trade,
  Signal,
  Position,
  AccountState,
  SessionStats,
  EquityPoint,
  HealthReport,
  TournamentInfo,
  LeaderboardEntry,
  StrategyDetail,
  StrategyStats,
  RiskEvent,
  RiskStatus,
  StrategyPerformanceEntry,
  SymbolPerformanceEntry,
  DailyPerformanceEntry,
  RegimeContext,
  RegimeHistoryEntry,
  CoinScoringData,
  StrategyRoutingData,
} from '@/types';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestSummary,
  BacktestEquityPoint,
  BacktestTrade,
  BacktestStrategyItem,
} from '@/types/backtest';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

export class ApiError extends Error {
  public statusCode: number;
  public endpoint: string;
  public isNetworkError: boolean;
  public traceId: string | null;

  constructor(message: string, statusCode: number, endpoint: string, isNetworkError: boolean = false, traceId?: string | null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.isNetworkError = isNetworkError;
    this.traceId = traceId ?? null;
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다', 0, endpoint, true);
  }

  const traceId = res.headers.get('x-trace-id') ?? null;

  let json: { success: boolean; data: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`서버 응답 파싱 실패 (HTTP ${res.status})`, res.status, endpoint, false, traceId);
  }

  if (!res.ok || !json.success) {
    throw new ApiError(json.error || '요청 실패', res.status, endpoint, false, traceId);
  }
  return json.data;
}

// Bot Control
export const botApi = {
  getStatus: () => request<BotStatus>('/api/bot/status'),
  start: (config?: Record<string, unknown>) =>
    request<BotStatus>('/api/bot/start', { method: 'POST', body: JSON.stringify(config || {}) }),
  stop: () => request<BotStatus>('/api/bot/stop', { method: 'POST' }),
  pause: () => request<BotStatus>('/api/bot/pause', { method: 'POST' }),
  resume: () => request<BotStatus>('/api/bot/resume', { method: 'POST' }),
  emergencyStop: () => request<BotStatus>('/api/bot/emergency-stop', { method: 'POST' }),
  updateRiskParams: (params: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/bot/risk-params', { method: 'PUT', body: JSON.stringify({ params }) }),
  getStrategies: () => request<{ strategies: StrategyListItem[] }>('/api/bot/strategies'),
  enableStrategy: (name: string, config?: Record<string, unknown>) =>
    request<{ message: string }>(`/api/bot/strategies/${name}/enable`, {
      method: 'POST',
      body: JSON.stringify(config || {}),
    }),
  disableStrategy: (name: string, mode: 'immediate' | 'graceful' = 'immediate') =>
    request<{ message: string }>(`/api/bot/strategies/${name}/disable`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  getTradingMode: () =>
    request<{ mode: string }>('/api/bot/trading-mode'),
  setTradingMode: (mode: string) =>
    request<{ mode: string }>('/api/bot/trading-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  updateStrategyConfig: (name: string, config: Record<string, unknown>) =>
    request<{ name: string; config: Record<string, unknown> }>(`/api/bot/strategies/${name}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

// Trades
export const tradeApi = {
  getHistory: (params?: { sessionId?: string; symbol?: string; strategy?: string; limit?: number; skip?: number }) => {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.symbol) query.set('symbol', params.symbol);
    if (params?.strategy) query.set('strategy', params.strategy);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.skip) query.set('skip', String(params.skip));
    const qs = query.toString();
    return request<Trade[]>(`/api/trades${qs ? `?${qs}` : ''}`);
  },
  getOpen: (sessionId?: string) => {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    return request<Trade[]>(`/api/trades/open${qs}`);
  },
  getPositions: () => request<{ positions: Position[]; accountState: AccountState }>('/api/trades/positions'),
  getSignals: (params?: { sessionId?: string; strategy?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.strategy) query.set('strategy', params.strategy);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<Signal[]>(`/api/trades/signals${qs ? `?${qs}` : ''}`);
  },
  getStrategyStats: (name: string, sessionId?: string) => {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    return request<StrategyStats>(`/api/trades/strategy-stats/${name}${qs}`);
  },
  submitOrder: (order: { symbol: string; action: string; [key: string]: unknown }) =>
    request<Trade>('/api/trades/order', { method: 'POST', body: JSON.stringify(order) }),
  cancelOrder: (orderId: string, params?: { symbol?: string; category?: string }) => {
    const query = new URLSearchParams();
    if (params?.symbol) query.set('symbol', params.symbol);
    if (params?.category) query.set('category', params.category);
    const qs = query.toString();
    return request<Trade>(`/api/trades/order/${orderId}${qs ? `?${qs}` : ''}`, { method: 'DELETE' });
  },
};

// Analytics
export const analyticsApi = {
  getSession: (sessionId: string) => request<SessionStats>(`/api/analytics/session/${sessionId}`),
  getEquityCurve: (sessionId: string) => request<EquityPoint[]>(`/api/analytics/equity-curve/${sessionId}`),
  getDaily: (sessionId: string) => request<DailyPerformanceEntry[]>(`/api/analytics/daily/${sessionId}`),
  getByStrategy: (sessionId: string) => request<Record<string, StrategyPerformanceEntry>>(`/api/analytics/by-strategy/${sessionId}`),
  getBySymbol: (sessionId: string) => request<Record<string, SymbolPerformanceEntry>>(`/api/analytics/by-symbol/${sessionId}`),
};

// Health
export const healthApi = {
  check: () => request<HealthReport>('/api/health'),
  ping: async () => {
    const res = await fetch(`${API_BASE}/api/health/ping`);
    return res.json() as Promise<{ pong: boolean; timestamp: string }>;
  },
};

// Tournament
export const tournamentApi = {
  getInfo: () => request<TournamentInfo>('/api/tournament/info'),
  start: (config?: { strategies?: string[]; initialBalance?: string }) =>
    request<TournamentInfo>('/api/tournament/start', { method: 'POST', body: JSON.stringify(config || {}) }),
  stop: () => request<TournamentInfo>('/api/tournament/stop', { method: 'POST' }),
  reset: (config?: { initialBalance?: string; clearTrades?: boolean }) =>
    request<{ message: string; info: TournamentInfo }>('/api/tournament/reset', { method: 'POST', body: JSON.stringify(config || {}) }),
  getLeaderboard: () => request<{ tournament: TournamentInfo; leaderboard: LeaderboardEntry[] }>('/api/tournament/leaderboard'),
  getStrategyDetail: (name: string) => request<StrategyDetail>(`/api/tournament/strategy/${name}`),
};

// Risk
export const riskApi = {
  getEvents: (params?: { sessionId?: string; severity?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<RiskEvent[]>(`/api/risk/events${qs ? `?${qs}` : ''}`);
  },
  getUnacknowledged: () => request<RiskEvent[]>('/api/risk/events/unacknowledged'),
  acknowledge: (id: string) =>
    request<RiskEvent>(`/api/risk/events/${id}/acknowledge`, { method: 'PUT' }),
  getStatus: () => request<RiskStatus>('/api/risk/status'),
  resetDrawdown: (type: 'daily' | 'full' = 'daily') =>
    request<RiskStatus>('/api/risk/drawdown/reset', {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
};

// Regime / Market Intelligence
export const regimeApi = {
  getStatus: () => request<RegimeContext>('/api/regime/status'),
  getHistory: (limit?: number) =>
    request<RegimeHistoryEntry[]>(`/api/regime/history${limit ? `?limit=${limit}` : ''}`),
  getCoinScoring: () => request<CoinScoringData>('/api/regime/coin-scoring'),
  getStrategyRouting: () => request<StrategyRoutingData>('/api/regime/strategy-routing'),
};

// Backtest
export const backtestApi = {
  run: (config: BacktestConfig) =>
    request<{ id: string }>('/api/backtest/run', { method: 'POST', body: JSON.stringify(config) }),
  list: () => request<BacktestSummary[]>('/api/backtest'),
  getResult: (id: string) => request<BacktestResult>(`/api/backtest/${id}`),
  getEquityCurve: (id: string, maxPoints?: number) => {
    const qs = maxPoints ? `?maxPoints=${maxPoints}` : '';
    return request<BacktestEquityPoint[]>(`/api/backtest/${id}/equity-curve${qs}`);
  },
  getTrades: (id: string, params?: { limit?: number; skip?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.skip) query.set('skip', String(params.skip));
    const qs = query.toString();
    return request<BacktestTrade[]>(`/api/backtest/${id}/trades${qs ? `?${qs}` : ''}`);
  },
  delete: (id: string) => request<{ message: string }>(`/api/backtest/${id}`, { method: 'DELETE' }),
  getStrategies: () => request<BacktestStrategyItem[]>('/api/backtest/strategies'),
};
