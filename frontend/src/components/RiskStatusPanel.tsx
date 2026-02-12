'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatPercent, formatCurrency } from '@/lib/utils';
import type { RiskStatus } from '@/types';

interface RiskStatusPanelProps {
  riskStatus: RiskStatus;
}

export default function RiskStatusPanel({ riskStatus }: RiskStatusPanelProps) {
  const { circuitBreaker, exposureGuard, drawdownMonitor } = riskStatus;

  const drawdownPct = parseFloat(drawdownMonitor.currentDrawdown) || 0;
  const exposurePct = parseFloat(exposureGuard.utilizationPercent) || 0;

  return (
    <Card title="리스크 상태">
      <div className="space-y-4">
        {/* Circuit Breaker */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">서킷 브레이커</span>
            <Badge variant={circuitBreaker.tripped ? 'danger' : 'success'} dot>
              {circuitBreaker.tripped ? '발동' : '정상'}
            </Badge>
          </div>
          {circuitBreaker.tripped && circuitBreaker.reason && (
            <p className="text-xs text-red-400 mt-1">{circuitBreaker.reason}</p>
          )}
        </div>

        {/* Drawdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">드로다운</span>
            <span className={`text-sm font-mono ${drawdownPct > 5 ? 'text-red-400' : drawdownPct > 3 ? 'text-yellow-400' : 'text-zinc-300'}`}>
              {formatPercent(drawdownMonitor.currentDrawdown)}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${drawdownPct > 5 ? 'bg-red-500' : drawdownPct > 3 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(drawdownPct * 10, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-zinc-600">최대: {formatPercent(drawdownMonitor.maxDrawdown)}</span>
            <span className="text-[10px] text-zinc-600">피크: ${formatCurrency(drawdownMonitor.peakEquity)}</span>
          </div>
        </div>

        {/* Exposure */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">노출도</span>
            <span className={`text-sm font-mono ${exposurePct > 80 ? 'text-red-400' : exposurePct > 60 ? 'text-yellow-400' : 'text-zinc-300'}`}>
              {formatPercent(exposureGuard.utilizationPercent)}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${exposurePct > 80 ? 'bg-red-500' : exposurePct > 60 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(exposurePct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-zinc-600">${formatCurrency(exposureGuard.totalExposure)}</span>
            <span className="text-[10px] text-zinc-600">한도: ${formatCurrency(exposureGuard.maxExposure)}</span>
          </div>
        </div>

        {/* Drawdown halt */}
        {drawdownMonitor.halted && (
          <Badge variant="danger" dot className="w-full justify-center">
            드로다운 한도 초과 — 거래 중단됨
          </Badge>
        )}
      </div>
    </Card>
  );
}
