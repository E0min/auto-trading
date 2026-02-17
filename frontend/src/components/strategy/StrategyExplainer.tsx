'use client';

import { translateDifficulty, getDifficultyColor, cn } from '@/lib/utils';
import type { StrategyDocs } from '@/types';

interface StrategyExplainerProps {
  docs: StrategyDocs;
  strategyName: string;
}

export default function StrategyExplainer({ docs, strategyName }: StrategyExplainerProps) {
  return (
    <div className="space-y-4 text-xs">
      {/* Summary */}
      <div>
        <p className="text-[var(--text-secondary)] leading-relaxed">{docs.summary}</p>
      </div>

      {/* Quick info row */}
      <div className="flex flex-wrap gap-2">
        <InfoChip label="난이도" value={translateDifficulty(docs.difficulty)} className={getDifficultyColor(docs.difficulty)} />
        <InfoChip label="타임프레임" value={docs.timeframe} />
        <InfoChip label="RR 비율" value={docs.riskReward.ratio} />
      </div>

      {/* Entry conditions */}
      <Section title="진입 조건">
        <div className="space-y-2">
          <ConditionBlock label="롱" color="text-emerald-400" text={docs.entry.long} />
          <ConditionBlock label="숏" color="text-red-400" text={docs.entry.short} />
          {docs.entry.conditions && docs.entry.conditions.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">공통 조건</span>
              <ul className="mt-1 space-y-0.5">
                {docs.entry.conditions.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)] mt-0.5 flex-shrink-0">-</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Exit conditions */}
      <Section title="청산 조건">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="익절 (TP)" value={docs.exit.tp} color="text-[var(--profit)]" />
          <MiniStat label="손절 (SL)" value={docs.exit.sl} color="text-[var(--loss)]" />
          <MiniStat label="트레일링" value={docs.exit.trailing} />
        </div>
        {docs.exit.other && docs.exit.other.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {docs.exit.other.map((o, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)] mt-0.5 flex-shrink-0">-</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Indicators */}
      <Section title="사용 지표">
        <div className="flex flex-wrap gap-1.5">
          {docs.indicators.map((ind, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded-md bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] border border-[var(--accent)]/10"
            >
              {ind}
            </span>
          ))}
        </div>
      </Section>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-3">
        <Section title="강점">
          <ul className="space-y-1">
            {docs.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[var(--text-secondary)]">
                <span className="text-[var(--profit)] mt-0.5 flex-shrink-0">+</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="약점">
          <ul className="space-y-1">
            {docs.weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[var(--text-secondary)]">
                <span className="text-[var(--loss)] mt-0.5 flex-shrink-0">-</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Best for */}
      <Section title="적합한 장세">
        <p className="text-[var(--text-secondary)]">{docs.bestFor}</p>
      </Section>

      {/* Warnings */}
      {docs.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">주의사항</span>
          <ul className="mt-1 space-y-0.5">
            {docs.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-amber-300/80">
                <span className="mt-0.5 flex-shrink-0">!</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
        {title}
      </h5>
      {children}
    </div>
  );
}

function InfoChip({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={cn('font-medium text-[var(--text-primary)]', className)}>{value}</span>
    </span>
  );
}

function ConditionBlock({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('text-[10px] font-medium w-5 flex-shrink-0 mt-0.5', color)}>{label}</span>
      <span className="text-[var(--text-secondary)]">{text}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <span className={cn('text-[11px] font-medium text-[var(--text-primary)]', color)}>{value}</span>
    </div>
  );
}
