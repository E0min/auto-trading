'use client';

import { useState, useEffect, useCallback } from 'react';
import { tournamentApi } from '@/lib/api-client';
import type { TournamentInfo, LeaderboardEntry, StrategyDetail } from '@/types';

export function useTournament(pollInterval = 3000) {
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
      setError(err instanceof Error ? err.message : 'Failed to fetch leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const id = setInterval(fetchLeaderboard, pollInterval);
    return () => clearInterval(id);
  }, [fetchLeaderboard, pollInterval]);

  const startTournament = useCallback(async (strategies?: string[], initialBalance?: string) => {
    try {
      const result = await tournamentApi.start({ strategies, initialBalance });
      setInfo(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start tournament');
      throw err;
    }
  }, []);

  const stopTournament = useCallback(async () => {
    try {
      const result = await tournamentApi.stop();
      setInfo(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop tournament');
      throw err;
    }
  }, []);

  const resetTournament = useCallback(async (initialBalance?: string, clearTrades?: boolean) => {
    try {
      await tournamentApi.reset({ initialBalance, clearTrades });
      await fetchLeaderboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset tournament');
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
