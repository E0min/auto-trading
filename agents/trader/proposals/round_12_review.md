# Round 12 교차 리뷰 — Senior Quant Trader

> 리뷰 일시: 2026-02-17
> 리뷰 대상: Engineer 제안서 (16건), UI/UX 제안서 (13건)
> 기준: 트레이딩 수익/리스크 관점, 실전 운용 영향도

---

## Engineer 제안서 리뷰

### E12-1 [CRITICAL] MarketDataCache 만료 항목 미정리

**판정: ✅ 동의**

소스 확인 완료 (`marketDataCache.js` L23-30). `get()` 호출 시에만 만료 항목을 삭제하는 lazy eviction 패턴이 유일한 정리 경로이다. CoinSelector가 4시간마다 후보를 변경하면서 이전 심볼의 OI/funding 캐시가 영구 잔류하는 것은 사실이다. OI/funding 객체 크기를 감안하면 sweep 타이머 추가는 합리적이다. 60초 간격이면 충분하다.

---

### E12-2 [CRITICAL] CoinSelector.selectCoins() 재진입

**판정: ✅ 동의**

소스 확인 완료 (`coinSelector.js` L201, L343, L401-403). async 함수 내에서 `_prevVol24h`를 읽고(F7 Volume Momentum) 쓰는데, 이 사이에 다른 호출이 개입하면 momentum 계산이 부정확해진다. 트레이딩 관점에서 **코인 선정 점수가 1~2% 틀어지면 최적이 아닌 심볼이 상위에 올라올 수 있고**, 이는 전략 수익률에 직접 영향을 미친다.

단, BotService에 이미 `_reselectionInProgress` 가드가 존재한다(`botService.js` L163-164, L1870-1872). **따라서 BotService 레벨에서는 이미 중첩 호출이 차단되고 있다.** 문제는 CoinSelector 자체에 가드가 없어서 BotService 외부에서 직접 호출하는 경우(없을 가능성이 높지만)에만 해당한다. 심각도를 CRITICAL에서 **HIGH로 하향 조정하되**, 방어적 프로그래밍 차원에서 CoinSelector 자체에도 가드를 추가하는 것에 동의한다.

---

### E12-3 [HIGH] TickerAggregator._tickers Map 무한 성장

**판정: ✅ 동의**

`tickerAggregator.js` L108에서 `_tickers.set(data.symbol, data)`로만 추가하고 정리 로직이 없다. L148에서 `Array.from(this._tickers.values())`로 매번 전체 배열을 생성하는 것도 확인했다. 트레이딩 관점에서 stale 티커가 aggregate 통계(advancers/decliners/avgChange)에 포함되면 **시장 레짐 판단이 왜곡**될 수 있다. 마지막 업데이트 30분 경과 심볼 제거에 동의한다.

---

### E12-4 [HIGH] BotService._performCoinReselection() 중첩 실행 방지 없음

**판정: ❌ 반대 — 이미 구현되어 있음**

소스 직접 확인 결과, `botService.js` L163에 `_reselectionInProgress = false` 초기화, L1870에 `if (this._reselectionInProgress)` 가드, L1875에 `this._reselectionInProgress = true` 설정이 **이미 존재**한다. 주석에도 "R8-T2-4: Guard flag to prevent concurrent reselections"으로 명시되어 있다.

이 항목은 **이미 해결된 사항**이므로 구현 대상에서 제외해야 한다. Engineer가 이 가드를 놓친 것으로 보인다.

---

### E12-5 [HIGH] ExchangeClient._withRetry() — Rate Limit 대응

**판정: ⚠️ 조건부 동의**

소스 확인 완료 (`exchangeClient.js` L111-155). `_withRetry()`는 maxRetries=3으로 제한되어 있고, backoff는 1s, 2s, 4s로 적절하다. 무한 재시도는 아니다 -- 최대 3회 시도 후 throw한다.

Bitget의 rate limit 사양:
- REST API: 대부분 endpoint 20회/초, 일부 10회/초
- 429 응답 시 Retry-After 헤더가 공식적으로 보장되지 않음 (비공식)
- IP 기반 rate limit이며, 초과 시 1~60초 차단 가능

**보완 사항**:
1. Retry-After 헤더 파싱은 Bitget이 보장하지 않으므로 의존하지 말 것. 대신 rate_limit 에러 시 **고정 5초 대기** + 전역 cooldown이 더 현실적
2. "Thundering herd" 지적은 타당하나, 현재 단일 프로세스에서 동시 API 호출이 10개 이상 발생하는 경우는 CoinSelector의 enrichment 뿐이며, 여기에 이미 `runWithConcurrency(tasks, 3)` 제한이 있음
3. **전역 rate limit cooldown** 추가에 동의하되, 구현 범위를 최소화할 것: rate_limit 에러 발생 시 5초간 모든 REST 호출을 큐잉하는 간단한 메커니즘

---

### E12-6 [HIGH] RateLimiter timestamps shift() 성능

**판정: ⚠️ 조건부 동의 (우선순위 하향)**

소스 확인 완료 (`rateLimiter.js` L80-83). `Array.shift()`가 O(n)인 것은 맞으나, 현재 시스템이 **단일 클라이언트(프론트엔드 대시보드)** 이며 RPS가 최대 1-2/sec 수준이다. timestamps 배열 크기가 100을 넘기 어렵고, V8의 shift() 구현은 작은 배열에서 실질적으로 O(1)에 가깝다.

**보완**: 심각도를 T2에서 **T3(LOW)**로 하향. 현재 성능 병목이 아니며, 향후 다중 클라이언트 지원 시 재평가하면 충분하다.

---

### E12-7 [HIGH] OrderManager WS 재연결 fill 보상

**판정: ✅ 동의 — 트레이딩 관점에서 매우 중요**

이것은 실거래에서 **실제 돈이 걸린 문제**이다. WS 재연결 사이에 체결된 주문이 Trade DB에 미반영되면:
1. Analytics가 부정확해져 전략 성과 평가가 왜곡
2. PositionManager의 REST 동기화가 포지션 자체는 보정하지만, 진입/청산 가격과 수수료 정보는 Trade 레코드에만 있음
3. **누적 PnL 추적이 불가능해져 DrawdownMonitor의 equity 계산도 부정확**

Bitget의 REST 주문 이력 조회(`/api/v2/mix/order/fills`)는 eventual consistency가 거의 없으며 실시간에 가깝다. 재연결 시 최근 60초 fill 조회로 충분히 보상 가능하다.

구현 시 주의: 중복 fill 처리를 위해 `clientOid` 또는 `tradeId` 기반 idempotency 체크 필수.

---

### E12-8 [HIGH] PaperEngine mark price 기반 SL/TP 트리거

**판정: ⚠️ 조건부 동의**

트레이딩 관점에서 last price vs mark price 차이는 **일반 시장에서 0.01~0.05%**, 급변 시장에서 **0.5~2%** 수준이다. Bitget은 SL/TP 트리거 기준으로 last price와 mark price를 모두 지원하며, 기본값은 mark price이다.

**보완 사항**:
1. PositionManager에서 mark price를 이미 수신하고 있으므로(`positionManager.js` L436: `markPrice: String(raw.markPrice || ...)`) 데이터는 이미 존재
2. 페이퍼 트레이딩의 목적이 "라이브와 최대한 유사한 시뮬레이션"이므로 mark price 기반 트리거가 맞음
3. 다만 **우선순위를 T1에서 T2로 하향** 권장 -- 현재 주요 목표가 라이브 안정성이며, 페이퍼의 정밀도는 이후에 개선해도 됨

---

### E12-9 [MEDIUM] BotService.start() 실패 시 rollback

**판정: ✅ 동의**

`botService.js` L203-318 확인. 17단계 중간 실패 시 catch 블록에서 `_state = IDLE`만 설정하고 이미 시작된 서비스들을 정리하지 않는다. start() 실패 후 재시도하면 marketData, tickerAggregator, positionManager 등이 이중 시작되어 **이벤트 핸들러 중복 등록, 중복 WS 구독**이 발생한다.

트레이딩 관점: 봇 시작 실패 후 재시도 시나리오는 실전에서 흔하다(네트워크 불안정, API 일시 장애). rollback 미비로 인한 이중 구독은 **이중 시그널 생성 -> 이중 주문**의 위험이 있다.

---

### E12-10 [MEDIUM] PositionManager marginMode 삼항 수정

**판정: ✅ 동의**

`positionManager.js` L439 확인: `marginMode: raw.marginMode || raw.marginCoin ? 'crossed' : 'crossed'` -- 양쪽 모두 'crossed'이므로 의미 없는 코드이다. `raw.marginMode || 'crossed'`로 수정이 맞다. 5분 작업이며 리스크 없음.

---

### E12-11 [MEDIUM] BacktestEngine equityCurve 샘플링

**판정: ✅ 동의**

`backtestEngine.js` L906-914 확인. 매 kline마다 push하므로 1분봉 1년은 525,600 포인트. 메모리 문제도 있지만, 트레이딩 관점에서 **5,000 포인트면 equity curve의 시각적 표현과 drawdown 분석에 충분**하다. 사실 프론트엔드에서 이미 downsample하고 있다면 엔진 레벨에서도 5000개로 제한하는 것이 효율적이다.

**보완**: N개 간격 균등 샘플링보다 **peak/valley 보존 샘플링**을 권장한다. 최대 낙폭 지점의 정밀도가 중요하므로, 단순 N-th 추출은 최대 낙폭 계산 정확도를 떨어뜨릴 수 있다. 메트릭 계산은 원본으로, 저장/시각화용만 downsample하는 2-pass 접근 추천.

---

### E12-12 [MEDIUM] HealthCheck WS 상태 검사 깊이 부족

**판정: ✅ 동의 — 우선순위 상향 권장**

`healthCheck.js` L188-207 확인. `_checkWebsocket()`이 단순히 `exchangeClient._wsConnected` boolean만 체크한다. 마지막 메시지 수신 시간, 구독 토픽 수 등은 전혀 검사하지 않는다.

트레이딩 관점에서 **"좀비 연결"은 가장 위험한 장애 유형** 중 하나이다. WS가 연결은 되어 있지만 데이터가 오지 않으면 봇은 stale 가격으로 매매를 계속한다. 이는 잘못된 시그널 -> 손실로 직결된다. **T1에서 T0로 상향할 것을 강력히 권장한다.**

ExchangeClient에 `getWsStatus()` 추가 제안에 동의하며, 마지막 메시지 수신 후 **30초 이상 경과 시 warning, 120초 이상이면 자동 재연결** 트리거까지 고려할 것을 제안한다.

---

### E12-13 [MEDIUM] Logger context 크기 제한

**판정: ✅ 동의**

실전 운용에서 트러블슈팅 시 DEBUG 레벨을 켜야 하는 상황이 반드시 온다. 이때 I/O 병목으로 봇 성능이 저하되면 문제 진단이 더 어려워진다. context 크기 제한과 DEBUG 샘플링은 합리적인 개선이다.

---

### E12-14 [LOW] BacktestRoutes 동시 실행 수 제한

**판정: ✅ 동의**

`backtestRoutes.js` L95 확인. `setImmediate(async () => { ... })` 로 비동기 실행하므로 동시 요청 제한이 없다. BacktestEngine의 kline 순회는 CPU-intensive이므로 동시 5개 실행 시 라이브 봇의 이벤트 루프가 영향을 받을 수 있다.

**보완**: MAX_CONCURRENT_BACKTESTS = 2 제안에 동의. 추가로 **라이브 봇이 RUNNING 상태일 때는 MAX를 1로 제한**하는 것을 권장한다. 라이브 트레이딩과 백테스트가 동시에 CPU를 경쟁하면 시그널 처리 지연이 발생할 수 있다.

---

### E12-15 [LOW] InstrumentCache staleness 경고

**판정: ✅ 동의**

`instrumentCache.js` L101-107 확인. 연속 실패 시 stale lot step으로 주문이 나가면 거래소가 거부한다. RiskEvent 발생과 healthCheck 반영은 적절한 개선이다.

---

### E12-16 [LOW] CoinSelector _prevVol24h 정리

**판정: ✅ 동의**

`coinSelector.js` L401-403 확인. 메모리 영향은 미미하지만 cleanup 추가는 좋은 코드 위생 습관이다.

---

## UI/UX 제안서 리뷰

### R12-FE-01 [HIGH] useSocket 더블 acquireSocket 문제

**판정: ✅ 동의**

`useSocket.ts` L122와 `useMarketIntelligence.ts` L112에서 동일 `REGIME_CHANGE` 이벤트에 두 핸들러가 등록되는 것을 확인했다. 트레이딩 관점에서 레짐 변경은 **전략 활성화/비활성화를 결정하는 핵심 이벤트**이므로 이중 처리로 인한 불필요한 리렌더가 성능에 영향을 줄 수 있다. 특히 레짐이 빠르게 변동하는 volatile 시장에서 대시보드 반응성이 중요하다.

---

### R12-FE-02 [HIGH] PerformanceTabs 탭 전환 시 데이터 새로고침 부재

**판정: ✅ 동의 — 트레이더 워크플로우에서 중요**

`PerformanceTabs.tsx` L43, L100-103 확인. 한번 로드된 탭은 세션 변경 전까지 갱신되지 않는다. 트레이더가 봇 실행 중에 전략별/심볼별 성과를 모니터링하는 것은 **핵심 워크플로우**이다. 실시간 성과 추적 없이는 전략 활성화/비활성화 결정을 내릴 수 없다.

**방법 B (stale-while-revalidate) 권장**: 캐시된 데이터를 먼저 보여주고 백그라운드에서 갱신하면 UX가 매끄럽다. 폴링 간격은 30초면 충분하다 -- 10초는 과도하고 서버 부담이 될 수 있다.

---

### R12-FE-03 [MEDIUM] handleClosePosition addToast 의존성 누락

**판정: ✅ 동의**

`page.tsx` L97-114 확인. `addToast`가 의존성 배열에 없다. useCallback으로 래핑된 `addToast`는 참조가 안정적이므로 실질적 버그는 아니지만, React hooks 규칙 준수와 잠재적 stale closure 방지를 위해 추가하는 것이 맞다. 10분 작업이며 리스크 없음.

---

### R12-FE-04 [MEDIUM] BacktestForm setInterval 변수 섀도잉

**판정: ✅ 동의**

`BacktestForm.tsx` L57 확인: `const [interval, setInterval] = useState('15m')`. 전역 `window.setInterval`을 섀도잉한다. 실제 버그는 아니지만 코드 명확성을 위해 `setIntervalValue` 또는 `[timeframe, setTimeframe]`로 변경하는 것이 좋다.

트레이딩 관점 보완: 백테스트에서 `interval`보다 `timeframe`이 더 정확한 용어이다. 트레이더들은 캔들 주기를 "타임프레임"이라고 부른다. `[timeframe, setTimeframe]`를 권장한다.

---

### R12-FE-05 [MEDIUM] useBacktest 폴링이 useAdaptivePolling 미사용

**판정: ✅ 동의**

`useBacktest.ts` L73-94 확인. 1초 간격 수동 setInterval이고 Page Visibility API를 미적용한다. 백테스트 실행 중 탭을 백그라운드로 보내도 1초 폴링이 계속되는 것은 낭비이다. `document.hidden`일 때 5초 간격으로 늘리는 최소 변경에 동의한다.

---

### R12-FE-06 [MEDIUM] SignalFeed 모바일 반응형

**판정: ⚠️ 조건부 동의**

`SignalFeed.tsx` L29-65 확인. `flex items-center justify-between`으로 한 줄 배치이고 요소가 많다.

**보완**: 트레이더가 모바일로 대시보드를 모니터링하는 경우가 실제로 많다 (외출 중 긴급 확인). 2줄 레이아웃 제안에 동의하되, **1줄에 action + symbol + confidence, 2줄에 strategy + risk status + time** 순서를 권장한다. Confidence가 트레이더에게 더 중요한 정보이므로 1줄에 포함시켜야 한다.

---

### R12-FE-07 [MEDIUM] AccountOverview value flash 효과

**판정: ✅ 동의 — 트레이더 관점에서 높은 가치**

`AccountOverview.tsx` 확인. `animate-number-up`이 최초 마운트 시에만 적용되고 이후 값 변경 시에는 효과 없다.

**UI/UX에게 응답 (R12-FE-07 관련 질문)**:

트레이더가 가장 먼저 인지해야 할 값의 우선순위:
1. **미실현 PnL** -- 가장 빈번하게 변하고, 즉각적 행동(포지션 청산)을 유발
2. **총 자산 (Equity)** -- 전체 포트폴리오 상태의 요약
3. **활성 포지션 수** -- 새 포지션 진입/청산을 즉시 인지

flash 효과는 **미실현 PnL에 가장 먼저 적용**하고, 색상도 직관적이어야 한다 (초록=이익 증가, 빨강=손실 증가). 총 자산은 변동 폭이 작으므로 미미한 flash만, 포지션 수 변경은 bold한 효과가 좋다.

---

### R12-FE-08 [MEDIUM] PositionsTable 전략 컬럼 추가

**판정: ✅ 동의 — 강력 권장**

`PositionsTable.tsx` L53-64 확인. 전략 컬럼이 없다. 18개 전략이 다중 심볼에서 동시 운용될 때 **어떤 전략이 어떤 포지션을 관리하는지 모르면 의사결정이 불가능**하다.

예를 들어 ETH 롱 포지션이 -3%인데 이것이 MaTrend의 추세추종인지 RSIPivot의 반전 매매인지에 따라 트레이더의 판단이 완전히 달라진다 (추세추종은 보유 유지, 반전 매매는 즉시 청산 등).

**보완**: "레버리지" 컬럼을 숨기는 대신 "전략" 컬럼 추가 제안에 동의한다. 레버리지는 현재 모든 포지션이 동일 레버리지이므로 개별 컬럼 불필요.

---

### R12-FE-09 [MEDIUM] TradingModeToggle 에러 무시

**판정: ✅ 동의 — 심각도 상향 권장**

`TradingModeToggle.tsx` L26-38 확인. Paper -> Live 전환은 **실제 자금이 투입되는 결정**이다. 이 전환이 실패했는데 사용자에게 알림이 없으면, 사용자는 "라이브로 전환되었다"고 착각하거나 반대로 "아직 페이퍼"라고 착각할 수 있다. 두 경우 모두 잘못된 의사결정으로 이어진다.

**심각도를 MEDIUM에서 HIGH로 상향할 것을 권장한다.** `onError` prop 추가 또는 내부 에러 상태 표시가 반드시 필요하다.

---

### R12-FE-10 [MEDIUM] SymbolRegimeTable과 StrategySymbolMap 중복

**판정: ⚠️ 조건부 동의**

두 컴포넌트가 심볼별 레짐 정보를 중복 표시하는 것은 맞다. 그러나 트레이더 관점에서 두 컴포넌트의 **정보 밀도가 다르다**:
- `StrategySymbolMap`: 전략-심볼 매핑이 핵심 (어떤 전략이 어떤 심볼을 담당하는지)
- `SymbolRegimeTable`: 심볼별 레짐 신뢰도와 상태가 핵심 (시장 분석용)

**보완**: 방법 B (접기/펼치기) 권장. 완전 통합은 정보 성격이 달라 부적절하다. `SymbolRegimeTable`을 기본 접힌 상태로 두되, 레짐 변경 시 자동 펼침 트리거를 추가하면 트레이더에게 유용하다.

---

### R12-FE-11 [LOW] DrawdownChart gradientId 충돌

**판정: ✅ 동의**

현재 문제는 아니지만 `useId()` 적용은 10분 작업이며 방어적 코드이다.

---

### R12-FE-12 [MEDIUM] tournament/page.tsx 분할

**판정: ✅ 동의**

441줄에 4개 컴포넌트가 한 파일에 있는 것은 유지보수성 측면에서 분할이 맞다. 트레이딩 관점에서 직접적 영향은 없으므로 Deferred 유지에 동의한다.

---

### R12-FE-13 [MEDIUM] 백테스트 결과 비교 기능

**판정: ✅ 동의 — 장기적으로 필수**

**UI/UX에게 응답 (R12-FE-13 관련 질문)**:

전략 비교 시 가장 중요한 메트릭 5개 (우선순위 순):

1. **Risk-Adjusted Return (Sharpe Ratio)** -- 리스크 대비 수익의 효율성. 단순 수익률보다 중요
2. **Maximum Drawdown (%)** -- 전략이 견뎌야 하는 최악의 상황. 심리적/자본 관리 한계와 직결
3. **Profit Factor** -- 총 이익 / 총 손실. 1.5 이상이 실전 운용 가능 기준
4. **Win Rate + Average Win/Loss Ratio** -- 승률 단독은 의미 없고, 평균 손익비와 함께 봐야 함. (높은 승률 + 낮은 손익비 = 꼬리 리스크)
5. **Total Return (%)** -- 절대 수익률. 다른 메트릭이 동일하면 최종 결정 기준

제안된 "총 수익률, 승률, 최대 낙폭, 샤프 비율, 수익 팩터"에서 **승률 대신 평균 손익비(Avg Win / Avg Loss)**를 포함하는 것을 권장한다. 또는 둘 다 포함하여 6개 메트릭으로 확장해도 좋다.

---

## 종합 의견 및 보완 제안

### 1. 우선순위 재조정 권장

| 항목 | 제안 심각도 | 트레이더 권장 심각도 | 사유 |
|------|-----------|-------------------|------|
| E12-4 | HIGH | ❌ 제외 | 이미 구현됨 |
| E12-6 | HIGH | LOW | 현재 병목 아님 |
| E12-8 | HIGH | MEDIUM | 페이퍼 정밀도는 라이브 안정성 이후 |
| E12-12 | MEDIUM | **HIGH (T0)** | 좀비 WS는 실거래 손실 직결 |
| R12-FE-09 | MEDIUM | **HIGH** | 모드 전환 실패 미감지 = 자금 리스크 |

### 2. Engineer 질문 응답

**E12-5 (Rate Limit)**: Bitget 공식 한도는 20 req/sec (대부분 endpoint). 실전에서 초당 5~8건 수준이면 안전하다. 429 시 **5초 고정 대기** 후 재시도가 현실적이다. Retry-After 헤더는 비공식이므로 의존하지 말 것.

**E12-7 (WS Fill 보상)**: WS 재연결은 10~30초 내에 완료되는 경우가 대부분이다. 60초 범위 fill 조회면 충분하다. REST 주문 이력의 eventual consistency는 1~2초 수준으로 무시해도 된다. fill 누락 빈도는 장기 운용 시 주 1~2회 발생할 수 있다.

**E12-8 (Mark Price SL/TP)**: 일반 시장에서 last price vs mark price 차이는 0.01~0.05%로 SL/TP 트리거에 무의미하다. 그러나 급변 시(청산 캐스케이드 등) 1~2% 차이가 발생하며, 이때 last price 기반 SL이 mark price 기반보다 먼저 트리거되어 **불필요한 조기 손절**이 발생할 수 있다.

### 3. 이번 Sprint 핵심 실행 항목 (트레이더 관점)

수익/리스크 영향도 기준으로 이번 스프린트에서 반드시 포함해야 할 항목:

**Backend 필수 (Track A)**:
1. E12-1: MarketDataCache sweep (메모리 안정성)
2. E12-2: CoinSelector 재진입 가드 (코인 선정 정확성)
3. E12-7: WS 재연결 fill 보상 (실거래 PnL 정확성)
4. E12-12: HealthCheck WS 깊이 검사 (좀비 연결 방지 -- T0 상향)
5. E12-10: marginMode 삼항 수정 (5분 수정)

**Frontend 필수 (Track C)**:
1. R12-FE-08: PositionsTable 전략 컬럼 (트레이더 필수 정보)
2. R12-FE-09: TradingModeToggle 에러 표시 (자금 안전)
3. R12-FE-03: addToast 의존성 수정 (10분 버그 방지)
4. R12-FE-07: AccountOverview value flash (실시간 모니터링)

### 4. 누락 사항 보완

내 자체 제안서(round_12.md)에서 제기한 **F12-1 (이중 트레일링 스탑)**과 **F12-3 (백테스트 레버리지 미반영)**은 이번 스프린트의 핵심 실행 대상이어야 한다. 특히:
- F12-1은 E12-7 (WS fill 보상)보다 구현이 간단하면서 (metadata에서 `trailingStop.enabled = false` 설정만으로 해결) 이중 청산 시도를 즉시 차단한다
- F12-3은 백테스트 결과의 신뢰성을 좌우하므로, 백테스트 기반 전략 최적화가 의미를 가지려면 반드시 필요하다
