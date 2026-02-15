'use client';

import { useState } from 'react';
import EquityCurveChart from '@/components/EquityCurveChart';
import DrawdownChart from '@/components/DrawdownChart';
import StrategyPerformance from '@/components/analytics/StrategyPerformance';
import SymbolPerformance from '@/components/analytics/SymbolPerformance';
import DailyPerformance from '@/components/analytics/DailyPerformance';
import { usePerformanceAnalytics } from '@/hooks/usePerformanceAnalytics';
import type { EquityPoint } from '@/types';

interface PerformanceTabsProps {
  sessionId: string | null;
  equityCurve: EquityPoint[];
  analyticsLoading: boolean;
  maxDrawdownPercent: number;
}

type TabKey = 'equity' | 'strategy' | 'symbol' | 'daily';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'equity', label: '에쿼티 커브' },
  { key: 'strategy', label: '전략별 성과' },
  { key: 'symbol', label: '심볼별 성과' },
  { key: 'daily', label: '일별 성과' },
];

export default function PerformanceTabs({
  sessionId,
  equityCurve,
  analyticsLoading,
  maxDrawdownPercent,
}: PerformanceTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('equity');

  const {
    byStrategy,
    bySymbol,
    daily,
    loading: perfLoading,
  } = usePerformanceAnalytics(sessionId);

  return (
    <div className="space-y-4">
      {/* Tab Navigation — minimal underline style */}
      <div className="flex gap-0 border-b border-[var(--border-subtle)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`
              px-4 py-2.5 text-[11px] font-medium transition-all duration-200 relative
              ${activeTab === tab.key
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }
            `}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="animate-fade-in">
        {activeTab === 'equity' && (
          <div className="space-y-4">
            <EquityCurveChart data={equityCurve} loading={analyticsLoading} />
            <DrawdownChart
              equityPoints={equityCurve || []}
              maxDrawdownPercent={maxDrawdownPercent}
            />
          </div>
        )}

        {activeTab === 'strategy' && (
          <StrategyPerformance data={byStrategy} loading={perfLoading} />
        )}

        {activeTab === 'symbol' && (
          <SymbolPerformance data={bySymbol} loading={perfLoading} />
        )}

        {activeTab === 'daily' && (
          <DailyPerformance data={daily} loading={perfLoading} />
        )}
      </div>
    </div>
  );
}
