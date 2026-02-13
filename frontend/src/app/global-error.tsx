'use client';

import { useEffect } from 'react';

interface GlobalErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    console.error('[GlobalErrorBoundary]', error);
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
    <html lang="ko" className="dark">
      <body className="antialiased bg-zinc-950 text-zinc-100">
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6">
            {/* Icon + Title */}
            <div className="flex items-start gap-3">
              <svg
                className="w-8 h-8 flex-shrink-0 text-red-400 mt-0.5"
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
                <h2 className="text-xl font-bold text-zinc-100">심각한 오류가 발생했습니다</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  애플리케이션에서 복구할 수 없는 오류가 발생했습니다.
                </p>
              </div>
            </div>

            {/* Error Details */}
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
              <p className="text-sm text-zinc-300 font-mono break-all">
                {error.message || '알 수 없는 오류'}
              </p>
              {error.digest && (
                <p className="text-xs text-zinc-600 mt-2">오류 코드: {error.digest}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={reset}
                className="w-full px-4 py-2.5 text-sm font-medium text-zinc-100 bg-zinc-800 border border-zinc-600 rounded-lg hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500"
              >
                다시 시도
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error has no Next.js router context */}
              <a
                href="/"
                className="w-full px-4 py-2.5 text-sm font-medium text-center text-zinc-400 border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              >
                대시보드로 이동
              </a>
            </div>

            {/* Emergency Stop */}
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-500 mb-3">
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
      </body>
    </html>
  );
}
