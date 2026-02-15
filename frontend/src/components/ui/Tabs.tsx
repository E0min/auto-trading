'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ── Context ──────────────────────────────────────────────────────────────────

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs compound components must be used within <Tabs>');
  return ctx;
}

// ── Tabs root ────────────────────────────────────────────────────────────────

interface TabsProps {
  defaultTab: string;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultTab, children, className }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// ── TabList ──────────────────────────────────────────────────────────────────

interface TabListProps {
  children: ReactNode;
  className?: string;
}

export function TabList({ children, className }: TabListProps) {
  return (
    <div
      className={cn(
        'flex gap-1 border-b border-[var(--border-subtle)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

interface TabProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function Tab({ value, children, className }: TabProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;

  const handleClick = useCallback(() => {
    setActiveTab(value);
  }, [setActiveTab, value]);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={handleClick}
      className={cn(
        'px-3 py-2 text-xs font-medium transition-all duration-200 relative',
        isActive
          ? 'text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
        isActive && 'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--accent)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── TabPanel ─────────────────────────────────────────────────────────────────

interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const { activeTab } = useTabsContext();
  if (activeTab !== value) return null;

  return (
    <div role="tabpanel" className={cn('pt-3 animate-fade-in', className)}>
      {children}
    </div>
  );
}
