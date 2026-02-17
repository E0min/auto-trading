'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency, shortenNumber, cn } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config';
import type { CoinScoringData } from '@/types';

interface CoinScoreboardProps {
  data: CoinScoringData | null;
}

export default function CoinScoreboard({ data }: CoinScoreboardProps) {
  const coins = useMemo(() => data?.coins ?? [], [data?.coins]);
  const weightProfile = data?.weightProfile ?? null;

  const isMarketCap = weightProfile?.method === 'market_cap';
  const methodLabel = isMarketCap ? '시가총액 기반 선정' : '거래량 기반 선정 (대체)';

  const chartData = useMemo(() => {
    return coins.slice(0, 15).map((c) => ({
      symbol: c.symbol.replace('USDT', ''),
      score: parseFloat(c.score) || 0,
      rank: parseInt(c.marketCapRank || '0', 10),
    }));
  }, [coins]);

  if (coins.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs">코인 스코어 데이터 없음</p>;
  }

  return (
    <div className="space-y-4">
      {/* Selection method label */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'text-[10px] font-mono px-2 py-0.5 rounded',
            isMarketCap
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400',
          )}
        >
          {methodLabel}
        </span>
        {weightProfile?.regime && (
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            레짐: {weightProfile.regime}
          </span>
        )}
      </div>

      {/* Horizontal bar chart — score (derived from market cap rank) */}
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
              contentStyle={CHART_TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
              formatter={(value?: number, name?: string) => {
                const v = value ?? 0;
                if (name === 'score') return [`${v.toFixed(1)}`, '점수'];
                return [v, name ?? ''];
              }}
            />
            <Bar dataKey="score" fill="#34d399" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-6 -mb-2">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">심볼</th>
              <th scope="col">시총순위</th>
              <th scope="col">점수</th>
              <th scope="col">가격</th>
              <th scope="col">24h</th>
              <th scope="col">거래량</th>
              <th scope="col">스프레드</th>
            </tr>
          </thead>
          <tbody>
            {coins.slice(0, 15).map((c, i) => {
              const change = parseFloat(c.change24h || '0');
              const rank = parseInt(c.marketCapRank || '0', 10);
              return (
                <tr key={c.symbol}>
                  <td className="text-[var(--text-muted)]">{i + 1}</td>
                  <td className="font-mono text-[var(--text-primary)]">
                    {c.symbol.replace('USDT', '')}
                  </td>
                  <td className="font-mono text-emerald-400">
                    {rank > 0 ? `#${rank}` : '-'}
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
