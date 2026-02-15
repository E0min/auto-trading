# Round 6 Proposal: 실거래 준비도 강화 -- 새 개선과제 발굴

**작성일**: 2026-02-16
**작성자**: Senior Systems Engineer (Claude Opus 4.6)
**범위**: 시스템 무결성, 에러 핸들링, 동시성, 보안, 메모리, 관측성

---

## 분석 요약

Round 1-5에서 구현된 핵심 방어 메커니즘(equity guard, per-symbol mutex, graceful shutdown, PaperEngine listener cleanup, CircuitBreaker array limit, Jest tests, API auth, traceContext, Prometheus metrics)은 안정적으로 작동하고 있다.

그러나 심층 코드 리뷰 결과, **실거래에 직접적으로 영향을 미치는 치명적 버그 2건**, **Trader S1에서 이관된 시스템 레벨 이슈 4건**, 그리고 **새로 발견한 시스템 취약점 8건**을 확인했다. 총 14건 중 5건은 실거래 전 반드시 수정해야 하는 Tier 0/1 수준이다.

### 심각도 분포

| 심각도 | 건수 | 설명 |
|--------|------|------|
| **T0 (즉시 수정)** | 2 | 런타임 크래시를 유발하는 누락 메서드 |
| **T1 (실거래 전 필수)** | 3 | 리스크 계산 오류, 레버리지 미적용, 리소스 누수 |
| **T2 (곧 수정)** | 5 | 메모리 관리, 상태 누적, Socket.io 보안 |
| **T3 (개선)** | 4 | 관측성, 코드 품질, 방어적 프로그래밍 |

---

## 발견 사항

### R6-1. [T0] `riskEngine.getAccountState()` 메서드 부재 -- 런타임 TypeError

**파일**: `backend/src/services/botService.js` 줄 838, 959
**파일**: `backend/src/services/riskEngine.js` (전체)

**문제**: `botService.js`에서 전략에 equity를 주입할 때 `this.riskEngine.getAccountState().equity`를 호출하지만, `RiskEngine` 클래스에는 `getAccountState()` 메서드가 존재하지 않는다. `RiskEngine`에는 `getStatus()`만 있고, 내부적으로 `this.accountState`를 직접 프로퍼티로 관리한다.

```javascript
// botService.js:838 — enableStrategy()에서 호출
getEquity: () => this.riskEngine ? this.riskEngine.getAccountState().equity || '0' : '0',

// botService.js:959 — _createStrategies()에서 호출
getEquity: () => this.riskEngine ? this.riskEngine.getAccountState().equity || '0' : '0',
```

```javascript
// riskEngine.js — getAccountState() 메서드가 없음
// accountState는 this.accountState로 직접 접근 가능하지만 public API가 없음
this.accountState = {
  equity: '0',
  positions: [],
};
```

**영향**: 봇 시작 시 전략이 `getEquity()`를 호출하면 `TypeError: this.riskEngine.getAccountState is not a function`이 발생. Paper mode에서는 `this.paperPositionManager.getEquity()`가 먼저 호출되어 마스킹될 수 있지만, 라이브 모드에서는 크래시.

**수정 방안**: `RiskEngine`에 `getAccountState()` public 메서드 추가:

```javascript
// riskEngine.js에 추가
getAccountState() {
  return {
    equity: this.accountState.equity,
    positions: [...this.accountState.positions],
  };
}
```

**난이도**: 낮음 | **예상 시간**: 10분

---

### R6-2. [T0] `exchangeClient.getAccountInfo()` 메서드 부재 -- 런타임 TypeError

**파일**: `backend/src/services/botService.js` 줄 996
**파일**: `backend/src/services/exchangeClient.js` (전체)

**문제**: `botService._resolveSignalQuantity()`에서 라이브 모드일 때 equity를 가져오기 위해 `this.exchangeClient.getAccountInfo()`를 호출하지만, `ExchangeClient`에는 이 메서드가 존재하지 않는다. `getBalances()` 메서드만 있다.

```javascript
// botService.js:994-998
try {
  const accountInfo = await this.exchangeClient.getAccountInfo();
  equity = accountInfo.equity || accountInfo.totalEquity || '0';
} catch (err) {
  log.error('_resolveSignalQuantity — failed to fetch equity', { error: err.message });
  return null;
}
```

**영향**: 라이브 모드에서 전략 시그널이 발생할 때마다 qty 해결이 실패하여 **모든 시그널이 무시**된다. Paper mode에서는 이 코드 경로에 도달하지 않아 발견되지 않음.

**수정 방안**: `ExchangeClient`에 `getAccountInfo()` 메서드를 추가하거나, `botService._resolveSignalQuantity()`에서 `getBalances()`를 사용하도록 수정. 후자가 더 안전:

```javascript
// botService.js:994-998 수정안
try {
  const response = await this.exchangeClient.getBalances(CATEGORIES.USDT_FUTURES);
  const accounts = Array.isArray(response?.data) ? response.data : [];
  if (accounts.length > 0) {
    equity = String(accounts[0].equity ?? accounts[0].accountEquity ?? accounts[0].usdtEquity ?? '0');
  }
} catch (err) {
  log.error('_resolveSignalQuantity — failed to fetch equity', { error: err.message });
  return null;
}
```

또는 이미 `positionManager._accountState.equity`가 주기적으로 동기화되고 있으므로, 이를 활용:

```javascript
// 더 나은 대안: riskEngine에서 이미 캐시된 equity 사용
equity = this.riskEngine.getAccountState().equity; // R6-1 수정 후
```

**난이도**: 낮음 | **예상 시간**: 15분

---

### R6-3. [T1] ExposureGuard 마켓 오더 price='1' 문제 (S1-1)

**파일**: `backend/src/services/exposureGuard.js` 줄 85
**파일**: `backend/src/services/orderManager.js` 줄 257

**문제**: 마켓 오더는 `price`가 없으므로 `order.price`가 `undefined`/`null`이다. 두 곳에서 이 문제가 발생:

1. **OrderManager** (줄 257): `price: price || '0'`으로 RiskEngine에 전달. price='0'이면 ExposureGuard에서 orderValue가 0이 되어 **어떤 규모의 주문이든 통과**시킨다.

2. **ExposureGuard** (줄 85): `const effectivePrice = order.price || '1'`로 폴백. price='0'이 전달되면 `'0' || '1'`은 JavaScript에서 `'0'`이 falsy가 아니므로 `effectivePrice = '0'`이 된다. 결과적으로 orderValue = qty * 0 = 0이 되어 모든 주문이 통과.

**영향**: 마켓 오더의 포지션 크기 제한이 완전히 무력화된다. 단일 포지션이 equity의 100%를 차지해도 ExposureGuard가 통과시킴.

**수정 방안**:

A. OrderManager에서 마켓 오더의 price를 최신 시장 가격으로 채움:
```javascript
// orderManager.js:_submitOrderInternal() — price 결정 로직 추가
let effectivePrice = price;
if (!effectivePrice && orderType === 'market') {
  // 페이퍼 모드: PaperEngine의 lastPrice 사용
  if (this._paperMode && this._paperEngine) {
    effectivePrice = this._paperEngine.getLastPrice(symbol);
  }
  // 라이브 모드: tickerAggregator에서 가져오거나, 0으로 두고 ExposureGuard가 처리
}

riskResult = this.riskEngine.validateOrder({
  symbol,
  side: actionMapping.side,
  qty,
  price: effectivePrice || '0',
  category,
});
```

B. ExposureGuard에서 price='0'일 때 reject하도록 방어 추가:
```javascript
// exposureGuard.js:validateOrder() 시작 부분
const effectivePrice = order.price && order.price !== '0' ? order.price : null;
if (!effectivePrice) {
  log.warn('Order rejected — price not available for exposure calculation', {
    symbol: order.symbol,
  });
  return { approved: false, reason: 'price_not_available' };
}
```

**권장**: 두 가지 모두 적용. A는 정상 경로, B는 방어적 폴백.

**난이도**: 중간 | **예상 시간**: 30분

---

### R6-4. [T1] 레버리지 관리 메커니즘 부재 (S1-2)

**파일**: `backend/src/services/exchangeClient.js` (전체)
**참조**: 18개 전략 파일 (모두 `leverage` 필드를 시그널에 포함)

**문제**: 18개 전략이 시그널에 `leverage: '2'` ~ `leverage: '5'`를 포함하지만, 이 값은 어디에서도 소비되지 않는다:

1. `ExchangeClient`에 `setLeverage()` 메서드가 없다 (검색 결과 `setLeverage|getLeverage|futuresSetLeverage` 매치 없음).
2. `OrderManager._submitOrderInternal()`에서 `signal.leverage`를 무시한다.
3. `ExchangeClient.placeOrder()`에 leverage 파라미터가 없다.
4. `PaperPositionManager._openPosition()`에서 leverage는 항상 `'1'`로 하드코딩된다.

**영향**:
- **라이브**: 거래소의 기본 레버리지(보통 20x)가 적용됨. 전략이 3x를 의도해도 20x로 실행되어 **청산 리스크 급증**.
- **페이퍼**: 레버리지가 항상 1x로 적용되어 **수익률 과소 추정**, 백테스트/토너먼트 결과가 라이브와 괴리.

**수정 방안**:

A. ExchangeClient에 `setLeverage()` 메서드 추가:
```javascript
// exchangeClient.js
async setLeverage({ category, symbol, leverage, marginCoin = 'USDT' }) {
  const label = 'setLeverage';
  const restClient = getRestClient();

  return this._withRetry(async () => {
    const params = {
      productType: category,
      symbol,
      leverage: String(leverage),
      marginCoin,
    };
    log.trade(`${label} — setting`, { symbol, leverage });
    const response = await restClient.setFuturesLeverage(params);
    log.trade(`${label} — done`, { symbol, leverage });
    return response;
  }, label);
}
```

B. OrderManager에서 주문 전 leverage 설정:
```javascript
// orderManager.js:_submitOrderInternal() — Step 3 이전에 추가
if (signal.leverage && !actionMapping.reduceOnly) {
  try {
    await this.exchangeClient.setLeverage({
      category,
      symbol,
      leverage: signal.leverage,
    });
  } catch (err) {
    log.warn('submitOrder — failed to set leverage (continuing with current)', {
      symbol, leverage: signal.leverage, error: err.message,
    });
  }
}
```

C. PaperPositionManager에서 leverage 반영:
```javascript
// paperPositionManager.js:_openPosition()
const position = {
  ...
  leverage: strategy?.leverage || '1',  // 전략의 leverage 사용
};
```

**난이도**: 중간 | **예상 시간**: 1시간

---

### R6-5. [T1] OrderManager/PositionManager destroy() 미호출 -- 리소스 누수

**파일**: `backend/src/app.js` 줄 461-517 (safeShutdown)
**파일**: `backend/src/services/orderManager.js` 줄 1093-1097
**파일**: `backend/src/services/positionManager.js` 줄 451-456

**문제**: `OrderManager.destroy()`는 `exchangeClient`에서 `ws:order`와 `ws:fill` 리스너를 제거한다. `PositionManager.destroy()`는 `ws:position`과 `ws:account` 리스너를 제거한다. 그러나 `safeShutdown()`에서는 `botService.stop()` 내부에서 `positionManager.stop()`만 호출되고, `destroy()`는 어디서도 호출되지 않는다.

```javascript
// app.js:safeShutdown — botService.stop()만 호출
try {
  await botService.stop('server_shutdown');
} catch (err) { ... }
// orderManager.destroy() 호출 없음
// positionManager.destroy() 호출 없음
```

```javascript
// botService.stop() 내부 — positionManager.stop()만 호출
this.positionManager.stop();  // 줄 543 — 인터벌만 정리, WS 리스너는 남음
```

**영향**:
- 봇 stop -> start 사이클마다 WS 리스너가 누적됨 (exchangeClient는 싱글톤이므로 리스너가 계속 추가됨)
- 메모리 누수 + 중복 이벤트 처리 (같은 주문 업데이트가 2번, 3번 처리)
- 장기 운영 시 `MaxListenersExceededWarning` 발생 가능 (현재 `setMaxListeners` 미설정)

**수정 방안**:

```javascript
// botService.js:stop() — Step 5 이후에 추가
// 5b. Destroy managers (remove WS listeners from singleton exchangeClient)
try {
  this.orderManager.destroy();
} catch (err) {
  log.error('stop — error destroying orderManager', { error: err });
}

if (!this.paperMode) {
  try {
    this.positionManager.destroy();
  } catch (err) {
    log.error('stop — error destroying positionManager', { error: err });
  }
}
```

그리고 OrderManager/PositionManager가 `start()` 시 리스너를 다시 등록하도록 수정하거나, `destroy()` 후 `constructor`를 다시 호출하는 패턴 필요. **더 나은 접근**: stop/start 사이클에서 리스너 등록/해제를 명시적으로 관리.

**난이도**: 중간 | **예상 시간**: 45분

---

### R6-6. [T2] SignalFilter `_activeSignals` 영구 누적 (S1-9)

**파일**: `backend/src/services/signalFilter.js` 줄 64-65, 330-349

**문제**: `_activeSignals` Map은 open 시그널이 통과할 때 항목이 추가되고, close 시그널이 통과할 때 제거된다. 하지만:

1. **비정상 종료**: 전략이 close 시그널을 발생시키지 못한 채 비활성화되면 `_activeSignals`에 stale 항목이 남는다 (예: 레짐 변경으로 전략 deactivate, 긴급 정지).
2. **외부 청산**: 거래소에서 수동으로 포지션을 청산하면 close 시그널이 SignalFilter를 통과하지 않으므로 `_activeSignals`에서 제거되지 않는다.
3. **시간 기반 정리 없음**: `_cleanup()`은 `_recentSignals`만 정리하고 `_activeSignals`는 정리하지 않는다.

```javascript
// signalFilter.js:_cleanup() — _activeSignals 정리 없음
_cleanup(now) {
  const cutoff = now - DUPLICATE_WINDOW_MS * 2;
  this._recentSignals = this._recentSignals.filter((entry) => entry.ts > cutoff);
  // _activeSignals, _lastSignalTime — 정리 없음!
}
```

**영향**: 장기 운영 시 `_activeSignals`에 ghost 항목이 쌓여 새로운 open 시그널이 `conflict` 이유로 영구 차단됨. 봇 재시작 없이는 해소 불가.

**수정 방안**:

```javascript
// signalFilter.js — _cleanup()에 _activeSignals 정리 추가
_cleanup(now) {
  const cutoff = now - DUPLICATE_WINDOW_MS * 2;
  this._recentSignals = this._recentSignals.filter((entry) => entry.ts > cutoff);

  // _activeSignals: 30분 이상 된 항목 제거 (정상적이라면 이미 close됨)
  // 이를 위해 _activeSignals에 타임스탬프 추가 필요
}
```

더 나은 접근: `_activeSignals`를 `Map<string, Map<string, number>>`로 변경하여 각 항목에 타임스탬프 저장:

```javascript
// 개선된 구조
// _activeSignals: Map<symbol, Map<strategyAction, timestamp>>
// _cleanup에서 MAX_ACTIVE_SIGNAL_AGE_MS (기본 30분) 초과 항목 제거

const MAX_ACTIVE_SIGNAL_AGE_MS = 30 * 60 * 1000;

_cleanup(now) {
  // ... 기존 _recentSignals 정리

  for (const [symbol, entries] of this._activeSignals) {
    for (const [key, ts] of entries) {
      if (now - ts > MAX_ACTIVE_SIGNAL_AGE_MS) {
        entries.delete(key);
        log.warn('Stale activeSignal removed', { symbol, key, ageMs: now - ts });
      }
    }
    if (entries.size === 0) this._activeSignals.delete(symbol);
  }
}
```

`_lastSignalTime`도 비슷하게 오래된 항목(등록되지 않은 전략)을 정리해야 한다.

**난이도**: 중간 | **예상 시간**: 30분

---

### R6-7. [T2] Socket.io CORS origin이 `'*'`로 하드코딩

**파일**: `backend/src/app.js` 줄 318-323

**문제**: Socket.io 서버의 CORS origin이 항상 `'*'`로 설정되어 있다. HTTP CORS는 `process.env.CORS_ORIGIN`을 참조하지만, Socket.io는 이를 무시한다.

```javascript
// app.js:318-323
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',  // 환경변수 미참조!
    methods: ['GET', 'POST'],
  },
});
```

**영향**: API_KEY 인증이 있더라도 Socket.io는 인증을 거치지 않으므로, 아무 오리진에서든 WebSocket 연결을 맺고 실시간 거래 데이터를 수신할 수 있다. 공격자가 포지션/주문/계좌 정보를 실시간으로 도청 가능.

**수정 방안**:

```javascript
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// Socket.io 연결 시 API_KEY 검증 추가
if (API_KEY) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));

    const keyBuffer = Buffer.from(API_KEY, 'utf-8');
    const tokenBuffer = Buffer.from(token, 'utf-8');
    if (keyBuffer.length !== tokenBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, tokenBuffer)) {
      return next(new Error('Invalid API key'));
    }
    next();
  });
}
```

프론트엔드에서도 연결 시 토큰 전달 필요:
```typescript
// frontend/src/lib/socket.ts
const socket = io(url, {
  auth: { token: process.env.NEXT_PUBLIC_API_KEY },
});
```

**난이도**: 중간 | **예상 시간**: 30분

---

### R6-8. [T2] 고빈도 Socket.io `market:ticker` 이벤트 -- 대역폭 폭발

**파일**: `backend/src/app.js` 줄 383-385

**문제**: `marketData`의 모든 ticker 업데이트가 필터 없이 Socket.io로 브로드캐스트된다. Bitget WS는 선택된 심볼마다 초당 1-5회 ticker를 보내므로, 10개 심볼이면 초당 10-50개의 Socket.io 이벤트가 모든 연결된 클라이언트에 전송된다.

```javascript
// app.js:383-385 — 모든 ticker를 무조건 브로드캐스트
marketData.on(MARKET_EVENTS.TICKER_UPDATE, (data) => {
  io.emit('market:ticker', data);
});
```

**영향**:
- 프론트엔드가 불필요한 데이터 처리로 UI 렉 발생
- 서버 CPU/메모리 부하 (JSON 직렬화 반복)
- 네트워크 대역폭 낭비

**수정 방안**: Throttle 적용:

```javascript
// 심볼당 최대 1초에 1번 전송
const _lastTickerEmit = new Map();
const TICKER_THROTTLE_MS = 1000;

marketData.on(MARKET_EVENTS.TICKER_UPDATE, (data) => {
  const now = Date.now();
  const lastEmit = _lastTickerEmit.get(data.symbol) || 0;
  if (now - lastEmit < TICKER_THROTTLE_MS) return;
  _lastTickerEmit.set(data.symbol, now);
  io.emit('market:ticker', data);
});
```

**난이도**: 낮음 | **예상 시간**: 15분

---

### R6-9. [T2] PaperEngine `_pendingOrders`와 `_pendingSLOrders` 미정리

**파일**: `backend/src/services/paperEngine.js`

**문제**: `PaperEngine`에는 `_pendingOrders` (리밋 오더)와 `_pendingSLOrders` (스탑로스) Map이 있지만, 봇이 stop될 때 이 Map들이 정리되지 않는다. `PaperEngine`에는 `stop()` 또는 `destroy()` 메서드가 없다.

또한, 봇 stop -> start 사이클에서 `paperEngine` 인스턴스는 재사용되므로 (app.js에서 한번만 생성), 이전 세션의 pending 오더가 새 세션에서 fill될 수 있다.

```javascript
// paperEngine.js — stop/destroy/reset 메서드 없음
// _pendingOrders, _pendingSLOrders, _lastPrices 모두 이전 세션 데이터 잔존
```

**영향**: 이전 세션의 리밋 오더가 새 세션에서 fill되어 의도하지 않은 포지션 생성.

**수정 방안**:

```javascript
// paperEngine.js — reset() 메서드 추가
reset() {
  const pendingCount = this._pendingOrders.size;
  const slCount = this._pendingSLOrders.size;

  this._pendingOrders.clear();
  this._pendingSLOrders.clear();
  this._lastPrices.clear();

  log.info('PaperEngine reset', { clearedOrders: pendingCount, clearedSL: slCount });
}
```

```javascript
// botService.js:stop() — paperEngine 리셋 추가
if (this.paperMode && this.paperEngine) {
  try {
    this.paperEngine.reset();
  } catch (err) {
    log.error('stop — error resetting paperEngine', { error: err });
  }
}
```

**난이도**: 낮음 | **예상 시간**: 15분

---

### R6-10. [T2] IndicatorCache 심볼 데이터 영구 누적

**파일**: `backend/src/services/indicatorCache.js` 줄 56, 149-191

**문제**: `IndicatorCache._data` Map은 새로운 심볼의 kline이 들어올 때마다 항목을 추가하지만, 심볼이 unsubscribe되거나 봇이 stop될 때 정리하지 않는다. `stop()`에서 `_data.clear()`를 호출하지만, **봇 start -> stop -> start 사이클에서 _data가 정리된 후 다시 쌓이는 것은 정상**. 그러나 `start()`를 호출하지 않고 kline 이벤트가 계속 들어오는 경우(race condition)나, 여러 번의 심볼 변경으로 이전 심볼의 데이터가 500개 kline까지 누적되는 것은 문제.

더 중요한 문제: `botService.stop()`에서 `indicatorCache.stop()` 후에도 `marketData`의 kline 이벤트가 계속 발생할 수 있다 (stop 순서가 indicatorCache -> marketData). `indicatorCache.stop()`은 리스너를 제거하므로 이 부분은 안전하다. **그러나** `start()` 호출 없이 `get()`을 호출하면 빈 결과를 반환할 뿐 에러는 없으므로 이 부분은 안전.

실제 문제는 `_data` Map의 각 심볼에 대해 500개 kline 데이터 + 500개 close/high/low/volume 배열이 유지되고, 각 kline마다 cache Map이 clear되는데, **GC 부하**가 있다는 점. 10개 심볼 x 500 klines x 5 arrays = 25,000개 문자열이 메모리에 상주. 이 자체는 문제 아님.

**실제 발견**: `_handleKline`에서 `splice(0, excess)`를 사용하는데, 이는 O(n) 연산이다. 500개 배열에서 1개를 제거하는 것이라 실질적으로 매 kline마다 O(500) 복사 발생.

**수정 방안**: ring buffer 패턴으로 개선 (T3 수준, 현재 성능 영향 미미).

**난이도**: 낮음 | **예상 시간**: N/A (현재 수준 수용 가능)

---

### R6-11. [T2] `_strategyMeta` 정리 안됨 -- SignalFilter 메모리 누적

**파일**: `backend/src/services/signalFilter.js`

**문제**: `signalFilter.reset()`은 `_lastSignalTime`, `_recentSignals`, `_positionCounts`, `_activeSignals`, `_stats`를 모두 정리하지만 **`_strategyMeta`는 정리하지 않는다**. `_strategyMeta`는 `registerStrategy()`로만 추가되고 삭제 방법이 없다.

```javascript
// signalFilter.js:430-438
reset() {
  this._lastSignalTime.clear();
  this._recentSignals = [];
  this._positionCounts.clear();
  this._activeSignals.clear();
  this._stats = { total: 0, passed: 0, blocked: 0 };
  // this._strategyMeta — 정리하지 않음!
  log.info('SignalFilter reset');
}
```

**영향**: 봇 start -> stop -> start 사이클에서 이전 세션의 전략 메타데이터가 남아있음. 전략 이름이 변경되면 오래된 메타데이터가 영구 누적. 실질적 메모리 영향은 미미하나, `getStatus()`에서 오래된 전략이 계속 표시됨.

**수정 방안**: `reset()`에 `_strategyMeta.clear()` 추가.

**난이도**: 낮음 | **예상 시간**: 5분

---

### R6-12. [T3] EventEmitter maxListeners 미설정

**파일**: `backend/src/services/exchangeClient.js` (싱글톤)
**파일**: `backend/src/services/marketData.js`

**문제**: `exchangeClient`는 싱글톤이고 `MarketData`, `OrderManager`, `PositionManager`, `HealthCheck` 등 여러 서비스가 이벤트를 구독한다. Node.js 기본 maxListeners는 10인데, 봇 start/stop 사이클에서 리스너가 누적되면 (R6-5 관련) 경고가 발생한다.

**수정 방안**:
```javascript
// exchangeClient.js constructor
this.setMaxListeners(20);
```

또는 R6-5를 먼저 수정하여 리스너 누적을 방지한 후 관찰.

**난이도**: 낮음 | **예상 시간**: 5분

---

### R6-13. [T3] botService._resolveSignalQuantity() 비효율적 API 호출

**파일**: `backend/src/services/botService.js` 줄 984-1027

**문제**: 라이브 모드에서 매 시그널마다 `exchangeClient.getAccountInfo()` (수정 후 `getBalances()`)를 호출한다. 활발한 시장에서 18개 전략이 각각 시그널을 발생시키면 분당 수십 건의 불필요한 REST API 호출이 발생하여 rate limit에 걸릴 수 있다.

**수정 방안**: `positionManager._accountState.equity`를 활용 (이미 30초마다 동기화됨) 또는 R6-1에서 추가한 `riskEngine.getAccountState().equity`를 사용.

```javascript
// botService.js:_resolveSignalQuantity() 개선
async _resolveSignalQuantity(signal) {
  if (signal.action === SIGNAL_ACTIONS.CLOSE_LONG || signal.action === SIGNAL_ACTIONS.CLOSE_SHORT) {
    return signal.suggestedQty || signal.qty || null;
  }

  let equity;
  if (this.paperMode && this.paperPositionManager) {
    equity = String(this.paperPositionManager.getEquity());
  } else {
    // riskEngine에 캐시된 equity 사용 (positionManager가 30초마다 갱신)
    equity = this.riskEngine.getAccountState().equity;
  }
  // ... 나머지 동일
}
```

**난이도**: 낮음 | **예상 시간**: 10분

---

### R6-14. [T3] Order qty 표준화 레이어 부재 (S1-3)

**파일**: `backend/src/services/botService.js` 줄 1019-1022
**파일**: `backend/src/services/exchangeClient.js`

**문제**: `_resolveSignalQuantity()`에서 `floorToStep(qty, '0.0001')`로 qty를 정규화하지만, 실제 거래소의 심볼별 lot step (최소 주문 단위)을 사용하지 않는다. 예를 들어:
- BTCUSDT: min qty = 0.001, step = 0.001
- DOGEUSDT: min qty = 1, step = 1
- SHIBUSDT: min qty = 100, step = 100

`'0.0001'` 스텝으로 floor하면 BTCUSDT에서는 불필요하게 정밀하고, DOGEUSDT에서는 `0.5`같은 불가능한 qty가 제출되어 거래소가 reject한다.

**수정 방안**:

Phase 1: `exchangeClient.getInstruments()`로 심볼별 lot info를 캐시하는 서비스 생성:

```javascript
// 새 서비스: InstrumentCache
class InstrumentCache {
  constructor({ exchangeClient }) {
    this._exchangeClient = exchangeClient;
    this._instruments = new Map(); // symbol → { minQty, qtyStep, minNotional }
  }

  async refresh(category) {
    const resp = await this._exchangeClient.getInstruments({ category });
    for (const inst of resp.data || []) {
      this._instruments.set(inst.symbol, {
        minQty: String(inst.minTradeNum || inst.minOrderAmount || '0.001'),
        qtyStep: String(inst.sizeMultiplier || inst.volumePlace
          ? `0.${'0'.repeat((inst.volumePlace || 4) - 1)}1` : '0.001'),
        minNotional: String(inst.minTradeUSDT || '5'),
      });
    }
  }

  getLotInfo(symbol) {
    return this._instruments.get(symbol) || { minQty: '0.001', qtyStep: '0.001', minNotional: '5' };
  }
}
```

Phase 2: `_resolveSignalQuantity()`에서 InstrumentCache 사용.

**난이도**: 높음 | **예상 시간**: 2시간

---

## 제안 사항 (우선순위)

### 즉시 수정 (T0) -- 실거래 전 반드시

| ID | 제목 | 난이도 | 시간 |
|----|------|--------|------|
| R6-1 | `riskEngine.getAccountState()` 추가 | 낮음 | 10분 |
| R6-2 | `exchangeClient.getAccountInfo()` -> `getBalances()` 수정 | 낮음 | 15분 |

### 실거래 전 필수 (T1)

| ID | 제목 | 난이도 | 시간 |
|----|------|--------|------|
| R6-3 | ExposureGuard 마켓오더 price 주입 | 중간 | 30분 |
| R6-4 | 레버리지 관리 메커니즘 구현 | 중간 | 1시간 |
| R6-5 | OrderManager/PositionManager destroy() 호출 | 중간 | 45분 |

### 곧 수정 (T2)

| ID | 제목 | 난이도 | 시간 |
|----|------|--------|------|
| R6-6 | SignalFilter `_activeSignals` stale 정리 | 중간 | 30분 |
| R6-7 | Socket.io CORS + 인증 | 중간 | 30분 |
| R6-8 | Socket.io ticker throttle | 낮음 | 15분 |
| R6-9 | PaperEngine reset() 추가 | 낮음 | 15분 |
| R6-11 | SignalFilter `_strategyMeta` 정리 | 낮음 | 5분 |

### 개선 (T3)

| ID | 제목 | 난이도 | 시간 |
|----|------|--------|------|
| R6-12 | EventEmitter maxListeners 설정 | 낮음 | 5분 |
| R6-13 | _resolveSignalQuantity API 호출 제거 | 낮음 | 10분 |
| R6-14 | InstrumentCache (심볼별 lot step) | 높음 | 2시간 |

**총 예상 시간**: T0+T1 = ~2시간 30분, T2 = ~1시간 35분, T3 = ~2시간 15분

---

## 구현 순서 권장

1. **Phase A (T0)**: R6-1, R6-2 -- 크래시 버그 수정 (25분)
2. **Phase B (T1-core)**: R6-3, R6-5 -- 리스크 계산 정상화 + 리소스 누수 수정 (1시간 15분)
3. **Phase C (T1-leverage)**: R6-4 -- 레버리지 관리 (1시간)
4. **Phase D (T2-quick)**: R6-8, R6-9, R6-11 -- 빠른 수정 모음 (35분)
5. **Phase E (T2-security)**: R6-7 -- Socket.io 보안 (30분)
6. **Phase F (T2-filter)**: R6-6 -- SignalFilter stale 정리 (30분)
7. **Phase G (T3)**: R6-12, R6-13, R6-14 -- 관측성/효율성/표준화 (2시간 15분)

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게

1. **R6-4 연계**: 각 전략의 `leverage` 값이 의도된 값인지 확인 요청. 현재 전략별 레버리지가 2x~5x로 설정되어 있는데, 이것이 거래소에 설정되지 않은 채 기본값(아마도 20x)으로 실행될 경우의 위험도 재평가.

2. **R6-3 연계**: 전략 시그널에 `suggestedPrice`가 항상 포함되는지 확인. 마켓 오더의 경우 `suggestedPrice`가 없으면 ExposureGuard 계산이 불가능. 전략이 현재 가격을 `suggestedPrice`에 항상 포함하도록 보장해야 함.

3. **R6-14 연계**: 전략이 생성하는 `suggestedQty`가 "equity의 %"인지 "절대 수량"인지 명확한 계약(contract) 정의 필요. 현재 모든 전략이 `positionSizePercent` (예: '3', '4', '5')를 `suggestedQty`에 넣고 있어 `botService._resolveSignalQuantity()`에서 % -> absolute 변환하는 것은 확인됨. 하지만 CLOSE 시그널의 `suggestedQty`는 무엇인지 (실제 보유 수량? 아니면 %?) 명확화 필요.

### UI 에이전트에게

1. **R6-7 연계**: Socket.io 연결에 API_KEY 인증이 추가되면, 프론트엔드의 Socket.io 클라이언트에서 `auth.token`을 전달하도록 수정 필요.

2. **R6-8 연계**: ticker throttle이 적용되면 UI의 ticker 업데이트 빈도가 줄어들 수 있으므로 사용자 경험에 영향이 없는지 확인.

---

## Round 1-5 변경사항 회귀 분석

| 항목 | 상태 | 비고 |
|------|------|------|
| T0-4 unhandledRejection handler | OK | app.js:524-535 정상 동작 |
| T0-5 per-symbol mutex | OK | orderManager.js:172-201, Lock timeout 30초 |
| T0-6 equity=0 guard | OK | riskEngine.js:96-106 |
| T0-4 graceful shutdown | **주의** | R6-5에서 발견한 destroy() 미호출 이슈 |
| T1-1 PaperEngine listener cleanup | OK | orderManager.js:127-129 |
| T1-3 CircuitBreaker array limit | OK | circuitBreaker.js:74-77, MAX_RAPID_LOSSES=500 |
| T3-2 API auth (timingSafeEqual) | OK | apiKeyAuth.js:48-52 |
| T3-5 Prometheus metrics | OK | metrics.js 확인 필요 |
| T3-7 traceContext | OK | traceContext.js:17-48, AsyncLocalStorage 기반 |

**T0-4 회귀**: graceful shutdown에서 `botService.stop()`은 호출되지만, `orderManager.destroy()`와 `positionManager.destroy()`가 호출되지 않아 WS 리스너가 잔존. 이전 라운드에서 이 부분을 놓침 (R6-5로 해결).

---

## 결론

Round 6에서 발견된 이슈 중 **R6-1과 R6-2는 실거래 모드에서 즉각적인 런타임 크래시를 유발하는 치명적 버그**로, Paper mode에서는 코드 경로가 다르기 때문에 발견되지 않았다. 이 두 건은 실거래 전환 전에 반드시 수정되어야 한다.

**R6-3 (ExposureGuard price='1')과 R6-4 (leverage 미적용)**은 리스크 관리 계산을 근본적으로 훼손하여 **과도한 포지션 크기와 비의도적 고레버리지**로 이어질 수 있는 T1 이슈다.

R6-5 (destroy 미호출)는 장기 운영 시 메모리 누수와 중복 이벤트 처리를 유발하므로 안정적 운영을 위해 필수 수정 대상이다.

T0+T1 총 5건의 수정에 약 2시간 30분이 소요되며, 이를 통해 시스템의 실거래 준비도가 현재의 "Paper-only safe"에서 "Live-ready with caveats"로 격상된다.
