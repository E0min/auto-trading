'use client';

import { useMemo } from 'react';
import Card from '@/components/ui/Card';
import EquityCurveBase from '@/components/charts/EquityCurveBase';
import { DASHBOARD_EQUITY_CONFIG } from '@/lib/chart-config';
import type { EquityPoint } from '@/types';

interface EquityCurveChartProps {
  data: EquityPoint[];
  loading: boolean;
}

export default function EquityCurveChart({ data, loading }: EquityCurveChartProps) {
  // Map unrealizedPnl -> pnl to match config.secondaryKey
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        pnl: point.unrealizedPnl,
      })),
    [data],
  );

  return (
    <Card title="에쿼티 커브" className="col-span-full">
      <EquityCurveBase
        data={chartData}
        loading={loading}
        config={DASHBOARD_EQUITY_CONFIG}
      />
    </Card>
  );
}
