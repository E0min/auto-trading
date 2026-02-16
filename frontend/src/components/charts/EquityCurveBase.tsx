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
import { CHART_TOOLTIP_STYLE, createCurrencyFormatter } from '@/lib/chart-config';
import type { EquityCurveConfig } from '@/lib/chart-config';

interface EquityCurveBaseProps<T> {
  data: T[];
  loading: boolean;
  config: EquityCurveConfig;
}

export default function EquityCurveBase<T extends object>({
  data,
  loading,
  config,
}: EquityCurveBaseProps<T>) {
  const chartData = useMemo(
    () =>
      data.map((point) => {
        const p = point as Record<string, unknown>;
        return {
          time: new Date(p[config.timeField] as number | string).toLocaleString(
            'ko-KR',
            config.timeFormat,
          ),
          [config.primaryKey]: parseFloat(String(p[config.primaryKey] ?? 0)) || 0,
          [config.secondaryKey]: parseFloat(String(p[config.secondaryKey] ?? 0)) || 0,
        };
      }),
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

  const tooltipFormatter = createCurrencyFormatter(
    (name) => name === config.primaryKey ? config.primaryLabel : config.secondaryLabel,
  );

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
            formatter={tooltipFormatter}
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
