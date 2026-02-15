'use client';

import { useState, useCallback } from 'react';
import { tradeApi } from '@/lib/api-client';
import { useAdaptivePolling } from './useAdaptivePolling';
import type { Position, AccountState } from '@/types';
import type { BotState } from '@/types';

const DEFAULT_ACCOUNT: AccountState = {
  equity: '0',
  availableBalance: '0',
  unrealizedPnl: '0',
};

export function usePositions(botState: BotState = 'idle') {
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

  useAdaptivePolling(fetchPositions, 'positions', botState);

  return { positions, accountState, loading, error, refetch: fetchPositions };
}
