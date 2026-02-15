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
        className="w-full border-b border-[var(--loss)]/30 text-[var(--loss)] text-center py-1 text-[11px] font-medium flex items-center justify-center gap-2"
        role="status"
        aria-label="실거래 모드"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--loss)] opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--loss)]" />
        </span>
        LIVE TRADING
      </div>
    );
  }

  return (
    <div
      className="w-full border-b border-[var(--accent)]/20 text-[var(--accent)]/60 text-center py-1 text-[10px] tracking-wider uppercase"
      role="status"
      aria-label="가상거래 모드"
    >
      PAPER TRADING
    </div>
  );
}
