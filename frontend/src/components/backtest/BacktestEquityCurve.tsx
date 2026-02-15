'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Card from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config';
import type { BacktestEquityPoint } from '@/types/backtest';

interface BacktestEquityCurveProps {
  data: BacktestEquityPoint[];
  loading: boolean;
}

export default function BacktestEquityCurve({ data, loading }: BacktestEquityCurveProps) {
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        time: new Date(point.ts).toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        equity: parseFloat(point.equity) || 0,
        cash: parseFloat(point.cash) || 0,
      })),
    [data]
  );

  return (
    <Card title="에쿼티 커브" className="col-span-full">
      {loading || data.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-[var(--text-muted)] text-sm">
          {loading ? '로딩 중...' : '데이터 없음'}
        </div>
      ) : (
        <div className="h-[300px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis
                dataKey="time"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={((value?: number, name?: string) => [
                  `$${formatCurrency(String(value ?? 0))}`,
                  name === 'equity' ? '에쿼티' : '현금',
                ]) as never}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="#4ADE80"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#4ADE80' }}
              />
              <Line
                type="monotone"
                dataKey="cash"
                stroke="var(--text-muted)"
                strokeWidth={1}
                dot={false}
                strokeDasharray="4 4"
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
