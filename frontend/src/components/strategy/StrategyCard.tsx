'use client';

import { useCallback } from 'react';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import StrategyDetail from '@/components/strategy/StrategyDetail';
import {
  translateStrategyName,
  translateRegime,
  getStrategyCategory,
  getRegimeColor,
  getRegimeDotColor,
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

const RISK_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'text-[var(--profit)]/60' },
  medium: { label: 'Med', color: 'text-amber-400/60' },
  high: { label: 'High', color: 'text-[var(--loss)]/60' },
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          ? 'border-l-2 border-l-[var(--profit)]/50 border-[var(--border-muted)] bg-[var(--bg-surface)]'
          : 'border-[var(--border-subtle)] bg-transparent',
        !recommended && !active && 'opacity-50',
      )}
    >
      {/* Card header — clickable to expand */}
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
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
                'w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors',
                active ? 'border-[var(--profit)]' : 'border-[var(--text-muted)]',
              )}
            >
              {active && <div className="w-1.5 h-1.5 rounded-full bg-[var(--profit)]" />}
            </div>
          )}
        </div>

        {/* Strategy info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {strategy.name}
            </span>
            {recommended && (
              <span className="text-[10px] text-[var(--accent)]">
                추천
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              {translateStrategyName(strategy.name)}
            </span>
            <span className="text-[10px] text-[var(--border-muted)]">|</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {CATEGORY_LABEL[category] || category}
            </span>
          </div>
          {/* Regime tags — dot + text only */}
          {regimes.length > 0 && (
            <div className="flex gap-2 mt-1.5">
              {regimes.slice(0, 3).map((r) => (
                <span
                  key={r}
                  className={cn('inline-flex items-center gap-1 text-[10px]', getRegimeColor(r))}
                >
                  <span className={cn('w-1 h-1 rounded-full', getRegimeDotColor(r))} />
                  {translateRegime(r)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right side: risk + status */}
        <div className="flex-shrink-0 flex items-center gap-3">
          <span className={cn('text-[10px] font-medium', risk.color)}>
            {risk.label}
          </span>
          <Badge variant={active ? 'success' : 'neutral'} dot>
            {active ? '활성' : '비활성'}
          </Badge>
          {/* Chevron */}
          <svg
            className={cn(
              'w-3.5 h-3.5 text-[var(--text-muted)] transition-transform',
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
        <div className="px-4 pb-4 animate-fade-in">
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
