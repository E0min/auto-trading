'use client';

import { useState, useMemo } from 'react';
import Card from '@/components/ui/Card';
import { formatCurrency, getPnlColor, getPnlSign } from '@/lib/utils';
import type { BacktestTrade } from '@/types/backtest';

interface BacktestTradeListProps {
  trades: BacktestTrade[];
  loading: boolean;
}

type SortKey = 'entryTime' | 'pnl' | 'holdTime' | 'qty';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

function formatHoldTime(entryTime: number, exitTime: number): string {
  const diffMs = exitTime - entryTime;
  if (diffMs <= 0) return '-';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function BacktestTradeList({ trades, loading }: BacktestTradeListProps) {
  const [sortKey, setSortKey] = useState<SortKey>('entryTime');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showAll, setShowAll] = useState(false);

  const sortedTrades = useMemo(() => {
    const sorted = [...trades].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'entryTime':
          cmp = a.entryTime - b.entryTime;
          break;
        case 'pnl':
          cmp = (parseFloat(a.pnl) || 0) - (parseFloat(b.pnl) || 0);
          break;
        case 'holdTime':
          cmp = (a.exitTime - a.entryTime) - (b.exitTime - b.entryTime);
          break;
        case 'qty':
          cmp = (parseFloat(a.qty) || 0) - (parseFloat(b.qty) || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [trades, sortKey, sortDir]);

  const visibleTrades = showAll ? sortedTrades : sortedTrades.slice(0, PAGE_SIZE);
  const hasMore = trades.length > PAGE_SIZE && !showAll;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'pnl' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  }

  return (
    <Card
      title="거래 내역"
      className="col-span-full overflow-hidden"
      headerRight={
        <span className="text-xs text-zinc-500">
          총 {trades.length}건
        </span>
      }
    >
      <div className="overflow-x-auto -mx-4 -mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="text-left px-4 py-2 font-medium">#</th>
              <th className="text-left px-4 py-2 font-medium">방향</th>
              <th className="text-right px-4 py-2 font-medium">진입가</th>
              <th className="text-right px-4 py-2 font-medium">청산가</th>
              <th
                className="text-right px-4 py-2 font-medium cursor-pointer select-none hover:text-zinc-300"
                onClick={() => handleSort('qty')}
              >
                수량{sortIndicator('qty')}
              </th>
              <th
                className="text-right px-4 py-2 font-medium cursor-pointer select-none hover:text-zinc-300"
                onClick={() => handleSort('pnl')}
              >
                손익{sortIndicator('pnl')}
              </th>
              <th className="text-right px-4 py-2 font-medium">수수료</th>
              <th
                className="text-right px-4 py-2 font-medium cursor-pointer select-none hover:text-zinc-300"
                onClick={() => handleSort('holdTime')}
              >
                보유시간{sortIndicator('holdTime')}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-zinc-500 py-8">
                  로딩 중...
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-zinc-500 py-8">
                  거래 내역이 없습니다
                </td>
              </tr>
            ) : (
              visibleTrades.map((trade, idx) => {
                const pnlNum = parseFloat(trade.pnl) || 0;
                const isLong = trade.side === 'long';
                const rowIndex = sortedTrades.indexOf(trade) + 1;
                return (
                  <tr
                    key={`${trade.entryTime}-${idx}`}
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                      idx % 2 === 0 ? '' : 'bg-zinc-800/50'
                    }`}
                  >
                    <td className="px-4 py-2 text-zinc-500 font-mono text-xs">
                      {rowIndex}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs font-medium ${
                          isLong ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isLong ? '롱' : '숏'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-200">
                      ${formatCurrency(trade.entryPrice)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-200">
                      ${formatCurrency(trade.exitPrice)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-300">
                      {formatCurrency(trade.qty, 4)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${getPnlColor(trade.pnl)}`}>
                      {getPnlSign(trade.pnl)}${formatCurrency(String(Math.abs(pnlNum)))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-500">
                      ${formatCurrency(trade.fee)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-400 text-xs whitespace-nowrap">
                      {formatHoldTime(trade.entryTime, trade.exitTime)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {hasMore && (
          <div className="flex justify-center py-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-4 py-1.5 rounded-md border border-zinc-700 hover:border-zinc-600"
            >
              더 보기 ({trades.length - PAGE_SIZE}건 남음)
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
