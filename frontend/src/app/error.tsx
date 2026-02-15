'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error);
  }, [error]);

  const handleEmergencyStop = async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      await fetch(`${apiBase}/api/bot/emergency-stop`, { method: 'POST' });
      alert('긴급 정지 요청이 전송되었습니다.');
    } catch {
      alert('서버에 연결할 수 없습니다. 거래소에서 직접 포지션을 관리하세요.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="max-w-lg w-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-8 space-y-6">
        {/* Icon + Title */}
        <div className="flex items-start gap-3">
          <svg
            className="w-8 h-8 flex-shrink-0 text-[var(--loss)] mt-0.5"
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
            <h2 className="text-xl font-bold text-[var(--text-primary)]">오류가 발생했습니다</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              페이지를 표시하는 중 예기치 않은 오류가 발생했습니다.
            </p>
          </div>
        </div>

        {/* Error Details */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-muted)] rounded-lg p-4">
          <p className="text-sm text-[var(--text-primary)] font-mono break-all">
            {error.message || '알 수 없는 오류'}
          </p>
          {error.digest && (
            <p className="text-xs text-[var(--text-muted)] mt-2">오류 코드: {error.digest}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-muted)] rounded-lg hover:bg-[var(--bg-elevated)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            다시 시도
          </button>
          <Link
            href="/"
            className="w-full px-4 py-2.5 text-sm font-medium text-center text-[var(--text-secondary)] border border-[var(--border-muted)] rounded-lg hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors block"
          >
            대시보드로 이동
          </Link>
        </div>

        {/* Emergency Stop */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <p className="text-xs text-[var(--text-muted)] mb-3">
            봇이 실행 중이라면 아래 버튼으로 긴급 정지할 수 있습니다.
          </p>
          <button
            onClick={handleEmergencyStop}
            className="w-full px-4 py-2.5 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            긴급 정지 (Emergency Stop)
          </button>
        </div>
      </div>
    </div>
  );
}
