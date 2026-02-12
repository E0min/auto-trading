'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatSymbol, formatTime, translateSide } from '@/lib/utils';
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
    <Card title="실시간 시그널" className="max-h-[400px] overflow-y-auto">
      {signals.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-8">시그널 대기 중...</p>
      ) : (
        <div className="space-y-2">
          {signals.map((signal, idx) => (
            <div
              key={signal._id || idx}
              className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/50 animate-slide-in"
            >
              <div className="flex items-center gap-2">
                <Badge variant={actionVariant[signal.action] || 'neutral'}>
                  {translateSide(signal.action)}
                </Badge>
                <span className="font-mono text-sm text-zinc-200">
                  {formatSymbol(signal.symbol)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-zinc-400">
                  {signal.strategy}
                </span>
                <span className="text-zinc-500">
                  {Math.round(signal.confidence * 100)}%
                </span>
                {signal.riskApproved !== null && (
                  <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
                    {signal.riskApproved ? '승인' : '거부'}
                  </Badge>
                )}
                <span className="text-zinc-600">
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
