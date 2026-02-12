'use client';

import { useState, useEffect, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import type { Trade } from '@/types';

export function useTrades(sessionId?: string | null, pollInterval = 10000) {
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

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, pollInterval);
    return () => clearInterval(interval);
  }, [fetchTrades, pollInterval]);

  return { trades, openTrades, loading, error, refetch: fetchTrades };
}
