# 리스크 엔진

## 개요

`riskEngine.js`는 **모든 주문의 필수 게이트웨이**입니다. 3개의 독립적인 서브 엔진이 주문을 검증합니다. 하나라도 거부하면 주문이 실행되지 않습니다.

```
주문 요청 → CircuitBreaker → DrawdownMonitor → ExposureGuard → 승인/거부
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
  └─ 예 → 카운터 +1
         └─ 카운터 ≥ consecutiveLossLimit (5)?
            ├─ 아니오 → 계속 허용
            └─ 예 → 서킷 발동!
                   → cooldownMinutes (30분) 동안 모든 OPEN 주문 차단
                   → RISK_EVENTS.CIRCUIT_BREAK 이벤트 발생
                   → 30분 후 자동 해제 (RISK_EVENTS.CIRCUIT_RESET)
```

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

---

## 3. ExposureGuard — 포지션 크기 제한

개별 포지션과 총 노출을 equity 대비 비율로 제한합니다.

### 검증 로직

```
주문 요청 (qty, price, side) →

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
