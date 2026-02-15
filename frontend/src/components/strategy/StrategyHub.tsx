'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import StrategyCard from '@/components/strategy/StrategyCard';
import { botApi } from '@/lib/api-client';
import {
  translateRegime,
  getRegimeColor,
  getRegimeDotColor,
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
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </Card>
    );
  }

  const activeCount = filteredStrategies.filter((s) => s.active).length;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">전략 관리</h2>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">
            {activeCount}/{filteredStrategies.length}
          </span>
        </div>
        {/* Current regime */}
        {currentRegime && (
          <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', getRegimeColor(currentRegime))}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', getRegimeDotColor(currentRegime))} />
            현재: {translateRegime(currentRegime)}
          </span>
        )}
      </div>

      {/* Category filter */}
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
              'px-2.5 py-1 text-[11px] rounded-md transition-colors',
              categoryFilter === value
                ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
                : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Regime filter */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => setRegimeFilter('all')}
          className={cn(
            'px-2.5 py-1 text-[11px] rounded-md transition-colors',
            regimeFilter === 'all'
              ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
              : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
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
                'flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md transition-colors',
                isSelected
                  ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
                  : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
              )}
            >
              {isCurrent && (
                <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(r))} />
              )}
              {translateRegime(r)}
            </button>
          );
        })}
      </div>

      {!botRunning && (
        <p className="text-[11px] text-[var(--text-muted)] mb-3">
          봇 시작 시 활성화할 전략을 선택하세요.
        </p>
      )}

      {/* Strategy cards */}
      <div className="space-y-1">
        {filteredStrategies.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">
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
