'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { analyticsApi } from '@/lib/api-client';
import type {
  StrategyPerformanceEntry,
  SymbolPerformanceEntry,
  DailyPerformanceEntry,
} from '@/types';

const POLLING_INTERVAL = 30_000; // 30 seconds

export function usePerformanceAnalytics(sessionId: string | null) {
  const [byStrategy, setByStrategy] = useState<Record<string, StrategyPerformanceEntry> | null>(null);
  const [bySymbol, setBySymbol] = useState<Record<string, SymbolPerformanceEntry> | null>(null);
  const [daily, setDaily] = useState<DailyPerformanceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const fetchData = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setLoading(true);
    try {
      const [strategyData, symbolData, dailyData] = await Promise.allSettled([
        analyticsApi.getByStrategy(sessionIdRef.current),
        analyticsApi.getBySymbol(sessionIdRef.current),
        analyticsApi.getDaily(sessionIdRef.current),
      ]);

      if (strategyData.status === 'fulfilled') {
        setByStrategy(strategyData.value);
      }
      if (symbolData.status === 'fulfilled') {
        setBySymbol(symbolData.value);
      }
      if (dailyData.status === 'fulfilled') {
        setDaily(dailyData.value);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '성과 데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch when sessionId changes
  useEffect(() => {
    if (sessionId) {
      fetchData();
    } else {
      setByStrategy(null);
      setBySymbol(null);
      setDaily(null);
    }
  }, [sessionId, fetchData]);

  // Polling when sessionId is available
  useEffect(() => {
    if (!sessionId) return;

    const intervalId = setInterval(() => {
      fetchData();
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [sessionId, fetchData]);

  return { byStrategy, bySymbol, daily, loading, error, refetch: fetchData };
}
