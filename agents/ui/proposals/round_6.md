# Round 6 Proposal -- "실거래 준비도 강화 -- 새 개선과제 발굴"

**Author**: UI/UX Engineer (Senior)
**Date**: 2026-02-16
**Scope**: Trader S1 요청 3건 구현 방안 + 신규 UX 개선과제 발굴 + 기술 부채 분석

---

## 분석 요약

Round 1-5를 거쳐 대시보드, 백테스트, 토너먼트 3개 페이지의 핵심 기능이 모두 완성되었다. 6446fa3 (토너먼트 Minimal Refined 리팩토링), 27d6b77 (색상 통일), 279714c (UI 리뉴얼 + Market Intelligence + TrendlineBreakout + StrategySymbolMap) 등 최근 커밋으로 디자인 시스템 일관성이 크게 향상되었다.

현재 대시보드 레이아웃:

```
Row 0:  TradingModeBanner + RiskAlertBanner
Row 1:  Header (BotControlPanel + SystemHealth + 모드 토글)
Hero:   AccountOverview (4-column stat grid)
Row 2:  PerformanceTabs (7/12) + RiskStatusPanel (5/12)
Row 3:  MarketIntelligence (collapsible, 4-tab)
Row 4:  PositionsTable (full width)
Row 5:  SignalFeed (5/12) + TradesTable (7/12)
Row 6:  StrategyHub (collapsible)
Row 7:  StrategySymbolMap
Row 8:  SymbolRegimeTable (collapsible)
```

**전체 코드 규모**: 42개 TSX/TS 파일 (컴포넌트 30+, 훅 13, 라이브러리 5, 타입 2)

**품질 평가**:
- 디자인 시스템: CSS 변수 기반 색상 토큰 11개 + Tailwind 4 통합. `globals.css`에 테이블/애니메이션 글로벌 스타일 정리됨
- 정보 계층: Hero stat -> Performance -> Risk -> Market -> Positions -> Signals -> Strategy 순으로 합리적 배치
- 실시간성: Socket.io + Adaptive Polling 하이브리드. ticker는 ref 분리로 리렌더 최적화
- 접근성: `role="status"`, `aria-label`, `role="meter"` 등 부분적으로 적용됨
- 반응형: `grid-cols-1 lg:grid-cols-12` 패턴 사용. 모바일 breakpoint는 부분적

---

## 발견 사항 (코드 레벨 근거)

### F-1. StrategyDetail 컴포넌트의 하드코딩 색상 (디자인 시스템 불일치)

**파일**: `frontend/src/components/strategy/StrategyDetail.tsx`

StrategyDetail 내부에서 CSS 변수(`var(--text-muted)` 등) 대신 직접 Tailwind 색상 클래스를 사용하고 있다:

```tsx
// L47-48 (StrategyDetail.tsx)
<span className="ml-2 text-xs text-zinc-500">로딩 중...</span>

// L54
<p className="text-xs text-red-400 py-3 text-center">{error}</p>

// L59
<div className="mt-2 border-t border-zinc-800 pt-2">

// L63
<span className="text-zinc-400">거래 <span className="text-zinc-200 font-medium">{stats.totalTrades}</span></span>

// L88 (positions table header)
<tr className="text-zinc-500 border-b border-zinc-800/50">

// L100
<td className="py-1.5 pr-2 text-zinc-300 font-medium">

// L210 (signals tab)
<div className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/40 text-xs">
```

이 컴포넌트는 최초 Round 1-2에서 구현된 후 디자인 리뉴얼(279714c) 시 migration이 누락된 것으로 보인다. `zinc-*` 직접 참조가 30곳 이상 존재하며, 다른 컴포넌트들은 모두 `var(--text-*)`, `var(--bg-*)`, `var(--border-*)` 토큰을 사용하고 있어 불일치가 명확하다.

**영향**: 사용자가 StrategyCard를 확장하면 내부 디테일 영역의 색상 톤이 미세하게 달라져 시각적 이질감 발생. 특히 `text-zinc-500`과 `var(--text-muted)` (#44444C)는 밝기가 다르다.

---

### F-2. error.tsx의 하드코딩 색상 (디자인 시스템 불일치)

**파일**: `frontend/src/app/error.tsx`

에러 바운더리 페이지가 CSS 변수 대신 직접 Tailwind 색상을 사용:

```tsx
// L27
<div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">

// L28
<div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6">

// L45
<h2 className="text-xl font-bold text-zinc-100">오류가 발생했습니다</h2>

// L53
<div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
```

이 파일 전체가 디자인 토큰 미적용 상태이다.

---

### F-3. PositionsTable에 레버리지 값 이미 표시됨 -- Trader S1 요청 (2) 확인

**파일**: `frontend/src/components/PositionsTable.tsx` L99

```tsx
<td className="font-mono text-[var(--text-muted)]">{pos.leverage}x</td>
```

**타입**: `frontend/src/types/index.ts` L93

```typescript
export interface Position {
  // ...
  leverage: string;
  // ...
}
```

Trader S1의 "레버리지 값 표시" 요청은 **이미 구현 완료** 상태이다. PositionsTable에 "레버리지" 컬럼이 있으며, `{pos.leverage}x` 형식으로 표시된다.

그러나 다음 위치에서는 레버리지가 **미표시**:
- `StrategyDetail.tsx` 포지션 탭 (L82-136): leverage 컬럼 없음
- `TournamentPage.tsx` StrategyDetailPanel 포지션 테이블 (L386-424): leverage 컬럼 없음
- `AccountOverview.tsx`: 현재 사용 중인 전체 레버리지 요약 없음

---

### F-4. 백테스트 결과에 disclaimer 부재 -- Trader S1 요청 (3)

**파일**: `frontend/src/components/backtest/BacktestStatsPanel.tsx`

백테스트 결과 표시 시 "레버리지 미반영, 펀딩비 미반영" 등의 면책 조항(disclaimer)이 없다. 백엔드 확인 결과:

```bash
# backend/src/backtest/ 에서 leverage, fundingFee 검색 -> 결과 없음
```

백엔드 backtestEngine에서 레버리지와 펀딩비를 반영하지 않으므로, 프론트엔드에서 사용자에게 이를 명확히 고지해야 한다. 현재 BacktestStatsPanel, BacktestEquityCurve, BacktestForm 어디에도 해당 고지가 없다.

---

### F-5. 전략별 레짐 호환성 매트릭스 -- Trader S1 요청 (1)

**파일**: `frontend/src/components/market-intel/RegimeFlowMap.tsx` L98-123

RegimeFlowMap의 하단에 "Regime breakdown matrix"가 이미 구현되어 있다:

```tsx
// L98-123 (RegimeFlowMap.tsx)
<div className="grid grid-cols-5 gap-2 pt-3 border-t border-[var(--border-subtle)]">
  {ALL_REGIMES.map((regime) => {
    const bd = regimeBreakdown?.[regime.toUpperCase()] ??
               regimeBreakdown?.[regime] ??
               { active: [], inactive: [] };
    const count = bd.active.length;
    // ...
    <div className="text-lg font-semibold">{count}</div>
    <div className="text-[9px]">전략</div>
```

이는 각 레짐별 활성 전략 **수**만 표시한다. Trader S1이 요청한 것은 "전략별 레짐 호환성 매트릭스"로, **어떤 전략이 어떤 레짐에서 작동하는지** 한눈에 볼 수 있는 교차 테이블(cross-tab)이다.

또한 `StrategySymbolMap.tsx`의 "대상 레짐" 컬럼(L138-152)에서 아이콘으로 표시하고 있지만, 이는 목록 형태이지 매트릭스가 아니다.

**백엔드 데이터 확인**: 19개 전략의 `targetRegimes` 데이터가 이미 존재하며, `GET /api/regime/strategy-routing` API가 `regimeBreakdown`을 반환한다.

---

### F-6. 백테스트 삭제 시 확인 다이얼로그 부재

**파일**: `frontend/src/components/backtest/BacktestListPanel.tsx` L122-136

```tsx
<span
  role="button"
  tabIndex={0}
  onClick={(e) => {
    e.stopPropagation();
    onDelete(bt.id);  // 즉시 삭제, 확인 없음
  }}
  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--loss)]"
>
  삭제
</span>
```

백테스트 기록 삭제 시 ConfirmDialog를 사용하지 않고 즉시 삭제가 실행된다. 토너먼트 페이지의 초기화는 ConfirmDialog를 사용하고 있어(L250-258) 일관성이 없다.

---

### F-7. AccountOverview 반응형 미지원

**파일**: `frontend/src/components/AccountOverview.tsx` L15

```tsx
<div className="grid grid-cols-4 gap-8 py-2">
```

고정 4열 그리드로, 모바일에서 컬럼이 좁아져 금액이 줄바꿈되거나 잘릴 수 있다. 다른 컴포넌트들은 `grid-cols-2 md:grid-cols-4`를 사용하고 있다(예: TournamentPage L175).

---

### F-8. 대시보드 네비게이션의 접근성/UX 이슈

**파일**: `frontend/src/app/page.tsx` L161-192

실거래 모드에서 백테스트/토너먼트 링크가 비활성화되는데, `<span>`에 `cursor-not-allowed`만 적용되어 있다:

```tsx
<span
  className="text-[11px] text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-md px-3 py-1.5 cursor-not-allowed select-none"
  title="가상거래 모드에서만 사용 가능"
>
  백테스트
</span>
```

- `aria-disabled="true"` 미적용
- `title` 속성은 터치 디바이스에서 접근 불가
- 접근성: 스크린 리더가 이 요소를 비활성 네비게이션으로 인식하지 못함

---

### F-9. BotControlPanel의 Live 모드 확인 다이얼로그 -- CSS 변수 불일치

**파일**: `frontend/src/components/BotControlPanel.tsx` L134-161

Live 모드 시작 확인 다이얼로그가 인라인 JSX로 구현되어 있으며, 기존 `ConfirmDialog` 컴포넌트를 재사용하지 않는다:

```tsx
{showLiveConfirm && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md" ...>
    <div className="bg-[var(--bg-elevated)] border border-[var(--loss)]/30 rounded-lg p-8 ...">
```

EmergencyStopDialog는 별도 컴포넌트인데, Live 시작 확인은 인라인이다. ConfirmDialog 컴포넌트(`ui/ConfirmDialog.tsx`)가 이미 있으므로 이를 재사용해야 한다.

---

### F-10. BacktestTradeList의 테이블 마진 불일치

**파일**: `frontend/src/components/backtest/BacktestTradeList.tsx` L82

```tsx
<div className="overflow-x-auto -mx-4 -mb-4">
```

다른 모든 Card 내 테이블은 `-mx-6 -mb-6`을 사용한다:
- PositionsTable L50: `-mx-6 -mb-6`
- TradesTable L36: `-mx-6 -mb-6`
- BacktestListPanel: Card 내부이므로 별도 마진 없음
- CoinScoreboard L125: `-mx-6 -mb-2`

BacktestTradeList만 `-mx-4`를 사용하여 좌우 여백이 다르다. Card의 padding이 `p-6` (24px)이므로 `-mx-6`이 정확한 값이다.

---

### F-11. 백테스트 폼에서 심볼 입력이 자유 텍스트

**파일**: `frontend/src/components/backtest/BacktestForm.tsx` L116-123

```tsx
<input
  id="bt-symbol"
  type="text"
  value={symbol}
  onChange={(e) => setSymbol(e.target.value)}
  placeholder="BTCUSDT"
  className={inputClass}
/>
```

심볼 입력이 자유 텍스트 필드이다. 사용자가 잘못된 심볼(예: "BTC", "btcusd")을 입력하면 백엔드에서 데이터를 찾지 못해 에러가 발생한다. 드롭다운이나 자동완성으로 유효한 심볼만 선택할 수 있게 해야 한다.

---

### F-12. 대시보드 페이지의 alert() 사용

**파일**: `frontend/src/app/page.tsx` L105, L121

```tsx
// L105
alert(err instanceof Error ? err.message : '포지션 청산에 실패했습니다.');

// L121
alert(err instanceof Error ? err.message : '드로다운 리셋에 실패했습니다.');
```

`alert()`는 브라우저 네이티브 다이얼로그로, 다크 테마와 어울리지 않고 UX가 불일치한다. 토스트(Toast) 또는 인라인 에러 메시지로 교체해야 한다.

---

### F-13. SignalFeed의 최대 높이 하드코딩

**파일**: `frontend/src/components/SignalFeed.tsx` L21

```tsx
<Card title="실시간 시그널" className="max-h-[400px] overflow-y-auto">
```

SignalFeed가 `max-h-[400px]`로 고정되어 있어, TradesTable(7/12)과 같은 Row에 배치될 때 높이가 맞지 않을 수 있다. TradesTable은 높이 제한이 없어서 데이터가 많으면 SignalFeed보다 훨씬 길어진다.

---

### F-14. StrategySymbolMap 테이블의 스타일 미적용

**파일**: `frontend/src/components/StrategySymbolMap.tsx` L112-157

StrategySymbolMap의 `<table>` 태그에 globals.css의 글로벌 테이블 스타일이 적용되지만, `<th>`에 별도 class가 없어 정렬 방향(`text-left` vs `text-right`)이 지정되지 않았다. 다른 테이블 컴포넌트들은 `th`에 명시적 class를 추가한다.

---

### F-15. 차트 컴포넌트 Tooltip 스타일 중복

`BacktestEquityCurve.tsx`, `BacktestPriceChart.tsx`, `EquityCurveChart.tsx`, `DrawdownChart.tsx`에서 Tooltip `contentStyle`이 반복적으로 정의됨:

```tsx
// DrawdownChart.tsx L15-20
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '6px',
  fontSize: '11px',
  padding: '8px 12px',
};

// EquityCurveChart.tsx L9-15 (동일)
const TOOLTIP_STYLE = { ... };

// BacktestEquityCurve.tsx L59-65 (인라인, 약간 다른 borderRadius: '8px')
contentStyle={{
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '8px',
  fontSize: '12px',
}}
```

`borderRadius`가 `6px` vs `8px`, `fontSize`가 `11px` vs `12px`로 미세 불일치. 공유 상수로 통합해야 한다.

---

## Trader S1 요청 3건 구체적 구현 방안

### S1-1. 전략별 레짐 호환성 매트릭스 표시

**현재 상태**: RegimeFlowMap에 레짐별 전략 수만 표시. StrategySymbolMap에 아이콘으로 개별 표시.

**구현 방안**: 새 컴포넌트 `StrategyRegimeMatrix.tsx`를 MarketIntelligence의 "전략 라우팅" 탭 내에 추가하거나, 독립 카드로 StrategyHub 하단에 배치.

**설계**:
```
              상승추세  하락추세  횡보   고변동  저변동
터틀 돌파        *        *       -      *       -
캔들 패턴        *        *       *      *       -
RSI Pivot       *        *       *      *       -
슈퍼트렌드       *        *       -      *       -
그리드 매매      -        -       *      -       -
볼린저 회귀      -        -       *      *       -
...             ...      ...     ...    ...     ...
```

- 행: 19개 전략 (translateStrategyName으로 한글 표시)
- 열: 5개 레짐
- 셀: 호환(accent 색 dot) / 비호환(빈칸 또는 dash)
- 현재 레짐 열 강조 (bg-[var(--accent)]/5 + 상단 화살표)
- 현재 활성 전략 행 강조 (좌측 녹색 바)
- 카테고리별 그룹핑 (Price-Action / Indicator-Light / Indicator-Heavy 구분선)

**데이터 소스**: `GET /api/regime/strategy-routing`의 `strategies[].targetRegimes` + `currentRegime`

**구현 난이도**: 낮 (1-1.5시간)
**예상 영향**: 중간 -- 트레이더가 현재 시장 상태에서 어떤 전략이 활성화되는지 한눈에 파악

---

### S1-2. 레버리지 값 표시 강화

**현재 상태**: PositionsTable에 이미 표시됨. 그러나 다른 위치에서 누락.

**구현 방안**:

1. **StrategyDetail.tsx 포지션 탭** (L82-136): `leverage` 컬럼 추가

```tsx
// 현재 헤더: ['심볼', '방향', '수량', '진입가', '현재가', '미실현 PnL']
// 변경 후:  ['심볼', '방향', '수량', '레버리지', '진입가', '현재가', '미실현 PnL']
```

2. **TournamentPage StrategyDetailPanel** (L386-424): `leverage` 컬럼 추가

3. **AccountOverview 강화** (선택적): 현재 4-column (총 자산, 가용 잔고, 미실현 PnL, 활성 포지션) 중 "활성 포지션" 영역에 평균/최대 레버리지 표시 추가

**구현 난이도**: 매우 낮 (30분)
**예상 영향**: 낮 -- 이미 주요 위치에 표시됨

---

### S1-3. 백테스트 결과에 disclaimer 추가

**현재 상태**: 백테스트 엔진이 레버리지/펀딩비를 반영하지 않음. 프론트엔드에 고지 없음.

**구현 방안**: BacktestStatsPanel 상단 또는 하단에 고정 disclaimer 배너 추가.

**위치 1**: `BacktestStatsPanel.tsx` 하단 (통계 아래)

```tsx
{/* Disclaimer */}
<div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
  <div className="flex items-start gap-2">
    <svg className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" ...>
      {/* info icon */}
    </svg>
    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
      본 백테스트 결과는 과거 데이터 기반 시뮬레이션이며, 실제 수익을 보장하지 않습니다.
      <strong className="text-[var(--text-secondary)]"> 레버리지 미반영</strong>,
      <strong className="text-[var(--text-secondary)]"> 펀딩비 미반영</strong>,
      슬리피지/수수료는 설정값 기준 근사치입니다.
      실거래 시 시장 유동성, 체결 속도, 펀딩비 등으로 결과가 달라질 수 있습니다.
    </p>
  </div>
</div>
```

**위치 2**: `BacktestForm.tsx` 실행 버튼 위 (선택적, 사전 고지)

**위치 3**: `BacktestEquityCurve.tsx` 차트 우상단 워터마크 (선택적)

**구현 난이도**: 매우 낮 (20분)
**예상 영향**: 높음 -- 실거래 전환 시 과대 기대 방지, 법적 보호

---

## 신규 UX 개선과제 및 기술 부채

### 제안 사항 총괄표

| 순위 | ID | 항목 | 난이도 | 시간 | 영향 |
|------|-----|------|--------|------|------|
| 1 | **S1-3** | 백테스트 disclaimer 추가 | 매우 낮 | 20분 | 높음 |
| 2 | **R6-1** | StrategyDetail 디자인 토큰 마이그레이션 (F-1) | 낮 | 40분 | 중간 |
| 3 | **S1-1** | 전략-레짐 호환성 매트릭스 | 낮 | 1.5시간 | 중간 |
| 4 | **R6-2** | Toast 알림 시스템 (F-12 해결) | 중 | 2시간 | 중간 |
| 5 | **R6-3** | error.tsx 디자인 토큰 마이그레이션 (F-2) | 매우 낮 | 15분 | 낮 |
| 6 | **R6-4** | 백테스트 삭제 ConfirmDialog 추가 (F-6) | 매우 낮 | 15분 | 낮 |
| 7 | **R6-5** | AccountOverview 반응형 개선 (F-7) | 매우 낮 | 10분 | 낮 |
| 8 | **R6-6** | BacktestTradeList 마진 수정 (F-10) | 매우 낮 | 5분 | 매우 낮 |
| 9 | **S1-2** | 레버리지 표시 보완 (StrategyDetail, Tournament) | 매우 낮 | 30분 | 낮 |
| 10 | **R6-7** | Chart Tooltip 스타일 상수 통합 (F-15) | 낮 | 30분 | 매우 낮 |
| 11 | **R6-8** | 네비게이션 접근성 강화 (F-8) | 매우 낮 | 15분 | 낮 |
| 12 | **R6-9** | BotControlPanel Live 확인 ConfirmDialog 전환 (F-9) | 낮 | 20분 | 낮 |
| 13 | **R6-10** | 백테스트 심볼 입력 개선 (F-11) | 중 | 1.5시간 | 중간 |
| 14 | **R6-11** | SignalFeed/TradesTable 높이 동기화 (F-13) | 낮 | 20분 | 낮 |
| 15 | **R6-12** | StrategySymbolMap 테이블 스타일 정규화 (F-14) | 매우 낮 | 10분 | 매우 낮 |

---

### R6-1. StrategyDetail 디자인 토큰 마이그레이션

**파일**: `frontend/src/components/strategy/StrategyDetail.tsx`

**변경 범위**: `zinc-*` 직접 참조를 CSS 변수로 전면 교체.

| 현재 | 변경 |
|------|------|
| `text-zinc-500` | `text-[var(--text-muted)]` |
| `text-zinc-400` | `text-[var(--text-secondary)]` (또는 muted) |
| `text-zinc-300` | `text-[var(--text-primary)]` |
| `text-zinc-200` | `text-[var(--text-primary)]` |
| `text-zinc-600` | `text-[var(--text-muted)]` |
| `border-zinc-800` | `border-[var(--border-subtle)]` |
| `border-zinc-800/50` | `border-[var(--border-subtle)]/50` |
| `border-zinc-800/30` | `border-[var(--border-subtle)]/30` |
| `bg-zinc-800/40` | `bg-[var(--bg-surface)]` |
| `bg-emerald-500/20 text-emerald-400` | 유지 (이것은 status color로 적절) |
| `bg-red-500/20 text-red-400` | 유지 (status color) |
| `text-red-400` (L54 에러 텍스트) | `text-[var(--loss)]` |

**주의**: TradeStatusBadge (L257-273)의 status 색상은 의도적으로 직접 색상을 사용한 것이므로 유지. 배경(`bg-emerald-500/20` 등)은 시맨틱 색상이므로 그대로 둔다.

---

### R6-2. Toast 알림 시스템

**현재 문제**: `alert()` 사용 (page.tsx L105, L121), 에러 상태가 인라인 text로만 표시.

**설계**:

1. `components/ui/Toast.tsx`: 최소한의 toast 컴포넌트
   - variant: `success` | `error` | `warning` | `info`
   - auto-dismiss (3-5초)
   - position: 우하단 (`fixed bottom-4 right-4`)
   - 애니메이션: slide-in + fade-out

2. `hooks/useToast.ts`: toast 상태 관리 (Context 없이 간단한 구현)
   ```typescript
   const { toast, toasts, dismiss } = useToast();
   toast({ message: '포지션 청산 성공', variant: 'success' });
   ```

3. `page.tsx`에서 `alert()` 호출을 `toast()` 호출로 교체

**대안**: 외부 라이브러리(sonner, react-hot-toast) 도입 검토. 현 프로젝트가 외부 의존성을 최소화하는 경향이므로 자체 구현을 우선 권장하되, 기능이 확장되면 sonner 도입을 검토한다.

---

### R6-3. error.tsx 디자인 토큰 마이그레이션

`error.tsx` 전체를 CSS 변수로 교체:

```tsx
// 변경 전
<div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
  <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-6">

// 변경 후
<div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
  <div className="max-w-lg w-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-8 space-y-6">
```

---

### R6-10. 백테스트 심볼 입력 개선

**옵션 A**: 인기 심볼 프리셋 + 자유 입력 허용

```tsx
const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT'];

<div className="flex gap-1.5 mb-1">
  {POPULAR_SYMBOLS.map(s => (
    <button
      key={s}
      type="button"
      onClick={() => setSymbol(s)}
      className={cn(
        'px-2 py-0.5 text-[10px] rounded-md transition-colors',
        symbol === s
          ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]/20'
          : 'text-[var(--text-muted)] border border-[var(--border-subtle)]',
      )}
    >
      {s.replace('USDT', '')}
    </button>
  ))}
</div>
<input type="text" value={symbol} ... /> {/* 자유 입력도 유지 */}
```

**옵션 B**: 백엔드 API에서 거래 가능 심볼 목록 가져와 `<select>` 또는 combobox로 표시. 이를 위해 새 API가 필요할 수 있음 (`GET /api/backtest/symbols`).

**권장**: 옵션 A를 먼저 구현 (백엔드 변경 불필요), 필요 시 옵션 B로 발전.

---

## 구현 우선순위 및 스프린트 계획

### Tier A: 즉시 구현 (총 ~2시간, 독립적 작업 가능)

| ID | 항목 | 시간 |
|----|------|------|
| S1-3 | 백테스트 disclaimer | 20분 |
| R6-1 | StrategyDetail 디자인 토큰 | 40분 |
| R6-3 | error.tsx 디자인 토큰 | 15분 |
| R6-4 | 백테스트 삭제 ConfirmDialog | 15분 |
| R6-5 | AccountOverview 반응형 | 10분 |
| R6-6 | BacktestTradeList 마진 수정 | 5분 |
| S1-2 | 레버리지 표시 보완 | 30분 |

**합계: ~2시간 15분**

### Tier B: 주요 기능 추가 (총 ~4시간)

| ID | 항목 | 시간 |
|----|------|------|
| S1-1 | 전략-레짐 호환성 매트릭스 | 1.5시간 |
| R6-2 | Toast 알림 시스템 | 2시간 |
| R6-8 | 네비게이션 접근성 | 15분 |

### Tier C: 개선 사항 (시간 여유 시)

| ID | 항목 | 시간 |
|----|------|------|
| R6-7 | Chart Tooltip 통합 | 30분 |
| R6-9 | Live 확인 ConfirmDialog | 20분 |
| R6-10 | 백테스트 심볼 프리셋 | 1.5시간 |
| R6-11 | SignalFeed 높이 동기화 | 20분 |
| R6-12 | StrategySymbolMap 테이블 | 10분 |

---

## 다른 에이전트에게 요청 사항

### Trader에게

1. **S1-1 전략-레짐 매트릭스**: `GET /api/regime/strategy-routing`의 `regimeBreakdown` 응답에서 `active`/`inactive` 배열에 전략명이 포함되는지 확인. 현재 코드상 `regimeBreakdown[regime].active: string[]`로 되어 있는데, 실제 JSON 응답에서 regime key가 대문자(`TRENDING_UP`)인지 소문자(`trending_up`)인지 확인 필요 (RegimeFlowMap L100에서 양쪽 모두 시도하고 있음).

2. **S1-3 백테스트 disclaimer**: 백엔드 backtestEngine이 향후 레버리지/펀딩비를 반영할 계획이 있는지. 있다면 disclaimer 문구를 "현재 버전에서는 미반영"으로 조정.

3. **R6-10 심볼 목록**: `GET /api/backtest/symbols` 또는 유사 API로 Bitget에서 거래 가능한 USDT-futures 심볼 목록을 반환하는 API가 필요한지 검토. 또는 기존 `coinSelector`의 심볼 목록을 활용할 수 있는지 확인.

4. **전략 메타데이터 확장**: 현재 `StrategyListItem` 타입에 `riskLevel`이 optional이고 일부 전략에서만 제공됨. StrategyCard (L57)에서 `riskLevel || 'medium'`으로 폴백하고 있음. 모든 전략에 `riskLevel`을 명시적으로 설정 가능한지 확인.

### Engineer에게

1. **R6-2 Toast 시스템**: 토스트 구현 시 Portal(`createPortal`)을 사용할지, 단순 `fixed` 포지셔닝을 사용할지 결정. App Router에서 Portal 사용 시 `document.body` 참조 주의사항 확인.

2. **빌드 검증**: 현재 git status에서 backtest 관련 6개 파일이 수정 상태이다. `npm run build` 통과 여부 확인 필요.

3. **F-15 Chart Tooltip 통합**: 공유 상수를 `lib/chart-config.ts`에 정의할지, `globals.css`에 CSS 변수로 할지 결정. Recharts의 `contentStyle`은 인라인 스타일 객체이므로 JS 상수가 적합.

4. **프론트엔드 테스트**: Round 5에서 제안한 Vitest + RTL 셋업이 아직 구현되지 않았다. Tier A 작업 완료 후 테스트 프레임워크 도입을 재검토.

---

## 핵심 결론

Round 6의 최우선 과제는 **Trader S1 요청 3건의 충실한 구현**이다:

1. **S1-3 (disclaimer)**: 가장 간단하면서 가장 중요. 실거래 전환 시 사용자가 백테스트 결과를 과신하는 것을 방지한다. 20분이면 구현 가능.

2. **S1-1 (전략-레짐 매트릭스)**: RegimeFlowMap의 기존 regimeBreakdown 데이터를 활용하여 교차 테이블로 시각화. 전략가가 현재 시장 상태에서 어떤 전략이 작동하는지 즉시 파악 가능.

3. **S1-2 (레버리지 보완)**: 이미 주 테이블에 구현됨. 세부 뷰(StrategyDetail, Tournament)에만 보완.

이와 병행하여, **디자인 시스템 일관성 복원**(R6-1 StrategyDetail, R6-3 error.tsx)과 **UX 안전장치**(R6-4 삭제 확인, R6-2 Toast)를 Tier A/B로 처리한다.

코드베이스 전반의 디자인 토큰 적용률은 약 95%로 높은 편이나, StrategyDetail과 error.tsx가 유일한 미적용 영역이다. 이를 마이그레이션하면 100% 토큰 커버리지를 달성할 수 있다.
