'use client';

import Card from '@/components/ui/Card';
import { translateRegime, getRegimeColor } from '@/lib/utils';
import type { MarketRegimeData } from '@/types';

interface MarketRegimeIndicatorProps {
  regime: MarketRegimeData | null;
}

export default function MarketRegimeIndicator({ regime }: MarketRegimeIndicatorProps) {
  const currentRegime = regime?.regime || 'unknown';
  const confidence = regime?.confidence ?? 0;

  return (
    <Card title="시장 상태" className="col-span-full">
      <div className="flex items-center gap-4">
        <span
          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${getRegimeColor(currentRegime)}`}
        >
          <span className={`w-2 h-2 rounded-full animate-pulse-dot ${
            currentRegime === 'trending_up' ? 'bg-emerald-400' :
            currentRegime === 'trending_down' ? 'bg-red-400' :
            currentRegime === 'ranging' ? 'bg-yellow-400' :
            currentRegime === 'volatile' ? 'bg-purple-400' :
            currentRegime === 'quiet' ? 'bg-blue-400' :
            'bg-zinc-400'
          }`} />
          {translateRegime(currentRegime)}
        </span>
        <span className="text-xs text-zinc-500">
          신뢰도: {Math.round(confidence * 100)}%
        </span>
        {regime?.timestamp && (
          <span className="text-xs text-zinc-600">
            {new Date(regime.timestamp).toLocaleTimeString('ko-KR')}
          </span>
        )}
      </div>
    </Card>
  );
}
