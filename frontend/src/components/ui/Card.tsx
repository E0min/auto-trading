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
    <div className={`bg-zinc-900 border border-zinc-800 rounded-xl p-4 ${className}`}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}
