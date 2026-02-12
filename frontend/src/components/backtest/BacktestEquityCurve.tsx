'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import Card from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
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
        <div className="h-[300px] flex items-center justify-center text-zinc-500 text-sm">
          {loading ? '로딩 중...' : '데이터 없음'}
        </div>
      ) : (
        <div className="h-[300px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="time"
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
                formatter={((value?: number, name?: string) => [
                  `$${formatCurrency(String(value ?? 0))}`,
                  name === 'equity' ? '에쿼티' : '현금',
                ]) as never}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#34d399' }}
              />
              <Line
                type="monotone"
                dataKey="cash"
                stroke="#60a5fa"
                strokeWidth={1}
                dot={false}
                strokeDasharray="4 4"
                activeDot={{ r: 3, fill: '#60a5fa' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
