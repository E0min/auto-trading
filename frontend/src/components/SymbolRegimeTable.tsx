'use client';

import Card from '@/components/ui/Card';
import { translateRegime, getRegimeColor, getRegimeDotColor, cn } from '@/lib/utils';
import type { SymbolRegimeEntry } from '@/types';

interface SymbolRegimeTableProps {
  symbolRegimes: Record<string, SymbolRegimeEntry>;
}

export default function SymbolRegimeTable({ symbolRegimes }: SymbolRegimeTableProps) {
  const entries = Object.entries(symbolRegimes);

  if (entries.length === 0) return null;

  return (
    <Card title="심볼별 시장 상태" className="col-span-full">
      <div className="overflow-x-auto -mx-6 -mb-6">
        <table>
          <thead>
            <tr>
              <th>심볼</th>
              <th>레짐</th>
              <th>신뢰도</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([symbol, entry]) => (
              <tr key={symbol}>
                <td className="font-mono text-[var(--text-primary)]">{symbol}</td>
                <td>
                  <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', getRegimeColor(entry.regime))}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(entry.regime))} />
                    {translateRegime(entry.regime)}
                  </span>
                </td>
                <td className="text-[var(--text-muted)] font-mono">
                  {Math.round(entry.confidence * 100)}%
                </td>
                <td>
                  {entry.warmedUp ? (
                    <span className="text-[var(--profit)] text-[11px]">준비됨</span>
                  ) : (
                    <span className="text-[var(--text-muted)] text-[11px]">워밍업 중...</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
