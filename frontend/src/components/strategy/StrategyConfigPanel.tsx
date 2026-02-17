'use client';

import { useState, useCallback, useMemo } from 'react';
import { botApi } from '@/lib/api-client';
import type { ParamMeta } from '@/types';

interface StrategyConfigPanelProps {
  strategyName: string;
  paramMeta: ParamMeta[];
  defaultConfig: Record<string, unknown>;
  currentConfig?: Record<string, unknown>;
  botRunning: boolean;
  onConfigSaved?: () => void;
}

export default function StrategyConfigPanel({
  strategyName,
  paramMeta,
  defaultConfig,
  currentConfig,
  botRunning,
  onConfigSaved,
}: StrategyConfigPanelProps) {
  const initialValues = useMemo(() => {
    const vals: Record<string, string | number | boolean> = {};
    for (const meta of paramMeta) {
      const configVal = currentConfig?.[meta.field] ?? defaultConfig[meta.field];
      if (meta.type === 'boolean') {
        vals[meta.field] = configVal === true || configVal === 'true';
      } else {
        vals[meta.field] = configVal !== undefined ? configVal as string | number : '';
      }
    }
    return vals;
  }, [paramMeta, defaultConfig, currentConfig]);

  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hasChanges = useMemo(() => {
    return paramMeta.some((meta) => {
      return String(values[meta.field]) !== String(initialValues[meta.field]);
    });
  }, [values, initialValues, paramMeta]);

  const handleChange = useCallback((field: string, value: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
    setError(null);
  }, []);

  const handleReset = useCallback(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const meta of paramMeta) {
      const val = defaultConfig[meta.field];
      if (meta.type === 'boolean') {
        defaults[meta.field] = val === true || val === 'true';
      } else {
        defaults[meta.field] = val !== undefined ? val as string | number : '';
      }
    }
    setValues(defaults);
    setSaved(false);
    setError(null);
  }, [paramMeta, defaultConfig]);

  const handleSave = useCallback(async () => {
    if (!botRunning) return;
    setSaving(true);
    setError(null);
    try {
      const config: Record<string, unknown> = {};
      for (const meta of paramMeta) {
        const v = values[meta.field];
        if (meta.type === 'integer') {
          config[meta.field] = parseInt(String(v), 10);
        } else if (meta.type === 'boolean') {
          config[meta.field] = v === true || v === 'true';
        } else {
          config[meta.field] = String(v);
        }
      }
      await botApi.updateStrategyConfig(strategyName, config);
      setSaved(true);
      onConfigSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '설정 저장 실패');
    } finally {
      setSaving(false);
    }
  }, [botRunning, paramMeta, values, strategyName, onConfigSaved]);

  if (!paramMeta || paramMeta.length === 0) {
    return (
      <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">
        이 전략은 튜닝 가능한 파라미터가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          전략 설정
        </h4>
        <div className="flex items-center gap-2">
          {!botRunning && (
            <span className="text-[10px] text-amber-400">봇 실행 중에만 저장 가능</span>
          )}
          {saved && (
            <span className="text-[10px] text-[var(--profit)]">저장됨</span>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            기본값
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || !botRunning || saving}
            className="px-2.5 py-1 text-[10px] rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20 hover:bg-[var(--accent)]/10"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-[var(--loss)]">{error}</p>
      )}

      <div className="space-y-2">
        {paramMeta.map((meta) => (
          <ParamInput
            key={meta.field}
            meta={meta}
            value={values[meta.field]}
            onChange={(v) => handleChange(meta.field, v)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Individual parameter input ──────────────────────────────────────────────

interface ParamInputProps {
  meta: ParamMeta;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

function ParamInput({ meta, value, onChange }: ParamInputProps) {
  if (meta.type === 'boolean') {
    return (
      <div className="flex items-center justify-between py-1">
        <label className="text-[11px] text-[var(--text-secondary)]">{meta.label}</label>
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          onClick={() => onChange(!value)}
          className={`relative w-8 h-4 rounded-full transition-colors ${
            value ? 'bg-[var(--accent)]' : 'bg-[var(--border-muted)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
              value ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>
    );
  }

  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const hasRange = meta.min !== undefined && meta.max !== undefined;

  return (
    <div className="flex items-center gap-3 py-0.5">
      <label className="text-[11px] text-[var(--text-secondary)] w-32 flex-shrink-0 truncate">
        {meta.label}
      </label>
      {hasRange && (
        <input
          type="range"
          min={meta.min}
          max={meta.max}
          step={meta.step || 1}
          value={isNaN(numVal) ? meta.min : numVal}
          onChange={(e) => {
            const v = meta.type === 'integer'
              ? parseInt(e.target.value, 10)
              : e.target.value;
            onChange(v);
          }}
          className="flex-1 h-1 accent-[var(--accent)] bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none"
        />
      )}
      <input
        type="number"
        min={meta.min}
        max={meta.max}
        step={meta.step || 1}
        value={value === '' ? '' : String(value)}
        onChange={(e) => {
          const v = meta.type === 'integer'
            ? parseInt(e.target.value, 10)
            : e.target.value;
          onChange(isNaN(v as number) ? e.target.value : v);
        }}
        className="w-16 px-1.5 py-0.5 text-[11px] text-right font-mono text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded focus:border-[var(--accent)]/50 focus:outline-none"
      />
      {meta.type === 'percent' && (
        <span className="text-[10px] text-[var(--text-muted)]">%</span>
      )}
    </div>
  );
}
