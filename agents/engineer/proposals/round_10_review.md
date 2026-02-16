# Round 10 Cross-Review — Senior Systems Engineer

**작성자**: Senior Systems Engineer
**작성일**: 2026-02-17
**대상**: Trader 제안서 (`agents/trader/proposals/round_10.md`) + UI/UX 제안서 (`agents/ui/proposals/round_10.md`)

---

## 리뷰 요약

| ID | 제목 | Trader 제안 | UI 제안 | Engineer 판정 |
|----|------|-------------|---------|---------------|
| R8-T3-3 | peakEquity 영속성 | 1순위 (하) | FE 무관 | **동의** (보완 1건) |
| R8-T3-2 | Trailing Stop | 2순위 (중) | FE 인터페이스 요청 | **조건부 동의** (보완 3건) |
| R8-T3-1 | 백테스트 멀티포지션 | 4순위 (중상) | FE 마커 겹침 우려 | **조건부 동의** (보완 2건) |
| R8-T3-4 | Sortino Ratio | 3순위 (하) | FE 1줄 추가 | **동의** (보완 1건) |
| R8-T3-5 | 데드코드 삭제 | 찬성 | 삭제 안전 100% 확인 | **동의** |
| R8-T3-6 | EquityCurveChart 공통 추출 | 찬성 | 설계안 제시 | **동의** |
| R8-T3-7 | th scope="col" | 찬성 | 88개 th 파악 완료 | **동의** |
| R8-T3-8 | TOOLTIP_STYLE 통일 | 찬성 | 4파일 교체 계획 | **조건부 동의** (보완 1건) |

---

## 상세 리뷰

### R8-T3-3: DrawdownMonitor peakEquity 영속성

**판정: 동의** (보완 1건)

Trader 제안의 `loadState()`/`getState()` 인터페이스 설계는 명확하고 최소 침습적이다. 기존 `drawdownMonitor.js`에 2개 메서드만 추가하면 되므로, 기존 로직에 부작용이 없다.

**코드 레벨 검증**:
- `riskEngine.js:43`에서 `this.drawdownMonitor`가 public 프로퍼티로 노출되어 있으므로, `botService.js`에서 `this.riskEngine.drawdownMonitor.loadState()` 호출이 가능하다.
- `BotSession.js:21`에 `peakEquity: { type: String, default: '0' }` 필드가 이미 존재한다.
- `botService.js:1496-1498`에서 이미 `session.stats.peakEquity`를 갱신하고 있다. 즉 MongoDB에 peakEquity가 주기적으로 기록되고 있다.

**보완 사항**:

1. **`isHalted` 상태도 복원할 것**: Trader 제안의 `loadState()`에서 peakEquity와 dailyStartEquity만 복원하지만, **`isHalted`와 `haltReason`도 복원해야 한다**. 서버 재시작 직전에 drawdown halt가 걸린 상태였다면, 재시작 후 halt가 풀려 보호 없이 거래가 재개된다. `BotSession` 모델에 `isHalted: Boolean, haltReason: String` 필드를 추가하거나, 최소한 `loadState()` 호출 후 즉시 `updateEquity(currentEquity)`를 호출하여 drawdown을 재계산하도록 해야 한다.

   **현실적 대안**: BotSession 스키마 변경 없이, `loadState()` 직후 `updateEquity(currentEquity)`를 호출하면 peakEquity 대비 현재 equity의 drawdown이 자동 재계산된다. drawdown 한도 초과 시 `halt()`가 트리거된다. 이 순서가 보장되면 `isHalted` 별도 영속화는 불필요하다.

   구체적 순서:
   ```
   1. const lastSession = await BotSession.findOne({ status: 'stopped' }).sort({ stoppedAt: -1 });
   2. if (lastSession?.stats?.peakEquity) {
        this.riskEngine.drawdownMonitor.loadState({ peakEquity: lastSession.stats.peakEquity });
      }
   3. const currentEquity = await this._fetchCurrentEquity();
   4. this.riskEngine.drawdownMonitor.updateEquity(currentEquity);
      // -> 이 시점에 drawdown 재계산 + 한도 초과 시 자동 halt
   ```

**레이스 컨디션 분석**: Trader가 우려할 수 있는 `start()` 내 로딩 순서 문제는 현재 구조에서 안전하다. `start()`는 `async`이고, `loadState()` 호출은 전략 활성화(step 8) 이전인 step 4~5 사이에 삽입하면 된다. 이 시점에는 아직 시그널이 발생하지 않으므로 레이스 컨디션이 없다.

**MongoDB I/O 영향**: `BotSession.findOne()` 1회 추가. 서버 시작 시 1회성이므로 성능 영향 무시 가능.

---

### R8-T3-2: Trailing Stop 구현

**판정: 조건부 동의** (보완 3건)

Trader 제안의 `strategyBase.js`에 공통 trailing 로직을 넣는 설계는 올바르다. 18개 전략에 흩어진 `_checkTpSl()` 중복을 제거하면서 trailing을 추가하는 것은 유지보수성 측면에서도 합리적이다.

그러나 실전 돈이 걸린 기능이므로 다음 보완이 필수적이다.

**보완 1 -- onFill() 시 trailing state 초기화 및 정리 안전성**:

Trader 제안에서 "onFill() 시 trailing state 초기화 필수 (highWaterMark 리셋)"라고 언급했지만, **구체적 시나리오가 누락**되었다.

현재 18개 전략의 `onFill()` 구현을 검토한 결과, 모든 전략이 `CLOSE_LONG`/`CLOSE_SHORT` 시 `this._positionSide = null; this._entryPrice = null;`로 리셋하는 패턴을 따른다. trailing state도 동일한 지점에서 리셋되어야 한다.

구현 시 다음 시나리오를 반드시 처리할 것:
- **OPEN -> CLOSE -> OPEN**: 첫 포지션의 highWaterMark가 두 번째 포지션에 잔류하면 안 됨
- **OPEN_LONG -> CLOSE_LONG -> OPEN_SHORT**: long의 highWaterMark가 short의 lowWaterMark 초기값이 되면 안 됨
- **서버 재시작 중 열린 포지션**: trailing state가 인메모리이므로, 재시작 후 entryPrice에서 trailing을 다시 시작해야 함. `onFill()`이 재시작 시 호출되지 않으므로, `stateRecovery` 과정에서 열린 포지션 탐지 시 trailing state를 entryPrice 기반으로 초기화하는 로직 필요

**권장 구현**:
```javascript
// strategyBase.js
_resetTrailingState() {
  this._trailingHighWaterMark = null;
  this._trailingLowWaterMark = null;
  this._trailingActivated = false;
}

// onFill의 CLOSE 분기에서 호출
// onFill의 OPEN 분기에서도 호출 (이전 잔여 state 정리)
```

**보완 2 -- trailingEnabled: false인 전략의 기존 동작 100% 보존**:

Trader 제안은 `trailingEnabled: false`가 기본이라고 했다. 그러나 `_checkTpSl()`를 base 클래스로 이전하면서 기존 로직이 미세하게 달라질 위험이 있다.

검증 방법: **기존 18개 전략의 백테스트를 구현 전/후 동일 데이터로 실행하여 결과(trades, PnL)가 바이트 수준으로 동일한지 비교**. R8-T3-1(멀티포지션)보다 먼저 구현하면 단일 포지션 기준으로 비교할 수 있으므로, 구현 순서도 T3-2 -> T3-1이 합리적이다(현재 Trader 제안 순서와 일치).

**보완 3 -- "18개 전략 파일 리팩토링"의 scope 축소**:

Trader 제안은 "18개 전략 파일 -- `_checkTpSl()` 중복 제거, base 클래스 위임"이라 했는데, 실제 코드를 확인하면 **`_checkTpSl()`이라는 이름의 메서드를 가진 전략은 `SupertrendStrategy` 1개뿐이다**. 다른 17개 전략은 `onTick()` 내부에서 TP/SL 로직을 인라인으로 또는 다른 이름(`_latestPrice`, `_entryPrice` 비교 패턴)으로 구현한다.

따라서 "18개 전략 일괄 리팩토링"은 이 라운드에서 scope가 과하다. **권장 접근**:
1. `strategyBase.js`에 `_checkTpSlBase()` (고정 SL/TP + trailing 옵션)를 추가
2. 추세 전략 6개(`trailingEnabled: true` 대상)만 base 메서드로 전환
3. 나머지 12개 전략은 기존 코드 유지 (향후 리팩토링 대상으로 백로그 등록)

이렇게 하면 구현 시간이 2~3시간에서 1.5~2시간으로 줄고, 변경 범위가 축소되어 회귀 리스크가 대폭 감소한다.

---

### R8-T3-1: 백테스트 멀티포지션 지원

**판정: 조건부 동의** (보완 2건)

Trader의 Map 기반 멀티포지션 설계는 합리적이다. `maxConcurrentPositions` 메타데이터가 이미 18개 전략 전부에 정의되어 있으므로 참조 인프라가 갖추어져 있다.

**보완 1 -- 메모리 관리 및 성능 가드레일**:

현재 `backtestEngine.js`는 1개 kline당 `_pendingSignals` 처리 + equity 스냅샷 기록을 수행한다. 멀티포지션으로 전환 시:
- `_calculateEquity()`: 현재 O(1)에서 O(N)으로 증가 (N = 열린 포지션 수). Grid 전략의 `maxConcurrentPositions: 3`이므로 최대 N=3. 성능 영향 무시 가능.
- `_forceClosePosition()`: 모든 포지션 순회하며 청산. N<=3이므로 문제 없음.
- **equity curve 배열 크기**: 변동 없음 (kline 수에만 비례).

**결론**: 현재 `maxConcurrentPositions` 최대값이 3(Grid 전략)이므로, 메모리/성능 문제는 발생하지 않는다. 다만 향후 대량 포지션 전략이 추가될 가능성에 대비하여, **Map size에 hard cap (예: 10)을 설정**할 것을 권장한다.

```javascript
const ABSOLUTE_MAX_POSITIONS = 10;
const maxPos = Math.min(
  metadata?.maxConcurrentPositions || 1,
  ABSOLUTE_MAX_POSITIONS
);
```

**보완 2 -- FIFO 청산의 모호성 해결**:

Trader 제안은 "FIFO (가장 오래된 포지션 먼저 청산) 또는 전략 신호에 포함된 positionId로 매칭"이라 했는데, 현재 전략의 signal 스펙에는 `positionId` 필드가 없다(`strategyBase.js:371` 참조). 따라서 **Round 10에서는 FIFO 전용으로 구현**하고, positionId 기반 매칭은 향후 과제로 남겨야 한다.

FIFO 구현 시 주의: Map의 iteration order는 insertion order이므로 FIFO에 적합하다. `Map.values().next().value`로 가장 오래된 포지션을 가져올 수 있다.

추가로, **`_closeLong` 시 short 포지션이 열려 있는 경우의 동작 정의**가 필요하다. 현재 단일 포지션에서는 `side !== 'long'`이면 skip하지만, 멀티포지션에서는 같은 side의 가장 오래된 포지션을 찾아 청산하는 로직이 필요하다.

---

### R8-T3-4: Sortino Ratio 산출

**판정: 동의** (보완 1건)

Trader 제안의 Sortino 구현은 표준 정의를 따르고 있다. 기존 `periodReturns` 배열 재활용, downside deviation 분모에 전체 period 수 사용 -- 올바르다.

Calmar Ratio 추가 제안도 1줄이므로 동의한다.

**보완 사항**:

Trader 제안 코드의 `sqrt()` 함수가 `backtestMetrics.js:42-46`에 정의된 `parseFloat`/`Math.sqrt` 기반 헬퍼를 사용한다. 이 함수는 부동소수점 연산이다. 프로젝트 규약은 "모든 금전적 값은 String"이지만, Sharpe/Sortino 같은 **통계 지표는 근사적 성격**이므로 `sqrt()`에 `parseFloat`를 쓰는 것은 허용 가능하다. 단, 이 점을 코드 주석에 명시하여 향후 개발자가 금전적 연산에 같은 패턴을 쓰지 않도록 경고해야 한다.

```javascript
// NOTE: sqrt uses parseFloat — acceptable for statistical ratios,
// but MUST NOT be used for monetary calculations (use mathUtils instead).
```

---

### R8-T3-5: 데드 코드 삭제 (StrategyPanel, ClientGate)

**판정: 동의**

독립 검증 완료:
- `import.*StrategyPanel|import.*ClientGate|from.*StrategyPanel|from.*ClientGate` grep 결과: **0건**. 두 파일 모두 어디에서도 import되지 않는다.
- `StrategyPanel.tsx` (297줄)은 `StrategyHub`로 대체 완료.
- `ClientGate.tsx` (22줄)은 Next.js 15 App Router의 `'use client'` 디렉티브로 대체 완료.

삭제 후 `npm run build` 검증은 UI 에이전트가 요청한 대로 수행할 것. 그러나 import가 0건이므로 빌드 실패 가능성은 0%이다.

---

### R8-T3-6: EquityCurveChart 공통 추출

**판정: 동의**

UI 에이전트의 설계안(`EquityCurveConfig` 인터페이스 + `EquityCurveBase` 공통 컴포넌트 + 기존 파일을 래퍼로 축소)은 깔끔하다. 기존 import 경로(`@/components/EquityCurveChart`, `@/components/backtest/BacktestEquityCurve`)가 유지되므로 소비자 변경 불필요.

시스템 관점에서 위험 요소 없음. `PerformanceTabs.tsx`도 변경 불필요하다는 UI 에이전트 분석에 동의한다.

---

### R8-T3-7: th scope="col" 일괄 추가

**판정: 동의**

88개 `<th>` 태그에 `scope="col"` 속성 추가. 순수 마크업 변경이므로 기능적 위험 0%.

UI 에이전트가 식별한 특수 케이스(조건부 렌더링, `.map()` 내부 동적 생성, onClick 핸들러 공존)도 모두 `scope` 속성 추가만으로 해결된다.

---

### R8-T3-8: TOOLTIP_STYLE 통일

**판정: 조건부 동의** (보완 1건)

UI 에이전트가 식별한 3개 파일의 로컬 `TOOLTIP_STYLE` 삭제 + `CHART_TOOLTIP_STYLE` import 교체는 올바르다.

**보완 사항**:

UI 에이전트가 **`CoinScoreboard.tsx`의 인라인 스타일**도 `CHART_TOOLTIP_STYLE`로 교체하겠다고 했다. 그런데 UI 에이전트 분석에서 CoinScoreboard의 인라인 스타일은 `border: '1px solid var(--border-subtle)'`로 다른 파일들의 `var(--border-muted)`와 다르다. **`CHART_TOOLTIP_STYLE`은 `border-muted`를 사용하므로**, CoinScoreboard에 그대로 적용하면 border 색상이 미세하게 변경된다.

이것이 의도적인 통일인지, 아니면 CoinScoreboard만 별도 border color가 필요한 이유가 있는지 UI 에이전트에게 확인을 요청한다. 의도적 통일이라면 동의한다 -- 실제로 `border-subtle` vs `border-muted`의 시각적 차이는 미미하고, 통일이 더 이로울 것이다.

---

## 우선순위 최종 의견

Trader 제안 우선순위에 동의한다. 순서를 재확인:

1. **R8-T3-3 (peakEquity)** -- 리스크 보호 구멍. 즉시 수정. 변경 범위 최소.
2. **R8-T3-2 (Trailing Stop)** -- 수익 임팩트 최대. 단, scope 축소 권장 (6개 전략만).
3. **R8-T3-4 (Sortino + Calmar)** -- 30분 작업. 비용 대비 효과 최고.
4. **R8-T3-1 (멀티포지션)** -- 구조적 리팩토링. FIFO 전용으로 scope 한정.
5. **R8-T3-5, T3-7, T3-8** -- FE 소규모 작업. 병렬 진행 가능.
6. **R8-T3-6** -- 마지막. 가장 구조적인 FE 변경.

**총 예상 시간**: BE 5~6h + FE ~95분 = 약 7.5h

---

## 다른 에이전트에게 전달 사항

### Trader Agent에게

1. **R8-T3-2 Trailing Stop scope 축소**: 18개 전략 일괄 리팩토링 대신, 추세 전략 6개만 base 메서드로 전환하는 것을 권장한다. 나머지 12개 전략의 `_checkTpSl()` / 인라인 TP/SL 제거는 향후 라운드의 "전략 TP/SL 공통화" 작업으로 분리할 것.

2. **R8-T3-1 FIFO 전용 구현**: positionId 기반 매칭은 현재 signal 스펙에 없으므로 이번 라운드에서 제외. FIFO만 구현하고, 향후 signal에 `positionId` 필드가 추가되면 확장할 것.

### UI Agent에게

1. **R8-T3-8 CoinScoreboard**: `border-subtle` -> `border-muted` 변경이 의도적 통일인지 확인. 의도적이면 진행.

2. **R8-T3-5 삭제 후 빌드 검증**: import 0건 확인 완료했으므로, 빌드 실패 위험은 사실상 없다. 그래도 `npm run build` 한 번은 돌려볼 것.
