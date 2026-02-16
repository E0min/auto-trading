'use client';

import { formatCurrency, getPnlColor, getPnlSign } from '@/lib/utils';
import type { AccountState } from '@/types';

interface AccountOverviewProps {
  accountState: AccountState;
  positionCount: number;
}

export default function AccountOverview({ accountState, positionCount }: AccountOverviewProps) {
  const { equity, availableBalance, unrealizedPnl } = accountState;

  return (
    <div className="space-y-4 lg:space-y-0 py-2">
      {/* Total Equity — Hero (full-width on mobile) */}
      <div className="animate-number-up pb-4 lg:pb-0 border-b border-[var(--border-subtle)] lg:border-b-0 lg:hidden">
        <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
          총 자산
        </p>
        <p className="text-3xl font-mono font-display text-[var(--text-primary)]">
          ${formatCurrency(equity)}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
        {/* Total Equity — desktop only (inline in grid) */}
        <div className="animate-number-up hidden lg:block">
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            총 자산
          </p>
          <p className="text-3xl font-mono font-display text-[var(--text-primary)]">
            ${formatCurrency(equity)}
          </p>
        </div>

        {/* Available Balance */}
        <div className="animate-number-up">
          <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
            가용 잔고
          </p>
          <p className="text-lg font-mono text-[var(--text-primary)]">
            ${formatCurrency(availableBalance)}
          </p>
        </div>

        {/* Unrealized PnL — color */}
        <div className="animate-number-up">
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
