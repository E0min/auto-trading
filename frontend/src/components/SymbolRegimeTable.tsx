'use client';

import Card from '@/components/ui/Card';
import { translateRegime, getRegimeColor } from '@/lib/utils';
import type { SymbolRegimeEntry } from '@/types';

interface SymbolRegimeTableProps {
  symbolRegimes: Record<string, SymbolRegimeEntry>;
}

const DOT_COLORS: Record<string, string> = {
  trending_up: 'bg-emerald-400',
  trending_down: 'bg-red-400',
  ranging: 'bg-yellow-400',
  volatile: 'bg-purple-400',
  quiet: 'bg-blue-400',
  unknown: 'bg-zinc-400',
};

export default function SymbolRegimeTable({ symbolRegimes }: SymbolRegimeTableProps) {
  const entries = Object.entries(symbolRegimes);

  if (entries.length === 0) return null;

  return (
    <Card title="심볼별 시장 상태" className="col-span-full">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-2 px-3 font-medium">심볼</th>
              <th className="text-left py-2 px-3 font-medium">레짐</th>
              <th className="text-left py-2 px-3 font-medium">신뢰도</th>
              <th className="text-left py-2 px-3 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([symbol, entry]) => (
              <tr key={symbol} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="py-2 px-3 font-mono text-zinc-200">{symbol}</td>
                <td className="py-2 px-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getRegimeColor(entry.regime)}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[entry.regime] || DOT_COLORS.unknown}`} />
                    {translateRegime(entry.regime)}
                  </span>
                </td>
                <td className="py-2 px-3 text-zinc-400">
                  {Math.round(entry.confidence * 100)}%
                </td>
                <td className="py-2 px-3">
                  {entry.warmedUp ? (
                    <span className="text-emerald-400 text-xs">준비됨</span>
                  ) : (
                    <span className="text-zinc-500 text-xs">워밍업 중...</span>
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
