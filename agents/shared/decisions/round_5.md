# Round 5 합의 결정문서

> 생성일: 2026-02-15
> 주제: Tier 3 Enhancement (6건)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | Track |
|----|------|----------|------|-------|
| T3-1 | 테스트 프레임워크 (BE Jest + FE Jest) | 3/3 동의 | E+U | A+C |
| T3-2 | API 인증 (1단계 API Key) | 3/3 동의 | E+U | A+C |
| T3-3 | Exchange-side stop loss (Phase 1: presetSL) | 2/3+조건부 | T+E | B |
| T3-5 | Prometheus 메트릭/모니터링 | 3/3 동의 | E | A |
| T3-6 | 성과 귀인 대시보드 (PerformanceTabs) | 2/3+조건부 | U+E | C+A |
| T3-7 | Correlation ID (AsyncLocalStorage traceId) | 3/3 동의 | E+U | A+C |
| BUG-1 | Map 직렬화 버그 (performanceTracker) | 3/3 즉시수정 | E | A |

---

## 아키텍처 결정

### AD-25: Test Framework — BE Jest + FE Jest (Vitest Fallback)
- **결정**: 백엔드는 Jest, 프론트엔드는 Jest + `@next/jest`로 통일. React 19 + jsdom 호환 문제 발생 시 프론트엔드만 Vitest로 전환 허용.
- **근거**:
  - 백엔드 CommonJS 환경에서 Jest는 zero-config 수준 (Engineer/Trader 합의)
  - 테스트 도입 초기 단계에서 단일 러너가 학습 비용 최소화 (UI 리뷰 동의)
  - Vitest fallback 옵션으로 유연성 확보 (UI 원안 보전)
- **상세**:
  - 백엔드: `jest` + `mongodb-memory-server`
  - 프론트엔드: `jest` + `@next/jest` + `@testing-library/react` + `jest-environment-jsdom`
  - 커버리지: istanbul 포맷으로 통일
  - 루트 `npm test`로 양쪽 순차 실행
  - 테스트 우선순위: mathUtils → RiskEngine(CB+DD+EG) → OrderManager → PaperEngine → API routes
  - 프론트엔드 P0: `lib/utils.ts`, `lib/drawdown.ts` (순수 함수)

### AD-26: API Authentication — API Key with Bearer Header
- **결정**: 1단계 API Key 인증을 `Authorization: Bearer <key>` 헤더로 구현. `crypto.timingSafeEqual()` 사용.
- **근거**:
  - RFC 6750 표준 → 향후 JWT 전환 시 헤더 변경 불필요 (Trader 리뷰)
  - 단일 운영자 로컬/VPN 환경에서 API Key만으로 충분 (3에이전트 합의)
  - `NEXT_PUBLIC_API_KEY` 클라이언트 노출은 현재 아키텍처에서 허용 가능 (Engineer/UI 합의)
- **상세**:
  - `backend/src/middleware/apiKeyAuth.js` 신규 생성
  - 인증 면제: `/api/health`, `/metrics`
  - `API_KEY` 미설정 시 인증 비활성화 (개발 편의) + 경고 로그 출력
  - 실거래 모드(`PAPER_TRADING=false`)에서 `API_KEY` 미설정 시 강화 경고 (Trader 보완)
  - CORS: `Access-Control-Allow-Origin`을 프론트엔드 URL로 제한 (Trader 보완)
  - CORS: `Access-Control-Expose-Headers: X-Trace-Id` 추가 (UI 요청, T3-7 연동)
  - 프론트엔드: `api-client.ts`의 `request()`에 `Authorization: Bearer ${API_KEY}` 헤더 추가

### AD-27: Exchange-side Stop Loss — presetStopLossPrice Phase 1
- **결정**: 전략 진입 시그널에 `stopLossPrice` 필드를 추가하여 Bitget `presetStopLossPrice` 활용. 소프트웨어 SL을 fallback으로 유지(이중 안전망). Plan Order는 후속 라운드.
- **근거**:
  - 기존 파이프라인 완비 (exchangeClient + orderManager 모두 지원) (Trader 분석)
  - 봇 장애/네트워크 단절 시 자산 보호 — 실거래 최대 리스크 시나리오 제거 (Trader 1순위)
  - Phase 1만으로 핵심 안전성 확보, Phase 3 복잡성 회피 (Engineer 동의)
- **상세**:
  - 적합도 높음(11개): 진입 시점 SL 확정 가능 (ATR 고정, 고정 %, 스윙 포인트, 피보나치 등)
  - 적합도 중간(5개): 초기 SL만 exchange-side, trailing은 소프트웨어
  - 적합도 낮음(2개, Grid+FundingRate): exchange-side SL 미적용
  - **필수 보완 3건** (Engineer 조건):
    1. SL 가격 tick size 라운딩 (심볼별 pricePlace 준수)
    2. SL 체결 WS 이벤트 처리 확인 (별도 orderId 매핑)
    3. PaperEngine SL 시뮬레이션 (`_pendingSLOrders` Map + `onTickerUpdate` 확장)
  - 프론트엔드: PositionsTable에 SL 가격 컬럼 추가 (UI 요청)

### AD-28: Prometheus Metrics — prom-client Singleton + /metrics Endpoint
- **결정**: `prom-client` 패키지로 메트릭 레지스트리 싱글턴(`utils/metrics.js`) 구현. `/metrics` 엔드포인트로 Prometheus scrape 지원.
- **근거**:
  - 현재 관측 수단이 JSON 로그 + /api/health뿐 (Engineer 분석)
  - 업계 표준 패턴 (3에이전트 합의)
  - 프론트엔드는 `/metrics` 직접 소비 불가 → `/api/health` 확장으로 일부 집계값 JSON 제공 (UI 의견)
- **상세**:
  - 4개 카테고리: 시스템(기본), HTTP(미들웨어), 트레이딩(비즈니스), 리스크/인프라
  - Trader 추가 메트릭 5건: fill_latency, slippage_bps, pnl_per_trade, uptime, hold_seconds
  - latency 버킷 조정: `[0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5]` (Trader 보완)
  - `/metrics` 인증: PUBLIC_PATHS에 포함 (Prometheus scraper 접근 보장)
  - 계측 지점: exchangeClient._withRetry(), riskEngine.validateOrder(), orderManager.submitOrder(), botService._handleStrategySignal()

### AD-29: Correlation ID — AsyncLocalStorage traceId Propagation
- **결정**: `AsyncLocalStorage` 기반 `traceContext.js` 모듈로 traceId 전파. HTTP 미들웨어 + 전략 시그널 체인 이중 진입점.
- **근거**:
  - async/await 체인 전체에서 컨텍스트 자동 전파 (Engineer 설계)
  - 동시 주문 시 로그 추적 불가능 → traceId로 즉시 해결 (Trader 가치 분석)
- **상세**:
  - traceId 형식: `trc_` + 12 hex chars (48비트 엔트로피) — UUID v4보다 짧아 로그 가독성 우수 (Trader 동의)
  - Express 미들웨어: `X-Trace-Id` 요청 헤더에서 추출 또는 자동 생성, 응답 헤더에 포함
  - logger.js: `getTraceId()` 자동 호출로 모든 로그에 traceId 포함
  - BotService._handleStrategySignal(): `runWithTrace(generateTraceId(), async () => {...})`
  - Trade 모델 metadata에 traceId 저장
  - **WS 핸들러 traceId 복원**: orderId → traceId In-memory Map 매핑 (Trader 보완)
  - 프론트엔드: `ApiError`에 `traceId` 필드 추가 + `request()`에서 `X-Trace-Id` 헤더 추출 (UI 설계)

### AD-30: Performance Dashboard — PerformanceTabs with Extended Metrics
- **결정**: 대시보드 Row 3에 탭 기반 `PerformanceTabs` 컴포넌트 도입. 4개 탭: 에쿼티 커브(기존), 전략별 성과, 심볼별 성과, 일별 성과. 백엔드 `getByStrategy`/`getBySymbol` 확장 메트릭 포함.
- **근거**:
  - 백엔드 API 이미 완비 → 프론트엔드 시각화만 구현 (3에이전트 공통 발견)
  - 세션 컨텍스트 유지 위해 탭 통합 (별도 /analytics 페이지 불필요) (Trader/UI 원안 합의)
  - 트레이더 의사결정에 profitFactor, expectancy 등 핵심 지표 필수 (Trader 강력 요청)
- **상세**:
  - 확장 메트릭 (getByStrategy/getBySymbol): avgPnl, profitFactor, avgWin, avgLoss, expectancy, largestWin, largestLoss, pnlContribution
  - cross-tab, strategy-correlation 엔드포인트는 후속 라운드 (Engineer 조건)
  - 테이블: Progressive Disclosure — 핵심 5개 컬럼 + 클릭 확장 상세 (UI 설계)
  - 시각화 우선순위: StrategyPerformanceTable > DailyPnlChart > PnlBarChart (가로 막대)
  - 폴링: 봇 running 시에만 30초 간격 (useAdaptivePolling 패턴)
  - 타입: `StrategyPerformanceEntry`, `SymbolPerformanceEntry`, `DailyPerformanceEntry` 추가

### AD-31: Map Serialization Fix — performanceTracker Returns Plain Object
- **결정**: `performanceTracker.js`의 `getByStrategy()`와 `getBySymbol()`이 `Map` 대신 plain `Object`를 반환하도록 수정.
- **근거**:
  - `JSON.stringify(new Map())` → `'{}'` — 모든 데이터 유실 (3에이전트 독립 발견)
  - `getSessionStats()`와 `getDailyStats()`는 이미 plain object/array 반환 → Map만 불일치 (Trader 근거)
  - 소비자가 변환을 신경 쓸 필요 없는 원천 수정이 적절 (Trader 근거)
- **상세**: `const result = new Map()` → `const result = {}`, `.set()` → `result[key] = value`

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|------|------|
| T3-1 FE 테스트 러너 | Jest/Vitest 양쪽 수용 | Jest 통일 | Vitest 권장 | **Jest 기본, Vitest fallback** — 초기 도입에서 통일이 학습비용 최소. React 19 이슈 시 전환 |
| T3-2 헤더 형식 | `Authorization: Bearer` | `Authorization: Bearer` | `X-API-Key` | **`Authorization: Bearer`** — RFC 6750 표준, JWT 전환 시 변경 불필요 |
| T3-3 Phase 순서 | Phase 1 즉시 + Phase 3 후속 | Phase 1 조건부 (보완 3건) | SL UI 표시 동시 | **Phase 1 + 보완 3건 동시** — 안전성은 Trader, 시스템 무결성은 Engineer 만족 |
| T3-6 Map 수정 위치 | performanceTracker.js (원천) | analyticsRoutes.js (직렬화 직전) | 무관 | **performanceTracker.js** — 다른 메서드와의 일관성, 소비자 부담 제거 |
| T3-6 페이지 구조 | 탭 통합 동의 | 탭 통합 동의 | 탭 → 후에 별도 페이지 변경 | **탭 통합** — 세션 컨텍스트 유지가 핵심 |
| T3-5 latency 버킷 | [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5] | [0.1, 0.25, 0.5, 1, 2.5, 5, 10] | 무관 | **Trader 안** — 50ms-200ms 구간 분해능이 슬리피지 분석에 필수 |
| 우선순위 | T3-3 > T3-1 > T3-2 | T3-1 > T3-2 > T3-7 | T3-6 > T3-1 > T3-2 | **T3-1 > T3-2 > T3-3 > T3-6 > T3-7 > T3-5** |

---

## 실행 계획

### Phase 1 (기반 + 보안 + 핵심 기능, 병렬 실행)

| Track | 항목 | 담당 | 산출물 |
|-------|------|------|--------|
| Track A | BUG-1 Map 직렬화 수정 | E | performanceTracker.js 수정 |
| Track A | T3-1 BE 테스트 (Jest 설정 + mathUtils/RiskEngine 테스트) | E | jest.config.js + __tests__/ |
| Track A | T3-2 API Key 미들웨어 + CORS 강화 | E | apiKeyAuth.js + app.js 수정 |
| Track B | T3-3 전략 SL 가격 추가 (적합도 높음 11개 우선) | T+E | strategies/*.js 수정 |
| Track B | T3-3 PaperEngine SL 시뮬레이션 | E | paperEngine.js 확장 |
| Track C | T3-6 PerformanceTabs + 시각화 3개 | U | components/analytics/*.tsx |
| Track C | T3-6 usePerformanceAnalytics 훅 + 타입 정의 | U | hooks/ + types/ |
| Track C | T3-2 FE Authorization 헤더 추가 | U | api-client.ts 수정 |

### Phase 2 (관측성 + 확장, Phase 1 완료 후)

| Track | 항목 | 담당 | 산출물 |
|-------|------|------|--------|
| Track A | T3-7 AsyncLocalStorage traceId + logger 통합 | E | traceContext.js + logger.js + app.js |
| Track A | T3-5 Prometheus metrics.js + /metrics + 계측 | E | metrics.js + 서비스 파일 수정 |
| Track A | T3-6 BE getByStrategy/getBySymbol 확장 메트릭 | E | performanceTracker.js 확장 |
| Track C | T3-3 PositionsTable SL 컬럼 | U | PositionsTable.tsx + types 수정 |
| Track C | T3-7 ApiError traceId + request() 헤더 추출 | U | api-client.ts 수정 |

### 의존성

```
BUG-1 (Map fix) ──→ T3-6 (프론트엔드가 데이터를 받을 수 있어야 함)
T3-2 BE (미들웨어) ──→ T3-2 FE (헤더 추가)
T3-3 BE (SL 로직) ──→ T3-3 FE (SL 컬럼)
T3-7 BE (traceId) ──→ T3-7 FE (ApiError 확장)
```

---

## 다음 단계

1. Phase 4에서 위 실행 계획에 따라 구현
2. 워크트리 없이 master 직접 작업 (항목 간 파일 충돌 없음)
3. 구현 완료 후 BACKLOG 상태 `done`으로 업데이트
4. Phase 5~7에서 문서 최신화 + 커밋 + 푸시
