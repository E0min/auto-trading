# Round 3 Proposal — Tier 1 Reliability (11건)

> **Agent**: Senior Systems Engineer
> **Date**: 2026-02-14
> **Base commit**: f0489fb (Sprint R2: Tier 0 Safety-Critical 9건 완료)
> **Scope**: T1-1 ~ T1-11 중 시스템 무결성 관점 분석

---

## 분석 요약

Round 2에서 Tier 0 Safety-Critical 9건을 모두 구현 완료한 상태에서, Tier 1 Reliability 11건을 분석했다.
내가 직접 발견한 T1-3(Graceful shutdown), T1-4(PaperEngine 리스너), T1-5(SignalFilter 연동)를 중점 분석하고,
T1-9(Socket.io lifecycle), T1-10(Error Boundary)를 시스템 안정성 관점에서 리뷰했다.
추가로 T1-1(Backtest IndicatorCache), T1-2(Backtest _notifyFill), T1-6(Sharpe ratio), T1-11(DrawdownMonitor 리셋)도 코드 수준에서 검증했다.

**핵심 발견**: 11건 모두 실제 코드 분석으로 문제가 확인되었다. 특히 T1-1은 18개 전략 중 8개가 backtest에서 즉시 크래시하는 치명적 문제이며, T1-3의 shutdown 순서는 데이터 유실 가능성이 있다.

---

## 발견 사항 (코드 레벨 근거 포함)

### T1-1: Backtest IndicatorCache 주입 — **CRITICAL**

**파일**: `backend/src/backtest/backtestEngine.js` (라인 247-271)
**파일**: `backend/src/services/indicatorCache.js`

**현재 상태**: `_createStrategy()` 메서드가 `registry.create()` 후 `strategy.activate()` 만 호출. `setIndicatorCache()`를 호출하지 않는다.

```javascript
// backtestEngine.js:247-271 — 문제 코드
_createStrategy() {
  const metadata = registry.getMetadata(this.strategyName);
  const defaultConfig = (metadata && metadata.defaultConfig) ? metadata.defaultConfig : {};
  const mergedConfig = { ...defaultConfig, ...this.strategyConfig };
  const strategy = registry.create(this.strategyName, mergedConfig);
  strategy.activate(this.symbol);
  // ❌ setIndicatorCache() 호출 없음
  // ❌ IndicatorCache가 없어서 this._indicatorCache가 null
  return strategy;
}
```

**영향받는 전략 (8개)**:
- `indicator-light/`: RsiPivot, BollingerReversion, Grid, MacdDivergence, Vwap (5개)
- `indicator-heavy/`: QuietRangeScalp, Breakout, AdaptiveRegime (3개)

이 8개 전략은 `onKline()`에서 `this._indicatorCache.get()` 또는 `this._indicatorCache.getHistory()`를 호출한다. `_indicatorCache`가 null이면 `TypeError: Cannot read properties of null (reading 'get')`로 즉시 크래시.

나머지 `price-action/` 5개 전략과 `indicator-light/` 중 MaTrend, Supertrend, FundingRate 3개는 자체 내부 배열을 관리하므로 영향 없다.

**해결 방안**:
BacktestEngine용 경량 IndicatorCache 스텁을 생성하여 주입해야 한다.
BacktestEngine이 KLINE_UPDATE 이벤트를 발생시키는 MarketData가 없으므로, kline을 직접 feed하는 인라인 캐시가 필요하다.

```javascript
// backtestEngine.js에 추가할 BacktestIndicatorCache
class BacktestIndicatorCache {
  constructor() {
    this._data = new Map();
  }

  // backtestEngine의 main loop에서 매 kline마다 호출
  feedKline(symbol, kline) {
    let store = this._data.get(symbol);
    if (!store) {
      store = { klines: [], closes: [], highs: [], lows: [], volumes: [], cache: new Map() };
      this._data.set(symbol, store);
    }
    // IndicatorCache._handleKline과 동일 로직
    store.klines.push({ high: kline.high, low: kline.low, close: kline.close, open: kline.open, volume: kline.volume || '0' });
    store.closes.push(kline.close);
    store.highs.push(kline.high || kline.close);
    store.lows.push(kline.low || kline.close);
    store.volumes.push(kline.volume || '0');
    if (store.klines.length > 500) { /* trim */ }
    store.cache.clear();
  }

  get(symbol, indicator, params = {}) {
    // IndicatorCache._compute와 동일 위임
  }

  getHistory(symbol) {
    // IndicatorCache.getHistory와 동일
  }
}
```

그리고 `_createStrategy()`에서:
```javascript
const strategy = registry.create(this.strategyName, mergedConfig);
strategy.setIndicatorCache(this._backtestCache);
strategy.activate(this.symbol);
```

메인 루프에서 매 kline마다:
```javascript
this._backtestCache.feedKline(this.symbol, kline);
this._strategy.onKline(kline);
```

**주의**: IndicatorCache의 `_compute()` 메서드를 공유하기 위해, 실제 IndicatorCache에서 static 메서드 또는 유틸 함수로 추출하는 것이 좋다. 코드 중복을 방지.

---

### T1-2: Backtest _notifyFill() action 필드 누락

**파일**: `backend/src/backtest/backtestEngine.js` (라인 722-730)

**현재 코드**:
```javascript
_notifyFill(side, price) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price });
      // ❌ action 필드 없음. fill.action이 undefined.
    } catch (err) { ... }
  }
}
```

**전략측 코드** (TurtleBreakoutStrategy.js:439):
```javascript
onFill(fill) {
  if (!fill) return;
  const action = fill.action || (fill.signal && fill.signal.action);
  // action이 undefined면 fall.action = '', 이후 if문 전부 건너뛰어 entry tracking 실패
  if (action === SIGNAL_ACTIONS.OPEN_LONG) {
    this._positionSide = 'long';
    ...
  }
}
```

15개 전략 모두 `onFill()`을 구현하고 있으며, 대부분 `fill.action`을 사용해 open_long/open_short/close_long/close_short를 구분한다. action이 없으면:
1. entry price tracking 실패 (TP/SL 작동 불가)
2. 포지션 상태 동기화 실패
3. 백테스트 결과가 실제와 크게 괴리

**해결 방안**:
`_notifyFill()`과 호출부를 수정:

```javascript
// 함수 시그니처 변경
_notifyFill(side, price, action) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price, action });
    } catch (err) { ... }
  }
}

// 호출부 수정 (4곳)
// _openLong:   this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.OPEN_LONG);
// _openShort:  this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.OPEN_SHORT);
// _closeLong:  this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);
// _closeShort: this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.CLOSE_SHORT);
```

추가로 `symbol` 필드도 포함하면 전략의 multi-symbol 로직에도 대응 가능:
```javascript
this._strategy.onFill({ side, price, action, symbol: this.symbol });
```

---

### T1-3: Graceful Shutdown 순서 수정 — 내가 원래 발견 (E:C-4)

**파일**: `backend/src/app.js` (라인 387-443)

**현재 shutdown 순서**:
1. `botService.stop()` (전략 중지, WS 해제)
2. `clearInterval(leaderboardInterval)`
3. `server.close()` (HTTP 서버 종료)
4. `io.close()` (Socket.io 종료)
5. `mongoose.disconnect()` (MongoDB 연결 해제) <-- **마지막**

**문제**: `botService.stop()` 내부 (라인 483-491)에서 `this.currentSession.save()`를 호출한다. 이 시점에서 MongoDB 연결은 아직 살아있으므로 정상 동작하지만, 만약 botService.stop()이 지연되어 mongoose.disconnect()가 먼저 실행되면 DB write가 실패할 수 있다.

더 중요한 문제는 **Socket.io를 DB write보다 먼저 닫는 것**이다:
- 현재: HTTP close -> Socket.io close -> MongoDB disconnect
- botService.stop() 중에 Trade/Signal 저장이 진행될 수 있음
- 그 사이 Socket.io가 닫히면 프론트엔드에 최종 상태 전달 불가

**해결 방안**: shutdown 순서 재정렬

```javascript
const safeShutdown = async (reason) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info(`safeShutdown — starting (reason: ${reason})`);

  // Notify frontend BEFORE anything closes
  try { io.emit(RISK_EVENTS.UNHANDLED_ERROR, { type: reason, timestamp: new Date().toISOString() }); } catch (_) {}

  const forceExitTimer = setTimeout(() => { process.exit(1); }, 10000);
  forceExitTimer.unref();

  // Phase 1: Stop bot (DB writes happen here — session save, etc.)
  try { await botService.stop('server_shutdown'); } catch (err) { ... }

  // Phase 2: Clear intervals
  if (leaderboardInterval) clearInterval(leaderboardInterval);

  // Phase 3: Stop accepting new HTTP requests
  server.close(() => { log.info('HTTP server closed'); });

  // Phase 4: Flush any pending DB writes (새로 추가)
  // 짧은 대기를 주어 botService.stop() 이후 비동기 save가 완료되도록
  await new Promise(resolve => setTimeout(resolve, 500));

  // Phase 5: Close MongoDB (DB 작업 완료 후)
  try { await mongoose.disconnect(); log.info('MongoDB disconnected'); } catch (err) { ... }

  // Phase 6: Close Socket.io (마지막 — 프론트엔드 알림이 완료된 후)
  try { io.close(); log.info('Socket.io closed'); } catch (err) { ... }

  log.info('safeShutdown complete');
  process.exit(0);
};
```

핵심 변경: **MongoDB disconnect를 Socket.io close보다 먼저** 실행. DB write가 완료되어야 데이터 무결성 보장. Socket.io는 맨 마지막에 닫아도 무방 (더 이상 emit할 데이터가 없으므로).

---

### T1-4: PaperEngine 리스너 누적 — 내가 원래 발견 (E:H-3)

**파일**: `backend/src/services/orderManager.js` (라인 123-136)

**현재 코드**:
```javascript
setPaperMode(paperEngine, paperPositionManager) {
  this._paperMode = true;
  this._paperEngine = paperEngine;
  this._paperPositionManager = paperPositionManager;

  // ❌ 매 호출마다 새 리스너 추가. 이전 리스너 제거 없음.
  this._paperEngine.on('paper:fill', (fill) => {
    this._handlePaperFill(fill).catch((err) => { ... });
  });
}
```

**문제**: `setPaperMode()`가 여러 번 호출되면 `paper:fill` 리스너가 누적된다.
실제 호출 경로:
1. `app.js:122` — bootstrap 시 `orderManager.setPaperMode(paperEngine, paperPositionManager)` (최초 1회)
2. `botService.js:644` — `setTradingMode('paper')` 시 `this.orderManager.setPaperMode(...)` (런타임)

사용자가 paper -> live -> paper 전환을 반복하면 리스너가 매번 추가. 결과:
- 하나의 limit fill에 대해 `_handlePaperFill`이 N번 실행
- Trade 문서 N번 업데이트, PnL N번 기록
- RiskEngine에 같은 trade를 N번 recordTrade -> CircuitBreaker 오동작

**해결 방안**:

```javascript
setPaperMode(paperEngine, paperPositionManager) {
  // 이전 리스너 제거
  if (this._paperEngine && this._paperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
  }

  this._paperMode = true;
  this._paperEngine = paperEngine;
  this._paperPositionManager = paperPositionManager;

  // 바인드된 핸들러 저장하여 나중에 제거 가능
  this._paperFillHandler = (fill) => {
    this._handlePaperFill(fill).catch((err) => {
      log.error('setPaperMode — error handling paper fill', { error: err });
    });
  };
  this._paperEngine.on('paper:fill', this._paperFillHandler);

  log.info('OrderManager — paper trading mode enabled');
}

setLiveMode() {
  // 리스너 정리
  if (this._paperEngine && this._paperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
    this._paperFillHandler = null;
  }

  this._paperMode = false;
  this._paperEngine = null;
  this._paperPositionManager = null;
  log.info('OrderManager — live trading mode enabled');
}
```

---

### T1-5: SignalFilter.updatePositionCount() 연동 — 내가 원래 발견 (E:4.11)

**파일**: `backend/src/services/signalFilter.js` (라인 99-101)
**파일**: `backend/src/services/botService.js`

**현재 상태**: `SignalFilter.updatePositionCount(strategy, count)`는 정의되어 있지만, **어디에서도 호출되지 않는다**.

```javascript
// signalFilter.js:99-101
updatePositionCount(strategy, count) {
  this._positionCounts.set(strategy, count);
}
```

그 결과 `_positionCounts` Map은 항상 비어있고, `_checkMaxConcurrent()`에서:
```javascript
// signalFilter.js:215
const currentCount = this._positionCounts.get(strategy) || 0;
// 항상 0 반환 → maxConcurrent 제한이 실질적으로 비활성화
```

**영향**: 전략별 최대 동시 포지션 제한이 작동하지 않음. RsiPivot이 maxConcurrentPositions=2로 설정되어 있어도, 실제로는 무제한 포지션을 열 수 있음.

**해결 방안**: botService에서 ORDER_FILLED 이벤트를 감지하여 SignalFilter에 포지션 카운트를 동기화해야 한다.

```javascript
// botService.js의 start() 내부, 이벤트 와이어링 섹션에 추가:

// 11d. Wire up: position changes -> signalFilter.updatePositionCount
if (this.signalFilter) {
  const updateFilterCounts = () => {
    // 현재 열려있는 포지션을 전략별로 집계
    const positions = this.positionManager.getPositions();
    const countMap = new Map();

    for (const pos of positions) {
      const strategy = pos.strategy || 'unknown';
      countMap.set(strategy, (countMap.get(strategy) || 0) + 1);
    }

    // 등록된 모든 전략의 카운트 업데이트
    for (const s of this.strategies) {
      this.signalFilter.updatePositionCount(s.name, countMap.get(s.name) || 0);
    }
  };

  // ORDER_FILLED 이벤트마다 갱신
  const onOrderFilled = () => { updateFilterCounts(); };
  this.orderManager.on(TRADE_EVENTS.ORDER_FILLED, onOrderFilled);
  this._eventCleanups.push(() => {
    this.orderManager.removeListener(TRADE_EVENTS.ORDER_FILLED, onOrderFilled);
  });

  // ORDER_CANCELLED 시에도 갱신 (주문 취소로 포지션 수 변동 가능)
  const onOrderCancelled = () => { updateFilterCounts(); };
  this.orderManager.on(TRADE_EVENTS.ORDER_CANCELLED, onOrderCancelled);
  this._eventCleanups.push(() => {
    this.orderManager.removeListener(TRADE_EVENTS.ORDER_CANCELLED, onOrderCancelled);
  });

  // 초기 카운트 설정
  updateFilterCounts();
}
```

**Paper 모드 주의**: `paperPositionManager.getPositions()` 반환 형식이 `positionManager`와 다를 수 있으므로, `pos.strategy` 필드 존재 여부를 확인해야 한다. Paper 모드에서는 `paperPositionManager.getPositions()` 결과에 strategy 필드가 포함되어 있는지 확인 필요.

---

### T1-6: Sharpe Ratio 연간화 정규화

**파일**: `backend/src/backtest/backtestMetrics.js` (라인 206-246)

**현재 코드**:
```javascript
// backtestMetrics.js:239-243
// Annualise: sharpe = (mean * sqrt(365)) / stdDev
if (!isZero(stdDev)) {
  const sqrtDays = sqrt('365');
  const annualisedReturn = multiply(meanReturn, sqrtDays);
  sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
}
```

**문제**: 수익률을 `equityCurve` 인접 포인트 간 pctChange로 계산하는데, equityCurve의 각 포인트는 **캔들 간격**이다 (1H, 5m 등). 하지만 연간화 시 `sqrt(365)` (일간 기준)를 사용. 이는 인터벌에 따라 Sharpe가 과대/과소평가됨.

- 1H 캔들 백테스트: 실제 24개 포인트 = 1일. `sqrt(365)` 적용하면 `sqrt(365*24)` = `sqrt(8760)` 이어야 맞는데 `sqrt(365)` 사용 -> 과소평가
- 5m 캔들: 288개 포인트 = 1일. `sqrt(365*288)` = `sqrt(105120)` 이어야 맞음 -> 극심한 과소평가

**해결 방안**: BacktestEngine에서 interval 정보를 metrics에 전달하고, metrics에서 적절한 기간 환산:

```javascript
// backtestMetrics.js
function computeMetrics({ trades, equityCurve, initialCapital, interval = '1D' }) {
  // ...

  // interval -> 연간 캔들 수 매핑
  const CANDLES_PER_YEAR = {
    '1m': 525600, '3m': 175200, '5m': 105120, '15m': 35040,
    '30m': 17520, '1H': 8760, '4H': 2190, '1D': 365, '1W': 52,
  };
  const candlesPerYear = CANDLES_PER_YEAR[interval] || 365;

  // Sharpe 연간화: mean * sqrt(candlesPerYear) / stdDev
  const sqrtPeriods = sqrt(String(candlesPerYear));
  const annualisedReturn = multiply(meanReturn, sqrtPeriods);
  sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
}
```

BacktestEngine 결과에 interval 포함:
```javascript
// backtestEngine.js:216 반환 객체에 추가
return {
  config: { ..., interval: this.interval },
  ...
};
```

---

### T1-9: Socket.io Ref-counted Lifecycle — 시스템 관점 리뷰

**파일**: `frontend/src/lib/socket.ts`
**파일**: `frontend/src/hooks/useSocket.ts`

**현재 상태**:
```typescript
// socket.ts — 전역 싱글턴
let socket: Socket | null = null;
export function getSocket(): Socket { ... }
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// useSocket.ts — cleanup에서 disconnectSocket() 호출
return () => {
  disconnectSocket();  // ❌ 다른 컴포넌트가 아직 사용 중일 수 있음
};
```

**문제**: 현재 `useSocket()`는 `page.tsx`에서 1곳만 사용하고 있어 문제가 아직 표면화되지 않았지만:
1. 다중 페이지/컴포넌트가 `useSocket()`을 호출하면, 한 컴포넌트의 unmount가 전체 소켓 연결을 끊어버림
2. Next.js의 App Router에서 route transition 시 페이지 컴포넌트가 unmount/remount 됨
3. `disconnectSocket()` 후 다른 컴포넌트가 `getSocket()`을 호출하면 새 소켓이 생성되어 중복 연결

**해결 방안**: ref-count 기반 lifecycle 관리

```typescript
// socket.ts
let socket: Socket | null = null;
let refCount = 0;

export function acquireSocket(): Socket {
  refCount++;
  if (!socket) {
    socket = io(SOCKET_URL, { ... });
    // ... event handlers ...
  }
  return socket;
}

export function releaseSocket(): void {
  refCount--;
  if (refCount <= 0) {
    refCount = 0;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }
}

// 하위 호환을 위해 getSocket도 유지
export function getSocket(): Socket {
  return acquireSocket();
}
```

```typescript
// useSocket.ts
useEffect(() => {
  const socket = acquireSocket();
  socketRef.current = socket;
  // ... event handlers ...
  return () => {
    releaseSocket();
  };
}, []);
```

---

### T1-10: Error Boundary + API Client 에러 래핑 — 안정성 관점 리뷰

**파일**: `frontend/src/app/error.tsx` (현재 **존재하지 않음**)
**파일**: `frontend/src/lib/api-client.ts`

**현재 상태**:
1. `error.tsx`가 없어서 런타임 에러 시 Next.js의 기본 에러 화면 (또는 빈 화면) 표시
2. `api-client.ts`의 `request()` 함수:
   ```typescript
   async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
     const res = await fetch(`${API_BASE}${endpoint}`, { ... });
     const json = await res.json();
     if (!json.success) {
       throw new Error(json.error || '요청 실패');
     }
     return json.data;
   }
   ```
   - `fetch()` 자체가 실패하면 (네트워크 에러, CORS, 서버 다운) `TypeError: Failed to fetch` 발생
   - `res.json()` 파싱 실패 시 (비-JSON 응답) `SyntaxError` 발생
   - HTTP 500 등에서 `json.success`가 없으면 `TypeError` 발생

**문제의 위험도**: 금융 대시보드에서 화면이 완전히 크래시하면 운영자가 봇 상태를 확인/제어할 수 없게 된다. 이는 **시스템 관측성의 완전한 상실**을 의미하며, 위험한 포지션을 방치하는 결과로 이어질 수 있다.

**해결 방안**:

1. **`app/error.tsx`** (Next.js App Router Error Boundary):
```tsx
'use client';
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">
      <div className="bg-zinc-900 border border-red-500/30 rounded-lg p-6 max-w-lg">
        <h2 className="text-red-400 text-lg font-semibold">오류가 발생했습니다</h2>
        <p className="text-zinc-400 mt-2 text-sm">{error.message}</p>
        <div className="mt-4 flex gap-3">
          <button onClick={reset} className="px-4 py-2 bg-zinc-800 ...">재시도</button>
          <a href="/" className="px-4 py-2 bg-zinc-800 ...">대시보드로 이동</a>
        </div>
        {/* 긴급 정지 버튼도 여기에 노출 */}
        <EmergencyStopButton />
      </div>
    </div>
  );
}
```

2. **API Client 에러 래핑**:
```typescript
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public isNetworkError: boolean = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { ... });
  } catch (err) {
    throw new ApiError(
      '서버에 연결할 수 없습니다',
      0,
      endpoint,
      true,
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(
      `잘못된 응답 형식 (HTTP ${res.status})`,
      res.status,
      endpoint,
    );
  }

  if (!json.success) {
    throw new ApiError(
      json.error || '요청 실패',
      res.status,
      endpoint,
    );
  }

  return json.data;
}
```

---

### T1-11: DrawdownMonitor 수동 리셋 API

**파일**: `backend/src/services/drawdownMonitor.js`
**파일**: `backend/src/services/riskEngine.js`
**파일**: `backend/src/api/riskRoutes.js`

**현재 상태**:
- `DrawdownMonitor`에는 `resetDaily()`와 `resetAll(equity)` 메서드가 이미 존재
- `RiskEngine`에는 `resetDaily()` 메서드가 있으나 `resetAll()`은 없음
- `/api/risk` 라우트에는 리셋 엔드포인트가 없음

**문제**: max_drawdown_exceeded로 halt된 후 관리자가 수동으로 풀 수 없음. `dailyLossExceeded`는 `resetDaily()`로 해제 가능하지만, `max_drawdown_exceeded`는 해제 방법이 없음.

**해결 방안**:

1. `RiskEngine`에 메서드 추가:
```javascript
/**
 * Manually reset the drawdown monitor with a new equity baseline.
 * WARNING: This lifts a max_drawdown halt. Use with extreme caution.
 * @param {string} equity — new baseline equity
 */
resetDrawdown(equity) {
  log.warn('Manual drawdown reset requested', { equity });
  this.drawdownMonitor.resetAll(equity);
}
```

2. `/api/risk` 라우트에 엔드포인트 추가:
```javascript
// POST /api/risk/drawdown/reset — manually reset drawdown monitor
router.post('/drawdown/reset', (req, res) => {
  try {
    const { equity } = req.body;
    if (!equity) {
      return res.status(400).json({ success: false, error: 'equity is required' });
    }
    riskEngine.resetDrawdown(equity);
    res.json({ success: true, data: riskEngine.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

3. 프론트엔드에 리셋 버튼 (UI 에이전트에게 요청)

---

## 제안 사항 (우선순위, 구현 난이도, 예상 영향)

| 순위 | ID | 제목 | 난이도 | 영향 | 비고 |
|------|-----|------|--------|------|------|
| **1** | **T1-1** | Backtest IndicatorCache 주입 | **높음** | **치명** | 8/18 전략 백테스트 불가. 코드량 중간 (BacktestIndicatorCache 클래스). |
| **2** | **T1-2** | Backtest _notifyFill() action 필드 | **낮음** | **높음** | 15개 전략의 position tracking 깨짐. 5줄 수정. |
| **3** | **T1-4** | PaperEngine 리스너 누적 제거 | **낮음** | **높음** | N배 중복 실행 -> CircuitBreaker 오작동. 10줄 수정. |
| **4** | **T1-5** | SignalFilter 포지션 카운트 연동 | **중간** | **높음** | maxConcurrent 제한 무효화 상태. 이벤트 와이어링 추가. |
| **5** | **T1-3** | Graceful shutdown 순서 수정 | **낮음** | **중간** | DB write 유실 가능성. shutdown 함수 내 순서 재정렬. |
| **6** | **T1-10** | Error Boundary + API 에러 래핑 | **낮음** | **높음** | 대시보드 크래시시 봇 제어 불가. 새 파일 2개. |
| **7** | **T1-9** | Socket.io ref-counted lifecycle | **중간** | **중간** | 현재 1곳 사용이라 급하지 않으나, 확장성 위해 필요. |
| **8** | **T1-11** | DrawdownMonitor 수동 리셋 | **낮음** | **중간** | halt 해제 불가. API 엔드포인트 + RiskEngine 메서드 추가. |
| **9** | **T1-6** | Sharpe ratio 연간화 보정 | **낮음** | **낮음** | 표시 오류일 뿐 거래 로직 영향 없음. |
| **10** | T1-7 | Dashboard 레이아웃 재설계 | - | - | UI 에이전트 영역 |
| **11** | T1-8 | PositionsTable 수동 청산 버튼 | - | - | UI 에이전트 영역 (API는 이미 존재) |

### Track 분배 제안

**Track A (Backend — 내가 구현)**: T1-1, T1-2, T1-3, T1-4, T1-5, T1-11 (6건)
**Track C (Frontend — UI 에이전트 구현)**: T1-7, T1-8, T1-9, T1-10 (4건)
**Track B (Backtest metrics)**: T1-6 (1건 — Trader 에이전트가 검증)

### 구현 순서 (Track A)

1. **T1-2** (5분) — 가장 간단, 즉시 효과
2. **T1-4** (10분) — 간단하지만 영향 큼
3. **T1-5** (20분) — 이벤트 와이어링, paper 모드 호환 확인 필요
4. **T1-3** (15분) — shutdown 순서 재정렬
5. **T1-11** (15분) — API + RiskEngine 메서드
6. **T1-1** (40분) — 가장 복잡, BacktestIndicatorCache 구현

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게
1. **T1-1**: BacktestIndicatorCache 구현 후 8개 전략 백테스트가 정상 실행되는지 검증 필요. 기존에 크래시 없이 동작하던 10개 전략 (price-action 5 + MaTrend/Supertrend/FundingRate/Grid 중 일부)과 결과 비교.
2. **T1-2**: action 필드 추가 후 전략별 TP/SL 작동 확인. 특히 TurtleBreakout, RsiPivot의 백테스트 수익률 변화 검증.
3. **T1-6**: Sharpe ratio 보정 공식 검증. interval별 기대 Sharpe 범위 확인 (보정 전/후 비교).

### UI 에이전트에게
1. **T1-10**: Error Boundary에서 **반드시 긴급 정지 버튼을 노출**해야 함. 에러 화면에서 봇 제어가 불가능하면 안전 위험. `botApi.emergencyStop()`을 직접 호출하는 버튼 포함 요청.
2. **T1-11**: DrawdownMonitor 리셋 UI 버튼. `/api/risk/drawdown/reset` API를 호출하는 버튼을 Risk Status 영역에 추가. 위험한 작업이므로 확인 다이얼로그 필수.
3. **T1-9**: ref-count 방식 전환 시 기존 `useSocket()` hook의 cleanup 로직 변경 필요. `disconnectSocket()` 대신 `releaseSocket()` 사용.
4. **T1-8**: 수동 청산 API는 `tradeApi.submitOrder({ symbol, action: 'close_long' })` 형태로 이미 존재. 프론트엔드에서 확인 다이얼로그 + 에러 핸들링만 추가하면 됨.
5. **T1-5 관련**: SignalFilter 포지션 카운트가 활성화되면, 봇 상태 API 응답의 `signalFilter` 필드에 per-strategy positionCount가 노출됨. Dashboard에서 이 정보를 보여주면 운영 가시성 향상.

---

## 리스크 분석

| 리스크 | 완화 방안 |
|--------|----------|
| T1-1에서 IndicatorCache의 `_compute()` 로직 중복 | IndicatorCache에서 static 유틸로 추출하여 공유 |
| T1-5에서 paper 모드 포지션 형식 불일치 | getPositions() 반환 형식 정규화, strategy 필드 보장 |
| T1-3 shutdown 순서 변경으로 기존 동작 깨짐 | 단계별 로그 + forceExit 타이머 유지 (10초) |
| T1-4 리스너 제거 시 참조 불일치 | bind된 핸들러를 인스턴스 프로퍼티에 저장하여 정확한 참조 제거 |
| T1-10 Error Boundary에서 `botApi.emergencyStop()` 실패 | 직접 `fetch()` fallback (api-client 우회) |
