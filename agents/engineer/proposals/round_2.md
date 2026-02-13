# Round 2 -- 시스템 엔지니어 구현 가이드 (Tier 0: 9건)

> 작성일: 2026-02-13
> 기반: Round 1 합의 (decisions/round_1.md), BACKLOG T0-1 ~ T0-9
> 범위: Backend T0-1 ~ T0-6 상세 구현 가이드 + T0-8용 RiskEvent 모델 스키마 설계
> 아키텍처 결정 준수: AD-1(Set 기반 심볼), AD-2(botService에서 sizing), AD-3(crash handler), AD-4(RiskEvent 모델)

---

## 분석 요약

Round 1에서 식별된 47개 이슈 중 Tier 0 9건은 실거래 전 반드시 수정해야 하는 안전 핵심(Safety-Critical) 항목이다. 본 문서에서는 Backend 6건(T0-1 ~ T0-6)에 대해 소스 코드를 직접 분석한 결과를 바탕으로 구체적 구현 방안을 제시하고, Frontend T0-8 지원을 위한 RiskEvent MongoDB 모델 스키마를 설계한다.

### 현재 코드 상태 핵심 발견

1. **T0-1 (전략 이름)**: `botService.js:896`에서 기본값 `['MomentumStrategy', 'MeanReversionStrategy']`를 사용하지만, 이 이름들은 `sampleStrategies.js`에서 정의된 레거시 전략으로 실전용이 아님.

2. **T0-2 (Position sizing)**: 모든 전략이 `suggestedQty`에 `positionSizePercent` (예: `'2'`) 값을 전달하고 있는데, `orderManager.submitOrder()`는 이 값을 실제 수량으로 해석하여 거래소에 전달.

3. **T0-3 (Multi-symbol)**: `strategyBase.js:106-108`에서 `activate(symbol)`이 `this._symbol = symbol`로 스칼라 덮어쓰기. 여러 심볼에 대해 순차 activate를 호출하면 마지막 심볼만 유효.

4. **T0-4 (Crash handler)**: `app.js:426-427`에 SIGTERM/SIGINT만 등록. unhandledRejection/uncaughtException 핸들러 없음.

5. **T0-5 (Mutex)**: `orderManager.submitOrder()`에 동시성 제어 없음.

6. **T0-6 (Division by zero)**: `exposureGuard.js:109`에서 `divide(orderValue, equity)` 호출 시 equity='0'이면 mathUtils.divide가 throw.

---

## 항목별 구현 가이드

---

### T0-1: 기본 전략 이름 수정

#### 구체적 변경 내용

**파일**: `backend/src/services/botService.js`

```javascript
// 변경 전 (라인 896)
const strategyNames = config.strategies || ['MomentumStrategy', 'MeanReversionStrategy'];

// 변경 후
const DEFAULT_STRATEGIES = [
  'RsiPivotStrategy',
  'MaTrendStrategy',
  'BollingerReversionStrategy',
  'SupertrendStrategy',
  'TurtleBreakoutStrategy',
];

const strategyNames = config.strategies || DEFAULT_STRATEGIES;
```

선정 기준:
- 5개 전략은 서로 다른 레짐 조합을 커버
- indicator-light + price-action 혼합으로 지표 과밀 방지

레거시 전략 제거 여부: `sampleStrategies.js`와 `strategies/index.js:33-39`의 레거시 등록은 **아직 제거하지 않는다**. 기본값에서 제외함으로써 새 세션에서는 사용되지 않는다.

#### 에러 핸들링 고려사항
- `_createStrategies()`에서 이미 `registry.has(name)` 검증 및 try-catch로 개별 전략 실패가 전체를 죽이지 않음. 추가 방어 불필요.

---

### T0-2: Position Sizing (percentage → quantity 변환)

#### 구체적 변경 내용 (AD-2 준수: botService.js에서 해결)

**파일**: `backend/src/services/botService.js`

`_resolveSignalQuantity()` 메서드를 추가한다.

```javascript
/**
 * 전략의 suggestedQty (percentage or absolute) 를 실제 거래소 수량으로 변환.
 */
_resolveSignalQuantity(signal) {
  const strategy = this.strategies.find(s => s.name === signal.strategy);
  const meta = strategy ? strategy.getMetadata() : {};
  const sizingMode = meta.positionSizing || 'percentage';

  if (sizingMode === 'absolute') {
    return signal.suggestedQty || signal.qty;
  }

  // percentage 모드
  const percentage = signal.suggestedQty || signal.qty || '0';

  // 1. equity 조회
  let equity;
  if (this.paperMode && this.paperPositionManager) {
    equity = this.paperPositionManager.getEquity();
  } else {
    equity = this.riskEngine.accountState.equity;
  }

  if (math.isZero(equity) || math.isLessThan(equity, '1')) {
    log.warn('_resolveSignalQuantity — equity too low, cannot resolve qty', {
      equity, strategy: signal.strategy,
    });
    return '0';
  }

  // 2. allocatedValue = equity * (percentage / 100)
  const allocatedValue = math.multiply(equity, math.divide(percentage, '100'));

  // 3. price 결정
  const price = signal.suggestedPrice || signal.price;
  if (!price || math.isZero(price)) {
    const ticker = this.marketData.getLatestTicker(signal.symbol);
    if (!ticker || !ticker.lastPrice || math.isZero(ticker.lastPrice)) {
      log.warn('_resolveSignalQuantity — no price available', { symbol: signal.symbol });
      return '0';
    }
    return math.divide(allocatedValue, ticker.lastPrice);
  }

  // 4. qty = allocatedValue / price
  const qty = math.divide(allocatedValue, price);
  return qty;
}
```

**시그널 라우팅 변경 (2곳)**:

```javascript
// 변경 후
const resolvedQty = this._resolveSignalQuantity(signal);
if (math.isZero(resolvedQty) || math.isLessThan(resolvedQty, '0')) {
  log.warn('Signal skipped — resolved qty is zero', {
    strategy: signal.strategy, symbol: signal.symbol,
  });
  return;
}

this.orderManager.submitOrder({
  ...signal,
  qty: resolvedQty,
  price: signal.suggestedPrice || signal.price,
  sessionId,
});
```

#### 에러 핸들링 고려사항
- equity=0 방어: `'0'` 반환하고 호출자가 skip
- price=0 방어: marketData fallback + 실패 시 `'0'` 반환
- 음수 qty 방어: `isLessThan(resolvedQty, '0')` 체크 포함

---

### T0-3: Multi-symbol Routing (Set 기반)

#### 구체적 변경 내용 (AD-1 준수: Set 기반)

**1. `strategyBase.js` 변경**

```javascript
constructor(name, config = {}) {
  // ...
  this._symbol = null;           // 하위 호환
  this._symbols = new Set();     // 신규: 다중 심볼
  // ...
}

activate(symbol, category = CATEGORIES.USDT_FUTURES) {
  if (!symbol || typeof symbol !== 'string') {
    throw new TypeError('StrategyBase.activate: symbol must be a non-empty string');
  }
  this._symbols.add(symbol);
  this._symbol = symbol;          // 하위 호환
  this._category = category;
  this._active = true;
}

deactivateSymbol(symbol) {
  this._symbols.delete(symbol);
  if (this._symbols.size === 0) {
    this._active = false;
    this._symbol = null;
  } else {
    this._symbol = this._symbols.values().next().value;
  }
}

deactivate() {
  this._active = false;
  this._symbols.clear();
}

hasSymbol(symbol) {
  return this._symbols.has(symbol);
}

getSymbols() {
  return Array.from(this._symbols);
}
```

**2. `botService.js` ticker/kline 라우팅 변경**

```javascript
// 변경 전
if (strategy.isActive() && strategy._symbol === ticker.symbol) {

// 변경 후
if (strategy.isActive() && strategy.hasSymbol(ticker.symbol)) {
```

**3. 하위 전략 호환 — 현재 처리 심볼 설정**

```javascript
// strategyBase.js에 추가
getCurrentSymbol() {
  return this._currentProcessingSymbol || this._symbol;
}

_setCurrentProcessingSymbol(symbol) {
  this._currentProcessingSymbol = symbol;
}
```

`botService.js`에서:

```javascript
if (strategy.isActive() && strategy.hasSymbol(ticker.symbol)) {
  try {
    strategy._setCurrentProcessingSymbol(ticker.symbol);
    strategy.onTick(ticker);
    strategy._setCurrentProcessingSymbol(null);
  } catch (err) {
    strategy._setCurrentProcessingSymbol(null);
    log.error('Strategy onTick error', { strategy: strategy.name, error: err });
  }
}
```

**4. `strategyRouter.js` updateSymbols() 변경**

```javascript
for (const strategy of this.getActiveStrategies()) {
  for (const oldSymbol of strategy.getSymbols()) {
    if (!symbols.includes(oldSymbol)) {
      strategy.deactivateSymbol(oldSymbol);
    }
  }
  for (const symbol of symbols) {
    if (!strategy.hasSymbol(symbol)) {
      strategy.activate(symbol, this._category);
    }
  }
  strategy.setMarketRegime(this._currentRegime);
}
```

**5. emitSignal() 수정**

```javascript
emitSignal(signalData) {
  const signal = {
    strategy: this.name,
    timestamp: new Date().toISOString(),
    symbol: signalData.symbol || this._currentProcessingSymbol || this._symbol,
    ...signalData,
  };
  // ...
}
```

#### 에러 핸들링 고려사항
- `_currentProcessingSymbol`은 반드시 try-finally 패턴으로 null 리셋
- Set 기반이므로 중복 activate 호출은 안전 (Set.add는 멱등)

---

### T0-4: unhandledRejection / uncaughtException 핸들러 (핵심 영역)

#### 구체적 변경 내용 (AD-3 준수)

**파일**: `backend/src/app.js` -- bootstrap() 함수 내

```javascript
// 중복 shutdown 방지 플래그
let isShuttingDown = false;

const safeShutdown = async (signal) => {
  if (isShuttingDown) {
    log.warn('Shutdown already in progress — ignoring duplicate', { signal });
    return;
  }
  isShuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    log.error('Force exit — graceful shutdown timed out after 15s');
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  await gracefulShutdown(signal);
};

// --- unhandledRejection: 로그 + 계속 실행 ---
process.on('unhandledRejection', (reason, promise) => {
  log.error('UNHANDLED REJECTION — process continues', {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });

  try {
    riskEngine.emit(RISK_EVENTS.ORDER_REJECTED, {
      order: null,
      reason: `unhandled_rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      source: 'process',
      severity: 'warning',
      ts: Date.now(),
    });
  } catch (_) {}
});

// --- uncaughtException: graceful shutdown ---
process.on('uncaughtException', (err, origin) => {
  log.error('UNCAUGHT EXCEPTION — initiating graceful shutdown', {
    error: { message: err.message, stack: err.stack },
    origin,
  });

  safeShutdown('uncaughtException').catch(() => {
    process.exit(1);
  });
});

// --- 기존 SIGTERM/SIGINT도 safeShutdown으로 교체 ---
process.on('SIGTERM', () => safeShutdown('SIGTERM'));
process.on('SIGINT', () => safeShutdown('SIGINT'));
```

**핵심 설계 원칙**:
1. unhandledRejection은 프로세스를 죽이지 않는다
2. uncaughtException은 반드시 종료한다
3. 중복 shutdown 방지: isShuttingDown 플래그
4. 강제 종료 타이머: 15초 후 강제 종료

---

### T0-5: OrderManager per-symbol Mutex (핵심 영역)

#### 구체적 변경 내용

**파일**: `backend/src/services/orderManager.js`

```javascript
// 생성자에 추가
this._orderLocks = new Map();

/**
 * Symbol별 순차 실행을 보장하는 mutex 래퍼.
 */
async _withSymbolLock(symbol, fn) {
  const currentLock = this._orderLocks.get(symbol);

  let releaseLock;
  const newLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  this._orderLocks.set(symbol, newLock);

  if (currentLock) {
    try {
      await currentLock;
    } catch (_) {}
  }

  try {
    return await fn();
  } finally {
    releaseLock();
    if (this._orderLocks.get(symbol) === newLock) {
      this._orderLocks.delete(symbol);
    }
  }
}
```

**submitOrder() 변경**:

```javascript
async submitOrder(signal) {
  const { symbol } = signal;

  if (!symbol) {
    log.error('submitOrder — signal missing symbol');
    return null;
  }

  return this._withSymbolLock(symbol, () => this._submitOrderInternal(signal));
}

async _submitOrderInternal(signal) {
  // ... 기존 submitOrder()의 전체 로직 ..
}
```

#### 설계 결정
1. **per-symbol lock**: 서로 다른 심볼은 병렬 처리 가능
2. **Promise 체인 기반 직렬화**: 외부 라이브러리 없이 구현
3. **타임아웃 없음**: 거래소 API 호출은 이미 `_withRetry()`에서 타임아웃 적용

---

### T0-6: ExposureGuard equity=0 Division by Zero 방어 (핵심 영역)

#### 구체적 변경 내용

**파일**: `backend/src/services/exposureGuard.js`

```javascript
validateOrder(order, accountState) {
  const equity = accountState.equity;

  // Equity 유효성 검증 (Division by zero 방어)
  if (!equity || equity === '0' || math.isLessThanOrEqual(equity, '0')) {
    log.warn('Order rejected — equity is zero or negative', {
      symbol: order.symbol,
      equity,
    });
    return {
      approved: false,
      reason: 'insufficient_equity',
    };
  }

  // ... 기존 로직 계속
}
```

**RiskEngine 수준 방어 (추가 권장)**:

```javascript
// riskEngine.js validateOrder()에 추가 (defense-in-depth)
if (!this.accountState.equity || this.accountState.equity === '0') {
  const result = { approved: false, rejectReason: 'equity_not_initialized' };
  log.warn('Order REJECTED — equity not yet initialized', { symbol: order.symbol });
  this.emit(RISK_EVENTS.ORDER_REJECTED, {
    order,
    reason: 'equity_not_initialized',
    source: 'risk_engine',
  });
  return result;
}
```

---

## RiskEvent 모델 스키마 설계 (T0-8 지원)

### 스키마 설계

**파일**: `backend/src/models/RiskEvent.js` (신규)

```javascript
'use strict';

const mongoose = require('mongoose');

const riskEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        'circuit_break', 'circuit_reset',
        'drawdown_warning', 'drawdown_halt',
        'exposure_adjusted', 'order_rejected',
        'equity_insufficient', 'emergency_stop',
        'process_error',
      ],
      index: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'warning',
      index: true,
    },
    source: {
      type: String,
      enum: [
        'circuit_breaker', 'drawdown_monitor',
        'exposure_guard', 'risk_engine',
        'process', 'manual',
      ],
      required: true,
    },
    symbol: { type: String, index: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BotSession',
      index: true,
    },
    reason: { type: String, required: true },
    orderContext: { type: mongoose.Schema.Types.Mixed },
    riskSnapshot: {
      equity: String,
      drawdownPercent: String,
      dailyPnlPercent: String,
      consecutiveLosses: Number,
      totalExposurePercent: String,
      isCircuitBroken: Boolean,
      isDrawdownHalted: Boolean,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
);

// 복합 인덱스
riskEventSchema.index({ sessionId: 1, createdAt: -1 });

// TTL 인덱스: 30일 후 자동 삭제
riskEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// 정적 메서드
riskEventSchema.statics.getUnacknowledged = function(sessionId, limit = 20) {
  const query = { acknowledged: false };
  if (sessionId) query.sessionId = sessionId;
  return this.find(query).sort({ createdAt: -1 }).limit(limit).lean();
};

riskEventSchema.statics.getRecent = function(limit = 50, filters = {}) {
  const query = {};
  if (filters.sessionId) query.sessionId = filters.sessionId;
  if (filters.severity) query.severity = filters.severity;
  if (filters.eventType) query.eventType = filters.eventType;
  return this.find(query).sort({ createdAt: -1 }).limit(limit).lean();
};

const RiskEvent = mongoose.model('RiskEvent', riskEventSchema);
module.exports = RiskEvent;
```

### RiskEvent 생성 통합 지점

`riskEngine.js`에 `_recordRiskEvent()` 메서드 추가:

```javascript
async _recordRiskEvent(eventName, payload) {
  const eventTypeMap = {
    [RISK_EVENTS.CIRCUIT_BREAK]: { eventType: 'circuit_break', severity: 'critical', source: 'circuit_breaker' },
    [RISK_EVENTS.CIRCUIT_RESET]: { eventType: 'circuit_reset', severity: 'info', source: 'circuit_breaker' },
    [RISK_EVENTS.DRAWDOWN_WARNING]: { eventType: 'drawdown_warning', severity: 'warning', source: 'drawdown_monitor' },
    [RISK_EVENTS.DRAWDOWN_HALT]: { eventType: 'drawdown_halt', severity: 'critical', source: 'drawdown_monitor' },
    [RISK_EVENTS.EXPOSURE_ADJUSTED]: { eventType: 'exposure_adjusted', severity: 'warning', source: 'exposure_guard' },
    [RISK_EVENTS.ORDER_REJECTED]: { eventType: 'order_rejected', severity: 'warning', source: 'risk_engine' },
  };

  const mapping = eventTypeMap[eventName];
  if (!mapping) return;

  await RiskEvent.create({
    eventType: mapping.eventType,
    severity: mapping.severity,
    source: mapping.source,
    symbol: payload.order?.symbol || payload.symbol || null,
    reason: payload.reason || eventName,
    orderContext: payload.order || null,
    riskSnapshot: {
      equity: this.accountState.equity,
      consecutiveLosses: this.circuitBreaker.consecutiveLosses,
      isCircuitBroken: this.circuitBreaker.isTripped,
      isDrawdownHalted: this.drawdownMonitor.isHalted,
    },
    metadata: payload,
  });
}
```

### API 엔드포인트

```
GET /api/risk/events?limit=50&severity=critical&sessionId=xxx
PUT /api/risk/events/:id/acknowledge
GET /api/risk/events/unacknowledged
```

---

## 구현 순서 추천

```
Phase 1 (독립, 병렬 가능):
  T0-6 — ExposureGuard equity=0 방어         [1시간] [독립]
  T0-4 — Crash handler                        [2시간] [독립]
  RiskEvent 모델 생성                         [1시간] [독립]

Phase 2 (T0-6 완료 후):
  T0-1 — 기본 전략 이름 수정                  [30분]
  T0-3 — Multi-symbol Set 기반               [1일]

Phase 3 (T0-3 완료 후):
  T0-2 — Position sizing 변환                [1일]
  T0-5 — OrderManager mutex                  [3시간]

Phase 4 (RiskEvent 모델 완료 후):
  RiskEngine → RiskEvent 기록 통합            [2시간]
  Risk API 라우트 생성                        [1시간]
```

총 예상 시간: **약 3.5일**

---

## 다른 에이전트에게 요청 사항

### Trader Agent에게

1. **T0-1**: 기본 5개 전략 선정 검증 요청
2. **T0-2**: 전략별 `positionSizing` 메타데이터 추가 필요 여부 확인
3. **T0-2**: 거래소 lot precision 반올림 규칙(floor vs round) 확인
4. **T0-3**: 하위 전략 18개에서 `this._symbol` 직접 참조 부분 마이그레이션

### UI Agent에게

1. **T0-8**: RiskEvent REST API 스키마 확정 후 프론트엔드 조회 방식 결정
2. **T0-8**: RiskEvent `severity` 기반 UI 표시 규칙 (critical=빨간, warning=노란, info=로그)
3. **T0-8**: `acknowledged` 상태 관리 UX
4. **T0-9**: `BotStatus` 응답의 `tradingMode: 'paper' | 'live'` 필드 활용
5. **T0-7**: ConfirmDialog UX (로딩 상태, 타임아웃)

---

## 부록: 변경 파일 목록

| 파일 | 변경 유형 | 관련 항목 |
|------|----------|----------|
| `backend/src/services/exposureGuard.js` | 수정 | T0-6 |
| `backend/src/services/riskEngine.js` | 수정 | T0-6, RiskEvent |
| `backend/src/app.js` | 수정 | T0-4 |
| `backend/src/services/botService.js` | 수정 | T0-1, T0-2, T0-3 |
| `backend/src/services/strategyBase.js` | 수정 | T0-3 |
| `backend/src/services/strategyRouter.js` | 수정 | T0-3 |
| `backend/src/services/orderManager.js` | 수정 | T0-5 |
| `backend/src/models/RiskEvent.js` | **신규** | T0-8 |

---

*본 문서는 Round 1에서 합의된 Tier 0 항목에 대한 시스템 엔지니어의 구체적 구현 가이드이다. 모든 제안은 실제 소스 코드 분석에 기반하며, AD-1~AD-4 아키텍처 결정을 준수한다.*
