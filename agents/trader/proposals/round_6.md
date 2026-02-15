# Round 6 Proposal -- "실거래 준비도 강화: 핵심 결함 수정 스프린트"

**Date**: 2026-02-16
**Author**: Senior Quant Trader Agent
**Based on**: Solo S1 Analysis (HIGH-1~HIGH-4 + 추가 발견)
**Sprint Goal**: 실거래 투입 전 반드시 해결해야 할 이슈 수정

---

## 분석 요약

Solo S1 분석에서 발견된 HIGH 4건(S1-1 ~ S1-4)의 구체적 구현 방안을 소스 코드 직접 분석을 통해 수립했다. 추가로 Solo S1에서 놓친 **NEW 이슈 3건**을 발견했다.

**핵심 판단**: 현재 시스템은 아키텍처적으로 견고하나, **실거래 경로에서 주문이 거래소에 도달하기 직전**에 4개의 중요한 결함이 있다. 이 4개가 해결되지 않으면 다음과 같은 사고가 발생한다:
1. 시장가 주문의 노출 검증이 무효화 (500,000 USDT 포지션이 0.01 USDT로 인식)
2. 레버리지가 전략 의도와 무관하게 거래소 기본값으로 실행
3. qty 변환 로직에 존재하지 않는 메서드 호출 (런타임 크래시)
4. 시그널 차단 후 전략이 영구적으로 진입 불가 상태에 빠짐

---

## 발견 사항 (코드 레벨 근거 포함)

### R6-1: ExposureGuard 시장가 주문 가격 주입 [S1-BL-1]

**심각도**: HIGH | **난이도**: Low | **예상 시간**: 30분

**현재 문제**:

파일: `backend/src/services/exposureGuard.js` (Line 85)
```js
const effectivePrice = order.price || '1';
```

시장가 주문 시 `order.price`가 `undefined`이므로 `effectivePrice = '1'`이 된다.

파일: `backend/src/services/orderManager.js` (Line 253-258)
```js
riskResult = this.riskEngine.validateOrder({
    symbol,
    side: actionMapping.side,
    qty,
    price: price || '0',    // market order -> '0'
    category,
});
```

OrderManager는 `price || '0'`을 전달. ExposureGuard에서 `'0' || '1'` = `'0'`은 falsy가 아니므로 `effectivePrice = '0'`이 된다. 그러나 `'0'`이 전달되면 `multiply(qty, '0')` = `'0'` -> orderValue = 0 -> positionSizePercent = 0% -> 항상 통과.

**실제 수치 예시**: BTC = $97,000, qty = 0.05 BTC
- 의도된 노출: $4,850 (자본 $10,000의 48.5%)
- 실제 계산: qty(0.05) * effectivePrice('0') = $0 -> 0% -> 통과
- maxPositionSizePercent = 5%를 완전히 우회

**구현 방안**:

1. `OrderManager._submitOrderInternal()`에서 market order일 때 현재 가격을 주입:

파일: `backend/src/services/orderManager.js` Line 250-259 변경

```js
// BEFORE risk validation: inject market price for market orders
let riskPrice = price;
if (!riskPrice || riskPrice === '0') {
    // Market order: use lastPrice from signal or tickerAggregator
    riskPrice = signal.suggestedPrice || signal.price || '0';
    if (riskPrice === '0') {
        log.warn('submitOrder -- market order without price reference', { symbol });
    }
}

riskResult = this.riskEngine.validateOrder({
    symbol,
    side: actionMapping.side,
    qty,
    price: riskPrice,
    category,
});
```

2. `ExposureGuard.validateOrder()`에서 fallback 강화:

파일: `backend/src/services/exposureGuard.js` Line 85 변경

```js
// T0-6 defense: reject market orders with no price data
const effectivePrice = order.price && order.price !== '0' ? order.price : null;
if (!effectivePrice) {
    log.warn('Order rejected -- no price available for exposure calculation', {
        symbol: order.symbol, orderPrice: order.price,
    });
    return { approved: false, reason: 'no_price_for_exposure_check' };
}
```

**검증 방법**: 단위 테스트 -- ExposureGuard에 `{ qty: '0.05', price: undefined }` 전달 시 reject 확인

---

### R6-2: 레버리지 설정 메커니즘 구현 [S1-BL-2]

**심각도**: HIGH | **난이도**: Medium | **예상 시간**: 1.5시간

**현재 문제**:

19개 전략이 모두 `leverage` 필드를 시그널에 포함하지만, 이 값은 어디에서도 거래소에 전달되지 않는다.

파일별 leverage 설정 (총 19개 전략):
| 전략 | leverage | 파일 |
|------|----------|------|
| Supertrend | '5' | SupertrendStrategy.js:670, 716 |
| AdaptiveRegime | '2'-'3' | AdaptiveRegimeStrategy.js:405~572 (레짐별 가변) |
| MaTrend | '3' | MaTrendStrategy.js:335, 385 |
| RsiPivot | 3 | RsiPivotStrategy.js:48 (metadata에만, signal에 미포함) |
| Bollinger | '3' | BollingerReversionStrategy.js:317, 356 |
| Turtle | '3' | TurtleBreakoutStrategy.js:75 |
| Grid | 2 | gridStrategy.js:70, 442, 486 |
| Funding | '3' | fundingRateStrategy.js:231~502 |
| MacdDivergence | '2' | MacdDivergenceStrategy.js:357, 418 |
| Candle | '2' | CandlePatternStrategy.js:615, 654 |
| Fibonacci | '2' | FibonacciRetracementStrategy.js:490, 543 |
| SupportResistance | '2' | SupportResistanceStrategy.js:437, 467 |
| SwingStructure | '3' | SwingStructureStrategy.js:348, 388 |
| Breakout | '3' | BreakoutStrategy.js:539, 589 |
| TrendlineBreakout | '3' | TrendlineBreakoutStrategy.js:253, 296 |

파일: `backend/src/services/exchangeClient.js` -- `setLeverage()` 메서드가 **존재하지 않음**

파일: `backend/src/services/orderManager.js` Line 354-363:
```js
const orderParams = {
    category, symbol, side: actionMapping.side,
    orderType, qty: finalQty,
    posSide: actionMapping.posSide,
    clientOid, reduceOnly: actionMapping.reduceOnly,
};
// leverage NOT included -- signal.leverage is ignored
```

**구현 방안**:

Step 1: ExchangeClient에 `setLeverage()` 추가

파일: `backend/src/services/exchangeClient.js` (getOpenOrders 뒤에 추가)

```js
/**
 * Set leverage for a symbol.
 * Bitget API: POST /api/v2/mix/account/set-leverage
 *
 * @param {Object} params
 * @param {string} params.symbol     -- e.g. 'BTCUSDT'
 * @param {string} params.category   -- product type
 * @param {string} params.leverage   -- leverage value (e.g. '5')
 * @param {string} [params.holdSide] -- 'long' | 'short' (for hedge mode)
 * @returns {Promise<Object>}
 */
async setLeverage({ symbol, category, leverage, holdSide }) {
    const label = 'setLeverage';
    const restClient = getRestClient();

    return this._withRetry(async () => {
        const params = {
            symbol,
            productType: category,
            leverage: String(leverage),
        };
        if (holdSide) params.holdSide = holdSide;

        log.trade(`${label} -- setting`, { symbol, leverage, holdSide });
        const response = await restClient.setFuturesLeverage(params);
        log.trade(`${label} -- done`, { symbol, leverage });
        return response;
    }, label, 2); // max 2 retries (idempotent)
}
```

Step 2: BotService에서 전략 활성화 시 leverage 설정

파일: `backend/src/services/botService.js` `_createStrategies()` 뒤에 호출

```js
// After strategy creation, set leverage per strategy's declared value
async _setStrategyLeverages(strategies, symbols, category) {
    const leverageMap = new Map(); // symbol -> max leverage needed

    for (const strategy of strategies) {
        const meta = strategy.getMetadata();
        const defaultConfig = meta.defaultConfig || {};
        const leverage = String(defaultConfig.leverage || '3');

        for (const symbol of symbols) {
            const current = leverageMap.get(symbol) || '0';
            if (isGreaterThan(leverage, current)) {
                leverageMap.set(symbol, leverage);
            }
        }
    }

    for (const [symbol, leverage] of leverageMap) {
        try {
            await this.exchangeClient.setLeverage({
                symbol, category, leverage,
            });
            log.info('Leverage set', { symbol, leverage });
        } catch (err) {
            log.error('Failed to set leverage', { symbol, leverage, error: err.message });
            // Non-fatal: continue with exchange default
        }
    }
}
```

Step 3: `start()` 메서드에서 전략 생성 후, 라우팅 전에 호출

파일: `backend/src/services/botService.js` Line 211 (전략 생성 후)

```js
this.strategies = this._createStrategies(config);

// Set leverage per-symbol based on strategy requirements
if (!this.paperMode) {
    await this._setStrategyLeverages(this.strategies, this._selectedSymbols, category);
}
```

**주의사항**:
- 다수 전략이 같은 심볼에 다른 레버리지를 요구할 경우, **최대값**을 사용 (안전 측면에서 포지션 사이즈를 ExposureGuard가 제한하므로)
- Paper 모드에서는 레버리지 설정 불필요 (paperEngine이 레버리지를 시뮬레이션하지 않음)

---

### R6-3: qty 표준화 레이어 및 getAccountInfo 크래시 수정 [S1-BL-3]

**심각도**: **CRITICAL (새로 상향)** | **난이도**: Medium | **예상 시간**: 1시간

**Solo S1에서 놓친 새로운 발견 -- 런타임 크래시 버그**:

파일: `backend/src/services/botService.js` Line 996:
```js
const accountInfo = await this.exchangeClient.getAccountInfo();
```

**`exchangeClient.getAccountInfo()` 메서드는 존재하지 않는다.** `exchangeClient.js`를 전수 조사한 결과 해당 메서드가 정의되어 있지 않음. 올바른 메서드는 `getBalances(category)`.

이 코드는 `_resolveSignalQuantity()` 내부에서 **실거래 모드(non-paper)**일 때 호출되므로:
- Paper 모드에서는 문제없음 (분기 건너뜀)
- **실거래 모드에서 모든 OPEN 시그널이 `TypeError: this.exchangeClient.getAccountInfo is not a function`으로 크래시**
- catch 블록에서 잡히지만 qty가 null 반환 -> 모든 OPEN 신호가 "qty resolution failed"로 스킵

이것은 Solo S1의 HIGH-2보다 심각한 문제이다. 실거래 모드에서 **주문이 아예 실행되지 않는** 상태.

**구현 방안**:

파일: `backend/src/services/botService.js` Line 991-1001 변경

```js
// BEFORE (broken):
// const accountInfo = await this.exchangeClient.getAccountInfo();
// equity = accountInfo.equity || accountInfo.totalEquity || '0';

// AFTER (fixed):
// Use PositionManager's synced account state (already updated via REST + WS)
const accountState = this.positionManager.getAccountState();
equity = accountState.equity || '0';

// Fallback: if equity not synced yet, try REST fetch
if (!equity || equity === '0') {
    try {
        const category = this.currentSession?.config?.category || CATEGORIES.USDT_FUTURES;
        const balanceResponse = await this.exchangeClient.getBalances(category);
        const rawAccounts = Array.isArray(balanceResponse?.data) ? balanceResponse.data : [];
        if (rawAccounts.length > 0) {
            const account = rawAccounts[0];
            equity = String(account.equity ?? account.accountEquity ?? account.usdtEquity ?? '0');
        }
    } catch (err) {
        log.error('_resolveSignalQuantity -- fallback equity fetch failed', { error: err.message });
        return null;
    }
}
```

**추가 -- 전략 suggestedQty 표준화**:

현재 모든 전략은 `suggestedQty`에 **퍼센트 값**(예: '5', '3', '4')을 넣는다. 이것은 `BotService._resolveSignalQuantity()`가 올바르게 처리하는 방식이다 (Line 1009-1026):

```js
const pct = signal.suggestedQty;          // '5' (percent)
const allocatedValue = math.multiply(equity, math.divide(pct, '100')); // equity * 5%
const qty = math.divide(allocatedValue, price);  // value / price = quantity
```

따라서 **전략 코드 수정은 불필요**하다. 핵심 문제는 `getAccountInfo` 크래시이다.

단, CLOSE 시그널에서도 `suggestedQty`에 퍼센트를 넣고 있는 전략이 있다:

파일: `backend/src/strategies/indicator-light/RsiPivotStrategy.js` Line 181:
```js
action: SIGNAL_ACTIONS.CLOSE_LONG,
suggestedQty: positionSizePercent,  // '5' (percent, not actual qty)
```

`_resolveSignalQuantity()`는 CLOSE 시그널에 대해 bypass한다 (Line 986-988):
```js
if (signal.action === SIGNAL_ACTIONS.CLOSE_LONG || signal.action === SIGNAL_ACTIONS.CLOSE_SHORT) {
    return signal.suggestedQty || signal.qty || null;
}
```

이 경우 CLOSE 시그널의 qty = '5' (퍼센트 문자열)가 그대로 OrderManager로 전달. ExposureGuard를 통과한 후 거래소에 `size: '5'`로 제출되는데, 이것은 **5 BTC**를 의미한다 (Bitget에서 size = base currency quantity).

**CLOSE 시그널 qty 수정 방안**:

파일: `backend/src/services/botService.js` `_resolveSignalQuantity()` Line 986-988 변경:

```js
// CLOSE signals: use actual position quantity, not percentage
if (signal.action === SIGNAL_ACTIONS.CLOSE_LONG || signal.action === SIGNAL_ACTIONS.CLOSE_SHORT) {
    // Try to get actual position qty from PositionManager
    const posSide = signal.action === SIGNAL_ACTIONS.CLOSE_LONG ? 'long' : 'short';
    if (this.paperMode && this.paperPositionManager) {
        const pos = this.paperPositionManager.getPosition(signal.symbol, posSide, signal.strategy);
        if (pos) return pos.qty;
    } else {
        const pos = this.positionManager.getPosition(signal.symbol, posSide);
        if (pos) return pos.qty;
    }
    // Fallback: pass through as-is (may be actual qty in some contexts)
    return signal.suggestedQty || signal.qty || null;
}
```

---

### R6-4: 전략 positionSide 조기 설정 제거 [S1-BL-4]

**심각도**: HIGH | **난이도**: Low | **예상 시간**: 1.5시간

**현재 문제**:

모든 전략에서 시그널 emit 시점에 `this._positionSide`와 `this._entryPrice`를 설정한다. 하지만 이 시그널이 SignalFilter에서 차단되거나 RiskEngine에서 reject되면, 전략은 "포지션이 열린 상태"라고 인식하지만 실제로는 열리지 않음.

영향 받는 전략 목록 (시그널 emit 시점에 positionSide를 설정하는 전략):

| 전략 | 파일:라인 | 코드 |
|------|-----------|------|
| RsiPivot | RsiPivotStrategy.js:283-284 | `this._positionSide = 'long'; this._entryPrice = close;` |
| AdaptiveRegime | AdaptiveRegimeStrategy.js:391-394 | `this._entryPrice = price; this._positionSide = 'long'; this._entryRegime = ...` |
| Supertrend | SupertrendStrategy.js (onFill에서만 설정 -- **정상**) | N/A |
| MaTrend | MaTrendStrategy.js (확인 필요) | |
| Bollinger | BollingerReversionStrategy.js (확인 필요) | |

**구체적 시나리오**:
1. RsiPivot이 `OPEN_LONG` 시그널 emit + `_positionSide = 'long'` 설정
2. SignalFilter가 cooldown으로 차단
3. 전략 내부: `_positionSide = 'long'`, `_entryPrice = close`
4. 이후 onKline에서: `if (this._entryPrice !== null) return;` (Line 247) -> 영구적으로 새 진입 불가
5. 시장이 절호의 기회를 제공해도 전략은 응답 없음

**구현 방안**:

**패턴 A (권장): 시그널 emit 시점의 상태 변경 제거, onFill에서만 설정**

SupertrendStrategy가 이미 이 패턴을 사용한다 (Line 204-223):
```js
onFill(fill) {
    if (fill.action === SIGNAL_ACTIONS.OPEN_LONG) {
        this._positionSide = 'long';
        this._entryPrice = String(fill.price || this._latestPrice);
    }
    // ...
}
```

적용 대상 전략과 구체적 변경:

**RsiPivotStrategy.js** (가장 대표적 케이스):

Line 282-286 변경:
```js
// BEFORE:
this._positionSide = 'long';
this._entryPrice = close;
this._lastSignal = signal;
this.emitSignal(signal);

// AFTER:
this._lastSignal = signal;
this.emitSignal(signal);
// positionSide and entryPrice are now set ONLY in onFill()
```

Line 314-317 변경 (SHORT 진입도 동일):
```js
// BEFORE:
this._positionSide = 'short';
this._entryPrice = close;
this._lastSignal = signal;
this.emitSignal(signal);

// AFTER:
this._lastSignal = signal;
this.emitSignal(signal);
```

**AdaptiveRegimeStrategy.js** 변경:

Line 389-396 (trendUpEntry):
```js
// BEFORE:
this._entryPrice = price;
this._positionSide = 'long';
this._entryRegime = MARKET_REGIMES.TRENDING_UP;
this._highestSinceEntry = price;
this._lowestSinceEntry = null;

return { action: SIGNAL_ACTIONS.OPEN_LONG, ... };

// AFTER:
// Store entry intent for onFill to finalize
this._pendingEntryRegime = MARKET_REGIMES.TRENDING_UP;
return { action: SIGNAL_ACTIONS.OPEN_LONG, ... };
```

AdaptiveRegimeStrategy의 `onFill()` 보강 (Line 357-369):
```js
onFill(fill) {
    if (!this._active) return;
    if (!fill) return;
    const action = fill.action || (fill.signal && fill.signal.action);

    if (action === SIGNAL_ACTIONS.OPEN_LONG) {
        this._positionSide = 'long';
        if (fill.price !== undefined) this._entryPrice = String(fill.price);
        this._entryRegime = this._pendingEntryRegime || this.getEffectiveRegime();
        this._highestSinceEntry = this._entryPrice;
        this._lowestSinceEntry = null;
        this._pendingEntryRegime = null;
    } else if (action === SIGNAL_ACTIONS.OPEN_SHORT) {
        this._positionSide = 'short';
        if (fill.price !== undefined) this._entryPrice = String(fill.price);
        this._entryRegime = this._pendingEntryRegime || this.getEffectiveRegime();
        this._lowestSinceEntry = this._entryPrice;
        this._highestSinceEntry = null;
        this._pendingEntryRegime = null;
    } else if (action === SIGNAL_ACTIONS.CLOSE_LONG || action === SIGNAL_ACTIONS.CLOSE_SHORT) {
        this._resetPosition();
    }
}
```

**나머지 전략 확인 후 동일 패턴 적용** (전략별 확인 필요):
- MaTrendStrategy
- BollingerReversionStrategy
- VwapReversionStrategy
- GridStrategy
- BreakoutStrategy
- CandlePatternStrategy
- SupportResistanceStrategy
- SwingStructureStrategy
- FibonacciRetracementStrategy
- MacdDivergenceStrategy
- FundingRateStrategy
- TurtleBreakoutStrategy
- TrendlineBreakoutStrategy
- QuietRangeScalpStrategy

---

### R6-5: [NEW] exchangeClient.getAccountInfo 미존재 메서드 호출 [신규 발견]

**심각도**: **CRITICAL** | **난이도**: Low | **예상 시간**: 15분

R6-3에서 상세 설명. 별도 항목으로 분리하여 강조.

파일: `backend/src/services/botService.js` Line 996:
```js
const accountInfo = await this.exchangeClient.getAccountInfo();
```

`exchangeClient.js` 전체 소스에 `getAccountInfo` 메서드가 없다. 존재하는 메서드:
- `getBalances(category)` -- 계정 잔고 조회
- `getCurrentPositions({ category })` -- 현재 포지션 조회

**결과**: 실거래 모드에서 모든 OPEN 신호가 `TypeError`로 크래시 -> qty resolution 실패 -> 주문 0건 실행.

Paper 모드에서는 Line 992-993의 분기로 이 코드에 도달하지 않아 발견되지 않았다:
```js
if (this.paperMode && this.paperPositionManager) {
    equity = String(this.paperPositionManager.getEquity());
}
```

**수정**: R6-3의 구현 방안에 포함됨.

---

### R6-6: [NEW] BotService 실거래 모드 시그널 처리에 await 누락 [신규 발견]

**심각도**: MEDIUM | **난이도**: Low | **예상 시간**: 15분

파일: `backend/src/services/botService.js` Line 1072-1084:
```js
this.orderManager.submitOrder({
    ...signal,
    qty: resolvedQty,
    price: signal.suggestedPrice || signal.price,
    positionSizePercent: signal.suggestedQty,
    resolvedQty,
    sessionId,
}).catch((err) => {
    log.error('orderManager.submitOrder error from strategy signal', {
        strategy: signal.strategy,
        error: err,
    });
});
```

`submitOrder`는 async 함수이고 `.catch()`로 에러를 잡지만, `_handleStrategySignal` 자체가 async이면서 `submitOrder`를 await하지 않는다. 이는 "fire-and-forget" 패턴으로, 다음 문제를 야기:

1. 같은 전략이 빠르게 연속 시그널을 보내면, submitOrder의 per-symbol mutex가 동작하기 전에 `_resolveSignalQuantity`가 동시에 실행될 수 있음
2. `submitOrder` 내부에서 에러가 발생해도 `_handleStrategySignal`의 caller는 알 수 없음
3. BotService.stop()이 호출될 때 pending submitOrder가 완료되기 전에 서비스가 종료될 수 있음

**수정 방안**:
```js
// Add await to ensure sequential signal processing per strategy
try {
    await this.orderManager.submitOrder({
        ...signal,
        qty: resolvedQty,
        price: signal.suggestedPrice || signal.price,
        positionSizePercent: signal.suggestedQty,
        resolvedQty,
        sessionId,
    });
} catch (err) {
    log.error('orderManager.submitOrder error from strategy signal', {
        strategy: signal.strategy,
        error: err,
    });
}
```

---

### R6-7: [NEW] CLOSE 시그널 qty가 퍼센트 값으로 전달되어 거래소에 잘못된 수량 제출 [신규 발견]

**심각도**: HIGH | **난이도**: Medium | **예상 시간**: 30분

R6-3에서 상세 설명. CLOSE 시그널의 `suggestedQty`가 퍼센트 값('5')인데, `_resolveSignalQuantity()`는 CLOSE를 bypass하여 그대로 qty로 사용.

파일: `backend/src/services/botService.js` Line 986-988:
```js
if (signal.action === SIGNAL_ACTIONS.CLOSE_LONG || signal.action === SIGNAL_ACTIONS.CLOSE_SHORT) {
    return signal.suggestedQty || signal.qty || null;
}
```

예시: BTC 0.002개 포지션 보유 중 CLOSE_LONG 시그널 발생 -> qty = '5' (원래 positionSizePercent) -> 거래소에 5 BTC 청산 요청 -> 실제 포지션보다 2500배 큰 수량

Bitget 거래소는 보유 수량 초과 청산 시 에러를 반환하므로 실제 자금 손실은 없겠지만, 주문이 실패하여 포지션이 청산되지 않는 문제 발생.

**수정**: R6-3 구현 방안에 포함 (PositionManager에서 실제 수량 조회).

---

## 제안 사항 (우선순위, 구현 난이도, 예상 시간)

### Sprint R6 구현 목록

| ID | 제목 | 우선순위 | 난이도 | 시간 | 대상 파일 |
|----|------|----------|--------|------|-----------|
| R6-5 | getAccountInfo 크래시 수정 | **CRITICAL** | Low | 15분 | `botService.js` |
| R6-1 | ExposureGuard 시장가 가격 주입 | HIGH | Low | 30분 | `orderManager.js`, `exposureGuard.js` |
| R6-7 | CLOSE 시그널 qty 퍼센트 문제 | HIGH | Medium | 30분 | `botService.js` |
| R6-3 | qty 표준화 (getAccountInfo 포함) | HIGH | Medium | 1시간 | `botService.js` |
| R6-2 | 레버리지 설정 메커니즘 | HIGH | Medium | 1.5시간 | `exchangeClient.js`, `botService.js` |
| R6-4 | positionSide 조기 설정 제거 | HIGH | Low (반복 작업) | 1.5시간 | 15+개 전략 파일 |
| R6-6 | submitOrder await 추가 | MEDIUM | Low | 15분 | `botService.js` |

**총 예상 시간**: ~5.5시간

### 구현 순서 (의존성 기반)

```
Phase 1 (즉시 -- 크래시 수정):
  R6-5: getAccountInfo -> getBalances/PositionManager

Phase 2 (리스크 검증 정상화):
  R6-1: ExposureGuard 가격 주입
  R6-7: CLOSE qty 수정 (R6-3의 일부)
  R6-3: qty 표준화 전체

Phase 3 (레버리지):
  R6-2: setLeverage 구현

Phase 4 (전략 상태 일관성):
  R6-4: positionSide 조기 설정 제거 (15+ 파일)

Phase 5 (품질):
  R6-6: submitOrder await
```

---

## 다른 에이전트에게 요청 사항

### Engineer (Backend)

1. **R6-5 즉시 수정 요청**: `botService.js:996`의 `getAccountInfo()` -> `positionManager.getAccountState().equity` 교체. 이것은 실거래 모드를 완전히 무효화하는 크래시 버그이므로 최우선 수정 대상.

2. **R6-1 ExposureGuard 수정**: 두 파일 변경 필요:
   - `orderManager.js` Line 253: market order 시 `signal.suggestedPrice`를 `price`로 전달
   - `exposureGuard.js` Line 85: `'0'`과 `undefined` 모두 방어하도록 변경

3. **R6-2 setLeverage 구현**: `exchangeClient.js`에 `setLeverage()` 메서드 추가. Bitget API v2 문서의 `setFuturesLeverage` 엔드포인트 참조. `botService.js`의 `start()` 메서드에서 전략 생성 후 호출.

4. **R6-3 qty 표준화**: `_resolveSignalQuantity()`의 실거래 경로 전면 재작성. PositionManager 활용.

5. **R6-4 전략 수정**: 15+ 전략 파일에서 시그널 emit 시점의 `this._positionSide` / `this._entryPrice` 설정 제거. SupertrendStrategy 패턴(onFill에서만 설정)을 표준으로 채택. **각 전략의 onKline 진입 로직에서 "이미 포지션 있으면 skip" 조건이 정상 작동하는지 확인 필요**.

6. **테스트**: 각 수정사항에 대한 단위 테스트 추가:
   - ExposureGuard: market order (price=undefined, price='0') 시나리오
   - botService._resolveSignalQuantity: paper/live 모드, OPEN/CLOSE 시그널
   - 전략 positionSide: 시그널 emit 후 filter 차단 시 상태 확인

### UI (Frontend)

1. **전략 레버리지 표시**: R6-2 구현 후, 전략 설정 패널에 각 전략의 `leverage` 값을 표시. `GET /api/bot/strategies` 응답에 leverage 필드 포함될 예정.

2. **백테스트 disclaimer**: 백테스트 결과 페이지에 "현재 백테스트는 레버리지를 반영하지 않습니다" 안내 추가 권장 (Solo S1 Section 7.1 참조).

---

## 부록: 영향 받는 파일 전체 목록

| 파일 | 변경 유형 | R6 항목 |
|------|-----------|---------|
| `backend/src/services/botService.js` | 수정 (3곳) | R6-3, R6-5, R6-6 |
| `backend/src/services/orderManager.js` | 수정 (1곳) | R6-1 |
| `backend/src/services/exposureGuard.js` | 수정 (1곳) | R6-1 |
| `backend/src/services/exchangeClient.js` | 추가 (1 메서드) | R6-2 |
| `backend/src/strategies/indicator-light/RsiPivotStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-heavy/AdaptiveRegimeStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/MaTrendStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/BollingerReversionStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/VwapReversionStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/gridStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/fundingRateStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-light/MacdDivergenceStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-heavy/BreakoutStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/indicator-heavy/QuietRangeScalpStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/TurtleBreakoutStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/CandlePatternStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/SupportResistanceStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/SwingStructureStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/FibonacciRetracementStrategy.js` | 수정 | R6-4 |
| `backend/src/strategies/price-action/TrendlineBreakoutStrategy.js` | 수정 | R6-4 |

**총 변경 파일**: 20개

---

*End of Round 6 Proposal*
