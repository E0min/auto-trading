'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { backtestApi } from '@/lib/api-client';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestSummary,
  BacktestStrategyItem,
} from '@/types/backtest';

export function useBacktest() {
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(null);
  const [strategies, setStrategies] = useState<BacktestStrategyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Fetch available strategies
  const fetchStrategies = useCallback(async () => {
    try {
      const data = await backtestApi.getStrategies();
      setStrategies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '전략 목록 로드 실패');
    }
  }, []);

  // Fetch backtest list
  const fetchList = useCallback(async () => {
    try {
      const data = await backtestApi.list();
      setBacktests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '백테스트 목록 로드 실패');
    }
  }, []);

  // Fetch full result by ID
  const fetchResult = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await backtestApi.getResult(id);
      setActiveResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run a new backtest
  const runBacktest = useCallback(async (config: BacktestConfig) => {
    setRunning(true);
    setError(null);
    setActiveResult(null);
    stopPolling();

    try {
      const { id } = await backtestApi.run(config);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const result = await backtestApi.getResult(id);
          if (result.status === 'completed' || result.status === 'error') {
            stopPolling();
            setActiveResult(result);
            setRunning(false);
            if (result.status === 'error') {
              setError(result.error || '백테스트 실행 오류');
            }
            // Refresh list
            fetchList();
          } else {
            // Still running — update progress
            setActiveResult(result);
          }
        } catch {
          stopPolling();
          setRunning(false);
          setError('백테스트 상태 조회 실패');
        }
      }, 1000);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : '백테스트 실행 실패');
    }
  }, [stopPolling, fetchList]);

  // Delete a backtest
  const deleteBacktest = useCallback(async (id: string) => {
    try {
      await backtestApi.delete(id);
      setBacktests((prev) => prev.filter((b) => b.id !== id));
      if (activeResult?.id === id) {
        setActiveResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제 실패');
    }
  }, [activeResult]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    backtests,
    activeResult,
    strategies,
    loading,
    running,
    error,
    fetchStrategies,
    fetchList,
    fetchResult,
    runBacktest,
    deleteBacktest,
    setError,
  };
}
