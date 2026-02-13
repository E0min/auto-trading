'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import StrategyCard from '@/components/strategy/StrategyCard';
import { botApi } from '@/lib/api-client';
import {
  translateRegime,
  getRegimeColor,
  getStrategyCategory,
  cn,
} from '@/lib/utils';
import type { StrategyListItem, MarketRegime, Signal, Position } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | 'price-action' | 'indicator-light' | 'indicator-heavy';

const ALL_REGIMES: MarketRegime[] = [
  'trending_up',
  'trending_down',
  'ranging',
  'volatile',
  'quiet',
];

const REGIME_DOT: Record<string, string> = {
  trending_up: 'bg-emerald-400',
  trending_down: 'bg-red-400',
  ranging: 'bg-yellow-400',
  volatile: 'bg-purple-400',
  quiet: 'bg-blue-400',
};

// ── Props ────────────────────────────────────────────────────────────────────

interface StrategyHubProps {
  botRunning: boolean;
  currentRegime: string | null;
  sessionId: string | null;
  realtimeSignals: Signal[];
  positions: Position[];
  onSelectionChange?: (selected: string[]) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StrategyHub({
  botRunning,
  currentRegime,
  sessionId,
  realtimeSignals,
  positions,
  onSelectionChange,
}: StrategyHubProps) {
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [regimeFilter, setRegimeFilter] = useState<string>('all');

  // Expanded card
  const [expandedName, setExpandedName] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

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

  // Notify parent of pre-selected strategies
  useEffect(() => {
    if (!botRunning && onSelectionChange) {
      const selected = strategies.filter((s) => s.active).map((s) => s.name);
      onSelectionChange(selected);
    }
  }, [strategies, botRunning, onSelectionChange]);

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredStrategies = useMemo(() => {
    return strategies.filter((s) => {
      if (categoryFilter !== 'all' && getStrategyCategory(s.name) !== categoryFilter) {
        return false;
      }
      if (regimeFilter !== 'all') {
        const regimes = s.targetRegimes || [];
        if (!regimes.includes(regimeFilter)) return false;
      }
      return true;
    });
  }, [strategies, categoryFilter, regimeFilter]);

  // ── Strategy recommended check ──────────────────────────────────────────

  const isRecommended = useCallback(
    (strategy: StrategyListItem) => {
      if (!currentRegime) return false;
      return (strategy.targetRegimes || []).includes(currentRegime);
    },
    [currentRegime],
  );

  // ── Toggle handler ──────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (strategy: StrategyListItem) => {
      if (togglingName) return;
      setTogglingName(strategy.name);

      try {
        if (botRunning) {
          if (strategy.active) {
            await botApi.disableStrategy(strategy.name);
          } else {
            await botApi.enableStrategy(strategy.name);
          }
          await fetchStrategies();
        } else {
          setStrategies((prev) =>
            prev.map((s) =>
              s.name === strategy.name ? { ...s, active: !s.active } : s,
            ),
          );
        }
      } catch (err) {
        console.error(`전략 ${strategy.active ? '비활성화' : '활성화'} 실패:`, err);
      } finally {
        setTogglingName(null);
      }
    },
    [togglingName, botRunning, fetchStrategies],
  );

  // ── Expand handler ──────────────────────────────────────────────────────

  const handleExpand = useCallback((name: string) => {
    setExpandedName((prev) => (prev === name ? null : name));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

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

  const activeCount = filteredStrategies.filter((s) => s.active).length;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">전략 관리</h2>
          <Badge variant={activeCount > 0 ? 'success' : 'neutral'}>
            {activeCount}/{filteredStrategies.length} 활성
          </Badge>
        </div>
        {/* Current regime badge */}
        {currentRegime && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border',
              getRegimeColor(currentRegime),
            )}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full animate-pulse',
                REGIME_DOT[currentRegime] || 'bg-zinc-400',
              )}
            />
            현재: {translateRegime(currentRegime)}
          </span>
        )}
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-1.5 mb-2">
        {([
          ['all', '전체'],
          ['price-action', 'Price Action'],
          ['indicator-light', 'Indicator-Light'],
          ['indicator-heavy', 'Indicator-Heavy'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategoryFilter(value)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-full transition-colors',
              categoryFilter === value
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Regime filter buttons */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => setRegimeFilter('all')}
          className={cn(
            'px-2.5 py-1 text-xs rounded-full transition-colors',
            regimeFilter === 'all'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60',
          )}
        >
          전체
        </button>
        {ALL_REGIMES.map((r) => {
          const isCurrent = currentRegime === r;
          const isSelected = regimeFilter === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRegimeFilter(r)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-xs rounded-full transition-colors',
                isSelected
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60',
              )}
            >
              {isCurrent && (
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    REGIME_DOT[r] || 'bg-zinc-400',
                    isSelected && 'animate-pulse',
                  )}
                />
              )}
              {translateRegime(r)}
              {isCurrent && ' ★'}
            </button>
          );
        })}
      </div>

      {!botRunning && (
        <p className="text-xs text-zinc-500 mb-3">
          봇 시작 시 활성화할 전략을 선택하세요.
        </p>
      )}

      {/* Strategy cards */}
      <div className="space-y-1.5">
        {filteredStrategies.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4 text-center">
            선택한 필터에 해당하는 전략이 없습니다.
          </p>
        ) : (
          filteredStrategies.map((strategy) => (
            <StrategyCard
              key={strategy.name}
              strategy={strategy}
              active={strategy.active}
              recommended={isRecommended(strategy)}
              expanded={expandedName === strategy.name}
              botRunning={botRunning}
              toggling={togglingName === strategy.name}
              sessionId={sessionId}
              realtimeSignals={realtimeSignals}
              positions={positions}
              onToggle={() => handleToggle(strategy)}
              onExpand={() => handleExpand(strategy.name)}
            />
          ))
        )}
      </div>
    </Card>
  );
}
