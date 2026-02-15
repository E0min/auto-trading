'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency, translateStrategyName } from '@/lib/utils';
import type { StrategyPerformanceEntry } from '@/types';

interface StrategyPerformanceProps {
  data: Record<string, StrategyPerformanceEntry> | null;
  loading: boolean;
}

interface ChartEntry {
  name: string;
  displayName: string;
  pnl: number;
  trades: number;
  winRate: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRateStr: string;
}

export default function StrategyPerformance({ data, loading }: StrategyPerformanceProps) {
  const entries: ChartEntry[] = useMemo(() => {
    if (!data) return [];
    return Object.entries(data)
      .map(([name, entry]) => ({
        name,
        displayName: translateStrategyName(name),
        pnl: parseFloat(entry.totalPnl) || 0,
        trades: entry.trades,
        winRate: parseFloat(entry.winRate) || 0,
        wins: entry.wins,
        losses: entry.losses,
        totalPnl: entry.totalPnl,
        winRateStr: entry.winRate,
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [data]);

  if (loading) {
    return (
      <Card className="col-span-full">
        <div className="h-[400px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Spinner size="md" />
            <span className="text-zinc-500 text-sm">데이터 로딩 중...</span>
          </div>
        </div>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="col-span-full">
        <div className="h-[400px] flex items-center justify-center text-zinc-500 text-sm">
          데이터가 없습니다
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Horizontal Bar Chart */}
      <Card title="전략별 PnL">
        <div style={{ height: Math.max(entries.length * 40 + 40, 200) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={entries}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <XAxis
                type="number"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
              />
              <YAxis
                type="category"
                dataKey="displayName"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                width={150}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={((value: number) => [
                  `$${formatCurrency(String(value))}`,
                  'PnL',
                ]) as never}
              />
              <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                {entries.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.pnl >= 0 ? '#34d399' : '#f87171'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Data Table */}
      <Card title="전략별 상세">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-2 px-3 font-medium">전략명</th>
                <th className="text-right py-2 px-3 font-medium">거래수</th>
                <th className="text-right py-2 px-3 font-medium">승률</th>
                <th className="text-right py-2 px-3 font-medium">총 PnL</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const pnlValue = parseFloat(entry.totalPnl);
                const pnlColor = pnlValue > 0 ? 'text-emerald-400' : pnlValue < 0 ? 'text-red-400' : 'text-zinc-400';
                const winRateColor = entry.winRate >= 50 ? 'text-emerald-400' : 'text-red-400';
                const pnlSign = pnlValue > 0 ? '+' : '';

                return (
                  <tr key={entry.name} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="py-2 px-3 text-zinc-200">{entry.displayName}</td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-300">{entry.trades}</td>
                    <td className={`py-2 px-3 text-right font-mono ${winRateColor}`}>
                      {entry.winRate.toFixed(1)}%
                    </td>
                    <td className={`py-2 px-3 text-right font-mono ${pnlColor}`}>
                      {pnlSign}${formatCurrency(entry.totalPnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
