# Round 5 Cross-Review: Tier 3 Enhancement

> **Reviewer**: Senior Quant Trader
> **Date**: 2026-02-15
> **Reviewed**: Engineer proposal (873L) + UI/UX proposal (583L)
> **Base commit**: 1e597ad (Sprint R4: Tier 2 Quality 12건 완료)

---

## 총평

두 제안서 모두 코드 레벨 분석이 철저하다. Engineer는 인프라/보안/관측성 4건(T3-1, T3-2, T3-5, T3-7)에 대해 즉시 구현 가능한 수준의 설계를 제시했고, UI/UX는 T3-6(성과 귀인 대시보드)에 대해 탭 기반 통합 레이아웃과 컴포넌트 분리를 상세히 설계했다. 특히 3개 에이전트 모두 `performanceTracker` Map 직렬화 버그를 독립적으로 발견한 점은 코드 분석의 신뢰성을 보여준다.

**핵심 의견**: 두 제안서 모두 대체로 동의하나, 몇 가지 트레이딩 관점에서 보완이 필요한 사항이 있다.

---

## T3-1: 테스트 프레임워크 (Jest vs Vitest 논쟁)

### Engineer: Jest 권장 / UI: Vitest 권장

**판정: 조건부 동의 -- 백엔드 Jest + 프론트엔드 Vitest 이중 체계 수용**

Engineer가 Jest를 권장하는 근거(CommonJS 네이티브 지원, `@next/jest` 공식 지원, Mongoose 생태계)는 백엔드에 대해 타당하다. UI가 Vitest를 권장하는 근거(ESM 네이티브, Vite 기반 HMR, TypeScript 환경 친화성)는 프론트엔드에 대해 타당하다.

**트레이딩 테스트 관점에서의 판단**:

`mathUtils`, `RiskEngine`, `CircuitBreaker`, `ExposureGuard`, `DrawdownMonitor`는 모두 CommonJS 모듈이며, Mongoose 모델에 의존하는 테스트(`performanceTracker`, `orderManager`)도 있다. 이들은 Jest의 네이티브 CJS 환경에서 zero-config에 가깝게 실행된다. Vitest에서 이 모듈들을 테스트하려면 CJS transform 설정이 필요하고, 이는 테스트 인프라 도입 초기 단계에서 불필요한 마찰이다.

반면 프론트엔드의 `lib/utils.ts`, `lib/drawdown.ts`, `hooks/useAdaptivePolling.ts` 등은 TypeScript/ESM 환경이므로 Vitest가 자연스럽다.

**결론**: 백엔드 Jest + 프론트엔드 Vitest 이중 체계를 수용한다. 루트 레벨 `npm test`로 양쪽을 순차 실행하도록 구성하면 된다. 이것은 Engineer와 UI 양쪽의 의견을 모두 반영하는 합리적 절충안이다.

**추가 보완 요청**:

Engineer의 테스트 우선순위에서 `mathUtils`를 1순위로 놓은 것에 강하게 동의한다. 그러나 테스트 케이스 설계에서 트레이딩 도메인의 edge case가 누락되어 있다:

| 함수 | 누락된 edge case | 위험도 |
|------|-----------------|:---:|
| `divide` | `divide('1', '3')` -- 무한소수의 precision cutoff 위치 | 높음 |
| `multiply` | 매우 작은 수 곱셈 `multiply('0.00000001', '0.00000001')` -- underflow | 높음 |
| `floorToStep` | `floorToStep('0.0049', '0.01')` -- 0이 되는 경우 주문 qty가 0 | 높음 |
| `pctChange` | 음수 oldVal `pctChange('-100', '-90')` -- 부호 처리 | 중간 |
| `inferPrecision` | 정수 입력 `add('100', '200')` -- precision이 2로 고정되는 것이 올바른지 | 중간 |

특히 `floorToStep`은 포지션 사이징의 최종 단계에서 호출되므로, step보다 작은 qty가 입력되면 '0'이 반환되어 주문 자체가 의미 없어진다. 이 경우의 방어 로직이 호출자(BotService, OrderManager)에 있는지도 확인해야 한다.

---

## T3-2: API 인증 (Engineer의 API Key 미들웨어 설계)

### 판정: 조건부 동의 -- timing-safe comparison 적절, 2가지 보완 필요

**timing-safe comparison (`crypto.timingSafeEqual`)**:

적절하다. 단일 API Key 인증에서 timing attack은 현실적 위협이 낮지만(brute force보다 key space가 크므로), 보안 모범 관행(best practice)으로서 올바른 선택이다. 실거래 환경에서는 방어의 깊이(defense-in-depth)가 중요하므로, 비용 없는 보안 강화는 항상 적용해야 한다.

**보완 사항**:

1. **API_KEY 미설정 시 pass-through 동작이 위험하다**:

   Engineer의 설계에서 `API_KEY`가 빈 문자열이면 인증이 비활성화되고 모든 요청이 통과한다:
   ```javascript
   if (!API_KEY) {
     log.warn('API_KEY not configured - authentication is DISABLED');
     return (_req, _res, next) => next();
   }
   ```

   이것은 개발 편의를 위한 것이지만, 실거래 모드(`PAPER_TRADING=false`)에서 API_KEY를 설정하지 않으면 인증이 자동으로 비활성화되어 위험하다. **실거래 모드일 때 API_KEY 미설정 시 서버 시작을 거부하거나 경고를 더 강하게 표시해야 한다**:

   ```javascript
   if (!API_KEY) {
     if (process.env.PAPER_TRADING !== 'true') {
       log.error('API_KEY is required in live trading mode. Set API_KEY in .env or enable PAPER_TRADING.');
       // 서버 시작은 허용하되, 위험 엔드포인트를 모두 차단
     }
     log.warn('API_KEY not configured - authentication is DISABLED');
     return (_req, _res, next) => next();
   }
   ```

2. **CORS 강화가 동시에 필요하다**:

   Engineer가 언급한 `Access-Control-Allow-Origin: '*'` 문제는 API Key 도입과 동시에 해결해야 한다. API Key가 `NEXT_PUBLIC_API_KEY`로 프론트엔드 빌드에 포함되므로, 브라우저 DevTools에서 누구나 확인할 수 있다. CORS를 프론트엔드 URL로 제한하면, 다른 출처에서의 요청은 브라우저가 차단한다. 물론 curl/Postman 같은 비브라우저 클라이언트는 CORS와 무관하므로 API Key가 여전히 필요하다.

**UI의 `X-API-Key` vs `Authorization: Bearer` 헤더 논쟁**:

UI가 `X-API-Key` 헤더를 제안하고, Engineer가 `Authorization: Bearer` 를 제안했다. **`Authorization: Bearer`를 추천한다**. 이유:
- RFC 6750 표준을 따르므로 향후 JWT 전환 시 헤더 변경이 불필요
- 프록시, CDN, 로드밸런서 등 인프라 도구들이 `Authorization` 헤더를 표준으로 인식
- 의미론적으로 "인증 정보"를 전달하는 것이므로 `Authorization` 이 적절

---

## T3-5: Prometheus 메트릭 카탈로그 리뷰

### 판정: 조건부 동의 -- 카탈로그 대체로 충분, 5개 핵심 메트릭 추가 필요

Engineer의 4개 카테고리(시스템, HTTP, 트레이딩, 리스크/인프라) 분류는 적절하며, 개별 메트릭 정의도 정확하다. 그러나 트레이딩 운영에서 실질적으로 필요한 몇 가지 지표가 누락되어 있다:

### 추가 필요 메트릭

| 메트릭 이름 | 타입 | 레이블 | 누락 이유와 필요성 |
|------------|------|--------|-------------------|
| `trading_fill_latency_seconds` | Histogram | strategy, side | 시그널 생성 시점 ~ 체결 시점 사이의 실제 latency. `exchange_api_latency`는 REST API 호출 시간만 측정하지만, 실제 체결까지의 시간(market order fill, limit order waiting)이 슬리피지와 직결된다 |
| `trading_slippage_bps` | Histogram | strategy, side | 시그널의 `suggestedPrice` vs 실제 체결가의 차이(basis points). 슬리피지가 전략 수익성을 직접 잠식하므로 핵심 운영 지표 |
| `trading_pnl_per_trade` | Histogram | strategy | 건당 PnL 분포. Counter인 `trading_pnl_total`은 누적값만 보여주지만, 분포(중앙값, 꼬리)를 알아야 전략의 위험 프로필을 이해할 수 있다 |
| `bot_uptime_seconds` | Gauge | -- | 봇 연속 가동 시간. 봇이 얼마나 안정적으로 운영되는지의 기본 지표 |
| `trading_position_hold_seconds` | Histogram | strategy | 포지션 보유 시간 분포. 전략의 시간 특성(스캘핑 vs 스윙)을 실시간 확인 |

### `/metrics` 엔드포인트 인증 문제

Engineer의 설계에서 `/metrics` 엔드포인트가 인증 면제인지 여부가 불명확하다. Prometheus가 주기적으로 scrape하려면 인증 없이 접근 가능해야 하지만, 메트릭에 equity, position count 등 민감 정보가 포함된다. **별도의 scrape token 또는 IP 화이트리스트를 적용하는 것을 권장한다**. 최소한 `PUBLIC_PATHS`에 `/metrics`를 추가하되, `T3-2` 인증과 독립적인 bearer token을 설정할 수 있으면 좋다.

### Histogram 버킷 설정

`exchange_api_latency_seconds`의 버킷이 `[0.1, 0.25, 0.5, 1, 2.5, 5, 10]`으로 설정되어 있다. Bitget API의 일반적인 응답 시간은 100-300ms이므로 0.1초 미만 버킷이 없다. **`[0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5]`로 조정하는 것을 권장한다**. 50ms-200ms 구간의 분해능이 중요하다. 이 구간에서의 latency 변동이 market order 슬리피지에 직접 영향을 미친다.

---

## T3-6: 성과 귀인 대시보드 (UI의 PerformanceTabs 설계)

### 판정: 조건부 동의 -- 구조는 좋으나 트레이더 의사결정에 필요한 핵심 지표와 차트 보완 필요

### 동의하는 부분

1. **탭 기반 통합 (별도 페이지 X)**: UI의 판단이 옳다. 세션 ID 컨텍스트를 유지하면서 분석 뷰를 전환하는 것이 UX 측면에서 우월하다. 별도 `/analytics` 페이지를 만들면 세션 선택 UI가 추가로 필요해진다.

2. **4개 탭 구성** (에쿼티 커브, 전략별, 심볼별, 일별): 기본 틀로 적절하다.

3. **가로 막대 차트 우선, TreeMap 후순위**: 맞다. Recharts TreeMap의 커스터마이징이 제한적이므로 가로 막대가 가독성과 구현 비용 모두 우수하다.

4. **접근성 고려** (양수/음수에 +/- 기호 병행, aria-sort): 좋은 관행이다.

### 보완이 필요한 부분

**1. 전략별 성과 탭(탭 2)의 데이터가 초급 수준이다**

UI가 정의한 테이블 컬럼 `| 전략명 | 거래 수 | 승 | 패 | 승률 | 총 PnL | PnL 바 |`는 기본 집계에 불과하다. 전문 트레이더의 의사결정에는 다음이 추가로 필수적이다:

| 추가 필요 컬럼 | 계산 방식 | 의사결정 가치 |
|----------------|-----------|--------------|
| **Profit Factor** | 총이익 / 총손실 (절대값) | 1.0 미만이면 전략 비활성화 고려. 가장 중요한 단일 지표 |
| **평균 승/패 비율** (Avg W/L Ratio) | avgWin / abs(avgLoss) | 승률이 낮아도 W/L 비율이 높으면 수익 가능 (추세추종의 특성) |
| **기대수익** (Expectancy) | winRate * avgWin + lossRate * avgLoss | 건당 기대 PnL. 양수여야 전략을 운영할 가치가 있다 |
| **수익 기여도** | 전략 PnL / 전체 PnL * 100% | 포트폴리오 내 역할 파악 |
| **최대 손실** (Largest Loss) | -- | 꼬리 위험(tail risk) 파악 |

이 지표들은 백엔드 `getByStrategy()`에서 계산해서 제공해야 한다. 프론트엔드에서 계산하면 데이터가 불완전할 위험이 있다 (예: avgWin, avgLoss는 개별 거래 데이터가 필요하므로 집계 응답만으로는 계산 불가).

**내 Round 5 제안서에서 이미 `getByStrategy()` 확장안을 제시했다** (avgPnl, profitFactor, avgWin, avgLoss, expectancy, largestWin, largestLoss, avgHoldTime, pnlContribution). Engineer가 이 확장을 백엔드에서 구현해야 한다.

**2. KPI 카드 설계가 아쉽다**

UI가 제안한 KPI 카드:
- 최고 수익 전략 (이름 + PnL)
- 최고 승률 전략 (이름 + %)
- 가장 활발한 전략 (이름 + 거래 수)
- 전략 수 / 활성 전략 수

이 중 "가장 활발한 전략"과 "전략 수/활성 전략 수"는 의사결정 가치가 낮다. 대신:

- **최고 Profit Factor 전략** (이름 + PF) -- 가장 효율적인 전략
- **최악 Expectancy 전략** (이름 + E) -- 비활성화 후보
- **전체 Sharpe Ratio** -- 포트폴리오 수준 위험 조정 수익률
- **전체 Profit Factor** -- 포트폴리오 수준 수익/손실 비율

**3. 전략-심볼 크로스탭이 없다**

"어떤 전략이 어떤 코인에서 잘 작동하는가"는 포트폴리오 최적화의 핵심 질문이다. 예를 들어 RSIPivot이 BTC에서는 수익이지만 ETH에서는 손실이라면, ETH에서는 RSIPivot을 비활성화하는 것이 합리적이다. 내 제안서에서 `GET /api/analytics/cross-tab/:sessionId` 엔드포인트를 제안했는데, UI의 설계에는 이 시각화가 없다. **히트맵 또는 피벗 테이블 형태로 추가를 권장한다** (다만 이번 스프린트에서 전부 구현하기 어려우면 후순위로 미뤄도 된다).

**4. 위험-수익 산점도(Scatter Plot)가 빠져 있다**

전략 간 비교에서 가장 직관적인 시각화는 X축=위험(maxDD 또는 변동성), Y축=수익률의 산점도이다. 각 점이 하나의 전략을 나타내며, 우상향(높은 수익, 낮은 위험)에 위치한 전략이 최적이다. 이것은 Recharts `ScatterChart`로 쉽게 구현 가능하다. **2순위로 추가를 권장한다**.

---

## T3-7: Correlation ID (AsyncLocalStorage 설계)

### 판정: 동의 -- 설계가 적절하며 전략 시그널 체인을 완전히 추적 가능

**AsyncLocalStorage 기반 설계의 적절성**:

Engineer의 설계는 두 가지 진입점을 모두 커버한다:

1. **HTTP 요청 경로**: Express 미들웨어에서 `runWithTrace(traceId, () => next())` -- 이후 모든 async 체인에서 `getTraceId()`로 자동 접근
2. **전략 시그널 경로**: `BotService._handleStrategySignal()`에서 `runWithTrace(generateTraceId(), async () => { ... })` -- signalFilter -> orderManager -> riskEngine -> exchangeClient 전체 체인 추적

**전략 시그널 -> 주문 실행 체인의 완전 추적 가능 여부**:

소스 코드를 확인한 결과, `BotService._handleStrategySignal()`은 async 함수이며, 내부에서 `signalFilter.filter()` -> `_resolveSignalQuantity()` -> `orderManager.submitOrder()` 순서로 호출한다. `orderManager.submitOrder()`은 내부에서 `riskEngine.validateOrder()` -> `exchangeClient.placeOrder()` 순으로 호출한다. 이 전체 체인이 하나의 async context 안에서 실행되므로, `AsyncLocalStorage`가 traceId를 자동 전파한다.

**한 가지 주의점**: `exchangeClient._withRetry()` 내부에서 `setTimeout` 기반의 재시도 대기가 있다면, `setTimeout`은 `AsyncLocalStorage` 컨텍스트를 유지하지만, `setInterval`이나 외부 이벤트 리스너에서 트리거되는 경우에는 컨텍스트가 유실될 수 있다. WebSocket 핸들러(`_handleOrderUpdate`)에서 수신된 이벤트는 별도의 async context이므로, 여기서 traceId를 복원하려면 `clientOid`에 traceId를 인코딩하거나 별도 매핑(orderId -> traceId)을 유지해야 한다.

**Engineer에게 보완 요청**: WebSocket 핸들러에서의 traceId 복원 전략을 명시해달라. 구체적으로:
- `placeOrder()` 시점에 `orderId -> traceId` 매핑을 In-memory Map에 저장
- WS `_handleOrderUpdate()` 에서 orderId로 traceId를 조회하여 로그에 포함
- 또는 `clientOid` 필드에 traceId를 prefix로 포함 (예: `trc_a1b2c3_coid_xxx`)

**traceId 형식**: Engineer가 `trc_` + 12 hex chars (48 bits)를 제안했는데, 이것으로 충분하다. UUID v4 (UI 제안)는 36자로 너무 길어서 로그 가독성이 떨어진다. `trc_a1b2c3d4e5f6` (16자)이 로그에서 `grep`하기에 적절한 길이다.

---

## Map 직렬화 버그 수정 방안

### 판정: 동의 -- 3개 에이전트 합의. 즉시 수정 필수

3개 에이전트 모두 동일한 버그를 독립적으로 발견했다:

- `performanceTracker.getByStrategy()` -- `Map` 반환
- `performanceTracker.getBySymbol()` -- `Map` 반환
- `analyticsRoutes.js` -- `res.json(data)` 호출 시 `Map`이 `{}`로 직렬화

**수정 위치에 대한 의견**:

Engineer는 `analyticsRoutes.js`에서 `Object.fromEntries()` 변환을 제안했다. 나는 **`performanceTracker.js` 자체에서 `Map` 대신 `Object`를 반환하도록 수정하는 것이 더 적절**하다고 본다. 이유:

1. `trackerService`를 거치든 직접 호출하든, 소비자가 항상 변환을 신경 쓸 필요가 없어진다
2. `getByStrategy()`의 JSDoc 반환 타입이 `Map`으로 선언되어 있으므로, 타입 계약 자체를 수정해야 한다
3. `getSessionStats()`나 `getDailyStats()`는 이미 plain object/array를 반환하고 있으므로, `getByStrategy()`/`getBySymbol()`만 Map인 것이 일관성에 어긋난다

**구체적 수정안**:

```javascript
// performanceTracker.js -- getByStrategy() (line 371~389)
// 변경 전:
const result = new Map();
for (const [name, data] of strategyMap) {
  // ...
  result.set(name, { trades, wins, losses, totalPnl, winRate });
}
return result;

// 변경 후:
const result = {};
for (const [name, data] of strategyMap) {
  // ...
  result[name] = { trades: data.trades, wins: data.wins, losses: data.losses, totalPnl: data.totalPnl, winRate };
}
return result;
```

`getBySymbol()`도 동일하게 수정. 이렇게 하면 `analyticsRoutes.js`는 변경할 필요가 없다.

---

## T3-3: Exchange-side Stop Loss (내 담당 항목)

Engineer와 UI 양쪽의 의견을 확인했다:

- **Engineer**: 전략별 SL 정책을 Trader가 정의해야 한다고 요청. Plan Order(`futuresSubmitPlanOrder`) 메서드 추가를 제안.
- **UI**: PositionsTable에 SL 가격 컬럼 추가, StrategyDetail에 SL 표시, SL 체결 시 WS 이벤트 전달 요청.

**응답**:

1. **전략별 SL 정책**: 내 제안서에서 이미 18개 전략의 적합도 분석과 Phase 1(진입 시 SL 포함) + Phase 2(소프트웨어 fallback 유지) 계획을 제시했다. 이것으로 진행한다.

2. **Plan Order는 이번 라운드에서 구현하지 않는다**: `presetStopLossPrice`(주문 생성 시 preset SL)만으로 Phase 1의 목적(봇 장애 시 기본 보호)을 달성할 수 있다. Plan Order는 SL 가격 동적 변경, trailing stop 등 고급 기능에 필요하며, 이는 Phase 3(후속 라운드)에서 다룬다.

3. **UI의 SL 표시 요청**: 동의한다. 포지션 조회 시 Bitget API가 `holdSide`와 함께 preset SL/TP 정보를 반환하는지 확인이 필요하다. 반환하지 않으면, 봇 내부적으로 포지션 메타데이터에 SL 가격을 저장하고 프론트엔드에 전달해야 한다.

4. **SL 가격 정밀도(tick size)**: 내 제안서에서 언급한 대로, 심볼별 tick size 라운딩이 필수이다. 현재 `exchangeClient`가 `instruments` 정보를 캐싱하고 있으므로, SL 가격도 `floorToStep(slPrice, tickSize)`으로 라운딩해야 한다.

---

## 우선순위 합의 도출

3개 에이전트의 우선순위 비교:

| ID | Trader 순위 | Engineer 순위 | UI 순위 | 합의 제안 |
|:---:|:---:|:---:|:---:|:---:|
| T3-1 (테스트) | 2 | 1 | 2 | **1** -- 3에이전트 합의 상위 |
| T3-2 (인증) | 3 | 2 | 3 | **2** -- 3에이전트 합의 상위 |
| T3-3 (SL) | 1 | 5 | 5 | **3** -- Trader 관점 필수, 다른 에이전트 하위지만 안전성 직결 |
| T3-5 (Prometheus) | 6 | 4 | 6 | **5** -- 3에이전트 합의 하위 |
| T3-6 (대시보드) | 4 | 6 | 1 | **4** -- UI 핵심 담당 |
| T3-7 (traceId) | 5 | 3 | 4 | **6** -- 중요하지만 긴급도 낮음 |

**합의 우선순위**: T3-1 > T3-2 > T3-3 > T3-6 > T3-5 > T3-7

**실행 순서 제안 (Phase 분배)**:

```
Phase 1 (기반 + 보안):
  Track A: T3-1 백엔드 테스트 (Jest) + T3-2 API Key 미들웨어 -- Engineer
  Track B: T3-3 전략별 SL 가격 추가 (Phase 1) -- Trader
  Track C: T3-1 프론트엔드 테스트 (Vitest) + T3-6 PerformanceTabs -- UI

Phase 2 (관측성 + 확장):
  Track A: T3-5 Prometheus + T3-7 traceId -- Engineer
  Track B: Map 직렬화 버그 수정 + getByStrategy() 확장 -- Engineer/Trader
  Track C: T3-2 프론트엔드 헤더 + T3-6 잔여 차트 -- UI
```

---

## 요약: 항목별 최종 판정

| 항목 | 대상 | 판정 | 핵심 사유/보완 |
|------|------|:---:|------|
| T3-1 (Jest vs Vitest) | Engineer + UI | 조건부 동의 | 백엔드 Jest + 프론트엔드 Vitest 이중 체계. 트레이딩 edge case 테스트 보강 필요 |
| T3-2 (API Key) | Engineer | 조건부 동의 | timing-safe 적절. 실거래 모드 API_KEY 미설정 방어 추가, CORS 동시 강화, Authorization: Bearer 사용 |
| T3-5 (Prometheus) | Engineer | 조건부 동의 | 카탈로그 대체로 충분. fill_latency, slippage_bps 등 5개 메트릭 추가. latency 버킷 조정 필요 |
| T3-6 (대시보드) | UI | 조건부 동의 | 탭 구조 좋음. profitFactor/expectancy/W:L ratio 등 핵심 지표 추가 필수. KPI 카드 개선. 크로스탭/산점도는 2순위 |
| T3-7 (traceId) | Engineer | 동의 | AsyncLocalStorage 설계 적절. WS 핸들러에서의 traceId 복원 전략 보완 필요 |
| Map 직렬화 버그 | 3에이전트 공통 | 동의 | performanceTracker.js에서 직접 Object 반환으로 수정 (analyticsRoutes.js 변환보다 우월) |
