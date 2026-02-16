# Round 9 Proposal — Tier 2 Quality (11건 + Deferred 2건)

**Author**: Senior Quant Trader Agent
**Date**: 2026-02-16
**Scope**: Backend 6건 + Frontend 코멘트 5건 + Deferred 재활성화 2건
**Base Commit**: `81bdca6` (Sprint R8)

---

## 분석 요약

Round 8까지 46건 합의, 25건 구현, 2건 deferred. 이번 라운드는 Tier 2에 해당하는 11건 agreed 항목과 deferred 2건의 재활성화를 검토한다.

**트레이딩 관점 우선순위 평가**:

| 순위 | 항목 | 수익 영향 | 리스크 영향 | 구현 난이도 |
|------|------|----------|-----------|-----------|
| 1 | R8-T2-1 (멀티심볼 라우팅) | **높음** | 중간 | 높음 |
| 2 | R8-T2-3 (펀딩비 PnL) | **높음** | 중간 | 중간 |
| 3 | R8-T2-2 (전략 warm-up) | 중간 | **높음** | 낮음 |
| 4 | R8-T2-4 (코인 재선정) | **높음** | 낮음 | 중간 |
| 5 | R8-T0-5 (PositionManager 전략 매핑) | 중간 | **높음** | 중간 |
| 6 | R8-T1-1 (InstrumentCache lot step) | 중간 | 중간 | 중간 |
| 7 | R8-T2-6 (StateRecovery 활성화) | 낮음 | **높음** | 낮음 |
| 8 | R8-T2-5 (Paper 전환 경고) | 낮음 | 낮음 | 낮음 |

핵심 인사이트: **현재 시스템은 모든 전략이 동일한 단일 심볼(symbols[0])에서만 거래한다.** `strategyRouter.js:161`에서 `const symbol = this._symbols[0]`으로 하드코딩되어 있으므로, 18개 전략이 있어도 사실상 1개 코인에 집중 투자되는 구조다. 이는 포트폴리오 다변화의 근본적 결여이며, 멀티심볼 라우팅(R8-T2-1)이 단일 최고 수익 향상 항목인 이유다.

---

## Backend 항목 분석

### R8-T2-1: 멀티심볼 라우팅 Phase 1 — 전략마다 다른 단일 심볼 배정

**현재 코드 분석**:

1. **`strategyRouter.js:161`** — `_routeStrategies()`에서 `const symbol = this._symbols[0]`으로 첫 번째 심볼만 사용:
   ```js
   // T0-3 Phase 1: 1 symbol per strategy to prevent internal state contamination
   const symbol = this._symbols[0];
   if (symbol) {
     strategy.activate(symbol, this._category);
   }
   ```

2. **`strategyRouter.js:403-410`** — `updateSymbols()`도 동일하게 `symbols[0]`만 사용.

3. **`botService.js:307-319`** — `onTickerUpdate` 핸들러에서 `strategy._symbol === ticker.symbol` 비교로 전략-심볼 매칭이 이미 동작 중.

4. **`coinSelector.js`** — `selectCoins()`가 이미 최대 10개 심볼을 스코어링하여 반환하지만, 결과 중 첫 번째만 사용됨.

5. **`strategyBase.js:40-175`** — `_symbols` Set, `addSymbol()`, `removeSymbol()`, `hasSymbol()`, `_currentProcessingSymbol` 등 멀티심볼 인프라가 이미 존재(T0-3에서 준비됨).

**구현 방안**:

**Phase 1 목표**: 전략마다 **단일 심볼**을 배정하되, 전략별로 **다른** 심볼을 배정.

**파일: `backend/src/services/strategyRouter.js`**

1. `_routeStrategies()` 수정:
   - 현재: `this._symbols[0]` 고정
   - 변경: 라운드 로빈 또는 스코어 기반 심볼 배정
   - 배정 로직:
     ```
     a) CoinSelector 스코어 기반: 각 전략의 riskLevel/targetRegimes와 심볼의 특성 매칭
     b) 동일 심볼에 배정되는 전략 수 제한 (maxStrategiesPerSymbol = 3)
     c) BTCUSDT는 MarketRegime 전용으로 예약 (전략 배정 제외)
     ```

2. `_symbolAssignment` Map 추가 (`strategyName → symbol`):
   ```js
   /** @type {Map<string, string>} Strategy name → assigned symbol */
   this._symbolAssignment = new Map();
   ```

3. 새 메서드 `_assignSymbols(strategies, symbols, regime)`:
   ```js
   _assignSymbols(strategies, symbols, regime) {
     // 1. BTCUSDT 제외 (MarketRegime 전용)
     const tradableSymbols = symbols.filter(s => s !== 'BTCUSDT');
     if (tradableSymbols.length === 0) {
       // Fallback: 전체 symbols[0] 사용 (기존 동작)
       tradableSymbols.push(symbols[0]);
     }

     // 2. 전략별 선호도 기반 배정
     //    - Funding 전략 → 펀딩비 절대값 높은 심볼
     //    - Grid/Ranging 전략 → 변동성 적절한 심볼
     //    - Trend 전략 → 모멘텀 강한 심볼
     //    - 기본: 라운드 로빈

     // 3. 동일 심볼 과부하 방지 (maxStrategiesPerSymbol)

     this._symbolAssignment.clear();
     // ... 배정 로직 ...
   }
   ```

4. `updateSymbols()` 수정: 재배정 후 전략 재활성화.

5. `getStatus()` 확장: 전략-심볼 매핑 정보 포함.

**파일: `backend/src/services/botService.js`**

1. `start()` 내 step 10에서 `strategyRouter.start()` 호출 시 coinSelector 결과(스코어 포함)도 전달:
   ```js
   this.strategyRouter.start(this.strategies, this._selectedSymbols, category, selectedCoins);
   ```

2. `onTickerUpdate`, `onKlineUpdate` 핸들러는 이미 `strategy._symbol === ticker.symbol`로 비교하므로 변경 불필요.

**트레이딩 관점 영향**:
- **기대수익 +20~30%**: 단일 심볼 집중 → 다변화로 기회 공간 확대
- **상관관계 감소**: 서로 다른 코인에 분산됨으로써 전략 간 PnL 상관관계 하락
- **리스크**: 유동성 낮은 심볼에 배정 시 슬리피지 증가 → 최소 볼륨/스프레드 필터로 방어 (coinSelector 이미 적용)
- **주의**: Phase 1은 1전략:1심볼이므로, 동일 전략 내 다중 심볼은 Phase 2로 미룸

**의존성**: R8-T0-5(PositionManager 전략 매핑)와 **강한 시너지**. 전략별 다른 심볼 배정 시 포지션의 strategy 필드가 정확해야 `_closeStrategyPositions()`가 올바르게 동작.

---

### R8-T2-2: 전략 warm-up 기간 (warmupCandles 메타데이터)

**현재 코드 분석**:

1. **각 전략이 자체적으로 warm-up 체크를 수행** — 예:
   - `RsiPivotStrategy.js:161`: `hist.closes.length < rsiPeriod + 1` → 15개 필요
   - `AdaptiveRegimeStrategy.js:228-238`: `minRequired = Math.max(bbPeriod, rsiPeriod+1, adxPeriod*2+1, emaPeriodSlow)` → 29개 이상 필요
   - `TurtleBreakoutStrategy.js:249`: `Math.max(trendFilter+1, entryChannel+1, exitChannel+1, atrPeriod+1)` → 51개 필요

2. **문제점**: warm-up 기간 동안 전략이 `return` 하면서 조용히 무시되지만, **BotService나 StrategyRouter는 전략이 warm-up 중인지 모름**. 이로 인해:
   - 전략이 활성화되었다고 보고되지만 실제 시그널은 0건
   - 대시보드에서 "활성" 상태로 표시되나 왜 시그널이 없는지 사용자가 혼란
   - SignalFilter의 쿨다운이 warm-up 완료 전에 시작될 수 있음

3. **`strategyBase.js`에 warmup 관련 필드/메서드 없음**.

**구현 방안**:

**파일: `backend/src/services/strategyBase.js`**

1. `static metadata`에 `warmupCandles` 필드 추가 (각 전략에서 정의):
   ```js
   // StrategyBase에 기본값 추가
   getWarmupCandles() {
     const meta = this.constructor.metadata;
     return (meta && meta.warmupCandles) || 0;
   }
   ```

2. warm-up 상태 추적:
   ```js
   /** @type {number} Number of klines received since activation */
   this._klineCount = 0;

   /** @returns {boolean} Whether the strategy has completed warm-up */
   isWarmedUp() {
     return this._klineCount >= this.getWarmupCandles();
   }
   ```

3. `onKline()` 호출 시 `_klineCount++` (각 전략의 super.onKline() 호출이 없으므로 `activate()`에서 리셋, 카운트는 BotService에서 관리하거나 StrategyBase에 wrapper 추가).

   더 깔끔한 접근: StrategyBase에 `_preOnKline()` wrapper:
   ```js
   _preOnKline(kline) {
     this._klineCount++;
   }
   ```
   그러나 현재 onKline()이 직접 호출되므로, **BotService의 onKlineUpdate 핸들러에서 카운트 관리**가 더 비침투적:

   ```js
   // botService.js — onKlineUpdate 핸들러 내
   if (strategy.isActive() && strategy._symbol === kline.symbol) {
     strategy._klineCount = (strategy._klineCount || 0) + 1;
     try { strategy.onKline(kline); } catch (err) { ... }
   }
   ```

**각 전략에 `warmupCandles` 추가** (18개 전략 모두):

| 전략 | warmupCandles | 산출 근거 |
|------|-------------|----------|
| RsiPivotStrategy | 15 | rsiPeriod(14) + 1 |
| MaTrendStrategy | 60 | dailySlowEma(30) × 2 (집계) |
| SupertrendStrategy | 60 | atrPeriod + 50 buffer (코드에 명시) |
| BollingerReversionStrategy | 22 | bbPeriod(20) + 2 |
| TurtleBreakoutStrategy | 51 | trendFilter(50) + 1 |
| AdaptiveRegimeStrategy | 43 | adxPeriod(14)*2 + emaPeriodSlow(21) 중 max=29, +14 버퍼 |
| BreakoutStrategy | 30 | 추정 |
| QuietRangeScalpStrategy | 30 | 추정 |
| GridStrategy | 1 | 즉시 동작 가능 |
| FundingRateStrategy | 1 | 펀딩비 데이터만 필요 |
| VwapReversionStrategy | 20 | vwap 주기 |
| MacdDivergenceStrategy | 35 | slow(26) + signal(9) |
| CandlePatternStrategy | 5 | 최근 5캔들 |
| SupportResistanceStrategy | 30 | S/R 레벨 감지 |
| SwingStructureStrategy | 20 | 스윙 포인트 감지 |
| FibonacciRetracementStrategy | 30 | 추세 식별 |
| TrendlineBreakoutStrategy | 30 | 추세선 감지 |

**파일: `backend/src/services/strategyRouter.js`**

1. `getStatus()`에 warm-up 상태 추가:
   ```js
   warmupState: s.isWarmedUp ? (s.isWarmedUp() ? 'ready' : 'warming_up') : 'unknown',
   klineCount: s._klineCount || 0,
   warmupRequired: s.getWarmupCandles ? s.getWarmupCandles() : 0,
   ```

**트레이딩 관점 영향**:
- **리스크 감소**: warm-up 미완료 전략의 시그널을 명시적으로 식별 가능 → 불완전한 지표 기반 진입 방지
- **운영 투명성**: 대시보드에서 "warm-up 중" 상태를 확인 가능 → 시그널 부재 원인 파악
- **백테스트 정합성**: 백테스트에서 warm-up 기간을 동일하게 적용 가능

---

### R8-T2-3: 펀딩비 PnL 반영 (WS account + 백테스트)

**현재 코드 분석**:

1. **`fundingDataService.js`** — 이미 5분 간격으로 펀딩비/OI 데이터 폴링 중. `FUNDING_UPDATE` 이벤트 발행. 그러나 **PnL 계산에 펀딩비를 반영하지 않음**.

2. **`orderManager.js:1002-1024`** — PnL 계산:
   ```js
   // Long close: PnL = (exitPrice - entryPrice) * qty
   // Short close: PnL = (entryPrice - exitPrice) * qty
   // fee만 차감, 펀딩비 미반영
   pnl = math.subtract(pnl, trade.fee);
   ```

3. **`backtestEngine.js`** — `_closeLong()`, `_closeShort()`에서 PnL = grossPnl - totalFee. 펀딩비 미반영.

4. **`positionManager.js:319-346`** — WS account 이벤트에서 equity/unrealizedPnl은 업데이트하지만, 펀딩비 관련 필드를 파싱하지 않음.

5. **Bitget WS `account` 토픽**: 실시간으로 펀딩비 정산이 equity에 반영됨. 따라서 equity 기반 계산은 자동으로 펀딩비가 포함되지만, **개별 포지션 PnL 추적에는 누락**.

**구현 방안**:

**A. 라이브 트레이딩 — 펀딩비 PnL 추적**

**파일: `backend/src/services/positionManager.js`**

1. 포지션 엔트리에 `accumulatedFunding` 필드 추가:
   ```js
   _parsePositionEntry(raw) {
     return {
       ...existing,
       accumulatedFunding: String(raw.fundingFee || raw.settleProfit || '0'),
     };
   }
   ```

2. WS `account` 이벤트에서 `fundingFee` 필드 파싱 (Bitget WS는 정산 시 `settle` 이벤트 발행):

   **실제 구현 시 유의**: Bitget UTA 모드에서 펀딩비 정산은 WS `account` 토픽의 equity 변동으로 자동 반영됨. 개별 펀딩비 내역은 REST API `GET /api/v2/mix/position/history-position`의 `settleProfit` 필드로 조회 가능.

3. `fundingDataService.js`에 마지막 정산 시간 추적 추가:
   ```js
   // nextSettlement 필드를 이미 파싱 중 (line 121)
   // 정산 직후 추가 REST 호출로 정산 금액 확인 가능
   ```

**B. Paper 모드 — 펀딩비 시뮬레이션**

**파일: `backend/src/services/paperPositionManager.js`** (또는 `paperAccountManager.js`)

1. 포지션별 `lastFundingTime`, `accumulatedFunding` 추가.
2. `fundingDataService`의 `FUNDING_UPDATE` 이벤트 수신 시:
   ```js
   // 펀딩비 = positionValue × fundingRate
   // Long: 양(+) 펀딩비 → 비용(PnL 감소), 음(-) 펀딩비 → 수익(PnL 증가)
   // Short: 양(+) 펀딩비 → 수익, 음(-) 펀딩비 → 비용
   const fundingCost = math.multiply(
     math.multiply(pos.qty, pos.markPrice),
     fundingRate
   );
   // Long pays positive, Short receives positive
   const adjustedCost = pos.posSide === 'long' ? fundingCost : math.negate(fundingCost);
   ```

**C. 백테스트 — 펀딩비 시뮬레이션**

**파일: `backend/src/backtest/backtestEngine.js`**

1. `constructor`에 `fundingRate` 파라미터 추가 (기본값 `'0.0001'` = 0.01% per 8h):
   ```js
   this.fundingRate = String(fundingRate || '0.0001');
   this.fundingIntervalBars = this._calculateFundingInterval(interval);
   ```

2. 메인 루프에서 8시간마다 펀딩비 정산:
   ```js
   // 4e. Funding fee settlement (every 8 hours)
   if (this._position && i % this.fundingIntervalBars === 0 && i > 0) {
     const positionValue = math.multiply(this._position.qty, kline.close);
     const fundingCost = math.multiply(positionValue, this.fundingRate);
     if (this._position.side === 'long') {
       this._cash = math.subtract(this._cash, fundingCost);
     } else {
       this._cash = math.add(this._cash, fundingCost);
     }
     this._position.accumulatedFunding = math.add(
       this._position.accumulatedFunding || '0', fundingCost
     );
   }
   ```

3. 트레이드 기록에 `fundingFee` 필드 추가:
   ```js
   this._trades.push({
     ...existing,
     fundingFee: position.accumulatedFunding || '0',
   });
   ```

**트레이딩 관점 영향**:
- **PnL 정확도 대폭 향상**: 펀딩비는 포지션 유지 비용의 핵심 요소. 8시간 간격 ±0.01% 기본이지만, 변동성 구간에서 ±0.1%까지 올라감. 1일 3회 × 0.03% = 연간 ~10% 수준
- **전략 선택에 영향**: Funding 전략(fundingRateStrategy)의 백테스트 결과가 비현실적으로 좋을 수 있음 → 펀딩비 반영으로 정확한 평가
- **Sharpe 비율 정확도**: 펀딩비는 지속적 비용이므로 Sharpe에 직접 영향
- **라이브 PnL vs 백테스트 PnL 괴리 감소**

---

### R8-T2-4: 코인 재선정 주기 (4~8시간 고정 간격)

**현재 코드 분석**:

1. **`botService.js:208`** — `selectCoins()`는 `start()` 시 **한 번만** 호출:
   ```js
   const selectedCoins = await this.coinSelector.selectCoins(category);
   this._selectedSymbols = selectedCoins.map((c) => c.symbol);
   ```

2. **봇이 실행되는 동안 코인이 재선정되지 않음**. 시장 환경이 변해도 동일한 심볼 세트 유지.

3. **`coinSelector.js`** — 레짐 기반 가중치 프로파일이 있으므로, 레짐이 바뀌면 다른 코인이 선정될 수 있지만 재호출이 없으므로 반영 안 됨.

4. **`strategyRouter.js:398-415`** — `updateSymbols()` 메서드가 이미 존재하며, 호출되면 전략을 새 심볼로 재활성화:
   ```js
   updateSymbols(symbols) {
     this._symbols = symbols;
     for (const strategy of this.getActiveStrategies()) {
       strategy.deactivate();
       const symbol = symbols[0];
       if (symbol) strategy.activate(symbol, this._category);
       strategy.setMarketRegime(this._currentRegime);
     }
   }
   ```

5. **`fundingDataService.js:79-83`** — `updateSymbols()` 메서드 존재하여 런타임 심볼 변경 대응 가능.

**구현 방안**:

**파일: `backend/src/services/botService.js`**

1. 재선정 타이머 추가:
   ```js
   /** @type {NodeJS.Timeout|null} Coin re-selection timer */
   this._coinReselectInterval = null;

   /** @type {number} Re-selection interval in ms (default 4h) */
   this._coinReselectIntervalMs = 4 * 60 * 60 * 1000;
   ```

2. `start()` 내 step 6 후에 재선정 타이머 시작:
   ```js
   // 6b. Start periodic coin re-selection (R8-T2-4)
   this._startCoinReselection(category);
   ```

3. `_startCoinReselection(category)` 메서드:
   ```js
   _startCoinReselection(category) {
     this._coinReselectInterval = setInterval(async () => {
       try {
         await this._reselectCoins(category);
       } catch (err) {
         log.error('Coin re-selection failed', { error: err.message });
       }
     }, this._coinReselectIntervalMs);
     if (this._coinReselectInterval.unref) this._coinReselectInterval.unref();
   }
   ```

4. `_reselectCoins(category)` 메서드:
   ```js
   async _reselectCoins(category) {
     log.info('Coin re-selection starting');

     const newCoins = await this.coinSelector.selectCoins(category);
     const newSymbols = newCoins.map(c => c.symbol);

     // 항상 BTCUSDT 포함
     if (!newSymbols.includes('BTCUSDT')) {
       newSymbols.unshift('BTCUSDT');
     }

     // 변경 없으면 skip
     const oldSet = new Set(this._selectedSymbols);
     const newSet = new Set(newSymbols);
     if (oldSet.size === newSet.size && [...oldSet].every(s => newSet.has(s))) {
       log.info('Coin re-selection — no change');
       return;
     }

     // 새 심볼 구독 (기존 + 신규)
     const addedSymbols = newSymbols.filter(s => !oldSet.has(s));
     if (addedSymbols.length > 0) {
       this.marketData.subscribeSymbols(addedSymbols, category);
     }

     this._selectedSymbols = newSymbols;

     // 하위 서비스 업데이트
     if (this.strategyRouter) {
       this.strategyRouter.updateSymbols(newSymbols);
     }
     if (this.fundingDataService) {
       this.fundingDataService.updateSymbols(newSymbols);
     }
     if (this.symbolRegimeManager) {
       const nonBtc = newSymbols.filter(s => s !== 'BTCUSDT');
       this.symbolRegimeManager.start(nonBtc); // restart with new symbols
     }

     // Session 업데이트
     if (this.currentSession) {
       this.currentSession.symbols = newSymbols;
       await this.currentSession.save();
     }

     this.emit('coins_reselected', {
       previous: [...oldSet],
       current: newSymbols,
       added: addedSymbols,
       removed: [...oldSet].filter(s => !newSet.has(s)),
       timestamp: new Date().toISOString(),
     });

     log.info('Coin re-selection complete', {
       added: addedSymbols,
       removed: [...oldSet].filter(s => !newSet.has(s)),
       newSymbols,
     });
   }
   ```

5. `stop()` 내 타이머 정리:
   ```js
   if (this._coinReselectInterval) {
     clearInterval(this._coinReselectInterval);
     this._coinReselectInterval = null;
   }
   ```

**주의사항**:
- **열린 포지션이 있는 심볼 제거 금지**: 제거 대상 심볼에 열린 포지션이 있으면 해당 심볼은 유지해야 함. 포지션 청산 후 자연스럽게 제거.
- **MarketData 구독 해제**: 현재 `marketData.subscribeSymbols()`는 추가만 지원하고 해제는 미지원. 메모리 누수 방지를 위해 `unsubscribeSymbols()` 추가 필요 (Phase 2).

**트레이딩 관점 영향**:
- **기회 포착**: 갑자기 거래량/변동성이 급증한 신규 코인을 4시간 내에 포착
- **손실 코인 회피**: 유동성이 떨어진 코인을 자연스럽게 교체
- **레짐 적응**: 레짐 변경 후 해당 레짐에 최적인 코인으로 재선정
- **4시간 간격 근거**: 8시간은 너무 느림(펀딩비 주기와 동일), 1시간은 잦은 변경으로 warm-up 비용 증가. 4시간이 균형점.

---

### R8-T2-5: Paper 모드 trading-mode 전환 경고 강화

**현재 코드 분석**:

1. **`botService.js:795-813`** — `setTradingMode()`:
   ```js
   setTradingMode(mode) {
     if (this._running) {
       throw new Error('봇이 실행 중입니다. 먼저 정지해주세요.');
     }
     // ... 모드 전환 ...
   }
   ```
   봇 실행 중 차단은 있지만, live→paper 전환 시 **열린 포지션 존재 경고 없음**.

2. **`botRoutes.js:122-134`** — POST `/api/bot/trading-mode`:
   - 모드만 전달, 확인 메커니즘 없음
   - 포지션 상태 확인 없음

3. **`frontend/src/components/TradingModeToggle.tsx`** — 단순 토글, 확인 다이얼로그 있지만 포지션 경고 없음.

**구현 방안**:

**파일: `backend/src/services/botService.js`**

1. `setTradingMode()` 강화:
   ```js
   setTradingMode(mode) {
     if (this._running) {
       throw new Error('봇이 실행 중입니다. 먼저 정지해주세요.');
     }

     // R8-T2-5: 라이브 포지션 존재 시 경고
     if (mode === 'paper' && !this.paperMode) {
       const positions = this.positionManager.getPositions();
       if (positions.length > 0) {
         const symbols = positions.map(p => `${p.symbol}:${p.posSide}`).join(', ');
         throw new Error(
           `라이브 포지션이 ${positions.length}개 열려 있습니다 (${symbols}). ` +
           `Paper 모드로 전환하면 이 포지션은 수동 관리해야 합니다. ` +
           `force=true 파라미터로 강제 전환 가능합니다.`
         );
       }
     }

     // ... 기존 로직 ...
   }
   ```

2. `force` 파라미터 지원:
   ```js
   setTradingMode(mode, { force = false } = {}) {
     // ... running check ...
     if (mode === 'paper' && !this.paperMode && !force) {
       // ... position check ...
     }
     // ... 전환 로직 ...
   }
   ```

**파일: `backend/src/api/botRoutes.js`**

1. POST `/api/bot/trading-mode` 핸들러에서 `force` 전달:
   ```js
   const { mode, force } = req.body || {};
   botService.setTradingMode(mode, { force: force === true });
   ```

**트레이딩 관점 영향**:
- 실거래 → 페이퍼 전환 시 실수로 라이브 포지션을 방치하는 사고 방지
- 구현 비용 매우 낮음 (30분)

---

### R8-T2-6: StateRecovery + OrphanOrderCleanup 활성화 (Paper 검증 후)

**현재 코드 분석**:

1. **`app.js:157-164`** — 인스턴스 생성됨:
   ```js
   const stateRecovery = new StateRecovery({ exchangeClient, orderManager });
   const orphanOrderCleanup = new OrphanOrderCleanup({ exchangeClient });
   ```

2. **어디에서도 `.recover()` 또는 `.start()` 호출되지 않음**. Grep 결과 확인 완료.

3. **`stateRecovery.js`** — `recover()` 메서드가 완전히 구현되어 있음. DB 주문 ↔ 거래소 주문 비교, 상태 불일치 해결.

4. **`orphanOrderCleanup.js`** — `start()` → 5분 간격 주기적 검사, `cleanup()` → 고아 주문 탐지 및 취소. 완전 구현.

**구현 방안**:

**파일: `backend/src/services/botService.js`**

1. DI로 `stateRecovery`, `orphanOrderCleanup` 주입:
   ```js
   constructor({ ..., stateRecovery, orphanOrderCleanup }) {
     this.stateRecovery = stateRecovery || null;
     this.orphanOrderCleanup = orphanOrderCleanup || null;
   }
   ```

2. `start()` 내 step 4(positionManager.start) 이전에 상태 복구 실행:
   ```js
   // 3b. State recovery — reconcile DB vs exchange (R8-T2-6)
   if (this.stateRecovery && !this.paperMode) {
     try {
       const result = await this.stateRecovery.recover(category);
       log.info('State recovery completed', result);
     } catch (err) {
       log.error('State recovery failed (non-fatal)', { error: err.message });
     }
   }
   ```

3. `start()` 내 마지막 단계에서 OrphanOrderCleanup 시작:
   ```js
   // 16b. Start orphan order cleanup (R8-T2-6)
   if (this.orphanOrderCleanup && !this.paperMode) {
     this.orphanOrderCleanup.start(category);
     this._eventCleanups.push(() => {
       this.orphanOrderCleanup.stop();
     });
   }
   ```

**파일: `backend/src/app.js`**

1. BotService 생성자에 추가 주입:
   ```js
   const botService = new BotService({
     ...,
     stateRecovery,
     orphanOrderCleanup,
   });
   ```

**Paper 모드 조건부**:
- Paper 모드에서는 StateRecovery/OrphanOrderCleanup 불필요 (거래소 API 미사용)
- `!this.paperMode` 조건으로 라이브 모드에서만 활성화

**트레이딩 관점 영향**:
- **크래시 복구**: 봇 다운 중 체결/취소된 주문의 DB 정합성 보장
- **고아 주문 방지**: 의도치 않은 노출(exposure) 방지 → 리스크 엔진의 정확성 향상
- **수익 영향**: 간접적이지만, 정확한 포지션 추적은 올바른 시그널 생성의 전제조건

---

## Deferred 항목 재활성화 판단

### R8-T0-5: PositionManager 전략 메타데이터 주입

**현재 코드 분석**:

1. **`positionManager.js:423-443`** — `_parsePositionEntry()`에 `strategy` 필드 없음:
   ```js
   return {
     symbol, posSide, qty, entryPrice, markPrice,
     unrealizedPnl, leverage, marginMode, liquidationPrice,
     updatedAt: new Date(),
     // strategy 필드 없음!
   };
   ```

2. **`botService.js:1044-1098`** — `_closeStrategyPositions()`에서 `p.strategy === strategyName`으로 필터링하는데, PositionManager의 포지션에는 `strategy` 필드가 없으므로 **라이브 모드에서 전략 비활성화 시 포지션 청산이 작동하지 않을 가능성**.

3. **Paper 모드에서는 PaperPositionManager가 `strategy` 필드를 관리**하므로 문제 없음.

4. **문제**: Bitget 거래소 API는 포지션에 전략 이름을 저장하지 않으므로, 라이브 모드에서는 별도의 매핑 테이블이 필요.

**재활성화 판단: YES — R8-T2-1(멀티심볼)과 함께 구현**

**근거**:
- 멀티심볼 라우팅 시 서로 다른 전략이 다른 심볼에서 거래 → 포지션-전략 매핑이 필수
- 현재 단일 심볼에서도 다수 전략이 동일 심볼/동일 방향 포지션을 열면 구분 불가
- `_closeStrategyPositions()`의 정확성은 리스크 관리의 핵심

**구현 방안**:

1. `PositionManager`에 내부 매핑 테이블 추가:
   ```js
   /** @type {Map<string, string>} `${symbol}:${posSide}` → strategyName */
   this._strategyMapping = new Map();
   ```

2. `orderManager.submitOrder()` → 주문 제출 시 매핑 등록:
   ```js
   // 체결 이벤트에서 매핑 업데이트
   positionManager.registerStrategyMapping(symbol, posSide, strategy);
   ```

3. `_parsePositionEntry()` 결과에 매핑 정보 병합:
   ```js
   const key = `${symbol}:${posSide}`;
   const strategy = this._strategyMapping.get(key) || 'unknown';
   return { ...entry, strategy };
   ```

**주의**: 동일 심볼+posSide에 여러 전략이 있을 수 있으므로, **1:N 매핑** 필요. 이는 Phase 2에서 해결하고, Phase 1에서는 마지막으로 주문한 전략으로 매핑 (last-write-wins).

---

### R8-T1-1: InstrumentCache 심볼별 lot step

**현재 코드 분석**:

1. **`botService.js:1219`** — lot step이 하드코딩:
   ```js
   // Floor to lot step (default 0.0001; Phase 2 will use per-symbol lot info)
   qty = math.floorToStep(qty, '0.0001');
   ```

2. **실제 Bitget 심볼별 lot step**:
   - BTCUSDT: 0.001 (= $100 단위)
   - ETHUSDT: 0.01 (= $30 단위)
   - DOGEUSDT: 1 (정수 단위)
   - 소형 코인: 0.1 ~ 10

3. **문제**: `0.0001` 기본값은 대부분의 심볼에서 너무 세밀함. 거래소가 거부하지는 않지만(자체적으로 반올림), **정확한 수량 계산을 위해 심볼별 lot step이 필요**.

**재활성화 판단: YES — R8-T2-1(멀티심볼)과 함께 구현**

**근거**:
- 멀티심볼 도입 시 다양한 코인이 거래 대상이 됨 → lot step 차이가 실질적 영향
- 하드코딩 `0.0001`은 소형 코인에서 주문 실패 유발 가능 (최소 주문 수량 미달)
- 구현 비용 대비 효과가 높음

**구현 방안**:

**신규 파일: `backend/src/services/instrumentCache.js`**

```js
class InstrumentCache {
  constructor({ exchangeClient }) {
    this._exchange = exchangeClient;
    this._instruments = new Map(); // symbol → { lotStep, minQty, maxQty, tickSize }
    this._lastRefresh = 0;
    this._refreshInterval = 24 * 60 * 60 * 1000; // 24시간
  }

  async refresh(category) {
    const response = await this._exchange.getInstruments({ category });
    const instruments = Array.isArray(response?.data) ? response.data : [];

    for (const inst of instruments) {
      const symbol = inst.symbol || inst.instId;
      this._instruments.set(symbol, {
        lotStep: String(inst.sizeMultiplier || inst.lotSz || inst.minTradeNum || '0.0001'),
        minQty: String(inst.minTradeNum || inst.minSz || '0'),
        maxQty: String(inst.maxTradeNum || inst.maxSz || '999999'),
        tickSize: String(inst.pricePlace ? Math.pow(10, -inst.pricePlace) : '0.01'),
        priceEndStep: String(inst.priceEndStep || '1'),
      });
    }

    this._lastRefresh = Date.now();
  }

  getLotStep(symbol) {
    const inst = this._instruments.get(symbol);
    return inst ? inst.lotStep : '0.0001'; // 안전한 기본값
  }

  getMinQty(symbol) {
    const inst = this._instruments.get(symbol);
    return inst ? inst.minQty : '0';
  }
}
```

**파일: `backend/src/services/botService.js`**

1. `_resolveSignalQuantity()` 수정:
   ```js
   // 현재: qty = math.floorToStep(qty, '0.0001');
   // 변경:
   const lotStep = this.instrumentCache
     ? this.instrumentCache.getLotStep(signal.symbol)
     : '0.0001';
   qty = math.floorToStep(qty, lotStep);

   // 최소 수량 검증
   if (this.instrumentCache) {
     const minQty = this.instrumentCache.getMinQty(signal.symbol);
     if (math.isLessThan(qty, minQty)) {
       log.warn('Qty below minimum', { symbol: signal.symbol, qty, minQty });
       return null;
     }
   }
   ```

2. `start()` 내에서 InstrumentCache 초기화:
   ```js
   // 6 이전: Instrument 정보 로드
   if (this.instrumentCache) {
     await this.instrumentCache.refresh(category);
   }
   ```

**파일: `backend/src/app.js`**

1. InstrumentCache 생성 및 주입:
   ```js
   const instrumentCache = new InstrumentCache({ exchangeClient });
   // ... BotService에 주입 ...
   ```

**트레이딩 관점 영향**:
- **주문 성공률 향상**: 잘못된 lot step으로 인한 주문 거부 방지
- **정확한 포지션 사이징**: 실제 거래 가능 단위에 맞춘 수량 계산
- **멀티심볼 필수 전제**: 다양한 코인 거래 시 lot step 차이가 치명적

---

## Frontend 항목 코멘트

프론트엔드 5건(R8-T2-8 ~ R8-T2-12)은 UI/UX 영역이므로 트레이딩 관점에서만 간략히 코멘트한다.

### R8-T2-8: StrategyCard toggle 접근성 수정
- **트레이딩 영향**: 전략 enable/disable 토글의 접근성 문제는 라이브 운영 시 긴급 전략 비활성화가 필요한 상황에서 치명적일 수 있음. **우선순위 높음**.

### R8-T2-9: MarketRegimeIndicator 중복 코드 정리 (삭제)
- **트레이딩 영향**: 없음. 순수 코드 정리. 구현 비용 최소(15분).

### R8-T2-10: 대시보드 헤더 모바일 반응형
- **트레이딩 영향**: 모바일에서 봇 상태 확인 및 긴급 조치 가능성. 24/7 시장에서 데스크톱 앞에 있지 않을 때 중요.

### R8-T2-11: AccountOverview 모바일 레이아웃
- **트레이딩 영향**: R8-T2-10과 동일 맥락. 포지션/PnL 모니터링의 모바일 접근성.

### R8-T2-12: RegimeFlowMap 모바일 대응
- **트레이딩 영향**: 레짐 흐름 시각화는 의사결정 보조 도구. 모바일 대응은 운영 편의.

**FE 추가 요청**: R8-T2-1(멀티심볼) 구현 시, 대시보드 전략 카드에 **배정된 심볼** 표시 필요. 현재 `getStatus()`에서 `strategy.symbol` 반환하므로 FE에서 렌더링만 추가하면 됨.

---

## 의존성 및 구현 순서 제안

```
Phase 1 (선행 작업 — 인프라):
  R8-T2-2 (warm-up 메타데이터)           [2h]
  R8-T1-1 (InstrumentCache lot step)     [2h]
    ↓
Phase 2 (핵심 — 멀티심볼 + 전략 매핑):
  R8-T0-5 (PositionManager 전략 매핑)    [3.5h]
  R8-T2-1 (멀티심볼 라우팅 Phase 1)      [8h]
    ↓ (R8-T0-5 완료 필수)
Phase 3 (보강):
  R8-T2-3 (펀딩비 PnL)                   [4.5h]
  R8-T2-4 (코인 재선정 주기)              [3.5h]
    ↓
Phase 4 (경량):
  R8-T2-5 (Paper 전환 경고)              [30m]
  R8-T2-6 (StateRecovery 활성화)         [45m]
```

**총 예상 시간**: ~24.75h (BE 8건)

**의존성 그래프**:
```
R8-T2-2 ──────────────────────────> (warm-up 정보를 StrategyRouter가 활용)
R8-T1-1 ───> R8-T2-1 (lot step은 멀티심볼 전제)
R8-T0-5 ───> R8-T2-1 (전략 매핑은 멀티심볼 전제)
R8-T2-1 ───> R8-T2-4 (코인 재선정 시 멀티심볼 재배정)
R8-T2-3 ──────────────────────────> (독립적, 언제든 구현 가능)
R8-T2-5 ──────────────────────────> (독립적)
R8-T2-6 ──────────────────────────> (독립적)
```

**크리티컬 패스**: R8-T1-1 + R8-T0-5 → R8-T2-1 → R8-T2-4

---

## 다른 에이전트에게 요청 사항

### Architect Agent에게:
1. **InstrumentCache 서비스 설계 리뷰**: 새 서비스 파일 생성이 필요하므로 DI 주입 순서 및 app.js bootstrap 위치 확인 요청.
2. **멀티심볼 라우팅의 심볼 배정 알고리즘**: 라운드 로빈 vs 스코어 매칭 vs 해시 기반 — 아키텍처 관점에서 확장성 평가 요청.
3. **코인 재선정 시 열린 포지션 심볼 보호 로직**: 재선정으로 심볼이 제거될 때 포지션이 열려 있으면 어떻게 처리할지 설계 결정 필요.

### Frontend Agent에게:
1. **R8-T2-1 구현 시 전략 카드에 배정 심볼 표시**: `getStatus()` 응답의 `strategy.symbol` 필드를 StrategyCard에 렌더링.
2. **warm-up 상태 표시**: 전략 카드에 "warm-up 중 (15/51 캔들)" 같은 진행 상태 표시 요청.
3. **코인 재선정 이벤트 Socket.io 수신**: `coins_reselected` 이벤트를 대시보드에 토스트 알림으로 표시.
4. **펀딩비 PnL 표시**: 포지션 카드에 `accumulatedFunding` 필드 렌더링 (구현 후).

### QA/Test Agent에게 (있다면):
1. **멀티심볼 통합 테스트**: 3개 전략 × 3개 심볼 시나리오에서 시그널 라우팅 정확성 검증.
2. **펀딩비 백테스트 검증**: 기존 백테스트 결과와 펀딩비 적용 후 결과 비교.
3. **코인 재선정 Edge Case**: 재선정 중 시그널 발생, 재선정 중 봇 정지 등 경쟁 조건 검증.
