# Round 9 Proposal: Tier 2 Quality (11건)

> **Author**: UI/UX Agent
> **Date**: 2026-02-17
> **Scope**: Frontend 5건 (코드 레벨 분석 + 구현 방안) + Backend 6건 (UX 코멘트) + Deferred 2건 재평가
> **Context**: Round 8 완료 (81bdca6), 46건 합의 중 25건 구현, 나머지 Tier 2/3 + deferred 잔여

---

## 분석 요약

Round 8에서 23건을 발견하여 CRITICAL/HIGH를 우선 구현했다. 이번 Round 9는 R8에서 합의되었으나 구현되지 않은 Tier 2 항목 11건(FE 5건, BE 6건)을 대상으로 한다.

Frontend 5건은 모두 소스 코드를 직접 분석한 결과, 명확한 수정 범위와 구체적 구현 방안이 도출되었다. 접근성 1건, 데드코드 1건, 모바일 반응형 3건이다. 모두 난이도 하~중이며, 총 예상 시간은 약 2시간 20분이다.

| 카테고리 | 건수 | 예상 시간 | 위험도 |
|---------|------|----------|-------|
| 접근성 (R8-T2-8) | 1 | 30m | 중 (HTML 규격 위반) |
| 데드코드 (R8-T2-9) | 1 | 15m | 하 |
| 모바일 반응형 (R8-T2-10, T2-11, T2-12) | 3 | 1h 35m | 하~중 |

---

## Frontend 항목 분석

### R8-T2-8: StrategyCard toggle 접근성 수정 [30m, 합의 3/3]

**파일**: `frontend/src/components/strategy/StrategyCard.tsx`

#### 현재 코드의 문제점

**문제 1: Interactive element 중첩 (HTML 규격 위반)**
- 줄 96~125: `<button>` (expand 버튼) 안에 `<div role="switch" onClick={handleToggleClick}>` (toggle)가 중첩되어 있다.
- HTML spec에 의하면 `<button>` 안에 또 다른 interactive element를 넣을 수 없다 (WCAG 4.1.2, HTML5 content model).
- 브라우저가 이를 어떻게 해석할지 정의되지 않으며, 스크린리더가 toggle을 인식하지 못할 수 있다.

```tsx
// 줄 96~125 — 문제가 되는 구조
<button type="button" onClick={onExpand} className="w-full ...">   {/* 부모: expand */}
  <div                                                                {/* 자식: toggle */}
    className="flex-shrink-0"
    onClick={handleToggleClick}                                       {/* click만 있음 */}
    role="switch"
    aria-checked={active}
  >
    {/* toggle visual */}
  </div>
  {/* ... strategy info, badges, chevron ... */}
</button>
```

**문제 2: 키보드 접근 불가**
- 줄 102~107: toggle `<div>`에 `tabIndex`가 없어 Tab 키로 도달 불가.
- `onKeyDown` 핸들러가 없어 Enter/Space로 toggle 불가.
- `role="switch"`를 선언했지만 키보드 조작이 없으므로 WCAG 2.1 SC 2.1.1 (Keyboard) 위반.

**문제 3: aria-label 부재**
- toggle에 `aria-label`이 없어 스크린리더 사용자가 "이 switch가 무엇을 하는지" 알 수 없다.

#### 구현 방안

**구조 변경**: 부모 `<button>`을 `<div role="group">`으로 변경하고, toggle과 expand를 각각 독립적인 `<button>`으로 분리한다.

```tsx
// 변경 후 구조
<div className={cn('rounded-lg border ...', /* 기존 조건부 클래스 */)}>
  <div className="flex items-center gap-3 px-4 py-3">
    {/* Toggle — 독립 button */}
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${strategy.name} 전략 ${active ? '비활성화' : '활성화'}`}
      onClick={onToggle}
      className="flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-full"
    >
      {toggling ? (
        <Spinner size="sm" />
      ) : (
        <div className={cn('w-3.5 h-3.5 rounded-full border-2 ...', /* 기존 조건부 */)}>
          {/* 기존 inner dot */}
        </div>
      )}
    </button>

    {/* Expand — 독립 button, flex-1로 나머지 영역 차지 */}
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={expanded}
      aria-controls={`strategy-detail-${strategy.name}`}
      className="flex-1 min-w-0 flex items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
    >
      {/* Strategy info (기존 줄 128~161) */}
      {/* Right side: risk + status + countdown + chevron (기존 줄 165~196) */}
    </button>
  </div>

  {/* Expanded detail */}
  {expanded && (
    <div id={`strategy-detail-${strategy.name}`} className="px-4 pb-4 animate-fade-in">
      <StrategyDetail ... />
    </div>
  )}
</div>
```

**핵심 변경 사항:**
1. `<button>` 안의 `<div onClick>` 패턴을 두 개의 독립적 `<button>`으로 분리
2. toggle 버튼에 `aria-label` 추가 (전략 이름 포함)
3. expand 버튼에 `aria-expanded` + `aria-controls` 추가
4. 양쪽 모두 `focus-visible:ring-2` 포커스 표시
5. `handleToggleClick`의 `stopPropagation()` 불필요해짐 (구조적 분리)

**WCAG 준수 항목:**
- SC 2.1.1 (Keyboard): 두 버튼 모두 Tab으로 도달, Enter/Space로 활성화
- SC 4.1.2 (Name, Role, Value): `role="switch"` + `aria-checked` + `aria-label`
- SC 1.3.1 (Info and Relationships): `aria-expanded` + `aria-controls`

---

### R8-T2-9: MarketRegimeIndicator 중복 코드 정리 (삭제) [15m, 합의 3/3]

**파일**: `frontend/src/components/MarketRegimeIndicator.tsx` (85줄)

#### 현재 코드의 문제점

**중복 코드 확인**: MarketRegimeIndicator.tsx의 내용이 MarketIntelligence.tsx 헤더와 거의 동일하다.

| 기능 | MarketRegimeIndicator (줄) | MarketIntelligence (줄) |
|------|---------------------------|------------------------|
| 현재 레짐 표시 | 37~49 | 72~75 |
| 신뢰도 % | 50~52 | 76~78 |
| Pending regime badge | 60~65 | 81~86 |
| Cooldown badge | 68~72 | 89~93 |
| Transition frequency badge | 75~81 | 96~102 |
| `getTransitionBadge()` 함수 | 27~31 | 53~57 |

MarketRegimeIndicator는 독립 `<Card>` 컴포넌트인 반면, MarketIntelligence는 collapsible Card 헤더에 동일 정보를 인라인으로 포함한다. `page.tsx`에서 MarketRegimeIndicator는 import 되지 않으며, MarketIntelligence만 사용된다 (줄 255~258).

**`getTransitionBadge()` 함수도 중복**: 두 파일에서 동일한 함수가 각각 정의되어 있다 (MarketRegimeIndicator 27~31줄, MarketIntelligence 53~57줄). 같은 임계값(3, 6), 같은 색상 클래스.

#### 구현 방안

**접근법**: MarketRegimeIndicator.tsx 파일을 삭제한다.

1. **MarketRegimeIndicator.tsx 삭제** — 대시보드에서 사용하지 않음. 다른 페이지에서도 import하지 않음 확인 완료.

2. **getTransitionBadge() 유틸리티 추출 (선택적)** — 현재 MarketIntelligence에만 남으므로 추출 불필요. 향후 다른 곳에서 필요하면 `lib/utils.ts`로 이동.

3. **import 검증**: 아래 파일 중 MarketRegimeIndicator를 import하는 곳이 없음을 확인.
   - `page.tsx` — MarketIntelligence만 import (줄 22)
   - `backtest/page.tsx` — 사용 안 함
   - `tournament/page.tsx` — 사용 안 함

**삭제 전 확인 사항:**
```bash
# MarketRegimeIndicator를 import하는 파일이 없는지 최종 확인
grep -r "MarketRegimeIndicator" frontend/src/
```

만약 다른 곳에서 참조가 발견되면, 해당 참조를 MarketIntelligence 또는 인라인 레짐 표시로 대체한다.

---

### R8-T2-10: 대시보드 헤더 모바일 반응형 [45m, 합의 2/3 MEDIUM]

**파일**: `frontend/src/app/page.tsx` 줄 152~224

#### 현재 코드의 문제점

줄 154에서 헤더가 `flex items-center justify-between`으로 한 줄 수평 배치:

```tsx
// 줄 154
<header className="flex items-center justify-between mb-8">
  {/* 좌측 그룹 (줄 155~201) */}
  <div className="flex items-center gap-6">
    <h1>Bitget 자동매매</h1>                     {/* ~130px */}
    <div className="w-px h-5" />                  {/* 1px divider */}
    <TradingModeToggle ... />                     {/* ~160px */}
    <div className="flex items-center gap-2">
      <Link>백테스트</Link>                        {/* ~70px */}
      <Link>토너먼트</Link>                        {/* ~70px */}
    </div>
  </div>
  {/* 우측 그룹 (줄 203~223) */}
  <div className="flex items-center gap-6">
    <SystemHealth ... />                           {/* ~150px */}
    <div className="w-px h-5" />                  {/* 1px divider */}
    <BotControlPanel ... />                        {/* ~250px */}
  </div>
</header>
```

**최소 필요 너비 계산:**
- 좌측: 130 + 16 + 1 + 24 + 160 + 24 + 70 + 8 + 70 = ~503px
- 우측: 150 + 24 + 1 + 24 + 250 = ~449px
- 합계: ~952px + gap(24px) = ~976px

768px(md) 이하에서는 약 200px이 부족하다. `px-6`(24px*2)을 빼면 가용 너비는 720px에 불과.

**구체적 문제:**
1. 줄 154: `flex-wrap` 없어 overflow
2. 줄 159: `w-px h-5` divider가 모바일에서 불필요한 공간 차지
3. 줄 165~201: 백테스트/토너먼트 링크가 모바일에서 필수가 아닌데 공간 차지

#### 구현 방안

**브레이크포인트 전략**: `lg:` (1024px)에서 수평 배치, 그 이하에서 2줄 스택.

```tsx
<header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-8">
  {/* 1열: 로고 + 모드 토글 + 내비 */}
  <div className="flex items-center gap-3 flex-wrap">
    <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
      Bitget 자동매매
    </h1>
    <div className="hidden lg:block w-px h-5 bg-[var(--border-subtle)]" />
    <TradingModeToggle ... />
    {/* 내비 링크 — 모바일에서 축소 */}
    <div className="hidden sm:flex items-center gap-2">
      {/* 기존 Link / disabled span */}
    </div>
  </div>

  {/* 2열: SystemHealth + BotControl */}
  <div className="flex items-center gap-3 sm:gap-6">
    <SystemHealth ... />
    <div className="hidden sm:block w-px h-5 bg-[var(--border-subtle)]" />
    <BotControlPanel ... />
  </div>
</header>
```

**핵심 변경 사항:**
1. `flex` -> `flex flex-col lg:flex-row` (줄 154)
2. divider에 `hidden lg:block` 추가 (줄 159, 210)
3. 백테스트/토너먼트 링크에 `hidden sm:flex` 추가 — 480px 이하에서 숨김
4. gap 축소: `gap-6` -> `gap-3 sm:gap-6` (공간 절약)
5. `px-6 py-8` -> `px-4 py-6 sm:px-6 sm:py-8` (줄 152, 본문 패딩도 반응형)

**모바일(< 640px) 레이아웃:**
```
[Bitget 자동매매] [Live|Paper]
[정상 ● WS ● 23ms] [대기중 ●] [봇 시작] [긴급]
```

**태블릿(640px~1023px) 레이아웃:**
```
[Bitget 자동매매] [Live|Paper] [백테스트] [토너먼트]
[정상 ● WS ● 23ms] | [대기중 ●] [봇 시작] [긴급]
```

**데스크톱(1024px+) 레이아웃 (현재와 동일):**
```
[Bitget 자동매매 | Live|Paper | 백테스트 | 토너먼트]    [정상 ● WS ● 23ms | 대기중 ● 봇 시작 긴급]
```

---

### R8-T2-11: AccountOverview 모바일 레이아웃 [20m, 합의 2/3 MEDIUM]

**파일**: `frontend/src/components/AccountOverview.tsx`

#### 현재 코드의 문제점

줄 15: `grid grid-cols-2 md:grid-cols-4 gap-8 py-2`

```tsx
// 줄 15~55 — 4개 항목이 2x2(모바일) 또는 1x4(md+) 그리드
<div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-2">
  {/* 총 자산 — text-3xl */}
  <div>
    <p className="text-3xl font-mono ...">
      ${formatCurrency(equity)}               {/* 예: $1,234,567.89 → 14자 */}
    </p>
  </div>
  {/* 가용 잔고 — text-lg */}
  {/* 미실현 PnL — text-lg */}
  {/* 활성 포지션 — text-lg */}
</div>
```

**문제 1: 총 자산 overflow**
- `text-3xl` (30px) + `font-mono`에서 큰 금액은 최소 ~180px 필요
- 모바일 375px 기준: (375 - 48패딩) / 2 = 163.5px per column
- `$1,234,567.89` = 약 14자 x 15px(monospace) = 210px -> overflow

**문제 2: gap-8 (32px)이 모바일에서 과도**
- 2열 x 32px gap = 실제 콘텐츠 영역이 더 좁아짐

**문제 3: "총 자산"이 다른 항목과 시각적 동급**
- 가장 중요한 정보인 총 자산이 `text-3xl`로 크게 표시되지만, 2열 레이아웃에서 가용 잔고 바로 옆에 배치되어 시각적 계층 구조가 약화됨

#### 구현 방안

**총 자산을 모바일에서 전체 너비(col-span-full)로 배치하고, 나머지 3개는 3열 그리드로 변경:**

```tsx
<div className="space-y-4 py-2">
  {/* Hero: 총 자산 — 항상 전체 너비 */}
  <div className="animate-number-up">
    <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
      총 자산
    </p>
    <p className="text-2xl sm:text-3xl font-mono font-display text-[var(--text-primary)]">
      ${formatCurrency(equity)}
    </p>
  </div>

  {/* Sub stats: 3열 그리드 */}
  <div className="grid grid-cols-3 gap-4 sm:gap-8">
    {/* 가용 잔고 */}
    <div className="animate-number-up">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
        가용 잔고
      </p>
      <p className="text-base sm:text-lg font-mono text-[var(--text-primary)]">
        ${formatCurrency(availableBalance)}
      </p>
    </div>

    {/* 미실현 PnL */}
    <div className="animate-number-up">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
        미실현 PnL
      </p>
      <p className={`text-base sm:text-lg font-mono font-medium ${getPnlColor(unrealizedPnl)}`}>
        {getPnlSign(unrealizedPnl)}${formatCurrency(unrealizedPnl)}
      </p>
    </div>

    {/* 활성 포지션 */}
    <div className="animate-number-up">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
        활성 포지션
      </p>
      <p className="text-base sm:text-lg font-mono text-[var(--text-primary)]">
        {positionCount}
      </p>
    </div>
  </div>
</div>
```

**핵심 변경 사항:**
1. 총 자산을 별도 행으로 분리 — 항상 전체 너비, 정보 계층 강화
2. `text-3xl` -> `text-2xl sm:text-3xl` — 모바일에서 약간 축소 (여전히 가장 큼)
3. 나머지 3개를 `grid-cols-3`으로 배치 — 모바일에서도 한 줄에 3개가 깔끔하게 들어감
4. `text-lg` -> `text-base sm:text-lg` — 모바일 폰트 축소
5. `gap-8` -> `gap-4 sm:gap-8` — 모바일 간격 축소
6. 외부 컨테이너를 `space-y-4`로 변경하여 총 자산과 sub stats 사이 간격 확보

**레이아웃 비교:**

| 뷰포트 | 현재 | 변경 후 |
|--------|------|---------|
| 모바일 (< 640px) | 2x2 그리드, 총 자산 overflow | 총 자산 전체 너비 + 3열 sub |
| 태블릿+ (640px+) | 4열 그리드 | 총 자산 전체 너비 + 3열 sub (더 큰 폰트/간격) |

---

### R8-T2-12: RegimeFlowMap 모바일 대응 [30m, 합의 3/3]

**파일**: `frontend/src/components/market-intel/RegimeFlowMap.tsx`

#### 현재 코드의 문제점

**문제 1: 고정 px + fr 혼합 그리드 (줄 25~29)**
```tsx
<div className={cn(
  'grid gap-3',
  grace.length > 0
    ? 'grid-cols-[140px_1fr_1fr_1fr]'    // 4열: 140px + 3 * 1fr
    : 'grid-cols-[140px_1fr_1fr]',         // 3열: 140px + 2 * 1fr
)}>
```

모바일 375px 기준: (375 - 48패딩 - 9gap(3*3)) / (140 + 3fr) = 각 1fr 열이 ~59px. 전략 이름 `translateStrategyName()` 결과(예: "멀티 이평선 추세")가 ~100px 필요하므로 truncate 필수.

**문제 2: 하단 5열 레짐 매트릭스 (줄 126)**
```tsx
<div className="grid grid-cols-5 gap-2 ...">
```

모바일에서 5열 = 각 ~57px. `translateRegime()` 결과("상승 추세" = 56px)가 경계에 걸림. 숫자와 "전략" 텍스트가 찌그러짐.

**문제 3: 컨텍스트적 접근 빈도**
이 컴포넌트는 MarketIntelligence 내부의 "전략 라우팅" 탭에 있으므로 접근하려면 (1) MarketIntelligence 펼치기 (2) "전략 라우팅" 탭 선택이 필요. 모바일에서의 접근 빈도는 낮지만, 접근했을 때 정보가 읽을 수 없으면 더 나쁜 경험.

#### 구현 방안

**상단 그리드: 모바일에서 수직 스택, lg에서 수평 그리드**

```tsx
{/* 상단 전략 라우팅 */}
<div className={cn(
  'grid gap-3',
  // 모바일: 1열 스택
  'grid-cols-1',
  // lg+: 원래 그리드
  grace.length > 0
    ? 'lg:grid-cols-[140px_1fr_1fr_1fr]'
    : 'lg:grid-cols-[140px_1fr_1fr]',
)}>
  {/* 현재 레짐 — 모바일에서는 상단 배너 역할 */}
  <div className="flex items-start lg:block">
    <div className={cn(
      'w-full rounded-lg border-2 p-3 text-center',
      // 모바일에서는 가로 배너로
      'lg:text-center',
      currentRegime ? 'border-[var(--accent)]' : 'border-[var(--border-subtle)]',
    )}>
      {/* 기존 레짐 표시 */}
    </div>
  </div>

  {/* Active / Grace / Inactive — 기존 그대로 */}
</div>
```

**하단 레짐 매트릭스: 모바일에서 3+2 또는 스크롤**

```tsx
{/* 레짐 매트릭스 — 모바일 대응 */}
<div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-3 border-t border-[var(--border-subtle)]">
  {ALL_REGIMES.map((regime) => {
    // ... 기존 로직 동일
    return (
      <div
        key={regime}
        className={cn(
          'rounded-lg p-2 text-center border',
          isCurrent
            ? 'border-[var(--accent)] bg-[var(--accent)]/5'
            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
        )}
      >
        <div className={cn('text-[10px] font-medium', getRegimeColor(regime))}>
          {translateRegime(regime)}
        </div>
        <div className="text-lg font-semibold text-[var(--text-primary)] mt-0.5">{count}</div>
        <div className="text-[9px] text-[var(--text-muted)]">전략</div>
      </div>
    );
  })}
</div>
```

**핵심 변경 사항:**
1. 상단 그리드: `grid-cols-[140px_1fr_...]` -> `grid-cols-1 lg:grid-cols-[140px_1fr_...]`
2. 하단 매트릭스: `grid-cols-5` -> `grid-cols-3 sm:grid-cols-5`
   - 모바일에서 3열: 상위 3개 레짐(trending_up, trending_down, ranging)이 1행, 하위 2개(volatile, quiet)가 2행
   - sm+ (640px): 기존 5열 유지
3. 모바일 수직 스택에서 "현재 레짐" 카드가 배너 역할을 하여 컨텍스트 제공
4. 전략 목록 내 truncate는 이미 적용되어 있으므로 (줄 66, 88, 112) 추가 작업 불필요

---

## Backend 항목 UX 코멘트

### R8-T2-1: 멀티심볼 라우팅 Phase 1 [8h]

**FE 영향도: HIGH**

현재 StrategySymbolMap (줄 62~65)에서 이미 `s.symbols` 배열을 처리하고 있으므로, 백엔드가 단일 심볼에서 멀티심볼로 전환해도 기본적인 표시는 동작한다. 그러나 다음 UI 변경이 필요:

1. **StrategyCard**: 현재 심볼 표시 없음 -> 멀티심볼이면 "BTC/USDT +2" 같은 카운트 배지 추가 필요
2. **StrategyDetail**: 심볼별 포지션/시그널 필터링 UI 필요
3. **SignalFeed**: 이미 `signal.symbol`을 표시하므로 변경 불필요
4. **PositionsTable**: 이미 심볼별 표시이므로 변경 불필요

**요청**: BE 구현 완료 시 FE 심볼 표시 항목에 대한 별도 FE 티켓 추가 필요 (예상 2h).

### R8-T2-2: 전략 warm-up 기간 [2h]

**FE 영향도: LOW**

전략이 warm-up 중인 상태를 UI에 표시하면 좋다. StrategyCard에서 `graceState`와 유사하게 `warmupState: 'warming_up' | 'ready'` 필드를 받아 배지로 표시 가능.

```
[워밍업 중 ●] — amber 배지, text-[10px], "데이터 수집 중..."
```

BE에서 warm-up 상태를 `GET /api/bot/strategies` 응답에 포함시켜 주면, FE에서 15분 이내 구현 가능.

### R8-T2-3: 펀딩비 PnL 반영 [4.5h]

**FE 영향도: MEDIUM**

현재 PositionsTable의 `unrealizedPnl`에 펀딩비가 포함되지 않을 수 있다. BE에서 펀딩비를 PnL에 포함시키면 기존 UI는 자동으로 반영된다. 다만 펀딩비 내역을 별도로 보여주면 트레이더 의사결정에 도움:

- PositionsTable에 `fundingFee` 컬럼 추가 (선택적 표시)
- StrategyDetail의 성과 탭에 "누적 펀딩비" 표시

BE에서 API 응답에 `fundingFee` 필드를 추가하면 FE 반영 30분.

### R8-T2-4: 코인 재선정 주기 [3.5h]

**FE 영향도: LOW**

CoinScoreboard (MarketIntelligence 내부)에서 이미 코인 스코어를 표시하므로, 재선정 주기가 변경되어도 UI 수정 불필요. 다만 "다음 재선정까지 N분" 표시를 CoinScoreboard 헤더에 추가하면 트레이더가 언제 코인이 바뀔지 예측 가능.

BE에서 `nextReselectAt` 또는 `reselectIntervalMs` 필드를 API 응답에 포함시키면, FE에서 카운트다운 표시 가능 (useCountdown 훅 재활용).

### R8-T2-5: Paper 모드 전환 경고 강화 [30m]

**FE 영향도: DIRECT — TradingModeToggle과의 통합**

현재 TradingModeToggle.tsx (줄 101~120)에서 모드 전환 시 ConfirmDialog를 이미 사용한다:
- Paper -> Live: "실제 자금으로 거래가 실행됩니다" (줄 104)
- Live -> Paper: "가상 자금으로 전환됩니다" (줄 115)

**BE의 경고 강화 내용이 FE에 미치는 영향:**

만약 BE가 모드 전환 시 추가 경고 조건(열린 포지션, 미체결 주문 등)을 반환한다면, ConfirmDialog의 `message`를 동적으로 구성해야 한다:

```tsx
// 현재 (정적 메시지)
message="실제 자금으로 거래가 실행됩니다. 계속하시겠습니까?"

// 개선안 (BE 경고 포함)
message={`실제 자금으로 거래가 실행됩니다.\n${warnings.length > 0 ? `\n경고:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}\n\n계속하시겠습니까?`}
```

**제안**: BE가 `POST /api/bot/trading-mode`에서 `{ warnings: string[] }` 형태의 사전 검증 응답을 제공하면, FE에서 모드 전환 전에 경고를 먼저 fetch하여 ConfirmDialog에 포함 가능. 또는 별도 `GET /api/bot/mode-switch-check?targetMode=live` API 추가.

### R8-T2-6: StateRecovery 활성화 [45m]

**FE 영향도: NONE~LOW**

StateRecovery는 서버 재시작 시 이전 상태를 복원하는 BE 내부 로직. FE에서는 봇 상태가 복원되면 기존 폴링/소켓으로 자동 감지하므로 별도 UI 변경 불필요.

단, 복원 과정에서 잠시 "recovering" 상태가 표시될 수 있으므로, `BotState` 타입에 `'recovering'`을 추가하고 `translateBotState()`에 "복구 중" 매핑을 추가하면 좋다.

---

## Deferred 항목 코멘트

### R8-T0-5: PositionManager 전략 메타데이터 주입 [3.5h]

**FE 관점: 재활성화 권장 (MEDIUM)**

현재 PositionsTable에서 `pos.strategy`가 문자열 또는 null로만 표시된다 (types/index.ts 줄 101). 전략 메타데이터(riskLevel, targetRegimes 등)가 포지션에 주입되면:

1. PositionsTable에서 전략별 색상 코딩 가능
2. "이 포지션은 어떤 전략의 것인가"를 한눈에 파악
3. 포지션별 리스크 레벨 표시 가능

BE에서 먼저 구현해야 FE에서 활용 가능. **FE 추가 작업: 약 30분** (PositionsTable에 전략 배지 + 색상 추가).

**재활성화 추천 여부**: R8-T2-1(멀티심볼)과 의존성이 높다. 멀티심볼 도입 시 전략-포지션 매핑이 더 중요해지므로, T2-1 완료 후 또는 동시에 진행 권장.

### R8-T1-1: InstrumentCache 심볼별 lot step [2h]

**FE 관점: 재활성화 중립**

lot step은 주문 수량 해상도 문제이며, FE에서는 직접적 영향이 없다. 다만 BacktestForm에서 수량 입력 시 lot step에 맞는 입력 검증(step attribute)을 제공할 수 있다:

```tsx
<input type="number" step={lotStep} min={minQty} />
```

이는 BE에서 심볼별 lot step을 API로 제공할 때 가능. 현재로서는 FE 개선 포인트가 적으므로, BE 우선순위에 따라 결정하는 것이 적절.

**재활성화 추천 여부**: BE 판단에 위임. FE 추가 작업은 미미 (~10분).

---

## 의존성 및 구현 순서 제안

### 의존성 맵

```
R8-T2-8 (StrategyCard 접근성) → 없음 (독립)
R8-T2-9 (MarketRegimeIndicator 삭제) → 없음 (독립)
R8-T2-10 (헤더 반응형) → 없음 (독립)
R8-T2-11 (AccountOverview 모바일) → 없음 (독립)
R8-T2-12 (RegimeFlowMap 모바일) → 없음 (독립)
```

5건 모두 독립적이므로 병렬 수행 가능. 다만, 아래 순서로 구현하면 테스트가 자연스럽다:

### 제안 구현 순서

**Phase 1: 접근성 + 데드코드 (45분)**
1. **R8-T2-8**: StrategyCard toggle 접근성 수정 — HTML 규격 위반 해소가 최우선
2. **R8-T2-9**: MarketRegimeIndicator 삭제 — 가장 빠르고 위험 낮음

**Phase 2: 모바일 반응형 (1h 35분)**
3. **R8-T2-11**: AccountOverview 모바일 — 가장 간단한 반응형 수정
4. **R8-T2-10**: 대시보드 헤더 모바일 — 가장 임팩트가 큰 반응형 수정
5. **R8-T2-12**: RegimeFlowMap 모바일 — MarketIntelligence 내부이므로 마지막

**총 예상 시간: 2시간 20분**

---

## 다른 에이전트에게 요청 사항

### Engineer (Backend) Agent에게

1. **R8-T2-1 (멀티심볼)**: 구현 완료 시 FE 심볼 표시 영향 범위를 정리해 전달 요청. 특히 `GET /api/bot/strategies` 응답의 `symbol` 필드가 배열로 변경되는지, 아니면 기존 `symbols` 배열만 확장되는지 API 계약 확인 필요.

2. **R8-T2-2 (warm-up)**: `GET /api/bot/strategies` 응답에 `warmupState` 또는 `warmingUp: boolean` 필드 추가 가능 여부 확인. FE에서 StrategyCard 배지로 표시할 예정.

3. **R8-T2-5 (Paper 모드 경고)**: 모드 전환 전 경고 조건을 사전에 확인할 수 있는 API가 필요한지, 아니면 전환 API 자체에서 `{ warnings: [] }` 응답을 반환할지 설계 방향 확인.

4. **R8-T2-9 (MarketRegimeIndicator 삭제)**: 삭제 전 다른 에이전트가 이 컴포넌트를 참조하는 코드를 작성했는지 확인. `grep -r "MarketRegimeIndicator" .` 결과를 공유해 주시면 안전하게 삭제 가능.

### Trader Agent에게

1. **R8-T2-11 (AccountOverview)**: 총 자산을 별도 행으로 분리하는 것이 트레이더 관점에서 적절한지 확인. 일부 트레이더는 4개 지표를 한 줄에서 비교하는 것을 선호할 수 있음.

2. **R8-T0-5 (PositionManager 전략 매핑) 재활성화**: 포지션에 전략 메타데이터가 주입되면, PositionsTable에서 어떤 정보가 가장 유용한지 (전략명, 리스크 레벨, 진입 근거 등) 트레이더 관점 의견 요청.
