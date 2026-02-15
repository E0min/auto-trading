# Round 4 Cross-Review: Tier 2 Quality (12건)

**Reviewer**: Senior Systems Engineer (E)
**Date**: 2026-02-15
**Phase**: 2 (Cross-Review)
**Reviewed**: Trader 제안서 (`agents/trader/proposals/round_4.md`), UI/UX 제안서 (`agents/ui/proposals/round_4.md`)

---

## Trader 제안서 리뷰

### T2-1: RSI Wilder Smoothing 구현 — ✅ 동의 (조건 1개)

Trader의 분석이 정확하다. 현재 `indicators.js:130-155`의 RSI는 Cutler's RSI(SMA 기반)이며, 마지막 `period+1`개 가격만 사용한다. Wilder smoothing으로의 전환은 업계 표준에 부합하며, `smoothing` 파라미터를 통한 하위 호환도 적절하다.

**특별 검토 요청 응답 — 전체 가격 이력 순회 성능**:

Wilder smoothing은 첫 `period`개로 SMA 시드를 만든 후 전체 나머지 이력을 순회해야 한다. 현재 `indicatorCache.js:244-245`를 보면:

```javascript
case 'rsi':
  return rsi(closes, params.period || 14);
```

`closes`는 IndicatorCache의 `store.closes` — kline이 들어올 때마다 추가되는 배열이다. 하루 1분봉 기준으로 1,440개, 5분봉 기준 288개이다.

- **1,440개 String 산술 연산**: 각 순회에서 `subtract`, `add`, `multiply`, `divide`를 호출한다. 이 함수들은 내부적으로 `parseFloat` 또는 `Decimal` 연산을 수행한다.
- **최악 케이스 추정**: 1,440 x 4회 mathUtils 호출 = ~5,760회. 단일 호출은 ~1us이므로 총 ~6ms.
- **결론**: **성능 문제 없음**. 6ms는 tick 처리 주기(100ms~1s) 대비 무시할 수 있는 수준이다. 다만, closes 배열이 무제한 성장하지 않도록 IndicatorCache에 trim 로직이 있는지 확인 필요 (있다면 문제 없음).

**조건**: IndicatorCache의 closes 배열 최대 길이가 합리적 수준(예: 500개 이하)으로 관리되고 있는지 확인한 후 진행. 만약 무제한 성장이면, closes 배열 trim을 T2-1과 함께 구현해야 한다.

---

### T2-2: Confidence-based Signal Filtering — ⚠️ 조건부 동의

필터링 자체는 적절하다. 그러나 Trader의 코드 제안에서 `parseFloat(confidence)` 사용에 대한 안전성 문제가 있다.

**특별 검토 요청 응답 — `parseFloat(confidence)` vs String math 정책 충돌**:

코드베이스 전체에서 confidence 값의 타입을 확인한 결과:

```javascript
// 모든 전략이 confidence를 String으로 emit:
confidence: toFixed(String(conf), 4)  // → '0.5500'
confidence: '0.7000'                   // 고정값도 String
confidence: toFixed(String(Math.min(confidence, 0.95)), 4)  // → '0.9500'
```

즉, **confidence는 현재 String 타입이다** — `'0.5500'`, `'0.7000'` 형태.

Trader의 제안 코드:
```javascript
const confidenceNum = parseFloat(confidence);
if (isNaN(confidenceNum) || confidenceNum < minConfidence) { ... }
```

이것은 **String math 정책과 충돌한다**. CLAUDE.md는 "모든 금전적 값은 String 타입으로 처리"라고 명시하고 있다. confidence는 엄밀히 "금전적 값"은 아니지만, 시스템 전체에서 이미 String으로 관리되고 있으며, 일관성을 위해 mathUtils를 사용해야 한다.

**권장 수정**:
```javascript
const { isLessThan } = require('../utils/mathUtils');

_checkConfidence(strategy, confidence) {
  const meta = this._strategyMeta.get(strategy);
  const minConfidence = meta ? meta.minConfidence : '0.50';  // String

  // confidence가 null/undefined이면 통과 (하위 호환)
  if (confidence === undefined || confidence === null) {
    return { passed: true, reason: null };
  }

  const confStr = String(confidence);  // 혹시 Number로 올 경우 방어
  if (isLessThan(confStr, minConfidence)) {
    return {
      passed: false,
      reason: `low_confidence: ${strategy} confidence ${confStr} < threshold ${minConfidence}`,
    };
  }
  return { passed: true, reason: null };
}
```

**조건**: `minConfidence` 값도 String으로 저장하고, 비교는 `mathUtils.isLessThan()`을 사용할 것. `parseFloat` 비교가 아닌 String 비교로 일관성 유지.

---

### T2-3: Backtest Position Size 전략 메타 기반 — ✅ 동의

분석과 해결 방안이 모두 적절하다. 95% all-in 백테스트는 실제와 완전히 괴리되므로 반드시 수정해야 한다.

Engineer 제안서의 `_getPositionSizePercent()` 구현과 Trader 제안서의 `_getPositionSizePct()` 구현이 실질적으로 동일하다. riskLevel 기반 fallback 값만 약간 다르다:

| riskLevel | Trader 제안 | Engineer 제안 |
|-----------|-------------|---------------|
| low       | '10'        | '10'          |
| medium    | '15'        | '15'          |
| high      | '8'         | '25'          |

**의견**: Trader의 '8' (고위험이지만 작은 포지션으로 손실 제한)이 Engineer의 '25'보다 리스크 관리 관점에서 더 안전하다. **Trader의 값을 채택한다**.

---

### T2-4: FundingRateStrategy 데이터 소스 구축 — ⚠️ 조건부 동의

**특별 검토 요청 응답 — 별도 `fundingDataService.js` vs botService 내부 통합**:

Trader가 별도 서비스(`fundingDataService.js`)를 제안한 반면, Engineer는 `botService` 내부에 `_startFundingPoll()` 메서드로 통합을 제안했다.

**시스템 아키텍처 관점 평가**:

| 기준 | 별도 서비스 | botService 내부 |
|------|-------------|-----------------|
| **단일 책임 원칙** | O (polling이 별도 관심사) | X (botService가 이미 거대) |
| **DI 일관성** | O (coinSelector와 동일 레벨) | X (botService 내부 메서드) |
| **lifecycle 관리** | O (독립적 start/stop) | X (botService shutdown에 의존) |
| **테스트 용이성** | O (독립 unit test 가능) | X (botService mock 필요) |
| **복잡도** | X (새 파일 + DI 등록 + 이벤트 배선) | O (기존 파일 수정만) |
| **rate limit 관리** | O (서비스 레벨에서 제어) | X (botService가 rate limit 인식 불가) |

**결론: 별도 `fundingDataService.js`를 채택한다.** 이유:

1. `botService.js`는 이미 오케스트레이터로서 충분히 복잡하다. REST polling loop를 추가하면 shutdown 경로가 더 복잡해진다.
2. `coinSelector`가 이미 `exchangeClient.getFundingRate()` + `getOpenInterest()`를 사용하고 있다 (`coinSelector.js:425-449`). 새 서비스가 이 호출을 중복하지 않도록, `fundingDataService`가 캐시를 제공하고 `coinSelector`도 이를 소비하는 구조가 가능하다.
3. 향후 다른 전략(또는 시장 데이터 소비자)이 funding rate를 필요로 할 때 재사용 가능.

**조건**:
1. `fundingDataService`는 `MARKET_EVENTS.FUNDING_UPDATE` 이벤트를 emit하고, `botService`/`strategyRouter`가 이를 구독하여 전략에 라우팅. 전략에 직접 주입하지 않는다.
2. `app.js` bootstrap 순서: `exchangeClient -> fundingDataService` (coinSelector와 동일 레벨).
3. Bitget API rate limit 준수: 활성 심볼이 10개일 때 5분마다 20회 REST 호출 (getFundingRate + getOpenInterest x 10). Bitget 20req/s 제한 내에서 안전하지만, **호출 간 100ms 딜레이를 넣어 burst를 방지**해야 한다.
4. `fundingDataService.stop()`에서 폴링 타이머를 반드시 `clearInterval()`할 것. `timer.unref()`도 추가.

---

### T2-5: GridStrategy Equity 주입 — ⚠️ 조건부 동의

**특별 검토 요청 응답 — `setAccountContext()/getEquity()` 콜백 패턴 vs `setContext({ equity })` 값 주입 패턴**:

두 패턴의 안전성 비교:

**패턴 A — Trader 제안: 콜백 패턴**
```javascript
// StrategyBase
setAccountContext(context) {
  this._accountContext = context;  // { getEquity: () => string }
}
getEquity() {
  return this._accountContext.getEquity();
}

// BotService
strategy.setAccountContext({
  getEquity: () => this.riskEngine.accountState.equity,
});
```

**패턴 B — Engineer 제안: 값 주입 패턴**
```javascript
// StrategyBase
setContext(ctx) {
  if (ctx.equity !== undefined) this.config.equity = ctx.equity;
}

// BotService — accountState 변경 시
for (const strategy of this.strategies) {
  strategy.setContext({ equity: state.equity });
}
```

| 기준 | 패턴 A (콜백) | 패턴 B (값 주입) |
|------|--------------|-----------------|
| **실시간성** | O (항상 최신값) | X (마지막 주입 시점의 값) |
| **stale 데이터 위험** | 없음 | 있음 (주입 빈도에 의존) |
| **디버깅** | X (값을 로깅하려면 호출 필요) | O (config에 값이 있어 즉시 확인) |
| **결합도** | X (riskEngine에 간접 의존) | O (순수 값 전달) |
| **NULL 안전성** | X (getEquity가 undefined일 때 런타임 에러) | O (fallback '0' 유지) |
| **백테스트 호환** | 중간 (콜백 주입 필요) | 좋음 (단순 값 설정) |
| **config 오염** | O (별도 _accountContext) | X (config에 직접 쓰기) |

**결론: 하이브리드 패턴을 채택한다.**

```javascript
// StrategyBase
setContext(ctx) {
  this._context = { ...(this._context || {}), ...ctx };
}

getEquity() {
  // 1순위: context에서 주입된 equity
  if (this._context && this._context.equity && this._context.equity !== '0') {
    return this._context.equity;
  }
  // 2순위: config fallback
  return this.config.equity || '0';
}
```

이유:
1. **콜백 패턴의 NULL safety 문제가 심각하다**. `this._accountContext.getEquity()`에서 `_accountContext`가 설정되지 않았거나 `getEquity`가 함수가 아닌 경우 런타임 에러로 전체 tick 처리가 중단된다. 방어 코드를 넣더라도 콜백 참조 관리가 복잡해진다.
2. **config에 직접 쓰는 것은 피해야 한다**. `config`는 사용자/메타데이터 기반 설정이므로, 런타임 주입 값과 분리되어야 한다. 별도 `_context` 객체를 사용한다.
3. **값 주입이면서 주기적으로 업데이트**하면 stale 데이터 문제도 완화된다. `botService`가 `accountStateUpdate` 이벤트를 수신할 때마다 전략에 `setContext()`를 호출하면 된다. tick 처리 주기(수 초) 대비 equity 변동 속도(분 단위)를 감안하면 충분하다.

**조건**: `this.config.equity`에 직접 쓰는 것이 아니라 별도 `_context` 필드를 사용할 것. BacktestEngine에서도 `strategy.setContext({ equity: this._cash })`로 매 tick마다 주입.

---

### T2-7: API Rate Limiting — ✅ 동의

Trader의 권장 설정이 적절하다. Engineer 제안서의 in-memory sliding-window 구현과 3-tier 체계도 합의되어 있다. 별도 의견 없음.

---

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한 — ✅ 동의

3개 에이전트 모두 동일한 문제를 인식하고 유사한 해결책을 제안한다. Trader의 `length > 100` 조건부 정리보다 Engineer의 `while(shift)` + `MAX_RAPID_LOSSES` 이중 안전장치가 더 견고하다.

**채택**: Engineer 제안의 `while(this.rapidLosses[0] < cutoff) shift()` + 절대 상한 500개.

---

## UI/UX 제안서 리뷰

### T2-6: useSocket 목적별 분리 — ⚠️ 조건부 동의

분석이 정확하다. 현재 `useSocket.ts`에서 `handleTicker`(L72-80)가 고빈도 상태 갱신을 일으키고, `lastTicker`가 `page.tsx`에서 사용되지 않으면서 불필요한 리렌더를 유발하는 문제를 정확히 짚었다.

**특별 검토 요청 응답 — 4개 훅이 동일 소켓 인스턴스 공유 시 이벤트 핸들러 등록/해제 순서 문제**:

`socket.ts`의 ref-counted `acquireSocket()/releaseSocket()` 구조를 확인했다 (`frontend/src/lib/socket.ts`):

```javascript
let refCount = 0;
function acquireSocket(): Socket {
  refCount++;
  if (!socket) { socket = io(...); }
  return socket;
}
function releaseSocket(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) { socket.disconnect(); socket = null; }
}
```

**잠재적 문제점**:

1. **핸들러 등록 순서**: 4개 훅이 각각 `useEffect`에서 `socket.on()`을 호출한다. React의 `useEffect` 실행 순서는 컴포넌트 트리의 자식 -> 부모이므로, `page.tsx`에서 4개 훅을 순서대로 호출해도 실행 순서가 보장되지 않는다. **그러나 Socket.io의 `on()`은 이벤트 핸들러를 배열에 추가하는 것이므로, 순서와 무관하게 정상 작동한다.** 핸들러 간에 상태 의존성이 없으므로 순서 문제는 없다.

2. **핸들러 해제 순서**: `useEffect` cleanup은 역순(부모 -> 자식)으로 실행된다. 핵심 위험은 **refCount가 0에 도달하여 소켓이 disconnect되는 시점**이다. 4개 훅 중 하나가 cleanup될 때 `releaseSocket()`을 호출하면 refCount가 3이 되지만, HMR(Hot Module Replacement)이나 페이지 전환 시 4개가 동시에 cleanup되면 마지막 cleanup에서 소켓이 disconnect된다. 이 동작은 **기존과 동일**하다(현재도 1개 훅이 1회 acquire/release).

3. **실제 위험 시나리오**: 컴포넌트 A가 `useSocketSignals`를, 컴포넌트 B가 `useSocketRisk`를 사용할 때, 컴포넌트 A만 unmount되면 `releaseSocket()`이 호출된다 (refCount: 2->1). 소켓은 유지되지만, **A의 signal 핸들러는 제거되고 B의 risk 핸들러만 남는다**. 이것은 의도된 동작이다.

4. **중복 핸들러 위험**: 같은 컴포넌트에서 `useSocketSignals`와 `useSocketRisk`를 모두 사용하면 `acquireSocket()`이 2번 호출되어 refCount가 2가 된다. 컴포넌트 unmount 시 cleanup이 2번 실행되어 refCount가 0이 된다. **정상 동작**이다.

**조건**:
1. 각 분리 훅에서 `socket.off(eventName, handler)`를 cleanup에서 반드시 호출할 것 (현재 패턴 유지).
2. 기존 `useSocket`은 facade로 유지하되, 내부에서 4개 훅을 조합하는 방식이 아닌 **deprecated 코드로 유지**하는 것을 권장한다. facade가 내부에서 4개 훅을 호출하면 refCount가 4배가 되어 lifecycle 추적이 어려워진다.
3. `lastTicker`와 `positions`는 현재 미사용이므로, `useSocketMarket`의 ticker 핸들러는 **기본적으로 비활성화**하고, 실제 소비자 컴포넌트가 생길 때 활성화하는 것이 안전하다.

---

### T2-8: SignalFeed rejectReason 표시 — ✅ 동의

제안이 적절하다. `translateRejectReason()` 번역 함수, 페이로드 정규화 로직 모두 올바르다.

UI가 지적한 `handleSignalGenerated` 페이로드 불일치 문제가 중요하다:

```typescript
// 현재: (signal: Signal)로 타입 지정
// 실제 서버 페이로드: { signal: Signal, approved: boolean, rejectReason?: string }
```

이 정규화는 반드시 수행해야 한다. **T2-2(confidence filtering) + T2-8(rejectReason 표시)을 함께 구현**하는 것이 맞다.

---

### T2-10: Drawdown 시각화 차트 — ✅ 동의

클라이언트 측에서 equity curve 데이터로부터 drawdown을 계산하는 접근이 올바르다. 추가 API 없이 구현 가능하다.

**Option A (탭 방식) 채택에 동의한다**. 대시보드 레이아웃 변경 최소화가 안정성 측면에서 중요하다.

단, `computeDrawdownSeries`에서 `parseFloat(point.equity)`를 사용하는 것은 **프론트엔드에서 표시 목적이므로 허용**한다. 프론트엔드의 차트 계산은 정밀도가 중요하지 않으므로 float 사용이 적절하다.

---

### T2-11: Risk Gauge 대시보드 — ✅ 동의

SVG 기반 반원형 게이지 설계가 적절하다. 접근성 고려(`aria-label`, `role="meter"`)가 좋다.

**안전성 주의 사항**:
- 게이지가 "안전" 표시일 때 사용자 과신 방지를 위해, 정확한 수치(%)를 항상 병행 표시해야 한다. UI가 이미 계획했으므로 추가 의견 없음.
- `computeRiskScore`에서 `MAX_DD = 10` 하드코딩 대신, 백엔드 `/api/risk/status`에서 `params.maxDrawdownPercent`를 반환하도록 하는 것이 맞다. 이 타입 확장은 Engineer가 구현한다.

---

### T2-12: 적응형 폴링 — ⚠️ 조건부 동의

**특별 검토 요청 응답 — interval 변경 시 setInterval 정리 레이스 컨디션**:

UI의 `useAdaptivePolling` 구현:

```typescript
useEffect(() => {
  fetchFn();
  const id = setInterval(fetchFn, interval);
  return () => clearInterval(id);
}, [fetchFn, interval]);
```

이 패턴에서 `interval`이 변경되면:
1. 기존 useEffect cleanup 실행: `clearInterval(oldId)` -- 기존 타이머 해제
2. 새 useEffect 실행: `fetchFn()` + `setInterval(fetchFn, newInterval)` -- 새 타이머 생성

**React의 useEffect는 cleanup을 먼저 실행한 후 새 effect를 실행하므로, 이론적으로 레이스 컨디션은 없다.**

그러나 실제 위험은 다른 곳에 있다:

1. **`fetchFn` 참조 안정성**: `fetchFn`이 `useCallback`으로 안정화되지 않으면, 매 렌더마다 새 참조가 생성되어 `useEffect`가 반복 실행된다. 이로 인해:
   - `clearInterval` + `setInterval`이 매 렌더마다 반복
   - `fetchFn()`이 매 렌더마다 즉시 호출 (API 폭주)

2. **봇 상태 변경 시 즉시 fetch**: `interval`이 변경될 때 `fetchFn()`이 즉시 호출되므로, 봇 상태가 빈번히 토글되면 (예: running -> paused -> running) 짧은 시간에 다수 fetch가 발생할 수 있다.

3. **`useMemo`의 `interval` 빈번 재계산**: `isVisible`, `riskHalted`, `botState`가 모두 `useMemo` 의존성이므로, 이 중 하나만 변경되어도 interval이 재계산되고 useEffect가 재실행된다.

**조건**:
1. `fetchFn`은 반드시 `useCallback`으로 감싸서 참조 안정성을 보장할 것.
2. interval 변경 시 `fetchFn()` 즉시 호출 대신, 새 interval로 setInterval만 재설정하는 것을 고려. 즉시 호출은 `isVisible` 변경(탭 복귀) 시에만 수행.
3. **최소 interval 변경 간격(debounce)**을 두어 빈번한 interval 전환을 방지:

```typescript
// 개선된 패턴
const [effectiveInterval, setEffectiveInterval] = useState(interval);

useEffect(() => {
  const timer = setTimeout(() => setEffectiveInterval(interval), 500);
  return () => clearTimeout(timer);
}, [interval]);

useEffect(() => {
  const id = setInterval(fetchFn, effectiveInterval);
  return () => clearInterval(id);
}, [fetchFn, effectiveInterval]);
```

---

### T2-7 (Rate Limiting) — 프론트엔드 연동 (UI 요청 응답)

**특별 검토 요청 응답 — 429 응답이 `{ success: false, error }` 규약을 따를 것임을 확인**:

Engineer 제안서의 `createRateLimiter` 코드(`agents/engineer/proposals/round_4.md` L238-243)를 확인하면:

```javascript
return res.status(429).json({
  success: false,
  error: message,
  retryAfter: Math.ceil(windowMs / 1000),
});
```

**확인: `{ success: false, error: string }` 규약을 준수한다.** 추가로 `retryAfter` 필드도 포함되어 있어 프론트엔드에서 재시도 로직에 활용 가능하다.

UI가 요청한 추가 사항:
1. `/api/health/ping` rate limit 제외: **동의**. health check는 모니터링 목적이므로 rate limit에서 제외한다. 구현 시 해당 라우트를 limiter 미들웨어 전에 마운트하면 된다.
2. Rate limit 설정값 공유: Critical(10/min), Standard(60/min), Heavy(3/min). T2-12의 폴링 간격이 이 한도 내에 있는지 UI가 확인해야 한다.
   - `botStatus` active(5s) = 12/min -> Standard(60/min) 내에서 안전
   - `positions` active(3s) = 20/min -> Standard(60/min) 내에서 안전
   - 모든 폴링 합산: 최대 ~40/min -> Standard(60/min) 내에서 안전

---

## 교차 이슈 (에이전트 간 중복/상충 발견사항)

### 1. AD 번호 충돌

3개 에이전트 모두 AD-18, AD-19, AD-20 번호를 사용하고 있으나 내용이 다르다:

| AD 번호 | Engineer | Trader | UI |
|---------|----------|--------|-----|
| AD-18 | API Rate Limiting In-Memory | Funding Data Service Polling | useSocket 분리 전략 |
| AD-19 | RSI Wilder Smoothing 기본값 | Strategy Account Context DI | 적응형 폴링 간격 표준 |
| AD-20 | Strategy Context Injection | RSI Default Smoothing | 클라이언트 측 Drawdown 계산 |

**해결**: Phase 3(Synthesize)에서 AD 번호를 정리한다. 제안:
- AD-18: API Rate Limiting (Engineer)
- AD-19: RSI Wilder Smoothing Default (Engineer/Trader 합의)
- AD-20: Strategy Context Injection — Hybrid Pattern (Engineer 수정)
- AD-21: Funding Data Service as Independent Module (Trader 기반, Engineer 승인)
- AD-22: useSocket Split Strategy (UI)
- AD-23: Adaptive Polling Standard (UI)
- AD-24: Client-side Drawdown Calculation (UI)

### 2. T2-5 setContext 패턴 상충

- **Engineer**: `setContext({ equity })` 값 주입 → `this.config.equity`에 직접 쓰기
- **Trader**: `setAccountContext({ getEquity })` 콜백 패턴 → 별도 `_accountContext` 필드

위 리뷰에서 하이브리드 패턴으로 해결 제안했다: 별도 `_context` 필드에 값 주입, `getEquity()` 헬퍼 제공.

### 3. T2-4 구현 위치 상충

- **Engineer**: `botService` 내부 `_startFundingPoll()` 메서드
- **Trader**: 별도 `fundingDataService.js` 모듈

위 리뷰에서 별도 모듈(`fundingDataService.js`)을 채택했다.

### 4. T2-1 RSI 함수 시그니처 상충

- **Engineer**: `rsi(prices, period, wilder = true)` — boolean 3번째 파라미터
- **Trader**: `rsi(prices, period, { smoothing = 'wilder' } = {})` — options 객체

**권장: Trader의 options 객체 패턴을 채택한다.** 이유:
1. 향후 추가 파라미터(예: `initialSeed` 방식)가 필요할 때 확장 가능
2. 호출부에서 `rsi(closes, 14, { smoothing: 'wilder' })`가 `rsi(closes, 14, true)`보다 의도가 명확
3. `indicatorCache.js`에서 `params.smoothing`을 바로 전달 가능

### 5. T2-2 + T2-8 타이밍

- Trader: T2-2 → T2-8 순서로 진행 (confidence filter 구현 후 rejectReason UI 표시)
- UI: T2-8을 T2-12와 병렬 처리 제안 (Phase 1)

**권장**: T2-2를 먼저 구현하되, T2-8은 기존 `riskEngine` 거부 사유(`equity_not_initialized`, `circuit_breaker_active` 등)만으로도 독립 구현 가능하므로 **병렬 진행 가능**. T2-2 완료 후 `low_confidence` 사유가 추가되면 번역 함수에 한 줄만 추가하면 된다.

### 6. T2-12 폴링 간격 — Trader vs UI 비교

| 항목 | Trader 제안 | UI 제안 |
|------|-------------|---------|
| idle positions | 미언급 | 30s |
| active positions | 미언급 | 3s |
| idle botStatus | 30s | 15s |
| active botStatus | 3s | 5s |

Trader가 `botStatus`의 active 간격을 3초로, UI가 5초로 제안했다. **5초를 채택한다** — rate limit(60/min = 1/s)과의 여유를 고려.

---

## 구현 순서 의견 (시스템 안전성 기준)

3개 에이전트의 우선순위 제안을 종합하여, **시스템 안전성/안정성 기준**으로 재정렬한다:

### Phase 1: Safety-Critical (비활성 코드 복구 + 메모리 누수 + 보안)

| 순서 | ID | 제목 | 담당 | 근거 |
|------|-----|------|------|------|
| 1 | T2-9 | CircuitBreaker rapidLosses 크기 제한 | E | 메모리 누수. 10줄 이내. 즉시 수정. |
| 2 | T2-7 | API Rate Limiting | E | 보안 취약점. 외부 노출 전 필수. |
| 3 | T2-5 | GridStrategy Equity 주입 | E+T | 전략 완전 비활성 상태 — P0. |
| 4 | T2-4 | FundingRate 데이터 소스 | E+T | 전략 완전 비활성 상태 — P0. |

**이유**: T2-9와 T2-7은 시스템 안전성(메모리/보안)이므로 기능 복구보다 우선한다. T2-5, T2-4는 비활성 전략 복구이지만, 시스템 안전 기반이 먼저 확보되어야 한다.

### Phase 2: Core Quality (매매 품질 개선)

| 순서 | ID | 제목 | 담당 | 근거 |
|------|-----|------|------|------|
| 5 | T2-1 | RSI Wilder Smoothing | E | 5개 전략의 지표 정확도에 직접 영향. |
| 6 | T2-2 | Confidence Signal Filtering | E | Sharpe ratio 개선 직접 경로. T2-8과 시너지. |
| 7 | T2-3 | Backtest Position Size | E | 백테스트 신뢰성 핵심. |

### Phase 3: Frontend Infrastructure (성능 + UX 기반)

| 순서 | ID | 제목 | 담당 | 근거 |
|------|-----|------|------|------|
| 8 | T2-12 | 적응형 폴링 | U | T2-7(rate limit) 적용 후 폴링 최적화. 서버 부하 75% 감소. |
| 9 | T2-8 | SignalFeed rejectReason | U | T2-2 완료 후 최대 효과. 독립 구현 가능. |
| 10 | T2-6 | useSocket 목적별 분리 | U | ticker 리렌더 제거. 영향 범위 넓어 후순위. |

### Phase 4: Visual Enhancement (신규 컴포넌트)

| 순서 | ID | 제목 | 담당 | 근거 |
|------|-----|------|------|------|
| 11 | T2-10 | Drawdown 시각화 차트 | U | 추가 API 불필요. 리스크 분석 강화. |
| 12 | T2-11 | Risk Gauge 대시보드 | U | Nice-to-have. SVG 구현 복잡도 높음. |

### Track 병렬성

Phase 1~2(Backend Track A)와 Phase 3~4(Frontend Track C)는 **대부분 병렬 진행 가능**하다. 단, 아래 의존 관계를 준수:

```
T2-7 (rate limit) ──before──> T2-12 (adaptive polling)
T2-2 (confidence) ──before──> T2-8 (rejectReason) [최적이지만 필수는 아님]
T2-5 (setContext) ──before──> T2-4 (fundingData) [둘 다 StrategyBase 변경]
```

실제 병렬 실행 계획:
```
Track A (Backend):   T2-9 → T2-7 → T2-5 → T2-4 → T2-1 → T2-2 → T2-3
Track C (Frontend):  [대기: T2-7 완료] → T2-12 → T2-8 → T2-6 → T2-10 → T2-11

Timeline:
  Phase 1:  Track A: T2-9, T2-7, T2-5, T2-4
            Track C: (T2-7 완료 후) T2-12, T2-8
  Phase 2:  Track A: T2-1, T2-2, T2-3
            Track C: T2-6, T2-10, T2-11
```

---

## 요약 테이블

| ID | Trader | UI | Engineer Review | 비고 |
|----|--------|-----|----------------|------|
| T2-1 | P1 | (백엔드) | ✅ 동의 | options 객체 시그니처 채택 |
| T2-2 | P1 | (백엔드) | ⚠️ 조건부 | parseFloat 금지, mathUtils 사용 |
| T2-3 | P1 | (백엔드) | ✅ 동의 | high fallback: Trader '8' 채택 |
| T2-4 | P0 | (백엔드) | ⚠️ 조건부 | 별도 fundingDataService 채택, burst 방지 |
| T2-5 | P0 | (백엔드) | ⚠️ 조건부 | 하이브리드 패턴: _context + getEquity() |
| T2-6 | P2 | P2(중) | ⚠️ 조건부 | facade 대신 deprecated 유지 |
| T2-7 | P2 | (연동 요청) | ✅ 동의 | 429 규약 준수 확인됨 |
| T2-8 | P2 | P2(낮) | ✅ 동의 | 페이로드 정규화 필수 |
| T2-9 | P3 | (백엔드) | ✅ 동의 | Engineer while+shift 패턴 채택 |
| T2-10 | P2 | P2(중) | ✅ 동의 | Option A 탭 방식 동의 |
| T2-11 | P3 | P2(중~높) | ✅ 동의 | params 타입 확장 필요 |
| T2-12 | P2 | P1(중) | ⚠️ 조건부 | fetchFn 안정성 + interval debounce |
