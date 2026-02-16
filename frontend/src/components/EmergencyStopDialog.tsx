'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface EmergencyStopDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  openPositionCount: number;
  unrealizedPnl: string;
}

export default function EmergencyStopDialog({
  isOpen, onClose, onConfirm, openPositionCount, unrealizedPnl,
}: EmergencyStopDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleConfirm = useCallback(() => {
    if (confirmed) {
      onConfirm();
      onClose();
      setConfirmed(false);
    }
  }, [confirmed, onConfirm, onClose]);

  const handleClose = useCallback(() => {
    setConfirmed(false);
    onClose();
  }, [onClose]);

  // R8-T0-8: Escape key handler + focus management
  useEffect(() => {
    if (!isOpen) return;

    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the dialog container
    requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      // Focus trap: Tab cycles within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])'
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
      // Restore focus on close
      previousFocusRef.current?.focus();
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-stop-title"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-zinc-900 border border-red-500/50 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl outline-none"
      >
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <h2 id="emergency-stop-title" className="text-lg font-bold text-red-400">
            긴급 정지
          </h2>
          <button onClick={handleClose} className="ml-auto text-zinc-400 hover:text-zinc-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-zinc-800/50 rounded-md p-3 mb-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">현재 열린 포지션</span>
            <span className="text-zinc-200 font-medium">{openPositionCount}건</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">총 미실현 PnL</span>
            <span className={`font-medium ${parseFloat(unrealizedPnl || '0') >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${unrealizedPnl || '0.00'}
            </span>
          </div>
        </div>

        <div className="text-sm text-zinc-300 mb-4 space-y-2">
          <p>모든 미체결 주문이 취소되고 봇이 즉시 정지됩니다.</p>
          <p className="text-red-400 font-medium">
            열린 포지션은 자동 청산되지 않으며, 수동으로 관리해야 합니다.
          </p>
          <p className="text-zinc-400">
            리스크 관리(서킷 브레이커, 드로다운 모니터)가 중단됩니다.
          </p>
        </div>

        <label className="flex items-start gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 rounded border-zinc-600 bg-zinc-800 text-red-500 focus:ring-red-500"
          />
          <span className="text-sm text-zinc-300">위 내용을 확인하였습니다</span>
        </label>

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm rounded-md bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={!confirmed}
            className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            긴급 정지 실행
          </button>
        </div>
      </div>
    </div>
  );
}
