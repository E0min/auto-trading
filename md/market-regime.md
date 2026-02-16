# 시장 레짐 시스템

## 개요

시장 상태를 5가지 레짐으로 실시간 분류하고, 분류 결과에 따라 전략을 자동으로 활성화/비활성화합니다.

### 5가지 레짐

| 레짐 | 한국어 | 설명 |
|------|--------|------|
| `trending_up` | 상승장 | 가격 상승 추세, 이동평균선 정렬 |
| `trending_down` | 하강장 | 가격 하락 추세 |
| `ranging` | 횡보장 | 방향성 없는 박스권 |
| `volatile` | 고변동성 | 큰 가격 변동폭 |
| `quiet` | 저변동성 | 작은 가격 변동폭, 거래량 감소 |

> **축 분류**: 방향(trending_up/trending_down/ranging)과 변동성(volatile/quiet)은 독립적인 축이지만, 최종 레짐은 가장 높은 점수 하나로 결정됩니다.

---

## 6팩터 가중 분류 (marketRegime.js)

### 팩터 목록

| # | 팩터 | 가중치 | 계산 방식 |
|---|------|--------|-----------|
| F1 | Multi-SMA Trend | 0.19 | 가격 vs EMA-9, SMA-20, SMA-50 정렬도 |
| F2 | Adaptive ATR | 0.17 | ATR 백분위 (히스토리 대비 75th/25th) |
| F3 | ROC Momentum | 0.16 | 10캔들 전 대비 변화율 (%) |
| F4 | Market Breadth | 0.19 | 상승 코인 / (상승 + 하락) 비율 |
| F5 | Volume Confirmation | 0.14 | 현재 볼륨 / SMA(20) 볼륨 비율 |
| F6 | Hysteresis | 0.15 | 현재 레짐 유지 보너스 (지터 방지) |

### 팩터 상세

#### F1: Multi-SMA Trend (가중치 0.19)
```
가격 > EMA-9 > SMA-20 > SMA-50  →  trending_up: 1.0
가격 < EMA-9 < SMA-20 < SMA-50  →  trending_down: 1.0
부분 정렬                         →  해당 방향: 0.3~0.7
```

#### F2: Adaptive ATR (가중치 0.17)
```
ATR 백분위 > 75th  →  volatile: 0.6~1.0 (극단일수록 높음)
ATR 백분위 < 25th  →  quiet: 0.6~1.0
그 사이              →  ranging: 0.4~0.6
```

#### F3: ROC Momentum (가중치 0.16)
```
ROC > +2%   →  trending_up: 1.0
ROC < -2%   →  trending_down: 1.0
|ROC| < 0.5% →  ranging: 0.6
```

#### F4: Market Breadth (가중치 0.19)
```
상승 코인 > 65%  →  trending_up: 1.0
상승 코인 < 35%  →  trending_down: 1.0
45%~55% 사이     →  ranging: 0.6
```

#### F5: Volume Confirmation (가중치 0.14)
```
볼륨 비율 > 1.5  →  volatile: 0.4 (고볼륨 = 변동성 확인)
볼륨 비율 < 0.7  →  quiet: 0.6 (저볼륨 = 저변동성 확인)
```

#### F6: Hysteresis (가중치 0.15)
```
현재 레짐에 +0.15 보너스 부여 → 불필요한 레짐 전환 방지
최소 10캔들 연속 확인 필요 (configurable, Optimizer 범위 [5,20])
```

### 최종 스코어 계산

```
각 레짐별 점수 = Σ(팩터_i × 가중치_i × 팩터_i의_해당_레짐_점수)
최종 레짐 = argmax(trending_up, trending_down, ranging, volatile, quiet)
confidence = 최고 점수 / 총 점수
```

---

## 삼중 보호 체계 (Sprint R7, AD-40)

레짐 전환 노이즈를 방지하는 3개 레이어:

```
Layer 1: Hysteresis (10캔들)    — 최소 10분 연속 확인 후 전환
Layer 2: Cooldown (5분)         — 전환 후 5분간 추가 전환 차단
Layer 3: Grace Period (5~15분)  — 전략 비활성화 전 유예기간
```

### 전환 쿨다운 (AD-44)

타이머 없이 timestamp 비교 방식:
```javascript
// _applyHysteresis() 내부
if (Date.now() - this._lastTransitionTs < cooldownMs) {
  return; // 전환 차단, pending 상태 유지
}
```
- `transitionCooldownMs`: 기본 300000ms (5분), Optimizer 범위 [120K, 600K]
- 쿨다운 중에도 pending 캔들은 계속 축적 → 쿨다운 종료 즉시 전환 가능

### 전환 빈도 메트릭 (R7-C1)

```javascript
marketRegime.getTransitionsLastHour()  // 최근 1시간 전환 횟수
marketRegime.getCooldownStatus()       // { active: boolean, remainingMs: number }
marketRegime.getContext()              // transitionsLastHour, cooldownStatus, lastTransitionTs 포함
```

---

## 전략 라우터 (strategyRouter.js)

레짐 변경 시 전략을 자동으로 활성화/비활성화합니다.

### 라우팅 로직 (Sprint R7 업데이트)

```
레짐 변경 이벤트 수신 → 각 전략의 targetRegimes 확인
  ├─ targetRegimes에 현재 레짐 포함
  │   ├─ 유예 중이면 → 유예 취소 (cancelGracePeriod)
  │   └─ 비활성이면 → activate()
  └─ targetRegimes에 현재 레짐 미포함
      └─ 활성이면 → 유예기간 시작 (OPEN 차단, CLOSE 허용)
                     유예 만료 시 → deactivate()
```

### 유예기간 시스템 (AD-41, AD-42, AD-43)

**상태 머신**: `ACTIVE → GRACE_PERIOD → DEACTIVATED` (레짐 복귀 시 `GRACE_PERIOD → ACTIVE`)

**중앙 관리**: `StrategyRouter._gracePeriods` Map + `setTimeout` + `unref()`

**유예 기간 값** (전략 metadata `gracePeriodMs` 우선, fallback 5분):

| 카테고리 | 전략 | 유예기간 |
|----------|------|---------|
| price-action (6개) | Turtle, Candle, S/R, Swing, Fibonacci, Trendline | 10분 |
| indicator-light (7개) | MaTrend, Funding, RsiPivot, Supertrend, Bollinger, Vwap, MacdDivergence | 5분 |
| indicator-light: Grid | Grid | 3분 |
| indicator-heavy (2개) | QuietRangeScalp, Breakout | 15분 |
| indicator-heavy: AdaptiveRegime | AdaptiveRegime | 0 (전 레짐 활성) |

**시그널 필터링** (AD-43): BotService `_handleStrategySignal()`에서 유예 중 전략의 OPEN 차단, CLOSE(SL/TP) 허용.

### 라우팅 예시

```
레짐: ranging → volatile 변경

활성화:  Turtle, SwingStructure, Funding, Supertrend (volatile 포함)
유예 시작: Grid (5분), VwapReversion (5분) — OPEN 차단, CLOSE 허용
유지:    CandlePattern, SupportResistance, RsiPivot (둘 다 포함)
```

### 이벤트

```javascript
// 전략 활성화
{ event: 'strategy:activated', name: 'TurtleBreakoutStrategy', regime: 'volatile' }

// 유예기간 시작 (Sprint R7)
{ event: 'strategy:grace_started', name: 'GridStrategy', regime: 'volatile', graceMs: 180000, expiresAt: 1700000180000 }

// 유예기간 취소 (레짐 복귀)
{ event: 'strategy:grace_cancelled', name: 'GridStrategy', reason: 'regime_returned' }

// 유예 만료 → 비활성화
{ event: 'strategy:deactivated', name: 'GridStrategy', regime: 'volatile', reason: 'grace_period_expired' }

// 전체 라우팅 결과
{
  event: 'router:regime_switch',
  previous: 'ranging',
  current: 'volatile',
  activated: ['Turtle', 'SwingStructure'],
  deactivated: ['Grid', 'VwapReversion'],
  activeCount: 10,
  totalCount: 18
}
```

---

## 코인 선정 (coinSelector.js)

7팩터 가중 스코어링으로 최적의 매매 대상 코인을 선정합니다.

### 7팩터 스코어링

| # | 팩터 | 설명 |
|---|------|------|
| F1 | Volume | 24시간 거래량 |
| F2 | Spread Inverse | 스프레드 역수 (낮을수록 좋음) |
| F3 | Open Interest | 미결제약정 |
| F4 | Funding Inverse | 펀딩비 역수 (중립일수록 좋음) |
| F5 | Momentum | 24시간 변화율 (레짐에 따라 조정) |
| F6 | Volatility | (고점-저점)/가격 × 100 |
| F7 | Volume Momentum | 볼륨 모멘텀 |

### 레짐별 가중치

| 팩터 | 상승장 | 하강장 | 횡보장 | 고변동성 | 저변동성 |
|------|--------|--------|--------|----------|----------|
| Volume | 15 | 15 | 20 | 25 | 20 |
| Spread Inv | 10 | 10 | 20 | 25 | 25 |
| OI | 20 | 20 | 10 | 10 | 10 |
| Funding Inv | 10 | 10 | 10 | 5 | 10 |
| Momentum | 25 | 25 | 5 | 10 | 5 |
| Volatility | 10 | 10 | 15 | 15 | 10 |
| Vol Momentum | 10 | 10 | 20 | 10 | 20 |

### 파이프라인

```
1. 사전 필터: 최소 볼륨, 최대 스프레드, 최대 변동률
2. 보강: OI + 펀딩비 조회 (60초 캐시)
3. 팩터 계산: 7개 원시값 산출
4. 정규화: 백분위 랭킹 [0~100]
5. 스코어: 가중 합산 = Σ(rank × weight) / 100
6. 정렬 & 선택: 상위 N개 코인
```

---

## 레짐 정확도 평가 (regimeEvaluator.js)

레짐 분류의 사후 정확도를 측정합니다.

### 평가 방식

레짐 변경 **4시간 후** 실제 가격 움직임과 비교:

| 레짐 | 정확 기준 |
|------|-----------|
| trending_up | 가격 변화 ≥ +0.5% |
| trending_down | 가격 변화 ≤ -0.5% |
| volatile | 가격 범위 ≥ 1.5% |
| ranging / quiet | |가격 변화| ≤ 0.3% |

### 평가 레코드

```javascript
{
  regime: 'trending_up',
  confidence: 0.72,
  priceAtClassification: '65000',
  classifiedAt: 1700000000000,
  priceAtEvaluation: '65800',
  priceChange: '1.23',          // %
  priceRange: '2.1',            // %
  correct: true,
  evaluatedAt: 1700014400000    // 4시간 후
}
```

---

## 레짐 파라미터 자동 최적화 (regimeOptimizer.js)

6시간마다 백테스트 기반으로 레짐 분류 파라미터를 자동 최적화합니다.

### 최적화 사이클

```
1. BTC 1H 7일간 kline 데이터 수집
2. 현재 파라미터 기준 MaTrend 백테스트 (기준선)
3. 20개 파라미터 변이 생성 (±20% 섭동)
4. 각 변이 백테스트 실행
5. 최적 변이 선택 (적합도 함수)
6. 개선이 있으면: EMA 블렌딩 (30%) 후 저장
```

### 적합도 함수

```
fitness = sharpe + 0.5 × profitFactor + 0.3 × (winRate / 100) - 0.2 × (maxDD / 100)
```

### EMA 블렌딩

급격한 파라미터 변경을 방지합니다:

```
새 파라미터 = 현재 × 0.7 + 최적 × 0.3
```

### 최적화 대상 파라미터 범위

| 파라미터 | 범위 |
|----------|------|
| ema9Period | 7~12 |
| sma20Period | 15~30 |
| sma50Period | 40~60 |
| atrPeriod | 10~20 |
| atrHighPercentile | 0.65~0.85 |
| atrLowPercentile | 0.15~0.35 |
| rocPeriod | 5~20 |
| rocStrongThreshold | 1.0~3.0 |
| breadthStrongRatio | 0.60~0.75 |
| hysteresisMinCandles | 5~20 |
| transitionCooldownMs | 120,000~600,000 |
| weights | 각 0.05~0.40 (정규화) |

### 파라미터 저장소 (regimeParamStore.js)

- `getParams()` — 현재 활성 파라미터 조회
- `save(params, source, meta)` — 새 파라미터 저장 (히스토리 유지)
- `getHistory()` — 최적화 히스토리 조회
- `rollback(index)` — 이전 버전으로 롤백

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/regime/status` | 현재 레짐 + 컨텍스트 |
| GET | `/api/regime/params` | 활성 파라미터 |
| GET | `/api/regime/params/history` | 최적화 히스토리 |
| POST | `/api/regime/params` | 수동 파라미터 갱신 |
| POST | `/api/regime/params/rollback/:v` | 이전 버전 롤백 |
| POST | `/api/regime/optimize` | 수동 최적화 트리거 |
| GET | `/api/regime/evaluations` | 정확도 평가 결과 |
| GET | `/api/regime/optimizer/status` | 옵티마이저 상태 |
