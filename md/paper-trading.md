# 페이퍼 트레이딩 & 토너먼트 모드

## 개요

실제 자금 없이 가상 매매를 시뮬레이션하는 모드입니다. 두 가지 하위 모드가 있습니다:

| 모드 | 환경 변수 | 설명 |
|------|-----------|------|
| **페이퍼 트레이딩** | `PAPER_TRADING=true` | 단일 공유 계정으로 가상 매매 |
| **토너먼트** | `PAPER_TRADING=true` + `TOURNAMENT_MODE=true` | 전략별 격리 계정으로 성과 비교 |

---

## 페이퍼 트레이딩

### 구성 요소

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ orderManager │ ──→ │ paperEngine  │ ──→ │ paperPosition    │
│              │     │ (주문 매칭)  │     │ Manager (포지션) │
└──────────────┘     └──────────────┘     └──────────────────┘
```

### PaperEngine — 가상 주문 매칭

실제 거래소 대신 가상으로 주문을 체결합니다.

#### 시장가 주문
```
현재가(lastPrice) ± 슬리피지(5bps) = 체결가
수수료 = 수량 × 체결가 × feeRate(0.06%)
```

**슬리피지 적용**:
- 매수: `fillPrice = lastPrice × (1 + 0.0005)` → 불리하게 (높은 가격)
- 매도: `fillPrice = lastPrice × (1 - 0.0005)` → 불리하게 (낮은 가격)

#### 지정가 주문
- 대기열에 추가 → 매 틱마다 조건 확인
- 체결 조건: 시장가가 지정가에 도달
- 체결 시 슬리피지 없음 (지정가 그대로)

#### Stop Loss 시뮬레이션 (Sprint R5)

PaperEngine에 거래소 사이드 SL 시뮬레이션이 추가되었습니다:
- `registerStopLoss({ symbol, posSide, triggerPrice, qty, strategy })`: SL 주문 등록
- `cancelStopLoss(symbol, posSide)`: SL 주문 취소
- `_checkStopLossTriggers(symbol, lastPrice)`: 매 틱마다 SL 트리거 확인
- LONG SL: `lastPrice <= triggerPrice`, SHORT SL: `lastPrice >= triggerPrice`
- SL 체결 시 `paper:fill` (reduceOnly, reason: 'stop_loss_triggered') + `paper:sl_triggered` 이벤트 발생
- `getPendingSLOrders()`: 대기 중 SL 주문 조회

#### Take Profit 시뮬레이션 (Sprint R11)

PaperEngine에 거래소 사이드 TP 시뮬레이션이 추가되었습니다:
- `registerTakeProfit({ symbol, posSide, triggerPrice, qty, strategy })`: TP 주문 등록
- `cancelTakeProfit(symbol, posSide)`: TP 주문 취소
- `_checkTakeProfitTriggers(symbol, lastPrice)`: 매 틱마다 TP 트리거 확인
- LONG TP: `lastPrice >= triggerPrice`, SHORT TP: `lastPrice <= triggerPrice`
- TP 체결 시 `paper:fill` (reduceOnly, reason: 'take_profit_triggered') + `paper:tp_triggered` 이벤트 발생

#### 대기 주문 관리 (Sprint R11)

대기 중인 지정가 주문에 TTL과 용량 제한이 적용됩니다:
- **30분 TTL**: 30분 이상 경과한 미체결 대기 주문은 자동 삭제
- **50건 상한**: 대기 주문이 50건을 초과하면 FIFO 방식으로 가장 오래된 주문부터 삭제

#### SL/TP Stale Cleanup (Sprint R14)

`_cleanupStaleOrders()` 메서드가 SL/TP 대기 주문도 정리합니다:
- **2시간 TTL**: 등록 후 2시간 이상 경과한 SL/TP 주문은 자동 삭제
- 대상: `_pendingSLOrders` Map + `_pendingTPOrders` Map
- 포지션 없이 남아있는 고아 SL/TP 주문 방지

#### reset() (Sprint R6)

`paperEngine.reset()`으로 대기 주문(`_pendingOrders`, `_pendingSLOrders`)과 가격 캐시(`_lastPrices`)를 초기화합니다. `botService.stop()` 시 자동 호출됩니다.

#### 기본 설정
```javascript
feeRate = '0.0006'     // 0.06% 테이커 수수료
slippageBps = '5'      // 5 bps = 0.05%
```

#### 체결(Fill) 객체
```javascript
{
  clientOid: 'auto_xxx',
  symbol: 'BTCUSDT',
  side: 'buy',
  posSide: 'long',
  qty: '0.05',
  fillPrice: '65435.77',
  fee: '1.963',
  notional: '3271.79',
  reduceOnly: false,
  strategy: 'TurtleBreakoutStrategy',
  action: 'open_long',        // Sprint R3: 시그널 액션 필드 추가
  filledAt: 1700000000000
}
```

### PaperPositionManager — 가상 포지션 관리

#### 초기 잔고
```javascript
initialBalance = '10000'  // 기본 10,000 USDT
```

#### 포지션 상태
```javascript
{
  symbol: 'BTCUSDT',
  posSide: 'long',
  qty: '0.05',
  entryPrice: '65435.77',
  markPrice: '65500.00',
  unrealizedPnl: '3.21',
  leverage: '3',                         // Sprint R6: fill에서 전달된 레버리지 반영
  margin: '1090.60',
  strategy: 'TurtleBreakoutStrategy'  // Sprint R3: 전략 필드 추가
}
```

#### 자산 계산
```
equity = availableBalance + Σ(unrealizedPnl)
availableBalance = initialBalance + realizedPnl - 사용중 마진
```

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/paper/status` | 페이퍼 상태 + 잔고 + 포지션 + 대기 주문 |
| GET | `/api/paper/positions` | 가상 포지션 목록 |
| GET | `/api/paper/orders` | 대기 중 지정가 주문 |
| POST | `/api/paper/reset` | 잔고/포지션/주문 초기화 |

---

## 토너먼트 모드

### 개념

18개 전략 각각에 **독립된 가상 계정**을 부여하여 동일 시장 조건에서 성과를 비교합니다.

```
┌────────────────────────────────────────────────────┐
│                 PaperAccountManager                 │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│
│ │ 전략 A 계정   │ │ 전략 B 계정   │ │ 전략 C 계정   ││
│ │ equity: 10523 │ │ equity: 9850  │ │ equity: 10100 ││
│ │ positions: 1  │ │ positions: 0  │ │ positions: 2  ││
│ └──────────────┘ └──────────────┘ └──────────────┘│
│                                                    │
│ 공유: PaperEngine (주문 매칭)                      │
│ 격리: PaperPositionManager (각 전략 독립)          │
└────────────────────────────────────────────────────┘
```

### 격리 보장

| 항목 | 격리 여부 | 설명 |
|------|-----------|------|
| 잔고(equity) | 격리 | 각 전략 독립 계정 |
| 포지션 | 격리 | 전략 A의 포지션은 B에 영향 없음 |
| PnL | 격리 | 한 전략의 손실이 다른 전략에 영향 없음 |
| 주문 매칭 | 공유 | 동일한 PaperEngine 사용 |
| 시장 데이터 | 공유 | 동일한 시장 조건 |

### PaperAccountManager 주요 메서드

```javascript
// 토너먼트 시작 — 전략별 독립 계정 생성
startTournament(['MaTrend', 'Grid', 'Turtle'])

// 체결 라우팅 — fill.strategy 기준으로 해당 계정에 반영
onFill(fill) // → fill.strategy === 'MaTrend' → MaTrend 계정에 적용

// 순위표 조회
getLeaderboard()
// → [{ rank, strategy, equity, pnl, pnlPercent, unrealizedPnl, positionCount }]

// 전략별 계정 상태
getStrategyAccountState('MaTrend')
// → { equity, availableBalance, unrealizedPnl, positions[] }

// Sprint R8: 초기 잔고 설정 (캡슐화 준수)
setInitialBalance('20000')

// Sprint R8: 전략별 포지션 조회 (캡슐화 준수)
getStrategyPositions('MaTrend')
// → [{ symbol, posSide, qty, entryPrice, ..., strategy: 'MaTrend' }]
```

### 리더보드

```
┌──────┬──────────────────────┬──────────┬──────────┬────────┐
│ 순위 │ 전략                 │ 자산     │ PnL      │ PnL%   │
├──────┼──────────────────────┼──────────┼──────────┼────────┤
│ 🥇 1 │ MaTrendStrategy      │ 10,523   │ +523.45  │ +5.23% │
│ 🥈 2 │ AdaptiveRegimeStrat. │ 10,100   │ +100.00  │ +1.00% │
│ 🥉 3 │ TurtleBreakoutStrat. │ 10,050   │ +50.00   │ +0.50% │
│   4  │ RsiPivotStrategy     │ 9,980    │ -20.00   │ -0.20% │
│   5  │ GridStrategy         │ 9,850    │ -150.00  │ -1.50% │
└──────┴──────────────────────┴──────────┴──────────┴────────┘
```

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/tournament/info` | 토너먼트 메타데이터 |
| POST | `/api/tournament/start` | 시작 (전략 배열 + 초기 잔고) |
| POST | `/api/tournament/stop` | 중지 |
| POST | `/api/tournament/reset` | 리셋 (잔고 초기화, 거래 삭제 선택) |
| GET | `/api/tournament/leaderboard` | 순위표 + 토너먼트 정보 |
| GET | `/api/tournament/strategy/:name` | 전략 상세 (계정, 포지션, 통계, 최근 거래) |

#### POST /api/tournament/start 요청

```json
{
  "strategies": [
    "MaTrendStrategy",
    "GridStrategy",
    "TurtleBreakoutStrategy",
    "AdaptiveRegimeStrategy"
  ],
  "initialBalance": "10000"
}
```

#### GET /api/tournament/strategy/:name 응답

```json
{
  "success": true,
  "data": {
    "strategy": "MaTrendStrategy",
    "account": {
      "equity": "10523.45",
      "availableBalance": "8200.00",
      "unrealizedPnl": "23.45"
    },
    "positions": [
      { "symbol": "BTCUSDT", "posSide": "long", "qty": "0.05", "entryPrice": "65000", "markPrice": "65500" }
    ],
    "stats": {
      "totalTrades": 8,
      "wins": 5,
      "losses": 3,
      "winRate": "62.5"
    },
    "recentTrades": []
  }
}
```

---

## 모드 전환

### 전환 조건
- 봇이 **정지 상태**에서만 전환 가능
- 실행 중 전환 시도 시 400 에러

### 전환 방법

**API**:
```javascript
// 라이브 → 페이퍼
POST /api/bot/trading-mode { "mode": "paper" }

// 페이퍼 → 라이브
POST /api/bot/trading-mode { "mode": "live" }
```

**프론트엔드**: TradingModeToggle 컴포넌트로 토글

### 모드별 차이

| 항목 | 라이브 모드 | 페이퍼 모드 |
|------|------------|------------|
| 주문 실행 | Bitget 실제 거래 | PaperEngine 가상 매칭 |
| 포지션 관리 | Bitget WS + REST | PaperPositionManager |
| 자금 | 실제 계정 잔고 | 가상 잔고 (기본 10,000) |
| 백테스트 접근 | 불가 | 가능 |
| 토너먼트 접근 | 불가 | 가능 |
| 리스크 | 실제 손실 위험 | 손실 없음 |
