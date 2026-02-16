'use client';

import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { formatCurrency, getPnlColor, getPnlSign, cn } from '@/lib/utils';
import type { BacktestMetrics, BacktestConfig } from '@/types/backtest';

interface BacktestStatsPanelProps {
  metrics: BacktestMetrics | null;
  loading: boolean;
  config?: BacktestConfig | null;
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
      if (isNaN(v)) return 'text-[var(--text-primary)]';
      return v >= 50 ? 'text-[var(--profit)]' : 'text-[var(--loss)]';
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
    getColor: () => 'text-[var(--loss)]',
  },
  {
    label: '칼마 비율 (연율화)',
    getValue: (m) => parseFloat(m.calmarRatio).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.calmarRatio);
      if (isNaN(v)) return 'text-[var(--text-primary)]';
      return v >= 1 ? 'text-[var(--profit)]' : v >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--loss)]';
    },
  },
  {
    label: '수익 팩터',
    getValue: (m) => parseFloat(m.profitFactor).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.profitFactor);
      if (isNaN(v)) return 'text-[var(--text-primary)]';
      return v >= 1 ? 'text-[var(--profit)]' : 'text-[var(--loss)]';
    },
  },
  {
    label: '샤프 비율',
    getValue: (m) => parseFloat(m.sharpeRatio).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.sharpeRatio);
      if (isNaN(v)) return 'text-[var(--text-primary)]';
      return v >= 1 ? 'text-[var(--profit)]' : v >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--loss)]';
    },
  },
  {
    label: '소르티노 비율',
    getValue: (m) => parseFloat(m.sortinoRatio).toFixed(2),
    getColor: (m) => {
      const v = parseFloat(m.sortinoRatio);
      if (isNaN(v)) return 'text-[var(--text-primary)]';
      return v >= 1 ? 'text-[var(--profit)]' : v >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--loss)]';
    },
  },
  {
    label: '최종 자산',
    getValue: (m) => `$${formatCurrency(m.finalEquity)}`,
  },
  {
    label: '평균 수익',
    getValue: (m) => `$${formatCurrency(m.avgWin)}`,
    getColor: () => 'text-[var(--profit)]',
  },
  {
    label: '평균 손실',
    getValue: (m) => `$${formatCurrency(m.avgLoss)}`,
    getColor: () => 'text-[var(--loss)]',
  },
  {
    label: '최대 수익',
    getValue: (m) => `$${formatCurrency(m.largestWin)}`,
    getColor: () => 'text-[var(--profit)]',
  },
  {
    label: '최대 손실',
    getValue: (m) => `$${formatCurrency(m.largestLoss)}`,
    getColor: () => 'text-[var(--loss)]',
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
    getColor: () => 'text-[var(--text-secondary)]',
  },
  {
    label: '총 펀딩비',
    getValue: (m) => m.totalFundingCost ? `$${formatCurrency(m.totalFundingCost)}` : '-',
    getColor: (m) => {
      if (!m.totalFundingCost) return 'text-[var(--text-muted)]';
      const v = parseFloat(m.totalFundingCost);
      if (isNaN(v) || v === 0) return 'text-[var(--text-secondary)]';
      return v < 0 ? 'text-[var(--loss)]' : 'text-[var(--text-secondary)]';
    },
  },
];

export default function BacktestStatsPanel({ metrics, loading, config }: BacktestStatsPanelProps) {
  const leverageNum = config?.leverage ? parseInt(config.leverage, 10) : 1;

  return (
    <Card title="성과 통계">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="md" />
          <span className="ml-2 text-sm text-[var(--text-muted)]">통계 계산 중...</span>
        </div>
      ) : !metrics ? (
        <div className="flex items-center justify-center py-10">
          <p className="text-sm text-[var(--text-muted)]">
            백테스트를 실행하면 성과 통계가 표시됩니다.
          </p>
        </div>
      ) : (
        <div>
          {leverageNum > 1 && (
            <div className="mb-4 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-amber-400">
                레버리지 {leverageNum}x 적용 (강제 청산 미시뮬레이션)
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {STATS.map((stat) => {
              const value = stat.getValue(metrics);
              const colorClass = stat.getColor ? stat.getColor(metrics) : 'text-[var(--text-primary)]';

              return (
                <div key={stat.label} className="space-y-1">
                  <p className="text-xs text-[var(--text-muted)]">{stat.label}</p>
                  <p className={cn('text-lg font-semibold', colorClass)}>{value}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
            <div className="flex items-start gap-2">
              <svg className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                본 백테스트 결과는 과거 데이터 기반 시뮬레이션이며, 실제 수익을 보장하지 않습니다.
                <strong className="text-[var(--text-secondary)]"> 레버리지 미반영</strong>,
                <strong className="text-[var(--text-secondary)]"> 펀딩비 근사치 반영 (실제와 상이할 수 있음)</strong>,
                슬리피지/수수료는 설정값 기준 근사치입니다.
                실거래 시 시장 유동성, 체결 지연, 실제 펀딩비, 레버리지 효과 등으로 결과가 크게 달라질 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
