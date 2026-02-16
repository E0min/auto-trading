# Round 10 Cross-Review — Senior Quant Trader

**Reviewer**: Senior Quant Trader
**Date**: 2026-02-17
**Reviewed**: Engineer 제안서 + UI/UX 제안서

---

## 1. R8-T3-2: Trailing Stop 구현

### Engineer 제안 평가: ⚠️ 조건부 동의

Engineer의 제안은 구조적으로 건전하다. StrategyBase에 opt-in 방식의 공통 trailing stop 인프라를 넣고, 전략 metadata에서 설정을 선언하는 패턴은 올바른 방향이다. 특히 다음이 좋다:

- `_trailingStopEnabled = false` 기본값 (기존 동작 100% 보존)
- `activationPercent` 개념 (수익 확보 후 trailing 시작)
- `AdaptiveRegimeStrategy`의 자체 trailing과의 충돌 방지 (`enabled: false`)
- try-catch 기반 fail-safe (trailing 실패 시 포지션 유지)

**보완 필요 사항**:

1. **trailPercent vs ATR-based trailing 선택지 필요**: Engineer가 `trailAtrMultiplier: null`을 넣긴 했지만, 이를 실제로 구현하는 경로가 불명확하다. 추세 전략(Turtle, Supertrend, MaTrend)은 **ATR 기반** trailing이 퍼센트 기반보다 우수하다. 이유: 변동성이 큰 시장에서 퍼센트 기반은 너무 빠르게 트리거되고, 조용한 시장에서는 너무 느리다. ATR은 현재 변동성에 자동 적응한다. 제안:
   - `trailMode: 'percent' | 'atr'` 필드를 metadata에 추가
   - `trailAtrMultiplier`가 설정되면 ATR 모드, 아니면 percent 모드
   - ATR 모드에서는 `_indicatorCache.get(symbol, 'atr', { period })` 활용

2. **전략별 파라미터 세분화**: Engineer가 "18개 전략에 trailing stop 설정 추가"라고 했는데, 내 원제안의 카테고리별 구분을 반영해야 한다:

   | 카테고리 | 전략 | trailing | mode | activation | callback/multiplier |
   |----------|------|----------|------|-----------|---------------------|
   | 추세추종 | Turtle, Supertrend, MaTrend, SwingStructure | **true** | **atr** | '1.5' | atrMultiplier: '1.0' |
   | 모멘텀 | RSIPivot, MacdDivergence | **true** | percent | '1.0' | '0.8' |
   | 횡보 | Grid, Bollinger, Vwap | false | - | - | - |
   | 스캘핑 | QuietRangeScalp | false | - | - | - |
   | 돌파 | Breakout, FibonacciRetracement | **true** | percent | '2.0' | '1.2' |
   | 패턴 | CandlePattern, SupportResistance | false | - | - | - |
   | 적응형 | AdaptiveRegime | false (자체 구현) | - | - | - |
   | 펀딩 | Funding | false | - | - | - |

3. **activation 이전의 고정 SL 유지**: Engineer 제안에서 "activation threshold 통과 여부"를 추적하지만, activation 전에는 기존 고정 SL이 작동해야 한다는 점을 명시적으로 구현해야 한다. 즉:
   - trailing 미활성 상태: 기존 `_checkTpSl()` 고정 SL 그대로 작동
   - trailing 활성 상태: trailing SL이 고정 SL보다 더 타이트하면 trailing SL 사용, 아니면 고정 SL 유지
   - **두 SL 중 더 타이트한 것을 적용** (max(trailingSL, fixedSL) for long)

4. **onFill() super 호출 문서화만으로는 부족**: Engineer가 "서브클래스가 super.onFill()을 호출하도록 문서화"라고 했지만, 현재 18개 전략 중 `onFill()`을 오버라이드하는 전략이 여러 개 있다. 이들이 super.onFill()을 호출하지 않으면 trailing state가 초기화되지 않는다. **방어 코드가 필요하다**: `_notifyFill()` (backtestEngine) 또는 botService의 fill 라우팅에서 StrategyBase의 trailing state를 직접 업데이트하는 경로를 보장할 것.

### UI/UX 제안 평가: ✅ 동의

UI 에이전트가 제안한 FE 영향 분석이 적절하다:
- PositionsTable에 Trailing Stop 활성 여부 Badge ("T") 표시
- `trailingActive`, `trailingCallbackRate`, `trailingHighPrice` 필드를 API 응답에 포함 요청

이 필드들은 BE 구현 시 positions API 응답에 포함시키면 된다. FE는 BE 완료 후 진행하는 것이 맞다.

---

## 2. R8-T3-3: DrawdownMonitor peakEquity 영속성

### Engineer 제안 평가: ✅ 동의 (우수한 분석)

Engineer의 분석은 정확하고 포괄적이다. 특히 다음 발견이 중요하다:

- BotSession.stats.peakEquity와 DrawdownMonitor.peakEquity가 **별개 시스템**으로 독립 추적 중
- 재시작 시 DrawdownMonitor에 피드백 경로가 없음
- `isHalted` 상태도 유실되어 "재시작으로 리스크 보호 우회 가능"

Engineer의 구현 방안에 전면 동의한다:

1. **hydrate/dehydrate 패턴** -- 깔끔하다. `loadState()`와 `getState()`라는 네이밍이 더 명확할 수도 있으나, hydrate/dehydrate도 업계 표준 용어이므로 문제없다.

2. **BotSession.stats 스키마 확장** -- `dailyStartEquity`, `drawdownHalted`, `drawdownHaltReason` 추가. 필요 최소한의 확장이다.

3. **안전 장치** -- "hydrate 시 peakEquity가 현재 equity보다 낮으면 현재 equity를 사용"은 **정확히 올바른 방어 로직**이다. 이유: 서버 다운 중에 대규모 수익이 발생하여 현재 equity가 저장된 peak보다 높을 수 있다. 이때 저장된 peak을 쓰면 이후 정상 하락도 drawdown으로 잘못 인식할 수 있다.

**추가 제안 1개**:

- **dailyResetTime 영속화**: Engineer가 `dailyStartEquity`는 영속화하지만 `dailyResetTime`은 언급하지 않았다. 서버가 23:50에 재시작되면 dailyResetTime이 null이 되어 23:50 equity가 새 dailyStartEquity가 된다. 그러나 10분 후 자정(00:00)에 daily reset이 발생하므로 실제 영향은 미미하다. 따라서 이 부분은 nice-to-have이며 필수는 아니다.

### UI/UX 제안 평가: ✅ 동의

"FE 영향 없음" 판단이 정확하다. 순수 BE 내부 로직이다.

---

## 3. R8-T3-1: 백테스트 멀티포지션 지원

### Engineer 제안 평가: ⚠️ 조건부 동의

구조적 변경 방안은 적절하다. `Map<string, Object>` 기반, `_maxConcurrentPositions` 상한, equity 합산 로직 모두 올바르다.

**보완 필요 사항**:

1. **포지션 사이징 정책이 핵심이다**: Engineer가 "포지션 크기 분할 정책을 설정 가능하게"라고 언급했지만, 구체적 기본값을 정하지 않았다. 내 권장:
   - **기본 정책: 가용 현금 기반 비율 유지** -- `_positionSizePct`가 현재 `this._cash` 기준이므로, 첫 포지션 진입 후 남은 cash의 동일 비율로 두 번째 포지션을 잡는다. 이것이 가장 현실적이다.
   - Grid 전략: 각 그리드 레벨에 `totalEquity / gridLevels` 만큼 할당 (균등 분할)
   - Turtle 피라미딩: 기존 포지션의 절반 크기로 추가 진입 (클래식 Turtle 룰)
   - **이 정책은 전략 metadata에 `positionSizingMode: 'remaining_cash' | 'equal_split' | 'half_pyramid'`로 선언**

2. **FIFO vs 전략 지정 청산**: Engineer가 FIFO를 제안했는데, 이것이 대부분의 전략에서 합리적이다. 하지만 Grid 전략은 FIFO가 아니라 **가격 기반 매칭**(가장 가까운 그리드 레벨의 포지션 청산)이 필요하다. 제안:
   - 기본: FIFO (대부분 전략)
   - Grid 전략용: 시그널에 `targetPositionId` 필드를 포함하여 특정 포지션 청산 가능

3. **회귀 방지 테스트 필수**: `maxConcurrentPositions = 1`인 전략들의 백테스트 결과가 변경 전과 **비트 단위로 동일**해야 한다. 이를 위한 검증 방법:
   - 변경 전: 모든 18개 전략 백테스트 결과를 `data/bt_all_results.json`에 저장 (이미 존재)
   - 변경 후: 동일 데이터로 재실행하여 `maxConcurrentPositions=1` 전략들의 metrics가 동일한지 diff
   - **이 테스트를 구현 PR에 반드시 포함할 것**

4. **동시 long+short (hedge) 시나리오**: Engineer가 key를 `'long' | 'short'`로만 설정했는데, 같은 방향의 멀티포지션(피라미딩)은 이 key로 구분할 수 없다. 내 원제안의 `${side}_${entryTime}` 또는 순차 ID가 더 유연하다. 제안: key를 `pos_${autoIncrementId}`로 변경하고, position 객체에 `side` 필드를 포함.

5. **cash 마이너스 방지**: Engineer가 "동시 포지션의 총 노출이 cash를 초과하면 마이너스 cash 발생 가능"이라고 올바르게 지적했다. 이 방지 로직을 `_openLong`/`_openShort`에 **반드시** 추가해야 한다:
   ```javascript
   if (math.isLessThan(this._cash, totalCost)) {
     log.debug('OPEN_LONG skipped — insufficient cash for multi-position');
     return;
   }
   ```
   이것은 이미 단일 포지션에서 `isLessThan(this._cash, '0')` 체크가 있으므로, 자연스럽게 보강된다.

### UI/UX 제안 평가: ✅ 동의

UI 에이전트의 FE 영향 분석이 적절하다:
- ScatterChart 마커 겹침 문제 인지 -- 맞다
- `positionIndex` 식별자 제안 -- 유용하다
- "최대 동시 포지션 수" 메트릭 추가 -- `BacktestStatsPanel`에 좋은 추가다

**추가 FE 메트릭 제안**: 멀티포지션 백테스트에서 다음 지표도 유용하다:
- `avgConcurrentPositions`: 평균 동시 포지션 수
- `maxConcurrentPositionsUsed`: 실제 사용된 최대 동시 포지션 수
- `overlapRatio`: 포지션이 겹친 시간 비율

---

## 4. R8-T3-4: Sortino Ratio 산출

### Engineer 제안 평가: ⚠️ 조건부 동의

Engineer의 Sortino 구현 코드는 대체로 올바르지만, **방법론적으로 한 가지 중요한 수정이 필요하다**.

**문제점: 연율화(annualisation) 방법**

Engineer 코드:
```javascript
const annualisedReturn = multiply(meanReturn, sqrtPeriods);
sortinoRatio = toFixed(divide(annualisedReturn, downsideDeviation), 2);
```

이것은 **분자만 연율화하고 분모(downside deviation)는 연율화하지 않는** 오류이다. Sharpe에서도 동일한 패턴을 쓰고 있지만, 수학적으로 이 방식은 다음과 동치이다:

```
Sortino = (meanReturn / downsideDeviation) * sqrt(periodsPerYear)
```

이는 실제로 **올바른 연율화 공식**이다 (분자와 분모를 각각 연율화하면 sqrt가 상쇄되어 같은 결과). 따라서 Engineer의 코드는 수학적으로 올바르다. 나의 우려를 철회한다.

**그러나 다음은 수정 필요**:

1. **`meanReturn` 스코프 문제**: Engineer가 올바르게 지적했듯이, 현재 `meanReturn`은 Sharpe의 `if (periodReturns.length > 0)` 블록 안에서 선언된다 (L258). Sortino가 이 변수를 참조하려면 스코프를 바깥으로 끌어올려야 한다. 이것은 **반드시 처리해야 하는 실질적 버그**다.

2. **edge case 처리 보완**: Engineer의 코드에서:
   - `downsideCount > 0`이지만 `downsideDeviation`이 0인 경우: `isZero(downsideDeviation)` 체크로 처리됨 -- OK
   - `downsideCount === 0` (모든 수익률 양수): `'999.99'` 반환 -- OK, Sharpe와 일관
   - **빠진 케이스**: `meanReturn`이 음수이고 downside deviation이 0인 경우 `'0.00'`이 아니라 **부정적 Sortino**를 반환해야 한다. 하지만 이 케이스는 현실적으로 불가능(모든 수익이 양수인데 평균이 음수일 수 없음)이므로 무시 가능.

3. **내 원제안의 Calmar Ratio 추가**: 1줄로 구현 가능하다. Engineer 제안에는 Calmar가 빠져있다. 추가를 강력 권장한다:
   ```javascript
   const calmarRatio = !isZero(maxDrawdownPercent)
     ? toFixed(divide(totalReturn, maxDrawdownPercent), 2)
     : '0.00';
   ```
   Calmar는 트레이더가 가장 직관적으로 이해하는 지표(연환산 수익률 / 최대 낙폭)이며, 이미 `totalReturn`과 `maxDrawdownPercent`가 계산되어 있어 추가 비용이 거의 0이다.

4. **zero-trades edge case**: `computeMetrics()`의 "no trades" 분기 (L96-117)에 `sortinoRatio: '0.00'`과 `calmarRatio: '0.00'`도 추가해야 한다.

### UI/UX 제안 평가: ✅ 동의

- `BacktestStatsPanel`에 Sortino를 Sharpe 옆에 배치 -- 적절하다
- `metrics.sortinoRatio` 필드만 있으면 즉시 반영 가능 -- 맞다
- **추가**: Calmar Ratio도 같은 위치에 배치할 것. Sharpe | Sortino | Calmar 3개를 한 행에 나란히.

---

## 5. R8-T3-5: 데드 코드 삭제

### Engineer + UI/UX 공통 평가: ✅ 동의

두 에이전트 모두 `StrategyPanel.tsx`(297줄)와 `ClientGate.tsx`(22줄) 삭제가 안전하다고 확인했다. grep 결과 import 0건. 동의한다.

Engineer가 `StrategyListItem` 타입의 다른 사용처 확인을 요청했는데, 이것은 삭제 전 확인하면 좋은 방어적 조치다. 다만 TypeScript에서 해당 타입이 다른 파일에서 import되지 않는다면 삭제해도 안전하다.

---

## 6. R8-T3-6: EquityCurveChart 공통 추출

### UI/UX 제안 평가: ✅ 동의

UI 에이전트의 설계안이 깔끔하다:
- `EquityCurveConfig` 인터페이스 + `DASHBOARD_EQUITY_CONFIG` / `BACKTEST_EQUITY_CONFIG` 상수 분리
- `EquityCurveBase` 공통 컴포넌트 + 기존 파일을 얇은 래퍼로 유지 (하위 호환)

트레이딩 관점에서 이 통합은 향후 다음 기능을 한 곳에서 추가할 수 있게 해준다:
- Drawdown 영역 음영 표시
- 최대 낙폭 구간 하이라이트
- 전략 교체 시점 수직선
- Benchmark(BTC 가격) 오버레이

---

## 7. R8-T3-7: th scope="col" 일괄 추가

### UI/UX 제안 평가: ✅ 동의

기계적 일괄 변환. 88개 `<th>` 태그에 `scope="col"` 추가. 사이드이펙트 없음. 비용 대비 접근성 향상 효과가 확실하다.

---

## 8. R8-T3-8: TOOLTIP_STYLE 통일

### UI/UX 제안 평가: ✅ 동의

`CHART_TOOLTIP_STYLE`(borderRadius 8px, fontSize 12px)을 표준으로 채택하고, 3개 로컬 TOOLTIP_STYLE + 1개 인라인을 교체. CoinScoreboard의 `border-subtle` -> `border-muted` 통일 포함.

차이가 미미하고(2px borderRadius, 1px fontSize) 통일의 이점이 더 크다.

---

## 구현 순서에 대한 의견

### Engineer 제안 순서:
```
Phase 1: R8-T3-3 (peakEquity) + R8-T3-4 (Sortino)
Phase 2: R8-T3-2 (Trailing Stop) + R8-T3-1 (멀티포지션)
Phase 3: FE 정리 (T3-5, T3-8, T3-7, T3-6)
```

### 내 의견: ✅ 동의 (Phase 1 최우선은 정확한 판단)

Phase 1에서 R8-T3-3을 최우선으로 잡은 것은 올바르다. **리스크 보호 구멍을 먼저 막는 것이 원칙이다.** R8-T3-4(Sortino)도 Phase 1에 넣어 빠르게 처리하는 것이 효율적이다 (30분이면 끝남).

Phase 2에서 R8-T3-2(Trailing Stop)를 R8-T3-1(멀티포지션) 앞에 두는 것도 맞다. Trailing stop은 실전 수익에 즉시 영향을 미치는 반면, 멀티포지션은 백테스트 정확도 개선이므로 즉각적 수익 영향은 간접적이다.

**한 가지 조정 제안**: R8-T3-1(멀티포지션)이 3~4시간으로 가장 큰 작업이므로, FE 정리(Phase 3)를 Phase 2와 병렬로 진행하면 전체 소요 시간을 줄일 수 있다. FE 작업은 BE와 완전히 독립적이다.

---

## 요약 합의 테이블

| ID | 항목 | 판정 | 핵심 사유/조건 |
|----|------|------|---------------|
| R8-T3-3 | peakEquity 영속성 | ✅ 동의 | Engineer 방안 그대로 진행. hydrate 시 방어 로직 포함. |
| R8-T3-2 | Trailing Stop | ⚠️ 조건부 | ATR 모드 추가, 전략별 세분화, activation 전 고정 SL 유지, onFill() 호출 보장 |
| R8-T3-1 | 멀티포지션 백테스트 | ⚠️ 조건부 | 포지션 사이징 정책 명확화, key를 autoIncrement ID로, 회귀 테스트 필수, cash 마이너스 방지 |
| R8-T3-4 | Sortino Ratio | ⚠️ 조건부 | meanReturn 스코프 수정, Calmar Ratio 동시 추가, zero-trades edge case |
| R8-T3-5 | 데드 코드 삭제 | ✅ 동의 | 안전 확인 완료 |
| R8-T3-6 | EquityCurveChart 추출 | ✅ 동의 | UI 에이전트 설계안 채택 |
| R8-T3-7 | th scope="col" | ✅ 동의 | 기계적 변환 |
| R8-T3-8 | TOOLTIP_STYLE 통일 | ✅ 동의 | CHART_TOOLTIP_STYLE 기준 통일 |
