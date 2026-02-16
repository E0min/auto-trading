# Round 9 Proposal — Systems Engineer

> **Agent**: Senior Systems Engineer (시스템 무결성)
> **Round**: 9 — Tier 2 Quality (11건 + deferred 2건 재활성화 검토)
> **Date**: 2026-02-17
> **Base commit**: 81bdca6

---

## 분석 요약

Round 9는 R8에서 합의되었으나 미구현된 Tier 2 항목 11건과 deferred 2건의 재활성화를 다룬다. 시스템 무결성 관점에서 가장 위험도가 높은 항목은 **R8-T2-1 (멀티심볼 라우팅)** 과 **R8-T2-3 (펀딩비 PnL 반영)** 이다. 두 항목 모두 동시성, 데이터 무결성, 리소스 관리에 대한 신중한 설계가 필요하다.

전체 코드베이스 분석 결과:
- `StrategyRouter._routeStrategies()` (L161)에서 이미 `symbols[0]`만 배정하는 Phase 1 패턴이 존재하므로 T2-1은 이 패턴을 확장하는 형태
- `StrategyBase`에 `_symbols` Set과 `addSymbol()/removeSymbol()` 인프라가 이미 마련됨 (T0-3)
- `stateRecovery.js`와 `orphanOrderCleanup.js`는 app.js에서 인스턴스화되지만 **어디서도 start/recover가 호출되지 않음** (사실상 비활성)
- `floorToStep()`에 하드코딩된 `'0.0001'` lot step이 `botService.js:1220`에 존재 (T1-1 연계점)

---

## Backend 항목 분석

### R8-T2-1: 멀티심볼 라우팅 Phase 1 — 전략마다 다른 단일 심볼 배정

**현재 코드 상태 분석:**

`strategyRouter.js:161-163`:
```javascript
// T0-3 Phase 1: 1 symbol per strategy to prevent internal state contamination
const symbol = this._symbols[0];
if (symbol) {
  strategy.activate(symbol, this._category);
}
```

현재 모든 전략이 `symbols[0]` (첫 번째 선택 코인)에만 배정된다. 이는 코인 선정을 통해 10개를 골라도 실제로는 1개만 사용하는 비효율.

**시스템 안전성 구현 방안:**

1. **심볼 배정 전략**: 라운드 로빈 또는 점수 기반 매칭. 전략 메타데이터에 `preferredVolatility` 등 추가하여 코인 스코어와 매칭 가능.

2. **핵심 불변량 (Invariant)**: **하나의 전략 인스턴스 = 하나의 심볼**. 내부 상태 오염 방지.
   - `StrategyBase._symbol`은 단일 값이어야 하며, `onTick()`/`onKline()`에서 심볼 불일치 시 반드시 skip
   - 이미 `botService.js:307`에서 `strategy._symbol === ticker.symbol` 가드 존재

3. **동시성 위험 — 코인 재선정과 심볼 교체 경합**:
   - R8-T2-4 (코인 재선정)와 결합 시, 재선정 중 전략이 이전 심볼의 시그널을 발행할 수 있음
   - 해결: `StrategyRouter.updateSymbols()` 호출 시 **deactivate-first** 패턴 유지 (이미 L403-409에서 구현됨)
   - 재선정 중 `_running` 플래그와 함께 `_symbolAssignmentLock` boolean guard 추가 권장

4. **에러 핸들링**:
   - 심볼이 전략 수보다 적은 경우 (예: 코인 5개, 전략 18개) → 다수 전략이 동일 심볼 공유 허용, 로그로 경고
   - 빈 심볼 리스트 방어: `if (this._symbols.length === 0)` early return

5. **리소스 관리**:
   - `_symbols` → `_strategySymbolMap` (Map<string, string>) 추가하되, 기존 `_symbols` 배열도 유지 (MarketData 구독에 필요)
   - Map 크기는 전략 수(최대 18)에 바인딩 — 제한적

6. **Graceful shutdown 영향**: 없음. `stop()`에서 이미 모든 전략 deactivate 처리.

7. **테스트 방안**:
   - 단위 테스트: 심볼 5개 + 전략 10개 → 배정 결과 검증
   - 에지 케이스: 심볼 0개, 심볼 1개 (현재 동작과 동일해야 함)
   - 코인 재선정 후 심볼 변경 시 기존 포지션 영향 없음 확인

**예상 구현 범위:**
- `strategyRouter.js`: `_assignSymbols()` 메서드 추가 (라운드 로빈 기본, 점수 매칭 확장 가능)
- `strategyRouter.js`: `_routeStrategies()`에서 `_assignSymbols()` 호출
- `strategyRouter.js`: `updateSymbols()`에서 재배정 로직

---

### R8-T2-2: 전략 warm-up 기간 (warmupCandles 메타데이터)

**현재 코드 상태 분석:**

`strategyBase.js`에 warm-up 관련 인프라가 전혀 없음. 전략이 활성화되면 즉시 `onTick()`/`onKline()` 수신 시작하고, 충분한 데이터 없이 시그널을 발행할 수 있다.

`signalFilter.js`는 cooldown, duplicate, max concurrent, confidence 필터만 존재. warm-up 필터 없음.

**시스템 안전성 구현 방안:**

1. **warm-up 상태 추적**: `StrategyBase`에 다음 추가:
   ```javascript
   this._warmupCandles = this.constructor.metadata?.warmupCandles || 0;
   this._receivedCandles = 0;
   this._warmedUp = false;
   ```

2. **시그널 게이트**: `emitSignal()` 내에서 warm-up 미완료 시 시그널 자동 차단:
   ```javascript
   if (!this._warmedUp && this._warmupCandles > 0) {
     this._log.debug('Signal suppressed — warming up', { received: this._receivedCandles, required: this._warmupCandles });
     return;
   }
   ```
   이 위치가 가장 안전 — 전략 내부에서 잘못된 데이터로 시그널 생성해도 외부로 나가지 않음.

3. **캔들 카운트**: `onKline()` 호출마다 `_receivedCandles++` (StrategyBase에서 처리), warm-up 도달 시 `_warmedUp = true` + 로그

4. **중요 고려사항 — deactivate/reactivate 사이클**:
   - 레짐 변경 → 전략 deactivate → 다시 activate 시, warm-up 리셋 필요 여부
   - **제안: `activate()` 시 warm-up 리셋 O** — 안전 우선. 새 심볼로 변경될 수 있으므로.
   - Grace period 중에는 이미 캔들을 받고 있으므로 warm-up 유지.

5. **에러 핸들링**: `_warmupCandles`가 음수이거나 비정상 값인 경우 → 0으로 clamp + 경고 로그

6. **StrategyBase 변경 최소화**: `onKline()` abstract이므로 직접 수정 불가 → **`_trackKlineForWarmup(kline)`** 헬퍼를 도입하고, BotService의 kline 와이어링에서 `strategy.onKline()` 전에 호출하거나, StrategyBase에 wrapping 메서드 도입

7. **SignalFilter 연계**: SignalFilter에 warm-up 필터를 추가하는 것은 **불필요** — StrategyBase 레벨에서 차단하는 것이 더 적절 (필터는 전략 외부 지식이므로 warm-up 캔들 수를 알 수 없음)

8. **테스트 방안**:
   - 전략에 `warmupCandles: 20` 설정 → 19개 kline 피드 후 시그널 없음, 20번째 후 시그널 가능 확인
   - deactivate → activate 후 카운트 리셋 확인

---

### R8-T2-3: 펀딩비 PnL 반영 (WS account + 백테스트)

**현재 코드 상태 분석:**

`positionManager.js:319-349` — `_handleWsAccountUpdate()`에서 `equity`, `availableBalance`, `unrealizedPnl`만 추적. 펀딩비 PnL은 별도 추적 없음.

`exchangeClient.js:818-823` — private WS에서 `account` 토픽을 `ws:account`로 emit. Bitget의 account WS 이벤트에는 펀딩비 관련 필드가 포함될 수 있으나, 현재 파싱하지 않음.

`backtestEngine.js` — 펀딩비 시뮬레이션 전무. grep 결과 `funding` 언급 0건.

`fundingDataService.js` — REST 폴링으로 `fundingRate`, `openInterest` 수집 중이나, **PnL 계산에는 사용 안 됨**.

**시스템 안전성 구현 방안:**

1. **라이브 트레이딩 — WS account 이벤트 펀딩비 필드 파싱**:
   - Bitget WS account update에 `funding` 또는 `fundingFee` 필드 존재 가능 (SDK 문서 확인 필요)
   - `_handleWsAccountUpdate()`에 `fundingPnl` 추적 추가
   - **주의**: equity에 이미 포함된 값이므로 **이중 계산 금지**. 펀딩비는 관측/기록 목적으로만 별도 추적하고, PnL 계산에 equity를 사용하면 자동 반영됨.

2. **데이터 무결성 핵심 원칙**:
   - **Bitget equity 값이 이미 펀딩비를 반영** → `positionManager._accountState.equity`는 정확
   - 별도 `cumulativeFundingPnl` 필드를 추가하여 **추적 (관측성)** 목적으로 누적
   - Trade 모델 또는 Snapshot 모델에 `fundingPnl` 필드 추가

3. **백테스트 펀딩비 시뮬레이션**:
   - `BacktestEngine`에 `fundingRate` 시뮬레이션 추가:
     - 8시간 주기 (00:00, 08:00, 16:00 UTC)에 열린 포지션에 대해 `fundingPnl = positionSize * fundingRate` 적용
     - 데이터 소스: kline 데이터와 함께 funding rate 히스토리 필요
   - **위험**: 히스토리 funding rate 데이터가 없으면 시뮬레이션 부정확
   - **대안**: 상수 펀딩비율 (configurable, default 0.01%) 사용하여 근사치

4. **리소스 관리**:
   - 펀딩비 히스토리 캐시는 `FundingDataService._cache` Map에 이미 TTL 기반 관리 중
   - 백테스트에서는 `BacktestEngine` 로컬 변수로만 추적 — 추가 메모리 부담 없음

5. **String 타입 준수**: 펀딩비 PnL은 반드시 `math.multiply()`, `math.add()`로 계산

6. **에러 핸들링**:
   - WS에서 펀딩비 필드 누락 시 → `'0'`으로 기본값, 로그 warn 없음 (정상 상황일 수 있음)
   - 백테스트에서 funding rate 데이터 없는 기간 → 0으로 처리, 로그 info

7. **테스트 방안**:
   - WS: mock 이벤트에 funding 필드 포함 → `_accountState` 업데이트 확인
   - 백테스트: 8시간 kline 100개 + position open → fundingPnl 누적 검증

---

### R8-T2-4: 코인 재선정 주기 (4~8시간 고정 간격)

**현재 코드 상태 분석:**

`coinSelector.js` — `selectCoins()`는 순수 함수 스타일로, 호출 시 ticker 수집 → pre-filter → enrichment → scoring → 반환. **주기적 호출 메커니즘 없음**.

`botService.js:208-211` — start() 시 한 번만 호출:
```javascript
const selectedCoins = await this.coinSelector.selectCoins(category);
this._selectedSymbols = selectedCoins.map((c) => c.symbol);
```

재선정 후 `marketData.subscribeSymbols()`, `strategyRouter.updateSymbols()` 등의 후처리 체인이 필요하나 현재는 start() 시에만 수행.

**시스템 안전성 구현 방안:**

1. **주기적 재선정 타이머**: `BotService`에 `_coinReselectInterval` 추가
   ```javascript
   this._coinReselectInterval = setInterval(() => {
     this._reselectCoins().catch(err => log.error('Coin reselection failed', { error: err.message }));
   }, reselectIntervalMs);
   if (this._coinReselectInterval.unref) this._coinReselectInterval.unref();
   ```

2. **동시성 위험 — 재선정 중 시그널 발행**:
   - 가장 위험한 레이스 컨디션: 재선정이 심볼 목록을 변경하는 동안 전략이 이전 심볼로 시그널 발행 → 구독 해제된 심볼에 주문 시도
   - **해결**: `_reselectCoins()` 시작 시 `this._reselectingCoins = true` 플래그 설정, `_handleStrategySignal()`에서 이 플래그 체크하여 시그널 대기열에 보관하거나 drop
   - 더 안전한 접근: 재선정을 **단계적**으로 수행
     1. 새 심볼 목록 계산
     2. 새 심볼 구독 (기존 유지)
     3. StrategyRouter.updateSymbols() — 내부적으로 deactivate → activate 수행
     4. 사용하지 않는 이전 심볼 구독 해제

3. **BTCUSDT 항상 유지**: 현재 `start()`에서 `if (!includes('BTCUSDT')) unshift` 로직 → `_reselectCoins()`에서도 동일하게 적용

4. **구독 관리 — 메모리/연결 누수 방지**:
   - `marketData._subscribedSymbols` Set이 무한 증가하지 않도록, 재선정 시 **차집합** 계산하여 불필요 심볼 unsubscribe
   - `marketData.unsubscribeSymbols(removedSymbols)` 호출 필수

5. **FundingDataService 연동**: `fundingDataService.updateSymbols(newSymbols)` 호출 필수 (이미 메서드 존재: `fundingDataService.js:79`)

6. **SymbolRegimeManager 연동**: `symbolRegimeManager.start(newNonBtcSymbols)` — stop() 후 재시작 또는 updateSymbols() 메서드 추가 필요

7. **설정 가능성**: `config.coinReselectIntervalMs` (기본 4시간 = 14400000ms)로 외부 설정 가능하게

8. **Graceful shutdown**: `_coinReselectInterval`를 `stop()`에서 clearInterval 처리

9. **테스트 방안**:
   - mock coinSelector.selectCoins() → 다른 심볼 리스트 반환
   - 재선정 전후 subscribed symbols 일치 확인
   - 재선정 중 시그널 발행 → 안전하게 차단/처리 확인

---

### R8-T2-5: Paper 모드 trading-mode 전환 경고 강화

**현재 코드 상태 분석:**

`botService.js:795-813` — `setTradingMode()`:
```javascript
setTradingMode(mode) {
  if (this._running) {
    throw new Error('봇이 실행 중입니다. 먼저 정지해주세요.');
  }
  // ... mode switch logic
}
```

`botRoutes.js:122-135` — POST `/trading-mode`:
```javascript
router.post('/trading-mode', (req, res) => {
  try {
    const { mode } = req.body || {};
    if (!mode || !['live', 'paper'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'mode must be "live" or "paper"' });
    }
    botService.setTradingMode(mode);
    res.json({ success: true, data: { mode } });
  } catch (err) {
    // ...
  }
});
```

**시스템 안전성 구현 방안:**

1. **현재 안전장치**: `_running` 체크로 실행 중 전환 차단 — 이미 안전함.

2. **추가 경고 강화 (Low risk, high value)**:
   - **응답에 경고 메시지 포함**: paper→live 전환 시 `{ success: true, data: { mode, warning: 'Live trading mode activated. Real funds at risk.' } }`
   - **열린 포지션 확인**: 전환 시점에 paper 포지션이 남아있으면 경고 (paper 포지션은 live에서 무의미)
   - **설정 불일치 감지**: `PAPER_TRADING=true` 환경변수와 `botService.paperMode` 불일치 감지 및 로그

3. **이벤트 발행**: 모드 전환 시 `this.emit('trading_mode_changed', { from, to })` → Socket.io 전달 → 프론트엔드 알림

4. **추가 검증 — live→paper는 안전, paper→live가 위험**:
   ```javascript
   if (mode === 'live') {
     // Verify exchange connectivity before switching
     // Check API key validity
     // Log with TRADE level (not INFO)
   }
   ```

5. **에러 핸들링**: 이미 충분. 추가 필요 없음.

6. **테스트 방안**:
   - 실행 중 전환 시도 → Error throw 확인
   - paper→live 전환 → 경고 메시지 포함 확인

**구현 예상 시간: 30분 (원안 동의)**

---

### R8-T2-6: StateRecovery + OrphanOrderCleanup 활성화

**현재 코드 상태 분석:**

`app.js:157-164` — 인스턴스 생성만 되고 **활성화되지 않음**:
```javascript
const stateRecovery = new StateRecovery({ exchangeClient, orderManager });
const orphanOrderCleanup = new OrphanOrderCleanup({ exchangeClient });
```

`stateRecovery.js` — `recover()` 메서드: DB Trade 문서 vs 거래소 오픈 주문 비교 + 포지션 로깅. **MongoDB 의존** (Trade 모델 쿼리).

`orphanOrderCleanup.js` — `start()/stop()/cleanup()`: 5분 간격으로 거래소 오픈 주문 vs DB 매칭, 불일치 시 취소. **MongoDB 의존** (Trade 모델 쿼리).

**시스템 안전성 구현 방안:**

1. **Paper 모드에서의 동작 정의**:
   - Paper 모드에서는 실제 거래소 주문이 없으므로 StateRecovery/OrphanCleanup은 **무의미**
   - **활성화 조건**: `!PAPER_TRADING` (live 모드일 때만)
   - Paper 모드 검증: paper에서 orphanOrderCleanup.start() 호출하면 불필요한 REST 호출 발생 → API rate limit 소모

2. **활성화 시점 — bot start vs server start**:
   - **권장: bot start 시 StateRecovery.recover() 1회 호출, orphanOrderCleanup은 bot 실행 중 주기적**
   - `BotService.start()` 내 step 2.5 위치 (WS 연결 후, 전략 생성 전):
     ```javascript
     // 2.5 State recovery (live mode only)
     if (!this.paperMode && this.stateRecovery) {
       try {
         const report = await this.stateRecovery.recover(category);
         log.info('State recovery completed', report);
       } catch (err) {
         log.error('State recovery failed — continuing', { error: err.message });
         // NOT fatal — continue startup
       }
     }
     ```

3. **DI 변경**: `BotService` 생성자에 `stateRecovery`, `orphanOrderCleanup` 주입 추가

4. **OrphanOrderCleanup 생명주기**:
   - `start()`는 `BotService.start()` 끝에서 호출
   - `stop()`은 `BotService.stop()` 초반에 호출
   - `_eventCleanups`에 `() => this.orphanOrderCleanup.stop()` 추가

5. **위험 — 거짓 양성 (False positive)**:
   - OrphanOrderCleanup이 봇이 방금 넣은 주문을 DB 동기화 전에 orphan으로 감지할 수 있음
   - **해결**: cleanup에서 `order.cTime` (생성 시간) 확인 → 최근 2분 이내 주문은 skip
   - `orphanOrderCleanup.js:145-195`에 age 필터 추가 필요

6. **Graceful shutdown**: `stop()` 내에서 `orphanOrderCleanup.stop()` 처리

7. **테스트 방안**:
   - Mock: DB에 active trade 3개, exchange에 open order 1개 → 2개 reconcile 확인
   - Paper 모드에서 호출 시 → no-op 확인

**구현 예상 시간: 45분 (원안 동의, 단 false positive 방어 추가 시 +15분)**

---

## Deferred 항목 재활성화 판단

### R8-T0-5: PositionManager 전략 메타데이터 주입 (3.5h)

**현재 코드 상태:**

`positionManager.js:431-442` — `_parsePositionEntry()`:
```javascript
return {
  symbol,
  posSide,
  qty: String(raw.total || raw.holdAmount || ...),
  entryPrice: String(raw.openPriceAvg || ...),
  // ...
  // strategy 필드 없음
};
```

PositionManager가 반환하는 포지션에 `strategy` 필드가 없다. `botService.js:1048`에서 `p.strategy === strategyName`으로 필터링하는데, 이는 **paperPositionManager에서만 동작**하고, 실제 live PositionManager에서는 전략 정보가 없다.

**재활성화 판단: 조건부 재활성화 (R8-T2-1과 함께)**

- **이유**: 멀티심볼 라우팅(T2-1)에서 전략별 다른 심볼을 배정하면, 포지션-전략 매핑이 필수가 됨
  - 현재: 모든 전략이 같은 심볼 → 심볼로 구분 불가 → 전략 매핑 필요
  - T2-1 후: 전략별 심볼이 다름 → 심볼로 역매핑 가능 (단, 같은 심볼에 여러 전략이 배정될 수 있음)
- **구현 방안**:
  1. `OrderManager.submitOrder()`에서 `clientOid`에 전략명 인코딩 (예: `bot_{strategy}_{timestamp}`)
  2. PositionManager는 fill 이벤트에서 `clientOid`를 파싱하여 전략명 추출, 포지션 메타데이터에 저장
  3. 또는 별도 `Map<positionKey, strategyName>` 유지 (BotService 레벨)
- **위험**: clientOid 인코딩에 의존하면 외부 주문과 혼동 가능 → StateRecovery가 처리해야 함
- **권장**: T2-1과 **함께** 구현하되, 초기에는 BotService 레벨의 `Map<string, string>` (`symbolPosSide → strategyName`)으로 시작. live PositionManager 변경은 Phase 2로.

### R8-T1-1: InstrumentCache 심볼별 lot step (2h)

**현재 코드 상태:**

`botService.js:1219-1220`:
```javascript
// Floor to lot step (default 0.0001; Phase 2 will use per-symbol lot info)
qty = math.floorToStep(qty, '0.0001');
```

`exchangeClient.js:443-457` — `getInstruments()` 메서드 이미 존재:
```javascript
async getInstruments({ category }) {
  // ... restClient.getFuturesContractConfig(params)
}
```

Instrument 데이터를 가져오는 REST 메서드는 있으나, 캐싱하는 InstrumentCache 서비스가 없음.

**재활성화 판단: 재활성화 권장**

- **이유**: 하드코딩된 `0.0001` lot step은 **모든 심볼에 부정확**
  - BTC는 0.001, ETH는 0.01, 소형 알트코인은 1 이상일 수 있음
  - 잘못된 lot step → 거래소 주문 거부 (`order size precision error`)
  - T2-1 (멀티심볼)로 다양한 심볼이 들어오면 이 문제가 즉시 표면화
- **시스템 안정성 관점에서 T2-1의 전제 조건**
- **구현 방안**:
  1. `InstrumentCache` 서비스 생성: 부트 시 `getInstruments()` 호출 → `Map<symbol, { lotStep, minSize, maxSize, pricePrecision }>` 캐싱
  2. 주기적 갱신 (24시간 간격 — instrument 스펙은 거의 변하지 않음)
  3. `BotService._resolveSignalQuantity()`에서 `instrumentCache.getLotStep(symbol)` 사용
  4. 캐시 미스 시 기본값 `'0.0001'` 폴백 + warn 로그
- **리소스 관리**: Map 크기 = 심볼 수 (최대 ~200개), 24시간마다 1회 REST 호출
- **Graceful shutdown**: timer unref + stop() 메서드

---

## Frontend 항목 코멘트

### R8-T2-8: StrategyCard toggle 접근성 수정
- **시스템/보안 관점**: 무영향. 순수 UI 접근성. toggle 클릭 시 API 호출 (enable/disable)이 이미 rate-limited — 추가 보안 이슈 없음.

### R8-T2-9: MarketRegimeIndicator 중복 코드 정리 (삭제)
- **시스템/보안 관점**: 코드 삭제이므로 위험 없음. 단, 삭제 대상 컴포넌트를 import하는 파일이 없는지 확인 필요 (빌드 깨짐 방지).

### R8-T2-10: 대시보드 헤더 모바일 반응형
- **시스템/보안 관점**: 무영향. CSS/레이아웃 변경.

### R8-T2-11: AccountOverview 모바일 레이아웃
- **시스템/보안 관점**: 무영향. 단, 금액 표시 시 precision 일관성 확인 (잘리거나 반올림되어 사용자 혼동 방지).

### R8-T2-12: RegimeFlowMap 모바일 대응
- **시스템/보안 관점**: 무영향. 차트 리사이즈 로직에서 불필요한 리렌더 방지만 주의 (성능).

---

## 의존성 및 구현 순서 제안

```
Phase 1 (기반, 선행 필수):
  R8-T1-1: InstrumentCache ──┐
                              ├──→ Phase 2
  R8-T2-2: warm-up ──────────┘

Phase 2 (핵심):
  R8-T2-1: 멀티심볼 라우팅 ──── (depends on: T1-1 lot step)
  R8-T0-5: 전략-포지션 매핑 ──── (co-implement with T2-1)

Phase 3 (연결):
  R8-T2-4: 코인 재선정 주기 ──── (depends on: T2-1 updateSymbols)
  R8-T2-3: 펀딩비 PnL ────────── (independent, but benefits from T2-4 symbol lifecycle)

Phase 4 (마무리):
  R8-T2-5: Paper 모드 경고 ────── (independent, low risk)
  R8-T2-6: StateRecovery 활성화 ── (independent, live mode only)

Phase FE (병렬):
  R8-T2-8, T2-9, T2-10, T2-11, T2-12 ── (프론트엔드, 백엔드 무관)
```

**구현 순서 근거:**
1. `InstrumentCache`(T1-1)가 없으면 멀티심볼(T2-1)에서 lot step 오류 발생 → T1-1 선행
2. `warm-up`(T2-2)은 독립적이나, 전략 기반 클래스 변경이므로 다른 전략 관련 작업 전에 완료하면 충돌 최소화
3. 멀티심볼(T2-1)과 전략-포지션 매핑(T0-5)은 같은 코드 영역 → 동시 구현
4. 코인 재선정(T2-4)은 T2-1의 `updateSymbols()` 인프라 사용 → T2-1 이후
5. 펀딩비(T2-3), Paper 경고(T2-5), StateRecovery(T2-6)는 독립적

**총 예상 시간:** BE 25h + FE 2h20m = ~27h

---

## 다른 에이전트에게 요청 사항

### Strategy Architect에게
1. **R8-T2-1 심볼 배정 알고리즘**: 전략 메타데이터에 `preferredVolatility: 'high' | 'medium' | 'low'`와 같은 필드를 추가하여 코인 스코어와 매칭하는 것이 유의미한지 판단 요청. 아니면 단순 라운드 로빈이면 충분한지.
2. **R8-T2-2 warmupCandles 값 제안**: 각 전략별 적정 warmupCandles 값 (RSI: 14+α, Bollinger: 20+α, MACD: 26+α 등). 전략 메타데이터에 이미 정의해야 할 값.
3. **R8-T2-3 백테스트 펀딩비**: 상수 funding rate 근사치(0.01%) vs 히스토리 데이터 페칭 중 어느 것이 백테스트 정확도에 더 유의미한지.

### Trading Logic Architect에게
1. **R8-T2-4 재선정 간격**: 4시간 vs 8시간. 짧으면 더 적응적이나 subscription churn 발생. 레짐 변경 시 즉시 재선정 트리거할지.
2. **R8-T2-3 펀딩비 PnL**: Trade 모델에 `fundingPnl` 필드를 추가할지, Snapshot에만 기록할지. 데이터 모델 관점 결정 필요.
3. **R8-T0-5 clientOid 인코딩 스키마**: `bot_{strategyName}_{timestamp}_{random}` 형태? 최대 길이 제한 확인 (Bitget clientOid 최대 길이).

### Frontend Engineer에게
1. **R8-T2-1 관련**: 전략 상태에 `assignedSymbol` 필드가 추가됨 → `getStatus()` 응답 형태 변경 → 대시보드 StrategyCard에서 표시 필요.
2. **R8-T2-4 관련**: 코인 재선정 이벤트(`coin_reselected`) 발행 예정 → 대시보드에 재선정 알림/로그 표시 필요 여부.
3. **R8-T2-5 관련**: trading-mode 전환 API 응답에 `warning` 필드 추가 → 프론트엔드에서 confirm 모달 또는 toast로 표시 필요.
