# 매매 파이프라인 — 8단계 실행 흐름

봇이 시작되면 시장 데이터 수신부터 손익 확정까지 8단계를 거칩니다.

## 전체 흐름

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 시장   │ →  │ 2. 전략   │ →  │ 3. 시그널 │ →  │ 4. 리스크 │
│ 데이터    │    │ 분석      │    │ 필터      │    │ 검증      │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────▼────┐
│ 8. 손익   │ ←  │ 7. 포지션 │ ←  │ 6. 거래소 │ ←  │ 5. 주문   │
│ 확정      │    │ 동기화    │    │ 전송      │    │ 생성      │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## 1단계: 시장 데이터 수신

**담당**: `marketData.js` + `exchangeClient.js`

Bitget WebSocket에서 실시간 틱/캔들 데이터를 수신합니다.

```
Bitget WS → exchangeClient → marketData → 정규화 → 캐싱 + 이벤트 방출
```

**정규화된 틱 데이터**:
```javascript
{
  symbol: 'BTCUSDT',
  lastPrice: '65432.50',
  bid: '65432.00',
  ask: '65433.00',
  high24h: '66000.00',
  low24h: '64000.00',
  vol24h: '12345.678',
  change24h: '2.34',
  ts: 1700000000000
}
```

**정규화된 캔들 데이터**:
```javascript
{
  symbol: 'BTCUSDT',
  interval: '1m',
  open: '65400.00',
  high: '65450.00',
  low: '65380.00',
  close: '65432.50',
  volume: '123.456',
  ts: 1700000000000
}
```

**부가 처리**:
- `tickerAggregator`: 전체 시장 통계 (상승/하락 비율, 변동성 지수)
- `coinSelector`: 7팩터 가중 스코어링으로 매매 대상 코인 선정
- `marketRegime`: 6팩터 분류로 시장 상태 판정 (상승장/하강장/횡보장/고변동성/저변동성)

---

## 2단계: 전략 분석 및 시그널 생성

**담당**: 18개 전략 클래스 (StrategyBase 상속)

각 전략이 `onTick()` / `onKline()` 콜백으로 시장 데이터를 수신하고, 조건 충족 시 시그널을 생성합니다.

```
marketData 이벤트 → 전략.onKline(kline) → 지표 계산 → 조건 평가 → emitSignal()
                 → 전략.onTick(ticker) → trailing stop 자동 체크 (R11) + 가격 업데이트
```

**onTick() 자동 trailing stop (Sprint R11)**: `strategyBase.onTick()`이 추상 메서드에서 concrete 메서드로 변경되었습니다. `metadata.trailingStop.enabled`가 `true`인 전략에서 매 틱마다 `_checkTrailingStop(price)`를 자동 호출하여, trailing stop 조건 충족 시 CLOSE 시그널을 방출합니다. 서브클래스는 `super.onTick(ticker)`를 호출하여 이 기능을 활용하거나, 완전히 오버라이드하여 자체 로직을 사용할 수 있습니다.

**시그널 구조**:
```javascript
{
  action: 'open_long',              // OPEN_LONG | OPEN_SHORT | CLOSE_LONG | CLOSE_SHORT
  symbol: 'BTCUSDT',
  category: 'USDT-FUTURES',
  suggestedQty: '3',               // 포지션 크기 (% of equity)
  suggestedPrice: '65432.50',
  stopLossPrice: '64000.00',       // Sprint R5: 거래소 SL 가격 (presetStopLossPrice)
  leverage: '5',                    // Sprint R6: 전략별 레버리지 (기본 1)
  confidence: '0.7500',            // 0~1 신뢰도
  marketContext: {                  // 시그널 시점의 시장 상태
    rsi: '28.5',
    sma: '65000',
    regime: 'trending_up'
  }
}
```

**전략 심볼 관리** (`strategyBase.js`):
- Set 기반 `_symbols` 관리: `addSymbol()`, `removeSymbol()`, `hasSymbol()`, `getSymbols()`
- `_currentProcessingSymbol`: 현재 처리 중인 심볼 추적
- `emitSignal()`: 시그널에 symbol이 없으면 `_currentProcessingSymbol`로 폴백
- `setAccountContext({ getEquity })`: equity DI 주입 (Sprint R4)
- `onFundingUpdate(data)`: 펀딩비 데이터 수신 콜백 (Sprint R4)

**전략 라우터** (`strategyRouter.js`):
- 시장 레짐 변경 시 `targetRegimes` 기반으로 전략 자동 활성화/비활성화
- 예: 상승장 → Turtle, MaTrend, Supertrend 활성화; Grid, QuietRangeScalp 비활성화
- **Phase 1 제한**: 전략당 첫 번째 심볼만 할당 (안정성 우선)

---

## 3단계: 시그널 필터링

**담당**: `signalFilter.js`

5가지 체크를 통과해야 주문 단계로 진행합니다.

| 체크 | 로직 | 기본값 |
|------|------|--------|
| **쿨다운** | 전략별 마지막 시그널 후 최소 대기 시간. **CLOSE/reduceOnly는 bypass** — `action.startsWith('close')` 또는 `signal.reduceOnly`로 판정 (Sprint R8, R11 수정) | 60초 |
| **중복 방지** | 같은 (전략+심볼+액션) 윈도우 내 중복 차단 | 5초 |
| **동시 포지션 제한** | 전략별 최대 동시 포지션 수 (OPEN 시그널만 적용) | 2개 |
| **심볼 충돌 방지** | 같은 심볼에 대해 반대 방향 OPEN 시그널 차단 | - |
| **신뢰도 필터** (Sprint R4) | confidence < 전략별 최소 임계값 차단 (mathUtils.isLessThan 사용) | low:'0.50', medium:'0.55', high:'0.60' |

### 포지션 카운트 업데이트 (Sprint R3)

`SignalFilter.updatePositionCount()`는 `TRADE_EVENTS.TRADE_COMPLETED` 이벤트를 통해 자동으로 호출됩니다. `botService.js`에서 거래 완료 시 전략 이름을 추출하여 필터에 전달합니다.

```javascript
// botService.js
this.on(TRADE_EVENTS.TRADE_COMPLETED, (trade) => {
  this.signalFilter.updatePositionCount(trade.strategy, -1);  // CLOSE 거래 시 카운트 감소
});
```

```
시그널 → 쿨다운? → 중복? → 포지션 한도? → 충돌? → 신뢰도? → ✅ 통과 / ❌ 차단
```

---

## 3.5단계: 포지션 사이징 (Sprint R2)

**담당**: `botService._resolveSignalQuantity()` + `botService._handleStrategySignal()`

시그널 필터를 통과한 후, 리스크 검증 전에 추상적인 퍼센트 기반 수량을 거래소에서 사용 가능한 실제 수량으로 변환합니다.

### `_resolveSignalQuantity(signal)` 파이프라인

```
suggestedQty (% of equity)
  → equity 조회 (페이퍼/라이브)
  → notional = equity × (suggestedQty / 100)
  → rawQty = notional / currentPrice
  → floorToStep(rawQty, stepSize)        ← mathUtils.floorToStep()
  → qty (거래소 호환 수량)
```

**핵심 함수**: `mathUtils.floorToStep(value, step)` — 값을 step 단위로 내림 처리 (예: `floorToStep('0.0567', '0.01')` → `'0.05'`). `getDecimalPlaces(numStr)` 헬퍼로 소수점 자릿수를 정확히 계산합니다.

### `_handleStrategySignal(signal)` 공통 핸들러

모든 전략 시그널은 이 공통 핸들러를 거칩니다:

```
시그널 수신 → _resolveSignalQuantity() → 수량 0이면 SIGNAL_SKIPPED 이벤트 → 리스크 검증 → 주문 제출 (await)
```

**CLOSE 시그널 수량 (Sprint R6, AD-35)**: CLOSE 시그널의 경우 `suggestedQty` 퍼센트 대신 `positionManager`에서 실제 포지션 수량을 조회하여 사용합니다.

**주문 제출 await (Sprint R6)**: `submitOrder()` 호출이 fire-and-forget(`.catch()`)에서 `await` + `try/catch`로 변경되어, 주문 실패 시 에러가 올바르게 처리됩니다.

---

## 4단계: 리스크 검증

**담당**: `riskEngine.js` (3개 서브 엔진)

**모든 주문**은 반드시 `riskEngine.validateOrder()`를 통과해야 합니다.

### 4-1. CircuitBreaker — 연속 손실 감지
```
연속 손실 횟수 ≥ consecutiveLossLimit (기본 5회) → 서킷 발동
→ cooldownMinutes(30분) 동안 모든 신규 주문 차단
```

### 4-2. DrawdownMonitor — 최대 낙폭 추적
```
일일 손실 ≥ maxDailyLossPercent (3%) → 일일 손실 중단
총 낙폭 ≥ maxDrawdownPercent (10%) → 전체 중단
```

### 4-3. ExposureGuard — 포지션 크기 제한
```
개별 포지션 크기 ≤ maxPositionSizePercent (5% of equity)
총 노출 ≤ maxTotalExposurePercent (30% of equity)
거래당 리스크 ≤ maxRiskPerTradePercent (2%)
```

**검증 결과**:
```javascript
// 승인
{ approved: true, adjustedQty: '0.05' }

// 거부
{ approved: false, reason: 'Exposure limit exceeded: 32% > 30% max' }
```

---

## 5단계: 주문 생성

**담당**: `orderManager.js`

리스크 검증을 통과하면 주문을 구성합니다.

### Per-Symbol Mutex (Sprint R2)

`orderManager.submitOrder()`에 심볼별 Promise-chaining 뮤텍스가 적용되어 있습니다. 같은 심볼에 대한 동시 주문 요청은 순차적으로 처리됩니다 (30초 타임아웃).

### 시장가 주문 가격 주입 (Sprint R6, AD-34)

시장가 주문의 경우 `order.price`가 없으므로, `orderManager`가 최신 틱 가격(`tickerAggregator` 또는 `marketData` 캐시)을 `riskPrice`로 주입하여 ExposureGuard에 전달합니다. ExposureGuard는 가격이 없거나 `'0'`인 주문을 즉시 거부합니다.

### Per-Signal 레버리지 설정 (Sprint R6, AD-36)

`orderManager`에 `_leverageCache` Map이 추가되었습니다. 주문 전 심볼+포지션 방향별로 레버리지가 캐시에 없으면 `exchangeClient.setLeverage()`를 호출하고 캐시합니다. 이를 통해 전략별로 다른 레버리지를 사용할 수 있습니다.

```
BTCUSDT 주문 A → 실행 중
BTCUSDT 주문 B → 대기 (A 완료 후 실행)
ETHUSDT 주문 C → 즉시 실행 (다른 심볼이므로 독립)
```

```javascript
{
  symbol: 'BTCUSDT',
  category: 'USDT-FUTURES',
  side: 'buy',
  orderType: 'market',
  qty: '0.05',
  posSide: 'long',
  clientOid: 'auto_1700000000000_abc123',
  // TP/SL 설정 (전략이 제공한 경우)
  takeProfitPrice: '67000.00',
  stopLossPrice: '64000.00'
}
```

**라이브 모드**: exchangeClient → Bitget REST API
**페이퍼 모드**: paperEngine → 가상 매칭 (슬리피지 + 수수료 시뮬레이션)

### 페이퍼 리스너 정리 (Sprint R3)

`orderManager.js`는 트레이딩 모드 전환 시 이전 페이퍼 엔진 리스너를 제거합니다:

```javascript
// 페이퍼 → 라이브 전환 시
if (this._paperFillHandler) {
  paperEngine.off('fill', this._paperFillHandler);
  this._paperFillHandler = null;
}
```

**장점**: 페이퍼↔라이브 반복 전환 시 리스너 중복 등록 방지

---

## 6단계: 거래소 전송 및 체결

**담당**: `exchangeClient.js` (라이브) / `paperEngine.js` (페이퍼)

### 라이브 모드
```
orderManager → exchangeClient.placeOrder() → Bitget REST API
              → 자동 재시도 (최대 3회, 지수 백오프)
              → 에러 분류: auth_error(즉시 실패), rate_limit(재시도), network_error(재시도)
```

### 페이퍼 모드
```
orderManager → paperEngine.matchMarketOrder()
              → 현재가 ± 슬리피지(5bps) 적용
              → 수수료(0.06%) 차감
              → fill 이벤트 발생
```

**페이퍼 주문 체결**:
```javascript
{
  clientOid: 'auto_xxx',
  symbol: 'BTCUSDT',
  side: 'buy',
  posSide: 'long',
  qty: '0.05',
  fillPrice: '65435.77',     // lastPrice + slippage
  fee: '1.963',              // 0.05 × 65435.77 × 0.0006
  notional: '3271.79',
  filledAt: 1700000000000
}
```

---

## 7단계: 포지션 동기화

**담당**: `positionManager.js` (라이브) / `paperPositionManager.js` (페이퍼)

체결 결과를 포지션 상태에 반영합니다.

### 라이브 모드
- WebSocket private 채널에서 실시간 포지션 업데이트 수신
- 주기적으로 REST API로 교차 검증

### 페이퍼 모드
```javascript
// 포지션 상태
{
  symbol: 'BTCUSDT',
  posSide: 'long',
  qty: '0.05',
  entryPrice: '65435.77',
  markPrice: '65500.00',        // 실시간 업데이트
  unrealizedPnl: '3.21',       // (markPrice - entryPrice) × qty
  leverage: '3',
  margin: '1090.60'
}
```

**RiskEngine 동기화**: 포지션 변경 시 `riskEngine.updateAccountState()`로 equity/positions 갱신

---

## 8단계: 손익 확정

**담당**: `positionManager.js` + `botService.js`

포지션 청산 시 손익을 계산하고 기록합니다.

```
체결(CLOSE) → PnL 계산 → MongoDB Trade 기록 → Socket.io 전달 → 프론트엔드 업데이트
```

**PnL 계산**:
- **롱 포지션**: `PnL = (exitPrice - entryPrice) × qty - fees`
- **숏 포지션**: `PnL = (entryPrice - exitPrice) × qty - fees`

**기록 대상**:
- MongoDB `Trade` 모델에 거래 기록 저장
- MongoDB `Signal` 모델에 시그널 결과 업데이트
- MongoDB `Snapshot` 모델에 equity 스냅샷 기록
- `BotSession.stats`에 통계 갱신 (totalTrades, wins, losses, totalPnl)

---

## 자금 분배 방식

여러 전략이 동시 활성화되어도 **사전 자금 할당은 없습니다**. 모든 전략이 공동 자금 풀에서 독립적으로 주문합니다.

### 제어 메커니즘

| 제어 계층 | 설명 | 기본값 |
|-----------|------|--------|
| 전략 Config | `positionSizePercent` — 전략이 요청하는 포지션 크기 | 2~5% |
| ExposureGuard | 개별 포지션 상한 | equity의 5% |
| ExposureGuard | 총 노출 상한 | equity의 30% |
| ExposureGuard | 거래당 리스크 상한 | equity의 2% |

### 예시 (equity = 10,000 USDT)

```
전략 A: 포지션 5% 요청 → 500 USDT (승인)    총 노출: 5%
전략 B: 포지션 4% 요청 → 400 USDT (승인)    총 노출: 9%
전략 C: 포지션 5% 요청 → 500 USDT (승인)    총 노출: 14%
...
전략 X: 포지션 5% 요청 → ExposureGuard: "총 노출 31% > 30% 제한" → 거부
```

### 토너먼트 모드 (격리)

토너먼트 모드에서는 각 전략이 **독립된 가상 계정**을 가집니다:
- 전략 A: 10,000 USDT (독립)
- 전략 B: 10,000 USDT (독립)
- 한 전략의 손실이 다른 전략에 영향 없음
