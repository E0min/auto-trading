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

const labelClass = 'block text-xs text-[var(--text-muted)] mb-1';

function toDateInputValue(date: Date): string {
  return date.toISOString().split('T')[0];
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

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.name === strategyName) ?? null,
    [strategies, strategyName]
  );

  const canSubmit =
    strategyName !== '' &&
    symbol.trim() !== '' &&
    startDate !== '' &&
    endDate !== '' &&
    initialCapital !== '' &&
    !running;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    if (startMs >= endMs) return;

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
      <form onSubmit={handleSubmit} className="space-y-4">
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
              className={inputClass}
            />
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
              className={inputClass}
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
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="bt-capital" className={labelClass}>
              초기 자본 (USDT)
            </label>
            <input
              id="bt-capital"
              type="number"
              min="1"
              step="any"
              value={initialCapital}
              onChange={(e) => setInitialCapital(e.target.value)}
              placeholder="10000"
              className={inputClass}
            />
          </div>
        </div>

        {/* Collapsible advanced options */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
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
                  step="0.001"
                  value={makerFee}
                  onChange={(e) => setMakerFee(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bt-taker" className={labelClass}>
                  테이커 수수료 (%)
                </label>
                <input
                  id="bt-taker"
                  type="number"
                  min="0"
                  step="0.001"
                  value={takerFee}
                  onChange={(e) => setTakerFee(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="bt-slippage" className={labelClass}>
                  슬리피지 (%)
                </label>
                <input
                  id="bt-slippage"
                  type="number"
                  min="0"
                  step="0.001"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className={inputClass}
                />
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
