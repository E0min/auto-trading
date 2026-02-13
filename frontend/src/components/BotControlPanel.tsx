'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import EmergencyStopDialog from '@/components/EmergencyStopDialog';
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

  const handleLiveConfirm = () => {
    setShowLiveConfirm(false);
    handleAction('start', onStart);
  };

  const handleEmergencyConfirm = () => {
    handleAction('emergency', onEmergencyStop);
  };

  return (
    <>
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
                onClick={handleStartClick}
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
              onClick={() => setShowEmergencyDialog(true)}
              disabled={!running}
            >
              긴급 정지
            </Button>
          </div>
        </div>
      </Card>

      {/* Emergency Stop Dialog */}
      <EmergencyStopDialog
        isOpen={showEmergencyDialog}
        onClose={() => setShowEmergencyDialog(false)}
        onConfirm={handleEmergencyConfirm}
        openPositionCount={openPositionCount}
        unrealizedPnl={unrealizedPnl}
      />

      {/* LIVE mode start confirmation */}
      {showLiveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="bg-zinc-900 border border-red-500/50 rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-red-400 mb-3">실거래 모드 확인</h3>
            <p className="text-sm text-zinc-300 mb-4">
              현재 <span className="text-red-400 font-medium">LIVE 모드</span>입니다. 실제 자금으로 거래가 실행됩니다. 봇을 시작하시겠습니까?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowLiveConfirm(false)}
                className="px-4 py-2 text-sm rounded-md bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              >
                취소
              </button>
              <button
                onClick={handleLiveConfirm}
                className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-500"
              >
                실거래 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
