# Round 5 Proposal — Tier 3 Enhancement (6건)

> **Agent**: Senior Systems Engineer
> **Date**: 2026-02-15
> **Base commit**: 1e597ad (Sprint R4: Tier 2 Quality 12건 완료)
> **Scope**: T3-1, T3-2, T3-3, T3-5, T3-6, T3-7 — 시스템 무결성 관점 심층 분석

---

## 분석 요약

Round 4까지 Tier 0~2 (32건)을 모두 완료한 후, 남은 Tier 3 Enhancement 6건을 분석한다.
이 중 **T3-1(테스트 프레임워크)**, **T3-2(API 인증/인가)**, **T3-5(Prometheus 메트릭)**, **T3-7(Correlation ID)** 4건은 내가 직접 제안한 항목이므로 심층 설계를 포함한다.

**핵심 발견**:

1. **T3-1 (테스트 프레임워크)**: `backend/package.json`의 `test` 스크립트가 `echo "Error: no test specified" && exit 1`로 되어 있다. 테스트 인프라가 전무한 상태에서 32건의 코드가 무검증으로 운영되고 있다. 이것이 가장 시급하다.

2. **T3-2 (API 인증/인가)**: 현재 9개 라우트 파일 전체에 인증 미들웨어가 없다. `POST /api/bot/start`, `POST /api/trades/order`, `POST /api/bot/emergency-stop` 등 실제 주문/봇 제어 엔드포인트가 인터넷에 노출될 경우 누구나 호출 가능하다. Rate limiter(T2-7)는 IP 기반 속도 제한만 수행하며 신원 검증은 하지 않는다.

3. **T3-5 (Prometheus 메트릭)**: 현재 관측 수단이 JSON 로그(`logger.js`)와 `/api/health` 헬스체크뿐이다. 봇 운영 시간, 주문 성공/실패율, 레이턴시 분포, 리스크 이벤트 빈도, 메모리 추세 등 핵심 운영 지표를 실시간으로 수집/알림할 수 있는 인프라가 없다.

4. **T3-7 (Correlation ID)**: 현재 로거는 `prefix`(컴포넌트명)만 포함하며, 개별 요청이나 신호 처리 체인을 추적할 수 있는 고유 식별자가 없다. 분산 환경이 아니더라도, 단일 요청이 botService -> strategyRouter -> signalFilter -> orderManager -> riskEngine -> exchangeClient를 거치는 과정을 하나의 ID로 추적할 수 없다.

5. **T3-3 (Exchange-side stop loss)**: 현재 `placeOrder()`에서 `stopLossPrice`를 `presetStopLossPrice`로 전달하고 있으나, 이것은 주문 생성 시점의 preset SL이지 독립적인 exchange-side stop order가 아니다. Bitget의 별도 trigger order API를 활용해야 실질적인 server-side SL이 보장된다.

6. **T3-6 (성과 귀인 대시보드)**: 백엔드에 `analyticsApi.getByStrategy()`와 `analyticsApi.getBySymbol()` API가 이미 존재하지만, 프론트엔드에서 이를 시각화하는 컴포넌트가 없다. `useAnalytics.ts` 훅은 `getEquityCurve`와 `getSession`만 호출한다.

---

## T3-1: 테스트 프레임워크 구축 (심층 분석)

### 현재 상태 (코드 근거)

**`backend/package.json`** (라인 6):
```json
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

**`frontend/package.json`**: 테스트 관련 의존성 없음. `devDependencies`에 eslint, tailwind, typescript만 존재.

테스트 프레임워크, mock 라이브러리, 코드 커버리지 도구가 전무하다. 32건의 기능이 수동 확인에만 의존하고 있다.

### Jest vs Vitest 비교 분석

| 기준 | Jest | Vitest |
|------|------|--------|
| **CommonJS 지원** | 네이티브 (Node.js 기본) | ESM 기본, CJS에 transform 필요 |
| **설정 복잡도** | 백엔드 CJS에는 zero-config 수준 | `vitest.config.js` + 약간의 설정 |
| **실행 속도** | 느린 편 (worker 기반, JIT) | 빠름 (Vite dev server, native ESM) |
| **프론트엔드 (Next.js)** | `@next/jest` 공식 지원 | 별도 설정 필요 (`@vitejs/plugin-react`) |
| **생태계 성숙도** | 10년+, 문서/예제 풍부 | 3년+, 빠르게 성장 중 |
| **Mongoose/MongoDB mock** | `jest.mock()` 네이티브, `mongodb-memory-server` 잘 통합 | 동일하게 가능하나 `vi.mock()` 문법 차이 |
| **Watch mode** | `--watch` (파일 변경 감지) | 기본 내장, Vite HMR 기반으로 더 빠름 |

**권고**: **Jest를 권장한다**. 이유:
1. 백엔드가 CommonJS 전용이므로 Jest의 네이티브 CJS 지원이 설정 비용을 최소화
2. Next.js 15는 `@next/jest` 공식 지원
3. Mongoose 테스트에 대한 문서/예제가 풍부
4. 팀이 테스트를 처음 도입하는 단계이므로 안정적인 도구가 우선

### 테스트 우선순위 (어떤 서비스부터)

**1순위: Safety-Critical 서비스 (단위 테스트)**

| 서비스 | 파일 | 테스트 포인트 | 이유 |
|--------|------|---------------|------|
| `mathUtils.js` | `utils/mathUtils.js` | add, subtract, multiply, divide, pctChange, isZero, floorToStep | 모든 금전적 연산의 기반. 부동소수점 오류가 직접 자산 손실 |
| `CircuitBreaker` | `services/circuitBreaker.js` | trip, reset, recordTrade, rapidLosses 윈도우, 연속 손실 | 안전 장치의 핵심 로직 |
| `ExposureGuard` | `services/exposureGuard.js` | validateOrder, equity=0 방어, qty 조정 | 포지션 크기 제한의 정확성 |
| `DrawdownMonitor` | `services/drawdownMonitor.js` | check, updateEquity, resetDaily, halt 조건 | 낙폭 제한 정확성 |
| `RiskEngine` | `services/riskEngine.js` | validateOrder 체인 (CB -> DD -> EG 순서), 이벤트 발행 | 전체 리스크 게이트웨이 |

**2순위: 핵심 비즈니스 로직 (단위 테스트)**

| 서비스 | 테스트 포인트 |
|--------|---------------|
| `OrderManager` | submitOrder flow, 리스크 거부 처리, 뮤텍스 동작, paper/live 분기 |
| `PaperEngine` | market fill, limit fill, 슬리피지/수수료 적용 |
| `PaperPositionManager` | onFill PnL 계산, 포지션 open/close |

**3순위: API 라우트 (통합 테스트)**

| 라우트 | 테스트 포인트 |
|--------|---------------|
| `botRoutes` | start/stop/pause/resume 상태 전이, 입력 검증 |
| `tradeRoutes` | order 제출, 취소, 조회 |
| `riskRoutes` | drawdown reset, 이벤트 조회 |

**4순위: 프론트엔드 (컴포넌트 테스트)**
- React Testing Library + Jest
- 핵심 훅 (`useBotStatus`, `usePositions`) 유닛 테스트
- 위험 UI (`EmergencyStopDialog`, `RiskAlertBanner`) 렌더 테스트

### 테스트 구조 설계

```
backend/
  __tests__/
    unit/
      utils/
        mathUtils.test.js
      services/
        circuitBreaker.test.js
        exposureGuard.test.js
        drawdownMonitor.test.js
        riskEngine.test.js
        orderManager.test.js
        paperEngine.test.js
        paperPositionManager.test.js
    integration/
      api/
        botRoutes.test.js
        tradeRoutes.test.js
        riskRoutes.test.js
    helpers/
      testSetup.js            # MongoDB in-memory, mock 팩토리
      mockExchangeClient.js   # exchangeClient 싱글턴 mock
      mockServices.js         # 공통 서비스 mock 팩토리
  jest.config.js

frontend/
  __tests__/
    hooks/
      useBotStatus.test.ts
      usePositions.test.ts
    components/
      EmergencyStopDialog.test.tsx
      RiskAlertBanner.test.tsx
  jest.config.ts
  jest.setup.ts
```

### 구현 계획

```bash
# 백엔드
npm install --save-dev jest @types/jest mongodb-memory-server

# 프론트엔드
npm install --save-dev jest @types/jest @testing-library/react @testing-library/jest-dom @next/jest jest-environment-jsdom
```

**`backend/jest.config.js`**:
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  setupFilesAfterSetup: ['./__tests__/helpers/testSetup.js'],
};
```

**예상 난이도**: 중간 (인프라 셋업 1일 + 1순위 테스트 작성 2일)
**예상 영향**: 극히 높음 — 향후 모든 변경의 회귀 방지 기반

---

## T3-2: API 인증/인가 (심층 분석)

### 현재 상태 (코드 근거)

**`app.js`** (라인 224~271) — 미들웨어 체인:
```
1. express.json()
2. CORS (Access-Control-Allow-Origin: *)
3. Rate limiters (IP 기반)
4. 라우트 마운트 — 인증 미들웨어 없음
```

**9개 라우트 파일 전체 스캔 결과**: `req.headers.authorization`, `req.user`, `authenticate`, `auth` 등의 키워드가 어디에도 존재하지 않는다.

**CORS 설정** (라인 229): `Access-Control-Allow-Origin: '*'` — 모든 출처에서 요청 가능.

**위험도 분석**:

| 엔드포인트 | HTTP Method | 위험도 | 이유 |
|-----------|-------------|--------|------|
| `/api/bot/start` | POST | **CRITICAL** | 봇 시작 — 실제 자금 투입 |
| `/api/bot/stop` | POST | **HIGH** | 봇 중단 — 운영 방해 |
| `/api/bot/emergency-stop` | POST | **HIGH** | 긴급정지 — rate limit도 없음 |
| `/api/trades/order` | POST | **CRITICAL** | 수동 주문 — 직접 자금 소비 |
| `/api/bot/risk-params` | PUT | **CRITICAL** | 리스크 파라미터 변경 — 안전장치 무력화 가능 |
| `/api/paper/reset` | POST | **MEDIUM** | 페이퍼 계좌 초기화 |
| `/api/tournament/start` | POST | **LOW** | 토너먼트 시작 |
| `/api/bot/status` | GET | **LOW** | 읽기 전용 |
| `/api/health/ping` | GET | **NONE** | 공개 상태 확인 |

### 1단계 구현안: API Key 인증

**설계 원칙**:
- 단순 + 즉시 효과: 환경변수에 API key 설정, `Authorization: Bearer <key>` 헤더 검증
- health/ping 엔드포인트는 인증 면제 (모니터링 시스템 접근 보장)
- rate limiter와 독립 동작 (인증 실패도 429 카운트에 포함하지 않음)

**`backend/src/middleware/apiKeyAuth.js`** (신규):

```javascript
'use strict';

const { createLogger } = require('../utils/logger');
const crypto = require('crypto');

const log = createLogger('ApiKeyAuth');

const API_KEY = process.env.API_KEY || '';

// 인증 면제 경로 (prefix match)
const PUBLIC_PATHS = [
  '/api/health',
];

function createApiKeyAuth() {
  if (!API_KEY) {
    log.warn('API_KEY not configured — authentication is DISABLED');
    return (_req, _res, next) => next();
  }

  log.info('API key authentication enabled');

  return (req, res, next) => {
    // 인증 면제 경로 체크
    for (const path of PUBLIC_PATHS) {
      if (req.path.startsWith(path)) {
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn('Missing or malformed Authorization header', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
      return res.status(401).json({
        success: false,
        error: '인증이 필요합니다. Authorization: Bearer <API_KEY> 헤더를 포함하세요.',
      });
    }

    const providedKey = authHeader.slice(7);

    // Timing-safe comparison to prevent timing attacks
    const keyBuffer = Buffer.from(API_KEY, 'utf-8');
    const providedBuffer = Buffer.from(providedKey, 'utf-8');

    if (keyBuffer.length !== providedBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
      log.warn('Invalid API key', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({
        success: false,
        error: '유효하지 않은 API 키입니다.',
      });
    }

    next();
  };
}

module.exports = { createApiKeyAuth };
```

**`app.js` 통합 위치** (라인 226, CORS 바로 뒤):
```javascript
const { createApiKeyAuth } = require('./middleware/apiKeyAuth');
// ...
app.use(createApiKeyAuth());  // CORS 뒤, rate limiter 앞
```

**`.env` 추가**:
```
API_KEY=your-secret-api-key-here
```

**프론트엔드 연동**:
- `frontend/.env.local`에 `NEXT_PUBLIC_API_KEY` 추가
- `lib/api-client.ts`의 `request()` 함수에 `Authorization: Bearer ${API_KEY}` 헤더 추가

### 2단계 로드맵: JWT (향후)

JWT는 다음 조건이 충족될 때 도입한다:
1. 다중 사용자 접근이 필요할 때 (현재는 단일 운영자)
2. 권한 수준 분리가 필요할 때 (읽기 전용 뷰어 vs 관리자)
3. 세션 관리/토큰 갱신 인프라가 필요할 때

JWT 도입 시 구조:
```
POST /api/auth/login  { username, password } → { accessToken, refreshToken }
POST /api/auth/refresh { refreshToken } → { accessToken }

미들웨어: req.user = { id, role: 'admin' | 'viewer' }
```

**중요**: 1단계 API Key만으로도 현재 시스템의 보안 요구를 충족한다. 단일 운영자, 로컬 또는 VPN 환경 전제.

### 보안 고려사항

1. **timing-safe comparison**: `crypto.timingSafeEqual()` 사용으로 타이밍 공격 방지
2. **API_KEY 미설정 시 안전한 열화**: 환경변수가 없으면 인증 비활성화 (개발 편의), 프로덕션 체크리스트에 포함
3. **CORS 강화**: `Access-Control-Allow-Origin: '*'`를 프론트엔드 URL로 제한 권장
4. **로그에 키 미노출**: API key 자체를 로그에 기록하지 않음

**예상 난이도**: 낮음 (미들웨어 1개 + 프론트엔드 헤더 추가)
**예상 영향**: 높음 — 모든 위험 엔드포인트의 무단 접근 차단

---

## T3-5: Prometheus 메트릭/모니터링 (심층 분석)

### 현재 상태 (코드 근거)

**관측 수단 현황**:

| 수단 | 파일 | 한계 |
|------|------|------|
| 구조화된 JSON 로그 | `utils/logger.js` | 시계열 집계 불가, 패턴 감지 불가 |
| `/api/health` | `api/healthRoutes.js` | 시점 스냅샷만 제공, 추세/이력 없음 |
| Socket.io 이벤트 | `app.js` L302~405 | 프론트엔드 연결 시에만 수신, 영구 저장 없음 |

**수집 불가능한 핵심 지표**:
- 주문 성공/실패율 시계열
- API 응답 레이턴시 분포 (p50/p95/p99)
- 리스크 엔진 거부율 추세
- WebSocket 재연결 빈도
- 메모리/CPU 사용 추세
- 전략별 신호 생성 빈도

### Prometheus 메트릭 설계

**의존성**: `prom-client` (Prometheus 공식 Node.js 클라이언트, 300KB, 의존성 없음)

```bash
npm install prom-client
```

**메트릭 카탈로그** (4개 카테고리):

#### A. 시스템 메트릭 (Node.js 기본)

`prom-client`의 `collectDefaultMetrics()`가 자동 수집:
- `process_cpu_seconds_total` — CPU 사용
- `nodejs_heap_size_total_bytes` — 힙 전체
- `nodejs_heap_size_used_bytes` — 힙 사용
- `nodejs_eventloop_lag_seconds` — 이벤트 루프 지연
- `nodejs_active_handles_total` — 활성 핸들 수

#### B. HTTP 메트릭 (Express 미들웨어)

| 메트릭 이름 | 타입 | 레이블 | 설명 |
|------------|------|--------|------|
| `http_requests_total` | Counter | method, path, status | 총 요청 수 |
| `http_request_duration_seconds` | Histogram | method, path, status | 응답 시간 분포 |
| `http_requests_in_flight` | Gauge | — | 현재 처리 중 요청 수 |

#### C. 트레이딩 메트릭 (비즈니스 레벨)

| 메트릭 이름 | 타입 | 레이블 | 수집 지점 |
|------------|------|--------|----------|
| `trading_orders_total` | Counter | side, strategy, status(submitted/filled/rejected/failed) | OrderManager |
| `trading_signals_total` | Counter | strategy, action, passed(true/false) | SignalFilter |
| `trading_pnl_total` | Counter | strategy, side | OrderManager._handleOrderFilled |
| `trading_positions_active` | Gauge | strategy | PositionManager |
| `trading_equity` | Gauge | mode(paper/live) | BotService 주기적 업데이트 |

#### D. 리스크/인프라 메트릭

| 메트릭 이름 | 타입 | 레이블 | 수집 지점 |
|------------|------|--------|----------|
| `risk_validations_total` | Counter | result(approved/rejected), source(circuit_breaker/drawdown/exposure) | RiskEngine |
| `risk_circuit_breaks_total` | Counter | reason | CircuitBreaker |
| `risk_drawdown_percent` | Gauge | type(daily/total) | DrawdownMonitor |
| `ws_reconnections_total` | Counter | channel(public/private) | ExchangeClient |
| `ws_messages_total` | Counter | topic | ExchangeClient |
| `exchange_api_latency_seconds` | Histogram | method | ExchangeClient._withRetry |
| `exchange_api_errors_total` | Counter | method, error_type | ExchangeClient._withRetry |

### 아키텍처

```
[ExchangeClient] ──metric──> [metricsRegistry] <──scrape── [Prometheus]
[OrderManager]   ──metric──>        │                            │
[RiskEngine]     ──metric──>        │                            v
[BotService]     ──metric──>        │                      [Grafana Dashboard]
                                    │
                      GET /metrics ──┘ (Express route)
```

**구현 패턴**:

**`backend/src/utils/metrics.js`** (신규 — 메트릭 레지스트리 싱글턴):
```javascript
'use strict';

const client = require('prom-client');

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// HTTP metrics
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Trading metrics
const tradingOrdersTotal = new client.Counter({
  name: 'trading_orders_total',
  help: 'Total trading orders by status',
  labelNames: ['side', 'strategy', 'status'],
  registers: [register],
});

const tradingSignalsTotal = new client.Counter({
  name: 'trading_signals_total',
  help: 'Total trading signals',
  labelNames: ['strategy', 'action', 'passed'],
  registers: [register],
});

const tradingEquity = new client.Gauge({
  name: 'trading_equity',
  help: 'Current account equity',
  labelNames: ['mode'],
  registers: [register],
});

// Risk metrics
const riskValidationsTotal = new client.Counter({
  name: 'risk_validations_total',
  help: 'Risk engine validation results',
  labelNames: ['result', 'source'],
  registers: [register],
});

const riskDrawdownPercent = new client.Gauge({
  name: 'risk_drawdown_percent',
  help: 'Current drawdown percentage',
  labelNames: ['type'],
  registers: [register],
});

// Exchange metrics
const exchangeApiLatency = new client.Histogram({
  name: 'exchange_api_latency_seconds',
  help: 'Bitget API latency in seconds',
  labelNames: ['method'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const exchangeApiErrors = new client.Counter({
  name: 'exchange_api_errors_total',
  help: 'Bitget API errors',
  labelNames: ['method', 'error_type'],
  registers: [register],
});

const wsReconnections = new client.Counter({
  name: 'ws_reconnections_total',
  help: 'WebSocket reconnections',
  labelNames: ['channel'],
  registers: [register],
});

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  tradingOrdersTotal,
  tradingSignalsTotal,
  tradingEquity,
  riskValidationsTotal,
  riskDrawdownPercent,
  exchangeApiLatency,
  exchangeApiErrors,
  wsReconnections,
};
```

**`/metrics` 엔드포인트** (app.js에 추가):
```javascript
const { register } = require('./utils/metrics');

// Prometheus scrape endpoint — 인증 면제 또는 별도 키
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

**HTTP 미들웨어** (app.js, express.json() 바로 뒤):
```javascript
const { httpRequestsTotal, httpRequestDuration } = require('./utils/metrics');

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const normalizedPath = _normalizePath(req.route?.path || req.path);
    httpRequestsTotal.inc({ method: req.method, path: normalizedPath, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, path: normalizedPath, status: res.statusCode }, durationSec);
  });
  next();
});
```

### 계측 지점별 코드 변경

| 서비스 | 변경 내용 |
|--------|----------|
| `exchangeClient.js` `_withRetry()` | 성공 시 `exchangeApiLatency.observe()`, 실패 시 `exchangeApiErrors.inc()` |
| `exchangeClient.js` WS handlers | reconnect 이벤트에 `wsReconnections.inc()` |
| `riskEngine.js` `validateOrder()` | approved/rejected별 `riskValidationsTotal.inc()` |
| `orderManager.js` `submitOrder()` | 제출/체결/거부별 `tradingOrdersTotal.inc()` |
| `botService.js` `_handleStrategySignal()` | SignalFilter 통과/차단별 `tradingSignalsTotal.inc()` |
| `botService.js` 주기적 | 10초마다 `tradingEquity.set()` |

**예상 난이도**: 중간 (metrics.js 모듈 + 10~15개 계측 지점)
**예상 영향**: 높음 — 운영 가시성 0% -> 100%

---

## T3-7: Correlation ID (traceId) 전파 (심층 분석)

### 현재 상태 (코드 근거)

**`utils/logger.js`** (라인 55~64) — 로그 엔트리 구조:
```javascript
const entry = {
  timestamp: new Date().toISOString(),
  level: LEVEL_NAMES[level],
  prefix,         // 컴포넌트명 (e.g. 'OrderManager')
  message,
  ...defaultContext,
  ...meta,        // 호출자가 제공하는 임의 데이터
};
```

**문제**: `traceId` 또는 `correlationId` 필드가 없다. 다음과 같은 로그 시퀀스를 추적할 수 없다:

```
[RiskEngine] Order VALIDATED  { symbol: 'BTCUSDT' }
[OrderManager] submitOrder — exchange placeOrder  { symbol: 'BTCUSDT' }
[ExchangeClient] placeOrder — success  { symbol: 'BTCUSDT' }
```

동일 시간에 여러 전략이 동시에 BTCUSDT 주문을 발생시키면, 어느 로그가 어느 주문 체인에 속하는지 구분이 불가능하다.

### 설계: AsyncLocalStorage 기반 traceId 전파

Node.js `AsyncLocalStorage`를 사용하면 async/await 체인 전체에서 컨텍스트를 전파할 수 있다. 이벤트 루프를 넘어가는 await도 자동 추적된다.

**`backend/src/utils/traceContext.js`** (신규):

```javascript
'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const als = new AsyncLocalStorage();

/**
 * Generate a short unique trace ID.
 * Format: 'trc_' + 12 hex chars (48 bits of entropy)
 */
function generateTraceId() {
  return 'trc_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Run a function within a trace context.
 * All async operations within fn() will have access to the traceId.
 */
function runWithTrace(traceId, fn) {
  return als.run({ traceId }, fn);
}

/**
 * Get the current trace ID, or null if not in a trace context.
 */
function getTraceId() {
  const store = als.getStore();
  return store?.traceId || null;
}

module.exports = { generateTraceId, runWithTrace, getTraceId };
```

### 전파 경로

```
HTTP 요청 수신
  │
  ├── [Express 미들웨어] traceId 생성 또는 X-Trace-Id 헤더에서 추출
  │     runWithTrace(traceId, () => next())
  │
  ├── [라우트 핸들러] → botService.start() / orderManager.submitOrder()
  │     │
  │     ├── [RiskEngine] validateOrder()  — getTraceId()로 자동 접근
  │     ├── [ExchangeClient] placeOrder() — getTraceId()로 자동 접근
  │     └── [Trade.create()] — traceId를 metadata에 저장
  │
  └── [응답] X-Trace-Id 헤더로 반환

전략 시그널 (비-HTTP 경로):
  │
  ├── [Strategy] SIGNAL_GENERATED 이벤트
  │     │
  │     ├── [BotService] _handleStrategySignal()
  │     │     runWithTrace(generateTraceId(), async () => { ... })
  │     │
  │     ├── [SignalFilter] filter()
  │     ├── [OrderManager] submitOrder()
  │     └── [RiskEngine] validateOrder()
```

### 코드 변경 지점

**1. Express 미들웨어** (app.js):
```javascript
const { generateTraceId, runWithTrace } = require('./utils/traceContext');

app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || generateTraceId();
  res.setHeader('X-Trace-Id', traceId);
  runWithTrace(traceId, () => next());
});
```

**2. logger.js 수정** — `write()` 함수에 traceId 자동 포함:
```javascript
const { getTraceId } = require('./traceContext');

function write(level, message, meta) {
  if (level < minLevel) return;

  const traceId = getTraceId();  // AsyncLocalStorage에서 자동 추출

  const entry = {
    timestamp: new Date().toISOString(),
    level: LEVEL_NAMES[level],
    prefix,
    message,
    ...(traceId ? { traceId } : {}),  // 존재 시에만 포함
    ...defaultContext,
    ...meta,
  };
  // ...
}
```

**3. BotService._handleStrategySignal()** — 전략 시그널 체인에 traceId 부여:
```javascript
async _handleStrategySignal(signal, sessionId) {
  const traceId = generateTraceId();

  await runWithTrace(traceId, async () => {
    // 기존 signalFilter -> resolveSignalQuantity -> submitOrder 체인
    // 모든 하위 호출에서 getTraceId()로 접근 가능
  });
}
```

**4. Trade 모델 metadata에 traceId 저장** (OrderManager):
```javascript
// Trade.create() 호출 시
metadata: {
  ...existingMetadata,
  traceId: getTraceId(),
}
```

### 결과 로그 예시

변경 전:
```json
{"timestamp":"...","level":"INFO","prefix":"RiskEngine","message":"Order VALIDATED","symbol":"BTCUSDT"}
{"timestamp":"...","level":"TRADE","prefix":"OrderManager","message":"submitOrder — submitted","symbol":"BTCUSDT","orderId":"123"}
```

변경 후:
```json
{"timestamp":"...","level":"INFO","prefix":"RiskEngine","message":"Order VALIDATED","traceId":"trc_a1b2c3d4e5f6","symbol":"BTCUSDT"}
{"timestamp":"...","level":"TRADE","prefix":"OrderManager","message":"submitOrder — submitted","traceId":"trc_a1b2c3d4e5f6","symbol":"BTCUSDT","orderId":"123"}
```

`traceId`로 `grep`하면 하나의 주문 체인 전체를 즉시 추적 가능.

**예상 난이도**: 낮음 (AsyncLocalStorage + 미들웨어 + logger 수정)
**예상 영향**: 중간~높음 — 디버깅 시간 대폭 단축, 특히 동시 주문 시

---

## 나머지 T3 항목 시스템 관점 검토

### T3-3: Exchange-side stop loss 주문

**현재 상태**:

`exchangeClient.js` `placeOrder()` (라인 224~225):
```javascript
if (takeProfitPrice !== undefined) orderParams.presetStopSurplusPrice = String(takeProfitPrice);
if (stopLossPrice !== undefined) orderParams.presetStopLossPrice = String(stopLossPrice);
```

이것은 Bitget의 **preset TP/SL** 기능으로, 주문 생성 시 TP/SL을 함께 설정한다. 주문이 체결되면 거래소가 자동으로 SL 트리거 주문을 생성한다.

**문제점**:
1. **preset SL은 주문 생성 시에만 설정 가능**: 이미 보유 중인 포지션에 SL을 추가/수정할 수 없다
2. **독립적 SL 주문 관리 불가**: SL 가격 변경, trailing stop loss, 조건부 SL 등 고급 기능 불가
3. **서버 장애 시**: 봇이 다운되어도 거래소 서버의 SL은 유지되므로 안전하지만, 현재 구현에서 preset SL이 실제로 설정되는 전략이 있는지 확인 필요

**시스템 관점 의견**:
- Bitget V3 API에는 `futuresSubmitPlanOrder()` (trigger order) 메서드가 존재하며, 이를 통해 독립적인 SL 주문을 관리할 수 있다
- `exchangeClient.js`에 `placeTriggerOrder()`, `cancelTriggerOrder()`, `getTriggerOrders()` 메서드 추가 필요
- **위험도**: 이 기능은 실거래 안전성에 직결. Trader 에이전트가 어떤 전략에서 어떻게 SL을 사용할지 정의해야 한다
- **주의**: trigger order는 별도의 order lifecycle을 가지므로, OrderManager의 상태 관리 로직에 영향

**권장**: Trader 에이전트가 전략별 SL 정책을 정의한 후, 내가 ExchangeClient/OrderManager 확장을 수행

### T3-6: 성과 귀인 대시보드 (by-strategy, by-symbol)

**현재 상태**:

백엔드 API 준비 완료:
- `GET /api/analytics/by-strategy/:sessionId` — `performanceTracker.getByStrategy()` 호출, 전략별 trades/wins/losses/totalPnl/winRate 반환
- `GET /api/analytics/by-symbol/:sessionId` — `performanceTracker.getBySymbol()` 호출, 심볼별 동일 데이터 반환
- `GET /api/trades/strategy-stats/:name` — 개별 전략 상세 통계 + 최근 거래/시그널

프론트엔드 API 클라이언트도 준비 완료:
- `analyticsApi.getByStrategy(sessionId)` (api-client.ts 라인 137)
- `analyticsApi.getBySymbol(sessionId)` (api-client.ts 라인 138)
- `tradeApi.getStrategyStats(name, sessionId)` (api-client.ts 라인 117~119)

**미구현 부분**: 프론트엔드 시각화 컴포넌트
- by-strategy 바 차트/테이블
- by-symbol 파이 차트/테이블
- 전략 간 성과 비교 시계열

**시스템 관점 의견**:
- 이것은 순수 프론트엔드 작업. 백엔드 변경 없음
- `PerformanceTracker.getByStrategy()`가 `Map`을 반환하는데, JSON 직렬화 시 `{}`로 변환되어 빈 객체가 될 수 있음. `trackerService`에서 `Map -> Object` 변환이 필요할 수 있음 (**잠재 버그**)
- **Map 직렬화 문제 확인**: Express의 `res.json()`은 `Map`을 `{}`로 직렬화한다. `analyticsRoutes.js`에서 `trackerService.getByStrategy()`의 반환값을 `Object.fromEntries()`로 변환해야 한다

**권장**: UI 에이전트가 시각화 구현, 내가 Map -> Object 변환 버그 수정

---

## 제안 사항

### 구현 우선순위 (시스템 무결성 기준)

| 순위 | ID | 제목 | 난이도 | 영향 | 근거 |
|------|-----|------|--------|------|------|
| **1** | T3-1 | 테스트 프레임워크 | 중간 | 극히 높음 | 32건 무검증 코드의 회귀 방지 기반. 나머지 T3 품질 검증에 필수 |
| **2** | T3-2 | API 인증/인가 | 낮음 | 높음 | CRITICAL 엔드포인트 무인증 노출. 1단계 API Key로 즉시 효과 |
| **3** | T3-7 | Correlation ID | 낮음 | 중간~높음 | 디버깅 인프라. T3-5 Prometheus와 시너지 (traceId로 메트릭 필터링) |
| **4** | T3-5 | Prometheus 메트릭 | 중간 | 높음 | 운영 가시성. T3-7 traceId와 함께 도입하면 최대 효과 |
| **5** | T3-3 | Exchange stop loss | 중간~높음 | 높음 | 실거래 안전성. Trader 에이전트의 전략 설계 의존 |
| **6** | T3-6 | 성과 귀인 대시보드 | 낮음 | 중간 | UX 강화. 백엔드 API 이미 존재, Map 직렬화 버그만 수정 |

### 구현 순서 추천

```
Phase 1: T3-1 + T3-2 (기반 인프라 + 보안)
  - T3-1: Jest 설정 + mathUtils/RiskEngine 테스트 30+개
  - T3-2: API Key 미들웨어 + 프론트엔드 헤더

Phase 2: T3-7 + T3-5 (관측성)
  - T3-7: AsyncLocalStorage traceId + logger 통합
  - T3-5: prom-client + metrics.js + 계측 지점 15+개

Phase 3: T3-3 + T3-6 (기능 강화)
  - T3-3: ExchangeClient trigger order API + OrderManager 확장
  - T3-6: Map 직렬화 수정 + 프론트엔드 시각화
```

### Track 분배

| Track | 항목 | 담당 |
|-------|------|------|
| Track A (Backend) | T3-1 백엔드 테스트, T3-2, T3-5, T3-7 | Engineer (나) |
| Track B (Backend) | T3-3 exchange stop loss | Engineer + Trader 공동 |
| Track C (Frontend) | T3-1 프론트엔드 테스트, T3-6 | UI 에이전트 |

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게

1. **T3-3 (Exchange stop loss)**: 전략별 SL 정책 정의가 필요하다
   - 어떤 전략이 서버 사이드 SL을 사용해야 하는가?
   - SL 가격은 어떻게 결정하는가? (고정 %, ATR 기반, 지지선 기반 등)
   - trailing stop loss가 필요한 전략이 있는가?
   - SL 주문의 lifecycle 관리 (포지션 청산 시 SL 취소 등)

2. **T3-1 (테스트)**: 전략 로직의 예상 입출력 테스트 케이스 제공
   - 특정 kline 시퀀스에 대한 기대 시그널
   - 에지 케이스: 갭 발생, 거래량 0, NaN 가격 등

### UI 에이전트에게

1. **T3-6 (성과 귀인 대시보드)**: 프론트엔드 시각화 구현
   - `analyticsApi.getByStrategy()` / `getBySymbol()` 데이터 시각화
   - 전략별 PnL 바 차트, 승률 비교, 심볼별 파이 차트
   - **주의**: 백엔드 응답이 `Map`일 수 있으므로, 빈 객체 `{}` 수신 시 대응 필요 (내가 백엔드 수정 예정)

2. **T3-2 (API Key)**: 프론트엔드 API 클라이언트에 `Authorization` 헤더 추가
   - `.env.local`에 `NEXT_PUBLIC_API_KEY` 환경변수
   - `lib/api-client.ts`의 `request()` 함수에 헤더 추가

3. **T3-1 (테스트)**: 프론트엔드 Jest 설정 + 핵심 컴포넌트 테스트
   - `@next/jest` + `@testing-library/react` 설정
   - `EmergencyStopDialog`, `RiskAlertBanner`, `BotControlPanel` 렌더 테스트
   - 커스텀 훅 (`useBotStatus`, `usePositions`) 단위 테스트

---

## 발견된 잠재 버그

### Map 직렬화 문제 (T3-6 관련)

**파일**: `backend/src/services/performanceTracker.js`

`getByStrategy()` (라인 371) 와 `getBySymbol()` (라인 433)은 `Map`을 반환한다:
```javascript
const result = new Map();
// ...
return result;
```

`trackerService.js`는 이 Map을 그대로 반환하고, `analyticsRoutes.js`는 `res.json()`으로 직렬화한다.

`JSON.stringify(new Map())` 의 결과는 `'{}'` — 빈 객체. 모든 데이터가 유실된다.

**수정**: `trackerService.js` 또는 `analyticsRoutes.js`에서 `Object.fromEntries()` 변환 추가:
```javascript
// analyticsRoutes.js — getByStrategy 핸들러
const statsMap = await trackerService.getByStrategy(sessionId);
const stats = Object.fromEntries(statsMap);
res.json({ success: true, data: stats });
```

이 버그는 T3-6과 관계없이 기존 `/api/analytics/by-strategy` 및 `/api/analytics/by-symbol` 엔드포인트에 이미 존재한다. **즉시 수정 권장**.
