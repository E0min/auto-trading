'use client';

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  headerRight?: ReactNode;
}

export default function Card({ children, className = '', title, headerRight }: CardProps) {
  return (
    <div
      className={`bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-6 transition-colors hover:border-[var(--border-muted)] ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {title}
          </h3>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}
