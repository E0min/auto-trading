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
import { formatCurrency } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config';
import type { EquityCurveConfig } from '@/lib/chart-config';

interface EquityCurveBaseProps {
  data: Record<string, unknown>[];
  loading: boolean;
  config: EquityCurveConfig;
}

export default function EquityCurveBase({ data, loading, config }: EquityCurveBaseProps) {
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        time: new Date(point[config.timeField] as number | string).toLocaleString(
          'ko-KR',
          config.timeFormat,
        ),
        [config.primaryKey]: parseFloat(String(point[config.primaryKey] ?? 0)) || 0,
        [config.secondaryKey]: parseFloat(String(point[config.secondaryKey] ?? 0)) || 0,
      })),
    [data, config],
  );

  const primaryStroke = config.primaryStroke ?? 'var(--accent)';
  const primaryStrokeWidth = config.primaryStrokeWidth ?? 1.5;

  if (loading || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-[var(--text-muted)] text-sm">
        {loading ? '로딩 중...' : '데이터 없음'}
      </div>
    );
  }

  return (
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
              name === config.primaryKey ? config.primaryLabel : config.secondaryLabel,
            ]) as never}
          />
          <Line
            type="monotone"
            dataKey={config.primaryKey}
            stroke={primaryStroke}
            strokeWidth={primaryStrokeWidth}
            dot={false}
            activeDot={{ r: 3, fill: primaryStroke }}
          />
          <Line
            type="monotone"
            dataKey={config.secondaryKey}
            stroke="var(--text-muted)"
            strokeWidth={1}
            dot={false}
            strokeDasharray="4 4"
            activeDot={{ r: 2, fill: 'var(--text-muted)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
