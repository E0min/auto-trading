'use client';

import Card from '@/components/ui/Card';
import { formatCurrency, getPnlColor, getPnlSign } from '@/lib/utils';
import type { AccountState } from '@/types';

interface AccountOverviewProps {
  accountState: AccountState;
  positionCount: number;
}

export default function AccountOverview({ accountState, positionCount }: AccountOverviewProps) {
  const { equity, availableBalance, unrealizedPnl } = accountState;

  const cards = [
    { label: '총 자산', value: `$${formatCurrency(equity)}`, color: 'text-zinc-100' },
    { label: '가용 잔고', value: `$${formatCurrency(availableBalance)}`, color: 'text-zinc-100' },
    {
      label: '미실현 PnL',
      value: `${getPnlSign(unrealizedPnl)}$${formatCurrency(unrealizedPnl)}`,
      color: getPnlColor(unrealizedPnl),
    },
    { label: '활성 포지션', value: String(positionCount), color: 'text-zinc-100' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <p className="text-xs text-zinc-500 mb-1">{card.label}</p>
          <p className={`text-xl font-bold font-mono ${card.color}`}>{card.value}</p>
        </Card>
      ))}
    </div>
  );
}
