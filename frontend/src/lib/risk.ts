import type { RiskStatusExtended } from '@/types';

export interface RiskScore {
  score: number;    // 0-100
  label: string;    // '안전' | '주의' | '위험'
  color: string;    // tailwind color class
}

export function computeRiskScore(riskStatus: RiskStatusExtended | null | undefined): RiskScore {
  if (!riskStatus) return { score: 0, label: '안전', color: 'text-emerald-400' };

  const { circuitBreaker, drawdownMonitor, exposureGuard } = riskStatus;

  // If circuit breaker is tripped, risk is 100%
  if (circuitBreaker?.tripped) {
    return { score: 100, label: '위험', color: 'text-red-400' };
  }

  // Drawdown normalization (40% weight)
  const drawdownPct = Math.abs(parseFloat(drawdownMonitor?.currentDrawdown || drawdownMonitor?.drawdownPercent || '0'));
  const maxDD = parseFloat(drawdownMonitor?.params?.maxDrawdownPercent || '10');
  const ddNormalized = Math.min((drawdownPct / maxDD) * 100, 100);

  // Exposure normalization (30% weight)
  const exposurePct = parseFloat(exposureGuard?.utilizationPercent || '0');
  const expNormalized = Math.min(exposurePct, 100);

  // Circuit Breaker normalization (30% weight)
  const consecutiveLosses = circuitBreaker?.consecutiveLosses || 0;
  const consecutiveLimit = circuitBreaker?.params?.consecutiveLossLimit || circuitBreaker?.consecutiveLossLimit || 5;
  const cbNormalized = Math.min((consecutiveLosses / consecutiveLimit) * 100, 100);

  const score = Math.round(ddNormalized * 0.40 + expNormalized * 0.30 + cbNormalized * 0.30);

  let label: string;
  let color: string;
  if (score > 70) {
    label = '위험';
    color = 'text-red-400';
  } else if (score > 40) {
    label = '주의';
    color = 'text-amber-400';
  } else {
    label = '안전';
    color = 'text-emerald-400';
  }

  return { score, label, color };
}

export function getRiskBarColor(percent: number): string {
  if (percent > 70) return 'bg-red-500';
  if (percent > 40) return 'bg-amber-500';
  return 'bg-emerald-500';
}
