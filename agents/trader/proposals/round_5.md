# Round 5 Proposal: Tier 3 Enhancement (6건)

**Author**: Senior Quant Trader (T)
**Date**: 2026-02-15
**Sprint**: R5
**Topic**: Tier 3 Enhancement
**Status**: PROPOSED

---

## 분석 요약

Tier 3 Enhancement 6건에 대해 트레이딩 전문가 관점에서 소스 코드 레벨 분석을 완료했다. 핵심 발견은 다음과 같다:

1. **T3-3 (Exchange-side stop loss)** -- **가장 중요한 항목**. 현재 18개 전략 전체가 소프트웨어 기반 stop loss만 사용하고 있다. 모든 전략이 `onTick()` 내부에서 가격을 확인하고 SL 조건 충족 시 `CLOSE_LONG`/`CLOSE_SHORT` 시그널을 emit하는 방식이다. 이는 봇 프로세스 장애, 네트워크 단절, 틱 데이터 지연 시 SL이 실행되지 않는 치명적 리스크를 내포한다. Bitget REST API의 `presetStopLossPrice` 파라미터를 통한 exchange-side SL이 `exchangeClient.placeOrder()` / `orderManager._submitOrderInternal()`에 이미 배관(plumbing)되어 있으나, **어떤 전략도 이를 사용하지 않는다**.

2. **T3-6 (성과 귀인 대시보드)** -- 백엔드 API는 `by-strategy`와 `by-symbol` 두 엔드포인트를 이미 제공하고 있으나, 프론트엔드는 이를 전혀 소비하지 않는다. `useAnalytics.ts` 훅이 `getEquityCurve`와 `getSession`만 호출하며, `getByStrategy`/`getBySymbol`/`getDaily`는 호출하지 않는다. 백엔드 데이터도 기본 집계(trades, wins, losses, totalPnl, winRate)만 제공하며 profitFactor, Sharpe ratio, maxDrawdown 등 트레이더에게 핵심적인 지표가 전략별/심볼별로 제공되지 않는다.

3. **T3-1 (테스트 프레임워크)** -- 트레이딩 관점에서 가장 시급한 테스트 대상은 (1) RiskEngine 파이프라인 (CircuitBreaker + DrawdownMonitor + ExposureGuard), (2) 전략 시그널 생성 로직, (3) 포지션 사이징/qty resolution, (4) PnL 계산 정확성이다.

4. **T3-2 (API 인증)** -- 현재 모든 API가 인증 없이 노출되어 있어, 외부에서 `/api/bot/start`, `/api/trades/order` 등을 호출하면 실거래 주문이 바로 실행된다. 실거래 전환 전 반드시 구현 필요.

5. **T3-5 (Prometheus 메트릭)** -- 현재 운영 가시성이 로그 텍스트에만 의존한다. 봇 운영 시 latency, 주문 성공률, 전략별 시그널 빈도 등의 수치를 실시간으로 모니터링할 수 없다.

6. **T3-7 (Correlation ID)** -- 로그 추적이 현재 불가능하다. 하나의 전략 시그널이 SignalFilter -> OrderManager -> ExchangeClient -> WS handler를 거치는 과정에서 동일 요청을 연결할 수 있는 traceId가 없다.

---

## T3-3: Exchange-side Stop Loss (심층 분석)

### 현재 상태: 소프트웨어 SL만 존재

18개 전략 전체를 분석한 결과, **모든 stop loss가 `onTick()` 콜백 내부의 가격 비교로 구현**되어 있다:

```
[전략 예시: TurtleBreakout]
if (isLessThan(price, atrStopPrice)) {
    this._emitCloseSignal('long', price, 'atr_stop_loss', { ... });
}

[전략 예시: RsiPivot]
if (isLessThan(currentPrice, slPrice)) {
    this.emitSignal({ action: SIGNAL_ACTIONS.CLOSE_LONG, ... });
}

[전략 예시: BollingerReversion]
if (isLessThan(ticker.lastPrice, this._stopLoss)) {
    this.emitSignal({ action: SIGNAL_ACTIONS.CLOSE_LONG, reason: 'stop_loss' });
}
```

이 방식의 치명적 한계:

| 장애 시나리오 | 소프트웨어 SL | Exchange-side SL |
|---------------|:---:|:---:|
| 봇 프로세스 크래시 | SL 미실행 | 거래소가 자동 실행 |
| 네트워크 단절 | SL 미실행 | 거래소가 자동 실행 |
| 틱 데이터 지연 (500ms+) | 슬리피지 악화 | 거래소 내부 가격으로 즉시 실행 |
| 급격한 가격 변동 (Flash crash) | 갭 이후 늦은 실행 | 거래소가 최적 가격으로 실행 |
| 서버 OOM / CPU 100% | 이벤트 루프 블로킹으로 지연 | 영향 없음 |

### 기존 인프라: 이미 배관은 있다

**exchangeClient.placeOrder()** (line 195-247):
```javascript
if (takeProfitPrice !== undefined) orderParams.presetStopSurplusPrice = String(takeProfitPrice);
if (stopLossPrice !== undefined) orderParams.presetStopLossPrice = String(stopLossPrice);
```

**orderManager._submitOrderInternal()** (line 223-237):
```javascript
const { takeProfitPrice, stopLossPrice } = signal;
// ... 이후 orderParams에 포함
if (takeProfitPrice) orderParams.takeProfitPrice = takeProfitPrice;
if (stopLossPrice) orderParams.stopLossPrice = stopLossPrice;
```

즉, 전략이 시그널에 `stopLossPrice`를 포함하기만 하면, 현재 파이프라인이 이를 Bitget의 `presetStopLossPrice`로 자동 전달한다. **하지만 어떤 전략도 이 필드를 설정하지 않는다.**

### 제안 구현

#### Phase 1: 진입 시그널에 SL 가격 포함 (전략 수정)

각 전략의 `emitSignal()` 호출에 `stopLossPrice` 필드를 추가한다. 전략별 SL 계산 로직은 이미 `onTick()` 내부에 존재하므로, 이를 진입 시점에도 사전 계산하면 된다:

```javascript
// 예: TurtleBreakout OPEN_LONG 시그널
this.emitSignal({
    action: SIGNAL_ACTIONS.OPEN_LONG,
    symbol: this._symbol,
    suggestedQty: '3',
    suggestedPrice: price,
    stopLossPrice: math.subtract(price, math.multiply(atr, '2')),  // 2ATR SL
    takeProfitPrice: math.add(price, math.multiply(atr, '4')),     // 4ATR TP
    confidence: 0.75,
});
```

#### Phase 2: 소프트웨어 SL을 fallback으로 유지 (이중 안전망)

Exchange-side SL이 설정되더라도, 기존 `onTick()` 내의 소프트웨어 SL 로직을 제거하지 않는다. 이유:

1. Exchange-side SL은 simple trigger price만 지원 -- ATR trailing stop, 시간 기반 SL 등 복합 로직은 소프트웨어에서만 가능
2. Paper trading 모드에서는 exchange-side SL이 작동하지 않음
3. 이중 안전망 원칙: exchange가 먼저 실행하고, 봇이 나중에 확인 시 이미 포지션이 닫혔으면 skip

#### Phase 3: 독립 SL 주문 (Plan Order) -- 향후 고려

Bitget V3 API의 `futuresSubmitPlanOrder` (트리거 주문)를 사용하면 진입 주문과 별도로 SL 주문을 배치할 수 있다. 이는 `presetStopLossPrice`보다 유연하지만 구현 복잡도가 높다. **Round 5에서는 Phase 1 + Phase 2만 구현**하고, Plan Order는 후속 라운드에서 다룬다.

### 전략별 적합도 분석

| 전략 | SL 방식 | Exchange SL 적합도 | 비고 |
|------|---------|:---:|------|
| TurtleBreakout | ATR 기반 고정 SL | 높음 | 진입 시 ATR로 SL 사전 계산 가능 |
| RsiPivot | 고정 % SL | 높음 | `stopLossPct` 설정으로 즉시 계산 |
| MaTrend | ATR 기반 SL | 높음 | 진입 시 ATR 이미 계산됨 |
| BollingerReversion | 밴드 기반 SL | 중간 | 밴드 변동 시 SL 갱신 필요 |
| Supertrend | Supertrend line SL | 중간 | 트레일링 특성 -- exchange SL은 초기값만 |
| VwapReversion | VWAP 오프셋 SL | 중간 | VWAP 변동 시 갱신 필요 |
| QuietRangeScalp | 레인지 상하한 SL | 높음 | 레인지 진입 시 SL 확정 |
| SupportResistance | S/R 레벨 SL | 높음 | 레벨이 명확하므로 사전 설정 용이 |
| SwingStructure | 스윙 포인트 SL | 높음 | 이전 스윙 로우/하이가 SL |
| CandlePattern | 패턴 저점/고점 SL | 높음 | 패턴 완성 시 SL 확정 |
| FibonacciRetracement | 피보나치 레벨 SL | 높음 | 레벨이 사전 확정 |
| MacdDivergence | 고정 % SL | 높음 | `stopLossPct` 사용 |
| Breakout | 반대 밴드 SL | 중간 | 밴드 변동 시 갱신 필요 |
| AdaptiveRegime | ATR 기반 SL | 높음 | 진입 시 ATR 계산됨 |
| Grid | 그리드 레벨 SL | 낮음 | 그리드 전략은 SL 개념이 다름 |
| FundingRate | 고정 % SL | 높음 | 단순 계산 |

**결론**: 18개 중 11개 전략이 "높음", 5개가 "중간", 2개가 "낮음". Phase 1에서 "높음" 11개를 우선 구현하고, "중간" 5개는 초기 SL만 설정 + 소프트웨어 trailing으로 보완.

### 구현 난이도: 중간

- 파이프라인은 이미 완비 (exchangeClient, orderManager 모두 지원)
- 각 전략의 진입 시그널에 SL 가격 필드 추가만 하면 됨
- Paper trading 호환: `_submitPaperOrder()`도 이미 `stopLossPrice` 필드를 받음
- 예상 LOC: 전략당 3-5줄 추가 x 18전략 = ~70줄 + exchangeClient에 Plan Order 메서드 추가 ~30줄

### 예상 영향: 매우 높음

- 봇 장애 시 포지션 보호 -- 실거래에서의 최대 리스크 시나리오 제거
- 슬리피지 감소 -- 거래소 내부 매칭으로 더 나은 실행 가격
- 심리적 안정 -- 트레이더가 봇을 신뢰하고 떠날 수 있음 (24/7 운영 전제조건)

---

## T3-6: 성과 귀인 대시보드 (심층 분석)

### 현재 상태: 백엔드 있고 프론트엔드 없음

**백엔드 (analyticsRoutes.js)**:
- `GET /api/analytics/by-strategy/:sessionId` -- 전략별 통계
- `GET /api/analytics/by-symbol/:sessionId` -- 심볼별 통계
- `GET /api/analytics/daily/:sessionId` -- 일별 통계

**PerformanceTracker (performanceTracker.js)**가 제공하는 데이터:

```javascript
// getByStrategy / getBySymbol 반환 형태
{
    trades: number,
    wins: number,
    losses: number,
    totalPnl: string,
    winRate: string,   // 백분율
}
```

**프론트엔드 (useAnalytics.ts)**:
```typescript
// 현재 호출하는 것
const [curve, stats] = await Promise.all([
    analyticsApi.getEquityCurve(sessionId),    // 주식 곡선
    analyticsApi.getSession(sessionId),         // 세션 통계
]);

// API 클라이언트에 정의되어 있지만 호출하지 않는 것
analyticsApi.getByStrategy(sessionId)   // 미사용
analyticsApi.getBySymbol(sessionId)     // 미사용
analyticsApi.getDaily(sessionId)        // 미사용
```

### 문제 1: 백엔드 데이터가 부족하다

현재 `getByStrategy`/`getBySymbol`이 제공하는 지표는 초급 수준이다. 전문 트레이더가 성과를 분석하려면 다음이 필수:

| 현재 제공 | 추가 필요 | 중요도 |
|-----------|-----------|:---:|
| trades, wins, losses | -- | 기본 |
| totalPnl | avgPnl (건당 평균) | 높음 |
| winRate | -- | 기본 |
| -- | profitFactor (총이익/총손실) | 높음 |
| -- | avgWin / avgLoss | 높음 |
| -- | 기대수익 (expectancy = winRate * avgWin - lossRate * avgLoss) | 높음 |
| -- | maxDrawdown (전략별/심볼별) | 높음 |
| -- | avgHoldTime | 중간 |
| -- | largestWin / largestLoss | 중간 |
| -- | 수익 기여도 (전체 PnL 대비 %) | 높음 |
| -- | 전략 간 상관계수 | 높음 |

### 문제 2: 프론트엔드 시각화가 전무하다

대시보드 메인 페이지(`page.tsx`)에 equity curve만 표시되고 있다. 트레이더가 필요로 하는 시각화:

1. **전략별 수익 바 차트** -- 어떤 전략이 수익을 내고 있는지 한눈에
2. **전략별 수익 곡선 (오버레이)** -- 전략 간 성과 추이 비교
3. **심볼별 히트맵** -- 어떤 코인에서 돈을 벌고 있는지
4. **일별 PnL 바 차트** -- 수익/손실의 시계열 패턴
5. **전략-심볼 크로스탭 테이블** -- "어떤 전략이 어떤 코인에서 잘 작동하는가"
6. **수익 기여도 파이 차트** -- 전체 수익에서 각 전략의 기여 비율
7. **위험-수익 산점도 (Scatter)** -- X축: 변동성(또는 maxDD), Y축: 수익률 -- 전략별 점

### 제안 구현

#### 백엔드 확장

`PerformanceTracker.getByStrategy()`와 `getBySymbol()`을 확장하여 다음 필드 추가:

```javascript
// 확장된 반환 형태
{
    trades: number,
    wins: number,
    losses: number,
    totalPnl: string,
    winRate: string,
    avgPnl: string,           // totalPnl / trades
    profitFactor: string,      // |totalWinPnl| / |totalLossPnl|
    avgWin: string,
    avgLoss: string,
    expectancy: string,        // winRate * avgWin + (1 - winRate) * avgLoss
    largestWin: string,
    largestLoss: string,
    avgHoldTime: number,       // ms
    pnlContribution: string,   // 전체 PnL 대비 이 전략의 %
}
```

새 엔드포인트 추가:
```
GET /api/analytics/cross-tab/:sessionId     -- 전략 x 심볼 크로스탭
GET /api/analytics/strategy-correlation/:sessionId  -- 전략 간 일별 PnL 상관계수
```

#### 프론트엔드 신규 컴포넌트

1. `StrategyPerformanceTable` -- 전략별 성과 표 (정렬 가능)
2. `SymbolHeatmap` -- 심볼별 수익 히트맵
3. `DailyPnlChart` -- 일별 PnL 바 차트 (Recharts)
4. `PnlContributionPie` -- 수익 기여도 파이 차트 (Recharts)
5. `RiskReturnScatter` -- 위험-수익 산점도 (Recharts)
6. `StrategyEquityCurves` -- 전략별 누적 수익 곡선 (오버레이)

### 구현 난이도: 중간-높음

- 백엔드: `getByStrategy`/`getBySymbol` 확장 (~100줄), 새 엔드포인트 2개 (~80줄)
- 프론트엔드: 6개 컴포넌트 + 훅 확장 + 새 페이지 or 대시보드 탭 (~600줄)
- Recharts는 이미 의존성에 포함되어 있으므로 추가 설치 불필요

### 예상 영향: 높음

- 전략 포트폴리오 최적화의 기반 -- 데이터 없이는 의사결정 불가
- 저성과 전략 식별 -> 비활성화/파라미터 조정 판단 근거 제공
- 전략 간 상관관계 분석으로 진정한 다변화 달성 가능

---

## 나머지 T3 항목 트레이딩 관점 검토

### T3-1: 테스트 프레임워크 구축 (Jest/Vitest)

**트레이딩 관점 우선 테스트 대상 (중요도순)**:

1. **RiskEngine 파이프라인**: `validateOrder()` → CircuitBreaker → DrawdownMonitor → ExposureGuard 의 순차 검증이 모든 경계값에서 올바르게 작동하는지. 특히:
   - equity가 '0'일 때 reject (T0-6)
   - consecutive loss limit 도달 시 circuit break
   - maxDrawdownPercent 초과 시 halt
   - 포지션 크기 조정(adjustedQty) 로직

2. **Position sizing / qty resolution**: `BotService._resolveSignalQuantity()` 의 % → 절대값 변환. 경계값: equity=0, pct=0, price=0, 매우 작은 qty (floorToStep 이후 0)

3. **PnL 계산 정확성**: `OrderManager._handleOrderFilled()` 와 `PaperPositionManager.onFill()` 의 Long/Short PnL 계산. fee 차감 포함.

4. **전략 시그널 생성**: 각 전략의 `onTick()` / `onKline()` → `emitSignal()` 경로가 올바른 action, confidence, 가격을 생성하는지. 특히 edge case: 데이터 부족 시 null 반환, 비활성 상태에서 시그널 미생성.

5. **mathUtils 산술**: `add`, `subtract`, `multiply`, `divide`, `pctChange` 등의 정밀도. 특히 `divide('1', '3')` 같은 무한소수, 음수 처리, '0' 나누기.

**의견**: 테스트 프레임워크 자체는 인프라이므로 Engineer 주도가 적절하지만, **테스트 케이스 설계**는 내가 기여할 수 있다. 특히 RiskEngine과 전략 시그널 테스트의 시나리오는 트레이딩 도메인 지식이 필요하다.

### T3-2: API 인증/인가

**트레이딩 관점 핵심 우려**:

1. **현재 상태**: 모든 API 엔드포인트가 인증 없이 접근 가능. `POST /api/bot/start`, `POST /api/trades/order` 를 포함한 위험한 엔드포인트가 rate limiter만으로 보호됨.

2. **실거래 전환 시 필수**: `PAPER_TRADING=false`로 전환하면 `/api/trades/order`가 실제 거래소 주문을 실행한다. 인증 없이는 서버 포트가 노출되면 누구나 주문을 넣을 수 있다.

3. **API key 단계(1단계)만으로도 충분한 보호**:
   - `.env`에 `API_KEY` 설정 → `Authorization: Bearer <key>` 헤더 검증
   - 프론트엔드는 `.env.local`에서 키를 읽어 모든 요청에 첨부
   - 이것만으로도 외부 무단 접근을 차단 가능

4. **위험도 분류**:
   - Critical (반드시 인증): `/api/bot/start`, `/api/bot/stop`, `/api/bot/emergency-stop`, `/api/trades/order`, `/api/bot/risk-params`
   - High (인증 권장): `/api/paper/reset`, `/api/tournament/start|stop|reset`
   - Low (인증 선택): `/api/health/*`, `/api/analytics/*`, `/api/trades` (GET)

**의견**: 1단계 API key는 구현이 간단하고(미들웨어 하나), 효과가 크다. JWT(2단계)는 다중 사용자 시나리오에서 필요하지만, 현재 단일 사용자 구조에서는 API key로 충분.

### T3-5: Prometheus 메트릭/모니터링

**트레이딩 관점 핵심 메트릭**:

| 메트릭 이름 | 타입 | 설명 | 알림 기준 |
|-------------|------|------|-----------|
| `bot_order_latency_ms` | Histogram | 시그널→주문 제출 지연 | p99 > 500ms |
| `bot_order_success_total` | Counter | 성공 주문 수 | -- |
| `bot_order_fail_total` | Counter | 실패 주문 수 (거부/에러) | 연속 5건+ |
| `bot_strategy_signal_total` | Counter (label: strategy) | 전략별 시그널 수 | -- |
| `bot_strategy_pnl` | Gauge (label: strategy) | 전략별 누적 PnL | -- |
| `bot_risk_circuit_break_total` | Counter | 서킷 브레이커 발동 횟수 | 1시간 3회+ |
| `bot_risk_drawdown_percent` | Gauge | 현재 낙폭 비율 | > 8% |
| `bot_ws_reconnect_total` | Counter | WS 재연결 횟수 | 1시간 5회+ |
| `bot_equity` | Gauge | 현재 계좌 자산 | -- |
| `bot_position_count` | Gauge | 열린 포지션 수 | -- |
| `bot_exchange_api_latency_ms` | Histogram (label: method) | REST API 응답 시간 | p99 > 2s |

**의견**: `prom-client` 패키지로 `/metrics` 엔드포인트 노출이 표준 패턴. Grafana + AlertManager 연동은 운영 환경에서 추후 설정. 핵심은 메트릭 수집 포인트를 코드에 삽입하는 것이므로, exchangeClient._withRetry(), orderManager.submitOrder(), riskEngine.validateOrder() 에 계측 코드를 추가해야 한다.

### T3-7: Correlation ID (traceId) 전파

**트레이딩 관점 핵심 가치**:

현재 로그에서 "왜 이 주문이 거부되었는가?"를 추적하려면:
1. 전략 로그에서 시그널 생성 시점 찾기
2. SignalFilter 로그에서 동일 시점의 symbol/strategy 매칭
3. OrderManager 로그에서 동일 symbol의 submitOrder 찾기
4. RiskEngine 로그에서 동일 symbol의 reject 사유 찾기

이 과정이 **수동으로 4개 서비스의 로그를 시간 기준으로 대조**해야 한다. traceId가 있으면 `grep traceId:abc123`으로 전체 흐름을 즉시 확인할 수 있다.

**전파 경로**:
```
Strategy.emitSignal({ traceId })
→ BotService._handleStrategySignal({ traceId })
→ SignalFilter.filter({ traceId })
→ OrderManager.submitOrder({ traceId })
→ RiskEngine.validateOrder({ traceId })
→ ExchangeClient.placeOrder({ traceId })  // clientOid에 포함 가능
→ Trade document { traceId }
→ WS handler { traceId }  // clientOid로 역매핑
```

**의견**: 구현은 간단 -- `crypto.randomUUID()` 생성 후 시그널 객체에 포함, 이후 모든 함수 호출 체인에서 로그에 포함. 중요한 것은 **HTTP API 요청에서도 traceId를 받거나 생성**하여 `/api/trades/order` → OrderManager까지 연결하는 것.

---

## 제안 사항

### 우선순위 (트레이딩 관점)

| 순위 | ID | 제목 | 근거 |
|:---:|:---:|------|------|
| 1 | T3-3 | Exchange-side stop loss | 실거래 안전성의 핵심. 봇 장애 시 자산 보호. 이미 배관 완비. |
| 2 | T3-1 | 테스트 프레임워크 | 나머지 T3 항목의 품질 보증 기반. RiskEngine 테스트 필수. |
| 3 | T3-2 | API 인증 | 실거래 전환 전 차단 조건. 1단계 API key면 충분. |
| 4 | T3-6 | 성과 귀인 대시보드 | 전략 포트폴리오 최적화 데이터 기반. |
| 5 | T3-7 | Correlation ID | 장애 분석/디버깅 효율 10x 향상. |
| 6 | T3-5 | Prometheus 메트릭 | 운영 가시성. 다른 T3보다 긴급도는 낮음. |

### 구현 난이도 및 예상 작업량

| ID | 난이도 | 예상 LOC | 예상 시간 | 의존성 |
|:---:|:---:|:---:|:---:|------|
| T3-1 | 높음 | 1000+ | 3-4h | 없음 |
| T3-2 | 낮음 | 100-150 | 1h | 없음 |
| T3-3 | 중간 | 150-200 | 2h | 없음 |
| T3-5 | 중간 | 200-250 | 2h | npm install prom-client |
| T3-6 | 중간-높음 | 700-800 | 3-4h | 없음 (Recharts 이미 있음) |
| T3-7 | 낮음 | 80-120 | 1h | 없음 |

### 실행 계획 추천

```
Phase 1 (Track A+B 병행):
  T3-1 (테스트 프레임워크) — Engineer 주도, Trader가 테스트 케이스 리뷰
  T3-3 (Exchange SL) — Trader 주도, Engineer 리뷰

Phase 2 (Phase 1 완료 후):
  T3-2 (API 인증) — Engineer 주도
  T3-7 (Correlation ID) — Engineer 주도

Phase 3 (병행):
  T3-5 (Prometheus) — Engineer 주도
  T3-6 (성과 대시보드) — UI 주도, Trader가 지표/시각화 설계 제공
```

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **T3-1**: 테스트 프레임워크 선택 시 ESM/CJS 호환성 확인 필요. 백엔드는 CommonJS, 프론트엔드는 ESM. Jest의 CJS 지원이 더 안정적이므로 Jest 추천.

2. **T3-3**: `exchangeClient.placeOrder()`에서 `presetStopLossPrice`를 Bitget API에 전달하는 부분의 응답 형태 확인 필요. SL이 설정된 주문의 SL 체결 시 WS 이벤트가 어떤 형태로 오는지 (별도 fill 이벤트? 기존 order update에 포함?) SDK 문서 확인 요청.

3. **T3-3**: Paper trading에서 exchange-side SL을 시뮬레이션하려면 `PaperEngine`에 SL 트리거 로직 추가 필요. 현재 `PaperEngine.onTickerUpdate()`에서 pending limit orders만 확인하고 있음 -- SL/TP 트리거 주문도 여기서 확인하도록 확장 필요.

4. **T3-7**: traceId 생성 위치는 `StrategyBase.emitSignal()`이 적절. HTTP API에서 들어오는 수동 주문은 `tradeRoutes.js`의 `POST /order` 핸들러에서 생성. 두 경로 모두 `OrderManager.submitOrder()`에 traceId가 도달해야 함.

5. **T3-5**: Prometheus 메트릭 수집 포인트 목록 (위 표 참조). `exchangeClient._withRetry()`에 latency histogram을 삽입하는 것이 가장 비용 대비 효과가 높음.

### UI 에이전트에게

1. **T3-6**: 성과 귀인 대시보드의 시각화 컴포넌트 6개 제안 (위 목록 참조). 우선순위:
   - 1순위: `StrategyPerformanceTable` (정렬 가능한 표) + `DailyPnlChart` (바 차트)
   - 2순위: `PnlContributionPie` (파이) + `SymbolHeatmap` (히트맵)
   - 3순위: `RiskReturnScatter` (산점도) + `StrategyEquityCurves` (오버레이)

2. **T3-6**: 대시보드 레이아웃 제안:
   - 기존 메인 대시보드(`/`) 하단에 "성과 분석" 섹션 추가, 또는
   - 별도 `/analytics` 페이지 생성 (추천 -- 대시보드가 이미 복잡함)

3. **T3-6**: `useAnalytics.ts` 훅을 확장하여 `getByStrategy`, `getBySymbol`, `getDaily` 데이터도 fetch하도록. 현재는 equityCurve와 sessionStats만 가져옴.

4. **T3-6**: 반환 데이터의 Map 타입 처리 주의. 백엔드 `getByStrategy()`가 JavaScript `Map`을 반환하는데, `res.json()`으로 직렬화 시 빈 객체 `{}`가 됨. **Engineer에게 Object로 변환 필요** 알림.

---

## 핵심 리스크 및 주의사항

1. **T3-3 Exchange SL의 Paper Trading 호환성**: Paper mode에서 `presetStopLossPrice`는 Bitget API를 호출하지 않으므로, PaperEngine에서 SL 트리거를 시뮬레이션해야 한다. 이것이 누락되면 Paper와 Live의 행동이 달라진다.

2. **T3-6 Map 직렬화 버그**: `PerformanceTracker.getByStrategy()` / `getBySymbol()`이 `Map`을 반환하는데, Express의 `res.json()`은 `Map`을 빈 객체로 직렬화한다. 이 버그를 **T3-6 구현 전에** 수정해야 한다. (`Object.fromEntries(map)`으로 변환)

3. **T3-3 SL 가격의 정밀도**: Bitget은 심볼별로 가격 정밀도(tick size)가 다르다. SL 가격도 이 정밀도를 준수해야 주문이 거부되지 않는다. 현재 `instruments` 정보를 캐싱하지 않으므로, SL 가격을 설정할 때 tick size 라운딩이 필요하다.

4. **T3-1 테스트에서 MongoDB 의존성**: 현재 Trade, Signal, BotSession 등이 Mongoose 모델이므로, 유닛 테스트 시 MongoDB 연결이 필요한 모듈과 순수 로직 모듈을 분리해야 한다. `mongodb-memory-server`나 모킹 전략 필요.
