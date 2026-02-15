'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  formatCurrency,
  formatSymbol,
  getPnlColor,
  getPnlSign,
  translateStrategyName,
  cn,
} from '@/lib/utils';
import type { BacktestSummary } from '@/types/backtest';

interface BacktestListPanelProps {
  backtests: BacktestSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusBadge: Record<
  BacktestSummary['status'],
  { variant: 'success' | 'danger' | 'info'; label: string }
> = {
  completed: { variant: 'success', label: '완료' },
  error: { variant: 'danger', label: '오류' },
  running: { variant: 'info', label: '실행 중' },
};

function formatDateRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  return `${fmt(startMs)} ~ ${fmt(endMs)}`;
}

export default function BacktestListPanel({
  backtests,
  activeId,
  onSelect,
  onDelete,
}: BacktestListPanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <Card title="백테스트 기록">
      {backtests.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <p className="text-sm text-[var(--text-muted)]">
            아직 실행된 백테스트가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {backtests.map((bt) => {
            const isActive = bt.id === activeId;
            const badge = statusBadge[bt.status];
            const hasPnl = bt.status === 'completed' && bt.metrics;

            return (
              <div
                key={bt.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(bt.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(bt.id);
                  }
                }}
                className={cn(
                  'w-full text-left px-3 py-3 rounded-lg border transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[var(--accent)]/10 border-[var(--accent)]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] hover:border-[var(--border-muted)]'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Left: strategy info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {translateStrategyName(bt.config.strategyName)}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-secondary)] flex-shrink-0">
                        {formatSymbol(bt.config.symbol)}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-muted)]">
                      {formatDateRange(bt.config.startTime, bt.config.endTime)}
                    </p>

                    {hasPnl && bt.metrics && (
                      <p
                        className={cn(
                          'text-sm font-mono font-medium mt-1',
                          getPnlColor(bt.metrics.totalPnl)
                        )}
                      >
                        {getPnlSign(bt.metrics.totalPnl)}${formatCurrency(bt.metrics.totalPnl)}
                        <span className="text-xs ml-1.5">
                          ({getPnlSign(bt.metrics.totalReturn)}
                          {parseFloat(bt.metrics.totalReturn).toFixed(2)}%)
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Right: status badge + delete */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge variant={badge.variant} dot>
                      {badge.label}
                    </Badge>

                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(bt.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          setDeleteTarget(bt.id);
                        }
                      }}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--loss)] transition-colors cursor-pointer"
                    >
                      삭제
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        title="백테스트 삭제"
        message="이 백테스트 결과를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        variant="danger"
      />
    </Card>
  );
}
