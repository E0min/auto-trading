'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import ConditionRow from '@/components/strategy/ConditionRow';
import { botApi } from '@/lib/api-client';
import type {
  CustomStrategyDef,
  CustomIndicatorDef,
  CustomRuleGroup,
  CustomCondition,
} from '@/types';

const INDICATOR_TYPES = [
  { value: 'rsi', label: 'RSI', defaultParams: { period: 14 } },
  { value: 'ema', label: 'EMA', defaultParams: { period: 20 } },
  { value: 'sma', label: 'SMA', defaultParams: { period: 50 } },
  { value: 'macd', label: 'MACD', defaultParams: { fast: 12, slow: 26, signal: 9 } },
  { value: 'bb', label: 'BB', defaultParams: { period: 20, stdDev: 2 } },
  { value: 'atr', label: 'ATR', defaultParams: { period: 14 } },
  { value: 'adx', label: 'ADX', defaultParams: { period: 14 } },
  { value: 'stochastic', label: 'Stochastic', defaultParams: { period: 14, smooth: 3 } },
  { value: 'vwap', label: 'VWAP', defaultParams: {} },
  { value: 'keltner', label: 'Keltner', defaultParams: { emaPeriod: 20, atrPeriod: 10, mult: 1.5 } },
] as const;

const ALL_REGIMES = [
  { value: 'trending_up', label: '상승추세' },
  { value: 'trending_down', label: '하락추세' },
  { value: 'ranging', label: '횡보' },
  { value: 'volatile', label: '변동성' },
  { value: 'quiet', label: '조용' },
];

const EMPTY_GROUP: CustomRuleGroup = { operator: 'AND', conditions: [] };
const EMPTY_CONDITION: CustomCondition = { left: 'close', comparison: '>', right: 0 };

interface CustomStrategyBuilderProps {
  initialDef?: CustomStrategyDef | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CustomStrategyBuilder({
  initialDef,
  onClose,
  onSaved,
}: CustomStrategyBuilderProps) {
  const isEditing = !!initialDef;

  const [name, setName] = useState(initialDef?.name || '');
  const [description, setDescription] = useState(initialDef?.description || '');
  const [indicators, setIndicators] = useState<CustomIndicatorDef[]>(initialDef?.indicators || []);
  const [entryLong, setEntryLong] = useState<CustomRuleGroup>(initialDef?.rules?.entryLong || { ...EMPTY_GROUP });
  const [entryShort, setEntryShort] = useState<CustomRuleGroup>(initialDef?.rules?.entryShort || { ...EMPTY_GROUP });
  const [exitLong, setExitLong] = useState<CustomRuleGroup>(initialDef?.rules?.exitLong || { operator: 'OR', conditions: [] });
  const [exitShort, setExitShort] = useState<CustomRuleGroup>(initialDef?.rules?.exitShort || { operator: 'OR', conditions: [] });
  const [positionSizePercent, setPositionSizePercent] = useState(initialDef?.config?.positionSizePercent || '3');
  const [leverage, setLeverage] = useState(initialDef?.config?.leverage || '2');
  const [tpPercent, setTpPercent] = useState(initialDef?.config?.tpPercent || '3');
  const [slPercent, setSlPercent] = useState(initialDef?.config?.slPercent || '2');
  const [targetRegimes, setTargetRegimes] = useState<string[]>(
    initialDef?.targetRegimes || ['trending_up', 'trending_down', 'ranging'],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R14-18: Modal ref for focus trap
  const modalRef = useRef<HTMLDivElement>(null);

  // R14-18: ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // R14-18: Focus trap — return focus to modal on Tab out
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const focusableSelector = 'input, select, button, textarea, [tabindex]:not([tabindex="-1"])';

    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = modal.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', handleFocusTrap);

    // Auto-focus first focusable element
    const firstFocusable = modal.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    return () => modal.removeEventListener('keydown', handleFocusTrap);
  }, []);

  // ── Indicator management ────────────────────────────────────────────────

  const addIndicator = useCallback(() => {
    const type = INDICATOR_TYPES[0];
    const id = `${type.value}${indicators.length + 1}`;
    setIndicators((prev) => [
      ...prev,
      { id, type: type.value as CustomIndicatorDef['type'], params: { ...type.defaultParams } },
    ]);
  }, [indicators.length]);

  const updateIndicator = useCallback((index: number, updated: CustomIndicatorDef) => {
    setIndicators((prev) => prev.map((ind, i) => (i === index ? updated : ind)));
  }, []);

  const removeIndicator = useCallback((index: number) => {
    setIndicators((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Condition helpers ──────────────────────────────────────────────────

  const addCondition = useCallback(
    (setter: React.Dispatch<React.SetStateAction<CustomRuleGroup>>) => {
      setter((prev) => ({
        ...prev,
        conditions: [...prev.conditions, { ...EMPTY_CONDITION }],
      }));
    },
    [],
  );

  const updateCondition = useCallback(
    (setter: React.Dispatch<React.SetStateAction<CustomRuleGroup>>, index: number, cond: CustomCondition) => {
      setter((prev) => ({
        ...prev,
        conditions: prev.conditions.map((c, i) => (i === index ? cond : c)),
      }));
    },
    [],
  );

  const removeCondition = useCallback(
    (setter: React.Dispatch<React.SetStateAction<CustomRuleGroup>>, index: number) => {
      setter((prev) => ({
        ...prev,
        conditions: prev.conditions.filter((_, i) => i !== index),
      }));
    },
    [],
  );

  const toggleOperator = useCallback(
    (setter: React.Dispatch<React.SetStateAction<CustomRuleGroup>>) => {
      setter((prev) => ({
        ...prev,
        operator: prev.operator === 'AND' ? 'OR' : 'AND',
      }));
    },
    [],
  );

  // ── Regime toggle ──────────────────────────────────────────────────────

  const toggleRegime = useCallback((regime: string) => {
    setTargetRegimes((prev) =>
      prev.includes(regime) ? prev.filter((r) => r !== regime) : [...prev, regime],
    );
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('전략 이름을 입력하세요.');
      return;
    }
    if (indicators.length === 0) {
      setError('최소 1개 이상의 지표를 추가하세요.');
      return;
    }
    if (entryLong.conditions.length === 0 && entryShort.conditions.length === 0) {
      setError('최소 1개 이상의 진입 조건을 추가하세요.');
      return;
    }

    setSaving(true);
    setError(null);

    const def = {
      ...(isEditing ? { id: initialDef!.id } : {}),
      name: name.trim(),
      description: description.trim(),
      indicators,
      rules: { entryLong, entryShort, exitLong, exitShort },
      config: { positionSizePercent, leverage, tpPercent, slPercent },
      targetRegimes,
    };

    try {
      if (isEditing) {
        await botApi.updateCustomStrategy(initialDef!.id, def);
      } else {
        await botApi.createCustomStrategy(def);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }, [
    name, description, indicators, entryLong, entryShort, exitLong, exitShort,
    positionSizePercent, leverage, tpPercent, slPercent, targetRegimes,
    isEditing, initialDef, onSaved,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8" role="dialog" aria-modal="true" aria-label={isEditing ? '커스텀 전략 수정' : '커스텀 전략 빌더'}>
      <div ref={modalRef} className="bg-[var(--bg-card)] border border-[var(--border-muted)] rounded-xl w-full max-w-2xl shadow-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            {isEditing ? '커스텀 전략 수정' : '커스텀 전략 빌더'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-[11px] rounded-md text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20 hover:bg-[var(--accent)]/10 disabled:opacity-50 transition-colors"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <p className="text-[11px] text-[var(--loss)] bg-[var(--loss)]/5 px-3 py-1.5 rounded">{error}</p>
          )}

          {/* Basic info */}
          <div className="space-y-2">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">전략 이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My RSI Strategy"
                  className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">설명</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="RSI 역추세 전략"
                  className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Indicators */}
          <Section title="지표 정의" onAdd={addIndicator}>
            {indicators.length === 0 ? (
              <p className="text-[10px] text-[var(--text-muted)] py-2">지표를 추가하세요.</p>
            ) : (
              <div className="space-y-1.5">
                {indicators.map((ind, i) => (
                  <IndicatorRow
                    key={i}
                    indicator={ind}
                    onChange={(updated) => updateIndicator(i, updated)}
                    onRemove={() => removeIndicator(i)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Entry Long */}
          <RuleGroupSection
            title="롱 진입 조건"
            group={entryLong}
            indicators={indicators}
            onToggleOperator={() => toggleOperator(setEntryLong)}
            onAddCondition={() => addCondition(setEntryLong)}
            onUpdateCondition={(idx, cond) => updateCondition(setEntryLong, idx, cond)}
            onRemoveCondition={(idx) => removeCondition(setEntryLong, idx)}
          />

          {/* Entry Short */}
          <RuleGroupSection
            title="숏 진입 조건"
            group={entryShort}
            indicators={indicators}
            onToggleOperator={() => toggleOperator(setEntryShort)}
            onAddCondition={() => addCondition(setEntryShort)}
            onUpdateCondition={(idx, cond) => updateCondition(setEntryShort, idx, cond)}
            onRemoveCondition={(idx) => removeCondition(setEntryShort, idx)}
          />

          {/* Exit Long */}
          <RuleGroupSection
            title="롱 청산 조건"
            group={exitLong}
            indicators={indicators}
            onToggleOperator={() => toggleOperator(setExitLong)}
            onAddCondition={() => addCondition(setExitLong)}
            onUpdateCondition={(idx, cond) => updateCondition(setExitLong, idx, cond)}
            onRemoveCondition={(idx) => removeCondition(setExitLong, idx)}
          />

          {/* Exit Short */}
          <RuleGroupSection
            title="숏 청산 조건"
            group={exitShort}
            indicators={indicators}
            onToggleOperator={() => toggleOperator(setExitShort)}
            onAddCondition={() => addCondition(setExitShort)}
            onUpdateCondition={(idx, cond) => updateCondition(setExitShort, idx, cond)}
            onRemoveCondition={(idx) => removeCondition(setExitShort, idx)}
          />

          {/* Risk settings */}
          <div>
            <h4 className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">리스크 설정</h4>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">포지션 크기 (%)</label>
                <input
                  type="number" min={1} max={20} step={0.5}
                  value={positionSizePercent}
                  onChange={(e) => setPositionSizePercent(e.target.value)}
                  className="w-full px-2 py-1 text-[11px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">레버리지</label>
                <input
                  type="number" min={1} max={20} step={1}
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  className="w-full px-2 py-1 text-[11px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">익절 (%)</label>
                <input
                  type="number" min={0.5} max={20} step={0.5}
                  value={tpPercent}
                  onChange={(e) => setTpPercent(e.target.value)}
                  className="w-full px-2 py-1 text-[11px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] block mb-0.5">손절 (%)</label>
                <input
                  type="number" min={0.5} max={10} step={0.5}
                  value={slPercent}
                  onChange={(e) => setSlPercent(e.target.value)}
                  className="w-full px-2 py-1 text-[11px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Target regimes */}
          <div>
            <h4 className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">대상 레짐</h4>
            <div className="flex gap-2 flex-wrap">
              {ALL_REGIMES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => toggleRegime(r.value)}
                  className={`px-2.5 py-1 text-[11px] rounded-md transition-colors border ${
                    targetRegimes.includes(r.value)
                      ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border-[var(--accent)]/20'
                      : 'text-[var(--text-muted)] border-[var(--border-subtle)]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{title}</h4>
        <button
          type="button"
          onClick={onAdd}
          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent)]/80 transition-colors"
        >
          + 추가
        </button>
      </div>
      {children}
    </div>
  );
}

function IndicatorRow({
  indicator,
  onChange,
  onRemove,
}: {
  indicator: CustomIndicatorDef;
  onChange: (ind: CustomIndicatorDef) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={indicator.id}
        onChange={(e) => onChange({ ...indicator, id: e.target.value })}
        className="w-16 px-1.5 py-1 text-[11px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
        placeholder="id"
      />
      <select
        value={indicator.type}
        onChange={(e) => {
          const type = e.target.value as CustomIndicatorDef['type'];
          const typeDef = INDICATOR_TYPES.find((t) => t.value === type);
          onChange({
            ...indicator,
            type,
            params: typeDef ? { ...typeDef.defaultParams } : {},
          });
        }}
        className="w-24 px-1.5 py-1 text-[11px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
      >
        {INDICATOR_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <div className="flex-1 flex items-center gap-1.5 flex-wrap">
        {Object.entries(indicator.params).map(([key, val]) => (
          <div key={key} className="flex items-center gap-0.5">
            <span className="text-[9px] text-[var(--text-muted)]">{key}:</span>
            <input
              type="number"
              value={val}
              onChange={(e) => {
                const num = parseFloat(e.target.value);
                onChange({
                  ...indicator,
                  params: { ...indicator.params, [key]: isNaN(num) ? 0 : num },
                });
              }}
              className="w-12 px-1 py-0.5 text-[10px] font-mono bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] focus:border-[var(--accent)]/50 focus:outline-none"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-[var(--text-muted)] hover:text-[var(--loss)] transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function RuleGroupSection({
  title,
  group,
  indicators,
  onToggleOperator,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  title: string;
  group: CustomRuleGroup;
  indicators: CustomIndicatorDef[];
  onToggleOperator: () => void;
  onAddCondition: () => void;
  onUpdateCondition: (index: number, cond: CustomCondition) => void;
  onRemoveCondition: (index: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <h4 className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{title}</h4>
          <button
            type="button"
            onClick={onToggleOperator}
            className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 transition-colors"
          >
            {group.operator}
          </button>
        </div>
        <button
          type="button"
          onClick={onAddCondition}
          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent)]/80 transition-colors"
        >
          + 추가
        </button>
      </div>
      {group.conditions.length === 0 ? (
        <p className="text-[10px] text-[var(--text-muted)] py-1 pl-2">조건 없음</p>
      ) : (
        <div className="space-y-0.5">
          {group.conditions.map((cond, i) => (
            <ConditionRow
              key={i}
              condition={cond}
              indicators={indicators}
              onChange={(updated) => onUpdateCondition(i, updated)}
              onRemove={() => onRemoveCondition(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
