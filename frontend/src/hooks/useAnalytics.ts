'use client';

import { useState, useEffect, useCallback } from 'react';
import { analyticsApi } from '@/lib/api-client';
import type { EquityPoint, SessionStats } from '@/types';

export function useAnalytics(sessionId: string | null) {
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const [curve, stats] = await Promise.all([
        analyticsApi.getEquityCurve(sessionId),
        analyticsApi.getSession(sessionId),
      ]);
      setEquityCurve(curve);
      setSessionStats(stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { equityCurve, sessionStats, loading, error, refetch: fetchAnalytics };
}
