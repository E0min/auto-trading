'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import StrategyCard from '@/components/strategy/StrategyCard';
import { botApi } from '@/lib/api-client';
import {
  translateRegime,
  getRegimeColor,
  getRegimeDotColor,
  getStrategyCategory,
  cn,
} from '@/lib/utils';
import type { StrategyListItem, MarketRegime, Signal, Position, GraceState } from '@/types';
import type { StrategyGraceInfo } from '@/hooks/useSocket';

// ── Types ────────────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | 'price-action' | 'indicator-light' | 'indicator-heavy' | 'custom';

const ALL_REGIMES: MarketRegime[] = [
  'trending_up',
  'trending_down',
  'ranging',
  'volatile',
  'quiet',
];

// ── Props ────────────────────────────────────────────────────────────────────

interface StrategyHubProps {
  botRunning: boolean;
  currentRegime: string | null;
  sessionId: string | null;
  realtimeSignals: Signal[];
  positions: Position[];
  strategyGraceStates?: Record<string, StrategyGraceInfo>;
  onSelectionChange?: (selected: string[]) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StrategyHub({
  botRunning,
  currentRegime,
  sessionId,
  realtimeSignals,
  positions,
  strategyGraceStates = {},
  onSelectionChange,
}: StrategyHubProps) {
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [regimeFilter, setRegimeFilter] = useState<string>('all');

  // Expanded card
  const [expandedName, setExpandedName] = useState<string | null>(null);

  // Disable mode dialog
  const [disableTarget, setDisableTarget] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchStrategies = useCallback(async () => {
    try {
      const data = await botApi.getStrategies();
      setStrategies(data.strategies);
    } catch (err) {
      console.error('전략 목록 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  // Notify parent of pre-selected strategies
  useEffect(() => {
    if (!botRunning && onSelectionChange) {
      const selected = strategies.filter((s) => s.active).map((s) => s.name);
      onSelectionChange(selected);
    }
  }, [strategies, botRunning, onSelectionChange]);

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredStrategies = useMemo(() => {
    return strategies.filter((s) => {
      const isCustom = s.name.startsWith('Custom_');
      if (categoryFilter === 'custom') {
        if (!isCustom) return false;
      } else if (categoryFilter !== 'all') {
        if (isCustom) return false;
        if (getStrategyCategory(s.name) !== categoryFilter) return false;
      }
      if (regimeFilter !== 'all') {
        const regimes = s.targetRegimes || [];
        if (!regimes.includes(regimeFilter)) return false;
      }
      return true;
    });
  }, [strategies, categoryFilter, regimeFilter]);

  // ── Resolve effective grace state (socket overrides API) ────────────────

  const getEffectiveGraceState = useCallback(
    (strategy: StrategyListItem): { graceState: GraceState; graceExpiresAt: string | null } => {
      const socketInfo = strategyGraceStates[strategy.name];
      if (socketInfo) {
        return { graceState: socketInfo.graceState, graceExpiresAt: socketInfo.graceExpiresAt };
      }
      // Fallback to API-provided data
      return {
        graceState: strategy.graceState ?? (strategy.active ? 'active' : 'inactive'),
        graceExpiresAt: strategy.graceExpiresAt ?? null,
      };
    },
    [strategyGraceStates],
  );

  // ── Strategy recommended check ──────────────────────────────────────────

  const isRecommended = useCallback(
    (strategy: StrategyListItem) => {
      if (!currentRegime) return false;
      return (strategy.targetRegimes || []).includes(currentRegime);
    },
    [currentRegime],
  );

  // ── Toggle handler ──────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (strategy: StrategyListItem) => {
      if (togglingName) return;

      // If disabling while bot is running, show mode selection dialog
      if (botRunning && strategy.active) {
        setDisableTarget(strategy.name);
        return;
      }

      setTogglingName(strategy.name);
      try {
        if (botRunning) {
          await botApi.enableStrategy(strategy.name);
          await fetchStrategies();
        } else {
          setStrategies((prev) =>
            prev.map((s) =>
              s.name === strategy.name ? { ...s, active: !s.active } : s,
            ),
          );
        }
      } catch (err) {
        console.error(`전략 ${strategy.active ? '비활성화' : '활성화'} 실패:`, err);
      } finally {
        setTogglingName(null);
      }
    },
    [togglingName, botRunning, fetchStrategies],
  );

  const handleDisableConfirm = useCallback(
    async (mode: 'immediate' | 'graceful') => {
      if (!disableTarget) return;
      const name = disableTarget;
      setDisableTarget(null);
      setTogglingName(name);

      try {
        await botApi.disableStrategy(name, mode);
        await fetchStrategies();
      } catch (err) {
        console.error('전략 비활성화 실패:', err);
      } finally {
        setTogglingName(null);
      }
    },
    [disableTarget, fetchStrategies],
  );

  // ── Expand handler ──────────────────────────────────────────────────────

  const handleExpand = useCallback((name: string) => {
    setExpandedName((prev) => (prev === name ? null : name));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </Card>
    );
  }

  const activeCount = filteredStrategies.filter((s) => s.active).length;
  const graceCount = filteredStrategies.filter((s) => {
    const { graceState } = getEffectiveGraceState(s);
    return graceState === 'grace_period';
  }).length;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">전략 관리</h2>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">
            {activeCount}/{filteredStrategies.length}
            {graceCount > 0 && (
              <span className="text-amber-400 ml-1">({graceCount} 유예)</span>
            )}
          </span>
        </div>
        {/* Current regime */}
        {currentRegime && (
          <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', getRegimeColor(currentRegime))}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', getRegimeDotColor(currentRegime))} />
            현재: {translateRegime(currentRegime)}
          </span>
        )}
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 mb-2">
        {([
          ['all', '전체'],
          ['price-action', 'Price Action'],
          ['indicator-light', 'Indicator-Light'],
          ['indicator-heavy', 'Indicator-Heavy'],
          ['custom', '커스텀'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategoryFilter(value)}
            className={cn(
              'px-2.5 py-1 text-[11px] rounded-md transition-colors',
              categoryFilter === value
                ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
                : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Regime filter */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => setRegimeFilter('all')}
          className={cn(
            'px-2.5 py-1 text-[11px] rounded-md transition-colors',
            regimeFilter === 'all'
              ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
              : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
          )}
        >
          전체
        </button>
        {ALL_REGIMES.map((r) => {
          const isCurrent = currentRegime === r;
          const isSelected = regimeFilter === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRegimeFilter(r)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md transition-colors',
                isSelected
                  ? 'text-[var(--accent)] bg-[var(--accent-subtle)] border border-[var(--accent)]/20'
                  : 'text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-muted)]',
              )}
            >
              {isCurrent && (
                <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(r))} />
              )}
              {translateRegime(r)}
            </button>
          );
        })}
      </div>

      {!botRunning && (
        <p className="text-[11px] text-[var(--text-muted)] mb-3">
          봇 시작 시 활성화할 전략을 선택하세요.
        </p>
      )}

      {/* Strategy cards */}
      <div className="space-y-1">
        {filteredStrategies.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">
            선택한 필터에 해당하는 전략이 없습니다.
          </p>
        ) : (
          filteredStrategies.map((strategy) => {
            const { graceState, graceExpiresAt } = getEffectiveGraceState(strategy);
            return (
              <StrategyCard
                key={strategy.name}
                strategy={strategy}
                active={strategy.active}
                graceState={graceState}
                graceExpiresAt={graceExpiresAt}
                recommended={isRecommended(strategy)}
                expanded={expandedName === strategy.name}
                botRunning={botRunning}
                toggling={togglingName === strategy.name}
                sessionId={sessionId}
                realtimeSignals={realtimeSignals}
                positions={positions}
                onToggle={() => handleToggle(strategy)}
                onExpand={() => handleExpand(strategy.name)}
              />
            );
          })
        )}
      </div>

      {/* Disable mode dialog — accessible */}
      {disableTarget && (
        <DisableModeDialog
          strategyName={disableTarget}
          onConfirm={handleDisableConfirm}
          onClose={() => setDisableTarget(null)}
        />
      )}

    </Card>
  );
}

// ── DisableModeDialog (accessible) ──────────────────────────────────────

interface DisableModeDialogProps {
  strategyName: string;
  onConfirm: (mode: 'immediate' | 'graceful') => void;
  onClose: () => void;
}

function DisableModeDialog({ strategyName, onConfirm, onClose }: DisableModeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus first action button
    requestAnimationFrame(() => {
      firstBtnRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap: Tab cycles within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-[var(--bg-card)] border border-[var(--border-muted)] rounded-xl p-5 w-80 shadow-xl outline-none"
      >
        <h3 id="disable-dialog-title" className="text-sm font-medium text-[var(--text-primary)] mb-1">
          전략 비활성화
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          <span className="text-[var(--text-secondary)] font-medium">{strategyName}</span> 전략을 어떻게 종료할까요?
        </p>
        <div className="space-y-2">
          <button
            ref={firstBtnRef}
            type="button"
            onClick={() => onConfirm('immediate')}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--loss)]/50 hover:bg-[var(--loss)]/5 transition-colors group"
          >
            <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--loss)]">
              즉시 청산
            </span>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              열린 포지션을 시장가로 즉시 청산합니다
            </p>
          </button>
          <button
            type="button"
            onClick={() => onConfirm('graceful')}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors group"
          >
            <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-amber-400">
              자연 종료
            </span>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              신규 진입을 차단하고, 기존 포지션은 SL/TP로 자연 청산
            </p>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          취소
        </button>
      </div>
    </div>
  );
}
