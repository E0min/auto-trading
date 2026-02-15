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
  ReferenceLine,
} from 'recharts';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency } from '@/lib/utils';
import type { DailyPerformanceEntry } from '@/types';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '6px',
  fontSize: '11px',
  padding: '8px 12px',
};

interface DailyPerformanceProps {
  data: DailyPerformanceEntry[] | null;
  loading: boolean;
}

interface ChartEntry {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export default function DailyPerformance({ data, loading }: DailyPerformanceProps) {
  const entries: ChartEntry[] = useMemo(() => {
    if (!data) return [];
    return data.map((entry) => ({
      date: entry.date,
      pnl: parseFloat(entry.pnl) || 0,
      trades: entry.trades,
      wins: entry.wins,
      losses: entry.losses,
    }));
  }, [data]);

  const summary = useMemo(() => {
    if (entries.length === 0) return null;
    const totalDays = entries.length;
    const profitDays = entries.filter((e) => e.pnl > 0).length;
    const lossDays = entries.filter((e) => e.pnl < 0).length;
    const totalPnl = entries.reduce((sum, e) => sum + e.pnl, 0);
    const avgDailyPnl = totalPnl / totalDays;
    return { totalDays, profitDays, lossDays, avgDailyPnl };
  }, [entries]);

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
      {/* Vertical Bar Chart */}
      <Card title="일별 PnL">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={entries} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={((value: number) => [
                  `$${formatCurrency(String(value))}`,
                  'PnL',
                ]) as never}
              />
              <ReferenceLine y={0} stroke="var(--border-muted)" />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]} barSize={16}>
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

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">총 거래일</p>
            <p className="text-lg font-mono text-[var(--text-primary)]">{summary.totalDays}</p>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">수익일</p>
            <p className="text-lg font-mono text-[var(--profit)]">{summary.profitDays}</p>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">손실일</p>
            <p className="text-lg font-mono text-[var(--loss)]">{summary.lossDays}</p>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">평균 일일 PnL</p>
            <p className={`text-lg font-mono ${summary.avgDailyPnl >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]'}`}>
              {summary.avgDailyPnl >= 0 ? '+' : ''}${formatCurrency(String(summary.avgDailyPnl))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
