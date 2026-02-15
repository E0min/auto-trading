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

  /* Gate: Paper mode only */
  if (!botStatusLoading && !isPaper) {
    return (
      <div className="min-h-screen flex items-center justify-center relative z-10">
        <div className="text-center space-y-5 max-w-sm">
          <div className="w-12 h-12 mx-auto rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center">
            <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)] mb-2">가상거래 모드 전용</h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              백테스트는 가상거래(Paper) 모드에서만 사용할 수 있습니다.<br />
              대시보드에서 가상거래 모드로 전환해주세요.
            </p>
          </div>
          <Link
            href="/"
            className="inline-block text-[11px] font-medium text-[var(--accent)] border border-[var(--accent)]/30 rounded-md px-4 py-2 hover:bg-[var(--accent-subtle)] transition-colors"
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
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
              <BacktestStatsPanel metrics={activeResult.metrics} loading={loading} />

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
  );
}
