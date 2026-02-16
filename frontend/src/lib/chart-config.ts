import type React from 'react';

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
