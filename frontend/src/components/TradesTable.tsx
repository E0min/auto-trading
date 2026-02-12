'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatCurrency, formatSymbol, formatDate, getPnlColor, getPnlSign, translateSide } from '@/lib/utils';
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
  return (
    <Card title="최근 거래 내역" className="col-span-full overflow-hidden">
      <div className="overflow-x-auto -mx-4 -mb-4">
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
                <td colSpan={9} className="text-center text-zinc-500 py-8">
                  로딩 중...
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-zinc-500 py-8">
                  거래 내역 없음
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr key={trade._id} className="hover:bg-zinc-800/50">
                  <td className="text-zinc-400 whitespace-nowrap">{formatDate(trade.createdAt)}</td>
                  <td className="font-mono font-medium text-zinc-200">{formatSymbol(trade.symbol)}</td>
                  <td>
                    <Badge variant={trade.side === 'buy' ? 'success' : 'danger'}>
                      {translateSide(trade.side)}
                    </Badge>
                  </td>
                  <td className="text-zinc-400">{trade.orderType}</td>
                  <td className="font-mono">{trade.filledQty || trade.qty}</td>
                  <td className="font-mono">${formatCurrency(trade.avgFilledPrice || trade.price)}</td>
                  <td>
                    <Badge variant={statusVariant[trade.status] || 'neutral'}>
                      {statusLabel[trade.status] || trade.status}
                    </Badge>
                  </td>
                  <td className={`font-mono font-medium ${getPnlColor(trade.pnl)}`}>
                    {trade.pnl ? `${getPnlSign(trade.pnl)}$${formatCurrency(trade.pnl)}` : '-'}
                  </td>
                  <td className="text-zinc-500 text-xs">{trade.strategy || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
