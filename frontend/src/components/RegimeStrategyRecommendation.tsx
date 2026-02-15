'use client';

import { useState, useEffect, useMemo } from 'react';
import Card from '@/components/ui/Card';
import {
  translateRegime,
  translateStrategyName,
  getStrategyCategory,
  cn,
} from '@/lib/utils';
import type { StrategyCategory } from '@/lib/utils';
import type { StrategyListItem, MarketRegime } from '@/types';

interface RegimeStrategyRecommendationProps {
  currentRegime: string | null;
  strategies: StrategyListItem[];
}

const ALL_REGIMES: MarketRegime[] = [
  'trending_up',
  'trending_down',
  'ranging',
  'volatile',
  'quiet',
];

const REGIME_DOT_COLOR: Record<string, string> = {
  trending_up: 'bg-emerald-400',
  trending_down: 'bg-red-400',
  ranging: 'bg-yellow-400',
  volatile: 'bg-purple-400',
  quiet: 'bg-blue-400',
};

const REGIME_RING_COLOR: Record<string, string> = {
  trending_up: 'ring-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  trending_down: 'ring-red-500/50 bg-red-500/10 text-red-300',
  ranging: 'ring-yellow-500/50 bg-yellow-500/10 text-yellow-300',
  volatile: 'ring-purple-500/50 bg-purple-500/10 text-purple-300',
  quiet: 'ring-blue-500/50 bg-blue-500/10 text-blue-300',
};

const RISK_PILL: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-emerald-500/20 text-emerald-400' },
  medium: { label: 'Med', color: 'bg-amber-500/20 text-amber-400' },
  high: { label: 'High', color: 'bg-red-500/20 text-red-400' },
};

const CATEGORY_META: Record<StrategyCategory, { icon: string; label: string }> = {
  'price-action': { icon: '\u{1F3AF}', label: '\uAC00\uACA9 \uD589\uB3D9' },
  'indicator-light': { icon: '\u{1F4C8}', label: '\uC9C0\uD45C \uACBD\uB7C9' },
  'indicator-heavy': { icon: '\u{1F9E0}', label: '\uC9C0\uD45C \uACE0\uAE09' },
};

const CATEGORY_ACCENT: Record<StrategyCategory, { border: string; bg: string; text: string }> = {
  'price-action': {
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5',
    text: 'text-cyan-400',
  },
  'indicator-light': {
    border: 'border-violet-500/30',
    bg: 'bg-violet-500/5',
    text: 'text-violet-400',
  },
  'indicator-heavy': {
    border: 'border-orange-500/30',
    bg: 'bg-orange-500/5',
    text: 'text-orange-400',
  },
};

export default function RegimeStrategyRecommendation({
  currentRegime,
  strategies,
}: RegimeStrategyRecommendationProps) {
  const [selectedRegime, setSelectedRegime] = useState<string>(
    currentRegime || 'trending_up'
  );

  // Auto-switch when live regime changes
  useEffect(() => {
    if (currentRegime) {
      setSelectedRegime(currentRegime);
    }
  }, [currentRegime]);

  // Classify strategies by category, then split recommended / not-recommended
  const categorized = useMemo(() => {
    const categories: StrategyCategory[] = [
      'price-action',
      'indicator-light',
      'indicator-heavy',
    ];

    return categories.map((cat) => {
      const all = strategies.filter((s) => getStrategyCategory(s.name) === cat);
      const recommended = all.filter((s) =>
        (s.targetRegimes || []).includes(selectedRegime)
      );
      const notRecommended = all.filter(
        (s) => !(s.targetRegimes || []).includes(selectedRegime)
      );
      return { category: cat, recommended, notRecommended, total: all.length };
    });
  }, [strategies, selectedRegime]);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">
          레짐별 추천 전략
        </h2>
        {currentRegime && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
              REGIME_RING_COLOR[currentRegime] || 'bg-zinc-500/10 text-zinc-400'
            )}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full animate-pulse',
                REGIME_DOT_COLOR[currentRegime] || 'bg-zinc-400'
              )}
            />
            현재: {translateRegime(currentRegime)}
          </span>
        )}
      </div>

      {/* Regime tab bar */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {ALL_REGIMES.map((r) => {
          const isSelected = selectedRegime === r;
          const isCurrent = currentRegime === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setSelectedRegime(r)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                isSelected
                  ? `ring-2 ${REGIME_RING_COLOR[r]}`
                  : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700/60'
              )}
            >
              {isCurrent && (
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isSelected ? 'animate-pulse' : '',
                    REGIME_DOT_COLOR[r] || 'bg-zinc-400'
                  )}
                />
              )}
              {translateRegime(r)}
            </button>
          );
        })}
      </div>

      {/* 3-column category grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {categorized.map(({ category, recommended, notRecommended, total }) => {
          const meta = CATEGORY_META[category];
          const accent = CATEGORY_ACCENT[category];

          return (
            <div
              key={category}
              className={cn(
                'rounded-lg border p-3',
                accent.border,
                'bg-zinc-900/50'
              )}
            >
              {/* Category header */}
              <div className="flex items-center justify-between mb-2.5">
                <span className={cn('text-sm font-medium', accent.text)}>
                  {meta.icon} {meta.label}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {recommended.length}/{total}
                </span>
              </div>

              {/* Recommended strategies */}
              {recommended.length > 0 && (
                <div className="space-y-1 mb-2">
                  {recommended.map((s) => (
                    <StrategyRow key={s.name} strategy={s} recommended />
                  ))}
                </div>
              )}

              {/* Divider if both sections exist */}
              {recommended.length > 0 && notRecommended.length > 0 && (
                <div className="border-t border-zinc-800/80 my-2" />
              )}

              {/* Not recommended strategies */}
              {notRecommended.length > 0 && (
                <div className="space-y-1">
                  {notRecommended.map((s) => (
                    <StrategyRow key={s.name} strategy={s} recommended={false} />
                  ))}
                </div>
              )}

              {/* Empty state */}
              {total === 0 && (
                <p className="text-xs text-zinc-600 text-center py-2">
                  전략 없음
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="text-emerald-400">&#10003;</span> 추천
        </span>
        <span className="flex items-center gap-1">
          <span className="text-zinc-600">&mdash;</span> 미추천
        </span>
        <span className="border-l border-zinc-700 pl-3 flex items-center gap-2">
          위험도:
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Low</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">Med</span>
          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">High</span>
        </span>
      </div>
    </Card>
  );
}

// ── Strategy row sub-component ──────────────────────────────────────────

function StrategyRow({
  strategy,
  recommended,
}: {
  strategy: StrategyListItem;
  recommended: boolean;
}) {
  const risk = RISK_PILL[strategy.riskLevel || 'medium'];

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors',
        recommended
          ? 'bg-zinc-800/60 hover:bg-zinc-800'
          : 'opacity-45 hover:opacity-60'
      )}
    >
      {/* Indicator */}
      <span className="flex-shrink-0 w-4 text-center text-xs">
        {recommended ? (
          <span className="text-emerald-400">&#10003;</span>
        ) : (
          <span className="text-zinc-600">&mdash;</span>
        )}
      </span>

      {/* Strategy name */}
      <span
        className={cn(
          'flex-1 text-xs truncate',
          recommended ? 'text-zinc-200' : 'text-zinc-500'
        )}
        title={strategy.name}
      >
        {translateStrategyName(strategy.name)}
      </span>

      {/* Risk pill */}
      <span
        className={cn(
          'flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium',
          risk.color
        )}
      >
        {risk.label}
      </span>
    </div>
  );
}
