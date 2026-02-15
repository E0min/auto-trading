'use client';

import { ReactNode } from 'react';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const dotColors: Record<BadgeVariant, string> = {
  success: 'bg-[var(--profit)]',
  danger: 'bg-[var(--loss)]',
  warning: 'bg-amber-400',
  info: 'bg-blue-400',
  neutral: 'bg-[var(--text-muted)]',
};

const textColors: Record<BadgeVariant, string> = {
  success: 'text-[var(--profit)]',
  danger: 'text-[var(--loss)]',
  warning: 'text-amber-400',
  info: 'text-blue-400',
  neutral: 'text-[var(--text-secondary)]',
};

export default function Badge({ children, variant = 'neutral', className = '', dot = false }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${textColors[variant]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
}
