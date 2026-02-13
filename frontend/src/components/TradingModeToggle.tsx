'use client';

import { useState } from 'react';
import { botApi } from '@/lib/api-client';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface TradingModeToggleProps {
  currentMode: 'live' | 'paper';
  botRunning: boolean;
  onModeChange: (mode: 'live' | 'paper') => void;
}

export default function TradingModeToggle({
  currentMode,
  botRunning,
  onModeChange,
}: TradingModeToggleProps) {
  const [pending, setPending] = useState<'live' | 'paper' | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelect = (mode: 'live' | 'paper') => {
    if (mode === currentMode || botRunning || loading) return;
    setPending(mode);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setLoading(true);
    try {
      await botApi.setTradingMode(pending);
      onModeChange(pending);
    } catch {
      // error is handled silently — mode stays unchanged
    } finally {
      setLoading(false);
      setPending(null);
    }
  };

  const handleCancel = () => {
    setPending(null);
  };

  const isLive = currentMode === 'live';

  return (
    <>
      <div
        className={`inline-flex items-center rounded-lg border p-0.5 text-xs font-medium ${
          botRunning ? 'opacity-50 cursor-not-allowed' : ''
        } ${
          isLive
            ? 'border-red-500/40 bg-red-500/10'
            : 'border-amber-500/40 bg-amber-500/10'
        }`}
      >
        {/* Live radio */}
        <button
          type="button"
          disabled={botRunning || loading}
          onClick={() => handleSelect('live')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            botRunning ? 'cursor-not-allowed' : 'cursor-pointer'
          } ${
            isLive
              ? 'bg-red-500/20 text-red-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
              isLive ? 'border-red-400' : 'border-zinc-600'
            }`}
          >
            {isLive && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
          </span>
          실거래(Live)
        </button>

        {/* Paper radio */}
        <button
          type="button"
          disabled={botRunning || loading}
          onClick={() => handleSelect('paper')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            botRunning ? 'cursor-not-allowed' : 'cursor-pointer'
          } ${
            !isLive
              ? 'bg-amber-500/20 text-amber-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span
            className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
              !isLive ? 'border-amber-400' : 'border-zinc-600'
            }`}
          >
            {!isLive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
          </span>
          가상거래(Paper)
        </button>
      </div>

      {/* Confirm dialog: paper → live */}
      <ConfirmDialog
        open={pending === 'live'}
        title="실거래 모드 전환"
        message="실제 자금으로 거래가 실행됩니다. 계속하시겠습니까?"
        confirmLabel="실거래 전환"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Confirm dialog: live → paper */}
      <ConfirmDialog
        open={pending === 'paper'}
        title="가상거래 모드 전환"
        message="가상 자금으로 전환됩니다. 실제 주문이 중단됩니다."
        confirmLabel="가상거래 전환"
        variant="warning"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
