'use client';

import { useState, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import { useAdaptivePolling } from './useAdaptivePolling';
import type { Trade } from '@/types';
import type { BotState } from '@/types';

export function useTrades(sessionId?: string | null, botState: BotState = 'idle') {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      const [history, open] = await Promise.all([
        tradeApi.getHistory({ sessionId: sessionId || undefined, limit: 50 }),
        tradeApi.getOpen(sessionId || undefined),
      ]);
      setTrades(history);
      setOpenTrades(open);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useAdaptivePolling(fetchTrades, 'trades', botState);

  return { trades, openTrades, loading, error, refetch: fetchTrades };
}
