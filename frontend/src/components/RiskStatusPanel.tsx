'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { formatPercent, formatCurrency } from '@/lib/utils';
import type { RiskStatus } from '@/types';

interface RiskStatusPanelProps {
  riskStatus: RiskStatus;
  onResetDrawdown?: (type: 'daily' | 'full') => Promise<void>;
  resetLoading?: boolean;
}

export default function RiskStatusPanel({ riskStatus, onResetDrawdown, resetLoading }: RiskStatusPanelProps) {
  const { circuitBreaker, exposureGuard, drawdownMonitor } = riskStatus;

  const drawdownPct = parseFloat(drawdownMonitor.currentDrawdown) || 0;
  const exposurePct = parseFloat(exposureGuard.utilizationPercent) || 0;

  // Full reset 2-step confirmation state
  const [showFullResetConfirm, setShowFullResetConfirm] = useState(false);
  const [fullResetChecked, setFullResetChecked] = useState(false);

  const handleDailyReset = () => {
    if (onResetDrawdown) {
      onResetDrawdown('daily');
    }
  };

  const handleFullReset = () => {
    if (onResetDrawdown) {
      onResetDrawdown('full');
      setShowFullResetConfirm(false);
      setFullResetChecked(false);
    }
  };

  const handleCancelFullReset = () => {
    setShowFullResetConfirm(false);
    setFullResetChecked(false);
  };

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

        {/* Drawdown halt + reset buttons */}
        {drawdownMonitor.halted && (
          <div className="space-y-3">
            <Badge variant="danger" dot className="w-full justify-center">
              드로다운 한도 초과 — 거래 중단됨
            </Badge>

            {onResetDrawdown && !showFullResetConfirm && (
              <div className="flex gap-2">
                <button
                  onClick={handleDailyReset}
                  disabled={resetLoading}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                >
                  {resetLoading ? <Spinner size="sm" className="text-yellow-400" /> : null}
                  일일 한도 리셋
                </button>
                <button
                  onClick={() => setShowFullResetConfirm(true)}
                  disabled={resetLoading}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  전체 리셋
                </button>
              </div>
            )}

            {/* Full reset 2-step confirmation */}
            {showFullResetConfirm && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 space-y-3">
                <p className="text-xs text-red-300 font-medium">전체 드로다운 리셋 확인</p>
                <div className="text-xs text-zinc-400 space-y-1">
                  <p>현재 드로다운: <span className="text-red-400 font-mono">{formatPercent(drawdownMonitor.currentDrawdown)}</span></p>
                  <p>피크 자산: <span className="text-zinc-300 font-mono">${formatCurrency(drawdownMonitor.peakEquity)}</span></p>
                </div>
                <p className="text-[11px] text-red-400">
                  전체 리셋은 피크 자산을 현재 자산으로 재설정하고 모든 드로다운 기록을 초기화합니다.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fullResetChecked}
                    onChange={(e) => setFullResetChecked(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-xs text-zinc-400">위 내용을 확인하였습니다</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelFullReset}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 border border-zinc-600 rounded-lg hover:bg-zinc-700 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleFullReset}
                    disabled={!fullResetChecked || resetLoading}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                  >
                    {resetLoading ? <Spinner size="sm" /> : null}
                    전체 리셋 실행
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
