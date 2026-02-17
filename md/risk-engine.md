# 리스크 엔진

## 개요

`riskEngine.js`는 **모든 주문의 필수 게이트웨이**입니다. 3개의 독립적인 서브 엔진이 주문을 검증합니다. 하나라도 거부하면 주문이 실행되지 않습니다.

```
주문 요청 → equity=0 조기 차단 → CircuitBreaker → DrawdownMonitor → ExposureGuard → 승인/거부
```

### equity=0 안전장치 (Sprint R2)

`validateOrder()`는 equity가 `'0'`이거나 falsy일 경우, 서브 엔진 검증 없이 **즉시 거부**합니다. 이는 봇 시작 직후 계정 상태가 동기화되기 전에 주문이 들어오는 경우를 방지합니다. `ExposureGuard`에서도 동일하게 equity=0일 때 division-by-zero를 방지하는 가드가 추가되었습니다.

### reduceOnly bypass (Sprint R8, AD-46)

`validateOrder()`는 `reduceOnly: true`인 주문(SL/TP/CLOSE)에 대해 **CircuitBreaker와 DrawdownMonitor 검증을 건너뛰고** ExposureGuard만 적용합니다. 이를 통해 서킷 브레이커 발동 중이거나 낙폭 중단 상태에서도 기존 포지션의 청산이 보장됩니다.

```
주문 요청 → equity=0 체크 → reduceOnly인가?
  ├─ 예 → ExposureGuard만 검증 → 승인/거부
  └─ 아니오 → CircuitBreaker → DrawdownMonitor → ExposureGuard → 승인/거부
```

## 기본 리스크 파라미터

```javascript
{
  maxPositionSizePercent: '5',       // 포지션당 최대 equity의 5%
  maxTotalExposurePercent: '30',     // 총 노출 최대 equity의 30%
  maxDailyLossPercent: '3',          // 일일 최대 손실 3%
  maxDrawdownPercent: '10',          // 최대 낙폭 10%
  maxRiskPerTradePercent: '2',       // 거래당 리스크 2%
  consecutiveLossLimit: 5,            // 연속 손실 5회 제한
  cooldownMinutes: 30                 // 서킷 브레이커 쿨다운
}
```

**파라미터 업데이트**: `PUT /api/bot/risk-params` 또는 `riskEngine.updateParams()`

---

## 1. CircuitBreaker — 연속 손실 감지

연속 손실이 임계값을 초과하면 자동으로 매매를 중단합니다.

### 동작 로직

```
거래 체결 → 손실인가?
  ├─ 아니오 → 연속 손실 카운터 리셋
  └─ 예 → 카운터 +1 + rapidLosses 타임스탬프 추가
         ├─ rapidLosses 윈도우(5분) 외 항목 trim
         ├─ 체크 1: 카운터 ≥ consecutiveLossLimit (5)?
         │  └─ 예 → 서킷 발동! (consecutive_loss_limit)
         └─ 체크 2: rapidLosses.length ≥ rapidLossThreshold (3)?
            └─ 예 → 서킷 발동! (rapid_loss_threshold)

발동 시:
  → cooldownMinutes (30분) 동안 모든 OPEN 주문 차단
  → RISK_EVENTS.CIRCUIT_BREAK 이벤트 발생
  → 30분 후 자동 해제 (RISK_EVENTS.CIRCUIT_RESET)
```

### 메모리 안전장치 (Sprint R4)

`rapidLosses` 배열에 절대 상한 `MAX_RAPID_LOSSES = 500`이 적용됩니다. 이 한계를 초과하면 가장 최근 500개만 유지하여 메모리 누수를 방지합니다.

### 상태

```javascript
{
  tripped: false,            // 발동 여부
  reason: null,              // 발동 사유
  trippedAt: null,           // 발동 시각
  consecutiveLosses: 0,      // 현재 연속 손실 수
  totalTrips: 0              // 총 발동 횟수
}
```

### 특이사항
- **CLOSE 주문은 항상 통과** — 기존 포지션 청산은 서킷 발동 중에도 가능
- 수동 리셋 가능: `riskEngine.resetCircuitBreaker()`

---

## 2. DrawdownMonitor — 최대 낙폭 추적

일일 손실과 총 낙폭을 실시간 추적합니다.

### 동작 로직

```
포지션/계정 업데이트 → equity 갱신
  ├─ equity > peakEquity → peakEquity 갱신
  └─ drawdown = (peakEquity - equity) / peakEquity × 100
     ├─ drawdown ≥ maxDrawdownPercent (10%) → HALT!
     │  → 모든 주문 차단 + 기존 포지션 강제 청산 시도
     │  → RISK_EVENTS.DRAWDOWN_HALT 이벤트
     └─ drawdown ≥ 경고 임계값 (기본 7%) → 경고
        → RISK_EVENTS.DRAWDOWN_WARNING 이벤트

일일 리셋 (UTC 0시) → dailyLoss = 0
  └─ 일일 손실 ≥ maxDailyLossPercent (3%) → 당일 신규 주문 차단
```

### 경고 디바운싱 (Sprint R14)

DrawdownMonitor의 `DRAWDOWN_WARNING` 이벤트가 5분 간격으로 제한됩니다. 고빈도 equity 변동 시 동일한 경고가 반복 발생하는 것을 방지합니다.

```javascript
// 5분 이내 이전 경고가 있으면 emit 건너뜀
if (Date.now() - this._lastWarningTime < this._warningDebounceMs) return;
```

### 상태

```javascript
{
  currentDrawdown: '2.5',     // 현재 낙폭 (%)
  maxDrawdown: '10',          // 설정된 최대 낙폭
  halted: false,              // 중단 여부
  peakEquity: '10500',        // 최고점 자산
  dailyLoss: '150',           // 당일 손실
  dailyLossLimit: '300'       // 당일 손실 한도 (equity × 3%)
}
```

### peakEquity 영속성 (Sprint R10, AD-58)

서버 재시작 시 `peakEquity`가 `'0'`으로 리셋되어 drawdown 보호가 무력화되는 문제를 해결합니다.

```javascript
// DrawdownMonitor 상태 복원/저장 메서드
drawdownMonitor.loadState({ peakEquity, dailyStartEquity })  // BotSession에서 복원
drawdownMonitor.getState()  // { peakEquity, dailyStartEquity, currentDrawdown, ... } 스냅샷 반환
```

**복원 흐름** (`botService.start()`):
```
1. 마지막 idle/stopped BotSession 조회 (R11: { status: { $in: ['idle', 'stopped'] } })
2. session.stats.peakEquity → loadState()
3. updateEquity(currentEquity) 호출
4. drawdown 한도 초과 시 자동 halt 트리거 (isHalted 별도 영속화 불필요)
```

**방어 로직**: hydrate 시 peakEquity가 현재 equity보다 낮으면 현재 equity를 사용.

**영속화**: `botService._updateSessionStats()`에서 DrawdownMonitor의 peakEquity를 BotSession.stats에 동기화.

### 수동 리셋 (Sprint R3)

낙폭 모니터를 수동으로 리셋할 수 있습니다:

```javascript
// 일일 손실만 리셋 (dailyLoss = 0)
riskEngine.resetDaily()

// 전체 리셋 (dailyLoss = 0, peakEquity = currentEquity, currentDrawdown = 0, halted = false)
riskEngine.resetDrawdown()
```

API:
```
POST /api/risk/drawdown/reset
Body: { "type": "daily" | "full" }
```

리셋 시 `RISK_EVENTS.DRAWDOWN_RESET` 이벤트가 발생하여 Socket.io를 통해 프론트엔드에 전달됩니다.

---

## 3. ExposureGuard — 포지션 크기 제한

개별 포지션과 총 노출을 equity 대비 비율로 제한합니다.

### 가격 방어 (Sprint R6, AD-34)

ExposureGuard는 `order.price`가 `'0'`이거나 falsy인 경우 **즉시 거부**합니다 (`reason: 'no_price_for_exposure_check'`). 시장가 주문의 경우, OrderManager가 사전에 최신 틱 가격을 `riskPrice`로 주입하여 ExposureGuard에 전달합니다.

### 검증 로직

```
주문 요청 (qty, price, side) →

0. price가 없거나 '0'이면 즉시 거부
1. orderValue = qty × price
2. positionSizePercent = orderValue / equity × 100
   → positionSizePercent > maxPositionSizePercent (5%)?
     → 거부: "Position size 6% exceeds 5% limit"

3. newTotalExposure = 기존 노출 + orderValue
4. totalExposurePercent = newTotalExposure / equity × 100
   → totalExposurePercent > maxTotalExposurePercent (30%)?
     → 거부: "Total exposure 32% exceeds 30% limit"

5. riskAmount = qty × price × (slDistance / price)
6. riskPercent = riskAmount / equity × 100
   → riskPercent > maxRiskPerTradePercent (2%)?
     → 수량 자동 조정 (adjustedQty)
```

### 수량 자동 조정

ExposureGuard는 가능한 경우 주문을 거부하지 않고 수량을 줄여서 승인합니다:

```
요청: 0.10 BTC (equity의 7%)
→ maxPositionSizePercent = 5%
→ adjustedQty = 0.10 × (5 / 7) = 0.071 BTC
→ 승인 (조정된 수량)
```

### 상태

```javascript
{
  totalExposure: '2500',         // 현재 총 노출
  maxExposure: '3000',           // 최대 허용 노출 (equity × 30%)
  utilizationPercent: '83.3',    // 노출 활용률
  positionCount: 3               // 현재 포지션 수
}
```

---

## 계정 상태 동기화

RiskEngine은 실시간으로 계정 상태를 추적해야 합니다:

```javascript
riskEngine.updateAccountState({
  equity: '10500',          // 총 자산
  positions: [              // 현재 포지션 목록
    { symbol: 'BTCUSDT', qty: '0.05', entryPrice: '65000', markPrice: '65500' },
    { symbol: 'ETHUSDT', qty: '1.0', entryPrice: '3500', markPrice: '3520' }
  ]
});
```

### 계정 상태 조회 (Sprint R6)

`riskEngine.getAccountState()`로 캐시된 계정 상태를 조회할 수 있습니다. REST API 호출 없이 equity와 포지션 정보를 반환합니다:

```javascript
const { equity, positions } = riskEngine.getAccountState();
// equity: '10500', positions: [...] (방어적 복사)
```

botService는 봇 시작 시 이 메서드를 사용하여 equity를 확인합니다 (REST fallback 포함).

### 동기화 시점
- **라이브 모드**: WebSocket 포지션/계정 이벤트 수신 시
- **페이퍼 모드**: `paperPositionManager.onFill()` 호출 시
- **봇 시작 시**: 초기 잔고 로드 후 (페이퍼: `getEquity()`)

> **중요**: 페이퍼 모드에서 봇 시작 시 equity 동기화를 빠뜨리면 `ExposureGuard`에서 divide by zero 오류가 발생합니다 (equity = "0"으로 초기화되어 있기 때문).

---

## 리스크 API

### GET /api/bot/status → riskStatus 필드

```javascript
{
  riskStatus: {
    circuitBreaker: {
      tripped: false,
      reason: null,
      trippedAt: null
    },
    exposureGuard: {
      totalExposure: '2500',
      maxExposure: '3000',
      utilizationPercent: '83.3'
    },
    drawdownMonitor: {
      currentDrawdown: '2.5',
      maxDrawdown: '10',
      halted: false,
      peakEquity: '10500'
    },
    accountState: {
      equity: '10250',
      positionCount: 3
    }
  }
}
```

### PUT /api/bot/risk-params

```json
{
  "params": {
    "maxPositionSizePercent": "3",
    "maxTotalExposurePercent": "20",
    "consecutiveLossLimit": 3
  }
}
```

---

## RiskEvent MongoDB 모델 (Sprint R2)

파일: `backend/src/models/RiskEvent.js`

리스크 엔진에서 발생한 이벤트를 MongoDB에 영구 기록합니다. 30일 TTL로 자동 만료됩니다.

### 스키마

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `eventType` | String | Yes | 이벤트 유형 (circuit_break, drawdown_warning, drawdown_halt, exposure_adjusted, unhandled_error 등) |
| `severity` | String | Yes | 심각도 (`critical`, `warning`, `info`) |
| `message` | String | - | 이벤트 설명 |
| `riskSnapshot` | Mixed | - | 발생 시점의 리스크 스냅샷 (equity, drawdown, exposure 등) |
| `acknowledged` | Boolean | - | 사용자 확인 여부 (기본 `false`) |
| `sessionId` | ObjectId | - | 관련 봇 세션 ID |

### TTL
- `createdAt` 필드에 30일 TTL 인덱스 설정 — 30일 후 자동 삭제

### Static 메서드
- `getUnacknowledged(sessionId?)` — 미확인 이벤트 조회
- `acknowledge(eventId)` — 이벤트 확인 처리

### 전용 API (`/api/risk`)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/risk/events` | 리스크 이벤트 목록 (`?sessionId=&severity=&limit=50`) |
| GET | `/api/risk/events/unacknowledged` | 미확인 리스크 이벤트 |
| PUT | `/api/risk/events/:id/acknowledge` | 이벤트 확인 처리 |
| GET | `/api/risk/status` | 현재 리스크 상태 종합 |
| POST | `/api/risk/drawdown/reset` | 낙폭 모니터 리셋 (`{ "type": "daily" \| "full" }`) |
