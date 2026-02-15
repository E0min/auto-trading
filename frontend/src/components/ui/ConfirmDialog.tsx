'use client';

import { useEffect, useCallback } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  const confirmBorder =
    variant === 'danger'
      ? 'border-[var(--loss)] text-[var(--loss)] hover:bg-red-500/10'
      : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onCancel}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-elevated)] p-8 shadow-2xl animate-fade-in">
        {/* Icon + Title */}
        <div className="flex items-start gap-3 mb-4">
          <svg
            className={`w-5 h-5 flex-shrink-0 mt-0.5 ${variant === 'danger' ? 'text-[var(--loss)]' : 'text-amber-400'}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-muted)] rounded-md hover:bg-[var(--bg-surface)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium border rounded-md transition-colors ${confirmBorder}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
