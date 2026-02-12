'use client';

import Badge from '@/components/ui/Badge';
import type { HealthReport } from '@/types';

interface SystemHealthProps {
  health: HealthReport | null;
  latency: number | null;
  socketConnected: boolean;
  error: string | null;
}

const healthVariant = {
  healthy: 'success' as const,
  degraded: 'warning' as const,
  unhealthy: 'danger' as const,
};

const healthLabel = {
  healthy: '정상',
  degraded: '저하',
  unhealthy: '비정상',
};

export default function SystemHealth({ health, latency, socketConnected, error }: SystemHealthProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="danger" dot>서버 연결 실패</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      {health && (
        <Badge variant={healthVariant[health.status]} dot>
          {healthLabel[health.status]}
        </Badge>
      )}
      <Badge variant={socketConnected ? 'success' : 'danger'} dot>
        {socketConnected ? 'WS 연결' : 'WS 끊김'}
      </Badge>
      {latency !== null && (
        <span className="text-zinc-500">
          {latency}ms
        </span>
      )}
    </div>
  );
}
