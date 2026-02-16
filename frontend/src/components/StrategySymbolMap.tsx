'use client';

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import {
  translateStrategyName,
  translateRegime,
  getRegimeColor,
  getRegimeDotColor,
  getStrategyCategory,
  formatSymbol,
  cn,
} from '@/lib/utils';
import type { StrategyInfo, SymbolRegimeEntry, MarketRegimeData } from '@/types';

interface StrategySymbolMapProps {
  strategies: StrategyInfo[];
  symbols: string[];
  symbolRegimes: Record<string, SymbolRegimeEntry>;
  currentRegime: MarketRegimeData | null | undefined;
}

const REGIME_ICON: Record<string, string> = {
  trending_up: '\u2191',
  trending_down: '\u2193',
  ranging: '\u2194',
  volatile: '\u26A1',
  quiet: '\u23F8',
};

function regimeIcon(regime: string): string {
  return REGIME_ICON[regime] ?? '?';
}

const CATEGORY_LABEL: Record<string, string> = {
  'price-action': 'Price-Action',
  'indicator-light': 'Indicator-Light',
  'indicator-heavy': 'Indicator-Heavy',
};

export default function StrategySymbolMap({
  strategies,
  symbols,
  symbolRegimes,
  currentRegime,
}: StrategySymbolMapProps) {
  // Bot not running — show placeholder
  if (strategies.length === 0) {
    return (
      <Card title="전략-심볼 매핑">
        <p className="text-[var(--text-muted)] text-xs text-center py-6">
          봇이 실행되면 전략-심볼 매핑이 표시됩니다
        </p>
      </Card>
    );
  }

  const activeStrategies = strategies.filter((s) => s.active);
  const inactiveStrategies = strategies.filter((s) => !s.active);

  // Symbols assigned to at least one strategy
  const assignedSymbols = new Set<string>();
  for (const s of strategies) {
    if (s.symbol) assignedSymbols.add(s.symbol);
    if (s.symbols) s.symbols.forEach((sym) => assignedSymbols.add(sym));
  }

  // Watched-only symbols: in bot symbols list but not assigned to any strategy
  const watchedSymbols = symbols.filter((sym) => !assignedSymbols.has(sym));

  // Derive the active symbol label (first assigned symbol for display)
  const activeSymbol = activeStrategies.length > 0
    ? activeStrategies[0].symbol || activeStrategies[0].symbols?.[0] || '-'
    : '-';

  return (
    <Card
      title="전략-심볼 매핑"
      headerRight={
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-[var(--text-muted)]">
            매매 중 {activeStrategies.length}/{strategies.length}
          </span>
          {activeSymbol !== '-' && (
            <>
              <span className="text-[var(--text-muted)]">&middot;</span>
              <span className="text-[var(--text-secondary)] font-mono">
                활성 심볼: {formatSymbol(activeSymbol)}
              </span>
            </>
          )}
          {currentRegime && (
            <>
              <span className="text-[var(--text-muted)]">&middot;</span>
              <span className={cn('inline-flex items-center gap-1', getRegimeColor(currentRegime.regime))}>
                <span className={cn('w-1.5 h-1.5 rounded-full', getRegimeDotColor(currentRegime.regime))} />
                {translateRegime(currentRegime.regime)}
              </span>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {/* Section 1: Active Strategies */}
        {activeStrategies.length > 0 && (
          <div>
            <h4 className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              매매 중인 전략
            </h4>
            <div className="overflow-x-auto -mx-6">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">전략명</th>
                    <th scope="col" className="text-left">카테고리</th>
                    <th scope="col" className="text-right">심볼</th>
                    <th scope="col" className="text-left">대상 레짐</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStrategies.map((s) => (
                    <tr key={s.name}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--profit)] flex-shrink-0" />
                          <span className="text-[var(--text-primary)] text-xs">
                            {translateStrategyName(s.name)}
                          </span>
                        </div>
                      </td>
                      <td className="text-[var(--text-muted)] text-[11px]">
                        {CATEGORY_LABEL[getStrategyCategory(s.name)] ?? 'Indicator-Light'}
                      </td>
                      <td className="text-right font-mono text-[var(--text-secondary)] text-xs">
                        {formatSymbol(s.symbol || s.symbols?.[0] || '-')}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(s.targetRegimes ?? []).map((r) => (
                            <span
                              key={r}
                              className={cn(
                                'inline-flex items-center gap-0.5 text-[11px]',
                                getRegimeColor(r),
                              )}
                              title={translateRegime(r)}
                            >
                              {regimeIcon(r)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section 2: Inactive (waiting) Strategies */}
        {inactiveStrategies.length > 0 && (
          <div>
            <h4 className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              대기 중 (현재 레짐 미매칭)
            </h4>
            <div className="overflow-x-auto -mx-6">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">전략명</th>
                    <th scope="col" className="text-left">카테고리</th>
                    <th scope="col" className="text-right">심볼</th>
                    <th scope="col" className="text-left">대상 레짐</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveStrategies.map((s) => (
                    <tr key={s.name}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] flex-shrink-0" />
                          <span className="text-[var(--text-muted)] text-xs">
                            {translateStrategyName(s.name)}
                          </span>
                        </div>
                      </td>
                      <td className="text-[var(--text-muted)] text-[11px]">
                        {CATEGORY_LABEL[getStrategyCategory(s.name)] ?? 'Indicator-Light'}
                      </td>
                      <td className="text-right font-mono text-[var(--text-muted)] text-xs">-</td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(s.targetRegimes ?? []).map((r) => (
                            <span
                              key={r}
                              className={cn(
                                'inline-flex items-center gap-0.5 text-[11px] opacity-50',
                                getRegimeColor(r),
                              )}
                              title={translateRegime(r)}
                            >
                              {regimeIcon(r)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section 3: Watched symbols (regime tracking only, no strategy assigned) */}
        {watchedSymbols.length > 0 && (
          <div>
            <h4 className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              감시 심볼 (레짐 추적만, 매매 미할당)
            </h4>
            <div className="flex flex-wrap gap-2">
              {watchedSymbols.map((sym) => {
                const entry = symbolRegimes[sym];
                return (
                  <div
                    key={sym}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--bg-base)] border border-[var(--border-subtle)] text-xs"
                  >
                    <span className="font-mono text-[var(--text-secondary)]">
                      {formatSymbol(sym)}
                    </span>
                    {entry ? (
                      <Badge variant={
                        entry.regime === 'trending_up' ? 'success' :
                        entry.regime === 'trending_down' ? 'danger' :
                        entry.regime === 'volatile' ? 'warning' :
                        entry.regime === 'quiet' ? 'info' :
                        'neutral'
                      } dot>
                        {translateRegime(entry.regime)} {Math.round(entry.confidence * 100)}%
                      </Badge>
                    ) : (
                      <span className="text-[var(--text-muted)] text-[11px]">대기</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
