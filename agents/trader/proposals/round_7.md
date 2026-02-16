# Round 7 Proposal: 레짐 변경 빈도 문제 -- A+B 조합

**작성자**: Senior Quant Trader
**작성일**: 2026-02-16
**대상 파일**: `marketRegime.js`, `strategyRouter.js`, `botService.js`, `strategyBase.js`

---

## 분석 요약

현재 시스템에서 레짐 변경이 빈번하게 발생하여 전략이 충분한 매매 사이클(진입 -> 보유 -> 청산)을 완료하기 전에 비활성화되는 구조적 문제가 있다. 이는 다음과 같은 수익 손실 경로를 만든다:

1. **신호 손실(Signal Loss)**: 전략이 진입 조건을 충족했으나 레짐 전환으로 deactivate 되어 주문이 발생하지 않음
2. **불필요한 고아 포지션(Orphan Position)**: 전략이 진입 후 레짐 전환으로 deactivate 되면 해당 전략이 SL/TP를 관리하지 못함. 현재 `strategyRouter.deactivate()`는 포지션 청산을 수행하지 않으므로 리스크가 관리되지 않는 포지션이 방치됨
3. **워밍업 비용(Warmup Cost)**: 대부분의 전략은 지표 버퍼(SMA, ATR, RSI 등)를 채우는 워밍업 기간이 필요. 빈번한 activate/deactivate 사이클은 이 워밍업 비용을 반복적으로 발생시킴
4. **수수료 마찰(Fee Drag)**: 레짐 변경으로 인한 강제 청산이 있을 경우 불필요한 수수료 발생

**핵심 수치 근거**: 1분봉(`candle1m`) 기준으로 `hysteresisMinCandles=3`이면 레짐 전환에 최소 3분만 소요. 그러나 18개 전략의 cooldownMs 범위가 30초~300초(5분)이므로, 레짐이 전환될 때 대부분의 전략은 단 하나의 매매 사이클도 완료할 수 없다.

---

## 발견 사항

### 1. hysteresisMinCandles = 3은 지나치게 낮다

**파일**: `backend/src/services/marketRegime.js` (line 67)
```javascript
const FALLBACK_PARAMS = Object.freeze({
  // ...
  hysteresisMinCandles: 3,
  // ...
});
```

**파일**: `backend/src/services/regimeParamStore.js` (line 49)
```javascript
hysteresisMinCandles: 3,
```

- 데이터 소스가 `candle1m`이므로 hysteresisMinCandles=3은 **3분**에 해당
- 6-factor weighted scoring에서 hysteresis 가중치는 0.10 (10%)으로, 현재 레짐에 대한 관성 보너스가 매우 약함
- `regimeOptimizer.js`의 `PARAM_RANGES`에서 `hysteresisMinCandles: [2, 5]`로 제한되어 있어 최적화가 돌아도 최대 5분(5분봉)까지만 가능
- 암호화폐 시장에서 1분봉 3개(3분)는 노이즈 구간. BTC가 30초 내에 0.5% 이상 움직이는 것은 흔한 일이며, 이 노이즈가 레짐 판정에 직접 반영됨

**트레이딩 관점**: 유의미한 레짐 전환은 최소 15~30분의 지속성을 가져야 한다. 3분 내에 "TRENDING_UP -> VOLATILE -> RANGING"으로 전환하는 것은 시장 미세구조 노이즈를 레짐으로 오판하는 것.

### 2. 레짐 전환 쿨다운이 없다

**파일**: `backend/src/services/marketRegime.js` (`_applyHysteresis` method, line 673-759)

```javascript
_applyHysteresis(candidateRegime, confidence, scores, params) {
    const minCandles = params.hysteresisMinCandles;
    // ...
    if (this._pendingCount >= minCandles) {
      // 바로 전환! 전환 간 최소 간격 없음
      this._currentRegime = candidateRegime;
      // ...
    }
}
```

- 레짐이 확정된 직후 즉시 다음 레짐 전환이 가능
- 전환 -> 전환 사이의 최소 간격(cooldown)이 없으므로 "A -> B -> A" 핑퐁이 몇 분 내에 발생 가능
- `_regimeHistory`에 기록만 할 뿐, 빈도 제한 로직 없음

### 3. StrategyRouter의 즉시 deactivate 문제

**파일**: `backend/src/services/strategyRouter.js` (`_routeStrategies`, line 131-193)

```javascript
} else if (!shouldBeActive && strategy.isActive()) {
    // Deactivate -- strategy doesn't fit current regime
    strategy.deactivate();   // 즉시 비활성화, 유예기간 없음
    deactivated.push(strategy.name);
    // ...
}
```

- 레짐이 바뀌면 targetRegimes에 포함되지 않는 전략은 **즉시** deactivate
- 유예기간(grace period) 개념이 없음
- deactivate 시 `strategy._active = false`로 설정되어 더 이상 onTick/onKline 이벤트를 처리하지 않음

**치명적 문제**: `strategyBase.js`의 `deactivate()`는 `this._symbols.clear()`를 호출하여 전략의 심볼 목록을 완전히 제거함. 이는 해당 전략이 보유 중인 포지션의 SL/TP 관리를 완전히 중단시킨다.

### 4. 포지션 고아화(Orphan Position) 위험

**파일**: `backend/src/services/botService.js`

`botService.disableStrategy()`는 `immediate` 모드에서 `_closeStrategyPositions()`를 호출하여 강제 청산하고, `graceful` 모드에서 `_gracefulDisabledStrategies`에 추가하여 새 진입만 차단한다.

그러나 **`strategyRouter._routeStrategies()`에서의 deactivate는 `botService.disableStrategy()`를 거치지 않는다**. 라우터는 직접 `strategy.deactivate()`만 호출:

```javascript
// strategyRouter.js line 158
strategy.deactivate();
```

이 때 해당 전략이 보유 중인 포지션은:
- SL/TP 트리거가 더 이상 작동하지 않음 (onTick 무시)
- 청산 주문이 발생하지 않음
- positionManager에는 여전히 포지션이 기록됨
- **완전한 관리 사각지대**

### 5. 전략별 최소 유효 매매 사이클 시간 분석

18개 전략의 cooldownMs + 지표 워밍업 요구를 종합하면:

| 카테고리 | 전략 | cooldownMs | targetRegimes | 최소 유효 사이클(추정) |
|----------|------|-----------|--------------|---------------------|
| **price-action** | TurtleBreakout | 300,000 (5m) | trending_up/down, volatile | 20~60분 (Donchian 20기 형성) |
| | CandlePattern | 60,000 (1m) | 4레짐 (quiet 제외) | 5~15분 (패턴 3봉 확인) |
| | SupportResistance | 120,000 (2m) | 4레짐 (quiet 제외) | 15~30분 (S/R 레벨 형성) |
| | SwingStructure | 300,000 (5m) | trending_up/down, volatile | 30~120분 (HH/HL 구조 형성) |
| | FibonacciRetracement | 180,000 (3m) | trending_up/down, ranging | 20~60분 (스윙 H/L 형성) |
| **indicator-light** | Grid | 30,000 (30s) | ranging | 10~30분 (그리드 주기) |
| | MaTrend | 300,000 (5m) | trending_up/down | 30~120분 (EMA 교차 확인) |
| | Funding | 60,000 (1m) | trending_up/down, volatile | 10~30분 (펀딩비 주기) |
| | RsiPivot | 60,000 (1m) | 4레짐 (quiet 제외) | 10~20분 (RSI 과매수/과매도) |
| | Supertrend | 180,000 (3m) | trending_up/down, volatile | 20~60분 (수퍼트렌드 반전) |
| | Bollinger | 60,000 (1m) | ranging, volatile | 10~30분 (BB 이탈/회귀) |
| | Vwap | 60,000 (1m) | ranging, quiet | 10~30분 (VWAP 이탈/회귀) |
| | MacdDivergence | 120,000 (2m) | 4레짐 (quiet 제외) | 15~45분 (다이버전스 형성) |
| **indicator-heavy** | QuietRangeScalp | 30,000 (30s) | quiet | 5~15분 (켈트너 채널) |
| | Breakout | 300,000 (5m) | quiet, ranging | 30~120분 (BB 스퀴즈) |
| | AdaptiveRegime | 120,000 (2m) | 전체 5레짐 | 15~30분 (자체 적응) |

**결론**: 대부분의 전략이 최소 10~30분의 매매 사이클을 필요로 하며, MaTrend, SwingStructure, Breakout 등은 30분~2시간이 필요. 현재 3분 hysteresis로는 이들 전략이 유의미한 매매를 수행할 수 없다.

### 6. hysteresis 가중치 10%의 의미

```javascript
// marketRegime.js line 396
scores[this._currentRegime] += w.hysteresis;  // 0.10
```

6-factor scoring에서 현재 레짐에 0.10의 보너스를 부여하는 것은 **다른 factor 하나의 절반 수준**. 예를 들어 multiSmaTrend(0.20)이 완전히 다른 레짐을 가리키면, hysteresis 보너스만으로는 현재 레짐을 유지할 수 없다. 이 보너스는 "경계선 사례(borderline case)"에서만 유효하며, 확신도 높은 레짐 전환을 막지 못한다.

### 7. RegimeOptimizer가 hysteresisMinCandles를 [2,5] 범위로 제한

```javascript
// regimeOptimizer.js line 51
hysteresisMinCandles:[2, 5],
```

자동 최적화가 돌아도 최대 5분까지만 hysteresis를 올릴 수 있어, 문제의 근본적 해결이 불가능하다.

---

## 제안 사항

### A. 레짐 판정 안정화 (MarketRegime 수정)

#### A-1. hysteresisMinCandles 상향 (우선순위: HIGH, 난이도: LOW, 예상: 15분)

**현재값**: 3 (3분)
**제안값**: 15 (15분)
**적용범위**: `FALLBACK_PARAMS`, `RegimeParamStore.DEFAULT_PARAMS`

| 파라미터 | 현재 | 제안 | 근거 |
|----------|------|------|------|
| `hysteresisMinCandles` | 3 | 15 | 18개 전략의 최소 유효 사이클 중앙값 ~20분. 15분 확인으로 노이즈 제거 + 대부분 전략이 최소 1 사이클 확보 가능 |

**구현**: `marketRegime.js` line 67과 `regimeParamStore.js` line 49에서 값 변경.

#### A-2. 레짐 전환 쿨다운 도입 (우선순위: HIGH, 난이도: MEDIUM, 예상: 30분)

레짐이 확정된 후 일정 시간 동안 새로운 레짐 전환을 차단하는 쿨다운 메커니즘.

**제안 파라미터**:
- `regimeTransitionCooldownMs`: 300000 (5분)
- 쿨다운 중에도 hysteresis 카운트는 진행하되, 쿨다운 종료 시점에서 최종 판정

**구현 위치**: `marketRegime.js`의 `_applyHysteresis()` 메서드 내부

```javascript
// 제안 로직 (의사코드)
_applyHysteresis(candidateRegime, confidence, scores, params) {
    const minCandles = params.hysteresisMinCandles;
    const cooldownMs = params.regimeTransitionCooldownMs || 300000;

    // 쿨다운 체크: 마지막 레짐 전환 후 충분한 시간이 경과했는가?
    if (this._lastTransitionTs && (Date.now() - this._lastTransitionTs) < cooldownMs) {
        // 쿨다운 중에도 pending은 계속 추적 (축적)
        if (candidateRegime !== this._currentRegime) {
            if (candidateRegime === this._pendingRegime) {
                this._pendingCount++;
            } else {
                this._pendingRegime = candidateRegime;
                this._pendingCount = 1;
            }
        }
        return; // 전환하지 않음
    }

    // 기존 hysteresis 로직 유지...
    if (this._pendingCount >= minCandles) {
        this._lastTransitionTs = Date.now(); // 전환 시점 기록
        // ... 나머지 전환 로직
    }
}
```

**신규 파라미터 추가 위치**:
- `FALLBACK_PARAMS`에 `regimeTransitionCooldownMs: 300000` 추가
- `RegimeParamStore.DEFAULT_PARAMS`에 동일 추가
- `PARAM_RANGES`에 `regimeTransitionCooldownMs: [120000, 600000]` 추가 (최적화 범위)

#### A-3. hysteresis 가중치 상향 (우선순위: MEDIUM, 난이도: LOW, 예상: 5분)

**현재값**: 0.10
**제안값**: 0.15

가중치 재조정:

| Factor | 현재 | 제안 | 변경 사유 |
|--------|------|------|----------|
| multiSmaTrend | 0.20 | 0.19 | -0.01 |
| adaptiveAtr | 0.18 | 0.17 | -0.01 |
| rocMomentum | 0.17 | 0.16 | -0.01 |
| marketBreadth | 0.20 | 0.19 | -0.01 |
| volumeConfirmation | 0.15 | 0.14 | -0.01 |
| hysteresis | 0.10 | 0.15 | +0.05 |
| **합계** | **1.00** | **1.00** | |

0.15로의 상향은 현재 레짐이 "근소한 차이로 2위"인 경우 전환을 억제하여, 확신도 높은 전환만 통과시킨다.

#### A-4. RegimeOptimizer 파라미터 범위 확장 (우선순위: MEDIUM, 난이도: LOW, 예상: 5분)

```javascript
// 변경 전
hysteresisMinCandles:[2, 5],

// 변경 후
hysteresisMinCandles:[10, 30],
regimeTransitionCooldownMs: [120000, 900000],
```

---

### B. 전략 비활성화 유예기간 (StrategyRouter + StrategyBase 수정)

#### B-1. 전략별 gracePeriod 도입 (우선순위: HIGH, 난이도: MEDIUM, 예상: 45분)

레짐 변경 시 전략을 즉시 비활성화하지 않고, 일정 시간의 유예기간을 부여한다. 유예기간 동안:
- **새로운 진입(OPEN) 시그널은 차단** (botService의 `_gracefulDisabledStrategies` 패턴 재활용)
- **기존 포지션의 청산(CLOSE) 시그널은 허용** (SL/TP 정상 작동)
- onTick/onKline 이벤트는 계속 수신 (지표 업데이트 + 청산 판단 지속)
- 유예기간 종료 시 완전히 deactivate

**카테고리별 차별화된 gracePeriod**:

| 카테고리 | 제안 gracePeriod | 근거 |
|----------|-----------------|------|
| price-action (5개) | 600,000ms (10분) | 가격행동 기반이라 패턴 완성까지 시간 필요. SwingStructure, Turtle은 긴 사이클 |
| indicator-light (8개) | 300,000ms (5분) | 지표 반응이 빠르므로 중간 유예 |
| indicator-heavy (3개) | 900,000ms (15분) | 복합 지표 기반, Breakout은 스퀴즈 후 돌파까지 장시간 소요 |
| AdaptiveRegime | 0ms (유예 불필요) | 모든 레짐에서 활성화되므로 deactivate 자체가 발생하지 않음 |

**구현 방안**:

1. `strategyBase.js`에 gracePeriod 관련 상태 추가:

```javascript
// strategyBase.js 추가
this._graceDeadline = null;   // 유예기간 종료 시각 (timestamp)
this._inGracePeriod = false;  // 유예 중 여부

enterGracePeriod(durationMs) {
    this._inGracePeriod = true;
    this._graceDeadline = Date.now() + durationMs;
}

isInGracePeriod() {
    if (!this._inGracePeriod) return false;
    if (Date.now() >= this._graceDeadline) {
        this._inGracePeriod = false;
        this._graceDeadline = null;
        return false;
    }
    return true;
}
```

2. `strategyRouter.js`의 `_routeStrategies` 수정:

```javascript
// 변경 전
} else if (!shouldBeActive && strategy.isActive()) {
    strategy.deactivate();

// 변경 후
} else if (!shouldBeActive && strategy.isActive() && !strategy.isInGracePeriod()) {
    const meta = strategy.getMetadata();
    const gracePeriodMs = meta.gracePeriodMs || this._getDefaultGracePeriod(strategy);

    if (gracePeriodMs > 0) {
        strategy.enterGracePeriod(gracePeriodMs);
        graceStarted.push(strategy.name);
        // 새 진입 차단 플래그 설정
        this.emit('strategy:grace_started', {
            name: strategy.name,
            regime,
            gracePeriodMs
        });
    } else {
        strategy.deactivate();
        deactivated.push(strategy.name);
        this.emit('strategy:deactivated', { ... });
    }
}
```

3. `botService.js`의 signal handler에서 유예기간 중 진입 차단:

```javascript
// _handleStrategySignal 수정
async _handleStrategySignal(signal, sessionId) {
    // 유예기간 중인 전략의 새 진입 차단
    const strategy = this.strategies.find(s => s.name === signal.strategy);
    if (strategy && strategy.isInGracePeriod()) {
        const isEntry = signal.action === SIGNAL_ACTIONS.OPEN_LONG
            || signal.action === SIGNAL_ACTIONS.OPEN_SHORT;
        if (isEntry) {
            log.info('Blocked entry during grace period', { strategy: signal.strategy });
            return;
        }
        // CLOSE 시그널은 통과 (SL/TP)
    }
    // ... 기존 로직
}
```

#### B-2. 유예기간 만료 타이머 (우선순위: HIGH, 난이도: LOW, 예상: 20분)

유예기간이 만료된 전략을 정리하는 주기적 검사 로직.

```javascript
// strategyRouter.js에 타이머 추가
start(strategies, symbols, category) {
    // ... 기존 로직
    this._graceCheckTimer = setInterval(() => {
        this._checkGraceExpiry();
    }, 10000); // 10초마다 체크
}

_checkGraceExpiry() {
    for (const strategy of this._strategies) {
        if (strategy._inGracePeriod && !strategy.isInGracePeriod()) {
            // 유예기간 만료 -> 완전 비활성화
            strategy.deactivate();
            this.emit('strategy:deactivated', {
                name: strategy.name,
                regime: this._currentRegime,
                reason: 'grace_period_expired',
            });
            log.info('Grace period expired, strategy deactivated', { name: strategy.name });
        }
    }
}
```

#### B-3. 유예기간 중 레짐 복귀 시 취소 (우선순위: MEDIUM, 난이도: LOW, 예상: 10분)

유예기간 중에 원래 레짐으로 되돌아오면 유예를 취소하고 정상 활성 상태로 복귀.

```javascript
// strategyRouter.js의 _routeStrategies 내부
} else if (shouldBeActive && strategy.isInGracePeriod()) {
    // 레짐이 다시 호환 -> 유예 취소, 정상 복귀
    strategy.cancelGracePeriod();
    reactivated.push(strategy.name);
    this.emit('strategy:grace_cancelled', { name: strategy.name, regime });
}
```

`strategyBase.js`에 추가:
```javascript
cancelGracePeriod() {
    this._inGracePeriod = false;
    this._graceDeadline = null;
}
```

---

### C. 통합 파라미터 요약

모든 A+B 변경을 적용한 후의 최종 파라미터:

| 파라미터 | 위치 | 현재값 | 제안값 |
|----------|------|--------|--------|
| `hysteresisMinCandles` | marketRegime, regimeParamStore | 3 | 15 |
| `regimeTransitionCooldownMs` | marketRegime (신규) | 없음 | 300,000 (5분) |
| `hysteresis weight` | marketRegime, regimeParamStore | 0.10 | 0.15 |
| `PARAM_RANGES.hysteresisMinCandles` | regimeOptimizer | [2,5] | [10,30] |
| `PARAM_RANGES.regimeTransitionCooldownMs` | regimeOptimizer (신규) | 없음 | [120000, 900000] |
| price-action `gracePeriodMs` | strategyBase metadata (신규) | 없음 | 600,000 (10분) |
| indicator-light `gracePeriodMs` | strategyBase metadata (신규) | 없음 | 300,000 (5분) |
| indicator-heavy `gracePeriodMs` | strategyBase metadata (신규) | 없음 | 900,000 (15분) |

### D. 예상 효과

#### 정량적 효과
- **레짐 전환 빈도 감소**: 현재 추정 시간당 ~10회 -> 시간당 ~1~2회로 감소 (hysteresis 15분 + 쿨다운 5분 = 최소 20분 간격)
- **전략 유효 매매 사이클 확보**: 15분 hysteresis + 5~15분 유예기간 = 최소 20~30분의 매매 시간 보장
- **고아 포지션 위험 해소**: 유예기간 동안 SL/TP가 정상 작동하므로 관리 사각지대 제거

#### 정성적 효과
- **전략 신뢰도 향상**: 전략이 "자신의 로직대로" 매매를 완료할 수 있는 환경 조성
- **백테스트-실거래 괴리 감소**: 백테스트에서는 레짐 전환이 없으므로 실거래에서만 발생하는 강제 비활성화 패턴 완화
- **리스크 관리 강화**: 유예기간의 "새 진입 차단 + 청산 허용" 패턴으로 레짐 전환 시 리스크 노출 점진적 감소

#### 잠재적 리스크
- **레짐 전환 지연**: 실제 레짐이 변경되었는데 15분 + 5분 = 20분 동안 이전 레짐의 전략이 활성 상태. 이 기간 중 잘못된 방향의 진입 가능성 있음
- **완화책**: 유예기간 중 새 진입 차단(B-1)으로 이 리스크를 거의 제거. hysteresis가 "확인"하는 것이므로 확정 전에는 전략 변경 자체가 없음
- **단, 급격한 시장 전환(flash crash)**: emergencyStop은 별도 경로로 작동하므로 이 메커니즘에 영향 없음

---

## 구현 우선순위 및 일정

| 순위 | 항목 | 파일 | 난이도 | 예상 시간 | 의존성 |
|------|------|------|--------|----------|--------|
| 1 | A-1: hysteresisMinCandles 상향 | marketRegime.js, regimeParamStore.js | LOW | 15분 | 없음 |
| 2 | A-2: 레짐 전환 쿨다운 | marketRegime.js, regimeParamStore.js | MEDIUM | 30분 | 없음 |
| 3 | A-3: hysteresis 가중치 상향 | marketRegime.js, regimeParamStore.js | LOW | 5분 | 없음 |
| 4 | A-4: Optimizer 범위 확장 | regimeOptimizer.js | LOW | 5분 | A-1, A-2 |
| 5 | B-1: gracePeriod 로직 | strategyBase.js, strategyRouter.js, botService.js | MEDIUM | 45분 | A-1 |
| 6 | B-2: 유예 만료 타이머 | strategyRouter.js | LOW | 20분 | B-1 |
| 7 | B-3: 유예 취소 로직 | strategyRouter.js, strategyBase.js | LOW | 10분 | B-1 |
| 8 | 전략 metadata에 gracePeriodMs 추가 | 17개 전략 파일 | LOW | 30분 | B-1 |
| 9 | 테스트 코드 | tests/ | MEDIUM | 45분 | 전체 |
| | **합계** | | | **3시간 25분** | |

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **A-1~A-4 구현**: `marketRegime.js`, `regimeParamStore.js`, `regimeOptimizer.js`의 파라미터 변경 + 전환 쿨다운 로직 추가
2. **B-1~B-3 구현**: `strategyBase.js`에 grace period 상태/메서드 추가, `strategyRouter.js`의 라우팅 로직 수정, `botService.js`의 시그널 핸들러에 유예기간 진입 차단 추가
3. **17개 전략 파일에 `gracePeriodMs` 메타데이터 추가**: 카테고리별 기본값 적용
   - price-action 5개: `gracePeriodMs: 600000`
   - indicator-light 8개 (Grid 제외): `gracePeriodMs: 300000`
   - Grid: `gracePeriodMs: 180000` (짧은 사이클)
   - indicator-heavy (QuietRangeScalp, Breakout): `gracePeriodMs: 900000`
   - AdaptiveRegime: `gracePeriodMs: 0` (전 레짐 활성이므로 유예 불필요)
4. **strategyRouter의 `router:regime_switch` 이벤트에 `graceStarted[]` 필드 추가**: 프론트엔드에서 유예 상태 표시
5. **테스트 코드**: hysteresis + 쿨다운 + grace period 시나리오 커버
6. **기존 `_gracefulDisabledStrategies` 로직과 grace period의 상호작용 정리**: 사용자가 수동으로 disable(graceful)한 전략과 라우터가 자동으로 grace period에 넣은 전략이 충돌하지 않도록 처리

### UI/Frontend에게

1. **전략 상태 표시 확장**: 현재 "active/inactive" 2상태에서 "active/grace_period/inactive" 3상태로 확장
   - grace_period 상태일 때 잔여 시간 표시 (카운트다운)
   - grace_period 상태의 전략은 노란색 등으로 시각적 구분
2. **레짐 전환 이력에 쿨다운 표시**: 레짐 전환 로그에 "쿨다운 중 전환 억제됨" 메시지 표시
3. **전략 상세 정보에 gracePeriodMs 값 표시**: 전략별 유예기간 설정을 사용자가 확인 가능하도록

---

## 참고: 해결 방향 C (가중치 기반 soft routing)에 대한 의견

C안(soft routing)은 "레짐 적합도를 0~1 스코어로 계산하여 전략의 포지션 사이즈를 동적 조절"하는 방식이다. 트레이딩 관점에서 이론적으로 우수하나, 현 시점에서의 구현 복잡도가 높고 A+B 조합으로 핵심 문제가 해결되므로 R7에서는 제외하되, 향후 R8+ 에서 고려할 수 있다.

C안 도입 시 필요한 추가 변경:
- 각 전략의 `suggestedQty` 산출 시 레짐 적합도 계수 반영
- ExposureGuard에서 레짐 적합도에 따른 노출 한도 동적 조절
- 이는 T3-15(positionSide 전체 리팩토링)와 함께 진행하는 것이 효율적

---

## 체크리스트

- [ ] A-1: `hysteresisMinCandles` 3 -> 15 (marketRegime.js, regimeParamStore.js)
- [ ] A-2: `regimeTransitionCooldownMs` 신규 파라미터 + 쿨다운 로직 (marketRegime.js)
- [ ] A-3: hysteresis weight 0.10 -> 0.15 + 나머지 가중치 재조정
- [ ] A-4: RegimeOptimizer `PARAM_RANGES` 확장
- [ ] B-1: `strategyBase.js`에 gracePeriod 상태/메서드 추가
- [ ] B-2: `strategyRouter.js`에 gracePeriod 연동 라우팅 수정
- [ ] B-3: `botService.js`에 유예기간 중 진입 차단
- [ ] B-4: 유예 만료 타이머 + 유예 취소 로직
- [ ] B-5: 17개 전략 파일에 `gracePeriodMs` 메타데이터 추가
- [ ] B-6: `router:regime_switch` 이벤트 확장 (graceStarted)
- [ ] FE: 전략 3상태 UI 구현
- [ ] TEST: 단위 테스트 추가
