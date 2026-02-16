# Round 8 Proposal — 코드베이스 재분석 및 새 개선과제 발굴

> Author: Senior Quant Trader Agent
> Date: 2026-02-16
> Base commit: 8253c75 (대시보드 레이아웃 개선)
> Previous: Round 7 완료 (삼중 보호 체계 + 유예기간), 81/89 done (91%)

---

## 분석 요약

Round 1~7에서 기본 인프라, 리스크 관리, 레짐 안정화까지 완료되었다. 이번 라운드에서는 코드베이스를 처음부터 재분석하여 **실거래 수익률에 직접 영향을 주는** 새로운 개선과제를 발굴했다. 총 **19개 발견 사항**을 도출했으며, CRITICAL 3건, HIGH 6건, MEDIUM 7건, LOW 3건으로 분류했다.

핵심 발견:
1. **StrategyRouter가 전략당 단일 심볼만 할당** — 10개 코인을 선정해도 모든 전략이 `symbols[0]` 하나에만 활성화되어 나머지 9개 코인의 매매 기회를 100% 상실
2. **mathUtils의 parseFloat 기반 연산이 큰 금액에서 정밀도 손실** — `multiply('99999999.12345678', '99999.9999')` 같은 연산에서 IEEE-754 부동소수점 오류 발생
3. **백테스트 엔진이 단일 포지션만 지원** — 실거래에서는 전략별 독립 포지션이 가능하나 백테스트는 1개 뿐
4. **PositionManager가 전략 메타데이터(strategy)를 추적하지 않음** — 어떤 전략이 어떤 포지션을 열었는지 알 수 없어 전략별 리스크 제어 불가
5. **Trailing Stop이 백테스트에서만 작동하고 라이브에서는 미구현** — 수익 극대화 기회 상실

---

## 발견 사항

### CRITICAL-1: StrategyRouter 단일 심볼 할당 — 매매 기회 90% 손실

**파일**: `backend/src/services/strategyRouter.js` (line 161)
**코드**:
```javascript
// T0-3 Phase 1: 1 symbol per strategy to prevent internal state contamination
const symbol = this._symbols[0];
if (symbol) {
  strategy.activate(symbol, this._category);
}
```

**문제**: `coinSelector`가 7-factor 스코어링으로 10개 코인을 신중히 선정하지만, `strategyRouter`가 모든 전략을 `symbols[0]`(항상 BTCUSDT)에만 할당한다. 나머지 9개 코인은 마켓 데이터를 구독해 대역폭을 소모하면서도 실제 매매에 사용되지 않는다.

**영향**: 기대수익 기회의 ~90% 상실. 멀티전략 포트폴리오의 분산 효과 완전 소멸.

**근거**: `botService.js` line 208-210에서 `coinSelector.selectCoins()`가 10개 심볼을 선정하고, line 211에서 `marketData.subscribeSymbols()`로 전부 구독하지만, `strategyRouter._routeStrategies()`에서 `symbols[0]`만 사용.

**제안**:
- Phase 2 멀티심볼 라우팅 구현: 전략별 최적 심볼 매칭 (전략 메타데이터의 `preferredPairs`, 레짐별 적합도, 코인 스코어 기반)
- 전략 내부 상태 격리: 심볼별 독립 상태 관리 (klineHistory, indicators 등을 `Map<symbol, state>`로 변경)
- 단계적 접근: 먼저 전략당 1심볼이되 전략마다 다른 심볼 배정 (라운드 로빈 or 스코어 기반)

**구현 난이도**: HIGH (전략 내부 상태 분리 필요)
**예상 시간**: 8~12시간
**예상 영향**: 매매 기회 5~10배 증가, 포트폴리오 분산으로 Sharpe ratio 개선

---

### CRITICAL-2: mathUtils의 parseFloat 정밀도 한계

**파일**: `backend/src/utils/mathUtils.js` (전체)
**코드**:
```javascript
function multiply(a, b) {
  const precision = inferPrecision(a, b);
  return (parse(a) * parse(b)).toFixed(precision);
}
```

**문제**: 모든 산술 연산이 `parseFloat()`을 사용한다. JavaScript의 `Number`는 IEEE-754 64비트 부동소수점이며, 유효 숫자가 약 15~17자리로 제한된다. 현재 시스템은 "String 기반"이라고 표방하지만 내부적으로는 `parseFloat`로 변환하여 연산하고 다시 `toFixed`로 문자열로 바꾼다.

**실제 오류 시나리오**:
1. `add('0.1', '0.2')` → 내부적으로 `0.30000000000000004.toFixed(2)` = `'0.30'` (OK, toFixed가 보정)
2. `multiply('99999999.12345678', '99999.9999')` → 유효 숫자 초과로 하위 자릿수 손실
3. 레버리지 + 큰 포지션에서 수수료/PnL 누적 오차 → 장시간 운영 시 실제 수익과 추적값 diverge

**deferred T3-4 재평가**: `decimal.js` 마이그레이션이 이전에 deferred되었으나, 실거래 전환 시 반드시 필요.

**제안**:
- 단기: 핵심 경로(PnL 계산, 수수료, ExposureGuard 비교)에 대해 `BigInt` 기반 fixed-point 연산 적용 (가볍고 빠름)
- 중기: `decimal.js` 또는 `big.js` 마이그레이션 (API 호환 래퍼 작성)
- 하위 호환: `mathUtils` 인터페이스 유지, 내부 구현만 교체

**구현 난이도**: MEDIUM (인터페이스 불변, 내부만 교체)
**예상 시간**: 4~6시간
**예상 영향**: 대규모 거래에서 PnL 추적 정확도 보장, 장기 운영 안정성

---

### CRITICAL-3: PositionManager에 전략 메타데이터 누락

**파일**: `backend/src/services/positionManager.js` (line 421-441)
**코드**:
```javascript
_parsePositionEntry(raw) {
  return {
    symbol,
    posSide,
    qty: String(raw.total || raw.holdAmount || ...),
    entryPrice: String(raw.openPriceAvg || ...),
    markPrice: String(raw.markPrice || ...),
    unrealizedPnl: String(raw.unrealizedPL || ...),
    leverage: String(raw.leverage || '1'),
    marginMode: raw.marginMode || 'crossed',
    liquidationPrice: String(raw.liquidationPrice || ...),
    updatedAt: new Date(),
    // *** strategy 필드 없음! ***
  };
}
```

**문제**: 라이브 `PositionManager`의 포지션 데이터에 `strategy` 필드가 없다. 거래소 REST/WS 응답에는 전략 정보가 없으므로 당연하지만, 이로 인해:
1. `signalFilter.updatePositionCount(strategy, count)`가 전략별 포지션 수를 정확히 세지 못함
2. `botService._closeStrategyPositions(strategyName)`가 라이브 모드에서 전략별 필터링 불가
3. ExposureGuard가 전략별 노출 한도를 적용할 수 없음

**근거**: `paperPositionManager.js`는 `strategy` 필드를 가지고 있어 정상 작동하지만, 실거래 `positionManager.js`는 거래소 데이터만 사용하므로 전략 정보가 없다.

**제안**:
- OrderManager에서 주문 제출 시 `orderId → strategy` 매핑을 메모리 Map에 저장
- PositionManager에서 WS position update 수신 시 orderId/symbol:posSide로 매핑을 역조회하여 `strategy` 필드 주입
- Trade 모델의 `strategy` 필드와 연계하여 DB 기반 폴백 조회

**구현 난이도**: MEDIUM
**예상 시간**: 3~4시간
**예상 영향**: 실거래에서 전략별 포지션 관리, 전략 비활성화 시 자동 청산 정확도

---

### HIGH-1: Trailing Stop 라이브 모드 미구현

**파일**: 전략들의 `_checkExitOnTick()` 메서드 (예: `TurtleBreakoutStrategy`, `SwingStructureStrategy`)
**코드**: Turtle 전략에는 trailing stop 로직이 존재하지만, 이는 전략 내부의 소프트웨어 SL이다.

**문제**: PaperEngine에는 exchange-side SL 시뮬레이션(`registerStopLoss`, `_checkStopLossTriggers`)이 구현되어 있지만, **trailing stop**은 어디에도 구현되어 있지 않다. 전략들이 `onTick`에서 매 틱마다 TP/SL을 확인하지만:
1. 봇 프로세스 장애 시 trailing stop이 작동하지 않음
2. 네트워크 지연으로 ticker가 늦게 도착하면 최적 청산 시점을 놓침
3. 수익이 나는 포지션을 끝까지 추적하지 못하고 고정 TP로 조기 청산

**제안**:
- PaperEngine에 trailing stop trigger 추가 (`registerTrailingStop({ symbol, posSide, activationPrice, trailDistance, qty })`)
- 라이브 모드: Bitget 거래소의 trailing stop order API 활용 (지원 여부 확인 필요)
- 전략에서 `stopLossPrice` 외에 `trailingStopConfig` 필드를 signal에 추가

**구현 난이도**: MEDIUM
**예상 시간**: 4~5시간
**예상 영향**: 추세 추종 전략(Turtle, Supertrend, MaTrend)의 수익률 15~30% 개선 가능

---

### HIGH-2: 백테스트 엔진 — 단일 포지션 제한

**파일**: `backend/src/backtest/backtestEngine.js` (line 514)
**코드**:
```javascript
_openLong(kline) {
  if (this._position !== null) {
    log.debug('OPEN_LONG skipped — already in position', { ... });
    return;
  }
  // ...
}
```

**문제**: 백테스트 엔진이 `this._position` 하나만 유지하여 동시에 하나의 포지션만 가능하다. 실거래에서는:
- 전략이 여러 심볼에 동시 포지션 보유 가능 (CRITICAL-1 해결 후)
- 같은 심볼에 long/short 동시 포지션 가능 (hedge mode)
- 전략당 `maxConcurrentPositions`가 2~3인 전략이 다수

이 제한으로 백테스트 결과가 실거래와 크게 괴리된다.

**제안**:
- `this._position`을 `Map<string, object>` (key: `${symbol}:${side}`)로 변경
- `maxConcurrentPositions` 메타데이터를 백테스트에서도 존중
- 멀티심볼 백테스트: 여러 심볼의 kline을 시간 순으로 병합하여 시뮬레이션

**구현 난이도**: HIGH
**예상 시간**: 6~8시간
**예상 영향**: 백테스트 현실성 대폭 개선, Grid/RsiPivot 등 멀티포지션 전략 정확도 향상

---

### HIGH-3: 코인 재선정 메커니즘 부재

**파일**: `backend/src/services/botService.js`
**코드**: `start()` 메서드의 step 6에서 `coinSelector.selectCoins()`를 한 번만 호출

**문제**: 봇 시작 시 한 번 코인을 선정하면, 이후 시장 상황이 변해도 동일한 코인으로만 매매한다. 24시간 이상 운영 시:
1. 초기 선정된 코인의 유동성/변동성이 크게 변할 수 있음
2. 새로운 고수익 기회 코인이 등장해도 반영 불가
3. 선정된 코인이 상장폐지/유동성 고갈될 수 있음

**제안**:
- 주기적 코인 재선정 (4~8시간 간격)
- 재선정 시 기존 포지션이 열린 코인은 유지, 새 코인 추가/비활성 코인 제거
- `strategyRouter.updateSymbols()`와 연계하여 안전한 심볼 교체
- 레짐 변경 시에도 재선정 트리거

**구현 난이도**: MEDIUM
**예상 시간**: 3~4시간
**예상 영향**: 장시간 운영 시 기회 포착 능력 유지

---

### HIGH-4: 펀딩비 비용이 PnL에 미반영

**파일**: `backend/src/services/orderManager.js`, `backend/src/backtest/backtestEngine.js`

**문제**: 선물 거래에서 펀딩비(funding fee)는 8시간마다 자동 정산되는 실제 비용이다. 현재:
1. `FundingDataService`가 펀딩 레이트 데이터를 수집하고 전략에 전달하지만, 이는 진입 판단 참고용
2. 포지션 보유 시 실제 발생하는 펀딩비를 PnL 계산에 반영하지 않음
3. 백테스트에서도 펀딩비가 빠져 있어, 롱-바이어스 전략의 수익이 과대평가됨

**시나리오**: BTCUSDT 롱 포지션 $10,000, 펀딩비 +0.01% (8h) → 연간 ~10.95% 비용. 이것이 PnL에서 빠지면 수익률이 크게 왜곡됨.

**제안**:
- 백테스트: kline 데이터에 펀딩비 적용 (8시간마다 `equity -= positionValue * fundingRate`)
- 라이브: WS account update에서 펀딩비 차감을 감지하여 Trade 레코드에 기록
- 성과 분석에 "총 펀딩비" 메트릭 추가

**구현 난이도**: MEDIUM
**예상 시간**: 4~5시간
**예상 영향**: PnL 정확도 개선, 특히 장기 보유 전략의 과대평가 방지

---

### HIGH-5: RiskEngine의 reduceOnly 주문에 대한 불필요한 검증

**파일**: `backend/src/services/riskEngine.js` (line 95)
**코드**:
```javascript
validateOrder(order) {
  // Step 0: Equity guard
  if (!this.accountState.equity || this.accountState.equity === '0') {
    return { approved: false, rejectReason: 'equity_not_initialized' };
  }
  // Step 1: Circuit Breaker
  // Step 2: Drawdown Monitor
  // Step 3: Exposure Guard
  // ...
}
```

**문제**: `reduceOnly` (청산) 주문도 전체 리스크 체인을 통과해야 한다. 이로 인해:
1. Circuit Breaker가 tripped 상태에서 SL 주문이 거부됨 → 손실 확대
2. Drawdown halt 상태에서 기존 포지션 청산이 불가 → 손실이 더 커질 수 있음
3. ExposureGuard가 청산 주문의 qty를 줄임 → 부분 청산으로 리스크 노출 지속

**제안**:
- `reduceOnly: true`인 주문은 Step 1(CircuitBreaker), Step 2(DrawdownMonitor)를 bypass
- ExposureGuard의 position size 체크도 bypass (청산은 노출을 줄이는 것이므로)
- 이미 signal에 `reduceOnly` 필드가 있으므로 `order.reduceOnly`를 체크하면 됨

**구현 난이도**: LOW
**예상 시간**: 1~2시간
**예상 영향**: 리스크 관리 정합성 대폭 개선, SL 실행 보장

---

### HIGH-6: 레버리지 관리 미흡 — 전략별 레버리지 불일치

**파일**: `backend/src/services/orderManager.js` (line 366-380)
**코드**:
```javascript
// AD-36: Set leverage per-signal with cache
if (signal.leverage && !actionMapping.reduceOnly) {
  const cachedLev = this._leverageCache.get(symbol);
  if (cachedLev !== String(signal.leverage)) {
    try {
      await this.exchangeClient.setLeverage({ symbol, category, leverage: signal.leverage });
      this._leverageCache.set(symbol, String(signal.leverage));
    } catch (err) { /* continue with current */ }
  }
}
```

**문제**: 레버리지가 심볼 단위로 설정되므로, 같은 심볼에 다른 전략이 다른 레버리지를 요구하면 충돌한다. 예:
- RsiPivot: leverage 3x on ETHUSDT
- Supertrend: leverage 5x on ETHUSDT
- 나중에 실행된 전략의 레버리지가 적용됨 → 이전 전략의 포지션 사이징이 의도와 다름

현재는 CRITICAL-1 때문에 모든 전략이 같은 심볼을 쓰므로 이 문제가 잠재적이지만, 멀티심볼 해결 시 표면화됨.

**제안**:
- 전략간 같은 심볼 사용 시 더 보수적인(낮은) 레버리지 적용
- 포지션 사이징을 레버리지 고려하여 조정 (notional / leverage = required margin)
- 전략 메타데이터의 `leverage` 값을 ExposureGuard에서 반영

**구현 난이도**: MEDIUM
**예상 시간**: 3~4시간
**예상 영향**: 실거래에서 의도치 않은 레버리지 노출 방지

---

### MEDIUM-1: 백테스트 Sortino Ratio 미산출

**파일**: `backend/src/backtest/backtestMetrics.js`

**문제**: Sharpe ratio만 산출하고 Sortino ratio가 없다. Sortino는 하방 변동성만 고려하므로 트레이딩 전략 평가에 더 적합하다.

**제안**: `computeMetrics`에 Sortino ratio 추가 (downside deviation 기반)

**구현 난이도**: LOW
**예상 시간**: 1시간
**예상 영향**: 전략 평가 정확도 향상

---

### MEDIUM-2: SignalFilter 쿨다운이 CLOSE 신호에도 적용

**파일**: `backend/src/services/signalFilter.js` (line 182-197)
**코드**:
```javascript
_checkCooldown(strategy, now) {
  const cooldownMs = meta ? meta.cooldownMs : DEFAULT_COOLDOWN_MS;
  const lastTime = this._lastSignalTime.get(strategy) || 0;
  const elapsed = now - lastTime;
  if (elapsed < cooldownMs) {
    return { passed: false, reason: `cooldown: ...` };
  }
  return { passed: true, reason: null };
}
```

**문제**: 쿨다운 체크가 `action`을 구분하지 않아 CLOSE 신호도 차단될 수 있다. OPEN 직후 조건이 급변하여 즉시 SL이 필요한 경우, 쿨다운이 이를 차단한다.

**제안**: CLOSE/reduceOnly 신호는 쿨다운 체크를 bypass

**구현 난이도**: LOW
**예상 시간**: 30분
**예상 영향**: SL/TP 신호의 즉시 실행 보장

---

### MEDIUM-3: 전략 warm-up 기간 동안의 거짓 신호

**파일**: 모든 전략의 `onKline()` 메서드

**문제**: 전략이 활성화된 직후 충분한 히스토리 데이터가 쌓이기 전에 지표가 불안정하다. 현재 대부분의 전략이 "최소 N개 캔들" 체크를 하지만, 이는 지표 계산 가능 여부만 확인할 뿐 지표의 안정성(warm-up)을 보장하지 않는다.

**예**: EMA-50을 사용하는 전략이 50개 캔들이 되면 신호를 생성하지만, 처음 50개 캔들로 계산된 EMA는 안정화되지 않은 값이다. 최소 2~3배(100~150개)는 필요하다.

**제안**:
- 전략 메타데이터에 `warmupCandles` 필드 추가 (기본값: 가장 긴 지표 기간 x 2)
- IndicatorCache에서 히스토리 길이가 `warmupCandles` 미만이면 null 반환
- 백테스트에서도 warm-up 기간의 신호 무시

**구현 난이도**: LOW
**예상 시간**: 2시간
**예상 영향**: 초기 거짓 신호 제거, 승률 개선

---

### MEDIUM-4: CoinSelector의 F7(volMomentum)이 F1(volume)과 동일

**파일**: `backend/src/services/coinSelector.js` (line 341-342)
**코드**:
```javascript
// F7: Volume Momentum (same as volume — percentile rank will differentiate)
factorArrays.volMomentum.push(c.vol24h);
```

**문제**: 7-factor 스코어링의 7번째 팩터(Volume Momentum)가 1번째 팩터(Volume)와 완전히 동일한 값(`vol24h`)을 사용한다. 주석에도 명시되어 있다. 이는 사실상 6-factor 시스템이며, 볼륨에 이중 가중치를 부여하는 것과 같다.

**제안**:
- F7을 실제 "Volume Momentum"으로 교체: `vol24h / vol24h_7d_avg` (최근 거래량이 7일 평균 대비 얼마나 높은지)
- 또는 F7을 "Open Interest Change"로 교체: OI의 24시간 변화율 (스마트 머니 흐름 추적)

**구현 난이도**: MEDIUM (데이터 소스 추가 필요)
**예상 시간**: 3시간
**예상 영향**: 코인 선정 품질 개선, 유동성 급증 코인 조기 포착

---

### MEDIUM-5: 백테스트에서 마켓 임팩트 미반영

**파일**: `backend/src/backtest/backtestEngine.js`

**문제**: 현재 슬리피지가 고정 비율(0.05%)로 적용된다. 실제로는:
1. 작은 알트코인은 호가 스프레드가 훨씬 넓음 (0.5~2%)
2. 큰 주문은 오더북을 먹으며 추가 슬리피지 발생
3. 변동성이 높을 때 슬리피지가 평상시 대비 5~10배

**제안**:
- 심볼별 스프레드 데이터를 백테스트 입력으로 받아 동적 슬리피지 적용
- 주문 사이즈에 비례하는 마켓 임팩트 모델 추가 (sqrt model)
- 변동성 기반 슬리피지 보정: `slippage = base_slippage * (1 + atr_percentile)`

**구현 난이도**: MEDIUM
**예상 시간**: 3~4시간
**예상 영향**: 백테스트 현실성 개선, 특히 알트코인 전략 과대평가 방지

---

### MEDIUM-6: DrawdownMonitor의 peakEquity가 재시작 시 초기화

**파일**: `backend/src/services/drawdownMonitor.js` (constructor)
**코드**:
```javascript
this.peakEquity = '0';
this.currentEquity = '0';
this.dailyStartEquity = '0';
```

**문제**: 봇 재시작 시 `peakEquity`가 0으로 초기화되어, 이전 세션에서의 최고 equity 기록이 사라진다. 예를 들어 $10,000에서 시작하여 $12,000까지 올렸다가 $11,000에서 봇을 재시작하면, peakEquity가 $11,000으로 설정되어 이전 $12,000에서의 drawdown이 무시된다.

**제안**:
- BotSession 모델에 `lastPeakEquity` 필드 추가
- 봇 시작 시 이전 세션의 peakEquity를 로드하여 DrawdownMonitor에 주입
- 또는 별도의 MongoDB 컬렉션에 peakEquity 영구 저장

**구현 난이도**: LOW
**예상 시간**: 1~2시간
**예상 영향**: 재시작 후 drawdown 추적 연속성 보장

---

### MEDIUM-7: 전략간 상관관계 분석 부재

**파일**: 시스템 전체

**문제**: 18개 전략이 동시 운영되지만, 전략간 상관관계를 측정하거나 관리하는 메커니즘이 없다. 높은 상관관계의 전략이 동시에 같은 방향 포지션을 열면 포트폴리오 리스크가 증폭된다.

**예**: RsiPivot, BollingerReversion, VwapReversion은 모두 평균 회귀 전략으로, RANGING 레짐에서 동시에 롱 신호를 생성할 가능성이 높다. 이 경우 효과적으로 3x 배로 노출된다.

**제안**:
- 전략별 최근 신호 방향을 추적하는 "CorrelationMonitor" 서비스 추가
- 같은 방향 신호가 N개 이상 동시 발생 시 ExposureGuard에서 총 노출 한도 강화
- 백테스트 결과에 전략간 상관 행렬(correlation matrix) 추가

**구현 난이도**: HIGH
**예상 시간**: 6~8시간
**예상 영향**: 포트폴리오 리스크 관리 강화, 극단적 손실 방지

---

### LOW-1: BotService.resume()이 StrategyRouter를 우회

**파일**: `backend/src/services/botService.js` (line 670-705)
**코드**:
```javascript
async resume() {
  for (const strategy of this.strategies) {
    for (const symbol of this._selectedSymbols) {
      strategy.activate(symbol, category);
    }
  }
  this._running = true;
}
```

**문제**: `resume()`이 모든 전략을 모든 심볼에 활성화한다. 이는:
1. StrategyRouter의 레짐 기반 활성화/비활성화를 무시
2. 레짐에 맞지 않는 전략도 활성화됨
3. 유예기간 중이던 전략도 즉시 재활성화

**제안**: `resume()` 시 `strategyRouter.refresh()`를 호출하여 현재 레짐에 맞는 전략만 활성화

**구현 난이도**: LOW
**예상 시간**: 30분

---

### LOW-2: ExposureGuard의 position markPrice 미업데이트

**파일**: `backend/src/services/exposureGuard.js` (line 148-153)
**코드**:
```javascript
for (const pos of accountState.positions) {
  const posValue = abs(multiply(pos.qty, pos.markPrice));
  totalExistingExposure = add(totalExistingExposure, posValue);
}
```

**문제**: `pos.markPrice`가 마지막 REST 동기화 시점의 값이다. WS로 실시간 가격이 업데이트되어도 `riskEngine.updateAccountState`가 positions를 갱신하기 전까지 stale한 markPrice로 총 노출을 계산한다.

**제안**: ExposureGuard에서 tickerAggregator의 최신 가격을 참조하여 markPrice를 보정

**구현 난이도**: LOW
**예상 시간**: 1시간

---

### LOW-3: 백테스트 결과에 MAE/MFE 미포함

**파일**: `backend/src/backtest/backtestMetrics.js`

**문제**: MAE(Maximum Adverse Excursion)와 MFE(Maximum Favorable Excursion)가 없다. 이 지표들은 각 거래가 최대 얼마나 역행했고/순행했는지를 보여주어 SL/TP 최적화에 필수적이다.

**제안**: 백테스트 엔진에서 포지션 보유 중 `highestPrice`/`lowestPrice`를 추적하여 MAE/MFE 계산

**구현 난이도**: LOW
**예상 시간**: 2시간

---

## Deferred 항목 재평가

### T3-4: decimal.js 마이그레이션 — **실거래 전 필수 (CRITICAL-2 관련)**
- 판정: **Round 8에서 착수 필수**
- 이유: CRITICAL-2에서 분석한 대로 parseFloat 기반 연산이 실거래에서 정밀도 문제 유발
- 방안: `big.js` (가볍고 API 단순) 또는 `decimal.js` (기능 풍부)

### T3-10: InstrumentCache 심볼별 lot step — **실거래 전 필수**
- 판정: **Round 8에서 착수 필수**
- 이유: 현재 `floorToStep(qty, '0.0001')` 하드코딩. BTC는 `0.001`, DOGE는 `1` 등 심볼마다 다름
- 불일치 시 거래소 API 거부(insufficient qty/invalid qty)로 주문 실패

### T3-15: positionSide 전체 리팩토링 — **deferred 유지**
- 판정: 현재 작동하므로 실거래 후 우선순위 재평가
- 리스크: 13개 전략 동시 수정은 regression 위험 높음

### R7 이관 — 동적 히스테리시스 decay — **deferred 유지**
- 판정: 현재 고정 값(10 캔들)이 충분히 안정적
- 실거래 후 레짐 전환 빈도 모니터링 후 재결정

### R7 이관 — 백테스트 레짐 시뮬레이션 — **MEDIUM 우선순위**
- 판정: 실거래 전 "nice to have", 실거래 후 "should have"
- 현재 백테스트가 고정 레짐으로만 작동하여 레짐 변경 영향 미반영

### R7 이관 — Soft routing — **deferred 유지**
- 판정: CRITICAL-1 해결이 선행 과제

---

## 제안 사항 (우선순위별 스프린트 구성)

### Sprint R8 — 실거래 필수 + 수익률 직결 (추정 38~52시간)

| ID | 제목 | 우선순위 | 난이도 | 시간 | 담당 |
|----|------|---------|--------|------|------|
| R8-C1 | StrategyRouter 멀티심볼 라우팅 | CRITICAL | HIGH | 8~12h | Engineer |
| R8-C2 | mathUtils decimal.js 마이그레이션 (T3-4) | CRITICAL | MEDIUM | 4~6h | Engineer |
| R8-C3 | PositionManager 전략 메타데이터 주입 | CRITICAL | MEDIUM | 3~4h | Engineer |
| R8-H1 | Trailing Stop 구현 (PaperEngine + 전략) | HIGH | MEDIUM | 4~5h | Engineer |
| R8-H5 | RiskEngine reduceOnly bypass | HIGH | LOW | 1~2h | Engineer |
| R8-M2 | SignalFilter CLOSE 쿨다운 bypass | MEDIUM | LOW | 0.5h | Engineer |
| R8-H3 | 코인 재선정 주기 | HIGH | MEDIUM | 3~4h | Engineer |
| R8-T3-10 | InstrumentCache lot step (T3-10) | HIGH | MEDIUM | 3~4h | Engineer |
| R8-H4 | 펀딩비 PnL 반영 | HIGH | MEDIUM | 4~5h | Engineer |
| R8-M3 | 전략 warm-up 기간 | MEDIUM | LOW | 2h | Engineer |
| R8-M6 | DrawdownMonitor peakEquity 영속성 | MEDIUM | LOW | 1~2h | Engineer |
| R8-L1 | BotService.resume() StrategyRouter 연동 | LOW | LOW | 0.5h | Engineer |

### Phase 2 — 백테스트 품질 + 분석 (별도 스프린트)

| ID | 제목 | 우선순위 | 난이도 | 시간 |
|----|------|---------|--------|------|
| R8-H2 | 백테스트 멀티포지션 지원 | HIGH | HIGH | 6~8h |
| R8-M1 | Sortino Ratio 산출 | MEDIUM | LOW | 1h |
| R8-M4 | CoinSelector F7 실질화 | MEDIUM | MEDIUM | 3h |
| R8-M5 | 백테스트 동적 슬리피지 | MEDIUM | MEDIUM | 3~4h |
| R8-M7 | 전략간 상관관계 모니터 | MEDIUM | HIGH | 6~8h |
| R8-L2 | ExposureGuard markPrice 실시간화 | LOW | LOW | 1h |
| R8-L3 | 백테스트 MAE/MFE 지표 | LOW | LOW | 2h |

---

## 다른 에이전트에게 요청 사항

### Engineer에게
1. **R8-C1 (멀티심볼 라우팅)**: 전략의 내부 상태를 심볼별로 격리하는 아키텍처 설계 필요. `StrategyBase`에 `_stateBySymbol: Map<string, StrategyState>` 패턴 도입 검토
2. **R8-C2 (decimal.js)**: `mathUtils.js`의 인터페이스(함수 시그니처)를 변경하지 않고 내부 구현만 교체하는 방안 설계. 모든 기존 테스트가 통과해야 함
3. **R8-C3 (PositionManager 전략 매핑)**: `orderId → strategy` 매핑의 메모리 관리 전략 (Map 크기 제한, TTL 등)
4. **R8-T3-10 (InstrumentCache)**: Bitget REST API에서 `symbol info`를 조회하여 `minTradeNum`, `pricePlace`, `volumePlace` 등을 캐싱하는 서비스 설계
5. **R8-H5 (reduceOnly bypass)**: `riskEngine.validateOrder`에 `{ reduceOnly: true }` 체크를 추가하되, 로깅은 유지하여 감사 추적 가능하게

### UI에게
1. **R8-C1 관련**: 전략별 활성 심볼을 대시보드에 표시 (현재는 모든 전략이 같은 심볼이라 의미 없었음)
2. **R8-M7 관련**: 전략간 상관 행렬 시각화 히트맵 (향후)
3. **R8-H4 관련**: PnL 표시에 "펀딩비 차감 전/후" 구분 추가
4. **R8-M1 관련**: 백테스트 결과 패널에 Sortino Ratio 표시

---

## 종합 평가

| 영역 | 현재 점수 | R8 후 예상 점수 | 비고 |
|------|-----------|----------------|------|
| 전략 매매 로직 | 7.5/10 | 8.0/10 | warm-up, trailing stop 추가 |
| 리스크 관리 | 7.0/10 | 8.5/10 | reduceOnly bypass, 전략별 포지션 추적 |
| 포지션 사이징 | 6.5/10 | 8.0/10 | lot step, 레버리지 관리 |
| 백테스트 현실성 | 6.0/10 | 7.5/10 | 멀티포지션, 동적 슬리피지, 펀딩비 |
| 멀티전략 포트폴리오 | 3.0/10 | 7.0/10 | 멀티심볼 라우팅이 핵심 |
| 주문 실행 품질 | 7.0/10 | 8.0/10 | trailing stop, lot step |
| **종합** | **6.2/10** | **7.8/10** | |

R8에서 가장 큰 수익률 임팩트는 **CRITICAL-1 (멀티심볼 라우팅)**이다. 현재 시스템은 10개 코인을 선정하면서 1개에서만 매매하는 것으로, 이는 구조적으로 수익 기회를 90% 낭비하는 것이다. 이 하나의 개선만으로도 기대수익이 3~5배 증가할 수 있다.
