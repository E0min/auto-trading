# Round 2 Proposal -- Tier 0 Safety-Critical (T0-1 ~ T0-9) 구현 가이드

> 작성자: Senior Quant Trader Agent
> 날짜: 2026-02-13
> 기반: Round 1 합의 (decisions/round_1.md), BACKLOG.md, 소스코드 직접 분석
> 대상 커밋: a0071df (Multi-agent system)

---

## 분석 요약

Round 1에서 합의된 9건의 Tier 0 항목을 소스코드 기반으로 정밀 분석했다. 핵심 발견사항:

1. **T0-1 (전략 이름)**: `botService.js:896`에서 기본값이 `['MomentumStrategy', 'MeanReversionStrategy']`인데, 이 이름은 `sampleStrategies.js`에서 레지스트리에 등록되어 실제로 존재한다. 하지만 이것은 데모용 전략이고 18개 본격 전략과 무관하다. config 없이 봇 시작 시 데모 전략만 로드되는 것이 문제.

2. **T0-2 (Position Sizing)**: 모든 18개 전략이 `suggestedQty`에 `positionSizePercent` 값(예: '2', '5')을 그대로 전달한다. botService.js에서 `qty: signal.suggestedQty || signal.qty`로 orderManager에 전달하므로, BTC 가격이 $60,000일 때 `qty='5'`는 $300,000 주문이 된다. ExposureGuard가 줄여주긴 하지만, 그것은 equity 대비 상한 클리핑일 뿐 정확한 변환이 아니다.

3. **T0-3 (Multi-symbol)**: `strategyBase.js:106`에서 `this._symbol = symbol`로 스칼라 덮어쓰기. `strategyRouter.js:141-143`에서 for-loop으로 여러 심볼을 activate하지만 마지막 심볼만 `_symbol`에 남는다. `botService.js:254`의 ticker 라우팅은 `strategy._symbol === ticker.symbol`로 비교하므로 마지막 심볼의 ticker만 전략에 도달한다.

4. **T0-6 (Division by Zero)**: `exposureGuard.js:109`에서 `divide(orderValue, equity)`를 호출하는데 equity가 '0'이면 mathUtils.divide가 `division by zero` 에러를 throw한다. 서버 시작 직후 riskEngine.accountState.equity는 '0'으로 초기화된다.

---

## 항목별 구현 가이드

### T0-1: 기본 전략 이름 수정

#### 현재 코드 문제점

파일: `backend/src/services/botService.js` 라인 896
```js
const strategyNames = config.strategies || ['MomentumStrategy', 'MeanReversionStrategy'];
```

`MomentumStrategy`와 `MeanReversionStrategy`는 실제로 `sampleStrategies.js`에서 레지스트리에 등록된다. 따라서 봇이 시작은 되지만, 이 두 전략은:
- RSI SMA 기반의 단순 데모 전략으로, 18개 본격 전략의 위상 외에 있음
- `positionSizePercent: '2'`를 `suggestedQty`로 직접 전달 (T0-2 문제 공유)
- metadata에 `defaultConfig`가 없어서 향후 파이프라인에서 누락 가능

문제의 핵심: config 미지정 시 데모 전략으로 실거래하게 됨. 실수로 실거래 진입 위험 매우 높음.

#### 구체적 변경 내용

**변경 1**: 기본 전략 목록을 18개 중 안정적이고 다양한 레짐을 커버하는 5개 핵심 전략으로 교체.

```js
// botService.js:896
const DEFAULT_STRATEGIES = [
  'RsiPivotStrategy',        // indicator-light, 양방향, trending + volatile + ranging
  'MaTrendStrategy',         // indicator-light, 추세, trending_up + trending_down
  'BollingerReversionStrategy', // indicator-light, 역추세, ranging + quiet
  'SupertrendStrategy',      // indicator-light, 추세, trending_up + trending_down + volatile
  'TurtleBreakoutStrategy',  // price-action, 돌파, trending_up + trending_down + volatile
];

const strategyNames = config.strategies || DEFAULT_STRATEGIES;
```

선정 근거 (Quant 관점):
- 5개 전략이 5개 레짐을 모두 커버
- indicator-light 3개 + price-action 1개 + indicator-light 1개로 다양성 확보
- 모두 안정적으로 동작 확인된 전략 (IndicatorCache 의존 없음 또는 선택적)
- 각 전략 간 상관관계가 낮음 (추세 + 역추세 + 돌파 + 피봇)

**변경 2**: `sampleStrategies.js`의 `MomentumStrategy`/`MeanReversionStrategy`는 삭제하지 않고 유지 (backward compat). 레지스트리 등록도 유지하되, 기본 전략 목록에서는 제외.

#### 변경할 파일/함수
| 파일 | 함수/위치 | 변경 |
|------|-----------|------|
| `backend/src/services/botService.js` | `_createStrategies()` (line 896) | DEFAULT_STRATEGIES 상수 정의 + 기본값 교체 |

#### 예상 부작용
- 기존 config 없이 시작하던 사용자의 전략이 바뀜 (의도된 변경)
- sampleStrategies.js는 여전히 레지스트리에 존재하므로 명시적 config로 사용 가능

---

### T0-2: Position Sizing -- percentage -> quantity 변환 파이프라인 구축

#### 현재 코드 문제점

**전 전략 공통 문제**: 모든 18개 전략(+ 2개 샘플)이 `suggestedQty`에 `positionSizePercent`를 그대로 전달한다.

예시 (RsiPivotStrategy.js):
```js
suggestedQty: this.config.positionSizePercent,  // '5' (= 5% of equity)
```

botService.js에서:
```js
this.orderManager.submitOrder({
  ...signal,
  qty: signal.suggestedQty || signal.qty,  // '5' 그대로 전달
  ...
});
```

orderManager.js에서:
```js
const finalQty = riskResult.adjustedQty || qty;  // riskEngine이 조정 안 하면 '5' 그대로
```

BTC가 $60,000일 때 qty='5'는 5 BTC = $300,000 주문. ExposureGuard의 maxPositionSizePercent('5')가 equity 대비 클리핑하지만:
- equity가 $10,000이면 maxAllowedValue = $500, qty = $500 / $60,000 = 0.00833 BTC = OK
- 하지만 이건 우연히 ExposureGuard가 잡아준 것일 뿐, 의도된 파이프라인이 아님
- equity가 $1M이면 ExposureGuard가 통과시킴 → qty=5 BTC = $300,000 주문 실행

**핵심 리스크**: percentage를 quantity로 오해석하면 주문 크기가 기대의 10,000x+ 가 됨.

#### 구체적 변경 내용

AD-2 결정에 따라 `botService.js`의 signal -> orderManager 파이프라인 사이에 변환 로직을 삽입한다.

**변경 1**: `botService.js`에 `_resolveQuantity()` 메서드 추가

```js
/**
 * Convert a percentage-based position size to an absolute quantity.
 *
 * Pipeline: signal.suggestedQty (percentage) -> absolute qty (contracts/coins)
 *
 * Steps:
 *   1. equity * (positionSizePercent / 100) = notional value to allocate
 *   2. notional / currentPrice = raw quantity
 *   3. Round down to exchange lot step (via contract config)
 *
 * @param {object} signal - { symbol, suggestedQty, suggestedPrice, ... }
 * @returns {string} resolved absolute quantity (String)
 */
_resolveQuantity(signal) {
  const { symbol, suggestedQty, suggestedPrice } = signal;

  // 1. Get current equity from the active position manager
  let equity;
  if (this.paperMode && this.paperPositionManager) {
    equity = this.paperPositionManager.getEquity();
  } else {
    equity = this.riskEngine.accountState.equity;
  }

  // Fallback: if equity is zero or not set, use a safe minimum
  if (!equity || math.isZero(equity)) {
    log.warn('_resolveQuantity -- equity is 0, cannot resolve quantity', { symbol });
    return null;
  }

  // 2. Get the current price
  const price = suggestedPrice
    || this.tickerAggregator.getLatestPrice(symbol)
    || null;

  if (!price || math.isZero(price)) {
    log.warn('_resolveQuantity -- no price available', { symbol });
    return null;
  }

  // 3. Calculate notional = equity * (pct / 100)
  const pct = suggestedQty; // e.g. '5' means 5%
  const notional = math.multiply(equity, math.divide(pct, '100'));

  // 4. Convert to quantity = notional / price
  let qty = math.divide(notional, price);

  // 5. Floor to lot precision (TODO: fetch from exchangeClient.getInstruments cache)
  const qtyFloat = parseFloat(qty);
  if (qtyFloat <= 0) {
    log.warn('_resolveQuantity -- calculated qty is zero or negative', {
      symbol, equity, pct, price, notional, qty,
    });
    return null;
  }

  // Use 4 decimal precision, floor (never round up to avoid exceeding limits)
  qty = math.toFixed(String(Math.floor(qtyFloat * 10000) / 10000), 4);

  log.info('_resolveQuantity -- converted', {
    symbol,
    equityUsed: equity,
    pctRequested: pct,
    notional,
    price,
    resolvedQty: qty,
  });

  return qty;
}
```

**변경 2**: signal handler에서 `_resolveQuantity()` 호출

botService.js의 `start()` 메서드 내 signal handler (line 305-336)와 `enableStrategy()` 내 signal handler (line 814-835) 양쪽 모두 변경:

```js
// Before (현재)
this.orderManager.submitOrder({
  ...signal,
  qty: signal.suggestedQty || signal.qty,
  price: signal.suggestedPrice || signal.price,
  sessionId,
});

// After (변경)
const resolvedQty = this._resolveQuantity(signal);
if (!resolvedQty) {
  log.warn('Signal skipped -- quantity resolution failed', {
    strategy: strategy.name,
    symbol: signal.symbol,
  });
  return;
}

this.orderManager.submitOrder({
  ...signal,
  qty: resolvedQty,
  price: signal.suggestedPrice || signal.price,
  sessionId,
});
```

#### 변경할 파일/함수
| 파일 | 함수/위치 | 변경 |
|------|-----------|------|
| `backend/src/services/botService.js` | 신규 `_resolveQuantity()` | percentage -> qty 변환 로직 |
| `backend/src/services/botService.js` | `start()` 내 signal handler (2곳) | `_resolveQuantity()` 호출 |
| `backend/src/services/botService.js` | `enableStrategy()` 내 signal handler | 동일 변경 |

#### 예상 부작용
- 모든 전략의 실제 주문 크기가 변경됨 (의도된 변경: 정상화)
- equity=0 시 주문이 거부됨 (의도된 안전장치)
- 백테스트 엔진은 자체 포지션 사이징 로직이 있으므로 영향 없음

---

### T0-3: Multi-symbol Routing -- Set 기반 심볼 관리로 전환

#### 현재 코드 문제점

**strategyBase.js:106**: `activate(symbol)`이 `this._symbol = symbol`로 스칼라 덮어쓰기
**strategyRouter.js:141-143**: for-loop으로 여러 심볼에 activate 호출:
```js
for (const symbol of this._symbols) {
  strategy.activate(symbol, this._category);  // 마지막 심볼만 _symbol에 남음
}
```

**botService.js:254**: ticker 라우팅이 스칼라 비교:
```js
if (strategy.isActive() && strategy._symbol === ticker.symbol) {
```

결과: 5개 심볼이 선택되어도 전략은 마지막 심볼의 데이터만 수신. 4개 심볼에 대해 시그널이 절대 생성되지 않음.

#### 구체적 변경 내용

AD-1 결정에 따라 전략당 1개 인스턴스를 유지하되, `_symbol` 스칼라를 `_symbols: Set`으로 교체.

**변경 1**: `strategyBase.js` 수정

```js
// constructor 내부
this._symbols = new Set();  // 기존: this._symbol = null;
this._symbol = null;        // 현재 처리 중인 심볼 (backward compat, onTick/onKline에서 설정)

// activate() 수정
activate(symbol, category = CATEGORIES.USDT_FUTURES) {
  if (!symbol || typeof symbol !== 'string') {
    throw new TypeError('StrategyBase.activate: symbol must be a non-empty string');
  }

  this._symbols.add(symbol);
  this._category = category;
  this._active = true;
  this._symbol = symbol;

  this._log.info('Strategy activated for symbol', { symbol, category, totalSymbols: this._symbols.size });
}

// 신규: 단일 심볼 제거
deactivateSymbol(symbol) {
  this._symbols.delete(symbol);
  if (this._symbols.size === 0) {
    this._active = false;
    this._symbol = null;
  } else {
    this._symbol = this._symbols.values().next().value;
  }
}

// deactivate() 수정
deactivate() {
  this._active = false;
  this._symbols.clear();
  this._symbol = null;
  this._log.info('Strategy deactivated');
}

// 신규: 심볼 포함 여부 확인
hasSymbol(symbol) {
  return this._symbols.has(symbol);
}

// 신규: 모든 활성 심볼 조회
getSymbols() {
  return Array.from(this._symbols);
}
```

**변경 2**: `botService.js` ticker/kline 라우팅 수정

```js
// 기존 (line 254)
if (strategy.isActive() && strategy._symbol === ticker.symbol) {

// 변경
if (strategy.isActive() && strategy.hasSymbol(ticker.symbol)) {
```

onTick/onKline 호출 전에 `strategy._symbol`을 현재 ticker의 심볼로 임시 설정하여 backward compat 유지:

```js
const onTickerUpdate = (ticker) => {
  for (const strategy of this.strategies) {
    if (strategy.isActive() && strategy.hasSymbol(ticker.symbol)) {
      try {
        strategy._symbol = ticker.symbol;  // 현재 처리 중인 심볼 설정
        strategy.onTick(ticker);
      } catch (err) {
        log.error('Strategy onTick error', { strategy: strategy.name, error: err });
      }
    }
  }
};
```

**변경 3**: `strategyRouter.js` updateSymbols() 수정

```js
updateSymbols(symbols) {
  this._symbols = symbols;

  for (const strategy of this.getActiveStrategies()) {
    // 기존 심볼 중 새 목록에 없는 것 제거
    for (const oldSymbol of strategy.getSymbols()) {
      if (!symbols.includes(oldSymbol)) {
        strategy.deactivateSymbol(oldSymbol);
      }
    }
    // 새 심볼 중 기존에 없는 것 추가
    for (const symbol of symbols) {
      if (!strategy.hasSymbol(symbol)) {
        strategy.activate(symbol, this._category);
      }
    }
    strategy.setMarketRegime(this._currentRegime);
  }
}
```

#### Quant 관점 주의사항
Phase 1에서 priceHistory 혼재 문제가 있으므로, 각 전략의 시그널 품질이 일시적으로 저하될 수 있다. **권장**: Phase 1 배포 직후에는 **심볼 수를 3개 이하로 제한**하거나, 전략당 1개 심볼 할당 모드를 임시로 사용하는 것이 안전하다.

---

### T0-4: unhandledRejection / uncaughtException 핸들러 추가

#### 현재 코드 문제점

`app.js`에는 SIGTERM/SIGINT 핸들러만 있다 (line 426-427). `unhandledRejection`과 `uncaughtException`에 대한 핸들러가 없다.

#### 구체적 변경 내용

AD-3 결정에 따라:
- `unhandledRejection` -> 로그 + risk alert, 프로세스 유지
- `uncaughtException` -> graceful shutdown

**변경**: `app.js`의 `bootstrap()` 내부, gracefulShutdown 정의 직후에 추가:

```js
process.on('unhandledRejection', (reason, promise) => {
  log.error('UNHANDLED REJECTION -- process will continue', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });

  io.emit('risk:unhandled_error', {
    type: 'unhandled_rejection',
    message: reason instanceof Error ? reason.message : String(reason),
    timestamp: new Date().toISOString(),
  });
});

process.on('uncaughtException', (error) => {
  log.error('UNCAUGHT EXCEPTION -- starting graceful shutdown', {
    message: error.message,
    stack: error.stack,
  });

  try {
    io.emit('risk:unhandled_error', {
      type: 'uncaught_exception',
      message: error.message,
      timestamp: new Date().toISOString(),
      shutdownInitiated: true,
    });
  } catch (_) {}

  const shutdownTimeout = setTimeout(() => {
    log.error('Graceful shutdown timed out -- forcing exit');
    process.exit(1);
  }, 15000);
  shutdownTimeout.unref();

  gracefulShutdown('uncaught_exception').catch(() => {
    process.exit(1);
  });
});
```

---

### T0-5: orderManager.submitOrder() per-symbol mutex 추가

#### 현재 코드 문제점

`orderManager.submitOrder()`는 동시성 제어가 없다. 같은 심볼에 대해 두 개의 시그널이 거의 동시에 발생하면 의도하지 않은 2x 포지션(double-spend)이 발생할 수 있다.

#### 구체적 변경 내용

per-symbol mutex를 구현하여 같은 심볼에 대한 주문이 직렬화되도록 한다.

```js
// constructor 내부
this._symbolLocks = new Map();

async submitOrder(signal) {
  const { symbol } = signal;

  while (this._symbolLocks.has(symbol)) {
    try {
      await this._symbolLocks.get(symbol);
    } catch (_) {}
  }

  let releaseLock;
  const lockPromise = new Promise((resolve) => { releaseLock = resolve; });
  this._symbolLocks.set(symbol, lockPromise);

  try {
    return await this._submitOrderInternal(signal);
  } finally {
    this._symbolLocks.delete(symbol);
    releaseLock();
  }
}
```

기존 `submitOrder()` 로직은 `_submitOrderInternal()`로 이름 변경.

---

### T0-6: ExposureGuard equity=0 division by zero 방어

#### 현재 코드 문제점

`exposureGuard.js:109`:
```js
const positionSizePercent = multiply(divide(orderValue, equity), '100');
```

`equity`가 '0'이면 `mathUtils.divide()`가 `division by zero` 에러를 throw한다.

#### 구체적 변경 내용

```js
validateOrder(order, accountState) {
  const equity = accountState.equity;

  // Guard: equity must be positive for any exposure calculation
  if (!equity || math.isZero(equity) || math.isLessThan(equity, '0')) {
    log.warn('Order rejected -- equity is zero or negative', {
      symbol: order.symbol,
      equity,
    });
    return {
      approved: false,
      reason: 'equity_zero_or_negative: cannot calculate exposure without valid equity',
    };
  }
  // ... 기존 로직 계속
}
```

추가: `drawdownMonitor.js`의 `updateEquity()` 시작에 equity=0 스킵 추가.

---

## Frontend 연동 요구사항

### T0-7: Emergency Stop ConfirmDialog

**백엔드 요구사항**: 없음. 기존 `POST /api/bot/emergency-stop` API가 충분.

**Quant 권장사항**:
- 확인 다이얼로그에 현재 열린 포지션 수와 총 미실현 PnL을 표시
- "모든 포지션이 시장가로 청산됩니다"라는 경고 문구 필수
- 버튼 색상: 빨간색, 2단계 확인 (체크박스 + 버튼)

### T0-8: Risk 이벤트(CB/DD) 실시간 UI 표시 + RiskAlertBanner

**백엔드 요구사항**:
1. **RiskEvent MongoDB 모델 생성** (AD-4 결정)
2. **riskEngine 이벤트 발생 시 RiskEvent 자동 저장**
3. **REST API 엔드포인트 추가**: `GET /api/risk/events`, `POST /api/risk/events/:id/resolve`, `GET /api/risk/status`

### T0-9: 실거래/가상거래 모드 시각적 경고 강화

**백엔드 요구사항**: 봇 상태 API에 tradingMode 정보 이미 포함. 추가 권장: 봇 시작 시 Socket.io 이벤트 발행.

**Quant 권장사항**:
- LIVE 모드: 전체 화면 상단에 빨간 배경의 "LIVE TRADING" 배너 상시 표시
- PAPER 모드: 초록 배경의 "PAPER TRADING" 배너
- LIVE 모드에서 봇 시작 시 별도의 확인 다이얼로그 필요

---

## 구현 순서 추천

```
Day 1 (병렬 가능):
  [Backend-A] T0-6 (ExposureGuard equity guard)     -- 30분, 독립
  [Backend-B] T0-4 (crash handler)                    -- 1시간, 독립
  [Backend-C] T0-1 (기본 전략 이름)                    -- 30분, 독립
  [Frontend]  T0-7 (Emergency Stop dialog)             -- 1시간, 독립
  [Frontend]  T0-9 (모드 시각적 경고)                   -- 2시간, 독립

Day 2 (순차):
  [Backend] T0-3 (Multi-symbol Set 기반) -- 4시간
    ↓ (T0-3 완료 후)
  [Backend] T0-2 (Position sizing 변환) -- 4시간
  [Frontend] T0-8 (Risk alert banner) -- 4시간

Day 3 (T0-3, T0-2 완료 후):
  [Backend] T0-5 (per-symbol mutex) -- 2시간
  [Backend] RiskEvent 모델 + API 추가 (T0-8 백엔드) -- 2시간
  [통합 테스트] 전체 파이프라인 검증
```

---

## 다른 에이전트에게 요청 사항

### Engineer Agent에게

1. **T0-3 Phase 1에서 `_symbol` 임시 설정 방식의 thread-safety 검증** — Node.js 싱글 스레드이므로 이론상 안전하지만, `onKline()` 내부에서 async 작업이 있는 전략이 있는지 확인 필요
2. **T0-5 mutex 구현의 메모리 누수 방지 검증** — `_symbolLocks` Map에서 lock이 해제되지 않는 edge case 방어 코드 리뷰 요청
3. **T0-4 graceful shutdown에서 열린 주문 취소 순서** 확인 필요
4. **RiskEvent 모델의 인덱스 설계** — `{ type, resolved, createdAt }` 복합 인덱스 권장, TTL 인덱스 30일
5. **T0-2 Phase 2에서 거래소 계약 정보 캐싱** — `exchangeClient.getInstruments()` 응답 구조 검증

### UI Agent에게

1. **T0-7 ConfirmDialog 디자인** — 열린 포지션 목록 + 각 포지션의 unrealizedPnl 표시 요청, 3초 카운트다운
2. **T0-8 RiskAlertBanner** — Socket.io 이벤트 수신, 배너 우선순위: HALT > BREAK > WARNING
3. **T0-9 모드 경고** — LIVE 모드 전환 시 이중 확인
4. **타입 정의 업데이트** — `StrategyInfo.symbols: string[]`, `RiskEvent` 타입 추가

---

## 검증 체크리스트

### T0-1 검증
- [ ] config 없이 봇 시작 -> 5개 기본 전략이 로드되는지
- [ ] config.strategies에 존재하지 않는 이름 포함 -> 경고 로그 + 나머지는 정상 로드

### T0-2 검증
- [ ] equity=$10,000, positionSizePercent='5', BTC=$60,000 -> qty = 0.0083 BTC
- [ ] equity=$10,000, positionSizePercent='5', ETH=$3,000 -> qty = 0.1666 ETH
- [ ] equity=0 -> qty 변환 실패, 주문 거부 (T0-6 연동)

### T0-3 검증
- [ ] 5개 심볼 선택 -> 모든 심볼의 ticker/kline이 전략에 도달
- [ ] 각 심볼에서 독립적으로 시그널 생성 가능

### T0-4 검증
- [ ] unhandledRejection 발생 -> 로그 기록, 프로세스 유지
- [ ] uncaughtException 발생 -> graceful shutdown 실행

### T0-5 검증
- [ ] 같은 심볼에 2개 시그널 동시 발생 -> 직렬 처리
- [ ] 다른 심볼에 2개 시그널 동시 발생 -> 병렬 처리

### T0-6 검증
- [ ] equity=0 상태에서 주문 시도 -> 거부
- [ ] equity 정상 값 -> 기존 로직 정상 작동

---

*이 문서는 Senior Quant Trader Agent가 Round 1 합의사항과 소스코드 직접 분석을 기반으로 작성하였다.*
