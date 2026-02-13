'use client';

import { useCallback } from 'react';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import StrategyDetail from '@/components/strategy/StrategyDetail';
import {
  translateStrategyName,
  translateRegime,
  getStrategyCategory,
  cn,
} from '@/lib/utils';
import type { StrategyListItem, Signal, Position } from '@/types';

interface StrategyCardProps {
  strategy: StrategyListItem;
  active: boolean;
  recommended: boolean;
  expanded: boolean;
  botRunning: boolean;
  toggling: boolean;
  sessionId: string | null;
  realtimeSignals: Signal[];
  positions: Position[];
  onToggle: () => void;
  onExpand: () => void;
}

const REGIME_TAG_COLORS: Record<string, string> = {
  trending_up: 'bg-emerald-500/20 text-emerald-400',
  trending_down: 'bg-red-500/20 text-red-400',
  ranging: 'bg-yellow-500/20 text-yellow-400',
  volatile: 'bg-purple-500/20 text-purple-400',
  quiet: 'bg-zinc-500/20 text-zinc-400',
};

const RISK_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-emerald-500/20 text-emerald-400' },
  medium: { label: 'Med', color: 'bg-amber-500/20 text-amber-400' },
  high: { label: 'High', color: 'bg-red-500/20 text-red-400' },
};

const CATEGORY_LABEL: Record<string, string> = {
  'price-action': '가격행동',
  'indicator-light': '지표 경량',
  'indicator-heavy': '지표 고급',
};

export default function StrategyCard({
  strategy,
  active,
  recommended,
  expanded,
  botRunning,
  toggling,
  sessionId,
  realtimeSignals,
  positions,
  onToggle,
  onExpand,
}: StrategyCardProps) {
  const risk = RISK_BADGE[strategy.riskLevel || 'medium'];
  const category = getStrategyCategory(strategy.name);
  const regimes = strategy.targetRegimes || [];

  const handleToggleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        active
          ? 'border-l-2 border-l-emerald-500 border-emerald-500/20 bg-emerald-500/5'
          : 'border-zinc-700/50 bg-zinc-800/30',
        !recommended && !active && 'opacity-60',
      )}
    >
      {/* Card header — clickable to expand */}
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* Toggle button */}
        <div
          className="flex-shrink-0"
          onClick={handleToggleClick}
          role="switch"
          aria-checked={active}
        >
          {toggling ? (
            <Spinner size="sm" />
          ) : (
            <div
              className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors',
                active ? 'border-emerald-400' : 'border-zinc-500',
              )}
            >
              {active && <div className="w-2 h-2 rounded-full bg-emerald-400" />}
            </div>
          )}
        </div>

        {/* Strategy info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">
              {strategy.name}
            </span>
            {recommended && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                추천
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500 truncate">
              {translateStrategyName(strategy.name)}
            </span>
            <span className="text-[10px] text-zinc-600">|</span>
            <span className="text-[10px] text-zinc-500">
              {CATEGORY_LABEL[category] || category}
            </span>
          </div>
          {/* Regime tags */}
          {regimes.length > 0 && (
            <div className="flex gap-1 mt-1">
              {regimes.slice(0, 3).map((r) => (
                <span
                  key={r}
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] rounded',
                    REGIME_TAG_COLORS[r] || 'bg-zinc-500/20 text-zinc-400',
                  )}
                >
                  {translateRegime(r)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right side: risk + status */}
        <div className="flex-shrink-0 flex items-center gap-2">
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium',
              risk.color,
            )}
          >
            {risk.label}
          </span>
          <Badge variant={active ? 'success' : 'neutral'} dot>
            {active ? '활성' : '비활성'}
          </Badge>
          {/* Chevron */}
          <svg
            className={cn(
              'w-4 h-4 text-zinc-500 transition-transform',
              expanded && 'rotate-180',
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3">
          <StrategyDetail
            strategyName={strategy.name}
            sessionId={sessionId}
            realtimeSignals={realtimeSignals}
            positions={positions}
          />
        </div>
      )}
    </div>
  );
}
