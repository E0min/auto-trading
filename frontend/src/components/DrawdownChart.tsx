'use client';

import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { computeDrawdownSeries } from '@/lib/drawdown';

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
    <div className="bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-300">드로다운 추이</h3>
          {data.length > 0 && (
            <span className="text-xs text-red-400">
              최대: {minDD.toFixed(2)}%
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {collapsed ? '펼치기' : '접기'}
        </button>
      </div>
      {!collapsed && (
        <div className="p-4" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="#52525b"
                tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[Math.min(limitLine * 1.2, minDD * 1.2), 0]}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                stroke="#52525b"
                tick={{ fontSize: 10 }}
                width={50}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                labelFormatter={(label) => formatTime(String(label))}
                formatter={((value?: number) => [`${(value ?? 0).toFixed(2)}%`, '드로다운']) as never}
              />
              <ReferenceLine
                y={warningLine}
                stroke="#f59e0b"
                strokeDasharray="5 5"
                label={{ value: '경고', fill: '#f59e0b', fontSize: 10, position: 'right' }}
              />
              <ReferenceLine
                y={limitLine}
                stroke="#ef4444"
                label={{ value: '한도', fill: '#ef4444', fontSize: 10, position: 'right' }}
              />
              <Area
                type="monotone"
                dataKey="drawdownPct"
                stroke="#ef4444"
                fill="url(#drawdownGradient)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
