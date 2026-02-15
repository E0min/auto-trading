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

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '6px',
  fontSize: '11px',
  padding: '8px 12px',
};

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
          <Spinner size="md" />
        </div>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="col-span-full">
        <div className="h-[400px] flex items-center justify-center text-[var(--text-muted)] text-sm">
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
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
              />
              <YAxis
                type="category"
                dataKey="displayName"
                tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={150}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={((value: number) => [
                  `$${formatCurrency(String(value))}`,
                  'PnL',
                ]) as never}
              />
              <Bar dataKey="pnl" radius={[0, 3, 3, 0]} barSize={12}>
                {entries.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'}
                    fillOpacity={0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Data Table */}
      <Card title="전략별 상세">
        <div className="overflow-x-auto -mx-6 -mb-6">
          <table>
            <thead>
              <tr>
                <th>전략명</th>
                <th className="text-right">거래수</th>
                <th className="text-right">승률</th>
                <th className="text-right">총 PnL</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const pnlValue = parseFloat(entry.totalPnl);
                const pnlColor = pnlValue > 0 ? 'text-[var(--profit)]' : pnlValue < 0 ? 'text-[var(--loss)]' : 'text-[var(--text-muted)]';
                const winRateColor = entry.winRate >= 50 ? 'text-[var(--profit)]' : 'text-[var(--loss)]';
                const pnlSign = pnlValue > 0 ? '+' : '';

                return (
                  <tr key={entry.name}>
                    <td className="text-[var(--text-primary)]">{entry.displayName}</td>
                    <td className="text-right font-mono text-[var(--text-secondary)]">{entry.trades}</td>
                    <td className={`text-right font-mono ${winRateColor}`}>
                      {entry.winRate.toFixed(1)}%
                    </td>
                    <td className={`text-right font-mono font-medium ${pnlColor}`}>
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
