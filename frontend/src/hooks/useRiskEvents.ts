'use client';

import { useCallback } from 'react';
import { riskApi } from '@/lib/api-client';
import type { RiskEvent } from '@/types';

/**
 * Hook for managing risk events — dismiss (local) and acknowledge (server-side).
 * Designed to be used alongside useSocket which provides real-time riskEvents.
 */
export function useRiskEvents(socketRiskEvents: RiskEvent[]) {
  const acknowledge = useCallback(async (eventId: string) => {
    try {
      await riskApi.acknowledge(eventId);
    } catch (err) {
      console.error('Risk event acknowledge failed:', err);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dismiss = useCallback((_eventId: string) => {
    // Local-only dismiss — handled by RiskAlertBanner's internal dismissedIds state.
    // No server call needed for non-critical events.
  }, []);

  return {
    events: socketRiskEvents,
    acknowledge,
    dismiss,
  };
}
