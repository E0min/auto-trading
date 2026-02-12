'use client';

import { useState, useEffect, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import type { Position, AccountState } from '@/types';

const DEFAULT_ACCOUNT: AccountState = {
  equity: '0',
  availableBalance: '0',
  unrealizedPnl: '0',
};

export function usePositions(pollInterval = 5000) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [accountState, setAccountState] = useState<AccountState>(DEFAULT_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const data = await tradeApi.getPositions();
      setPositions(data.positions || []);
      setAccountState(data.accountState || DEFAULT_ACCOUNT);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '포지션 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, pollInterval);
    return () => clearInterval(interval);
  }, [fetchPositions, pollInterval]);

  return { positions, accountState, loading, error, refetch: fetchPositions };
}
