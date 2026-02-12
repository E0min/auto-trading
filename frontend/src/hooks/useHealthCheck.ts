'use client';

import { useState, useEffect, useCallback } from 'react';
import { healthApi } from '@/lib/api-client';
import type { HealthReport } from '@/types';

export function useHealthCheck(pollInterval = 30000) {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    const start = Date.now();
    try {
      const data = await healthApi.check();
      setLatency(Date.now() - start);
      setHealth(data);
      setError(null);
    } catch (err) {
      setLatency(null);
      setError(err instanceof Error ? err.message : '헬스체크 실패');
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, pollInterval);
    return () => clearInterval(interval);
  }, [checkHealth, pollInterval]);

  return { health, latency, error, refetch: checkHealth };
}
