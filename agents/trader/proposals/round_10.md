# Round 10 Proposal: Tier 3 Enhancement (8건)

**Author**: Senior Quant Trader
**Date**: 2026-02-17
**Scope**: 매매 전략, 리스크, 백테스트 관점의 분석 + FE 의견

---

## 분석 요약

Tier 3 잔여 8건은 크게 세 트랙으로 나뉜다.

| 트랙 | 항목 | 수익에 미치는 영향 | 트레이더 우선순위 |
|------|------|--------------------|-------------------|
| Backtest | R8-T3-1 멀티포지션, R8-T3-4 Sortino | 백테스트 정확도 직결 | **최고** |
| Backend | R8-T3-2 Trailing Stop, R8-T3-3 peakEquity 영속성 | 실전 수익/리스크 직결 | **최고** |
| Frontend | R8-T3-5~8 데드코드/공통추출/접근성/스타일 | 간접적 (개발 속도 향상) | 보통 |

**핵심 판단**: 4개 BE/BT 항목은 모두 실전 수익률과 리스크 관리에 직접 영향을 미치는 항목이며, FE 4건은 코드 품질 개선으로 향후 유지보수 비용을 줄인다. 8건 전부 구현 가능하고 구현해야 한다.

---

## 발견 사항 (코드 레벨 근거)

### R8-T3-1: 백테스트 멀티포지션 지원

**현재 상태** (`backend/src/backtest/backtestEngine.js`):
- `this._position`이 단일 객체 (`null` 또는 하나의 포지션)
- `_openLong()` / `_openShort()` 시작부에 `if (this._position !== null) return;` 가드 (L533, L597)
- Grid 전략 같은 멀티포지션 전략은 백테스트 결과가 실전과 괴리

**문제점 분석**:
1. **Grid 전략**: 실전에서는 여러 그리드 레벨에 동시 포지션을 갖지만, 백테스트에서는 첫 진입 후 나머지 신호 전부 무시
2. **Turtle 전략**: 피라미딩(추가 진입)이 핵심인데, 단일 포지션이라 불가
3. **멀티심볼 라우팅**(R9에서 구현)과도 맞물림: 같은 전략이 다른 심볼에 동시 진입하는 시나리오

**제안 구현**:
```
변경 파일: backend/src/backtest/backtestEngine.js

1. this._position (단일) → this._positions (Map<string, object>)
   - key: `${side}_${entryTime}` 또는 순차 ID

2. maxConcurrentPositions 제한: 전략 metadata.maxConcurrentPositions 참조
   - 현재 대부분 전략이 maxConcurrentPositions = 1이므로 기존 동작 100% 호환

3. _openLong/_openShort:
   - 가드 조건을 `this._positions.size >= maxConcurrentPositions` 로 변경
   - 새 포지션을 Map에 추가

4. _closeLong/_closeShort:
   - FIFO (가장 오래된 포지션 먼저 청산) 또는 전략 신호에 포함된 positionId로 매칭

5. _calculateEquity:
   - 전체 포지션의 미실현 PnL 합산

6. _forceClosePosition:
   - 모든 열린 포지션을 순회하며 강제 청산

7. 포지션별 _accumulatedFunding 추적
```

**예상 영향**: Grid 전략 백테스트 Sharpe가 30~50% 더 현실적으로 나올 것. Turtle 피라미딩 효과 반영으로 추세장 수익률 과소평가 문제 해결.

**구현 난이도**: 중상 (기존 단일 포지션 로직 전면 리팩토링)
**예상 시간**: 3~4시간

---

### R8-T3-2: Trailing Stop 구현

**현재 상태**:
- 모든 18개 전략이 **고정 비율 SL** 사용 (예: Supertrend `slPercent: '2'`)
- `_checkTpSl()` 패턴이 모든 전략에 동일하게 반복 (각 전략의 `onTick()`에서 호출)
- `strategyBase.js`에는 TP/SL 관련 공통 로직이 없음
- `orderManager.js`는 `stopLossPrice`를 거래소에 전달하지만, trailing 로직은 없음

**Trailing Stop의 수익 임팩트**:
- 고정 SL의 문제: 강한 추세에서 +5% 수익 중 반전하면 SL -2%에 걸려 +3%만 획득
- Trailing Stop이면: 최고점 대비 2% 하락 시 청산 -> +3% 대신 +4~5% 획득 가능
- 특히 Turtle, Supertrend, MaTrend 같은 추세 전략에서 효과 극대

**현재 SL 패턴 분석** (SupertrendStrategy L236-292 대표):
```javascript
_checkTpSl() {
  const pnlRatio = divide(subtract(this._latestPrice, this._entryPrice), this._entryPrice, 8);
  if (isLessThan(pnlRatio, negSl)) { /* close */ }
}
```
모든 전략이 이 패턴을 복사-붙여넣기로 구현 중. 공통화와 trailing 확장이 동시에 가능.

**제안 구현**:
```
변경 파일:
  - backend/src/services/strategyBase.js — 공통 TP/SL/Trailing 로직 추가
  - 18개 전략 파일 — _checkTpSl() 중복 제거, base 클래스 위임

strategyBase.js 추가:

1. _trailingState 인스턴스 변수:
   {
     highWaterMark: null,    // 포지션 이후 최고가 (long) / 최저가 (short)
     trailingActivated: false,
     trailingActivationPercent: config.trailingActivationPercent || null,
     trailingCallbackPercent: config.trailingCallbackPercent || slPercent,
   }

2. updateTrailingStop(latestPrice):
   - long: highWaterMark = max(highWaterMark, latestPrice)
     trailing SL = highWaterMark * (1 - callbackPercent/100)
   - short: lowWaterMark = min(lowWaterMark, latestPrice)
     trailing SL = lowWaterMark * (1 + callbackPercent/100)

3. trailingActivationPercent:
   - null이면 진입 즉시 trailing 시작 (순수 trailing)
   - 값이 있으면 해당 %만큼 수익 발생 후 trailing 활성화
   - 활성화 전에는 고정 SL 사용

4. 전략별 metadata.defaultConfig에 추가:
   - trailingEnabled: true/false (기본 false — 기존 동작 유지)
   - trailingActivationPercent: '1.5'
   - trailingCallbackPercent: '1.0'
```

**전략별 추천 설정**:
| 전략 카테고리 | trailingEnabled | activation | callback | 이유 |
|--------------|-----------------|-----------|----------|------|
| 추세추종 (Turtle, Supertrend, MaTrend) | true | '1.5' | '1.0' | 강한 추세 포착에 최적 |
| 모멘텀 (RSIPivot, MacdDivergence) | true | '1.0' | '0.8' | 중간 모멘텀에서도 수익 보호 |
| 횡보 (Grid, Bollinger, Vwap) | false | - | - | 작은 범위 왕복이므로 고정 SL이 적합 |
| 스캘핑 (QuietRangeScalp) | false | - | - | 극소 수익 목표, trailing 오버헤드 불필요 |

**예상 영향**: 추세 전략군(6개)의 평균 수익률 15~25% 향상 예상. Profit Factor 개선.
**구현 난이도**: 중 (base 클래스 변경 + 전략별 config 추가)
**예상 시간**: 2~3시간

---

### R8-T3-3: DrawdownMonitor peakEquity 영속성

**현재 상태** (`backend/src/services/drawdownMonitor.js`):
- `this.peakEquity = '0'`으로 생성자에서 초기화 (L43)
- 서버 재시작 시 peakEquity가 0으로 리셋됨
- `updateEquity()`에서 현재 equity보다 클 때만 갱신 (L62-64)
- **핵심 버그**: 서버 재시작 후 첫 equity 값이 새 peak가 되므로, 실제 peak(재시작 전)보다 낮을 수 있음
  - 예: 재시작 전 peak = 11000, 현재 equity = 9500 → 재시작 후 peak = 9500
  - 결과: drawdown이 0%로 잘못 계산됨 → 리스크 엔진이 위험을 감지 못함

**BotSession 모델에 이미 peakEquity 필드 존재** (`backend/src/models/BotSession.js` L21):
```javascript
peakEquity: { type: String, default: '0' },
```

**botService.js에서도 peakEquity 추적 중** (L1496-1498):
```javascript
const peakEquity = session.stats.peakEquity || '0';
if (math.isGreaterThan(currentEquity, peakEquity)) {
  session.stats.peakEquity = currentEquity;
}
```

그러나 **이 값이 DrawdownMonitor에 주입되지 않는다**. BotSession의 peakEquity와 DrawdownMonitor의 peakEquity가 완전히 별개.

**제안 구현**:
```
변경 파일:
  - backend/src/services/drawdownMonitor.js — loadState() / getState() 메서드 추가
  - backend/src/services/botService.js — start() 시 peakEquity 복원

1. drawdownMonitor.js 추가:

   loadState({ peakEquity, dailyStartEquity }) {
     if (peakEquity && isGreaterThan(peakEquity, this.peakEquity)) {
       this.peakEquity = peakEquity;
     }
     if (dailyStartEquity) {
       this.dailyStartEquity = dailyStartEquity;
     }
   }

   getState() {
     return {
       peakEquity: this.peakEquity,
       dailyStartEquity: this.dailyStartEquity,
       currentEquity: this.currentEquity,
       isHalted: this.isHalted,
       haltReason: this.haltReason,
     };
   }

2. botService.js start() 수정:
   - 마지막 활성 세션에서 peakEquity 로드
   - drawdownMonitor.loadState({ peakEquity }) 호출
   - 이렇게 하면 서버 재시작 후에도 진정한 peak가 유지됨

3. botService.js 주기적 저장 (equity 스냅샷 저장 시):
   - drawdownMonitor.getState()의 peakEquity를 BotSession에 동기화
```

**예상 영향**: 서버 재시작 후 리스크 엔진이 올바른 drawdown을 계산하여 과도한 위험 노출 방지. 이 버그가 실전에서 터지면 최대 낙폭 한도가 무력화되어 치명적.
**구현 난이도**: 하 (기존 인프라 활용, 2개 파일 수정)
**예상 시간**: 1시간

---

### R8-T3-4: Sortino Ratio 산출

**현재 상태** (`backend/src/backtest/backtestMetrics.js`):
- Sharpe Ratio만 구현 (L236-276)
- 수익률 계산: equity curve에서 per-period returns 추출 → 평균/표준편차 → 연율화
- `PERIODS_PER_YEAR` 매핑 테이블로 interval별 연율화 (L56-68)
- `sqrt()` 헬퍼가 `parseFloat`/`Math.sqrt` 기반 (L42-46) — mathUtils에 sqrt 없음

**Sharpe vs Sortino 차이**:
- Sharpe: 전체 변동성(상방+하방) 기준 → 상방 변동성까지 페널티
- Sortino: **하방 변동성(downside deviation)만** 기준 → 수익이 큰 전략을 정당하게 평가
- 암호화폐 시장은 수익률 분포가 비대칭(skewed)이므로 Sortino가 더 적합한 성과 지표

**제안 구현**:
```
변경 파일: backend/src/backtest/backtestMetrics.js

computeMetrics() 내부, Sharpe 계산 직후에 추가:

// -- Sortino Ratio (annualised, downside deviation only) --
let sortinoRatio = '0.00';

if (periodReturns.length > 0) {
  // 1. 하방 수익률만 필터 (0 이하)
  let sumSquaredDownside = '0';
  let downsideCount = 0;

  for (const r of periodReturns) {
    if (isLessThan(r, '0') || isZero(r)) {
      // 단, isZero는 downside에 포함하지 않는 변형도 있으나,
      // 보수적으로 0 이하를 downside로 처리
    }
    // MAR(Minimum Acceptable Return) = 0 기준
    // downside = min(r - MAR, 0) → r < 0이면 r, 아니면 0
    if (isLessThan(r, '0')) {
      const squared = multiply(r, r);
      sumSquaredDownside = add(sumSquaredDownside, squared);
      downsideCount++;
    }
  }

  // 2. Downside Deviation = sqrt(sum(min(r,0)^2) / N)
  //    N = 전체 기간 수 (not just downside count) → 표준 Sortino 정의
  if (periodReturns.length > 0) {
    const downsideVariance = divide(sumSquaredDownside, String(periodReturns.length));
    const downsideDeviation = sqrt(downsideVariance);

    // 3. Sortino = (meanReturn * sqrt(periodsPerYear)) / downsideDeviation
    if (!isZero(downsideDeviation)) {
      const sqrtPeriods = sqrt(String(periodsPerYear));
      const annualisedReturn = multiply(meanReturn, sqrtPeriods);
      sortinoRatio = toFixed(divide(annualisedReturn, downsideDeviation), 2);
    }
  }
}

// 반환 객체에 추가:
return {
  ...existingMetrics,
  sortinoRatio,
};
```

**중요 구현 세부사항**:
- Downside deviation 분모: 전체 period 수 사용 (downside count 아님). 이것이 표준 Sortino 정의.
- MAR(Minimum Acceptable Return) = 0 (risk-free rate). 암호화폐에서는 0이 표준.
- `periodReturns` 배열은 Sharpe 계산에서 이미 만들어져 있으므로 재활용.

**추가 제안 — Calmar Ratio도 같이 추가**:
```javascript
// Calmar = annualised return / max drawdown
// 이미 maxDrawdownPercent와 totalReturn이 계산되어 있으므로 1줄
const calmarRatio = !isZero(maxDrawdownPercent)
  ? toFixed(divide(totalReturn, maxDrawdownPercent), 2)
  : '0.00';
```
Calmar는 drawdown 대비 수익률로, 트레이더가 가장 직관적으로 이해하는 지표.

**예상 영향**: 전략 간 비교 시 더 정확한 리스크 조정 수익률 제공. 특히 Turtle, AdaptiveRegime 같은 고변동 전략의 하방 리스크를 정확히 평가.
**구현 난이도**: 하 (기존 Sharpe 로직 패턴 재활용)
**예상 시간**: 30분

---

### R8-T3-5: 데드 코드 삭제 (StrategyPanel, ClientGate)

**현재 상태**:
- `frontend/src/components/StrategyPanel.tsx` — 어디에서도 import하지 않음 (grep 결과 0건)
- `frontend/src/components/ClientGate.tsx` — 어디에서도 import하지 않음 (grep 결과 0건)

**트레이더 의견**: 데드 코드는 개발 속도를 저하시키고, 의존성 업데이트 시 불필요한 컴파일 에러를 유발한다. 삭제 적극 찬성. 다만 삭제 전에 해당 파일이 포함하고 있을 수 있는 유용한 로직(예: 전략 설정 UI 패턴)이 있다면, 향후 구현 시 참고할 수 있도록 커밋 히스토리에서 복원 가능하다는 점을 확인한 뒤 삭제할 것.

**구현 난이도**: 최하
**예상 시간**: 5분

---

### R8-T3-6: EquityCurveChart 공통 추출

**현재 상태**:
- `frontend/src/components/EquityCurveChart.tsx` — 대시보드 주식 곡선
- `frontend/src/components/backtest/BacktestEquityCurve.tsx` — 백테스트 주식 곡선
- `frontend/src/components/analytics/PerformanceTabs.tsx` — 분석 탭에서도 equity curve 렌더링

3곳에서 Recharts `LineChart` + `Tooltip` + `ResponsiveContainer` 패턴이 중복. CHART_TOOLTIP_STYLE은 이미 `lib/chart-config.ts`로 추출됨.

**트레이더 의견**: 주식 곡선 차트는 트레이딩 대시보드의 핵심 시각화다. 통일된 컴포넌트가 있으면 향후 drawdown 영역 음영, 최대 낙폭 구간 표시, 전략별 색상 구분 등 고급 기능을 한 곳에서 추가할 수 있다. 찬성.

**구현 난이도**: 중하
**예상 시간**: 1시간

---

### R8-T3-7: th scope="col" 일괄 추가

**트레이더 의견**: 접근성(a11y) 개선. 직접적인 매매 영향은 없으나, 기관 투자자나 규제 환경에서 웹 접근성 준수가 요구될 수 있다. 비용이 거의 없으므로 찬성.

**구현 난이도**: 최하
**예상 시간**: 15분

---

### R8-T3-8: TOOLTIP_STYLE 통일

**현재 상태**:
- `lib/chart-config.ts`에 `CHART_TOOLTIP_STYLE`이 정의됨
- `DrawdownChart.tsx`, `BacktestEquityCurve.tsx`, `EquityCurveChart.tsx`, `BacktestPriceChart.tsx` — 이미 공통 스타일 사용 중
- `DailyPerformance.tsx`, `StrategyPerformance.tsx`, `SymbolPerformance.tsx` — 각각 로컬 `TOOLTIP_STYLE` 정의 (중복)

3개 파일에서 로컬 TOOLTIP_STYLE을 `CHART_TOOLTIP_STYLE`로 교체하면 끝.

**트레이더 의견**: 시각적 일관성은 데이터 인지 속도에 영향을 미친다. 차트 간 스타일이 불일치하면 인지 부하가 증가한다. 찬성.

**구현 난이도**: 최하
**예상 시간**: 10분

---

## 제안 사항 (우선순위, 구현 난이도, 예상 시간)

| 우선 | ID | 제목 | 난이도 | 시간 | 수익 임팩트 |
|------|----|------|--------|------|-------------|
| 1 | R8-T3-3 | DrawdownMonitor peakEquity 영속성 | 하 | 1h | 리스크 직결 (버그 수정) |
| 2 | R8-T3-2 | Trailing Stop 구현 | 중 | 2~3h | 수익률 15~25% 향상 |
| 3 | R8-T3-4 | Sortino Ratio 산출 (+Calmar) | 하 | 30m | 전략 평가 정확도 |
| 4 | R8-T3-1 | 백테스트 멀티포지션 | 중상 | 3~4h | 백테스트 정확도 |
| 5 | R8-T3-8 | TOOLTIP_STYLE 통일 | 최하 | 10m | 시각 일관성 |
| 6 | R8-T3-7 | th scope="col" 일괄 추가 | 최하 | 15m | 접근성 |
| 7 | R8-T3-5 | 데드 코드 삭제 | 최하 | 5m | 코드 위생 |
| 8 | R8-T3-6 | EquityCurveChart 공통 추출 | 중하 | 1h | 유지보수성 |

**총 예상 시간**: 8~10시간

**우선순위 근거**:
- R8-T3-3이 1위인 이유: 현재 **리스크 엔진의 핵심 방어막에 구멍**이 있다. 서버 재시작 시 peakEquity 소실로 drawdown 한도가 무력화됨. 실전에서 이 버그가 터지면 최대 낙폭 제한을 우회하여 과도한 손실 발생 가능. 즉각 수정 필요.
- R8-T3-2가 2위인 이유: 추세 전략 6개의 수익률을 직접 올리는 기능. 구현 후 백테스트로 즉시 검증 가능.
- R8-T3-4가 3위인 이유: 코드 30줄 추가로 전략 평가 품질이 크게 향상. 비용 대비 효과 최고.

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **R8-T3-3 (peakEquity 영속성)**:
   - `drawdownMonitor.js`에 `loadState()`/`getState()` 추가
   - `botService.js` start() 시 마지막 세션에서 peakEquity 복원하여 `riskEngine.drawdownMonitor.loadState()` 호출
   - 테스트: 서버 재시작 후 peakEquity가 보존되는지 검증

2. **R8-T3-2 (Trailing Stop)**:
   - `strategyBase.js`에 공통 trailing stop 로직 구현
   - 추세 전략 6개 (`TurtleBreakoutStrategy`, `SupertrendStrategy`, `MaTrendStrategy`, `MacdDivergenceStrategy`, `RsiPivotStrategy`, `SwingStructureStrategy`)에 `trailingEnabled: true` 적용
   - 횡보/스캘핑 전략은 `trailingEnabled: false` 유지
   - 기존 `_checkTpSl()` 중복 코드를 base 클래스에 위임하도록 리팩토링
   - **주의**: `onFill()` 시 trailing state 초기화 필수 (highWaterMark 리셋)

3. **R8-T3-1 (멀티포지션)**:
   - `backtestEngine.js`의 `_position` -> `_positions` Map 전환
   - `maxConcurrentPositions` 메타데이터 참조하여 포지션 수 제한
   - FIFO 청산 로직 구현
   - 포지션별 funding 추적 분리
   - **주의**: 기존 maxConcurrentPositions=1 전략의 백테스트 결과가 변경되지 않아야 함 (회귀 방지)

4. **R8-T3-4 (Sortino Ratio)**:
   - `backtestMetrics.js`의 computeMetrics()에 Sortino + Calmar 추가
   - Sharpe 계산에서 이미 생성된 `periodReturns`, `meanReturn` 재활용
   - 반환 객체에 `sortinoRatio`, `calmarRatio` 추가

### UI 에이전트에게

5. **R8-T3-5 (데드 코드 삭제)**:
   - `StrategyPanel.tsx`, `ClientGate.tsx` 삭제
   - 삭제 전 git log로 해당 파일의 유용한 패턴이 있는지 확인 (커밋 히스토리에서 복원 가능)

6. **R8-T3-6 (EquityCurveChart 공통 추출)**:
   - 공통 props: `data`, `dataKey`, `height`, `formatTooltip`, `color`
   - `EquityCurveChart.tsx`를 기반으로 범용화
   - `BacktestEquityCurve.tsx`와 `PerformanceTabs.tsx`에서 공통 컴포넌트 사용

7. **R8-T3-7 (th scope="col")**:
   - 모든 `<th>` 태그에 `scope="col"` 또는 `scope="row"` 추가

8. **R8-T3-8 (TOOLTIP_STYLE 통일)**:
   - `DailyPerformance.tsx`, `StrategyPerformance.tsx`, `SymbolPerformance.tsx`에서 로컬 `TOOLTIP_STYLE` 삭제
   - `import { CHART_TOOLTIP_STYLE } from '@/lib/chart-config'`로 교체
   - `contentStyle={TOOLTIP_STYLE}` → `contentStyle={CHART_TOOLTIP_STYLE}`

---

## 추가 제안 (Scope 외, 향후 참고)

### Trailing Stop + 백테스트 연동
R8-T3-2 구현 후, 백테스트 엔진이 trailing stop을 정확히 시뮬레이션할 수 있도록 `backtestEngine.js`의 `_processSignal()`이 전략의 trailing state를 반영해야 한다. 현재 백테스트는 전략의 `onTick()` → `_checkTpSl()` 흐름을 그대로 타므로, 전략 내부에 trailing 로직이 있으면 자동으로 백테스트에도 반영된다. 별도 작업 불필요.

### Sortino Ratio 프론트엔드 표시
R8-T3-4 구현 후, 백테스트 결과 페이지에 Sortino와 Calmar 지표를 표시해야 한다. 이는 FE에서 백테스트 결과 카드에 2개 필드를 추가하는 간단한 작업.
