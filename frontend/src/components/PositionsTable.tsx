'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatCurrency, formatSymbol, getPnlColor, getPnlSign, translateSide } from '@/lib/utils';
import type { Position } from '@/types';

interface PositionsTableProps {
  positions: Position[];
  loading: boolean;
}

export default function PositionsTable({ positions, loading }: PositionsTableProps) {
  return (
    <Card title="활성 포지션" className="overflow-hidden">
      <div className="overflow-x-auto -mx-4 -mb-4">
        <table>
          <thead>
            <tr>
              <th>심볼</th>
              <th>방향</th>
              <th>수량</th>
              <th>진입가</th>
              <th>현재가</th>
              <th>미실현 PnL</th>
              <th>레버리지</th>
              <th>청산가</th>
            </tr>
          </thead>
          <tbody>
            {loading && positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-zinc-500 py-8">
                  로딩 중...
                </td>
              </tr>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-zinc-500 py-8">
                  활성 포지션 없음
                </td>
              </tr>
            ) : (
              positions.map((pos, idx) => (
                <tr key={`${pos.symbol}-${pos.posSide}-${idx}`} className="hover:bg-zinc-800/50">
                  <td className="font-mono font-medium text-zinc-200">{formatSymbol(pos.symbol)}</td>
                  <td>
                    <Badge variant={pos.posSide === 'long' ? 'success' : 'danger'}>
                      {translateSide(pos.posSide)}
                    </Badge>
                  </td>
                  <td className="font-mono">{pos.qty}</td>
                  <td className="font-mono">${formatCurrency(pos.entryPrice)}</td>
                  <td className="font-mono">${formatCurrency(pos.markPrice)}</td>
                  <td className={`font-mono font-medium ${getPnlColor(pos.unrealizedPnl)}`}>
                    {getPnlSign(pos.unrealizedPnl)}${formatCurrency(pos.unrealizedPnl)}
                  </td>
                  <td className="font-mono">{pos.leverage}x</td>
                  <td className="font-mono text-zinc-500">${formatCurrency(pos.liquidationPrice)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
