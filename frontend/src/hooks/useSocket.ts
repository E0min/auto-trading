'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, disconnectSocket, SOCKET_EVENTS } from '@/lib/socket';
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
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setState(prev => ({ ...prev, connected: true }));
    });

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, connected: false }));
    });

    // Trade events
    socket.on(SOCKET_EVENTS.SIGNAL_GENERATED, (signal: Signal) => {
      setState(prev => ({
        ...prev,
        signals: [signal, ...prev.signals].slice(0, 50),
      }));
    });

    socket.on(SOCKET_EVENTS.POSITION_UPDATED, (data: { positions: Position[] }) => {
      setState(prev => ({ ...prev, positions: data.positions }));
    });

    // Market events
    socket.on(SOCKET_EVENTS.REGIME_CHANGE, (data: MarketRegimeData) => {
      setState(prev => ({ ...prev, regime: data }));
    });

    socket.on(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, (data: { symbol: string; current: string; confidence: number }) => {
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
    });

    socket.on(SOCKET_EVENTS.TICKER, (data: { symbol: string; lastPrice: string; volume24h: string }) => {
      setState(prev => ({
        ...prev,
        lastTicker: {
          ...prev.lastTicker,
          [data.symbol]: { lastPrice: data.lastPrice, volume24h: data.volume24h },
        },
      }));
    });

    // Risk events
    socket.on(SOCKET_EVENTS.CIRCUIT_BREAK, (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    });

    socket.on(SOCKET_EVENTS.DRAWDOWN_WARNING, (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    });

    socket.on(SOCKET_EVENTS.DRAWDOWN_HALT, (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    });

    socket.on(SOCKET_EVENTS.CIRCUIT_RESET, (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    });

    socket.on(SOCKET_EVENTS.EXPOSURE_ADJUSTED, (data: RiskEvent) => {
      setState(prev => ({
        ...prev,
        riskEvents: [data, ...prev.riskEvents].slice(0, 20),
      }));
    });

    socket.on(SOCKET_EVENTS.UNHANDLED_ERROR, (data: { type: string; reason?: string; timestamp: string }) => {
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
    });

    return () => {
      disconnectSocket();
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
