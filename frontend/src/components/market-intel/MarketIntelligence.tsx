'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import FactorBreakdown from './FactorBreakdown';
import CoinScoreboard from './CoinScoreboard';
import RegimeFlowMap from './RegimeFlowMap';
import RegimeTimeline from './RegimeTimeline';
import { useMarketIntelligence } from '@/hooks/useMarketIntelligence';
import { translateRegime, getRegimeColor, getRegimeDotColor, cn } from '@/lib/utils';
import type { BotState, MarketRegime } from '@/types';

interface MarketIntelligenceProps {
  botState: BotState;
  currentRegime: MarketRegime | null;
}

type TabKey = 'factors' | 'coins' | 'routing' | 'timeline';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'factors', label: '팩터 분석' },
  { key: 'coins', label: '코인 스코어보드' },
  { key: 'routing', label: '전략 라우팅' },
  { key: 'timeline', label: '레짐 타임라인' },
];

export default function MarketIntelligence({ botState, currentRegime }: MarketIntelligenceProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('factors');

  const {
    regimeContext,
    regimeHistory,
    coinScoring,
    strategyRouting,
    loading,
  } = useMarketIntelligence(botState);

  const regime = regimeContext?.regime ?? currentRegime ?? 'unknown';
  const confidence = regimeContext?.confidence ?? 0;

  // R7-FE2: Pending regime & cooldown
  const pendingRegime = regimeContext?.pendingRegime ?? null;
  const pendingCount = regimeContext?.pendingCount ?? 0;
  const hysteresisMinCandles = regimeContext?.hysteresisMinCandles ?? 3;
  const cooldownStatus = regimeContext?.cooldownStatus;
  const cooldownRemainingSeconds = cooldownStatus?.active
    ? Math.ceil((cooldownStatus.remainingMs ?? 0) / 1000)
    : 0;

  // R7-FE5: Transition frequency
  const transitionsLastHour = regimeContext?.transitionsLastHour ?? 0;
  const getTransitionBadge = (count: number) => {
    if (count >= 6) return { label: '과다', colorClass: 'bg-red-500/20 text-red-400 border-red-500/30' };
    if (count >= 3) return { label: '빈번', colorClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    return { label: '안정', colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  };
  const transitionBadge = getTransitionBadge(transitionsLastHour);

  return (
    <Card className="col-span-full">
      {/* Header — clickable toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between -mt-1 -mb-1"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            시장 분석
          </h3>
          <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', getRegimeColor(regime))}>
            <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(regime))} />
            {translateRegime(regime)}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {Math.round(confidence * 100)}%
          </span>

          {/* R7-FE2: Pending regime confirmation indicator */}
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
        <svg
          className={cn(
            'w-4 h-4 text-[var(--text-muted)] transition-transform duration-200',
            open && 'rotate-180',
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="mt-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1.5">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'px-3 py-1 rounded-full text-[11px] font-medium transition-colors',
                  activeTab === key
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div>
              {activeTab === 'factors' && <FactorBreakdown context={regimeContext} />}
              {activeTab === 'coins' && <CoinScoreboard data={coinScoring} />}
              {activeTab === 'routing' && <RegimeFlowMap data={strategyRouting} />}
              {activeTab === 'timeline' && <RegimeTimeline history={regimeHistory} />}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
