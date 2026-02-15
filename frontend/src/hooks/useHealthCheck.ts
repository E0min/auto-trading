'use client';

import { useState, useCallback } from 'react';
import { healthApi } from '@/lib/api-client';
import { useAdaptivePolling } from './useAdaptivePolling';
import type { HealthReport } from '@/types';

export function useHealthCheck() {
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

  useAdaptivePolling(checkHealth, 'health');

  return { health, latency, error, refetch: checkHealth };
}
