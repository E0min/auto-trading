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
        'flex gap-1 border-b border-zinc-800 pb-px',
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
        'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
        isActive
          ? 'text-zinc-100 bg-zinc-800 border-b-2 border-blue-500'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
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
    <div role="tabpanel" className={cn('pt-2', className)}>
      {children}
    </div>
  );
}
