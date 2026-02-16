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
import { formatCurrency, formatSymbol } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE, createCurrencyFormatter } from '@/lib/chart-config';
import type { SymbolPerformanceEntry } from '@/types';

interface SymbolPerformanceProps {
  data: Record<string, SymbolPerformanceEntry> | null;
  loading: boolean;
}

interface ChartEntry {
  symbol: string;
  displaySymbol: string;
  pnl: number;
  trades: number;
  winRate: number;
  wins: number;
  losses: number;
  totalPnl: string;
}

export default function SymbolPerformance({ data, loading }: SymbolPerformanceProps) {
  const entries: ChartEntry[] = useMemo(() => {
    if (!data) return [];
    return Object.entries(data)
      .map(([symbol, entry]) => ({
        symbol,
        displaySymbol: formatSymbol(symbol),
        pnl: parseFloat(entry.totalPnl) || 0,
        trades: entry.trades,
        winRate: parseFloat(entry.winRate) || 0,
        wins: entry.wins,
        losses: entry.losses,
        totalPnl: entry.totalPnl,
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
      <Card title="심볼별 PnL">
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
                dataKey="displaySymbol"
                tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={createCurrencyFormatter(() => 'PnL')}
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
      <Card title="심볼별 상세">
        <div className="overflow-x-auto -mx-6 -mb-6">
          <table>
            <thead>
              <tr>
                <th scope="col">심볼</th>
                <th scope="col" className="text-right">거래수</th>
                <th scope="col" className="text-right">승률</th>
                <th scope="col" className="text-right">총 PnL</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const pnlValue = parseFloat(entry.totalPnl);
                const pnlColor = pnlValue > 0 ? 'text-[var(--profit)]' : pnlValue < 0 ? 'text-[var(--loss)]' : 'text-[var(--text-muted)]';
                const winRateColor = entry.winRate >= 50 ? 'text-[var(--profit)]' : 'text-[var(--loss)]';
                const pnlSign = pnlValue > 0 ? '+' : '';

                return (
                  <tr key={entry.symbol}>
                    <td className="text-[var(--text-primary)] font-mono">{entry.displaySymbol}</td>
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
