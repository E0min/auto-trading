'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
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
  return (
    <Card title="백테스트 기록">
      {backtests.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <p className="text-sm text-zinc-500">
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
              <button
                key={bt.id}
                type="button"
                onClick={() => onSelect(bt.id)}
                className={cn(
                  'w-full text-left px-3 py-3 rounded-lg border transition-colors',
                  isActive
                    ? 'bg-blue-500/10 border-blue-500'
                    : 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800 hover:border-zinc-600'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Left: strategy info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-zinc-200 truncate">
                        {translateStrategyName(bt.config.strategyName)}
                      </span>
                      <span className="text-xs font-mono text-zinc-400 flex-shrink-0">
                        {formatSymbol(bt.config.symbol)}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-500">
                      {formatDateRange(bt.config.startTime, bt.config.endTime)}
                    </p>

                    {/* PnL line for completed backtests */}
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

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(bt.id);
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
