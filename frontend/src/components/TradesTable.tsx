'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatCurrency, formatSymbol, formatDate, getPnlColor, getPnlSign, translateSide, cn } from '@/lib/utils';
import type { Trade } from '@/types';

interface TradesTableProps {
  trades: Trade[];
  loading: boolean;
}

const statusVariant: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  filled: 'success',
  cancelled: 'neutral',
  rejected: 'danger',
  failed: 'danger',
  pending: 'warning',
  open: 'info',
  partially_filled: 'info',
};

const statusLabel: Record<string, string> = {
  filled: '체결',
  cancelled: '취소',
  rejected: '거부',
  failed: '실패',
  pending: '대기',
  open: '활성',
  partially_filled: '부분체결',
};

export default function TradesTable({ trades, loading }: TradesTableProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card className="col-span-full overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between -mt-1 mb-2"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            최근 거래 내역
          </h3>
          {trades.length > 0 && (
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {trades.length}건
            </span>
          )}
        </div>
        <svg
          className={cn(
            'w-3.5 h-3.5 text-[var(--text-muted)] transition-transform',
            collapsed && '-rotate-90',
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Collapsible content */}
      {!collapsed && (
        <div className="overflow-x-auto -mx-6 -mb-6">
          <table>
            <thead>
              <tr>
                <th>시간</th>
                <th>심볼</th>
                <th>방향</th>
                <th>유형</th>
                <th>수량</th>
                <th>가격</th>
                <th>상태</th>
                <th>PnL</th>
                <th>전략</th>
              </tr>
            </thead>
            <tbody>
              {loading && trades.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-[var(--text-muted)] py-10">
                    로딩 중...
                  </td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-[var(--text-muted)] py-10">
                    거래 내역 없음
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade._id}>
                    <td className="text-[var(--text-muted)] whitespace-nowrap">{formatDate(trade.createdAt)}</td>
                    <td className="font-mono font-medium text-[var(--text-primary)]">{formatSymbol(trade.symbol)}</td>
                    <td>
                      <Badge variant={trade.side === 'buy' ? 'success' : 'danger'} dot>
                        {translateSide(trade.side)}
                      </Badge>
                    </td>
                    <td className="text-[var(--text-muted)]">{trade.orderType}</td>
                    <td className="font-mono text-[var(--text-secondary)]">{trade.filledQty || trade.qty}</td>
                    <td className="font-mono text-[var(--text-secondary)]">${formatCurrency(trade.avgFilledPrice || trade.price)}</td>
                    <td>
                      <Badge variant={statusVariant[trade.status] || 'neutral'} dot>
                        {statusLabel[trade.status] || trade.status}
                      </Badge>
                    </td>
                    <td className={`font-mono font-medium ${getPnlColor(trade.pnl)}`}>
                      {trade.pnl ? `${getPnlSign(trade.pnl)}$${formatCurrency(trade.pnl)}` : '\u2014'}
                    </td>
                    <td className="text-[var(--text-muted)] text-xs">{trade.strategy || '\u2014'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
