# Solo Analysis S1 -- Post-R5 종합 트레이딩 품질 분석

**Date**: 2026-02-16
**Author**: Senior Quant Trader Agent
**Scope**: Round 1-5 완료 후 전체 시스템 심층 분석
**Status**: Complete

---

## 1. 분석 주제 및 범위

Round 5까지 Tier 0-3 전체 구현이 완료된 상태에서 아래 7개 영역을 소스 코드 기반으로 심층 분석:

1. **전략 성숙도** -- 19개 전략(18 + TrendlineBreakout)의 실전 준비 수준
2. **리스크 관리** -- RiskEngine + 3개 서브엔진 파라미터 현실성
3. **포지션 사이징** -- 자본 효율성과 안전성
4. **백테스트 신뢰도** -- 슬리피지/수수료 모델, fill 가정
5. **전략 상관관계 & 포트폴리오** -- 멀티전략 동시 운용 시 분산 효과
6. **시장 레짐 & 라우팅** -- MarketRegime 분류 정확도, StrategyRouter 로직
7. **실거래 준비도** -- 실전 투입 전 남은 gap

분석 대상 파일 총 30+개, 약 8,000 라인 직접 Read.

---

## 2. 현재 상태 요약 (코드 레벨)

### 2.1 전략 아키텍처

| 항목 | 상태 |
|------|------|
| 전략 수 | 19 (index.js 등록) + 2 legacy (Momentum, MeanReversion) = 21 |
| StrategyBase 추상화 | 완성 -- 멀티심볼, DI, 레짐 인식, 이벤트 기반 시그널 |
| 등록 패턴 | safeRequire() + strategyRegistry 싱글턴 -- 안전 |
| 공통 진입/청산 패턴 | onKline 진입, onTick TP/SL, onFill 포지션 추적 -- 일관 |
| 자체 지표 vs IndicatorCache | 혼합 (SupertrendStrategy: 자체 계산, RSI/BB/MACD: 캐시) |

### 2.2 리스크 관리 체인

```
Order → RiskEngine.validateOrder()
  → Step 0: equity_not_initialized guard
  → Step 1: CircuitBreaker.check()
  → Step 2: DrawdownMonitor.check()
  → Step 3: ExposureGuard.validateOrder()
→ OrderManager._submitOrderInternal()
```

**DEFAULT_RISK_PARAMS** (`constants.js:94-102`):
- `maxPositionSizePercent`: 5%
- `maxTotalExposurePercent`: 30%
- `maxDailyLossPercent`: 3%
- `maxDrawdownPercent`: 10%
- `maxRiskPerTradePercent`: 2%
- `consecutiveLossLimit`: 5
- `cooldownMinutes`: 30

### 2.3 시그널 파이프라인

```
Strategy.emitSignal() → SignalFilter.filter() → OrderManager.submitOrder()
                              ↓
                        5 filters:
                        1. Cooldown (60s default)
                        2. Duplicate (5s window)
                        3. Max concurrent (2 default)
                        4. Symbol conflict
                        5. Confidence threshold
```

### 2.4 백테스트 엔진

- 단일 심볼, 단일 포지션 시뮬레이션
- 슬리피지: 0.05%, 수수료: maker 0.02%, taker 0.06%
- kline → onKline() → onTick(synthetic) → signal → virtual fill
- 포지션 사이징: 전략 메타데이터 기반 % of cash

---

## 3. 발견 사항 (코드 근거 포함, 심각도별 정렬)

### CRITICAL: 없음

Round 1-5에서 Critical 버그(C1-C5) 전부 수정 완료. 현재 Critical 수준 이슈 없음.

---

### HIGH-1: 백테스트 엔진 -- 단일 포지션 제한으로 그리드/멀티포지션 전략 테스트 불가

**파일**: `backend/src/backtest/backtestEngine.js:513-520`

```js
_openLong(kline) {
    if (this._position !== null) {
      log.debug('OPEN_LONG skipped — already in position', {
        side: this._position.side,
        ts: kline.ts,
      });
      return;
    }
```

- `this._position`은 `null | object` -- 오직 1개 포지션만 관리
- GridStrategy (maxConcurrentPositions: 3) 등 멀티포지션 전략은 백테스트에서 실제 동작과 다르게 작동
- 결과: 그리드 전략 백테스트 결과가 실거래와 괴리 발생 가능

**영향**: 백테스트 결과 신뢰성 저하, 전략 간 비교 왜곡
**난이도**: Medium (포지션 배열/Map으로 변경 + close 로직 수정)

---

### HIGH-2: 전략 포지션 사이징이 suggestedQty에 "퍼센트 문자열"을 전달 -- OrderManager가 이를 무시

**파일**: `backend/src/strategies/indicator-light/SupertrendStrategy.js:793-797`

```js
_calculateQty() {
    return this._positionSizePercent;  // returns '5' (a percentage, not qty)
}
```

**파일**: `backend/src/services/orderManager.js:253-258`

```js
riskResult = this.riskEngine.validateOrder({
    symbol,
    side: actionMapping.side,
    qty,        // This is the signal's qty -- could be '5' (percent) or actual qty
    price: price || '0',
    category,
});
```

- 전략들이 `suggestedQty`에 퍼센트 값(예: '5')을 넣는 경우와 실제 수량을 넣는 경우가 혼재
- OrderManager는 이 값을 그대로 `qty`로 사용
- ExposureGuard는 이 값을 `qty * price`로 계산 (`exposureGuard.js:114`)
- 만약 '5'를 qty로 처리하면: BTC 가격이 100,000일 때 5 BTC = $500,000 -- 자본금 대비 과다

**중요**: 백테스트 엔진(`backtestEngine.js:531`)은 별도 사이징 로직(`_positionSizePct / 100 * cash`)을 사용하므로 문제없음. 하지만 **실거래 경로에서** 전략이 올바른 qty를 계산하지 않으면 ExposureGuard가 조정하겠지만, 원래 의도한 사이즈와 다를 수 있음.

**영향**: 실거래 시 포지션 사이즈 불일치 또는 ExposureGuard에 과도하게 의존
**난이도**: Medium (qty 계산 표준화 레이어 필요 -- BotService 또는 OrderManager에서)

---

### HIGH-3: 레버리지 파라미터가 전략에서 설정되지만 실제 주문에 반영되지 않음

**파일**: 다수 전략 (SupertrendStrategy: `leverage: '5'`, AdaptiveRegime: `trendLeverage: '3'` 등)

시그널에 `leverage` 필드를 포함시키지만:

**파일**: `backend/src/services/orderManager.js:354-363`

```js
const orderParams = {
    category,
    symbol,
    side: actionMapping.side,
    orderType,
    qty: finalQty,
    posSide: actionMapping.posSide,
    clientOid,
    reduceOnly: actionMapping.reduceOnly,
};
// leverage is NOT included in orderParams
```

레버리지는 Bitget에서 심볼별로 한 번 설정하는 것이지 주문마다 설정하는 것이 아님. 현재 코드에는 `exchangeClient.setLeverage()` 호출이 주문 전에 일어나지 않음.

**영향**: 전략마다 다른 레버리지를 의도하지만 실제로는 거래소 기본값 사용
**난이도**: Medium (BotService에서 전략 활성화 시 setLeverage 호출 추가)

---

### HIGH-4: ExposureGuard 가격 미전달 시 effectivePrice = '1' 사용

**파일**: `backend/src/services/exposureGuard.js:85`

```js
const effectivePrice = order.price || '1';
```

시장가 주문 시 `price`가 없으면 `effectivePrice = '1'`로 계산. 이 경우:
- qty=0.01, price='1' → orderValue='0.01' → 거의 0% → 항상 통과
- 실제로는 qty=0.01 BTC × $100,000 = $1,000 노출

**영향**: 시장가 주문의 노출 검증이 사실상 무효화됨
**난이도**: Low (market order 시 lastPrice 주입 로직 추가)

---

### MEDIUM-1: Sharpe Ratio 계산에 parseFloat 사용 -- String 산술 원칙 위반

**파일**: `backend/src/backtest/backtestMetrics.js:42-46`

```js
function sqrt(val) {
  const n = parseFloat(val);
  if (n < 0) return '0.00000000';
  return Math.sqrt(n).toFixed(8);
}
```

- 프로젝트 원칙은 "모든 금전적 값은 String, mathUtils로 산술"
- sqrt 함수에서 parseFloat 사용은 부동소수점 오류 가능 (단 Sharpe 계산에서만 사용)
- 현재 `T3-4 (decimal.js migration)` deferred 상태

**영향**: Sharpe ratio 미세 오차 가능 (실질적 영향 낮음)
**난이도**: Low (decimal.js 도입 시 함께 수정)

---

### MEDIUM-2: MarketRegime EMA-9 계산에 parseFloat 사용

**파일**: `backend/src/services/marketRegime.js:324-337`

```js
_updateEma9(close, period) {
    const closeF = parseFloat(close);
    if (isNaN(closeF)) return;
    // ...
    const k = 2 / (period + 1);
    const prevEma = parseFloat(this._ema9);
    const newEma = closeF * k + prevEma * (1 - k);
    this._ema9 = toFixed(String(newEma), 8);
}
```

또한 `_scoreMultiSmaTrend`(`marketRegime.js:432-436`)에서 전체적으로 parseFloat 기반 비교. 레짐 분류 로직 전반이 float 산술.

**영향**: 레짐 오분류 가능성 (BTC 같은 고가 자산에서 부동소수점 누적 에러)
**난이도**: Medium (6-factor 전체를 String 산술로 전환 필요)

---

### MEDIUM-3: StrategyRouter가 활성화 시 `symbols[0]`만 할당 -- 멀티심볼 미활용

**파일**: `backend/src/services/strategyRouter.js:142-145`

```js
// T0-3 Phase 1: 1 symbol per strategy to prevent internal state contamination
const symbol = this._symbols[0];
if (symbol) {
    strategy.activate(symbol, this._category);
}
```

코드에 명시적으로 "Phase 1" 주석이 있어 의도된 제한이지만:
- CoinSelector가 최대 10개 심볼을 선정하는데, 모든 전략이 1개 심볼에만 활성화
- 나머지 9개 심볼은 사실상 사각지대

**영향**: 수익 기회 대폭 감소 -- CoinSelector의 7-factor 스코어링이 무의미해짐
**난이도**: High (전략별 내부 상태 격리 패턴 설계 필요)

---

### MEDIUM-4: SignalFilter activeSignals 추적이 close 시 정확히 매칭되지 않을 수 있음

**파일**: `backend/src/services/signalFilter.js:340-349`

```js
if (action.startsWith('close_')) {
    const activeSet = this._activeSignals.get(symbol);
    if (activeSet) {
        const matchingOpen = action === 'close_long' ? 'open_long' : 'open_short';
        activeSet.delete(`${strategy}:${matchingOpen}`);
    }
}
```

문제: `strategy A`가 open_long 신호를 보내고, `strategy B`가 동일 심볼에 close_long을 보내면, B의 close가 A의 activeSignal을 삭제하지 못함 (strategy 이름이 다르므로). 이 자체는 올바른 동작이지만, 만약 A의 포지션이 외부에서 청산되면 activeSignals에 stale 엔트리가 남아 이후 다른 전략의 진입을 영구적으로 차단할 수 있음.

**영향**: stale activeSignal로 인한 신호 차단 (bot restart로만 해소)
**난이도**: Low (주기적 cleanup 또는 PositionManager 연동 추가)

---

### MEDIUM-5: CoinSelector 볼륨 모멘텀(F7)이 볼륨(F1)과 동일

**파일**: `backend/src/services/coinSelector.js:341`

```js
// F7: Volume Momentum (same as volume — percentile rank will differentiate)
factorArrays.volMomentum.push(c.vol24h);
```

F7 "Volume Momentum"이 F1 "Volume"과 동일한 값을 사용. 코멘트로 인정하고 있으나, 실질적으로 7-factor가 아닌 6-factor 스코어링. 볼륨 관련 가중치가 이중 부여됨.

**영향**: 볼륨 과대 반영, 유동성 낮은 심볼 과소 선정
**난이도**: Low (볼륨 변화율 또는 OI 변화율로 F7 교체)

---

### MEDIUM-6: 백테스트 엔진 -- 숏 포지션 PnL 회계 비직관적이지만 수학적으로 정확

**파일**: `backend/src/backtest/backtestEngine.js:708-772`

_closeShort에서 short close PnL 계산:
```js
const entryNotional = math.multiply(position.qty, position.entryPrice);
const grossPnl = math.multiply(position.qty, math.subtract(position.entryPrice, fillPrice));
const netProceeds = math.subtract(math.add(entryNotional, grossPnl), closeFee);
this._cash = math.add(this._cash, netProceeds);
```

검증: entry=100, exit=90 (이익), qty=1 → entryNotional=100, grossPnl=10, netProceeds=110-closeFee.
open 시 cash -= 100 + openFee. close 시 cash += 110 - closeFee.
순이익 = 10 - openFee - closeFee. **수학적으로 정확**.

다만 이 패턴은 선물이 아닌 **현물 공매도 회계**에 가까움. 실제 선물에서는 margin만 차감되고 나머지는 유지보증금. 이 차이 때문에 백테스트에서 캐시 사용 효율이 과소평가될 수 있음 (레버리지 미반영).

**영향**: 백테스트가 레버리지를 반영하지 않아 실제보다 보수적인 자본 효율
**난이도**: Medium (margin-based 회계로 전환)

---

### MEDIUM-7: CircuitBreaker의 rapidLossWindow 기본값 5분이 과소

**파일**: `backend/src/services/circuitBreaker.js:33`

```js
rapidLossWindow = 5,    // 5 minutes
rapidLossThreshold = 3, // 3 losses in 5 min
```

암호화폐 시장에서 5분 내 3회 손실은 극히 빠른 빈도. 실제로는:
- 1분봉 전략 3개가 동시 활성화되면 쉽게 트리거
- 너무 빈번한 circuit break → 정상적 회전매매 차단

**영향**: 과도한 서킷 브레이크 발동으로 수익 기회 상실
**난이도**: Low (파라미터 조정: 15-30분 / 5회 권장)

---

### LOW-1: 전략별 지표 계산 이중화

SupertrendStrategy는 자체적으로 ATR, MACD, Volume Oscillator를 O(1) 증분 계산하면서 동시에 IndicatorCache를 사용하지 않음. 반면 RSIPivotStrategy, AdaptiveRegimeStrategy는 IndicatorCache에 의존.

**파일**: `SupertrendStrategy.js:303-335` (자체 ATR), `RsiPivotStrategy.js:169` (캐시 RSI)

**영향**: 동일 지표에 대해 두 가지 계산 경로 → 미세 차이 가능, 메모리 이중 사용
**난이도**: Low (SupertrendStrategy를 IndicatorCache 기반으로 마이그레이션)

---

### LOW-2: 전략 onFill 호출에서 positionSide 조기 설정

다수 전략에서 시그널 생성 시 이미 `this._positionSide`를 설정:

**파일**: `RsiPivotStrategy.js:283-284`

```js
this._positionSide = 'long';
this._entryPrice = close;
```

이것은 시그널 emit 시점이지, 실제 fill 시점이 아님. 만약 시그널이 SignalFilter에서 차단되면 전략 내부 상태는 "포지션 있음"이지만 실제로는 없음. onFill에서 다시 설정하지만, 시그널 차단 시 onFill이 호출되지 않으므로 **상태 불일치** 발생.

**영향**: 시그널 차단 후 전략이 새 진입 시그널을 생성하지 않음 (다음 bot restart까지)
**난이도**: Low (시그널 생성 시 positionSide 설정 제거, onFill에서만 설정)

---

### LOW-3: DrawdownMonitor 일일 리셋이 UTC 자정 기준 -- 한국 시간 불일치

**파일**: `backend/src/services/positionManager.js:362-374`

```js
const utcHour = now.getUTCHours();
if (utcHour === 0 && this._lastResetDate !== todayDate) {
    this.riskEngine.resetDaily();
}
```

UTC 자정 = KST 오전 9시. 이는 Bitget의 펀딩비 결제 시간(UTC 0/8/16)과 일치하므로 적절하지만, 한국 사용자 입장에서 "일일" 손실이 오전 9시부터 리셋되는 것은 직관적이지 않을 수 있음.

**영향**: 사용자 혼란 가능 (기능적 문제 아님)
**난이도**: Low (설정 가능한 리셋 시간으로 변경)

---

## 4. 개선 제안 (우선순위, 난이도, 예상 영향)

### Tier 1: 실거래 투입 전 필수 (HIGH)

| ID | 제안 | 우선순위 | 난이도 | 예상 영향 |
|----|------|----------|--------|-----------|
| S1-1 | **ExposureGuard 시장가 주문 가격 주입** -- OrderManager에서 market order 시 lastPrice를 order.price에 채워서 ExposureGuard에 전달 | HIGH | Low | 시장가 노출 검증 정상화 -- 과다 포지션 방지 |
| S1-2 | **레버리지 설정 메커니즘 구현** -- BotService에서 전략 활성화 시 해당 전략의 leverage 값으로 `exchangeClient.setLeverage(symbol, leverage)` 호출 | HIGH | Medium | 전략 의도대로 레버리지 반영 |
| S1-3 | **qty 표준화 레이어** -- OrderManager 또는 BotService에서 시그널의 `suggestedQty`가 퍼센트인지 실제 수량인지 판별 → 퍼센트이면 `equity * pct / 100 / price`로 변환 | HIGH | Medium | 포지션 사이즈 정확성 확보 |
| S1-4 | **전략 positionSide 조기 설정 제거** -- 시그널 emit 시점이 아닌 onFill에서만 포지션 상태 변경 | HIGH | Low | 시그널 차단 시 상태 불일치 방지 |

### Tier 2: 수익률 향상 (MEDIUM)

| ID | 제안 | 우선순위 | 난이도 | 예상 영향 |
|----|------|----------|--------|-----------|
| S1-5 | **멀티심볼 Phase 2** -- StrategyRouter에서 symbols[0]만이 아닌 N개 심볼 분배. 전략별 심볼 풀 할당 로직 설계 | MEDIUM | High | 수익 기회 10배 확대 (현재 1/10만 활용) |
| S1-6 | **백테스트 멀티포지션 지원** -- BacktestEngine의 `_position` → Map 변환, 그리드/멀티포지션 전략 테스트 가능화 | MEDIUM | Medium | 그리드 전략 백테스트 신뢰도 확보 |
| S1-7 | **CoinSelector F7 교체** -- volMomentum을 "24h 볼륨 변화율" 또는 "OI 변화율"로 교체하여 진정한 7-factor 스코어링 구현 | MEDIUM | Low | 코인 선정 품질 향상 |
| S1-8 | **CircuitBreaker 파라미터 현실화** -- rapidLossWindow: 5분 → 20분, rapidLossThreshold: 3 → 5 | MEDIUM | Low | 과도한 서킷 브레이크 방지 |
| S1-9 | **SignalFilter activeSignals stale 방지** -- PositionManager.POSITION_UPDATED 이벤트를 listen하여 실제 포지션이 없는 심볼의 activeSignals를 정리 | MEDIUM | Low | 장기 운용 시 신호 차단 방지 |
| S1-10 | **백테스트 레버리지/마진 회계** -- 현재 현물 기반 회계를 선물 마진 기반으로 전환하여 자본 효율 현실화 | MEDIUM | Medium | 백테스트 수익률 현실 반영 |

### Tier 3: 품질 개선 (LOW)

| ID | 제안 | 우선순위 | 난이도 | 예상 영향 |
|----|------|----------|--------|-----------|
| S1-11 | SupertrendStrategy IndicatorCache 마이그레이션 | LOW | Low | 코드 일관성, 지표 이중 계산 제거 |
| S1-12 | MarketRegime parseFloat → mathUtils String 산술 전환 | LOW | Medium | 부동소수점 누적 오차 제거 |
| S1-13 | backtestMetrics sqrt → decimal.js 적용 (T3-4 합류) | LOW | Low | Sharpe 계산 정밀도 |
| S1-14 | 일일 리셋 시간 설정 가능화 | LOW | Low | 사용자 편의성 |

---

## 5. 전략 성숙도 상세 평가

### 5.1 전략별 실전 준비 수준

| 전략 | Edge 판단 | TP/SL | 트레일링 | 레짐 인식 | 양방향 | 신뢰도 스코어 | 등급 |
|------|-----------|-------|---------|-----------|--------|--------------|------|
| AdaptiveRegimeStrategy | 높음 -- 레짐별 모드 전환 | ATR기반 동적 | O | O | O | 4/5 | **A** |
| SupertrendStrategy | 높음 -- 3중 확인 | 고정% | X | O | O | 4/5 | **A** |
| TrendlineBreakoutStrategy | 높음 -- 추세선 돌파 | ATR기반 | O | O | O | 4/5 | **A** |
| RsiPivotStrategy | 중간 -- RSI+Pivot 역추세 | 고정% + Pivot | X | O | O | 3.5/5 | **B+** |
| BollingerReversionStrategy | 중간 -- BB 평균회귀 | 고정% | X | O | O | 3/5 | **B** |
| MaTrendStrategy | 중간 -- MA 크로스 | 고정% | X | O | O | 3/5 | **B** |
| MacdDivergenceStrategy | 높음 -- 다이버전스 | ATR기반 | O | O | O | 3.5/5 | **B+** |
| VwapReversionStrategy | 중간 -- VWAP 회귀 | 고정% | X | O | O | 3/5 | **B** |
| GridStrategy | 높음 -- ATR 그리드 | 그리드 구조 | X | O | O (헤지) | 3.5/5 | **B+** |
| FundingRateStrategy | 독특 -- 펀딩비 역발상 | 고정% | X | O | O | 3/5 | **B** |
| BreakoutStrategy | 중간 -- 볼린저 돌파 | 고정% | X | O | O | 3/5 | **B** |
| QuietRangeScalpStrategy | 중간 -- 스캘핑 | 고정% | X | O | O | 3/5 | **B** |
| SwingStructureStrategy | 중간 -- 구조적 추세 | 고정% | X | O | O | 3/5 | **B** |
| TurtleBreakoutStrategy | 기본 -- 채널 돌파 | N-bar exit | X | O | O | 2.5/5 | **B-** |
| CandlePatternStrategy | 기본 -- 패턴 인식 | 고정% | X | O | O | 2.5/5 | **B-** |
| SupportResistanceStrategy | 기본 -- S/R 레벨 | 고정% | X | O | O | 2.5/5 | **B-** |
| FibonacciRetracementStrategy | 기본 -- 피보나치 | 고정% | X | O | O | 2.5/5 | **B-** |

### 5.2 전략 간 상관관계 분석

| 그룹 | 전략들 | 상관성 | 분산 효과 |
|------|--------|--------|-----------|
| 추세추종 | MaTrend, Supertrend, TrendlineBreakout, Turtle | 높음 (같은 방향 진입) | **낮음** |
| 역추세/평균회귀 | RSIPivot, Bollinger, Vwap, QuietRangeScalp | 중간 (오버솔드/오버봇 영역) | **중간** |
| 적응형 | AdaptiveRegime | 독립적 (레짐별 모드 전환) | **높음** |
| 그리드/펀딩 | Grid, FundingRate | 낮음 (서로 다른 매커니즘) | **높음** |
| 구조분석 | SwingStructure, CandlePattern, Fibonacci, S/R | 중간 (유사 가격행동) | **중간** |

**포트폴리오 관점**: 추세추종 그룹 4개가 동시 활성화되면 사실상 같은 방향에 4배 노출. StrategyRouter가 레짐별로 필터링하지만, `TRENDING_UP`에서 MaTrend, Supertrend, TrendlineBreakout이 모두 활성화되어 상관관계가 높은 3개 전략이 동시 신호 가능.

### 5.3 레짐별 전략 분포

```
TRENDING_UP  : Supertrend, MaTrend, TrendlineBreakout, Turtle, RSIPivot,
               Bollinger, Vwap, MACD, Breakout, SwingStructure, Candle,
               S/R, Fibonacci, AdaptiveRegime (14개)

TRENDING_DOWN: 위와 유사 (13-14개)

RANGING      : Grid, RSIPivot, Bollinger, Vwap, QuietRangeScalp,
               Breakout, SwingStructure, AdaptiveRegime (8개)

VOLATILE     : Supertrend, RSIPivot, TrendlineBreakout, MACD,
               FundingRate, Breakout, AdaptiveRegime (7개)

QUIET        : AdaptiveRegime만 활성 (but QUIET에서는 진입 없음)
```

**문제**: TRENDING_UP/DOWN에서 14개 전략이 동시 활성화. SignalFilter의 cooldown(60s)과 maxConcurrent(2)가 과도한 신호를 제어하겠지만, 전체 시스템이 한 방향에 과집중될 위험.

---

## 6. 리스크 관리 심층 평가

### 6.1 DEFAULT_RISK_PARAMS 적정성

| 파라미터 | 현재값 | 권장값 | 근거 |
|----------|--------|--------|------|
| maxPositionSizePercent | 5% | **3-5%** | 적정 -- 하지만 HIGH-2에서 qty 해석 문제로 무효화 가능 |
| maxTotalExposurePercent | 30% | **20-30%** | 적정 -- 19개 전략 동시 운용 시 30%는 합리적 |
| maxDailyLossPercent | 3% | **2-3%** | 적정 -- 암호화폐 변동성 고려 시 3%는 보수적 |
| maxDrawdownPercent | 10% | **8-15%** | 적정 -- 시작 자본 대비 10%는 합리적 |
| maxRiskPerTradePercent | 2% | **1-2%** | 적정 -- 전통적 2% 룰 |
| consecutiveLossLimit | 5 | **5-7** | 적정 |
| cooldownMinutes | 30 | **15-30** | 적정 -- 다소 보수적일 수 있음 |

### 6.2 리스크 체인 누락

1. **상관 노출 제한 없음**: 같은 방향 전략 3개가 동시에 BTCUSDT long을 열면 15% 노출 (각 5%), totalExposure는 총합 30%까지 허용하므로 통과. 하지만 이는 사실상 한 심볼에 3배 집중.
2. **전략 간 포지션 합산 없음**: ExposureGuard는 개별 주문 단위로 검증. 이미 같은 심볼에 다른 전략이 포지션을 보유하고 있는지 확인하지 않음.
3. **일일 거래 횟수 제한 없음**: CircuitBreaker는 손실만 추적. 수수료 누적으로 인한 일일 최대 거래 횟수 제한이 없음.

---

## 7. 백테스트 신뢰도 평가

### 7.1 현실성 점수

| 항목 | 구현 | 현실성 | 비고 |
|------|------|--------|------|
| 슬리피지 | 0.05% 고정 | **중간** | 실제는 유동성/주문 크기에 따라 가변 |
| 수수료 | taker 0.06% | **양호** | Bitget 실제 수수료와 근사 |
| 포지션 사이징 | 메타데이터 기반 % | **양호** | T2-3에서 개선됨 |
| 단일 포지션 제한 | Yes | **제한적** | 그리드 전략 테스트 불가 |
| 레버리지 | 미반영 | **낮음** | 실제보다 보수적 수익률 |
| 펀딩비 | 미반영 | **낮음** | 장기 포지션 시 누적 비용 큼 |
| 유동성 | 무한 가정 | **중간** | 소형 코인에서 괴리 |
| 인디케이터 일관성 | BacktestIndicatorCache | **양호** | 실시간과 동일 computeIndicator 사용 |

**종합 신뢰도**: **65/100** -- 기본 구조는 건전하나 레버리지 미반영과 펀딩비 부재가 가장 큰 gap.

### 7.2 과적합 위험

- 전략 파라미터가 defaultConfig에 하드코딩 → 특정 시장 기간에 과적합 가능
- Walk-forward 검증 메커니즘 없음
- Out-of-sample 테스트 자동화 없음
- 다수 전략이 유사한 지표(RSI, BB, MA) 사용 → 같은 데이터 분포에 과적합 경향

---

## 8. 실거래 준비도 종합 평가

### 8.1 준비 완료 항목 (Green)

- [x] RiskEngine 3중 게이트웨이 (CircuitBreaker, DrawdownMonitor, ExposureGuard)
- [x] OrderManager per-symbol mutex (T0-5)
- [x] Paper trading 경로 분리
- [x] WebSocket 실시간 포지션/계정 동기화
- [x] REST 폴링 기반 reconciliation (30초)
- [x] 일일 리셋 자동화 (UTC 0시)
- [x] Exchange-side SL (presetSL in orderParams)
- [x] Signal filter 5중 검증
- [x] API 인증 미들웨어
- [x] Prometheus 메트릭
- [x] 에러 복구 (safeRequire, try-catch 전반)

### 8.2 실거래 전 필수 해결 (Red)

- [ ] **S1-1**: ExposureGuard 시장가 가격 주입 (HIGH)
- [ ] **S1-2**: 레버리지 설정 메커니즘 (HIGH)
- [ ] **S1-3**: qty 표준화 (HIGH)
- [ ] **S1-4**: 전략 positionSide 조기 설정 제거 (HIGH)

### 8.3 실거래 후 우선 개선 (Yellow)

- [ ] **S1-5**: 멀티심볼 Phase 2
- [ ] **S1-8**: CircuitBreaker 파라미터 조정
- [ ] **S1-9**: SignalFilter stale 정리
- [ ] 상관 노출 제한 메커니즘
- [ ] 펀딩비 백테스트 반영

### 8.4 종합 점수

| 영역 | 점수 | 등급 |
|------|------|------|
| 전략 다양성 | 9/10 | A |
| 전략 로직 품질 | 7/10 | B+ |
| 리스크 관리 | 7/10 | B+ |
| 포지션 사이징 | 5/10 | C+ |
| 주문 실행 | 7/10 | B+ |
| 백테스트 | 6.5/10 | B |
| 시장 레짐 | 8/10 | A- |
| 시그널 필터링 | 8/10 | A- |
| 실거래 준비도 | 6/10 | B- |

**Overall: 7.1/10 (B+)** -- Round 1-5에서 견고한 기반 완성. Tier 1 이슈 4개 해결 시 실거래 투입 가능.

---

## 9. BACKLOG 추가 후보

| ID | 제목 | 유형 | 우선순위 |
|----|------|------|----------|
| S1-BL-1 | ExposureGuard market order price injection | Bug Fix | Tier 1 |
| S1-BL-2 | Leverage management in BotService | Feature | Tier 1 |
| S1-BL-3 | Order qty standardization layer | Feature | Tier 1 |
| S1-BL-4 | Strategy positionSide early-set removal | Bug Fix | Tier 1 |
| S1-BL-5 | Multi-symbol Phase 2 | Feature | Tier 2 |
| S1-BL-6 | BacktestEngine multi-position support | Enhancement | Tier 2 |
| S1-BL-7 | CoinSelector F7 replacement | Enhancement | Tier 2 |
| S1-BL-8 | CircuitBreaker param tuning | Config | Tier 2 |
| S1-BL-9 | SignalFilter stale cleanup | Enhancement | Tier 2 |
| S1-BL-10 | Backtest leverage/margin accounting | Enhancement | Tier 2 |
| S1-BL-11 | Correlated exposure guard | Feature | Tier 2 |
| S1-BL-12 | Funding fee in backtest | Enhancement | Tier 3 |

---

## 10. Engineer/UI 에게 전달 사항

### Engineer (Backend)

1. **S1-1 (가장 빠른 수정)**: `orderManager.js:253`에서 market order 시 `positionManager.getAccountState()`에서 해당 심볼 lastPrice를 조회하여 `order.price`에 주입. 또는 ExposureGuard에서 market order임을 감지하여 tickerAggregator에서 lastPrice 조회.

2. **S1-3 (qty 표준화)**: `BotService._handleSignal()` 또는 `OrderManager._submitOrderInternal()` 초입에 다음 로직 추가:
   ```js
   // If suggestedQty looks like a percentage (< 100 and no decimal beyond 2 places)
   // convert to actual qty: qty = equity * pct / 100 / price
   ```
   전략 시그널에 `qtyType: 'percent' | 'absolute'` 필드를 추가하는 것이 더 명시적.

3. **S1-4 (positionSide)**: 모든 전략에서 시그널 emit 부분의 `this._positionSide = 'long'` 등을 제거하고, `onFill()` 메서드에서만 설정하도록 통일. 백테스트 엔진의 `_notifyFill()`이 이미 이를 호출하므로 백테스트도 정상 동작.

### UI (Frontend)

1. **전략 상태 표시**: 현재 UI에 "전략별 레짐 호환성" 매트릭스 표시 고려 (StrategyRouter.getRegimeBreakdown() 활용)
2. **레버리지 표시**: 전략 설정 패널에 leverage 값 표시 (현재 미반영이므로 구현 후)
3. **백테스트 결과 주의 표시**: "레버리지 미반영, 펀딩비 미반영" disclaimer 추가 권장

---

*End of Solo Analysis S1*
