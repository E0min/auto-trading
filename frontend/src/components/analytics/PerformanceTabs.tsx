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
    <div className="space-y-3">
      {/* Tab Navigation */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`
              flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors
              ${activeTab === tab.key
                ? 'bg-zinc-700/70 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
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
