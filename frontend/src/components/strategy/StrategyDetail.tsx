'use client';

import { useMemo, useState } from 'react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/Tabs';
import Spinner from '@/components/ui/Spinner';
import { useStrategyDetail } from '@/hooks/useStrategyDetail';
import {
  formatCurrency,
  formatSymbol,
  formatTime,
  getPnlColor,
  getPnlSign,
  translateSide,
  cn,
} from '@/lib/utils';
import type { Signal, Position } from '@/types';

interface StrategyDetailProps {
  strategyName: string;
  sessionId: string | null;
  realtimeSignals: Signal[];
  positions: Position[];
}

export default function StrategyDetail({
  strategyName,
  sessionId,
  realtimeSignals,
  positions,
}: StrategyDetailProps) {
  const { stats, loading, error } = useStrategyDetail(strategyName, sessionId);
  const [showAll, setShowAll] = useState(false);

  // Filter positions for this strategy
  const filteredPositions = useMemo(() => {
    if (showAll) return positions;
    return positions.filter((p) => p.strategy === strategyName);
  }, [positions, strategyName, showAll]);

  // Filter realtime signals for this strategy and merge with API signals
  const mergedSignals = useMemo(() => {
    const rt = realtimeSignals.filter((s) => s.strategy === strategyName);
    if (!stats?.recentSignals) return rt.slice(0, 5);

    const apiIds = new Set(stats.recentSignals.map((s) => s._id));
    const unique = [...rt.filter((s) => !apiIds.has(s._id)), ...stats.recentSignals];
    return unique.slice(0, 5);
  }, [realtimeSignals, stats?.recentSignals, strategyName]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
        <span className="ml-2 text-xs text-[var(--text-muted)]">로딩 중...</span>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <p className="text-xs text-[var(--loss)] py-3 text-center">{error}</p>
    );
  }

  return (
    <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
      {/* Summary bar */}
      {stats && (
        <div className="flex items-center gap-4 mb-2 text-xs">
          <span className="text-[var(--text-secondary)]">
            거래 <span className="text-[var(--text-primary)] font-medium">{stats.totalTrades}</span>
          </span>
          <span className="text-[var(--text-secondary)]">
            승률 <span className="text-[var(--text-primary)] font-medium">{stats.winRate}%</span>
          </span>
          <span className={cn('font-medium', getPnlColor(stats.totalPnl))}>
            PnL {getPnlSign(stats.totalPnl)}{formatCurrency(stats.totalPnl)} USDT
          </span>
        </div>
      )}

      <Tabs defaultTab="positions">
        <TabList>
          <Tab value="positions">포지션</Tab>
          <Tab value="trades">거래내역</Tab>
          <Tab value="signals">시그널</Tab>
        </TabList>

        {/* Positions tab */}
        <TabPanel value="positions">
          {filteredPositions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]/50">
                    <th className="text-left py-1 pr-2 font-medium">심볼</th>
                    <th className="text-left py-1 pr-2 font-medium">방향</th>
                    <th className="text-right py-1 pr-2 font-medium">수량</th>
                    <th className="text-right py-1 pr-2 font-medium">진입가</th>
                    <th className="text-right py-1 pr-2 font-medium">현재가</th>
                    <th className="text-right py-1 font-medium">미실현 PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPositions.map((p) => (
                    <tr key={`${p.symbol}-${p.posSide}`} className="border-b border-[var(--border-subtle)]/30">
                      <td className="py-1.5 pr-2 text-[var(--text-primary)] font-medium">
                        {formatSymbol(p.symbol)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-medium',
                            p.posSide === 'long'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400',
                          )}
                        >
                          {translateSide(p.posSide)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--text-secondary)]">{p.qty}</td>
                      <td className="py-1.5 pr-2 text-right text-[var(--text-primary)]">
                        {formatCurrency(p.entryPrice, 4)}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--text-primary)]">
                        {formatCurrency(p.markPrice, 4)}
                      </td>
                      <td className={cn('py-1.5 text-right font-medium', getPnlColor(p.unrealizedPnl))}>
                        {getPnlSign(p.unrealizedPnl)}{formatCurrency(p.unrealizedPnl)} USDT
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-1.5 transition-colors"
              >
                {showAll
                  ? `* 전체 포지션 표시 중 (${positions.length}건) — 이 전략만 보기`
                  : `* 이 전략의 포지션만 표시 (${filteredPositions.length}/${positions.length}건) — 전체 보기`}
              </button>
            </div>
          ) : (
            <div className="py-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">이 전략의 활성 포지션이 없습니다.</p>
              {positions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-1 transition-colors"
                >
                  전체 포지션 보기 ({positions.length}건)
                </button>
              )}
            </div>
          )}
        </TabPanel>

        {/* Trades tab */}
        <TabPanel value="trades">
          {stats && stats.recentTrades.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]/50">
                    <th className="text-left py-1 pr-2 font-medium">심볼</th>
                    <th className="text-left py-1 pr-2 font-medium">방향</th>
                    <th className="text-left py-1 pr-2 font-medium">타입</th>
                    <th className="text-right py-1 pr-2 font-medium">수량</th>
                    <th className="text-right py-1 pr-2 font-medium">체결가</th>
                    <th className="text-right py-1 pr-2 font-medium">PnL</th>
                    <th className="text-center py-1 pr-2 font-medium">상태</th>
                    <th className="text-right py-1 font-medium">시간</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentTrades.map((t) => (
                    <tr key={t._id} className="border-b border-[var(--border-subtle)]/30">
                      <td className="py-1.5 pr-2 text-[var(--text-primary)] font-medium">
                        {formatSymbol(t.symbol)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-medium',
                            t.posSide === 'long'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400',
                          )}
                        >
                          {translateSide(t.posSide)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--text-muted)]">
                        {t.reduceOnly ? '청산' : '진입'}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--text-secondary)]">
                        {t.filledQty || t.qty}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-[var(--text-primary)]">
                        {t.avgFilledPrice
                          ? formatCurrency(t.avgFilledPrice, 4)
                          : t.price
                            ? formatCurrency(t.price, 4)
                            : '-'}
                      </td>
                      <td className={cn('py-1.5 pr-2 text-right font-medium', getPnlColor(t.pnl))}>
                        {t.pnl ? `${getPnlSign(t.pnl)}${formatCurrency(t.pnl)}` : '-'}
                      </td>
                      <td className="py-1.5 pr-2 text-center">
                        <TradeStatusBadge status={t.status} />
                      </td>
                      <td className="py-1.5 text-right text-[var(--text-muted)]">{formatTime(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] py-3 text-center">거래 내역이 없습니다.</p>
          )}
        </TabPanel>

        {/* Signals tab */}
        <TabPanel value="signals">
          {mergedSignals.length > 0 ? (
            <div className="space-y-1">
              {mergedSignals.map((s) => (
                <div
                  key={s._id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--bg-surface)] text-xs"
                >
                  <span className="text-[var(--text-primary)] font-medium">{formatSymbol(s.symbol)}</span>
                  <span
                    className={
                      s.action.includes('long')
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }
                  >
                    {translateSide(s.action)}
                  </span>
                  {s.suggestedPrice && (
                    <span className="text-[var(--text-secondary)]">
                      @{formatCurrency(s.suggestedPrice, 4)}
                    </span>
                  )}
                  {s.confidence != null && (
                    <span className="text-[var(--text-muted)]">
                      {Math.round(s.confidence * 100)}%
                    </span>
                  )}
                  <span
                    className={cn(
                      'ml-auto px-1.5 py-0.5 rounded text-[10px]',
                      s.riskApproved
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400',
                    )}
                  >
                    {s.riskApproved ? '승인' : '거부'}
                  </span>
                  <span className="text-[var(--text-muted)]">{formatTime(s.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] py-3 text-center">시그널이 없습니다.</p>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}

// ── Trade status badge sub-component ────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  filled: { label: '체결', color: 'bg-emerald-500/20 text-emerald-400' },
  open: { label: '대기', color: 'bg-blue-500/20 text-blue-400' },
  partially_filled: { label: '부분체결', color: 'bg-yellow-500/20 text-yellow-400' },
  cancelled: { label: '취소', color: 'bg-zinc-500/20 text-zinc-400' },
  rejected: { label: '거부', color: 'bg-red-500/20 text-red-400' },
  failed: { label: '실패', color: 'bg-red-500/20 text-red-400' },
  pending: { label: '대기', color: 'bg-zinc-500/20 text-zinc-400' },
};

function TradeStatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || { label: status, color: 'bg-zinc-500/20 text-zinc-400' };
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', s.color)}>
      {s.label}
    </span>
  );
}
