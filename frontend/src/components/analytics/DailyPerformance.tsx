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
      {/* Vertical Bar Chart */}
      <Card title="일별 PnL">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={entries} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
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
              <ReferenceLine y={0} stroke="#52525b" />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
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

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
            <p className="text-xs text-zinc-500 mb-1">총 거래일</p>
            <p className="text-lg font-mono text-zinc-100">{summary.totalDays}</p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
            <p className="text-xs text-zinc-500 mb-1">수익일</p>
            <p className="text-lg font-mono text-emerald-400">{summary.profitDays}</p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
            <p className="text-xs text-zinc-500 mb-1">손실일</p>
            <p className="text-lg font-mono text-red-400">{summary.lossDays}</p>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
            <p className="text-xs text-zinc-500 mb-1">평균 일일 PnL</p>
            <p className={`text-lg font-mono ${summary.avgDailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.avgDailyPnl >= 0 ? '+' : ''}${formatCurrency(String(summary.avgDailyPnl))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
