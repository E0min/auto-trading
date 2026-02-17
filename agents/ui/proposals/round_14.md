# Round 14 Proposal: 코드베이스 재분석 Round 4

**분석 일자**: 2026-02-17
**분석 대상**: 프론트엔드 전체 (components, hooks, lib, types, pages)
**이전 라운드**: R13 (전략 모듈화 + 파라미터 튜닝 + UX), R12 (BE 20건 + BT 3건 + FE 12건)

---

## 분석 요약

R13에서 추가된 StrategyExplainer, Quick Stats Bar, 3-tab 구조는 전반적으로 잘 구현되어 있다. 이번 Round 14에서는 다음 5개 영역에서 **새로운** 개선 기회 15건을 발굴했다:

1. **StrategyConfigPanel 입력 유효성 검증 부재** -- 범위 밖 값 입력 시 피드백 없음
2. **CustomStrategyBuilder 모달 접근성 & ESC 처리 미흡** -- 포커스 트랩/키보드 내비게이션 없음
3. **PerformanceTabs 데이터 갱신 누락** -- 한번 로드 후 stale 상태 유지
4. **StrategyExplainer 진입/청산 섹션 반응형 깨짐** -- grid-cols-2가 모바일에서 좁아짐
5. **대시보드 page.tsx 거대 컴포넌트** -- 310줄 단일 파일에 모든 로직 집중
6. **Tabs 컴포넌트 ARIA 불완전** -- role="tablist" 누락, 방향키 내비게이션 없음
7. **StrategyHub 필터 상태 URL 비동기화** -- 카테고리/레짐 필터가 URL에 반영 안됨
8. **useAdaptivePolling 이중 visibilitychange 리스너** -- 동일 이벤트에 2개 핸들러 등록
9. **ConditionRow 피연산자 전환 UX 불명확** -- `#->f` / `f->#` 버튼이 비직관적
10. **트레이드 테이블 정렬 기능 부재** -- 시간/PnL/상태 등 컬럼 정렬 불가
11. **SignalFeed 가상화 미적용** -- 50개까지 누적 시 불필요한 DOM 생성
12. **StrategyCard Quick Stats Bar 과밀** -- regimes + docs + 구분자가 좁은 뷰포트에서 overflow
13. **RiskStatusPanel 접근성 개선** -- meter 요소에 aria-valuetext 누락, 색상 의존적 상태 전달
14. **토너먼트 페이지 단일 파일 분할 필요** -- 441줄의 모놀리식 컴포넌트
15. **전략 비교 뷰 (deferred) 구현 가치 재확인** -- 2개 이상 전략의 성과를 사이드바이사이드 비교

---

## 발견 사항

### R14-1. StrategyConfigPanel 입력 유효성 검증 부재 [HIGH]

**파일**: `frontend/src/components/strategy/StrategyConfigPanel.tsx:187-226`

현재 `ParamInput` 컴포넌트는 `<input type="number" min={meta.min} max={meta.max}>`를 사용하지만, HTML5 기본 유효성 검증만 의존한다. 사용자가 범위 밖 값을 직접 입력하면(예: min=1, max=20인데 100 입력) 아무런 시각적 피드백 없이 저장 시도가 가능하다.

```tsx
// StrategyConfigPanel.tsx:208-220 -- min/max 시각적 피드백 없음
<input
  type="number"
  min={meta.min}
  max={meta.max}
  step={meta.step || 1}
  value={value === '' ? '' : String(value)}
  onChange={(e) => {
    const v = meta.type === 'integer'
      ? parseInt(e.target.value, 10)
      : e.target.value;
    onChange(isNaN(v as number) ? e.target.value : v);
  }}
  className="w-16 ..."
/>
```

**문제점**:
- range 슬라이더와 number input이 동기화되지만, number input에서 범위 초과 시 빨간 테두리 등 피드백 없음
- 저장 버튼 클릭 시 서버에 유효하지 않은 값이 전송될 수 있음
- `ParamMeta.description` 필드가 존재하지만 UI에 표시되지 않음 (types/index.ts:192)

**제안**:
- 값이 min/max 범위를 벗어나면 input border를 빨간색으로 변경하고 에러 메시지 표시
- `meta.description`이 있으면 tooltip 또는 help text로 표시
- 저장 시 클라이언트 사이드 유효성 검증 추가

---

### R14-2. CustomStrategyBuilder 모달 접근성 & ESC 처리 [HIGH]

**파일**: `frontend/src/components/strategy/CustomStrategyBuilder.tsx:184-372`

`CustomStrategyBuilder`는 `fixed inset-0 z-50` 오버레이 모달이지만, `DisableModeDialog`(StrategyHub.tsx:380-488)와 달리:
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` 속성 없음
- ESC 키 핸들러 없음
- 포커스 트랩 없음 (탭 키로 모달 밖 요소에 접근 가능)
- 이전 포커스 복원 없음

```tsx
// CustomStrategyBuilder.tsx:185 -- 접근성 속성 없음
<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8">
  <div className="bg-[var(--bg-card)] ...">
```

반면 `DisableModeDialog`는 이미 훌륭하게 구현되어 있음:
```tsx
// StrategyHub.tsx:432-437 -- 올바른 접근성 구현
<div role="dialog" aria-modal="true" aria-labelledby="disable-dialog-title" ...>
```

**제안**: DisableModeDialog의 접근성 패턴(ESC, focus trap, focus restore)을 CustomStrategyBuilder에도 동일하게 적용

---

### R14-3. PerformanceTabs stale-while-revalidate 패턴 부재 [MEDIUM]

**파일**: `frontend/src/components/analytics/PerformanceTabs.tsx:43,97-103`

`loadedTabs` Set으로 1회 로드 후 재요청하지 않는다:
```tsx
// PerformanceTabs.tsx:43 -- loadedTabs가 useState 초기값으로 고정
const [loadedTabs] = useState<Set<TabKey>>(() => new Set<TabKey>(['equity']));

// :97-103 -- 이미 로드된 탭은 다시 조회하지 않음
const handleTabClick = useCallback((tab: TabKey) => {
  setActiveTab(tab);
  if (tab !== 'equity' && !loadedTabs.has(tab) && sessionIdRef.current) {
    loadedTabs.add(tab);
    fetchTabData(tab);
  }
}, [loadedTabs, fetchTabData]);
```

봇이 장시간 실행 중일 때 전략별/심볼별/일별 성과 데이터가 처음 조회 값에서 멈춘다. 이전 라운드에서 deferred된 "stale-while-revalidate" 패턴을 이제 구현할 가치가 있다.

**제안**:
- 탭 전환 시 마지막 조회 후 60초 이상 경과했으면 백그라운드 재조회
- 이전 데이터를 보여주면서 새 데이터 로딩 (stale-while-revalidate)
- 탭 헤더에 "업데이트됨: HH:MM" 표시

---

### R14-4. StrategyExplainer 청산 조건 grid-cols-2 모바일 깨짐 [LOW]

**파일**: `frontend/src/components/strategy/StrategyExplainer.tsx:49`

```tsx
// :49 -- 좁은 카드 내부에서 2열 그리드가 깨질 수 있음
<div className="grid grid-cols-2 gap-2">
  <MiniStat label="익절 (TP)" value={docs.exit.tp} color="text-[var(--profit)]" />
  <MiniStat label="손절 (SL)" value={docs.exit.sl} color="text-[var(--loss)]" />
  <MiniStat label="트레일링" value={docs.exit.trailing} />
</div>
```

StrategyExplainer는 StrategyCard 내부 패널(px-4)에 렌더링되므로 가용 너비가 매우 좁다. grid-cols-2에서 3개 항목이면 트레일링이 홀로 한 줄을 차지하며 시각적으로 불균형.

**제안**: `grid-cols-3`으로 변경하거나, 좁은 뷰에서 `grid-cols-1`으로 폴백하는 반응형 처리

---

### R14-5. Dashboard page.tsx 거대 컴포넌트 분할 [MEDIUM]

**파일**: `frontend/src/app/page.tsx` (310줄)

단일 `Dashboard` 컴포넌트에 12개 이상의 훅과 모든 핸들러가 집중되어 있다:

```tsx
// page.tsx:33-131 -- 약 100줄의 훅/핸들러/상태
const { status, loading, startBot, stopBot, ... } = useBotStatus();
const { connected, signals, regime, ... } = useSocket();
const { events, acknowledge, dismiss } = useRiskEvents(...);
const { positions, accountState, ... } = usePositions(...);
const { trades, ... } = useTrades(...);
const { equityCurve, ... } = useAnalytics(...);
const { health, latency, error } = useHealthCheck();
const { toasts, addToast, dismissToast } = useToasts();
// + handleClosePosition, handleResetDrawdown, handleStartBot...
```

**문제점**:
- 한 줄의 상태 변경이 전체 컴포넌트 리렌더 유발
- 코드 내비게이션 어려움
- 테스트 불가

**제안**: 섹션별 서브 컴포넌트로 분리
- `DashboardHeader` (봇 컨트롤, 시스템 헬스, 트레이딩 모드)
- `DashboardHero` (AccountOverview)
- `DashboardPerformance` (PerformanceTabs + RiskStatusPanel)
- `DashboardTrading` (PositionsTable + SignalFeed + TradesTable)

---

### R14-6. Tabs 컴포넌트 ARIA 불완전 [HIGH]

**파일**: `frontend/src/components/ui/Tabs.tsx:46-56, 67-93`

현재 `TabList`에 `role="tablist"` 속성이 없고, `Tab`에는 `role="tab"`과 `aria-selected`가 있지만 방향키(좌/우) 내비게이션이 없다:

```tsx
// Tabs.tsx:46-56 -- role="tablist" 누락
export function TabList({ children, className }: TabListProps) {
  return (
    <div className={cn('flex gap-1 border-b ...', className)}>
      {children}
    </div>
  );
}
```

WAI-ARIA Tabs 패턴에 따르면:
- `TabList`에 `role="tablist"` 필수
- `Tab`에 `aria-controls="panel-id"` 필수
- `TabPanel`에 `aria-labelledby="tab-id"` 필수
- 좌우 방향키로 탭 간 이동, Home/End로 처음/마지막 탭 이동
- 현재 활성 탭만 `tabIndex={0}`, 나머지는 `tabIndex={-1}`

**제안**: WAI-ARIA Tabs 패턴 완전 준수로 업그레이드. `useId()`로 자동 ID 생성.

---

### R14-7. StrategyHub 필터 상태 URL 비동기화 [LOW]

**파일**: `frontend/src/components/strategy/StrategyHub.tsx:59-60`

```tsx
const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
const [regimeFilter, setRegimeFilter] = useState<string>('all');
```

카테고리와 레짐 필터가 로컬 state만 사용하므로 페이지 새로고침 시 초기화된다. 사용자가 "price-action + trending_up"으로 필터링한 상태를 유지할 수 없다.

**제안**: Next.js `useSearchParams()`와 `useRouter()`로 URL query 동기화 (`?category=price-action&regime=trending_up`). 링크 공유 시에도 동일 필터 상태 복원 가능.

---

### R14-8. useAdaptivePolling 이중 visibilitychange 리스너 [MEDIUM]

**파일**: `frontend/src/hooks/useAdaptivePolling.ts:32-36, 47-55`

동일 파일 내에서 `visibilitychange` 이벤트에 2개의 독립 리스너를 등록한다:

```tsx
// :32-36 -- 첫 번째: isVisible 상태 업데이트
useEffect(() => {
  const handler = () => setIsVisible(!document.hidden);
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, []);

// :47-55 -- 두 번째: 탭 복귀 시 즉시 fetch
useEffect(() => {
  const handler = () => {
    if (!document.hidden) {
      fetchFn();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, [fetchFn]);
```

**문제점**: 하나의 논리를 2개 useEffect로 분리하여 불필요한 리스너 중복. 또한 fetchFn이 변경될 때마다 두 번째 리스너가 재등록됨.

**제안**: 단일 useEffect에서 `isVisible` 업데이트와 즉시 fetch를 모두 처리. fetchFn은 ref로 래핑하여 리스너 재등록 방지.

---

### R14-9. ConditionRow 피연산자 전환 UX 개선 [LOW]

**파일**: `frontend/src/components/strategy/ConditionRow.tsx:116-129`

```tsx
// :116-129 -- 버튼 텍스트가 비직관적
<button
  title={isRightNumeric ? '지표로 전환' : '숫자로 전환'}
  className="px-1 py-0.5 text-[9px] ..."
>
  {isRightNumeric ? '#→f' : 'f→#'}
</button>
```

`#->f`와 `f->#` 기호는 개발자에게는 이해되지만 일반 트레이딩 사용자에게는 의미 불명확. title 속성으로 한국어 설명이 있지만 hover 전에는 보이지 않음.

**제안**:
- 텍스트를 "숫자" / "지표"로 변경
- 또는 아이콘 + 더 명확한 라벨 사용 (`123` / `f(x)`)
- 현재 모드를 시각적으로 구분 (active state 색상)

---

### R14-10. TradesTable 컬럼 정렬 기능 [MEDIUM]

**파일**: `frontend/src/components/TradesTable.tsx:73-85`

테이블 헤더가 순수 텍스트이며 정렬 기능이 없다:
```tsx
// :73-85 -- 정적 테이블 헤더
<thead>
  <tr>
    <th scope="col">시간</th>
    <th scope="col">심볼</th>
    ...
  </tr>
</thead>
```

거래 내역이 많아지면 사용자가 PnL 높은 순/낮은 순, 최신/오래된 순 등으로 정렬하고 싶어할 수 있다. 동일하게 PositionsTable에도 적용 가능.

**제안**:
- 정렬 가능 컬럼에 클릭 핸들러 + 화살표 아이콘 추가
- `useMemo`로 정렬된 데이터 캐싱
- 기본 정렬: 시간 역순(최신 우선)

---

### R14-11. SignalFeed 대량 DOM 최적화 [LOW]

**파일**: `frontend/src/components/SignalFeed.tsx:25-69`

`useSocket`에서 시그널은 최대 50개까지 누적된다 (socket.ts:39). `SignalFeed`는 이 50개를 모두 DOM에 렌더링:

```tsx
// :25-69 -- 50개 모두 렌더링
<div className="space-y-0">
  {signals.map((signal, idx) => (
    <div key={signal._id || idx} className="flex flex-col sm:flex-row ...">
      ...
    </div>
  ))}
</div>
```

50개 정도는 성능 문제가 없지만, `max-h-[500px] overflow-y-auto` 스크롤 컨테이너 내에서 뷰포트 밖 항목도 모두 렌더링된다.

**제안**: 현재는 50개로 충분히 가벼우므로 LOW 우선순위. 다만 "더 보기" 패턴(초기 10개 표시 + 버튼으로 확장)이 정보 밀도 측면에서 더 효과적일 수 있다.

---

### R14-12. StrategyCard Quick Stats Bar 과밀 & overflow [MEDIUM]

**파일**: `frontend/src/components/strategy/StrategyCard.tsx:153-176`

Quick Stats Bar에 레짐 태그 + 구분자 + 난이도 + 지표 수가 한 줄에 표시됨:

```tsx
// :153-176 -- flex-wrap이 있지만 좁은 카드에서 2줄 이상으로 불규칙하게 넘침
<div className="flex items-center gap-2 mt-1.5 flex-wrap">
  {regimes.slice(0, 3).map(...)}
  {regimes.length > 0 && strategy.docs && (
    <span className="text-[var(--border-muted)] text-[10px]">|</span>
  )}
  {strategy.docs && (
    <>
      <span className={cn('text-[10px]', getDifficultyColor(strategy.docs.difficulty))}>
        {translateDifficulty(strategy.docs.difficulty)}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">
        {strategy.docs.indicators.length}개 지표
      </span>
    </>
  )}
</div>
```

**문제점**: 레짐이 3개이고 docs가 있으면 `상승 추세 | 하락 추세 | 횡보 | 초급 3개 지표`처럼 상당히 길어짐. `flex-wrap`이 있어 줄바꿈은 되지만, 구분자 `|`가 줄바꿈 경계에 걸리면 어색한 레이아웃이 된다.

**제안**:
- 레짐 태그와 난이도/지표를 별도 줄로 분리하거나
- 구분자를 CSS `border-left`로 대체하여 줄바꿈 시에도 자연스럽게 처리
- 좁은 뷰포트에서는 레짐 태그만 표시하고 난이도/지표는 숨김

---

### R14-13. RiskStatusPanel 접근성 강화 [HIGH]

**파일**: `frontend/src/components/RiskStatusPanel.tsx:84,104`

`role="meter"` 요소에 `aria-valuetext`가 없어 스크린 리더가 수치만 읽고 맥락을 알 수 없음:

```tsx
// :84 -- aria-valuetext 없음
<div className="w-full ..." role="meter" aria-label="드로다운"
     aria-valuenow={drawdownPct} aria-valuemin={0} aria-valuemax={10}>

// :104 -- 동일 문제
<div className="w-full ..." role="meter" aria-label="노출도"
     aria-valuenow={exposurePct} aria-valuemin={0} aria-valuemax={100}>
```

또한 종합 리스크 점수(riskScore)가 색상으로만 상태를 전달한다 (`text-emerald-400`, `text-amber-400`, `text-red-400`). 색약 사용자는 안전/주의/위험 구분이 어려울 수 있다.

**제안**:
- `aria-valuetext`에 `"드로다운 3.5% (최대 10%)"` 형식 추가
- 리스크 점수에 배경/테두리 아이콘 등 색상 외 시각적 단서 추가
- "안전" / "주의" / "위험" 라벨이 이미 있으므로, 아이콘(방패/경고/위험 삼각형) 보강

---

### R14-14. 토너먼트 페이지 분할 [LOW]

**파일**: `frontend/src/app/tournament/page.tsx` (441줄)

이전 라운드에서 deferred된 항목. 현재 단일 파일에:
- `TournamentPage` 메인 컴포넌트 (224줄)
- `StatCard` 서브 컴포넌트 (228-245)
- `LeaderboardRow` 서브 컴포넌트 (247-307)
- `StrategyDetailPanel` 서브 컴포넌트 (309-440)

**제안**: 서브 컴포넌트를 별도 파일로 분리
- `components/tournament/LeaderboardTable.tsx`
- `components/tournament/StrategyDetailPanel.tsx`
- `components/tournament/TournamentHeader.tsx`

---

### R14-15. 전략 비교 뷰 [MEDIUM]

이전 라운드에서 deferred된 항목. 봇 운영 시 "이 전략과 저 전략 중 어느 것이 더 나은가"를 판단하는 가장 핵심적인 UX 중 하나.

**제안**:
- StrategyHub에서 2-3개 전략을 체크박스로 선택 후 "비교" 버튼
- 사이드바이사이드 비교 테이블: 승률, 총 PnL, 최대 드로다운, 평균 수익/손실, Sharpe 등
- PerformanceTabs의 전략별 성과 데이터 재활용 가능
- 백테스트 결과 비교로도 확장 가능

---

## 제안 사항 (우선순위별 정리)

| # | 제안 | 우선순위 | 구현 난이도 | 예상 시간 | 파일 |
|---|------|---------|-----------|----------|------|
| R14-1 | StrategyConfigPanel 입력 유효성 검증 | HIGH | 낮음 | 30분 | StrategyConfigPanel.tsx |
| R14-2 | CustomStrategyBuilder 모달 접근성 | HIGH | 중간 | 45분 | CustomStrategyBuilder.tsx |
| R14-6 | Tabs ARIA 완전 준수 | HIGH | 중간 | 40분 | ui/Tabs.tsx |
| R14-13 | RiskStatusPanel 접근성 강화 | HIGH | 낮음 | 20분 | RiskStatusPanel.tsx |
| R14-3 | PerformanceTabs stale-while-revalidate | MEDIUM | 중간 | 40분 | PerformanceTabs.tsx |
| R14-5 | Dashboard page.tsx 분할 | MEDIUM | 중간 | 60분 | app/page.tsx |
| R14-8 | useAdaptivePolling 리스너 통합 | MEDIUM | 낮음 | 15분 | useAdaptivePolling.ts |
| R14-10 | TradesTable 컬럼 정렬 | MEDIUM | 중간 | 45분 | TradesTable.tsx |
| R14-12 | Quick Stats Bar 과밀 해소 | MEDIUM | 낮음 | 25분 | StrategyCard.tsx |
| R14-15 | 전략 비교 뷰 | MEDIUM | 높음 | 90분 | 신규 컴포넌트 |
| R14-4 | StrategyExplainer 반응형 | LOW | 낮음 | 10분 | StrategyExplainer.tsx |
| R14-7 | StrategyHub 필터 URL 동기화 | LOW | 중간 | 30분 | StrategyHub.tsx |
| R14-9 | ConditionRow 전환 버튼 UX | LOW | 낮음 | 15분 | ConditionRow.tsx |
| R14-11 | SignalFeed "더 보기" 패턴 | LOW | 낮음 | 15분 | SignalFeed.tsx |
| R14-14 | 토너먼트 페이지 분할 | LOW | 낮음 | 30분 | tournament/page.tsx |

**총 예상 시간**: 약 8시간 (FE 전담)

---

## 구현 우선순위 권장

### Sprint R14 추천 범위 (10건, ~5시간)

**Phase 1: 접근성 & 유효성** (4건, HIGH)
1. R14-1: StrategyConfigPanel 입력 유효성
2. R14-2: CustomStrategyBuilder 모달 접근성
3. R14-6: Tabs ARIA 완전 준수
4. R14-13: RiskStatusPanel 접근성 강화

**Phase 2: 데이터 & 성능** (3건, MEDIUM)
5. R14-8: useAdaptivePolling 리스너 통합
6. R14-3: PerformanceTabs stale-while-revalidate
7. R14-12: Quick Stats Bar 과밀 해소

**Phase 3: UX 향상** (3건, MEDIUM/LOW)
8. R14-4: StrategyExplainer 반응형
9. R14-9: ConditionRow 전환 버튼 UX
10. R14-10: TradesTable 컬럼 정렬

### Deferred (R15 이후)
- R14-5: Dashboard page.tsx 분할 (리팩토링 스코프가 크고, 기능 영향 없음)
- R14-7: StrategyHub 필터 URL 동기화 (편의 기능)
- R14-11: SignalFeed "더 보기" (현재 50개로 충분)
- R14-14: 토너먼트 페이지 분할 (리팩토링)
- R14-15: 전략 비교 뷰 (신규 기능, 충분한 설계 필요)

---

## Deferred 항목 재평가

| 항목 | 이전 상태 | R14 재평가 | 사유 |
|------|----------|-----------|------|
| tournament/page.tsx 분할 | deferred (R12) | **유지 (deferred)** | 코드 품질 개선이지만 사용자 체감 변화 적음. R15에서 신규 기능 추가 시 함께 분리 |
| PerformanceTabs stale-while-revalidate | deferred (R13) | **구현 권장 (R14-3)** | 장시간 운영 시 stale 데이터 문제가 실제 발생. 구현 난이도 낮음 |
| 백테스트 결과 비교 | deferred (R13) | **유지 (deferred)** | 전략 비교 뷰(R14-15)를 먼저 구현한 후 확장하는 것이 자연스러움 |
| 파이프라인 시각화 | deferred (R13) | **유지 (deferred)** | 트레이더 관점에서 우선순위 낮음. RegimeFlowMap이 유사 역할 수행 중 |
| 모듈별 설정 아코디언 | deferred (R13) | **유지 (deferred)** | StrategyCard 3탭 구조에서 설정 탭이 역할 대체 중 |
| 전략 비교 뷰 | deferred (R13) | **조건부 권장 (R14-15)** | 데이터 인프라(StrategyStats API)가 이미 있어 구현 가능. 다만 90분 규모라 이번 스프린트 범위 초과 시 defer |
| 모바일 반응형 | deferred (R12) | **부분 구현 (R14-4, R14-12)** | 전체 반응형은 대규모 작업이나, 개별 컴포넌트 단위 개선은 가능 |
| 전략 숨김/표시 | deferred (R12) | **유지 (deferred)** | 필터 기능이 이미 숨김 역할을 부분적으로 수행 |

---

## 다른 에이전트에게 요청 사항

### Trader/Engineer 에이전트

1. **전략 비교 API (R14-15 관련)**: 현재 `/api/trades/strategy-stats/:name`이 단일 전략 통계만 반환. 다수 전략의 통계를 한번에 조회하는 batch endpoint가 있으면 비교 뷰 구현이 효율적
   - 예: `GET /api/analytics/compare?strategies=MaTrend,Supertrend&sessionId=...`
   - 반환: 각 전략의 승률, PnL, 드로다운, Sharpe 등 비교 가능한 형태

2. **StrategyConfigPanel 유효성 검증 (R14-1 관련)**: 백엔드 `strategyConfigValidator.js`에서 이미 서버 사이드 검증을 수행하고 있는지 확인 필요. 클라이언트 사이드 검증과 이중화 여부 판단용.

3. **ParamMeta description 데이터 (R14-1 관련)**: `ParamMeta.description` 필드가 types에 정의되어 있으나, 실제 백엔드 전략 파일에서 이 필드를 채우고 있는지 확인. 비어있으면 FE tooltip 구현이 무의미.

---

## 참고: 코드 품질 메트릭

| 메트릭 | 값 |
|--------|-----|
| 프론트엔드 총 파일 수 | ~55개 (components + hooks + lib + types + pages) |
| 최대 파일 크기 | tournament/page.tsx (441줄), page.tsx (310줄) |
| 컴포넌트 수 | ~35개 |
| 커스텀 훅 수 | 14개 |
| 타입 정의 | ~60개 인터페이스/타입 |
| UI 컴포넌트 라이브러리 | 8개 (Card, Button, Badge, Tabs, Spinner, ConfirmDialog, ErrorToast, PaperModeGate) |
| CSS 변수 | 12개 |
| 접근성 준수율 | ~75% (role, aria-label은 있으나 ARIA 패턴 완전 준수 미흡) |
