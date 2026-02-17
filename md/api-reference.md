# API 레퍼런스

## 개요

- **Base URL**: `http://localhost:3001`
- **응답 규약**: `{ success: boolean, data: T, error?: string }`
- **인증**: API Key (`Authorization: Bearer <API_KEY>` 헤더, Sprint R5). 미설정 시 비활성화. `/api/health`, `/metrics` 면제.
- **Content-Type**: `application/json`
- **Rate Limiting** (Sprint R4): 인메모리 슬라이딩 윈도우. Critical(10/분), Standard(60/분), Heavy(3/분). 초과 시 429 응답 + `retryAfter` 헤더. `/api/bot/emergency-stop`, `/api/health/*` 제외.

---

## Bot 제어 (`/api/bot`)

### 봇 생명주기

| Method | Path | 설명 | 요청 Body |
|--------|------|------|-----------|
| POST | `/api/bot/start` | 봇 시작 | `{ strategies?: string[], symbols?: string[] }` (선택) |
| POST | `/api/bot/stop` | 봇 정지 | - |
| POST | `/api/bot/pause` | 봇 일시정지 | - |
| POST | `/api/bot/resume` | 봇 재개 | - |
| GET | `/api/bot/status` | 봇 상태 조회 | - |
| POST | `/api/bot/emergency-stop` | 긴급 정지 (전 포지션 청산) | - |

#### GET /api/bot/status 응답

```json
{
  "success": true,
  "data": {
    "running": true,
    "sessionId": "65a1b2c3...",
    "status": "running",
    "strategies": [
      { "name": "TurtleBreakoutStrategy", "active": true }
    ],
    "symbols": ["BTCUSDT", "ETHUSDT"],
    "registeredStrategies": ["TurtleBreakoutStrategy", "GridStrategy", "..."],
    "riskStatus": {
      "circuitBreaker": { "tripped": false, "reason": null, "trippedAt": null },
      "exposureGuard": { "totalExposure": "2500", "maxExposure": "3000", "utilizationPercent": "83.3" },
      "drawdownMonitor": { "currentDrawdown": "2.5", "maxDrawdown": "10", "halted": false, "peakEquity": "10500" },
      "accountState": { "equity": "10250", "positionCount": 3 }
    },
    "paperMode": true,
    "tradingMode": "paper",
    "regime": { "regime": "trending_up", "confidence": 0.72, "timestamp": "..." }
  }
}
```

### 트레이딩 모드

| Method | Path | 설명 | 요청 Body |
|--------|------|------|-----------|
| GET | `/api/bot/trading-mode` | 현재 모드 조회 | - |
| POST | `/api/bot/trading-mode` | 모드 전환 (봇 정지 상태에서만) | `{ "mode": "live" \| "paper" }` |

### 리스크 파라미터

| Method | Path | 설명 | 요청 Body |
|--------|------|------|-----------|
| PUT | `/api/bot/risk-params` | 리스크 파라미터 업데이트 | `{ "params": { "maxPositionSizePercent": "3", ... } }` |

### 전략 관리

| Method | Path | 설명 | 요청 Body |
|--------|------|------|-----------|
| GET | `/api/bot/strategies` | 전체 전략 목록 + 활성 상태 | - |
| POST | `/api/bot/strategies/:name/enable` | 전략 런타임 활성화 | `{ config?: {} }` (선택) |
| POST | `/api/bot/strategies/:name/disable` | 전략 런타임 비활성화 | - |
| PUT | `/api/bot/strategies/:name/config` | 실행 중 전략 설정 변경 | 설정 객체 |

#### GET /api/bot/strategies 응답

```json
{
  "success": true,
  "data": {
    "strategies": [
      {
        "name": "TurtleBreakoutStrategy",
        "description": "N-day breakout strategy",
        "defaultConfig": { "entryChannel": 20, "exitChannel": 10 },
        "targetRegimes": ["trending_up", "trending_down", "volatile"],
        "riskLevel": "medium",
        "active": true,
        "paramMeta": [
          { "field": "entryChannel", "label": "진입 채널", "type": "integer", "min": 5, "max": 100, "step": 1, "group": "indicator", "description": "..." }
        ],
        "docs": {
          "summary": "...", "timeframe": "1분봉", "entry": { "long": "...", "short": "...", "conditions": [] },
          "exit": { "tp": "...", "sl": "...", "trailing": "...", "other": [] },
          "indicators": ["EMA(20)", "ATR(14)"], "riskReward": { "tp": "+3%", "sl": "-2%", "ratio": "1:1.5" },
          "strengths": [], "weaknesses": [], "bestFor": "...", "warnings": [], "difficulty": "intermediate"
        },
        "maxConcurrentPositions": 1,
        "cooldownMs": 300000,
        "warmupCandles": 50,
        "volatilityPreference": "neutral",
        "maxSymbolsPerStrategy": 1,
        "runtime": {
          "currentConfig": { "entryChannel": 20 },
          "assignedSymbols": ["BTCUSDT"]
        }
      }
    ]
  }
}
```

> **Sprint R13 확장**: `paramMeta` (group, description 포함), `docs` (전략 설명 메타데이터), `maxConcurrentPositions`, `cooldownMs`, `warmupCandles`, `volatilityPreference`, `maxSymbolsPerStrategy`, `runtime` (봇 실행 중일 때만) 필드가 추가되었습니다.

#### PUT /api/bot/strategies/:name/config 요청

Sprint R13: 서버측 config 검증이 추가되었습니다. `strategyConfigValidator`가 paramMeta의 min/max/type 제약조건을 검사하여, 위반 시 `400 Bad Request` + `validationErrors` 배열을 반환합니다.

---

## 거래 (`/api/trades`)

| Method | Path | 설명 | 쿼리/Body |
|--------|------|------|-----------|
| GET | `/api/trades` | 거래 내역 | `?sessionId=&symbol=&limit=50&skip=0` |
| GET | `/api/trades/open` | 미체결 주문 | `?sessionId=` |
| POST | `/api/trades/order` | 수동 주문 제출 | `{ symbol, side, orderType, qty, price?, ... }` |
| DELETE | `/api/trades/order/:orderId` | 주문 취소 | `?symbol=BTCUSDT` |
| GET | `/api/trades/positions` | 현재 포지션 + 계정 상태 | - |
| GET | `/api/trades/signals` | 시그널 내역 | `?limit=50&sessionId=` |

#### GET /api/trades/positions 응답

```json
{
  "success": true,
  "data": {
    "positions": [
      {
        "symbol": "BTCUSDT",
        "posSide": "long",
        "qty": "0.05",
        "entryPrice": "65000",
        "markPrice": "65500",
        "unrealizedPnl": "25.00",
        "leverage": "3",
        "liquidationPrice": "62000",
        "margin": "1083.33",
        "stopLossPrice": "64000",
        "strategy": "TurtleBreakoutStrategy"
      }
    ],
    "accountState": {
      "equity": "10025",
      "availableBalance": "7500",
      "unrealizedPnl": "25.00"
    }
  }
}
```

---

## 분석 (`/api/analytics`)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/analytics/session/:sessionId` | 세션 통계 (승률, PnL, 샤프 등) |
| GET | `/api/analytics/equity-curve/:sessionId` | 자산 곡선 데이터 |
| GET | `/api/analytics/daily/:sessionId` | 일별 통계 |
| GET | `/api/analytics/by-strategy/:sessionId` | 전략별 통계 |
| GET | `/api/analytics/by-symbol/:sessionId` | 심볼별 통계 |

#### GET /api/analytics/session/:id 응답

```json
{
  "success": true,
  "data": {
    "totalTrades": 42,
    "wins": 25,
    "losses": 17,
    "totalPnl": "523.45",
    "maxDrawdown": "312.00",
    "winRate": "59.52",
    "avgWin": "45.20",
    "avgLoss": "-18.30",
    "profitFactor": "2.47",
    "sharpeRatio": "1.85"
  }
}
```

---

## 백테스트 (`/api/backtest`)

| Method | Path | 설명 | 쿼리/Body |
|--------|------|------|-----------|
| POST | `/api/backtest/run` | 백테스트 실행 (비동기, ID 즉시 반환) | 아래 참조 |
| GET | `/api/backtest` | 백테스트 목록 (요약) | - |
| GET | `/api/backtest/strategies` | 사용 가능 전략 목록 | - |
| GET | `/api/backtest/:id` | 백테스트 상세 결과 | - |
| GET | `/api/backtest/:id/equity-curve` | 자산 곡선 (다운샘플링 지원) | `?maxPoints=500` |
| GET | `/api/backtest/:id/trades` | 거래 내역 (페이지네이션) | `?skip=0&limit=50` |
| DELETE | `/api/backtest/:id` | 백테스트 삭제 | - |

#### POST /api/backtest/run 요청

```json
{
  "strategyName": "TurtleBreakoutStrategy",
  "strategyConfig": {},
  "symbol": "BTCUSDT",
  "interval": "1H",
  "startTime": 1734969600000,
  "endTime": 1739318400000,
  "initialCapital": "10000",
  "makerFee": "0.0002",
  "takerFee": "0.0006",
  "slippage": "0.0005",
  "marketRegime": "trending_up",
  "leverage": "1"
}
```

> **leverage** (Sprint R12, AD-70): 1~20 정수. 기본값 `"1"`. margin = cash * pct, positionValue = margin * leverage. 강제 청산은 미시뮬레이션.
> **동시 실행 제한** (Sprint R12): 봇 RUNNING 시 최대 1건, 정지 시 최대 2건. 초과 요청 시 429 응답.

#### GET /api/backtest/:id 응답

```json
{
  "success": true,
  "data": {
    "id": "bt_abc123",
    "status": "completed",
    "progress": 100,
    "config": { "..." },
    "metrics": {
      "totalTrades": 15,
      "wins": 9,
      "losses": 6,
      "winRate": "60.00",
      "totalPnl": "850.23",
      "totalReturn": "8.50",
      "profitFactor": "2.15",
      "maxDrawdownPercent": "3.20",
      "sharpeRatio": "1.42",
      "finalEquity": "10850.23"
    },
    "trades": [],
    "equityCurve": [],
    "createdAt": "2026-01-15T..."
  }
}
```

---

## 페이퍼 트레이딩 (`/api/paper`)

> `PAPER_TRADING=true` 환경 변수 필요

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/paper/status` | 페이퍼 모드 상태 + 잔고 + 포지션 + 대기 주문 |
| GET | `/api/paper/positions` | 가상 포지션 |
| GET | `/api/paper/orders` | 대기 중 지정가 주문 |
| POST | `/api/paper/reset` | 잔고/포지션 초기화 |

---

## 토너먼트 (`/api/tournament`)

> `PAPER_TRADING=true` AND `TOURNAMENT_MODE=true` 환경 변수 필요

| Method | Path | 설명 | 요청 Body |
|--------|------|------|-----------|
| GET | `/api/tournament/info` | 토너먼트 메타데이터 | - |
| POST | `/api/tournament/start` | 토너먼트 시작 | `{ "strategies": ["A", "B"], "initialBalance": "10000" }` |
| POST | `/api/tournament/stop` | 토너먼트 중지 | - |
| POST | `/api/tournament/reset` | 토너먼트 리셋 | `{ "initialBalance": "10000", "clearTrades": true }` |
| GET | `/api/tournament/leaderboard` | 순위표 | - |
| GET | `/api/tournament/strategy/:name` | 전략 상세 | - |

#### GET /api/tournament/leaderboard 응답

```json
{
  "success": true,
  "data": {
    "tournament": {
      "tournamentId": "t_abc123",
      "running": true,
      "startedAt": "2026-01-15T10:00:00Z",
      "strategyCount": 5,
      "initialBalance": "10000"
    },
    "leaderboard": [
      {
        "rank": 1,
        "strategy": "MaTrendStrategy",
        "equity": "10523.45",
        "pnl": "523.45",
        "pnlPercent": "5.23",
        "unrealizedPnl": "12.30",
        "positionCount": 1
      }
    ]
  }
}
```

---

## 레짐 (`/api/regime`)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/regime/status` | 현재 레짐 + 컨텍스트 + 신뢰도 |
| GET | `/api/regime/params` | 활성 파라미터 세트 |
| GET | `/api/regime/params/history` | 최적화 히스토리 |
| POST | `/api/regime/params` | 수동 파라미터 업데이트 (병합 방식) |
| POST | `/api/regime/params/rollback/:v` | 이전 버전 롤백 |
| POST | `/api/regime/optimize` | 수동 최적화 실행 |
| GET | `/api/regime/evaluations` | 정확도 평가 결과 (`?limit=20`) |
| GET | `/api/regime/optimizer/status` | 옵티마이저 상태 |

---

## 리스크 이벤트 (`/api/risk`)

리스크 엔진에서 발생한 이벤트(서킷 브레이크, 낙폭 경고, 노출 조정 등)를 조회하고 관리합니다.

| Method | Path | 설명 | 쿼리/Body |
|--------|------|------|-----------|
| GET | `/api/risk/events` | 리스크 이벤트 목록 | `?sessionId=&severity=&limit=50` |
| GET | `/api/risk/events/unacknowledged` | 미확인 리스크 이벤트 | - |
| PUT | `/api/risk/events/:id/acknowledge` | 리스크 이벤트 확인 처리 | - |
| GET | `/api/risk/status` | 현재 리스크 상태 (서킷 브레이커, 낙폭, 노출 종합) | - |
| POST | `/api/risk/drawdown/reset` | 낙폭 모니터 수동 리셋 (daily/full) | `{ "type": "daily" \| "full" }` |

#### GET /api/risk/events 응답

```json
{
  "success": true,
  "data": [
    {
      "_id": "65a1b2c3...",
      "eventType": "circuit_break",
      "severity": "critical",
      "message": "연속 5회 손실로 서킷 브레이커 발동",
      "riskSnapshot": {
        "equity": "9500",
        "drawdown": "5.0",
        "exposure": "15.2"
      },
      "acknowledged": false,
      "sessionId": "65a1b2c3...",
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ]
}
```

#### GET /api/risk/status 응답

```json
{
  "success": true,
  "data": {
    "circuitBreaker": { "tripped": false, "reason": null },
    "drawdownMonitor": { "currentDrawdown": "2.5", "halted": false },
    "exposureGuard": { "utilizationPercent": "83.3" },
    "accountState": { "equity": "10250", "positionCount": 3 }
  }
}
```

---

## 시스템 상태 (`/api/health`)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 전체 시스템 헬스 체크 (200 or 503) |
| GET | `/api/health/ping` | 단순 핑 (항상 200) |

---

## Prometheus 메트릭 (`/metrics`) (Sprint R5)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/metrics` | Prometheus scrape 엔드포인트 (text/plain) |

인증 면제. 14개 커스텀 메트릭 + Node.js 기본 메트릭:
- HTTP: `http_request_duration_seconds`, `http_requests_total`
- Trading: `trading_orders_total`, `trading_pnl_per_trade`, `trading_positions_open`, `trading_fill_latency_seconds`, `trading_slippage_bps`
- Risk: `risk_events_total`, `risk_circuit_breaker_trips_total`, `risk_drawdown_percent`
- System: `bot_uptime_seconds`, `exchange_api_calls_total`, `exchange_api_latency_seconds`, `ws_reconnections_total`

#### GET /api/health 응답

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 86400,
    "services": {
      "exchange": { "status": "connected", "latency": 45 },
      "database": { "status": "connected", "latency": 5 },
      "websocket": { "status": "connected" }
    },
    "ws": {
      "connected": true,
      "lastPublicMessageMs": 1708200000000,
      "lastPrivateMessageMs": 1708200000000,
      "publicStale": false,
      "privateStale": false
    },
    "timestamp": "2026-01-15T10:00:00Z"
  }
}
```

> **ws** (Sprint R12, AD-71): ExchangeClient의 `getWsStatus()` 반환값. `publicStale`/`privateStale`은 마지막 메시지로부터 60초 이상 경과 시 `true`.

---

## Socket.io 이벤트

프론트엔드에서 실시간으로 수신하는 이벤트:

| 이벤트 | 페이로드 | 설명 |
|--------|---------|------|
| `signal_generated` | Signal 객체 | 새 시그널 생성 |
| `position_updated` | Position 객체 | 포지션 변경 |
| `regime_change` | `{ regime, confidence }` | 시장 레짐 변경 |
| `symbol_regime_update` | `{ symbol, regime, confidence }` | 개별 심볼 레짐 변경 |
| `ticker` | Ticker 객체 | 가격/볼륨 업데이트 |
| `circuit_break` | `{ reason, trippedAt }` | 서킷 브레이커 발동 |
| `drawdown_warning` | `{ currentDrawdown, maxDrawdown }` | 낙폭 경고 |
| `drawdown_halt` | `{ currentDrawdown }` | 낙폭 중단 |
| `drawdown_reset` | `{ type, resetBy }` | 낙폭 모니터 리셋 |
| `circuit_reset` | `{ resetAt }` | 서킷 브레이커 해제 |
| `exposure_adjusted` | `{ symbol, adjustedQty, reason }` | 노출 자동 조정 |
| `unhandled_error` | `{ error, source }` | 미처리 예외 발생 |
| `signal_skipped` | `{ strategy, symbol, reason }` | 시그널 건너뜀 |
