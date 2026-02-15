# Round 4 합의 결정문서

> 생성일: 2026-02-15
> 주제: Tier 2 Quality (12건)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | Track |
|----|------|----------|------|-------|
| T2-9 | CircuitBreaker rapidLosses 배열 크기 제한 | 3/3 동의 | E | A |
| T2-5 | GridStrategy equity 주입 (DI context 패턴) | 3/3 동의 (패턴 합의) | E+T | A |
| T2-4 | FundingRateStrategy 데이터 소스 구축 | 3/3 동의 (구조 합의) | E+T | A |
| T2-1 | RSI Wilder smoothing 구현 | 3/3 동의 (시그니처 합의) | E | A |
| T2-2 | Confidence-based signal filtering | 2/3+조건 (String math) | E | A |
| T2-3 | Backtest position size 전략 메타 기반 | 3/3 동의 (값 합의) | E | A |
| T2-7 | API rate limiting (in-memory custom) | 3/3 동의 (예외 합의) | E | A |
| T2-8 | SignalFeed rejectReason 표시 | 3/3 동의 (번역맵 확장) | U | C |
| T2-12 | 적응형 폴링 (봇 상태별 간격 조절) | 3/3 동의 (간격 합의) | U | C |
| T2-6 | useSocket 최적화 (ticker 격리) | 2/3+조건 (범위 축소) | U | C |
| T2-10 | Drawdown 시각화 차트 | 2/3+조건 (배치 합의) | U | C |
| T2-11 | Risk Gauge / RiskStatusPanel 강화 | 2/3+조건 (형태 합의) | U | C |

---

## 아키텍처 결정

### AD-18: API Rate Limiting — In-Memory Sliding Window
- **결정**: 외부 패키지(express-rate-limit) 대신 커스텀 in-memory sliding window rate limiter를 구현한다.
- **근거**: 단일 인스턴스 배포이므로 Redis/외부 store 불필요. 외부 의존성 0으로 보안 감사 범위 축소.
- **상세**:
  - 3-tier: Critical(10/min — bot control/order), Standard(60/min — data queries), Heavy(3/min — backtest run)
  - **emergency-stop은 rate limit에서 제외** (안전 기능)
  - `/api/health/ping`도 제외 (모니터링 목적)
  - cleanup timer에 `unref()` 적용, graceful shutdown 시 `stopCleanup()` 호출
  - 429 응답 형식: `{ success: false, error: string, retryAfter: number }`

### AD-19: RSI Wilder Smoothing Default
- **결정**: `indicators.js`의 `rsi()` 함수 기본 smoothing을 Wilder로 변경한다.
- **근거**: 업계 표준(TradingView, Bloomberg 등) 정합성. Cutler's RSI는 과도한 진동으로 false signal 증가.
- **상세**:
  - 함수 시그니처: `rsi(prices, period = 14, { smoothing = 'wilder' } = {})` — **options 객체 방식 채택** (Trader 제안, Engineer 리뷰 지지). 향후 확장성 확보.
  - `smoothing: 'sma'`로 기존 Cutler's RSI 하위 호환 유지
  - 전체 가격 이력을 순회하는 Wilder 방식. IndicatorCache closes 배열 크기 확인 필요.
  - **임계값 재조정 불필요** (기존 30/70은 원래 Wilder 기준 표준값)

### AD-20: Strategy Account Context — Callback DI Pattern
- **결정**: `StrategyBase`에 `setAccountContext({ getEquity })` 콜백 패턴을 도입하여 실시간 equity 접근을 제공한다.
- **근거**: 값 주입(setContext)은 stale 데이터 위험. 콜백 방식은 호출 시점에 항상 최신 equity 반환.
- **상세**:
  - `StrategyBase.setAccountContext(context)` — `{ getEquity: () => string }` 형태 저장
  - `StrategyBase.getEquity()` — `_accountContext?.getEquity()` 호출, fallback `this.config.equity || '0'` (NULL safety)
  - BotService: `strategy.setAccountContext({ getEquity: () => this.riskEngine.accountState.equity })`
  - BacktestEngine: `strategy.setAccountContext({ getEquity: () => this._cash })`
  - `_accountContext` 별도 필드 사용 (config 오염 방지)

### AD-21: Funding Data Service as Independent Module
- **결정**: `fundingDataService.js`를 별도 서비스 모듈로 생성하여 FundingRateStrategy에 데이터를 공급한다.
- **근거**: botService에 폴링 추가하면 이미 비대한 오케스트레이터가 더 복잡해짐. 단일 책임 원칙, DI 일관성, 독립 테스트 가능성에서 별도 서비스가 우위.
- **상세**:
  - REST polling 5분 간격 (Bitget 8시간 정산 주기 대비 충분)
  - `exchangeClient.getFundingRate()` + `getOpenInterest()` 호출
  - `MARKET_EVENTS.FUNDING_UPDATE` 이벤트 emit → strategyRouter가 FundingRateStrategy에 라우팅
  - app.js bootstrap 순서: `exchangeClient → fundingDataService` (coinSelector와 동일 레벨)
  - 호출 간 100ms 딜레이로 burst 방지
  - `stop()` 시 clearInterval + timer.unref()

### AD-22: useSocket Optimization Strategy
- **결정**: 전체 4개 훅 분리 대신, 현재 미사용 상태(`lastTicker`, `positions`)를 `useRef`로 전환하여 불필요한 리렌더를 제거한다.
- **근거**: 현재 소비처가 `page.tsx` 1곳뿐이므로 4개 훅 분리는 과도한 엔지니어링 (UI 리뷰 자체 수정). `useRef`로 ticker를 격리하면 동일 효과 달성.
- **상세**:
  - `lastTicker`를 `useRef`로 전환 (setState → ref 업데이트, 리렌더 없음)
  - `positions` socket 핸들러 제거 (REST `usePositions` 훅으로 충분)
  - 향후 페이지가 증가하면 그때 분리 진행

### AD-23: Adaptive Polling Standard
- **결정**: `useAdaptivePolling` 훅을 통해 봇 상태 + 탭 가시성에 따라 폴링 간격을 동적 조절한다.
- **근거**: idle 시 불필요한 서버 요청 75% 감소, 탭 비활성 시 90% 감소.
- **상세**:
  - 폴링 매트릭스:

    | 훅 | idle | active | halted | hidden |
    |----|------|--------|--------|--------|
    | botStatus | 30s | 5s | 10s | 60s |
    | positions | 30s | 3s | 10s | 60s |
    | trades | 30s | 10s | 15s | 60s |
    | health | 60s | 30s | 30s | 120s |

  - Page Visibility API로 탭 복귀 시 즉시 fetch
  - `fetchFn`은 반드시 `useCallback`으로 안정화
  - interval 변경 시 500ms debounce (Engineer 리뷰 제안)
  - 수동 주문 후 positions 즉시 refetch 트리거 필요

### AD-24: Client-side Drawdown Calculation
- **결정**: 드로다운 차트 데이터를 추가 API 없이 기존 equity curve 데이터에서 클라이언트 측 계산으로 파생한다.
- **근거**: Snapshot 모델에 equity 히스토리 존재. peak - current 관계는 단순 수학. 프론트엔드 로컬 축적은 새로고침 시 데이터 손실.
- **상세**:
  - 데이터 소스: `/api/analytics/equity-curve/:sessionId`
  - `computeDrawdownSeries()` — O(n) 단일 패스로 peak tracking + drawdown% 계산
  - 프론트엔드 float 사용 허용 (차트 표시 목적)

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|-----|------|
| T2-1 파라미터 형식 | options 객체 `{smoothing}` | boolean `wilder` | boolean 선호 | **options 객체** (확장성, Engineer 리뷰에서 채택) |
| T2-2 confidence 비교 | parseFloat 사용 | mathUtils.isLessThan() | 무관 | **mathUtils.isLessThan()** (String math 정책 준수) |
| T2-2 기본 minConfidence | 0.55 | 0.50 | 0.50 | **'0.55'** (Trader 근거: 0.50은 동전 던지기 수준) |
| T2-3 high riskLevel | 8% | 25% | 8% 지지 | **'8'** (3/3 합의: 고위험 전략은 작은 포지션) |
| T2-3 전역 fallback | 15%로 변경 | 95% 유지 | 무관 | **'15'** (95%는 비현실적) |
| T2-4 구현 위치 | 별도 fundingDataService | botService 내부 | 별도 서비스 | **별도 fundingDataService.js** (Engineer 리뷰에서 채택) |
| T2-5 DI 패턴 | 콜백 getEquity() | 값 주입 setContext() | 콜백 지지 | **콜백 패턴 + NULL safety** (2/3 + 실시간성 우위) |
| T2-6 분리 범위 | 4개 훅 분리 동의 | 4개 분리 + deprecated | useRef로 충분 | **useRef 방식** (UI 자체 수정, 실용적) |
| T2-7 emergency-stop | rate limit 적용 | critical에 포함 | 제외 필수 | **제외** (안전 기능은 rate limit 불가) |
| T2-10 배치 | Option B (별도 Row) | Option A (탭) | equity curve 아래 overlay | **Option B 변형**: EquityCurveChart 아래 synced DrawdownChart, collapse 토글 |
| T2-11 형태 | 3개 분리 게이지, CB 포함 | 1개 종합 게이지 | 기존 bar 강화 | **기존 RiskStatusPanel 강화** + 종합 점수 헤더 추가 |
| T2-11 가중치 | DD40%+Exp30%+CB30% | DD 50%+Exp 50% | DD60%+Exp40% | **DD40%+Exp30%+CB30%** (Trader: CB는 전략 오작동 신호) |
| T2-12 idle botStatus | 30s | 30s | 15s | **30s** (idle에서 변경 가능성 극히 낮음) |
| T2-12 → T2-7 순서 | T2-12 먼저 | T2-7 먼저 | T2-12 먼저 | **T2-12 먼저** (2/3: 기존 5s 폴링이 rate limit에 걸리지 않도록) |
| AD 번호 | AD-18~20 | AD-18~20 | AD-18~20 | **AD-18~24로 재배번** (중복 해소) |

---

## 구현 가이드

### Track A (Backend) — 7건

#### 1. T2-9: CircuitBreaker rapidLosses 크기 제한
**파일**: `backend/src/services/circuitBreaker.js`
**변경**:
- `recordTrade()` 내에서 `while(this.rapidLosses[0] < cutoff) shift()` 패턴으로 윈도우 외 항목 제거
- `MAX_RAPID_LOSSES = 500` 절대 상한 추가
- 절대 상한 초과 시에만 `log.warn()` (일반 trim은 로그 불필요)
- 기존 `filter()` 새 배열 대신 `this.rapidLosses` 직접 참조로 변경

#### 2. T2-5: GridStrategy equity 주입
**파일**: `backend/src/services/strategyBase.js`, `backend/src/strategies/indicator-light/gridStrategy.js`, `backend/src/services/botService.js`, `backend/src/backtest/backtestEngine.js`
**변경**:
- `StrategyBase`에 `_accountContext` 필드, `setAccountContext(ctx)`, `getEquity()` 메서드 추가
- `getEquity()`: `_accountContext?.getEquity()` 우선, fallback `this.config.equity || '0'`
- `GridStrategy._calculatePerLevelQty()`에서 `this.config.equity` → `this.getEquity()` 변경
- `botService`에서 전략 생성 시 `strategy.setAccountContext({ getEquity: () => this.riskEngine.accountState.equity })`
- `backtestEngine`에서 `strategy.setAccountContext({ getEquity: () => this._cash })`

#### 3. T2-4: FundingRateStrategy 데이터 소스
**파일**: `backend/src/services/fundingDataService.js` (신규), `backend/src/utils/constants.js`, `backend/src/app.js`, `backend/src/services/botService.js`
**변경**:
- 새 서비스 `fundingDataService.js` 생성:
  - `start(symbols)` / `stop()` lifecycle
  - 5분 간격 REST polling (`exchangeClient.getFundingRate()`, `getOpenInterest()`)
  - 호출 간 100ms 딜레이 (burst 방지)
  - `MARKET_EVENTS.FUNDING_UPDATE` emit: `{ symbol, fundingRate, nextSettlement, openInterest }`
- `constants.js`에 `MARKET_EVENTS.FUNDING_UPDATE` 추가
- `app.js` bootstrap에 `fundingDataService` 생성/주입
- `botService`에서 FUNDING_UPDATE 이벤트 구독 → `onFundingUpdate()` 라우팅
- `StrategyBase`에 `onFundingUpdate(data)` 기본 no-op 메서드 추가

#### 4. T2-1: RSI Wilder Smoothing
**파일**: `backend/src/utils/indicators.js`, `backend/src/services/indicatorCache.js`
**변경**:
- `rsi(prices, period, { smoothing = 'wilder' } = {})` 시그니처 변경
- `smoothing === 'sma'`: 기존 Cutler's RSI 로직 (`_rsiCutler()` 내부 함수로 분리)
- `smoothing === 'wilder'`: 첫 period개 SMA 시드 → 이후 Wilder 재귀 평활
  - `avgGain = (prevAvgGain * (period-1) + currentGain) / period`
  - 전체 prices 배열 순회 (O(n) mathUtils 연산)
- `indicatorCache.computeIndicator()` case 'rsi': `params.smoothing` 전달

#### 5. T2-2: Confidence Signal Filtering
**파일**: `backend/src/services/signalFilter.js`
**변경**:
- `registerStrategy(name, meta)` 에 `minConfidence` 수용 (String 타입, 기본 `'0.55'`)
- `_checkConfidence(strategy, confidence)` 메서드 추가
  - `mathUtils.isLessThan(confStr, minConfidence)` 사용 (**parseFloat 금지**)
  - confidence가 null/undefined이면 통과 (하위 호환)
  - reason: `low_confidence: {strategy} confidence {value} < threshold {min}`
- `filter()` 체인의 Filter 5로 추가
- riskLevel 기반 자동 매핑: `low: '0.50'`, `medium: '0.55'`, `high: '0.60'`
- confidence 필터링 통계 로깅 (주기적으로 필터링 비율 출력)

#### 6. T2-3: Backtest Position Size 메타 기반
**파일**: `backend/src/backtest/backtestEngine.js`
**변경**:
- `_getPositionSizePercent()` 메서드 추가
  - 1순위: `metadata.defaultConfig.positionSizePercent`
  - 2순위: `metadata.defaultConfig.totalBudgetPercent`
  - 3순위: riskLevel 매핑 `{ low: '10', medium: '15', high: '8' }`
  - 4순위: `DEFAULT_POSITION_SIZE_PCT`
- `DEFAULT_POSITION_SIZE_PCT`를 `'95'`에서 `'15'`로 변경
- `_openLong()`, `_openShort()`에서 고정값 대신 `this._positionSizePct` 사용
- constructor에서 `this._positionSizePct = this._getPositionSizePercent()` 캐싱

#### 7. T2-7: API Rate Limiting
**파일**: `backend/src/middleware/rateLimiter.js` (신규), `backend/src/app.js`
**변경**:
- `rateLimiter.js`: in-memory sliding window `createRateLimiter({ windowMs, max, keyPrefix, message })`
  - `_store` Map + 1분 cleanup timer + `unref()`
  - `stopCleanup()` export (graceful shutdown용)
- `app.js`:
  - Critical(10/min): `/api/bot/start`, `/api/bot/stop`, `/api/bot/risk-params`, `/api/trades/order`
  - Standard(60/min): `/api/bot/status`, `/api/trades`, `/api/analytics`, `/api/risk`
  - Heavy(3/min): `/api/backtest/run`
  - **제외**: `/api/bot/emergency-stop`, `/api/health/ping`
  - shutdown 핸들러에 `stopCleanup()` 추가

### Track C (Frontend) — 5건

#### 8. T2-8: SignalFeed rejectReason 표시
**파일**: `frontend/src/components/SignalFeed.tsx`, `frontend/src/lib/utils.ts`, `frontend/src/hooks/useSocket.ts`
**변경**:
- `utils.ts`에 `translateRejectReason(reason: string): string` 추가
  - prefix 매칭: `cooldown:` → '쿨다운 대기', `duplicate:` → '중복 시그널', `max_concurrent:` → '최대 동시 포지션 초과', `conflict:` → '반대 시그널 충돌', `low_confidence:` → '신뢰도 부족'
  - 정적 매칭: `circuit_breaker_active`, `daily_loss_exceeded`, `max_drawdown_exceeded`, `total_exposure_exceeded`, `equity_not_initialized`
  - `Risk validation error:` → '리스크 검증 오류', `Exchange error:` → '거래소 오류'
  - fallback: 원문 그대로 반환
- `SignalFeed.tsx`: 거부 시 `translateRejectReason()` 결과 표시 (`text-[10px]`, `truncate`, `max-w-[160px]`, `title`에 원문)
- `useSocket.ts` `handleSignalGenerated`: payload 정규화 (`data.signal || data as Signal`)

#### 9. T2-12: 적응형 폴링
**파일**: `frontend/src/hooks/useAdaptivePolling.ts` (신규), `frontend/src/hooks/useBotStatus.ts`, `frontend/src/hooks/usePositions.ts`, `frontend/src/hooks/useTrades.ts`, `frontend/src/hooks/useHealthCheck.ts`
**변경**:
- `useAdaptivePolling.ts` 신규 생성
  - Page Visibility API로 탭 가시성 감지
  - botState + riskHalted + isVisible → interval 결정
  - interval 변경 시 500ms debounce (빈번한 전환 방지)
  - 탭 복귀 시 즉시 fetch 1회
- 기존 4개 훅에서 고정 `setInterval` → `useAdaptivePolling` 전환
- `fetchFn`은 `useCallback`으로 안정화

#### 10. T2-6: useSocket 최적화
**파일**: `frontend/src/hooks/useSocket.ts`
**변경**:
- `lastTicker`를 `useState` → `useRef`로 전환 (리렌더 제거)
- `positions` socket 핸들러 제거 (REST `usePositions` 훅으로 충분, 미사용 확인됨)
- 기존 `useSocket()` API 유지 (하위 호환)
- 향후 분리 대비 주석만 추가

#### 11. T2-10: Drawdown 시각화 차트
**파일**: `frontend/src/lib/drawdown.ts` (신규), `frontend/src/components/DrawdownChart.tsx` (신규), `frontend/src/app/page.tsx`
**변경**:
- `drawdown.ts`: `computeDrawdownSeries(equityPoints)` — peak tracking + drawdown% 계산
- `DrawdownChart.tsx`: Recharts AreaChart
  - equity curve 아래에 synced x-axis로 배치 (Option B 변형)
  - collapse 토글 버튼 (접기/펴기)
  - 경고선: maxDrawdownPercent 50% (5%) 점선
  - 한도선: maxDrawdownPercent (10%) 실선
  - 색상: 0-3% emerald, 3-5% amber, 5%+ red
  - 높이: 180px
- `page.tsx`: EquityCurveChart 아래에 DrawdownChart 추가

#### 12. T2-11: RiskStatusPanel 강화 + 종합 리스크 점수
**파일**: `frontend/src/components/RiskStatusPanel.tsx`, `frontend/src/lib/risk.ts` (신규)
**변경**:
- `risk.ts`: `computeRiskScore(riskStatus)` — DD 40% + Exp 30% + CB 30%
  - CB 정규화: `tripped ? 100 : (consecutiveLosses / consecutiveLossLimit) * 100`
  - DD 정규화: `(drawdownPct / maxDrawdownPercent) * 100`
  - Exp 정규화: `utilizationPercent` (이미 0-100%)
- `RiskStatusPanel.tsx`:
  - 상단에 종합 리스크 점수 표시 (큰 숫자 + 색상 라벨: 안전/주의/위험)
  - progress bar 높이 `h-1.5` → `h-2.5`
  - 3색 코딩: emerald(0-40%), amber(40-70%), red(70-100%)
  - `aria-label` 접근성 속성 추가
  - `/api/risk/status`에서 `params` 반환 필요 → riskEngine.getStatus()에 params 포함

---

## 구현 순서 (최종 합의)

### Track A (Backend) — 순차 실행

```
T2-9 (10줄, 즉시) → T2-5 (strategyBase + gridStrategy)
→ T2-4 (fundingDataService 신규 + 연동)
→ T2-1 (indicators.js rsi 리팩토링)
→ T2-2 (signalFilter confidence 추가)
→ T2-3 (backtestEngine position size)
→ T2-7 (rateLimiter 신규 + app.js 적용)
```

### Track C (Frontend) — 순차 실행

```
T2-8 (rejectReason, 독립) → T2-12 (adaptive polling, T2-7 전에 완료)
→ T2-6 (useSocket useRef 최적화)
→ T2-10 (DrawdownChart 신규)
→ T2-11 (RiskStatusPanel 강화)
```

### Track 병렬성

Track A와 Track C는 **완전 병렬 실행 가능**. 유일한 교차 의존:
- T2-7 (rate limit) 배포 전에 T2-12 (adaptive polling) 완료 권장 (기존 5s 폴링이 rate limit에 안 걸리도록)
- T2-8 (rejectReason)은 T2-2 (confidence filtering) 없이도 독립 구현 가능 (기존 risk 거부 사유로 충분)

---

## 파일 변경 요약

### 신규 파일 (4개)
| 파일 | T2 ID | 설명 |
|------|-------|------|
| `backend/src/services/fundingDataService.js` | T2-4 | 펀딩비/OI REST polling 서비스 |
| `backend/src/middleware/rateLimiter.js` | T2-7 | In-memory sliding window rate limiter |
| `frontend/src/hooks/useAdaptivePolling.ts` | T2-12 | 봇 상태별 동적 폴링 훅 |
| `frontend/src/lib/drawdown.ts` | T2-10 | Drawdown 계산 유틸 |

### 신규 컴포넌트 (1개)
| 파일 | T2 ID | 설명 |
|------|-------|------|
| `frontend/src/components/DrawdownChart.tsx` | T2-10 | Drawdown 시각화 차트 |

### 신규 유틸 (1개)
| 파일 | T2 ID | 설명 |
|------|-------|------|
| `frontend/src/lib/risk.ts` | T2-11 | 종합 리스크 점수 계산 |

### 수정 파일 (14개)
| 파일 | T2 ID | 변경 유형 |
|------|-------|-----------|
| `backend/src/services/circuitBreaker.js` | T2-9 | recordTrade() 수정 |
| `backend/src/services/strategyBase.js` | T2-5, T2-4 | setAccountContext/getEquity/onFundingUpdate 추가 |
| `backend/src/strategies/indicator-light/gridStrategy.js` | T2-5 | getEquity() 사용 |
| `backend/src/services/botService.js` | T2-5, T2-4 | accountContext 주입 + funding 이벤트 라우팅 |
| `backend/src/backtest/backtestEngine.js` | T2-5, T2-3 | accountContext + position size |
| `backend/src/utils/indicators.js` | T2-1 | rsi() Wilder smoothing |
| `backend/src/services/indicatorCache.js` | T2-1 | smoothing param 전달 |
| `backend/src/services/signalFilter.js` | T2-2 | confidence filtering |
| `backend/src/utils/constants.js` | T2-4 | FUNDING_UPDATE 이벤트 |
| `backend/src/app.js` | T2-4, T2-7 | fundingDataService DI + rate limiter |
| `frontend/src/components/SignalFeed.tsx` | T2-8 | rejectReason 표시 |
| `frontend/src/lib/utils.ts` | T2-8 | translateRejectReason() |
| `frontend/src/hooks/useSocket.ts` | T2-8, T2-6 | payload 정규화 + useRef |
| `frontend/src/hooks/useBotStatus.ts` | T2-12 | adaptive polling |
| `frontend/src/hooks/usePositions.ts` | T2-12 | adaptive polling |
| `frontend/src/hooks/useTrades.ts` | T2-12 | adaptive polling |
| `frontend/src/hooks/useHealthCheck.ts` | T2-12 | adaptive polling |
| `frontend/src/components/RiskStatusPanel.tsx` | T2-11 | 강화 + 종합 점수 |
| `frontend/src/app/page.tsx` | T2-10 | DrawdownChart 추가 |

---

## 다음 단계

Phase 4 실행 시:
1. Track A (Backend 7건)와 Track C (Frontend 5건) 병렬 구현
2. 워크트리 또는 master 직접 작업 (선택)
3. 구현 후 BACKLOG 상태를 `done`으로 업데이트
4. KNOWLEDGE_INDEX 업데이트 (Phase 5)
5. md/ 문서 최신화 (Phase 6)
6. Commit & Push (Phase 7)
