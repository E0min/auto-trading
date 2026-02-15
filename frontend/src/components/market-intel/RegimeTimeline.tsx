'use client';

import { useMemo } from 'react';
import { translateRegime, getRegimeColor, getRegimeDotColor, formatCurrency, cn } from '@/lib/utils';
import type { RegimeHistoryEntry } from '@/types';

interface RegimeTimelineProps {
  history: RegimeHistoryEntry[];
}

const REGIME_BG: Record<string, string> = {
  trending_up: 'bg-emerald-500/60',
  trending_down: 'bg-red-500/60',
  ranging: 'bg-amber-500/60',
  volatile: 'bg-purple-500/60',
  quiet: 'bg-blue-500/60',
  unknown: 'bg-zinc-500/60',
};

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}분`;
  return `${(ms / 3_600_000).toFixed(1)}시간`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RegimeTimeline({ history }: RegimeTimelineProps) {
  // Compute segments with durations
  const segments = useMemo(() => {
    if (history.length === 0) return [];
    return history.map((entry, i) => {
      const nextTs = i < history.length - 1 ? history[i + 1].ts : Date.now();
      return {
        ...entry,
        duration: nextTs - entry.ts,
      };
    });
  }, [history]);

  // Regime distribution
  const distribution = useMemo(() => {
    const totals: Record<string, number> = {};
    let totalMs = 0;
    for (const seg of segments) {
      totals[seg.current] = (totals[seg.current] || 0) + seg.duration;
      totalMs += seg.duration;
    }
    if (totalMs === 0) return [];
    return Object.entries(totals)
      .map(([regime, ms]) => ({ regime, pct: (ms / totalMs) * 100 }))
      .sort((a, b) => b.pct - a.pct);
  }, [segments]);

  const totalDuration = segments.reduce((s, seg) => s + seg.duration, 0) || 1;

  if (history.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs">레짐 변경 이력 없음</p>;
  }

  const recent = segments.slice(-20).reverse();

  return (
    <div className="space-y-4">
      {/* Horizontal color bar */}
      <div>
        <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">타임라인</div>
        <div className="flex h-5 rounded-md overflow-hidden gap-px">
          {segments.map((seg, i) => {
            const widthPct = Math.max(0.5, (seg.duration / totalDuration) * 100);
            return (
              <div
                key={i}
                className={cn('relative group', REGIME_BG[seg.current] || REGIME_BG.unknown)}
                style={{ width: `${widthPct}%` }}
                title={`${translateRegime(seg.current)} — ${formatDuration(seg.duration)}`}
              >
                {/* Hover tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 whitespace-nowrap">
                  <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[10px] shadow-lg">
                    <div className="text-[var(--text-primary)]">{translateRegime(seg.current)}</div>
                    <div className="text-[var(--text-muted)]">{formatDuration(seg.duration)} | {formatTs(seg.ts)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log list */}
      <div>
        <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
          최근 변경 ({recent.length}건)
        </div>
        <div className="space-y-1 max-h-[240px] overflow-y-auto">
          {recent.map((seg, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] px-1 py-0.5">
              <span className="font-mono text-[var(--text-muted)] w-12 shrink-0">{formatTs(seg.ts)}</span>
              <span className={cn('w-2 h-2 rounded-full shrink-0', getRegimeDotColor(seg.current))} />
              <span className={cn('shrink-0', getRegimeColor(seg.current))}>
                {translateRegime(seg.current)}
              </span>
              <span className="text-[var(--text-muted)]">{formatDuration(seg.duration)}</span>
              {seg.btcPrice > 0 && (
                <span className="ml-auto font-mono text-[var(--text-muted)]">
                  BTC {formatCurrency(String(seg.btcPrice), 0)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Distribution */}
      <div className="pt-3 border-t border-[var(--border-subtle)]">
        <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">레짐 분포</div>
        <div className="flex flex-wrap gap-3">
          {distribution.map(({ regime, pct }) => (
            <div key={regime} className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', getRegimeDotColor(regime))} />
              <span className={cn('text-[11px]', getRegimeColor(regime))}>
                {translateRegime(regime)}
              </span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
