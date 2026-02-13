'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { acquireSocket, releaseSocket, SOCKET_EVENTS } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import type { Signal, Position, MarketRegimeData, SymbolRegimeEntry, RiskEvent } from '@/types';

interface SocketState {
  connected: boolean;
  signals: Signal[];
  positions: Position[];
  regime: MarketRegimeData | null;
  symbolRegimes: Record<string, SymbolRegimeEntry>;
  riskEvents: RiskEvent[];
  lastTicker: Record<string, { lastPrice: string; volume24h: string }>;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<SocketState>({
    connected: false,
    signals: [],
    positions: [],
    regime: null,
    symbolRegimes: {},
    riskEvents: [],
    lastTicker: {},
  });

  useEffect(() => {
    const socket = acquireSocket();
    socketRef.current = socket;

    // Named handlers so they can be removed with off()
    const handleConnect = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    const handleDisconnect = () => {
      setState(prev => ({ ...prev, connected: false }));
    };

    const handleSignalGenerated = (signal: Signal) => {
      setState(prev => ({
        ...prev,
        signals: [signal, ...prev.signals].slice(0, 50),
      }));
    };

    const handlePositionUpdated = (data: { positions: Position[] }) => {
      setState(prev => ({ ...prev, positions: data.positions }));
    };

    const handleRegimeChange = (data: MarketRegimeData) => {
      setState(prev => ({ ...prev, regime: data }));
    };

    const handleSymbolRegimeUpdate = (data: { symbol: string; current: string; confidence: number }) => {
      setState(prev => ({
        ...prev,
        symbolRegimes: {
          ...prev.symbolRegimes,
          [data.symbol]: {
            regime: data.current as SymbolRegimeEntry['regime'],
            confidence: data.confidence,
            warmedUp: true,
          },
        },
      }));
    };

    const handleTicker = (data: { symbol: string; lastPrice: string; volume24h: string }) => {
      setState(prev => ({
        ...prev,
        lastTicker: {
          ...prev.lastTicker,
          [data.symbol]: { lastPrice: data.lastPrice, volume24h: data.volume24h },
        },
      }));
    };

    const handleCircuitBreak = (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    };

    const handleDrawdownWarning = (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    };

    const handleDrawdownHalt = (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    };

    const handleCircuitReset = (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    };

    const handleExposureAdjusted = (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    };

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
      setState(prev => ({
        ...prev,
        riskEvents: [errorEvent, ...prev.riskEvents].slice(0, 20),
      }));
    };

    // Register all handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on(SOCKET_EVENTS.SIGNAL_GENERATED, handleSignalGenerated);
    socket.on(SOCKET_EVENTS.POSITION_UPDATED, handlePositionUpdated);
    socket.on(SOCKET_EVENTS.REGIME_CHANGE, handleRegimeChange);
    socket.on(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, handleSymbolRegimeUpdate);
    socket.on(SOCKET_EVENTS.TICKER, handleTicker);
    socket.on(SOCKET_EVENTS.CIRCUIT_BREAK, handleCircuitBreak);
    socket.on(SOCKET_EVENTS.DRAWDOWN_WARNING, handleDrawdownWarning);
    socket.on(SOCKET_EVENTS.DRAWDOWN_HALT, handleDrawdownHalt);
    socket.on(SOCKET_EVENTS.CIRCUIT_RESET, handleCircuitReset);
    socket.on(SOCKET_EVENTS.EXPOSURE_ADJUSTED, handleExposureAdjusted);
    socket.on(SOCKET_EVENTS.UNHANDLED_ERROR, handleUnhandledError);

    return () => {
      // Remove all named handlers BEFORE releasing socket
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off(SOCKET_EVENTS.SIGNAL_GENERATED, handleSignalGenerated);
      socket.off(SOCKET_EVENTS.POSITION_UPDATED, handlePositionUpdated);
      socket.off(SOCKET_EVENTS.REGIME_CHANGE, handleRegimeChange);
      socket.off(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, handleSymbolRegimeUpdate);
      socket.off(SOCKET_EVENTS.TICKER, handleTicker);
      socket.off(SOCKET_EVENTS.CIRCUIT_BREAK, handleCircuitBreak);
      socket.off(SOCKET_EVENTS.DRAWDOWN_WARNING, handleDrawdownWarning);
      socket.off(SOCKET_EVENTS.DRAWDOWN_HALT, handleDrawdownHalt);
      socket.off(SOCKET_EVENTS.CIRCUIT_RESET, handleCircuitReset);
      socket.off(SOCKET_EVENTS.EXPOSURE_ADJUSTED, handleExposureAdjusted);
      socket.off(SOCKET_EVENTS.UNHANDLED_ERROR, handleUnhandledError);
      releaseSocket();
    };
  }, []);

  const clearSignals = useCallback(() => {
    setState(prev => ({ ...prev, signals: [] }));
  }, []);

  const clearRiskEvents = useCallback(() => {
    setState(prev => ({ ...prev, riskEvents: [] }));
  }, []);

  return { ...state, clearSignals, clearRiskEvents };
}
