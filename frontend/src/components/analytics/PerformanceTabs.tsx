'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import EquityCurveChart from '@/components/EquityCurveChart';
import DrawdownChart from '@/components/DrawdownChart';
import StrategyPerformance from '@/components/analytics/StrategyPerformance';
import SymbolPerformance from '@/components/analytics/SymbolPerformance';
import DailyPerformance from '@/components/analytics/DailyPerformance';
import Spinner from '@/components/ui/Spinner';
import { analyticsApi } from '@/lib/api-client';
import type {
  EquityPoint,
  StrategyPerformanceEntry,
  SymbolPerformanceEntry,
  DailyPerformanceEntry,
} from '@/types';

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

  // Lazy loading: track which tabs have been loaded
  const [loadedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>(['equity']));
  const [tabLoading, setTabLoading] = useState(false);

  // Per-tab cached data
  const [byStrategy, setByStrategy] = useState<Record<string, StrategyPerformanceEntry> | null>(null);
  const [bySymbol, setBySymbol] = useState<Record<string, SymbolPerformanceEntry> | null>(null);
  const [daily, setDaily] = useState<DailyPerformanceEntry[] | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Reset data when sessionId changes
  useEffect(() => {
    if (!sessionId) {
      setByStrategy(null);
      setBySymbol(null);
      setDaily(null);
      loadedTabs.clear();
      loadedTabs.add('equity');
    }
  }, [sessionId, loadedTabs]);

  // Fetch data for a specific tab
  const fetchTabData = useCallback(async (tab: TabKey) => {
    if (!sessionIdRef.current) return;
    setTabLoading(true);
    try {
      switch (tab) {
        case 'strategy': {
          const data = await analyticsApi.getByStrategy(sessionIdRef.current);
          setByStrategy(data);
          break;
        }
        case 'symbol': {
          const data = await analyticsApi.getBySymbol(sessionIdRef.current);
          setBySymbol(data);
          break;
        }
        case 'daily': {
          const data = await analyticsApi.getDaily(sessionIdRef.current);
          setDaily(data);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error(`탭 데이터 조회 실패 (${tab}):`, err);
    } finally {
      setTabLoading(false);
    }
  }, []);

  // Handle tab selection — fetch on first select only
  const handleTabClick = useCallback((tab: TabKey) => {
    setActiveTab(tab);

    if (tab !== 'equity' && !loadedTabs.has(tab) && sessionIdRef.current) {
      loadedTabs.add(tab);
      fetchTabData(tab);
    }
  }, [loadedTabs, fetchTabData]);

  // Determine loading state for analytics tabs
  const isTabLoading = (tab: TabKey): boolean => {
    if (tab === 'equity') return analyticsLoading;
    return tabLoading && activeTab === tab;
  };

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-0 border-b border-[var(--border-subtle)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
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
          isTabLoading('strategy') ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <StrategyPerformance data={byStrategy} loading={false} />
          )
        )}

        {activeTab === 'symbol' && (
          isTabLoading('symbol') ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <SymbolPerformance data={bySymbol} loading={false} />
          )
        )}

        {activeTab === 'daily' && (
          isTabLoading('daily') ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <DailyPerformance data={daily} loading={false} />
          )
        )}
      </div>
    </div>
  );
}
