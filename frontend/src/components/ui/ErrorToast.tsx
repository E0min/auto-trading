'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Error severity levels — controls toast auto-dismiss behavior (AD-47).
 *
 * - critical: Persistent until manually dismissed (order failures, API connection failures)
 * - warning: Auto-dismiss after 10 seconds (data delays, WebSocket reconnection)
 * - info: Auto-dismiss after 5 seconds (success feedback)
 */
export type ToastSeverity = 'critical' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  severity: ToastSeverity;
}

const SEVERITY_CONFIG: Record<ToastSeverity, { autoDismissMs: number | null; bgClass: string; borderClass: string; textClass: string; icon: string }> = {
  critical: {
    autoDismissMs: null, // Persistent — user must dismiss
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    textClass: 'text-red-400',
    icon: '!',
  },
  warning: {
    autoDismissMs: 10_000,
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-400',
    icon: '!',
  },
  info: {
    autoDismissMs: 5_000,
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textClass: 'text-emerald-400',
    icon: 'i',
  },
};

interface ErrorToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const config = SEVERITY_CONFIG[toast.severity];

  useEffect(() => {
    if (config.autoDismissMs === null) return;

    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, config.autoDismissMs);

    return () => clearTimeout(timer);
  }, [toast.id, config.autoDismissMs, onDismiss]);

  return (
    <div
      className={`flex items-start gap-3 ${config.bgClass} border ${config.borderClass} ${config.textClass} text-sm px-4 py-3 rounded-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2`}
      role="alert"
    >
      <span className="shrink-0 w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs font-bold mt-0.5">
        {config.icon}
      </span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-current/60 hover:text-current"
        aria-label="닫기"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function ErrorToast({ toasts, onDismiss }: ErrorToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Hook to manage toast state. Returns addToast, dismissToast, and toasts array.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((message: string, severity: ToastSeverity = 'warning') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, severity }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return { toasts, addToast, dismissToast, clearAll };
}
