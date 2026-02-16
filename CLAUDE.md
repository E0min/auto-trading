# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Bitget 거래소 기반 암호화폐 자동매매 플랫폼. 모노레포 구조:

- **`backend/`** — Node.js/Express API 서버 (포트 3001). CommonJS 전용.
- **`frontend/`** — Next.js 15 App Router 대시보드 (포트 3000). TypeScript.

각 패키지는 `node_modules`를 별도 관리하므로 각 디렉토리에서 `npm install` 개별 실행 필요.

## 명령어

### 백엔드 (`backend/`)
```bash
node src/app.js                         # 서버 실행 (포트 3001, MongoDB 필요)
node backend/scripts/runAllBacktest.js   # 18개 전략 일괄 백테스트 → data/bt_all_results.json
```

### 프론트엔드 (`frontend/`)
```bash
npm run dev      # 개발 서버 (localhost:3000)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
```

MongoDB 미설치 시 서버 시작 실패 (ECONNREFUSED).

### 테스트 (`backend/`)
```bash
npm test                                   # Jest 전체 테스트 실행
npx jest --coverage                        # 커버리지 포함 실행
```

## 환경 변수

`backend/.env`:
- `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE` — 거래소 API 인증
- `PORT` (기본 3001), `MONGO_URI` (기본 `mongodb://localhost:27017/tradingBot`)
- `LOG_LEVEL` (DEBUG/INFO/TRADE/WARN/ERROR, 기본 INFO)
- `PAPER_TRADING=true` — 페이퍼 트레이딩 모드 활성화
- `TOURNAMENT_MODE=true` — 토너먼트 모드 활성화
- `API_KEY` — API 인증 키 (미설정 시 인증 비활성화)
- `CORS_ORIGIN` — CORS 허용 오리진 (기본 `*`)

`frontend/.env.local`:
- `NEXT_PUBLIC_API_URL` (기본 `http://localhost:3001`)
- `NEXT_PUBLIC_SOCKET_URL` (기본 `http://localhost:3001`)
- `NEXT_PUBLIC_API_KEY` — API 인증 키 (백엔드 `API_KEY`와 동일)

## 핵심 아키텍처 패턴

### 의존성 주입 (DI)
`backend/src/app.js`의 `bootstrap()`에서 모든 서비스를 순서대로 생성하고 주입:
```
exchangeClient (싱글턴) → riskEngine → orderManager/positionManager
→ marketData → tickerAggregator → coinSelector/marketRegime
→ indicatorCache/fundingDataService/strategyRouter/signalFilter → botService (오케스트레이터)

미들웨어 체인: CORS → traceContext → apiKeyAuth → httpMetrics → rateLimiter → routes
```
모든 API 라우트 파일은 팩토리 함수를 export: `createBotRoutes({ botService, riskEngine })`

### 금액 값 = 문자열
모든 금전적 값은 **String 타입**으로 처리. `backend/src/utils/mathUtils.js`로 산술 연산 (`add`, `subtract`, `multiply`, `divide`, `pctChange`, 비교 함수 등). 부동소수점 직접 사용 금지.

### ExchangeClient 싱글턴
`exchangeClient.js`가 bitget-api SDK의 **유일한** 소비자. 다른 모듈에서 SDK 직접 import 금지. 자동 재시도 + 에러 분류 + WebSocket 이벤트 정규화 내장.

### RiskEngine 필수 게이트웨이
**모든 주문**은 `riskEngine.validateOrder()`를 통과해야 함. 3개 서브 엔진 조합:
- `CircuitBreaker` — 연속 손실 감지
- `DrawdownMonitor` — 최대 낙폭/일일 손실 추적
- `ExposureGuard` — 포지션 크기/총 노출 제한
- **reduceOnly bypass**: SL/TP/CLOSE 주문은 CircuitBreaker/DrawdownMonitor를 건너뛰고 ExposureGuard만 적용 (AD-46)

### EventEmitter 기반 통신
서비스 간 통신은 EventEmitter 이벤트로 처리. 이벤트 상수는 `utils/constants.js`에 정의 (`TRADE_EVENTS`, `RISK_EVENTS`, `MARKET_EVENTS`). Socket.io를 통해 프론트엔드에 전달.

## 전략 시스템

### 구조
- **기본 클래스**: `services/strategyBase.js` — `onTick()`, `onKline()`, `getSignal()` 오버라이드 필수
- **레지스트리**: `services/strategyRegistry.js` — 싱글턴. 각 전략 파일이 모듈 로드 시 자동 등록
- **인덱스**: `strategies/index.js` — `safeRequire()`로 모든 전략 임포트 (하나 실패해도 나머지 영향 없음)

### 18개 전략 (3개 카테고리)
- `strategies/price-action/` (5): Turtle, CandlePattern, SupportResistance, SwingStructure, FibonacciRetracement
- `strategies/indicator-light/` (8): Grid, MaTrend, Funding, RSIPivot, Supertrend, Bollinger, Vwap, MacdDivergence
- `strategies/indicator-heavy/` (3): QuietRangeScalp, Breakout, AdaptiveRegime

### 전략 메타데이터
각 전략 클래스의 static `metadata`에 `targetRegimes`, `riskLevel`, `maxConcurrentPositions`, `cooldownMs`, `gracePeriodMs`, `defaultConfig` 정의. `strategyRouter.js`가 시장 레짐 변경 시 `targetRegimes` 기반으로 전략을 자동 활성화/비활성화. 비활성화 시 `gracePeriodMs` 동안 유예기간 적용 (OPEN 차단, CLOSE 허용).

### 시장 레짐
`marketRegime.js`가 시장 상태를 분류: `TRENDING_UP`, `TRENDING_DOWN`, `RANGING`, `VOLATILE`, `QUIET`. 삼중 보호 체계: hysteresis(10캔들) + 전환 쿨다운(5분) + 전략 유예기간(5~15분). 레짐별 코인 선정 가중치도 차별화 (`coinSelector.js`의 7-factor 스코어링).

## Bitget SDK 주의사항

- bitget-api **v3** 사용 (`RestClientV2`, `WebsocketClientV3`, `WebsocketAPIClient`)
- **UTA (Unified Trading Account)** 모드 필수
- Private WS topics: `instType: 'UTA'` / Public WS topics: `instType: 'usdt-futures'`
- 주문 파라미터: `productType` (not `category`), `size` (not `qty`), `tradeSide` (not `posSide`)

## API 엔드포인트

| Prefix | 주요 엔드포인트 |
|--------|----------------|
| `/api/bot` | start, stop, pause, resume, status, emergency-stop, strategies, strategies/:name/enable\|disable\|config |
| `/api/trades` | history, open, order(POST), order/:id(DELETE), positions, signals |
| `/api/analytics` | session/:id, equity-curve/:id, daily, by-strategy, by-symbol |
| `/api/backtest` | run(POST), list, :id(GET/DELETE) |
| `/api/paper` | account, reset (PAPER_TRADING=true일 때만) |
| `/api/tournament` | info, leaderboard, start, stop, reset, strategy/:name (TOURNAMENT_MODE=true일 때만) |
| `/api/risk` | events, events/unacknowledged, events/:id/acknowledge, status, drawdown/reset |
| `/api/health` | ping, status |
| `/metrics` | Prometheus 메트릭 (prom-client, 인증 면제) |

## 프론트엔드 구조

- **3개 페이지**: `/` (대시보드), `/backtest` (백테스트), `/tournament` (토너먼트)
- **실시간 통신**: Socket.io 이벤트 + 폴링 (3~30초 간격) 병행
- **경로 별칭**: `@/*` → `./src/*`
- **스타일**: Tailwind CSS 4, 다크 테마 (zinc 팔레트)
- **차트**: Recharts (주식 곡선, 백테스트 시각화)
- **한국어 UI**: `lib/utils.ts`에 번역 헬퍼 (`translateBotState`, `translateSide`, `translateRegime`, `translateStrategyName`)

### 프론트엔드 패턴
- 커스텀 훅이 API 호출 + 폴링 + 에러 처리 캡슐화 (`hooks/useBotStatus.ts`, `usePositions.ts` 등)
- API 클라이언트 (`lib/api-client.ts`)는 네임스페이스별 분리: `botApi`, `tradeApi`, `analyticsApi`, `healthApi`, `tournamentApi`, `backtestApi`
- 응답 규약: `{ success: boolean, data: T, error?: string }`

## 백테스트 시스템

- `backtest/dataFetcher.js` — Bitget에서 kline 데이터 페이지네이션 수집, `data/klines/`에 캐싱
- `backtest/backtestEngine.js` — kline 시뮬레이션 루프 (전략에 kline→ticker 순서로 피드, 슬리피지/수수료 적용)
- `backtest/backtestMetrics.js` — 승률, PnL, 최대 낙폭, Sharpe, Profit Factor 등 산출
- `backtest/backtestStore.js` — 결과 인메모리 저장소 (싱글턴 Map, FIFO 50건 제한)

## Mongoose 모델 (`models/`)

- `Trade` — 주문 정보 (금액 필드 전부 String)
- `BotSession` — 봇 세션 상태/설정/통계
- `Signal` — 전략 시그널 (confidence, riskApproved, marketContext 포함)
- `Snapshot` — 주식 곡선용 시점별 스냅샷 (sessionId, equity, cash, unrealizedPnl)
- `RiskEvent` — 리스크 이벤트 기록 (eventType, severity, riskSnapshot, acknowledged, TTL 30일)
