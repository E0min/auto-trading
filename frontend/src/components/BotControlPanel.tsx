'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { translateBotState } from '@/lib/utils';
import type { BotState } from '@/types';

interface BotControlPanelProps {
  status: BotState;
  running: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onEmergencyStop: () => Promise<void>;
}

const statusVariant: Record<BotState, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  idle: 'neutral',
  running: 'success',
  paused: 'warning',
  stopping: 'info',
  error: 'danger',
};

export default function BotControlPanel({
  status,
  running,
  onStart,
  onStop,
  onPause,
  onResume,
  onEmergencyStop,
}: BotControlPanelProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleAction = async (action: string, fn: () => Promise<void>) => {
    setLoadingAction(action);
    try {
      await fn();
    } catch (err) {
      console.error(`봇 ${action} 실패:`, err);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Card className="col-span-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">봇 제어</h2>
          <Badge variant={statusVariant[status]} dot>
            {translateBotState(status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!running ? (
            <Button
              variant="primary"
              size="sm"
              loading={loadingAction === 'start'}
              onClick={() => handleAction('start', onStart)}
            >
              시작
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                loading={loadingAction === 'pause'}
                onClick={() => handleAction('pause', status === 'paused' ? onResume : onPause)}
              >
                {status === 'paused' ? '재개' : '일시정지'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={loadingAction === 'stop'}
                onClick={() => handleAction('stop', onStop)}
              >
                정지
              </Button>
            </>
          )}
          <Button
            variant="danger"
            size="sm"
            loading={loadingAction === 'emergency'}
            onClick={() => handleAction('emergency', onEmergencyStop)}
            disabled={!running}
          >
            긴급 정지
          </Button>
        </div>
      </div>
    </Card>
  );
}
