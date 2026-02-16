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
import PaperModeGate from '@/components/ui/PaperModeGate';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';

export default function BacktestPage() {
  const { status: botStatus, loading: botStatusLoading } = useBotStatus();
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

  useEffect(() => {
    fetchStrategies();
    fetchList();
  }, [fetchStrategies, fetchList]);

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
  <PaperModeGate feature="백테스트" isPaper={!!isPaper} loading={botStatusLoading}>
    <div className="min-h-screen relative z-10">
      <div className="px-6 py-8 max-w-[1440px] mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
              백테스트
            </h1>
            <div className="w-px h-5 bg-[var(--border-subtle)]" />
            <Badge variant="warning" dot>가상거래</Badge>
            <Link
              href="/"
              className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded-md px-3 py-1.5 hover:border-[var(--border-muted)]"
            >
              대시보드
            </Link>
          </div>
        </header>

        <div className="space-y-6">
          {/* Form */}
          <BacktestForm
            strategies={strategies}
            running={running}
            onSubmit={runBacktest}
          />

          {/* Progress */}
          {running && activeResult && (
            <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Spinner size="sm" />
                <span className="text-xs text-[var(--text-secondary)]">백테스트 실행 중...</span>
                {activeResult.progress !== undefined && (
                  <div className="flex-1">
                    <div className="h-[2px] bg-[var(--bg-surface)] rounded-full overflow-hidden">
                      <div
                        className="h-[2px] bg-[var(--accent)] rounded-full transition-all duration-500"
                        style={{ width: `${activeResult.progress}%` }}
                      />
                    </div>
                  </div>
                )}
                {activeResult.progress !== undefined && (
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {activeResult.progress}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-lg border border-[var(--loss)]/20 bg-[var(--loss)]/5 flex items-center justify-between">
              <p className="text-xs text-[var(--loss)]">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-[var(--loss)] hover:text-[var(--text-primary)] text-[11px] transition-colors"
              >
                닫기
              </button>
            </div>
          )}

          {/* Results */}
          {activeResult && activeResult.status === 'completed' && (
            <>
              <BacktestStatsPanel metrics={activeResult.metrics} loading={loading} config={activeResult.config} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BacktestEquityCurve data={equityCurve} loading={loading} />
                <BacktestPriceChart trades={activeResult.trades} loading={loading} />
              </div>

              <BacktestTradeList trades={activeResult.trades} loading={loading} />
            </>
          )}

          {/* Past backtests */}
          <BacktestListPanel
            backtests={backtests}
            activeId={activeResult?.id ?? null}
            onSelect={fetchResult}
            onDelete={deleteBacktest}
          />
        </div>
      </div>
    </div>
  </PaperModeGate>
  );
}
