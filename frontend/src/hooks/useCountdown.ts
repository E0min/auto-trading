'use client';

import { useState, useEffect } from 'react';

/**
 * Countdown hook that ticks every second until expiresAt is reached.
 * Returns remaining milliseconds (0 when expired) and formatted string.
 */
export function useCountdown(expiresAt: string | null | undefined): {
  remainingMs: number;
  formatted: string;
  expired: boolean;
} {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    if (!expiresAt) return 0;
    return Math.max(0, new Date(expiresAt).getTime() - Date.now());
  });

  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }

    const calc = () => Math.max(0, new Date(expiresAt).getTime() - Date.now());
    setRemainingMs(calc());

    const interval = setInterval(() => {
      const ms = calc();
      setRemainingMs(ms);
      if (ms <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = remainingMs > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : '만료 중...';

  return {
    remainingMs,
    formatted,
    expired: remainingMs <= 0 && !!expiresAt,
  };
}
