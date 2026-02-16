# Round 7 Proposal: 레짐 변경 빈도 문제 -- A+B 조합 설계

**작성일**: 2026-02-16
**작성자**: Senior Systems Engineer (Claude Opus 4.6)
**범위**: 레짐 전환 안정화, 전략 deactivate 유예기간, 타이머/리소스 관리, 동시성 보호

---

## 분석 요약

1분 캔들(`candle1m`) 기반 MarketRegime이 `hysteresisMinCandles: 3`으로 설정되어 있어, 레짐 전환이 **최소 3분 만에** 발생할 수 있다. StrategyRouter는 레짐 변경 이벤트를 수신하면 즉시 `strategy.deactivate()`를 호출하여 전략을 비활성화한다. 이는 다음 문제를 야기한다:

- **전략 진입 기회 상실**: 전략이 활성화되어 시장 데이터를 축적하고 시그널 컨피던스를 쌓기까지 수분~수십분이 필요한데, 3분 만에 비활성화되면 진입 기회 자체가 없다
- **열린 포지션의 조기 고아화**: StrategyRouter.deactivate()는 `_active = false` + `_symbols.clear()`를 수행하므로, 전략이 비활성화되면 해당 전략의 열린 포지션에 대한 SL/TP 관리가 중단된다
- **노이즈 기반 전환**: 1분 캔들의 일시적 변동이 레짐 전환을 유발할 수 있고, 히스테리시스 3캔들은 이를 충분히 필터링하지 못한다

### 핵심 발견

| 항목 | 현재 상태 | 위험도 |
|------|----------|--------|
| `hysteresisMinCandles` | 3 (1분 캔들 기준 3분) | **높음** - 노이즈 민감 |
| 레짐 전환 쿨다운 | **없음** | **높음** - 연속 전환 가능 |
| deactivate 유예기간 | **없음** | **높음** - 즉시 비활성화 |
| deactivate 시 포지션 처리 | `_active=false`, `_symbols.clear()` | **중간** - 관리 중단 |
| 레짐 전환 이벤트 로깅 | 기본 info 로그만 | **낮음** - 빈도 분석 불가 |

---

## 발견 사항

### R7-1. [핵심] hysteresisMinCandles = 3은 1분 캔들 기반에서 불충분

**파일**: `backend/src/services/marketRegime.js` 줄 67, 673-758
**파일**: `backend/src/services/regimeParamStore.js` 줄 49

**현재 코드**:
```javascript
// marketRegime.js FALLBACK_PARAMS
hysteresisMinCandles: 3,

// regimeParamStore.js DEFAULT_PARAMS
hysteresisMinCandles: 3,
```

**분석**: `marketData.js` 줄 155-158에서 `candle1m`을 구독하므로, `_onBtcKline`은 매 1분마다 호출된다. 히스테리시스 카운터가 3이면 3분 연속으로 새 레짐이 최고 점수를 받으면 전환된다.

RegimeOptimizer의 `PARAM_RANGES`에서 `hysteresisMinCandles`의 범위는 `[2, 5]`로 설정되어 있어(regimeOptimizer.js 줄 51), 자동 최적화도 이 문제를 해결할 수 없다 -- 최대 5분까지만 늘어날 수 있기 때문이다.

**실제 시나리오**: BTC 가격이 일시적 변동(뉴스 스파이크, 대량 주문)을 겪으면:
1. Factor 1(Multi-SMA Trend)과 Factor 3(ROC Momentum)이 순간적으로 VOLATILE 또는 반대 트렌드 점수를 높임
2. 3분 연속 이런 점수가 나오면 레짐 전환
3. StrategyRouter가 `_routeStrategies()`를 호출하여 비호환 전략 비활성화
4. 5분 후 가격이 원래 추세로 복귀 → 또 레짐 전환 → 전략 다시 활성화
5. 전략은 내부 상태가 초기화(deactivate → `_symbols.clear()`)되어 처음부터 다시 시작

### R7-2. [핵심] 레짐 전환 쿨다운 메커니즘 부재

**파일**: `backend/src/services/marketRegime.js` 줄 673-758

**현재 코드**: `_applyHysteresis` 메서드는 순수하게 연속 캔들 카운트만 추적한다.

```javascript
_applyHysteresis(candidateRegime, confidence, scores, params) {
    const minCandles = params.hysteresisMinCandles;
    // ... 연속 카운트 확인 후 즉시 전환
    if (this._pendingCount >= minCandles) {
        // 즉시 전환 — 쿨다운 없음
        this._currentRegime = candidateRegime;
        // ...
    }
}
```

**문제**: 레짐이 A→B로 전환된 직후, B가 불안정하면 다시 B→A 또는 B→C로 전환될 수 있다. 전환 간 최소 간격이 없으므로, 이론적으로 6분 동안 A→B→C 두 번 전환이 가능하다 (각 3분 히스테리시스).

**영향**:
- 전략이 6분 안에 `activate → deactivate → activate`를 겪을 수 있음
- 매 activate/deactivate 시 이벤트 리스너 등록/해제가 발생하여 불필요한 오버헤드
- 로그가 전환 이벤트로 범람

### R7-3. [핵심] StrategyRouter의 즉시 deactivate -- 유예기간 없음

**파일**: `backend/src/services/strategyRouter.js` 줄 131-193

**현재 코드**:
```javascript
_routeStrategies(regime, previousRegime) {
    for (const strategy of this._strategies) {
        const shouldBeActive = targetRegimes.includes(regime);
        if (!shouldBeActive && strategy.isActive()) {
            // 즉시 비활성화 — 유예 없음
            strategy.deactivate();
            deactivated.push(strategy.name);
        }
    }
}
```

**분석**: `strategyBase.js`의 `deactivate()`는 `_active = false`와 `_symbols.clear()`를 수행한다 (줄 127-131). 이는 다음을 의미한다:

1. **내부 버퍼 보존**: `deactivate()`는 `_ema9`, `_sma20Buffer` 등 전략 내부 인디케이터 버퍼를 초기화하지 않음 → 양호
2. **심볼 셋 초기화**: `_symbols.clear()`로 전략이 어떤 심볼에 할당되었는지 잃어버림
3. **틱/캔들 무시**: `botService.js` 줄 286에서 `strategy.isActive()` 체크로 비활성 전략은 데이터를 받지 못함
4. **시그널 차단**: 비활성 전략은 emitSignal()을 호출해도 BotService의 onTick/onKline 루프에서 걸러짐

**열린 포지션 문제**: 비활성화된 전략이 연 포지션은 그대로 남지만, 전략의 SL/TP 로직이 더 이상 호출되지 않는다. 이는 다음 경우에만 안전하다:
- SL/TP가 거래소 측 조건부 주문으로 설정된 경우 (서버 사이드 SL)
- paperEngine이 자체적으로 SL 트리거를 관리하는 경우

그러나 전략이 소프트웨어 기반 SL (onTick에서 가격 모니터링 → closeLong/closeShort 시그널)을 사용한다면, 비활성화 시 SL이 작동하지 않아 **무한 손실 위험**이 있다.

### R7-4. [분석] BotService의 _gracefulDisabledStrategies와의 상호작용

**파일**: `backend/src/services/botService.js` 줄 99-100, 935-970, 1172-1184

`_gracefulDisabledStrategies`는 사용자가 수동으로 전략을 비활성화할 때 사용하는 메커니즘이다:
- `disableStrategy(name, { mode: 'graceful' })` → 전략을 리스트에서 제거하되, `_gracefulDisabledStrategies`에 추가
- 이후 해당 전략의 OPEN 시그널은 차단, CLOSE 시그널은 허용

**A+B 조합 설계 시 고려점**:
- StrategyRouter의 레짐 기반 deactivate 유예기간과 BotService의 graceful disable이 충돌할 수 있음
- 유예 중인 전략을 사용자가 수동으로 disable하면? → 유예 타이머 정리 필요
- 유예 중인 전략이 봇 stop 시 → 유예 타이머 정리 필요

### R7-5. [분석] 레짐 히스테리시스 가중치(Factor 6)의 정적 보너스

**파일**: `backend/src/services/marketRegime.js` 줄 396

```javascript
// Hysteresis bonus: current regime gets a small bonus
scores[this._currentRegime] += w.hysteresis; // 기본값 0.10
```

현재 레짐에 대한 보너스는 0.10으로 고정되어 있다. 이는 5개 레짐의 다른 팩터 점수 합이 0.90 범위에서 경합하는 상황에서, 0.10 보너스는 **상당한 방어력**을 제공한다. 그러나:
- 레짐 전환 직후에는 새 레짐이 0.10 보너스를 받아, 원래 레짐으로 돌아가기 어려움 (ping-pong 방지 효과)
- 하지만 이 메커니즘이 있음에도 3분 히스테리시스가 불충분하다는 것은, 팩터 점수 변동폭이 0.10 보너스를 압도할 만큼 크다는 의미

### R7-6. [분석] 타이머/리스너 누수 가능성 분석

**StrategyRouter 리스너**:
- `start()` 시 `REGIME_CHANGE` 리스너 1개 등록 → `stop()` 시 제거 → **양호**
- BotService의 `_eventCleanups`에도 `strategyRouter.stop()` 등록 → **이중 보호**

**MarketRegime 리스너**:
- `start()` 시 `KLINE_UPDATE`, `aggregate:update` 리스너 등록 → `stop()` 시 제거 → **양호**
- `_running` 플래그로 중복 start 방지 → **양호**

**RegimeOptimizer 타이머**:
- `start()` 시 `setInterval` → `stop()` 시 `clearInterval` → **양호**
- `_optimizing` 플래그로 동시 실행 방지 → **양호**

**A+B 구현 시 신규 타이머 위험**:
- 유예기간 타이머(`setTimeout`)를 전략별로 생성 → 정리하지 않으면 누수
- 레짐 쿨다운 타이머 → 단순 timestamp 비교로 구현 시 타이머 불필요 (권장)

### R7-7. [분석] 18개 전략의 레짐 커버리지 분석

각 전략의 `targetRegimes`를 분석하면:

| 레짐 | 해당 전략 수 | 전략 이름 |
|------|-------------|----------|
| trending_up | 12 | MaTrend, Funding, RsiPivot, Supertrend, Bollinger를 제외한 대부분 |
| trending_down | 12 | 위와 동일 |
| ranging | 9 | Grid, Bollinger, Vwap, Fibonacci, SupportResistance, CandlePattern, MacdDivergence, RsiPivot, Breakout |
| volatile | 10 | Turtle, CandlePattern, SupportResistance, SwingStructure, Trendline, Funding, Supertrend, Bollinger, MacdDivergence, AdaptiveRegime |
| quiet | 4 | QuietRangeScalp, Breakout, Vwap, AdaptiveRegime |

**관찰**:
- `quiet` 레짐에서 활성화되는 전략은 4개뿐 → quiet→volatile 전환 시 대규모 전략 교체 발생
- `trending_up`과 `trending_down`의 전략 셋이 거의 동일 → 이 둘 간 전환은 전략 교체가 최소
- `ranging`↔`volatile` 전환도 상당한 전략 교체를 유발 (Grid, Vwap만 ranging, Turtle, SwingStructure 등은 volatile만)

→ 유예기간이 특히 필요한 전환: `quiet ↔ volatile`, `quiet ↔ trending`, `ranging ↔ volatile`

---

## 제안 사항

### A. 레짐 전환 안정화 (MarketRegime 측)

#### A-1. hysteresisMinCandles 상향 + RegimeOptimizer 범위 확대

**우선순위**: P0 (즉시)
**난이도**: 낮음
**예상 시간**: 20분

**변경 내용**:

```javascript
// marketRegime.js FALLBACK_PARAMS
hysteresisMinCandles: 8,  // 3 → 8 (8분 연속 확인 필요)

// regimeParamStore.js DEFAULT_PARAMS
hysteresisMinCandles: 8,  // 동일하게 상향

// regimeOptimizer.js PARAM_RANGES
hysteresisMinCandles: [5, 15],  // [2, 5] → [5, 15]
```

**근거**: 1분 캔들 기준 8분은 여전히 빠른 반응이지만, 일시적 스파이크(1-3분)를 필터링한다. 옵티마이저 범위를 [5, 15]로 확장하여 최적값을 자동 탐색할 수 있게 한다.

#### A-2. 레짐 전환 쿨다운 (Transition Cooldown)

**우선순위**: P0 (즉시)
**난이도**: 중간
**예상 시간**: 40분

**설계**:

```javascript
// MarketRegime 클래스에 추가
/** @private 마지막 레짐 전환 시각 (ms) */
this._lastTransitionTs = 0;

/** @private 전환 쿨다운 (ms) — 파라미터화 */
// FALLBACK_PARAMS에 추가:
transitionCooldownMs: 300000,  // 5분 (기본값)

// _applyHysteresis 메서드 수정
_applyHysteresis(candidateRegime, confidence, scores, params) {
    const minCandles = params.hysteresisMinCandles;
    const cooldownMs = params.transitionCooldownMs || 300000;

    // ... 기존 로직 ...

    if (this._pendingCount >= minCandles) {
        // 쿨다운 검사: 마지막 전환 후 충분한 시간이 경과했는지
        const elapsed = Date.now() - this._lastTransitionTs;
        if (elapsed < cooldownMs) {
            // 쿨다운 중 — 전환 보류, 카운터 유지
            log.info('Regime transition cooldown active', {
                candidate: candidateRegime,
                remainingMs: cooldownMs - elapsed,
                pendingCount: this._pendingCount,
            });
            return;  // 전환하지 않고 return
        }

        // 전환 실행
        const previous = this._currentRegime;
        this._currentRegime = candidateRegime;
        this._lastTransitionTs = Date.now();  // 쿨다운 타이머 리셋
        // ... 나머지 기존 로직 ...
    }
}
```

**쿨다운 vs 타이머**: `setTimeout` 대신 단순 timestamp 비교를 사용한다. 이는:
- 타이머 누수 위험 제로
- GC 부담 제로
- graceful shutdown 시 정리할 것 없음
- 테스트 용이 (`Date.now()` 모킹만으로 검증 가능)

**RegimeOptimizer 연동**:
```javascript
// regimeOptimizer.js PARAM_RANGES에 추가
transitionCooldownMs: [120000, 600000],  // 2~10분
```

#### A-3. 히스테리시스 가중치 동적 조정 (선택적 개선)

**우선순위**: P2 (개선)
**난이도**: 낮음
**예상 시간**: 15분

**아이디어**: 레짐 전환 직후에는 히스테리시스 보너스를 일시적으로 상향하여 ping-pong을 더 강하게 억제한다.

```javascript
// 전환 직후 일정 기간 동안 보너스 증가
const timeSinceTransition = Date.now() - this._lastTransitionTs;
const decayFactor = Math.min(timeSinceTransition / (cooldownMs * 2), 1.0);
const effectiveBonus = w.hysteresis * (1 + (1 - decayFactor));
// 전환 직후: bonus × 2.0, 쿨다운 2배 경과 후: bonus × 1.0 (원래값)
scores[this._currentRegime] += effectiveBonus;
```

---

### B. 전략 Deactivate 유예기간 (StrategyRouter 측)

#### B-1. 유예기간 기본 구조

**우선순위**: P0 (즉시)
**난이도**: 높음
**예상 시간**: 90분

**핵심 설계 원칙**:
1. 유예 중인 전략은 **새 진입을 차단**하되, **기존 포지션의 SL/TP 관리는 계속**
2. 유예기간 만료 시 실제 deactivate 수행
3. 유예 중 레짐이 다시 호환되면 유예 취소 (re-activate)
4. 유예 타이머는 반드시 cleanup 보장

**상태 다이어그램**:
```
ACTIVE ──(레짐 불일치)──→ GRACE_PERIOD ──(유예 만료)──→ DEACTIVATED
                              │
                              ├──(레짐 다시 일치)──→ ACTIVE (유예 취소)
                              ├──(봇 stop)──→ DEACTIVATED (즉시)
                              └──(사용자 disable)──→ DEACTIVATED (즉시)
```

**StrategyRouter 변경**:

```javascript
class StrategyRouter extends EventEmitter {
    constructor({ marketRegime }) {
        // ... 기존 코드 ...

        /** @type {Map<string, { timer: NodeJS.Timeout, regime: string, startedAt: number }>} */
        this._gracePeriods = new Map();

        /** @type {number} 유예기간 (ms) — 설정 가능 */
        this._graceMs = 180000;  // 기본 3분
    }

    /**
     * Configure grace period duration.
     * @param {number} ms — grace period in milliseconds
     */
    setGracePeriod(ms) {
        if (typeof ms !== 'number' || ms < 0 || ms > 600000) {
            log.warn('Invalid grace period', { ms });
            return;
        }
        this._graceMs = ms;
        log.info('Grace period updated', { graceMs: ms });
    }

    _routeStrategies(regime, previousRegime) {
        const activated = [];
        const deactivated = [];
        const graceStarted = [];
        const graceCancelled = [];

        for (const strategy of this._strategies) {
            const targetRegimes = strategy.getTargetRegimes();
            const shouldBeActive = targetRegimes.includes(regime);
            const name = strategy.name;

            if (shouldBeActive && !strategy.isActive() && !this._gracePeriods.has(name)) {
                // 활성화
                const symbol = this._symbols[0];
                if (symbol) strategy.activate(symbol, this._category);
                strategy.setMarketRegime(regime);
                activated.push(name);
                this.emit('strategy:activated', { name, regime });

            } else if (shouldBeActive && this._gracePeriods.has(name)) {
                // 유예 취소 — 레짐이 다시 일치
                this._cancelGrace(name);
                strategy.setMarketRegime(regime);
                graceCancelled.push(name);
                this.emit('strategy:grace_cancelled', { name, regime });

                log.info('Grace period cancelled — regime matches again', { name, regime });

            } else if (!shouldBeActive && strategy.isActive() && !this._gracePeriods.has(name)) {
                // 유예기간 시작 (즉시 deactivate 대신)
                if (this._graceMs > 0) {
                    this._startGrace(name, strategy, regime);
                    graceStarted.push(name);
                } else {
                    // 유예기간 0이면 즉시 비활성화 (기존 동작)
                    strategy.deactivate();
                    deactivated.push(name);
                    this.emit('strategy:deactivated', { name, regime, reason: 'regime_mismatch' });
                }

            } else if (shouldBeActive && strategy.isActive()) {
                // 이미 활성 — 레짐만 갱신
                strategy.setMarketRegime(regime);
            }
        }

        this.emit('router:regime_switch', {
            previous: previousRegime || null,
            current: regime,
            activated,
            deactivated,
            graceStarted,
            graceCancelled,
            activeCount: this.getActiveStrategies().length,
            graceCount: this._gracePeriods.size,
            totalCount: this._strategies.length,
        });
    }

    /**
     * Start grace period for a strategy.
     * During grace: strategy remains active but should block new entries.
     */
    _startGrace(name, strategy, regime) {
        // 기존 유예 타이머가 있으면 먼저 정리
        this._cancelGrace(name);

        const timer = setTimeout(() => {
            // 유예 만료 — 실제 비활성화
            this._gracePeriods.delete(name);

            if (strategy.isActive()) {
                strategy.deactivate();
                this.emit('strategy:deactivated', {
                    name,
                    regime: this._currentRegime,
                    reason: 'grace_period_expired',
                });
                log.info('Grace period expired — strategy deactivated', {
                    name,
                    graceMs: this._graceMs,
                });
            }
        }, this._graceMs);

        // unref()로 프로세스 종료를 차단하지 않도록
        if (timer.unref) timer.unref();

        this._gracePeriods.set(name, {
            timer,
            regime,
            startedAt: Date.now(),
        });

        this.emit('strategy:grace_started', { name, regime, graceMs: this._graceMs });
        log.info('Grace period started', { name, regime, graceMs: this._graceMs });
    }

    /**
     * Cancel grace period for a strategy (re-activation or cleanup).
     */
    _cancelGrace(name) {
        const grace = this._gracePeriods.get(name);
        if (grace) {
            clearTimeout(grace.timer);
            this._gracePeriods.delete(name);
        }
    }

    /**
     * Stop router — clean up all grace timers.
     */
    stop() {
        this._running = false;
        this._marketRegime.removeListener(MARKET_EVENTS.REGIME_CHANGE, this._boundOnRegimeChange);

        // 모든 유예 타이머 정리
        for (const [name, grace] of this._gracePeriods) {
            clearTimeout(grace.timer);
            log.debug('Grace timer cleared on stop', { name });
        }
        this._gracePeriods.clear();

        log.info('StrategyRouter stopped');
    }
}
```

#### B-2. 유예 중 진입 차단 메커니즘

**우선순위**: P0 (B-1과 함께)
**난이도**: 중간
**예상 시간**: 30분 (B-1에 포함)

유예 중인 전략은 `isActive() === true`를 유지하므로 onTick/onKline을 계속 받는다. 그러나 새 진입 시그널은 차단해야 한다.

**방법 1: StrategyRouter → BotService 통신** (권장)

```javascript
// StrategyRouter가 유예 전략 목록을 제공
getGracePeriodStrategies() {
    return new Set(this._gracePeriods.keys());
}

// BotService의 _handleStrategySignal에서 체크
async _handleStrategySignal(signal, sessionId) {
    // 기존 gracefulDisabledStrategies 체크 다음에 추가
    if (this.strategyRouter) {
        const graceSet = this.strategyRouter.getGracePeriodStrategies();
        if (graceSet.has(signal.strategy)) {
            const isEntry = signal.action === SIGNAL_ACTIONS.OPEN_LONG
                || signal.action === SIGNAL_ACTIONS.OPEN_SHORT;
            if (isEntry) {
                log.info('Signal blocked — strategy in grace period', {
                    strategy: signal.strategy,
                    action: signal.action,
                });
                return;
            }
            // CLOSE 시그널은 허용 (SL/TP)
        }
    }

    // ... 기존 로직 ...
}
```

이 방식은 `_gracefulDisabledStrategies`와 동일한 패턴을 따르므로 코드 일관성이 높다.

**방법 2: StrategyBase에 graceMode 플래그** (대안)

```javascript
// strategyBase.js에 추가
this._inGracePeriod = false;

setGracePeriod(active) {
    this._inGracePeriod = active;
}

isInGracePeriod() {
    return this._inGracePeriod;
}
```

방법 2는 전략이 자체적으로 유예 상태를 인식하여 시그널 생성 자체를 억제할 수 있지만, 모든 전략 서브클래스가 이를 올바르게 처리해야 하므로 방법 1이 안전하다.

#### B-3. 유예 타이머 동시성 보호

**우선순위**: P1 (필수)
**난이도**: 중간
**예상 시간**: 20분 (B-1 설계에 내장)

**레이스 컨디션 시나리오와 방어**:

| 시나리오 | 위험 | 방어 |
|----------|------|------|
| 유예 중 봇 stop | 유예 타이머가 stop 후에 발화 | `stop()`에서 모든 grace timer clearTimeout + `_running` 체크 |
| 유예 중 동일 전략 재활성화 | 이중 timer 생성 | `_startGrace`에서 기존 timer 먼저 cancel |
| 유예 만료와 레짐 변경 동시 | deactivate 후 즉시 activate 시도 | timer 콜백에서 `_gracePeriods.has(name)` 체크 (delete 선행) |
| 유예 중 사용자가 disableStrategy | timer 잔존 | `disableStrategy`에서 grace cancel 호출 |
| 유예 중 사용자가 enableStrategy (같은 전략) | 중복 인스턴스 | `enableStrategy`에서 기존 전략 존재 확인으로 방어 (이미 있음) |
| 유예 만료 콜백에서 에러 발생 | timer 핸들 잔존 | try-catch + `_gracePeriods.delete` 선행 실행 |

**핵심 보호 코드** (timer 콜백):

```javascript
const timer = setTimeout(() => {
    // 1. Map에서 먼저 제거 (재진입 방지)
    this._gracePeriods.delete(name);

    // 2. 라우터 실행 중인지 확인
    if (!this._running) return;

    // 3. 전략이 아직 활성 상태인지 확인
    try {
        if (strategy.isActive()) {
            strategy.deactivate();
            this.emit('strategy:deactivated', { ... });
        }
    } catch (err) {
        log.error('Grace period expiry error', { name, error: err.message });
    }
}, this._graceMs);
```

#### B-4. BotService.disableStrategy와 통합

**우선순위**: P1 (필수)
**난이도**: 낮음
**예상 시간**: 15분

```javascript
// botService.js disableStrategy 수정
disableStrategy(name, opts = {}) {
    // ... 기존 코드 ...

    // StrategyRouter의 유예 타이머도 정리
    if (this.strategyRouter && typeof this.strategyRouter._cancelGrace === 'function') {
        this.strategyRouter._cancelGrace(name);
    }

    // ... 나머지 코드 ...
}
```

또는 더 깔끔하게, StrategyRouter에 public 메서드를 추가:

```javascript
// strategyRouter.js
cancelGracePeriod(name) {
    this._cancelGrace(name);
}
```

---

### C. 관측성 강화

#### C-1. 레짐 전환 빈도 메트릭

**우선순위**: P1 (실거래 전)
**난이도**: 낮음
**예상 시간**: 20분

**변경**: MarketRegime에 전환 빈도 추적 추가

```javascript
// MarketRegime 클래스에 추가
this._transitionCount = 0;
this._transitionCountWindow = [];  // 최근 1시간 전환 타임스탬프

// _applyHysteresis에서 전환 시:
this._transitionCount++;
this._transitionCountWindow.push(Date.now());
// 1시간 이전 엔트리 제거
const oneHourAgo = Date.now() - 3600000;
this._transitionCountWindow = this._transitionCountWindow.filter(ts => ts > oneHourAgo);

// getContext()에 추가:
transitionsLastHour: this._transitionCountWindow.length,
totalTransitions: this._transitionCount,
lastTransitionTs: this._lastTransitionTs,
cooldownActive: (Date.now() - this._lastTransitionTs) < cooldownMs,
```

#### C-2. StrategyRouter 유예 상태 노출

**우선순위**: P1
**난이도**: 낮음
**예상 시간**: 15분

```javascript
// strategyRouter.js getStatus() 확장
getStatus() {
    return {
        // ... 기존 필드 ...
        graceMs: this._graceMs,
        gracePeriods: Array.from(this._gracePeriods.entries()).map(([name, g]) => ({
            name,
            regime: g.regime,
            startedAt: g.startedAt,
            remainingMs: Math.max(0, this._graceMs - (Date.now() - g.startedAt)),
        })),
    };
}
```

#### C-3. Socket.io 이벤트로 프론트엔드 전달

**우선순위**: P2 (개선)
**난이도**: 낮음
**예상 시간**: 15분

새 이벤트:
- `strategy:grace_started` → 유예기간 시작 알림
- `strategy:grace_cancelled` → 유예기간 취소 (레짐 복귀) 알림
- `strategy:grace_expired` → 유예기간 만료 → deactivate 알림

---

### D. 설정 파라미터 구조

#### D-1. 통합 파라미터 설계

**우선순위**: P1
**난이도**: 낮음
**예상 시간**: 10분

**RegimeParamStore에 추가할 파라미터**:

```javascript
// regimeParamStore.js DEFAULT_PARAMS에 추가
transitionCooldownMs: 300000,     // 레짐 전환 후 최소 대기 (5분)

// 별도 설정 (RegimeParamStore 외부, StrategyRouter 자체):
// strategyRouter 생성 시 설정
routerGraceMs: 180000,            // 전략 deactivate 유예기간 (3분)
```

**API 노출**: 기존 `/api/bot/strategies/:name/config` 엔드포인트 패턴을 따라 레짐 파라미터도 런타임 변경 가능하게:
- `GET /api/bot/regime-params` → 현재 파라미터
- `PATCH /api/bot/regime-params` → 파라미터 갱신 (regimeParamStore.save 호출)

---

## 구현 우선순위 요약

| ID | 항목 | 우선순위 | 난이도 | 예상 시간 | 담당 |
|----|------|---------|--------|----------|------|
| A-1 | hysteresisMinCandles 상향 | P0 | 낮음 | 20분 | Engineer |
| A-2 | 레짐 전환 쿨다운 | P0 | 중간 | 40분 | Engineer |
| B-1 | StrategyRouter 유예기간 핵심 구조 | P0 | 높음 | 90분 | Engineer |
| B-2 | 유예 중 진입 차단 | P0 | 중간 | (B-1 포함) | Engineer |
| B-3 | 유예 타이머 동시성 보호 | P1 | 중간 | (B-1 내장) | Engineer |
| B-4 | BotService.disableStrategy 통합 | P1 | 낮음 | 15분 | Engineer |
| C-1 | 레짐 전환 빈도 메트릭 | P1 | 낮음 | 20분 | Engineer |
| C-2 | StrategyRouter 유예 상태 노출 | P1 | 낮음 | 15분 | Engineer |
| C-3 | Socket.io FE 이벤트 | P2 | 낮음 | 15분 | Engineer/UI |
| A-3 | 히스테리시스 동적 보너스 | P2 | 낮음 | 15분 | Engineer |
| D-1 | 통합 파라미터 구조 | P1 | 낮음 | 10분 | Engineer |

**총 예상 시간**: ~4시간 (P0: 2.5시간, P1: 1시간, P2: 0.5시간)

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게

1. **전략별 최소 워밍업 시간 분석**: 각 전략이 활성화 후 첫 시그널을 생성하기까지 필요한 최소 캔들 수를 조사해주세요. 이를 기반으로 유예기간 기본값(현재 3분 제안)이 적절한지 검증이 필요합니다.
   - 예: MaTrend는 SMA-20 버퍼 충족까지 최소 20캔들(20분), QuietRangeScalp는 ATR+볼린저 워밍업까지 수십 캔들
   - 유예기간이 워밍업 시간보다 짧으면, 유예 중 비활성화된 전략이 다시 활성화되어도 바로 시그널 생성 불가

2. **소프트웨어 기반 SL 사용 전략 목록**: 거래소 서버사이드 SL이 아닌, onTick에서 가격 모니터링으로 청산하는 전략이 있는지 확인해주세요. 이런 전략은 유예기간이 아닌 **즉시 deactivate가 위험**하므로, 반드시 유예기간 동안 SL 관리를 유지해야 합니다.

3. **레짐 전환 쿨다운 5분의 적정성**: 5분 쿨다운이 전략 수익 기회를 과도하게 제한하지 않는지, 백테스트 관점에서 검증해주세요. 대안으로 3분, 10분 등의 시나리오 비교가 있으면 좋겠습니다.

4. **AdaptiveRegimeStrategy 특수 처리**: 이 전략은 모든 레짐을 targetRegimes로 선언하여 항상 활성 상태입니다. 유예기간이 이 전략에 불필요한 오버헤드를 추가하지 않는지 확인이 필요합니다 (모든 레짐에 매칭되므로 유예 자체가 발생하지 않아야 정상).

### UI 에이전트에게

1. **레짐 상태 표시 개선**: 현재 대시보드에서 레짐이 표시된다면, 다음 정보 추가를 검토해주세요:
   - 현재 레짐 + 쿨다운 잔여 시간 (쿨다운 활성 시)
   - 유예 중인 전략 목록 + 유예 잔여 시간
   - 최근 1시간 레짐 전환 횟수 (빈도 모니터링)

2. **유예 상태 시각 표시**: 전략 리스트에서 유예 중인 전략을 별도 상태(예: 주황색 아이콘, "유예 중 (2:30 남음)")로 표시하는 것이 사용자 경험에 도움이 됩니다.

3. **레짐 타임라인**: 레짐 변경 히스토리를 시간축 그래프로 표시하면 전환 빈도 문제를 시각적으로 확인할 수 있습니다 (MarketRegime.getRegimeHistory() 데이터 활용).

---

## 리스크 평가

### 구현하지 않을 경우의 리스크

- **수익 기회 상실**: 전략이 진입 전 비활성화되어 수익 기회를 놓침
- **고아 포지션**: 비활성화된 전략의 열린 포지션이 SL 없이 방치될 위험
- **로그 과부하**: 잦은 레짐 전환으로 로그 볼륨 증가, 실제 이슈 식별 어려움

### 구현 시 주의점

- **유예기간이 너무 길면**: 비호환 레짐에서 전략이 계속 활성 상태로 남아, 잘못된 시그널 생성 가능 → 진입만 차단하고 청산은 허용하는 설계로 완화
- **쿨다운이 너무 길면**: 실제 레짐 변화에 느리게 반응 → 5분 기본값 + 자동 최적화로 조정
- **기존 테스트 영향**: StrategyRouter의 동작이 변경되므로 관련 테스트 업데이트 필요

---

## 참고: 방향 C (가중치 기반 soft routing) 소견

사용자가 A+B를 선호한다고 명시했으므로 방향 C는 구현 대상에서 제외하지만, 장기적으로 고려할 가치가 있다.

**Soft routing 개념**: 레짐 매칭/비매칭을 boolean이 아닌 가중치로 처리. 예를 들어 MaTrend가 `trending_up`에 1.0, `ranging`에 0.3, `volatile`에 0.1의 가중치를 가지면, 레짐이 `ranging`일 때 MaTrend를 완전 비활성화하지 않고 시그널 컨피던스에 0.3을 곱하여 진입 기준을 높인다.

이는 A+B의 "경직된" 전환 문제를 근본적으로 해결하지만, 구현 복잡도가 높고 모든 전략의 메타데이터 구조를 변경해야 한다. A+B를 먼저 적용하고, 실거래 데이터를 축적한 후 방향 C의 필요성을 재평가하는 것이 합리적이다.
