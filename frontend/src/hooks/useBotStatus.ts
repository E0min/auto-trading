'use client';

import { useState, useCallback } from 'react';
import { botApi } from '@/lib/api-client';
import { useAdaptivePolling } from './useAdaptivePolling';
import type { BotStatus } from '@/types';

const DEFAULT_STATUS: BotStatus = {
  running: false,
  sessionId: null,
  status: 'idle',
  strategies: [],
  symbols: [],
  registeredStrategies: [],
  riskStatus: {
    circuitBreaker: { tripped: false, reason: null, trippedAt: null },
    exposureGuard: { totalExposure: '0', maxExposure: '0', utilizationPercent: '0' },
    drawdownMonitor: { currentDrawdown: '0', maxDrawdown: '0', halted: false, peakEquity: '0' },
    accountState: { equity: '0', positionCount: 0 },
  },
};

export function useBotStatus() {
  const [status, setStatus] = useState<BotStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await botApi.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  const riskHalted = status.riskStatus?.drawdownMonitor?.halted || status.riskStatus?.circuitBreaker?.tripped || false;
  useAdaptivePolling(fetchStatus, 'botStatus', status.status, riskHalted);

  const startBot = useCallback(async (config?: Record<string, unknown>) => {
    try {
      await botApi.start(config);
      await fetchStatus();
    } catch (err) {
      throw err;
    }
  }, [fetchStatus]);

  const stopBot = useCallback(async () => {
    try {
      await botApi.stop();
      await fetchStatus();
    } catch (err) {
      throw err;
    }
  }, [fetchStatus]);

  const pauseBot = useCallback(async () => {
    try {
      await botApi.pause();
      await fetchStatus();
    } catch (err) {
      throw err;
    }
  }, [fetchStatus]);

  const resumeBot = useCallback(async () => {
    try {
      await botApi.resume();
      await fetchStatus();
    } catch (err) {
      throw err;
    }
  }, [fetchStatus]);

  const emergencyStop = useCallback(async () => {
    try {
      await botApi.emergencyStop();
      await fetchStatus();
    } catch (err) {
      throw err;
    }
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
    startBot,
    stopBot,
    pauseBot,
    resumeBot,
    emergencyStop,
  };
}
