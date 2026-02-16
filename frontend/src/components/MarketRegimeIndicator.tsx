'use client';

import Card from '@/components/ui/Card';
import { translateRegime, getRegimeColor, cn } from '@/lib/utils';
import type { MarketRegimeData, RegimeContext } from '@/types';

interface MarketRegimeIndicatorProps {
  regime: MarketRegimeData | null;
  regimeContext?: RegimeContext | null;
}

export default function MarketRegimeIndicator({ regime, regimeContext }: MarketRegimeIndicatorProps) {
  const currentRegime = regime?.regime || 'unknown';
  const confidence = regime?.confidence ?? 0;

  // R7-FE2: Pending regime & cooldown from context
  const pendingRegime = regimeContext?.pendingRegime ?? null;
  const pendingCount = regimeContext?.pendingCount ?? 0;
  const hysteresisMinCandles = regimeContext?.hysteresisMinCandles ?? 3;
  const cooldownStatus = regimeContext?.cooldownStatus ?? regime?.cooldownStatus;
  const cooldownRemainingSeconds = cooldownStatus?.active
    ? Math.ceil((cooldownStatus.remainingMs ?? 0) / 1000)
    : 0;

  // R7-FE5: Transition frequency
  const transitionsLastHour = regimeContext?.transitionsLastHour ?? regime?.transitionsLastHour ?? 0;
  const getTransitionBadge = (count: number) => {
    if (count >= 6) return { label: '과다', colorClass: 'bg-red-500/20 text-red-400 border-red-500/30' };
    if (count >= 3) return { label: '빈번', colorClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    return { label: '안정', colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  };
  const transitionBadge = getTransitionBadge(transitionsLastHour);

  return (
    <Card title="시장 상태" className="col-span-full">
      <div className="flex items-center gap-4 flex-wrap">
        <span
          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${getRegimeColor(currentRegime)}`}
        >
          <span className={`w-2 h-2 rounded-full animate-pulse-dot ${
            currentRegime === 'trending_up' ? 'bg-emerald-400' :
            currentRegime === 'trending_down' ? 'bg-red-400' :
            currentRegime === 'ranging' ? 'bg-yellow-400' :
            currentRegime === 'volatile' ? 'bg-purple-400' :
            currentRegime === 'quiet' ? 'bg-blue-400' :
            'bg-zinc-400'
          }`} />
          {translateRegime(currentRegime)}
        </span>
        <span className="text-xs text-zinc-500">
          신뢰도: {Math.round(confidence * 100)}%
        </span>
        {regime?.timestamp && (
          <span className="text-xs text-zinc-600">
            {new Date(regime.timestamp).toLocaleTimeString('ko-KR')}
          </span>
        )}

        {/* R7-FE2: Pending regime confirmation */}
        {pendingRegime && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/25">
            <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
            확인 중: {translateRegime(pendingRegime)} ({pendingCount}/{hysteresisMinCandles})
          </span>
        )}

        {/* R7-FE2: Cooldown badge */}
        {cooldownStatus?.active && cooldownRemainingSeconds > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/25">
            쿨다운: {cooldownRemainingSeconds}초
          </span>
        )}

        {/* R7-FE5: Transition frequency badge */}
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border',
          transitionBadge.colorClass,
        )}>
          {transitionBadge.label}
          <span className="text-[9px] opacity-70">({transitionsLastHour}/h)</span>
        </span>
      </div>
    </Card>
  );
}
