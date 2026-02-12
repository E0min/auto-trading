/**
 * Format a string number as currency (USDT)
 */
export function formatCurrency(value: string | undefined | null, decimals = 2): string {
  if (!value) return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format percentage string
 */
export function formatPercent(value: string | undefined | null, decimals = 2): string {
  if (!value) return '0.00%';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00%';
  return `${num.toFixed(decimals)}%`;
}

/**
 * Format date string to localized Korean format
 */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format date to short time only
 */
export function formatTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Get PnL color class based on value
 */
export function getPnlColor(value: string | undefined | null): string {
  if (!value) return 'text-zinc-400';
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return 'text-zinc-400';
  return num > 0 ? 'text-emerald-400' : 'text-red-400';
}

/**
 * Get PnL sign prefix
 */
export function getPnlSign(value: string | undefined | null): string {
  if (!value) return '';
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return '';
  return num > 0 ? '+' : '';
}

/**
 * Format symbol (e.g., "BTCUSDT" -> "BTC/USDT")
 */
export function formatSymbol(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

/**
 * Translate bot state to Korean
 */
export function translateBotState(state: string): string {
  const map: Record<string, string> = {
    idle: '대기 중',
    running: '실행 중',
    paused: '일시정지',
    stopping: '정지 중',
    error: '오류',
  };
  return map[state] || state;
}

/**
 * Translate trade side to Korean
 */
export function translateSide(side: string): string {
  const map: Record<string, string> = {
    buy: '매수',
    sell: '매도',
    long: '롱',
    short: '숏',
    open_long: '롱 진입',
    open_short: '숏 진입',
    close_long: '롱 청산',
    close_short: '숏 청산',
  };
  return map[side] || side;
}

/**
 * Translate market regime to Korean
 */
export function translateRegime(regime: string): string {
  const map: Record<string, string> = {
    trending_up: '상승 추세',
    trending_down: '하락 추세',
    ranging: '횡보',
    volatile: '고변동성',
    unknown: '분석 중',
  };
  return map[regime] || regime;
}

/**
 * Get regime badge color
 */
export function getRegimeColor(regime: string): string {
  const map: Record<string, string> = {
    trending_up: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    trending_down: 'bg-red-500/20 text-red-400 border-red-500/30',
    ranging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    volatile: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    unknown: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  };
  return map[regime] || map.unknown;
}

/**
 * Shorten large numbers (e.g., 1234567 -> "1.23M")
 */
export function shortenNumber(value: string | undefined | null): string {
  if (!value) return '0';
  const num = parseFloat(value);
  if (isNaN(num)) return '0';
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

/**
 * Translate strategy name to Korean description
 */
export function translateStrategyName(name: string): string {
  const map: Record<string, string> = {
    MomentumStrategy: '모멘텀 추세추종',
    MeanReversionStrategy: '평균 회귀',
    RsiPivotStrategy: 'RSI + Pivot 역추세',
    SupertrendStrategy: '슈퍼트렌드 + MACD',
    GridStrategy: 'ATR 그리드 매매',
    BollingerReversionStrategy: '볼린저 밴드 회귀',
    MaTrendStrategy: '멀티 이평선 추세',
    FundingRateStrategy: '펀딩비 역발상',
    AdaptiveRegimeStrategy: '장세 적응형 멀티전략',
    VwapReversionStrategy: 'VWAP 회귀',
    MacdDivergenceStrategy: 'MACD 다이버전스',
    BreakoutStrategy: 'BB Squeeze 돌파',
    QuietRangeScalpStrategy: 'QUIET 장세 스캘핑',
  };
  return map[name] || name;
}

/**
 * cn - simple class name merger (no clsx dependency needed)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
