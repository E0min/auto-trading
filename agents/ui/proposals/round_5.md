# Round 5 Proposal -- Tier 3 Enhancement (UI/UX Engineer)

**Author**: UI/UX Engineer
**Date**: 2026-02-15
**Scope**: T3-6 (Frontend Track C: 성과 귀인 대시보드) + T3-1, T3-2 (Cross-cutting: 프론트엔드 관점) + T3-3, T3-5, T3-7 (Backend: UX 관점 리뷰)

---

## 분석 요약

Round 4에서 Tier 2 Quality 12건 모두 완료되어 useSocket 최적화(ticker ref 분리), SignalFeed rejectReason 표시, DrawdownChart, RiskStatusPanel 게이지 강화, 적응형 폴링(useAdaptivePolling) 등이 안정적으로 반영되었다. 현재 대시보드 레이아웃은 아래와 같이 확정 상태이다:

```
Row 0: TradingModeBanner + RiskAlertBanner
Row 1: BotControlPanel + AccountOverview
Row 2: PositionsTable (full width)
Row 3: RiskStatusPanel(1/3) + EquityCurveChart + DrawdownChart(2/3)
Row 4: SignalFeed(1/3) + TradesTable(2/3)
Row 5: StrategyHub (full width)
Row 6: SymbolRegimeTable (full width)
```

Tier 3 Enhancement 6건 중 **T3-6 (성과 귀인 대시보드)** 가 UI/UX 핵심 담당이며, T3-1 (테스트), T3-2 (인증)는 프론트엔드 관점에서 검토한다. 나머지 T3-3, T3-5, T3-7은 백엔드 항목이나 UX에 미치는 영향을 분석한다.

---

## T3-6: 성과 귀인 대시보드 (심층 분석)

### 1. 현재 상태 분석

#### 백엔드 API -- 이미 완비

`backend/src/api/analyticsRoutes.js`에 다음 두 엔드포인트가 이미 존재한다:

```
GET /api/analytics/by-strategy/:sessionId
GET /api/analytics/by-symbol/:sessionId
```

`backend/src/services/performanceTracker.js`의 `getByStrategy()`와 `getBySymbol()`이 실제 구현을 담당하며, 각각 다음 스키마를 반환한다:

```typescript
// by-strategy 응답 형태 (Map이 JSON 직렬화 시 Object로 변환)
Record<string, {
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;    // String 타입 (mathUtils)
  winRate: string;      // 백분율 문자열
}>

// by-symbol 응답 형태 (동일 스키마)
Record<string, {
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRate: string;
}>
```

추가로 `GET /api/analytics/daily/:sessionId`도 존재한다:

```typescript
Array<{
  date: string;        // "YYYY-MM-DD"
  trades: number;
  pnl: string;
  wins: number;
  losses: number;
}>
```

#### 프론트엔드 API 클라이언트 -- 이미 완비

`frontend/src/lib/api-client.ts`의 `analyticsApi`에 해당 호출이 이미 정의되어 있다:

```typescript
// L137-138 (api-client.ts)
getByStrategy: (sessionId: string) => request<Record<string, unknown>>('/api/analytics/by-strategy/${sessionId}'),
getBySymbol:   (sessionId: string) => request<Record<string, unknown>>('/api/analytics/by-symbol/${sessionId}'),
getDaily:      (sessionId: string) => request<Record<string, unknown>>('/api/analytics/daily/${sessionId}'),
```

**문제**: 반환 타입이 `Record<string, unknown>`으로 타입이 미지정이다. 실제 사용 시 타입 안전성이 없다.

#### 프론트엔드 UI -- 전혀 없음

현재 대시보드(`page.tsx`)에서 `useAnalytics` 훅은 `equityCurve`와 `sessionStats`만 소비한다. `analyticsApi.getByStrategy()`와 `analyticsApi.getBySymbol()`은 **어디에서도 호출되지 않는다**. 즉, 백엔드 API가 완비되어 있음에도 프론트엔드에서 전혀 시각화하지 않는 상태이다.

기존 관련 컴포넌트:
- `StrategyHub` / `StrategyCard` / `StrategyDetail` -- 전략 on/off 및 개별 전략 상세(포지션, 거래, 시그널). 하지만 **전략 간 비교 뷰**는 없음
- `TradesTable` -- 전체 거래 내역을 시간순으로 나열. 전략/심볼별 필터링이나 집계 기능 없음
- `BacktestStatsPanel` -- 백테스트 전용이므로 라이브 세션에서는 사용 불가

### 2. UI/UX 설계안

#### 2.1 페이지 구조 결정: 대시보드 내 탭 통합 (별도 페이지 X)

**결정 근거**:
- 현재 대시보드 Row 4 아래가 이미 길어서, 별도 페이지(`/analytics`)로 분리하는 것이 정보 밀도와 네비게이션 측면에서 우월
- 그러나 현재 앱은 3개 페이지(`/`, `/backtest`, `/tournament`)만 가지며, 분석 데이터는 세션 ID에 종속적이므로 대시보드 컨텍스트를 벗어나면 세션 선택 UI가 필요해진다
- **최적 방안**: 대시보드 내 EquityCurveChart 영역에 **탭 네비게이션**을 추가하여 "에쿼티 커브 | 전략별 성과 | 심볼별 성과 | 일별 성과" 4개 탭으로 전환. 기존 Row 3의 2/3 영역(EquityCurveChart + DrawdownChart)을 `PerformanceTabs` 컴포넌트로 교체

#### 2.2 레이아웃 설계

```
Row 3 변경 후:
  ┌─────────────┬────────────────────────────────────────────┐
  │ RiskStatus  │ [에쿼티 커브] [전략별 성과] [심볼별] [일별]  │
  │ Panel (1/3) │                                            │
  │             │ <선택된 탭의 콘텐츠>                         │
  │             │                                            │
  └─────────────┴────────────────────────────────────────────┘
```

#### 2.3 탭 1: 에쿼티 커브 (기존)

기존 `EquityCurveChart` + `DrawdownChart`를 그대로 유지한다. 변경 없음.

#### 2.4 탭 2: 전략별 성과 (StrategyPerformance)

**핵심 차트**: 가로 막대 차트 (PnL by Strategy)
- X축: 전략명 (한글 번역 + 원명)
- Y축: 총 PnL (USDT)
- 색상: 양수 = emerald, 음수 = red
- 정렬: PnL 내림차순 (최고 수익 전략이 가장 위)

**하단 테이블**: 전략별 상세 통계
| 전략명 | 거래 수 | 승 | 패 | 승률 | 총 PnL | PnL 바 |
|--------|---------|----|----|------|--------|--------|
| RSI Pivot... | 24 | 15 | 9 | 62.5% | +$342.50 | ████░░ |

- PnL 바: 인라인 가로 막대 (전략 간 비교 가능한 상대적 너비)
- 정렬: PnL 내림차순 기본, 열 헤더 클릭으로 정렬 전환 가능
- 승률 색상: >= 50% emerald, < 50% red

**추가 KPI 카드 (상단)**:
- 최고 수익 전략 (이름 + PnL)
- 최고 승률 전략 (이름 + %)
- 가장 활발한 전략 (이름 + 거래 수)
- 전략 수 / 활성 전략 수

#### 2.5 탭 3: 심볼별 성과 (SymbolPerformance)

**핵심 차트**: 트리맵 또는 가로 막대 차트
- Recharts에 TreeMap이 있으므로 사용 가능
- 각 사각형 크기 = abs(totalPnl), 색상 = 양수(emerald)/음수(red)
- 호버 시 상세 정보 (거래 수, 승률, PnL)

**가로 막대 차트를 우선 구현** (TreeMap은 Recharts에서 제한적이므로):
- 동일한 가로 막대 차트 패턴 (PnL by Symbol)
- 심볼명은 `formatSymbol()` 사용 (BTCUSDT -> BTC/USDT)

**하단 테이블**: 심볼별 상세 통계
| 심볼 | 거래 수 | 승 | 패 | 승률 | 총 PnL |
|------|---------|----|----|------|--------|

#### 2.6 탭 4: 일별 성과 (DailyPerformance)

**핵심 차트**: 일별 PnL 막대 차트
- X축: 날짜 (MM/DD 형식)
- Y축: PnL (USDT)
- 색상: 양수일 = emerald 막대, 음수일 = red 막대
- 0 기준선 표시

**하단**: 일별 통계 요약 카드
- 총 거래일 수
- 수익일 / 손실일
- 최대 일일 수익
- 최대 일일 손실
- 평균 일일 PnL

### 3. 컴포넌트 구조

```
frontend/src/components/analytics/
  PerformanceTabs.tsx        -- 탭 컨테이너 (기존 Tabs 컴포넌트 재사용)
  StrategyPerformance.tsx    -- 전략별 성과 (차트 + 테이블)
  SymbolPerformance.tsx      -- 심볼별 성과 (차트 + 테이블)
  DailyPerformance.tsx       -- 일별 성과 (차트 + 요약)
  PnlBarChart.tsx            -- 재사용 가능한 가로 PnL 막대 차트
  PerformanceKPI.tsx         -- 상단 KPI 카드 그리드

frontend/src/hooks/
  usePerformanceAnalytics.ts -- by-strategy, by-symbol, daily 데이터 fetch + 캐싱

frontend/src/types/
  index.ts 또는 analytics.ts -- 타입 정의 추가
```

### 4. 타입 정의 (추가 필요)

```typescript
// types/index.ts에 추가
export interface StrategyPerformanceEntry {
  strategy: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRate: string;
}

export interface SymbolPerformanceEntry {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: string;
  winRate: string;
}

export interface DailyPerformanceEntry {
  date: string;
  trades: number;
  pnl: string;
  wins: number;
  losses: number;
}
```

### 5. API 클라이언트 타입 강화

`api-client.ts`의 `analyticsApi`에서 `Record<string, unknown>` 대신 구체적 타입 사용:

```typescript
getByStrategy: (sessionId: string) =>
  request<Record<string, StrategyPerformanceEntry>>(`/api/analytics/by-strategy/${sessionId}`),
getBySymbol: (sessionId: string) =>
  request<Record<string, SymbolPerformanceEntry>>(`/api/analytics/by-symbol/${sessionId}`),
getDaily: (sessionId: string) =>
  request<DailyPerformanceEntry[]>(`/api/analytics/daily/${sessionId}`),
```

### 6. 데이터 Fetch 훅: usePerformanceAnalytics

```typescript
// hooks/usePerformanceAnalytics.ts
export function usePerformanceAnalytics(sessionId: string | null) {
  // State: byStrategy, bySymbol, daily, loading, error
  // Fetch: Promise.all로 3개 동시 호출
  // sessionId 변경 시 자동 refetch
  // 봇이 running일 때만 30초 간격 폴링 (useAdaptivePolling 패턴 참조)
  // return { byStrategy, bySymbol, daily, loading, error, refetch }
}
```

### 7. page.tsx 통합

기존 Row 3의 EquityCurve + DrawdownChart 영역을 `PerformanceTabs`로 교체:

```tsx
// 변경 전
<div className="lg:col-span-2 space-y-4">
  <EquityCurveChart data={equityCurve} loading={analyticsLoading} />
  <DrawdownChart equityPoints={equityCurve || []} maxDrawdownPercent={10} />
</div>

// 변경 후
<div className="lg:col-span-2">
  <PerformanceTabs
    sessionId={botStatus.sessionId}
    equityCurve={equityCurve}
    analyticsLoading={analyticsLoading}
    maxDrawdownPercent={10}
  />
</div>
```

### 8. 접근성 고려사항

- 차트에 대한 대체 텍스트 (aria-label)
- 색상만으로 구분하지 않도록 양수/음수에 +/- 기호와 아이콘 병행
- 테이블 정렬 시 `aria-sort` 속성 사용
- 키보드로 탭 전환 가능 (기존 Tabs 컴포넌트가 role="tab" 지원)

### 9. 반응형 설계

- **데스크톱** (lg+): 가로 막대 차트 + 테이블 전체 표시
- **태블릿** (md): 차트 높이 축소, 테이블 가로 스크롤
- **모바일** (sm): 차트만 표시, 테이블은 아코디언 또는 카드 형식으로 변환

---

## T3-1: 프론트엔드 테스트 관점

### 현재 상태

- `frontend/package.json`에 테스트 관련 의존성이 **전혀 없음**: Vitest, Jest, React Testing Library 등 미설치
- `scripts`에 `test` 명령이 없음
- `tsconfig.json`에 테스트 경로 미포함

### 프론트엔드 테스트 전략 제안

#### 1단계: 도구 선택 -- Vitest + React Testing Library

**Vitest를 Jest보다 권장하는 이유**:
- Next.js 15 + TypeScript 환경에서 ESM 네이티브 지원
- Vite 기반으로 HMR/watch 모드가 빠름
- Jest와 API 호환이므로 학습 비용 최소
- `@testing-library/react`와 완벽 호환

**설치 패키지**:
```bash
npm install -D vitest @vitejs/plugin-react jsdom
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

#### 2단계: 테스트 대상 우선순위

| 우선순위 | 대상 | 이유 |
|----------|------|------|
| P0 | `lib/utils.ts` | 순수 함수 22개, 비용 대비 효과 최고 |
| P0 | `lib/drawdown.ts` | 순수 계산 로직, 수학적 정확성 검증 필수 |
| P1 | `lib/api-client.ts` | API 호출 + 에러 핸들링 검증 (msw로 모킹) |
| P1 | `hooks/useAdaptivePolling.ts` | 봇 상태별 간격 계산 로직 |
| P2 | `components/ui/Badge.tsx`, `Button.tsx`, `Card.tsx` | UI 기본 컴포넌트 렌더 검증 |
| P2 | `components/PositionsTable.tsx` | 데이터 바인딩 + 액션 버튼 |
| P3 | `components/BotControlPanel.tsx` | 상태별 버튼 활성화/비활성화 로직 |
| P3 | `components/strategy/StrategyHub.tsx` | 필터링 + 토글 인터랙션 |

#### 3단계: 테스트 패턴

```typescript
// utils.test.ts 예시
describe('formatCurrency', () => {
  it('포맷 정상 동작', () => {
    expect(formatCurrency('1234.56')).toBe('1,234.56');
  });
  it('소수점 이하가 긴 작은 수 처리', () => {
    expect(formatCurrency('0.0004369')).toBe('0.000437');
  });
  it('null/undefined 안전 처리', () => {
    expect(formatCurrency(null)).toBe('0.00');
    expect(formatCurrency(undefined)).toBe('0.00');
  });
});
```

#### 4단계: CI 통합

- `npm test` 스크립트 추가
- 커밋 전 lint + test 실행
- 커버리지 목표: P0 대상 100%, 전체 60%+

### 다른 에이전트에 요청

- **Engineer**: `vitest.config.ts` 셋업, `setupTests.ts` 작성, `tsconfig` 경로 별칭(`@/*`) vitest에서 인식하도록 `resolve.alias` 설정
- **Engineer**: 백엔드 Jest 설정과 프론트엔드 Vitest 설정을 루트 레벨에서 통합 관리할지, 각 패키지에서 독립 관리할지 결정

---

## T3-2: 인증 UI 관점

### 현재 상태

- 현재 프론트엔드에서 API 호출 시 **인증 헤더가 전혀 없음**
- `api-client.ts`의 `request()` 함수가 `Content-Type: application/json`만 설정
- 로그인 페이지, 토큰 관리, 인증 상태 컨텍스트가 모두 없음

### 1단계: API Key 인증 (프론트엔드 관점)

1단계 API Key 방식은 프론트엔드 영향이 상대적으로 작다:

- **환경 변수**: `NEXT_PUBLIC_API_KEY`를 `.env.local`에 추가
- **request() 함수 수정**: `Authorization: Bearer ${apiKey}` 또는 `X-API-Key: ${apiKey}` 헤더 추가
- **UI 변경 없음**: 사용자가 로그인할 필요 없이, 빌드 시 API key가 포함됨

```typescript
// api-client.ts 수정안
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }
  // ...
}
```

### 2단계: JWT 인증 (프론트엔드 관점)

JWT 도입 시 프론트엔드 변경이 대폭 확대된다:

#### 필요 컴포넌트/페이지

| 항목 | 설명 |
|------|------|
| `/login` 페이지 | 로그인 폼 (아이디/비밀번호 또는 API key 입력) |
| `AuthContext` | React Context로 인증 상태 관리 (token, user, isAuthenticated) |
| `AuthProvider` | `layout.tsx`에서 감싸는 Provider (토큰 localStorage 관리) |
| `useAuth` 훅 | login(), logout(), token refresh 로직 |
| `ProtectedRoute` | 인증되지 않은 사용자를 `/login`으로 리다이렉트 |
| `api-client.ts` 수정 | 요청마다 `Authorization: Bearer ${token}` 자동 첨부 |
| 토큰 만료 처리 | 401 응답 시 자동 refresh 또는 로그인 페이지 리다이렉트 |

#### 로그인 페이지 설계

```
┌─────────────────────────────────────────┐
│           Bitget 자동매매                  │
│                                          │
│   ┌──────────────────────────┐          │
│   │  API Key                 │          │
│   └──────────────────────────┘          │
│   ┌──────────────────────────┐          │
│   │  비밀번호                 │          │
│   └──────────────────────────┘          │
│                                          │
│   [로그인]                               │
│                                          │
│   * 단일 사용자 시스템                    │
│   * 최초 실행 시 설정 마법사 표시          │
└─────────────────────────────────────────┘
```

- 다크 테마 유지 (zinc 팔레트)
- 단순한 폼: 이 플랫폼은 단일 사용자 시스템이므로 회원가입이 필요 없음
- 에러 표시: 잘못된 인증 시 인라인 에러 메시지

#### 토큰 갱신 전략

```typescript
// api-client.ts에 인터셉터 패턴
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res = await fetchWithAuth(endpoint, options);

  if (res.status === 401) {
    // Access token 만료 -> refresh 시도
    const refreshed = await refreshToken();
    if (refreshed) {
      res = await fetchWithAuth(endpoint, options);
    } else {
      // Refresh도 실패 -> 로그아웃
      window.location.href = '/login';
      throw new ApiError('인증 만료', 401, endpoint);
    }
  }
  // ...
}
```

### 권장: 1단계만 이번 스프린트에서 구현

JWT 2단계는 별도 스프린트로 분리하는 것이 적절하다. 1단계 API Key는 프론트엔드 변경이 최소(request 함수 + env 변수)이므로, 백엔드의 API key 미들웨어와 동시에 구현 가능하다.

---

## 나머지 T3 항목 UX 관점 검토

### T3-3: Exchange-side Stop Loss 주문

**UX 영향**: 낮음 (백엔드 로직)

하지만 다음 UX 개선이 동반되면 트레이더 경험이 크게 향상된다:

1. **PositionsTable에 SL 가격 표시**: 현재 `Position` 타입에 `stopLossPrice` 필드가 없다. 백엔드에서 exchange-side SL을 설정하면, 프론트엔드에서도 해당 가격을 표시해야 한다.
   - 컬럼 추가: "SL 가격" (stopLossPrice가 설정되어 있으면 빨간색 표시, 없으면 "-")
   - 시각적 표시: 진입가 대비 SL까지의 거리를 % 또는 pips로 표시

2. **StrategyDetail 포지션 탭**: 동일하게 SL 가격 표시 추가

3. **매뉴얼 주문 시**: `tradeApi.submitOrder()`에 `stopLoss` 파라미터를 UI에서 입력할 수 있는 필드 추가 (향후)

**다른 에이전트에 요청**:
- **Trader/Engineer**: `Position` 타입에 `stopLossPrice?: string` 필드 추가 여부, WS로 SL 체결 이벤트 전달 방안

### T3-5: Prometheus 메트릭/모니터링

**UX 영향**: 중간

현재 `SystemHealth` 컴포넌트(`components/SystemHealth.tsx`)가 헬스체크 결과를 표시하고 있다. Prometheus 메트릭이 추가되면 다음과 같은 UX 강화가 가능하다:

1. **SystemHealth 확장**: 현재 "정상/경고/오류" 3단계 표시를 더 세분화
   - API 응답 시간 히스토그램
   - WebSocket 재연결 횟수
   - 메모리/CPU 사용량 (Prometheus에서 제공 시)

2. **성과 귀인 대시보드와 연동**: Prometheus 메트릭에서 전략별 실행 횟수, 시그널 생성 빈도 등을 가져와 시각화할 수 있다.

3. **별도 모니터링 페이지**: 향후 `/monitoring` 페이지에서 Grafana 임베드 또는 자체 메트릭 차트를 표시하는 방안 (다음 스프린트)

**이번 스프린트에서의 프론트엔드 작업**: 없음. 백엔드에서 `/metrics` 엔드포인트가 먼저 구축된 후 프론트엔드를 개선한다.

### T3-7: Correlation ID (traceId) 전파

**UX 영향**: 낮음 (디버깅 용도)

하지만 다음 UX 개선이 가능하다:

1. **에러 메시지에 traceId 포함**: API 에러 발생 시 `ApiError` 클래스에 `traceId` 필드를 추가. 사용자가 에러를 보고할 때 traceId를 첨부하면 디버깅이 빨라진다.

```typescript
// api-client.ts 수정안
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // ...
  const traceId = res.headers.get('X-Trace-Id') || '';
  if (!res.ok || !json.success) {
    throw new ApiError(
      json.error || '요청 실패',
      res.status,
      endpoint,
      false,
      traceId  // 추가
    );
  }
  return json.data;
}
```

2. **에러 토스트에 traceId 표시**: 에러 발생 시 "오류가 발생했습니다. (Trace: abc123)" 형태로 표시
3. **RiskEvent에 traceId 포함**: 리스크 이벤트 상세에서 traceId를 표시하면, 해당 이벤트의 전체 처리 경로를 추적할 수 있다

**다른 에이전트에 요청**:
- **Engineer**: 응답 헤더에 `X-Trace-Id` 포함 여부, traceId 형식(UUID vs nanoid)

---

## 제안 사항 (우선순위, 구현 난이도, 예상 영향)

| 순위 | 항목 | 구현 난이도 | 예상 영향 | 프론트엔드 작업량 |
|------|------|-------------|-----------|-------------------|
| 1 | **T3-6: 성과 귀인 대시보드** | 중 (3~4시간) | 높음 -- 트레이더 의사결정 | 신규 컴포넌트 5개 + 훅 1개 + 타입 3개 |
| 2 | **T3-1: 테스트 프레임워크** (FE) | 중 (2~3시간) | 높음 -- 품질 기반 | 설정 + P0 테스트 작성 |
| 3 | **T3-2: API 인증** (1단계) | 낮 (30분) | 중간 -- 보안 | request 함수 헤더 추가만 |
| 4 | **T3-7: traceId** (FE 소비) | 낮 (30분) | 낮음 -- 디버깅 편의 | ApiError 확장 + 에러 표시 |
| 5 | **T3-3: SL 표시** | 낮 (1시간) | 중간 -- 안전성 인지 | Position 타입 + 테이블 컬럼 |
| 6 | **T3-5: 메트릭 소비** | 없음 (이번 스프린트) | - | 백엔드 완료 후 |

### 구현 순서 권장

1. **T3-6 먼저 시작** -- 가장 큰 프론트엔드 작업이자, 기존 미사용 API를 활성화하는 것이므로 독립적으로 진행 가능
2. **T3-1 동시 진행** -- 테스트 프레임워크 셋업 후 T3-6의 새 컴포넌트에 대한 테스트도 작성
3. **T3-2, T3-7, T3-3** -- 백엔드 작업이 먼저 완료되어야 하므로, 백엔드 트랙 완료 후 프론트엔드 소비 작업 진행

---

## 다른 에이전트에게 요청 사항

### Trader에게

1. **T3-6 성과 귀인 대시보드**:
   - `getByStrategy()` 반환값에서 Map이 JSON 직렬화될 때 Object로 변환되는지 확인 (Express `res.json()`이 Map을 빈 객체 `{}`로 직렬화할 수 있음). 필요 시 `Object.fromEntries(result)` 변환 추가
   - `getByStrategy()`와 `getBySymbol()`에 `avgPnlPerTrade`, `profitFactor` 추가 가능 여부 -- 프론트엔드에서 계산할 수도 있지만 백엔드에서 제공하면 더 정확
   - 일별 성과(`getDaily()`)에 `cumPnl` (누적 PnL) 필드 추가 가능 여부 -- 일별 누적 수익 곡선 차트에 필요

2. **T3-3 Exchange-side SL**:
   - 포지션 조회 API 응답에 `stopLossPrice` 필드 포함 가능 여부
   - SL 체결 시 WebSocket 이벤트(`trade:sl_triggered` 등) 전달 가능 여부

### Engineer에게

1. **T3-1 테스트 프레임워크**:
   - 프론트엔드: Vitest + React Testing Library 셋업
   - 백엔드: Jest 셋업
   - 루트 레벨 `npm test` 명령으로 both 실행 가능하도록 구성
   - vitest.config.ts에서 `@/*` 경로 별칭 설정

2. **T3-2 인증**:
   - 1단계 API Key 미들웨어의 구체적 사양: `X-API-Key` 헤더 또는 `Authorization: Bearer` 중 어느 것을 사용할지
   - 프론트엔드에서 `NEXT_PUBLIC_API_KEY` 환경 변수로 전달

3. **T3-7 traceId**:
   - 응답 헤더에 `X-Trace-Id` 포함 여부
   - traceId 형식: UUID v4 권장 (프론트엔드에서 사용자에게 표시 시 가독성)

4. **T3-5 Prometheus**:
   - `/metrics` 엔드포인트 형식: Prometheus exposition format (text/plain) 또는 JSON
   - 프론트엔드에서 직접 소비할 메트릭이 있는지, 아니면 Grafana 대시보드만으로 충분한지

---

## 핵심 결론

**T3-6 성과 귀인 대시보드는 이번 스프린트의 프론트엔드 핵심 항목이다.** 백엔드 API(`by-strategy`, `by-symbol`, `daily`)가 이미 완비되어 있으므로, 프론트엔드에서 시각화 컴포넌트만 구현하면 된다. 기존 `EquityCurveChart` + `DrawdownChart` 영역을 탭 기반 `PerformanceTabs`로 확장하여, 트레이더가 "어떤 전략이 가장 돈을 벌고 있는가", "어떤 심볼에서 가장 성과가 좋은가", "일별 추이는 어떤가"를 한 곳에서 파악할 수 있도록 한다.

**주의점**:
- `performanceTracker.getByStrategy()`가 ES6 `Map`을 반환하므로 Express의 `res.json()`이 이를 `{}`로 직렬화할 가능성이 있다. **반드시 `Object.fromEntries()` 변환을 확인**해야 한다. 이것이 프론트엔드에서 빈 데이터를 받게 되는 원인이 될 수 있다.
- T3-1 테스트 프레임워크는 T3-6의 새 컴포넌트에 대한 유닛 테스트를 바로 작성할 수 있는 기회이므로, 동시에 진행하는 것을 강력히 권장한다.
