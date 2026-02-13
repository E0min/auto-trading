# Round 2 Review -- Senior Systems Engineer

> 작성자: Senior Systems Engineer Agent
> 날짜: 2026-02-14
> 리뷰 대상: Trader Round 2 제안서 (T0-1 ~ T0-6, T0-7~T0-9 백엔드 요구사항) + UI Round 2 제안서 (T0-7, T0-8, T0-9)
> 검증 방법: 소스코드 직접 대조 + 런타임 동작 시뮬레이션 + 장애 시나리오 분석

---

## Trader 제안서 리뷰

### T0-1: 기본 전략 이름 수정

**판정: ✅ 동의**

코드 확인 결과 `botService.js:896`에서 `['MomentumStrategy', 'MeanReversionStrategy']`가 기본값인 것이 맞고, 이를 실전 검증된 5개 전략으로 교체하는 것은 올바른 접근이다. `sampleStrategies.js`를 삭제하지 않고 유지하는 결정도 backward compat 측면에서 적절하다.

선정된 5개 전략(RsiPivot, MaTrend, Bollinger, Supertrend, Turtle)이 5개 레짐을 커버하며 상관관계가 낮다는 Quant 분석에 동의한다. 시스템 관점에서 이 변경은 단순 상수 교체이므로 부작용 위험이 극히 낮다.

---

### T0-2: Position Sizing -- percentage -> quantity 변환 파이프라인

**판정: ⚠️ 조건부 동의 (5건 보완 필요)**

전체 설계 방향은 정확하다. `suggestedQty`에 퍼센트 값이 그대로 수량으로 전달되는 문제가 실제로 확인되었고, `botService.js`에서 변환하는 위치 선택(AD-2)에도 동의한다. 그러나 구현 세부사항에 보완이 필요하다.

#### 보완 1: `parseFloat` + `Math.floor` 혼합 사용 금지

제안 코드에서:
```js
const qtyFloat = parseFloat(qty);
qty = math.toFixed(String(Math.floor(qtyFloat * 10000) / 10000), 4);
```

이것은 프로젝트의 **"모든 금전적 값은 String 타입"** 원칙을 위반한다. `parseFloat` 변환 과정에서 부동소수점 오류가 유입된다. 예를 들어 `parseFloat('0.00015')` -> `0.00014999999...` -> `Math.floor(1.4999...)` = `1` -> `0.0001`로 기대치보다 줄어든다.

**대안**: `mathUtils`에 `floorToStep(value, step)` 함수를 추가하여 문자열 연산으로 처리한다:
```js
function floorToStep(value, step) {
  const v = parse(value);
  const s = parse(step);
  if (s === 0) return value;
  return (Math.floor(v / s) * s).toFixed(DEFAULT_PRECISION);
}
```

혹은 최소한 4자리 고정이 아니라 심볼별 `sizeMultiplier` (거래소 lot step)를 사용해야 한다. BTC는 0.001 단위, DOGE는 1 단위 등 심볼마다 다르다.

#### 보완 2: `math.isZero()` 함수 존재 여부

제안 코드에서 `math.isZero(equity)`를 호출하지만, 현재 `mathUtils.js`의 export를 확인하면 `isZero` 함수가 export 목록에 없을 가능성이 있다. 구현 전에 `isZero`가 존재하는지 확인하고, 없으면 추가해야 한다:
```js
function isZero(val) {
  return parse(val) === 0;
}
```

#### 보완 3: paperPositionManager.getEquity() 반환값 검증

```js
if (this.paperMode && this.paperPositionManager) {
  equity = this.paperPositionManager.getEquity();
}
```

`paperPositionManager.getEquity()`가 String을 반환하는지 확인 필요. Number를 반환하면 이후 `math.divide()` 호출 시 정밀도 문제가 발생할 수 있다.

#### 보완 4: 두 곳의 signal handler 동기화

`start()` 내 signal handler(line 305-336)와 `enableStrategy()` 내 signal handler(line 814-835)가 동일한 변환 로직을 중복 적용해야 하는데, 이를 공통 메서드(`_handleStrategySignal`)로 추출하는 것이 유지보수에 더 안전하다. 한쪽만 수정하고 다른 쪽을 놓치는 실수가 발생하기 쉬운 구조이다.

#### 보완 5: CLOSE 시그널에 대한 qty 변환 스킵

`_resolveQuantity()`는 OPEN 시그널에만 적용해야 한다. CLOSE_LONG/CLOSE_SHORT 시그널에서 `suggestedQty`는 "보유 포지션 중 몇 %를 청산할 것인가"를 의미할 수 있다. 현재 제안은 모든 시그널에 동일한 equity-based 변환을 적용하는데, 청산 시에는 보유 수량 기반으로 계산해야 한다. 시그널의 `action` 필드를 확인하여 분기 처리가 필요하다.

---

### T0-3: Multi-symbol Routing -- Set 기반 심볼 관리

**판정: ⚠️ 조건부 동의 (3건 보완 필요)**

Set 기반 전환 설계는 AD-1 결정대로이며, `strategyBase.js`의 `_symbol` 스칼라를 `_symbols: Set`으로 교체하는 방향에 동의한다. 소스코드 확인 결과 `strategyRouter.js:141-143`의 for-loop 덮어쓰기 문제가 실재한다.

#### 보완 1: `_symbol` 임시 설정 시 `getSymbolRegime()` 정합성

`strategyBase.js:188-189`에서:
```js
if (this._symbol && this._symbolRegimes.has(this._symbol)) {
  return this._symbolRegimes.get(this._symbol);
}
```

`_symbol`을 현재 처리 중인 심볼로 임시 설정하는 패턴은 thread-safety 측면에서 Node.js 싱글 스레드이므로 안전하다 (Trader가 확인 요청한 부분). `onTick()`/`onKline()` 내에 `async` 작업이 없음을 확인했다 (`grep "async\s+(onTick|onKline)"` 결과 0건). 그러나 향후 어떤 전략이 `await`를 도입하면 즉시 race condition이 발생한다.

**권장**: `_symbol` 임시 설정 대신, `onTick(ticker)` / `onKline(kline)` 호출 시 ticker/kline 객체에 이미 `symbol` 필드가 포함되어 있으므로, 전략 내부에서 `this._symbol` 대신 `ticker.symbol` / `kline.symbol`을 사용하도록 strategyBase 문서화하고, `getSymbolRegime(symbol)` 파라미터를 명시적으로 받는 오버로드를 추가하는 것이 더 안전하다:

```js
getSymbolRegime(symbol = null) {
  const target = symbol || this._symbol;
  if (target && this._symbolRegimes.has(target)) {
    return this._symbolRegimes.get(target);
  }
  return this._currentRegime;
}
```

#### 보완 2: priceHistory/indicatorState 심볼 간 오염

Trader가 Phase 1 주의사항으로 언급한 "priceHistory 혼재 문제"에 대해 구체적으로:
- 전략이 내부에 `this.prices = []` 같은 배열을 가지고 있다면, 심볼 A의 가격과 심볼 B의 가격이 동일 배열에 쌓인다.
- 이것은 RSI, MA 등 모든 지표 계산을 오염시킨다.

단순히 심볼 수를 3개 이하로 제한하는 것으로는 문제가 해결되지 않는다 (3개여도 혼재됨). 구조적 해결이 필요하다:

**필수**: 각 전략의 내부 상태(priceHistory, indicators)를 심볼별로 분리하는 `Map<symbol, state>` 패턴을 strategyBase에 헬퍼로 제공해야 한다. 또는 Trader가 "심볼 수 3개 이하 제한" 대신 **Phase 1에서는 전략당 1개 심볼만 허용**하고, Phase 2에서 상태 분리를 구현하는 것이 안전하다.

#### 보완 3: `deactivateSymbol()` 후 `_symbol` 설정

```js
deactivateSymbol(symbol) {
  this._symbols.delete(symbol);
  if (this._symbols.size === 0) {
    this._active = false;
    this._symbol = null;
  } else {
    this._symbol = this._symbols.values().next().value;
  }
}
```

`this._symbols.values().next().value`는 Set의 삽입 순서에 의존한다. 이것 자체는 문제가 아니지만, `_symbol`이 "대표 심볼"로 사용되는 곳이 있는지 확인 필요. 현재 `_symbol`은 라우팅(이제 `hasSymbol`로 교체)과 `getSymbolRegime()`에서만 사용되므로 괜찮다. 다만 로그 출력 목적으로 `_symbol`이 참조되는 곳이 있을 수 있으므로 `deactivateSymbol()` 후 로그에서 혼란이 없도록 문서화해야 한다.

---

### T0-4: unhandledRejection / uncaughtException 핸들러

**판정: ⚠️ 조건부 동의 (2건 보완 필요)**

전체 설계에 동의한다. AD-3 결정대로 `unhandledRejection`은 프로세스 유지, `uncaughtException`은 graceful shutdown이 맞다.

#### 보완 1: `io` 참조 가용성

제안 코드에서 `io.emit('risk:unhandled_error', ...)` 를 호출하는데, `uncaughtException` 핸들러는 `bootstrap()` 내부의 `gracefulShutdown` 정의 직후에 등록된다. 이 시점에서 `io`가 이미 초기화되어 있으므로 참조는 유효하다. 다만 **graceful shutdown 과정에서 `io.close()`가 먼저 호출**되면 이후 `io.emit()`이 실패할 수 있다.

**권장**: `uncaughtException` 핸들러에서 `io.emit()`을 `try-catch`로 감싸는 것은 이미 되어 있으므로 OK. 그러나 `unhandledRejection` 핸들러에서도 동일하게 `try-catch`로 감싸야 한다:

```js
process.on('unhandledRejection', (reason, promise) => {
  log.error('UNHANDLED REJECTION -- process will continue', { ... });
  try {
    io.emit('risk:unhandled_error', { ... });
  } catch (_) {}
});
```

#### 보완 2: `risk:unhandled_error` 이벤트를 constants.js에 등록

현재 `RISK_EVENTS`에 `risk:unhandled_error`가 정의되어 있지 않다. 새 이벤트 유형을 추가할 때는 반드시 `constants.js`의 `RISK_EVENTS` 객체에 등록하고 프론트엔드의 `SOCKET_EVENTS`와 동기화해야 한다. 하드코딩된 문자열은 유지보수 부채가 된다.

---

### T0-5: orderManager.submitOrder() per-symbol mutex

**판정: ⚠️ 조건부 동의 (3건 보완 필요)**

per-symbol 직렬화의 필요성에 동의한다. 같은 심볼에 두 시그널이 거의 동시에 발생하면 riskEngine이 첫 번째 주문의 포지션 변화를 반영하기 전에 두 번째 주문을 승인할 수 있다.

#### 보완 1: 무한 대기 방지 (Trader가 요청한 메모리 누수 검증)

제안된 구현:
```js
while (this._symbolLocks.has(symbol)) {
  try {
    await this._symbolLocks.get(symbol);
  } catch (_) {}
}
```

`_submitOrderInternal()`이 예외를 throw하더라도 `finally` 블록에서 `_symbolLocks.delete(symbol)` + `releaseLock()`이 호출되므로 메모리 누수는 없다. 그러나 **`_submitOrderInternal()`이 hang하면** (예: 거래소 API 타임아웃이 매우 길 경우) 다음 시그널이 무한 대기한다.

**필수**: 타임아웃 가드를 추가해야 한다:
```js
const LOCK_TIMEOUT_MS = 30000; // 30초

async submitOrder(signal) {
  const { symbol } = signal;

  if (this._symbolLocks.has(symbol)) {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (this._symbolLocks.has(symbol)) {
      if (Date.now() > deadline) {
        log.error('submitOrder — lock timeout, skipping order', { symbol });
        return null;
      }
      try {
        await Promise.race([
          this._symbolLocks.get(symbol),
          new Promise(resolve => setTimeout(resolve, LOCK_TIMEOUT_MS)),
        ]);
      } catch (_) {}
    }
  }
  // ... lock acquire + submit
}
```

#### 보완 2: `while` 루프의 ABA 문제

```js
while (this._symbolLocks.has(symbol)) {
  await this._symbolLocks.get(symbol);
}
// 여기서 다른 마이크로태스크가 먼저 lock을 잡을 수 있음
this._symbolLocks.set(symbol, lockPromise);
```

`await` 이후 이벤트 루프로 제어가 돌아가면, 동일한 `while` 루프를 빠져나온 다른 대기자가 먼저 lock을 잡을 수 있다. 실질적으로 Node.js의 마이크로태스크 큐 순서상 이 확률은 매우 낮지만, 이론적으로 2개 주문이 동시에 lock을 잡을 수 있다.

**대안**: `async-mutex` npm 패키지 사용을 권장한다. 외부 의존성을 피하려면, Promise 체이닝 방식의 mutex가 더 안전하다:
```js
async submitOrder(signal) {
  const { symbol } = signal;
  const prev = this._symbolLocks.get(symbol) || Promise.resolve();
  let releaseLock;
  const current = new Promise(resolve => { releaseLock = resolve; });
  this._symbolLocks.set(symbol, current);

  try {
    await prev; // 이전 주문 완료 대기
    return await this._submitOrderInternal(signal);
  } finally {
    releaseLock();
    if (this._symbolLocks.get(symbol) === current) {
      this._symbolLocks.delete(symbol);
    }
  }
}
```

이 패턴은 체이닝 기반이므로 ABA 문제가 발생하지 않고, 순서가 보장된다.

#### 보완 3: 기존 `submitOrder()` -> `_submitOrderInternal()` 리네이밍

현재 `submitOrder()`는 `async` 함수이고, 내부에서 `riskEngine.validateOrder()`, `exchangeClient` API 호출, `Trade.create()` 등을 수행한다. 이 로직 전체를 `_submitOrderInternal()`로 옮기는 것은 동의하나, 리네이밍 시 `this._handleWsOrderUpdate` 등에서 `submitOrder`를 참조하는 곳이 있는지 확인해야 한다. 현재 코드에서는 WS 핸들러가 `submitOrder`를 직접 호출하지 않으므로 안전하다.

---

### T0-6: ExposureGuard equity=0 division by zero 방어

**판정: ✅ 동의 (1건 개선 권장)**

코드 확인 결과 `exposureGuard.js:109`에서 `divide(orderValue, equity)`가 equity=0일 때 throw하는 것이 맞다. 제안된 early return guard는 정확하고 간결하다.

#### 개선 권장: drawdownMonitor.updateEquity()의 equity=0 처리

Trader가 "drawdownMonitor의 `updateEquity()` 시작에 equity=0 스킵 추가"를 제안했는데, `drawdownMonitor.js:76-81`을 보면 `pctChange()`가 `peakEquity=0`일 때 throw하는 것을 이미 `try-catch`로 잡고 `return`하고 있다. 따라서 drawdownMonitor는 이미 equity=0에 대해 방어되어 있다. 추가 guard는 방어적 프로그래밍으로 나쁘지 않지만 필수는 아니다.

다만, **riskEngine 레벨**에서 equity=0일 때 `validateOrder()`를 호출하기 전에 조기 차단하는 것이 더 적절하다. ExposureGuard 진입 전에 riskEngine에서 먼저 거부하면 CircuitBreaker, DrawdownMonitor를 불필요하게 통과하지 않아도 된다:

```js
// riskEngine.validateOrder() 최상단
if (!this.accountState.equity || this.accountState.equity === '0') {
  return { approved: false, reason: 'equity_not_initialized' };
}
```

---

### T0-7/T0-8/T0-9 백엔드 요구사항 (Trader 제안서의 프론트엔드 연동 섹션)

#### T0-8 RiskEvent MongoDB 모델 (AD-4)

**판정: ✅ 동의**

인덱스 설계에 대해:
- `{ type: 1, resolved: 1, createdAt: -1 }` 복합 인덱스: 적절함. resolved=false인 이벤트를 최근순으로 조회하는 패턴에 최적.
- TTL 인덱스 30일: 적절함. `createdAt` 필드에 `expireAfterSeconds: 2592000` 설정.
- 추가 권장: `{ sessionId: 1, createdAt: -1 }` 인덱스도 필요. 세션별 리스크 이벤트 조회가 analytics에서 사용될 것.

#### T0-8 REST API 엔드포인트

`GET /api/risk/events` — 동의. 쿼리 파라미터로 `?resolved=false&limit=50&type=circuit_break` 지원 필요.
`POST /api/risk/events/:id/resolve` — 동의. resolve 시 `resolvedAt`, `resolvedBy` 필드 기록.
`GET /api/risk/status` — 동의. riskEngine의 현재 상태(CB/DD/EG 각각의 상태) 집계 반환.

---

### 구현 순서에 대한 의견

Trader가 제안한 Day 1/2/3 순서는 대체로 합리적이다. 하나 조정 권장:

- **T0-6을 T0-2보다 반드시 먼저 완료**: T0-2의 `_resolveQuantity()`가 equity=0 체크를 포함하지만, ExposureGuard의 division-by-zero 방어가 없으면 `_resolveQuantity()`를 우회하는 경로(예: 직접 `submitOrder` 호출)에서 여전히 크래시 가능. Trader의 Day 1 배치에서 이미 T0-6이 먼저이므로 OK.

- **T0-3과 T0-2의 순서**: T0-3(multi-symbol)이 T0-2(position sizing)보다 먼저인 것에 동의. multi-symbol 라우팅이 수정되지 않으면 position sizing 테스트가 단일 심볼에서만 검증되어 불완전하다.

---

## UI 제안서 리뷰

### T0-7: Emergency Stop ConfirmDialog

**판정: ✅ 동의**

소스코드 확인 결과:
- `BotControlPanel.tsx:89-97`에서 `handleAction('emergency', onEmergencyStop)`이 확인 없이 직접 호출되는 것이 맞다.
- 기존 `ConfirmDialog` 컴포넌트(`components/ui/ConfirmDialog.tsx`)가 이미 `variant="danger"` 지원, ESC 키 핸들링을 포함하고 있어 즉시 재사용 가능하다.

ConfirmDialog 메시지의 정확성도 검증했다: `botService.emergencyStop()`은 (1) riskEngine halt, (2) 미체결 주문 취소, (3) 봇 정지를 수행하지만 열린 포지션의 시장가 청산은 포함하지 않는다. UI 제안서의 메시지("열린 포지션은 유지되지만, 리스크 관리가 중단됩니다")가 사실에 부합한다.

접근성 관점에서 "긴급 정지 실행" 버튼에 `autoFocus`를 추가하지 않는 결정도 올바르다.

---

### T0-8: Risk 이벤트 실시간 UI 표시 + RiskAlertBanner

**판정: ⚠️ 조건부 동의 (3건 보완 필요)**

전체 설계에 동의한다. `useSocket.ts:84-103`에서 이미 `riskEvents`를 수집하고 있으나 렌더링되지 않는 문제가 실재하며, `RiskAlertBanner` 신규 컴포넌트로 해결하는 접근이 적절하다.

#### 보완 1: 메모리 관리 -- riskEvents 무한 축적 방지

`useSocket.ts`에서 `.slice(0, 20)`으로 20건 제한은 되어 있다. 그러나 `RiskAlertBanner`에서 `onDismiss`로 개별 이벤트를 닫아도 새 이벤트가 계속 쌓이면 사용자가 인지하지 못하는 이벤트가 발생할 수 있다.

**권장**: dismissed 이벤트와 active 이벤트를 분리 관리하거나, dismiss된 이벤트의 timestamp를 기록하여 동일 이벤트가 재표시되지 않도록 해야 한다.

#### 보완 2: `drawdown_warning` 30초 자동 닫기 구현

제안서에서 `drawdown_warning`은 30초 자동 닫기라고 했으나, 실제 코드에서 자동 닫기 로직이 구현되어 있지 않다. `RiskAlertBanner` 컴포넌트 내부에 `useEffect` + `setTimeout`으로 자동 dismiss를 구현해야 한다:

```tsx
useEffect(() => {
  const timers: NodeJS.Timeout[] = [];
  riskEvents.forEach((event, idx) => {
    if (classifyRiskEvent(event) === 'drawdown_warning') {
      timers.push(setTimeout(() => onDismiss(idx), 30000));
    }
  });
  return () => timers.forEach(clearTimeout);
}, [riskEvents]);
```

단, 이 패턴은 `riskEvents` 배열이 변경될 때마다 타이머가 재설정되므로, 이벤트별 고유 ID(`timestamp` 기반)로 관리하는 것이 더 정확하다.

#### 보완 3: `CIRCUIT_RESET` 이벤트 처리 누락

`useSocket.ts`에서 `CIRCUIT_BREAK`, `DRAWDOWN_WARNING`, `DRAWDOWN_HALT`는 수신하지만, `CIRCUIT_RESET`은 수신하지 않는다. 서킷 브레이커가 리셋되면 기존 `circuit_break` 배너를 자동으로 닫거나 "리셋됨" 상태로 전환해야 한다.

**권장**: `useSocket.ts`에 `CIRCUIT_RESET` 리스너를 추가하고, `circuit_break` 이벤트를 자동 dismiss하거나 상태를 `resolved`로 변경하는 로직을 추가한다.

---

### T0-9: 실거래/가상거래 모드 시각적 경고 강화

**판정: ✅ 동의**

3단계 시각적 신호(상단 스트라이프 + 헤더 뱃지 + 기존 토글) 설계에 동의한다. 실거래 모드의 시각적 강도를 가상거래보다 3배 이상 강하게 설정한 것이 적절하다.

`role="status"` + `aria-label` 접근성 처리, 색상 외 텍스트 기반 모드 명시 등 UX 세부사항이 잘 설계되었다.

`animate-ping` dot은 성능 영향이 미미하지만 (CSS animation, GPU 가속), 장시간 대시보드를 열어두는 트레이딩 특성상 확인 차원에서 `will-change: transform` 이 Tailwind의 `animate-ping`에 이미 포함되어 있으므로 OK.

**한 가지 추가 권장**: `TradingModeBanner`의 `mode` prop 결정 로직:
```tsx
mode={botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live')}
```
`botStatus.tradingMode`이 undefined이고 `botStatus.paperMode`도 undefined이면 기본값이 `'live'`가 된다. 봇 상태가 아직 로드되지 않은 초기 상태에서 잘못된 "LIVE TRADING" 배너가 표시될 수 있다.

**권장**: 로딩 중에는 배너를 숨기거나, 명시적인 기본값을 `'paper'`로 설정하여 안전 방향으로 fallback:
```tsx
mode={botStatus.tradingMode ?? (botStatus.paperMode !== false ? 'paper' : 'live')}
```

---

### 타입 변경 사항

**판정: ✅ 동의**

- `StrategyInfo.symbols: string[]` 추가: T0-3과 동기화. `symbol: string`도 유지하여 backward compat -- 적절.
- `Signal.positionSizePercent`, `Signal.resolvedQty` 추가: T0-2와 동기화 -- 적절.
- `RiskEvent` 확장: 모든 필드가 optional이므로 기존 코드 영향 없음 -- 적절.

---

## 교차 검증 결과 요약

### Trader가 Engineer에게 요청한 5건

| # | 요청 | 검증 결과 |
|---|------|----------|
| 1 | T0-3 `_symbol` 임시 설정 thread-safety | Node.js 싱글 스레드 + 전략 onTick/onKline에 async 없음 확인. **현재 안전하지만, 파라미터 명시 방식으로 전환 권장** |
| 2 | T0-5 mutex 메모리 누수 방지 | `finally` 블록에서 해제 확인. **누수 없으나 hang 시 무한 대기 -- 타임아웃 필수** |
| 3 | T0-4 graceful shutdown 주문 취소 순서 | `gracefulShutdown()`에서 `botService.stop()` 호출 -> `botService.stop()`이 미체결 주문 취소 포함. **순서 OK** |
| 4 | RiskEvent 인덱스 설계 | 복합 인덱스 + TTL 30일 **적절**. sessionId 인덱스 추가 권장 |
| 5 | 거래소 계약 정보 캐싱 | Phase 2 과제로 분류. `exchangeClient.getInstruments()` 캐싱 구현 시 TTL 24시간 + warm-up on bootstrap 패턴 권장 |

### UI가 Engineer에게 요청한 6건

| # | 요청 | 응답 |
|---|------|------|
| 1 | 리스크 이벤트 페이로드에 `timestamp` 추가 | `new Date().toISOString()` 이미 대부분 포함. CircuitBreaker의 `CIRCUIT_BREAK` 이벤트에서는 누락 가능. **구현 시 모든 RISK_EVENTS emit에 timestamp 필드 강제** |
| 2 | RiskEvent REST API | T0-8 백엔드 작업에 포함. 위 리뷰 참조 |
| 3 | `eventType` 필드 추가 | 프론트엔드에서 이벤트 분류에 유용. **권장**: emit 시 `{ eventType: 'circuit_break', ...payload }` 형태로 통일 |
| 4 | emergencyStop 동작 명세 | 위에서 확인: 미체결 주문 취소 O, 열린 포지션 시장가 청산 X. UI 제안서 메시지 정확 |
| 5 | T0-1 전략 이름 확정 후 프론트 동기화 | Trader 제안의 5개 전략명 확정 후 `translateStrategyName()` 업데이트 필요. **T0-1 구현 PR에 프론트 변경 포함 권장** |
| 6 | T0-3 완료 후 StrategyInfo 응답에 `symbols[]` 포함 | **동의**. botService의 전략 상태 API에서 `strategy.getSymbols()` 호출하여 응답에 포함 |

---

## 종합 판정

| 항목 | 판정 | 핵심 보완 사항 |
|------|------|---------------|
| T0-1 (기본 전략) | ✅ | -- |
| T0-2 (Position Sizing) | ⚠️ | parseFloat 금지, isZero 확인, CLOSE 시그널 분기, signal handler 공통화 |
| T0-3 (Multi-symbol) | ⚠️ | priceHistory 심볼 간 오염 해결 (Phase 1은 전략당 1심볼 권장), getSymbolRegime 파라미터화 |
| T0-4 (Crash handler) | ⚠️ | unhandledRejection에도 try-catch, 이벤트명 constants.js 등록 |
| T0-5 (Mutex) | ⚠️ | 타임아웃 추가 필수, Promise 체이닝 방식으로 ABA 방지 |
| T0-6 (Equity guard) | ✅ | riskEngine 레벨 조기 차단 권장 (필수 아님) |
| T0-7 (Emergency dialog) | ✅ | -- |
| T0-8 (Risk banner) | ⚠️ | 자동 닫기 구현 누락, CIRCUIT_RESET 처리 추가, dismissed 이벤트 관리 |
| T0-9 (Mode banner) | ✅ | 로딩 중 기본값을 paper로 (안전 방향 fallback) |

**전체적으로 두 제안서 모두 소스코드를 정확히 분석**하고 있으며, 설계 방향이 Round 1 합의(AD-1~AD-6)와 일관된다. 위 보완 사항들을 반영하면 안전하게 구현을 진행할 수 있다.

---

*이 리뷰는 Senior Systems Engineer Agent가 두 제안서와 소스코드를 직접 대조하여 안정성/보안/성능 관점에서 작성하였다.*
