'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useBacktest } from '@/hooks/useBacktest';
import BacktestForm from '@/components/backtest/BacktestForm';
import BacktestStatsPanel from '@/components/backtest/BacktestStatsPanel';
import BacktestEquityCurve from '@/components/backtest/BacktestEquityCurve';
import BacktestPriceChart from '@/components/backtest/BacktestPriceChart';
import BacktestTradeList from '@/components/backtest/BacktestTradeList';
import BacktestListPanel from '@/components/backtest/BacktestListPanel';
import Spinner from '@/components/ui/Spinner';

export default function BacktestPage() {
  const {
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
  } = useBacktest();

  // Load strategies and past backtests on mount
  useEffect(() => {
    fetchStrategies();
    fetchList();
  }, [fetchStrategies, fetchList]);

  // Downsample equity curve for chart rendering (max 500 points)
  const equityCurve = useMemo(() => {
    if (!activeResult?.equityCurve) return [];
    const curve = activeResult.equityCurve;
    if (curve.length <= 500) return curve;

    const result = [curve[0]];
    const step = (curve.length - 1) / 499;
    for (let i = 1; i < 499; i++) {
      result.push(curve[Math.round(i * step)]);
    }
    result.push(curve[curve.length - 1]);
    return result;
  }, [activeResult?.equityCurve]);

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex items-center gap-4 mb-6">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          &larr; 대시보드
        </Link>
        <h1 className="text-xl font-bold text-zinc-100">백테스트</h1>
      </header>

      <div className="space-y-4">
        {/* Form */}
        <BacktestForm
          strategies={strategies}
          running={running}
          onSubmit={runBacktest}
        />

        {/* Progress bar (when running) */}
        {running && activeResult && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Spinner size="sm" />
              <span className="text-sm text-zinc-400">
                백테스트 실행 중...
              </span>
              {activeResult.progress !== undefined && (
                <div className="flex-1">
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${activeResult.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300 text-xs"
            >
              닫기
            </button>
          </div>
        )}

        {/* Stats Panel */}
        {activeResult && activeResult.status === 'completed' && (
          <>
            <BacktestStatsPanel
              metrics={activeResult.metrics}
              loading={loading}
            />

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BacktestEquityCurve
                data={equityCurve}
                loading={loading}
              />
              <BacktestPriceChart
                trades={activeResult.trades}
                loading={loading}
              />
            </div>

            {/* Trade List */}
            <BacktestTradeList
              trades={activeResult.trades}
              loading={loading}
            />
          </>
        )}

        {/* Past backtests list */}
        <BacktestListPanel
          backtests={backtests}
          activeId={activeResult?.id ?? null}
          onSelect={fetchResult}
          onDelete={deleteBacktest}
        />
      </div>
    </div>
  );
}
