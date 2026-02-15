'use client';

import { translateRegime, translateStrategyName, getRegimeColor, getRegimeDotColor, cn } from '@/lib/utils';
import type { StrategyRoutingData } from '@/types';

interface RegimeFlowMapProps {
  data: StrategyRoutingData | null;
}

const ALL_REGIMES = ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet'] as const;

export default function RegimeFlowMap({ data }: RegimeFlowMapProps) {
  if (!data) {
    return <p className="text-[var(--text-muted)] text-xs">전략 라우팅 데이터 없음</p>;
  }

  const { currentRegime, strategies, regimeBreakdown } = data;
  const active = strategies.filter((s) => s.active);
  const inactive = strategies.filter((s) => !s.active);

  return (
    <div className="space-y-4">
      {/* 3-column grid: regime → active → inactive */}
      <div className="grid grid-cols-[140px_1fr_1fr] gap-3">
        {/* Left: current regime */}
        <div className="flex items-start">
          <div className={cn(
            'w-full rounded-lg border-2 p-3 text-center',
            currentRegime ? 'border-[var(--accent)]' : 'border-[var(--border-subtle)]',
          )}>
            {currentRegime ? (
              <>
                <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', getRegimeColor(currentRegime))}>
                  <span className={cn('w-2 h-2 rounded-full animate-pulse', getRegimeDotColor(currentRegime))} />
                  {translateRegime(currentRegime)}
                </span>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">현재 레짐</div>
              </>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">대기 중</span>
            )}
          </div>
        </div>

        {/* Center: active strategies */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
            활성 ({active.length})
          </div>
          <div className="space-y-1">
            {active.length === 0 ? (
              <span className="text-[11px] text-[var(--text-muted)]">없음</span>
            ) : (
              active.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--bg-surface)]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--profit)]" />
                  <span className="text-[11px] text-[var(--text-primary)] truncate">
                    {translateStrategyName(s.name)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: inactive strategies */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
            비활성 ({inactive.length})
          </div>
          <div className="space-y-1">
            {inactive.length === 0 ? (
              <span className="text-[11px] text-[var(--text-muted)]">없음</span>
            ) : (
              inactive.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--bg-surface)] opacity-40"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                  <span className="text-[11px] text-[var(--text-muted)] truncate">
                    {translateStrategyName(s.name)}
                  </span>
                  <span className="ml-auto text-[9px] text-[var(--text-muted)]">
                    {s.targetRegimes.map((r) => translateRegime(r)).join(', ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Regime breakdown matrix */}
      <div className="grid grid-cols-5 gap-2 pt-3 border-t border-[var(--border-subtle)]">
        {ALL_REGIMES.map((regime) => {
          const bd = regimeBreakdown?.[regime.toUpperCase()] ??
                     regimeBreakdown?.[regime] ??
                     { active: [], inactive: [] };
          const count = bd.active.length;
          const isCurrent = currentRegime === regime;
          return (
            <div
              key={regime}
              className={cn(
                'rounded-lg p-2 text-center border',
                isCurrent
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
              )}
            >
              <div className={cn('text-[10px] font-medium', getRegimeColor(regime))}>
                {translateRegime(regime)}
              </div>
              <div className="text-lg font-semibold text-[var(--text-primary)] mt-0.5">{count}</div>
              <div className="text-[9px] text-[var(--text-muted)]">전략</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
