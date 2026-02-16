# Round 12 제안서 — Senior Quant Trader

> 생성일: 2026-02-17
> 분석 유형: 코드베이스 재분석 (Round 3)
> 분석 파일 수: 20+ 핵심 파일
> 기준: R1~R11 완료 항목 제외, 신규 발견만 포함

---

## 분석 요약

R11까지의 구현으로 핵심 인프라(트레일링 스탑, Sortino/Calmar, 다중 포지션, 펀딩 비용 시뮬레이션, 워밍업, 유예기간 등)가 안정적으로 갖춰졌다. 이번 Round 3 재분석에서는 **전략 코드 일관성**, **백테스트와 라이브의 동작 괴리**, **리스크 계산의 레버리지 미반영**, **포지션 사이징의 정교함 부족** 등 실제 실전 운용 시 수익률과 리스크에 직접적으로 영향을 미치는 이슈들을 집중 발굴했다.

핵심 발견:
1. **이중 트레일링 스탑 충돌** — MaTrend, AdaptiveRegime이 자체 구현 + StrategyBase 메타데이터 양쪽 모두 활성화
2. **14개 전략의 close 시그널에 `reduceOnly` 미설정** — SignalFilter 우회는 action 기반으로 동작하지만 일관성 결여
3. **백테스트 엔진의 레버리지 미반영** — 포지션 사이징에서 레버리지가 적용되지 않아 라이브와 수익률 차이 발생
4. **ExposureGuard의 레버리지 미반영** — 노출도 계산에서 레버리지 미고려로 실제 리스크 과소평가
5. **전략 간 상관관계 추적 부재** — 동일 방향 시그널 동시 발생 시 집중 리스크 증가

---

## 발견 사항

### F12-1: 이중 트레일링 스탑 충돌 (심각도: HIGH)

**파일**: `backend/src/strategies/indicator-light/maTrendStrategy.js` (L42, L74, L152-177)
**파일**: `backend/src/strategies/indicator-heavy/adaptiveRegimeStrategy.js` (L49, L685)
**파일**: `backend/src/services/strategyBase.js` (L106-131, L429-438)

MaTrendStrategy는 두 곳에서 트레일링 스탑을 정의한다:
- `static metadata.trailingStop = { enabled: true, activationPercent: '1.5', callbackPercent: '1.0' }` (L42) → StrategyBase가 읽어서 자동 처리
- 자체 `_trailingStopPercent = '2'` (L74) + 자체 `onTick()` 로직 (L152-177) → 독립 처리

이 두 로직은 각각 독립적으로 close 시그널을 발생시킨다:
- StrategyBase 트레일링: 1.5% 수익 도달 후 1.0% 콜백 시 발동 (activation→callback 2단계)
- 자체 트레일링: 진입 이후 최고가에서 2.0% 하락 시 즉시 발동 (단순 비율)

**문제**: 두 트레일링이 동시에 활성화되면 먼저 닿는 쪽이 close 시그널을 생성하고, 이후 다른 쪽도 close 시그널을 생성한다. 첫 close 후 포지션이 없는 상태에서 두 번째 close가 발생하면 **고아 주문**(orphan order)이 되거나 OrderManager에서 에러가 발생한다.

AdaptiveRegimeStrategy도 동일한 패턴: metadata에 `trailingStop.enabled: true` (L49) + 자체 ATR 기반 TP/SL 로직.

**영향**: 비정상 이중 청산 시도, 오류 로그 발생, 전략 상태 불일치.

---

### F12-2: 14개 전략의 close 시그널에 `reduceOnly` 미설정 (심각도: MEDIUM)

**파일**: 17개 전략 중 14개 (maTrend, adaptiveRegime, grid 제외)

Grep 분석 결과, `CLOSE_LONG`/`CLOSE_SHORT` 시그널을 생성하는 17개 전략 중 `reduceOnly: true`를 시그널에 포함하는 전략은 3개뿐:
- `maTrendStrategy.js` (L675) — `_emitExit()`에서 설정
- `adaptiveRegimeStrategy.js` (L685) — `_emitExit()`에서 설정
- `gridStrategy.js` (L491, L606, L624) — 직접 설정

나머지 14개 전략은 `reduceOnly`를 시그널에 포함하지 않는다.

**완화 요소**:
1. `orderManager.js` L52-56의 `ACTION_MAP`이 `CLOSE_LONG/SHORT`을 항상 `reduceOnly: true`로 매핑하므로, 거래소 주문 자체는 정상 처리됨
2. `signalFilter.js` L136이 `action.startsWith('close')` 체크로 필터 우회를 허용하므로 필터링도 정상

**그러나**: `botService.js` L487에서 `trade.reduceOnly`를 확인하여 포지션 매핑을 정리하므로, 시그널 수준의 일관성이 코드 가독성과 디버깅에 중요하다.

**해당 전략 목록**:
- price-action/: TurtleBreakout, CandlePattern, SupportResistance, SwingStructure, FibonacciRetracement
- indicator-light/: RsiPivot, Supertrend, Bollinger, Vwap, MacdDivergence, Funding
- indicator-heavy/: Breakout, QuietRangeScalp

---

### F12-3: 백테스트 엔진의 레버리지 미반영 (심각도: HIGH)

**파일**: `backend/src/backtest/backtestEngine.js` (L584-596)

```javascript
// Position value: metadata-based % of available (remaining) cash (T2-3)
const positionValue = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));
// Quantity
const qty = math.divide(positionValue, fillPrice);
```

포지션 사이징에서 **레버리지가 전혀 고려되지 않는다**. 실제 라이브 거래에서 3x 레버리지를 사용하면 동일 자본으로 3배의 포지션을 열 수 있지만, 백테스트에서는 1x로만 계산된다.

**영향**:
- 백테스트 수익률이 라이브 대비 과소 추정 (레버리지 수익 효과 미반영)
- 백테스트 낙폭이 라이브 대비 과소 추정 (레버리지 손실 확대 미반영)
- 전략 파라미터 최적화 결과가 라이브에 직접 적용 불가
- MaTrendStrategy는 `leverage: '3'`을 시그널에 포함 (L335) 하지만, 백테스트에서 무시됨

---

### F12-4: ExposureGuard의 레버리지 미반영 (심각도: HIGH)

**파일**: `backend/src/services/exposureGuard.js` (L120-155)

```javascript
// ---- 1. Single-position size check ----
const orderValue = multiply(qty, effectivePrice);
const positionSizePercent = multiply(divide(orderValue, equity), '100');
```

ExposureGuard는 `qty * price`로 주문 가치를 계산하는데, 이것은 **마진 기반 계산이 아닌 명목(notional) 가치** 계산이다. 그러나 실제 USDT 선물에서 3x 레버리지를 사용하면:
- 마진 소요: `qty * price / leverage`
- 명목 노출: `qty * price`

현재 `maxPositionSizePercent = 5%`는 "자기 자본의 5%까지 한 포지션"인데, 이것이 명목 기준인지 마진 기준인지 모호하다. 레버리지가 3x이면 명목 기준 5%는 마진 기준 1.67%에 불과하여, 실제보다 보수적으로 작동한다. 반면 `maxTotalExposurePercent = 30%`도 명목 기준이라 3x에서는 마진 10%만 사용 가능.

**영향**: 리스크 한도 해석의 모호성, 레버리지 변경 시 의도치 않은 포지션 크기 변화.

---

### F12-5: 전략 간 상관관계 추적 부재 (심각도: MEDIUM)

**파일**: `backend/src/services/signalFilter.js`, `backend/src/services/botService.js`

현재 `signalFilter.js`는 `symbolConflictFilter`로 동일 심볼에 대한 동시 시그널만 차단하지만, **다른 심볼에서 같은 방향**으로 동시 진입하는 것은 허용한다. 예를 들어:
- MaTrend가 BTCUSDT OPEN_LONG 시그널 생성
- Supertrend가 ETHUSDT OPEN_LONG 시그널 생성
- RSIPivot이 SOLUSDT OPEN_LONG 시그널 생성

모두 다른 심볼이므로 충돌 없이 통과하지만, BTC-ETH-SOL은 상관계수가 높아서 사실상 **동일 방향 3x 노출**이 된다. ExposureGuard의 `maxTotalExposurePercent`가 명목 기준으로만 제한하므로, 상관 리스크는 전혀 관리되지 않는다.

**영향**: 시장 급락 시 모든 롱 포지션이 동시에 손실, 포트폴리오 분산 효과 없음.

---

### F12-6: 백테스트 단일 심볼 한정 (심각도: MEDIUM)

**파일**: `backend/src/backtest/backtestEngine.js` (constructor)

```javascript
this.symbol = params.symbol;
```

백테스트 엔진은 단일 심볼만 테스트 가능. 라이브에서는 coinSelector가 3~5개 심볼을 선정하고 전략이 각각에 배정되는 **포트폴리오 모드**로 운용되지만, 백테스트에서는 이를 재현할 수 없다.

**영향**:
- 전략 간 상호작용(자본 경쟁, 동시 포지션) 테스트 불가
- 포트폴리오 수준의 Sharpe, Sortino, MaxDrawdown 측정 불가
- coinSelector의 효과를 검증할 수 없음

---

### F12-7: PaperEngine의 제한적 SL/TP 시뮬레이션 (심각도: MEDIUM)

**파일**: `backend/src/services/paperEngine.js`

PaperEngine은 `takeProfitPrice`, `stopLossPrice`를 주문 생성 시 받아서 가격 도달 시 트리거하는데, 전략이 `getSignal()`에서 직접 SL/TP 체크를 수행하는 경우(대부분의 전략)와 **이중으로** 트리거된다.

예: RsiPivotStrategy는 `_checkExitOnTick()`에서 TP/SL 가격에 도달하면 CLOSE 시그널을 생성한다. 동시에 PaperEngine도 동일 TP/SL 가격에서 트리거를 시도한다. 어느 쪽이 먼저 실행되는지에 따라 결과가 달라질 수 있다.

**영향**: 페이퍼 트레이딩에서 이중 청산 시도, PnL 계산 불일치.

---

### F12-8: Calmar Ratio 연율화 미적용 (심각도: LOW)

**파일**: `backend/src/backtest/backtestMetrics.js` (L310-312)

```javascript
const calmarRatio = !isZero(maxDrawdownPercent)
  ? toFixed(divide(totalReturn, maxDrawdownPercent), 2)
  : '0.00';
```

Calmar Ratio = **연간 수익률** / 최대 낙폭(%). 현재 구현은 `totalReturn / maxDrawdownPercent`인데, `totalReturn`은 전체 백테스트 기간의 총 수익률이지 연율화된 수익률이 아니다. 30일 백테스트에서 10% 수익은 연율 121%이지만, 현재 구현은 10%를 그대로 사용한다.

**영향**: 백테스트 기간에 따라 Calmar Ratio 해석이 달라짐, 짧은 백테스트에서 과소평가.

---

### F12-9: 전략 TP/SL 비율 하드코딩 (심각도: MEDIUM)

**파일**: 다수 전략 파일

대부분의 전략이 TP/SL 비율을 고정값으로 하드코딩:
- MaTrend: TP 4%, SL 2% (risk:reward = 1:2)
- RSIPivot: TP 2%, SL 2% (risk:reward = 1:1)
- Bollinger: SL 4%
- Turtle: ATR 기반 (유일하게 동적)

고정 TP/SL은 **변동성과 무관하게 동일 비율**을 적용하므로:
- 변동성이 낮을 때: TP에 도달하기 어려워 보유 기간 증가
- 변동성이 높을 때: SL이 너무 좁아 잦은 손절

ATR 기반 동적 TP/SL이 Turtle에서만 구현되어 있고, 대부분의 전략은 시장 상황과 무관한 고정 비율을 사용한다.

**영향**: 변동성 레짐 변화에 대한 적응력 저하, 불필요한 손절 증가.

---

### F12-10: DrawdownMonitor의 peakEquity 초기화 문제 (심각도: LOW)

**파일**: `backend/src/services/drawdownMonitor.js`

`loadState()` 없이 시작하면 `peakEquity = '0'`이고, 첫 `_updateEquity()` 호출 시 `equity > peak(0)` 이므로 즉시 peak가 설정된다. 그러나 이 경우 **첫 번째 하락까지 drawdown이 0%**로 유지되므로, 봇 시작 직후의 급락에 대한 방어가 1틱 지연된다.

이는 R10에서 `loadState/getState` (AD-58)로 해결되었으나, 첫 세션(저장된 상태 없음)에서는 여전히 존재한다.

---

### F12-11: CoinSelector 스코어링에 비용 가중 미반영 (심각도: MEDIUM)

**파일**: `backend/src/services/coinSelector.js`

CoinSelector의 7-factor 스코어링에서 **거래 비용**(스프레드, 슬리피지, 펀딩 레이트 방향)이 간접적으로만 반영된다:
- Spread는 inverted로 반영 (좁을수록 높은 점수)
- Funding Rate는 inverted로 반영 (0에 가까울수록 높은 점수)

그러나 실제 비용 기반 필터링이 아닌 상대적 순위만 사용하므로, 모든 후보가 높은 비용이면 가장 낮은 비용인 코인이 선정되더라도 절대적으로는 비용이 높을 수 있다.

---

## 제안 사항

### P12-1: 이중 트레일링 스탑 통합 (우선순위: Tier 0, 난이도: 중, 시간: 2시간)

**대상**: MaTrendStrategy, AdaptiveRegimeStrategy

**방안 A (권장)**: 자체 트레일링 로직을 제거하고 StrategyBase의 메타데이터 기반 트레일링에 통합.
- MaTrend: `defaultConfig.trailingStopPercent`를 삭제, `metadata.trailingStop`의 `callbackPercent`를 `'2.0'`으로 조정
- AdaptiveRegime: 레짐별 ATR 기반 TP/SL은 유지하되, 트레일링 로직은 StrategyBase에 위임
- `onTick()` 내 자체 trailing 관련 코드 제거

**방안 B**: StrategyBase의 메타데이터 트레일링을 비활성화하고 자체 로직만 사용.
- `metadata.trailingStop.enabled = false`로 설정
- 자체 로직이 더 전략 특화되어 있으므로 유지

**권장: 방안 B** — 각 전략의 자체 로직이 해당 전략 특성에 맞게 조정되어 있으므로, StrategyBase의 범용 트레일링을 비활성화하는 것이 더 안전하고 간단함.

| 파일 | 변경 |
|------|------|
| `maTrendStrategy.js` | `metadata.trailingStop.enabled = false` |
| `adaptiveRegimeStrategy.js` | `metadata.trailingStop.enabled = false` |

---

### P12-2: 전략 close 시그널 `reduceOnly` 일괄 추가 (우선순위: Tier 1, 난이도: 하, 시간: 1시간)

**대상**: 14개 전략의 `_emitCloseSignal()`, `_emitClose()`, 직접 시그널 생성 코드

모든 close 시그널에 `reduceOnly: true`를 추가:
- TurtleBreakout: `_emitCloseSignal()` 에 `reduceOnly: true` 추가
- Supertrend: `_emitClose()` 에 `reduceOnly: true` 추가
- RSIPivot: `_checkExitOnTick()` 의 signal 객체에 추가
- Bollinger: `_checkExitOnTick()` 의 signal 객체에 추가
- 나머지 10개 전략: 동일 패턴

이는 기능적 변경은 아니지만(OrderManager ACTION_MAP이 이미 enforcing), 코드 일관성과 디버깅 용이성을 높인다.

---

### P12-3: 백테스트 레버리지 반영 (우선순위: Tier 0, 난이도: 중, 시간: 3시간)

**대상**: `backend/src/backtest/backtestEngine.js`

**변경 내용**:
1. `_createStrategy()` 시 전략 메타데이터 또는 시그널에서 `leverage` 값 추출
2. `_openLong()`/`_openShort()`에서 포지션 크기 계산에 레버리지 적용:
   ```javascript
   const leverage = this._leverage || '1';
   const margin = math.multiply(this._cash, math.divide(this._positionSizePct, '100'));
   const positionValue = math.multiply(margin, leverage);
   const qty = math.divide(positionValue, fillPrice);
   // 현금에서 margin만 차감 (leverage 적용된 notional이 아닌)
   const fee = math.multiply(math.multiply(qty, fillPrice), this.takerFee);
   this._cash = math.subtract(this._cash, math.add(margin, fee));
   ```
3. PnL 계산에서도 leveraged qty 기반으로 손익 반영
4. 강제 청산(liquidation) 시뮬레이션은 이번 범위 외로 제한

**API 변경**: `POST /api/backtest/run` body에 `leverage` 파라미터 추가 (기본값 '1')

---

### P12-4: ExposureGuard 레버리지 인지 (우선순위: Tier 1, 난이도: 중, 시간: 2시간)

**대상**: `backend/src/services/exposureGuard.js`

**변경 내용**:
1. `validate()` 메서드에서 `order.leverage` 파라미터를 받아 마진 기준 계산 지원
2. 두 가지 모드 명확화:
   - `maxPositionSizePercent`: **마진** 기준 (자기 자본의 n%)
   - `maxTotalExposurePercent`: **명목** 기준 유지 (총 포지션 가치)
3. 로그에 레버리지, 마진, 명목 값 모두 출력하여 투명성 확보

---

### P12-5: 전략 간 방향성 집중도 모니터링 (우선순위: Tier 1, 난이도: 중상, 시간: 4시간)

**대상**: `backend/src/services/signalFilter.js` 또는 신규 `directionGuard.js`

**변경 내용**:
1. 현재 열린 포지션들의 방향(long/short)을 추적
2. 새 진입 시그널이 같은 방향이면 **방향 집중도** 체크:
   - 예: 이미 3개 long 포지션이면 추가 long 진입에 경고 또는 차단
   - 설정: `maxDirectionalConcentration` (기본 3)
3. 반대 방향(short)은 헤지로 간주하여 허용
4. RiskEngine의 validateOrder 체인에 추가 또는 SignalFilter에 통합

---

### P12-6: ATR 기반 동적 TP/SL 범용화 (우선순위: Tier 2, 난이도: 중상, 시간: 5시간)

**대상**: `backend/src/services/strategyBase.js`, 각 전략

**변경 내용**:
1. StrategyBase에 `_calculateDynamicTPSL(entryPrice, atr, side)` 헬퍼 추가
2. TP = entry +/- (atr * tpAtrMultiplier), SL = entry -/+ (atr * slAtrMultiplier)
3. 각 전략의 metadata에 `tpAtrMultiplier`, `slAtrMultiplier` 추가 (기본값: TP 2.5, SL 1.5)
4. 기존 고정 TP/SL은 fallback으로 유지
5. IndicatorCache에서 ATR 값을 조회하여 사용

이는 모든 전략의 TP/SL을 변동성 적응형으로 만드는 범용 인프라 변경이다.

---

### P12-7: Calmar Ratio 연율화 (우선순위: Tier 2, 난이도: 하, 시간: 30분)

**대상**: `backend/src/backtest/backtestMetrics.js` (L310-312)

**변경 내용**:
```javascript
// 기간 일수 계산
const durationMs = equityCurve.length >= 2
  ? Number(equityCurve[equityCurve.length - 1].ts) - Number(equityCurve[0].ts)
  : 0;
const durationDays = durationMs / (24 * 60 * 60 * 1000);
const annualizedReturn = durationDays > 0
  ? toFixed(multiply(divide(totalReturn, String(durationDays)), '365'), 2)
  : totalReturn;
const calmarRatio = !isZero(maxDrawdownPercent)
  ? toFixed(divide(annualizedReturn, maxDrawdownPercent), 2)
  : '0.00';
```

---

### P12-8: 백테스트 포트폴리오 모드 (우선순위: Tier 3, 난이도: 상, 시간: 10시간)

**대상**: `backend/src/backtest/backtestEngine.js`, 신규 `backtestPortfolioEngine.js`

라이브 환경의 다중 심볼 + 다중 전략 운용을 재현하는 포트폴리오 백테스트 엔진. 이번 스프린트 범위를 벗어나지만 장기 로드맵에 포함할 것을 제안.

---

### P12-9: CoinSelector 절대 비용 필터 (우선순위: Tier 2, 난이도: 하, 시간: 1시간)

**대상**: `backend/src/services/coinSelector.js`

**변경 내용**:
- Pre-filter에 **절대 비용 기준** 추가: `maxEffectiveCost` (기본 0.15%)
  - Effective Cost = spread + (2 * taker fee) + abs(funding rate * 3)
  - 이 기준 초과 시 후보에서 제외
- 현재 `maxSpread 0.8%`만 있고 종합 비용 필터는 없음

---

## 우선순위 요약

| ID | 이슈 | 심각도 | 우선순위 | 난이도 | 시간 | 담당 |
|----|------|--------|---------|--------|------|------|
| P12-1 | 이중 트레일링 스탑 통합 | HIGH | Tier 0 | 중 | 2h | Backend |
| P12-2 | close 시그널 reduceOnly 일괄 | MEDIUM | Tier 1 | 하 | 1h | Backend |
| P12-3 | 백테스트 레버리지 반영 | HIGH | Tier 0 | 중 | 3h | Backtest |
| P12-4 | ExposureGuard 레버리지 인지 | HIGH | Tier 1 | 중 | 2h | Backend |
| P12-5 | 방향성 집중도 모니터링 | MEDIUM | Tier 1 | 중상 | 4h | Backend |
| P12-6 | ATR 기반 동적 TP/SL | MEDIUM | Tier 2 | 중상 | 5h | Backend |
| P12-7 | Calmar Ratio 연율화 | LOW | Tier 2 | 하 | 0.5h | Backtest |
| P12-8 | 포트폴리오 백테스트 | MEDIUM | Tier 3 | 상 | 10h | Backtest |
| P12-9 | CoinSelector 절대 비용 필터 | MEDIUM | Tier 2 | 하 | 1h | Backend |

---

## 다른 에이전트에게 요청 사항

### Engineer에게
1. **P12-1**: 이중 트레일링 스탑 충돌의 시스템 안정성 영향 분석. StrategyBase와 전략 자체 로직이 동시에 close 시그널을 발생시킬 때 OrderManager의 mutex 처리가 안전한지 확인 필요.
2. **P12-3/P12-4**: 레버리지 반영 시 mathUtils의 정밀도(소수점 8자리)가 충분한지, 극단 레버리지(20x)에서 오버플로우 가능성 확인.
3. **P12-5**: 방향성 집중도를 RiskEngine 체인에 통합할 때의 서브엔진 아키텍처 설계 의견. 새 서브엔진 vs SignalFilter 확장.

### UI/UX에게
1. **P12-3**: 백테스트 실행 UI에 레버리지 선택 옵션 추가 필요 (슬라이더 또는 입력 필드, 범위 1~20x)
2. **P12-4**: 대시보드의 리스크 현황에 "마진 사용률" vs "명목 노출률" 구분 표시 필요
3. **P12-5**: 포지션 목록에 "방향 집중도" 지표 표시 (예: "Long 3/3 ⚠️")
4. **P12-7**: 백테스트 결과 화면에서 Calmar Ratio 옆에 "연율화" 표시 추가
