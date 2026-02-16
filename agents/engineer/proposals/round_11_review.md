# Round 11 Cross-Review — Senior Systems Engineer

> 작성일: 2026-02-17
> 리뷰어: Systems Engineer
> 관점: 시스템 안정성, 에러 핸들링, 성능, 보안, 후방 호환성

---

## Trader 제안서 리뷰

### R11-T1: 트레일링 스탑 통합 (MaTrend/Turtle 이중 구현 제거)

**판정: ⚠️ 조건부 동의**

분석이 정확하다. MaTrend는 자체 `_highestSinceEntry`/`_lowestSinceEntry` 기반 단순 퍼센트 트레일링(lines 142-174)과 StrategyBase의 2단계 `activationPercent -> callbackPercent` 트레일링을 동시에 보유하고 있다. 코드를 확인한 결과, MaTrend의 metadata에 `trailingStop: { enabled: true, activationPercent: '1.5', callbackPercent: '1.0' }`이 설정되어 있고, 동시에 `defaultConfig.trailingStopPercent: '2'`로 자체 트레일링도 활성 상태이다.

**보완 조건**:
1. **동작 차이 매핑이 필수**: MaTrend 자체 트레일링은 "즉시 활성화 + 고정 퍼센트" 방식이고, StrategyBase는 "activation 도달 후 callback 트레일링" 2단계 방식이다. 통합 시 기존 MaTrend 백테스트 성과가 변하지 않도록, MaTrend의 `activationPercent: '0'` (즉시 활성화) + `callbackPercent: '2'`로 매핑해야 한다.
2. **마이그레이션 순서**: 자체 트레일링 코드 제거 전에 StrategyBase 파라미터를 먼저 조정하고, 해당 파라미터로 동일한 트레일링 동작이 재현되는지 단위 테스트로 검증한 뒤 제거해야 한다.
3. **TurtleBreakout의 ATR 기반 트레일링**은 StrategyBase의 퍼센트 기반과 근본적으로 다르다. ATR 기반을 StrategyBase로 통합하려면 StrategyBase에 `trailingStopMode: 'percent' | 'atr'` 옵션을 추가하거나, Turtle은 자체 구현 유지를 고려해야 한다. 무리하게 통합하면 오히려 복잡도가 증가한다.

**리스크**: 중 — 전략별 미묘한 동작 차이가 실거래 성과에 직접 영향.

---

### R11-T2: RsiPivot/Supertrend _checkTrailingStop() 호출 추가

**판정: ✅ 동의**

코드 확인 결과 사실이다. RsiPivotStrategy와 SupertrendStrategy 모두 metadata에 `trailingStop: { enabled: true, ... }`를 설정하고 super.onFill()도 호출하지만, onTick()에서 `_checkTrailingStop(price)`를 한 번도 호출하지 않는다. `_checkTrailingStop`이 호출되는 전략 파일은 현재 0건이다 (strategies/ 디렉토리에서 grep 결과 없음).

이는 R10에서 StrategyBase에 트레일링 인프라를 추가했으나 실제 전략에서 호출 연결을 누락한 것이다. 구현 난이도가 낮고 위험도 최소이므로 즉시 진행 적합하다.

**추가 제안**: 6개 전략(MaTrend, Turtle, RsiPivot, Supertrend, SwingStructure, MacdDivergence) 모두에서 `_checkTrailingStop` 호출 여부를 일괄 점검하라. R11-T1(통합) 이후에 진행하면 더 깔끔하다는 의견에 동의한다.

---

### R11-T3: BollingerReversion super.onFill(fill) 호출 추가

**판정: ✅ 동의**

코드 확인 완료. BollingerReversionStrategy.onFill()은 line 391에서 자체 로직만 실행하고 super.onFill(fill)을 호출하지 않는다. 다른 6개 전략(SwingStructure, Turtle, MacdDivergence, MaTrend, Supertrend, RsiPivot)은 모두 호출한다.

현재 Bollinger에 트레일링 메타데이터가 없어 즉각 문제는 없지만, StrategyBase.onFill()은 트레일링 외에도 포지션 상태 관리 등을 담당하므로 호출 누락은 잠재적 결함이다. 수정은 한 줄 추가로 완료되므로 즉시 진행.

---

### R11-T4: MaTrend/Turtle _entryPrice 설정을 onFill()로 이동 (AD-37 준수)

**판정: ⚠️ 조건부 동의**

분석이 정확하다. MaTrend(lines 328-330)와 Turtle(lines 378-382, 425-426)은 시그널 발행 시점에 `_entryPrice`를 설정한다. 주문 거부/지연 시 잘못된 상태가 남는 위험이 있다. 그러나 두 전략 모두 onFill()에서도 `fill.price`로 `_entryPrice`를 재설정하고 있다(MaTrend line 442, Turtle line 450).

**보완 조건**:
1. 시그널 발행 시점의 `_entryPrice = close` 설정을 제거하되, 해당 값을 참조하는 다른 로직(트레일링 스탑 초기화 등)이 없는지 확인 필요. MaTrend는 시그널 발행 직후 `_highestSinceEntry = close`도 설정하는데(line 329), 이것도 onFill()로 이동해야 한다.
2. 시그널 발행과 체결 사이의 틱에서 TP/SL 체크가 `_entryPrice`를 참조하는 경우, null 상태에서의 방어 로직이 이미 있는지 확인. RsiPivot의 `_checkExitOnTick()`는 line 171에서 `if (this._entryPrice === null) return;`으로 방어하고 있으나, MaTrend/Turtle도 동일한 패턴인지 점검 필요.

**리스크**: 낮-중 — 기존에 onFill()에서 재설정하므로 실제 영향은 제한적이나, 리팩토링 시 엣지 케이스 주의.

---

### R11-T5: SignalFilter 클로즈 바이패스 로직 오류

**판정: ✅ 동의 — 최우선 수정 대상**

이것은 **실제 운영 버그**이다. 코드를 직접 확인했다:

```javascript
// signalFilter.js line 136
const isClose = action === 'CLOSE' || signal.reduceOnly;
```

`SIGNAL_ACTIONS`에는 `'CLOSE'` 값이 없고, `'close_long'`과 `'close_short'`만 있다. 따라서 `action === 'CLOSE'`는 항상 false이다.

**심각도 평가**: RsiPivotStrategy의 close 시그널을 전수 조사한 결과, TP/SL/지표 청산 시그널에 `reduceOnly` 필드를 설정하지 않는다. 즉, RsiPivot의 청산 시그널은 쿨다운, 중복 감지, 최대 동시 포지션 등 모든 필터를 통과해야 한다. 이는 정당한 청산이 차단될 수 있음을 의미한다.

일부 전략(GridStrategy, AdaptiveRegime, MaTrend)은 `reduceOnly: true`를 설정하므로 영향이 없지만, `reduceOnly`를 설정하지 않는 전략의 청산 시그널은 필터에 걸릴 수 있다.

**권장 수정**:
```javascript
const isClose = action.startsWith('close') || signal.reduceOnly;
```

`['close_long', 'close_short'].includes(action)`도 가능하나, `action.startsWith('close')`가 더 간결하고 향후 확장에 유리하다. 단, `action`이 undefined/null인 경우의 방어가 필요하다:
```javascript
const isClose = (action && action.startsWith('close')) || signal.reduceOnly;
```

**사이드 이펙트 검토 결과**: botService의 `_handleStrategySignal()`에서 graceful-disabled와 grace-period 체크는 OPEN만 차단하고 CLOSE를 통과시키는 별도 로직이 있다(lines 1648-1658, 1661-1673). SignalFilter 수정은 이 로직과 충돌하지 않는다. 오히려 SignalFilter의 close bypass가 제대로 작동해야 전체 청산 경로가 일관된다.

---

### R11-T6: 백테스트 getEquity 미실현 PnL 포함

**판정: ✅ 동의**

`backtestEngine.js` line 425에서 `getEquity: () => this._cash`만 반환하는 것을 확인했다. 미실현 PnL을 포함해야 포지션 사이징이 정확해진다.

**성능 검토 (요청 사항)**: 백테스트에서 전략당 포지션 수는 metadata의 `maxConcurrentPositions` (대부분 1~3)로 제한되므로, 매 틱마다 Map 순회하더라도 요소 수가 극소이다. O(n) where n <= 3이므로 성능 영향은 무시할 수 있다.

**구현 주의사항**: 미실현 PnL 계산 시 long은 `(currentPrice - entryPrice) * size`, short는 `(entryPrice - currentPrice) * size`이며, 모든 값이 String이므로 반드시 `mathUtils`의 함수를 사용해야 한다.

---

### R11-T7: 백테스트 펀딩 비용 cash 반영

**판정: ✅ 동의**

분석이 정확하다. 펀딩 비용이 cash에 실제로 차감되지 않으면, 장기 보유 전략(Grid, Bollinger 등)의 백테스트 결과가 과대평가된다.

**구현 시 주의사항**:
1. 펀딩 비용 차감은 8시간 간격(0:00, 8:00, 16:00 UTC)에만 발생해야 한다. 매 캔들마다 차감하면 안 된다.
2. cash가 음수가 되지 않도록 `Math.min(cash, fundingCost)` 패턴으로 방어해야 한다.
3. 펀딩 비용은 양수(지불)와 음수(수취) 모두 가능하므로 부호 처리에 주의.

---

### R11-T8: CoinSelector F7 volMomentum 수정

**판정: ✅ 동의**

코드 확인 결과, line 341의 주석에도 `// F7: Volume Momentum (same as volume -- percentile rank will differentiate)`라고 적혀 있어 개발 시점부터 인지된 TODO였음이 명확하다. F1과 동일한 값을 사용하므로 7-factor가 실질 6-factor이다.

**구현 제안**: 이전 폴링 주기 대비 거래량 변화율을 사용하려면 이전 vol24h를 캐싱해야 한다. TickerAggregator에 이미 이전 ticker 데이터가 있다면 거기서 가져오고, 없다면 CoinSelector 내부에 `_prevVol24h` Map을 추가한다. 메모리 영향은 코인 수(~50개) * 8바이트로 무시 가능.

---

### R11-T9: 변동성 기반 포지션 사이징 (ATR 사이징 모듈)

**판정: ⚠️ 조건부 동의**

방향성은 올바르다. 고정 비율 포지션 사이징은 변동성 차이를 무시하여 리스크가 불균등하다.

**보완 조건**:
1. **StrategyBase에서 ATR 자동 계산**은 부적절하다. ATR 계산에는 kline 히스토리가 필요한데, 모든 전략이 kline을 받는 것은 아니며(onTick만 사용하는 전략도 존재), ATR 기간도 전략마다 다르다. 대신 **시그널에 `riskPerUnit` 필드를 포함하는 opt-in 방식**을 권장한다. ATR을 이미 계산하는 전략(Turtle, Supertrend 등)이 시그널에 포함하고, ExposureGuard가 있으면 사용하고 없으면 기존 고정 비율 폴백.
2. **ExposureGuard 통합 아키텍처**: 현재 ExposureGuard는 3-tier(riskPerUnit -> 단일 캡 -> 총 노출 캡) 구조이다. ATR 사이징은 1-tier(riskPerUnit)에 해당하므로 기존 구조와 자연스럽게 호환된다. botService의 `_resolveSignalQuantity()`에서 `signal.riskPerUnit`이 있으면 `equityStr * riskPercent / riskPerUnit`로 수량을 계산하고, 없으면 기존 `positionSizePercent` 폴백.
3. **점진적 롤아웃**: 한 번에 17개 전략을 변경하지 말고, ATR을 이미 보유한 전략(Turtle, Supertrend, Bollinger, SwingStructure)부터 적용하고, 나머지는 Phase 2에서 indicatorCache를 통해 ATR을 주입.

**리스크**: 중-상 — 포지션 사이징 변경은 모든 전략의 실거래 행동에 직접 영향. 충분한 백테스트 비교 후 적용 필수.

---

### R11-T10: StrategyBase maxHoldTime 강제 청산

**판정: ⚠️ 조건부 동의**

무기한 포지션 보유는 실제 리스크이며, 특히 펀딩 비용 누적 관점에서 문제다.

**보완 조건**:
1. **강제 청산은 "경고 -> 강제" 2단계로 구현**: 먼저 `maxHoldWarnMs`에서 이벤트를 발행하고(RISK_EVENTS 확장), `maxHoldMs`에서 강제 청산. 즉각 강제 청산은 불리한 가격에서 슬리피지를 유발할 수 있다.
2. **전략별 opt-out 가능하게**: Grid 전략 같은 경우 의도적으로 장기 보유할 수 있으므로, `metadata.maxHoldMinutes: null`일 때 무제한을 허용해야 한다.
3. **시간 추적의 기준점**: `_entryPrice` 설정 시점이 아닌 **onFill() 체결 시점**의 타임스탬프를 기준으로 해야 한다. R11-T4의 AD-37 패턴과 일관성 유지.

---

### R11-T11: PaperEngine TP 트리거 시뮬레이션

**판정: ✅ 동의**

코드 확인 결과, `_checkStopLossTriggers()`만 존재하고 TP 트리거 로직이 없다. 페이퍼 트레이딩에서 TP가 작동하지 않으면 성과 측정이 왜곡된다.

**구현 주의사항**:
1. SL 트리거 로직(`_checkStopLossTriggers()`)의 구조를 미러링하되, TP는 가격 방향이 반대(long: price >= tpPrice, short: price <= tpPrice)임에 주의.
2. SL과 TP가 동시에 트리거될 수 있는 엣지 케이스(급변동 시) 처리: SL이 우선해야 한다(보수적 접근).

---

## UI/UX 제안서 리뷰

### R11-FE-01: MarketRegimeIndicator.tsx 삭제

**판정: ✅ 동의**

grep으로 확인한 결과, `MarketRegimeIndicator`를 import하는 파일이 자기 자신뿐이다. 안전하게 삭제 가능.

삭제 후 `npm run build` 확인은 당연히 수행해야 하나, import 없음이 확인되었으므로 빌드 실패 가능성은 극히 낮다.

---

### R11-FE-02: risk.ts의 any 타입 제거

**판정: ✅ 동의**

타입만 변경하고 런타임 동작은 변경하지 않으므로 안전하다. `RiskStatusExtended` 타입 정의 접근이 적절하다.

**추가 의견**: Trader에게 `/api/risk/status` 응답 필드를 확인 요청한 것은 올바른 접근이다. 타입을 확장할 때 optional 필드(`?`)로 정의하여 백엔드 응답이 달라져도 FE가 깨지지 않도록 해야 한다.

---

### R11-FE-03: as unknown as 캐스트 3건 제거

**판정: ✅ 동의**

EquityCurveBase를 제네릭 컴포넌트로 변경하는 것이 타입 안전성을 근본적으로 개선한다. `T extends Record<string, unknown>` 제약이 적절하며, 기존 소비자(EquityCurveChart, BacktestEquityCurve)에서 캐스트 없이 사용 가능해진다.

---

### R11-FE-04: as never 캐스트 7건 공통화

**판정: ⚠️ 조건부 동의**

방향은 맞으나 Recharts 타입 문제의 근본 원인을 먼저 확인해야 한다.

**보완 조건**:
1. 현재 `package.json`의 recharts 버전을 확인하고, 최신 버전에서 Tooltip.formatter 타입이 개선되었는지 확인. 라이브러리 업데이트로 해결 가능하다면 공통 래퍼보다 업데이트가 우선이다.
2. `createCurrencyFormatter` 래퍼를 만들 경우, 반환 타입이 Recharts 내부 타입과 정확히 매치하는지 검증 필요. 부정확하면 `as never`가 `as ChartTooltipFormatter`로 바뀔 뿐 근본 해결이 아니다.

---

### R11-FE-05: PaperModeGate 공통 컴포넌트

**판정: ✅ 동의**

두 페이지(backtest, tournament)에 거의 동일한 가드 UI가 중복되어 있으므로 공통화는 당연하다. 위험 없음.

---

### R11-FE-06: CATEGORY_LABEL 통일

**판정: ✅ 동의**

같은 카테고리에 3가지 다른 한국어 표현(`경량지표` vs `지표 경량` vs `Indicator-Light`)이 사용되는 것은 일관성 문제이다. `translateStrategyCategory()` 함수로 통일하는 것이 맞다.

---

### R11-FE-07: formatPnl 유틸 승격

**판정: ✅ 동의**

로컬 함수를 공통 유틸로 승격하는 표준적인 리팩토링. 위험 없음.

---

### R11-FE-08: tournament/page.tsx 분할 (478줄)

**판정: ✅ 동의**

478줄에 4개 컴포넌트가 포함된 것은 분할 대상이다. 다만 우선순위 B로 분류한 것이 적절하다. 기능 변경 없이 구조만 개선하므로 안전하다.

---

### R11-FE-09: 백테스트 결과 비교 기능

**판정: ⚠️ 조건부 동의**

기능적 가치는 높지만, 한 스프린트에서 소화하기에는 90분 추정이 낙관적일 수 있다.

**보완 조건**:
1. 에쿼티 커브 오버레이(같은 차트에 2개 라인)는 시간축(x축)이 다를 수 있다(시작일/종료일, 캔들 수 차이). 시간축 정렬 로직이 필요하며 이것만으로도 상당한 복잡도 추가.
2. Phase 1에서는 **핵심 지표 테이블 비교만** 구현하고, 에쿼티 커브 오버레이는 Phase 2로 분리할 것을 권장. 지표 비교 테이블만으로도 충분한 가치를 제공한다.
3. 상태 관리: 비교 모드에서 2건 선택 시 `activeResult`가 단일 상태에서 배열로 변경되어야 한다. 기존 단일 선택 모드와의 호환성 유지가 필요하다 (비교 모드 토글이 off이면 기존 동작 유지).

**리스크**: 중 — 기존 flow 변경 시 regression 가능성. 우선순위 C 분류가 적절하다.

---

### R11-FE-10: 백테스트 폼 유효성 검증 강화

**판정: ✅ 동의**

현재 날짜 범위 오류를 silent하게 무시하는 것(`if (startMs >= endMs) return;`)은 UX 결함이다. 인라인 에러 메시지와 합리적 범위 검증 추가는 당연하다.

**추가 제안**: 초기 자본에 대해 `> 0` 뿐만 아니라 최소값(예: 100 USDT)을 설정하는 것을 권장. 극단적으로 작은 자본(0.01 등)은 수수료에 의해 무의미한 결과를 생성한다.

---

### R11-FE-11: useStrategyDetail 적응형 폴링 전환

**판정: ✅ 동의**

코드 확인 결과, `useStrategyDetail`만 유일하게 수동 `setInterval(fetchStats, 5000)`을 사용한다. 탭 비활성 시 불필요한 API 호출이 발생하므로 `useAdaptivePolling`으로 전환이 맞다.

**주의사항**: `strategyName`이 null일 때 폴링을 중지해야 하므로, `useAdaptivePolling`에 `enabled` 파라미터가 없다면 추가가 필요하다. 또는 콜백 내부에서 `if (!strategyName) return;`으로 early return하는 방식도 가능하나, 이 경우 불필요한 타이머가 계속 돌아가므로 `enabled` 파라미터가 더 깔끔하다.

---

### R11-FE-12: PerformanceTabs lazy loading

**판정: ✅ 동의**

에쿼티 커브 탭(기본값)만 볼 때 3개 추가 API를 호출하는 것은 낭비이다. 탭 최초 선택 시 fetch하는 lazy loading 패턴이 적절하다.

**성능 영향**: API 호출 3건 감소 (초기 로드 시). 사용자가 실제로 다른 탭을 클릭하면 그때 로딩하므로 체감 UX는 탭 전환 시 잠깐의 로딩 스피너가 추가된다. 이 trade-off는 합리적이다.

**구현 제안**: `usePerformanceAnalytics`를 3개 독립 훅으로 분리하는 것보다, 기존 훅에 `enabledMetrics: Set<'byStrategy' | 'bySymbol' | 'daily'>` 파라미터를 추가하는 것이 변경 범위가 적다.

---

### R11-FE-13: 커스텀 다이얼로그 Focus Trap

**판정: ✅ 동의**

접근성 관점에서 `role="dialog"`, `aria-modal`, Escape 키 닫기, 포커스 트랩은 모달 다이얼로그의 필수 요소이다. EmergencyStopDialog의 패턴을 복제하면 되므로 구현이 간단하다.

---

## 종합 의견

### 전체 평가

두 제안서 모두 코드 레벨의 구체적 근거를 제시하고 있으며, 발견 사항의 정확도가 높다. 직접 코드를 검증한 결과 대부분의 주장이 사실과 일치한다.

### 우선순위 재조정 권장

**즉시 수정 필수 (Tier 0)**:
1. **R11-T5** (SignalFilter close bypass) — 실제 운영 버그. 청산 시그널이 차단될 수 있는 심각한 결함. 수정은 1줄이며 사이드 이펙트 없음.
2. **R11-T3** (Bollinger super.onFill) — 1줄 추가, 위험 없음.
3. **R11-T2** (RsiPivot/Supertrend _checkTrailingStop 호출) — R10 기능의 사실상 미완성 보완.

**1주 내 (Tier 1)**:
4. **R11-T11** (PaperEngine TP 트리거) — 페이퍼 트레이딩 정확도에 직접 영향.
5. **R11-T4** (entryPrice 이동) — AD-37 일관성. 실제 영향은 제한적이나 코드 품질 차원.
6. **R11-T6** (백테스트 getEquity) — 백테스트 정확도 개선.
7. **R11-T8** (volMomentum 수정) — 간단한 수정, 코인 선정 품질 개선.
8. **R11-FE-01~07, 10, 11, 13** (FE 우선순위 A 전체) — 모두 안전하고 독립적.

**2주 내 (Tier 2)**:
9. **R11-T1** (트레일링 통합) — 난이도가 높고 전략 동작 변경 수반. 충분한 테스트 필요.
10. **R11-T7** (백테스트 펀딩 반영) — 정확도 개선이나 긴급하지 않음.
11. **R11-FE-04, 08, 12** (FE 우선순위 B) — 구조 개선, 급하지 않음.

**보류 (Tier 3)**:
12. **R11-T9** (ATR 사이징) — 아키텍처 설계가 선행 필요. 충분한 백테스트 비교 후 적용.
13. **R11-T10** (maxHoldTime) — 유용하나 설계 논의 필요 (2단계 경고, opt-out 등).
14. **R11-FE-09** (백테스트 비교) — 가치 있으나 복잡도 높음. 다음 라운드로 분리 권장.

### 총 작업량 예측

- Trader 제안: Tier 0~1 항목 7건, 약 10시간
- UI/UX 제안: 우선순위 A 전체 9건 + B 일부, 약 3.5시간
- **합계: 약 13.5시간** — 한 스프린트(8시간) 내에서는 Tier 0 전체 + Tier 1 일부가 현실적

### Engineer 담당 구현 사항

Trader 제안서의 요청에 대한 답변:
1. **R11-T5 사이드 이펙트**: 검토 완료. `action.startsWith('close')` 수정은 안전. null 방어만 추가.
2. **R11-T1 트레일링 매핑**: MaTrend는 `activationPercent: '0' + callbackPercent` 매핑. Turtle ATR 기반은 별도 모드 추가 또는 유지 검토.
3. **R11-T6 성능**: Map 순회 O(n<=3), 무시 가능. 승인.
4. **R11-T9 아키텍처**: opt-in `riskPerUnit` 시그널 필드 방식 제안. StrategyBase 자동 ATR 계산은 부적절.
