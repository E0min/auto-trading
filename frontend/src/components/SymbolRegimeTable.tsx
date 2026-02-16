'use client';

import { useState } from 'react';
import { translateRegime, getRegimeColor, getRegimeDotColor, cn } from '@/lib/utils';
import type { SymbolRegimeEntry } from '@/types';

interface SymbolRegimeTableProps {
  symbolRegimes: Record<string, SymbolRegimeEntry>;
}

export default function SymbolRegimeTable({ symbolRegimes }: SymbolRegimeTableProps) {
  const [collapsed, setCollapsed] = useState(true);
  const entries = Object.entries(symbolRegimes);

  if (entries.length === 0) return null;

  return (
    <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-6 py-3"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            심볼별 시장 상태
          </h3>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">
            {entries.length}개
          </span>
        </div>
        <svg
          className={cn(
            'w-4 h-4 text-[var(--text-muted)] transition-transform',
            !collapsed && 'rotate-180'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto border-t border-[var(--border-subtle)]">
          <table>
            <thead>
              <tr>
                <th scope="col">심볼</th>
                <th scope="col">레짐</th>
                <th scope="col">신뢰도</th>
                <th scope="col">상태</th>
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
      )}
    </div>
  );
}
