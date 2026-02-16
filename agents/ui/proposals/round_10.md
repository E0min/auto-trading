# Round 10 Proposal — Tier 3 Enhancement (8건)

**Agent**: UI/UX Engineer
**Date**: 2026-02-17
**Topic**: R8 미구현 agreed 항목 8건 마무리

---

## 분석 요약

Tier 3 잔여 항목 8건을 코드 레벨에서 분석했다. FE 4건(R8-T3-5~8)은 모두 **코드 품질 및 접근성 개선**으로, 기능적 위험 없이 구현 가능하다. BE/Backtest 4건(R8-T3-1~4)에 대해서도 FE 관점의 영향을 분석했다.

### 전체 우선순위 (FE 관점)

| 순위 | ID | 제목 | 난이도 | 예상 시간 | 근거 |
|------|------|------|--------|-----------|------|
| 1 | R8-T3-8 | TOOLTIP_STYLE 통일 | S | 15분 | 이미 `CHART_TOOLTIP_STYLE`이 `chart-config.ts`에 존재하나, 2개 파일이 로컬 복사본 사용 중 |
| 2 | R8-T3-7 | th scope="col" 일괄 추가 | S | 30분 | 10개 파일, 약 80개 `<th>` 태그에 단순 속성 추가 |
| 3 | R8-T3-5 | 데드 코드 삭제 | S | 10분 | 2파일 삭제 — import 없음 확인 완료 |
| 4 | R8-T3-6 | EquityCurveChart 공통 추출 | M | 45분 | 2개 컴포넌트 통합 → 제네릭 컴포넌트 + 래퍼 |

---

## 발견 사항 (코드 레벨 근거)

### R8-T3-5: 데드 코드 삭제 (StrategyPanel, ClientGate)

**분석 결과: 삭제 안전 — 100% 확인**

1. **`StrategyPanel.tsx`** (`frontend/src/components/StrategyPanel.tsx`, 297줄)
   - Grep 결과: `StrategyPanel`을 import하는 파일 **0건**
   - `page.tsx` (대시보드)는 `StrategyHub`를 사용 중 (line 16: `import StrategyHub from '@/components/strategy/StrategyHub'`)
   - `StrategyHub`가 R6에서 StrategyPanel을 대체한 상위 컴포넌트
   - StrategyPanel 내부의 필터링 UI, 토글 로직은 StrategyHub/StrategyCard에 이미 흡수됨

2. **`ClientGate.tsx`** (`frontend/src/components/ClientGate.tsx`, 22줄)
   - Grep 결과: `ClientGate`를 import하는 파일 **0건**
   - Next.js 15 App Router에서 `'use client'` 디렉티브로 hydration 관리가 되므로 불필요
   - `layout.tsx`에 `suppressHydrationWarning` 이미 적용

**작업**: 두 파일 삭제 (319줄 제거)

---

### R8-T3-6: EquityCurveChart 공통 추출

**분석: 2개 컴포넌트 90% 동일 구조, 공통 추출 가능**

현재 상태:

| 속성 | `EquityCurveChart.tsx` (대시보드) | `BacktestEquityCurve.tsx` (백테스트) |
|------|-----------------------------------|--------------------------------------|
| 위치 | `components/EquityCurveChart.tsx` | `components/backtest/BacktestEquityCurve.tsx` |
| 입력 타입 | `EquityPoint` (timestamp, equity, unrealizedPnl) | `BacktestEquityPoint` (ts, equity, cash) |
| 시간 포맷 | `toLocaleTimeString('ko-KR', {hour, minute})` | `toLocaleString('ko-KR', {month, day, hour, minute})` |
| 1차 라인 | equity (stroke: `var(--accent)`, width 1.5) | equity (stroke: `#4ADE80`, width 2) |
| 2차 라인 | pnl (점선, muted) | cash (점선, muted) |
| 라인 라벨 | '자산' / '미실현 PnL' | '에쿼티' / '현금' |
| XAxis fontSize | 10 | 11 |
| YAxis axisLine | false | stroke var(--border-subtle) |

**차이점 요약**: 시간 필드명, 시간 포맷, 2차 데이터키, 라벨명, 미세한 스타일 차이

**설계안**:

```typescript
// lib/chart-config.ts에 추가
export interface EquityCurveConfig {
  timeField: string;          // 'timestamp' | 'ts'
  timeFormat: Intl.DateTimeFormatOptions;
  primaryKey: string;         // 'equity'
  secondaryKey: string;       // 'pnl' | 'cash'
  primaryLabel: string;       // '자산' | '에쿼티'
  secondaryLabel: string;     // '미실현 PnL' | '현금'
  primaryStroke?: string;     // default 'var(--accent)'
  primaryStrokeWidth?: number; // default 1.5
}

export const DASHBOARD_EQUITY_CONFIG: EquityCurveConfig = {
  timeField: 'timestamp',
  timeFormat: { hour: '2-digit', minute: '2-digit' },
  primaryKey: 'equity',
  secondaryKey: 'pnl',
  primaryLabel: '자산',
  secondaryLabel: '미실현 PnL',
};

export const BACKTEST_EQUITY_CONFIG: EquityCurveConfig = {
  timeField: 'ts',
  timeFormat: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  primaryKey: 'equity',
  secondaryKey: 'cash',
  primaryLabel: '에쿼티',
  secondaryLabel: '현금',
  primaryStroke: '#4ADE80',
  primaryStrokeWidth: 2,
};
```

```typescript
// components/charts/EquityCurveBase.tsx — 공통 컴포넌트
interface EquityCurveBaseProps {
  data: Record<string, unknown>[];
  loading: boolean;
  config: EquityCurveConfig;
  title?: string;
}
```

**기존 컴포넌트 변환**:
- `EquityCurveChart.tsx` → config prop 전달하는 얇은 래퍼로 축소 (하위 호환)
- `BacktestEquityCurve.tsx` → 동일 패턴

**파일 변경**:
- 신규: `frontend/src/components/charts/EquityCurveBase.tsx` (~70줄)
- 수정: `frontend/src/lib/chart-config.ts` (config 추가)
- 수정: `frontend/src/components/EquityCurveChart.tsx` (래퍼로 축소)
- 수정: `frontend/src/components/backtest/BacktestEquityCurve.tsx` (래퍼로 축소)
- 소비자(`PerformanceTabs.tsx`, `backtest/page.tsx`)는 변경 불필요 — API 동일 유지

---

### R8-T3-7: th scope="col" 일괄 추가

**분석: 10개 파일, 80+ `<th>` 태그에 scope 속성 전무**

Grep 결과: `scope=` 매치 0건. 모든 `<th>` 태그에 `scope="col"` 누락.

**영향 파일 및 `<th>` 개수**:

| 파일 | `<th>` 수 | 패턴 |
|------|-----------|------|
| `components/TradesTable.tsx` | 9 | 단순 `<th>` |
| `components/PositionsTable.tsx` | 10 | 조건부 `<th>` 포함 |
| `components/SymbolRegimeTable.tsx` | 4 | 단순 `<th>` |
| `components/StrategySymbolMap.tsx` | 8 (4x2) | 2개 테이블, className 포함 |
| `components/backtest/BacktestTradeList.tsx` | 8 | className + onClick 포함 |
| `components/strategy/StrategyDetail.tsx` | 14 (6+8) | 2개 테이블 |
| `components/analytics/StrategyPerformance.tsx` | 4 | 단순 `<th>` |
| `components/analytics/SymbolPerformance.tsx` | 4 | 단순 `<th>` |
| `components/market-intel/CoinScoreboard.tsx` | 7 | 단순 `<th>` |
| `app/tournament/page.tsx` | 20+ | 3개 테이블, 일부 `.map()` 패턴 |

**총 약 88개 `<th>` 태그**

**작업**: 모든 `<th>`에 `scope="col"` 추가. 단순 기계적 작업이지만 파일이 많으므로 주의 필요.

특수 케이스:
- `PositionsTable.tsx` line 63: `{onClosePosition && <th>작업</th>}` → `{onClosePosition && <th scope="col">작업</th>}`
- `tournament/page.tsx` lines 394, 435: `.map()` 내부 동적 생성 → `<th key={h} scope="col" className={...}>`
- 정렬 가능한 `<th>` (BacktestTradeList): `onClick` 핸들러 유지하면서 scope 추가

**접근성 효과**: 스크린 리더가 각 데이터 셀을 읽을 때 해당 열의 헤더를 자동으로 안내. WCAG 2.1 Level A 충족.

---

### R8-T3-8: TOOLTIP_STYLE 통일

**분석: `CHART_TOOLTIP_STYLE` 상수 이미 존재하나 2개 파일이 사용하지 않음**

현재 상태:

| 파일 | Tooltip Style | 사용 상수 |
|------|--------------|-----------|
| `lib/chart-config.ts` | 공통 정의 | `CHART_TOOLTIP_STYLE` |
| `EquityCurveChart.tsx` | `CHART_TOOLTIP_STYLE` 사용 | O |
| `BacktestEquityCurve.tsx` | `CHART_TOOLTIP_STYLE` 사용 | O |
| `DrawdownChart.tsx` | `CHART_TOOLTIP_STYLE` 사용 | O |
| `BacktestPriceChart.tsx` | `CHART_TOOLTIP_STYLE` 사용 | O |
| **`DailyPerformance.tsx`** | **로컬 `TOOLTIP_STYLE` 정의** (line 19-25) | **X** |
| **`SymbolPerformance.tsx`** | **로컬 `TOOLTIP_STYLE` 정의** (line 18-24) | **X** |
| **`StrategyPerformance.tsx`** | **로컬 `TOOLTIP_STYLE` 정의** (line 18-24) | **X** |
| `CoinScoreboard.tsx` | **인라인 스타일** (line 100-105) | **X** |

**로컬 정의 vs 공통 상수 비교**:

```typescript
// chart-config.ts (공통)
{
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '8px',     // <-- 8px
  fontSize: '12px',        // <-- 12px
  padding: '8px 12px',
}

// DailyPerformance / SymbolPerformance / StrategyPerformance (로컬)
{
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-muted)',
  borderRadius: '6px',     // <-- 6px (차이!)
  fontSize: '11px',        // <-- 11px (차이!)
  padding: '8px 12px',
}

// CoinScoreboard (인라인)
{
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',  // <-- border-subtle (차이!)
  borderRadius: 6,          // <-- number (차이!)
  fontSize: 11,             // <-- number (차이!)
}
```

**차이점**: borderRadius (8px vs 6px), fontSize (12px vs 11px), CoinScoreboard는 border color도 다름

**제안**: 공통 상수를 기준으로 통일. `8px` + `12px`가 전체 디자인 시스템과 더 일관됨 (Card 컴포넌트 border-radius가 8px).

**작업**:
1. `DailyPerformance.tsx`: 로컬 `TOOLTIP_STYLE` 삭제 → `import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config'` + 참조 변경
2. `SymbolPerformance.tsx`: 동일
3. `StrategyPerformance.tsx`: 동일
4. `CoinScoreboard.tsx`: 인라인 스타일 → `CHART_TOOLTIP_STYLE` import + `labelStyle` 별도 처리

---

## BE/Backtest 항목에 대한 UX 관점 의견

### R8-T3-1: 백테스트 멀티포지션 지원

**FE 영향**: 현재 `BacktestTradeList.tsx`와 `BacktestPriceChart.tsx`는 단일 포지션 시나리오에 최적화됨. 멀티포지션 지원 시:
- `BacktestPriceChart.tsx`의 ScatterChart에서 동시 진입/청산 포인트가 겹칠 수 있음 → 마커 크기/투명도 조절 필요
- `BacktestStatsPanel.tsx`에 "최대 동시 포지션 수" 지표 추가 고려
- **FE 변경은 선택적** — 기존 UI가 동작은 하지만 시각적 최적화가 바람직

### R8-T3-2: Trailing Stop 구현

**FE 영향**:
- `PositionsTable.tsx`의 "SL 가격" 컬럼에 Trailing Stop 활성 여부 표시 필요
- 제안: SL 가격 옆에 작은 아이콘 또는 Badge로 "T" 표시 (Trailing 활성 상태)
- `StrategyCard.tsx` 또는 `StrategyDetail.tsx`에서 Trailing Stop 설정 표시 가능성
- **FE 작업은 BE 구현 후 진행 가능** — 현재 라운드에서는 BE 인터페이스 확정만 필요

### R8-T3-3: DrawdownMonitor peakEquity 영속성

**FE 영향**: **없음**. 순수 BE 내부 로직. `DrawdownChart.tsx`나 `RiskStatusPanel.tsx`는 API 응답을 그대로 표시하므로 FE 변경 불필요.

### R8-T3-4: Sortino Ratio 산출

**FE 영향**:
- `BacktestStatsPanel.tsx`에 Sortino Ratio 지표 추가 필요
- 현재 이미 Sharpe Ratio 표시 중이므로 동일 패턴으로 추가 가능 (1줄 정도)
- **FE 작업 trivial** — BE가 `metrics.sortinoRatio` 필드를 반환하면 즉시 반영 가능

---

## 제안 사항 (우선순위, 구현 난이도, 예상 시간)

### Track C (Frontend) 구현 계획

| 순서 | ID | 작업 | 난이도 | 시간 | 비고 |
|------|----|------|--------|------|------|
| 1 | R8-T3-5 | `StrategyPanel.tsx` + `ClientGate.tsx` 삭제 | S | 5분 | 단순 파일 삭제 |
| 2 | R8-T3-8 | 3개 파일 로컬 TOOLTIP_STYLE → CHART_TOOLTIP_STYLE, CoinScoreboard 인라인 → 공통 상수 | S | 15분 | import 교체 + 6줄 삭제 x3 + 인라인 교체 x1 |
| 3 | R8-T3-7 | 10개 파일 ~88개 `<th>` → `<th scope="col">` | S | 30분 | 기계적이나 파일 많음 |
| 4 | R8-T3-6 | EquityCurveBase 공통 추출 | M | 45분 | 신규 파일 1개 + config 추가 + 기존 2파일 래퍼화 |

**총 FE 예상 시간**: ~95분

### 구현 순서 근거

1. **데드 코드 삭제(T3-5)** 먼저 — 코드베이스를 깨끗하게 만든 후 작업
2. **TOOLTIP_STYLE 통일(T3-8)** — chart-config.ts를 먼저 정리해야 T3-6 진행이 깔끔
3. **th scope(T3-7)** — 독립 작업, 순서 유연
4. **EquityCurveChart 공통 추출(T3-6)** — 가장 구조적 변경이므로 마지막

---

## 다른 에이전트에게 요청 사항

### Trader Agent (Backend)에게

1. **R8-T3-2 (Trailing Stop)**: 포지션 API 응답에 `trailingStop` 관련 필드 추가 시 FE에 알려주세요:
   - `trailingActive: boolean` — Trailing Stop 활성 여부
   - `trailingCallbackRate: string` — 콜백 비율 (예: "1.5")
   - `trailingHighPrice: string` — 추적 중인 최고가
   - 이 필드들이 있으면 `PositionsTable.tsx`에서 SL 가격 옆에 Trailing 상태 표시 가능

2. **R8-T3-4 (Sortino Ratio)**: 백테스트 `metrics` 객체에 `sortinoRatio: string` 필드 추가 부탁드립니다. FE에서 `BacktestStatsPanel.tsx`에 Sharpe 옆에 배치하겠습니다.

3. **R8-T3-1 (멀티포지션)**: 백테스트 결과의 `trades` 배열에 겹치는 시간대 거래가 생기면, FE의 `BacktestPriceChart.tsx` ScatterChart에서 마커 겹침 문제가 있을 수 있습니다. 거래에 `positionIndex` 같은 식별자를 추가하면 FE에서 색상/오프셋으로 구분 가능합니다.

### Engineer Agent (Infra/Quality)에게

1. **R8-T3-5** 삭제 후 `npm run build` 확인 필요 — dead code이므로 문제없을 것이나 안전 차원
2. **R8-T3-6** 공통 추출 후 기존 import 경로(`@/components/EquityCurveChart`, `@/components/backtest/BacktestEquityCurve`)가 유지되는지 빌드 검증 필요

---

## 참고: 전체 변경 파일 목록 (FE Track C)

### 삭제 (2파일)
- `frontend/src/components/StrategyPanel.tsx`
- `frontend/src/components/ClientGate.tsx`

### 수정 (14파일)
- `frontend/src/lib/chart-config.ts` — EquityCurveConfig 타입 + 2개 config 상수 추가
- `frontend/src/components/EquityCurveChart.tsx` — 래퍼로 축소
- `frontend/src/components/backtest/BacktestEquityCurve.tsx` — 래퍼로 축소
- `frontend/src/components/analytics/DailyPerformance.tsx` — TOOLTIP_STYLE → CHART_TOOLTIP_STYLE
- `frontend/src/components/analytics/SymbolPerformance.tsx` — TOOLTIP_STYLE → CHART_TOOLTIP_STYLE
- `frontend/src/components/analytics/StrategyPerformance.tsx` — TOOLTIP_STYLE → CHART_TOOLTIP_STYLE
- `frontend/src/components/market-intel/CoinScoreboard.tsx` — 인라인 → CHART_TOOLTIP_STYLE
- `frontend/src/components/TradesTable.tsx` — th scope 추가
- `frontend/src/components/PositionsTable.tsx` — th scope 추가
- `frontend/src/components/SymbolRegimeTable.tsx` — th scope 추가
- `frontend/src/components/StrategySymbolMap.tsx` — th scope 추가
- `frontend/src/components/backtest/BacktestTradeList.tsx` — th scope 추가
- `frontend/src/components/strategy/StrategyDetail.tsx` — th scope 추가
- `frontend/src/app/tournament/page.tsx` — th scope 추가

### 신규 (1파일)
- `frontend/src/components/charts/EquityCurveBase.tsx` — 공통 에쿼티 커브 차트
