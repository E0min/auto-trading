'use client';

import { translateRegime, getRegimeColor, getRegimeDotColor, cn, formatCurrency } from '@/lib/utils';
import type { RegimeContext } from '@/types';

interface FactorBreakdownProps {
  context: RegimeContext | null;
}

const FACTOR_META: { key: string; label: string; desc: string }[] = [
  { key: 'f1', label: 'Trend', desc: '추세 강도' },
  { key: 'f2', label: 'Momentum', desc: '모멘텀' },
  { key: 'f3', label: 'Volatility', desc: '변동성' },
  { key: 'f4', label: 'Volume', desc: '거래량' },
  { key: 'f5', label: 'Mean-Rev', desc: '평균 회귀' },
];

export default function FactorBreakdown({ context }: FactorBreakdownProps) {
  if (!context) {
    return <p className="text-[var(--text-muted)] text-xs">레짐 데이터 없음</p>;
  }

  const scores = context.factorScores ?? {};

  return (
    <div className="space-y-4">
      {/* Regime + Confidence summary */}
      <div className="flex items-center gap-3">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', getRegimeColor(context.regime))}>
          <span className={cn('w-2 h-2 rounded-full animate-pulse', getRegimeDotColor(context.regime))} />
          {translateRegime(context.regime)}
        </span>
        <span className="text-[var(--text-muted)] text-[11px] font-mono">
          신뢰도 {Math.round(context.confidence * 100)}%
        </span>
      </div>

      {/* Factor bars */}
      <div className="space-y-2.5">
        {FACTOR_META.map(({ key, label, desc }) => {
          const val = scores[key] ?? 0;
          const pct = Math.max(0, Math.min(100, Math.round(val * 100)));
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {label} <span className="text-[var(--text-muted)]">{desc}</span>
                </span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">{pct}</span>
              </div>
              <div className="h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom indicator grid */}
      <div className="grid grid-cols-5 gap-3 pt-3 border-t border-[var(--border-subtle)]">
        {[
          { label: 'BTC', value: context.btcPrice ? formatCurrency(String(context.btcPrice), 0) : '-' },
          { label: 'EMA-9', value: context.ema9 ? formatCurrency(String(context.ema9), 0) : '-' },
          { label: 'SMA-20', value: context.sma20 ? formatCurrency(String(context.sma20), 0) : '-' },
          { label: 'SMA-50', value: context.sma50 ? formatCurrency(String(context.sma50), 0) : '-' },
          { label: 'ATR', value: context.atr ? formatCurrency(String(context.atr), 0) : '-' },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</div>
            <div className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
