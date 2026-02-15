'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import EmergencyStopDialog from '@/components/EmergencyStopDialog';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { translateBotState } from '@/lib/utils';
import type { BotState } from '@/types';

interface BotControlPanelProps {
  status: BotState;
  running: boolean;
  tradingMode?: 'live' | 'paper';
  openPositionCount: number;
  unrealizedPnl: string;
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
  tradingMode = 'paper',
  openPositionCount,
  unrealizedPnl,
  onStart,
  onStop,
  onPause,
  onResume,
  onEmergencyStop,
}: BotControlPanelProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

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

  const handleStartClick = () => {
    if (tradingMode === 'live') {
      setShowLiveConfirm(true);
    } else {
      handleAction('start', onStart);
    }
  };

  const handleEmergencyConfirm = () => {
    handleAction('emergency', onEmergencyStop);
  };

  return (
    <>
      {/* Inline bot controls — no separate card */}
      <div className="flex items-center gap-3">
        <Badge variant={statusVariant[status]} dot>
          {translateBotState(status)}
        </Badge>
        <div className="flex items-center gap-2">
          {!running ? (
            <Button
              variant="primary"
              size="sm"
              loading={loadingAction === 'start'}
              onClick={handleStartClick}
            >
              봇 시작
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
            onClick={() => setShowEmergencyDialog(true)}
            disabled={!running}
          >
            긴급
          </Button>
        </div>
      </div>

      {/* Emergency Stop Dialog */}
      <EmergencyStopDialog
        isOpen={showEmergencyDialog}
        onClose={() => setShowEmergencyDialog(false)}
        onConfirm={handleEmergencyConfirm}
        openPositionCount={openPositionCount}
        unrealizedPnl={unrealizedPnl}
      />

      {/* LIVE mode start confirmation */}
      <ConfirmDialog
        open={showLiveConfirm}
        onCancel={() => setShowLiveConfirm(false)}
        onConfirm={() => {
          setShowLiveConfirm(false);
          handleAction('start', onStart);
        }}
        title="실거래 모드 시작"
        message="실제 자금으로 거래를 시작합니다. 계속하시겠습니까?"
        confirmLabel="시작"
        variant="danger"
      />
    </>
  );
}
