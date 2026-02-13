# 프론트엔드 가이드

## 기술 스택

- **프레임워크**: Next.js 15 (App Router)
- **언어**: TypeScript
- **스타일**: Tailwind CSS 4 (다크 테마, zinc 팔레트)
- **차트**: Recharts
- **실시간 통신**: Socket.io Client
- **경로 별칭**: `@/*` → `./src/*`

---

## 페이지 구조

### 1. 대시보드 (`/`) — `app/page.tsx`

메인 대시보드. 봇 제어와 모니터링을 위한 단일 페이지.

**레이아웃 (Sprint R3 재설계)**:
```
┌─ TradingModeBanner (LIVE=빨강 펄스 / PAPER=초록 배너) ──────┐
├─ RiskAlertBanner (심각도 기반 자동 닫기 알림) ─────────────┤
├─ 헤더 ─────────────────────────────────────────────────────┤
│ 봇 제목 | 트레이딩 모드 토글 | 백테스트/토너먼트 링크      │
├─────────────────────────────────────────────────────────────┤
│ 시스템 상태 표시기 (최우선 표시)                           │
├─────────────────────────────────────────────────────────────┤
│ 봇 제어 패널 (시작/정지/일시정지/재개/긴급정지)            │
├─────────────────────────────────────────────────────────────┤
│ 전략 관리 패널 (필터 + 활성/비활성 토글)                   │
├──────────────────────┬──────────────────────────────────────┤
│ 계정 개요            │ 리스크 상태 패널 (낙폭 리셋 버튼)   │
├──────────────────────┴──────────────────────────────────────┤
│ 자산 곡선 차트 (봇 실행 중 시그널 피드보다 우선)          │
├──────────────────────┬──────────────────────────────────────┤
│ 포지션 테이블        │ 시그널 피드                          │
│ (수동 청산 버튼)     │                                      │
├──────────────────────┴──────────────────────────────────────┤
│ 시장 레짐 표시기 + 심볼별 레짐 테이블                      │
├─────────────────────────────────────────────────────────────┤
│ 레짐 기반 전략 추천                                        │
├─────────────────────────────────────────────────────────────┤
│ 거래 내역 테이블                                           │
└─────────────────────────────────────────────────────────────┘
```

**핵심 기능**:
- Socket.io 실시간 업데이트 (시그널, 포지션, 레짐)
- REST 폴링 대체 (3~30초 간격)
- 봇 시작 전 전략 사전 선택 (useRef)
- 세션 기반 분석 필터링
- Sprint R3: 우선순위 기반 레이아웃 (시스템 상태 > 봇 제어 > 자산 곡선 > 시장 레짐)
- Sprint R3: 포지션 수동 청산 기능 (ConfirmDialog 통합)

---

### 2. 백테스트 (`/backtest`) — `app/backtest/page.tsx`

> 페이퍼 모드에서만 접근 가능

**레이아웃**:
```
┌─ 백테스트 폼 ───────────────────────────────────────────────┐
│ 전략 선택 | 심볼 | 타임프레임 | 날짜 범위 | 자본 | 수수료   │
├─────────────────────────────────────────────────────────────┤
│ 진행률 바 (실행 중)                                        │
├─────────────────────────────────────────────────────────────┤
│ 성과 지표 패널 (승률, PnL, 샤프, 최대 낙폭 등)            │
├──────────────────────┬──────────────────────────────────────┤
│ 자산 곡선 차트       │ 가격 차트 (진입/청산 마커)          │
├──────────────────────┴──────────────────────────────────────┤
│ 거래 내역 리스트                                           │
├─────────────────────────────────────────────────────────────┤
│ 이전 백테스트 결과 목록                                    │
└─────────────────────────────────────────────────────────────┘
```

**특징**:
- 실행 중 1초 간격 폴링
- 큰 자산 곡선은 500포인트로 다운샘플링
- 세션 기반 결과 관리

---

### 3. 토너먼트 (`/tournament`) — `app/tournament/page.tsx`

> 페이퍼 모드에서만 접근 가능

**레이아웃**:
```
┌─ 토너먼트 헤더 ─────────────────────────────────────────────┐
│ 상태 | 전략 수 | 초기 잔고 | 시작 시간                     │
│ [시작/중지] [리셋]                                         │
├─────────────────────────────────────────────────────────────┤
│ 순위표 (랭크 | 전략 | 자산 | PnL | PnL% | 미실현 | 포지션) │
│ ├─ 클릭 시 확장: 전략 상세 (계정, 포지션, 최근 거래)       │
└─────────────────────────────────────────────────────────────┘
```

**특징**:
- 3초 간격 리더보드 폴링
- 클릭 확장으로 전략 상세 조회
- 상위 3위 금/은/동 배지

---

## 커스텀 훅

| 훅 | 파일 | 폴링 간격 | 용도 |
|----|------|----------|------|
| `useBotStatus` | `hooks/useBotStatus.ts` | 5초 | 봇 상태, 전략, 리스크 메트릭 |
| `useSocket` | `hooks/useSocket.ts` | 이벤트 기반 | 실시간 시그널, 포지션, 레짐, circuit_reset, exposure_adjusted, unhandled_error, drawdown_reset |
| `usePositions` | `hooks/usePositions.ts` | 5초 | 오픈 포지션 + 계정 상태 |
| `useTrades` | `hooks/useTrades.ts` | 10초 | 거래 내역 + 미체결 주문 |
| `useAnalytics` | `hooks/useAnalytics.ts` | 1회 | 자산 곡선 + 세션 통계 |
| `useHealthCheck` | `hooks/useHealthCheck.ts` | 30초 | API 지연, 서비스 상태 |
| `useBacktest` | `hooks/useBacktest.ts` | 1초 (실행 중) | 백테스트 CRUD + 결과 폴링 |
| `useTournament` | `hooks/useTournament.ts` | 3초 | 토너먼트 정보 + 순위표 |
| `useRiskEvents` | `hooks/useRiskEvents.ts` | 이벤트 기반 | 리스크 이벤트 조회/확인 처리 |

### 훅 사용 패턴

```typescript
// 페이지에서 훅 사용 — 직접 API 호출 없음
const { status, loading, error, startBot, stopBot } = useBotStatus();
const { connected, signals, positions, regime } = useSocket();
const { positions: openPositions, accountState } = usePositions();
```

### Socket 관리 (Sprint R3)

`useSocket` 훅은 ref-counted socket 관리를 사용합니다:

```typescript
// lib/socket.ts
acquireSocket()  // 소켓 인스턴스 획득 (없으면 생성, 있으면 참조 카운트 +1)
releaseSocket()  // 참조 카운트 -1, 0이 되면 연결 해제
getSocket()      // 현재 소켓 인스턴스 조회 (없으면 null)
```

**장점**: 여러 컴포넌트에서 동시 사용 가능, 모든 컴포넌트가 언마운트되면 자동으로 연결 해제

`useSocket` 훅은 이름 있는 핸들러로 이벤트를 등록하여 cleanup 시 정확히 제거합니다.

---

## 컴포넌트 목록

### UI 기본 컴포넌트 (`components/ui/`)

| 컴포넌트 | 설명 |
|----------|------|
| `Button` | 스타일 버튼 (variant 지원) |
| `Card` | 카드 레이아웃 래퍼 |
| `Badge` | 상태/라벨 배지 (success, danger, neutral 등) |
| `Spinner` | 로딩 표시기 (sm, md, lg) |
| `ConfirmDialog` | 확인 모달 (Sprint R3: PositionsTable 청산 확인에도 사용) |

### Error Boundary (Sprint R3)

프론트엔드에 두 레벨의 에러 경계가 추가되었습니다:

| 파일 | 범위 | 기능 |
|------|------|------|
| `app/error.tsx` | 페이지 레벨 | 에러 표시 + EmergencyStop 버튼 + 재시도 버튼 |
| `app/global-error.tsx` | 전역 | 최후 방어선 (layout 에러 포함) |

**EmergencyStop 통합**: `error.tsx`에서 긴급 정지 버튼을 제공하여 에러 발생 시 즉시 봇을 중단할 수 있습니다.

### 대시보드 컴포넌트

| 컴포넌트 | 설명 |
|----------|------|
| `BotControlPanel` | 시작/정지/일시정지/재개/긴급정지 버튼 (LIVE 모드 시작 확인, EmergencyStopDialog 통합). Props: tradingMode, openPositionCount, unrealizedPnl |
| `TradingModeToggle` | 라이브/페이퍼 모드 전환 |
| `StrategyPanel` | 전략 선택기 (3단 필터: 카테고리, 방향, 변동성) |
| `AccountOverview` | 자산, 잔고, 미실현 PnL |
| `RiskStatusPanel` | 서킷 브레이커, 노출, 낙폭 지표 (Sprint R3: 낙폭 리셋 버튼 추가) |
| `MarketRegimeIndicator` | 현재 시장 레짐 배지 + 신뢰도 |
| `SymbolRegimeTable` | 심볼별 레짐 분류 테이블 |
| `RegimeStrategyRecommendation` | 현재 레짐에 맞는 전략 추천 |
| `EquityCurveChart` | Recharts 자산 곡선 |
| `PositionsTable` | 오픈 포지션 (진입가, 현재가, 미실현 PnL, Sprint R3: 수동 청산 버튼 추가) |
| `SignalFeed` | 실시간 시그널 피드 (최대 50개, 최신순) |
| `TradesTable` | 거래 내역 + 페이지네이션 |
| `SystemHealth` | API 상태, 지연, 소켓 연결 |
| `ClientGate` | 서버/클라이언트 경계 안전 컴포넌트 |
| `EmergencyStopDialog` | 긴급 정지 체크박스 확인 다이얼로그 |
| `TradingModeBanner` | 트레이딩 모드 배너 (LIVE=빨강 펄스, PAPER=초록 배너) |
| `RiskAlertBanner` | 심각도 기반 리스크 알림 배너 (critical=수동 닫기, warning=30초, info=10초 자동 닫기) |

### 백테스트 컴포넌트 (`components/backtest/`)

| 컴포넌트 | 설명 |
|----------|------|
| `BacktestForm` | 백테스트 설정 폼 |
| `BacktestStatsPanel` | 성과 지표 그리드 |
| `BacktestEquityCurve` | 자산 곡선 차트 |
| `BacktestPriceChart` | 가격 차트 + 진입/청산 마커 |
| `BacktestTradeList` | 거래 상세 목록 |
| `BacktestListPanel` | 이전 결과 목록 (선택/삭제) |

---

## API 클라이언트 (`lib/api-client.ts`)

네임스페이스별로 분리된 API 호출 함수:

```typescript
import { botApi, tradeApi, analyticsApi, healthApi, tournamentApi, backtestApi, riskApi } from '@/lib/api-client';

// 사용 예시
const status = await botApi.getStatus();
const strategies = await botApi.getStrategies();
const positions = await tradeApi.getPositions();
const health = await healthApi.check();
```

### 네임스페이스

| 네임스페이스 | 주요 메서드 |
|-------------|-------------|
| `botApi` | getStatus, start, stop, pause, resume, emergencyStop, getStrategies, enableStrategy, disableStrategy, getTradingMode, setTradingMode |
| `tradeApi` | getHistory, getOpen, getPositions, getSignals, submitOrder, cancelOrder |
| `analyticsApi` | getSession, getEquityCurve, getDaily, getByStrategy, getBySymbol |
| `healthApi` | check, ping |
| `tournamentApi` | getInfo, start, stop, reset, getLeaderboard, getStrategyDetail |
| `backtestApi` | run, list, getResult, getEquityCurve, getTrades, delete, getStrategies |
| `riskApi` | getEvents, getUnacknowledged, acknowledge, getStatus, resetDrawdown |

### API 에러 처리 (Sprint R3)

`api-client.ts`에 `ApiError` 클래스가 추가되어 에러 응답을 구조화합니다:

```typescript
class ApiError extends Error {
  statusCode: number
  response?: any
}

// 사용 예시
try {
  await botApi.start()
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.statusCode, err.message)
  }
}
```

모든 API 호출은 에러 발생 시 `ApiError`로 래핑되어 throw됩니다.

---

## 유틸리티 (`lib/utils.ts`)

### 번역 헬퍼

```typescript
translateBotState('running')       // → '실행 중'
translateSide('buy')               // → '매수'
translateRegime('trending_up')     // → '상승장'
translateStrategyName('TurtleBreakoutStrategy') // → '터틀 돌파'
getStrategyCategory('GridStrategy') // → 'indicator-light'
```

### 전략 카테고리 매핑

```typescript
// price-action (5개)
'TurtleBreakoutStrategy' → 'price-action'
'CandlePatternStrategy' → 'price-action'
'SupportResistanceStrategy' → 'price-action'
'SwingStructureStrategy' → 'price-action'
'FibonacciRetracementStrategy' → 'price-action'

// 나머지는 indicator-light 또는 indicator-heavy
```

---

## 타입 시스템

### 핵심 타입

| 타입 | 파일 | 설명 |
|------|------|------|
| `BotStatus` | `types/index.ts` | 봇 전체 상태 |
| `RiskStatus` | `types/index.ts` | 리스크 엔진 상태 |
| `Trade` | `types/index.ts` | 거래 기록 |
| `Position` | `types/index.ts` | 포지션 정보 |
| `Signal` | `types/index.ts` | 시그널 정보 |
| `StrategyListItem` | `types/index.ts` | 전략 목록 항목 |
| `SessionStats` | `types/index.ts` | 세션 통계 |
| `HealthReport` | `types/index.ts` | 시스템 상태 |
| `MarketRegimeData` | `types/index.ts` | 시장 레짐 데이터 |
| `TournamentInfo` | `types/index.ts` | 토너먼트 메타데이터 |
| `LeaderboardEntry` | `types/index.ts` | 순위표 항목 |
| `RiskEvent` | `types/index.ts` | 리스크 이벤트 (eventType, severity, riskSnapshot, acknowledged) |
| `RiskEventLegacy` | `types/index.ts` | 레거시 호환 리스크 이벤트 |
| `BacktestConfig` | `types/backtest.ts` | 백테스트 설정 |
| `BacktestResult` | `types/backtest.ts` | 백테스트 결과 |
| `BacktestMetrics` | `types/backtest.ts` | 백테스트 성과 지표 |

---

## 스타일링 규칙

| 용도 | 색상 |
|------|------|
| 배경 | zinc-900 / zinc-950 |
| 카드 배경 | zinc-800/50 |
| 테두리 | zinc-700/50 |
| 기본 텍스트 | zinc-100 |
| 보조 텍스트 | zinc-400 / zinc-500 |
| 양수 (이익) | emerald-400 / emerald-500 |
| 음수 (손실) | red-400 / red-500 |
| 상승장 태그 | emerald-500/20 |
| 하강장 태그 | red-500/20 |
| 횡보장 태그 | yellow-500/20 |
| 고변동성 태그 | purple-500/20 |
| 저변동성 태그 | zinc-500/20 |

---

## 통신 패턴

### 우선순위

1. **Socket.io** — 시그널, 포지션, 레짐 변경 (실시간)
2. **REST 폴링** — 봇 상태(5초), 포지션(5초), 거래(10초), 헬스(30초)
3. **1회성 조회** — 분석 데이터 (세션 변경 시)

### 데이터 흐름

```
훅(useSocket) → Socket.io 이벤트 수신 → state 업데이트 → 컴포넌트 리렌더링
훅(useBotStatus) → setInterval 폴링 → API 호출 → state 업데이트 → 리렌더링
페이지 → 훅 사용 → 직접 API 호출 없음
```
