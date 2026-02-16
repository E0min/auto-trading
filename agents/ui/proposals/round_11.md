# Round 11 Proposal -- 코드베이스 재분석 및 새 개선과제 발굴

**Agent**: UI/UX Engineer
**Date**: 2026-02-16
**Topic**: 프론트엔드 코드베이스 심층 재분석 -- 아직 발견되지 않은 개선과제 발굴

---

## 분석 요약

R1~R10까지 40+건의 FE 개선을 거친 현재 코드베이스(67개 TS/TSX 파일)를 전수 조사했다. 코드 품질은 전반적으로 높은 수준이나, 아래 8개 카테고리에서 **신규 개선과제 13건**을 발견했다.

### 핵심 발견

| 카테고리 | 건수 | 영향 |
|----------|------|------|
| 데드 코드 잔존 | 1건 | 코드 청결 |
| 타입 안전성 취약 | 3건 | 런타임 안정성 |
| 중복 코드 패턴 | 3건 | 유지보수성 |
| 컴포넌트 구조 개선 | 2건 | 확장성/성능 |
| 백테스트 UX 강화 | 2건 | 사용자 경험 |
| 접근성 미비 | 1건 | WCAG 준수 |
| 성능 최적화 | 1건 | 렌더 효율 |

---

## 발견 사항 (코드 레벨 근거)

### 1. [R11-FE-01] 데드 코드: MarketRegimeIndicator.tsx 삭제

**파일**: `frontend/src/components/MarketRegimeIndicator.tsx` (86줄)

**근거**:
- Grep 결과: `MarketRegimeIndicator`를 import하는 파일 **0건**
- `page.tsx`(대시보드)에서 이 컴포넌트를 사용하지 않음
- 동일한 레짐 표시 기능이 `MarketIntelligence.tsx` 헤더에 이미 통합되어 있음 (line 69~102)
- `MarketIntelligence.tsx`가 pending regime, cooldown, 전환 빈도 뱃지까지 모두 포함
- R9에서 "MarketRegimeIndicator 삭제"가 언급되었으나 파일이 남아 있음

```
// MarketRegimeIndicator.tsx의 기능이 MarketIntelligence.tsx에 이미 흡수됨:
// - 현재 레짐 표시 (line 72-75)
// - 확인 중 pending regime (line 81-86)
// - 쿨다운 뱃지 (line 89-93)
// - 전환 빈도 뱃지 (line 96-102)
```

**난이도**: S (5분)
**위험**: 없음 -- import 없음 확인 완료

---

### 2. [R11-FE-02] 타입 안전성: `risk.ts`의 `any` 타입 제거

**파일**: `frontend/src/lib/risk.ts` (line 8)

**근거**:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeRiskScore(riskStatus: any): RiskScore {
```

- `riskStatus`는 `RiskStatus` 타입 (이미 `types/index.ts`에 정의됨)
- 호출부 (`RiskStatusPanel.tsx` line 22): `computeRiskScore(riskStatus)` -- `riskStatus: RiskStatus`
- 함수 내부에서 접근하는 필드들:
  - `riskStatus.circuitBreaker.tripped` -- `RiskStatus.circuitBreaker` 존재
  - `riskStatus.drawdownMonitor.currentDrawdown` -- `RiskStatus.drawdownMonitor` 존재
  - `riskStatus.exposureGuard.utilizationPercent` -- `RiskStatus.exposureGuard` 존재
- **단, 함수 내부에서 `drawdownMonitor?.params?.maxDrawdownPercent`와 `circuitBreaker?.consecutiveLosses` 등 `RiskStatus` 타입에 없는 필드에 접근** (line 20-29)
- 이는 백엔드 응답에 `RiskStatus` 외 추가 필드가 포함될 수 있음을 암시

**제안**: `RiskStatus` 타입을 확장하거나, `computeRiskScore` 전용 확장 타입 생성
```typescript
interface RiskStatusExtended extends RiskStatus {
  drawdownMonitor: RiskStatus['drawdownMonitor'] & {
    params?: { maxDrawdownPercent?: string };
    drawdownPercent?: string;
  };
  circuitBreaker: RiskStatus['circuitBreaker'] & {
    consecutiveLosses?: number;
    consecutiveLossLimit?: number;
    params?: { consecutiveLossLimit?: number };
  };
}
```

**난이도**: S (20분)
**위험**: 낮음 -- 타입만 변경, 런타임 동작 변화 없음

---

### 3. [R11-FE-03] 타입 안전성: `as unknown as` 캐스트 3건 제거

**파일**: 3개 파일

| 파일 | 위치 | 캐스트 |
|------|------|--------|
| `EquityCurveChart.tsx` | line 28 | `data={chartData as unknown as Record<string, unknown>[]}` |
| `BacktestEquityCurve.tsx` | line 17 | `data={data as unknown as Record<string, unknown>[]}` |
| `CoinScoreboard.tsx` | line 72 | `(weightProfile.weights as unknown as Record<string, number>)` |

**근거**:
- `EquityCurveBase.tsx`가 `data: Record<string, unknown>[]`를 받는데, 소비자가 `EquityPoint[]`나 `BacktestEquityPoint[]`를 넘길 때 강제 캐스트 필요
- 이는 R10에서 `EquityCurveBase`를 만들 때 generic을 사용하지 않았기 때문

**제안**: `EquityCurveBase`를 제네릭 컴포넌트로 변경
```typescript
interface EquityCurveBaseProps<T extends Record<string, unknown>> {
  data: T[];
  loading: boolean;
  config: EquityCurveConfig;
}

export default function EquityCurveBase<T extends Record<string, unknown>>({
  data, loading, config
}: EquityCurveBaseProps<T>) { ... }
```

`CoinScoreboard.tsx`는 `CoinFactorScores` 타입이 이미 `types/index.ts`에 정의되어 있으므로:
```typescript
// 현재: (weightProfile.weights as unknown as Record<string, number>)[k]
// 수정: (weightProfile.weights)[k as keyof CoinFactorScores]
```

**난이도**: S (15분)
**위험**: 없음 -- 타입만 개선, 런타임 변화 없음

---

### 4. [R11-FE-04] 타입 안전성: `as never` 캐스트 7건 정리

**파일**: 7개 파일에서 Recharts `Tooltip.formatter` 타입 문제

| 파일 | 위치 |
|------|------|
| `DrawdownChart.tsx` | line 87 |
| `EquityCurveBase.tsx` | line 69 |
| `DailyPerformance.tsx` | line 100 |
| `StrategyPerformance.tsx` | line 106 |
| `SymbolPerformance.tsx` | line 104 |
| `BacktestPriceChart.tsx` | line 142 |
| `CoinScoreboard.tsx` | line 106 |

**근거**:
- Recharts의 `Tooltip` 컴포넌트의 `formatter` prop 타입이 복잡하여 모든 곳에서 `as never` 캐스트 사용 중
- 이는 Recharts v2의 타입 정의 문제로, 공통 유틸리티 타입을 만들어 해결 가능

**제안**: `chart-config.ts`에 공통 formatter 타입 정의
```typescript
// lib/chart-config.ts
import type { TooltipProps } from 'recharts';

// Recharts Tooltip formatter 타입 안전 래퍼
export type ChartTooltipFormatter = TooltipProps<number, string>['formatter'];

export function createCurrencyFormatter(
  label: string
): ChartTooltipFormatter {
  return (value, _name) => [`$${formatCurrency(String(value ?? 0))}`, label];
}
```

이렇게 하면 각 차트에서:
```typescript
// 현재: formatter={((value?: number) => [...]) as never}
// 수정: formatter={createCurrencyFormatter('PnL')}
```

**난이도**: M (30분) -- 7개 파일 일괄 수정
**위험**: 낮음 -- 기능 동일, 타입만 개선

---

### 5. [R11-FE-05] 중복 코드: Paper-mode Gate 패턴 공통화

**파일**: `app/backtest/page.tsx` (line 53-79), `app/tournament/page.tsx` (line 107-132)

**근거**:
두 파일에 거의 동일한 "가상거래 모드 전용" 게이트 UI가 중복됨:

```tsx
// backtest/page.tsx (line 53-79)
if (!botStatusLoading && !isPaper) {
  return (
    <div className="min-h-screen flex items-center justify-center relative z-10">
      <div className="text-center space-y-5 max-w-sm">
        <div className="w-12 h-12 mx-auto rounded-lg ..."> {/* 잠금 아이콘 SVG */} </div>
        <div>
          <h2>가상거래 모드 전용</h2>
          <p>백테스트는 가상거래(Paper) 모드에서만...</p>
        </div>
        <Link href="/">대시보드로 돌아가기</Link>
      </div>
    </div>
  );
}

// tournament/page.tsx (line 107-132) -- 거의 동일, "토너먼트" 텍스트만 다름
```

**제안**: 공통 `PaperModeGate` 컴포넌트 추출
```typescript
// components/ui/PaperModeGate.tsx
interface PaperModeGateProps {
  feature: string; // "백테스트" | "토너먼트"
}
export function PaperModeGate({ feature }: PaperModeGateProps) { ... }
```

**난이도**: S (15분)
**위험**: 없음

---

### 6. [R11-FE-06] 중복 코드: CATEGORY_LABEL 상수 3곳 중복

**파일**: 3개 파일에 동일/유사한 `CATEGORY_LABEL` 상수 정의

| 파일 | 값 |
|------|-----|
| `app/tournament/page.tsx` (line 31-35) | `{ 'price-action': '가격행동', 'indicator-light': '경량지표', 'indicator-heavy': '중량지표' }` |
| `components/StrategySymbolMap.tsx` (line 35-39) | `{ 'price-action': 'Price-Action', 'indicator-light': 'Indicator-Light', 'indicator-heavy': 'Indicator-Heavy' }` |
| `components/strategy/StrategyCard.tsx` (line 40-44) | `{ 'price-action': '가격행동', 'indicator-light': '지표 경량', 'indicator-heavy': '지표 고급' }` |

**문제**: 같은 카테고리에 대해 3가지 다른 한국어 표현이 사용됨 (가격행동 vs Price-Action, 경량지표 vs 지표 경량)

**제안**: `lib/utils.ts`에 `translateStrategyCategory()` 함수 추가하여 통일
```typescript
export function translateStrategyCategory(category: StrategyCategory): string {
  const map: Record<StrategyCategory, string> = {
    'price-action': '가격행동',
    'indicator-light': '경량지표',
    'indicator-heavy': '고급지표',
  };
  return map[category] || category;
}
```

**난이도**: S (15분) -- 3파일에서 로컬 상수 삭제 + 함수 호출로 교체
**위험**: 없음 -- UI 텍스트 통일

---

### 7. [R11-FE-07] 중복 코드: `formatPnl` 함수 tournament 로컬 정의

**파일**: `app/tournament/page.tsx` (line 25-29)

**근거**:
```typescript
// tournament/page.tsx 로컬 정의
function formatPnl(pnl: string): string {
  const num = parseFloat(pnl);
  if (isNaN(num)) return '0.00';
  return num >= 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}
```

- `lib/utils.ts`에 이미 `getPnlSign()` + `formatCurrency()` 조합으로 동일 기능 가능
- 그러나 `formatPnl`은 부호 포함 포맷이므로 별도 유틸로 `lib/utils.ts`에 승격이 적절

**제안**: `lib/utils.ts`에 `formatPnlValue()` 추가 후 tournament에서 import
```typescript
export function formatPnlValue(value: string | undefined | null): string {
  if (!value) return '0.00';
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num >= 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}
```

**난이도**: S (10분)
**위험**: 없음

---

### 8. [R11-FE-08] tournament/page.tsx 분할 (478줄 단일 파일)

**파일**: `app/tournament/page.tsx` (478줄)

**근거**:
- 현재 1개 파일에 **4개 컴포넌트**가 정의됨:
  - `TournamentPage` (메인 페이지, ~130줄)
  - `StatCard` (통계 카드, ~18줄)
  - `LeaderboardRow` (리더보드 행, ~60줄)
  - `StrategyDetailPanel` (전략 상세, ~130줄)
- 대시보드 `page.tsx`(310줄)는 이미 모든 서브컴포넌트를 분리 파일로 유지 중
- `StatCard`는 범용 컴포넌트인데 tournament 전용으로 갇혀 있음

**제안**: 서브 컴포넌트를 `components/tournament/` 디렉토리로 분리
- `components/tournament/LeaderboardTable.tsx`
- `components/tournament/StrategyDetailPanel.tsx`
- `StatCard`는 `components/ui/StatCard.tsx`로 분리 (DailyPerformance의 유사 카드와도 통합 검토)

**난이도**: M (40분)
**위험**: 낮음 -- 구조 리팩토링, 기능 변경 없음

---

### 9. [R11-FE-09] 백테스트 결과 비교 기능

**파일**: `app/backtest/page.tsx`, `components/backtest/BacktestListPanel.tsx`

**근거**:
- 현재 백테스트 목록에서 하나만 선택 가능 (`activeResult` 단일 상태)
- 서로 다른 전략/설정의 백테스트 결과를 나란히 비교하는 기능 없음
- `BacktestListPanel`에서 최대 2개 선택 후 핵심 지표(수익률, 최대 낙폭, 샤프 비율, 승률) 비교 테이블 표시

**제안**:
1. `BacktestListPanel`에 "비교" 모드 토글 + 체크박스 선택 (최대 2건)
2. 선택 시 `BacktestComparePanel.tsx` 신규 컴포넌트에서 2건의 metrics를 나란히 표시
3. 에쿼티 커브 오버레이 (같은 차트에 2개 라인)

**핵심 지표 비교 항목**:
- 총 수익률, 승률, 수익 팩터, 샤프 비율, 소르티노 비율, 칼마 비율, 최대 낙폭
- 차이 값/퍼센트 표시 (어느 쪽이 더 우수한지 시각적 표시)

**난이도**: L (90분) -- 신규 컴포넌트 + 상태 관리 변경
**위험**: 중간 -- 기존 flow 수정 필요하나 하위 호환 유지 가능

---

### 10. [R11-FE-10] 백테스트 폼 유효성 검증 강화

**파일**: `components/backtest/BacktestForm.tsx`

**근거**:
- 현재 유효성 검증은 빈 값 체크만 수행 (line 55-61):
  ```typescript
  const canSubmit = strategyName !== '' && symbol.trim() !== '' && ...
  ```
- 날짜 범위 오류(시작일 > 종료일)는 `handleSubmit` 내부에서 무시 (line 70: `if (startMs >= endMs) return;`) -- 사용자에게 피드백 없음
- 초기 자본 음수/0 검증 없음
- 수수료/슬리피지 범위 검증 없음 (100% 이상 입력 가능)

**제안**:
1. 날짜 범위 오류 시 인라인 에러 메시지 표시
2. 초기 자본 최소값 검증 (> 0)
3. 수수료/슬리피지 합리적 범위 경고 (0~5%)
4. 심볼 형식 검증 (XXXUSDT 패턴)
5. submit 버튼에 tooltip으로 미충족 조건 표시

**난이도**: S (25분)
**위험**: 없음 -- UX 개선만

---

### 11. [R11-FE-11] useStrategyDetail 훅의 수동 폴링 -> useAdaptivePolling 전환

**파일**: `hooks/useStrategyDetail.ts`

**근거**:
```typescript
// line 54: 고정 5초 폴링
intervalRef.current = setInterval(fetchStats, 5000);
```

- 다른 모든 훅은 `useAdaptivePolling`으로 전환 완료 (R8-T1-11~13)
- `useStrategyDetail`만 유일하게 수동 `setInterval` 사용
- 탭이 비활성일 때도 5초마다 폴링 -- 불필요한 API 호출
- `strategyName` 변경 시 cleanup + re-setup 로직이 `useAdaptivePolling` 내부 패턴과 중복

**제안**: `useAdaptivePolling` 전환 -- 단, 이 훅은 `strategyName`이 null일 때 폴링 중지가 필요하므로 약간의 조건 분기 필요

**난이도**: S (15분)
**위험**: 낮음 -- 기존 동작과 동일하되 탭 비활성 시 최적화

---

### 12. [R11-FE-12] PerformanceTabs 비활성 탭 데이터 사전 로드 방지

**파일**: `components/analytics/PerformanceTabs.tsx`

**근거**:
```typescript
// line 36-41: 4개 탭 데이터를 모두 즉시 로드
const {
  byStrategy, bySymbol, daily, loading: perfLoading,
} = usePerformanceAnalytics(sessionId);
```

- `usePerformanceAnalytics`는 마운트 즉시 `byStrategy`, `bySymbol`, `daily` 3개 API를 병렬 호출
- 사용자가 "에쿼티 커브" 탭(기본값)만 볼 때도 나머지 3개 API를 불필요하게 호출
- 에쿼티 커브 데이터(`equityCurve`)는 이미 상위에서 전달받으므로 추가 fetch 불필요

**제안**: Lazy loading 패턴 -- 탭 최초 선택 시에만 해당 데이터 fetch
```typescript
// 활성 탭이 바뀔 때만 해당 API 호출
const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set(['equity']));

// 탭 클릭 시
const handleTabChange = (tab: TabKey) => {
  setActiveTab(tab);
  setLoadedTabs(prev => new Set(prev).add(tab));
};
```

또는 `usePerformanceAnalytics`를 3개 독립 훅으로 분리하여 각 탭에서만 호출.

**난이도**: M (30분)
**위험**: 낮음 -- API 호출 감소, 초기 로드 시간 개선

---

### 13. [R11-FE-13] 접근성: 커스텀 다이얼로그의 Focus Trap 미구현

**파일**: `components/strategy/StrategyHub.tsx` (line 332-376)

**근거**:
- "전략 비활성화 모드" 다이얼로그가 커스텀 modal로 구현됨 (line 332-376)
- `<div className="fixed inset-0 z-50 ...">` 배경 + 내부 카드
- **Focus trap 미구현**: 다이얼로그가 열린 상태에서 Tab 키로 배경 요소에 접근 가능
- **Escape 키 닫기 미구현**: 키보드로 닫을 수 없음
- 대비: `ConfirmDialog.tsx`와 `EmergencyStopDialog.tsx`는 별도 컴포넌트로 포커스 관리가 되어 있음

비교:
```
EmergencyStopDialog.tsx:
  - tabIndex={-1} on container (line 96)
  - useEffect 내부 focus() (line 81)
  - Escape 키 핸들러 (line 76)

StrategyHub의 disable dialog:
  - focus trap: 없음
  - Escape 키: 없음
  - aria-modal: 없음
  - role="dialog": 없음
```

**제안**:
1. `role="dialog"`, `aria-modal="true"`, `aria-labelledby` 추가
2. Escape 키로 닫기 기능
3. 열릴 때 첫 번째 버튼에 자동 포커스
4. 선택적: `ConfirmDialog` 컴포넌트를 재사용하여 통일 (variant를 "choice"로 확장)

**난이도**: S (20분) -- 기존 EmergencyStopDialog 패턴 복제
**위험**: 없음 -- 접근성 개선

---

## 제안 사항 (우선순위, 구현 난이도, 예상 시간)

### 우선순위 A: 즉시 구현 (위험 최소, 효과 확실)

| 순서 | ID | 제목 | 난이도 | 시간 | 카테고리 |
|------|----|------|--------|------|----------|
| 1 | R11-FE-01 | MarketRegimeIndicator.tsx 삭제 | S | 5분 | 데드 코드 |
| 2 | R11-FE-06 | CATEGORY_LABEL 통일 + translateStrategyCategory | S | 15분 | 중복 코드 |
| 3 | R11-FE-07 | formatPnl 유틸 승격 | S | 10분 | 중복 코드 |
| 4 | R11-FE-02 | risk.ts any 타입 제거 | S | 20분 | 타입 안전성 |
| 5 | R11-FE-03 | as unknown as 캐스트 3건 제거 | S | 15분 | 타입 안전성 |
| 6 | R11-FE-05 | PaperModeGate 공통 컴포넌트 | S | 15분 | 중복 코드 |
| 7 | R11-FE-10 | 백테스트 폼 유효성 검증 | S | 25분 | 백테스트 UX |
| 8 | R11-FE-11 | useStrategyDetail 적응형 폴링 | S | 15분 | 성능 |
| 9 | R11-FE-13 | 비활성화 다이얼로그 접근성 | S | 20분 | 접근성 |

**소계**: 9건, ~140분

### 우선순위 B: 구조 개선 (더 높은 효과, 약간 더 복잡)

| 순서 | ID | 제목 | 난이도 | 시간 | 카테고리 |
|------|----|------|--------|------|----------|
| 10 | R11-FE-04 | as never 캐스트 7건 공통화 | M | 30분 | 타입 안전성 |
| 11 | R11-FE-12 | PerformanceTabs lazy loading | M | 30분 | 성능 |
| 12 | R11-FE-08 | tournament/page.tsx 분할 | M | 40분 | 컴포넌트 구조 |

**소계**: 3건, ~100분

### 우선순위 C: 기능 확장 (높은 가치, 큰 작업)

| 순서 | ID | 제목 | 난이도 | 시간 | 카테고리 |
|------|----|------|--------|------|----------|
| 13 | R11-FE-09 | 백테스트 결과 비교 기능 | L | 90분 | 백테스트 UX |

**소계**: 1건, ~90분

### 총 예상 시간: ~330분 (5.5시간)

### 권장 실행 범위

한 스프린트에서 **우선순위 A 전체(9건) + B에서 1~2건** 구현을 권장한다.

- **A 그룹(9건, ~140분)**: 모두 S 난이도로, 각각 독립적이며 부작용 위험이 극히 낮음
- **B 그룹에서 R11-FE-04 + R11-FE-12(60분)**: 차트 타입 정리와 성능 개선은 함께 진행하면 시너지

총 **11건, ~200분**이 현실적인 한 스프린트 분량이다.

---

## Deferred 항목 재검토

### 기존 deferred 항목 중 재검토

| Deferred 항목 | 현재 판단 | 이유 |
|---------------|----------|------|
| Toast 시스템 | **유지** | R8에서 `ErrorToast` + `useToasts` 구현 완료. 현재 상태로 충분. 글로벌 Toast Provider로의 전환은 앱 규모 대비 과도 |
| 레짐 매트릭스 | **유지** | `MarketIntelligence`의 4개 탭이 이미 충분한 정보 제공. 별도 매트릭스 시각화는 ROI 낮음 |
| 백테스트 프리셋 | **부분 수용** | R11-FE-10의 폼 유효성 강화가 우선. 프리셋은 향후 "인기 설정 저장/불러오기"로 진화 가능 |
| 레버리지 표시 | **구현 완료** | `PositionsTable.tsx` line 99에 `{pos.leverage}x` 이미 표시 중 |

---

## 다른 에이전트에게 요청 사항

### Trader Agent (Backend)에게

1. **R11-FE-02 관련**: `GET /api/risk/status` 응답에 실제로 포함되는 필드를 확인해 주세요. 현재 FE의 `RiskStatus` 타입에는 없지만 `risk.ts`에서 접근하는 필드들:
   - `drawdownMonitor.params.maxDrawdownPercent`
   - `drawdownMonitor.drawdownPercent`
   - `circuitBreaker.consecutiveLosses`
   - `circuitBreaker.consecutiveLossLimit`
   - `circuitBreaker.params.consecutiveLossLimit`

   이 필드들이 실제 응답에 포함된다면, `types/index.ts`의 `RiskStatus` 타입을 확장해야 합니다.

2. **R11-FE-09 (백테스트 비교)**: 이미 `GET /api/backtest/:id`로 개별 결과를 가져올 수 있으므로 BE 변경 불필요. 다만 향후 `POST /api/backtest/compare`처럼 서버 측 비교 API가 있으면 더 효율적일 수 있습니다 (optional).

### Engineer Agent (Infra/Quality)에게

1. **R11-FE-01** 삭제 후 `npm run build` 확인 필요
2. **R11-FE-04** Recharts 타입 문제가 라이브러리 버전 업데이트로 해결될 수 있는지 확인 (`package.json`의 recharts 버전 체크)
3. **R11-FE-11** `useAdaptivePolling`에 "조건부 비활성화" 파라미터 추가가 필요할 수 있음 -- `strategyName`이 null일 때 폴링 중지

---

## 참고: 전체 변경 파일 목록

### 삭제 (1파일)
- `frontend/src/components/MarketRegimeIndicator.tsx`

### 신규 (1~3파일, 범위에 따라)
- `frontend/src/components/ui/PaperModeGate.tsx` (R11-FE-05)
- `frontend/src/components/backtest/BacktestComparePanel.tsx` (R11-FE-09, 우선순위 C)
- `frontend/src/components/tournament/LeaderboardTable.tsx` (R11-FE-08, 우선순위 B)

### 수정 (예상 최대 15파일)
- `frontend/src/lib/utils.ts` -- translateStrategyCategory, formatPnlValue 추가
- `frontend/src/lib/risk.ts` -- any -> RiskStatusExtended
- `frontend/src/lib/chart-config.ts` -- ChartTooltipFormatter 타입 추가
- `frontend/src/types/index.ts` -- RiskStatus 확장
- `frontend/src/components/charts/EquityCurveBase.tsx` -- 제네릭 타입
- `frontend/src/components/EquityCurveChart.tsx` -- 캐스트 제거
- `frontend/src/components/backtest/BacktestEquityCurve.tsx` -- 캐스트 제거
- `frontend/src/components/market-intel/CoinScoreboard.tsx` -- 캐스트 + tooltip
- `frontend/src/components/analytics/DailyPerformance.tsx` -- tooltip formatter
- `frontend/src/components/analytics/StrategyPerformance.tsx` -- tooltip formatter
- `frontend/src/components/analytics/SymbolPerformance.tsx` -- tooltip formatter
- `frontend/src/components/DrawdownChart.tsx` -- tooltip formatter
- `frontend/src/components/backtest/BacktestPriceChart.tsx` -- tooltip formatter
- `frontend/src/components/backtest/BacktestForm.tsx` -- 유효성 검증
- `frontend/src/components/strategy/StrategyHub.tsx` -- 다이얼로그 접근성
- `frontend/src/hooks/useStrategyDetail.ts` -- adaptive polling
- `frontend/src/app/tournament/page.tsx` -- 분할 + CATEGORY_LABEL + formatPnl 제거
- `frontend/src/app/backtest/page.tsx` -- PaperModeGate
- `frontend/src/components/strategy/StrategyCard.tsx` -- CATEGORY_LABEL 제거
- `frontend/src/components/StrategySymbolMap.tsx` -- CATEGORY_LABEL 제거
