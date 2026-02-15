'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCurrency, shortenNumber, cn } from '@/lib/utils';
import type { CoinScoringData } from '@/types';

interface CoinScoreboardProps {
  data: CoinScoringData | null;
}

const FACTOR_KEYS = ['volume', 'spreadInv', 'openInterest', 'fundingInv', 'momentum', 'volatility', 'volMomentum'] as const;

const FACTOR_LABELS: Record<string, string> = {
  volume: '거래량',
  spreadInv: '스프레드',
  openInterest: 'OI',
  fundingInv: '펀딩비',
  momentum: '모멘텀',
  volatility: '변동성',
  volMomentum: '거래량세',
};

const FACTOR_COLORS: Record<string, string> = {
  volume: '#eab308',
  spreadInv: '#38bdf8',
  openInterest: '#a78bfa',
  fundingInv: '#34d399',
  momentum: '#f472b6',
  volatility: '#fb923c',
  volMomentum: '#60a5fa',
};

export default function CoinScoreboard({ data }: CoinScoreboardProps) {
  if (!data || data.coins.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs">코인 스코어 데이터 없음</p>;
  }

  const { coins, weightProfile } = data;

  const chartData = useMemo(() => {
    return coins.slice(0, 15).map((c) => {
      const base: Record<string, unknown> = {
        symbol: c.symbol.replace('USDT', ''),
      };
      for (const k of FACTOR_KEYS) {
        base[k] = c._factorScores?.[k] ?? 0;
      }
      return base;
    });
  }, [coins]);

  return (
    <div className="space-y-4">
      {/* Weight profile */}
      {weightProfile && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            가중치({weightProfile.regime})
          </span>
          {FACTOR_KEYS.map((k) => {
            const w = (weightProfile.weights as unknown as Record<string, number>)[k] ?? 0;
            if (w === 0) return null;
            return (
              <span
                key={k}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${FACTOR_COLORS[k]}20`, color: FACTOR_COLORS[k] }}
              >
                {FACTOR_LABELS[k]} {w}
              </span>
            );
          })}
        </div>
      )}

      {/* Stacked bar chart */}
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="symbol"
              width={56}
              tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((value: any, name: any) => [
                Math.round(Number(value) || 0),
                FACTOR_LABELS[String(name)] ?? name,
              ]) as any}
            />
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 10, color: 'var(--text-muted)' }}
              formatter={(value: string) => FACTOR_LABELS[value] ?? value}
            />
            {FACTOR_KEYS.map((k) => (
              <Bar key={k} dataKey={k} stackId="a" fill={FACTOR_COLORS[k]} radius={0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-6 -mb-2">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>심볼</th>
              <th>점수</th>
              <th>가격</th>
              <th>24h</th>
              <th>거래량</th>
              <th>스프레드</th>
            </tr>
          </thead>
          <tbody>
            {coins.slice(0, 15).map((c, i) => {
              const change = parseFloat(c.change24h || '0');
              return (
                <tr key={c.symbol}>
                  <td className="text-[var(--text-muted)]">{i + 1}</td>
                  <td className="font-mono text-[var(--text-primary)]">
                    {c.symbol.replace('USDT', '')}
                  </td>
                  <td className="font-mono text-[var(--accent)]">
                    {parseFloat(c.score).toFixed(1)}
                  </td>
                  <td className="font-mono text-[var(--text-secondary)]">
                    {formatCurrency(c.lastPrice)}
                  </td>
                  <td className={cn('font-mono', change >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]')}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </td>
                  <td className="font-mono text-[var(--text-muted)]">
                    {shortenNumber(c.vol24h)}
                  </td>
                  <td className="font-mono text-[var(--text-muted)]">
                    {parseFloat(c.spread || '0').toFixed(4)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
