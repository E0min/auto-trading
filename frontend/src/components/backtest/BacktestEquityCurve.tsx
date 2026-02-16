'use client';

import Card from '@/components/ui/Card';
import EquityCurveBase from '@/components/charts/EquityCurveBase';
import { BACKTEST_EQUITY_CONFIG } from '@/lib/chart-config';
import type { BacktestEquityPoint } from '@/types/backtest';

interface BacktestEquityCurveProps {
  data: BacktestEquityPoint[];
  loading: boolean;
}

export default function BacktestEquityCurve({ data, loading }: BacktestEquityCurveProps) {
  return (
    <Card title="에쿼티 커브" className="col-span-full">
      <EquityCurveBase
        data={data}
        loading={loading}
        config={BACKTEST_EQUITY_CONFIG}
      />
    </Card>
  );
}
