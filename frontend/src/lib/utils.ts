/**
 * Format a string number as currency (USDT).
 * Auto-detects decimal places for small numbers so that
 * tiny prices (e.g. 0.0004369) don't display as "$0.00".
 */
export function formatCurrency(value: string | undefined | null, decimals = 2): string {
  if (!value) return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  if (num === 0) return '0.00';

  const absNum = Math.abs(num);
  let effectiveDecimals = decimals;

  if (absNum > 0 && absNum < 1) {
    // Find how many leading zeros after decimal point, then show 2 significant digits
    const leadingZeros = -Math.floor(Math.log10(absNum)) - 1;
    effectiveDecimals = Math.max(decimals, leadingZeros + 2);
    effectiveDecimals = Math.min(effectiveDecimals, 8); // cap at 8
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: effectiveDecimals,
    maximumFractionDigits: effectiveDecimals,
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
  if (!value) return 'text-[var(--text-muted)]';
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return 'text-[var(--text-muted)]';
  return num > 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]';
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
    quiet: '저변동성',
    unknown: '분석 중',
  };
  return map[regime] || regime;
}

/**
 * Get regime badge color
 */
export function getRegimeColor(regime: string): string {
  const map: Record<string, string> = {
    trending_up: 'text-emerald-400/70',
    trending_down: 'text-red-400/70',
    ranging: 'text-amber-400/70',
    volatile: 'text-purple-400/70',
    quiet: 'text-blue-400/70',
    unknown: 'text-[var(--text-muted)]',
  };
  return map[regime] || map.unknown;
}

export function getRegimeDotColor(regime: string): string {
  const map: Record<string, string> = {
    trending_up: 'bg-emerald-400',
    trending_down: 'bg-red-400',
    ranging: 'bg-amber-400',
    volatile: 'bg-purple-400',
    quiet: 'bg-blue-400',
    unknown: 'bg-[var(--text-muted)]',
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
    TurtleBreakoutStrategy: '터틀 Donchian 돌파',
    CandlePatternStrategy: '캔들 패턴 가격행동',
    SupportResistanceStrategy: '지지저항 돌파',
    SwingStructureStrategy: '스윙 구조 추세',
    FibonacciRetracementStrategy: '피보나치 되돌림',
    TrendlineBreakoutStrategy: '추세선 돌파',
  };
  return map[name] || name;
}

/**
 * Strategy category — 3-way classification
 */
export type StrategyCategory = 'price-action' | 'indicator-light' | 'indicator-heavy';

const STRATEGY_CATEGORY_MAP: Record<string, StrategyCategory> = {
  TurtleBreakoutStrategy: 'price-action',
  CandlePatternStrategy: 'price-action',
  SupportResistanceStrategy: 'price-action',
  SwingStructureStrategy: 'price-action',
  FibonacciRetracementStrategy: 'price-action',
  TrendlineBreakoutStrategy: 'price-action',
  QuietRangeScalpStrategy: 'indicator-heavy',
  BreakoutStrategy: 'indicator-heavy',
  AdaptiveRegimeStrategy: 'indicator-heavy',
};

export function getStrategyCategory(name: string): StrategyCategory {
  return STRATEGY_CATEGORY_MAP[name] || 'indicator-light';
}

/**
 * Translate reject reason to Korean
 */
export function translateRejectReason(reason: string): string {
  // Prefix matching for dynamic reasons
  if (reason.startsWith('cooldown:')) return '쿨다운 대기';
  if (reason.startsWith('duplicate:')) return '중복 시그널';
  if (reason.startsWith('max_concurrent:')) return '최대 동시 포지션 초과';
  if (reason.startsWith('conflict:')) return '반대 시그널 충돌';
  if (reason.startsWith('low_confidence:')) return '신뢰도 부족';
  if (reason.startsWith('Risk validation error:')) return '리스크 검증 오류';
  if (reason.startsWith('Exchange error:')) return '거래소 오류';

  const map: Record<string, string> = {
    circuit_breaker_active: '서킷 브레이커 발동',
    daily_loss_exceeded: '일일 손실 한도 초과',
    max_drawdown_exceeded: '최대 드로다운 초과',
    total_exposure_exceeded: '총 노출 한도 초과',
    equity_not_initialized: '자산 미초기화',
    qty_resolution_failed: '수량 산출 실패',
  };
  return map[reason] || reason;
}

/**
 * Translate strategy category to Korean
 */
export function translateStrategyCategory(category: string): string {
  const map: Record<string, string> = {
    'price-action': '가격행동',
    'indicator-light': '경량지표',
    'indicator-heavy': '고급지표',
  };
  return map[category] || category;
}

/**
 * Format PnL value with sign prefix
 */
export function formatPnlValue(value: string | undefined | null): string {
  if (!value) return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num >= 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}

/**
 * cn - simple class name merger (no clsx dependency needed)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
