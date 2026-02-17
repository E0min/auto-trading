'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';

type BotState = 'idle' | 'running' | 'paused' | 'stopping' | 'error' | string;

interface PollingConfig {
  idle: number;
  active: number;
  halted: number;
  hidden: number;
}

const POLLING_CONFIGS: Record<string, PollingConfig> = {
  botStatus:  { idle: 30000, active: 5000,  halted: 10000, hidden: 60000 },
  positions:  { idle: 30000, active: 3000,  halted: 10000, hidden: 60000 },
  trades:     { idle: 30000, active: 10000, halted: 15000, hidden: 60000 },
  health:     { idle: 60000, active: 30000, halted: 30000, hidden: 120000 },
  marketIntel: { idle: 30000, active: 10000, halted: 15000, hidden: 60000 },
};

export function useAdaptivePolling(
  fetchFn: () => void | Promise<void>,
  configKey: keyof typeof POLLING_CONFIGS,
  botState: BotState = 'idle',
  riskHalted: boolean = false,
) {
  const config = POLLING_CONFIGS[configKey];
  const [isVisible, setIsVisible] = useState(true);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  // R14-20: Single consolidated visibilitychange listener
  // Handles both visibility state tracking and tab-return fetch
  const handleVisibility = useCallback(() => {
    const visible = !document.hidden;
    setIsVisible(visible);
    if (visible) {
      fetchFnRef.current();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [handleVisibility]);

  // Calculate target interval
  const targetInterval = useMemo(() => {
    if (!isVisible) return config.hidden;
    if (riskHalted) return config.halted;
    if (botState === 'running') return config.active;
    return config.idle;
  }, [isVisible, riskHalted, botState, config]);

  // Main polling effect — React's cleanup pattern clears the old interval
  // when targetInterval changes, so no additional debounce is needed
  useEffect(() => {
    const id = setInterval(() => fetchFnRef.current(), targetInterval);
    return () => clearInterval(id);
  }, [targetInterval]);

  // Initial fetch
  useEffect(() => {
    fetchFnRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
