'use client';

import { useState, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { translateStrategyName, cn } from '@/lib/utils';
import type { BacktestConfig, BacktestStrategyItem } from '@/types/backtest';

interface BacktestFormProps {
  strategies: BacktestStrategyItem[];
  running: boolean;
  onSubmit: (config: BacktestConfig) => void;
}

const INTERVALS = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1H', label: '1H' },
  { value: '4H', label: '4H' },
  { value: '1D', label: '1D' },
] as const;

const inputClass =
  'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors';

const inputErrorClass =
  'w-full bg-[var(--bg-surface)] border border-[var(--loss)]/50 rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--loss)] transition-colors';

const labelClass = 'block text-xs text-[var(--text-muted)] mb-1';

const SYMBOL_PATTERN = /^[A-Z]+USDT$/;

function toDateInputValue(date: Date): string {
  return date.toISOString().split('T')[0];
}

interface ValidationErrors {
  dateRange?: string;
  initialCapital?: string;
  makerFee?: string;
  takerFee?: string;
  slippage?: string;
  symbol?: string;
}

interface ValidationWarnings {
  makerFee?: string;
  takerFee?: string;
  slippage?: string;
}

export default function BacktestForm({ strategies, running, onSubmit }: BacktestFormProps) {
  const [strategyName, setStrategyName] = useState('');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('15m');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return toDateInputValue(d);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [initialCapital, setInitialCapital] = useState('10000');
  const [makerFee, setMakerFee] = useState('0.02');
  const [takerFee, setTakerFee] = useState('0.06');
  const [slippage, setSlippage] = useState('0.05');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.name === strategyName) ?? null,
    [strategies, strategyName]
  );

  // Validation
  const errors = useMemo((): ValidationErrors => {
    const errs: ValidationErrors = {};

    // Date range
    if (startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      if (startMs >= endMs) {
        errs.dateRange = '시작일은 종료일보다 이전이어야 합니다';
      }
    }

    // Initial capital
    const capital = parseFloat(initialCapital);
    if (isNaN(capital) || capital < 100) {
      errs.initialCapital = '초기 자본은 최소 100 USDT 이상이어야 합니다';
    }

    // Symbol format
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (trimmedSymbol && !SYMBOL_PATTERN.test(trimmedSymbol)) {
      errs.symbol = '심볼은 대문자 영문 + USDT 형식이어야 합니다 (예: BTCUSDT)';
    }

    // Fee validation (only when advanced is shown or values differ from default)
    const makerFeeNum = parseFloat(makerFee);
    if (!isNaN(makerFeeNum) && (makerFeeNum < 0 || makerFeeNum > 1)) {
      errs.makerFee = '메이커 수수료는 0~1% 범위여야 합니다';
    }

    const takerFeeNum = parseFloat(takerFee);
    if (!isNaN(takerFeeNum) && (takerFeeNum < 0 || takerFeeNum > 1)) {
      errs.takerFee = '테이커 수수료는 0~1% 범위여야 합니다';
    }

    // Slippage validation
    const slippageNum = parseFloat(slippage);
    if (!isNaN(slippageNum) && (slippageNum < 0 || slippageNum > 0.5)) {
      errs.slippage = '슬리피지는 0~0.5% 범위여야 합니다';
    }

    return errs;
  }, [startDate, endDate, initialCapital, symbol, makerFee, takerFee, slippage]);

  // Warnings (non-blocking)
  const warnings = useMemo((): ValidationWarnings => {
    const warns: ValidationWarnings = {};

    const makerFeeNum = parseFloat(makerFee);
    if (!isNaN(makerFeeNum) && makerFeeNum > 0.5 && makerFeeNum <= 1) {
      warns.makerFee = '메이커 수수료가 0.5%를 초과합니다. 일반적인 거래소 수수료보다 높습니다.';
    }

    const takerFeeNum = parseFloat(takerFee);
    if (!isNaN(takerFeeNum) && takerFeeNum > 0.5 && takerFeeNum <= 1) {
      warns.takerFee = '테이커 수수료가 0.5%를 초과합니다. 일반적인 거래소 수수료보다 높습니다.';
    }

    const slippageNum = parseFloat(slippage);
    if (!isNaN(slippageNum) && slippageNum > 0.3 && slippageNum <= 0.5) {
      warns.slippage = '슬리피지가 높게 설정되어 있습니다. 결과가 보수적으로 나올 수 있습니다.';
    }

    return warns;
  }, [makerFee, takerFee, slippage]);

  const hasErrors = Object.keys(errors).length > 0;

  const canSubmit =
    strategyName !== '' &&
    symbol.trim() !== '' &&
    startDate !== '' &&
    endDate !== '' &&
    initialCapital !== '' &&
    !hasErrors &&
    !running;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!canSubmit) return;

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    const config: BacktestConfig = {
      strategyName,
      strategyConfig: selectedStrategy?.defaultConfig ?? {},
      symbol: symbol.trim().toUpperCase(),
      interval,
      startTime: startMs,
      endTime: endMs,
      initialCapital,
      makerFee: (parseFloat(makerFee) / 100).toString(),
      takerFee: (parseFloat(takerFee) / 100).toString(),
      slippage: (parseFloat(slippage) / 100).toString(),
    };

    onSubmit(config);
  };

  return (
    <Card title="백테스트 설정">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Row 1: Strategy, Symbol, Interval */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="bt-strategy" className={labelClass}>
              전략 선택
            </label>
            <select
              id="bt-strategy"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className={inputClass}
            >
              <option value="">-- 전략을 선택하세요 --</option>
              {strategies.map((s) => (
                <option key={s.name} value={s.name}>
                  {translateStrategyName(s.name)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="bt-symbol" className={labelClass}>
              심볼
            </label>
            <input
              id="bt-symbol"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="BTCUSDT"
              className={submitted && errors.symbol ? inputErrorClass : inputClass}
              aria-invalid={submitted && !!errors.symbol}
              aria-describedby={errors.symbol ? 'bt-symbol-error' : undefined}
            />
            {submitted && errors.symbol && (
              <p id="bt-symbol-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                {errors.symbol}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="bt-interval" className={labelClass}>
              기간
            </label>
            <select
              id="bt-interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className={inputClass}
            >
              {INTERVALS.map((iv) => (
                <option key={iv.value} value={iv.value}>
                  {iv.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Strategy description */}
        {selectedStrategy && (
          <p className="text-xs text-[var(--text-muted)] -mt-1 px-1">
            {selectedStrategy.description}
          </p>
        )}

        {/* Row 2: Start date, End date, Initial capital */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="bt-start" className={labelClass}>
              시작일
            </label>
            <input
              id="bt-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={submitted && errors.dateRange ? inputErrorClass : inputClass}
              aria-invalid={submitted && !!errors.dateRange}
              aria-describedby={errors.dateRange ? 'bt-date-error' : undefined}
            />
          </div>

          <div>
            <label htmlFor="bt-end" className={labelClass}>
              종료일
            </label>
            <input
              id="bt-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={submitted && errors.dateRange ? inputErrorClass : inputClass}
              aria-invalid={submitted && !!errors.dateRange}
              aria-describedby={errors.dateRange ? 'bt-date-error' : undefined}
            />
            {submitted && errors.dateRange && (
              <p id="bt-date-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                {errors.dateRange}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="bt-capital" className={labelClass}>
              초기 자본 (USDT)
            </label>
            <input
              id="bt-capital"
              type="number"
              min="100"
              step="any"
              value={initialCapital}
              onChange={(e) => setInitialCapital(e.target.value)}
              placeholder="10000"
              className={submitted && errors.initialCapital ? inputErrorClass : inputClass}
              aria-invalid={submitted && !!errors.initialCapital}
              aria-describedby={errors.initialCapital ? 'bt-capital-error' : undefined}
            />
            {submitted && errors.initialCapital && (
              <p id="bt-capital-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                {errors.initialCapital}
              </p>
            )}
          </div>
        </div>

        {/* Collapsible advanced options */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <svg
              className={cn(
                'w-3.5 h-3.5 transition-transform',
                showAdvanced && 'rotate-90'
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            고급 설정
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div>
                <label htmlFor="bt-maker" className={labelClass}>
                  메이커 수수료 (%)
                </label>
                <input
                  id="bt-maker"
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  value={makerFee}
                  onChange={(e) => setMakerFee(e.target.value)}
                  className={errors.makerFee ? inputErrorClass : inputClass}
                  aria-invalid={!!errors.makerFee}
                  aria-describedby={
                    errors.makerFee ? 'bt-maker-error' : warnings.makerFee ? 'bt-maker-warn' : undefined
                  }
                />
                {errors.makerFee && (
                  <p id="bt-maker-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                    {errors.makerFee}
                  </p>
                )}
                {!errors.makerFee && warnings.makerFee && (
                  <p id="bt-maker-warn" className="text-[10px] text-amber-400 mt-1">
                    {warnings.makerFee}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="bt-taker" className={labelClass}>
                  테이커 수수료 (%)
                </label>
                <input
                  id="bt-taker"
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  value={takerFee}
                  onChange={(e) => setTakerFee(e.target.value)}
                  className={errors.takerFee ? inputErrorClass : inputClass}
                  aria-invalid={!!errors.takerFee}
                  aria-describedby={
                    errors.takerFee ? 'bt-taker-error' : warnings.takerFee ? 'bt-taker-warn' : undefined
                  }
                />
                {errors.takerFee && (
                  <p id="bt-taker-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                    {errors.takerFee}
                  </p>
                )}
                {!errors.takerFee && warnings.takerFee && (
                  <p id="bt-taker-warn" className="text-[10px] text-amber-400 mt-1">
                    {warnings.takerFee}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="bt-slippage" className={labelClass}>
                  슬리피지 (%)
                </label>
                <input
                  id="bt-slippage"
                  type="number"
                  min="0"
                  max="0.5"
                  step="0.001"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className={errors.slippage ? inputErrorClass : inputClass}
                  aria-invalid={!!errors.slippage}
                  aria-describedby={
                    errors.slippage ? 'bt-slippage-error' : warnings.slippage ? 'bt-slippage-warn' : undefined
                  }
                />
                {errors.slippage && (
                  <p id="bt-slippage-error" className="text-[10px] text-[var(--loss)] mt-1" role="alert">
                    {errors.slippage}
                  </p>
                )}
                {!errors.slippage && warnings.slippage && (
                  <p id="bt-slippage-warn" className="text-[10px] text-amber-400 mt-1">
                    {warnings.slippage}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!canSubmit}
          loading={running}
          className="w-full sm:w-auto"
        >
          백테스트 실행
        </Button>
      </form>
    </Card>
  );
}
