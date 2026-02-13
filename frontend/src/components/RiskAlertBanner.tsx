'use client';

import { useState, useEffect } from 'react';
import type { RiskEvent } from '@/types';

const SEVERITY_CONFIG = {
  critical: {
    bg: 'bg-red-900/90 border-red-500/50',
    iconColor: 'text-red-400',
    autoDismissMs: null as number | null,
  },
  warning: {
    bg: 'bg-amber-900/60 border-amber-500/30',
    iconColor: 'text-amber-400',
    autoDismissMs: 30000,
  },
  info: {
    bg: 'bg-blue-900/40 border-blue-500/20',
    iconColor: 'text-blue-400',
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
      className={`w-full border-b px-4 py-2 ${config.bg}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-3 max-w-7xl mx-auto">
        <svg className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-100">
            {EVENT_TYPE_LABELS[topEvent.eventType] || topEvent.eventType}
          </span>
          <span className="text-sm text-zinc-300 ml-2">{topEvent.reason}</span>
          {topEvent.symbol && (
            <span className="text-xs text-zinc-400 ml-2">[{topEvent.symbol}]</span>
          )}
        </div>
        {remainingCount > 0 && (
          <span className="text-xs text-zinc-400 flex-shrink-0">+{remainingCount}건 더</span>
        )}
        {topEvent.severity === 'critical' ? (
          <button
            onClick={() => onAcknowledge(topEvent._id)}
            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 flex-shrink-0"
          >
            확인
          </button>
        ) : (
          <button
            onClick={() => { setDismissedIds((prev) => new Set(prev).add(topEvent._id)); onDismiss(topEvent._id); }}
            className="text-zinc-400 hover:text-zinc-200 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
