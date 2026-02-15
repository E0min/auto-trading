# Round 4 Review — Tier 2 Quality (Trader Review)

**Author**: Senior Quant Trader (T)
**Date**: 2026-02-15
**Review Target**: Engineer Round 4 Proposal + UI/UX Round 4 Proposal
**Perspective**: 트레이딩/수익 극대화, 리스크 관리, 실거래 안정성

---

## Engineer 제안서 리뷰

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한

**판정: ⚠️ 조건부 동의**

Engineer의 진단은 정확하다. `rapidLosses` 배열이 unbounded growth하는 것은 확실히 수정해야 한다. 그러나 **구현 세부사항에 조건**이 있다.

**`shift()` vs `filter()` 성능 문제**:
Engineer가 제안한 `while (this.rapidLosses[0] < cutoff) { this.rapidLosses.shift(); }` 패턴에 주의가 필요하다. JavaScript 배열의 `shift()`는 **O(n)** 연산이다 (모든 요소를 앞으로 이동). 최악의 경우 while 루프 안에서 shift를 반복 호출하면 O(n^2) 복잡도가 된다.

그러나 현실적 규모를 고려하면:
- rapidLossWindow가 보통 30분~1시간
- 해당 윈도우 내 손실 거래는 현실적으로 최대 수십 건
- MAX_RAPID_LOSSES = 500이면 shift 비용은 무시 가능

따라서 실질적으로는 문제가 되지 않지만, **원칙적으로 올바른 대안**을 명시한다:

**보완 요구**:
1. 현재 구현(shift while loop)을 그대로 사용해도 무방하다. 배열 크기가 500 이하로 제한되므로 shift의 O(n) 비용은 무시할 수준.
2. 다만 MAX_RAPID_LOSSES cap(500)이 핵심이다. 이것이 없으면 shift loop 자체도 문제가 될 수 있다.
3. `filter()` 새 배열 생성 대신 `this.rapidLosses`를 직접 수정하는 현재 제안이 GC pressure 측면에서 우수.

**결론**: shift + MAX_RAPID_LOSSES cap 조합은 적절하다. 그대로 진행.

---

### T2-7: API Rate Limiting — In-Memory 커스텀 구현

**판정: ⚠️ 조건부 동의**

Engineer의 in-memory sliding window 구현은 기술적으로 건전하다. `express-rate-limit` 대신 커스텀 구현이 적절한지에 대한 판단:

**커스텀 구현 찬성 근거**:
- 단일 인스턴스 배포이므로 Redis store 불필요
- 외부 의존성 0개 추가 (보안 감사 범위 축소)
- 3-tier 차등 제한을 코드 수준에서 정밀 제어 가능
- cleanup timer의 `unref()` 처리가 graceful shutdown과 잘 맞음

**보완 요구**:
1. **Rate limit 설정값 조정**: Engineer 제안의 Critical tier(분당 10회)는 **너무 제한적**이다. `/api/bot/status`를 5초 폴링하면 분당 12회인데, 이것이 critical이 아닌 standard에 올바르게 분류되어 있지만, `/api/bot/start`와 `/api/bot/stop`은 분당 10회면 충분하다. 현재 분류가 적절함.
2. **429 응답 형식**: UI 에이전트가 요청한 대로 `{ success: false, error: '...', retryAfter: N }` 형식을 반드시 준수해야 한다. Engineer의 현재 코드가 이를 충족한다. 좋다.
3. **Bitget API 연쇄 차단 방지**: 가장 중요한 포인트. `/api/bot/status`가 내부적으로 Bitget REST API를 호출하는 경우, rate limiter가 외부 요청만 제한하고 **내부 Bitget 호출은 별도로 관리**해야 한다. ExchangeClient의 자체 retry/backoff 로직이 이 역할을 하는지 확인 필요.
4. **`/api/health/ping` 제외**: UI 에이전트의 요청에 동의. 헬스체크는 모니터링 도구에서 사용하며 rate limit에서 제외해야 한다.
5. **cleanup timer 관리**: Engineer가 언급한 `stopCleanup()`의 graceful shutdown 호출은 필수. `app.js`의 shutdown 핸들러에 반드시 포함할 것.

**결론**: 커스텀 in-memory 구현이 이 프로젝트에 적합하다. express-rate-limit을 도입하면 오히려 과잉 엔지니어링.

---

### T2-1: RSI Wilder Smoothing — `wilder` 파라미터 기본값 변경

**판정: ✅ 동의**

Engineer의 `wilder = true` 기본값 변경에 **강하게 동의**한다.

**근거**:
1. **업계 표준 정합성**: TradingView, Bloomberg, Binance 등 모든 주요 플랫폼이 Wilder smoothing을 기본 사용. Cutler's RSI를 사용하는 프로덕션 시스템은 거의 없다.
2. **시그널 품질**: Wilder smoothing은 RSI 노이즈를 감쇠시켜 false signal을 줄인다. 특히 1분/5분 차트에서 Cutler's RSI는 과도하게 진동한다.
3. **경계값 영향**: RSI 30/70 경계에서 Wilder와 Cutler의 차이가 1-3 포인트 발생할 수 있다. 이것은 진입/청산 결정을 바꿀 수 있는 수준이다.

**추가 의견 — 임계값 재조정 불필요**:
Engineer가 질문한 "RsiPivotStrategy의 buyThreshold/sellThreshold 재조정 필요 여부"에 답한다. **재조정 불필요하다.** 이유:
- RsiPivotStrategy의 기본값(30/70)은 Wilder RSI 기준으로 설계된 업계 표준값이다.
- 현재 Cutler 구현에서 이 값들이 사용되고 있었다는 것 자체가 비정상이었다.
- Wilder로 전환하면 오히려 원래 의도한 동작에 가까워진다.
- 다만 BollingerReversion(25/75)과 VwapReversion(35/65)은 Wilder 기준에서도 합리적인 범위이다.

**위험 관리**: 변경 후 반드시 18개 전략 일괄 백테스트(`runAllBacktest.js`)를 실행하여 기존 결과와 비교해야 한다. 특히 RsiPivotStrategy, BollingerReversionStrategy의 수익/손실 분포 변화를 확인.

---

### T2-2: Confidence-Based Signal Filtering

**판정: ⚠️ 조건부 동의**

전략별 minConfidence 개념은 필수적이다. 그러나 Engineer 제안의 **임계값이 너무 관대**하다.

**Engineer 제안 vs Trader 수정안**:

| 전략 | Engineer 제안 | Trader 수정안 | 근거 |
|------|-------------|-------------|------|
| FundingRateStrategy | 0.55 | 0.55 | 동의. 펀딩비 전략은 빈도가 낮아 관대하게 |
| GridStrategy | 0.60 | 0.65 | 고정 0.70에서 0.60으로 낮추는 것은 과도. 0.65가 적절 |
| RsiPivotStrategy | 0.55 | 0.55 | 동의. RSI reversal은 빈도 유지 필요 |
| CandlePatternStrategy | 0.55 | 0.60 | 캔들 패턴은 false positive가 높아 더 엄격해야 |
| 기타 기본값 | 0.50 | 0.55 | 0.50은 동전 던지기 수준. 최소 0.55 |

**보완 요구**:
1. **riskLevel 기반 자동 매핑** 추가 (내 원래 제안 유지):
   - `low` -> 0.50 (보수적 전략, 빈도 중시)
   - `medium` -> 0.55 (균형)
   - `high` -> 0.60 (고위험은 높은 확신 필요)
2. **confidence 필터링 통계 로깅**: 필터링된 시그널 비율을 주기적으로 로깅해야 한다. 만약 특정 전략의 시그널 70% 이상이 필터링되면 임계값이 너무 높거나 전략 자체의 confidence 산출 로직에 문제가 있는 것이다.
3. **T2-8과 반드시 동시 구현**: confidence 필터링 도입 시 UI에서 `confidence_too_low` 거부 사유가 보여야 한다.

---

### T2-3: Backtest Position Size

**판정: ⚠️ 조건부 동의**

riskLevel별 fallback 비율에 대한 검증 결과:

| riskLevel | Engineer 제안 | Trader 수정안 | 근거 |
|-----------|-------------|-------------|------|
| low | 10% | 10% | 동의. FundingRate(5%), GridStrategy(20%) 사이의 합리적 fallback |
| medium | 15% | 15% | 동의. RsiPivot(5%), CandlePattern 등의 중간값 |
| high | 25% | **8%** | **반대**. 고위험 전략에 25%는 과도하다. |

**`high` riskLevel을 25%에서 8%로 낮추는 이유**:
- BreakoutStrategy(high, 4%)와 QuietRangeScalp(high, 3%)가 이 카테고리에 속한다.
- 이 전략들의 실제 positionSizePercent가 3-4%인데 fallback이 25%면 격차가 너무 크다.
- 고위험 전략은 빈번한 손실을 전제로 설계되어 있으므로 작은 포지션이 원칙이다.
- 내 원래 제안(round_4.md)에서도 `high: '8'`을 명시했다.

**추가 보완**: `DEFAULT_POSITION_SIZE_PCT = '95'` 전역 fallback은 `'15'`로 변경하는 것이 안전하다. 95%는 어떤 상황에서도 비현실적인 값이다.

---

### T2-4: FundingRateStrategy 데이터 소스

**판정: ✅ 동의**

Engineer의 REST polling 방식에 동의한다. 추가 검증 결과:

**폴링 주기 5분의 적절성**:
- Bitget 펀딩 정산: 8시간마다 (00:00, 08:00, 16:00 UTC)
- 펀딩비는 정산 간격 전체에 걸쳐 점진적으로 변동하므로 5분 간격이면 충분
- 정산 직전 변동이 크지만, FundingRateStrategy의 `consecutivePeriods: 3` 조건은 최소 3번 연속(=15분) 관찰해야 하므로 5분이 적절

**fundingRate 임계값(-0.01, +0.03) 현실성 검토**:
- Bitget USDT-Futures 펀딩비 일반 범위: -0.005% ~ +0.005% (8시간)
- 극단적 시장: -0.05% ~ +0.1%
- 전략 기본값: `longFundingThreshold: '-0.01'`, `shortFundingThreshold: '0.03'`
- 이 값들은 합리적이다. -0.01%는 "약간 극단적 음수", +0.03%는 "강한 양수"에 해당. 너무 극단적이지도 않고 너무 관대하지도 않다.

**Engineer 제안의 `botService._startFundingPoll()` 패턴에 대한 의견**:
나는 원래 별도의 `fundingDataService.js` 모듈을 제안했고, Engineer는 botService에 직접 구현을 제안했다. **Engineer의 방식이 더 실용적**이다. fundingDataService를 별도로 만들면 DI 체인에 또 하나의 서비스가 추가되어 복잡성이 증가한다. botService에서 직접 polling하는 것이 단순하고 문제 추적이 쉽다.

---

### T2-5: GridStrategy Equity 주입 — `setContext()` vs `setAccountContext()/getEquity()`

**판정: ⚠️ 조건부 동의 (Trader 패턴 우위)**

Engineer의 `setContext({ equity })` 패턴과 내가 제안한 `setAccountContext({ getEquity }) / getEquity()` 패턴을 비교한다.

**Engineer 패턴** (`setContext`):
```javascript
setContext(ctx) {
  if (ctx.equity !== undefined) {
    this.config.equity = ctx.equity;
  }
}
```
- 장점: 단순함, 명시적
- **단점**: equity를 스냅샷 값으로 저장. 호출 시점의 값이 고정되므로 다음 setContext 호출 전까지 stale 데이터 사용

**Trader 패턴** (`getEquity`):
```javascript
setAccountContext(context) {
  this._accountContext = context;  // { getEquity: () => string }
}
getEquity() {
  return this._accountContext?.getEquity() || this.config.equity || '0';
}
```
- 장점: **항상 최신 equity 반환**. 클로저를 통해 riskEngine.accountState.equity를 실시간 참조
- 단점: 간접 참조 한 단계 추가

**트레이딩 관점에서 Trader 패턴이 우월한 이유**:
1. **Equity는 밀리초 단위로 변동**한다. 포지션이 열리고 닫힐 때마다, 미실현 PnL이 변할 때마다 equity가 변한다.
2. GridStrategy의 `_calculatePerLevelQty()`는 그리드 레벨별로 호출된다. 하나의 그리드에 20개 레벨이면 20번 호출되는데, 이때 1번째와 20번째 호출 사이에 equity가 바뀔 수 있다.
3. `setContext()`는 botService가 **언제 호출하느냐**에 의존하지만, `getEquity()`는 **사용 시점**에 항상 최신 값을 가져온다.

**보완 요구**: Trader 패턴(`setAccountContext` + `getEquity()`)으로 구현하되, `setContext()`는 equity 외의 다른 런타임 데이터(예: 활성 심볼 목록, 시장 레짐 등) 주입용으로 별도 유지할 수 있다. 두 메서드를 공존시키는 것도 가능:
- `setAccountContext()` -> equity 전용 (실시간 콜백)
- `setContext()` -> 기타 런타임 메타데이터 (스냅샷)

---

### T2-6: useSocket 목적별 분리

**판정: ✅ 동의**

시스템 무결성 관점의 분석이 정확하다. ticker 이벤트의 과도한 리렌더링은 UI 래그를 유발하고, 이것은 트레이딩 의사결정에 직접 영향을 미친다. 4개 훅 분리 전략에 동의.

---

### T2-8: SignalFeed rejectReason 표시

**판정: ✅ 동의**

T2-2(confidence filtering)와 함께 구현하는 것이 효율적이라는 의견에 동의.

---

### T2-10, T2-11, T2-12: 프론트엔드 UX 항목

**T2-10**: ✅ 동의 (프론트엔드 equity curve에서 drawdown 파생은 합리적)
**T2-11**: ✅ 동의 (시각적 게이지는 트레이딩 모니터링에 유용)
**T2-12**: ✅ 동의 (적응형 폴링은 서버 부하 감소에 효과적)

---

## UI/UX 제안서 리뷰

### T2-6: useSocket 목적별 분리

**판정: ✅ 동의**

UI 에이전트의 분석이 매우 정밀하다. 특히 `lastTicker`와 socket `positions`가 `page.tsx`에서 실제로 사용되지 않는다는 발견은 중요하다. 사용되지 않는 상태 업데이트가 불필요한 리렌더를 유발하는 것이므로, 이 두 가지를 제거하는 것만으로도 즉각적인 성능 개선이 가능하다.

4개 훅 분리 계획과 기존 `useSocket`을 facade로 유지하는 전략에 동의한다.

---

### T2-8: SignalFeed rejectReason 표시

**판정: ⚠️ 조건부 동의**

UI 에이전트의 구현 설계가 우수하다. `translateRejectReason()` 번역 함수와 payload 정규화 로직이 잘 설계되어 있다.

**보완 요구**:
1. **거부 사유별 심각도 색상 차별화**: UI 에이전트가 `text-red-400/70`로 일괄 표시하지만, 사유에 따라 차별화가 필요하다:
   - `circuit_breaker_active` -> 빨간색 (즉시 대응 필요)
   - `total_exposure_exceeded` -> 주황색 (포지션 정리 후 재시도 가능)
   - `confidence_too_low` -> 회색 (정보성, 대응 불필요)
   - `daily_loss_exceeded` -> 빨간색 (당일 거래 중단)
2. **재시도 가능 여부 힌트**: `total_exposure_exceeded`나 `confidence_too_low`는 조건 변경 시 재시도 가능하지만, `circuit_breaker_active`나 `daily_loss_exceeded`는 쿨다운/리셋 대기가 필요하다. 이 정보를 시각적으로 구분하면 트레이더의 대응 효율이 높아진다.
3. **`handleSignalGenerated` payload 정규화**: UI 에이전트가 정확히 짚었다. 서버 emit이 `{ signal, approved, rejectReason }` 형태이므로 `data.signal` 추출이 필수. 이 부분은 반드시 수정해야 한다.

---

### T2-10: Drawdown 시각화 차트

**판정: ⚠️ 조건부 동의 (Option A 탭 방식 반대, Option B 별도 Row 지지)**

**UI 에이전트의 Tab 방식(Option A) 선호에 대한 반론**:

트레이더 관점에서 **Option B (별도 Row)가 압도적으로 우수**하다. 이유:

1. **동시 모니터링 필수**: 트레이더는 equity curve(자산 추이)와 drawdown curve(낙폭 추이)를 **동시에** 봐야 한다. 탭으로 전환하면서 정보를 기억하고 비교하는 것은 실시간 의사결정에 부적합하다.
2. **Bloomberg/TradingView 표준**: 모든 전문 트레이딩 플랫폼은 equity curve 아래에 drawdown chart를 별도 패널로 배치한다. 동시 표시가 업계 표준이다.
3. **200px 높이면 충분**: 페이지 길이 증가는 미미하며, 스크롤보다 정보 누락이 더 위험하다.
4. **상관관계 시각화**: equity가 하락할 때 drawdown이 깊어지는 패턴을 동시에 보면 추세 반전 시점을 더 빨리 포착할 수 있다.

**수정 제안**:
```
Row 3: RiskStatusPanel(1/3) + EquityCurveChart(2/3)
Row 3.5: DrawdownChart (full width, 높이 180px, 축소 가능)
```
- 축소(collapse) 토글 버튼을 추가하여 공간이 부족할 때 접을 수 있게 하면 두 가지 장점을 모두 취할 수 있다.

**경고선/한도선 기준값 확인 (UI 에이전트 요청 응답)**:
- `DEFAULT_RISK_PARAMS.maxDrawdownPercent = '10'` (10%)
- `DEFAULT_RISK_PARAMS.maxDailyLossPercent = '3'` (3%)
- 경고선: maxDrawdownPercent의 50% = 5% 지점
- 한도선: maxDrawdownPercent = 10% 지점

---

### T2-11: Risk Gauge 종합 점수 가중치

**판정: ⚠️ 조건부 동의 (가중치 수정 필요)**

**UI 에이전트 제안**: DD 60% + Exposure 40%
**Trader 수정안**: DD 40% + Exposure 30% + Circuit Breaker 30%

**Circuit Breaker를 점수에 포함해야 하는 이유**:
1. 연속 손실은 **전략 오작동**의 강력한 신호이다. 드로다운이나 노출도보다 더 즉각적인 경고가 필요하다.
2. `consecutiveLosses`가 `consecutiveLossLimit`의 60%를 넘으면 (예: 5회 중 3회) 이미 위험 구간이다.
3. 서킷 브레이커가 tripped되면 100%는 맞지만, tripped 직전 상태도 반영해야 한다.

**정규화 방법**:
```typescript
// Circuit Breaker 점수 (0~100)
const cbNormalized = circuitBreaker.tripped
  ? 100
  : Math.min((consecutiveLosses / consecutiveLossLimit) * 100, 100);

// 종합 점수
const score = Math.round(
  ddNormalized * 0.40 +
  expNormalized * 0.30 +
  cbNormalized * 0.30
);
```

**추가 요구**: `riskEngine.getStatus()` 반환값에 `params`(maxDrawdownPercent, consecutiveLossLimit 등)를 포함해야 한다. UI 에이전트가 Engineer에게 이미 요청했으며 이에 동의한다.

---

### T2-12: 적응형 폴링 간격

**판정: ⚠️ 조건부 동의 (간격 미세 조정)**

UI 에이전트의 폴링 매트릭스에 대한 트레이딩 관점 검토:

| 훅 | UI 제안 (idle) | Trader 의견 | UI 제안 (active) | Trader 의견 | UI 제안 (halted) | Trader 의견 |
|----|-------------|------------|---------------|------------|---------------|------------|
| botStatus | 15s | **30s로** (idle에서 상태 변경 가능성 극히 낮음) | 5s | 적절 | 10s | 적절 |
| positions | 30s | **주의 필요** | 3s | 적절 | 10s | 적절 |
| trades | 30s | 적절 | 10s | 적절 | 15s | 적절 |
| health | 60s | 적절 | 30s | 적절 | 30s | 적절 |

**positions idle 30s에 대한 우려**:
- 사용자가 **수동 주문**을 제출한 직후, idle 상태라면 30초 후에야 포지션 목록이 갱신된다. 이것은 UX에 문제가 있다.
- **해결 방안**: 수동 주문 제출 API 호출 직후 `positions` 즉시 refetch 트리거를 추가해야 한다. 이것은 폴링 간격과 독립적으로 동작한다.
- 이 즉시 refetch가 구현되면 idle 30s는 문제 없다.

**active 시 positions 3s의 충분성**:
- 크립토 선물 시장에서 3초는 적절하다. 가격이 급변해도 실제 포지션 정보(진입가, PnL 등)는 1초 이내로 변하지 않는다.
- 진정한 실시간이 필요하면 Socket.io 이벤트(`position_updated`)로 보완해야 하며, REST 폴링에 의존하지 말아야 한다.

**hidden 상태(탭 비활성) 폴링**:
- UI 에이전트의 Page Visibility API 활용과 탭 복귀 시 즉시 fetch는 우수한 설계이다. 동의.

---

## 교차 이슈 (에이전트 간 중복/상충 발견사항)

### 1. AD 번호 충돌

Engineer와 UI가 동일한 AD 번호를 사용하고 있다:
- **AD-18**: Engineer = "API Rate Limiting", UI = "useSocket 분리 전략"
- **AD-19**: Engineer = "RSI Wilder", UI = "적응형 폴링"
- **AD-20**: Engineer = "Strategy Context Injection", UI = "클라이언트 측 Drawdown 계산"

**해결**: AD 번호를 통합 관리해야 한다. 제안:
- AD-18: API Rate Limiting (Engineer)
- AD-19: RSI Wilder Smoothing (Engineer)
- AD-20: Strategy Context Injection (Engineer/Trader)
- AD-21: useSocket 분리 전략 (UI)
- AD-22: 적응형 폴링 표준 (UI)
- AD-23: 클라이언트 측 Drawdown 계산 (UI)

### 2. T2-5 equity 주입 패턴 상충

- **Engineer**: `setContext({ equity })` — 스냅샷 값 주입
- **Trader**: `setAccountContext({ getEquity }) + getEquity()` — 실시간 콜백 주입

위에서 분석했듯이 **Trader 패턴이 우위**하다. 단, 두 패턴을 공존시킬 수 있다.

### 3. T2-7 rate limiting vs T2-12 적응형 폴링 의존성

- UI 에이전트가 T2-12를 T2-7보다 **먼저** 구현해야 한다고 제안 (현재 5초 폴링이 rate limit에 걸릴 수 있으므로)
- Engineer는 T2-7을 먼저 배치

**Trader 판정**: UI 에이전트의 순서가 맞다. T2-12(적응형 폴링) -> T2-7(rate limiting) 순서로 진행해야 한다. 이유:
1. Rate limiting을 먼저 배포하면 현재 5초 폴링 클라이언트가 429를 받을 수 있음
2. 적응형 폴링으로 먼저 요청 빈도를 낮춘 후 rate limiting을 안전하게 적용

### 4. T2-2 confidence filtering 이벤트 명칭

- UI 에이전트: `trade:signal_skipped` 이벤트로 필터링 시그널 전송 요청
- Engineer: `signal:blocked` 이벤트의 payload에 reason 포함 언급

**통일 필요**: 기존 `signal:blocked` 이벤트에 confidence 거부 사유를 추가하는 것이 더 자연스럽다. 새 이벤트 타입을 추가하면 프론트엔드 이벤트 핸들러가 늘어난다.

### 5. T2-8 Signal payload 구조 불일치

UI 에이전트가 정확히 짚었다. `handleSignalGenerated`가 `Signal` 타입으로 받지만 실제 payload는 `{ signal, approved, rejectReason }` wrapper 형태이다. 이것은 T2-8 구현 시 반드시 정규화해야 한다. **Engineer와 UI 모두 이 문제를 인식**하고 있으므로 합의 가능.

---

## 구현 순서 의견 (트레이딩 영향도 기준)

세 에이전트의 우선순위 제안을 종합하여 **트레이딩 수익 영향도** 기준으로 최종 순서를 제시한다.

### Phase 1: 비활성 전략 복구 (수익 기회 복원)

| 순서 | 항목 | 에이전트 | 근거 |
|------|------|---------|------|
| 1 | **T2-5** (GridStrategy equity) | Engineer | Grid 전략이 완전 비활성. qty=0으로 모든 주문 실패. 즉시 수정 |
| 2 | **T2-4** (FundingRate 데이터) | Engineer | Funding 전략이 완전 비활성. 시그널 생성 불가. 즉시 수정 |

**이유**: 18개 전략 중 2개가 완전히 작동하지 않는 상태는 포트폴리오 다각화의 심각한 손실이다. 이것들이 활성화되면 수익 기회가 즉시 확대된다.

### Phase 2: 매매 품질 개선 (수익률/Sharpe 직접 영향)

| 순서 | 항목 | 에이전트 | 근거 |
|------|------|---------|------|
| 3 | **T2-1** (RSI Wilder) | Engineer | 5개 전략의 시그널 정확도 개선. False signal 감소 |
| 4 | **T2-2** (Confidence filtering) | Engineer | 저질 시그널 차단 -> Sharpe ratio 직접 개선 |
| 5 | **T2-3** (Backtest position size) | Engineer | 백테스트 신뢰성 확보 -> 전략 선택 품질 개선 |

### Phase 3: 인프라 안정성 (시스템 보호)

| 순서 | 항목 | 에이전트 | 근거 |
|------|------|---------|------|
| 6 | **T2-9** (rapidLosses 정리) | Engineer | 메모리 누수. 10줄 수정이므로 Phase 2와 함께 가능 |
| 7 | **T2-12** (적응형 폴링) | UI | T2-7 배포 전 선행 필수. 서버 부하 감소 |
| 8 | **T2-7** (API rate limiting) | Engineer | T2-12 이후 안전하게 배포 |

### Phase 4: UX 강화 (모니터링/의사결정 지원)

| 순서 | 항목 | 에이전트 | 근거 |
|------|------|---------|------|
| 9 | **T2-8** (rejectReason 표시) | UI | T2-2 완료 후. 디버깅 효율 |
| 10 | **T2-6** (useSocket 분리) | UI | 성능 개선. 점진적 마이그레이션 |
| 11 | **T2-10** (Drawdown 차트) | UI | 리스크 시각화 (별도 Row 방식) |
| 12 | **T2-11** (Risk Gauge) | UI | 종합 리스크 게이지 |

### 병렬 실행 가능성

- **Phase 1 (T2-4, T2-5)**: 독립적이므로 병렬 가능
- **Phase 2 (T2-1, T2-2, T2-3)**: 독립적이므로 병렬 가능. T2-9도 여기서 함께 처리
- **Phase 3 (T2-12 -> T2-7)**: 순차 필수
- **Phase 4 (T2-8, T2-6, T2-10, T2-11)**: 대부분 병렬 가능. T2-8은 T2-2 의존

---

## 최종 정리

| 항목 | Engineer | UI | Trader 판정 |
|------|---------|-----|------------|
| T2-1 RSI Wilder | wilder=true 기본 | N/A | ✅ 동의. 임계값 재조정 불필요 |
| T2-2 Confidence | minConfidence 0.50~0.60 | N/A | ⚠️ 기본값 0.55로 상향, high riskLevel은 0.60 |
| T2-3 Backtest size | high: 25% | N/A | ⚠️ high: 8%로 하향. 95% fallback도 15%로 변경 |
| T2-4 FundingRate | REST 5분 polling | N/A | ✅ 동의. botService 직접 구현 방식 지지 |
| T2-5 Equity DI | setContext({ equity }) | N/A | ⚠️ Trader 패턴(getEquity 콜백) 우위 |
| T2-6 useSocket | facade 유지 | 4개 훅 분리 | ✅ 양측 동의, 진행 |
| T2-7 Rate limit | in-memory 커스텀 | T2-12 이후 배포 | ⚠️ 커스텀 구현 적합. /health/ping 제외 |
| T2-8 rejectReason | T2-2와 동시 | translateRejectReason | ⚠️ 심각도별 색상 차별화 추가 |
| T2-9 rapidLosses | shift + MAX_RAPID_LOSSES | N/A | ⚠️ shift O(n) 인지하되 500 cap이면 무방 |
| T2-10 Drawdown | 프론트엔드 축적 | Option A (탭) 권장 | ⚠️ **Option B (별도 Row) 강하게 권장** |
| T2-11 Risk Gauge | N/A | DD 60% + Exp 40% | ⚠️ DD 40% + Exp 30% + CB 30%로 변경 |
| T2-12 적응형 폴링 | idle 30s | idle 15s | ⚠️ idle 30s + 수동 주문 후 즉시 refetch |
