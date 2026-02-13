# 아키텍처

## 의존성 주입 (DI)

`backend/src/app.js`의 `bootstrap()` 함수에서 모든 서비스를 순서대로 생성하고 주입합니다.

### 서비스 생성 순서

```
1. exchangeClient (싱글턴)      ← 외부 의존성 없음
2. riskEngine                   ← 외부 의존성 없음 (내부 서브 엔진 생성)
3. orderManager                 ← { riskEngine, exchangeClient }
4. positionManager              ← { exchangeClient, riskEngine }
5. marketData                   ← { exchangeClient }
6. tickerAggregator             ← { marketData }
7. coinSelector                 ← { exchangeClient, tickerAggregator }
8. marketRegime                 ← { marketData, tickerAggregator }
9. indicatorCache               ← { marketData }
10. strategyRouter              ← { marketRegime }
11. signalFilter                ← (독립)
12. regimeParamStore            ← (독립)
13. regimeEvaluator             ← { marketRegime, marketData }
14. regimeOptimizer             ← { exchangeClient, regimeParamStore }
15. paperEngine                 ← { marketData } (페이퍼 모드 시)
16. paperPositionManager        ← (페이퍼 모드 시)
17. paperAccountManager         ← { paperEngine } (토너먼트 모드 시)
18. botService (오케스트레이터) ← { 위 모든 서비스 }
```

### API 라우트 팩토리

모든 라우트 파일은 팩토리 함수를 export합니다:

```javascript
// botRoutes.js
module.exports = function createBotRoutes({ botService, riskEngine }) {
  const router = require('express').Router();
  // ... 라우트 정의
  return router;
};

// app.js에서 주입
app.use('/api/bot', createBotRoutes({ botService, riskEngine }));
```

## 의존성 그래프

```
                    ┌─────────────┐
                    │ exchangeClient│ (Bitget SDK 싱글턴)
                    └──────┬──────┘
              ┌────────────┼──────────────┐
              │            │              │
        ┌─────▼─────┐  ┌──▼───┐  ┌──────▼──────┐
        │ marketData │  │order │  │  position   │
        │            │  │Manager│  │  Manager    │
        └─────┬──────┘  └──┬───┘  └─────────────┘
              │            │
     ┌────────┼────────┐   │
     │        │        │   │
┌────▼───┐ ┌──▼──────┐│   │
│ticker  │ │indicator ││   │
│Aggregat│ │Cache     ││   │
└────┬───┘ └──────────┘│   │
     │                 │   │
┌────▼────┐  ┌─────────▼┐ │
│coin     │  │market    │ │
│Selector │  │Regime    │ │
└─────────┘  └────┬─────┘ │
                  │        │
            ┌─────▼──────┐ │
            │strategy    │ │
            │Router      │ │
            └────────────┘ │
                           │
            ┌──────────────▼──────┐
            │     riskEngine      │
            │ ┌────────────────┐  │
            │ │CircuitBreaker  │  │
            │ │DrawdownMonitor │  │
            │ │ExposureGuard   │  │
            │ └────────────────┘  │
            └─────────────────────┘
                      │
              ┌───────▼───────┐
              │  botService   │ (오케스트레이터)
              └───────────────┘
```

## EventEmitter 기반 통신

서비스 간 통신은 Node.js EventEmitter 이벤트로 처리됩니다. 이벤트 상수는 `utils/constants.js`에 정의되어 있습니다.

### 이벤트 카테고리

#### MARKET_EVENTS — 시장 데이터 이벤트
| 이벤트 | 발신 서비스 | 수신 서비스 | 설명 |
|--------|-------------|-------------|------|
| `market:ticker` | marketData | tickerAggregator, strategies | 틱 데이터 업데이트 |
| `market:kline` | marketData | indicatorCache, strategies, marketRegime | 캔들 데이터 업데이트 |
| `market:book` | marketData | (선택적) | 호가 업데이트 |
| `market:regime_change` | marketRegime | strategyRouter, botService, regimeEvaluator | 시장 레짐 변경 |
| `symbol:regime_change` | marketRegime | botService (→ Socket.io) | 개별 심볼 레짐 변경 |
| `market:coin_selected` | coinSelector | botService | 코인 선정 완료 |

#### TRADE_EVENTS — 매매 이벤트
| 이벤트 | 발신 서비스 | 수신 서비스 | 설명 |
|--------|-------------|-------------|------|
| `trade:signal_generated` | strategies | signalFilter → orderManager | 전략 시그널 생성 |
| `trade:order_submitted` | orderManager | botService (→ Socket.io) | 주문 제출 |
| `trade:order_filled` | orderManager | positionManager, botService | 주문 체결 |
| `trade:order_cancelled` | orderManager | botService | 주문 취소 |
| `trade:position_updated` | positionManager | botService (→ Socket.io) | 포지션 업데이트 |

#### RISK_EVENTS — 리스크 이벤트
| 이벤트 | 발신 서비스 | 수신 서비스 | 설명 |
|--------|-------------|-------------|------|
| `risk:order_validated` | riskEngine | orderManager | 주문 리스크 승인 |
| `risk:order_rejected` | riskEngine | orderManager, botService | 주문 리스크 거부 |
| `risk:circuit_break` | CircuitBreaker | botService (→ Socket.io) | 서킷 브레이커 발동 |
| `risk:circuit_reset` | CircuitBreaker | botService | 서킷 브레이커 해제 |
| `risk:drawdown_warning` | DrawdownMonitor | botService (→ Socket.io) | 낙폭 경고 |
| `risk:drawdown_halt` | DrawdownMonitor | botService (→ Socket.io) | 낙폭 중단 |
| `risk:exposure_adjusted` | ExposureGuard | botService | 노출 조정 |

#### REGIME_EVENTS — 레짐 최적화 이벤트
| 이벤트 | 발신 서비스 | 수신 서비스 | 설명 |
|--------|-------------|-------------|------|
| `optimizer:cycle_start` | regimeOptimizer | (로깅) | 최적화 시작 |
| `optimizer:cycle_complete` | regimeOptimizer | (로깅) | 최적화 완료 |
| `params:updated` | regimeOptimizer | marketRegime | 파라미터 갱신 |
| `evaluation:complete` | regimeEvaluator | (로깅) | 정확도 평가 완료 |

### Socket.io → 프론트엔드 전달

botService가 백엔드 이벤트를 수신하여 Socket.io로 프론트엔드에 전달합니다:

```
백엔드 이벤트                    Socket.io 이벤트         프론트엔드 훅
─────────────────────────────────────────────────────────────────────
trade:signal_generated     →    signal_generated      →  useSocket
trade:position_updated     →    position_updated      →  useSocket
market:regime_change       →    regime_change         →  useSocket
symbol:regime_change       →    symbol_regime_update  →  useSocket
market:ticker              →    ticker                →  useSocket
risk:circuit_break         →    circuit_break         →  useSocket
risk:drawdown_warning      →    drawdown_warning      →  useSocket
risk:drawdown_halt         →    drawdown_halt         →  useSocket
```

## 상수 체계

### 주문 관련
```javascript
ORDER_SIDES   = { BUY: 'buy', SELL: 'sell' }
ORDER_TYPES   = { LIMIT: 'limit', MARKET: 'market' }
POS_SIDES     = { LONG: 'long', SHORT: 'short' }
ORDER_STATUS  = { PENDING, OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, REJECTED, FAILED }
SIGNAL_ACTIONS = { OPEN_LONG, OPEN_SHORT, CLOSE_LONG, CLOSE_SHORT }
```

### 시장/봇 상태
```javascript
MARKET_REGIMES = { TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE, QUIET }
BOT_STATES     = { IDLE, RUNNING, PAUSED, STOPPING, ERROR }
CATEGORIES     = { SPOT, USDT_FUTURES, COIN_FUTURES, USDC_FUTURES }
```

### 기본 리스크 파라미터
```javascript
DEFAULT_RISK_PARAMS = {
  maxPositionSizePercent: '5',       // 포지션당 최대 5%
  maxTotalExposurePercent: '30',     // 총 노출 최대 30%
  maxDailyLossPercent: '3',          // 일일 최대 손실 3%
  maxDrawdownPercent: '10',          // 최대 낙폭 10%
  maxRiskPerTradePercent: '2',       // 거래당 리스크 2%
  consecutiveLossLimit: 5,            // 연속 손실 5회 제한
  cooldownMinutes: 30                 // 쿨다운 30분
}
```

## WebSocket 인스턴스 타입

```javascript
WS_INST_TYPES = {
  PUBLIC_FUTURES: 'usdt-futures',  // 공개 채널 (틱, 캔들, 호가)
  PRIVATE: 'UTA'                    // 비공개 채널 (주문, 포지션, 계정)
}
```
