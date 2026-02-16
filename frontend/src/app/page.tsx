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
import StrategySymbolMap from '@/components/StrategySymbolMap';
import SymbolRegimeTable from '@/components/SymbolRegimeTable';
import PerformanceTabs from '@/components/analytics/PerformanceTabs';
import MarketIntelligence from '@/components/market-intel/MarketIntelligence';
import PositionsTable from '@/components/PositionsTable';
import SignalFeed from '@/components/SignalFeed';
import TradesTable from '@/components/TradesTable';
import SystemHealth from '@/components/SystemHealth';
import Spinner from '@/components/ui/Spinner';
import ErrorToast, { useToasts } from '@/components/ui/ErrorToast';
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
    strategyGraceStates,
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
  } = useAnalytics(botStatus.sessionId, botStatus.status);

  const {
    health,
    latency,
    error: healthError,
  } = useHealthCheck();

  // R8-T0-9: Severity-based error toasts (AD-47)
  const { toasts, addToast, dismissToast } = useToasts();

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
      addToast(err instanceof Error ? err.message : '포지션 청산에 실패했습니다.', 'critical');
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
      addToast(err instanceof Error ? err.message : '드로다운 리셋에 실패했습니다.', 'critical');
    } finally {
      setResetLoading(false);
    }
  }, [refetchBotStatus]);

  // Initial loading
  if (botLoading && positionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" />
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider">로딩 중</p>
        </div>
      </div>
    );
  }

  const tradingMode = botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live');
  const isPaper = tradingMode === 'paper' || botStatus.paperMode;

  return (
    <div className="min-h-screen flex flex-col relative z-10">
      {/* Row 0: Top Banners */}
      <TradingModeBanner mode={tradingMode} isLoading={botLoading} />
      <RiskAlertBanner events={riskEvents} onDismiss={dismissRisk} onAcknowledge={acknowledgeRisk} />

      <div className="flex-1 px-4 lg:px-6 py-6 lg:py-8 max-w-[1440px] mx-auto w-full">
        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 lg:mb-8">
          <div className="flex flex-wrap items-center gap-3 lg:gap-6">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
              Bitget 자동매매
            </h1>
            <div className="hidden lg:block w-px h-5 bg-[var(--border-subtle)]" />
            <TradingModeToggle
              currentMode={botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live')}
              botRunning={botStatus.running}
              onModeChange={() => refetchBotStatus()}
            />
            <div className="flex items-center gap-2">
              {isPaper ? (
                <>
                  <Link
                    href="/backtest"
                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded-md px-3 py-1.5 hover:border-[var(--border-muted)]"
                  >
                    백테스트
                  </Link>
                  <Link
                    href="/tournament"
                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded-md px-3 py-1.5 hover:border-[var(--border-muted)]"
                  >
                    토너먼트
                  </Link>
                </>
              ) : (
                <>
                  <span
                    className="text-[11px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 cursor-not-allowed select-none"
                    role="link"
                    aria-disabled="true"
                    aria-label="백테스트 - 가상거래 모드에서만 사용 가능"
                  >
                    백테스트
                  </span>
                  <span
                    className="text-[11px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 cursor-not-allowed select-none"
                    role="link"
                    aria-disabled="true"
                    aria-label="토너먼트 - 가상거래 모드에서만 사용 가능"
                  >
                    토너먼트
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 lg:gap-6">
            <SystemHealth
              health={health}
              latency={latency}
              socketConnected={socketConnected}
              error={healthError}
            />
            <div className="hidden lg:block w-px h-5 bg-[var(--border-subtle)]" />
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
          </div>
        </header>

        <div className="space-y-6">
          {/* Hero Stats */}
          <section className="border-b border-[var(--border-subtle)] pb-6">
            <AccountOverview
              accountState={accountState}
              positionCount={positions.length}
            />
          </section>

          {/* Row 2: Performance (7/12) + Risk (5/12) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <PerformanceTabs
                sessionId={botStatus?.sessionId || null}
                equityCurve={equityCurve}
                analyticsLoading={analyticsLoading}
                maxDrawdownPercent={10}
              />
            </div>
            <div className="lg:col-span-5">
              <RiskStatusPanel
                riskStatus={botStatus.riskStatus}
                onResetDrawdown={handleResetDrawdown}
                resetLoading={resetLoading}
              />
            </div>
          </div>

          {/* Row 3: Market Intelligence (collapsible) */}
          <MarketIntelligence
            botState={botStatus.status}
            currentRegime={regime?.regime ?? null}
          />

          {/* Row 4: PositionsTable (full width) */}
          <PositionsTable
            positions={positions}
            loading={positionsLoading}
            onClosePosition={handleClosePosition}
            closingSymbol={closingSymbol}
          />

          {/* Row 4: SignalFeed + TradesTable (vertical stack) */}
          <SignalFeed signals={signals} />
          <TradesTable trades={trades} loading={tradesLoading} />

          {/* Row 5: StrategyHub (collapsible) */}
          <StrategyHub
            botRunning={botStatus.running}
            currentRegime={regime?.regime ?? botStatus.regime?.regime ?? null}
            sessionId={botStatus.sessionId}
            realtimeSignals={signals}
            positions={positions}
            strategyGraceStates={strategyGraceStates}
            onSelectionChange={handleSelectionChange}
          />

          {/* Row 5.5: Strategy-Symbol Mapping */}
          <StrategySymbolMap
            strategies={botStatus.strategies}
            symbols={botStatus.symbols}
            symbolRegimes={
              Object.keys(socketSymbolRegimes).length > 0
                ? socketSymbolRegimes
                : (botStatus.symbolRegimes ?? {})
            }
            currentRegime={regime ?? botStatus.regime ?? null}
          />

          {/* Row 6: SymbolRegimeTable (collapsible) */}
          <SymbolRegimeTable
            symbolRegimes={
              Object.keys(socketSymbolRegimes).length > 0
                ? socketSymbolRegimes
                : (botStatus.symbolRegimes ?? {})
            }
          />
        </div>
      </div>

      {/* R8-T0-9: Severity-based error toasts (AD-47) */}
      <ErrorToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
