'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useBotStatus } from '@/hooks/useBotStatus';
import { useTournament } from '@/hooks/useTournament';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PaperModeGate from '@/components/ui/PaperModeGate';
import Spinner from '@/components/ui/Spinner';
import {
  formatCurrency,
  formatTime,
  formatPnlValue,
  getPnlColor,
  getPnlSign,
  translateStrategyName,
  getStrategyCategory,
  translateStrategyCategory,
  cn,
} from '@/lib/utils';
import type { LeaderboardEntry, StrategyDetail } from '@/types';

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function TournamentPage() {
  const { status: botStatus, loading: botStatusLoading } = useBotStatus();
  const isPaper = botStatus.tradingMode === 'paper' || botStatus.paperMode;

  const {
    info,
    leaderboard,
    loading,
    error,
    startTournament,
    stopTournament,
    resetTournament,
    getStrategyDetail,
  } = useTournament('running');

  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [strategyDetail, setStrategyDetail] = useState<StrategyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const handleRowClick = useCallback(async (name: string) => {
    if (selectedStrategy === name) {
      setSelectedStrategy(null);
      setStrategyDetail(null);
      return;
    }
    setSelectedStrategy(name);
    setDetailLoading(true);
    try {
      const detail = await getStrategyDetail(name);
      setStrategyDetail(detail);
    } catch {
      setStrategyDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedStrategy, getStrategyDetail]);

  const handleStart = useCallback(async () => {
    setActionLoading(true);
    try {
      await startTournament(['all']);
    } catch { /* error handled in hook */ }
    finally { setActionLoading(false); }
  }, [startTournament]);

  const handleStop = useCallback(async () => {
    setActionLoading(true);
    try {
      await stopTournament();
    } catch { /* error handled in hook */ }
    finally { setActionLoading(false); }
  }, [stopTournament]);

  const handleReset = useCallback(async () => {
    setResetDialogOpen(false);
    setActionLoading(true);
    try {
      await resetTournament();
      setSelectedStrategy(null);
      setStrategyDetail(null);
    } catch { /* error handled in hook */ }
    finally { setActionLoading(false); }
  }, [resetTournament]);

  /* ── Main ────────────────────────────────────────────────────────────── */

  return (
  <PaperModeGate feature="토너먼트" isPaper={!!isPaper} loading={botStatusLoading}>
    <div className="min-h-screen relative z-10">
      <div className="px-6 py-8 max-w-[1440px] mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
              전략 토너먼트
            </h1>
            <div className="w-px h-5 bg-[var(--border-subtle)]" />
            <Badge variant="info" dot>TOURNAMENT</Badge>
            <Badge variant="warning" dot>가상거래</Badge>
            <Link
              href="/"
              className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded-md px-3 py-1.5 hover:border-[var(--border-muted)]"
            >
              대시보드
            </Link>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {info?.running ? (
              <Button variant="danger" size="sm" onClick={handleStop} loading={actionLoading}>
                정지
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleStart} loading={actionLoading}>
                시작
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setResetDialogOpen(true)}>
              초기화
            </Button>
          </div>
        </header>

        {/* Tournament Info Bar */}
        {info && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="상태"
              value={info.running ? '실행 중' : '정지'}
              badge={info.running ? 'success' : 'neutral'}
            />
            <StatCard label="전략 수" value={String(info.strategyCount)} />
            <StatCard label="초기 잔고" value={`${formatCurrency(info.initialBalance)} USDT`} />
            <StatCard
              label="시작 시간"
              value={info.startedAt ? new Date(info.startedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg border border-[var(--loss)]/20 bg-[var(--loss)]/5">
            <p className="text-xs text-[var(--loss)]">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Leaderboard */}
          <Card title="리더보드">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner size="md" />
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-12">
                토너먼트가 아직 시작되지 않았습니다. 시작 버튼을 눌러 전략별 계좌를 생성하세요.
              </p>
            ) : (
              <div className="overflow-x-auto -mx-6 -mb-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th scope="col" className="px-6 py-2.5 text-left text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium w-12">#</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">전략</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">카테고리</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">자산</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">실현 PnL</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">수익률</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">미실현</th>
                      <th scope="col" className="px-6 py-2.5 text-right text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium">포지션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry) => (
                      <LeaderboardRow
                        key={entry.strategy}
                        entry={entry}
                        selected={selectedStrategy === entry.strategy}
                        onClick={() => handleRowClick(entry.strategy)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Strategy Detail Panel */}
          {selectedStrategy && (
            <StrategyDetailPanel
              name={selectedStrategy}
              detail={strategyDetail}
              loading={detailLoading}
            />
          )}
        </div>
      </div>

      {/* Reset Confirm Dialog */}
      <ConfirmDialog
        open={resetDialogOpen}
        title="토너먼트 초기화"
        message="모든 전략의 계좌, 포지션, 거래 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
        confirmLabel="초기화"
        cancelLabel="취소"
        variant="danger"
        onConfirm={handleReset}
        onCancel={() => setResetDialogOpen(false)}
      />
    </div>
  </PaperModeGate>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function StatCard({ label, value, badge }: {
  label: string;
  value: string;
  badge?: 'success' | 'neutral';
}) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">{label}</p>
      {badge ? (
        <Badge variant={badge} dot>
          <span className="text-sm font-mono">{value}</span>
        </Badge>
      ) : (
        <p className="text-sm font-mono text-[var(--text-primary)]">{value}</p>
      )}
    </div>
  );
}

function LeaderboardRow({
  entry,
  selected,
  onClick,
}: {
  entry: LeaderboardEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const rankColor = entry.rank === 1
    ? 'text-[var(--accent)]'
    : entry.rank <= 3
      ? 'text-[var(--text-secondary)]'
      : 'text-[var(--text-muted)]';

  const category = getStrategyCategory(entry.strategy);

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-[var(--border-subtle)]/50 cursor-pointer transition-colors',
        selected ? 'bg-[var(--bg-surface)]' : 'hover:bg-[var(--bg-surface)]/50',
      )}
    >
      <td className={cn('px-6 py-3 font-mono font-medium', rankColor)}>
        {entry.rank}
      </td>
      <td className="px-4 py-3">
        <div>
          <span className="text-sm text-[var(--text-primary)] font-medium">
            {translateStrategyName(entry.strategy)}
          </span>
          <span className="ml-2 text-[10px] text-[var(--text-muted)] font-mono">
            {entry.strategy.replace('Strategy', '')}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
          {translateStrategyCategory(category)}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text-primary)]">
        {formatCurrency(entry.equity)}
      </td>
      <td className={cn('px-4 py-3 text-right font-mono text-sm', getPnlColor(entry.pnl))}>
        {getPnlSign(entry.pnl)}{formatPnlValue(entry.pnl)}
      </td>
      <td className={cn('px-4 py-3 text-right font-mono text-sm', getPnlColor(entry.pnlPercent))}>
        {formatPnlValue(entry.pnlPercent)}%
      </td>
      <td className={cn('px-4 py-3 text-right font-mono text-sm', getPnlColor(entry.unrealizedPnl))}>
        {formatPnlValue(entry.unrealizedPnl)}
      </td>
      <td className="px-6 py-3 text-right text-sm text-[var(--text-muted)]">
        {entry.positionCount}
      </td>
    </tr>
  );
}

function StrategyDetailPanel({
  name,
  detail,
  loading: isLoading,
}: {
  name: string;
  detail: StrategyDetail | null;
  loading: boolean;
}) {
  return (
    <Card
      title={`${translateStrategyName(name)} 상세`}
      headerRight={
        <span className="text-[10px] text-[var(--text-muted)] font-mono">
          {name}
        </span>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : !detail ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-8">데이터 없음</p>
      ) : (
        <div className="space-y-6">
          {/* Account + Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="자산" value={`${formatCurrency(detail.account.equity)} USDT`} />
            <StatCard label="잔고" value={`${formatCurrency(detail.account.availableBalance)} USDT`} />
            <StatCard
              label="승률"
              value={`${detail.stats.winRate}%`}
              badge={parseFloat(detail.stats.winRate) >= 50 ? 'success' : 'neutral'}
            />
            <StatCard label="거래" value={`${detail.stats.wins}승 / ${detail.stats.losses}패 (${detail.stats.totalTrades})`} />
          </div>

          {/* Open Positions */}
          {detail.positions.length > 0 && (
            <div>
              <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-3">보유 포지션</h4>
              <div className="overflow-x-auto -mx-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      {['심볼', '방향', '수량', '진입가', '현재가', '미실현 PnL'].map((h, i) => (
                        <th scope="col" key={h} className={cn(
                          'px-6 py-2 text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium',
                          i >= 2 ? 'text-right' : 'text-left',
                        )}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.positions.map((pos, i) => (
                      <tr key={i} className="border-b border-[var(--border-subtle)]/50">
                        <td className="px-6 py-2.5 text-sm font-mono text-[var(--text-primary)]">{pos.symbol.replace('USDT', '')}</td>
                        <td className="px-6 py-2.5">
                          <Badge variant={pos.posSide === 'long' ? 'success' : 'danger'} dot>
                            {pos.posSide === 'long' ? 'LONG' : 'SHORT'}
                          </Badge>
                        </td>
                        <td className="px-6 py-2.5 text-right text-sm font-mono text-[var(--text-secondary)]">{parseFloat(pos.qty).toFixed(4)}</td>
                        <td className="px-6 py-2.5 text-right text-sm font-mono text-[var(--text-secondary)]">{formatCurrency(pos.entryPrice)}</td>
                        <td className="px-6 py-2.5 text-right text-sm font-mono text-[var(--text-secondary)]">{formatCurrency(pos.markPrice)}</td>
                        <td className={cn('px-6 py-2.5 text-right text-sm font-mono', getPnlColor(pos.unrealizedPnl))}>
                          {getPnlSign(pos.unrealizedPnl)}{formatPnlValue(pos.unrealizedPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Trades */}
          {detail.recentTrades.length > 0 && (
            <div>
              <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-3">최근 거래</h4>
              <div className="overflow-x-auto -mx-6 -mb-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      {['시간', '심볼', '방향', '수량', '체결가', 'PnL'].map((h, i) => (
                        <th scope="col" key={h} className={cn(
                          'px-6 py-2 text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] font-medium',
                          i >= 3 ? 'text-right' : 'text-left',
                        )}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentTrades.map((trade) => (
                      <tr key={trade._id} className="border-b border-[var(--border-subtle)]/50">
                        <td className="px-6 py-2.5 text-[11px] text-[var(--text-muted)] font-mono">
                          {formatTime(trade.createdAt)}
                        </td>
                        <td className="px-6 py-2.5 text-sm font-mono text-[var(--text-primary)]">
                          {trade.symbol.replace('USDT', '')}
                        </td>
                        <td className="px-6 py-2.5">
                          <Badge variant={trade.side === 'buy' ? 'success' : 'danger'} dot>
                            {trade.side === 'buy' ? 'BUY' : 'SELL'} {trade.posSide}
                          </Badge>
                        </td>
                        <td className="px-6 py-2.5 text-right text-sm font-mono text-[var(--text-secondary)]">
                          {parseFloat(trade.qty).toFixed(4)}
                        </td>
                        <td className="px-6 py-2.5 text-right text-sm font-mono text-[var(--text-secondary)]">
                          {trade.avgFilledPrice ? formatCurrency(trade.avgFilledPrice) : '-'}
                        </td>
                        <td className={cn('px-6 py-2.5 text-right text-sm font-mono', trade.pnl ? getPnlColor(trade.pnl) : 'text-[var(--text-muted)]')}>
                          {trade.pnl ? `${getPnlSign(trade.pnl)}${formatPnlValue(trade.pnl)}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
