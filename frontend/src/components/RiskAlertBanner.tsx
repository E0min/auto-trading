'use client';

import { useState, useEffect } from 'react';
import type { RiskEvent } from '@/types';

const SEVERITY_CONFIG = {
  critical: {
    border: 'border-[var(--loss)]/30',
    textColor: 'text-[var(--loss)]',
    autoDismissMs: null as number | null,
  },
  warning: {
    border: 'border-amber-500/20',
    textColor: 'text-amber-400',
    autoDismissMs: 30000,
  },
  info: {
    border: 'border-blue-500/10',
    textColor: 'text-blue-400',
    autoDismissMs: 10000,
  },
} as const;

const EVENT_TYPE_LABELS: Record<string, string> = {
  circuit_break: '서킷 브레이커 발동',
  circuit_reset: '서킷 브레이커 리셋',
  drawdown_warning: '드로다운 경고',
  drawdown_halt: '드로다운 중단',
  exposure_adjusted: '노출 조정',
  order_rejected: '주문 거부',
  equity_insufficient: '잔고 부족',
  emergency_stop: '긴급 정지',
  process_error: '프로세스 오류',
};

interface RiskAlertBannerProps {
  events: RiskEvent[];
  onDismiss: (eventId: string) => void;
  onAcknowledge: (eventId: string) => void;
}

export default function RiskAlertBanner({ events, onDismiss, onAcknowledge }: RiskAlertBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const activeEvents = events.filter(
    (e) => !dismissedIds.has(e._id) && !e.acknowledged,
  );

  // Auto-dismiss for non-critical events
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const event of activeEvents) {
      const config = SEVERITY_CONFIG[event.severity] || SEVERITY_CONFIG.info;
      if (config.autoDismissMs) {
        timers.push(
          setTimeout(() => {
            setDismissedIds((prev) => new Set(prev).add(event._id));
          }, config.autoDismissMs),
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [activeEvents.map((e) => e._id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // CIRCUIT_RESET auto-dismisses matching CIRCUIT_BREAK
  useEffect(() => {
    const resets = events.filter((e) => e.eventType === 'circuit_reset');
    if (resets.length > 0) {
      const breakIds = events
        .filter((e) => e.eventType === 'circuit_break' && !e.acknowledged)
        .map((e) => e._id);
      if (breakIds.length > 0) {
        setDismissedIds((prev) => {
          const next = new Set(prev);
          breakIds.forEach((id) => next.add(id));
          return next;
        });
      }
    }
  }, [events]);

  if (activeEvents.length === 0) return null;

  // Show highest severity first
  const sorted = [...activeEvents].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });

  const topEvent = sorted[0];
  const remainingCount = sorted.length - 1;
  const config = SEVERITY_CONFIG[topEvent.severity] || SEVERITY_CONFIG.info;

  return (
    <div
      className={`w-full border-b ${config.border} bg-[var(--bg-primary)] px-6 py-2`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-3 max-w-[1440px] mx-auto">
        <svg className={`w-4 h-4 flex-shrink-0 ${config.textColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <div className="flex-1 min-w-0">
          <span className={`text-[11px] font-medium ${config.textColor}`}>
            {EVENT_TYPE_LABELS[topEvent.eventType] || topEvent.eventType}
          </span>
          <span className="text-[11px] text-[var(--text-secondary)] ml-2">{topEvent.reason}</span>
          {topEvent.symbol && (
            <span className="text-[10px] text-[var(--text-muted)] ml-2">[{topEvent.symbol}]</span>
          )}
        </div>
        {remainingCount > 0 && (
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">+{remainingCount}</span>
        )}
        {topEvent.severity === 'critical' ? (
          <button
            onClick={() => onAcknowledge(topEvent._id)}
            className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--loss)]/30 text-[var(--loss)] hover:bg-red-500/10 flex-shrink-0 transition-colors"
          >
            확인
          </button>
        ) : (
          <button
            onClick={() => { setDismissedIds((prev) => new Set(prev).add(topEvent._id)); onDismiss(topEvent._id); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex-shrink-0 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
