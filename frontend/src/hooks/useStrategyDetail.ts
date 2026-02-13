'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import type { StrategyStats } from '@/types';

interface UseStrategyDetailReturn {
  stats: StrategyStats | null;
  loading: boolean;
  error: string | null;
}

export function useStrategyDetail(
  strategyName: string | null,
  sessionId?: string | null,
): UseStrategyDetailReturn {
  const [stats, setStats] = useState<StrategyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    if (!strategyName) return;
    try {
      const data = await tradeApi.getStrategyStats(
        strategyName,
        sessionId ?? undefined,
      );
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [strategyName, sessionId]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!strategyName) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    fetchStats();

    intervalRef.current = setInterval(fetchStats, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [strategyName, fetchStats]);

  return { stats, loading, error };
}
