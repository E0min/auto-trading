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
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || '요청 실패');
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
  disableStrategy: (name: string) =>
    request<{ message: string }>(`/api/bot/strategies/${name}/disable`, { method: 'POST' }),
};

// Trades
export const tradeApi = {
  getHistory: (params?: { sessionId?: string; symbol?: string; limit?: number; skip?: number }) => {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.symbol) query.set('symbol', params.symbol);
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
  getSignals: (params?: { sessionId?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<Signal[]>(`/api/trades/signals${qs ? `?${qs}` : ''}`);
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
  getDaily: (sessionId: string) => request<Record<string, unknown>>(`/api/analytics/daily/${sessionId}`),
  getByStrategy: (sessionId: string) => request<Record<string, unknown>>(`/api/analytics/by-strategy/${sessionId}`),
  getBySymbol: (sessionId: string) => request<Record<string, unknown>>(`/api/analytics/by-symbol/${sessionId}`),
};

// Health
export const healthApi = {
  check: () => request<HealthReport>('/api/health'),
  ping: async () => {
    const res = await fetch(`${API_BASE}/api/health/ping`);
    return res.json() as Promise<{ pong: boolean; timestamp: string }>;
  },
};
