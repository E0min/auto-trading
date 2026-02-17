'use client';

import { useState, useCallback } from 'react';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import StrategyDetail from '@/components/strategy/StrategyDetail';
import StrategyConfigPanel from '@/components/strategy/StrategyConfigPanel';
import { useCountdown } from '@/hooks/useCountdown';
import StrategyExplainer from '@/components/strategy/StrategyExplainer';
import {
  translateStrategyName,
  translateRegime,
  translateDifficulty,
  getDifficultyColor,
  getStrategyCategory,
  translateStrategyCategory,
  getRegimeColor,
  getRegimeDotColor,
  cn,
} from '@/lib/utils';
import type { StrategyListItem, Signal, Position, GraceState } from '@/types';

interface StrategyCardProps {
  strategy: StrategyListItem;
  active: boolean;
  graceState?: GraceState;
  graceExpiresAt?: string | null;
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


export default function StrategyCard({
  strategy,
  active,
  graceState,
  graceExpiresAt,
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

  // Resolve effective grace state
  const effectiveGraceState: GraceState = graceState ?? (active ? 'active' : 'inactive');
  const isGracePeriod = effectiveGraceState === 'grace_period';

  // Countdown timer for grace period
  const { formatted: countdownFormatted, expired: countdownExpired } = useCountdown(
    isGracePeriod ? graceExpiresAt : null,
  );

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
        isGracePeriod
          ? 'border-l-2 border-l-amber-500/50 border-amber-500/20 bg-amber-500/5'
          : active
            ? 'border-l-2 border-l-[var(--profit)]/50 border-[var(--border-muted)] bg-[var(--bg-surface)]'
            : 'border-[var(--border-subtle)] bg-transparent',
        !recommended && !active && !isGracePeriod && 'opacity-50',
      )}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle button — separated for accessibility */}
        <button
          type="button"
          className="flex-shrink-0"
          onClick={handleToggleClick}
          aria-pressed={active}
          aria-label={`${translateStrategyName(strategy.name)} 전략 ${active ? '비활성화' : '활성화'}`}
        >
          {toggling ? (
            <Spinner size="sm" />
          ) : (
            <div
              className={cn(
                'w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors',
                isGracePeriod
                  ? 'border-amber-400'
                  : active
                    ? 'border-[var(--profit)]'
                    : 'border-[var(--text-muted)]',
              )}
            >
              {isGracePeriod && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
              {active && !isGracePeriod && <div className="w-1.5 h-1.5 rounded-full bg-[var(--profit)]" />}
            </div>
          )}
        </button>

        {/* Expand button — rest of the row */}
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          aria-label={`${translateStrategyName(strategy.name)} 전략 상세 ${expanded ? '접기' : '펼치기'}`}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
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
                {translateStrategyCategory(category)}
              </span>
            </div>
            {/* R14-21: Quick Stats Bar — regime tags + key metrics (overcrowding fix) */}
            <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden max-w-full">
              {regimes.slice(0, 2).map((r) => (
                <span
                  key={r}
                  className={cn('inline-flex items-center gap-1 text-[10px] flex-shrink-0', getRegimeColor(r))}
                >
                  <span className={cn('w-1 h-1 rounded-full', getRegimeDotColor(r))} />
                  {translateRegime(r)}
                </span>
              ))}
              {regimes.length > 2 && (
                <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0" title={regimes.slice(2).map(translateRegime).join(', ')}>
                  +{regimes.length - 2}
                </span>
              )}
              {regimes.length > 0 && strategy.docs && (
                <span className="text-[var(--border-muted)] text-[10px] flex-shrink-0">|</span>
              )}
              {strategy.docs && (
                <>
                  <span className={cn('text-[10px] flex-shrink-0', getDifficultyColor(strategy.docs.difficulty))}>
                    {translateDifficulty(strategy.docs.difficulty)}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 truncate">
                    {strategy.docs.indicators.length}개 지표
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right side: risk + status + countdown */}
          <div className="flex-shrink-0 flex items-center gap-3">
            <span className={cn('text-[10px] font-medium', risk.color)}>
              {risk.label}
            </span>
            {isGracePeriod ? (
              <div className="flex items-center gap-2">
                <Badge variant="warning" dot>
                  유예 중
                </Badge>
                <span className="text-[10px] font-mono text-amber-400">
                  {countdownExpired ? '만료 중...' : `${countdownFormatted}`}
                </span>
              </div>
            ) : (
              <Badge variant={active ? 'success' : 'neutral'} dot>
                {active ? '활성' : '비활성'}
              </Badge>
            )}
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
      </div>

      {/* Expanded detail with tabs */}
      {expanded && (
        <ExpandedContent
          strategy={strategy}
          botRunning={botRunning}
          sessionId={sessionId}
          realtimeSignals={realtimeSignals}
          positions={positions}
        />
      )}
    </div>
  );
}

// ── Expanded content with tabs ──────────────────────────────────────────────

type ExpandedTab = 'overview' | 'detail' | 'config';

function ExpandedContent({
  strategy,
  botRunning,
  sessionId,
  realtimeSignals,
  positions,
}: {
  strategy: StrategyListItem;
  botRunning: boolean;
  sessionId: string | null;
  realtimeSignals: Signal[];
  positions: Position[];
}) {
  const hasParamMeta = (strategy.paramMeta?.length ?? 0) > 0;
  const [tab, setTab] = useState<ExpandedTab>('overview');

  const tabs: { key: ExpandedTab; label: string; show: boolean }[] = [
    { key: 'overview', label: '개요', show: true },
    { key: 'detail', label: '상세', show: true },
    { key: 'config', label: '설정', show: hasParamMeta },
  ];

  return (
    <div className="px-4 pb-4 animate-fade-in">
      {/* Tab bar */}
      {(
        <div className="flex gap-1 mb-3 border-b border-[var(--border-subtle)]">
          {tabs.filter(t => t.show).map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 text-[11px] transition-colors border-b-2 -mb-px',
                tab === t.key
                  ? 'text-[var(--accent)] border-[var(--accent)]'
                  : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'overview' ? (
        <StrategyExplainer strategy={strategy} />
      ) : tab === 'config' ? (
        <StrategyConfigPanel
          strategyName={strategy.name}
          paramMeta={strategy.paramMeta || []}
          defaultConfig={strategy.defaultConfig}
          botRunning={botRunning}
        />
      ) : (
        <StrategyDetail
          strategyName={strategy.name}
          sessionId={sessionId}
          realtimeSignals={realtimeSignals}
          positions={positions}
        />
      )}
    </div>
  );
}
