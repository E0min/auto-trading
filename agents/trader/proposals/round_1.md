# Round 1 - Senior Quant Trader Analysis

> Agent 1: Senior Quant Trader
> Date: 2026-02-13
> Scope: Complete codebase audit from a trading/alpha-generation perspective

---

## Table of Contents

1. [Critical Issues (Must Fix Before Live Trading)](#1-critical-issues)
2. [High-Priority Improvements](#2-high-priority-improvements)
3. [Enhancement Ideas](#3-enhancement-ideas)
4. [Per-Strategy Detailed Reviews](#4-per-strategy-detailed-reviews)
5. [Risk Management Audit](#5-risk-management-audit)
6. [Execution Quality Audit](#6-execution-quality-audit)
7. [Backtest Reliability Audit](#7-backtest-reliability-audit)
8. [Strategy Orchestration Audit](#8-strategy-orchestration-audit)
9. [Indicator Library Audit](#9-indicator-library-audit)

---

## 1. Critical Issues

These are bugs or design flaws that will cause incorrect behavior, financial loss, or system failure in live trading. They must be fixed before any real capital is deployed.

### C1. Multi-Symbol Support Is Fundamentally Broken

**Files:** `backend/src/services/strategyBase.js` (line 90), `backend/src/services/strategyRouter.js` (lines 180-210), `backend/src/services/botService.js` (line 254)

**Problem:** `StrategyBase.activate()` sets `this._symbol` to a single value. When `strategyRouter.js` loops over symbols calling `activate()` for each, only the **last symbol** is retained. BotService then checks `strategy._symbol === ticker.symbol` to route tickers, which means only the last-activated symbol receives data.

**Impact:** If the system selects 10 trading symbols, each strategy instance only processes the 10th symbol. The other 9 symbols are silently ignored. This is a silent data loss bug -- no error is thrown, no warning is logged.

**Fix:** Either (a) create one strategy instance per symbol (recommended), or (b) change `_symbol` to a `Set` of symbols and update all routing logic accordingly. The `activate()` method should accumulate symbols, and `deactivate()` should remove them.

```js
// Option A: In botService._createStrategies(), create per-symbol instances
for (const symbol of symbols) {
  for (const strategyName of activeStrategies) {
    const instance = registry.create(strategyName, config);
    instance.activate(symbol);
    this._strategies.push(instance);
  }
}
```

### C2. Position Sizing Disconnect -- Percentage vs Quantity

**Files:** `backend/src/services/botService.js` (lines 320-331), `backend/src/services/orderManager.js` (line ~180), all 18 strategy files

**Problem:** Strategies emit `suggestedQty` as a **percentage string** (e.g., `'5'` meaning 5% of equity), but `orderManager.submitOrder()` interprets this as an **absolute quantity**. There is no translation layer between percentage-based sizing and actual contract/coin quantity.

**Impact:** Orders will be submitted with grossly incorrect sizes. A strategy intending 5% of a $10,000 account ($500 worth) would instead submit a market order for 5 BTC (~$500,000 at current prices). This could cause catastrophic financial loss.

**Fix:** Add a position size resolver in BotService or OrderManager:
```js
// In botService.js, before passing to orderManager:
const equity = this.riskEngine.accountState.equity;
const pctString = signal.suggestedQty || signal.positionSizePercent;
const notionalValue = math.multiply(equity, math.divide(pctString, '100'));
const actualQty = math.divide(notionalValue, signal.suggestedPrice);
```

### C3. Backtest Fill Notification Missing `action` Field

**Files:** `backend/src/backtest/backtestEngine.js` (lines 722-729)

**Problem:** `_notifyFill()` only passes `{ side, price }` to strategies. However, many strategies' `onFill()` handlers check `fill.action` (e.g., `SIGNAL_ACTIONS.OPEN_LONG`). The fill object never includes `action`, so strategies cannot distinguish between an opening fill and a closing fill. The `side: 'buy'` could mean "opening a long" or "closing a short."

**Impact:** During backtests, strategies fail to properly track their internal position state. This makes backtest results unreliable -- strategies that depend on `onFill()` for state management (BollingerReversion, FundingRate, VwapReversion, BreakoutStrategy, AdaptiveRegime, MacdDivergence) will have incorrect position tracking.

**Fix:**
```js
_notifyFill(side, price, action) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price, action });
    } catch (err) {
      log.error('Strategy.onFill error', { side, price, action, error: err.message });
    }
  }
}

// Then in _openLong:
this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.OPEN_LONG);
// In _closeLong:
this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);
// etc.
```

### C4. Backtest Ignores IndicatorCache -- Strategies Crash on `this._indicatorCache.getHistory()`

**Files:** `backend/src/backtest/backtestEngine.js` (entire file), `backend/src/services/indicatorCache.js`

**Problem:** The backtest engine creates a strategy instance and feeds it klines, but never creates or injects an `IndicatorCache` instance. Strategies that use `this._indicatorCache` (BollingerReversion, VwapReversion, MacdDivergence, QuietRangeScalp, BreakoutStrategy, AdaptiveRegime, RsiPivot, Supertrend) will throw `TypeError: Cannot read properties of null (reading 'getHistory')` on the first kline.

**Impact:** 14 out of 18 strategies will crash immediately in backtest mode. Only the 4 strategies that compute indicators internally (TurtleBreakout, MaTrend, GridStrategy, FundingRate) can potentially survive backtest.

**Fix:** The BacktestEngine must create a mock `IndicatorCache` that ingests each kline before passing it to the strategy:
```js
_createStrategy() {
  // ... existing code ...

  // Create a standalone IndicatorCache for backtesting
  const { EventEmitter } = require('events');
  const mockMarketData = new EventEmitter();
  const IndicatorCache = require('../services/indicatorCache');
  const cache = new IndicatorCache({ marketData: mockMarketData });
  cache.start();

  strategy._indicatorCache = cache;
  this._mockMarketData = mockMarketData;

  return strategy;
}

// In the main loop, before strategy.onKline():
this._mockMarketData.emit(MARKET_EVENTS.KLINE_UPDATE, { symbol: this.symbol, ...kline });
```

### C5. Default Strategy Names Don't Exist

**File:** `backend/src/services/botService.js` (line ~165)

**Problem:** `_createStrategies()` defaults to `['MomentumStrategy', 'MeanReversionStrategy']` which are not registered in the strategy registry. These are legacy names from before Wave 6 that were never updated.

**Impact:** If no strategies are explicitly configured, the bot starts with zero working strategies and generates zero signals. No error is thrown -- it just runs silently doing nothing.

**Fix:** Update to existing strategy names, e.g., `['MaTrendStrategy', 'BollingerReversionStrategy']`, or better yet, require explicit strategy configuration.

---

## 2. High-Priority Improvements

These won't cause crashes but significantly reduce trading performance or create hidden risks.

### H1. Sharpe Ratio Calculation Treats Sub-Daily Returns as Daily

**File:** `backend/src/backtest/backtestMetrics.js` (lines 205-245)

**Problem:** The Sharpe ratio computation treats each equity curve point as a "daily return" regardless of the actual kline interval. If backtesting with 15-minute klines, there are 96 data points per day. The code computes `mean * sqrt(365) / stdDev`, treating each 15-min return as if it were a daily return.

**Impact:** Sharpe ratio is inflated by approximately `sqrt(96) ~ 9.8x` when using 15-minute data. A mediocre strategy with a true annualized Sharpe of 0.5 would appear to have a Sharpe of ~4.9, making it seem exceptional.

**Fix:**
```js
// Determine the time interval from the equity curve
const intervalMs = Number(equityCurve[1].ts) - Number(equityCurve[0].ts);
const periodsPerDay = 86400000 / intervalMs; // ms per day / ms per period
const periodsPerYear = periodsPerDay * 365;
const sqrtPeriodsPerYear = sqrt(String(periodsPerYear));
const annualisedReturn = multiply(meanReturn, sqrtPeriodsPerYear);
sharpeRatio = toFixed(divide(annualisedReturn, stdDev), 2);
```

### H2. RSI Calculation Uses Simple Average Instead of Wilder Smoothing

**File:** `backend/src/utils/indicators.js` (lines 130-155)

**Problem:** The RSI implementation uses a simple average of gains and losses over the last `period` bars. The standard RSI (Wilder's RSI) uses an exponentially smoothed moving average (Wilder smoothing). The simple-average approach produces a much noisier RSI that whipsaws more frequently.

**Impact:** All strategies using RSI (RsiPivot, BollingerReversion, AdaptiveRegime, VwapReversion, MacdDivergence, Supertrend) will generate signals at different points than intended, and the signals will be less reliable due to higher noise sensitivity. Crossover detection (e.g., RSI crossing 30) will trigger more false positives.

**Fix:** Implement Wilder's smoothed RSI:
```js
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;

  // Seed with simple average of first `period` changes
  let avgGain = '0', avgLoss = '0';
  for (let i = 1; i <= period; i++) {
    const diff = subtract(prices[i], prices[i-1]);
    if (isGreaterThan(diff, '0')) avgGain = add(avgGain, diff);
    else avgLoss = add(avgLoss, abs(diff));
  }
  avgGain = divide(avgGain, String(period));
  avgLoss = divide(avgLoss, String(period));

  // Wilder smoothing for remaining bars
  for (let i = period + 1; i < prices.length; i++) {
    const diff = subtract(prices[i], prices[i-1]);
    if (isGreaterThan(diff, '0')) {
      avgGain = divide(add(multiply(avgGain, String(period - 1)), diff), String(period));
      avgLoss = divide(multiply(avgLoss, String(period - 1)), String(period));
    } else {
      avgGain = divide(multiply(avgGain, String(period - 1)), String(period));
      avgLoss = divide(add(multiply(avgLoss, String(period - 1)), abs(diff)), String(period));
    }
  }

  if (!isGreaterThan(avgLoss, '0')) return '100';
  const rs = divide(avgGain, avgLoss);
  return toFixed(subtract('100', divide('100', add('1', rs))), 4);
}
```

### H3. No Confidence-Based Signal Filtering

**File:** `backend/src/services/signalFilter.js`

**Problem:** The signal filter pipeline checks cooldown, duplicates, max concurrent, and symbol conflicts, but never examines signal confidence. A signal with confidence 0.30 passes through just as easily as one with 0.90.

**Impact:** Low-conviction signals generate real orders, wasting capital on poor setups and diluting overall strategy edge.

**Fix:** Add a minimum confidence filter (e.g., 0.50 default):
```js
// In signalFilter.js, add as the first filter:
_checkMinConfidence(signal) {
  const minConfidence = this._config.minConfidence || '0.50';
  if (isLessThan(signal.confidence || '0', minConfidence)) {
    return { passed: false, reason: `confidence_too_low (${signal.confidence} < ${minConfidence})` };
  }
  return { passed: true };
}
```

### H4. ExposureGuard Receives Percentage as Quantity

**File:** `backend/src/services/exposureGuard.js` (lines 76-171)

**Problem:** ExposureGuard's `validateOrder()` expects `order.qty` as an absolute quantity and `order.price` as a price, then computes `orderValue = qty * price`. But strategies pass percentage strings (e.g., `'5'`) as `qty`. The guard would compute `orderValue = 5 * 60000 = 300000` for BTC, which is obviously wrong but would likely exceed the exposure limit, causing rejection.

**Impact:** Most orders from strategies will be rejected by ExposureGuard due to the qty/percentage confusion. The bot will appear to work but generate very few actual trades.

**Fix:** This is the same root cause as C2. The position size resolution must happen before the order reaches ExposureGuard.

### H5. Backtest Position Sizing Uses 95% of Cash Per Trade

**File:** `backend/src/backtest/backtestEngine.js` (line 36, `DEFAULT_POSITION_SIZE_PCT = '95'`)

**Problem:** Every backtest trade uses 95% of available cash. This is unrealistically aggressive compared to live trading where RiskEngine limits positions to 5% of equity. Backtest results are therefore not comparable to expected live performance.

**Impact:** Backtests show much larger returns (and drawdowns) than live trading would produce. A strategy that backtests at +50% return would likely produce only ~2.5% return live with 5% position sizing.

**Fix:** The backtest engine should respect the strategy's `positionSizePercent` from its metadata:
```js
const positionSizePct = this._strategy.config.positionSizePercent || '5';
const positionValue = math.multiply(this._cash, math.divide(positionSizePct, '100'));
```

### H6. Signal Filter `_activeSignals` Memory Leak

**File:** `backend/src/services/signalFilter.js`

**Problem:** `_activeSignals` tracks open signals but only removes them when a close signal arrives. If a strategy crashes, a position is force-closed externally, or the close signal is filtered out, the `_activeSignals` entry persists forever.

**Impact:** Over time, `_activeSignals` grows unbounded, and the `maxConcurrent` filter becomes increasingly restrictive, eventually blocking all new signals.

**Fix:** Add a TTL-based cleanup:
```js
// In constructor:
this._signalTtlMs = config.signalTtlMs || 24 * 60 * 60 * 1000; // 24h default

// Add periodic cleanup:
_cleanupStaleSignals() {
  const cutoff = Date.now() - this._signalTtlMs;
  for (const [key, signal] of this._activeSignals.entries()) {
    if (signal.timestamp < cutoff) {
      this._activeSignals.delete(key);
    }
  }
}
```

### H7. DrawdownMonitor Never Auto-Recovers from `max_drawdown_exceeded`

**File:** `backend/src/services/drawdownMonitor.js` (lines 170-205)

**Problem:** `resetDaily()` only clears the halt if the reason was `daily_loss_exceeded`. If the halt was caused by `max_drawdown_exceeded`, there is no automatic recovery path. The bot remains halted until a manual restart.

**Impact:** After a max drawdown halt, the bot stays offline permanently. If the market recovers, the bot misses all recovery trades.

**Fix:** Add a `resetDrawdown()` method or allow recovery when equity returns to within the threshold:
```js
resetDrawdown(newPeak) {
  if (this.isHalted && this.haltReason === 'max_drawdown_exceeded') {
    this.peakEquity = newPeak || this.currentEquity;
    this.isHalted = false;
    this.haltReason = null;
    log.info('Drawdown halt lifted via manual reset');
  }
}
```

---

## 3. Enhancement Ideas

Improvements that would meaningfully improve alpha generation and risk management.

### E1. Dynamic Position Sizing Based on Signal Confidence

Currently all strategies use fixed percentage sizing. A Kelly-criterion-inspired approach would allocate more capital to high-confidence signals and less to low-confidence ones. FundingRateStrategy already has a Kelly implementation but hardcodes `winRate = 0.55`.

### E2. Correlation-Aware Exposure Management

ExposureGuard sums position notionals without considering correlation. If 5 positions are all long BTC-correlated altcoins, the effective exposure is much higher than the sum suggests. Add a correlation matrix (even a simple BTC-beta factor) to the exposure calculation.

### E3. Adaptive Cooldown Based on Market Volatility

The signal filter uses a fixed 60-second cooldown. During high-volatility periods, this is too short (signals are noise). During low-volatility periods, this might be too long (missing clean setups). Scale cooldown proportionally to ATR percentile.

### E4. Exchange-Side Stop Loss Orders

Currently, all SL/TP logic runs in the strategy's `onTick()` handler. If the bot crashes or loses connectivity, open positions have no protection. Submit exchange-side stop-loss orders immediately after entry fills.

### E5. Order Type Intelligence

OrderManager always uses market orders. For non-urgent entries (confidence < 0.8), limit orders placed slightly better than market would save 0.04% per round-trip (maker fee vs taker fee). Over hundreds of trades, this is significant.

### E6. Funding Rate Data Source

FundingRateStrategy depends on `ticker.fundingRate` being present in the ticker data, but the exchange WebSocket ticker channel typically does not include funding rate. It needs a separate subscription or periodic REST fetch. Currently the strategy will never trigger because `_fundingRateHistory` stays empty.

### E7. Multi-Timeframe Confirmation Framework

Several strategies could benefit from higher-timeframe confirmation (e.g., enter on 15m signal only if 1h trend agrees). MaTrendStrategy attempts this manually with kline aggregation but the implementation is brittle. A proper multi-timeframe framework would serve all strategies.

### E8. Walk-Forward Optimization

The backtest engine runs a single in-sample test. A walk-forward framework (train on N months, test on next M months, roll forward) would validate that strategy parameters are not overfit.

---

## 4. Per-Strategy Detailed Reviews

### 4.1 TurtleBreakoutStrategy

**File:** `backend/src/strategies/price-action/TurtleBreakoutStrategy.js` (575 lines)

**Signal Quality:** GOOD. Classic Donchian Channel breakout with proper implementation. Uses 20-bar entry channel, 10-bar exit channel, 50-bar trend filter. Correctly excludes the current bar from Donchian calculation.

**Strengths:**
- Proper trailing stop implementation (ratchets correctly, never moves backward)
- ATR-based stops (2x ATR) are well-calibrated for crypto
- Warm-up period tracking prevents premature signals

**Issues:**
1. `positionSizePercent: '4'` is passed as `suggestedQty` (C2 applies)
2. No volume confirmation on breakouts -- many false breakouts in crypto occur on low volume
3. Trend filter (50-bar high > 50-bar low) is always true; it compares Donchian channel high vs low which is mathematically guaranteed. The intended filter should compare current price to a moving average.

**Recommendation:** Add volume breakout filter (volume > 1.5x SMA(20)), fix the trend filter logic.

---

### 4.2 CandlePatternStrategy

**File:** `backend/src/strategies/price-action/CandlePatternStrategy.js` (827 lines)

**Signal Quality:** MODERATE. Detects 6 patterns (Engulfing, Hammer, Shooting Star, Morning/Evening Star). Pattern detection mathematics are sound.

**Issues:**
1. **No volume confirmation** -- engulfing patterns on low volume are unreliable. High-volume engulfing is 2-3x more predictive.
2. **No trend context** -- bullish engulfing in a strong downtrend is counter-trend and has much lower win rate. Need higher-timeframe trend alignment.
3. **Fixed TP/SL** (ATR 2x / 1.5x) gives R:R of 1.33:1, which is acceptable but could be dynamic based on pattern strength.
4. **Morning/Evening Star detection** requires 3 consecutive candles with specific body/shadow ratios. The implementation looks correct but the thresholds (body ratio < 0.3 for doji) may be too strict for crypto where wicks are often long.

**Recommendation:** Add volume filter (at minimum: `volume > volumeSMA`), add trend-alignment scoring to confidence.

---

### 4.3 SupportResistanceStrategy

**File:** `backend/src/strategies/price-action/SupportResistanceStrategy.js` (566 lines)

**Signal Quality:** MODERATE. Detects horizontal S/R levels via swing high/low clustering, enters on breakout with retest confirmation.

**Issues:**
1. **`minTouches: 1` is too low** -- a single-touch level is not statistically meaningful. Should require at minimum 2 touches, ideally 3.
2. **S/R levels recalculated every kline** -- levels can flip between support and resistance frequently, creating noise. Levels should be cached and only recalculated on significant new data (e.g., every 24 hours or on regime change).
3. **Retest confirmation** checks last 3 bars for proximity to level. This is a good feature but the tolerance (0.3%) may be too tight for volatile crypto.
4. **No proximity filter** -- multiple S/R levels can cluster, creating redundant signals.

**Recommendation:** Increase `minTouches` to 2 or 3, add S/R level caching with staleness expiry, merge nearby levels.

---

### 4.4 SwingStructureStrategy

**File:** `backend/src/strategies/price-action/SwingStructureStrategy.js` (545 lines)

**Signal Quality:** LOW-MODERATE. Detects Higher Highs/Higher Lows (uptrend) and Lower Highs/Lower Lows (downtrend), enters on Break of Structure (BOS).

**Issues:**
1. **Only checks last 2 swing points** for structure determination. This makes it extremely sensitive to noise. A single noisy swing can flip the structure classification. Should require at least 3 consecutive structural points.
2. **No take-profit target** -- relies entirely on structure violation or trailing stop. In crypto, trends can be very extended; the strategy needs a mechanism to capture windfall profits.
3. **SL at swing low - 0.5*ATR** is reasonable for the initial stop but can be very wide in volatile conditions.
4. **BOS (break of structure) confirmation** uses only price close above/below the swing point. No volume confirmation, no candle close confirmation (could use close above swing on 2+ candles for confirmation).

**Recommendation:** Require 3+ structural points for trend identification, add partial TP at 2x ATR, add volume confirmation for BOS.

---

### 4.5 FibonacciRetracementStrategy

**File:** `backend/src/strategies/price-action/FibonacciRetracementStrategy.js` (670 lines)

**Signal Quality:** MODERATE-GOOD. Finds significant swings, computes Fibonacci levels, enters on golden zone (0.382-0.618) bounces with proper invalidation at 0.786.

**Strengths:**
- Well-designed invalidation logic (0.786 level)
- Partial TP concept (50% at swing extreme)
- Proper swing detection with configurable sensitivity

**Issues:**
1. **`swingPeriod: 50` is very slow to warm up** -- needs 50+ bars before generating any signal. In 15-minute timeframe, that's 12.5 hours of no signals.
2. **Partial exit emits a close signal with full `positionSizePercent`** -- there is no mechanism for actual partial position closing in OrderManager. The strategy internally tracks `_partialExitDone` but the full position gets closed.
3. **No confluence filter** -- Fibonacci levels are more reliable when they coincide with other technical levels (S/R, moving averages). No such check exists.

**Recommendation:** Add confluence scoring with S/R or EMA proximity, implement proper partial close support in OrderManager, reduce warmup period or add pre-loading.

---

### 4.6 GridStrategy

**File:** `backend/src/strategies/indicator-light/GridStrategy.js` (651 lines)

**Signal Quality:** MODERATE. ATR-based bidirectional grid, only active in RANGING regime.

**Issues:**
1. **`_calculatePerLevelQty()` uses `this.config.equity` which is never set** -- always returns `'0'`. The grid strategy cannot compute its own quantity. This is a functional bug.
2. **Grid spacing minimum of 0.1%** is good for preventing excessively dense grids.
3. **Drawdown SL at 3%** is reasonable for a ranging strategy.
4. **No grid rebalancing** -- if the price drifts away from the initial grid center, all grid levels become one-sided and the strategy behaves like a trend follower.

**Fix for equity issue:**
```js
// GridStrategy needs equity injected, e.g., via config or a method:
setEquity(equity) { this.config.equity = equity; }
```

**Recommendation:** Add periodic grid recentering, fix the equity injection, add partial fill tracking.

---

### 4.7 MaTrendStrategy

**File:** `backend/src/strategies/indicator-light/MaTrendStrategy.js` (704 lines)

**Signal Quality:** MODERATE. Multi-timeframe EMA (1h/4h/daily) trend following with pullback entry.

**Issues:**
1. **Kline aggregation is fragile** -- aggregates 1h candles into 4h/daily by counting (every 4th/24th). This assumes the kline interval is exactly 1 hour. If the interval changes or klines are missing, the aggregation produces incorrect results. Should use timestamp-based aggregation.
2. **Fixed TP (+4%) and SL (-2%)** are not ATR-adjusted. In high-volatility conditions (BTC moves 5% intraday), the 2% SL will be hit frequently on noise. In low-volatility conditions, the 4% TP may never be reached.
3. **Requires ALL 6 EMAs** to be computed before generating any signal. With 24h kline aggregation, this means 24 * max(EMA period) hours = 24 * 50 = 1,200 hours = 50 days of warmup.
4. **Does not use IndicatorCache** -- computes everything internally, which means it doesn't benefit from shared computation and won't crash on backtest (unlike most other strategies), but also won't be consistent with the cache's indicator values.

**Recommendation:** Switch to timestamp-based aggregation, make TP/SL ATR-adaptive, reduce warmup via pre-seeding.

---

### 4.8 RsiPivotStrategy

**File:** `backend/src/strategies/indicator-light/RsiPivotStrategy.js` (585 lines)

**Signal Quality:** LOW-MODERATE. RSI + daily pivot point reversal strategy.

**Issues:**
1. **No null check for `_indicatorCache`** before calling `c.getHistory()` -- will crash if `_indicatorCache` is null (which it is in backtest mode per C4).
2. **Assumes 15-minute kline interval** for daily candle aggregation without verification. If the actual interval is 1h, the "daily" candle resets every 24 klines (24 hours), which is correct by coincidence but breaks with other intervals.
3. **TP/SL at fixed 2%/2%** gives R:R of 1:1, which barely breaks even before fees. With taker fee of 0.06% per trade (0.12% round-trip), the strategy needs >51.2% win rate to be profitable. Daily pivot points in crypto typically have ~52-54% directional accuracy, leaving almost zero edge after fees.
4. **No trailing stop** -- pure fixed TP/SL. Winning trades that could have captured larger moves are cut short at 2%.

**Recommendation:** Increase R:R to at least 1.5:1 (TP 3%, SL 2%), add trailing stop for runners, add ATR-based dynamic SL.

---

### 4.9 SupertrendStrategy

**File:** `backend/src/strategies/indicator-light/SupertrendStrategy.js` (868 lines)

**Signal Quality:** LOW. Requires simultaneous Supertrend direction change AND MACD cross AND Volume Oscillator confirmation.

**Issues:**
1. **Signal frequency is extremely low** -- requiring all three conditions to align simultaneously makes signals very rare. In backtest, this likely produces fewer than 5 trades per month. Low sample size means unreliable performance metrics.
2. **Leverage 5x with 2% SL** means actual account risk of ~10% per trade. This is extremely aggressive. A 5-trade losing streak (common even with 55% win rate) would draw down 50% of the account.
3. **No partial exit logic** -- all-in, all-out approach means missing opportunities for profit capture on partial moves.
4. **Depends on IndicatorCache** but the Supertrend is computed internally (not cached), while MACD and Volume Oscillator may or may not be available from cache.

**Recommendation:** Reduce leverage to 2-3x, relax entry conditions (e.g., Supertrend + MACD OR Supertrend + Volume, not all three), add trailing stop.

---

### 4.10 BollingerReversionStrategy

**File:** `backend/src/strategies/indicator-light/BollingerReversionStrategy.js` (620 lines)

**Signal Quality:** GOOD. BB(20,2) + RSI(14) + Stochastic(14,3) mean reversion with split entries (40%/30%/30%).

**Strengths:**
- Triple confirmation (BB + RSI crossover + Stochastic crossover) reduces false signals
- Split entry with weighted average pricing is well-implemented
- Bandwidth filter (>2%) prevents entries during extremely tight ranges
- Trending regime filter prevents counter-trend entries

**Issues:**
1. **Depends on IndicatorCache** (C4 applies for backtest)
2. **Half profit at BB middle, full profit at BB opposite band** is a good TP scheme, but the "full profit" exit at opposite band uses `positionSizePercent` instead of the remaining position size.
3. **`_calcConfidence()` uses parseFloat** for intermediate calculations, breaking the String-arithmetic convention. Not a correctness bug but an architectural violation.
4. **Stochastic crossover in oversold zone** (`%K < 20`) combined with RSI crossing 30 is very restrictive -- both conditions must be met simultaneously.

**Recommendation:** This is one of the better strategies. Minor improvements: relax stochastic zone to `%K < 30`, fix partial exit quantity tracking.

---

### 4.11 FundingRateStrategy

**File:** `backend/src/strategies/indicator-light/FundingRateStrategy.js` (775 lines)

**Signal Quality:** MODERATE (if data is available). Exploits extreme funding rate imbalances with OI confirmation and half-Kelly sizing.

**Strengths:**
- Unique alpha source (funding rate) not correlated with technical indicators
- Half-Kelly position sizing is theoretically sound
- 24-hour time limit prevents holding into adverse regime changes
- Partial exit on funding normalization is a smart feature

**Issues:**
1. **Funding rate data is likely never received** (E6) -- the WebSocket ticker channel doesn't include funding rate. The `_fundingRateHistory` array stays empty, and the strategy never generates signals.
2. **OI data similarly requires a separate subscription** -- `ticker.openInterest` is typically not in the standard ticker payload.
3. **Kelly formula uses hardcoded `winRate = 0.55`** -- this should be estimated from historical performance, not assumed.
4. **No close signal `suggestedQty` for full exit** -- `_emitClose()` doesn't include `suggestedQty`, which may cause issues with OrderManager.

**Recommendation:** Add dedicated REST polling for funding rate and OI data (e.g., every 5 minutes). Track actual win rate for dynamic Kelly calculation.

---

### 4.12 VwapReversionStrategy

**File:** `backend/src/strategies/indicator-light/VwapReversionStrategy.js` (623 lines)

**Signal Quality:** GOOD. Well-designed VWAP reversion with split entry (60%/40%), dual TP targets (VWAP + overshoot), time limit, and ATR-based SL.

**Strengths:**
- Session-based VWAP with 96-candle reset (appropriate for 15-min candles)
- Volume confirmation (`volume > volumeSMA * 1.2`)
- Add-on entry logic (if price moves further against, average down)
- Time limit (48 candles) prevents holding stale positions

**Issues:**
1. **Depends on IndicatorCache** (C4 applies)
2. **Session reset at 96 candles is a fixed count**, not timestamp-based. If the kline interval isn't 15 minutes, the session length will be wrong.
3. **Add-on entry increases risk** -- averaging into a losing position can amplify losses if the reversion thesis is wrong. Should have a maximum number of add-ons (currently 1, which is reasonable).
4. **RSI thresholds (35/65)** are moderate -- not extreme enough to ensure strong reversion signals.

**Recommendation:** Make session length configurable or timestamp-based. Consider RSI thresholds of 30/70 for stronger confirmation.

---

### 4.13 MacdDivergenceStrategy

**File:** `backend/src/strategies/indicator-light/MacdDivergenceStrategy.js` (651 lines)

**Signal Quality:** MODERATE-GOOD. MACD divergence detection with histogram zero-cross confirmation, swing-based SL, EMA(50) TP, trailing stop, and failure detection.

**Strengths:**
- Failure detection (histogram reversal within 5 candles) is a smart exit mechanism
- Swing-based SL (capped at 2.5x ATR) is more meaningful than fixed percentage
- Trailing stop with separate activation and distance thresholds
- Conservative sizing (2% position, 2x leverage)

**Issues:**
1. **Depends on IndicatorCache** for MACD histogram array, RSI, ATR, EMA (C4 applies)
2. **Divergence detection via `findPivots()` + `detectDivergence()`** is well-structured but may produce false positives when the pivot detection window is too small (leftBars=3, rightBars=3). This means pivots can form from just 7 bars of data, which may include noise.
3. **`onFill()` uses `fill.side` instead of `fill.action`** -- inconsistent with other strategies that use `action`. In backtest, `_notifyFill()` passes `side` but not `action`, so the MacdDivergence `onFill()` will partially work (it matches on `fill.side`), but the close detection logic is based on side-position mismatch which is fragile.

**Recommendation:** Increase pivot detection window (leftBars=5, rightBars=5) for more reliable divergence signals. Standardize `onFill()` to use `action`.

---

### 4.14 QuietRangeScalpStrategy

**File:** `backend/src/strategies/indicator-heavy/QuietRangeScalpStrategy.js` (406 lines)

**Signal Quality:** MODERATE. QUIET regime Keltner Channel scalping with EMA midpoint partial exit.

**Strengths:**
- Regime-specific (QUIET only) with immediate exit on regime change
- ATR quiet filter (`ATR <= ATR_SMA * 0.7`) is a good volatility confirmation
- Tight TP/SL (1.2%/0.8%) appropriate for scalping
- EMA midpoint partial exit is smart for scalping

**Issues:**
1. **Depends on IndicatorCache** (C4 applies)
2. **`onFill()` uses `fill.side` pattern**, inconsistent with action-based patterns in other strategies
3. **No leverage specified in signals** -- `metadata.defaultConfig.leverage: 2` is set but not passed in the signal object
4. **TP/SL ratio is 1.5:1** which is good for scalping, but the edge depends on high win rate. Keltner Channel reversion in QUIET conditions should have ~55-60% win rate.

**Recommendation:** Add leverage to signal output, ensure regime change detection is fast enough (currently checked on every tick, which is good).

---

### 4.15 BreakoutStrategy

**File:** `backend/src/strategies/indicator-heavy/BreakoutStrategy.js` (730 lines)

**Signal Quality:** GOOD. BB Squeeze breakout with multi-factor confirmation (volume explosion, ATR expansion, EMA slope).

**Strengths:**
- Squeeze detection (BB inside KC) with minimum duration requirement (6 candles)
- Volume explosion filter (2x SMA)
- ATR expansion filter (1.5x SMA)
- EMA slope direction confirmation
- Failure detection (price re-enters BB within 3 candles)
- SL at opposite BB band (dynamic, not fixed percentage)

**Issues:**
1. **Depends on IndicatorCache** (C4 applies)
2. **`_squeezeOppositeBand` is always set to `bb.lower` during squeeze counting** (line 338). This is overwritten on entry, but if the squeeze detection assigns `bb.lower` and then the entry is a short (which should use `bb.upper` as SL), the logic at entry correctly reassigns. However, during the squeeze period, the stored band may be stale.
3. **Squeeze count resets to 0 when not in squeeze AND no position** -- this means if a squeeze breaks on one candle and reforms the next, the counter resets. Consider a decay instead of a hard reset.
4. **High risk** -- 4% position with 3x leverage = 12% leveraged exposure per trade. In combination with the opposite-band SL which can be wide, this is aggressive.

**Recommendation:** Reduce position size to 3% or leverage to 2x. Add squeeze persistence (don't reset to 0, decay by 1 per non-squeeze candle).

---

### 4.16 AdaptiveRegimeStrategy

**File:** `backend/src/strategies/indicator-heavy/AdaptiveRegimeStrategy.js` (714 lines)

**Signal Quality:** MODERATE. Automatically switches trading mode per regime. This is the most sophisticated strategy in the system.

**Strengths:**
- Per-regime entry logic (trend-following, mean-reversion, momentum, wait)
- Dynamic TP/SL based on ATR and regime type
- Regime incompatibility exit (close long if regime flips to TRENDING_DOWN)
- Per-regime position sizing and leverage

**Issues:**
1. **Depends on IndicatorCache** (C4 applies)
2. **Trend entry RSI window is very narrow** -- TRENDING_UP requires RSI 40-50, TRENDING_DOWN requires RSI 50-60. These 10-point windows are extremely restrictive with the noisy (non-Wilder) RSI implementation. Many valid pullback entries will be missed.
3. **RANGING SL uses 0.8*ATR** -- this is very tight for mean-reversion trades. BB lower band to BB upper band can be 3-4x ATR in a ranging market. A 0.8*ATR SL will be hit by normal ranging price action.
4. **VOLATILE entry requires RSI < 25 or RSI > 75** -- extremely rare conditions. The strategy will rarely trigger in VOLATILE regime. RSI < 30 / > 70 would be more practical.
5. **QUIET regime does nothing** -- correct by design, but the strategy could at least accumulate kline data for faster warm-up when the regime changes.
6. **EMA computation uses both incremental (emaStep) and cache** -- the first kline uses cache, subsequent use incremental. This can create a subtle divergence if the cache recomputes from full history while the incremental value drifts due to floating-point accumulation.

**Recommendation:** Widen RSI windows (TRENDING: 35-55 / 45-65, VOLATILE: RSI < 30 / > 70), increase RANGING SL to 1.5*ATR, use cache consistently for EMA.

---

## 5. Risk Management Audit

### 5.1 RiskEngine Architecture

**File:** `backend/src/services/riskEngine.js` (269 lines)

The three-tier architecture (CircuitBreaker -> DrawdownMonitor -> ExposureGuard) is well-designed. Order of checks is correct: hard halts first, then drawdown, then position sizing.

**Gaps:**

1. **No per-trade risk calculation** -- `maxRiskPerTradePercent` (2%) exists in ExposureGuard but requires `order.riskPerUnit` (ATR-based stop distance) which strategies don't pass. The 2% rule is effectively disabled.

2. **No correlation risk management** -- The system can have long positions in BTCUSDT, ETHUSDT, SOLUSDT, etc. simultaneously. These are ~0.85-0.95 correlated. A single BTC drop triggers all SLs at once, effectively creating 5x the intended risk.

3. **No leverage-aware exposure calculation** -- ExposureGuard computes `orderValue = qty * price` but doesn't account for leverage. A 3x leveraged 5% position is effectively a 15% exposure.

4. **`accountState.equity` starts at '0'** and is only updated when `updateAccountState()` is called. If this call is delayed or missed, ExposureGuard divides by zero or makes incorrect calculations.

5. **No maximum open positions limit** -- ExposureGuard limits total exposure percentage but not the number of concurrent positions. 30 small positions create 30x the management overhead and 30x the execution risk.

### 5.2 CircuitBreaker

**File:** `backend/src/services/circuitBreaker.js` (185 lines)

**Assessment:** GOOD implementation. Consecutive loss tracking and rapid-loss clustering are both important features.

**Gaps:**
1. **`rapidLosses` array is never trimmed based on the window** -- entries older than `rapidLossWindow` are never removed. Over time, the array grows. The `filter()` in the check handles correctness, but the array should be periodically trimmed for memory efficiency.
2. **No loss-magnitude awareness** -- 5 consecutive losses of $1 each trigger the same circuit break as 5 losses of $1,000 each. Loss magnitude should be factored in.

### 5.3 DrawdownMonitor

**File:** `backend/src/services/drawdownMonitor.js` (268 lines)

**Assessment:** GOOD. Peak-to-trough tracking and daily loss tracking are correctly implemented.

**Gaps:**
1. **No time-weighted drawdown** -- a 10% drawdown over 1 hour is much more concerning than 10% over 1 month. The monitor treats them identically.
2. **Daily reset timing** -- `resetDaily()` is called externally but there's no automatic UTC midnight reset. If the caller forgets, daily loss tracking is incorrect.
3. **H7 applies** -- no recovery from `max_drawdown_exceeded`.

### 5.4 ExposureGuard

**File:** `backend/src/services/exposureGuard.js` (196 lines)

**Assessment:** MODERATE. The three-tier validation (risk-per-trade, position size, total exposure) is correct in structure.

**Gaps:**
1. **H4 applies** -- percentage vs quantity confusion.
2. **`effectivePrice = order.price || '1'`** -- for market orders where `order.price` is undefined, the fallback is `'1'`. This makes `orderValue = qty * 1`, which is obviously wrong. Should use the latest market price.
3. **No leverage consideration** -- discussed in 5.1.
4. **Position matching** -- `accountState.positions` is an array, but there's no symbol-level grouping. If you're adding to an existing position in the same symbol, the exposure calculation double-counts.

---

## 6. Execution Quality Audit

### 6.1 OrderManager

**File:** `backend/src/services/orderManager.js` (1037 lines)

**Strengths:**
- Clean separation of paper/live execution paths
- WebSocket fill event handling
- Order state machine with proper status transitions

**Gaps:**

1. **Always uses market orders** -- no limit order support for entries. This means paying taker fees on every trade. With 0.06% taker vs 0.02% maker fee, switching to limit orders for non-urgent entries would save 0.08% per round-trip.

2. **No partial fill handling** -- if a large order is partially filled, the system treats it as either fully filled or not filled. Partial fills create a risk of inconsistent position tracking between the strategy's internal state and the exchange's actual state.

3. **No order timeout** -- if an order is submitted and never fills (e.g., limit order in a fast market), there's no mechanism to cancel and retry. The order hangs indefinitely.

4. **PnL calculation for live trades requires `trade.metadata.entryPrice`** which may not always be populated -- if the entry order's fill price isn't captured, the PnL calculation breaks silently.

### 6.2 ExchangeClient

**File:** `backend/src/services/exchangeClient.js` (810 lines)

**Strengths:**
- Singleton pattern prevents multiple SDK instances
- Auto-retry with exponential backoff (1s, 2s, 4s, max 3 retries)
- Error classification (auth errors abort, network errors retry)
- WebSocket reconnection logic

**Gaps:**

1. **No rate limit tracking** -- relies purely on retry after 429 errors. Proactive rate limiting would prevent rate limit errors entirely.

2. **No circuit breaker for exchange connectivity** -- if the exchange is consistently returning errors, the client keeps retrying indefinitely. Should detect sustained failures and alert.

3. **WebSocket ping/pong monitoring** -- not clear if the client monitors for stale connections. If the WS connection silently dies (no close event), the system won't receive price updates but won't know it.

---

## 7. Backtest Reliability Audit

### 7.1 BacktestEngine

**File:** `backend/src/backtest/backtestEngine.js` (733 lines)

**Strengths:**
- Correct kline -> ticker sequencing (avoids look-ahead bias in the kline handler)
- Slippage model (fixed percentage, applied directionally)
- Fee deduction on both open and close
- Force-close at end of simulation

**Issues:**
1. **C3** -- `_notifyFill()` doesn't pass `action`, breaking strategy position tracking
2. **C4** -- No IndicatorCache, most strategies crash
3. **H5** -- 95% position sizing doesn't match live behavior
4. **No orderbook/liquidity simulation** -- slippage is fixed regardless of order size. A $100 order and a $100,000 order have identical slippage.
5. **Single-position only** -- the engine skips signals if a position is already open. Grid strategy and split-entry strategies can't be properly backtested.
6. **No funding rate simulation** -- FundingRateStrategy receives no funding data in backtest.
7. **Short position P&L accounting** is correct but convoluted. The comments explain the math but the actual formula (`qty * (2 * entryPrice - fillPrice) - closeFee`) is different from the code's approach. Verified the code is correct, but the comments are misleading.

### 7.2 BacktestMetrics

**File:** `backend/src/backtest/backtestMetrics.js` (277 lines)

**Issues:**
1. **H1** -- Sharpe ratio inflated for sub-daily data
2. **`sqrt()` uses `parseFloat()`** breaking the String-arithmetic pattern. Not a correctness issue but architectural inconsistency.
3. **Average hold time** uses `Number(t.exitTime) - Number(t.entryTime)`. If timestamps are Unix milliseconds this is correct, but the function doesn't validate.
4. **No Calmar ratio** (annualized return / max drawdown) -- this is the most important metric for evaluating a strategy's risk-adjusted return relative to its worst period.
5. **No Sortino ratio** -- Sharpe treats upside and downside volatility equally. Sortino only penalizes downside volatility, which is more appropriate for directional strategies.

---

## 8. Strategy Orchestration Audit

### 8.1 StrategyRouter

**File:** `backend/src/services/strategyRouter.js` (287 lines)

**Issues:**
1. **`updateSymbols()` deactivates then re-activates strategies**, which resets `_symbol` on each strategy. Any internal state tied to the previous symbol is lost.
2. **C1 applies** -- multi-symbol routing is broken at the base class level.
3. **Regime change activates/deactivates strategies** -- this is correct behavior, but strategies lose their internal state (kline history, indicator values, position tracking) on deactivation. When re-activated, they need a full warmup period again.

### 8.2 SignalFilter

**File:** `backend/src/services/signalFilter.js` (391 lines)

**Issues:**
1. **H3** -- No confidence-based filtering
2. **H6** -- Memory leak in `_activeSignals`
3. **Symbol conflict filter** prevents two strategies from holding positions in the same symbol. This is conservative but may be too restrictive -- two strategies could complement each other (e.g., one long-term trend, one short-term scalp).

### 8.3 CoinSelector

**File:** `backend/src/services/coinSelector.js` (525 lines)

**Strengths:**
- 7-factor scoring with regime-specific weights
- Percentile-rank normalization
- Pre-filter thresholds (volume, spread, max change)
- OI and funding rate enrichment with caching

**Issues:**
1. **Factor 7 (volMomentum) is identical to Factor 1 (volume)** -- `factorArrays.volMomentum.push(c.vol24h)` just pushes the same value as volume. This effectively double-counts volume in the scoring. Should be volume change (current volume vs historical average) or volume acceleration.
2. **Funding rate inverse** (`1/abs(fundingRate)`) creates extreme values near zero. If funding is 0.0001%, the inverse is 10,000, dominating the percentile ranking. Should clamp or use a different normalization.
3. **Momentum adjustment for TRENDING_DOWN negates the change** -- this means coins that dropped the most get the highest momentum score. This is correct for finding short candidates but unintuitive.
4. **`maxSymbols: 10` default** -- combined with the multi-symbol bug (C1), only the last of 10 symbols is actually traded.

---

## 9. Indicator Library Audit

**File:** `backend/src/utils/indicators.js` (634 lines)

### ATR Implementation: CORRECT
The ATR uses True Range (max of |H-L|, |H-prevClose|, |L-prevClose|) with simple averaging. This is correct (SMA-based ATR, not Wilder-smoothed ATR). The summary from the previous session incorrectly stated the ATR was wrong -- upon reading the actual code, it properly includes `prevClose` in the TR calculation.

### RSI Implementation: NON-STANDARD (H2)
Uses simple average instead of Wilder smoothing. Produces valid but noisier RSI values.

### Bollinger Bands: CORRECT
Standard implementation: SMA(20) +/- 2*stdDev. Population stdDev (not sample) is used, which is the standard convention for BB.

### MACD: CORRECT
EMA-based MACD with signal line. The full histogram array builder (`macdHistogramArray`) is well-implemented for divergence detection.

### Stochastic: CORRECT
Standard %K and %D calculation with proper high/low tracking.

### ADX: CORRECT
Wilder's smoothing for DI+ and DI-, SMA for final ADX value. Requires 2*period+1 klines for stability, which is correctly enforced.

### VWAP: CORRECT
Typical Price = (H+L+C)/3 weighted by volume. Session-based with caller-defined window.

### Pivot Detection: MODERATE
`findPivots()` is correct but uses a fixed window (leftBars/rightBars). In noisy crypto data, small windows produce many false pivots. The divergence detection compares the last two pivots, which is the standard approach.

### stdDev: USES parseFloat for sqrt
```js
return toFixed(String(Math.sqrt(parseFloat(variance))), 8);
```
This breaks the String-arithmetic convention. Should be documented or replaced with a String-based sqrt approximation (Newton's method).

---

## Summary of Priority Actions

| Priority | ID | Issue | Estimated Impact |
|----------|-----|-------|-----------------|
| CRITICAL | C1 | Multi-symbol routing broken | 90% of intended symbols ignored |
| CRITICAL | C2 | Percentage vs quantity confusion | Orders 10,000x wrong size |
| CRITICAL | C4 | Backtest missing IndicatorCache | 14/18 strategies crash in backtest |
| CRITICAL | C3 | Backtest fill missing action | Unreliable backtest results |
| CRITICAL | C5 | Default strategy names don't exist | Bot starts with zero strategies |
| HIGH | H1 | Sharpe ratio ~10x inflated | Misleading performance evaluation |
| HIGH | H2 | RSI uses simple avg not Wilder | Signal quality degraded for 6 strategies |
| HIGH | H3 | No confidence filtering | Low-quality signals executed |
| HIGH | H4 | ExposureGuard qty confusion | Most orders incorrectly rejected |
| HIGH | H5 | Backtest 95% position size | Backtest results not comparable to live |
| HIGH | H6 | Signal filter memory leak | Progressive signal blocking |
| HIGH | H7 | No drawdown recovery | Bot permanently halted |
| MEDIUM | E1 | Dynamic position sizing | Better capital allocation |
| MEDIUM | E2 | Correlation-aware exposure | Hidden concentrated risk |
| MEDIUM | E4 | Exchange-side stop losses | No crash protection |
| MEDIUM | E5 | Limit order support | Fee savings |
| MEDIUM | E6 | Funding rate data source | FundingRateStrategy non-functional |
| LOW | E3 | Adaptive cooldown | Minor signal quality improvement |
| LOW | E7 | Multi-timeframe framework | Architecture improvement |
| LOW | E8 | Walk-forward optimization | Overfitting prevention |
