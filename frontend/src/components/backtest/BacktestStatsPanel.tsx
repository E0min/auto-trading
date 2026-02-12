'use client';

import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency, getPnlColor, getPnlSign, cn } from '@/lib/utils';
import type { BacktestMetrics } from '@/types/backtest';

interface BacktestStatsPanelProps {
  metrics: BacktestMetrics | null;
  loading: boolean;
}

interface StatDefinition {
  label: string;
  getValue: (m: BacktestMetrics) => string;
  getColor?: (m: BacktestMetrics) => string;
}

const STATS: StatDefinition[] = [
  {
    label: '총 거래',
    getValue: (m) => m.totalTrades.toLocaleString(),
  },
  {
    label: '승률',
    getValue: (m) => `${parseFloat(m.winRate).toFixed(2)}%`,
    getColor: (m) => {
      const v = parseFloat(m.winRate);
      if (isNaN(v)) return 'text-zinc-100';
      return v >= 50 ? 'text-emerald-400' : 'text-red-400';
    },
  },
  {
    label: '총 수익',
    getValue: (m) => `${getPnlSign(m.totalPnl)}$${formatCurrency(m.totalPnl)}`,
    getColor: (m) => getPnlColor(m.totalPnl),
  },
  {
    label: '수익률',
    getValue: (m) => `${getPnlSign(m.totalReturn)}${parseFloat(m.totalReturn).toFixed(2)}%`,
    getColor: (m) => getPnlColor(m.totalReturn),
  },
  {
    label: '최대 낙폭',
    getValue: (m) => `${parseFloat(m.maxDrawdownPercent).toFixed(2)}%`,
    getColor: () => 'text-red-400',
  },
  {
    label: '수익 팩터',
    getValue: (m) => parseFloat(m.profitFactor).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.profitFactor);
      if (isNaN(v)) return 'text-zinc-100';
      return v >= 1 ? 'text-emerald-400' : 'text-red-400';
    },
  },
  {
    label: '샤프 비율',
    getValue: (m) => parseFloat(m.sharpeRatio).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.sharpeRatio);
      if (isNaN(v)) return 'text-zinc-100';
      return v >= 1 ? 'text-emerald-400' : v >= 0 ? 'text-zinc-100' : 'text-red-400';
    },
  },
  {
    label: '최종 자산',
    getValue: (m) => `$${formatCurrency(m.finalEquity)}`,
  },
  {
    label: '평균 수익',
    getValue: (m) => `$${formatCurrency(m.avgWin)}`,
    getColor: () => 'text-emerald-400',
  },
  {
    label: '평균 손실',
    getValue: (m) => `$${formatCurrency(m.avgLoss)}`,
    getColor: () => 'text-red-400',
  },
  {
    label: '최대 수익',
    getValue: (m) => `$${formatCurrency(m.largestWin)}`,
    getColor: () => 'text-emerald-400',
  },
  {
    label: '최대 손실',
    getValue: (m) => `$${formatCurrency(m.largestLoss)}`,
    getColor: () => 'text-red-400',
  },
  {
    label: '연속 승리',
    getValue: (m) => m.consecutiveWins.toLocaleString(),
  },
  {
    label: '연속 패배',
    getValue: (m) => m.consecutiveLosses.toLocaleString(),
  },
  {
    label: '총 수수료',
    getValue: (m) => `$${formatCurrency(m.totalFees)}`,
    getColor: () => 'text-zinc-400',
  },
];

export default function BacktestStatsPanel({ metrics, loading }: BacktestStatsPanelProps) {
  return (
    <Card title="성과 통계">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="md" />
          <span className="ml-2 text-sm text-zinc-500">통계 계산 중...</span>
        </div>
      ) : !metrics ? (
        <div className="flex items-center justify-center py-10">
          <p className="text-sm text-zinc-500">
            백테스트를 실행하면 성과 통계가 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((stat) => {
            const value = stat.getValue(metrics);
            const colorClass = stat.getColor ? stat.getColor(metrics) : 'text-zinc-100';

            return (
              <div key={stat.label} className="space-y-1">
                <p className="text-xs text-zinc-500">{stat.label}</p>
                <p className={cn('text-lg font-semibold', colorClass)}>{value}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
