'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useBotStatus } from '@/hooks/useBotStatus';
import { useTournament } from '@/hooks/useTournament';
import type { LeaderboardEntry, StrategyDetail } from '@/types';

function formatPnl(pnl: string): string {
  const num = parseFloat(pnl);
  if (isNaN(num)) return '0.00';
  return num >= 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}

function pnlColor(pnl: string): string {
  const num = parseFloat(pnl);
  if (num > 0) return 'text-emerald-400';
  if (num < 0) return 'text-red-400';
  return 'text-zinc-400';
}

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
  } = useTournament(3000);

  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [strategyDetail, setStrategyDetail] = useState<StrategyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
    try {
      await startTournament(['all']);
    } catch { /* error handled in hook */ }
  }, [startTournament]);

  const handleStop = useCallback(async () => {
    try {
      await stopTournament();
    } catch { /* error handled in hook */ }
  }, [stopTournament]);

  const handleReset = useCallback(async () => {
    if (!confirm('토너먼트를 초기화하시겠습니까? 모든 데이터가 삭제됩니다.')) return;
    try {
      await resetTournament();
      setSelectedStrategy(null);
      setStrategyDetail(null);
    } catch { /* error handled in hook */ }
  }, [resetTournament]);

  if (!botStatusLoading && !isPaper) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-200">가상거래 모드 전용</h2>
          <p className="text-sm text-zinc-500">
            토너먼트는 가상거래(Paper) 모드에서만 사용할 수 있습니다.<br />
            대시보드에서 가상거래 모드로 전환해주세요.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-4 py-2 text-sm font-medium text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 transition-colors"
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-zinc-100">Strategy Tournament</h1>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
            TOURNAMENT MODE
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400/80 border border-amber-500/20">
            가상거래 전용
          </span>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-700 rounded-lg px-3 py-1.5"
          >
            대시보드
          </Link>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {info?.running ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
            >
              Start
            </button>
          )}
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-700/50 text-zinc-400 border border-zinc-600 hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Tournament Info Bar */}
      {info && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <InfoCard label="Status" value={info.running ? 'Running' : 'Stopped'} valueColor={info.running ? 'text-emerald-400' : 'text-zinc-500'} />
          <InfoCard label="Strategies" value={String(info.strategyCount)} />
          <InfoCard label="Initial Balance" value={`${parseFloat(info.initialBalance).toLocaleString()} USDT`} />
          <InfoCard label="Started" value={info.startedAt ? new Date(info.startedAt).toLocaleString('ko-KR') : '-'} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-300">Leaderboard</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading...</div>
        ) : leaderboard.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">
            토너먼트가 아직 시작되지 않았습니다. 봇을 시작하면 자동으로 전략별 계좌가 생성됩니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                  <th className="px-4 py-2 text-left font-medium w-12">#</th>
                  <th className="px-4 py-2 text-left font-medium">Strategy</th>
                  <th className="px-4 py-2 text-right font-medium">Equity</th>
                  <th className="px-4 py-2 text-right font-medium">PnL</th>
                  <th className="px-4 py-2 text-right font-medium">PnL %</th>
                  <th className="px-4 py-2 text-right font-medium">Unrealized</th>
                  <th className="px-4 py-2 text-right font-medium">Positions</th>
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
      </div>

      {/* Strategy Detail Panel */}
      {selectedStrategy && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-300">
              {selectedStrategy} — Detail
            </h2>
          </div>

          {detailLoading ? (
            <div className="p-8 text-center text-zinc-500 text-sm">Loading...</div>
          ) : strategyDetail ? (
            <div className="p-4 space-y-4">
              {/* Account + Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoCard label="Equity" value={`${parseFloat(strategyDetail.account.equity).toFixed(2)} USDT`} />
                <InfoCard label="Balance" value={`${parseFloat(strategyDetail.account.availableBalance).toFixed(2)} USDT`} />
                <InfoCard
                  label="Win Rate"
                  value={`${strategyDetail.stats.winRate}%`}
                  valueColor={parseFloat(strategyDetail.stats.winRate) >= 50 ? 'text-emerald-400' : 'text-red-400'}
                />
                <InfoCard label="Trades" value={`${strategyDetail.stats.wins}W / ${strategyDetail.stats.losses}L (${strategyDetail.stats.totalTrades})`} />
              </div>

              {/* Positions */}
              {strategyDetail.positions.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 mb-2">Open Positions</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-zinc-500 border-b border-zinc-800">
                          <th className="px-3 py-1.5 text-left">Symbol</th>
                          <th className="px-3 py-1.5 text-left">Side</th>
                          <th className="px-3 py-1.5 text-right">Qty</th>
                          <th className="px-3 py-1.5 text-right">Entry</th>
                          <th className="px-3 py-1.5 text-right">Mark</th>
                          <th className="px-3 py-1.5 text-right">Unrealized PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategyDetail.positions.map((pos, i) => (
                          <tr key={i} className="border-b border-zinc-800/50">
                            <td className="px-3 py-1.5 text-zinc-200">{pos.symbol}</td>
                            <td className={`px-3 py-1.5 ${pos.posSide === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {pos.posSide.toUpperCase()}
                            </td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{parseFloat(pos.qty).toFixed(4)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{parseFloat(pos.entryPrice).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{parseFloat(pos.markPrice).toFixed(2)}</td>
                            <td className={`px-3 py-1.5 text-right ${pnlColor(pos.unrealizedPnl)}`}>
                              {formatPnl(pos.unrealizedPnl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent Trades */}
              {strategyDetail.recentTrades.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 mb-2">Recent Trades</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-zinc-500 border-b border-zinc-800">
                          <th className="px-3 py-1.5 text-left">Time</th>
                          <th className="px-3 py-1.5 text-left">Symbol</th>
                          <th className="px-3 py-1.5 text-left">Side</th>
                          <th className="px-3 py-1.5 text-right">Qty</th>
                          <th className="px-3 py-1.5 text-right">Price</th>
                          <th className="px-3 py-1.5 text-right">PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategyDetail.recentTrades.map((trade) => (
                          <tr key={trade._id} className="border-b border-zinc-800/50">
                            <td className="px-3 py-1.5 text-zinc-400">
                              {new Date(trade.createdAt).toLocaleTimeString('ko-KR')}
                            </td>
                            <td className="px-3 py-1.5 text-zinc-200">{trade.symbol}</td>
                            <td className={`px-3 py-1.5 ${trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {trade.side.toUpperCase()} {trade.posSide}
                            </td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{parseFloat(trade.qty).toFixed(4)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">
                              {trade.avgFilledPrice ? parseFloat(trade.avgFilledPrice).toFixed(2) : '-'}
                            </td>
                            <td className={`px-3 py-1.5 text-right ${trade.pnl ? pnlColor(trade.pnl) : 'text-zinc-500'}`}>
                              {trade.pnl ? formatPnl(trade.pnl) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-zinc-500 text-sm">No data available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function InfoCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-sm font-semibold ${valueColor || 'text-zinc-200'}`}>{value}</p>
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
  const rankBadge = entry.rank <= 3
    ? ['text-yellow-400', 'text-zinc-300', 'text-amber-600'][entry.rank - 1]
    : 'text-zinc-500';

  return (
    <tr
      onClick={onClick}
      className={`border-b border-zinc-800/50 cursor-pointer transition-colors hover:bg-zinc-800/40 ${
        selected ? 'bg-zinc-800/60' : ''
      }`}
    >
      <td className={`px-4 py-2.5 font-bold ${rankBadge}`}>{entry.rank}</td>
      <td className="px-4 py-2.5 text-zinc-200 font-medium">{entry.strategy}</td>
      <td className="px-4 py-2.5 text-right text-zinc-200 font-mono">
        {parseFloat(entry.equity).toFixed(2)}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono ${pnlColor(entry.pnl)}`}>
        {formatPnl(entry.pnl)}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono ${pnlColor(entry.pnlPercent)}`}>
        {formatPnl(entry.pnlPercent)}%
      </td>
      <td className={`px-4 py-2.5 text-right font-mono ${pnlColor(entry.unrealizedPnl)}`}>
        {formatPnl(entry.unrealizedPnl)}
      </td>
      <td className="px-4 py-2.5 text-right text-zinc-400">
        {entry.positionCount}
      </td>
    </tr>
  );
}
