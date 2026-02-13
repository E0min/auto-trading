# Round 3 Proposal: Tier 1 Reliability (11건) - Senior Quant Trader 분석

> **Agent**: Senior Quant Trader
> **Date**: 2026-02-14
> **Base Commit**: f0489fb (Sprint R2: Tier 0 Safety-Critical 완료)
> **Scope**: 매매 전략 로직, 리스크 엔진, 백테스트 시뮬레이션, 포지션 관리

---

## 분석 요약

Round 2에서 Tier 0 Safety-Critical 9건을 성공적으로 구현하여 기본적인 안전성은 확보되었다. 그러나 현재 코드베이스에는 **백테스트 시뮬레이션의 신뢰성을 근본적으로 훼손하는 결함**이 여전히 존재한다. Tier 1 항목 11건 중 내가 직접 발견하거나 리뷰에서 동의한 5건(T1-1, T1-2, T1-5, T1-6, T1-11)을 중점 분석하되, 나머지 항목에 대해서도 매매 전략/리스크 관점에서 의견을 제시한다.

**핵심 결론**: T1-1(IndicatorCache 주입)과 T1-2(_notifyFill action 필드)는 백테스트 결과를 완전히 무효화하는 결함이므로 **최우선 구현 대상**이다. T1-6(Sharpe 정규화)은 전략 평가 지표를 왜곡하여 잘못된 전략 선택을 유발할 수 있다.

---

## 발견 사항 (코드 레벨 근거 포함)

### T1-1: Backtest IndicatorCache 주입 (CRITICAL)

**현재 상태 분석**:

`backtestEngine.js`의 `_createStrategy()` (line 247-271)에서 전략 인스턴스를 생성하지만, **IndicatorCache를 주입하지 않는다**:

```javascript
// backtestEngine.js:260
const strategy = registry.create(this.strategyName, mergedConfig);
strategy.activate(this.symbol);
// !! setIndicatorCache() 호출이 없음 !!
```

반면 `botService.js`의 `_createStrategies()` (line 858-886)에서는 정상적으로 주입한다:

```javascript
// botService.js:875-876
const strategy = registry.create(name, strategyConfig);
if (this.indicatorCache) {
  strategy.setIndicatorCache(this.indicatorCache);  // <-- 백테스트에는 이것이 없음
}
```

**영향 범위 — 8/18 전략 크래시**:

`_indicatorCache`를 null 체크 없이 직접 호출하는 전략 목록 (크래시 발생):
1. **RsiPivotStrategy** (line 158-159): `c.getHistory(this._symbol)` — TypeError: Cannot read properties of null
2. **GridStrategy** (line 213-214): `c.getHistory(this._symbol)` — 동일
3. **BollingerReversionStrategy** (line 205): `c.getHistory(this._symbol)` — 동일
4. **VwapReversionStrategy** (line 216): `c.getHistory(this._symbol)` — 동일 (단, line 149-150에서 ATR 조회 시 optional chaining 사용)
5. **MacdDivergenceStrategy** (line 230): `c.getHistory(this._symbol)` — 동일
6. **QuietRangeScalpStrategy** (line 145-146): `c.getHistory(this._symbol)` — 동일
7. **AdaptiveRegimeStrategy** (line 230, 239): `c.getHistory(this._symbol)` — 동일
8. **BreakoutStrategy** (line 298): 유일하게 `this._indicatorCache ? ... : null` 가드 있음 — 크래시는 안 하지만 지표 없이 작동하여 **무의미한 결과 생성**

**정상 작동 가능한 전략 (10개)**: 5개 price-action + MaTrendStrategy + SupertrendStrategy + FundingRateStrategy (자체 지표 계산 로직 보유)

**수익률 영향**: 백테스트 가능한 전략이 10개로 제한되면, indicator-based 전략(수익 기여도가 높은 RSI, MACD, Bollinger 등)의 성능을 평가할 수 없어 **전략 포트폴리오 최적화가 불가능**하다. 이는 실제 자금 투입 전 검증 단계의 핵심 기능이 작동하지 않음을 의미한다.

**해결 방안**:

BacktestEngine에 **경량 IndicatorCache 어댑터**를 생성하여 주입해야 한다. 실시간 IndicatorCache는 MarketData의 KLINE_UPDATE 이벤트에 의존하지만, 백테스트에서는 kline을 직접 순차 피드하므로 이벤트 없이 동기적으로 데이터를 적재해야 한다.

```javascript
// 제안: backtestEngine.js 내 _createStrategy() 수정
_createStrategy() {
  const metadata = registry.getMetadata(this.strategyName);
  const defaultConfig = (metadata && metadata.defaultConfig) ? metadata.defaultConfig : {};
  const mergedConfig = { ...defaultConfig, ...this.strategyConfig };

  const strategy = registry.create(this.strategyName, mergedConfig);

  // T1-1: 백테스트용 IndicatorCache 어댑터 주입
  const backtestCache = this._createBacktestIndicatorCache();
  strategy.setIndicatorCache(backtestCache);

  strategy.activate(this.symbol);
  if (this.marketRegime) {
    strategy.setMarketRegime(this.marketRegime);
  }
  return strategy;
}
```

백테스트용 캐시는 두 가지 접근 가능:

**Option A — Lightweight Stub** (권장):
- IndicatorCache와 동일한 인터페이스(`get()`, `getHistory()`) 제공
- 내부적으로 kline 배열을 직접 관리 (MarketData 이벤트 불필요)
- 메인 루프에서 kline 피드 시 `_handleKline()` 직접 호출
- 복잡도: 중간 | 구현 시간: ~1시간

**Option B — Real IndicatorCache with Fake MarketData**:
- 실제 IndicatorCache 인스턴스 생성, EventEmitter를 fake MarketData로 대체
- `start()` 후 매 kline마다 `KLINE_UPDATE` 이벤트 emit
- 복잡도: 낮음 | 구현 시간: ~30분

**나의 권장**: Option A. 백테스트 환경에서 EventEmitter 오버헤드가 불필요하고, 실제 IndicatorCache의 `_handleKline`은 symbol 필드에 의존하는데 백테스트 kline 포맷에는 symbol이 없다(ts/open/high/low/close/volume만 있음). Stub이 더 깨끗하다.

---

### T1-2: Backtest _notifyFill() action 필드 추가 (CRITICAL)

**현재 상태 분석**:

`backtestEngine.js`의 `_notifyFill()` (line 722-730):

```javascript
_notifyFill(side, price) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price });  // !! action 필드 없음 !!
    } catch (err) { ... }
  }
}
```

호출 패턴 (4곳):
- `_openLong` line 395: `this._notifyFill('buy', fillPrice)` — action 없음
- `_openShort` line 458: `this._notifyFill('sell', fillPrice)` — action 없음
- `_closeLong` line 524: `this._notifyFill('sell', fillPrice)` — action 없음
- `_closeShort` line 601: `this._notifyFill('buy', fillPrice)` — action 없음

**전략 측 기대 인터페이스**:

18개 전략 중 16개가 `onFill()`을 구현하며, 대부분이 `fill.action`에 의존:

- **14개 전략**: `fill.action || (fill.signal && fill.signal.action)` 또는 `fill.action || ''` 패턴으로 action을 읽음
- **2개 전략** (MaTrend, Supertrend): 직접 `fill.action === SIGNAL_ACTIONS.OPEN_LONG` 비교

`action`이 `undefined`이면:
1. `fill.action || ''` → 빈 문자열 → **어떤 분기에도 진입하지 못함**
2. 전략 내부의 `_entryPrice`, `_positionSide` 등 포지션 추적 상태가 업데이트되지 않음
3. **결과**: TP/SL 로직이 작동하지 않아 포지션이 영원히 유지되거나, 반대 방향 신호가 발생해도 기존 포지션을 인식하지 못함

**수익률 영향**: 이것은 **백테스트 PnL을 심각하게 왜곡**한다. 전략이 내부적으로 포지션 상태를 추적하지 못하면:
- SL이 작동하지 않아 큰 손실을 방지하지 못함
- TP가 작동하지 않아 수익 실현 시점을 놓침
- 이미 포지션이 있는데 중복 진입 신호를 발생시킬 수 있음 (BacktestEngine이 `_position !== null`로 차단하긴 하지만, 전략 내부 로직과 불일치)

**해결 방안**:

`_notifyFill` 호출부 4곳에 action을 추가:

```javascript
// _openLong (line 395)
this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.OPEN_LONG);

// _openShort (line 458)
this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.OPEN_SHORT);

// _closeLong (line 524)
this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);

// _closeShort (line 601)
this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.CLOSE_SHORT);

// _notifyFill 시그니처 변경
_notifyFill(side, price, action) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price, action });
    } catch (err) {
      log.error('Strategy.onFill error', { side, price, action, error: err.message });
    }
  }
}
```

**구현 난이도**: 매우 낮음 (5줄 수정)
**영향**: 16/18 전략의 백테스트 포지션 추적이 정상화됨

---

### T1-5: SignalFilter.updatePositionCount() 연동 (MEDIUM)

**현재 상태 분석**:

`signalFilter.js`의 `_checkMaxConcurrent()` (line 207-225)는 `this._positionCounts` Map에서 전략별 현재 포지션 수를 조회하여 maxConcurrentPositions 제한을 적용한다:

```javascript
_checkMaxConcurrent(strategy, action) {
  if (action.startsWith('close_')) return { passed: true, reason: null };
  const maxConcurrent = meta ? meta.maxConcurrentPositions : DEFAULT_MAX_CONCURRENT;
  const currentCount = this._positionCounts.get(strategy) || 0;
  if (currentCount >= maxConcurrent) { ... }
}
```

그러나 `updatePositionCount(strategy, count)` (line 99-101)를 실제로 호출하는 곳이 **코드베이스 어디에도 없다**. 검증:

- `botService.js`: `signalFilter.registerStrategy()`만 호출, `updatePositionCount()` 호출 없음
- `orderManager.js`: 주문 체결 시 포지션 카운트 업데이트 연동 없음
- `positionManager.js`: 포지션 변경 이벤트에서 signalFilter 갱신 없음

**결과**: `_positionCounts`는 항상 0이므로 `maxConcurrentPositions` 제한이 **사실상 무효**. 전략이 `maxConcurrentPositions: 1`로 선언해도 무한히 포지션을 열 수 있다.

**수익률 영향**: 이 버그는 과도한 동시 포지션을 허용하여:
- 리스크가 의도된 수준을 초과
- ExposureGuard가 최종 방어선이지만, 전략별 세분화된 제어가 불가능
- 특정 전략이 시장 노이즈에 과도하게 반응하여 과다매매(overtrading) 발생 가능

**해결 방안**:

`botService.js` 또는 `positionManager`에서 포지션 변경 시 signalFilter를 갱신하는 와이어링 추가:

```javascript
// botService.js start() 내부, step 12 근처
// positionManager의 POSITION_UPDATED 이벤트에서 전략별 포지션 수 계산
const onPositionUpdated = (data) => {
  if (!this.signalFilter) return;
  // 전략별 포지션 카운트 집계
  const counts = new Map();
  const positions = this.paperMode && this.paperPositionManager
    ? this.paperPositionManager.getPositions()
    : this.positionManager.getPositions();
  for (const pos of positions) {
    const strategy = pos.strategy || 'unknown';
    counts.set(strategy, (counts.get(strategy) || 0) + 1);
  }
  for (const [strategy, count] of counts) {
    this.signalFilter.updatePositionCount(strategy, count);
  }
  // 포지션이 없는 전략은 0으로 리셋
  for (const s of this.strategies) {
    if (!counts.has(s.name)) {
      this.signalFilter.updatePositionCount(s.name, 0);
    }
  }
};
```

**주의사항**: Paper 모드에서는 `paperPositionManager`의 포지션에 `strategy` 필드가 있는지 확인 필요. 없다면 paperPositionManager 쪽도 strategy 추적을 추가해야 함.

**구현 난이도**: 중간 (이벤트 와이어링 + 포지션에 strategy 필드 보장)

---

### T1-6: Sharpe Ratio 연간화 정규화 (MEDIUM-HIGH)

**현재 상태 분석**:

`backtestMetrics.js` line 205-246의 Sharpe 계산:

```javascript
// Sharpe ratio (annualised, 365 trading days, risk-free = 0)
// ...
// Compute daily returns from equity curve
const dailyReturns = [];
for (let i = 1; i < equityCurve.length; i++) {
  const prevEquity = equityCurve[i - 1].equity;
  const currEquity = equityCurve[i].equity;
  if (!isZero(prevEquity)) {
    const ret = pctChange(prevEquity, currEquity);
    dailyReturns.push(ret);
  }
}
// ...
// Annualise: sharpe = (mean * sqrt(365)) / stdDev
const sqrtDays = sqrt('365');
const annualisedReturn = multiply(meanReturn, sqrtDays);
sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
```

**문제점**:

1. **캔들 간격을 "일간"으로 가정**: `equityCurve`의 각 포인트는 **kline 하나마다** 기록된다 (backtestEngine.js line 649-657의 `_recordEquitySnapshot`은 매 kline마다 호출). 즉 1H 캔들 백테스트에서 equityCurve 포인트 간격은 1시간이다.

2. **sqrt(365) 연간화 계수는 일간 수익률에만 유효**: 1H 캔들이면 하루에 24개 포인트가 있으므로, 연간화 계수는 `sqrt(365 * 24) = sqrt(8760)`이어야 한다. 5m 캔들이면 `sqrt(365 * 24 * 12) = sqrt(105120)`.

3. **현재 결과**: 1H 백테스트에서 Sharpe가 `sqrt(365)/sqrt(8760) = 1/sqrt(24) ≈ 0.204`배 과소평가. 5m에서는 더 심한 왜곡. 반대로 1D 캔들에서는 정확하나, 실제로 1D 백테스트는 거의 사용하지 않음.

   실제 왜곡 방향을 정확히 계산하면:
   - 1H 캔들: 수익률의 평균과 표준편차가 모두 hourly 스케일이지만, `sqrt(365)`로 연간화하면 **실제 annualized 값의 1/sqrt(24)** → Sharpe가 **과소평가**됨 (mean과 stdDev가 같은 비율로 스케일링되므로 Sharpe 자체는 `sqrt(N)` 비례)
   - 정확하게는: hourly Sharpe를 annualize하려면 `sqrt(8760)`을 곱해야 하는데 `sqrt(365)`만 곱하므로 `sqrt(365/8760) = sqrt(1/24)` 배 = 약 20.4%로 축소

4. **전략 선택 왜곡**: 짧은 타임프레임 전략(scalping 계열)의 Sharpe가 체계적으로 과소평가되어, 전략 비교 시 느린 전략이 부당하게 유리해짐.

**해결 방안**:

```javascript
// backtestMetrics.js 수정
function computeMetrics({ trades, equityCurve, initialCapital, interval }) {
  // ...

  // interval → 연간 기간 수 계산
  const periodsPerYear = _getPeriodsPerYear(interval);

  // ...

  // Annualise: sharpe = (meanReturn * sqrt(periodsPerYear)) / stdDev
  if (!isZero(stdDev)) {
    const sqrtPeriods = sqrt(String(periodsPerYear));
    const annualisedReturn = multiply(meanReturn, sqrtPeriods);
    sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
  }
}

/**
 * Convert interval string to number of periods per year.
 * Crypto markets run 24/7/365.
 */
function _getPeriodsPerYear(interval) {
  if (!interval) return 365; // fallback: daily

  const map = {
    '1m':  365 * 24 * 60,     // 525,600
    '3m':  365 * 24 * 20,     // 175,200
    '5m':  365 * 24 * 12,     // 105,120
    '15m': 365 * 24 * 4,      // 35,040
    '30m': 365 * 24 * 2,      // 17,520
    '1H':  365 * 24,           //  8,760
    '4H':  365 * 6,            //  2,190
    '6H':  365 * 4,            //  1,460
    '12H': 365 * 2,            //    730
    '1D':  365,                //    365
    '1W':  52,                 //     52
  };

  return map[interval] || 365;
}
```

**추가 필요 변경**:
- `backtestEngine.js`의 `run()` 반환값에 `interval` 포함 (현재 config에는 있지만 metrics 계산 시 전달 안 됨)
- `backtestRoutes.js`의 `computeMetrics()` 호출에 `interval` 파라미터 추가

**Sortino Ratio 추가 제안**: Sharpe만으로는 하방 리스크를 충분히 반영하지 못한다. 동일한 정규화 로직으로 Sortino ratio도 함께 계산하면 전략 비교가 더 정확해진다.

**구현 난이도**: 낮음-중간 (로직 자체는 간단, interval 파라미터 전달 경로 수정 필요)

---

### T1-11: DrawdownMonitor 수동 리셋 API + UI 리셋 버튼 (MEDIUM)

**현재 상태 분석**:

`drawdownMonitor.js`는 이미 `resetAll(equity)` 메서드 (line 212-221)를 보유:

```javascript
resetAll(equity) {
  this.peakEquity = equity;
  this.currentEquity = equity;
  this.dailyStartEquity = equity;
  this.dailyResetTime = Date.now();
  this.isHalted = false;
  this.haltReason = null;
}
```

`riskEngine.js`는 `resetDaily()` (line 249-251)만 노출하며, `resetAll`은 노출하지 않는다.

`riskRoutes.js`에는 리셋 엔드포인트가 **존재하지 않는다** (GET /events, GET /events/unacknowledged, PUT /events/:id/acknowledge, GET /status 4개만 존재).

**문제 시나리오**:
1. 봇이 `max_drawdown_exceeded`로 halt됨
2. 트레이더가 상황을 분석하고, 봇을 재개하고 싶음
3. 현재는 **서버를 재시작해야만** DrawdownMonitor 상태가 리셋됨
4. 서버 재시작 시 MongoDB 세션, WebSocket 연결, 전략 상태 등 모두 날아감

**해결 방안**:

1. **RiskEngine에 resetDrawdown() 메서드 추가**:

```javascript
// riskEngine.js
resetDrawdown(newEquity) {
  if (!newEquity) {
    newEquity = this.accountState.equity;
  }
  this.drawdownMonitor.resetAll(newEquity);
  log.info('DrawdownMonitor manually reset', { equity: newEquity });
  this.emit(RISK_EVENTS.DRAWDOWN_RESET, { equity: newEquity, timestamp: Date.now() });
}
```

2. **riskRoutes.js에 POST /api/risk/drawdown/reset 추가**:

```javascript
router.post('/drawdown/reset', (req, res) => {
  try {
    const { equity } = req.body; // optional: override equity
    riskEngine.resetDrawdown(equity || undefined);
    const status = riskEngine.getStatus();
    res.json({ success: true, data: status.drawdownMonitor });
  } catch (err) {
    log.error('POST /drawdown/reset — error', { error: err });
    res.status(500).json({ success: false, error: err.message });
  }
});
```

3. **RISK_EVENTS에 DRAWDOWN_RESET 상수 추가** (constants.js)

4. **CircuitBreaker 리셋도 함께 제공** — drawdown halt와 circuit break가 동시에 발생할 수 있으므로, `/api/risk/circuit-breaker/reset` 도 함께 추가하는 것이 운영상 합리적이다.

**보안 고려사항**: 리셋 API는 신중하게 사용되어야 한다. 무분별한 리셋은 리스크 관리를 무력화한다. UI에서 리셋 시 확인 모달(한 번 더 클릭) + 리셋 사유 입력을 권장한다.

**구현 난이도**: 낮음 (백엔드 ~20줄, 프론트엔드는 UI 에이전트에 위임)

---

### T1-3: Graceful Shutdown 순서 수정 (LOW, but CORRECT)

**현재 상태 분석**:

`app.js` line 390-443의 `safeShutdown()`:

```javascript
// 현재 순서:
1. botService.stop()          // WS close 포함
2. server.close()             // HTTP server
3. io.close()                 // Socket.io
4. mongoose.disconnect()      // MongoDB
```

`botService.stop()` (line 385-508) 내부에서:
1. 전략 비활성화
2. 이벤트 리스너 정리
3. indicatorCache/marketRegime/tickerAggregator/marketData 중지
4. positionManager 중지
5. **exchangeClient.closeWebsockets()** (line 476-480) ← WS 종료
6. **BotSession.save()** (line 483-492) ← DB write

즉 WS를 먼저 닫고 DB write를 하는데, 이 순서가 문제가 되는 시나리오:
- WS 닫힌 후 DB write가 실패하면 세션 상태가 'running'으로 남아 다음 시작 시 혼란
- 하지만 MongoDB는 WS가 아닌 별도 TCP 연결이므로 직접적 영향은 제한적

**나의 관점**: 순서 수정 자체는 간단하지만, 실질적 위험은 낮다. Engineer 에이전트가 판단할 영역.

---

### T1-4: PaperEngine 리스너 누적 제거 (LOW-MEDIUM)

**현재 상태 분석**:

`paperEngine.js`는 EventEmitter를 확장하며 `paper:fill` 이벤트를 emit한다 (line 221). 그러나 `removeAllListeners()` 또는 리스너 정리 메커니즘이 **없다**.

`botService.js`에서 `stop()` 시 `_eventCleanups` 배열로 리스너를 정리하지만, PaperEngine 자체의 리스너(onTickerUpdate에서 등록되는 내부 상태)는 별도 정리가 필요하다.

봇을 start/stop 반복하면 리스너가 누적되어:
- `paper:fill` 이벤트가 중복 처리
- 메모리 누수 (MaxListenersExceededWarning)

**나의 관점**: 페이퍼 트레이딩 모드에서 봇을 반복 재시작하면 체감되는 버그. 수정은 `PaperEngine`에 `stop()` 메서드 추가 + `botService.stop()`에서 호출.

---

### T1-8: PositionsTable 수동 청산 버튼 (MEDIUM — Trading 관점 필수)

**나의 관점**: 이것은 **운영 필수 기능**이다. 자동매매 봇이 잘못된 포지션을 열었을 때, 수동으로 즉시 청산할 수 있는 UI 버튼이 없으면:
- 긴급 상황에서 거래소 웹사이트에 직접 접속해야 함
- 대시보드의 존재 이유(원격 제어)가 약화됨

필요한 인터페이스:
- `POST /api/trades/order` — 수동 주문 제출 (이미 존재)
- 또는 `DELETE /api/trades/order/:id` + 반대 방향 시장가 주문 조합

Frontend에서:
- PositionsTable 각 행에 "청산" 버튼
- 클릭 시 확인 모달 → CLOSE_LONG 또는 CLOSE_SHORT 시장가 주문

---

## 제안 사항 (우선순위, 구현 난이도, 예상 영향)

### 우선순위 배정

| 순위 | ID | 제목 | 난이도 | 예상 영향 | 근거 |
|------|-----|------|--------|-----------|------|
| **1** | **T1-1** | IndicatorCache 백테스트 주입 | 중간 | **Critical** — 8/18 전략 백테스트 크래시 해결 | 백테스트 무용지물 상태 해소 |
| **2** | **T1-2** | _notifyFill action 필드 | 낮음 | **Critical** — 16/18 전략 포지션 추적 정상화 | 5줄 수정으로 최대 효과 |
| **3** | **T1-6** | Sharpe 연간화 정규화 | 낮음-중간 | **High** — 전략 비교 지표 정확도 | 잘못된 Sharpe로 전략 선택 오류 방지 |
| **4** | **T1-5** | SignalFilter position count 연동 | 중간 | **High** — maxConcurrentPositions 실효성 확보 | 과다매매 방지 |
| **5** | **T1-11** | DrawdownMonitor 수동 리셋 | 낮음 | **Medium** — 운영 편의성 | 서버 재시작 없이 halt 해제 |
| 6 | T1-8 | 수동 청산 버튼 | 중간 | **Medium** — 운영 안전성 | 긴급 청산 능력 |
| 7 | T1-4 | PaperEngine 리스너 정리 | 낮음 | **Medium** — 메모리 안정성 | 반복 재시작 시 누적 |
| 8 | T1-3 | Graceful shutdown 순서 | 낮음 | **Low** — 정합성 개선 | 세션 상태 일관성 |
| 9 | T1-9 | Socket.io lifecycle | 중간 | **Medium** — FE 안정성 | UI 에이전트 영역 |
| 10 | T1-10 | Error Boundary | 중간 | **Medium** — FE 안정성 | UI 에이전트 영역 |
| 11 | T1-7 | Dashboard 레이아웃 | 높음 | **Low** — UX 개선 | 기능적 영향 없음 |

### Track 배분 제안

**Track A (Backend — Critical Path)**: T1-1 → T1-2 → T1-6 (순차, 모두 백테스트 관련)
**Track B (Backend — Independent)**: T1-5, T1-4, T1-3, T1-11 (병렬 가능)
**Track C (Frontend)**: T1-7, T1-8, T1-9, T1-10 (병렬 가능)

T1-1과 T1-2는 **반드시 함께 구현**되어야 한다. T1-1만 구현하면 지표는 계산되지만 포지션 추적이 깨지고, T1-2만 구현하면 크래시는 여전하다.

---

## 다른 에이전트에게 요청 사항

### Engineer 에이전트에게

1. **T1-1 구현 시**: BacktestEngine 내부에 생성할 백테스트용 IndicatorCache 어댑터의 인터페이스는 다음을 만족해야 한다:
   - `get(symbol, indicator, params)` — 실제 IndicatorCache와 동일한 시그니처
   - `getHistory(symbol)` — `{ klines, closes, highs, lows, volumes }` 반환
   - `feedKline(kline)` — BacktestEngine의 메인 루프에서 매 kline마다 호출 (symbol 필드를 자동 주입)
   - kline 포맷: 백테스트 kline은 `{ ts, open, high, low, close, volume }`이지만, IndicatorCache는 `{ symbol, close, high, low, open, volume }`을 기대. 변환 필요.

2. **T1-2 구현 시**: `_notifyFill`의 시그니처를 `(side, price, action)`으로 변경하고, 호출부 4곳 + `_forceClosePosition` 경유 시에도 action이 전달되는지 확인. `_forceClosePosition`은 `_closeLong`/`_closeShort`를 호출하므로 자동 해결됨.

3. **T1-5 구현 시**: `paperPositionManager.getPositions()` 반환값에 `strategy` 필드가 포함되는지 확인. 없다면 주문 제출 시 strategy를 기록하는 로직 추가 필요.

4. **T1-6 구현 시**: `computeMetrics` 함수 시그니처에 `interval` 파라미터 추가. 호출부(`backtestRoutes.js` line 135-139, `runAllBacktest.js`)도 함께 수정.

5. **T1-11 구현 시**: `RISK_EVENTS` 상수에 `DRAWDOWN_RESET: 'drawdown_reset'` 추가. riskRoutes.js에 엔드포인트 추가. app.js의 Socket.io forward에 해당 이벤트도 포함.

6. **T1-3 구현 시**: `botService.stop()` 내부에서 BotSession DB write 후 WebSocket close 순서로 변경. 구체적으로 line 469-480(positionManager.stop + exchangeClient.closeWebsockets)과 line 482-492(session save)의 순서를 교체.

### UI 에이전트에게

1. **T1-8 (수동 청산 버튼)**: PositionsTable의 각 행에 빨간색 "청산" 버튼 추가. 클릭 시 확인 모달 표시 후 `tradeApi.submitOrder({ action: CLOSE_LONG/CLOSE_SHORT, symbol, qty, orderType: 'market' })` 호출. 성공/실패 토스트 알림.

2. **T1-11 (리셋 버튼)**: 리스크 상태 패널에 DrawdownMonitor가 halted일 때만 표시되는 "Drawdown 리셋" 버튼 추가. 클릭 시 확인 모달(리셋 사유 입력 포함) → `POST /api/risk/drawdown/reset` 호출.

3. **T1-7**: 대시보드 레이아웃에서 리스크 상태 패널의 가시성을 높여주길 바란다. DrawdownMonitor halt 상태일 때 대시보드 상단에 경고 배너가 표시되면 이상적이다.

---

## 추가 제언: 백테스트 검증 프로세스

T1-1과 T1-2가 구현된 후, **백테스트 결과의 sanity check**을 수행해야 한다:

1. 간단한 전략(RSI Pivot)으로 BTCUSDT 1H 백테스트 실행
2. 수동으로 몇 개 거래의 진입/청산 가격이 kline close와 일치하는지 확인
3. TP/SL이 실제로 트리거되는지 확인 (T1-2 수정 전에는 불가능했음)
4. Sharpe ratio가 interval에 따라 합리적인 범위인지 확인

이 검증은 Phase 4 구현 완료 후 Phase 5(Wrap-up)에서 수행하면 된다.
