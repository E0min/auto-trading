'use client';

import { useCallback, useRef } from 'react';
import Link from 'next/link';
import { useBotStatus } from '@/hooks/useBotStatus';
import { useSocket } from '@/hooks/useSocket';
import { usePositions } from '@/hooks/usePositions';
import { useTrades } from '@/hooks/useTrades';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useHealthCheck } from '@/hooks/useHealthCheck';

import BotControlPanel from '@/components/BotControlPanel';
import TradingModeToggle from '@/components/TradingModeToggle';
import StrategyHub from '@/components/strategy/StrategyHub';
import AccountOverview from '@/components/AccountOverview';
import RiskStatusPanel from '@/components/RiskStatusPanel';
import SymbolRegimeTable from '@/components/SymbolRegimeTable';
import EquityCurveChart from '@/components/EquityCurveChart';
import PositionsTable from '@/components/PositionsTable';
import SignalFeed from '@/components/SignalFeed';
import TradesTable from '@/components/TradesTable';
import SystemHealth from '@/components/SystemHealth';
import Spinner from '@/components/ui/Spinner';

export default function Dashboard() {
  // Track pre-selected strategies for bot start
  const selectedStrategiesRef = useRef<string[]>([]);

  // Data hooks
  const {
    status: botStatus,
    loading: botLoading,
    startBot,
    stopBot,
    pauseBot,
    resumeBot,
    emergencyStop,
    refetch: refetchBotStatus,
  } = useBotStatus();

  const handleStartBot = useCallback(async () => {
    await startBot({ strategies: selectedStrategiesRef.current });
  }, [startBot]);

  const handleSelectionChange = useCallback((selected: string[]) => {
    selectedStrategiesRef.current = selected;
  }, []);

  const {
    connected: socketConnected,
    signals,
    regime,
    symbolRegimes: socketSymbolRegimes,
  } = useSocket();

  const {
    positions,
    accountState,
    loading: positionsLoading,
  } = usePositions();

  const {
    trades,
    loading: tradesLoading,
  } = useTrades(botStatus.sessionId);

  const {
    equityCurve,
    loading: analyticsLoading,
  } = useAnalytics(botStatus.sessionId);

  const {
    health,
    latency,
    error: healthError,
  } = useHealthCheck();

  // Initial loading
  if (botLoading && positionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-zinc-500 text-sm">대시보드 로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-zinc-100">
            Bitget 자동매매
          </h1>
          <TradingModeToggle
            currentMode={botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live')}
            botRunning={botStatus.running}
            onModeChange={() => refetchBotStatus()}
          />
          {(botStatus.tradingMode === 'paper' || botStatus.paperMode) ? (
            <>
              <Link
                href="/backtest"
                className="text-sm text-amber-400/80 hover:text-amber-300 transition-colors border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-1.5"
              >
                백테스트
              </Link>
              <Link
                href="/tournament"
                className="text-sm text-amber-400/80 hover:text-amber-300 transition-colors border border-amber-500/30 bg-amber-500/5 rounded-lg px-3 py-1.5"
              >
                토너먼트
              </Link>
            </>
          ) : (
            <>
              <span
                className="text-sm text-zinc-600 border border-zinc-800 rounded-lg px-3 py-1.5 cursor-not-allowed select-none"
                title="가상거래 모드에서만 사용 가능"
              >
                백테스트
              </span>
              <span
                className="text-sm text-zinc-600 border border-zinc-800 rounded-lg px-3 py-1.5 cursor-not-allowed select-none"
                title="가상거래 모드에서만 사용 가능"
              >
                토너먼트
              </span>
            </>
          )}
        </div>
        <SystemHealth
          health={health}
          latency={latency}
          socketConnected={socketConnected}
          error={healthError}
        />
      </header>

      <div className="space-y-4">
        {/* Bot Control */}
        <BotControlPanel
          status={botStatus.status}
          running={botStatus.running}
          onStart={handleStartBot}
          onStop={stopBot}
          onPause={pauseBot}
          onResume={resumeBot}
          onEmergencyStop={emergencyStop}
        />

        {/* Strategy Hub — unified strategy management + regime recommendation + per-strategy detail */}
        <StrategyHub
          botRunning={botStatus.running}
          currentRegime={regime?.regime ?? botStatus.regime?.regime ?? null}
          sessionId={botStatus.sessionId}
          realtimeSignals={signals}
          positions={positions}
          onSelectionChange={handleSelectionChange}
        />

        {/* Account Overview + Risk Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <AccountOverview
              accountState={accountState}
              positionCount={positions.length}
            />
          </div>
          <RiskStatusPanel riskStatus={botStatus.riskStatus} />
        </div>

        {/* Per-symbol Regimes — prefer socket data, fall back to REST polling */}
        <SymbolRegimeTable
          symbolRegimes={
            Object.keys(socketSymbolRegimes).length > 0
              ? socketSymbolRegimes
              : (botStatus.symbolRegimes ?? {})
          }
        />

        {/* Equity Curve */}
        <EquityCurveChart data={equityCurve} loading={analyticsLoading} />

        {/* Positions + Signals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PositionsTable positions={positions} loading={positionsLoading} />
          <SignalFeed signals={signals} />
        </div>

        {/* Trades Table */}
        <TradesTable trades={trades} loading={tradesLoading} />
      </div>
    </div>
  );
}
