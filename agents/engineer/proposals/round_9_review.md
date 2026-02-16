# Round 9 교차 리뷰 — Engineer

> **Agent**: Senior Systems Engineer (시스템 무결성)
> **Date**: 2026-02-17
> **Reviewing**: Trader 제안서 (860줄) + UI/UX 제안서 (617줄)
> **Context**: 자체 제안서(round_9.md)와 비교하여 시스템 안정성 관점 판정

---

## Trader 제안서 리뷰

### R8-T2-1: 멀티심볼 라우팅 Phase 1 — 전략마다 다른 단일 심볼 배정

**조건부 동의**

Trader의 분석은 정확하다. `strategyRouter.js:161`에서 `symbols[0]` 고정, 18개 전략이 사실상 1개 코인에 집중 투자되는 구조적 결함을 올바르게 식별했다. 구현 방안의 큰 틀(라운드 로빈/스코어 기반 배정, `_symbolAssignment` Map, `maxStrategiesPerSymbol`)도 합리적이다.

**시스템 안정성 보완 필요 사항:**

1. **동시성 보호 누락**: Trader 제안에는 `_assignSymbols()` 실행 중 시그널 발행에 대한 가드가 없다. `_routeStrategies()`에서 전략을 순회하며 `activate(newSymbol)` 하는 동안 다른 전략이 이전 심볼로 시그널을 발행할 수 있다. Node.js가 단일 스레드이므로 동기 코드 내에서는 문제가 없으나, `updateSymbols()` 호출 시 `deactivate()` -> `activate()` 사이에 이벤트 루프가 양보되면 위험하다. **해결**: `deactivate()`와 `activate()` 사이에 비동기 코드가 끼지 않도록 보장하거나, `_symbolUpdateInProgress` 플래그를 도입하여 시그널 핸들러에서 체크.

2. **BTCUSDT 예약 정책의 부작용**: Trader는 "BTCUSDT는 MarketRegime 전용으로 예약 (전략 배정 제외)"라고 제안했으나, 이는 BTC에서 강한 트렌드 시그널이 발생해도 거래할 수 없다는 의미. **대안**: BTCUSDT를 배정 제외하지 말고, MarketRegime이 항상 BTC 데이터를 구독하되 전략 배정 대상으로도 허용. 이미 `marketData.subscribeSymbols()`에서 BTCUSDT를 항상 포함하므로 데이터 중복 구독 문제는 없다.

3. **`_symbolAssignment` Map의 정리**: `_symbolAssignment.clear()`를 호출하면 이전 매핑 정보가 소실된다. 포지션이 열려 있는 전략의 매핑이 사라지면 `_closeStrategyPositions()`에 영향을 줄 수 있다. **권장**: clear 대신 새 매핑으로 덮어쓰되, 포지션이 열려 있는 전략의 이전 심볼 매핑은 보존.

4. **에러 핸들링**: 코인이 5개인데 전략이 18개인 현실적 시나리오에서 라운드 로빈은 3~4개 전략이 동일 심볼을 공유하게 된다. 이때 `maxStrategiesPerSymbol = 3` 제한을 초과하면 일부 전략이 심볼 없이 남는 경우 어떻게 처리할지 명시 필요. **제안**: 초과 전략은 가장 유동성이 높은 심볼에 배정 (오버플로 풀).

**판정**: 조건부 동의. 위 1, 3번은 구현 시 반드시 반영 필요.

---

### R8-T2-2: 전략 warm-up 기간 (warmupCandles 메타데이터)

**동의**

Trader의 분석이 정확하고 상세하다. 18개 전략의 warmupCandles 값 테이블(line 183-201)도 합리적인 근거가 제시되어 있다.

**보완 사항 (minor)**:

1. Trader는 "BotService의 `onKlineUpdate` 핸들러에서 카운트 관리"를 제안했는데, 이것이 자체 제안서에서 논의한 `emitSignal()` 내부 게이트보다 약한 방어이다. kline 카운트와 시그널 차단이 분리되면 타이밍 불일치가 발생할 수 있다. **권장**: BotService에서 카운트 관리 + StrategyBase의 `emitSignal()`에서 이중 체크 (벨트 앤 서스펜더).

2. `activate()` 시 `_klineCount` 리셋을 Trader가 명시적으로 언급하지 않았다. 레짐 변경으로 전략이 deactivate -> activate 되면 warm-up을 처음부터 다시 해야 할 수 있다 (새 심볼 배정 가능성). **필수**: `activate()`에서 `_klineCount = 0`, `_warmedUp = false` 리셋.

**판정**: 동의. 위 2번은 구현 시 필수 반영.

---

### R8-T2-3: 펀딩비 PnL 반영 (WS account + 백테스트)

**조건부 동의**

Trader의 3파트 구분(라이브/Paper/백테스트)이 체계적이다. 특히 "equity에 이미 포함된 값이므로 이중 계산 금지"라는 핵심 원칙을 자체 제안서와 동일하게 식별했다.

**시스템 안정성 보완:**

1. **WS account 데이터 연동과 커넥션 안정성**: Trader가 `positionManager.js`에 `accumulatedFunding` 파싱을 추가하는 방안을 제시했는데, 현재 `_handleWsAccountUpdate()` (L319-350)는 `equity/availableBalance/unrealizedPnl` 3개 필드만 파싱한다. 추가 필드 파싱 자체는 커넥션에 영향 없다 (수신 데이터의 파싱일 뿐). **안전**.

2. **Bitget WS `account` 토픽에 `fundingFee` 필드 존재 여부 미확인**: Trader는 "REST API `settleProfit` 필드로 조회 가능"이라고 언급했지만, WS에서 실시간으로 받을 수 있는지는 SDK 문서 확인이 선행되어야 한다. WS에 없으면 REST 폴링이 필요한데, 이는 8시간 주기 × 포지션 수만큼 REST 호출 = rate limit 소모. **요구**: 구현 전 Bitget WS account 토픽의 필드 목록을 확인하고, WS에서 불가능하면 `fundingDataService`의 기존 5분 폴링 주기에 편승하여 펀딩비 정산 감지.

3. **백테스트 펀딩비 시뮬레이션**: Trader의 `i % this.fundingIntervalBars === 0` 로직은 kline 간격에 의존한다. 1분 봉 기준 `8 * 60 = 480 bars`이지만, 백테스트가 5분 봉을 사용할 수도 있으므로 `_calculateFundingInterval(interval)`이 올바르게 구현되어야 한다. Trader가 이 메서드를 언급했으므로 인지하고 있다. **OK**.

4. **Paper 모드 펀딩비**: Trader의 "FUNDING_UPDATE 이벤트 수신 시 펀딩비 적용" 방안은 합리적이나, Paper 포지션의 `markPrice`가 실시간으로 업데이트되지 않을 수 있다. Paper에서는 마지막 ticker 가격을 사용하므로 약간의 오차 존재. 이는 수용 가능한 수준.

**판정**: 조건부 동의. 2번(Bitget WS 필드 확인) 선행 필수.

---

### R8-T2-4: 코인 재선정 주기 (4~8시간 고정 간격)

**조건부 동의**

Trader의 구현 방안이 상세하고, 특히 "열린 포지션이 있는 심볼 제거 금지" 주의사항을 명시한 점이 좋다.

**시스템 안정성 보완:**

1. **레이스 컨디션 위험 — 핵심 이슈**: Trader의 `_reselectCoins()` 메서드는 `async`이다. `coinSelector.selectCoins()`가 await하는 동안 이벤트 루프가 양보되고, 이 사이에 `onTickerUpdate` -> `strategy.onTick()` -> 시그널 발행 -> `orderManager.submitOrder()`가 발생할 수 있다. 이때 전략이 아직 이전 심볼에 바인딩되어 있으므로 이전 심볼에 대한 주문이 제출된다. 이것 자체는 문제가 아니지만(주문은 유효), **직후 `strategyRouter.updateSymbols()`가 호출되면 이전 심볼의 포지션을 추적하지 못할 수 있다**.

   **해결 방안**: 자체 제안서에서 제안한 단계적 접근이 더 안전하다.
   ```
   (1) 새 심볼 목록 계산
   (2) 새 심볼 구독 (기존 유지)
   (3) 열린 포지션이 있는 제거 대상 심볼을 보호 목록에 추가
   (4) strategyRouter.updateSymbols() — deactivate -> activate
   (5) 보호 목록에 없는 이전 심볼 구독 해제
   ```

2. **`marketData.unsubscribeSymbols()` 사용 누락**: Trader는 "현재 `marketData.subscribeSymbols()`는 추가만 지원하고 해제는 미지원. 메모리 누수 방지를 위해 `unsubscribeSymbols()` 추가 필요 (Phase 2)"라고 적었으나, **`marketData.js:178`에 `unsubscribeSymbols()` 메서드가 이미 존재한다**. `_subscribedSymbols.delete(symbol)` + `_latestTickers.delete(symbol)` 처리까지 구현되어 있다. Phase 2로 미루지 말고 즉시 사용해야 한다. 미사용 시 구독 누적으로 WS 메시지 과부하 발생.

3. **unref() 사용**: Trader가 `setInterval.unref()`를 사용하여 프로세스 종료를 차단하지 않도록 한 점은 좋다.

4. **재선정 중 봇 정지 경합**: `_reselectCoins()`가 await 중에 `stop()`이 호출되면 `_coinReselectInterval`이 clear되지만 진행 중인 `_reselectCoins()` 비동기 작업은 계속 실행된다. **해결**: `_reselectCoins()` 시작 시 `if (!this._running) return;` 가드, 그리고 주요 단계(구독, 라우터 업데이트)마다 동일 가드 삽입.

**판정**: 조건부 동의. 2번(unsubscribeSymbols 즉시 사용)은 필수 수정, 1번과 4번은 구현 시 반드시 반영.

---

### R8-T2-5: Paper 모드 trading-mode 전환 경고 강화

**동의**

Trader의 구현 방안은 간단하고 안전하다. `force` 파라미터 지원, 포지션 확인 로직 모두 합리적이다. 자체 제안서의 "paper -> live가 위험, live -> paper는 안전" 관점과 상호 보완된다.

**minor 보완**: Trader는 live -> paper 전환 시 라이브 포지션 경고에만 집중했는데, paper -> live 전환 시에도 `exchangeClient` 연결 상태 확인이 있으면 좋다(API 키 유효성). 자체 제안서에서 이미 언급했으므로 합산 구현.

**판정**: 동의.

---

### R8-T2-6: StateRecovery + OrphanOrderCleanup 활성화

**동의**

Trader의 DI 주입 + Paper 모드 조건부 활성화 방안은 자체 제안서와 일치한다.

**보완 사항 (구현 시 반영)**:

1. **OrphanOrderCleanup 거짓 양성 방어 누락**: Trader 제안에서는 orphan 감지 기준에 age 필터가 언급되지 않았다. 현재 `orphanOrderCleanup.js:145-195` 코드를 보면 `order.cTime` (생성 시간) 확인 없이 DB 매칭 실패만으로 orphan으로 판정한다. 봇이 방금 넣은 주문이 DB에 아직 기록되기 전에 cleanup 사이클이 돌면 정상 주문을 취소할 수 있다. **필수**: `cTime` 기반 age 필터 추가 (최소 2분 경과 주문만 orphan 판정).

2. **StateRecovery 실행 시점**: Trader는 "step 4(positionManager.start) 이전"을 제안했는데, 이는 WS 연결 이후여야 한다 (REST API로 거래소 상태 확인). 자체 제안서의 "step 2.5 (WS 연결 후, 전략 생성 전)" 제안과 호환된다. 어느 쪽이든 `positionManager.start()` 이전이면 OK.

**판정**: 동의. 1번(age 필터)은 필수 추가.

---

### R8-T0-5: PositionManager 전략 메타데이터 주입 (deferred 재활성화)

**동의 — 재활성화 권장**

Trader의 분석이 핵심 문제를 정확히 짚었다: `_closeStrategyPositions()`에서 `p.strategy === strategyName`으로 필터링하는데, live PositionManager에는 `strategy` 필드가 없어 **라이브 모드에서 전략 비활성화 시 포지션 청산이 작동하지 않는다**. 이는 현재도 존재하는 버그이며, 멀티심볼 도입 시 더 치명적이 된다.

**시스템 안정성 관점 보완:**

1. **1:N 매핑 문제**: Trader가 인식한 "동일 심볼+posSide에 여러 전략"은 Phase 1에서 발생 가능하다. Trader의 "last-write-wins" 접근은 데이터 손실 위험이 있다. **대안**: `Map<positionKey, Set<string>>` (1:N 매핑)으로 시작하고, 청산 시 가장 최근 전략부터 청산 큐에 넣는 방식. 다만 이는 복잡도가 높으므로, Phase 1에서는 **T2-1 (멀티심볼)로 전략별 심볼이 다르면 `symbol:posSide` 키로 1:1 매핑이 대부분 보장**된다는 Trader의 전제가 맞다.

2. **`_strategyMapping` Map의 생명주기**: 봇 재시작 시 Map이 초기화되므로 이전 세션의 포지션 매핑이 소실된다. StateRecovery(T2-6)와 연계하여 매핑 정보도 복구하거나, DB에 persist하는 방안이 Phase 2에서 필요.

3. **`clientOid` 인코딩 방안(자체 제안서)**: Trader의 Map 방식과 자체 제안의 clientOid 방식 중 **Map 방식이 Phase 1에서 더 단순하고 안전**하다. clientOid는 Bitget 최대 길이(64자)에 전략명 인코딩 시 전략명 truncation 위험이 있다. Map 방식 채택 권장.

**판정**: 동의. Map 기반 `_strategyMapping`으로 Phase 1 구현.

---

### R8-T1-1: InstrumentCache 심볼별 lot step (deferred 재활성화)

**동의 — 재활성화 필수**

Trader의 분석과 구현 방안이 자체 제안서와 거의 일치한다. 특히 `exchangeClient.getInstruments()` 메서드가 이미 존재한다는 점과 24시간 갱신 주기가 적절하다는 점에서 동의.

**minor 보완:**

1. Trader의 `InstrumentCache` 클래스에서 `lotStep` 파싱 시 `inst.sizeMultiplier || inst.lotSz || inst.minTradeNum`으로 여러 필드를 fallback 하는데, Bitget REST API의 실제 응답 필드명을 확인해야 한다. `getFuturesContractConfig()` 응답에서 사용하는 정확한 필드명은 `sizeMultiplier`가 맞는지 SDK 레벨에서 검증 필요.

2. **캐시 미스 안전성**: `getLotStep(symbol)`에서 캐시 미스 시 기본값 `'0.0001'` 반환은 안전하지 않을 수 있다 (DOGE 같은 코인은 lotStep이 1). **대안**: 캐시 미스 시 경고 로그 + 보수적 기본값 `'1'` (과소 수량 → 주문 가능, 과대 수량 → 주문 거부보다 안전). 또는 `refresh()` 완료 전에는 주문 차단.

**판정**: 동의. T2-1의 선행 조건으로 필수 구현.

---

## UI/UX 제안서 리뷰

### R8-T2-8: StrategyCard toggle 접근성 수정

**동의**

분석이 정확하다. `<button>` 안에 interactive `<div role="switch" onClick>`이 중첩된 것은 HTML 규격 위반(WCAG 4.1.2)이며, 구조적 분리(두 개의 독립 `<button>`)가 올바른 해결 방안이다.

**시스템 관점**: API 호출 빈도에 영향 없음. `stopPropagation()` 제거로 이벤트 버블링 관련 잠재적 버그도 해소. 안전한 변경.

**판정**: 동의.

---

### R8-T2-9: MarketRegimeIndicator 중복 코드 정리 (삭제)

**동의**

`page.tsx`에서 import되지 않고, MarketIntelligence에 동일 기능이 인라인으로 존재함을 확인했다. 삭제 전 `grep -r "MarketRegimeIndicator"` 확인이 필요하다는 UI의 제안에 동의한다.

**시스템 관점**: 빌드 깨짐 위험만 주의. 삭제 후 `npm run build` 확인 필수.

**판정**: 동의.

---

### R8-T2-10: 대시보드 헤더 모바일 반응형

**동의**

UI의 최소 필요 너비 계산(~976px)이 정량적이며, 브레이크포인트 전략(`lg:` 1024px)이 합리적이다.

**성능 관점**: `flex-col` -> `flex-row` 전환은 CSS-only이므로 JavaScript 리렌더 없음. `hidden sm:flex`로 조건부 렌더링이 CSS 레벨에서 처리되므로 React 렌더 트리에는 영향 없음. **성능 영향 없음**.

**minor 보완**: 모바일에서 백테스트/토너먼트 링크를 `hidden sm:flex`로 숨기면, 640px 미만에서 이 페이지들에 접근할 방법이 없다. 햄버거 메뉴 또는 하단 탭 같은 대안 네비게이션이 필요할 수 있으나, 현재 3개 페이지뿐이므로 Phase 2로 미뤄도 무방하다.

**판정**: 동의.

---

### R8-T2-11: AccountOverview 모바일 레이아웃

**동의**

총 자산 overflow 문제(모노스페이스 14자 x 15px = 210px > 가용 163.5px)의 정량적 분석이 좋다. 총 자산을 전체 너비로 분리하는 해결책이 합리적이다.

**성능 관점**: `grid` -> `space-y-4` + 내부 `grid-cols-3` 변경은 CSS-only. 추가 컴포넌트 생성 없음. **성능 영향 없음**.

**판정**: 동의.

---

### R8-T2-12: RegimeFlowMap 모바일 대응

**동의**

고정 px + fr 혼합 그리드(`grid-cols-[140px_1fr_1fr_1fr]`)가 모바일에서 1fr 열을 ~59px로 압축하는 문제를 정확히 분석했다.

**성능 관점**: `grid-cols-1` -> `lg:grid-cols-[...]` 전환은 CSS-only. 하단 매트릭스의 `grid-cols-3 sm:grid-cols-5` 변경으로 모바일에서 5개 아이템이 2행으로 reflow되지만, DOM 요소 수는 5개로 동일하므로 성능 영향 없다. RegimeFlowMap은 MarketIntelligence 내부 탭이므로 lazy 렌더 가능하지만, 현재 조건부 렌더(`{activeTab === 'routing' && ...}`)가 이미 적용되어 있다면 추가 최적화 불필요.

**판정**: 동의.

---

## 핵심 이견 사항

### 1. R8-T2-4 — `marketData.unsubscribeSymbols()` 존재 여부

- **Trader 주장**: "`marketData.subscribeSymbols()`는 추가만 지원하고 해제는 미지원. `unsubscribeSymbols()` 추가 필요 (Phase 2)."
- **실제**: `marketData.js:178-199`에 `unsubscribeSymbols()` 메서드가 **이미 구현되어 있다**. `_subscribedSymbols.delete(symbol)` + `_latestTickers.delete(symbol)` + WS unsubscribe까지 완전히 구현됨.
- **결론**: Trader의 오류. 코인 재선정(T2-4) 구현 시 `marketData.unsubscribeSymbols(removedSymbols)` 를 반드시 호출해야 한다. Phase 2로 미루면 WS 메시지 누적으로 CPU/메모리 부하가 증가한다.

### 2. R8-T2-1 — BTCUSDT 전략 배정 제외 정책

- **Trader 주장**: "BTCUSDT는 MarketRegime 전용으로 예약 (전략 배정 제외)."
- **Engineer 의견**: BTC는 가장 유동성이 높고 스프레드가 좁은 심볼이므로 전략 배정에서 제외하면 최적 거래 기회를 포기하는 것이다. MarketRegime은 BTC kline을 데이터 소스로만 사용할 뿐, 전략이 BTC에서 거래한다고 충돌이 발생하지 않는다.
- **제안**: BTCUSDT 배정 제한이 아닌, BTCUSDT에 배정 가능한 전략 수 제한(maxStrategiesPerSymbol로 자연 제한)이 더 적절.

### 3. R8-T0-5 — Phase 1 매핑 전략 (last-write-wins vs 1:N)

- **Trader 주장**: "Phase 1에서는 마지막으로 주문한 전략으로 매핑 (last-write-wins)."
- **Engineer 의견**: T2-1 (멀티심볼)로 전략별 다른 심볼이 배정되면 대부분 1:1 매핑이므로 last-write-wins도 수용 가능. 단, 같은 심볼에 2+ 전략이 배정된 경우 데이터 손실 위험. **타협점**: `Map<positionKey, string>` (1:1)로 시작하되, 덮어쓰기 시 warn 로그를 남겨 Phase 2에서 1:N 전환 필요성 판단 근거로 활용.

---

## 공통 확인 사항

### 3자 동의 (합의 완료)

| 항목 | Trader | Engineer | UI | 합의 |
|------|--------|----------|----|------|
| R8-T2-1 (멀티심볼) | 구현 | 조건부 동의 (동시성 보호) | FE 영향도 HIGH | **3/3 합의, 조건부** |
| R8-T2-2 (warm-up) | 구현 | 동의 | FE 배지 표시 가능 | **3/3 합의** |
| R8-T2-3 (펀딩비 PnL) | 구현 | 조건부 동의 (WS 필드 확인) | FE 컬럼 추가 가능 | **3/3 합의, 조건부** |
| R8-T2-4 (코인 재선정) | 구현 | 조건부 동의 (unsubscribe, 레이스 컨디션) | FE 카운트다운 가능 | **3/3 합의, 조건부** |
| R8-T2-5 (Paper 전환 경고) | 구현 | 동의 | FE ConfirmDialog 연동 | **3/3 합의** |
| R8-T2-6 (StateRecovery) | 구현 | 동의 (age 필터 추가) | FE 무영향 | **3/3 합의** |
| R8-T0-5 (전략 매핑 재활성화) | 재활성화 | 동의 | FE 배지 활용 가능 | **3/3 합의** |
| R8-T1-1 (InstrumentCache 재활성화) | 재활성화 | 동의 (필수) | FE 중립 | **3/3 합의** |
| R8-T2-8 (StrategyCard 접근성) | 우선순위 높음 | 동의 | 구현 | **3/3 합의** |
| R8-T2-9 (MarketRegimeIndicator 삭제) | 무영향 | 동의 | 구현 | **3/3 합의** |
| R8-T2-10 (헤더 반응형) | 모바일 중요 | 동의 | 구현 | **3/3 합의** |
| R8-T2-11 (AccountOverview 모바일) | 동일 맥락 | 동의 | 구현 | **3/3 합의** |
| R8-T2-12 (RegimeFlowMap 모바일) | 운영 편의 | 동의 | 구현 | **3/3 합의** |

### 구현 순서 — 3자 비교

| Phase | Trader | Engineer | 차이 |
|-------|--------|----------|------|
| 1 (기반) | T2-2 + T1-1 | T1-1 + T2-2 | 동일 (순서만 역전) |
| 2 (핵심) | T0-5 + T2-1 | T2-1 + T0-5 | 동일 (co-implement) |
| 3 (보강) | T2-3 + T2-4 | T2-4 + T2-3 | 동일 |
| 4 (마무리) | T2-5 + T2-6 | T2-5 + T2-6 | 동일 |
| FE (병렬) | - | 5건 병렬 | UI 동의 |

**크리티컬 패스 일치**: T1-1 + T0-5 -> T2-1 -> T2-4

### 필수 보완 사항 요약 (Synthesize Phase에서 반영 필요)

1. **T2-1**: `_symbolUpdateInProgress` 플래그 도입 (동시성 보호)
2. **T2-1**: BTCUSDT 전략 배정 제외 정책 재논의
3. **T2-2**: `activate()` 시 warmup 카운트 리셋 명시
4. **T2-3**: Bitget WS account 토픽 `fundingFee` 필드 존재 확인 (구현 전 선행)
5. **T2-4**: `marketData.unsubscribeSymbols()` 즉시 사용 (Phase 2 미룸 X)
6. **T2-4**: `_reselectCoins()` 내 `_running` 가드 삽입
7. **T2-6**: OrphanOrderCleanup에 `cTime` 기반 age 필터 추가
8. **T0-5**: 매핑 덮어쓰기 시 warn 로그 (1:N 전환 판단 근거)
