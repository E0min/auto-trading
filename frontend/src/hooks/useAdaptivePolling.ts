'use client';

import { useEffect, useState, useMemo } from 'react';

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

  // Track page visibility
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Calculate target interval
  const targetInterval = useMemo(() => {
    if (!isVisible) return config.hidden;
    if (riskHalted) return config.halted;
    if (botState === 'running') return config.active;
    return config.idle;
  }, [isVisible, riskHalted, botState, config]);

  // Fetch on tab return
  useEffect(() => {
    const handler = () => {
      if (!document.hidden) {
        fetchFn();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetchFn]);

  // Main polling effect — React's cleanup pattern clears the old interval
  // when targetInterval changes, so no additional debounce is needed
  useEffect(() => {
    const id = setInterval(fetchFn, targetInterval);
    return () => clearInterval(id);
  }, [fetchFn, targetInterval]);

  // Initial fetch
  useEffect(() => {
    fetchFn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
