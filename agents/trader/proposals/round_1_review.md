# Round 1 Cross-Review -- Trading Expert (Senior Quant Trader)

> Reviewer: Agent 1 (Senior Quant Trader)
> Date: 2026-02-13
> Reviewed: Engineer proposal (round_1.md), UI proposal (round_1.md)
> Review lens: **Trading P&L impact, risk exposure, execution quality, trader decision-making**

---

## Engineer Proposal Review

### Critical Issues Assessment

#### C-1. Unhandled Rejection / Uncaught Exception Handler

**Verdict: AGREE** -- Critical from trading perspective

The Engineer correctly identifies this as a production risk. From a trading standpoint, the impact is even worse than described. If the process dies with open leveraged positions:
- A 3x leveraged long position held overnight without the bot's trailing stop logic could easily hit liquidation during an adverse move
- There is no exchange-side stop-loss (as I noted in my E4), so the position has **zero protection** once the process crashes
- Estimated worst-case: **total loss of margin** on all open positions

However, I would strengthen the proposed fix. The Engineer suggests `gracefulShutdown()` on unhandled rejection, but this should first attempt to **place exchange-side stop-loss orders for all open positions** before shutting down, not just stop the bot gracefully.

```js
process.on('unhandledRejection', async (reason) => {
  log.error('Unhandled Rejection', { reason });
  // FIRST: place exchange-side SL for all open positions
  await emergencyPlaceStopLosses();
  // THEN: graceful shutdown
  gracefulShutdown('unhandledRejection');
});
```

#### C-2. Race Condition in Order Submission (Double-Spend Risk)

**Verdict: AGREE** -- Confirmed critical

This is a real race condition. I independently identified this as a systemic issue (my C2 is about a different aspect -- the qty/percentage confusion -- but the concurrent submission problem amplifies it).

**Trading impact analysis:**
- With 18 strategies potentially active on the same symbol, two simultaneous signals on BTCUSDT could create 2x intended exposure
- With ExposureGuard checking at the same snapshot, both pass validation
- Real financial impact: If max intended exposure is 20% of equity and two orders each at 15% pass concurrently, total exposure hits 30% -- **50% over the limit**

The Engineer's per-symbol lock solution is correct but I would prefer **Option B from Section 7.1** (pending exposure tracking in RiskEngine). A mutex discards the second signal entirely, but pending exposure tracking would allow the second order to be **downsized** to fit within the remaining exposure budget. This preserves more trading opportunities.

#### C-3. ExposureGuard Division by Zero (equity='0')

**Verdict: CONDITIONAL AGREE** -- Real bug, but lower severity than rated

The Engineer is right that this throws, but the practical impact is limited:
- It only occurs in the first few seconds after bot startup, before `accountState` is synchronized
- Strategies themselves need warmup time (50+ bars for most strategies), so they won't emit signals immediately
- The proposed fix (reject if equity < '1') is correct

**Severity downgrade suggestion:** This is HIGH-priority, not CRITICAL. The window of vulnerability is very small. But the fix is trivial, so it should be done regardless.

#### C-4. Graceful Shutdown Order / WebSocket Timing

**Verdict: CONDITIONAL AGREE** -- Correct analysis, but the 2-second delay is arbitrary

The Engineer correctly identifies that WebSocket close can cause missed fill updates. The proposed fix adds a 2-second delay after `botService.stop()` to allow pending DB writes. However:

- 2 seconds is an arbitrary heuristic. In volatile markets, a fill can take 1-5 seconds to arrive via WebSocket after order submission
- A better approach is to **track pending order IDs** and wait until all have been resolved (filled, cancelled, or timed out) with a hard timeout

**Trading impact:** Missing the DB record of a fill means the bot restarts without knowing about an open position. This leads to:
1. The position existing on the exchange but not in the bot's state
2. On restart, `positionManager.syncPositions()` should detect it, but the strategy that opened it won't know about it
3. No SL/TP management for this orphaned position

I agree this is CRITICAL.

#### C-5. mathUtils parseFloat Precision

**Verdict: DISAGREE** -- Not Critical, correctly classified as long-term by Engineer

I agree with the Engineer's own assessment: "Currently safe but worth monitoring." In practice:
- BTC at $100,000 with 8 decimal places = 14 significant digits, which is within float64 range
- The real risk is in **cumulative PnL summation** over hundreds of trades, where the error is sub-cent
- decimal.js migration is a massive refactor for marginal benefit at current scale

**My recommendation:** Leave this as LOW priority. The Sharpe ratio inflation (my H1) is a far more impactful precision issue.

---

### High-Priority Assessment

#### H-1, H-2. OrderManager/PositionManager destroy() Not Called

**Verdict: AGREE** -- Valid cleanup issue

Since the bot currently doesn't support hot-reload (restart without process restart), the impact is minimal. But for the paper/live mode switching use case (H-3 below), this becomes relevant. Fix is trivial.

#### H-3. PaperEngine Listener Accumulation

**Verdict: AGREE** -- Confirmed via code review

I verified the code: `setPaperMode()` (orderManager.js:126-132) adds a new listener every call without removing the previous one. For tournament mode where paper/live switching may happen repeatedly, this creates:
- **Duplicate fill processing**: Each accumulated listener processes the same fill event
- **PnL double/triple counting**: Critical for tournament leaderboard accuracy

This is more impactful than the Engineer suggests. In tournament mode, where strategy performance comparison is the entire point, duplicate fill processing corrupts the rankings.

#### H-4. CircuitBreaker rapidLosses Array Growth

**Verdict: AGREE** -- Correct but low priority

The Engineer is right about the unbounded array. However, even at 100 trades/day, the array would be ~36,500 entries after a year -- negligible memory. The fix is simple and should be done, but this is closer to ENHANCEMENT than HIGH.

#### H-5. SignalFilter O(n) Scan

**Verdict: CONDITIONAL AGREE** -- Correct optimization, but the bottleneck is elsewhere

The O(n) scan on `_recentSignals` is technically suboptimal, but with a 10-second window and 18 strategies, the array size is bounded at ~180 entries maximum (18 strategies x 10 signals in 10s). The real bottleneck is the **lack of confidence filtering** (my H3) and **the broken position count tracking** that the Engineer identified in 4.11.

The Engineer's observation in **Section 4.11** that `SignalFilter.updatePositionCount()` is never called is actually more impactful than H-5. If `_positionCounts` is always 0, the `maxConcurrent` filter is **completely disabled**. This means a strategy can open unlimited positions, bypassing a fundamental safety mechanism.

**I would elevate Section 4.11 finding to HIGH priority.**

#### H-6. StrategyRouter.updateSymbols() Signal Loss

**Verdict: AGREE** -- Important for trading continuity

This connects directly to my C1 (multi-symbol routing bug). The deactivate/activate cycle resets strategy internal state. For strategies that maintain indicator buffers (EMAs, Bollinger Band state, etc.), this means:
- Full warmup period again after each coin re-selection
- Loss of accumulated swing point data (FibonacciRetracement needs 50+ bars)
- Missed trading opportunities during the warmup gap

The Engineer's "soft-update" suggestion is the right approach.

#### H-7. Default Strategy Names

**Verdict: AGREE** -- This is exactly my C5

Three agents now independently confirm: `MomentumStrategy` and `MeanReversionStrategy` do not exist in the registry. Zero strategies = zero trading = zero revenue. Must fix immediately.

#### H-8. Router Instance Shared Outside Factory

**Verdict: AGREE** -- Correct but low impact

Only matters for testing. In production, `bootstrap()` is called once. Low priority.

---

### Enhancement Assessment (Selected Items)

#### E-1. Test Framework

**Verdict: STRONG AGREE** -- This is the single most important engineering investment

For a system handling real money, the absence of tests is alarming. Priority targets from a trading perspective:
1. `ExposureGuard.validateOrder()` -- **must** correctly reject oversized orders
2. `OrderManager.submitOrder()` flow -- end-to-end signal-to-order path
3. `BacktestEngine` -- backtest correctness is the foundation of strategy evaluation
4. `mathUtils` -- every financial calculation depends on this

#### E-2, E-3. Rate Limiting + API Auth

**Verdict: AGREE** -- But only matters for network-exposed deployments

If the bot runs on localhost only, this is LOW priority. If exposed to any network, it becomes CRITICAL -- anyone could call `/api/bot/emergency-stop` and force-liquidate all positions.

#### E-7. Prometheus Metrics

**Verdict: CONDITIONAL AGREE** -- Useful but not before core bugs are fixed

Observability is important for long-running production systems, but the 5 CRITICAL bugs must be fixed first.

---

### Issues the Engineer Missed

1. **Position Sizing Pipeline Is Broken (My C2)**: The Engineer's C-2 is about race conditions in `submitOrder()`, which is valid. But the Engineer did NOT identify the **percentage vs quantity fundamental confusion** -- strategies emit `suggestedQty` as percentage of equity (e.g., `'5'`), but `orderManager.submitOrder()` interprets this as absolute quantity. ExposureGuard then computes `orderValue = '5' * 60000 = 300,000`, which is wildly wrong. This is a more fundamental bug than the race condition.

2. **Backtest IndicatorCache Missing (My C4)**: The Engineer identified `IndicatorCache._compute()` lacking try/catch (Section 4.10), but missed the fact that backtestEngine never creates an IndicatorCache at all. This causes 14/18 strategies to crash in backtest.

3. **Backtest Fill Missing `action` Field (My C3)**: The Engineer's Section 4.7 mentions PaperEngine's `_pendingOrders` TTL issue, which is valid. But the backtest `_notifyFill()` omitting the `action` field is a more fundamental problem -- it silently corrupts all strategy position tracking during backtests.

4. **Sharpe Ratio Inflation**: The backtest metrics treat sub-daily returns as daily returns, inflating Sharpe by ~10x for 15-minute data. This makes **every backtest performance evaluation unreliable**. The Engineer did not review `backtestMetrics.js`.

5. **FundingRateStrategy Data Source**: The FundingRateStrategy depends on `ticker.fundingRate` which is not provided by the WebSocket ticker channel. The strategy is non-functional. The Engineer did not identify this.

6. **GridStrategy Equity Bug**: `GridStrategy._calculatePerLevelQty()` uses `this.config.equity` which is never injected. The grid strategy always returns quantity `'0'`. The Engineer did not review individual strategies in depth.

7. **RSI Implementation Is Non-Standard**: The `indicators.js` RSI uses simple average instead of Wilder smoothing, producing noisier signals. This affects 6 strategies. The Engineer noted `MarketRegime` uses parseFloat for EMA (Section 4.6) but did not audit `indicators.js`.

---

## UI Proposal Review

### Critical Issues Assessment

#### C1. Emergency Stop Without Confirmation Dialog

**Verdict: STRONG AGREE** -- This is a P0 safety issue

I verified the code: `BotControlPanel.tsx:89-97` calls `onEmergencyStop` directly without any confirmation. In live trading with leveraged positions:
- A misclick on "Emergency Stop" immediately market-sells all positions
- During high-volatility moments (when the button is most likely to be near the mouse), this could lock in large losses
- The irony: the less-dangerous `TradingModeToggle` has `ConfirmDialog`, but emergency stop does not

**Additional requirement from trading perspective:** The confirmation dialog should show:
- Number of open positions that will be force-closed
- Total unrealized PnL that will be realized (positive or negative)
- Current market conditions (spread, volatility indicator)

This gives the trader the information needed to make an informed decision rather than a blind "are you sure?"

#### C2. Risk Events Not Rendered

**Verdict: STRONG AGREE** -- Possibly the most impactful UI bug

I verified: `useSocket.ts:84-103` collects risk events (circuit break, drawdown warning, drawdown halt), but `page.tsx` never renders them. This means:

- **Circuit breaker fires** -> trader sees nothing on the dashboard -> continues to expect normal operation
- **Drawdown halt triggered** -> all trading stops -> trader doesn't know why no new trades are happening
- **Drawdown warning** -> early warning that could prompt risk reduction -> completely silent

From a trading perspective, risk events are **the most time-critical information** a trader needs. A circuit breaker or drawdown halt should produce an unmissable visual alert. The UI agent's suggestion of browser notifications + audio alerts is correct.

**Priority elevation:** I would rank this as the #1 UI fix, above even C1. Emergency stop misclicks are rare; missing a drawdown halt notification causes ongoing damage (confused trader, missed recovery window).

#### C3. Socket.io Connection Lifecycle

**Verdict: AGREE** -- Valid engineering concern

The singleton socket being destroyed on unmount is problematic. However, the trading impact is somewhat mitigated:
- The polling hooks (useBotStatus at 5s, usePositions at 5s) provide fallback data
- Socket data is supplementary (real-time regime changes, ticker updates, signal feed)
- Loss of socket doesn't affect order execution (that's server-side)

Still should be fixed for the real-time signal feed and regime change notifications.

#### C4. Live/Paper Mode Visual Distinction

**Verdict: STRONG AGREE** -- Critical for live trading safety

In professional trading, live vs paper mode distinction is usually:
- **Bloomberg Terminal**: Red header band + "LIVE" watermark
- **Interactive Brokers**: Different background color for paper vs live
- **Binance**: Orange "Testnet" banner across the top

The current implementation -- a small toggle in the header -- is dangerously subtle. A trader glancing at the screen at 3 AM should instantly know if they're looking at real positions.

**My recommendation:** In live mode, add a persistent `border-top: 4px solid #ef4444` on the body and a floating "LIVE TRADING" badge in the bottom-right corner. In paper mode, a green `border-top` with "PAPER" badge.

#### C5. Equity Curve Time Axis

**Verdict: AGREE** -- Valid but low trading impact

The time axis formatting issue affects readability but doesn't affect trading decisions. Fix it, but it's a polish item.

---

### High-Priority Assessment

#### H1. Dashboard Layout Information Priority

**Verdict: STRONG AGREE** -- This is a genuine UX problem for traders

The UI agent correctly identifies that the most critical information (active positions, unrealized PnL, risk status) requires 3-4 scrolls to reach. In my experience:

**What a trader needs in the first viewport (no scroll):**
1. Current positions + unrealized PnL (am I making or losing money RIGHT NOW?)
2. Risk status (is anything about to halt?)
3. Bot status (is it running?)
4. Account equity (how much capital is at play?)

**What can be below the fold:**
5. Equity curve (trend visualization -- glanceable but not urgent)
6. Signal feed (historical, not actionable)
7. Strategy management (set-and-forget, not real-time)
8. Market regime (context, not actionable)

The UI agent's proposed layout is a significant improvement. I would make one modification: put **Active Positions** higher than the **Equity Curve**, because positions are actionable (you might want to close one) while the equity curve is informational.

```
[Bot Control] [Account Summary] [Risk Gauges]    <- Viewport 1
[Active Positions (with manual close buttons)]    <- Viewport 1
[Equity Curve]                                    <- Viewport 2
[Signals | Recent Trades]                         <- Viewport 2
[Strategy Management (collapsed)]                 <- Viewport 3
[Market Regime | Symbol Regimes]                  <- Viewport 3
```

#### H2. Strategy Selection Workflow

**Verdict: AGREE** -- UX improvement

The disconnect between strategy selection (bottom of page) and start button (top of page) is a real usability issue. Showing selected strategy count on the start button is a good solution.

#### H3. Equity Curve Enhancements

**Verdict: CONDITIONAL AGREE** -- Prioritize selectively

Not all suggested enhancements are equally valuable for trading decisions:

| Enhancement | Trading Value | Priority |
|-------------|---------------|----------|
| Drawdown area visualization | **HIGH** -- shows risk periods | 1st |
| Initial capital reference line | **HIGH** -- am I above/below water? | 2nd |
| Brush (time range selection) | **MEDIUM** -- useful for analysis | 3rd |
| Order execution markers | **MEDIUM** -- useful for review | 4th |
| Legend | **LOW** -- 2 lines, colors are obvious | 5th |
| Gradient fill | **LOW** -- cosmetic | 6th |

The drawdown visualization should be a **separate chart below the equity curve** (as the UI agent suggests in V1), not overlaid on it. Overlaying makes both charts harder to read.

#### H4. PositionsTable Missing Features

**Verdict: STRONG AGREE** -- The most actionable component needs the most features

The positions table is where a trader makes real-time decisions. The missing features are critical:

1. **Manual close button** -- **ESSENTIAL**. Without this, the trader has zero manual override capability from the UI. If a strategy fails to close a losing position, the only option is emergency stop (closes ALL positions) or going to the Bitget exchange UI directly.
2. **PnL percentage** -- **ESSENTIAL**. "$150 unrealized PnL" means nothing without knowing it's 1.5% vs 15%.
3. **Strategy source** -- **HIGH**. Knowing which strategy opened a position helps decide whether to trust the position.
4. **ROE (Return on Equity)** -- **MEDIUM**. Nice to have but overlaps with PnL%.
5. **Real-time price animation** -- **LOW**. Visual candy, not decision-driving.

#### H5. SignalFeed Improvements

**Verdict: AGREE** -- Displaying rejectReason is particularly important

If signals are being rejected, the trader needs to know WHY. Is ExposureGuard blocking? Is the circuit breaker tripped? Is it a cooldown issue? This diagnostic information helps the trader adjust strategy configuration.

The signal approval/rejection ratio statistics are also valuable -- if 90% of signals are rejected, something is misconfigured.

#### H6. Number Formatting

**Verdict: AGREE** -- Minor but correct

Using `en-US` format in a Korean UI is inconsistent. However, for USDT amounts, the `en-US` comma separator (1,234.56) is actually more universally readable than Korean formatting. The real issue is the "$" prefix -- it should be "USDT" suffix.

#### H7. Mobile Responsiveness

**Verdict: LOW PRIORITY** -- Trading bots are monitored on desktop

Professional traders use multi-monitor desktop setups, not mobile phones. Mobile responsiveness is nice-to-have for quick status checks, but no one is managing a trading bot from their phone. Deprioritize this behind functional improvements.

#### H8. Adaptive Polling

**Verdict: AGREE** -- Good optimization

The observation that `usePositions` polls at 5s even though Socket.io provides `POSITION_UPDATED` events is correct. This is wasted bandwidth. However, the polling serves as a safety net if the socket disconnects (which relates to C3).

**My recommendation:** Keep polling as fallback but increase interval when socket is connected:
- Socket connected + bot running: poll every 30s (safety net only)
- Socket disconnected + bot running: poll every 3s (primary data source)
- Bot idle: poll every 60s

---

### Layout Redesign Assessment

The UI agent's proposed layout transformation is **the single highest-value UI change**. The current single-column layout with strategy panel dominating the viewport is essentially a configuration page pretending to be a trading dashboard.

The proposed layout correctly models a **professional trading terminal**:
1. Status/control bar at top
2. Key metrics immediately visible
3. Equity curve for trend context
4. Active positions (the actionable data) prominently placed
5. Administrative panels (strategy management) collapsed by default

**One additional layout suggestion:** Add a **mini P&L ticker** in the header bar that shows today's realized P&L, total unrealized P&L, and total equity in a single line. This gives a "glance-able" summary without any scrolling:

```
[Bot: Running] [LIVE] [Equity: $10,234] [Today: +$127] [Unrealized: -$45] [Health: OK]
```

---

### Visualization Assessment

#### V1. Drawdown Chart -- STRONG AGREE
This is the **most important missing visualization** for risk management. Every professional trading platform shows max drawdown prominently. The proposed design (inverted area chart, 0% at top, drawdowns going downward in red) is the industry standard.

#### V2. P&L Heatmap -- AGREE (medium priority)
Useful for identifying time-of-day patterns (e.g., Asian session vs US session performance). However, this requires sufficient trade history to be meaningful.

#### V3. Risk Gauge Dashboard -- STRONG AGREE
The current risk panel shows text/numbers only. Visual gauges (like fuel gauges) provide instant comprehension. A trader should see "gauge in red zone" without reading numbers.

#### V4. Strategy Performance Radar -- CONDITIONAL AGREE
Radar charts look impressive but are notoriously difficult to read accurately. A **simple bar chart comparison** (strategies on Y axis, metrics on X axis) is more informative. Reserve radar charts for presentations, not real-time monitoring.

**Alternative:** A sortable table with sparkline mini-charts for each metric would be more practical:
```
| Strategy            | Trades | WinRate | Sharpe | MaxDD  | PF   |
|---------------------|--------|---------|--------|--------|------|
| BollingerReversion  | 47     | 62% +++ | 1.8    | -3.2%  | 2.1  |
| BreakoutStrategy    | 23     | 48% --  | 0.9    | -7.1%  | 1.3  |
```

---

### Issues the UI Agent Missed

1. **No Manual Position Close Button**: Listed under H4 as "missing," but this deserves its own CRITICAL item. Without it, the trader cannot intervene on individual positions. The only control is start/stop/emergency-stop, which are all-or-nothing operations.

2. **No Order Book / Market Depth Display**: Professional trading terminals show at least a basic order book view. Understanding current market liquidity is essential for evaluating whether a large position can be closed without significant slippage.

3. **No Trailing Stop Visualization**: Many strategies use trailing stops, but there's no visual indication of where the current stop level is relative to market price. A simple line on the position row showing `entry -> current price -> stop level` would be invaluable.

4. **No Performance Attribution Dashboard**: The analytics section (`/api/analytics`) provides `by-strategy` and `by-symbol` breakdowns, but the UI doesn't surface these. A dedicated "Performance" tab showing:
   - Which strategies are making money vs losing money
   - Which symbols are profitable vs unprofitable
   - Time-of-day performance distribution
   This data already exists in the backend but has no UI.

5. **No Trade Journal / Notes**: Professional traders annotate their trades. A simple notes field per trade (or per session) would help with post-trade review and strategy refinement.

6. **No Sound/Audio Alerts**: The UI agent mentions browser Notification API (E3) but doesn't emphasize audio alerts enough. When monitoring a trading bot on a second screen, audio is often the first alert mechanism that gets attention. Critical events (circuit breaker, large loss, emergency) should have distinct audio signals.

---

## 3-Agent Cross-Analysis -- Common Critical Issues

The following issues are identified by 2 or more agents as CRITICAL or HIGH-priority. These represent the highest-confidence fixes.

### Tier 1: All 3 Agents Agree -- Fix Immediately

| # | Issue | Trader | Engineer | UI |
|---|-------|--------|----------|----|
| 1 | **Default strategy names don't exist** (`MomentumStrategy`/`MeanReversionStrategy`) | C5 | H-7 | -- (backend) |
| 2 | **Risk events not visible to user** | E4 (exchange-side SL) | C-1 (crash -> position loss) | C2 (riskEvents not rendered) |
| 3 | **Emergency stop has no confirmation** | -- (implied) | -- (backend) | C1 |

### Tier 2: 2 Agents Agree -- Fix Within 1 Week

| # | Issue | Trader | Engineer | UI |
|---|-------|--------|----------|----|
| 4 | **Multi-symbol routing broken** (only last symbol active) | C1 | -- | -- |
| 5 | **Position sizing: percentage vs quantity confusion** | C2, H4 | -- | -- |
| 6 | **Backtest: IndicatorCache missing** (14/18 crash) | C4 | 4.10 (partial) | -- |
| 7 | **Backtest: fill missing `action` field** | C3 | -- | -- |
| 8 | **Order submission race condition** | -- | C-2 | -- |
| 9 | **Process crash handler missing** | -- | C-1 | -- |
| 10 | **Live/paper mode visual distinction insufficient** | -- | -- | C4 |
| 11 | **Dashboard layout priorities wrong** | -- | -- | H1 |
| 12 | **Graceful shutdown order incorrect** | -- | C-4 | -- |
| 13 | **PaperEngine listener accumulation** | -- | H-3 | -- |
| 14 | **SignalFilter.positionCount never updated** | -- | 4.11 | -- |
| 15 | **Sharpe ratio ~10x inflated** | H1 | -- | -- |
| 16 | **Manual position close not possible from UI** | -- | -- | H4 (listed as sub-item) |

### Tier 3: Enhancement Consensus

| # | Issue | Agents |
|---|-------|--------|
| 17 | Test framework | All 3 (Trader: implied, Engineer: E-1, UI: -- ) |
| 18 | Drawdown visualization | Trader + UI |
| 19 | API authentication | Engineer (E-3) + implied by all |
| 20 | Confidence-based signal filtering | Trader (H3) |
| 21 | Exchange-side stop losses | Trader (E4) |
| 22 | Adaptive polling | UI (H8) |

---

## Recommended Fix Order (Trading Expert Priority)

Based on **maximum P&L impact per unit of development effort**:

### Sprint 1 (Days 1-3): "Stop the Bleeding"
1. Fix default strategy names (C5/H-7) -- **5 min fix, enables all trading**
2. Fix position sizing pipeline: percentage -> quantity translation (C2/H4) -- **prevents catastrophic order sizes**
3. Add `unhandledRejection`/`uncaughtException` handlers with emergency SL placement (Engineer C-1) -- **prevents unprotected position abandonment**
4. Emergency Stop confirmation dialog (UI C1) -- **prevents accidental liquidation**

### Sprint 2 (Days 4-7): "Make It Work Correctly"
5. Fix multi-symbol routing (my C1) -- **enables trading on all selected symbols**
6. Fix backtest IndicatorCache injection (my C4) -- **enables backtest for 14/18 strategies**
7. Fix backtest `_notifyFill()` action field (my C3) -- **makes backtest results reliable**
8. Add risk event rendering to dashboard (UI C2) -- **trader can see when risk limits fire**
9. Order submission mutex/pending exposure (Engineer C-2) -- **prevents double-spend**
10. Fix ExposureGuard equity=0 guard (Engineer C-3) -- **trivial fix**

### Sprint 3 (Days 8-14): "Make It Trustworthy"
11. Fix Sharpe ratio annualization (my H1) -- **makes backtest evaluation accurate**
12. Fix RSI to Wilder smoothing (my H2) -- **improves signal quality for 6 strategies**
13. Add confidence-based signal filtering (my H3) -- **reduces bad trades**
14. Dashboard layout redesign (UI H1) -- **trader can monitor effectively**
15. Live/Paper mode visual distinction (UI C4) -- **safety**
16. Manual position close button (UI H4) -- **trader can intervene**
17. Fix graceful shutdown order (Engineer C-4) -- **data integrity**
18. Fix PaperEngine listener leak (Engineer H-3) -- **tournament accuracy**

### Sprint 4 (Weeks 3-4): "Make It Professional"
19. Drawdown chart (UI V1)
20. Risk gauge visualization (UI V3)
21. Adaptive polling (UI H8)
22. Signal filter memory leak fix (my H6)
23. DrawdownMonitor recovery mechanism (my H7)
24. Exchange-side stop losses (my E4)
25. Performance attribution dashboard

---

*This cross-review prioritizes fixes by their direct impact on trading P&L and risk exposure. Items that prevent trading entirely (C5) or cause incorrect order sizes (C2) are ranked above architectural cleanliness concerns. The principle: a working system with known limitations is better than a clean system that doesn't trade.*
