'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { regimeApi } from '@/lib/api-client';
import { acquireSocket, releaseSocket, SOCKET_EVENTS } from '@/lib/socket';
import { useAdaptivePolling } from '@/hooks/useAdaptivePolling';
import type {
  RegimeContext,
  RegimeHistoryEntry,
  CoinScoringData,
  StrategyRoutingData,
  BotState,
} from '@/types';

interface MarketIntelligenceState {
  regimeContext: RegimeContext | null;
  regimeHistory: RegimeHistoryEntry[];
  coinScoring: CoinScoringData | null;
  strategyRouting: StrategyRoutingData | null;
  loading: boolean;
  error: string | null;
}

export function useMarketIntelligence(botState: BotState = 'idle') {
  const [state, setState] = useState<MarketIntelligenceState>({
    regimeContext: null,
    regimeHistory: [],
    coinScoring: null,
    strategyRouting: null,
    loading: true,
    error: null,
  });

  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const [ctxRes, histRes, coinRes, routeRes] = await Promise.allSettled([
        regimeApi.getStatus(),
        regimeApi.getHistory(100),
        regimeApi.getCoinScoring(),
        regimeApi.getStrategyRouting(),
      ]);

      if (!mountedRef.current) return;

      setState((prev) => ({
        regimeContext: ctxRes.status === 'fulfilled' ? ctxRes.value : prev.regimeContext,
        regimeHistory: histRes.status === 'fulfilled' ? histRes.value : prev.regimeHistory,
        coinScoring: coinRes.status === 'fulfilled' ? coinRes.value : prev.coinScoring,
        strategyRouting: routeRes.status === 'fulfilled' ? routeRes.value : prev.strategyRouting,
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : '데이터 로드 실패',
      }));
    }
  }, []);

  useAdaptivePolling(fetchAll, 'marketIntel', botState);

  // Socket.io real-time listeners
  useEffect(() => {
    mountedRef.current = true;
    const socket = acquireSocket();

    // Regime change → prepend to history
    socket.on(SOCKET_EVENTS.REGIME_CHANGE, (data: RegimeHistoryEntry) => {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        regimeContext: {
          ...prev.regimeContext,
          regime: data.current,
          confidence: data.confidence,
          btcPrice: data.btcPrice,
          ema9: data.ema9,
          sma20: data.sma20,
          sma50: data.sma50,
          atr: data.atr,
          factorScores: data.scores,
        } as RegimeContext,
        regimeHistory: [...prev.regimeHistory, data].slice(-100),
      }));
    });

    // Coin selection → refresh scoring
    socket.on(SOCKET_EVENTS.COIN_SELECTED, () => {
      if (!mountedRef.current) return;
      regimeApi.getCoinScoring().then((data) => {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, coinScoring: data }));
        }
      }).catch(() => {});
    });

    // Strategy router regime switch → refresh routing
    socket.on(SOCKET_EVENTS.REGIME_SWITCH, () => {
      if (!mountedRef.current) return;
      regimeApi.getStrategyRouting().then((data) => {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, strategyRouting: data }));
        }
      }).catch(() => {});
    });

    return () => {
      mountedRef.current = false;
      socket.off(SOCKET_EVENTS.REGIME_CHANGE);
      socket.off(SOCKET_EVENTS.COIN_SELECTED);
      socket.off(SOCKET_EVENTS.REGIME_SWITCH);
      releaseSocket();
    };
  }, []);

  return {
    ...state,
    refetch: fetchAll,
  };
}
