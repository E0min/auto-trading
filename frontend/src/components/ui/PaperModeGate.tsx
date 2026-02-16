'use client';

import Link from 'next/link';

interface PaperModeGateProps {
  feature: string;
  children: React.ReactNode;
  isPaper: boolean;
  loading: boolean;
}

/**
 * Guard component that blocks access to Paper-mode-only features.
 * Renders children when in paper mode; shows a lock screen otherwise.
 */
export default function PaperModeGate({
  feature,
  children,
  isPaper,
  loading,
}: PaperModeGateProps) {
  if (loading || isPaper) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative z-10">
      <div className="text-center space-y-5 max-w-sm">
        <div className="w-12 h-12 mx-auto rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center">
          <svg
            className="w-5 h-5 text-[var(--text-muted)]"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)] mb-2">
            가상거래 모드 전용
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {feature}는 가상거래(Paper) 모드에서만 사용할 수 있습니다.
            <br />
            대시보드에서 가상거래 모드로 전환해주세요.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block text-[11px] font-medium text-[var(--accent)] border border-[var(--accent)]/30 rounded-md px-4 py-2 hover:bg-[var(--accent-subtle)] transition-colors"
        >
          대시보드로 돌아가기
        </Link>
      </div>
    </div>
  );
}
