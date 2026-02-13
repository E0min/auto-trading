'use client';

interface TradingModeBannerProps {
  mode: 'live' | 'paper';
  isLoading?: boolean;
}

export default function TradingModeBanner({ mode, isLoading }: TradingModeBannerProps) {
  if (isLoading) return null;

  if (mode === 'live') {
    return (
      <div
        className="w-full bg-red-600/90 text-white text-center py-1.5 text-sm font-medium flex items-center justify-center gap-2"
        role="status"
        aria-label="실거래 모드"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
        </span>
        LIVE TRADING — 실제 자금 거래 중
      </div>
    );
  }

  return (
    <div
      className="w-full bg-emerald-600/30 border-b border-emerald-500/20 text-emerald-400 text-center py-1 text-xs"
      role="status"
      aria-label="가상거래 모드"
    >
      PAPER TRADING
    </div>
  );
}
