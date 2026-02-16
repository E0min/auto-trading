'use client';

import { useState, useCallback } from 'react';
import { tournamentApi } from '@/lib/api-client';
import { useAdaptivePolling } from '@/hooks/useAdaptivePolling';
import type { TournamentInfo, LeaderboardEntry, StrategyDetail, BotState } from '@/types';

export function useTournament(botState: BotState = 'running') {
  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await tournamentApi.getLeaderboard();
      setInfo(data.tournament);
      setLeaderboard(data.leaderboard);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '리더보드 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // R8-T1-12: Use adaptive polling instead of fixed 3s interval
  useAdaptivePolling(fetchLeaderboard, 'positions', botState);

  const startTournament = useCallback(async (strategies?: string[], initialBalance?: string) => {
    try {
      const result = await tournamentApi.start({ strategies, initialBalance });
      setInfo(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : '토너먼트 시작 실패');
      throw err;
    }
  }, []);

  const stopTournament = useCallback(async () => {
    try {
      const result = await tournamentApi.stop();
      setInfo(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : '토너먼트 정지 실패');
      throw err;
    }
  }, []);

  const resetTournament = useCallback(async (initialBalance?: string, clearTrades?: boolean) => {
    try {
      await tournamentApi.reset({ initialBalance, clearTrades });
      await fetchLeaderboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : '토너먼트 리셋 실패');
      throw err;
    }
  }, [fetchLeaderboard]);

  const getStrategyDetail = useCallback(async (name: string): Promise<StrategyDetail> => {
    return tournamentApi.getStrategyDetail(name);
  }, []);

  return {
    info,
    leaderboard,
    loading,
    error,
    startTournament,
    stopTournament,
    resetTournament,
    getStrategyDetail,
    refresh: fetchLeaderboard,
  };
}
