# Round 10 Cross-Review — UI/UX Engineer

**Reviewer**: Senior UI/UX Engineer
**Date**: 2026-02-17
**Reviewed**: Trader proposal (`agents/trader/proposals/round_10.md`), Engineer proposal (`agents/engineer/proposals/round_10.md`)

---

## 1. R8-T3-3: DrawdownMonitor peakEquity 영속성

### Trader 제안

**Verdict: ✅ 동의**

`loadState()`/`getState()` 방식 깔끔하다. BotSession에 이미 peakEquity 필드가 존재하고, 두 시스템(BotSession.stats vs DrawdownMonitor)이 독립적으로 peak을 추적하는 문제를 정확히 짚었다. FE 관점에서 변경 없음 -- `RiskStatusPanel`과 `DrawdownChart`는 API 응답을 그대로 렌더링하므로 영향 제로.

### Engineer 제안

**Verdict: ✅ 동의**

`hydrate()`/`dehydrate()` 네이밍이 더 명확하다 (React 생태계에서 hydration이 친숙한 개념). `isHalted` 복원까지 포함한 것이 Trader 제안보다 범위가 넓고 안전하다. BotSession.stats 스키마에 `dailyStartEquity`, `drawdownHalted`, `drawdownHaltReason` 추가하는 것도 합리적.

**UX 관점 추가 의견**: 없음. 순수 BE 내부 로직이므로 FE에 영향 없다. 두 제안 모두 즉시 진행 가능.

---

## 2. R8-T3-2: Trailing Stop 구현

### Trader 제안

**Verdict: ⚠️ 조건부 동의**

strategyBase.js에 공통 trailing stop 로직을 넣는 방향, 전략별 opt-in 설계, 추세 전략 6개에 활성화하는 판단 모두 합리적이다. 전략별 추천 파라미터 테이블도 잘 정리되어 있다.

**보완 필요 (FE 인터페이스)**:

Trader 제안에서 누락된 것은 **FE에서 trailing stop 상태를 어떻게 표시할지에 대한 API 응답 설계**다. 현재 `Position` 타입(`frontend/src/types/index.ts` L90-102)에는 trailing 관련 필드가 없다:

```typescript
export interface Position {
  symbol: string;
  posSide: PosSide;
  qty: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
  liquidationPrice: string;
  margin: string;
  stopLossPrice?: string;
  strategy?: string | null;
}
```

`PositionsTable.tsx`의 "SL 가격" 컬럼(line 58, 92-94)은 `stopLossPrice`만 표시한다. Trailing stop이 활성화되면 이 SL 가격이 동적으로 변하므로, 사용자가 다음을 알 수 있어야 한다:

1. **이 포지션이 trailing stop 모드인지** (고정 SL vs 추적 SL)
2. **현재 trailing SL 가격이 얼마인지** (가장 최근 업데이트된 값)
3. **trailing이 활성화 임계점을 넘었는지** (활성화 전 = 고정 SL, 활성화 후 = 추적 SL)

**구체적 보완 사항**:

BE API 응답에 다음 필드를 추가 요청:
```
trailingActive: boolean        // trailing stop이 활성화되어 추적 중인지
trailingStopPrice: string      // 현재 trailing SL 가격 (= highWaterMark * (1 - callback%))
```

FE에서는 `PositionsTable.tsx`의 SL 가격 컬럼을 다음과 같이 확장:
- `trailingActive === true`이면 SL 가격 옆에 작은 위쪽 화살표 아이콘과 `(추적)` 텍스트를 dim 처리로 표시
- SL 가격 자체는 `trailingStopPrice || stopLossPrice`로 동적 표시
- 이 변경은 BE 구현 후 후속 작업으로 진행 가능하므로 **R10에서는 BE 인터페이스 확정만 필요**

### Engineer 제안

**Verdict: ⚠️ 조건부 동의**

시스템 안정성 관점의 분석이 탁월하다. 특히:
- `_checkTrailingStop()`을 try-catch로 감싸는 fail-safe 설계
- AdaptiveRegimeStrategy 기존 trailing과의 충돌 방지 (`trailingStop.enabled: false`)
- super.onFill() 호출 패턴 문서화 필요성 지적

**보완 필요 (동일)**:

Engineer 제안에서도 FE 인터페이스 설계가 누락되어 있다. 위 Trader 리뷰에서 명시한 `trailingActive`/`trailingStopPrice` 필드를 positions API 응답에 포함하는 것을 합의 사항으로 추가해야 한다.

**추가 UX 고려사항**:

`StrategyDetail.tsx`의 전략 상세 화면(열린 포지션 테이블)에서도 trailing 상태를 표시해야 한다. 현재 `StrategyDetail.tsx`에는 14개의 `<th>` 태그가 있는 2개 테이블이 있으므로, trailing 상태 컬럼 추가 시 레이아웃이 넓어질 수 있다. 그러나 이는 기존 SL 컬럼에 통합 표시(아이콘 + 텍스트)하면 별도 컬럼 추가 없이 해결 가능하다.

---

## 3. R8-T3-1: 백테스트 멀티포지션 지원

### Trader 제안

**Verdict: ⚠️ 조건부 동의**

멀티포지션 전환의 기술적 설계는 합리적이다. `_positions` Map 전환, FIFO 청산, 포지션별 funding 추적 모두 타당하다.

**보완 필요 (FE 시각화)**:

멀티포지션이 백테스트에 적용되면 FE 시각화에 다음 영향이 생긴다:

**BacktestPriceChart.tsx (매매 포인트 차트)**:
현재 ScatterChart는 시간-가격 2D 평면에 진입/청산 마커를 찍는다. 동시 포지션이 존재하면:
- 같은 시간대에 진입 마커 + 기존 포지션 청산 마커가 겹침
- 특히 Grid 전략에서 여러 그리드 레벨의 진입점이 수직으로 밀집

현재 마커 크기(삼각형 높이 14px, 원 기본 크기)로는 3개 이상 겹치면 식별 불가.

**대안 제시**:
1. `BacktestTrade` 인터페이스에 `positionId: string` 필드 추가 요청 (Trader 제안서에 이미 `${side}_${entryTime}` 또는 순차 ID 언급)
2. FE에서는 positionId별 색상 오프셋으로 구분 (같은 시간대 마커를 수평으로 약간 오프셋)
3. 그러나 이 FE 변경은 **R10 스코프 밖**으로 보는 것이 합리적. 기존 UI가 멀티포지션 데이터를 표시 자체는 가능하고 (겹침이 있을 뿐), 최적화는 후속 라운드에서 진행

**BacktestStatsPanel.tsx (성과 통계)**:
Trader 제안서에 "최대 동시 포지션 수" 메트릭 언급이 없다. 멀티포지션 백테스트에서는 이 지표가 필수적이다:
- `maxConcurrentPositions` (실제 최대 동시 포지션 수)를 `BacktestMetrics`에 추가 요청
- `BacktestStatsPanel.tsx`에 "최대 동시 포지션" 항목 1줄 추가 (STATS 배열에 push)
- `BacktestMetrics` 타입(`frontend/src/types/backtest.ts`)에 `maxConcurrentPositions: number` 추가

### Engineer 제안

**Verdict: ⚠️ 조건부 동의**

key 설계를 `'long' | 'short'`으로 한 것은 **멀티포지션의 의미를 축소**한다. 이 설계에서는 같은 방향의 포지션이 최대 1개이므로 실질적으로 "헤지 포지션"만 가능하고, Grid 전략의 같은 방향 다중 진입(핵심 시나리오)을 지원하지 못한다.

**보완 필요**:

Trader 제안의 `${side}_${entryTime}` 또는 순차 ID 방식이 더 유연하다. Engineer의 `'long' | 'short'` key는 maxConcurrentPositions=2(long+short) 시나리오에만 적합하고, Grid의 같은 방향 여러 포지션에는 부적합하다.

key를 `pos_${incrementalId}` 방식으로 하되, `_maxConcurrentPositions`를 전략 메타데이터의 `maxConcurrentPositions`에서 읽어오는 것을 권장.

---

## 4. R8-T3-4: Sortino Ratio 산출

### Trader 제안

**Verdict: ✅ 동의**

Sortino 계산 로직이 수학적으로 정확하다. 분모를 전체 period 수로 나누는 표준 정의를 따르고, MAR=0 설정도 암호화폐에 적합하다. Calmar Ratio 추가 제안도 좋다 -- 1줄 추가로 직관적인 지표를 얻을 수 있다.

**FE 표시 위치 설계 (BacktestStatsPanel)**:

현재 `BacktestStatsPanel.tsx`의 STATS 배열에 15개 지표가 `grid-cols-2 md:grid-cols-4` 그리드로 표시된다. 15개이므로 4열 기준으로 4줄(마지막 줄 3개)이다.

Sortino + Calmar를 추가하면 17개가 되어 4열 기준 5줄(마지막 줄 1개)이 된다. 마지막 줄에 1개만 있으면 시각적으로 어색하다.

**제안 배치**:
- Sortino를 "샤프 비율" 바로 뒤에 배치 (관련 지표 묶음)
- Calmar를 "최대 낙폭" 바로 뒤에 배치 (drawdown 관련 묶음)
- 이렇게 하면 17개 = 4줄 + 마지막 1개인데, 추가로 "평균 보유시간" 지표를 넣으면 18개 = 4열 x 4.5줄 = 깔끔한 배치
- 또는 "총 수수료"를 하단 면책 조항 영역으로 이동하면 16개 = 4열 x 4줄로 정확히 맞음

**구체적 STATS 배열 삽입 위치**:
```typescript
// 현재 index 6: '샤프 비율'
// 새로 index 7: '소르티노 비율' (Sortino)
{
  label: '소르티노 비율',
  getValue: (m) => parseFloat(m.sortinoRatio ?? '0').toFixed(2),
  getColor: (m) => {
    const v = parseFloat(m.sortinoRatio ?? '0');
    if (isNaN(v)) return 'text-[var(--text-primary)]';
    return v >= 1 ? 'text-[var(--profit)]' : v >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--loss)]';
  },
},

// 현재 index 4: '최대 낙폭' 뒤에
// 새로 index 5: '칼마 비율' (Calmar)
{
  label: '칼마 비율',
  getValue: (m) => parseFloat(m.calmarRatio ?? '0').toFixed(2),
  getColor: (m) => {
    const v = parseFloat(m.calmarRatio ?? '0');
    if (isNaN(v)) return 'text-[var(--text-primary)]';
    return v >= 1 ? 'text-[var(--profit)]' : v >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--loss)]';
  },
},
```

**타입 변경 필요** (`frontend/src/types/backtest.ts`):
```typescript
export interface BacktestMetrics {
  // ... 기존 필드
  sortinoRatio: string;   // 추가
  calmarRatio: string;    // 추가 (Calmar도 넣을 경우)
}
```

### Engineer 제안

**Verdict: ✅ 동의**

edge case 처리(하방 수익률 0건 시 999.99)가 Sharpe와 일관적이다. `meanReturn` 스코프 조정 필요성도 정확히 짚었다.

---

## 5. R8-T3-5: 데드 코드 삭제

### Trader 제안

**Verdict: ✅ 동의**

단, 한 가지 중요한 확인 사항이 있다.

### Engineer 제안

**Verdict: ⚠️ 조건부 동의**

Engineer가 "`StrategyListItem` 타입이 다른 곳에서도 쓰이는지 확인 필요"라고 언급했는데, 이미 확인했다:

**`StrategyListItem` 사용처** (Grep 결과):
1. `frontend/src/types/index.ts` -- 타입 정의
2. `frontend/src/components/StrategyPanel.tsx` -- 삭제 대상 (import)
3. `frontend/src/components/strategy/StrategyCard.tsx` -- 사용 중
4. `frontend/src/components/strategy/StrategyHub.tsx` -- 사용 중
5. `frontend/src/lib/api-client.ts` -- 사용 중

**결론**: `StrategyListItem` 타입은 3곳에서 활발히 사용 중이므로 타입 삭제 금지. `StrategyPanel.tsx` 파일만 삭제하면 안전하다. Engineer의 우려는 타당했으나, 결론은 "타입은 유지, 파일만 삭제"이다.

---

## 6. R8-T3-6: EquityCurveChart 공통 추출

### Trader 제안

**Verdict: ✅ 동의**

공통 추출 방향에 동의. "한 곳에서 고급 기능을 추가할 수 있다"는 판단이 정확하다.

### Engineer 제안

**Verdict: ⚠️ 조건부 동의**

`BaseEquityCurve` 공통 컴포넌트 + thin wrapper 구조는 내 Phase 1 제안서와 동일한 방향이다.

**보완 필요 (Props 인터페이스 정제)**:

Engineer가 제안한 `dataMapper: (point) => { time, primary, secondary }` 방식은 유연하지만, 타입 안전성이 떨어진다. 내 제안서의 `EquityCurveConfig` 인터페이스(config object 방식)가 더 적합한 이유:

1. **타입 추론**: config 객체의 `timeField`, `primaryKey`, `secondaryKey`를 명시하면 IDE 자동완성이 동작
2. **직렬화 가능**: config 객체는 JSON으로 직렬화 가능하여 Storybook/테스트에서 사용 용이
3. **확장성**: 향후 tournament equity curve 추가 시 새 config 상수만 정의하면 됨

다만, 공통 추출 시 **Card 래핑을 공통 컴포넌트에 포함할지 말지** 결정이 필요하다:
- 현재 두 컴포넌트 모두 `<Card title="에쿼티 커브">`로 래핑
- 대시보드는 `col-span-full` 클래스를 Card에 추가
- 공통 컴포넌트에서는 Card를 **포함하지 않고** 순수 차트만 렌더링하는 것을 권장
- 이유: `PerformanceTabs.tsx`에서 이미 자체적인 탭 레이아웃 안에서 `EquityCurveChart`를 사용하고 있어, Card 중첩이 발생할 수 있음
- wrapper에서 Card 래핑을 담당하게 하면 소비자별 유연성 확보

---

## 7. R8-T3-7: th scope="col" 일괄 추가

### Trader 제안

**Verdict: ✅ 동의**

비용이 거의 없고 WCAG 2.1 Level A 충족. 내 분석과 동일.

### Engineer 제안

**Verdict: ✅ 동의**

72개라고 했으나 내 분석에서는 88개로 파악. tournament/page.tsx의 동적 생성 `<th>` (`.map()` 내부)까지 포함하면 88개가 맞다. 사소한 차이이고, 어차피 모든 `<th>`에 일괄 추가하므로 구현에 영향 없음.

**추가 UX 세부사항**: `<th>` 중 행 헤더 역할을 하는 것은 `scope="row"`를 써야 한다. 현재 코드를 확인한 결과, 행 헤더로 사용되는 `<th>`는 없으므로 모두 `scope="col"`로 통일해도 무방.

---

## 8. R8-T3-8: TOOLTIP_STYLE 통일

### Trader 제안

**Verdict: ✅ 동의**

"시각적 일관성은 데이터 인지 속도에 영향을 미친다"는 판단에 완전히 동의.

### Engineer 제안

**Verdict: ⚠️ 조건부 동의**

`CoinScoreboard.tsx`의 `border-subtle` vs `border-muted` 차이를 짚은 것이 좋다.

**보완 필요 (디자인 의도 확인)**:

Engineer가 "analytics 차트가 의도적으로 더 작은 borderRadius를 쓴 것인지" 질문했는데, 코드를 확인한 결과 **의도적이지 않다**:

- `DailyPerformance.tsx`, `StrategyPerformance.tsx`, `SymbolPerformance.tsx`의 로컬 `TOOLTIP_STYLE`은 R3~R4 시점에 작성됨
- `CHART_TOOLTIP_STYLE`은 R6에서 `chart-config.ts`로 추출되면서 borderRadius를 8px로 통일
- analytics 3개 파일은 R6 리팩토링 대상에서 누락된 것

따라서 `borderRadius: '8px'`, `fontSize: '12px'`로 통일하는 것이 올바르다. 추가로 `CoinScoreboard.tsx`의 `border-subtle`도 `border-muted`로 통일한다. `border-subtle`은 테이블 구분선용이고, 차트 tooltip에는 `border-muted`가 디자인 시스템에 맞다.

---

## 전체 합의 요약

### 우선순위 동의

3개 제안서 모두 R8-T3-3(peakEquity 영속성)을 1위로 배치했다. **완전 합의**.

| ID | Trader | Engineer | UI/UX | 합의 |
|----|--------|----------|-------|------|
| R8-T3-3 | 1위 | 1위 | 동의 | **1위 확정** |
| R8-T3-2 | 2위 | 2위 | 조건부 동의 (FE 인터페이스 보완) | **2위 확정** |
| R8-T3-4 | 3위 | 4위 | 동의 + FE 배치 설계 완료 | **3위 (빠른 구현, 높은 ROI)** |
| R8-T3-1 | 4위 | 3위 | 조건부 동의 (key 설계 + FE 메트릭) | **4위 (가장 큰 구현 비용)** |
| R8-T3-5 | 7위 | 8위 | 동의 (StrategyListItem 유지 확인) | **5위** |
| R8-T3-8 | 5위 | 5위 | 동의 (비의도적 차이 확인) | **6위** |
| R8-T3-7 | 6위 | 6위 | 동의 | **7위** |
| R8-T3-6 | 8위 | 7위 | 조건부 동의 (Card 래핑 분리) | **8위** |

### BE에 필요한 FE 인터페이스 확정 요청

1. **R8-T3-2 (Trailing Stop)**: Position API 응답에 `trailingActive: boolean`, `trailingStopPrice: string` 필드 추가
2. **R8-T3-1 (멀티포지션)**: BacktestMetrics에 `maxConcurrentPositions: number` 추가, BacktestTrade에 `positionId: string` 추가
3. **R8-T3-4 (Sortino)**: BacktestMetrics에 `sortinoRatio: string`, `calmarRatio: string` 추가
4. **R8-T3-1 (key 설계)**: Map key를 `${side}_${entryTime}` 또는 순차 ID 방식으로 (Engineer의 `'long'|'short'` key 반대)

### FE 구현 계획 (내 담당)

```
Phase 3-A (빠른 정리, ~30분):
  R8-T3-5  데드 코드 삭제 (StrategyPanel.tsx, ClientGate.tsx)
  R8-T3-8  TOOLTIP_STYLE 통일 (4개 파일)
  R8-T3-7  th scope="col" 일괄 추가 (10개 파일, ~88개 태그)

Phase 3-B (구조적 개선, ~45분):
  R8-T3-6  EquityCurveBase 공통 추출 + 래퍼

Phase 3-C (BE 완료 후, ~30분):
  R8-T3-4  BacktestStatsPanel에 Sortino + Calmar 표시
  R8-T3-4  BacktestMetrics 타입 확장
  R8-T3-2  PositionsTable trailing stop 상태 표시 (BE API 확정 후)
```

**총 FE 예상 시간**: ~1시간 45분
