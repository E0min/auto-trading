'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatSymbol, formatTime, translateSide, translateRejectReason } from '@/lib/utils';
import type { Signal } from '@/types';

interface SignalFeedProps {
  signals: Signal[];
}

const actionVariant: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
  open_long: 'success',
  open_short: 'danger',
  close_long: 'warning',
  close_short: 'info',
};

export default function SignalFeed({ signals }: SignalFeedProps) {
  return (
    <Card title="실시간 시그널" className="max-h-[500px] overflow-y-auto">
      {signals.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm text-center py-10">시그널 대기 중...</p>
      ) : (
        <div className="space-y-0">
          {signals.map((signal, idx) => (
            <div
              key={signal._id || idx}
              className="flex items-center justify-between py-3 border-b border-[var(--border-subtle)]/50 last:border-b-0 animate-slide-in"
            >
              <div className="flex items-center gap-3">
                <Badge variant={actionVariant[signal.action] || 'neutral'} dot>
                  {translateSide(signal.action)}
                </Badge>
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {formatSymbol(signal.symbol)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-[var(--text-muted)]">
                  {signal.strategy}
                </span>
                <span className="text-[var(--text-muted)] font-mono">
                  {Math.round(signal.confidence * 100)}%
                </span>
                {signal.riskApproved !== null && (
                  <div className="flex items-center gap-1.5">
                    <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
                      {signal.riskApproved ? '승인' : '거부'}
                    </Badge>
                    {!signal.riskApproved && signal.rejectReason && (
                      <span
                        className="text-[10px] text-[var(--loss)]/60 max-w-[160px] truncate"
                        title={signal.rejectReason}
                      >
                        {translateRejectReason(signal.rejectReason)}
                      </span>
                    )}
                  </div>
                )}
                <span className="text-[var(--text-muted)] font-mono">
                  {formatTime(signal.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
