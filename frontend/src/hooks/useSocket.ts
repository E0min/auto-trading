'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { acquireSocket, releaseSocket, SOCKET_EVENTS } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import type {
  Signal, Position, MarketRegimeData, SymbolRegimeEntry, RiskEvent,
  GraceStartedEvent, GraceCancelledEvent, StrategyDeactivatedEvent, GraceState,
} from '@/types';

export interface StrategyGraceInfo {
  graceState: GraceState;
  graceExpiresAt: string | null;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const tickerRef = useRef<Record<string, { lastPrice: string; volume24h: string }>>({});

  // R8-T1-9: Split state to prevent unnecessary re-renders
  const [connected, setConnected] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [regime, setRegime] = useState<MarketRegimeData | null>(null);
  const [symbolRegimes, setSymbolRegimes] = useState<Record<string, SymbolRegimeEntry>>({});
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [strategyGraceStates, setStrategyGraceStates] = useState<Record<string, StrategyGraceInfo>>({});

  useEffect(() => {
    const socket = acquireSocket();
    socketRef.current = socket;

    // Named handlers so they can be removed with off()
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSignalGenerated = (data: any) => {
      const signal: Signal = data.signal || data;
      setSignals(prev => [signal, ...prev].slice(0, 50));
    };

    const handleRegimeChange = (data: MarketRegimeData) => setRegime(data);

    const handleSymbolRegimeUpdate = (data: { symbol: string; current: string; confidence: number }) => {
      setSymbolRegimes(prev => ({
        ...prev,
        [data.symbol]: {
          regime: data.current as SymbolRegimeEntry['regime'],
          confidence: data.confidence,
          warmedUp: true,
        },
      }));
    };

    // T2-6: Use ref for ticker to prevent re-renders on every tick
    const handleTicker = (data: { symbol: string; lastPrice: string; volume24h: string }) => {
      tickerRef.current = {
        ...tickerRef.current,
        [data.symbol]: { lastPrice: data.lastPrice, volume24h: data.volume24h },
      };
    };

    // Risk event handlers — all update the same riskEvents array
    const addRiskEvent = (data: RiskEvent) => {
      setRiskEvents(prev => [data, ...prev].slice(0, 20));
    };

    const handleCircuitBreak = addRiskEvent;
    const handleDrawdownWarning = addRiskEvent;
    const handleDrawdownHalt = addRiskEvent;
    const handleCircuitReset = addRiskEvent;
    const handleExposureAdjusted = addRiskEvent;

    const handleUnhandledError = (data: { type: string; reason?: string; timestamp: string }) => {
      const errorEvent: RiskEvent = {
        _id: `err_${Date.now()}`,
        eventType: 'process_error',
        severity: 'critical',
        source: 'process',
        reason: data.reason || `Process ${data.type}`,
        acknowledged: false,
        createdAt: data.timestamp,
      };
      setRiskEvents(prev => [errorEvent, ...prev].slice(0, 20));
    };

    // Grace period handlers
    const handleGraceStarted = (data: GraceStartedEvent) => {
      setStrategyGraceStates(prev => ({
        ...prev,
        [data.strategy]: {
          graceState: 'grace_period' as GraceState,
          graceExpiresAt: data.graceExpiresAt,
        },
      }));
    };

    const handleGraceCancelled = (data: GraceCancelledEvent) => {
      setStrategyGraceStates(prev => ({
        ...prev,
        [data.strategy]: {
          graceState: 'active' as GraceState,
          graceExpiresAt: null,
        },
      }));
    };

    const handleStrategyDeactivated = (data: StrategyDeactivatedEvent) => {
      setStrategyGraceStates(prev => ({
        ...prev,
        [data.strategy]: {
          graceState: 'inactive' as GraceState,
          graceExpiresAt: null,
        },
      }));
    };

    // Register all handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on(SOCKET_EVENTS.SIGNAL_GENERATED, handleSignalGenerated);
    socket.on(SOCKET_EVENTS.REGIME_CHANGE, handleRegimeChange);
    socket.on(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, handleSymbolRegimeUpdate);
    socket.on(SOCKET_EVENTS.TICKER, handleTicker);
    socket.on(SOCKET_EVENTS.CIRCUIT_BREAK, handleCircuitBreak);
    socket.on(SOCKET_EVENTS.DRAWDOWN_WARNING, handleDrawdownWarning);
    socket.on(SOCKET_EVENTS.DRAWDOWN_HALT, handleDrawdownHalt);
    socket.on(SOCKET_EVENTS.CIRCUIT_RESET, handleCircuitReset);
    socket.on(SOCKET_EVENTS.EXPOSURE_ADJUSTED, handleExposureAdjusted);
    socket.on(SOCKET_EVENTS.UNHANDLED_ERROR, handleUnhandledError);
    socket.on(SOCKET_EVENTS.GRACE_STARTED, handleGraceStarted);
    socket.on(SOCKET_EVENTS.GRACE_CANCELLED, handleGraceCancelled);
    socket.on(SOCKET_EVENTS.STRATEGY_DEACTIVATED, handleStrategyDeactivated);

    return () => {
      // Remove all named handlers BEFORE releasing socket
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off(SOCKET_EVENTS.SIGNAL_GENERATED, handleSignalGenerated);
      socket.off(SOCKET_EVENTS.REGIME_CHANGE, handleRegimeChange);
      socket.off(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, handleSymbolRegimeUpdate);
      socket.off(SOCKET_EVENTS.TICKER, handleTicker);
      socket.off(SOCKET_EVENTS.CIRCUIT_BREAK, handleCircuitBreak);
      socket.off(SOCKET_EVENTS.DRAWDOWN_WARNING, handleDrawdownWarning);
      socket.off(SOCKET_EVENTS.DRAWDOWN_HALT, handleDrawdownHalt);
      socket.off(SOCKET_EVENTS.CIRCUIT_RESET, handleCircuitReset);
      socket.off(SOCKET_EVENTS.EXPOSURE_ADJUSTED, handleExposureAdjusted);
      socket.off(SOCKET_EVENTS.UNHANDLED_ERROR, handleUnhandledError);
      socket.off(SOCKET_EVENTS.GRACE_STARTED, handleGraceStarted);
      socket.off(SOCKET_EVENTS.GRACE_CANCELLED, handleGraceCancelled);
      socket.off(SOCKET_EVENTS.STRATEGY_DEACTIVATED, handleStrategyDeactivated);
      releaseSocket();
    };
  }, []);

  const clearSignals = useCallback(() => {
    setSignals([]);
  }, []);

  const clearRiskEvents = useCallback(() => {
    setRiskEvents([]);
  }, []);

  return {
    connected,
    signals,
    positions: [] as Position[], // Maintained for backward compatibility
    regime,
    symbolRegimes,
    riskEvents,
    lastTicker: {} as Record<string, { lastPrice: string; volume24h: string }>,
    strategyGraceStates,
    tickerRef,
    clearSignals,
    clearRiskEvents,
  };
}
