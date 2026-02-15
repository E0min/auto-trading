# Round 4 Proposal: Tier 2 Quality (12건)

**Author**: Senior Quant Trader (T)
**Date**: 2026-02-15
**Sprint**: R4
**Topic**: Tier 2 Quality
**Status**: PROPOSED

---

## 분석 요약

Tier 2 Quality 12건에 대한 트레이딩 전문가 관점의 코드 레벨 분석을 완료했다. 핵심 발견은 다음과 같다:

1. **T2-1 (RSI Wilder smoothing)** — 현재 RSI는 단순 평균(SMA) 기반으로 구현되어 있어, 업계 표준인 Wilder의 지수 평활(EMA-like smoothing)을 사용하지 않는다. 이로 인해 RSI 값이 실제보다 덜 부드럽고 과민하게 반응하며, 5개 전략이 영향을 받는다.

2. **T2-2 (Confidence filtering)** — SignalFilter에 confidence 기반 필터링이 전혀 없다. 현재 4가지 필터(cooldown, duplicate, max concurrent, symbol conflict)만 존재하며, 모든 전략이 confidence 값을 생성하지만 아무도 이를 필터 기준으로 사용하지 않는다.

3. **T2-3 (Backtest position size)** — BacktestEngine이 모든 전략에 고정 95% 포지션 사이징을 적용한다. 전략별 메타데이터에 `positionSizePercent`가 이미 정의된 경우가 많지만(BreakoutStrategy: 4%, QuietRangeScalp: 3%, FundingRate: 5% 등) 백테스트가 이를 무시한다.

4. **T2-4 (FundingRate 데이터)** — **가장 심각한 문제**. FundingRateStrategy는 ticker에서 `fundingRate`와 `openInterest` 필드를 읽지만, tickerAggregator/marketData/botService 어디에서도 이 데이터를 ticker에 주입하지 않는다. 즉, 이 전략은 현재 **영원히 시그널을 생성할 수 없다**.

5. **T2-5 (Grid equity)** — GridStrategy의 `_calculatePerLevelQty()`가 `this.config.equity`를 읽지만, 이 값은 어디에서도 주입되지 않아 항상 `'0'`이다. 모든 그리드 주문의 수량이 `'0'`으로 나가며, 이후 RiskEngine이나 OrderManager에서 거부되거나 무시된다.

6. **T2-9 (CircuitBreaker rapidLosses)** — `rapidLosses` 배열이 `recordTrade()` 시 추가만 되고, `reset()` 시에만 전체 삭제된다. 장기 운영 시 메모리 누수 패턴이다.

---

## 발견 사항

### T2-1: RSI Wilder Smoothing 구현

**파일**: `backend/src/utils/indicators.js` (line 130-155)

**현재 상태**:
```javascript
// Line 130-155: 현재 RSI 구현
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const startIdx = prices.length - period - 1;
  let sumGain = '0';
  let sumLoss = '0';
  for (let i = startIdx; i < prices.length - 1; i++) {
    const diff = subtract(prices[i + 1], prices[i]);
    if (isGreaterThan(diff, '0')) {
      sumGain = add(sumGain, diff);
    } else if (isLessThan(diff, '0')) {
      sumLoss = add(sumLoss, abs(diff));
    }
  }
  const avgGain = divide(sumGain, String(period));
  const avgLoss = divide(sumLoss, String(period));
  ...
}
```

**문제점**:
- 이 구현은 **Cutler's RSI** (SMA 기반)이다. 매번 마지막 `period+1`개의 가격만 사용한다.
- Wilder's RSI는 이전 avgGain/avgLoss를 지수적으로 평활한다: `avgGain = (prevAvgGain * (period-1) + currentGain) / period`
- Cutler's RSI는 동일한 입력에서 Wilder's RSI보다 더 변동성이 크다.
- 이 차이는 RSI가 30/70 경계에 있을 때 가장 크다 — 정확히 진입/퇴출 결정이 이루어지는 영역이다.

**영향 범위** (5개 전략):
- `RsiPivotStrategy` — RSI 30/70 크로스오버 진입
- `BollingerReversionStrategy` — RSI 25/75 확인 필터
- `MacdDivergenceStrategy` — RSI 오버솔드/오버바이 확인
- `VwapReversionStrategy` — RSI 35/65 트리거
- `AdaptiveRegimeStrategy` — RSI 레짐 판단

**트레이딩 임팩트**: **높음**
- Wilder smoothing 없이는 RSI가 과도하게 진동하여 false signal 빈도가 높아진다.
- 특히 1분/5분 차트에서 차이가 극대화된다.
- 업계 TradingView, Bloomberg Terminal 등 모든 표준 도구가 Wilder 방식을 사용한다. 백테스트 결과를 외부 데이터와 비교할 때 불일치가 발생한다.

**제안**:
```javascript
// 새로운 rsi 함수 시그니처
function rsi(prices, period = 14, { smoothing = 'wilder' } = {}) {
  // smoothing === 'sma': 기존 Cutler's RSI (하위 호환)
  // smoothing === 'wilder': Wilder's 지수 평활 (새 기본값)
}
```

구현 전략:
1. 첫 `period` 개 변화에서 SMA로 초기 avgGain/avgLoss 씨드
2. 이후 각 가격에 대해 Wilder 평활 적용: `avgGain = (prevAvgGain * (period-1) + gain) / period`
3. 전체 prices 배열을 순회하여 최종 RSI 반환
4. `smoothing` 파라미터로 'wilder' (기본) vs 'sma' 선택 가능
5. IndicatorCache의 `computeIndicator()`에서 params.smoothing 전달

**구현 난이도**: 낮음 (함수 내부 변경만)
**위험도**: 중간 (기존 전략의 RSI 값이 달라지므로 백테스트 결과 변화)
**우선순위**: P1 (매매 품질 직접 영향)

---

### T2-2: Confidence-based Signal Filtering

**파일**: `backend/src/services/signalFilter.js`

**현재 상태**:
- `filter()` 메서드에서 4가지 필터만 적용: cooldown, duplicate, maxConcurrent, symbolConflict
- `signal.confidence` 필드는 모든 전략이 0.50~0.95 범위로 생성하지만, 필터 체인에서 완전히 무시된다
- 즉, confidence 0.50인 시그널도 confidence 0.95인 시그널과 동일하게 통과한다

**전략별 confidence 범위 분석**:
| 전략 | Base | 최소 | 최대 | 비고 |
|------|------|------|------|------|
| CandlePatternStrategy | 0.55 | 0.55 | 1.00 | 패턴 타입 + 레짐 보너스 |
| FundingRateStrategy | 0.50 | 0.50 | 0.95 | 펀딩비 극단성 + OI + 레짐 |
| GridStrategy | 고정 | 0.70 | 0.70 | 고정값 |
| AdaptiveRegimeStrategy | 0.55 | 0.45 | 0.90 | ADX + RSI 조합 |
| SwingStructureStrategy | 0.55 | 0.55 | 0.95 | 구조 선명도 + 레짐 |
| SupportResistanceStrategy | 0.55 | 0.55 | 0.95 | 터치 횟수 + 강도 |

**문제점**:
- 낮은 confidence 시그널이 무분별하게 주문으로 변환되어 기대수익이 낮은 거래가 다수 실행됨
- 특히 AdaptiveRegimeStrategy에서 confidence 0.45까지 내려가는 경우가 있음
- Sharpe ratio 개선의 가장 효과적인 경로: 저질 시그널 제거

**제안**:

`signalFilter.js`에 Filter 5로 confidence threshold 추가:

```javascript
// registerStrategy() 확장
registerStrategy(name, meta = {}) {
  this._strategyMeta.set(name, {
    cooldownMs: meta.cooldownMs || DEFAULT_COOLDOWN_MS,
    maxConcurrentPositions: meta.maxConcurrentPositions || DEFAULT_MAX_CONCURRENT,
    minConfidence: meta.minConfidence || DEFAULT_MIN_CONFIDENCE,  // NEW: 0.55 기본
  });
}

// filter() 내 새로운 체크 추가
_checkConfidence(strategy, confidence) {
  const meta = this._strategyMeta.get(strategy);
  const minConfidence = meta ? meta.minConfidence : DEFAULT_MIN_CONFIDENCE;
  const confidenceNum = parseFloat(confidence);
  if (isNaN(confidenceNum) || confidenceNum < minConfidence) {
    return {
      passed: false,
      reason: `confidence_too_low: ${confidence} < ${minConfidence} for ${strategy}`,
    };
  }
  return { passed: true, reason: null };
}
```

**전략별 권장 임계값**:
| riskLevel | minConfidence | 근거 |
|-----------|---------------|------|
| low | 0.50 | 보수적 전략은 빈도 유지 |
| medium | 0.55 | 적절한 필터링 |
| high | 0.60 | 고위험 전략은 높은 확신 시에만 |

metadata에 `minConfidence` 필드를 추가하거나, `riskLevel` 기반으로 자동 매핑.

**구현 난이도**: 낮음
**위험도**: 낮음 (기존 필터에 추가만)
**우선순위**: P1 (Sharpe 개선 직접 경로)

---

### T2-3: Backtest Position Size 전략 메타 기반

**파일**: `backend/src/backtest/backtestEngine.js` (line 37, 492, 555)

**현재 상태**:
```javascript
// Line 37
const DEFAULT_POSITION_SIZE_PCT = '95';

// Line 492 (_openLong)
const positionValue = math.multiply(this._cash, math.divide(DEFAULT_POSITION_SIZE_PCT, '100'));

// Line 555 (_openShort) — 동일한 95%
```

**문제점**:
- 모든 전략이 95%로 동일하게 백테스트됨
- 실제 운영에서 FundingRateStrategy는 5%, GridStrategy는 20% (totalBudgetPercent), BreakoutStrategy는 4%를 사용
- **95% 포지션으로 백테스트 → 실제 4% 포지션으로 운영** = 백테스트 결과가 현실과 완전히 괴리
- PnL, 최대 낙폭, Sharpe 등 모든 메트릭이 왜곡됨
- 이것은 **과적합의 온상**: 95% 포지션에서 좋아 보이는 전략이 실제 포지션 크기에서는 수수료에 먹혀 수익성이 없을 수 있음

**전략 메타데이터별 실제 포지션 크기**:
| 전략 | 메타데이터 키 | 값 | 유형 |
|------|-------------|------|------|
| BreakoutStrategy | positionSizePercent | 4% | equity % |
| QuietRangeScalp | positionSizePercent | 3% | equity % |
| FundingRateStrategy | positionSizePercent | 5% | equity % |
| GridStrategy | totalBudgetPercent | 20% (/ 20 levels) | equity % / levels |
| TurtleBreakoutStrategy | - (ATR 기반) | 동적 | 없음 (계산 필요) |
| 나머지 | - | 없음 | 기본값 필요 |

**제안**:

```javascript
// BacktestEngine._createStrategy() 직후에 position size 결정
_getPositionSizePct() {
  const metadata = registry.getMetadata(this.strategyName);
  const dc = metadata?.defaultConfig || {};

  // 1순위: 전략 메타의 positionSizePercent
  if (dc.positionSizePercent) return dc.positionSizePercent;

  // 2순위: riskLevel 기반 기본값
  const riskDefaults = {
    low: '10',      // 보수적
    medium: '15',   // 중간
    high: '8',      // 공격적이지만 작은 포지션 (손실 제한)
  };
  if (metadata?.riskLevel) return riskDefaults[metadata.riskLevel] || '15';

  // 3순위: 전역 기본값 (레거시 호환)
  return DEFAULT_POSITION_SIZE_PCT;
}
```

- 기존 `DEFAULT_POSITION_SIZE_PCT = '95'`는 fallback으로 유지하되, 전략 메타데이터가 있으면 그것을 우선 사용
- `constructor`에서 `opts.positionSizePct`로 사용자 오버라이드도 허용

**구현 난이도**: 낮음
**위험도**: 중간 (기존 백테스트 결과와 비교 불가해짐 — 이전 결과 기록 필요)
**우선순위**: P1 (백테스트 신뢰성 핵심)

---

### T2-4: FundingRateStrategy 데이터 소스 구축

**파일**:
- `backend/src/strategies/indicator-light/fundingRateStrategy.js` (line 125-167)
- `backend/src/services/exchangeClient.js` (line 485-497)
- `backend/src/services/coinSelector.js` (line 425-449)

**현재 상태**:

**데이터 소비자 (전략 측)**:
```javascript
// fundingRateStrategy.js line 134
if (ticker.fundingRate !== undefined && ticker.fundingRate !== null) {
  this._fundingRateHistory.push({ rate: String(ticker.fundingRate), timestamp: new Date() });
}
// line 152
if (ticker.openInterest !== undefined && ticker.openInterest !== null) {
  this._oiHistory.push({ oi: String(ticker.openInterest), timestamp: new Date() });
}
```

**데이터 공급자 (인프라 측)**:
- `exchangeClient.getFundingRate()` 존재함 (REST API 호출)
- `coinSelector._enrichSymbol()` 에서 funding rate를 가져오지만, 이 데이터는 코인 선정에만 사용되고 전략에 전달되지 않음
- `tickerAggregator`, `marketData`, `botService` 모두 funding rate를 ticker에 포함시키지 않음
- WebSocket public topic에도 funding rate 구독이 없음

**결론**: FundingRateStrategy는 **완전히 비활성 상태** (dead code)이다.

**제안**: REST polling 기반 데이터 파이프라인 구축

```
                   8시간 주기 (또는 5분 polling)
ExchangeClient ──────────────────────────────────────►  FundingDataService
(getFundingRate)                                          │
(getOpenInterest)                                         │ MARKET_EVENTS.FUNDING_UPDATE
                                                          │
                                                          ▼
                                               BotService/StrategyRouter
                                                          │
                                                          ▼
                                               FundingRateStrategy.onFundingUpdate()
```

구체적 구현 계획:

1. **새 서비스 `fundingDataService.js`** (또는 `marketData.js` 확장):
   - 활성 심볼 목록에 대해 5분 간격으로 REST polling
   - `exchangeClient.getFundingRate()` 및 `getOpenInterest()` 호출
   - `MARKET_EVENTS.FUNDING_UPDATE` 이벤트 emit: `{ symbol, fundingRate, nextSettlement, openInterest }`

2. **전략 인터페이스 확장**:
   - `StrategyBase`에 `onFundingUpdate(data)` 메서드 추가 (기본 no-op)
   - FundingRateStrategy에서 오버라이드하여 `_fundingRateHistory`와 `_oiHistory` 업데이트

3. **BotService/StrategyRouter 통합**:
   - FUNDING_UPDATE 이벤트를 FundingRateStrategy에 라우팅

4. **Bitget 펀딩비 주기**:
   - Bitget USDT-Futures는 8시간마다 펀딩 정산 (00:00, 08:00, 16:00 UTC)
   - 폴링 주기: 5분 (rate limit 부담 적음, 실시간성 불필요)
   - 정산 10분 전~후에는 1분 간격으로 밀도 상향 가능 (선택)

**대안 분석**: WebSocket 기반 vs REST polling
- Bitget public WS에 `ticker` topic이 funding rate를 포함하지만 **실시간 갱신 빈도가 불명확**
- REST polling이 더 안정적이고 데이터 정확성이 보장됨
- 추천: REST polling 기반 + 향후 WS 보강 가능

**구현 난이도**: 중간
**위험도**: 낮음 (새 모듈 추가, 기존 코드 변경 최소)
**우선순위**: P0 (전략이 완전 비활성 — 즉시 수정 필요)

---

### T2-5: GridStrategy Equity 주입

**파일**: `backend/src/strategies/indicator-light/gridStrategy.js` (line 508-521)

**현재 상태**:
```javascript
// Line 508-521
_calculatePerLevelQty(price) {
  const equity = this.config.equity || '0';  // ← 항상 '0'
  if (equity === '0' || !price || price === '0') {
    return '0';  // ← 항상 이 경로 실행
  }
  // ... 아래 코드 도달 불가
}
```

**문제점**:
- `this.config`는 생성자에서 `{ ...GridStrategy.metadata.defaultConfig, ...config }`로 설정됨
- defaultConfig에 `equity` 필드가 없음
- BotService에서 전략 생성 시 equity를 config에 주입하는 코드 없음
- 결과: 모든 그리드 주문의 suggestedQty가 `'0'`
- OrderManager/RiskEngine이 qty 0을 거부할 가능성 높음

**추가 문제**: equity는 시간에 따라 변동하는데, 생성자에서 고정값으로 주입하면 stale 데이터 사용

**제안**: DI Context 패턴

1. `StrategyBase`에 `_accountContext` 필드 추가:
```javascript
// strategyBase.js
setAccountContext(context) {
  this._accountContext = context;  // { getEquity: () => string }
}
getEquity() {
  if (this._accountContext && typeof this._accountContext.getEquity === 'function') {
    return this._accountContext.getEquity();
  }
  return this.config.equity || '0';
}
```

2. `BotService`에서 전략 생성 시 context 주입:
```javascript
// botService 내부
strategy.setAccountContext({
  getEquity: () => this.riskEngine.accountState.equity,
});
```

3. `GridStrategy._calculatePerLevelQty()` 수정:
```javascript
_calculatePerLevelQty(price) {
  const equity = this.getEquity();  // DI 컨텍스트 사용
  if (equity === '0' || !price || price === '0') return '0';
  // ... 기존 계산 로직
}
```

**장점**:
- 실시간 equity 값 반영 (stale 문제 해결)
- 다른 전략도 동일 패턴으로 equity 접근 가능
- StrategyBase 레벨에서 해결하므로 향후 확장 용이

**백테스트 호환성**:
- BacktestEngine에서도 `setAccountContext({ getEquity: () => this._cash })` 주입 필요

**구현 난이도**: 중간
**위험도**: 중간 (StrategyBase 변경은 전 전략에 영향)
**우선순위**: P0 (GridStrategy 완전 비활성 — 즉시 수정 필요)

---

### T2-7: API Rate Limiting

**트레이딩 관점 의견**:

- API rate limiting은 인프라 항목이지만, **트레이딩 시스템에서는 DDoS보다 자체 버그가 더 위험**
- 프론트엔드 폴링이 3~30초 간격으로 작동하므로, 오작동 시 초당 수십 건의 요청이 백엔드를 압도할 수 있음
- 특히 `/api/bot/status`와 `/api/trades/positions`는 exchangeClient를 통해 Bitget API를 호출할 수 있어, **내부 rate limit 초과 → Bitget 429 에러 → 주문 실패** 체인이 발생 가능

**권장 설정**:
| 엔드포인트 | Window | Max Requests | 근거 |
|------------|--------|-------------|------|
| `/api/bot/*` | 1분 | 60 | 상태 폴링 빈도 고려 |
| `/api/trades/order` (POST) | 1분 | 10 | 수동 주문 제한 |
| `/api/backtest/run` (POST) | 1분 | 3 | CPU 집약적 |
| 기타 | 1분 | 120 | 일반적 보호 |

**구현 난이도**: 낮음 (express-rate-limit 패키지)
**우선순위**: P2 (안전 보강)

---

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한

**파일**: `backend/src/services/circuitBreaker.js` (line 45, 60)

**현재 상태**:
```javascript
// Line 45
this.rapidLosses = []; // Array of timestamps (ms)

// Line 60 (recordTrade)
this.rapidLosses.push(Date.now());  // 추가만 함

// Line 78 (rapidLossWindow 체크)
const recentLosses = this.rapidLosses.filter((ts) => ts >= cutoff);
// ← filter는 배열 변형 없이 새 배열 반환. 원본은 계속 성장.
```

**문제점**:
- `rapidLosses` 배열은 손실 거래마다 timestamp를 추가하지만, 오래된 항목을 제거하지 않음
- `reset()` (line 152)에서만 전체 초기화
- 봇이 한 달간 연속 운영되면서 1000건의 손실이 발생하면 → 1000개 항목 축적
- `filter()` 호출 시 매번 전체 배열 순회 (O(n))

**실제 영향 추정**:
- 하루 평균 50건 거래, 40% 손실 → 20건/일 → 600건/월
- 메모리: 8바이트 x 600 = 4.8KB (미미하지만 원칙의 문제)
- 성능: `filter()` O(600)은 무시할 수준이지만, 1년이면 7,300건

**제안**: `recordTrade()` 내에서 window 외 항목 정리

```javascript
recordTrade(trade) {
  if (isLessThan(trade.pnl, '0')) {
    this.consecutiveLosses += 1;
    this.rapidLosses.push(Date.now());

    // Prune entries older than 2x window (generous margin)
    const pruneThreshold = Date.now() - this.params.rapidLossWindow * 60 * 1000 * 2;
    if (this.rapidLosses.length > 100) {  // 빈번한 정리 방지
      this.rapidLosses = this.rapidLosses.filter(ts => ts >= pruneThreshold);
    }
    // ... 기존 로직
  }
}
```

**구현 난이도**: 매우 낮음
**위험도**: 없음
**우선순위**: P3 (미미한 영향이지만 코드 위생 차원)

---

## Frontend 항목 트레이딩 UX 리뷰

### T2-6: useSocket 목적별 분리

**파일**: `frontend/src/hooks/useSocket.ts`

**현재 상태**: 단일 `useSocket()` 훅이 13개 이벤트를 구독하고, 하나의 거대한 `SocketState` 객체를 관리한다.

**트레이딩 UX 관점**:
- 모든 컴포넌트가 전체 SocketState를 구독하면, ticker 업데이트(수 밀리초 간격)가 SignalFeed 리렌더를 유발
- **틱 데이터 래그**는 포지션 관리 UI에서 치명적: 트레이더가 보는 가격이 200ms 지연되면 의사결정에 영향
- 분리 추천: `useTickerSocket()`, `useSignalSocket()`, `useRiskSocket()`, `useRegimeSocket()`

**우선순위**: P2 (UX 성능)

### T2-8: SignalFeed rejectReason 표시

**파일**: `frontend/src/components/SignalFeed.tsx`

**현재 상태**:
```tsx
// Line 46-49: 승인/거부만 표시, 거부 사유 미표시
{signal.riskApproved !== null && (
  <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
    {signal.riskApproved ? '승인' : '거부'}
  </Badge>
)}
```

**트레이딩 UX 관점**:
- 거부 사유를 모르면 트레이더가 왜 시그널이 거절됐는지 파악할 수 없음
- 특히 `circuit_breaker_active`, `exposure_limit`, `confidence_too_low` 등은 즉각적인 대응이 필요한 정보
- `Signal` 타입에 이미 `rejectReason: string | null` 필드가 존재 (types/index.ts line 117)

**제안**: 거부 시 tooltip 또는 확장 영역에 rejectReason 표시
```tsx
{signal.riskApproved === false && signal.rejectReason && (
  <span className="text-xs text-red-400/70 ml-1" title={signal.rejectReason}>
    ({translateRejectReason(signal.rejectReason)})
  </span>
)}
```

**우선순위**: P2 (디버깅/모니터링 필수)

### T2-10: Drawdown 시각화 차트

**트레이딩 UX 관점**:
- 드로다운 차트는 **포트폴리오 건강도의 핵심 시각지표**
- equity curve만으로는 최대 낙폭의 심각성을 직관적으로 파악하기 어렵
- 필요한 데이터: `equityCurve` + peak tracking → drawdown % 실시간 계산
- Recharts `AreaChart`로 수중곡선(underwater equity curve) 구현 추천

**구현 데이터 소스**: `/api/analytics/equity-curve/:sessionId` 에서 equity 배열 → 프론트엔드에서 drawdown 계산

**우선순위**: P2 (리스크 시각화)

### T2-11: Risk Gauge 대시보드

**트레이딩 UX 관점**:
- 현재 `RiskStatusPanel.tsx`가 텍스트 기반으로 리스크 상태를 표시
- 게이지 형태 시각화는 **한 눈에 위험도 파악**에 효과적
- 3개 게이지 추천: Drawdown %, Exposure %, Circuit Breaker 상태
- 색상 코딩: 초록(0-50%) → 노랑(50-80%) → 빨강(80-100%)

**우선순위**: P3 (나이스투해브)

### T2-12: 적응형 폴링

**파일**: `frontend/src/hooks/useBotStatus.ts` (line 22, 40-42)

**현재 상태**:
```typescript
export function useBotStatus(pollInterval = 5000) {
  // ...
  const interval = setInterval(fetchStatus, pollInterval);
}
```

**트레이딩 UX 관점**:
- 봇이 idle 상태일 때 5초 폴링은 불필요한 서버 부하
- 봇이 활발히 거래 중일 때 5초는 너무 느릴 수 있음

**제안 폴링 간격**:
| 봇 상태 | 간격 | 근거 |
|---------|------|------|
| idle | 30초 | 변화 없음 |
| running (포지션 있음) | 3초 | 실시간 모니터링 필요 |
| running (포지션 없음) | 10초 | 시그널 대기 중 |
| paused | 15초 | 중간 빈도 |
| error | 5초 | 복구 상태 확인 |

**우선순위**: P2 (서버 부하 감소 + 반응성 개선)

---

## 제안 사항 (우선순위, 구현 난이도, 구현 가이드)

### 우선순위 매트릭스

| 항목 | 우선순위 | 난이도 | 트레이딩 임팩트 | 의존성 |
|------|---------|--------|---------------|--------|
| **T2-4** | **P0** | 중간 | 전략 비활성 해제 | 없음 |
| **T2-5** | **P0** | 중간 | 전략 비활성 해제 | 없음 |
| **T2-1** | **P1** | 낮음 | RSI 품질 개선 | 없음 |
| **T2-3** | **P1** | 낮음 | 백테스트 신뢰성 | 없음 |
| **T2-2** | **P1** | 낮음 | Sharpe 개선 | 없음 |
| T2-8 | P2 | 낮음 | 디버깅 효율 | 없음 |
| T2-12 | P2 | 낮음 | 서버 부하 | 없음 |
| T2-6 | P2 | 중간 | UX 성능 | 없음 |
| T2-10 | P2 | 중간 | 리스크 시각화 | 없음 |
| T2-7 | P2 | 낮음 | 안전 보강 | 없음 |
| T2-9 | P3 | 매우 낮음 | 코드 위생 | 없음 |
| T2-11 | P3 | 중간 | 나이스투해브 | 없음 |

### 구현 순서 추천

**Phase 1 (Critical — 비활성 전략 복구)**:
1. T2-5: GridStrategy equity DI context
2. T2-4: FundingRateStrategy 데이터 파이프라인

**Phase 2 (Core Quality — 매매 품질)**:
3. T2-1: RSI Wilder smoothing
4. T2-3: Backtest position size 메타 기반
5. T2-2: Confidence signal filtering

**Phase 3 (UX & Safety)**:
6. T2-8: SignalFeed rejectReason
7. T2-12: 적응형 폴링
8. T2-7: API rate limiting
9. T2-9: CircuitBreaker rapidLosses 정리
10. T2-6: useSocket 분리
11. T2-10: Drawdown 차트
12. T2-11: Risk Gauge

---

## 다른 에이전트에게 요청 사항

### Engineer (E)에게

1. **T2-4 구현 시 `fundingDataService.js` 새 모듈 생성 요청**:
   - `exchangeClient.getFundingRate()` + `getOpenInterest()` REST polling
   - 5분 간격 기본, configurable
   - `MARKET_EVENTS.FUNDING_UPDATE` 이벤트 emit
   - DI 순서: `exchangeClient → fundingDataService` (coinSelector와 유사 레벨)
   - `app.js` bootstrap에 추가

2. **T2-5 구현 시 `strategyBase.js` 확장 요청**:
   - `setAccountContext(ctx)` / `getEquity()` 메서드 추가
   - `botService.js`에서 전략 생성 시 context 주입
   - `BacktestEngine._createStrategy()`에서도 동일 패턴 적용

3. **T2-1 구현 시 indicators.js `rsi()` 리팩토링**:
   - `smoothing` 파라미터 추가 ('wilder' | 'sma')
   - 기본값: 'wilder' (breaking change — 의도적)
   - indicatorCache의 `computeIndicator()` case 'rsi'에서 params.smoothing 전달

4. **T2-3 구현 시 BacktestEngine 수정**:
   - `_getPositionSizePct()` 메서드 추가
   - registry에서 전략 메타데이터 읽어 positionSizePercent 결정
   - `_openLong()`, `_openShort()`에서 사용

5. **T2-2 구현 시 signalFilter.js 확장**:
   - `_checkConfidence()` 메서드 추가
   - `registerStrategy()` 시 `minConfidence` 파라미터 수용
   - `filter()` 체인의 Filter 5로 추가 (symbolConflict 이후)

6. **T2-9**: `circuitBreaker.js`의 `recordTrade()` 내 `rapidLosses` 정리 코드 추가 (5줄)

7. **T2-7**: `express-rate-limit` 설치 + 미들웨어 설정

### UI (U)에게

1. **T2-8**: `SignalFeed.tsx`에 `rejectReason` 표시 추가
   - `lib/utils.ts`에 `translateRejectReason()` 번역 함수 추가
   - 리스크 거부 사유: `circuit_breaker_active` → "서킷 브레이커", `exposure_limit` → "노출 한도 초과", `confidence_too_low` → "신뢰도 부족" 등

2. **T2-12**: `useBotStatus.ts` 적응형 폴링 구현
   - 봇 상태에 따른 동적 interval 변경

3. **T2-6**: `useSocket.ts` 목적별 분리
   - 4개 훅으로 분리: tickers, signals, risk, regime
   - 기존 useSocket은 compose 패턴으로 하위 호환 유지

4. **T2-10**: Drawdown 수중곡선 차트 컴포넌트
   - `components/DrawdownChart.tsx` 신규 생성
   - Recharts AreaChart, 음수 영역 빨간색 채우기

5. **T2-11**: Risk Gauge 컴포넌트
   - `components/RiskGauge.tsx` 신규 생성
   - 3개 원형 게이지 (Drawdown, Exposure, Circuit Breaker)

### 공통 요청

- T2-4, T2-5는 **전략이 완전히 비활성**인 상태이므로 최우선 처리 필요
- T2-1 (RSI Wilder) 변경 후 기존 백테스트 결과와 비교하여 임팩트 측정 필요
- 모든 backend 변경은 `constants.js`에 새 이벤트/파라미터 추가 시 프론트엔드 타입과 동기화 필요

---

## Architecture Decisions 제안

### AD-18: Funding Data Service Polling Pattern
- FundingRateStrategy에 데이터를 공급하기 위해 REST polling 기반 `fundingDataService`를 도입한다.
- WebSocket 대신 REST polling을 선택한 이유: Bitget의 funding rate WS topic 갱신 빈도가 불명확하고, REST는 데이터 정확성이 보장된다.
- 5분 기본 polling 간격.

### AD-19: Strategy Account Context DI
- 전략이 실시간 equity를 접근하기 위해 `setAccountContext()` DI 패턴을 도입한다.
- `config.equity` 정적 값 대신, `getEquity()` 콜백으로 항상 최신 값을 반환한다.
- StrategyBase 레벨에서 구현하여 모든 전략이 동일 패턴 사용.

### AD-20: RSI Default Smoothing
- RSI 기본 smoothing을 'wilder'로 변경한다 (기존 'sma').
- 이는 **의도적 breaking change**이며, 기존 백테스트 결과와 달라질 수 있다.
- 'sma' 옵션은 하위 호환을 위해 유지.
