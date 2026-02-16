# Round 10 Proposal — Tier 3 Enhancement (8건)

**작성자**: Senior Systems Engineer
**작성일**: 2026-02-16
**대상**: R8 Backlog 잔여 Tier 3 항목 전체 (8건)

---

## 분석 요약

최종 라운드. Tier 3 항목 8건을 시스템 무결성 관점에서 분석했다. 이 항목들은 기능적 완성도를 높이는 작업이지만, 일부(Trailing Stop, DrawdownMonitor 영속성)는 **실제 돈의 안전성에 직결**되므로 세심한 설계가 필요하다.

### 전체 우선순위 배치

| 순위 | ID | 제목 | 위험도 | 구현 난이도 | 예상 시간 |
|------|-----|------|--------|-------------|-----------|
| 1 | R8-T3-3 | DrawdownMonitor peakEquity 영속성 | **높음** | 중 | 1.5h |
| 2 | R8-T3-2 | Trailing Stop 구현 | **높음** | 높음 | 3h |
| 3 | R8-T3-1 | 백테스트 멀티포지션 지원 | 중 | 높음 | 2.5h |
| 4 | R8-T3-4 | Sortino Ratio 산출 | 낮음 | 낮음 | 0.5h |
| 5 | R8-T3-8 | TOOLTIP_STYLE 통일 | 낮음 | 낮음 | 0.5h |
| 6 | R8-T3-7 | th scope="col" 일괄 추가 | 낮음 | 낮음 | 0.5h |
| 7 | R8-T3-6 | EquityCurveChart 공통 추출 | 낮음 | 중 | 1h |
| 8 | R8-T3-5 | 데드 코드 삭제 | 낮음 | 낮음 | 0.3h |

**총 예상 시간: ~9.8h (BE ~7.5h + FE ~2.3h)**

---

## 발견 사항 (코드 레벨 근거 포함)

### R8-T3-3: DrawdownMonitor peakEquity 영속성 [위험도: 높음]

**현재 상태**: `drawdownMonitor.js:43-48`에서 peakEquity, dailyStartEquity 등이 순수 인메모리 변수:

```javascript
// drawdownMonitor.js:43-48
this.peakEquity = '0';
this.currentEquity = '0';
this.dailyStartEquity = '0';
this.dailyResetTime = null;
this.isHalted = false;
this.haltReason = null;
```

**핵심 문제점**:

1. **프로세스 재시작 시 peakEquity가 '0'으로 리셋** -- 서버 재시작 후 DrawdownMonitor가 현재 equity를 새로운 peak으로 인식한다. 만약 직전에 equity가 $10,000이었고 $8,000까지 떨어진 상태에서 재시작하면, $8,000이 새로운 peak이 되어 20% 낙폭이 사라진다. **이것은 리스크 보호를 완전히 무력화한다.**

2. **dailyStartEquity 동일 문제** -- 서버가 낮 중간에 재시작되면 일일 손실 카운터가 리셋된다.

3. **isHalted 상태 유실** -- 낙폭 초과로 거래 정지 상태에서 서버 재시작 시 정지가 해제된다. **자동화된 위험 회피 시스템이 재시작만으로 우회 가능하다는 뜻이다.**

**영속화 대상 (BotSession.stats에 이미 부분적으로 존재)**:
- `BotSession.js:21`에 `peakEquity: { type: String, default: '0' }` 존재
- `botService.js:1496-1498`에서 session.stats.peakEquity를 이미 업데이트 중
- 하지만 **이것은 DrawdownMonitor에 피드백되지 않는다** -- 두 시스템이 독립적으로 peak을 추적

**결론**: BotSession에 영속화된 peakEquity를 **서버 시작 시 DrawdownMonitor에 주입**하는 경로가 없다. 새로운 세션 생성 시 항상 '0'에서 시작한다.

---

### R8-T3-2: Trailing Stop 구현 [위험도: 높음]

**현재 상태**: 전략 수준에서 개별적으로 trailing stop을 구현하고 있음:

```javascript
// AdaptiveRegimeStrategy.js:102-104 (인스턴스 변수)
this._highestSinceEntry = null;
this._lowestSinceEntry = null;

// AdaptiveRegimeStrategy.js:186-210 (trend regime에서만)
if (this._isTrendRegime(this._entryRegime)) {
  const trailDistance = multiply(atrVal, '1');
  if (isLong && this._highestSinceEntry) {
    const trailingStop = subtract(this._highestSinceEntry, trailDistance);
    // ...
  }
}
```

**문제점**:

1. **18개 전략 중 1개만 trailing stop 보유** -- AdaptiveRegimeStrategy만 자체적으로 구현. 나머지 17개 전략은 고정 SL만 사용하거나 아예 없다.

2. **전략별 중복 구현 위험** -- 각 전략이 개별적으로 trailing stop을 구현하면, 버그가 전략별로 다르게 나타날 수 있다. **틈새 버그가 특정 전략에만 존재하여 대규모 손실을 유발하는 시나리오**.

3. **현재 아키텍처의 trailing stop 한계**:
   - `orderManager.js`의 `submitOrder()`는 `takeProfitPrice`/`stopLossPrice`만 지원 (L221-222)
   - Bitget API 수준의 trailing stop order는 `exchangeClient`에서 아직 래핑하지 않음
   - 전략의 `onTick()`에서 가격 변동 시마다 직접 체크하는 방식 (polling 기반)

4. **타이머/이벤트 관리 관점**:
   - 현재 trailing stop은 `onTick()` 콜백 내에서 동기적으로 체크하므로, 별도 타이머나 인터벌 불필요
   - 이 방식은 시스템 안정성 면에서 양호하나, **ticker 업데이트가 지연되면 trailing stop 실행도 지연**된다는 한계
   - Paper 모드에서 `paperEngine`의 가격 피드 간격에 종속

5. **StrategyBase에 공통 trailing stop을 넣을 경우의 리스크**:
   - StrategyBase.onTick()은 abstract이므로, 공통 로직을 넣으려면 hook 패턴(super.onTick() → strategy specific)으로 전환 필요
   - `onFill()` (L94-96)에서 entry 가격/side를 StrategyBase 수준에서 트래킹해야 함
   - **현재 각 전략이 entry 가격을 자체적으로 관리 중** -- StrategyBase에는 `_entryPrice` 같은 필드가 없음

---

### R8-T3-1: 백테스트 멀티포지션 지원 [위험도: 중]

**현재 상태**: `backtestEngine.js`는 단일 포지션 모델:

```javascript
// backtestEngine.js:223-224
this._position = null;   // 단일 포지션 (long/short, null이면 없음)
this._trades = [];

// backtestEngine.js:532-539
_openLong(kline) {
  if (this._position !== null) {   // <<< 이미 포지션이 있으면 스킵
    log.debug('OPEN_LONG skipped — already in position');
    return;
  }
```

**멀티포지션 전환 시 영향 분석**:

1. **자료구조 변경**: `this._position: Object|null` → `this._positions: Map<string, Object>` (key = `${symbol}:${side}`)
   - 현재 single symbol이므로 key는 `long`/`short`만으로 충분
   - 그러나 향후 multi-symbol 백테스트 고려하면 `${symbol}:${side}` 사용 권장

2. **equity 계산 복잡도 증가**: `_calculateEquity()`가 단일 포지션 기준:
   ```javascript
   // backtestEngine.js:883-906
   if (this._position === null) return this._cash;
   // ... long/short 단일 분기
   ```
   멀티포지션에서는 **모든 열린 포지션의 MTM(Mark-to-Market)을 합산**해야 한다.

3. **cash 관리 정합성**: 현재 opening 시 `_cash`에서 차감, closing 시 `_cash`에 가산하는 방식. 멀티포지션에서도 동일하게 동작하지만, **동시 포지션의 총 노출이 cash를 초과하면 마이너스 cash 발생 가능**. 이를 방지하는 exposure guard가 백테스트에는 없다.

4. **force close 로직**: `_forceClosePosition()`이 단일 포지션만 닫는다 → 모든 열린 포지션을 순회해야 함.

5. **funding 시뮬레이션**: `_applyFundingIfDue()`가 `this._position` 단일 참조 → 모든 열린 포지션에 대해 각각 적용해야 함.

6. **메모리/성능**: Map 기반은 적절. 백테스트는 동기 루프이므로 동시성 문제는 없다.

---

### R8-T3-4: Sortino Ratio 산출 [위험도: 낮음]

**현재 상태**: `backtestMetrics.js`는 Sharpe Ratio만 산출 (L235-277):

```javascript
// backtestMetrics.js:236-276
// Sharpe ratio (annualised, scaled by interval periods/year, risk-free = 0)
let sharpeRatio = '0.00';
const periodsPerYear = _getPeriodsPerYear(interval);

if (equityCurve.length >= 2) {
  const periodReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const ret = pctChange(prevEquity, currEquity);
    periodReturns.push(ret);
  }
  // Mean, StdDev, Annualise
}
```

**Sortino Ratio 구현 분석**:

1. **수학적 차이**: Sharpe는 전체 변동성(stdDev)으로 나누지만, Sortino는 **하방 변동성(downside deviation)**으로만 나눈다.
   - downside deviation = sqrt(mean of (min(return - target, 0))^2)
   - target은 보통 0 (risk-free rate)

2. **기존 코드 재활용도 높음**: periodReturns 배열 계산 로직을 공유하고, 음수 수익률만 필터하여 하방 편차를 산출하면 된다.

3. **정합성 주의점**:
   - `sqrt()` 헬퍼 (L42-46)가 parseFloat을 사용하는데, 이는 mathUtils의 String 산술 원칙을 위반한다. 그러나 Sharpe에서도 같은 함수를 쓰므로 일관성은 유지됨.
   - 하방 수익률이 0건이면 division by zero → '999.99' 또는 '0.00' 처리 필요

4. **edge case**: 모든 수익률이 양수이면 downside deviation = 0 → Sortino = 무한대. Sharpe의 '999.99' 패턴과 동일하게 처리 가능.

---

### R8-T3-5: 데드 코드 삭제 (StrategyPanel, ClientGate) [위험도: 낮음]

**현재 상태 확인 결과**:

- **StrategyPanel.tsx** (297줄): `StrategyPanel`을 import하는 파일이 **0개**. 완전한 데드 코드.
- **ClientGate.tsx** (22줄): `ClientGate`를 import하는 파일이 **0개**. 완전한 데드 코드.

**삭제 안전성**: 두 파일 모두 어디서도 참조되지 않으므로 안전하게 삭제 가능. StrategyPanel의 기능은 `strategy/StrategyHub.tsx` + `strategy/StrategyCard.tsx`로 대체되었고, ClientGate는 Next.js 15 App Router의 Suspense/streaming 방식으로 대체된 것으로 보인다.

---

### R8-T3-6: EquityCurveChart 공통 추출 [위험도: 낮음]

**현재 상태**:

- `EquityCurveChart.tsx` (80줄): 대시보드용 -- `EquityPoint[]` (timestamp, equity, unrealizedPnl)
- `BacktestEquityCurve.tsx` (92줄): 백테스트용 -- `BacktestEquityPoint[]` (ts, equity, cash)

**차이점 분석**:

| 속성 | EquityCurveChart | BacktestEquityCurve |
|------|------------------|---------------------|
| 데이터 필드 | timestamp, equity, unrealizedPnl | ts, equity, cash |
| X축 포맷 | `toLocaleTimeString (HH:MM)` | `toLocaleString (MM/DD HH:MM)` |
| 주선 색상 | `var(--accent)` | `#4ADE80` |
| 주선 두께 | 1.5 | 2 |
| 보조선 데이터 | `pnl` (unrealizedPnl) | `cash` |
| Y축 axisLine | `false` | `stroke: var(--border-subtle)` |
| fontSize | 10 | 11 |
| tooltip label | '자산' / '미실현 PnL' | '에쿼티' / '현금' |
| activeDot | `{r:3}` / `{r:2}` | `{r:4}` / `{r:3}` |

**공통 추출 가능성**: 구조적으로 거의 동일하지만, 세부 스타일과 데이터 매핑이 다르다. **Props 기반 구성**으로 통합 가능:
- `dataMapper: (point) => { time, primary, secondary }`
- `primaryLabel`, `secondaryLabel`
- `primaryColor`, `strokeWidth`, `fontSize` 등

---

### R8-T3-7: th scope="col" 일괄 추가 [위험도: 낮음]

**현재 상태**: 총 **72개의 `<th>` 태그**가 `scope` 속성 없이 사용 중:

- `PositionsTable.tsx`: 10개
- `TradesTable.tsx`: 9개
- `StrategyDetail.tsx`: 14개
- `StrategySymbolMap.tsx`: 8개
- `SymbolRegimeTable.tsx`: 4개
- `CoinScoreboard.tsx`: 7개
- `SymbolPerformance.tsx`: 4개
- `StrategyPerformance.tsx`: 4개
- `BacktestTradeList.tsx`: 8개
- `tournament/page.tsx`: ~8개 (동적 생성 포함)
- `DailyPerformance.tsx`: 0개 (테이블 없음, 차트만)

**WCAG 2.1 관점**: `scope="col"`은 접근성 AA 수준 요구사항. 스크린 리더가 테이블 헤더와 데이터 셀의 관계를 파악하는 데 필수적. 기계적 일괄 추가가 가능하며 사이드이펙트 없음.

---

### R8-T3-8: TOOLTIP_STYLE 통일 [위험도: 낮음]

**현재 상태**: 3가지 tooltip 스타일이 공존:

1. **`CHART_TOOLTIP_STYLE`** (`lib/chart-config.ts`): 4개 파일에서 import
   ```typescript
   { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-muted)',
     borderRadius: '8px', fontSize: '12px', padding: '8px 12px' }
   ```

2. **로컬 `TOOLTIP_STYLE`**: 3개 analytics 파일에서 각각 선언
   ```typescript
   { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-muted)',
     borderRadius: '6px', fontSize: '11px', padding: '8px 12px' }
   ```
   차이: `borderRadius: '6px'` vs `'8px'`, `fontSize: '11px'` vs `'12px'`

3. **인라인 스타일**: `CoinScoreboard.tsx` (L100-104)
   ```typescript
   contentStyle={{ backgroundColor: 'var(--bg-elevated)',
     border: '1px solid var(--border-subtle)',  // border-subtle vs border-muted
     borderRadius: 6, fontSize: 11 }}
   ```
   차이: `border-subtle` vs `border-muted`, padding 누락

**통일 방안**: `CHART_TOOLTIP_STYLE`을 표준으로 채택하고, 3개 로컬 상수 + 1개 인라인을 모두 import로 교체. borderRadius/fontSize 차이는 미미하지만, **`border-subtle` vs `border-muted`**는 시각적 일관성에 영향.

---

## 제안 사항

### R8-T3-3: DrawdownMonitor peakEquity 영속성

**구현 방안**:

1. **BotSession.stats 스키마 확장** (`models/BotSession.js`):
   ```javascript
   // 기존 peakEquity에 추가 필드
   dailyStartEquity: { type: String, default: '0' },
   drawdownHalted: { type: Boolean, default: false },
   drawdownHaltReason: { type: String, default: null },
   ```

2. **DrawdownMonitor에 hydrate/dehydrate 메서드 추가** (`services/drawdownMonitor.js`):
   ```javascript
   hydrate({ peakEquity, dailyStartEquity, isHalted, haltReason }) {
     if (peakEquity && peakEquity !== '0') {
       this.peakEquity = peakEquity;
     }
     if (dailyStartEquity && dailyStartEquity !== '0') {
       this.dailyStartEquity = dailyStartEquity;
     }
     if (isHalted) {
       this.isHalted = true;
       this.haltReason = haltReason;
     }
     log.info('DrawdownMonitor hydrated from persistent state', {
       peakEquity: this.peakEquity, dailyStartEquity: this.dailyStartEquity,
       isHalted: this.isHalted,
     });
   }

   dehydrate() {
     return {
       peakEquity: this.peakEquity,
       dailyStartEquity: this.dailyStartEquity,
       isHalted: this.isHalted,
       haltReason: this.haltReason,
     };
   }
   ```

3. **BotService.start()에서 최신 세션의 drawdown 상태 복원** (`services/botService.js`):
   - 서버 시작 시, 가장 최근 BotSession의 stats에서 peakEquity/dailyStartEquity를 읽어 DrawdownMonitor에 주입
   - `_updateSessionStats()`에서 peakEquity 갱신 시 동시에 dailyStartEquity도 영속화

4. **Snapshot과의 연계**: 현재 `_generateSnapshot()`에서 equity 스냅샷을 생성 중. 여기서도 drawdownMonitor 상태를 함께 영속화하면 더 안전.

**변경 파일**:
- `backend/src/services/drawdownMonitor.js` -- hydrate/dehydrate 추가
- `backend/src/models/BotSession.js` -- statsSubSchema 확장
- `backend/src/services/botService.js` -- start()에서 복원, _updateSessionStats()에서 영속화
- `backend/src/services/riskEngine.js` -- hydrateDrawdown() 래퍼 메서드

**안전 장치**:
- hydrate 시 peakEquity가 현재 equity보다 낮으면 현재 equity를 사용 (방어적)
- isHalted 복원 시 로그 경고 출력하여 관리자에게 알림
- DB에서 읽어온 값이 없거나 '0'이면 hydrate 스킵 (기존 동작 유지)

---

### R8-T3-2: Trailing Stop 구현

**설계 원칙**: StrategyBase 수준의 공통 trailing stop은 **옵트인 방식**으로 구현. 전략이 명시적으로 활성화해야 동작.

**구현 방안**:

1. **StrategyBase에 trailing stop 인프라 추가** (`services/strategyBase.js`):
   ```javascript
   // 생성자에 추가
   this._trailingStopEnabled = false;
   this._trailingStopConfig = {
     activationPercent: '1',    // 진입가 대비 1% 수익 이후 활성화
     trailPercent: '0.5',       // 최고점 대비 0.5% 하락 시 트리거
     trailAtrMultiplier: null,  // ATR 기반 사용 시 (null이면 percent 사용)
   };
   this._trailingState = {
     entryPrice: null,
     positionSide: null,
     extremePrice: null,        // highest (long) or lowest (short)
     activated: false,           // activation threshold 통과 여부
   };
   ```

2. **공통 checkTrailingStop() 메서드**:
   ```javascript
   _checkTrailingStop(price) {
     if (!this._trailingStopEnabled || !this._trailingState.entryPrice) return null;
     // ... activation check, extreme update, trigger check
     // 반환: null (유지) | { action, reason: 'trailing_stop' }
   }
   ```

3. **onFill() 오버라이드에서 entryPrice 캡처**:
   - StrategyBase.onFill()이 현재 no-op이므로, trailing state를 여기서 초기화
   - 서브클래스가 super.onFill()을 호출하도록 문서화

4. **전략 메타데이터에 trailingStop 설정 추가**:
   ```javascript
   static metadata = {
     // ...
     trailingStop: {
       enabled: true,
       activationPercent: '1.5',
       trailPercent: '0.8',
     },
   };
   ```

**변경 파일**:
- `backend/src/services/strategyBase.js` -- trailing stop 인프라
- 18개 전략 파일 -- metadata에 trailingStop 설정 추가 (opt-in)
- `backend/src/backtest/backtestEngine.js` -- 백테스트에서도 trailing stop 시뮬레이션

**시스템 안정성 고려사항**:
- **타이머 불필요**: onTick() 내에서 동기적으로 체크하므로 타이머/인터벌 관리 부담 없음
- **메모리**: `_trailingState` 객체 5개 필드 -- 무시할 수준
- **에러 격리**: _checkTrailingStop()을 try-catch로 감싸고, 실패 시 trailing stop을 비활성화하되 포지션 유지 (fail-safe)
- **중복 close 방지**: `_checkTrailingStop()`이 close 시그널을 emit한 후 `_trailingState`를 즉시 리셋하여 중복 신호 방지
- **AdaptiveRegimeStrategy 호환**: 이미 자체 trailing stop이 있으므로, metadata에서 `trailingStop.enabled: false`로 설정하여 공통 trailing과 충돌 방지

---

### R8-T3-1: 백테스트 멀티포지션 지원

**구현 방안**:

1. **자료구조 변경** (`backtestEngine.js`):
   ```javascript
   // 기존: this._position = null;
   // 변경:
   this._positions = new Map();  // key: 'long' | 'short'
   this._maxConcurrentPositions = 2;  // 최대 동시 포지션 (long + short)
   ```

2. **_openLong/_openShort 수정**:
   ```javascript
   _openLong(kline) {
     if (this._positions.has('long')) return;  // 같은 방향 중복 방지
     if (this._positions.size >= this._maxConcurrentPositions) return;  // 총 포지션 수 제한
     // ... 기존 로직
     this._positions.set('long', { side: 'long', entryPrice, qty, ... });
   }
   ```

3. **_calculateEquity 수정**:
   ```javascript
   _calculateEquity(kline) {
     let equity = this._cash;
     for (const [, pos] of this._positions) {
       if (pos.side === 'long') {
         equity = math.add(equity, math.multiply(pos.qty, kline.close));
       } else {
         const entryNotional = math.multiply(pos.qty, pos.entryPrice);
         const unrealized = math.multiply(pos.qty, math.subtract(pos.entryPrice, kline.close));
         equity = math.add(equity, math.add(entryNotional, unrealized));
       }
     }
     return equity;
   }
   ```

4. **funding 시뮬레이션 수정**: `_applyFundingIfDue()`가 모든 열린 포지션에 대해 순회.

5. **force close 수정**: `_forceClosePosition()`이 모든 열린 포지션을 순회하여 닫음.

6. **position size 조정**: 멀티포지션 시 `_positionSizePct`를 포지션 수로 분할할지, 동일하게 유지할지 설정 가능하게.

**안전 장치**:
- `_maxConcurrentPositions` 상한(default 2, max 5)으로 메모리 제한
- `_positions.size` 체크를 모든 open 메서드에 추가
- 같은 방향의 중복 포지션 방지 (현재와 동일한 보호)

**변경 파일**:
- `backend/src/backtest/backtestEngine.js` -- 핵심 변경
- `backend/src/backtest/backtestMetrics.js` -- 멀티포지션 관련 메트릭 추가 필요 시

---

### R8-T3-4: Sortino Ratio 산출

**구현 방안** (`backtestMetrics.js`):

```javascript
// Sharpe 산출 블록 직후 (L277 근처)에 추가:
let sortinoRatio = '0.00';

if (periodReturns.length > 0) {
  // Downside deviation: sqrt(mean((min(r, 0))^2))
  let sumSquaredDownside = '0';
  let downsideCount = 0;
  for (const r of periodReturns) {
    if (isLessThan(r, '0')) {
      const squaredDown = multiply(r, r);
      sumSquaredDownside = add(sumSquaredDownside, squaredDown);
      downsideCount++;
    }
  }

  if (downsideCount > 0) {
    const downsideVariance = divide(sumSquaredDownside, String(periodReturns.length));
    const downsideDeviation = sqrt(downsideVariance);
    if (!isZero(downsideDeviation)) {
      const sqrtPeriods = sqrt(String(periodsPerYear));
      const annualisedReturn = multiply(meanReturn, sqrtPeriods);
      sortinoRatio = toFixed(divide(annualisedReturn, downsideDeviation), 2);
    } else {
      sortinoRatio = isGreaterThan(meanReturn, '0') ? '999.99' : '0.00';
    }
  } else {
    // 하방 수익률 없음 = 모든 수익이 양수
    sortinoRatio = isGreaterThan(meanReturn, '0') ? '999.99' : '0.00';
  }
}
```

**주의사항**:
- `meanReturn` 변수를 periodReturns 블록 바깥으로 끌어올려야 Sortino에서도 참조 가능
- 현재 `meanReturn`은 if 블록 안에 선언되어 있으므로 스코프 조정 필요 (L258)
- `sumSquaredDownside`를 **전체 periodReturns.length**로 나눈다 (하방 수익률 수가 아닌 전체 기간)

**변경 파일**:
- `backend/src/backtest/backtestMetrics.js` -- Sortino 계산 추가
- 반환 객체에 `sortinoRatio` 필드 추가

---

### R8-T3-5 ~ R8-T3-8: 프론트엔드 항목

**R8-T3-5 (데드 코드 삭제)**:
- `StrategyPanel.tsx` 삭제 -- 어디서도 import하지 않음. 확인 완료.
- `ClientGate.tsx` 삭제 -- 어디서도 import하지 않음. 확인 완료.
- **타입 정리**: StrategyPanel이 사용하는 `StrategyListItem` 타입이 다른 곳에서도 쓰이는지 확인 필요 (사이드이펙트 방지)

**R8-T3-6 (EquityCurveChart 공통 추출)**:
- 두 컴포넌트의 차이가 data mapping + 스타일 상수 수준이므로, props 기반 통합 가능
- 제안: `BaseEquityCurve` 공통 컴포넌트를 만들고, 기존 두 파일은 thin wrapper로 유지
- **시스템 안전성**: 공통 추출은 FE 전용이므로 BE 안정성에 영향 없음. 다만 리팩토링 과정에서 기존 import 경로가 변경되지 않도록 주의.

**R8-T3-7 (th scope="col")**:
- 총 72개 `<th>` 태그에 `scope="col"` 일괄 추가
- 대상 파일 10개: PositionsTable, TradesTable, StrategyDetail, StrategySymbolMap, SymbolRegimeTable, CoinScoreboard, SymbolPerformance, StrategyPerformance, BacktestTradeList, tournament/page.tsx
- **기계적 변환**: `<th` → `<th scope="col"`, `<th className` → `<th scope="col" className`
- 동적 생성된 `<th>` (tournament/page.tsx L394, L435)도 포함

**R8-T3-8 (TOOLTIP_STYLE 통일)**:
- `CHART_TOOLTIP_STYLE` (`lib/chart-config.ts`)을 표준으로 채택
- 변경 대상:
  1. `DailyPerformance.tsx`: 로컬 TOOLTIP_STYLE → import CHART_TOOLTIP_STYLE
  2. `StrategyPerformance.tsx`: 로컬 TOOLTIP_STYLE → import CHART_TOOLTIP_STYLE
  3. `SymbolPerformance.tsx`: 로컬 TOOLTIP_STYLE → import CHART_TOOLTIP_STYLE
  4. `CoinScoreboard.tsx`: 인라인 스타일 → import CHART_TOOLTIP_STYLE
- **미세 차이 통일**: borderRadius `6px → 8px`, fontSize `11px → 12px`로 통일. 시각적 차이 미미.
- **border-subtle vs border-muted 해결**: CoinScoreboard만 `border-subtle` 사용 중. `border-muted`로 통일.

---

## 다른 에이전트에게 요청 사항

### Trader Agent (전략/백테스트 전문가)에게

1. **R8-T3-2 (Trailing Stop)**: 전략별 trailing stop 파라미터 결정 필요
   - 각 18개 전략에 대해 `activationPercent`와 `trailPercent` 최적값 제안
   - AdaptiveRegimeStrategy의 기존 ATR 기반 trailing과의 공존 방안 확인
   - 백테스트로 trailing stop 유/무 비교 데이터 생성

2. **R8-T3-1 (멀티포지션)**: 멀티포지션이 실제로 필요한 전략 명시
   - Grid, AdaptiveRegime 등이 주 후보
   - 포지션 크기 분할 정책 결정 (균등 분할 vs 전략 자율)

3. **R8-T3-4 (Sortino)**: FE에서 Sortino Ratio를 어디에 표시할지 결정
   - BacktestStatsPanel에 추가 필드
   - Sharpe 옆에 병렬 배치 vs 별도 섹션

### UI Agent (프론트엔드 전문가)에게

1. **R8-T3-5 (데드 코드)**: 삭제 전 `StrategyListItem` 타입의 다른 사용처 확인
2. **R8-T3-6 (EquityCurveChart)**: BaseEquityCurve의 Props 인터페이스 설계
   - `dataMapper`, `primaryLabel`, `secondaryLabel`, `primaryColor`, `strokeWidth` 등
   - 향후 tournament 페이지의 equity curve에도 재사용 가능하도록
3. **R8-T3-7 (th scope)**: tournament/page.tsx의 동적 `<th>` 생성 부분에서 scope 추가 방법 확인
4. **R8-T3-8 (TOOLTIP_STYLE)**: borderRadius/fontSize 미세 차이를 통일할 때 디자인 의도 확인 필요 (analytics 차트가 의도적으로 더 작은 borderRadius를 쓴 것인지)

---

## 구현 순서 제안

```
Phase 1 (안전 최우선):
  R8-T3-3  DrawdownMonitor 영속성   [BE, 1.5h]
  R8-T3-4  Sortino Ratio            [BE, 0.5h]

Phase 2 (핵심 기능):
  R8-T3-2  Trailing Stop            [BE, 3h]
  R8-T3-1  멀티포지션 백테스트      [BE, 2.5h]

Phase 3 (FE 정리):
  R8-T3-5  데드 코드 삭제           [FE, 0.3h]
  R8-T3-8  TOOLTIP_STYLE 통일       [FE, 0.5h]
  R8-T3-7  th scope="col"           [FE, 0.5h]
  R8-T3-6  EquityCurveChart 추출    [FE, 1h]
```

Phase 1을 먼저 구현하는 이유: DrawdownMonitor 영속성 부재는 **현재 프로덕션 배포 시 실질적 위험**이다. 프로세스 재시작만으로 리스크 보호가 무력화되는 것은 즉시 수정해야 한다.
