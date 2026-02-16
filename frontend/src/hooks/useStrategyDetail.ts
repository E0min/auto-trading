'use client';

import { useState, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import { useAdaptivePolling } from '@/hooks/useAdaptivePolling';
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

  // Use adaptive polling instead of manual setInterval.
  // When strategyName is null, fetchStats does an early return (no fetch).
  // The 'trades' config gives 10s active / 30s idle intervals with visibility awareness.
  useAdaptivePolling(
    fetchStats,
    'trades',
    strategyName ? 'running' : 'idle',
  );

  return { stats, loading, error };
}
