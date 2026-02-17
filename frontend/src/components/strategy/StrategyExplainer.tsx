'use client';

import { useMemo } from 'react';
import {
  translateDifficulty,
  getDifficultyColor,
  translateRegime,
  getRegimeColor,
  getRegimeDotColor,
  cn,
} from '@/lib/utils';
import type { StrategyListItem, ParamMeta } from '@/types';

interface StrategyExplainerProps {
  strategy: StrategyListItem;
}

// ── Group labels ────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  signal: '시그널',
  indicator: '지표',
  risk: '리스크',
  sizing: '포지션',
};

const VOLATILITY_LABELS: Record<string, string> = {
  high: '고변동성 선호',
  low: '저변동성 선호',
  neutral: '중립',
};

const RISK_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: '저위험', color: 'text-[var(--profit)]' },
  medium: { label: '중위험', color: 'text-amber-400' },
  high: { label: '고위험', color: 'text-[var(--loss)]' },
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function StrategyExplainer({ strategy }: StrategyExplainerProps) {
  const docs = strategy.docs;
  const paramMeta = strategy.paramMeta || [];
  const defaultConfig = strategy.defaultConfig || {};
  const runtimeConfig = strategy.runtime?.currentConfig;

  // Group paramMeta by group field
  const paramGroups = useMemo(() => {
    if (paramMeta.length === 0) return [];

    const groups: Record<string, ParamMeta[]> = {};
    const ungrouped: ParamMeta[] = [];

    for (const meta of paramMeta) {
      if (meta.group) {
        if (!groups[meta.group]) groups[meta.group] = [];
        groups[meta.group].push(meta);
      } else {
        ungrouped.push(meta);
      }
    }

    const result: { label: string; params: ParamMeta[] }[] = [];
    for (const groupKey of ['signal', 'indicator', 'risk', 'sizing']) {
      if (groups[groupKey]) {
        result.push({ label: GROUP_LABELS[groupKey] || groupKey, params: groups[groupKey] });
      }
    }
    if (ungrouped.length > 0) {
      result.push({ label: '기타', params: ungrouped });
    }
    return result;
  }, [paramMeta]);

  const risk = RISK_LABELS[strategy.riskLevel || 'medium'];
  const regimes = strategy.targetRegimes || [];

  return (
    <div className="space-y-4 text-xs">
      {/* ── Docs Section ─────────────────────────────────────────────────── */}
      {docs && (
        <>
          {/* Summary */}
          <div>
            <p className="text-[var(--text-secondary)] leading-relaxed">{docs.summary}</p>
          </div>

          {/* Quick info row */}
          <div className="flex flex-wrap gap-2">
            <InfoChip label="난이도" value={translateDifficulty(docs.difficulty)} className={getDifficultyColor(docs.difficulty)} />
            <InfoChip label="타임프레임" value={docs.timeframe} />
            <InfoChip label="RR 비율" value={docs.riskReward.ratio} />
            <InfoChip label="위험등급" value={risk.label} className={risk.color} />
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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

          {/* Risk/Reward detail */}
          <Section title="리스크/리워드">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="익절 (TP)" value={docs.riskReward.tp} color="text-[var(--profit)]" />
              <MiniStat label="손절 (SL)" value={docs.riskReward.sl} color="text-[var(--loss)]" />
              <MiniStat label="비율 (RR)" value={docs.riskReward.ratio} color="text-[var(--accent)]" />
            </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </>
      )}

      {/* ── Target Regimes ───────────────────────────────────────────────── */}
      {regimes.length > 0 && (
        <Section title="대상 장세 (Target Regimes)">
          <div className="flex flex-wrap gap-1.5">
            {regimes.map((r) => (
              <span
                key={r}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-medium',
                  'bg-[var(--bg-surface)] border-[var(--border-subtle)]',
                  getRegimeColor(r),
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(r))} />
                {translateRegime(r)}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Default Config Values ────────────────────────────────────────── */}
      {paramGroups.length > 0 && (
        <Section title="기본 설정값">
          <div className="space-y-3">
            {paramGroups.map((group) => (
              <div key={group.label}>
                <span className="text-[10px] text-[var(--text-muted)] font-medium">{group.label}</span>
                <div className="mt-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                  {group.params.map((meta) => {
                    const currentVal = runtimeConfig?.[meta.field];
                    const defaultVal = defaultConfig[meta.field];
                    const displayVal = currentVal ?? defaultVal;
                    const isChanged = runtimeConfig && currentVal !== undefined
                      && String(currentVal) !== String(defaultVal);

                    return (
                      <div key={meta.field} className="flex items-baseline justify-between gap-2" title={meta.description || ''}>
                        <span className="text-[11px] text-[var(--text-secondary)] truncate">
                          {meta.label}
                        </span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <span className={cn(
                            'text-[11px] font-mono font-medium',
                            isChanged ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]',
                          )}>
                            {formatParamValue(displayVal, meta.type)}
                          </span>
                          {isChanged && (
                            <span className="text-[9px] text-[var(--text-muted)] line-through">
                              {formatParamValue(defaultVal, meta.type)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Operational Metadata ──────────────────────────────────────────── */}
      <Section title="운영 파라미터">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <MetaItem label="최대 동시 포지션" value={String(strategy.maxConcurrentPositions ?? 1)} />
          <MetaItem label="최대 심볼 수" value={String(strategy.maxSymbolsPerStrategy ?? 1)} />
          <MetaItem
            label="쿨다운"
            value={formatDuration(strategy.cooldownMs ?? 0)}
          />
          <MetaItem
            label="워밍업 캔들"
            value={strategy.warmupCandles ? `${strategy.warmupCandles}개` : '없음'}
          />
          <MetaItem
            label="변동성 선호"
            value={VOLATILITY_LABELS[strategy.volatilityPreference || 'neutral'] || '중립'}
          />
          <MetaItem
            label="위험등급"
            value={risk.label}
            className={risk.color}
          />
        </div>
      </Section>

      {/* ── Runtime Info (when bot is running) ────────────────────────────── */}
      {strategy.runtime && (
        <Section title="런타임 정보">
          <div className="space-y-2">
            {strategy.runtime.assignedSymbols.length > 0 && (
              <div>
                <span className="text-[10px] text-[var(--text-muted)]">배정 심볼</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {strategy.runtime.assignedSymbols.map((sym) => (
                    <span
                      key={sym}
                      className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] text-[10px] border border-[var(--border-subtle)] font-mono"
                    >
                      {sym}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {strategy.runtime.assignedSymbols.length === 0 && (
              <p className="text-[11px] text-[var(--text-muted)]">배정된 심볼이 없습니다.</p>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatParamValue(value: unknown, type: string): string {
  if (value === undefined || value === null) return '-';
  if (type === 'boolean') return value === true || value === 'true' ? 'ON' : 'OFF';
  if (type === 'percent') return `${value}%`;
  return String(value);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '없음';
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  return `${Math.round(ms / 60_000)}분`;
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

function MetaItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <span className={cn('text-[11px] font-medium text-[var(--text-primary)]', className)}>{value}</span>
    </div>
  );
}
