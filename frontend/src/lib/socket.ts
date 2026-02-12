import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[Socket] 연결됨:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] 연결 해제:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] 연결 오류:', err.message);
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Socket event names (match backend constants)
export const SOCKET_EVENTS = {
  // Trade events
  ORDER_SUBMITTED: 'trade:order_submitted',
  ORDER_FILLED: 'trade:order_filled',
  ORDER_CANCELLED: 'trade:order_cancelled',
  SIGNAL_GENERATED: 'trade:signal_generated',
  POSITION_UPDATED: 'trade:position_updated',
  // Risk events
  RISK_VALIDATED: 'risk:order_validated',
  RISK_REJECTED: 'risk:order_rejected',
  CIRCUIT_BREAK: 'risk:circuit_break',
  CIRCUIT_RESET: 'risk:circuit_reset',
  DRAWDOWN_WARNING: 'risk:drawdown_warning',
  DRAWDOWN_HALT: 'risk:drawdown_halt',
  EXPOSURE_ADJUSTED: 'risk:exposure_adjusted',
  // Market events
  TICKER: 'market:ticker',
  KLINE: 'market:kline',
  BOOK: 'market:book',
  REGIME_CHANGE: 'market:regime_change',
  COIN_SELECTED: 'market:coin_selected',
} as const;
