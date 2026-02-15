# Round 5 Cross-Review: Trader + UI/UX 제안서

**Reviewer**: Senior Systems Engineer
**Date**: 2026-02-15
**Reviewed**: `agents/trader/proposals/round_5.md`, `agents/ui/proposals/round_5.md`
**Base**: 내 제안서 `agents/engineer/proposals/round_5.md` (873줄) 대비 교차 검증

---

## 1. T3-3: Exchange-side Stop Loss

### Trader 제안 요약

- 18개 전략 전체를 분석하여 SL 적합도를 높음(11개)/중간(5개)/낮음(2개)으로 분류
- Phase 1: 진입 시그널에 `stopLossPrice` 필드 추가 (기존 파이프라인 활용)
- Phase 2: 소프트웨어 SL을 fallback으로 유지 (이중 안전망)
- Phase 3: `futuresSubmitPlanOrder` (독립 trigger order) -- 향후 라운드

### 리뷰

#### 전략별 SL 적합도 분류: **✅ 동의**

Trader의 분류가 시스템 관점에서 적절하다. 핵심 판별 기준은 "진입 시점에 SL 가격을 확정할 수 있는가"이며:

- **높음(11개)**: ATR 고정, 고정 %, 스윙 포인트, 피보나치 레벨 등 -- 진입 시점에 결정론적(deterministic)으로 계산 가능. `presetStopLossPrice`에 적합.
- **중간(5개)**: Bollinger band, Supertrend line, VWAP offset 등 -- 시간 경과에 따라 SL 레벨이 변동. 초기 SL만 exchange-side로 설정하고, 더 유리한 방향의 갱신은 소프트웨어 trailing에 위임하는 Trader의 접근이 합리적.
- **낮음(2개, Grid + 1)**: Grid 전략은 고정 그리드 간격이 SL 역할을 하므로 exchange-side SL 개념 자체가 부적합. 동의.

#### Phase 1 구현 (presetStopLossPrice): **⚠️ 조건부 동의**

Trader의 핵심 주장 -- "기존 파이프라인이 이미 완비되어 있으므로 전략에서 `stopLossPrice` 필드만 추가하면 된다" -- 는 **코드 확인 결과 정확하다**:

```
exchangeClient.placeOrder() L225:
  if (stopLossPrice !== undefined) orderParams.presetStopLossPrice = String(stopLossPrice);

orderManager._submitOrderInternal() L367:
  if (stopLossPrice) orderParams.stopLossPrice = stopLossPrice;
```

**보완 필요 사항 3가지**:

1. **SL 가격 정밀도(tick size) 라운딩**: Trader도 "핵심 리스크" 섹션에서 언급했듯이, Bitget은 심볼별로 `pricePlace`(가격 소수 자릿수)가 다르다. SL 가격이 이 정밀도를 위반하면 주문이 `40035 (invalid price precision)` 에러로 거부된다. `exchangeClient.placeOrder()` 또는 `orderManager._submitOrderInternal()`에서 `presetStopLossPrice`에 대해 tick size 라운딩을 적용하는 로직이 필요하다. 현재 `instruments` 캐시가 있는지 확인한 결과 **없으므로**, `exchangeClient`에 심볼 정보 캐싱 메서드 추가가 선행되어야 한다. 단, 이것은 Round 5 범위를 넘을 수 있으므로, 최소한 전략에서 `mathUtils.floorToStep()` 등으로 적절한 소수 자릿수를 적용하도록 가이드라인을 제공하면 된다.

2. **SL 체결 시 WS 이벤트 처리**: `presetStopLossPrice`로 설정된 SL이 거래소에서 트리거되면, Bitget WS에서 별도의 order fill 이벤트가 발생한다. 현재 `exchangeClient`의 WS handler(`_handleOrderUpdate`)가 이 SL fill 이벤트를 정상적으로 처리하는지 확인이 필요하다. SL fill은 원래 주문의 `clientOid`와 다른 새 orderId를 가질 수 있으므로, `OrderManager._handleOrderFilled()`에서 이를 기존 포지션과 매칭하는 로직이 필요할 수 있다. **이 검증을 Phase 1 구현 시 반드시 수행해야 한다.**

3. **Paper Trading SL 시뮬레이션**: 현재 `PaperEngine`은 market order와 limit order만 처리한다(`matchMarketOrder()`, `submitLimitOrder()`, `onTickerUpdate()`). SL/TP 트리거 주문에 대한 시뮬레이션이 전혀 없다. 코드를 확인한 결과:

```
PaperEngine.onTickerUpdate() -- pending limit orders만 순회
  for (const [clientOid, order] of this._pendingOrders) {
    // buy limit: lastPrice <= order.price
    // sell limit: lastPrice >= order.price
  }
```

**SL 트리거 시뮬레이션 추가가 필수적이다.** 제안:
- `PaperEngine`에 `_pendingSLOrders` Map을 추가
- `submitSLOrder({ clientOid, symbol, side, posSide, qty, triggerPrice, strategy })` 메서드 추가
- `onTickerUpdate()`에서 SL 조건도 확인 (long SL: lastPrice <= triggerPrice, short SL: lastPrice >= triggerPrice)
- 이 없이는 Paper와 Live의 동작이 분기되어, Paper에서 테스트한 결과가 Live에서 재현되지 않는다

이 3가지가 보완되면 Phase 1 진행에 동의한다.

#### Phase 2 이중 안전망: **✅ 동의**

소프트웨어 SL을 제거하지 않는 접근은 방어적 프로그래밍 원칙에 부합한다. Exchange SL이 먼저 실행되면 포지션이 이미 닫혀 있을 것이고, 소프트웨어 SL이 이후에 확인하면 no-op이 된다. 경합(race condition) 위험도 없다 -- 최악의 경우 이미 닫힌 포지션에 대해 close 시그널이 발생하지만, `OrderManager`가 이미 닫힌 포지션에 대한 close를 reject할 것이다.

#### Phase 3 (Plan Order) 후속 라운드 연기: **✅ 동의**

독립 trigger order API는 별도의 order lifecycle 관리(생성, 수정, 취소, 상태 추적)가 필요하며 OrderManager 복잡도를 크게 높인다. Phase 1의 `presetStopLossPrice`로 핵심 안전성을 확보한 후, 필요 시 Phase 3을 진행하는 것이 리스크 관리 측면에서 적절하다.

---

## 2. T3-6: 성과 귀인 대시보드

### Map 직렬화 버그: **✅ 3명 모두 합의 -- 즉시 수정**

코드 확인 결과 버그가 확정적이다:

```javascript
// performanceTracker.js L371, L432
const result = new Map();
// ...
return result;

// trackerService.js L78, L89
return _performanceTracker.getByStrategy(sessionId);  // Map 그대로 반환

// analyticsRoutes.js L61-62
const stats = await trackerService.getByStrategy(sessionId);
res.json({ success: true, data: stats });  // JSON.stringify(Map) = '{}'
```

**수정 방안**: `analyticsRoutes.js`에서 `Object.fromEntries()` 변환이 가장 적절하다. `trackerService` 레벨에서 변환하면 내부적으로 Map 기능이 필요한 다른 소비자에게 영향을 줄 수 있으므로, API 직렬화 직전에 변환하는 것이 단일 책임 원칙에 부합한다.

```javascript
// analyticsRoutes.js -- 수정안
const statsMap = await trackerService.getByStrategy(sessionId);
const stats = statsMap instanceof Map ? Object.fromEntries(statsMap) : statsMap;
res.json({ success: true, data: stats });
```

`instanceof Map` 방어 검사를 추가하여, 추후 `performanceTracker`가 Object를 직접 반환하도록 리팩토링되더라도 안전하게 동작하도록 한다.

### Trader 제안 -- 백엔드 지표 확장 (avgPnl, profitFactor 등)

#### **⚠️ 조건부 동의**

Trader가 제안한 확장 지표(avgPnl, profitFactor, expectancy, avgWin, avgLoss, largestWin, largestLoss, avgHoldTime, pnlContribution)는 트레이딩 관점에서 가치가 높다. 그러나:

**시스템 관점 우려**: `getByStrategy()`와 `getBySymbol()`은 매 호출마다 `Trade.find({ sessionId }).lean()`으로 **전체 거래 내역을 MongoDB에서 조회**한다. 지표 확장 자체는 in-memory 계산이므로 성능 영향이 미미하지만, **프론트엔드에서 이 API들을 폴링하기 시작하면** DB 부하가 늘어난다.

**보완 사항**:
1. 거래 수가 1000건을 넘어가면 `Trade.find()` 쿼리 비용이 유의미해진다. 중기적으로 `PerformanceTracker`에 in-memory 캐시(최근 N분 TTL) 도입을 고려해야 한다.
2. 당장은 **프론트엔드 폴링 간격을 30초 이상**으로 설정하면 충분하다. UI가 제안한 `useAdaptivePolling` 패턴(봇 running 시에만 폴링)과 결합하면 안전하다.
3. 지표 확장 자체는 동의하되, `cross-tab`과 `strategy-correlation` 엔드포인트는 Round 5에서 제외하고 후속에서 다루는 것을 권장한다. 상관계수 계산은 전략 수 * 일수 만큼의 행렬 연산이 필요하여 연산 비용이 비교적 높다.

### UI 제안 -- PerformanceTabs 설계

#### 4개 API 동시 호출 성능: **⚠️ 조건부 동의**

UI가 제안한 `usePerformanceAnalytics` 훅은 `Promise.all`로 3개 API를 동시 호출한다(by-strategy, by-symbol, daily). 기존 `useAnalytics`의 2개(equityCurve, session)와 합치면 **최대 5개 API가 동시에 발생**할 수 있다.

**시스템 관점 평가**:
- 5개 동시 요청은 HTTP/2 환경에서 문제 없다. Node.js Express는 단일 이벤트 루프이지만, 5개 요청의 합산 처리 시간이 수백ms 이내이므로 블로킹 우려 없음.
- 다만 `by-strategy`와 `by-symbol`이 **동일한 `Trade.find({ sessionId })` 쿼리를 중복 실행**한다. 이 두 엔드포인트가 같은 sessionId에 대해 동시에 호출되면 MongoDB에 불필요한 중복 쿼리가 발생한다.

**보완 사항**:
1. **단기**: `usePerformanceAnalytics` 훅에서 `Promise.all`로 3개를 한번에 호출하되, 탭 전환 시에만 해당 탭의 데이터를 fetch하는 **lazy loading** 패턴이 더 적절하다. 모든 탭의 데이터를 한번에 가져올 필요 없이, 활성 탭의 데이터만 로드하면 초기 로딩 시간과 네트워크 비용을 절약할 수 있다.
2. **중기**: 백엔드에 `GET /api/analytics/summary/:sessionId` 통합 엔드포인트를 추가하여 한 번의 DB 조회로 by-strategy + by-symbol + daily를 모두 반환하는 것을 고려할 수 있다. 단, Round 5 범위에서는 불필요.

#### 탭 기반 레이아웃: **✅ 동의**

기존 Row 3의 EquityCurveChart + DrawdownChart 영역을 `PerformanceTabs`로 교체하는 설계가 적절하다. 별도 `/analytics` 페이지 대신 탭 통합을 선택한 근거(세션 컨텍스트 유지)도 합리적이다.

#### 타입 정의 추가: **✅ 동의**

`Record<string, unknown>`을 구체적 타입으로 교체하는 것은 프론트엔드 코드 안정성을 높인다. `StrategyPerformanceEntry`, `SymbolPerformanceEntry`, `DailyPerformanceEntry` 3개 타입 정의에 동의한다.

---

## 3. T3-1: 테스트 프레임워크 -- Jest vs Vitest

### UI의 Vitest 권장 vs Trader의 Jest 권장 vs 내 Jest 권장

#### **⚠️ 조건부 동의 (모노레포 분리 운영 방식으로)**

**핵심 쟁점**: 모노레포에서 백엔드(CommonJS) Jest와 프론트엔드(ESM/TypeScript) Vitest를 동시 운영하는 것이 관리 가능한가?

**결론: 관리 가능하며, 오히려 각 환경에 최적화된 도구를 선택하는 것이 합리적이다.**

근거:

1. **백엔드 = Jest**: CommonJS 환경에서 Jest는 zero-config에 가깝다. `require()` 기반 모듈 시스템에 자연스럽고, `jest.mock()` 패턴이 안정적이다. `mongodb-memory-server`와의 통합도 검증되어 있다.

2. **프론트엔드 = Vitest**: Next.js 15 + TypeScript + ESM 환경에서 Vitest가 더 자연스럽다는 UI의 주장에 일리가 있다. `@next/jest`도 옵션이지만, React 19 + App Router 환경에서 Vitest의 HMR 기반 watch mode가 개발 경험에서 우위에 있다.

3. **모노레포 관리**: 두 도구가 `node_modules`를 별도 관리하는 모노레포 구조이므로, 의존성 충돌이 없다. 루트 레벨에서 `"test": "cd backend && npm test && cd ../frontend && npm test"` 스크립트로 통합 실행이 가능하다.

**보완 사항**:
- 루트 `package.json`에 통합 테스트 스크립트를 추가하여 CI에서 한 번에 실행할 수 있도록 해야 한다.
- Vitest 도입 시 `vitest.config.ts`에서 `@/*` 경로 별칭을 `resolve.alias`로 설정해야 한다 (UI가 이미 언급).
- **커버리지 도구 통일**: Jest는 `istanbul`, Vitest도 `istanbul` 또는 `v8`을 지원한다. `istanbul`으로 통일하면 커버리지 리포트 형식이 일관적이다.

**최종 권고**: 백엔드 Jest + 프론트엔드 Vitest 분리 운영에 동의한다. 다만 프론트엔드 테스트는 Round 5에서 P0 순수 함수(`lib/utils.ts`, `lib/drawdown.ts`) 테스트까지만 구현하고, P1 이상(컴포넌트, 훅)은 후속 라운드에서 진행하는 것을 권장한다. 백엔드 Jest 테스트가 더 시급하다(RiskEngine, mathUtils, PaperEngine).

---

## 4. T3-2: API 인증 -- `NEXT_PUBLIC_API_KEY` 보안 분석

### UI 제안 요약

```typescript
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';
headers['X-API-Key'] = API_KEY;
```

### 리뷰: **⚠️ 조건부 동의 -- 환경에 따른 위험 수준 차이 인지 필요**

#### `NEXT_PUBLIC_*` 변수의 특성

Next.js에서 `NEXT_PUBLIC_` 접두어가 붙은 환경 변수는 **빌드 시 클라이언트 번들에 인라인**된다. 즉:

1. 브라우저의 DevTools > Sources에서 API key가 평문으로 노출된다
2. 네트워크 탭에서 모든 요청의 `X-API-Key` 헤더에 키가 보인다
3. 빌드 아티팩트(`.next/static/`)에 키가 하드코딩된다

#### 위험도 평가

| 시나리오 | 위험도 | 설명 |
|----------|--------|------|
| **로컬 전용 (localhost)** | 매우 낮음 | 외부 접근 불가. API key는 추가 방어층. |
| **LAN 내부 (같은 네트워크)** | 낮음 | 같은 네트워크의 다른 기기가 접근 가능하나, API key가 없으면 차단. 키 노출 경로가 제한적. |
| **공인 IP/도메인 노출** | **높음** | 누구나 프론트엔드에 접근 가능 -> DevTools로 API key 확인 -> 백엔드 직접 호출 가능. API key가 사실상 무력화. |
| **VPN 뒤** | 낮음 | VPN 접근 권한이 있어야 프론트엔드에 접근 가능. |

#### 결론

**현재 시스템의 사용 시나리오(단일 운영자, 로컬/LAN 환경)에서는 수용 가능하다.**

그러나 다음을 명확히 문서화해야 한다:
1. `NEXT_PUBLIC_API_KEY`는 클라이언트 사이드에 노출되므로, 이것만으로는 공인 인터넷 환경에서의 보안을 보장하지 않는다
2. 공인 인터넷에 노출할 경우 JWT 인증(2단계)으로 전환하거나, 서버 사이드 프록시(Next.js API Routes를 통한 백엔드 호출)로 키를 숨겨야 한다
3. Trader의 위험도 분류(Critical/High/Low/None)와 결합하여, health/ping 외에는 모두 인증 필수로 적용

**보완 사항**:
- 내 제안서의 `createApiKeyAuth()` 미들웨어에서 `API_KEY` 미설정 시 인증 비활성화(개발 편의)하되, 콘솔에 **경고 로그를 눈에 띄게 출력**하여 프로덕션에서 실수로 미설정하는 것을 방지
- CORS를 `Access-Control-Allow-Origin: '*'` 에서 프론트엔드 URL로 제한하는 것을 T3-2에 포함 (이것만으로도 외부 스크립트의 cross-origin 요청을 차단)

---

## 5. T3-7: traceId를 ApiError에 포함

### UI 제안 요약

```typescript
const traceId = res.headers.get('X-Trace-Id') || '';
if (!res.ok || !json.success) {
  throw new ApiError(json.error || '요청 실패', res.status, endpoint, false, traceId);
}
```

### 리뷰: **✅ 동의**

에러 전파 패턴과 일관적이다. 근거:

1. **단방향 전파**: 백엔드가 `X-Trace-Id` 응답 헤더에 traceId를 포함 -> 프론트엔드가 이를 읽어 `ApiError`에 저장 -> 에러 UI에 표시. 단방향이므로 복잡한 상태 관리가 불필요.

2. **기존 ApiError 확장과 호환**: 현재 `ApiError` 클래스는 `(message, statusCode, endpoint, isNetworkError)` 4개 인자를 받는다. 5번째 인자 `traceId`를 추가하는 것은 하위 호환이 보장된다.

3. **네트워크 에러 시 traceId 부재**: `catch` 블록(네트워크 에러)에서는 응답 자체가 없으므로 traceId가 `''`이 된다. 이는 올바른 동작이다 -- 요청이 서버에 도달하지 못했으므로 traceId가 없는 것이 정확하다.

**보완 사항 1가지**:
- 내 제안서의 AsyncLocalStorage 기반 traceId와 UI의 프론트엔드 소비를 연결하려면, Express 미들웨어에서 **모든 응답**(성공 포함)에 `X-Trace-Id` 헤더를 설정해야 한다. 내 설계에서 이미 `res.setHeader('X-Trace-Id', traceId)`를 포함하고 있으므로 호환된다.

---

## 6. 추가 시스템 관점 검토

### Trader 제안 - PaperEngine SL 시뮬레이션 (재강조)

Trader가 "핵심 리스크" 섹션에서 "PaperEngine에서 SL 트리거를 시뮬레이션해야 한다"고 언급한 것은 정확하다. 현재 PaperEngine 코드를 직접 확인한 결과:

- `matchMarketOrder()`: 즉시 fill. SL 관련 로직 없음.
- `submitLimitOrder()`: `_pendingOrders` Map에 저장. SL 개념 없음.
- `onTickerUpdate()`: `_pendingOrders`의 limit order만 확인. SL trigger 확인 없음.
- `_createFill()`: `stopLossPrice` 또는 `takeProfitPrice` 필드를 처리하지 않음.

**결론**: PaperEngine에 SL 시뮬레이션을 추가하지 않으면, Paper 모드에서 exchange-side SL 테스트가 불가능하다. 이는 "Paper에서 검증 -> Live에서 실행"이라는 기본 운영 흐름을 깨뜨린다. **T3-3 구현 시 PaperEngine SL 시뮬레이션을 필수 포함 항목으로 지정한다.**

### UI 제안 - 접근성 고려사항

UI의 접근성 고려(aria-label, aria-sort, 색상 외 기호 병행, 키보드 탭 전환)는 시스템 안정성과 직접 관련은 없지만, **에러 상황에서의 사용자 인지**에 기여한다. 특히 양수/음수를 색상 외 +/- 기호로도 구분하는 것은, 모니터 색상 프로파일이 다른 환경에서도 PnL 방향을 정확히 인지할 수 있게 해준다. 동의.

### Trader/UI 공통 - 우선순위 차이

| 항목 | Trader 순위 | UI 순위 | Engineer 순위 |
|------|:-----------:|:-------:|:-------------:|
| T3-3 Exchange SL | **1** | 5 | 5 |
| T3-1 테스트 | 2 | 2 | **1** |
| T3-2 인증 | 3 | 3 | **2** |
| T3-6 대시보드 | 4 | **1** | 6 |
| T3-7 traceId | 5 | 4 | 3 |
| T3-5 Prometheus | 6 | 6 | 4 |

**3개 에이전트 합의점**:
- T3-1(테스트)과 T3-2(인증)는 모두 상위 3위 안에 있다 -- **합의 도출 용이**
- T3-3(Exchange SL)은 Trader가 1순위로 밀지만, Engineer/UI는 후순위. Trader의 "실거래 안전성" 논거가 강력하므로 상위 조정이 타당
- T3-6(대시보드)은 UI가 1순위이나, 기존 API가 Map 직렬화 버그로 동작하지 않으므로 버그 수정이 선행되어야 함

**합의 제안**:

```
Phase 1 (병행):
  Track A: T3-1 테스트 프레임워크 (Engineer 주도) + T3-2 인증 (Engineer 주도)
  Track B: T3-3 Exchange SL (Trader 주도, Engineer가 PaperEngine SL 시뮬 담당)
  Track C: T3-6 대시보드 (UI 주도, Engineer가 Map 버그 수정 선행)

Phase 2 (Phase 1 완료 후):
  Track A: T3-7 traceId (Engineer 주도)
  Track B: T3-5 Prometheus (Engineer 주도)
```

이 순서의 근거:
1. T3-1과 T3-2는 인프라/보안 기반이므로 최우선
2. T3-3와 T3-6은 각각 Trader와 UI의 핵심 항목이므로 병행 진행
3. T3-7과 T3-5는 관측성 인프라로, 기능 구현 후에 도입해도 무방

---

## 최종 요약

| 항목 | Trader 제안 | 판정 | UI 제안 | 판정 |
|------|------------|:----:|---------|:----:|
| T3-3 SL 적합도 분류 | 높음/중간/낮음 18개 분류 | ✅ | -- | -- |
| T3-3 Phase 1 (presetSL) | 진입 시그널에 stopLossPrice 추가 | ⚠️ (tick size + WS 이벤트 + PaperEngine SL 보완) | SL 가격 UI 표시 | ✅ |
| T3-3 Phase 2 (이중 안전망) | 소프트웨어 SL 유지 | ✅ | -- | -- |
| T3-6 Map 직렬화 | Object.fromEntries() 변환 | ✅ | 동일 발견 | ✅ |
| T3-6 지표 확장 | avgPnl, profitFactor 등 | ⚠️ (cross-tab/correlation 연기) | -- | -- |
| T3-6 PerformanceTabs | -- | -- | 탭 기반 4개 뷰 | ⚠️ (lazy loading 권장) |
| T3-6 타입 정의 | -- | -- | 3개 인터페이스 추가 | ✅ |
| T3-1 Vitest vs Jest | Jest 권장 (CJS) | -- | Vitest 권장 (ESM) | ⚠️ (BE Jest + FE Vitest 분리 운영) |
| T3-2 NEXT_PUBLIC_API_KEY | API key 1단계 충분 | ✅ | 프론트엔드 헤더 추가 | ⚠️ (로컬/LAN 한정 안전, 공인 IP 노출 시 불안전) |
| T3-7 ApiError traceId | traceId 전파 경로 설계 | ✅ | X-Trace-Id 헤더 -> ApiError | ✅ |

---

**리뷰 완료. Phase 2 (Cross-Review) 종료 조건 충족.**
