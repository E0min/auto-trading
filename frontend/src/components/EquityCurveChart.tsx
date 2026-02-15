'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config';
import type { EquityPoint } from '@/types';

interface EquityCurveChartProps {
  data: EquityPoint[];
  loading: boolean;
}

export default function EquityCurveChart({ data, loading }: EquityCurveChartProps) {
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        time: new Date(point.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        equity: parseFloat(point.equity) || 0,
        pnl: parseFloat(point.unrealizedPnl) || 0,
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
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={((value?: number, name?: string) => [
                  `$${formatCurrency(String(value ?? 0))}`,
                  name === 'equity' ? '자산' : '미실현 PnL',
                ]) as never}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="var(--accent)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: 'var(--accent)' }}
              />
              <Line
                type="monotone"
                dataKey="pnl"
                stroke="var(--text-muted)"
                strokeWidth={1}
                dot={false}
                strokeDasharray="4 4"
                activeDot={{ r: 2, fill: 'var(--text-muted)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
