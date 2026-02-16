'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCurrency, getPnlColor, getPnlSign } from '@/lib/utils';
import type { AccountState } from '@/types';

type FlashDirection = 'up' | 'down' | null;

function useValueFlash(value: string | undefined): FlashDirection {
  const prevRef = useRef<string | undefined>(undefined);
  const [flash, setFlash] = useState<FlashDirection>(null);

  useEffect(() => {
    if (prevRef.current === undefined) {
      prevRef.current = value;
      return;
    }
    const prev = parseFloat(prevRef.current || '0');
    const curr = parseFloat(value || '0');
    prevRef.current = value;
    if (isNaN(prev) || isNaN(curr) || prev === 0) return;
    const changePct = Math.abs((curr - prev) / prev) * 100;
    if (changePct < 0.1) return;
    setFlash(curr > prev ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), 500);
    return () => clearTimeout(timer);
  }, [value]);

  return flash;
}

function flashClass(dir: FlashDirection): string {
  if (dir === 'up') return 'bg-emerald-500/15 transition-colors duration-500';
  if (dir === 'down') return 'bg-red-500/15 transition-colors duration-500';
  return 'transition-colors duration-500';
}

interface AccountOverviewProps {
  accountState: AccountState;
  positionCount: number;
}

export default function AccountOverview({ accountState, positionCount }: AccountOverviewProps) {
  const { equity, availableBalance, unrealizedPnl } = accountState;

  const equityFlash = useValueFlash(equity);
  const balanceFlash = useValueFlash(availableBalance);
  const pnlFlash = useValueFlash(unrealizedPnl);

  return (
    <div className="space-y-4 lg:space-y-0 py-2">
      {/* Total Equity — Hero (full-width on mobile) */}
      <div className={`animate-number-up pb-4 lg:pb-0 border-b border-[var(--border-subtle)] lg:border-b-0 lg:hidden rounded px-2 -mx-2 ${flashClass(equityFlash)}`}>
        <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
          총 자산
        </p>
        <p className="text-3xl font-mono font-display text-[var(--text-primary)]">
          ${formatCurrency(equity)}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
        {/* Total Equity — desktop only (inline in grid) */}
        <div className={`animate-number-up hidden lg:block rounded px-2 -mx-2 ${flashClass(equityFlash)}`}>
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            총 자산
          </p>
          <p className="text-3xl font-mono font-display text-[var(--text-primary)]">
            ${formatCurrency(equity)}
          </p>
        </div>

        {/* Available Balance */}
        <div className={`animate-number-up rounded px-2 -mx-2 ${flashClass(balanceFlash)}`}>
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            가용 잔고
          </p>
          <p className="text-lg font-mono text-[var(--text-primary)]">
            ${formatCurrency(availableBalance)}
          </p>
        </div>

        {/* Unrealized PnL — color */}
        <div className={`animate-number-up rounded px-2 -mx-2 ${flashClass(pnlFlash)}`}>
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            미실현 PnL
          </p>
          <p className={`text-lg font-mono font-medium ${getPnlColor(unrealizedPnl)}`}>
            {getPnlSign(unrealizedPnl)}${formatCurrency(unrealizedPnl)}
          </p>
        </div>

        {/* Active Positions */}
        <div className="animate-number-up">
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            활성 포지션
          </p>
          <p className="text-lg font-mono text-[var(--text-primary)]">
            {positionCount}
          </p>
        </div>
      </div>
    </div>
  );
}
