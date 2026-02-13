# Round 1 Cross-Review -- Senior Systems Engineer

> Reviewer: Agent 2 (Systems Engineer)
> Date: 2026-02-13
> Scope: Cross-review of Trader (Agent 1) and UI (Agent 3) Round 1 proposals from a systems-engineering perspective (reliability, concurrency, performance, memory, security, observability)

---

## Trader (Agent 1) Proposal Review

### Critical Issues Evaluation

#### C1. Multi-Symbol Support Is Fundamentally Broken

**Verdict: AGREE -- This is the #1 system-level critical bug.**

I independently flagged this in a different form (graceful shutdown ordering), but the Trader's analysis is precise. Verified in code:

- `strategyBase.js:106` -- `this._symbol = symbol` is a scalar overwrite
- `strategyRouter.js:141-143` -- loops over symbols calling `activate()`, each call overwrites the previous
- `botService.js:254` -- `strategy._symbol === ticker.symbol` routes to only the last symbol
- `botService.js:595-601` (`resume()`) -- same loop pattern, same bug

**Engineering implementation recommendation -- Option A (one instance per symbol) is correct:**

```js
// In botService._createStrategies() or strategyRouter.start()
_createStrategies(config) {
  const strategyNames = config.strategies || [];
  const strategies = [];

  for (const name of strategyNames) {
    // Create one instance per strategy. The StrategyRouter will handle
    // per-symbol activation via a _symbols Set (see below).
    const strategy = registry.create(name, strategyConfig);
    strategies.push(strategy);
  }
  return strategies;
}
```

However, **one-instance-per-symbol creates O(strategies * symbols) instances** (e.g., 10 strategies * 10 symbols = 100 instances). Each instance holds its own kline buffer, indicator history, and position state. At 50 klines per buffer * 10 fields * 8 bytes, this is manageable (~400KB total), but:

- **Memory concern:** Each strategy's `_klineHistory` can grow to 500+ entries. With 100 instances: ~50K kline objects in memory. Not critical, but warrants a `maxHistoryLength` cap.
- **CPU concern:** Each tick event iterates all 100 instances. If `onTick()` computes indicators synchronously, a single ticker update could block the event loop for 10-50ms. Add a `process.nextTick()` yield every N strategies.
- **Concurrency concern:** All 100 instances call `getSignal()` which may emit signals simultaneously. Without a mutex on `orderManager.submitOrder()`, we could get race conditions (my original C-2 finding).

**Recommended architecture: Set-based symbols + single instance per strategy**

```js
// strategyBase.js
activate(symbol, category) {
  if (!this._symbols) this._symbols = new Set();
  this._symbols.add(symbol);
  this._category = category;
  this._active = true;
}

deactivate(symbol) {
  if (symbol) {
    this._symbols.delete(symbol);
    if (this._symbols.size === 0) this._active = false;
  } else {
    // Deactivate all
    this._symbols.clear();
    this._active = false;
  }
}

isSubscribedTo(symbol) {
  return this._symbols && this._symbols.has(symbol);
}
```

Then in `botService.js:254`:
```js
if (strategy.isActive() && strategy.isSubscribedTo(ticker.symbol)) {
```

This avoids the 100-instance explosion while solving the routing bug. Each strategy maintains per-symbol state internally (keyed maps for kline history, position tracking, etc.). Strategies that cannot handle multi-symbol can opt into the per-instance model via a metadata flag `multiSymbol: false`.

---

#### C2. Position Sizing Disconnect -- Percentage vs Quantity

**Verdict: AGREE -- This is the #2 system-level critical bug, and it compounds with my C-3 (ExposureGuard division by zero).**

Verified in code:
- `botService.js:320-322` passes `qty: signal.suggestedQty` directly to `orderManager.submitOrder()`
- `orderManager.js:171` destructures it as `qty` and passes to `riskEngine.validateOrder()`
- `exposureGuard.js:107` computes `orderValue = multiply(qty, effectivePrice)` -- treating qty as absolute units

The Trader's fix (resolve percentage to quantity in botService before passing to orderManager) is the correct approach. However, there are additional system-level concerns:

1. **Where to resolve?** It MUST happen before `riskEngine.validateOrder()`, which means in `botService.js` between signal filter and `orderManager.submitOrder()`. NOT inside orderManager, because riskEngine needs the absolute qty.

2. **Price source for conversion:** The signal's `suggestedPrice` may be stale by the time the order executes. For market orders, use the latest ticker price from `tickerAggregator` or `marketData`. For limit orders, use `suggestedPrice`.

3. **Contract size / lot size:** Bitget USDT-FUTURES have a `sizeMultiplier` (e.g., BTC is quoted in contracts where 1 contract = 0.01 BTC). The resolved quantity must be rounded to the exchange's lot precision. `exchangeClient` should provide a `getSymbolInfo(symbol)` method returning `{ sizeMultiplier, pricePrecision, qtyPrecision, minQty }`.

**Complete resolution function:**

```js
// In botService.js, add a _resolveOrderQty method:
_resolveOrderQty(signal) {
  const pctString = signal.suggestedQty || signal.positionSizePercent;
  if (!pctString || pctString === '0') return '0';

  // Get current equity
  const equity = this.riskEngine.accountState.equity;
  if (!equity || equity === '0') {
    log.error('Cannot resolve order qty -- equity is 0');
    return '0';
  }

  // Get current price for the symbol
  const latestPrice = signal.suggestedPrice
    || this.tickerAggregator.getLatestPrice(signal.symbol);
  if (!latestPrice || latestPrice === '0') {
    log.error('Cannot resolve order qty -- no price available', { symbol: signal.symbol });
    return '0';
  }

  // Convert percentage to notional value, then to quantity
  const notionalValue = math.multiply(equity, math.divide(pctString, '100'));
  const rawQty = math.divide(notionalValue, latestPrice);

  // Round to exchange precision (TODO: get from exchangeClient.getSymbolInfo)
  return math.toFixed(rawQty, 6);
}
```

---

#### C3. Backtest Fill Notification Missing `action` Field

**Verdict: AGREE**

Verified at `backtestEngine.js:722-729`. The `_notifyFill(side, price)` signature lacks the `action` parameter. This is straightforward to fix as the Trader describes. No system-level concerns beyond the fix itself.

One addition: the backtest engine should also pass `{ symbol, qty, fee, timestamp }` in the fill object to give strategies full context. Several strategies track position size internally and need qty for partial close logic.

---

#### C4. Backtest Ignores IndicatorCache

**Verdict: AGREE -- but with SIGNIFICANT implementation concerns.**

The Trader's fix creates a mock IndicatorCache per backtest run. This works but has system implications:

1. **IndicatorCache listens to MARKET_EVENTS.KLINE_UPDATE.** In backtest, we need to emit synthetic events. The Trader's `mockMarketData` approach is correct but must ensure the IndicatorCache processes each kline **synchronously before** the strategy's `onKline()` is called. If IndicatorCache uses async operations or setImmediate internally, there's a race condition.

2. **Memory:** IndicatorCache stores indicator histories per symbol per indicator type. For a 1-year backtest with 1H candles (8,760 klines), each indicator type stores ~8,760 values. With 8+ indicator types, that's ~70K entries per run. For bulk backtests (18 strategies), this needs explicit cleanup.

3. **Better approach -- inject cache via strategy constructor, not post-hoc:**

```js
// In BacktestEngine constructor:
const IndicatorCache = require('../services/indicatorCache');
const { EventEmitter } = require('events');

this._mockMarketData = new EventEmitter();
this._indicatorCache = new IndicatorCache({ marketData: this._mockMarketData });
this._indicatorCache.start();

// When creating the strategy:
const strategy = registry.create(strategyName, strategyConfig);
strategy.setIndicatorCache(this._indicatorCache);

// In the kline processing loop, BEFORE strategy.onKline():
this._mockMarketData.emit(MARKET_EVENTS.KLINE_UPDATE, {
  symbol: this.symbol,
  ...kline,
});

// After run() completes:
this._indicatorCache.stop();
this._mockMarketData.removeAllListeners();
```

---

#### C5. Default Strategy Names Don't Exist

**Verdict: AGREE**

Verified at `botService.js:896`: `['MomentumStrategy', 'MeanReversionStrategy']` -- neither exists in the registry. This is a **silent failure** (the `registry.has(name)` check logs a warning but continues), resulting in an empty strategies array.

The system-level fix should go beyond just updating the names:

```js
_createStrategies(config) {
  const strategyNames = config.strategies;

  if (!strategyNames || strategyNames.length === 0) {
    throw new Error('No strategies specified in config. Explicit strategy selection is required.');
  }

  // ... rest of creation logic ...

  if (strategies.length === 0) {
    throw new Error(`No valid strategies could be created from: ${strategyNames.join(', ')}`);
  }

  return strategies;
}
```

Failing loudly is critical for a financial system. Silent degradation is far worse than a crash.

---

### High-Priority Evaluation

#### H1. Sharpe Ratio Inflated for Sub-Daily Data

**Verdict: AGREE -- minor but important for decision-making.**

The Trader's fix is correct. One system note: the `intervalMs` calculation assumes uniform spacing in the equity curve. If the backtest skips weekends or has gaps, the interval between the first two points may not be representative. Use the median interval or derive from the kline interval parameter.

#### H2. RSI Uses Simple Average Instead of Wilder Smoothing

**Verdict: CONDITIONAL AGREE**

The Trader is technically correct about the algorithm difference. However, the Wilder-smoothed RSI implementation proposed uses **incremental state** (`avgGain`, `avgLoss` updated per bar), which means:

1. The function must receive the **full price history** and compute from scratch each time. This is O(N) per call. With 18 strategies potentially calling RSI on different windows, and each kline triggering recalculation, this is computationally expensive.

2. **The IndicatorCache should own RSI computation** and store incremental state. Individual strategy calls to `indicators.rsi()` should use cached values. This is a design change, not just a function replacement.

3. **All strategies using RSI need re-tuning** after this change. RSI thresholds (30/70, 35/65, etc.) were calibrated against the current noisy implementation. Wilder RSI is smoother and reaches extremes less frequently. If we change RSI without adjusting thresholds, signal frequency will drop significantly.

**Recommendation:** Implement Wilder RSI in `indicators.js`, but add a `smoothing` parameter (default `'wilder'`, option `'sma'`) for backward compatibility. Update IndicatorCache to compute incrementally. Adjust strategy thresholds in a separate pass.

#### H3. No Confidence-Based Signal Filtering

**Verdict: CONDITIONAL AGREE**

Adding a minimum confidence filter is sensible, but the threshold (0.50) should be **configurable per strategy** via metadata, not a global default. Some strategies (GridStrategy, TurtleBreakout) produce binary signals (confidence is always 0.8+), while others (MACD Divergence, Candle Patterns) produce graduated confidence. A single threshold penalizes the latter.

**System concern:** The confidence filter should be **the first filter** in the pipeline (before cooldown, duplicate, etc.) to short-circuit as early as possible and avoid wasting CPU on subsequent checks for signals that will be rejected anyway.

#### H4. ExposureGuard Receives Percentage as Quantity

**Verdict: AGREE -- same root cause as C2.**

This is not a separate issue but a downstream consequence. Once C2 is fixed (percentage resolved to quantity before reaching orderManager/riskEngine), H4 is automatically resolved.

However, I want to flag an additional issue the Trader found but understated: **`effectivePrice = order.price || '1'`** at `exposureGuard.js:78`. For market orders, `order.price` is typically undefined (the strategy wants market execution). The fallback to `'1'` makes `orderValue = qty * 1 = qty`, which is meaningless. This needs the latest market price as fallback:

```js
const effectivePrice = order.price
  || (this._latestPrices && this._latestPrices.get(order.symbol))
  || '1'; // Last resort, but should log.error
```

#### H5. Backtest 95% Position Size

**Verdict: AGREE**

The default `DEFAULT_POSITION_SIZE_PCT = '95'` is unrealistic. Should use the strategy's `metadata.defaultConfig.positionSizePercent` or a configurable backtest parameter.

#### H6. Signal Filter Memory Leak

**Verdict: AGREE -- and this intersects with my H-3 finding (PaperEngine listener accumulation).**

The Trader's TTL-based cleanup is the right approach. Additionally, the cleanup should be triggered on a `setInterval` (e.g., every 5 minutes) rather than on every `filter()` call, to avoid adding overhead to the hot path:

```js
constructor() {
  super();
  // ... existing init ...
  this._cleanupTimer = setInterval(() => this._cleanupStaleSignals(), 300000);
}

stop() {
  clearInterval(this._cleanupTimer);
}
```

**Important:** The `stop()` method must clear this interval. This is a classic resource leak pattern in Node.js -- timers that outlive the service lifecycle.

#### H7. DrawdownMonitor Never Auto-Recovers

**Verdict: CONDITIONAL AGREE**

The Trader suggests a `resetDrawdown()` method with manual reset capability. I agree this is needed, but **automatic recovery is dangerous for a financial system.** If the max drawdown was triggered legitimately, auto-recovering and continuing to trade could compound losses.

The correct approach is:
1. **Manual reset only** via an authenticated API endpoint (not just a method call)
2. **Logged and audited** -- every drawdown reset should be recorded with timestamp, user action, and reason
3. **Progressive cooldown** -- after a drawdown halt, the next trading session should start with reduced position sizes (e.g., 50% of normal) for the first 2 hours

---

### Per-Strategy Reviews -- System-Level Issues

The Trader identified several recurring patterns across strategies that have system-level implications:

#### 1. `onFill()` handler inconsistency (affects 14/18 strategies)

Some strategies use `fill.action` (SIGNAL_ACTIONS enum), others use `fill.side` ('buy'/'sell'). This is a **systemic API contract violation**. The fix must be:

1. Define a canonical `Fill` interface in `constants.js`:
```js
const FILL_SHAPE = {
  action: 'string',  // SIGNAL_ACTIONS value
  side: 'string',    // 'buy' or 'sell'
  price: 'string',
  qty: 'string',
  symbol: 'string',
  fee: 'string',
  timestamp: 'number',
};
```

2. Both live fills (via exchangeClient WS) and backtest fills must conform to this shape.
3. Each strategy's `onFill()` must be updated to use `fill.action` as the primary discriminator.

#### 2. GridStrategy equity never set (`this.config.equity` is undefined)

This is a **DI gap**. The `_createStrategies()` method creates strategy instances but doesn't inject runtime context (equity, account state). Fix:

```js
// In botService._createStrategies, after creation:
strategy.setRuntimeContext({
  getEquity: () => this.riskEngine.accountState.equity,
  getPositions: () => this.riskEngine.accountState.positions,
});
```

This uses a getter pattern so the strategy always reads current values, not stale ones from creation time.

#### 3. FundingRate data never arrives (E6)

The Trader correctly identified that funding rate is NOT included in the standard ticker WebSocket payload. This is a **data pipeline gap**, not a strategy bug. The fix must be at the `MarketData` or `ExchangeClient` level:

```js
// In exchangeClient.js or a new FundingDataService:
async fetchFundingRates(symbols) {
  // REST call: GET /api/v2/mix/market/current-fund-rate
  // Schedule this on a 5-minute interval
}
```

The funding rate data should flow through `MarketData` events (e.g., `MARKET_EVENTS.FUNDING_UPDATE`) so all strategies can optionally consume it.

---

### Issues the Trader Missed

#### TM-1. No `submitOrder()` concurrency control (my original C-2)

The Trader identified C2 (qty/percentage confusion) but missed the concurrent execution risk. If two strategies emit signals for the same symbol within the same event loop tick, two `submitOrder()` calls execute concurrently. Both pass the ExposureGuard check (neither sees the other's pending order), and both get submitted. This is a **double-spend** scenario.

**Fix:** Add a per-symbol async mutex to `orderManager.submitOrder()`:

```js
const locks = new Map();

async submitOrder(signal) {
  const lockKey = signal.symbol;
  while (locks.get(lockKey)) {
    await locks.get(lockKey);
  }

  let resolve;
  locks.set(lockKey, new Promise(r => { resolve = r; }));

  try {
    return await this._doSubmitOrder(signal);
  } finally {
    locks.delete(lockKey);
    resolve();
  }
}
```

#### TM-2. No `unhandledRejection` / `uncaughtException` handlers (my original C-1)

Verified: `app.js` only registers `SIGTERM` and `SIGINT` handlers. If an unhandled promise rejection occurs (e.g., MongoDB disconnect during a write), the Node.js process will crash without cleanup. Open positions on the exchange would be orphaned.

```js
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Promise Rejection', { reason, promise });
  // Do NOT exit -- log and continue.
  // Consider: emit a RISK_EVENT so the UI shows an alert.
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception -- initiating graceful shutdown', { error: err });
  gracefulShutdown('uncaughtException');
});
```

#### TM-3. Graceful shutdown order is wrong (my original C-4)

The current shutdown in `app.js:390-423` does:
1. `botService.stop()` (deactivates strategies, closes WS)
2. `server.close()` (closes HTTP)
3. `io.close()` (closes Socket.io)
4. `mongoose.disconnect()` (closes DB)

**Problem:** `botService.stop()` at step 1 calls `this.currentSession.save()` (line 510) which writes to MongoDB. But step 1 also calls `this.exchangeClient.closeWebsockets()` (line 499). If the WebSocket close triggers any final position update events that need DB writes, those writes will fail because the WS close and the DB write are not sequenced.

**Correct order:**
1. Set `_running = false` on botService (stop accepting new signals)
2. Cancel all pending orders on the exchange
3. Wait for in-flight order submissions to complete (drain the queue)
4. Save final session state to MongoDB
5. Close WebSocket connections
6. Close Socket.io
7. Close HTTP server
8. Disconnect MongoDB

#### TM-4. No rate limiting on REST API endpoints

The backend Express server has no rate limiting middleware. An attacker or a malfunctioning frontend could:
- Trigger hundreds of `emergencyStop` calls per second
- Flood the `submitOrder` endpoint
- Exhaust MongoDB connections via analytics queries

Add `express-rate-limit`:
```js
const rateLimit = require('express-rate-limit');
app.use('/api/', rateLimit({ windowMs: 60000, max: 100 }));
app.use('/api/bot/emergency-stop', rateLimit({ windowMs: 60000, max: 5 }));
```

---

## UI (Agent 3) Proposal Review

### Critical Issues Evaluation

#### C1. Emergency Stop Without Confirmation Dialog

**Verdict: AGREE -- this is a legitimate safety issue.**

From a system perspective, the emergency stop endpoint (`/api/bot/emergency-stop`) calls `riskEngine.emergencyStop()` which halts the circuit breaker, then cancels all open orders, then closes all positions at market. This is an irreversible, high-impact operation. A confirmation dialog is the minimum viable safety measure.

However, I want to add a **system-level requirement**: the emergency stop should also work even if the frontend is down. The backend should have its own monitoring that triggers emergency stop under certain conditions (e.g., the `DrawdownMonitor` halt already does this partially, but should be extended to cover connectivity loss, API errors, etc.).

#### C2. Risk Events Not Rendered in UI

**Verdict: AGREE -- critical observability gap.**

Verified: `useSocket.ts:84-103` collects `riskEvents` but `page.tsx` never renders them. The WebSocket pipeline works (events flow from `riskEngine -> app.js io.emit -> frontend socket.on`), but the data dead-ends at `riskEvents` state.

**Backend API change needed:** The risk events should also be persisted to MongoDB (a `RiskEvent` model) so they can be queried historically, not just streamed in real-time. If the user refreshes the page, all accumulated risk events are lost.

```js
// In app.js, where risk events are forwarded to Socket.io:
riskEngine.on(RISK_EVENTS.CIRCUIT_BREAK, async (data) => {
  io.emit(RISK_EVENTS.CIRCUIT_BREAK, data);
  // Also persist:
  await RiskEvent.create({ type: 'circuit_break', data, timestamp: new Date() }).catch(log.error);
});
```

Add a REST endpoint: `GET /api/risk/events?since=<timestamp>&limit=50`

#### C3. Socket.io Connection Lifecycle

**Verdict: AGREE -- this is a real bug, especially in development with React Strict Mode.**

Verified at `socket.ts:33-38`: `disconnectSocket()` sets the module-level `socket` to `null` and calls `socket.disconnect()`. In React Strict Mode, `useEffect` runs twice (mount, unmount, remount). On the first unmount, the socket is destroyed. On the remount, `getSocket()` creates a new socket -- which is correct but causes a visible reconnection flicker and loses any events emitted during the gap.

**System fix:** Ref-counting is the cleanest approach:

```ts
let socket: Socket | null = null;
let refCount = 0;

export function acquireSocket(): Socket {
  refCount++;
  if (!socket) {
    socket = io(SOCKET_URL, { /* options */ });
  }
  return socket;
}

export function releaseSocket(): void {
  refCount--;
  if (refCount <= 0 && socket) {
    socket.disconnect();
    socket = null;
    refCount = 0;
  }
}
```

#### C4. Live/Paper Mode Visual Distinction

**Verdict: AGREE -- but this is a UX issue, not a system issue.**

No backend changes needed. Pure frontend CSS/UI change. Low engineering risk.

#### C5. Equity Curve Time Axis

**Verdict: AGREE -- minor UX issue.**

No backend changes needed. The data model already includes timestamps.

---

### Backend API Changes Required for UI Proposals

| UI Proposal | Backend Change Required | Complexity |
|---|---|---|
| C2 (Risk Events) | `RiskEvent` model + `GET /api/risk/events` endpoint + DB persistence | Medium |
| H1 (Layout) | None | N/A |
| H2 (Strategy Selection) | `GET /api/bot/strategies` already exists | N/A |
| H3 (Equity Curve) | `GET /api/analytics/equity-curve/:sessionId` already exists; may need `drawdown` field added | Low |
| H4 (Positions) | `POST /api/trades/order/:id` (manual close) endpoint needed if not exists. `GET /api/trades/positions` may need `strategyName`, `entryPrice`, `marginRatio` fields | Medium |
| H5 (Signal Feed) | `GET /api/trades/signals` may need `rejectReason` in response (already saved in DB) | Low |
| H6 (Number Format) | None (frontend only) | N/A |
| H7 (Mobile) | None | N/A |
| H8 (Adaptive Polling) | `GET /api/bot/status` already returns `running` boolean -- frontend can use it | N/A |
| E1 (Drawdown Chart) | Need drawdown series in equity curve endpoint or new `GET /api/analytics/drawdown/:sessionId` | Low |
| E3 (Notification Center) | Need `GET /api/risk/events` (same as C2) | Shared with C2 |
| E4 (Settings Page) | `PUT /api/bot/risk-params` already exists | N/A |
| V3 (Risk Gauge) | `GET /api/bot/status` needs `riskStatus` sub-object with CB state, DD%, exposure% | Low |

---

### Frontend Engineering Evaluation

#### FE1. Type Safety (`as never`, `Record<string, unknown>`)

**Verdict: AGREE -- low priority but worth fixing.**

The `as never` casts are Recharts-specific workarounds. Using custom Tooltip content components is the right fix. No system impact.

The `Record<string, unknown>` types in `types/index.ts` should at minimum have the critical fields typed:

```ts
interface Signal {
  // ... existing fields ...
  marketContext: {
    regime: string;
    price: string;
    volume24h: string;
    atr?: string;
  };
}
```

This prevents runtime errors when accessing nested properties.

#### FE2. Unnecessary Re-renders

**Verdict: AGREE -- this has system-level performance implications.**

The `useSocket` monolithic state causes **every socket event to re-render the entire dashboard**. With 10 symbols receiving ticker updates every ~1 second, the TICKER event handler at line 73-81 fires 10 times/second. Each fire creates a new `lastTicker` object AND triggers a React reconciliation of the entire Dashboard component tree.

**Performance impact:** On low-end devices, this can cause 30-50ms per render, leading to dropped frames. The dashboard becomes sluggish when the bot is actively trading multiple symbols.

**Fix priority: HIGH.** Split `useSocket` into purpose-specific hooks:

```ts
function useSocketTickers() { /* only lastTicker state */ }
function useSocketSignals() { /* only signals state */ }
function useSocketRisk() { /* only riskEvents state */ }
function useSocketRegime() { /* only regime + symbolRegimes */ }
function useSocketConnection() { /* only connected state */ }
```

Each hook subscribes to its relevant socket events only. Components consume only what they need.

Alternatively, use `useSyncExternalStore` with a proper socket store that supports selector-based subscriptions (like Zustand).

#### FE3. Error Handling

**Verdict: AGREE -- critical for production.**

Verified at `api-client.ts:27-36`: The `request()` function has no try-catch around `fetch()`. A network error (server down, DNS failure, timeout) will throw an unhandled exception that propagates to the component, potentially crashing the app (no Error Boundary).

**Fix:**
```ts
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkError) {
    throw new Error(`Network error: ${(networkError as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Request failed');
  }
  return json.data;
}
```

**Error Boundary:** Next.js 13+ supports `error.tsx` for per-route error boundaries. At minimum, add `app/error.tsx` and `app/global-error.tsx`.

#### FE4. Memory Leaks

**Verdict: CONDITIONAL AGREE**

The `useBacktest` `setInterval` issue is real but mitigated by the cleanup in the `useEffect` return. The actual risk is the race condition between the async callback and unmounting. An `AbortController` or `isMounted` ref is the correct fix.

The `useSocket` listener cleanup concern is **less of an issue** because `socket.disconnect()` removes all listeners on that socket instance. However, if `disconnectSocket()` sets `socket = null` before all listeners fire their final callbacks, we get the "setState on unmounted component" React warning.

#### FE5. Accessibility

**Verdict: AGREE but LOW PRIORITY for this system.**

This is a single-user trading dashboard, not a public-facing application. Accessibility improvements are good engineering practice but are not a system reliability concern. Prioritize after all Critical and High issues.

#### FE6. Code Structure (Duplicated Constants)

**Verdict: AGREE**

The regime color maps duplicated across 4 files is a maintenance hazard. Create `frontend/src/lib/constants.ts`:

```ts
export const REGIME_COLORS: Record<string, string> = {
  TRENDING_UP: 'emerald',
  TRENDING_DOWN: 'red',
  RANGING: 'amber',
  VOLATILE: 'purple',
  QUIET: 'sky',
};
```

#### FE7. Bundle Optimization

**Verdict: CONDITIONAL AGREE -- low impact for a single-user app.**

Recharts tree-shaking, dynamic imports, and Socket.io lazy loading are good optimizations for a public app, but this is a self-hosted trading terminal. The user loads it once and keeps it open for hours/days. Initial load time is less critical than runtime performance. Prioritize FE2 (re-render optimization) over FE7.

---

### UI Proposals -- Missed System Points

#### UM-1. No CSRF protection on state-mutating endpoints

The frontend `api-client.ts` sends `POST`/`PUT` requests without any CSRF token. While the backend is typically accessed from the same machine (localhost), if exposed on a network, a malicious page could trigger `POST /api/bot/emergency-stop` via a cross-origin request.

**Fix:** Add a CSRF token middleware or, at minimum, check the `Origin` header on mutating endpoints.

#### UM-2. No authentication on the backend API

The entire REST API is unauthenticated. Anyone with network access to port 3001 can start/stop the bot, submit orders, or trigger emergency stop. This is acceptable for localhost-only development but **must be fixed before any network deployment**.

Add at minimum:
- A static API key via `Authorization: Bearer <token>` header
- API key stored in `.env` and validated in middleware

#### UM-3. Frontend does not handle backend restarts

If the backend restarts while the frontend is open, the Socket.io connection will auto-reconnect (configured in `socket.ts:13`), but the frontend's state (botStatus, positions, trades) will be stale. There's no mechanism to detect a backend restart and refetch all data.

**Fix:** On Socket.io `connect` event (which fires on reconnection), trigger a full data refresh:

```ts
socket.on('connect', () => {
  setState(prev => ({ ...prev, connected: true }));
  // Trigger refetch of all REST data
  refetchBotStatus();
  refetchPositions();
  refetchTrades();
});
```

This requires the `useSocket` hook to accept refetch callbacks or use a pub/sub pattern.

---

## Implementation Dependency Analysis (DAG)

The following diagram shows the order in which fixes must be implemented, based on technical dependencies.

```
Layer 0 (Foundation -- no dependencies):
  [Eng C-1] unhandledRejection/uncaughtException handlers
  [Eng C-5] mathUtils parseFloat precision audit
  [UI  C1]  Emergency Stop confirmation dialog
  [UI  FE3] Error boundaries (app/error.tsx)

Layer 1 (Core Infrastructure):
  [Trd C1]  Multi-symbol routing fix (strategyBase Set-based symbols)
    depends on: nothing
  [Eng C-2] orderManager.submitOrder() mutex
    depends on: nothing
  [Eng C-3] ExposureGuard equity=0 division fix
    depends on: nothing
  [Trd C5]  Default strategy names / require explicit config
    depends on: nothing

Layer 2 (Signal Pipeline -- depends on Layer 1):
  [Trd C2 + H4] Position sizing resolution (pct -> qty)
    depends on: [Trd C1] (must know which symbol for price lookup)
    depends on: [Eng C-3] (ExposureGuard must handle qty correctly)
  [Trd H3]  Confidence-based signal filtering
    depends on: nothing (but best done with C2 at same time)
  [Trd H6]  SignalFilter memory leak TTL cleanup
    depends on: nothing

Layer 3 (Backtest System -- depends on Layer 2):
  [Trd C4]  BacktestEngine IndicatorCache injection
    depends on: nothing (standalone)
  [Trd C3]  Backtest fill action field
    depends on: nothing (standalone)
  [Trd H5]  Backtest position sizing
    depends on: [Trd C2] (same sizing logic should be shared)
  [Trd H1]  Sharpe ratio annualization fix
    depends on: nothing

Layer 4 (Risk & Observability -- depends on Layer 2):
  [Eng C-4] Graceful shutdown ordering
    depends on: [Eng C-2] (must drain order queue before closing)
  [Trd H7]  DrawdownMonitor manual recovery
    depends on: nothing
  [UI  C2]  Risk events UI rendering + persistence
    depends on: backend RiskEvent model (new)
  [UI  C3]  Socket.io ref-counted lifecycle
    depends on: nothing

Layer 5 (Strategy Quality -- depends on Layer 1+2):
  [Trd H2]  RSI Wilder smoothing
    depends on: nothing (but ALL strategies need re-testing after)
  [Trd E6]  FundingRate data pipeline
    depends on: [Trd C1] (data pipeline must support multi-symbol)
  [All strategy-specific fixes from Trader per-strategy reviews]
    depends on: [Trd C1], [Trd C2], [Trd C4]

Layer 6 (UI Polish -- depends on Layers 3-4):
  [UI  H1]  Dashboard layout redesign
  [UI  H2-H8] Various UX improvements
  [UI  FE2] useSocket re-render optimization
  [UI  E1-E7] Enhancement features
```

**Recommended implementation order (parallel tracks):**

**Track A (Backend Critical -- 1 person, 3-5 days):**
1. Eng C-1 (process handlers) -- 1 hour
2. Eng C-3 (ExposureGuard div-by-zero) -- 1 hour
3. Trd C5 (default strategy names) -- 30 min
4. Trd C1 (multi-symbol fix) -- 1 day
5. Trd C2 + H4 (position sizing resolution) -- 1 day
6. Eng C-2 (submitOrder mutex) -- 3 hours
7. Eng C-4 (shutdown ordering) -- 3 hours

**Track B (Backtest Critical -- 1 person, 2-3 days):**
1. Trd C4 (IndicatorCache in backtest) -- 4 hours
2. Trd C3 (fill action field) -- 2 hours
3. Trd H5 (backtest position sizing) -- 2 hours
4. Trd H1 (Sharpe ratio fix) -- 1 hour
5. Trd H6 (SignalFilter TTL) -- 1 hour

**Track C (Frontend Critical -- 1 person, 2-3 days):**
1. UI C1 (Emergency Stop dialog) -- 1 hour
2. UI FE3 (Error boundaries + API error handling) -- 3 hours
3. UI C2 (Risk events rendering) -- 4 hours (needs backend RiskEvent model)
4. UI C3 (Socket ref-counting) -- 2 hours
5. UI FE2 (useSocket split) -- 4 hours

---

## 3-Agent Cross-Analysis -- Common Critical Issues

The following issues were identified by **two or more agents**, confirming their critical importance:

| Issue | Trader | Engineer | UI | Consensus |
|-------|--------|----------|-----|-----------|
| Multi-symbol routing broken | C1 | -- | -- | Trader found, Engineer validates + proposes Set-based fix |
| Percentage vs Quantity confusion | C2 + H4 | -- | -- | Trader found, Engineer adds price source + lot size concerns |
| ExposureGuard equity=0 | -- | C-3 | -- | Engineer found, related to Trader's H4 |
| Backtest IndicatorCache missing | C4 | -- | -- | Trader found, Engineer adds memory/sync concerns |
| Backtest fill missing action | C3 | -- | -- | Trader found, Engineer validates |
| Default strategy names wrong | C5 | H-7 | -- | Both found independently |
| No process crash handlers | -- | C-1 | -- | Engineer only |
| submitOrder concurrency | -- | C-2 | -- | Engineer only |
| Graceful shutdown ordering | -- | C-4 | -- | Engineer only |
| Emergency stop no confirmation | -- | -- | C1 | UI only (but Engineer agrees) |
| Risk events not rendered | -- | -- | C2 | UI only (Engineer adds persistence need) |
| Socket lifecycle in Strict Mode | -- | -- | C3 | UI only (Engineer validates) |
| SignalFilter memory leak | H6 | H-3* | -- | Both found (* Engineer found PaperEngine variant) |
| DrawdownMonitor no recovery | H7 | -- | -- | Trader found, Engineer adds safety constraints |
| RSI implementation non-standard | H2 | -- | -- | Trader only (Engineer adds caching concern) |
| No API authentication | -- | -- | -- | Engineer adds (new finding) |
| No API rate limiting | -- | -- | -- | Engineer adds (new finding) |

### Top 5 Issues by Combined Risk Score

1. **Trd-C2 / Eng-C3: Position sizing pipeline** (catastrophic financial risk)
   - Percentage interpreted as absolute quantity = orders 10,000x wrong size
   - ExposureGuard divides by equity=0 before first account update
   - Combined: either a massive wrong-sized order or a crash

2. **Trd-C1: Multi-symbol routing broken** (90% of trading capability lost)
   - System silently ignores 9/10 selected symbols
   - No error, no warning in normal operation

3. **Eng-C-2: submitOrder concurrency** (double-spend / duplicate orders)
   - Two concurrent signals for same symbol bypass ExposureGuard
   - Results in 2x intended position size

4. **Eng-C-1: No process crash handlers** (orphaned exchange positions)
   - Unhandled rejection -> process crash -> open positions without management
   - No stop-loss protection if bot dies unexpectedly

5. **Trd-C4: Backtest missing IndicatorCache** (invalid backtesting)
   - 14/18 strategies crash in backtest
   - Cannot validate strategy performance before deployment

---

*This cross-review covers system-level implications of all proposals from the Trader and UI agents. The implementation dependency DAG should be used to sequence work across the three tracks to minimize blocking dependencies and maximize parallel progress.*
