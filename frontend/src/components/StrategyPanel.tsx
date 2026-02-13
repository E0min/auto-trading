'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { botApi } from '@/lib/api-client';
import { translateStrategyName, translateRegime, getStrategyCategory } from '@/lib/utils';
import type { StrategyListItem } from '@/types';

type CategoryFilter = 'all' | 'price-action' | 'indicator-light' | 'indicator-heavy';
type DirectionFilter = 'all' | 'trending_up' | 'trending_down' | 'ranging';
type VolatilityFilter = 'all' | 'volatile' | 'quiet';

interface StrategyPanelProps {
  botRunning: boolean;
  onSelectionChange?: (selected: string[]) => void;
}

const REGIME_TAG_COLORS: Record<string, string> = {
  trending_up: 'bg-emerald-500/20 text-emerald-400',
  trending_down: 'bg-red-500/20 text-red-400',
  ranging: 'bg-yellow-500/20 text-yellow-400',
  volatile: 'bg-purple-500/20 text-purple-400',
  quiet: 'bg-zinc-500/20 text-zinc-400',
};

export default function StrategyPanel({ botRunning, onSelectionChange }: StrategyPanelProps) {
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingName, setTogglingName] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [volatilityFilter, setVolatilityFilter] = useState<VolatilityFilter>('all');

  const fetchStrategies = useCallback(async () => {
    try {
      const data = await botApi.getStrategies();
      setStrategies(data.strategies);
    } catch (err) {
      console.error('전략 목록 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  // Notify parent of selected strategies when not running (pre-selection mode)
  useEffect(() => {
    if (!botRunning && onSelectionChange) {
      const selected = strategies.filter((s) => s.active).map((s) => s.name);
      onSelectionChange(selected);
    }
  }, [strategies, botRunning, onSelectionChange]);

  const filteredStrategies = useMemo(() => {
    return strategies.filter((s) => {
      if (categoryFilter !== 'all' && getStrategyCategory(s.name) !== categoryFilter) {
        return false;
      }
      const regimes = s.targetRegimes || [];
      if (directionFilter !== 'all' && !regimes.includes(directionFilter)) {
        return false;
      }
      if (volatilityFilter !== 'all' && !regimes.includes(volatilityFilter)) {
        return false;
      }
      return true;
    });
  }, [strategies, categoryFilter, directionFilter, volatilityFilter]);

  const handleToggle = async (strategy: StrategyListItem) => {
    if (togglingName) return;
    setTogglingName(strategy.name);

    try {
      if (botRunning) {
        // Live toggle via API
        if (strategy.active) {
          await botApi.disableStrategy(strategy.name);
        } else {
          await botApi.enableStrategy(strategy.name);
        }
        await fetchStrategies();
      } else {
        // Pre-selection: toggle locally
        setStrategies((prev) =>
          prev.map((s) =>
            s.name === strategy.name ? { ...s, active: !s.active } : s
          )
        );
      }
    } catch (err) {
      console.error(`전략 ${strategy.active ? '비활성화' : '활성화'} 실패:`, err);
    } finally {
      setTogglingName(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-6">
          <Spinner size="md" />
          <span className="ml-2 text-sm text-zinc-500">전략 목록 로딩 중...</span>
        </div>
      </Card>
    );
  }

  if (strategies.length === 0) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-100">전략 관리</h2>
        </div>
        <p className="text-sm text-zinc-500 py-4 text-center">등록된 전략이 없습니다.</p>
      </Card>
    );
  }

  const filteredActiveCount = filteredStrategies.filter((s) => s.active).length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-zinc-100">전략 관리</h2>
        <Badge variant={filteredActiveCount > 0 ? 'success' : 'neutral'}>
          {filteredActiveCount}/{filteredStrategies.length} 활성
        </Badge>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 mb-2">
        {([
          ['all', '전체'],
          ['price-action', '가격행동'],
          ['indicator-light', '지표 경량'],
          ['indicator-heavy', '지표 고급'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategoryFilter(value)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors
              ${categoryFilter === value
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60'}
            `}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Direction filter */}
      <div className="flex gap-1.5 mb-2">
        {([
          ['all', '전체'],
          ['trending_up', '상승장'],
          ['trending_down', '하강장'],
          ['ranging', '횡보장'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setDirectionFilter(value)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors
              ${directionFilter === value
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60'}
            `}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Volatility filter */}
      <div className="flex gap-1.5 mb-3">
        {([
          ['all', '전체'],
          ['volatile', '고변동성'],
          ['quiet', '저변동성'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setVolatilityFilter(value)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors
              ${volatilityFilter === value
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60'}
            `}
          >
            {label}
          </button>
        ))}
      </div>

      {!botRunning && (
        <p className="text-xs text-zinc-500 mb-3">
          봇 시작 시 활성화할 전략을 선택하세요.
        </p>
      )}

      <div className="space-y-1">
        {filteredStrategies.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4 text-center">
            선택한 필터에 해당하는 전략이 없습니다.
          </p>
        ) : (
          filteredStrategies.map((strategy) => {
            const isToggling = togglingName === strategy.name;
            const regimes = strategy.targetRegimes || [];
            return (
              <button
                key={strategy.name}
                type="button"
                onClick={() => handleToggle(strategy)}
                disabled={isToggling}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                  ${strategy.active
                    ? 'bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15'
                    : 'bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800'}
                  ${isToggling ? 'opacity-60 cursor-wait' : 'cursor-pointer'}
                `}
              >
                {/* Radio indicator */}
                <div className="flex-shrink-0">
                  {isToggling ? (
                    <Spinner size="sm" />
                  ) : (
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center
                        ${strategy.active
                          ? 'border-emerald-400'
                          : 'border-zinc-500'}
                      `}
                    >
                      {strategy.active && (
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      )}
                    </div>
                  )}
                </div>

                {/* Strategy info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200">
                    {strategy.name}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {translateStrategyName(strategy.name)}
                    {strategy.description && strategy.description !== strategy.name
                      ? ` — ${strategy.description}`
                      : ''}
                  </div>
                  {/* Regime tags */}
                  {regimes.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {regimes.slice(0, 3).map((r) => (
                        <span
                          key={r}
                          className={`px-1.5 py-0.5 text-[10px] rounded ${REGIME_TAG_COLORS[r] || 'bg-zinc-500/20 text-zinc-400'}`}
                        >
                          {translateRegime(r)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div className="flex-shrink-0">
                  <Badge variant={strategy.active ? 'success' : 'neutral'} dot>
                    {strategy.active ? '활성' : '비활성'}
                  </Badge>
                </div>
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}
