'use client';

import type { CustomCondition, CustomIndicatorDef } from '@/types';

const COMPARISONS = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'crosses_above', label: '상향 돌파' },
  { value: 'crosses_below', label: '하향 돌파' },
] as const;

const PRICE_FIELDS = ['close', 'open', 'high', 'low'] as const;

interface ConditionRowProps {
  condition: CustomCondition;
  indicators: CustomIndicatorDef[];
  onChange: (updated: CustomCondition) => void;
  onRemove: () => void;
}

/** Build available left/right value options from defined indicators */
function getValueOptions(indicators: CustomIndicatorDef[]) {
  const options: { value: string; label: string }[] = [];

  // Price fields
  for (const p of PRICE_FIELDS) {
    options.push({ value: p, label: p });
  }

  // Indicator fields
  for (const ind of indicators) {
    const t = ind.type;
    if (t === 'macd') {
      options.push({ value: `${ind.id}.macdLine`, label: `${ind.id} MACD` });
      options.push({ value: `${ind.id}.signalLine`, label: `${ind.id} Signal` });
      options.push({ value: `${ind.id}.histogram`, label: `${ind.id} Hist` });
    } else if (t === 'bb' || t === 'keltner') {
      options.push({ value: `${ind.id}.upper`, label: `${ind.id} Upper` });
      options.push({ value: `${ind.id}.middle`, label: `${ind.id} Middle` });
      options.push({ value: `${ind.id}.lower`, label: `${ind.id} Lower` });
    } else if (t === 'stochastic') {
      options.push({ value: `${ind.id}.k`, label: `${ind.id} %K` });
      options.push({ value: `${ind.id}.d`, label: `${ind.id} %D` });
    } else {
      options.push({ value: ind.id, label: `${ind.id} (${t.toUpperCase()})` });
    }
  }

  return options;
}

export default function ConditionRow({
  condition,
  indicators,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const valueOptions = getValueOptions(indicators);

  const isRightNumeric = typeof condition.right === 'number' ||
    (typeof condition.right === 'string' && !isNaN(parseFloat(condition.right)) &&
     !PRICE_FIELDS.includes(condition.right as typeof PRICE_FIELDS[number]) &&
     !indicators.some(i => condition.right === i.id || String(condition.right).startsWith(`${i.id}.`)));

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* Left operand */}
      <select
        value={condition.left}
        onChange={(e) => onChange({ ...condition, left: e.target.value })}
        className="w-28 px-1.5 py-1 text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
      >
        {valueOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Comparison operator */}
      <select
        value={condition.comparison}
        onChange={(e) => onChange({ ...condition, comparison: e.target.value as CustomCondition['comparison'] })}
        className="w-20 px-1 py-1 text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
      >
        {COMPARISONS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      {/* Right operand — toggle between number input and dropdown */}
      {isRightNumeric ? (
        <input
          type="number"
          value={String(condition.right)}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            onChange({ ...condition, right: isNaN(num) ? e.target.value : num });
          }}
          className="w-20 px-1.5 py-1 text-[11px] font-mono text-right bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
          placeholder="값"
        />
      ) : (
        <select
          value={String(condition.right)}
          onChange={(e) => onChange({ ...condition, right: e.target.value })}
          className="w-28 px-1.5 py-1 text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
        >
          {valueOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {/* Toggle right type */}
      <button
        type="button"
        onClick={() => {
          if (isRightNumeric) {
            onChange({ ...condition, right: valueOptions[0]?.value || 'close' });
          } else {
            onChange({ ...condition, right: 0 });
          }
        }}
        title={isRightNumeric ? '지표로 전환' : '숫자로 전환'}
        className="px-1 py-0.5 text-[9px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)] transition-colors"
      >
        {isRightNumeric ? '#→f' : 'f→#'}
      </button>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="px-1 text-[var(--text-muted)] hover:text-[var(--loss)] transition-colors"
        aria-label="조건 삭제"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
