'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useBotStatus } from '@/hooks/useBotStatus';
import { useSocket } from '@/hooks/useSocket';
import { usePositions } from '@/hooks/usePositions';
import { useTrades } from '@/hooks/useTrades';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useHealthCheck } from '@/hooks/useHealthCheck';

import BotControlPanel from '@/components/BotControlPanel';
import TradingModeToggle from '@/components/TradingModeToggle';
import TradingModeBanner from '@/components/TradingModeBanner';
import RiskAlertBanner from '@/components/RiskAlertBanner';
import StrategyHub from '@/components/strategy/StrategyHub';
import AccountOverview from '@/components/AccountOverview';
import RiskStatusPanel from '@/components/RiskStatusPanel';
import SymbolRegimeTable from '@/components/SymbolRegimeTable';
import EquityCurveChart from '@/components/EquityCurveChart';
import DrawdownChart from '@/components/DrawdownChart';
import PositionsTable from '@/components/PositionsTable';
import SignalFeed from '@/components/SignalFeed';
import TradesTable from '@/components/TradesTable';
import SystemHealth from '@/components/SystemHealth';
import Spinner from '@/components/ui/Spinner';
import { useRiskEvents } from '@/hooks/useRiskEvents';
import { tradeApi, riskApi } from '@/lib/api-client';
import type { Position } from '@/types';

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
    riskEvents: socketRiskEvents,
  } = useSocket();

  const { events: riskEvents, acknowledge: acknowledgeRisk, dismiss: dismissRisk } = useRiskEvents(socketRiskEvents);

  const {
    positions,
    accountState,
    loading: positionsLoading,
    refetch: refetchPositions,
  } = usePositions(botStatus.status);

  const {
    trades,
    loading: tradesLoading,
  } = useTrades(botStatus.sessionId, botStatus.status);

  const {
    equityCurve,
    loading: analyticsLoading,
  } = useAnalytics(botStatus.sessionId);

  const {
    health,
    latency,
    error: healthError,
  } = useHealthCheck();

  // T1-8: Close position handler
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);

  const handleClosePosition = useCallback(async (pos: Position) => {
    const key = `${pos.symbol}-${pos.posSide}`;
    setClosingSymbol(key);
    try {
      const action = pos.posSide === 'long' ? 'close_long' : 'close_short';
      await tradeApi.submitOrder({
        symbol: pos.symbol,
        action,
        qty: pos.qty,
        orderType: 'market',
      });
      await refetchPositions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '포지션 청산에 실패했습니다.');
    } finally {
      setClosingSymbol(null);
    }
  }, [refetchPositions]);

  // T1-11: Drawdown reset handler
  const [resetLoading, setResetLoading] = useState(false);

  const handleResetDrawdown = useCallback(async (type: 'daily' | 'full') => {
    setResetLoading(true);
    try {
      await riskApi.resetDrawdown(type);
      await refetchBotStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : '드로다운 리셋에 실패했습니다.');
    } finally {
      setResetLoading(false);
    }
  }, [refetchBotStatus]);

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

  const tradingMode = botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live');

  return (
    <div className="min-h-screen flex flex-col">
      {/* Row 0: Top Banners */}
      <TradingModeBanner mode={tradingMode} isLoading={botLoading} />
      <RiskAlertBanner events={riskEvents} onDismiss={dismissRisk} onAcknowledge={acknowledgeRisk} />

      <div className="flex-1 p-4 md:p-6 max-w-[1600px] mx-auto w-full">
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
        {/* Row 1: BotControlPanel + AccountOverview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BotControlPanel
            status={botStatus.status}
            running={botStatus.running}
            tradingMode={tradingMode}
            openPositionCount={positions.length}
            unrealizedPnl={accountState?.unrealizedPnl ?? '0.00'}
            onStart={handleStartBot}
            onStop={stopBot}
            onPause={pauseBot}
            onResume={resumeBot}
            onEmergencyStop={emergencyStop}
          />
          <AccountOverview
            accountState={accountState}
            positionCount={positions.length}
          />
        </div>

        {/* Row 2: PositionsTable (full width, above the fold) */}
        <PositionsTable
          positions={positions}
          loading={positionsLoading}
          onClosePosition={handleClosePosition}
          closingSymbol={closingSymbol}
        />

        {/* Row 3: RiskStatusPanel + EquityCurveChart */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <RiskStatusPanel
            riskStatus={botStatus.riskStatus}
            onResetDrawdown={handleResetDrawdown}
            resetLoading={resetLoading}
          />
          <div className="lg:col-span-2 space-y-4">
            <EquityCurveChart data={equityCurve} loading={analyticsLoading} />
            {/* Drawdown Chart — synced below equity curve */}
            <DrawdownChart
              equityPoints={equityCurve || []}
              maxDrawdownPercent={10}
            />
          </div>
        </div>

        {/* Row 4: SignalFeed + TradesTable */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SignalFeed signals={signals} />
          <div className="lg:col-span-2">
            <TradesTable trades={trades} loading={tradesLoading} />
          </div>
        </div>

        {/* Row 5: StrategyHub (full width, settings/lower priority) */}
        <StrategyHub
          botRunning={botStatus.running}
          currentRegime={regime?.regime ?? botStatus.regime?.regime ?? null}
          sessionId={botStatus.sessionId}
          realtimeSignals={signals}
          positions={positions}
          onSelectionChange={handleSelectionChange}
        />

        {/* Row 6: SymbolRegimeTable (full width, reference info) */}
        <SymbolRegimeTable
          symbolRegimes={
            Object.keys(socketSymbolRegimes).length > 0
              ? socketSymbolRegimes
              : (botStatus.symbolRegimes ?? {})
          }
        />
      </div>
      </div>
    </div>
  );
}
