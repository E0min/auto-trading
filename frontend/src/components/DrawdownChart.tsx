'use client';

import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { computeDrawdownSeries } from '@/lib/drawdown';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '6px',
  fontSize: '11px',
  padding: '8px 12px',
};

interface DrawdownChartProps {
  equityPoints: { timestamp: string; equity: string }[];
  maxDrawdownPercent?: number; // default 10
}

export default function DrawdownChart({ equityPoints, maxDrawdownPercent = 10 }: DrawdownChartProps) {
  const [collapsed, setCollapsed] = useState(false);
  const data = computeDrawdownSeries(equityPoints);

  if (data.length === 0) return null;

  const minDD = Math.min(...data.map(d => d.drawdownPct));
  const warningLine = -(maxDrawdownPercent * 0.5);
  const limitLine = -maxDrawdownPercent;

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            드로다운 추이
          </h3>
          {data.length > 0 && (
            <span className="text-[11px] text-[var(--loss)] font-mono">
              최대: {minDD.toFixed(2)}%
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {collapsed ? '펼치기' : '접기'}
        </button>
      </div>
      {!collapsed && (
        <div className="p-6" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F87171" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#F87171" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="var(--border-subtle)"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              />
              <YAxis
                domain={[Math.min(limitLine * 1.2, minDD * 1.2), 0]}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                stroke="var(--border-subtle)"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                width={50}
                axisLine={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(label) => formatTime(String(label))}
                formatter={((value?: number) => [`${(value ?? 0).toFixed(2)}%`, '드로다운']) as never}
              />
              <ReferenceLine
                y={warningLine}
                stroke="#FBBF24"
                strokeDasharray="6 4"
                strokeWidth={0.5}
                label={{ value: '경고', position: 'right', fontSize: 9, fill: '#FBBF24' }}
              />
              <ReferenceLine
                y={limitLine}
                stroke="#F87171"
                strokeDasharray="6 4"
                strokeWidth={0.5}
                label={{ value: '한도', position: 'right', fontSize: 9, fill: '#F87171' }}
              />
              <Area
                type="monotone"
                dataKey="drawdownPct"
                stroke="var(--loss)"
                fill="url(#drawdownGradient)"
                strokeWidth={1}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
