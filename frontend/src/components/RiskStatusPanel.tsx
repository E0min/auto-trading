'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { formatPercent, formatCurrency } from '@/lib/utils';
import { computeRiskScore, getRiskBarColor } from '@/lib/risk';
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
  const riskScore = computeRiskScore(riskStatus);

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
      <div className="space-y-5">
        {/* Composite Risk Score */}
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-mono font-display ${riskScore.color}`}>
              {riskScore.score}%
            </span>
            <span className={`text-xs ${riskScore.color}`}>
              {riskScore.label}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">종합 리스크</span>
        </div>

        {/* Circuit Breaker */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">서킷 브레이커</span>
            <Badge variant={circuitBreaker.tripped ? 'danger' : 'success'} dot>
              {circuitBreaker.tripped ? '발동' : '정상'}
            </Badge>
          </div>
          {circuitBreaker.tripped && circuitBreaker.reason && (
            <p className="text-xs text-[var(--loss)] mt-1">{circuitBreaker.reason}</p>
          )}
        </div>

        {/* Drawdown */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">드로다운</span>
            <span className={`text-sm font-mono ${drawdownPct > 5 ? 'text-[var(--loss)]' : drawdownPct > 3 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
              {formatPercent(drawdownMonitor.currentDrawdown)}
            </span>
          </div>
          <div className="w-full bg-[var(--bg-surface)] rounded-full h-[2px]" role="meter" aria-label="드로다운" aria-valuenow={drawdownPct} aria-valuemin={0} aria-valuemax={10}>
            <div
              className={`h-[2px] rounded-full transition-all ${getRiskBarColor(drawdownPct * 10)}`}
              style={{ width: `${Math.min(drawdownPct * 10, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-[var(--text-muted)]">최대: {formatPercent(drawdownMonitor.maxDrawdown)}</span>
            <span className="text-[10px] text-[var(--text-muted)]">피크: ${formatCurrency(drawdownMonitor.peakEquity)}</span>
          </div>
        </div>

        {/* Exposure */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">노출도</span>
            <span className={`text-sm font-mono ${exposurePct > 80 ? 'text-[var(--loss)]' : exposurePct > 60 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
              {formatPercent(exposureGuard.utilizationPercent)}
            </span>
          </div>
          <div className="w-full bg-[var(--bg-surface)] rounded-full h-[2px]" role="meter" aria-label="노출도" aria-valuenow={exposurePct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`h-[2px] rounded-full transition-all ${getRiskBarColor(exposurePct)}`}
              style={{ width: `${Math.min(exposurePct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-[var(--text-muted)]">${formatCurrency(exposureGuard.totalExposure)}</span>
            <span className="text-[10px] text-[var(--text-muted)]">한도: ${formatCurrency(exposureGuard.maxExposure)}</span>
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
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-amber-400 border border-amber-500/30 rounded-md hover:bg-amber-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                >
                  {resetLoading ? <Spinner size="sm" className="text-amber-400" /> : null}
                  일일 한도 리셋
                </button>
                <button
                  onClick={() => setShowFullResetConfirm(true)}
                  disabled={resetLoading}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--loss)] border border-[var(--loss)]/30 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  전체 리셋
                </button>
              </div>
            )}

            {/* Full reset 2-step confirmation */}
            {showFullResetConfirm && (
              <div className="border border-[var(--loss)]/20 rounded-lg p-4 space-y-3">
                <p className="text-xs text-[var(--loss)] font-medium">전체 드로다운 리셋 확인</p>
                <div className="text-xs text-[var(--text-secondary)] space-y-1">
                  <p>현재 드로다운: <span className="text-[var(--loss)] font-mono">{formatPercent(drawdownMonitor.currentDrawdown)}</span></p>
                  <p>피크 자산: <span className="text-[var(--text-primary)] font-mono">${formatCurrency(drawdownMonitor.peakEquity)}</span></p>
                </div>
                <p className="text-[11px] text-[var(--loss)]/80">
                  전체 리셋은 피크 자산을 현재 자산으로 재설정하고 모든 드로다운 기록을 초기화합니다.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fullResetChecked}
                    onChange={(e) => setFullResetChecked(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[var(--border-muted)] bg-[var(--bg-surface)] text-[var(--loss)] focus:ring-[var(--loss)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)]">위 내용을 확인하였습니다</span>
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelFullReset}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-muted)] rounded-md hover:bg-[var(--bg-surface)] transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleFullReset}
                    disabled={!fullResetChecked || resetLoading}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--loss)] border border-[var(--loss)] rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
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
