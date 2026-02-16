# 백테스트 시스템

## 개요

과거 kline 데이터로 전략 성과를 시뮬레이션합니다. 비동기 실행으로 ID를 즉시 반환하고, 폴링으로 진행률을 추적합니다.

---

## 구성 요소

```
┌───────────┐     ┌──────────────┐     ┌───────────────┐
│ dataFetcher│ ──→ │ backtestEngine│ ──→ │ backtestMetrics│
│ (데이터)   │     │ (시뮬레이션)  │     │ (지표 산출)    │
└───────────┘     └──────────────┘     └───────────────┘
       │                                       │
       ▼                                       ▼
┌───────────┐                          ┌───────────────┐
│ data/klines│                          │ backtestStore │
│ (캐시)     │                          │ (결과 저장)   │
└───────────┘                          └───────────────┘
```

---

## DataFetcher — 데이터 수집

### 기능
- Bitget API에서 과거 kline 데이터 수집
- 페이지네이션 자동 처리 (200개/요청)
- 로컬 JSON 파일 캐시 (`backend/data/klines/`)

### 캐시 경로 규칙
```
data/klines/{symbol}_{interval}_{startTime}_{endTime}.json
예: data/klines/BTCUSDT_1H_1734969600000_1739318400000.json
```

### 워밍업 바
```
실제 시작 시점 전 200개 추가 캔들 수집
→ 이동평균선 등 지표 초기화에 필요
```

### 정규화
```
Bitget 원시 형식: [ts, open, high, low, close, volCoin, volUsdt]
↓ 정규화
{ ts: string, open: string, high: string, low: string, close: string, volume: string }
```

### 지원 타임프레임

| 간격 | 밀리초 |
|------|--------|
| 1m | 60,000 |
| 5m | 300,000 |
| 15m | 900,000 |
| 30m | 1,800,000 |
| 1H | 3,600,000 |
| 4H | 14,400,000 |
| 1D | 86,400,000 |
| 1W | 604,800,000 |

---

## BacktestEngine — 시뮬레이션

### 입력 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `strategyName` | (필수) | 등록된 전략 이름 |
| `strategyConfig` | {} | 설정 오버라이드 |
| `symbol` | (필수) | 심볼 (예: BTCUSDT) |
| `interval` | (필수) | 타임프레임 (예: 1H) |
| `initialCapital` | (필수) | 초기 자본 (String) |
| `makerFee` | '0.0002' | 메이커 수수료 (0.02%) |
| `takerFee` | '0.0006' | 테이커 수수료 (0.06%) |
| `slippage` | '0.0005' | 슬리피지 (0.05%) |
| `marketRegime` | null | 고정 시장 레짐 (선택) |

### 시뮬레이션 루프

```
각 캔들(kline)에 대해:
  1. strategy.onKline(kline)    → 지표 계산 + 시그널 생성
  2. 대기 시그널 처리            → OPEN/CLOSE 주문 실행
  3. 합성 ticker 생성           → strategy.onTick(ticker)
  4. equity 스냅샷 기록

마지막 캔들 후:
  → 잔여 포지션 강제 청산
  → metrics 산출
```

### BacktestIndicatorCache (Sprint R3)

백테스트 전용 지표 캐시로, `indicatorCache.js`의 `computeIndicator()` 함수를 재사용합니다. 전략이 `feedKline()`을 통해 kline을 주입하면 자동으로 지표를 계산하여 캐시에 저장합니다.

```javascript
// 백테스트 엔진 내부에서 전략에 주입
const cache = new BacktestIndicatorCache();
strategy._backtestIndicatorCache = cache;

// 각 kline마다 지표 사전 계산
cache.feedKline(symbol, interval, kline);
// → strategy.onKline() 호출 시 캐시된 지표 즉시 사용 가능
```

**장점**: 실시간 모드와 동일한 지표 계산 로직 사용, 코드 중복 없음

### 슬리피지 적용 규칙

| 동작 | 슬리피지 방향 | 이유 |
|------|-------------|------|
| OPEN_LONG (매수 진입) | 가격 상승 | 매수자에게 불리 |
| OPEN_SHORT (매도 진입) | 가격 하락 | 매도자에게 불리 |
| CLOSE_LONG (매도 청산) | 가격 하락 | 매도자에게 불리 |
| CLOSE_SHORT (매수 청산) | 가격 상승 | 매수자에게 불리 |

```javascript
// OPEN_LONG
fillPrice = close × (1 + slippage)

// OPEN_SHORT
fillPrice = close × (1 - slippage)

// CLOSE_LONG
fillPrice = close × (1 - slippage)

// CLOSE_SHORT
fillPrice = close × (1 + slippage)
```

### 포지션 사이징 (Sprint R4)

전략 메타데이터 기반 동적 포지션 사이징:

```
우선순위:
1. positionSizePercent (전략 config)
2. totalBudgetPercent (Grid 전략 등)
3. riskLevel 매핑: { low: '10', medium: '15', high: '8' }
4. 기본값 DEFAULT_POSITION_SIZE_PCT = '15' (이전: '95')

수량 = (cash × positionSizePercent / 100) / fillPrice
```

**Equity DI**: 백테스트 엔진은 `strategy.setAccountContext({ getEquity: () => this._cash })`로 현재 가용 자금을 전략에 주입합니다.

### 멀티포지션 지원 (Sprint R10, AD-60)

`_position` (단일) 대신 `_positions` (Map)으로 전환되어 동시 다중 포지션을 지원합니다.

| 항목 | 값 |
|------|-----|
| 포지션 키 | `pos_${autoIncrementId}` |
| 최대 동시 포지션 | 전략 metadata `maxConcurrentPositions` (hard cap: 10) |
| 청산 방식 | FIFO (Map insertion order) |
| 펀딩비 | 포지션별 개별 적용 |

**핵심 동작**:
- `_openLong`/`_openShort`: 포지션 수 ≥ maxPositions이면 스킵, 잔여 cash 확인
- `_closeLong`/`_closeShort`: Map 순서대로 첫 번째 포지션 청산 (FIFO)
- `_calculateEquity`: 모든 열린 포지션의 MTM 합산
- `_forceClosePosition`: 모든 포지션 순회 청산
- `_applyFundingIfDue`: 포지션별 개별 펀딩비 적용

**회귀 안전**: `maxConcurrentPositions=1` 전략은 동작 변경 없음 (기존과 동일한 결과)

### Equity 계산

```
포지션 없음:  equity = cash
단일 포지션:
  롱:    equity = cash + (qty × currentPrice)
  숏:    equity = cash + entryNotional + unrealizedPnl
멀티포지션: equity = cash + Σ(각 포지션의 MTM)
```

**R11 변경**: `_calculateEquity()`가 열린 포지션의 미실현 손익(unrealized PnL)을 equity에 포함합니다. 또한 펀딩비가 cash에서 직접 차감되어 equity 곡선에 펀딩 비용이 반영됩니다.

---

## BacktestMetrics — 성과 지표

### 거래 통계

| 지표 | 설명 |
|------|------|
| `totalTrades` | 총 거래 수 |
| `wins` | 승리 거래 수 (PnL > 0) |
| `losses` | 패배 거래 수 (PnL ≤ 0) |
| `winRate` | 승률 (%) |
| `consecutiveWins` | 최대 연속 승리 |
| `consecutiveLosses` | 최대 연속 패배 |
| `avgHoldTime` | 평균 보유 시간 (ms) |

### 수익 지표

| 지표 | 설명 |
|------|------|
| `totalPnl` | 총 손익 (String) |
| `totalReturn` | 총 수익률 (%) |
| `avgWin` | 평균 승리 금액 |
| `avgLoss` | 평균 손실 금액 (절대값) |
| `largestWin` | 최대 단일 수익 |
| `largestLoss` | 최대 단일 손실 |
| `profitFactor` | 이익 합산 / 손실 합산 (무손실 시 999.99) |

### 리스크 지표

| 지표 | 설명 | 산출 방식 |
|------|------|-----------|
| `maxDrawdown` | 최대 낙폭 (절대값) | peak - trough |
| `maxDrawdownPercent` | 최대 낙폭 (%) | (peak - trough) / peak × 100 |
| `sharpeRatio` | 연간화 샤프 비율 | (평균 수익률 × √intervalsPerYear) / 수익률 표준편차 |
| `sortinoRatio` | 소르티노 비율 (Sprint R10) | (평균 수익률 × √intervalsPerYear) / 하방 편차. 하방만 고려 (MAR=0) |
| `calmarRatio` | 칼마 비율 (Sprint R10) | totalReturn / maxDrawdownPercent. 수익 대비 최대 낙폭 |
| `totalFees` | 총 수수료 | 모든 거래 수수료 합산 |
| `totalFundingCost` | 총 펀딩 비용 (Sprint R11) | 시뮬레이션 동안 발생한 펀딩비 절대값 합산 |
| `finalEquity` | 최종 자산 | 시뮬레이션 종료 시 equity |

#### 샤프 비율 연간화 (Sprint R3)

타임프레임별로 적절한 연간화 계수를 사용합니다:

| 타임프레임 | intervalsPerYear | 연간화 계수 (√) |
|-----------|------------------|----------------|
| 1m | 525,600 | 725.2 |
| 5m | 105,120 | 324.2 |
| 15m | 35,040 | 187.2 |
| 30m | 17,520 | 132.4 |
| 1H | 8,760 | 93.6 |
| 4H | 2,190 | 46.8 |
| 1D | 365 | 19.1 |
| 1W | 52 | 7.2 |

예: 1H 백테스트 → `sharpeRatio = (평균 시간별 수익률 × 93.6) / 표준편차`

### 거래 0건 시
모든 지표 0 또는 빈값, `finalEquity = initialCapital`, `sortinoRatio = '0.00'`, `calmarRatio = '0.00'`

### Edge Cases (Sprint R10)
- 하방 편차 = 0 (모든 수익 양수) → `sortinoRatio = '999.99'`
- 최대 낙폭 = 0 → `calmarRatio = '999.99'`

---

## BacktestStore — 결과 저장

인메모리 싱글턴 Map으로 결과를 저장합니다. **FIFO 50건 제한** (Sprint R8): 최대 50개 결과만 보관하며, 초과 시 가장 오래된 항목부터 자동 삭제하여 메모리 O.O.M을 방지합니다.

### 메서드

| 메서드 | 설명 |
|--------|------|
| `save(id, result)` | 결과 저장 + createdAt 자동 첨부 |
| `get(id)` | 전체 결과 조회 (equityCurve, trades 포함) |
| `list()` | 요약 목록 (equityCurve, trades 제외) |
| `delete(id)` | 결과 삭제 |
| `has(id)` | 존재 확인 |

### 결과 구조

```javascript
{
  id: 'bt_abc123',
  createdAt: '2026-01-15T10:00:00Z',
  status: 'completed',          // running | completed | error
  progress: 100,                // 0~100
  config: { strategyName, symbol, interval, startTime, endTime, ... },
  metrics: { totalTrades, winRate, totalPnl, maxDrawdown, ... },
  trades: [
    { entryTime, exitTime, entryPrice, exitPrice, side, qty, pnl, fee }
  ],
  equityCurve: [
    { ts, equity, cash, unrealizedPnl? }  // R11: unrealizedPnl 필드 추가 (선택)
  ],
  error: null
}
```

---

## 일괄 백테스트 스크립트

### 실행

```bash
node backend/scripts/runAllBacktest.js
```

### 설정

| 항목 | 값 |
|------|-----|
| 데이터 | BTCUSDT 1H, Dec 2024 ~ Feb 2025 |
| 초기 자본 | $10,000 |
| 테이커 수수료 | 0.06% |
| 메이커 수수료 | 0.02% |
| 슬리피지 | 0.05% |
| 스킵 전략 | FundingRateStrategy (외부 데이터 필요) |

### 레짐 전략

```
1. 전략 메타데이터의 선호 레짐으로 백테스트
2. 거래 0건이면 → 모든 레짐 순회: [trending_up, trending_down, ranging, volatile, quiet, null]
3. 거래가 발생하는 첫 번째 레짐 사용
```

### 출력

1. 콘솔: pass/fail 요약
2. 수익률 기준 순위 테이블
3. 비활성 전략 목록 (전 레짐에서 거래 0건)
4. 최고 성과 전략 (최소 3거래 기준):
   - Best Return, Win Rate, Profit Factor, Sharpe, Lowest MDD
5. 파일: `backend/data/bt_all_results.json`

### 출력 파일 구조

```json
{
  "timestamp": "2026-01-15T10:00:00Z",
  "dataRange": "BTCUSDT 1H Dec2024~Feb2025",
  "klineCount": 1064,
  "initialCapital": "10000",
  "results": [
    {
      "strategy": "MaTrendStrategy",
      "regime": "trending_up",
      "totalTrades": 12,
      "wins": 7,
      "winRate": "58.33",
      "totalPnl": "850.23",
      "totalReturn": "8.50",
      "profitFactor": "2.15",
      "maxDrawdownPercent": "3.20",
      "sharpeRatio": "1.42",
      "totalFees": "42.50",
      "totalFundingCost": "12.30"
    }
  ]
}
```

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/backtest/run` | 백테스트 실행 (비동기, ID 즉시 반환) |
| GET | `/api/backtest` | 백테스트 목록 (요약, trades/equityCurve 제외) |
| GET | `/api/backtest/strategies` | 사용 가능 전략 목록 |
| GET | `/api/backtest/:id` | 전체 결과 |
| GET | `/api/backtest/:id/equity-curve` | 자산 곡선 (`?maxPoints=500` 다운샘플링) |
| GET | `/api/backtest/:id/trades` | 거래 내역 (`?skip=0&limit=50`) |
| DELETE | `/api/backtest/:id` | 결과 삭제 |

### 워크플로우

```
1. POST /api/backtest/run → { id: 'bt_xxx' }
2. GET /api/backtest/bt_xxx (1초 폴링)
   → { status: 'running', progress: 45 }
   → { status: 'running', progress: 80 }
   → { status: 'completed', metrics: {...}, trades: [...] }
3. 결과 확인 + 시각화
```
