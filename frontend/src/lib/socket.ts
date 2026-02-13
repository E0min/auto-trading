import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

let socket: Socket | null = null;
let refCount = 0;

function debugLog(...args: unknown[]) {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[Socket]', ...args);
  }
}

/**
 * Acquire a socket connection, incrementing the reference count.
 * Creates the socket if it doesn't exist yet.
 */
export function acquireSocket(): Socket {
  refCount++;
  debugLog(`acquireSocket: refCount=${refCount}`);

  if (!socket) {
    debugLog('새 소켓 연결 생성');
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      debugLog('연결됨:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      debugLog('연결 해제:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] 연결 오류:', err.message);
    });
  }

  return socket;
}

/**
 * Release a socket reference. Disconnects and cleans up when refCount reaches 0.
 */
export function releaseSocket(): void {
  refCount = Math.max(0, refCount - 1);
  debugLog(`releaseSocket: refCount=${refCount}`);

  if (refCount === 0 && socket) {
    debugLog('refCount=0, 소켓 연결 해제');
    socket.disconnect();
    socket = null;
  }
}

/**
 * Read-only accessor. Returns the current socket without changing refCount.
 * Returns null if no socket exists (AD-14).
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Force-disconnect regardless of refCount (backwards compat / emergency).
 */
export function disconnectSocket(): void {
  debugLog(`disconnectSocket: 강제 연결 해제 (refCount was ${refCount})`);
  refCount = 0;
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
  UNHANDLED_ERROR: 'risk:unhandled_error',
  // Trade extended
  SIGNAL_SKIPPED: 'trade:signal_skipped',
  // Market events
  TICKER: 'market:ticker',
  KLINE: 'market:kline',
  BOOK: 'market:book',
  REGIME_CHANGE: 'market:regime_change',
  SYMBOL_REGIME_UPDATE: 'market:symbol_regime_update',
  COIN_SELECTED: 'market:coin_selected',
} as const;
