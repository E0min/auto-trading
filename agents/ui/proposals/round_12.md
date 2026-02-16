# Round 12 Proposal -- 코드베이스 재분석 Round 3

**Agent**: UI/UX Engineer
**Date**: 2026-02-17
**Topic**: 프론트엔드 코드베이스 3차 정밀 분석 -- 구조적 패턴 개선, UX 강화, 성능 최적화

---

## 분석 요약

R1~R11까지 50+건의 FE 개선을 거친 현재 코드베이스(42개 TSX/TS 파일, 14개 커스텀 훅, 6개 lib 모듈)를 전수 조사했다. 이전 라운드에서 타입 안전성, 적응형 폴링, 접근성 패턴이 잘 정리되어 있으나, 3차 분석에서 **13건의 신규 개선과제**를 발견했다.

### 핵심 발견 요약

| 카테고리 | 건수 | 심각도 분포 |
|----------|------|------------|
| 구조적 리팩토링 | 3건 | HIGH 1, MEDIUM 2 |
| UX 개선 | 4건 | HIGH 1, MEDIUM 3 |
| 성능 최적화 | 2건 | MEDIUM 2 |
| 접근성/안정성 | 2건 | MEDIUM 2 |
| Deferred 항목 재평가 | 2건 | MEDIUM 2 |

### 읽은 파일 목록 (30개+)

- 3개 페이지: `page.tsx`, `backtest/page.tsx`, `tournament/page.tsx`
- 14개 훅: `useBotStatus`, `useSocket`, `usePositions`, `useTrades`, `useAnalytics`, `useHealthCheck`, `useAdaptivePolling`, `useRiskEvents`, `useMarketIntelligence`, `usePerformanceAnalytics`, `useBacktest`, `useTournament`, `useStrategyDetail`, `useCountdown`
- 6개 lib: `api-client.ts`, `socket.ts`, `utils.ts`, `risk.ts`, `chart-config.ts`, `drawdown.ts`
- 2개 타입: `types/index.ts`, `types/backtest.ts`
- 15+개 컴포넌트: `BotControlPanel`, `AccountOverview`, `PositionsTable`, `SignalFeed`, `TradesTable`, `RiskStatusPanel`, `StrategyHub`, `StrategyCard`, `StrategyDetail`, `MarketIntelligence`, `EquityCurveChart`, `DrawdownChart`, `PerformanceTabs`, `StrategyPerformance`, `DailyPerformance`, `SymbolRegimeTable`, `StrategySymbolMap`, `BacktestForm`, `BacktestStatsPanel`, `SystemHealth`, `TradingModeToggle`, `RiskAlertBanner`, `ErrorToast`, `Card`, 등
- `layout.tsx`, `globals.css`

---

## 발견 사항 (코드 레벨 근거)

### 1. [R12-FE-01] useSocket 더블 acquireSocket 문제 (useMarketIntelligence와 중복 소켓 구독)

**심각도**: HIGH
**파일**: `frontend/src/hooks/useSocket.ts`, `frontend/src/hooks/useMarketIntelligence.ts`

**근거**:
- `useSocket.ts` (line 121-123): `REGIME_CHANGE`, `SYMBOL_REGIME_UPDATE`, `COIN_SELECTED` 이벤트를 구독
- `useMarketIntelligence.ts` (line 112-114): **동일한** `REGIME_CHANGE`, `COIN_SELECTED` 이벤트를 **별도로** 구독
- 두 훅 모두 `acquireSocket()`을 호출하여 refCount를 증가시킴 -- 소켓 자체는 싱글턴이므로 연결은 하나지만, **동일 이벤트에 두 개의 핸들러가 등록**됨
- `useSocket`의 `handleRegimeChange`는 `setRegime(data)` -- 단순 상태 저장
- `useMarketIntelligence`의 `handleRegimeChange`는 `setState(prev => ...)` -- regimeContext + regimeHistory 갱신 + 팩터 스코어 매핑
- 결과: `market:regime_change` 이벤트 발생 시 **두 핸들러가 모두 실행**되어 불필요한 이중 상태 업데이트 + 이중 리렌더 발생

**제안**:
- `useSocket`에서 `REGIME_CHANGE` 핸들러는 제거하지 않되(다른 컴포넌트가 `regime` 상태를 직접 참조), `useMarketIntelligence`의 `REGIME_CHANGE` 처리를 `useSocket`의 `regime` 상태를 watch하는 `useEffect`로 대체하는 방안 검토
- 또는 `useMarketIntelligence`에서 `acquireSocket` 대신 `getSocket()`을 사용하고 `releaseSocket`을 제거하여 refCount를 하나로 유지

**난이도**: M (1시간)
**예상 영향**: 레짐 변경 시 불필요 리렌더 1회 제거, 소켓 refCount 정규화

---

### 2. [R12-FE-02] PerformanceTabs 탭 전환 시 데이터 새로고침 부재

**심각도**: HIGH
**파일**: `frontend/src/components/analytics/PerformanceTabs.tsx`

**근거**:
- line 43: `const [loadedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>(['equity']));`
- line 100-103: `if (tab !== 'equity' && !loadedTabs.has(tab) && sessionIdRef.current) { loadedTabs.add(tab); fetchTabData(tab); }`
- **문제**: `loadedTabs`는 `useState`로 생성되었으나 `Set` 객체이므로 `loadedTabs.add()`가 호출되어도 **리렌더를 트리거하지 않음** (Set의 reference가 변경되지 않으므로). 이것 자체는 의도적(캐시 역할)이지만:
- 한번 로드된 탭은 세션이 변경되기 전까지 **절대 새로고침되지 않음** -- 봇이 실행 중일 때 전략별/심볼별 성과가 실시간으로 변하지만 이를 반영하지 못함
- line 55-62에서 sessionId가 null이 되면 `loadedTabs.clear()`를 하지만, 동일 sessionId 내에서는 갱신 없음
- 비교: `usePerformanceAnalytics` 훅은 adaptive polling으로 주기적으로 갱신하지만, `PerformanceTabs`는 이 훅을 사용하지 않고 자체적으로 lazy fetch

**제안**:
- 방법 A: `usePerformanceAnalytics` 훅을 `PerformanceTabs` 내부에서 활용하여 활성 탭에 한해 adaptive polling 적용
- 방법 B: 탭 전환 시 항상 refetch하되, 캐시 데이터를 먼저 보여주고 백그라운드에서 갱신 (stale-while-revalidate 패턴)
- 방법 C (최소 변경): 활성 탭에 "새로고침" 버튼 추가

**난이도**: M (1.5시간)
**예상 영향**: 봇 실행 중 전략별/심볼별 성과 데이터의 정확도 향상

---

### 3. [R12-FE-03] 대시보드 page.tsx의 handleClosePosition에서 addToast 의존성 누락

**심각도**: MEDIUM
**파일**: `frontend/src/app/page.tsx`

**근거**:
```typescript
// line 97-114
const handleClosePosition = useCallback(async (pos: Position) => {
  // ...
  } catch (err) {
    addToast(err instanceof Error ? err.message : '포지션 청산에 실패했습니다.', 'critical');
  }
}, [refetchPositions]);  // addToast가 dependency에 없음
```

- `addToast`는 `useToasts` 훅에서 반환된 `useCallback` (line 102, ErrorToast.tsx)이므로 참조가 안정적이긴 하지만, React의 hooks exhaustive-deps 규칙상 의존성 배열에 포함해야 함
- 같은 패턴이 `handleResetDrawdown` (line 119-129)에서도 발견됨 -- `addToast`가 의존성에 없음

**제안**:
```typescript
const handleClosePosition = useCallback(async (pos: Position) => {
  // ...
}, [refetchPositions, addToast]);

const handleResetDrawdown = useCallback(async (type: 'daily' | 'full') => {
  // ...
}, [refetchBotStatus, addToast]);
```

**난이도**: S (10분)
**예상 영향**: 잠재적 stale closure 버그 방지, ESLint 경고 제거

---

### 4. [R12-FE-04] BacktestForm의 setInterval 변수 섀도잉

**심각도**: MEDIUM
**파일**: `frontend/src/components/backtest/BacktestForm.tsx`

**근거**:
```typescript
// line 57
const [interval, setInterval] = useState('15m');
```

- React 컴포넌트 내부에서 `setInterval`이라는 이름의 state setter를 선언
- `setInterval`은 **전역 함수**(window.setInterval)와 이름이 동일하여 shadowing 발생
- 현재 이 컴포넌트에서 `window.setInterval`을 사용하는 곳은 없으므로 실제 런타임 버그는 아니지만:
  - 코드 가독성 저하 (다른 개발자가 혼동 가능)
  - 향후 타이머 기능 추가 시 버그 소지

**제안**:
```typescript
const [interval, setIntervalValue] = useState('15m');
```
또는
```typescript
const [backtestInterval, setBacktestInterval] = useState('15m');
```

**난이도**: S (10분)
**예상 영향**: 코드 명확성 향상, 잠재적 shadowing 버그 방지

---

### 5. [R12-FE-05] useBacktest 폴링이 useAdaptivePolling을 미사용 (불일치)

**심각도**: MEDIUM
**파일**: `frontend/src/hooks/useBacktest.ts`

**근거**:
- line 73-94: 백테스트 실행 중 결과를 폴링하기 위해 **직접 `setInterval`** 사용
- 다른 모든 훅(useBotStatus, usePositions, useTrades, useAnalytics, useHealthCheck, useMarketIntelligence, useTournament, useStrategyDetail)은 `useAdaptivePolling`을 사용
- `useBacktest`만 수동 인터벌 관리 (line 19: `pollRef`, line 21-26: `stopPolling`, line 73: `setInterval(..., 1000)`)
- 이유: 백테스트는 비동기 작업의 완료를 기다리는 것이므로 adaptive polling과 용도가 다름
- 하지만 문제점:
  - **Page Visibility API 미적용** -- 탭이 백그라운드로 가도 1초 간격 폴링 지속
  - 백테스트 페이지를 떠나면 `useEffect` cleanup으로 정리되긴 하지만, 같은 페이지에서 탭 전환 시에는 계속 폴링

**제안**:
- 최소 변경: `document.hidden`일 때 폴링 간격을 5초로 늘리거나, `document.hidden`일 때 폴링을 일시 중지
- 또는 `useAdaptivePolling`에 "task completion polling" 모드를 추가하여 통합

```typescript
useEffect(() => {
  // Pause polling when tab is hidden
  const handleVisibility = () => {
    if (document.hidden) {
      stopPolling();
    } else if (running) {
      // Resume polling on return
      // ... restart interval
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}, [running, stopPolling]);
```

**난이도**: S (30분)
**예상 영향**: 백테스트 실행 중 백그라운드 탭에서의 불필요 네트워크 요청 절감

---

### 6. [R12-FE-06] SignalFeed 모바일 반응형 레이아웃 부재

**심각도**: MEDIUM
**파일**: `frontend/src/components/SignalFeed.tsx`

**근거**:
- line 29-65: 시그널 아이템이 `flex items-center justify-between`으로 한 줄에 배치
- 한 줄에 포함되는 요소: Badge(action) + symbol + strategyName + confidence + riskApproved + rejectReason + time
- 모바일(< 640px)에서 이 요소들이 한 줄에 들어가지 않아 **수평 스크롤 또는 잘림** 발생
- 비교: `PositionsTable`, `TradesTable`은 `overflow-x-auto` + table 구조로 가로 스크롤을 지원하지만, `SignalFeed`는 `flex` 기반이라 텍스트가 겹치거나 잘릴 수 있음
- `max-w-[160px] truncate` (line 53)로 rejectReason만 truncate하지만, 나머지 요소들은 제한 없음

**제안**:
- 모바일에서 시그널 아이템을 2줄 레이아웃으로 변경:
  - 1줄: action badge + symbol + time
  - 2줄: strategy + confidence + risk status + reject reason
- `sm:` breakpoint 활용하여 데스크톱에서는 현재 1줄 유지

```tsx
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
  {/* Row 1: Core signal info */}
  <div className="flex items-center gap-3">...</div>
  {/* Row 2: Metadata */}
  <div className="flex items-center gap-3 text-[11px] pl-0 sm:pl-0">...</div>
</div>
```

**난이도**: S (30분)
**예상 영향**: 모바일 UX 향상, 시그널 정보의 가독성 개선

---

### 7. [R12-FE-07] AccountOverview 금액 값의 flash/transition 효과 부재

**심각도**: MEDIUM
**파일**: `frontend/src/components/AccountOverview.tsx`

**근거**:
- line 14-68: 총 자산, 가용 잔고, 미실현 PnL 등 핵심 금액 값이 폴링(3초 간격, running 시)으로 갱신됨
- 값이 변경될 때 **시각적 전환 효과가 없음** -- 사용자는 값이 업데이트되었는지 눈으로 포착하기 어려움
- `animate-number-up` (line 17, 28, 38, 48, 58) 클래스는 **최초 마운트 시에만** 애니메이션 -- 이후 값 변경 시에는 적용 안 됨
- 트레이딩 대시보드의 핵심 UX: 금액 변동을 즉시 인지할 수 있어야 함

**제안**:
- 값 변경 감지 시 **일시적 색상 flash** 적용 (값 증가 시 초록색 flash, 감소 시 빨간색 flash, 0.5초 후 원래 색으로)
- `useRef` + `useEffect`로 이전 값과 비교하여 변경 방향 감지
- CSS transition으로 자연스러운 색상 변화

```typescript
function useValueFlash(value: string) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = parseFloat(prevRef.current) || 0;
    const curr = parseFloat(value) || 0;
    if (curr > prev) setFlash('up');
    else if (curr < prev) setFlash('down');
    prevRef.current = value;

    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [value]);

  return flash;
}
```

**난이도**: M (1시간)
**예상 영향**: 실시간 데이터 변동 인지력 대폭 향상 -- 트레이더 의사결정 지원

---

### 8. [R12-FE-08] PositionsTable의 strategy 컬럼 미표시

**심각도**: MEDIUM
**파일**: `frontend/src/components/PositionsTable.tsx`

**근거**:
- `Position` 타입 (types/index.ts line 91-102)에 `strategy?: string | null` 필드가 존재
- 그러나 `PositionsTable.tsx`의 테이블 헤더에 **strategy 컬럼이 없음** (line 53-64)
- 컬럼: 심볼, 방향, 수량, 진입가, SL 가격, 현재가, 미실현 PnL, 레버리지, 청산가, 작업
- **어떤 전략이 해당 포지션을 열었는지** 표시하지 않음
- 대조: `StrategyDetail.tsx` (line 105-106)의 포지션 테이블에는 전략으로 필터링하므로 해당 정보가 불필요하지만, 메인 대시보드의 `PositionsTable`에서는 모든 전략의 포지션이 혼재

**제안**:
- 기존 "SL 가격" 컬럼과 "현재가" 사이에 "전략" 컬럼 추가
- 값이 null이면 '--' 표시
- 전략명은 `translateStrategyName`으로 한국어 변환하여 표시
- 컬럼이 너무 많으면 "레버리지" 컬럼을 숨기고 대신 "전략" 추가 (레버리지는 진입 시 설정값으로 고정이므로 상대적으로 중요도 낮음)

**난이도**: S (20분)
**예상 영향**: 어떤 전략이 어떤 포지션을 관리하는지 즉시 파악 가능 -- 다중 전략 운영 시 필수 정보

---

### 9. [R12-FE-09] TradingModeToggle의 에러 무시 (silent catch)

**심각도**: MEDIUM
**파일**: `frontend/src/components/TradingModeToggle.tsx`

**근거**:
```typescript
// line 30-38
const handleConfirm = async () => {
  if (!pending) return;
  setLoading(true);
  try {
    await botApi.setTradingMode(pending);
    onModeChange(pending);
  } catch {
    // error is handled silently -- mode stays unchanged
  } finally {
    setLoading(false);
    setPending(null);
  }
};
```

- 모드 전환 실패 시 사용자에게 **아무 피드백 없음**
- 다른 컴포넌트들(`BotControlPanel`, 대시보드 page.tsx)은 실패 시 `addToast()`로 에러를 표시
- 모드 전환은 중요한 작업(paper <-> live)이므로 실패 시 반드시 사용자에게 알려야 함

**제안**:
- `onError?: (message: string) => void` prop 추가
- 또는 컴포넌트 내부에 에러 상태 표시
- 대시보드에서 `addToast`와 연결

```typescript
interface TradingModeToggleProps {
  currentMode: 'live' | 'paper';
  botRunning: boolean;
  onModeChange: (mode: 'live' | 'paper') => void;
  onError?: (message: string) => void;  // 추가
}
```

**난이도**: S (15분)
**예상 영향**: 모드 전환 실패 시 사용자 혼란 방지

---

### 10. [R12-FE-10] SymbolRegimeTable과 StrategySymbolMap의 역할 중복 및 조건부 표시 부재

**심각도**: MEDIUM
**파일**: `frontend/src/components/SymbolRegimeTable.tsx`, `frontend/src/components/StrategySymbolMap.tsx`, `frontend/src/app/page.tsx`

**근거**:
- `page.tsx` line 283-302: `StrategySymbolMap`과 `SymbolRegimeTable`이 **연속 배치**됨
- `StrategySymbolMap`의 "감시 심볼" 섹션 (line 214-248): 각 심볼의 레짐을 Badge로 표시
- `SymbolRegimeTable` (전체): 각 심볼의 레짐, 신뢰도, 상태를 테이블로 표시
- **정보 중복**: 심볼별 레짐 정보가 두 컴포넌트에서 이중으로 표시됨
- `SymbolRegimeTable`은 봇이 실행 중이지 않으면 `entries.length === 0`이므로 `return null` (line 14) -- 자연 숨김
- 하지만 봇이 실행 중일 때 두 컴포넌트가 **동시에 보이면** 화면이 길어지고 정보가 중복

**제안**:
- 방법 A: `SymbolRegimeTable`을 `StrategySymbolMap` 내부의 **접을 수 있는 섹션**으로 통합
- 방법 B: `SymbolRegimeTable`에 접기/펼치기 토글 추가 (기본 접힌 상태)
- 방법 C: 대시보드에서 `MarketIntelligence` 섹션의 하위 탭으로 통합 (이미 "코인 스코어보드" 탭이 유사 정보를 제공)

**난이도**: M (1시간)
**예상 영향**: 대시보드 정보 밀도 최적화, 중복 정보 제거

---

### 11. [R12-FE-11] DrawdownChart의 gradientId 전역 충돌 가능성

**심각도**: LOW
**파일**: `frontend/src/components/DrawdownChart.tsx`

**근거**:
```typescript
// line 65-68
<linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="#F87171" stopOpacity={0.05} />
  <stop offset="100%" stopColor="#F87171" stopOpacity={0.2} />
</linearGradient>
```

- SVG `id="drawdownGradient"`가 **하드코딩**되어 있음
- 현재 `DrawdownChart`가 한 페이지에 한 번만 사용되므로 문제 없음
- 하지만 향후 백테스트 결과 비교(R11-D12 deferred 항목) 등으로 **같은 페이지에 DrawdownChart가 2개 이상** 렌더링되면 SVG id 충돌 발생
- 비교: `EquityCurveBase.tsx`의 그래디언트 id 처리 방식 확인 필요

**제안**:
- `useId()` (React 18+) 또는 `useMemo(() => crypto.randomUUID(), [])` 활용하여 유니크 id 생성

```typescript
const gradientId = useId();
// ...
<linearGradient id={`dd-grad-${gradientId}`} ...>
```

**난이도**: S (10분)
**예상 영향**: 향후 다중 차트 렌더링 시 SVG 충돌 방지

---

### 12. [R12-FE-12] Deferred 재평가: tournament/page.tsx 분할 (R11-D11)

**심각도**: MEDIUM (Deferred 재평가)
**파일**: `frontend/src/app/tournament/page.tsx` (441줄)

**근거**:
- 이전 R11에서 deferred된 항목: "tournament/page.tsx 478줄 -> 분할 검토"
- 현재 441줄로 약간 줄었으나 여전히 한 파일에 4개의 컴포넌트가 정의됨:
  - `TournamentPage` (메인 페이지, line 28-223)
  - `StatCard` (line 228-245)
  - `LeaderboardRow` (line 247-307)
  - `StrategyDetailPanel` (line 309-440)
- `StatCard`는 단순 표시 컴포넌트 (17줄)이므로 분리 불필요
- `LeaderboardRow`는 60줄, `StrategyDetailPanel`은 131줄로 각각 독립적 역할

**제안**:
- `StrategyDetailPanel`을 `frontend/src/components/tournament/StrategyDetailPanel.tsx`로 분리
- `LeaderboardRow`는 `StrategyDetailPanel`과 함께 분리하거나, 리더보드 테이블 전체를 `LeaderboardTable.tsx`로 분리
- 페이지 파일은 데이터 훅 + 상태 관리 + 레이아웃 조합만 담당

**난이도**: M (1시간)
**예상 영향**: 코드 탐색성 향상, 컴포넌트 테스트 용이성

---

### 13. [R12-FE-13] Deferred 재평가: 백테스트 결과 비교 기능 (R11-D12)

**심각도**: MEDIUM (Deferred 재평가 + 신규 UX 제안)
**파일**: `frontend/src/app/backtest/page.tsx`, `frontend/src/components/backtest/BacktestListPanel.tsx`

**근거**:
- 현재 백테스트 결과는 한 번에 하나만 볼 수 있음 (line 122-133: `activeResult` 하나만 표시)
- `BacktestListPanel`에서 결과를 선택하면 이전 결과가 **대체**됨 (line 139: `onSelect={fetchResult}`)
- 18개 전략을 운영하는 시스템에서 전략 간 백테스트 결과를 비교하는 것은 핵심 워크플로우
- 현재 비교하려면 수동으로 결과를 번갈아 선택해야 하며, 메트릭을 기억해야 함

**제안 (Phase 1 -- 최소 구현)**:
- `BacktestListPanel`에 멀티 선택 모드 추가 (체크박스)
- 선택된 2~3개 결과의 핵심 메트릭을 **나란히 비교하는 테이블** 표시
- 비교 대상 메트릭: 총 수익률, 승률, 최대 낙폭, 샤프 비율, 수익 팩터 (5개)

**난이도**: L (3시간)
**예상 영향**: 전략 선정 과정의 효율성 대폭 향상

---

## 제안 사항 우선순위

| 순위 | ID | 항목 | 심각도 | 난이도 | 예상 시간 |
|------|-----|------|--------|--------|-----------|
| 1 | R12-FE-03 | addToast 의존성 누락 | MEDIUM | S | 10분 |
| 2 | R12-FE-04 | setInterval 변수 섀도잉 | MEDIUM | S | 10분 |
| 3 | R12-FE-09 | TradingModeToggle 에러 무시 | MEDIUM | S | 15분 |
| 4 | R12-FE-11 | DrawdownChart gradientId | LOW | S | 10분 |
| 5 | R12-FE-08 | PositionsTable 전략 컬럼 추가 | MEDIUM | S | 20분 |
| 6 | R12-FE-06 | SignalFeed 모바일 반응형 | MEDIUM | S | 30분 |
| 7 | R12-FE-05 | useBacktest 폴링 Visibility | MEDIUM | S | 30분 |
| 8 | R12-FE-07 | AccountOverview value flash | MEDIUM | M | 1시간 |
| 9 | R12-FE-01 | useSocket 이중 구독 | HIGH | M | 1시간 |
| 10 | R12-FE-10 | SymbolRegime 중복 통합 | MEDIUM | M | 1시간 |
| 11 | R12-FE-02 | PerformanceTabs 갱신 부재 | HIGH | M | 1.5시간 |
| 12 | R12-FE-12 | tournament/page.tsx 분할 | MEDIUM | M | 1시간 |
| 13 | R12-FE-13 | 백테스트 결과 비교 | MEDIUM | L | 3시간 |

**총 예상 시간**: ~10.5시간 (S: 2시간, M: 5.5시간, L: 3시간)

### 추천 Sprint 범위

**Core Sprint (S 난이도 7건, ~2시간)**: R12-FE-03, 04, 09, 11, 08, 06, 05
**Extended Sprint (+M 난이도 4건, +5.5시간)**: R12-FE-07, 01, 10, 02
**Deferred (L 2건)**: R12-FE-12, 13

---

## 다른 에이전트에게 요청 사항

### Engineer 에이전트에게

1. **R12-FE-01 (이중 소켓 구독)**: 백엔드의 Socket.io 이벤트 구조를 확인해주세요. `market:regime_change` 이벤트가 발생할 때 payload 크기가 얼마인지, 프론트엔드에서 두 번 처리되는 것이 서버 측에도 영향이 있는지 확인 부탁드립니다.

2. **R12-FE-08 (PositionsTable 전략 컬럼)**: `tradeApi.getPositions()` 응답의 `Position` 객체에 `strategy` 필드가 항상 포함되는지 확인 부탁드립니다. 백엔드 `positionManager`에서 해당 필드를 populate하는지 확인이 필요합니다.

3. **R12-FE-02 (PerformanceTabs 갱신)**: `analyticsApi.getByStrategy`, `getBySymbol`, `getDaily`의 응답 크기가 얼마인지 (전략 18개 * 심볼 다수일 때) 확인 부탁드립니다. 10초 간격 polling이 서버에 부담이 되지 않는지 판단이 필요합니다.

### Trader 에이전트에게

1. **R12-FE-13 (백테스트 비교)**: 전략 비교 시 가장 중요한 메트릭 5개를 선정해주세요. 현재 제안은 총 수익률, 승률, 최대 낙폭, 샤프 비율, 수익 팩터이지만, 트레이더 관점에서 우선순위가 다를 수 있습니다.

2. **R12-FE-07 (value flash)**: 트레이더가 대시보드를 모니터링할 때, 어떤 값의 변동을 가장 먼저 인지해야 하는지 우선순위를 알려주세요. (총 자산, 미실현 PnL, 리스크 점수 등)

---

## 미포함 사항 (분석 결과 이슈 아님으로 판단)

1. **CSS 변수 체계**: `globals.css`의 CSS 커스텀 프로퍼티 체계가 일관적이고 잘 정리되어 있음. 테마 관련 추가 작업 불필요.
2. **타입 시스템**: R11에서 `RiskStatusExtended` 도입 등 타입 안전성이 크게 개선됨. `any` 타입 잔존 없음.
3. **적응형 폴링**: `useAdaptivePolling` 훅이 Page Visibility + Bot State + Risk State를 모두 고려하는 우수한 구현. 추가 개선 불필요.
4. **접근성**: 모든 다이얼로그에 focus trap, ESC 닫기, aria 속성이 적용됨. WCAG 준수 상태 양호.
5. **ErrorToast 시스템**: severity 기반 auto-dismiss가 잘 구현됨. 현재 `useToasts`만 사용하므로 full toast 시스템(T3-11 deferred)은 여전히 향후 과제.
6. **차트 라이브러리**: Recharts 기반 차트들이 일관된 설정(`chart-config.ts`)을 공유하고 있어 유지보수성 양호.
