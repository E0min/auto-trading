# Round 5 Review: Tier 3 Enhancement (6건) — UI/UX 관점

**Reviewer**: Senior UI/UX Engineer (U)
**Date**: 2026-02-15
**Reviewed**: Trader 제안서 (round_5.md) + Engineer 제안서 (round_5.md)
**Scope**: 사용자 경험(UX), 프론트엔드 아키텍처, 데이터 시각화 관점 전면 리뷰

---

## 1. T3-3: Exchange-side Stop Loss — Trader 제안 리뷰

**판정: ✅ 동의 (프론트엔드 보완 필요)**

Trader의 분석이 매우 정확하다. 18개 전략이 모두 `onTick()` 소프트웨어 SL에만 의존하고 있다는 사실은 실거래 관점에서 가장 위험한 gap이다. Phase 1(진입 시그널에 SL 가격 포함) + Phase 2(소프트웨어 SL fallback 유지)의 이중 안전망 설계에 동의한다.

### 프론트엔드 UX 영향 분석

Exchange-side SL이 도입되면 **PositionsTable에 SL 가격 컬럼 추가가 필요하다**. 현재 테이블 컬럼 구조:

```
심볼 | 방향 | 수량 | 진입가 | 현재가 | 미실현 PnL | 레버리지 | 청산가 | 작업
```

SL 가격은 청산가(liquidationPrice)와 혼동되기 쉬운데, 이 둘은 성격이 완전히 다르다:
- **청산가**: 거래소가 강제 청산하는 마지노선 (margin call)
- **SL 가격**: 전략이 설정한 자발적 손절선

따라서 SL 가격은 "현재가" 바로 옆, 또는 "미실현 PnL" 바로 뒤에 배치하는 것이 인지 흐름상 자연스럽다. 제안하는 컬럼 순서:

```
심볼 | 방향 | 수량 | 진입가 | 현재가 | SL가 | 미실현 PnL | 레버리지 | 청산가 | 작업
```

**구현 시 고려사항**:

1. **Position 타입 확장**: `types/index.ts`의 `Position` 인터페이스에 `stopLossPrice?: string` 필드 추가 필요. 백엔드 `getPositions()` 응답에 SL 가격을 포함해야 한다. 현재 Bitget API의 position 데이터에 SL 정보가 포함되는지 Engineer가 확인 필요.

2. **시각적 표현**: SL 가격은 빨간색 계열(`text-red-400/70`)로 표시하여 "경고/방어선" 의미를 시각적으로 전달. SL이 미설정된 포지션은 "미설정" 텍스트를 `text-zinc-600`으로 표시하되, 이는 위험 신호이므로 아이콘(삼각 경고)을 병행.

3. **SL까지 거리 표시**: SL 가격 자체보다 "현재가에서 SL까지 몇 % 남았는지"가 트레이더에게 더 직관적이다. 툴팁으로 `SL 거리: -2.3%` 형태를 표시하거나, 좁은 progress bar로 시각화할 수 있다.

4. **반응형 처리**: 모바일에서는 컬럼이 10개가 되면 가로 스크롤이 심해진다. 현재도 `overflow-x-auto`로 처리하고 있지만, 모바일에서는 SL 가격을 진입가 아래에 서브 행으로 접는 것을 검토할 필요가 있다.

5. **Paper Trading 호환**: Trader가 지적한 대로 Paper mode에서 exchange-side SL 시뮬레이션이 누락되면 Paper vs Live의 행동이 달라진다. 프론트엔드 관점에서는 Paper mode에서도 SL 가격이 동일하게 표시되어야 한다. PaperEngine의 SL 트리거 시뮬레이션 구현은 Engineer에게 위임.

---

## 2. T3-1: 테스트 프레임워크 — Engineer 제안 리뷰

**판정: ⚠️ 조건부 동의 — 프론트엔드 테스트 러너 선택에 대한 보완 필요**

### Jest vs Vitest: 백엔드/프론트엔드 분리 전략

Engineer가 백엔드에 Jest를 권장하는 근거(CommonJS 네이티브 지원, 설정 비용 최소화)에 동의한다. 백엔드는 Jest가 맞다.

그러나 **프론트엔드도 Jest를 쓰겠다는 제안에는 조건부 동의**한다. 이유:

| 기준 | Jest + @next/jest | Vitest |
|------|:-:|:-:|
| Next.js 15 App Router 호환 | `@next/jest`가 공식이지만, App Router + RSC(Server Components) 테스트 지원이 아직 불완전 | Vitest + `@vitejs/plugin-react`로 RSC 제외한 클라이언트 컴포넌트 테스트에는 문제 없음 |
| React 19 호환 | `@testing-library/react` v16이 React 19를 지원하지만, jest-environment-jsdom과 React 19의 충돌 사례 다수 보고 | Vitest + happy-dom이 더 안정적인 경향 |
| 설정 복잡도 | `@next/jest` 플러그인이 SWC transform을 자동 처리 | Vitest.config.ts + alias 설정 필요하지만, Vite 생태계라 일관성 있음 |
| CI에서 2개 러너 혼재 | `npm test --workspace=backend` + `npm test --workspace=frontend` 로 분리 가능 | 동일 |

**나의 권장**: 현재 시점에서는 Engineer 제안대로 **백엔드 Jest + 프론트엔드도 Jest(`@next/jest`)**로 통일하는 것이 팀의 학습 비용을 줄인다. 테스트 도입 초기 단계에서 두 가지 러너를 관리하는 것은 불필요한 복잡성이다. 다만 다음 조건을 명시한다:

1. **CI 스크립트에서 워크스페이스별 `test` 명령 분리**: `backend/` 에서 `npx jest`, `frontend/`에서 `npx jest`를 각각 실행하도록 하면 혼란 없음.
2. **React 19 + jsdom 호환 문제 발생 시 Vitest 전환 허용**: `@testing-library/react` v16 + React 19 + jest-environment-jsdom 조합에서 문제가 발생하면 프론트엔드만 Vitest로 전환할 수 있는 유연성 확보.
3. **커버리지 리포트 통합**: 백엔드/프론트엔드 커버리지를 하나의 리포트로 병합하려면 `istanbul` 포맷으로 통일하고, CI에서 `nyc merge`를 사용.

### 프론트엔드 테스트 우선순위 (내 관점)

Engineer가 제안한 4순위(프론트엔드 컴포넌트 테스트)의 대상 목록을 재정렬한다:

| 순위 | 대상 | 이유 |
|:---:|------|------|
| 1 | `useBotStatus` 훅 | 봇 상태 전이(idle->running->paused 등)가 UI 전체에 파급. 상태 전이 오류 시 전체 대시보드 기능 장애 |
| 2 | `EmergencyStopDialog` | Safety-Critical UI. 긴급정지 버튼이 올바른 조건에서만 활성화되는지, 확인 다이얼로그가 정확히 동작하는지 |
| 3 | `RiskAlertBanner` | Critical 이벤트의 auto-dismiss 미동작, acknowledge 버튼 미렌더링 등의 버그는 사용자가 위험 상황을 인지하지 못하게 함 |
| 4 | `PositionsTable` | 포지션 청산 확인 다이얼로그의 PnL 표시 정확성, 손실/수익 분기 로직 |
| 5 | `usePositions` 훅 | 포지션 데이터 fetching + 갱신 로직 |

---

## 3. T3-2: API 인증 — Engineer 제안 리뷰

**판정: ⚠️ 조건부 동의 — `NEXT_PUBLIC_API_KEY` 클라이언트 노출 문제 해결 필요**

Engineer의 1단계 API Key 인증 설계 자체는 깔끔하다. `crypto.timingSafeEqual()` 사용, PUBLIC_PATHS 면제, API_KEY 미설정 시 안전한 열화 -- 모두 적절하다.

### 핵심 문제: `NEXT_PUBLIC_API_KEY`는 클라이언트에 노출된다

Next.js에서 `NEXT_PUBLIC_` 접두사가 붙은 환경변수는 **빌드 시점에 클라이언트 번들에 인라인된다**. 즉:

1. 브라우저의 개발자 도구 > Network 탭에서 모든 요청의 `Authorization: Bearer <key>` 헤더를 볼 수 있다.
2. 빌드된 JS 번들(`_next/static/chunks/...`)에서 문자열 검색으로 API key를 추출할 수 있다.
3. 외부에 프론트엔드 빌드를 배포하면 API key가 공개적으로 유출된다.

### 이것이 허용 가능한가?

**현재 아키텍처에서는 허용 가능하다.** 이유:

1. **단일 운영자 환경**: 이 시스템은 운영자 본인만 사용하는 로컬/VPN 환경이다. 프론트엔드를 공개 인터넷에 배포하는 시나리오가 아니다.
2. **API Key의 목적**: 외부 공격자의 무단 접근 차단이 목적이지, 프론트엔드 사용자로부터 API를 숨기는 것이 목적이 아니다.
3. **대안의 복잡성**: Server-side proxy(`/api/proxy/*`)를 두어 Next.js API Route에서 서버 측 환경변수로 인증하는 방식은 가능하지만, 모든 API 호출에 프록시 레이어를 추가하는 것은 과도한 엔지니어링이다.

### 보완 조건

1. **환경변수명을 `NEXT_PUBLIC_API_KEY`로 하되, `.env.local`에만 설정하고 `.env.example`에는 값을 비워 둔다.** git에 실제 키가 커밋되지 않도록.
2. **`api-client.ts`의 `request()` 함수에서 API_KEY가 빈 문자열이면 Authorization 헤더를 생략**하여 개발 편의성 유지.
3. **프론트엔드 빌드를 공개 호스팅(Vercel 등)에 배포할 경우, Next.js API Route 기반 프록시로 전환해야 한다는 점을 문서에 명시.**

### `api-client.ts` 수정 제안

```typescript
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      headers,
      ...options,
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다', 0, endpoint, true);
  }
  // ... 기존 로직
}
```

---

## 4. T3-5: Prometheus 메트릭 — Engineer 제안 리뷰

**판정: ✅ 동의 (프론트엔드 소비 가능성에 대한 의견 추가)**

Engineer의 메트릭 카탈로그 설계는 체계적이고, 계측 지점 식별이 정확하다. `prom-client` + `/metrics` 엔드포인트는 업계 표준이며, Grafana 연동 시 강력한 운영 가시성을 제공한다.

### 프론트엔드에서 Prometheus 메트릭을 직접 소비해야 하는가?

**아니오. 프론트엔드가 `/metrics` 엔드포인트를 직접 호출하는 것은 부적절하다.**

이유:
1. Prometheus 텍스트 포맷(OpenMetrics)은 프론트엔드 파싱에 비효율적이다.
2. `/metrics`는 Prometheus scraper가 주기적으로 pull하는 용도이며, 클라이언트 폴링용이 아니다.
3. 히스토그램 버킷, 카운터 누적값 등은 raw 형태로 프론트엔드에서 표시하기에 부적합하다.

### 대안: 기존 `/api/health` 확장

현재 `SystemHealth` 컴포넌트는 `/api/health`의 `HealthReport`를 소비한다:

```typescript
interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  services: Record<string, { status: string; latency?: number }>;
  timestamp: string;
}
```

Prometheus 메트릭 중 프론트엔드에 유용한 일부를 `/api/health`(또는 새 `/api/health/metrics`) 응답에 **JSON 형태로 가공하여 포함**하는 것이 적절하다:

```typescript
interface HealthReport {
  // 기존 필드
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  services: Record<string, { status: string; latency?: number }>;
  timestamp: string;
  // 추가: 프론트엔드 소비용 집계 메트릭
  metrics?: {
    apiLatencyP99Ms: number;       // exchange_api_latency_seconds p99 * 1000
    orderSuccessRate: number;      // 최근 1시간 성공률 %
    wsReconnectsLastHour: number;  // 최근 1시간 WS 재연결 횟수
    memoryUsageMb: number;         // 힙 사용량 MB
  };
}
```

이렇게 하면 `SystemHealth` 컴포넌트에서 API latency p99를 표시할 수 있다:

```
[정상] [WS 연결] 15ms | API p99: 230ms | 메모리: 128MB
```

**구현 시점**: T3-5 Prometheus 메트릭이 수집되기 시작한 후, `/api/health` 확장은 후속 작업으로 진행. Round 5에서 반드시 할 필요는 없다.

---

## 5. T3-6: 성과 귀인 대시보드 — Trader 제안 리뷰

**판정: ⚠️ 조건부 동의 — 추가 메트릭의 레이아웃 영향 및 구현 범위 조정 필요**

Trader의 분석에 대체로 동의한다. `useAnalytics.ts`가 `getByStrategy`/`getBySymbol`/`getDaily`를 호출하지 않는 현 상태는 의미 있는 데이터가 사장되고 있다는 것이다.

### 추가 메트릭의 테이블 레이아웃 영향

Trader가 제안한 확장 데이터 필드:

```
trades | wins | losses | totalPnl | winRate | avgPnl | profitFactor |
avgWin | avgLoss | expectancy | largestWin | largestLoss | avgHoldTime | pnlContribution
```

이 14개 컬럼을 한 행에 모두 표시하면 **최소 1800px 이상의 가로 폭이 필요하다**. 현재 `max-w-[1600px]` 제약 내에서 이를 모두 표시하는 것은 불가능하다.

### 해결 방안: 계층적 정보 공개 (Progressive Disclosure)

**1단계: 요약 테이블 (항상 표시)**

핵심 5개 컬럼만 표시. 전략명 클릭 시 상세 확장.

```
전략명 | 거래수 | 승률 | 총 PnL | Profit Factor | 기여도
```

이 5개면 **"어떤 전략이 돈을 벌고 있는가"**에 대한 즉각적인 답을 제공한다.

**2단계: 확장 상세 (클릭/토글)**

전략명을 클릭하면 아래로 확장되어 나머지 세부 지표 표시:

```
avgWin | avgLoss | expectancy | largestWin | largestLoss | avgHoldTime
```

이 패턴은 현재 `StrategyHub` 컴포넌트의 `StrategyCard` -> `StrategyDetail` 확장 패턴과 일관된다.

### 시각화 컴포넌트 우선순위 조정

Trader가 제안한 6개 시각화 중, UX 영향과 구현 비용을 고려하여 재정렬:

| 순위 | 컴포넌트 | 이유 | 난이도 |
|:---:|----------|------|:---:|
| 1 | `StrategyPerformanceTable` | 가장 정보밀도 높음. 표 하나로 모든 전략의 핵심 지표를 비교 가능 | 낮음 |
| 2 | `DailyPnlChart` | 시간축 패턴 파악 필수. "언제 돈을 벌고 언제 잃었나" | 낮음 |
| 3 | `PnlContributionPie` | 전체 수익에서 각 전략의 기여도를 직관적으로 표현 | 낮음 |
| 4 | `SymbolHeatmap` | 심볼별 수익 분포. 히트맵은 시각적 임팩트가 크지만 Recharts 네이티브 지원 아님. Treemap으로 대체 가능 | 중간 |
| 5 | `RiskReturnScatter` | 전략 최적화에 매우 유용하지만, 충분한 데이터(30+ trades/전략)가 있어야 의미 있음 | 중간 |
| 6 | `StrategyEquityCurves` | 전략별 누적 수익 곡선은 backtest 페이지와 기능 중복. 운영 대시보드에서는 우선순위 낮음 | 높음 |

### 페이지 배치: 별도 `/analytics` 페이지 생성 권장

Trader의 제안에 동의한다. 현재 메인 대시보드(`/`)는 이미 6개 Row에 12개 이상의 컴포넌트가 배치되어 있다. 성과 분석 시각화를 메인에 추가하면 스크롤 깊이가 과도해진다.

별도 `/analytics` 페이지를 생성하여:
- 헤더에 "분석" 네비게이션 링크 추가 (백테스트/토너먼트 링크와 동일 패턴)
- 페이지 상단: `StrategyPerformanceTable` + `PnlContributionPie` (2-column grid)
- 페이지 중단: `DailyPnlChart` (full width)
- 페이지 하단: `SymbolHeatmap` (또는 Treemap)

### Map 직렬화 버그

Trader와 Engineer 모두 지적한 `Map -> {}` 직렬화 버그는 T3-6과 무관하게 **즉시 수정해야 하는 기존 버그**다. 프론트엔드에서 `analyticsApi.getByStrategy()`를 호출하면 빈 객체를 받게 되어 모든 시각화가 무의미해진다. Engineer가 `Object.fromEntries()` 변환을 T3-6 구현 이전에 수정할 것을 요청한다.

---

## 6. T3-7: Correlation ID (traceId) — Engineer 제안 리뷰

**판정: ✅ 동의 (프론트엔드 에러 UI 확장 제안 포함)**

AsyncLocalStorage 기반 설계가 깔끔하다. HTTP 미들웨어에서 `X-Trace-Id` 헤더를 응답에 포함하고, 전략 시그널 체인에서는 `generateTraceId()`를 자동 생성하는 이중 경로 설계가 적절하다.

### 프론트엔드 ApiError에 traceId를 포함하면 에러 UI에 어떤 변화가 필요한가?

#### `ApiError` 클래스 확장

```typescript
export class ApiError extends Error {
  public statusCode: number;
  public endpoint: string;
  public isNetworkError: boolean;
  public traceId: string | null;  // 신규

  constructor(
    message: string,
    statusCode: number,
    endpoint: string,
    isNetworkError: boolean = false,
    traceId: string | null = null,  // 신규
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.isNetworkError = isNetworkError;
    this.traceId = traceId;
  }
}
```

#### `request()` 함수에서 traceId 추출

```typescript
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // ...
  const traceId = res.headers.get('X-Trace-Id');
  // ...
  if (!res.ok || !json.success) {
    throw new ApiError(json.error || '요청 실패', res.status, endpoint, false, traceId);
  }
  return json.data;
}
```

#### 에러 토스트/다이얼로그 디자인 변경

현재 에러 처리는 `alert()` (예: `page.tsx`의 `handleClosePosition`)으로 처리되고 있다. 이것은 traceId를 표시할 수 없다.

**에러 토스트 컴포넌트 도입** 시 traceId를 포함하는 방식:

```
+------------------------------------------+
| [!] 주문 실행 실패                        |
| 서버 응답: 잔고 부족                       |
|                                          |
| Trace ID: trc_a1b2c3d4e5f6  [복사]        |
+------------------------------------------+
```

핵심 설계 원칙:

1. **traceId는 기본적으로 접힌 상태(collapsed)로 표시**. 일반 사용자에게는 에러 메시지만 보여주고, "상세 정보" 토글을 클릭하면 traceId가 표시된다.
2. **"복사" 버튼 제공**: traceId를 클립보드에 복사할 수 있게 하여, 운영자가 서버 로그에서 `grep trc_a1b2c3d4e5f6`으로 즉시 추적 가능.
3. **RiskAlertBanner에도 traceId 포함**: critical 리스크 이벤트가 특정 주문 체인에서 발생했을 때, 해당 이벤트의 traceId를 배너에 표시하면 디버깅이 용이해진다. 다만, `RiskEvent` 모델의 `details` 필드에 traceId가 포함되어야 한다.

**Round 5에서는 `ApiError`에 traceId 필드 추가 + `request()`에서 헤더 추출까지만 구현하고, 에러 토스트 컴포넌트는 후속 라운드에서 구현하는 것을 권장한다.** 현재 `alert()` 기반 에러 처리를 토스트 시스템으로 전환하는 것은 별도 스코프의 작업이다.

---

## 실행 계획에 대한 의견

### Trader와 Engineer의 Phase 분배 비교

| Phase | Trader 제안 | Engineer 제안 | 내 의견 |
|-------|-------------|---------------|---------|
| 1 | T3-1 + T3-3 (테스트 + SL) | T3-1 + T3-2 (테스트 + 인증) | **Engineer 안 동의**. SL은 전략별 분석이 필요하므로 Phase 1에는 과도. 인증은 구현이 간단하고 즉시 효과. |
| 2 | T3-2 + T3-7 (인증 + traceId) | T3-7 + T3-5 (traceId + Prometheus) | **Engineer 안 동의**. 관측성 도구를 묶는 것이 시너지. |
| 3 | T3-5 + T3-6 (Prometheus + 대시보드) | T3-3 + T3-6 (SL + 대시보드) | **병합 동의**. SL과 대시보드를 마지막에 배치하는 것이 합리적. |

### Track 분배에 대한 의견

Engineer의 Track 분배에 동의하되, Track C(Frontend) 범위를 명확히 한다:

| Track C 항목 | 담당 | 상세 |
|-------------|------|------|
| T3-1 프론트엔드 테스트 설정 | UI (나) | Jest + @next/jest + @testing-library/react 설정 + 핵심 훅/컴포넌트 5개 테스트 |
| T3-2 프론트엔드 헤더 추가 | UI (나) | `api-client.ts`의 `request()` 함수에 `Authorization` 헤더 추가 |
| T3-3 PositionsTable SL 컬럼 | UI (나) | Position 타입 확장 + SL 가격 컬럼 추가 + 시각적 표현 |
| T3-6 성과 시각화 | UI (나) | `/analytics` 페이지 + 컴포넌트 3~4개 (StrategyPerformanceTable, DailyPnlChart, PnlContributionPie) |
| T3-7 ApiError traceId | UI (나) | `ApiError` 클래스 확장 + `request()` 헤더 추출 |

---

## 요약: 항목별 최종 판정

| ID | Trader 제안 | Engineer 제안 | 판정 | 핵심 보완/조건 |
|----|:-----------:|:------------:|:----:|---------------|
| T3-1 | 테스트 케이스 설계 기여 | Jest 백엔드 + 프론트엔드 통일 | ⚠️ 조건부 동의 | React 19 + jsdom 호환 이슈 시 프론트엔드만 Vitest 전환 허용 |
| T3-2 | API Key 1단계 충분 | API Key 미들웨어 설계 | ⚠️ 조건부 동의 | `NEXT_PUBLIC_API_KEY` 클라이언트 노출은 현재 아키텍처에서 허용 가능. 공개 배포 시 프록시 전환 필요 명시 |
| T3-3 | 전략별 SL 정책 + 적합도 분석 | ExchangeClient 확장 | ✅ 동의 | PositionsTable에 SL 가격 컬럼 추가. Position 타입 확장. SL 거리 % 툴팁 |
| T3-5 | 트레이딩 관점 메트릭 목록 | prom-client + metrics.js 설계 | ✅ 동의 | 프론트엔드는 `/metrics` 직접 소비 불가. `/api/health` 확장으로 일부 집계값 JSON 제공 |
| T3-6 | 추가 메트릭 + 시각화 6개 | Map 직렬화 버그 수정 + UI 위임 | ⚠️ 조건부 동의 | 14개 컬럼을 Progressive Disclosure로 처리. 별도 `/analytics` 페이지. 시각화는 4개(Table+DailyPnl+Pie+Treemap)로 축소 |
| T3-7 | traceId 전파 경로 정의 | AsyncLocalStorage 설계 | ✅ 동의 | `ApiError`에 traceId 필드 추가. 에러 토스트 전환은 후속 라운드 |

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **T3-3**: `getPositions()` API 응답에 각 포지션의 SL 가격(`stopLossPrice`)을 포함해 달라. Bitget REST API의 position 데이터에 `presetStopLossPrice`가 포함되는지 확인 필요. 포함되지 않으면 별도로 `getTriggerOrders()`를 조회하여 매핑해야 한다.

2. **T3-6**: Map 직렬화 버그(`getByStrategy()`, `getBySymbol()`)를 T3-6 구현 이전에 수정해 달라. 프론트엔드 시각화가 이 데이터에 의존한다.

3. **T3-7**: HTTP 응답의 `X-Trace-Id` 헤더가 CORS 설정에서 노출되도록 `Access-Control-Expose-Headers: X-Trace-Id`를 추가해 달라. 기본 CORS에서는 커스텀 헤더가 브라우저 JS에 노출되지 않는다.

4. **T3-2**: API Key 미들웨어가 401/403을 반환할 때, 프론트엔드에서 이를 감지하여 사용자에게 "API 키가 올바르지 않습니다" 에러를 표시해야 한다. `request()` 함수에서 401/403 응답에 대한 분기 처리를 추가하겠다.

### Trader에게

1. **T3-6**: `StrategyPerformanceTable`의 기본 정렬 기준은 `totalPnl` 내림차순(가장 수익 높은 전략이 위)으로 하겠다. 다른 선호 기준이 있으면 알려 달라.

2. **T3-6**: `pnlContribution`(수익 기여도)의 계산 방식 확인: `전략 totalPnl / 전체 totalPnl * 100`이 맞는가? 음수 PnL 전략이 있을 때 기여도 합이 100%를 초과하거나 음수가 되는 문제는 어떻게 처리할 것인가? 절대값 기준으로 비율을 계산하는 것이 시각화(파이 차트)에 적합하다.

3. **T3-3**: PositionsTable에 SL 가격과 함께 TP(Take Profit) 가격도 표시할 것인가? `presetStopSurplusPrice`도 이미 배관되어 있으므로, 같이 표시하면 일관성이 높아진다. 단, 컬럼이 하나 더 늘어나므로 SL/TP를 하나의 셀에 2줄로 표시하는 것을 제안한다:
   ```
   SL/TP
   ─────
   $42,100
   $48,500
   ```
