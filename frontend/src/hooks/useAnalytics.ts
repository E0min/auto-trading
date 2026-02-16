'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { analyticsApi } from '@/lib/api-client';
import { useAdaptivePolling } from '@/hooks/useAdaptivePolling';
import type { EquityPoint, SessionStats, BotState } from '@/types';

export function useAnalytics(sessionId: string | null, botState: BotState = 'idle') {
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const fetchAnalytics = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setLoading(true);
    try {
      const [curve, stats] = await Promise.all([
        analyticsApi.getEquityCurve(sessionIdRef.current),
        analyticsApi.getSession(sessionIdRef.current),
      ]);
      setEquityCurve(curve);
      setSessionStats(stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // Clear data when sessionId is null
  useEffect(() => {
    if (!sessionId) {
      setEquityCurve([]);
      setSessionStats(null);
    }
  }, [sessionId]);

  // R8-T1-13: Use adaptive polling for equity curve updates (linked to R8-T1-2 Snapshot generation)
  useAdaptivePolling(fetchAnalytics, 'trades', botState);

  return { equityCurve, sessionStats, loading, error, refetch: fetchAnalytics };
}
