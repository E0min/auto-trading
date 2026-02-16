import type React from 'react';
import { formatCurrency } from '@/lib/utils';

export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '8px',
  fontSize: '12px',
  padding: '8px 12px',
};

export interface EquityCurveConfig {
  timeField: string;
  timeFormat: Intl.DateTimeFormatOptions;
  primaryKey: string;
  secondaryKey: string;
  primaryLabel: string;
  secondaryLabel: string;
  primaryStroke?: string;
  primaryStrokeWidth?: number;
}

export const DASHBOARD_EQUITY_CONFIG: EquityCurveConfig = {
  timeField: 'timestamp',
  timeFormat: { hour: '2-digit', minute: '2-digit' },
  primaryKey: 'equity',
  secondaryKey: 'pnl',
  primaryLabel: '자산',
  secondaryLabel: '미실현 PnL',
};

export const BACKTEST_EQUITY_CONFIG: EquityCurveConfig = {
  timeField: 'ts',
  timeFormat: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  primaryKey: 'equity',
  secondaryKey: 'cash',
  primaryLabel: '에쿼티',
  secondaryLabel: '현금',
  primaryStroke: '#4ADE80',
  primaryStrokeWidth: 2,
};

/**
 * Create a type-safe Recharts Tooltip formatter for currency values.
 *
 * Recharts Formatter signature: (value?, name?, entry?, index?, payload?) => ReactNode | [ReactNode, string]
 * We match the expected `value?: number | undefined, name?: string | undefined` to avoid `as never`.
 */
export function createCurrencyFormatter(
  labelFn?: (name: string) => string,
  prefix = '$',
) {
  return (value?: number, name?: string) => [
    `${prefix}${formatCurrency(String(value ?? 0))}`,
    labelFn ? labelFn(String(name ?? '')) : (String(name ?? '') || 'PnL'),
  ] as [string, string];
}

/**
 * Create a type-safe Recharts Tooltip formatter for percentage values.
 */
export function createPercentFormatter(label = '드로다운') {
  return (value?: number) => [
    `${(value ?? 0).toFixed(2)}%`,
    label,
  ] as [string, string];
}

/**
 * Create a type-safe Recharts Tooltip formatter for integer/score values.
 */
export function createScoreFormatter(
  labelFn: (name: string) => string,
) {
  return (value?: number, name?: string) => [
    Math.round(Number(value ?? 0)),
    labelFn(String(name ?? '')),
  ] as [number, string];
}
