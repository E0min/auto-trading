'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useBotStatus } from '@/hooks/useBotStatus';
import { useBacktest } from '@/hooks/useBacktest';
import BacktestForm from '@/components/backtest/BacktestForm';
import BacktestStatsPanel from '@/components/backtest/BacktestStatsPanel';
import BacktestEquityCurve from '@/components/backtest/BacktestEquityCurve';
import BacktestPriceChart from '@/components/backtest/BacktestPriceChart';
import BacktestTradeList from '@/components/backtest/BacktestTradeList';
import BacktestListPanel from '@/components/backtest/BacktestListPanel';
import Spinner from '@/components/ui/Spinner';

export default function BacktestPage() {
  const { status: botStatus, loading: botStatusLoading } = useBotStatus(10000);

  const isPaper = botStatus.tradingMode === 'paper' || botStatus.paperMode;

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

  if (!botStatusLoading && !isPaper) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-200">가상거래 모드 전용</h2>
          <p className="text-sm text-zinc-500">
            백테스트는 가상거래(Paper) 모드에서만 사용할 수 있습니다.<br />
            대시보드에서 가상거래 모드로 전환해주세요.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-4 py-2 text-sm font-medium text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 transition-colors"
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

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
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400/80 border border-amber-500/20">
          가상거래 전용
        </span>
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
