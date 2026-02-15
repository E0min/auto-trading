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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-2">
      {/* Total Equity — Hero */}
      <div className="animate-number-up">
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
  );
}
