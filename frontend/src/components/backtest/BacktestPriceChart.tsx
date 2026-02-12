'use client';

import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import Card from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import type { BacktestTrade } from '@/types/backtest';

interface BacktestPriceChartProps {
  trades: BacktestTrade[];
  loading: boolean;
}

interface ScatterPoint {
  time: number;
  price: number;
  label: string;
  side: 'long' | 'short';
  pnl: number;
}

const ENTRY_COLOR_LONG = '#34d399';
const ENTRY_COLOR_SHORT = '#ef4444';
const EXIT_COLOR_WIN = '#34d399';
const EXIT_COLOR_LOSS = '#ef4444';

function TriangleUp(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx = 0, cy = 0, fill } = props;
  return (
    <polygon
      points={`${cx},${cy - 7} ${cx - 6},${cy + 5} ${cx + 6},${cy + 5}`}
      fill={fill}
      stroke={fill}
      strokeWidth={1}
    />
  );
}

function formatTickDate(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BacktestPriceChart({ trades, loading }: BacktestPriceChartProps) {
  const { entries, exits } = useMemo(() => {
    const entryPoints: ScatterPoint[] = [];
    const exitPoints: ScatterPoint[] = [];

    trades.forEach((trade) => {
      const pnl = parseFloat(trade.pnl) || 0;

      entryPoints.push({
        time: trade.entryTime,
        price: parseFloat(trade.entryPrice) || 0,
        label: trade.side === 'long' ? '롱 진입' : '숏 진입',
        side: trade.side,
        pnl,
      });

      exitPoints.push({
        time: trade.exitTime,
        price: parseFloat(trade.exitPrice) || 0,
        label: trade.side === 'long' ? '롱 청산' : '숏 청산',
        side: trade.side,
        pnl,
      });
    });

    entryPoints.sort((a, b) => a.time - b.time);
    exitPoints.sort((a, b) => a.time - b.time);

    return { entries: entryPoints, exits: exitPoints };
  }, [trades]);

  const domain = useMemo(() => {
    if (entries.length === 0 && exits.length === 0) return { x: [0, 1], y: [0, 1] };
    const allPoints = [...entries, ...exits];
    const times = allPoints.map((p) => p.time);
    const prices = allPoints.map((p) => p.price);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const pricePadding = (maxPrice - minPrice) * 0.05 || maxPrice * 0.01;
    const timePadding = (maxTime - minTime) * 0.02 || 60000;
    return {
      x: [minTime - timePadding, maxTime + timePadding],
      y: [minPrice - pricePadding, maxPrice + pricePadding],
    };
  }, [entries, exits]);

  return (
    <Card title="매매 포인트" className="col-span-full">
      {loading ? (
        <div className="h-[300px] flex items-center justify-center text-zinc-500 text-sm">
          로딩 중...
        </div>
      ) : trades.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-zinc-500 text-sm">
          거래 없음
        </div>
      ) : (
        <div className="h-[300px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                type="number"
                dataKey="time"
                domain={domain.x as [number, number]}
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                tickFormatter={formatTickDate}
              />
              <YAxis
                type="number"
                dataKey="price"
                domain={domain.y as [number, number]}
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                tickFormatter={(v) => `$${formatCurrency(String(v), 0)}`}
              />
              <Tooltip
                cursor={false}
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={((value?: number, name?: string) => {
                  if (name === 'price') return [`$${formatCurrency(String(value ?? 0))}`, '가격'];
                  return [value, name];
                }) as never}
                labelFormatter={(ts) => formatTickDate(Number(ts))}
              />

              {/* Entry points — triangle markers */}
              <Scatter name="진입" data={entries} shape={<TriangleUp />}>
                {entries.map((entry, i) => (
                  <Cell
                    key={`entry-${i}`}
                    fill={entry.side === 'long' ? ENTRY_COLOR_LONG : ENTRY_COLOR_SHORT}
                  />
                ))}
              </Scatter>

              {/* Exit points — circle markers */}
              <Scatter name="청산" data={exits}>
                {exits.map((exit, i) => (
                  <Cell
                    key={`exit-${i}`}
                    fill={exit.pnl >= 0 ? EXIT_COLOR_WIN : EXIT_COLOR_LOSS}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
