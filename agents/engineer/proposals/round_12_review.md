# Round 12 Review — Senior Systems Engineer

> 리뷰일: 2026-02-17
> 검증 방식: 제안서 근거 파일 전수 코드 리딩 + 호출 체인 추적
> 검증 파일 수: 35+

---

## Trader 제안서 리뷰

### P12-1: 이중 트레일링 스탑 통합 — ⚠️ 조건부 동의 (진단 정정 필요)

**코드 검증 결과 — 제안서의 진단이 부분적으로 부정확하다.**

제안서는 MaTrendStrategy와 AdaptiveRegimeStrategy에서 "StrategyBase 메타데이터 트레일링 + 자체 트레일링이 동시에 실행되어 이중 close 시그널이 발생한다"고 주장한다. 그러나 실제 코드를 추적한 결과:

1. **MaTrendStrategy는 `onTick()`을 완전히 override하며, `super.onTick()`을 호출하지 않는다** (L124). AdaptiveRegimeStrategy도 동일하다 (L119).
2. StrategyBase의 `onTick()` (L101-131)에서 `_checkTrailingStop()`이 호출되지만, 이것은 **child가 super를 호출할 때만 실행**된다.
3. `super.onTick()` 호출이 없으므로 StrategyBase의 trailing stop 로직은 **실제로 실행되지 않는다 (dead code)**.
4. StrategyBase L96-97의 주석이 이를 확인: "Sub-classes should call super.onTick(ticker) if they want automatic trailing stop, or override completely if they manage their own trailing logic."

**실제 문제점**: StrategyBase `_initTrailingFromMetadata()` (L86, constructor에서 호출)가 `_trailingStopEnabled = true`로 설정하고 config을 초기화하지만, 이 상태가 전혀 사용되지 않는다. 이는 dead code이자 혼동의 원인이다. 메모리 낭비는 미미하지만 코드 의도가 모호해진다.

**권장: 방안 B (metadata.trailingStop.enabled = false) 동의**, 단 이유가 다르다. 이중 실행 방지가 아니라, **dead code 제거 + 코드 의도 명확화** 목적이다. 추가로 8개 전략 전체(제안서에서 언급한 2개 외에 Breakout, SwingStructure, MacdDivergence, RsiPivot, Supertrend, Turtle도 해당)에서 사용하지 않는 metadata.trailingStop.enabled를 false로 변경하거나 제거해야 한다.

---

### P12-2: 전략 close 시그널 `reduceOnly` 일괄 추가 — ✅ 동의

코드 검증 완료. OrderManager의 `ACTION_MAP` (L52-56)이 `CLOSE_LONG/SHORT`을 항상 `reduceOnly: true`로 매핑하므로 기능적으로는 안전하지만, 제안서가 정확히 지적했듯이:

- `botService.js` L487에서 `trade.reduceOnly`를 확인하여 포지션 매핑 정리를 수행한다.
- 시그널 수준의 명시적 `reduceOnly`는 디버깅 가독성과 일관성에 기여한다.
- TurtleBreakout `_emitCloseSignal()` (L489-506), Supertrend `_emitClose()` (L843-855) 모두 `reduceOnly` 미포함 확인.

변경이 단순하고 안전하며, 부수효과 위험이 없다. 1시간 추정도 적절하다.

---

### P12-3: 백테스트 레버리지 반영 — ⚠️ 조건부 동의 (보완 필수)

**코드 검증 완료**. `backtestEngine.js` L584-596에서 `positionValue = cash * (positionSizePct / 100)` 이후 `qty = positionValue / fillPrice`로 계산하며, 레버리지가 전혀 반영되지 않는 것을 확인.

**보완 사항**:

1. **현금 차감 로직의 정확성**: 제안된 코드에서 `margin`만 현금에서 차감하는 것은 올바르다. 그러나 현재 백테스트의 `_closeLong()` / `_closeShort()` PnL 계산도 레버리지를 반영하도록 동시 수정 필요하다. 현재 `_closeLong()` (L610 이후)에서 `pnl = (closePrice - entryPrice) * qty`로 계산하는데, 레버리지 적용 후 qty가 커지므로 PnL도 자연히 증폭된다. 이 부분은 기존 코드가 qty 기반이므로 추가 수정 없이 자동 반영되지만 **명시적 검증 테스트 케이스**가 필요하다.

2. **마진 콜 / 강제 청산 미시뮬레이션**: 레버리지를 적용하면 마진 소진 시 강제 청산이 발생해야 하지만, 제안서가 "이번 범위 외"로 제한했다. 이는 수용 가능하나, **레버리지 적용 시 마진 부족(cash < 0) 상태를 감지하는 guard**는 최소한 추가해야 한다. 현재 L576의 `cash < 0` 체크만으로는 레버리지 시나리오에서 불충분하다.

3. **mathUtils 정밀도**: `parseFloat` 기반 (mathUtils L24)이므로 IEEE 754 double의 유효 자릿수 ~15자리. 20x 레버리지에서도 금액 계산은 충분하지만, 매우 작은 알트코인 가격 (예: 0.00001 USDT) * 20x 시나리오에서 qty가 극단적으로 커질 수 있다. 실용적으로는 문제 없으나 테스트에서 경계값 확인 필요.

4. **API 파라미터 검증**: `leverage` 파라미터에 대한 입력 검증 (범위 1~20, 양의 정수) 필수.

---

### P12-4: ExposureGuard 레버리지 인지 — ⚠️ 조건부 동의 (설계 명확화 필요)

**코드 검증 완료**. `exposureGuard.js` L120-155에서 명목 가치 기반 계산 확인.

**보완 사항**:

1. **설계 결정 필요**: 제안서는 `maxPositionSizePercent`를 마진 기준, `maxTotalExposurePercent`를 명목 기준으로 분리하자고 한다. 이 이원화가 오히려 혼동을 일으킬 수 있다. **두 값 모두 명목(notional) 기준으로 통일**하되, 로그에 마진 환산값을 함께 출력하는 것이 더 안전하다. 리스크 관리는 "실제 노출 위험"을 기준으로 해야 하므로 명목 기준이 적절하다.

2. **기존 positions의 레버리지 반영**: L149-152에서 기존 포지션의 `pos.qty * pos.markPrice`로 노출도를 계산하는데, 이것은 이미 명목 가치이다 (거래소에서 반환하는 qty는 레버리지 적용 후의 실제 계약 수량). 따라서 현재 구현이 명목 기준으로 이미 올바르게 동작하고 있다. 문제는 **새 주문의 qty에 레버리지가 적용된 값이 들어오는지 여부**이다. 이 부분을 명확히 문서화하면 충분하다.

3. **하위 호환성**: params 변경 시 기존 설정과의 호환성 보장 필요.

---

### P12-5: 전략 간 방향성 집중도 모니터링 — ⚠️ 조건부 동의 (아키텍처 의견)

**개념적으로 동의**. 암호화폐 시장의 높은 상관관계를 고려하면 방향성 집중도 관리는 필수적이다.

**아키텍처 결정**:

- **SignalFilter 확장을 권장**한다. 새로운 서브엔진(DirectionGuard)을 RiskEngine 체인에 추가하는 것은 과도하다. 이유:
  - RiskEngine의 3개 서브엔진(CircuitBreaker, DrawdownMonitor, ExposureGuard)은 모두 **주문 수준**에서 동작한다.
  - 방향성 집중도는 **시그널 수준**에서 필터링하는 것이 더 자연스럽다. 이미 SignalFilter에 `symbolConflictFilter`가 있으므로, `directionalConcentrationFilter`를 추가하면 된다.
  - SignalFilter는 botService에서 시그널을 수신할 때 가장 먼저 실행되므로, 불필요한 주문 생성 자체를 방지한다.

- **구현 시 주의**: positionManager에서 현재 포지션 방향을 조회해야 하므로 SignalFilter에 positionManager 의존성 주입 필요. 순환 의존성이 발생하지 않도록 주의.

---

### P12-6: ATR 기반 동적 TP/SL 범용화 — ⚠️ 조건부 동의 (점진적 적용)

전략 메타데이터에 `tpAtrMultiplier`, `slAtrMultiplier`를 추가하는 인프라 변경 자체는 동의한다. 다만:

1. **모든 전략에 일괄 적용은 위험하다**. 각 전략의 고정 TP/SL은 해당 전략의 특성(진입 조건, 보유 기간)에 맞게 조정된 값이다. ATR 기반으로 변경하면 전략 성격이 변할 수 있다.
2. **권장**: StrategyBase에 헬퍼만 추가하고, 2~3개 전략(Supertrend, Bollinger, RSIPivot)에 먼저 적용하여 백테스트로 성과를 비교한 후 점진적으로 확대.
3. **IndicatorCache 의존성**: ATR 값을 조회하려면 해당 심볼의 kline 데이터가 indicatorCache에 있어야 한다. 모든 전략이 indicatorCache에 접근 가능한지 확인 필요 (현재 botService에서 주입하는 구조).

---

### P12-7: Calmar Ratio 연율화 — ✅ 동의

코드 검증 완료 (`backtestMetrics.js` L310-312). 현재 `totalReturn / maxDrawdownPercent`으로 기간 정규화 없이 계산되는 것 확인. 제안된 연율화 코드는 정확하다.

단, `durationDays`가 0에 가까운 경우 (예: 1일 미만 백테스트) 연율화 수익률이 극단적으로 커질 수 있으므로, 최소 기간 guard (예: `durationDays >= 7`일 때만 연율화, 그 외에는 raw ratio 사용) 추가를 권장한다.

---

### P12-8: 백테스트 포트폴리오 모드 — ✅ 동의 (Tier 3 유지)

장기 로드맵으로 적절하다. 현재 단일 심볼 백테스트 엔진의 구조를 크게 변경해야 하므로 이번 스프린트에서는 범위 외가 맞다. 다만 P12-3의 레버리지 반영 시 향후 포트폴리오 모드 확장이 용이하도록 **마진/현금 관리를 position별로 분리**하는 구조를 미리 고려해 두면 좋다.

---

### P12-9: CoinSelector 절대 비용 필터 — ✅ 동의

현재 CoinSelector의 상대적 순위 기반 스코어링만으로는 절대 비용이 높은 시장 환경에서 불리한 코인이 선정될 수 있다. `maxEffectiveCost` pre-filter는 단순하고 효과적인 방어선이다.

`Effective Cost = spread + (2 * taker fee) + abs(funding rate * 3)` 공식에서 `funding rate * 3`은 평균 보유 기간 3개 펀딩 주기(24시간)를 가정한 것으로 보이는데, 전략별 평균 보유 기간이 다르므로 고정 계수보다는 설정 가능한 `fundingPeriods` 파라미터를 두는 것이 더 유연하다.

---

## UI/UX 제안서 리뷰

### R12-FE-01: useSocket 더블 acquireSocket 문제 — ⚠️ 조건부 동의

코드 검증 완료. `useSocket.ts` L122에서 `REGIME_CHANGE`를, `useMarketIntelligence.ts` L112에서도 동일 이벤트를 구독하는 것 확인. Socket.io의 싱글턴 소켓에 두 개의 핸들러가 등록되어 이벤트 당 두 번 실행되는 것은 맞다.

**시스템 영향 평가**:
- **서버 측 영향: 없음**. Socket.io 이벤트 broadcast는 서버에서 한 번만 전송하며, 클라이언트 측 핸들러 수는 서버에 영향을 주지 않는다.
- **클라이언트 측 영향: 미미**. `REGIME_CHANGE` 이벤트는 수분에 한 번 발생 (레짐 전환 빈도). 이중 리렌더 비용은 무시할 수 있는 수준이다.
- **refCount 관련**: `acquireSocket()`의 refCount가 2가 되어, 한쪽 훅이 unmount되어도 소켓이 유지된다. 이것은 정상적인 동작이며 문제가 아니다.

**보완**: `useMarketIntelligence`에서 `acquireSocket()` 대신 `getSocket()`을 사용하는 방안은 위험하다. getSocket()이 null을 반환할 수 있고, 소켓 연결 타이밍 문제가 생길 수 있다. 대신 **`useSocket`에서 반환하는 `regime` 상태를 `useMarketIntelligence`의 props로 받는 것**이 가장 깔끔하다.

---

### R12-FE-02: PerformanceTabs 탭 전환 시 데이터 새로고침 부재 — ✅ 동의

코드 검증 완료. `loadedTabs` Set이 `useState`지만 reference 불변이라 `add()`가 리렌더를 트리거하지 않는 것, 그리고 동일 sessionId 내에서 갱신이 없는 것 확인.

**방법 B (stale-while-revalidate) 권장**. 1.5시간 추정도 적절하다.

**서버 부하 평가**: `analyticsApi.getByStrategy`, `getBySymbol`, `getDaily`는 인메모리 세션 데이터에서 계산하므로 응답이 빠르다. 10초 간격 polling은 서버에 부담이 되지 않는다. 다만 활성 탭에 대해서만 polling하도록 제한하는 것이 중요하다.

---

### R12-FE-03: handleClosePosition에서 addToast 의존성 누락 — ✅ 동의

코드 검증 완료 (`page.tsx` L97-114, L119-129). `addToast`가 `useCallback`으로 반환되어 참조가 안정적이므로 실제 stale closure 버그는 발생하지 않지만, `exhaustive-deps` 규칙 준수를 위해 추가하는 것이 올바르다.

10분 추정 적절. 부수효과 없음.

---

### R12-FE-04: BacktestForm의 setInterval 변수 섀도잉 — ✅ 동의

코드 검증 완료 (`BacktestForm.tsx` L57). `window.setInterval`을 shadowing하는 것 확인. 현재 버그는 아니지만 코드 위생(hygiene) 개선으로 적절하다.

`[backtestInterval, setBacktestInterval]`로 이름 변경 권장. `setIntervalValue`보다 의미가 명확하다.

---

### R12-FE-05: useBacktest 폴링이 useAdaptivePolling 미사용 — ✅ 동의

코드 검증 완료 (`useBacktest.ts` L73-94). 직접 `setInterval` 사용 + Page Visibility API 미적용 확인.

백테스트 폴링은 1초 간격으로 빈번하므로, 백그라운드 탭에서의 불필요 요청이 누적될 수 있다. `document.hidden`일 때 폴링 중지는 간단하고 효과적이다.

다만 `useAdaptivePolling` 통합보다는 **제안서의 최소 변경 방안 (visibility change listener)** 이 더 적절하다. 백테스트 완료 대기는 adaptive polling의 "봇 상태 기반 간격 조정" 로직과 맞지 않는다.

---

### R12-FE-06: SignalFeed 모바일 반응형 레이아웃 부재 — ✅ 동의

코드 검증 완료 (`SignalFeed.tsx` L29-65). `flex items-center justify-between`으로 한 줄 배치, 모바일에서 요소 겹침 가능성 확인.

2줄 레이아웃 제안은 적절하다. `flex-col sm:flex-row` 패턴이 기존 코드베이스의 반응형 패턴과 일관적이다.

---

### R12-FE-07: AccountOverview 금액 값 flash/transition 효과 부재 — ⚠️ 조건부 동의

제안된 `useValueFlash` 훅은 기능적으로 올바르지만:

1. **`parseFloat` 사용 주의**: 프로젝트 전반에서 금액을 문자열로 처리하는데, `useValueFlash` 내부에서 `parseFloat`로 비교한다. 이것은 비교 목적으로만 사용되므로 허용 가능하지만, 비교 정밀도 문제가 생길 수 있다 (예: '10000.00000001' vs '10000.00000002'). 소수점 2자리까지만 비교하도록 `toFixed(2)` 후 비교하는 것이 더 안정적이다.

2. **고빈도 업데이트 시 flash 과다**: 폴링 간격 3초에서 미실현 PnL은 거의 매번 미세하게 변동한다. 이로 인해 flash가 거의 항상 활성 상태가 되어 시각적 피로를 유발할 수 있다. **변동률이 일정 임계치(예: 0.1%) 이상일 때만 flash**를 적용하는 것을 권장한다.

---

### R12-FE-08: PositionsTable의 strategy 컬럼 미표시 — ⚠️ 조건부 동의 (백엔드 연동 필요)

**중요 발견**: `positionManager._parsePositionEntry()` (L423-443)가 반환하는 객체에 `strategy` 필드가 없다. 거래소 REST/WS 응답에는 전략 정보가 포함되지 않기 때문이다.

전략-포지션 매핑은 `botService._strategyPositionMap` (L155)에서 별도 관리되며, 이 정보는 `GET /api/trades/positions` 응답에 포함되지 않는다.

**필수 선행 작업**:
1. `tradeRoutes.js` L99-103에서 `positionManager.getPositions()` 반환 시 `botService._strategyPositionMap`의 매핑 정보를 merge하여 `strategy` 필드를 포함하도록 수정
2. 또는 별도 API (`GET /api/bot/strategy-position-map`)를 프론트에서 호출하여 클라이언트 측에서 매핑

이 백엔드 변경 없이는 프론트엔드에서 strategy 컬럼을 추가해도 항상 `--`만 표시된다. **난이도를 S에서 M으로 상향** 조정해야 한다.

---

### R12-FE-09: TradingModeToggle의 에러 무시 — ✅ 동의

코드 검증 완료 (`TradingModeToggle.tsx` L26-38). paper/live 모드 전환은 운용에 중대한 영향을 미치는 작업이므로 실패 시 반드시 사용자에게 알려야 한다.

`onError` prop 방식이 적절하다. 15분 추정 적절.

---

### R12-FE-10: SymbolRegimeTable과 StrategySymbolMap 역할 중복 — ✅ 동의

**방법 B (접기/펼치기 토글) 권장**. 두 컴포넌트는 정보 깊이가 다르다: StrategySymbolMap은 전략-심볼 매핑 + 레짐 badge를, SymbolRegimeTable은 레짐 상세 (신뢰도, 상태 등)를 보여준다. 정보 중복은 레짐 badge 부분이므로, SymbolRegimeTable을 기본 접힌 상태로 두면 화면 밀도를 줄이면서 상세 정보 접근성을 유지할 수 있다.

---

### R12-FE-11: DrawdownChart gradientId 전역 충돌 — ✅ 동의

코드 검증 완료 (`DrawdownChart.tsx` L65). 현재는 문제 없으나 `useId()` 활용한 예방적 수정으로 적절하다. 10분으로 비용 대비 효과가 좋다.

---

### R12-FE-12: tournament/page.tsx 분할 — ✅ 동의

441줄에 4개 컴포넌트는 분할 기준에 해당한다. `StrategyDetailPanel` (131줄)을 별도 파일로 분리하는 것이 적절하다.

---

### R12-FE-13: 백테스트 결과 비교 기능 — ✅ 동의 (Deferred 유지)

18개 전략 운영에서 비교 기능은 실용적 가치가 높다. 3시간 추정은 최소 구현 기준으로 적절하나, UX 디테일(정렬, 하이라이트, 차트 오버레이 등)을 포함하면 5시간 이상이 될 수 있다. Phase 1 범위를 "테이블 비교만"으로 명확히 제한하는 것이 중요하다.

---

## 종합 의견 및 보완 제안

### 1. P12-1 진단 정정이 필수

Trader 제안서의 핵심 발견 F12-1 "이중 트레일링 스탑 충돌"은 실제 코드에서 발생하지 않는다. 모든 전략이 `onTick()`을 override하며 `super.onTick()`을 호출하지 않으므로, StrategyBase의 trailing stop 인프라는 dead code다. 수정 방향 (metadata에서 enabled=false 설정)은 동일하지만, 이유와 범위가 다르다. 8개 전략 전체에 적용해야 한다.

### 2. R12-FE-08 백엔드 선행 작업 필요

UI 제안서의 PositionsTable 전략 컬럼 추가는 단독 FE 작업이 아니다. 백엔드의 positions API 응답에 `strategy` 필드를 포함하는 작업이 선행되어야 한다. Trader/UI 양쪽 모두 이 의존성을 인지하지 못했다.

### 3. 이번 스프린트 권장 범위

**Tier 0 (반드시)**:
- P12-1 (8개 전략 metadata 정리) — 2시간
- P12-3 (백테스트 레버리지) — 3시간
- R12-FE-03, 04, 09 (quick fixes) — 35분

**Tier 1 (권장)**:
- P12-2 (reduceOnly 일괄) — 1시간
- P12-7 (Calmar 연율화) — 30분
- R12-FE-05, 06, 08, 11 — 1.5시간 (FE-08은 BE 작업 포함 시 +1시간)

**Tier 2 (가능하면)**:
- P12-5 (방향성 집중도, SignalFilter 확장) — 4시간
- R12-FE-01, 07, 10 — 3시간

**Deferred**:
- P12-4 (ExposureGuard 레버리지, 설계 정리 후), P12-6, P12-8, P12-9
- R12-FE-02, 12, 13

### 4. 누락 사항 보완

1. **테스트 부재**: P12-3 (백테스트 레버리지)은 수치 정확성이 핵심이므로, 레버리지 1x/3x/10x에서의 PnL 계산을 검증하는 단위 테스트가 반드시 포함되어야 한다.
2. **P12-1 확대 범위**: MaTrend, AdaptiveRegime 외에 Breakout, SwingStructure, MacdDivergence, RsiPivot, Supertrend, Turtle (총 8개)에서도 동일 정리 필요.
3. **positions API 확장**: R12-FE-08 구현을 위해 `GET /api/trades/positions` 응답에 `botService._strategyPositionMap` 데이터를 merge하는 BE 작업 추가.
