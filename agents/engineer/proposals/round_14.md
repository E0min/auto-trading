# Round 14 Proposal — 코드베이스 재분석 Round 4

**작성자**: Senior Systems Engineer
**날짜**: 2026-02-17
**기반 커밋**: 3cf6301 (feat: CoinGecko 시가총액 기반 코인 선정으로 전환)
**이전 라운드**: R13 (전략 모듈화 + 파라미터 튜닝 + UX 완료 10/10)

---

## 분석 요약

R13에서 추가된 `strategyConfigValidator`, `strategyParamMeta`, `customStrategyStore`, 그리고 `CustomRuleStrategy` 전체 파이프라인을 포함하여 124개 파일/26,000+ 라인의 전체 코드베이스를 재분석했다. 이번 라운드에서는 R13 신규 코드의 잠재적 문제, 장기 운영 시 누적되는 구조적 취약점, 동시성/레이스 컨디션, 보안, 그리고 deferred 항목의 재평가에 집중했다.

**발견 사항 요약**: 16건 (CRITICAL 2, HIGH 5, MEDIUM 6, LOW 3)

---

## 발견 사항

### R14-BE-01: CustomStrategyStore ID 충돌 및 Prototype Pollution [CRITICAL]

**파일**: `backend/src/services/customStrategyStore.js:61`
**현상**: `save()` 메서드에서 ID 생성이 `Date.now()` 기반이라 동일 밀리초 내 두 번 호출 시 ID 충돌 가능. 더 심각하게, `def.id`를 사용자가 직접 전달할 수 있고 `__proto__`, `constructor`, `toString` 같은 위험한 키를 전달하면 Map 자체는 안전하지만, JSON 직렬화/역직렬화 시 `Object.prototype` 오염 가능성이 있다.

```js
// customStrategyStore.js:61
const id = def.id || `custom_${Date.now()}`;
```

**영향**: (1) ID 충돌 시 기존 전략 덮어쓰기, (2) `__proto__` 등 특수 키로 인한 보안 취약점
**수정 방안**:
- ID 생성을 `crypto.randomBytes(8).toString('hex')` 또는 `crypto.randomUUID()`로 교체
- `def.id`가 사용자 입력으로 들어올 때 정규식 검증 추가 (`/^[a-zA-Z0-9_-]{1,64}$/`)
- `botRoutes.js`의 POST `/custom-strategies` 엔드포인트에서 `def.id` 필드를 무시하고 서버 측에서만 생성

**구현 난이도**: 쉬움 | **예상 시간**: 30분

---

### R14-BE-02: Custom Strategy 업데이트 시 활성 인스턴스 미반영 [CRITICAL]

**파일**: `backend/src/api/botRoutes.js:364-383`
**현상**: PUT `/custom-strategies/:id`로 커스텀 전략의 규칙 정의를 업데이트해도, 현재 봇이 실행 중이고 해당 전략이 활성화되어 있으면 실행 중인 `CustomRuleStrategy` 인스턴스의 `_ruleDef`, `_indicatorDefs`, `_rules`가 갱신되지 않는다. 이전 규칙으로 계속 시그널이 생성되어 사용자 의도와 불일치.

```js
// botRoutes.js:377 — store만 업데이트, 실행 중 인스턴스는 그대로
const updated = customStrategyStore.update(id, def);
res.json({ success: true, data: updated });
// botService.strategies 내 CustomRuleStrategy 인스턴스는 변경 없음
```

**영향**: 사용자가 규칙을 변경했다고 생각하지만 실제로는 이전 규칙으로 트레이딩 → 의도치 않은 손실 가능
**수정 방안**:
1. PUT 핸들러에서 `botService.strategies`에서 해당 인스턴스를 찾아 `disableStrategy` → `enableStrategy`로 재생성
2. 또는 `CustomRuleStrategy`에 `hotReload(newDef)` 메서드 추가하여 런타임에 규칙 교체
3. 봇이 실행 중이면 경고 메시지와 함께 "재활성화 필요" 플래그를 응답에 포함

**구현 난이도**: 중간 | **예상 시간**: 1시간

---

### R14-BE-03: strategyConfigValidator가 Custom Strategy를 검증 불가 [HIGH]

**파일**: `backend/src/services/strategyConfigValidator.js:12-15`
**현상**: `validateStrategyConfig()`는 `getParamMeta(strategyName)`를 호출하는데, `PARAM_META`에는 18개 내장 전략만 정의되어 있고 커스텀 전략(`Custom_xxx`)은 포함되지 않음. 결과적으로 `meta`가 `null`이므로 `{ valid: true, errors: [] }`을 반환하여 모든 커스텀 전략 config 변경이 무검증 통과.

```js
// strategyConfigValidator.js:12-15
const meta = getParamMeta(strategyName);
if (!meta || meta.length === 0) {
  return { valid: true, errors: [] };  // ← 커스텀 전략은 항상 여기
}
```

**영향**: 커스텀 전략의 config에 음수 레버리지, 문자열 등 무효한 값 주입 가능
**수정 방안**:
- `CustomRuleStrategy._buildMetadata()`가 반환하는 `defaultConfig`에서 동적으로 paramMeta를 생성
- 또는 커스텀 전략에 대해 `positionSizePercent(1-20)`, `leverage(1-20)`, `tpPercent(0.5-50)`, `slPercent(0.5-20)` 같은 공통 필드의 하드코딩된 검증 규칙 적용

**구현 난이도**: 중간 | **예상 시간**: 45분

---

### R14-BE-04: CustomRuleStrategy에서 `parseFloat` 사용으로 부동소수점 위반 [HIGH]

**파일**: `backend/src/strategies/custom/CustomRuleStrategy.js:98-104`
**현상**: 프로젝트 전체가 "금액 값 = String + mathUtils" 정책을 따르는데, CustomRuleStrategy의 `onTick()`에서 TP/SL 판정을 `parseFloat`로 수행함. 정밀도 손실로 인해 TP/SL 트리거가 정확하지 않을 수 있다.

```js
// CustomRuleStrategy.js:98-104
const entry = parseFloat(s.entryPrice);
const cur = parseFloat(price);
const pctChange = ((cur - entry) / entry) * 100;
```

또한 `_evaluateCondition()`에서도 `parseFloat`로 비교 (라인 286-289).

**영향**: 극단적 가격대(예: SHIB 0.00000001)에서 비교 오류 발생 가능
**수정 방안**: `mathUtils.pctChange()`, `mathUtils.isGreaterThanOrEqual()` 등을 사용하도록 교체

**구현 난이도**: 쉬움 | **예상 시간**: 30분

---

### R14-BE-05: BotService `_handleStrategySignal` 비동기 에러 누락 [HIGH]

**파일**: `backend/src/services/botService.js:528-534`
**현상**: `strategy.on(TRADE_EVENTS.SIGNAL_GENERATED, onSignal)` 콜백에서 `_handleStrategySignal`은 `async` 함수인데, 리턴된 Promise를 `.catch()` 없이 호출한다. `_handleStrategySignal` 내부에서 `_resolveSignalQuantity`의 REST 호출이 실패하면 unhandledRejection이 발생한다.

```js
// botService.js:528-529
const onSignal = (signal) => {
  this._handleStrategySignal(signal, sessionId);  // ← Promise 무시
};
```

**영향**: unhandledRejection 경고 + 에러 추적 누락
**수정 방안**:
```js
const onSignal = (signal) => {
  this._handleStrategySignal(signal, sessionId).catch((err) => {
    log.error('_handleStrategySignal unhandled error', { strategy: signal.strategy, error: err.message });
  });
};
```
`enableStrategy()`의 동일 패턴(라인 1264-1266)도 동일하게 수정.

**구현 난이도**: 쉬움 | **예상 시간**: 15분

---

### R14-BE-06: RiskEngine 이벤트 포워딩에서 리스너 누수 [HIGH]

**파일**: `backend/src/services/riskEngine.js:77-83`
**현상**: `_forwardEvents()`에서 sub-engine에 익명 함수로 리스너를 등록하는데, RiskEngine 인스턴스가 재생성되지 않으므로 직접적 누수는 아니지만, `RiskEngine`이 여러 번 생성되는 테스트 환경에서 sub-engine의 리스너가 누적된다. 또한 `botService.stop()` → `botService.start()` 사이클에서 RiskEngine은 재생성되지 않으므로 sub-engine 이벤트가 중복으로 re-emit될 수 있다.

```js
// riskEngine.js:78-82 — 리스너 제거 메커니즘 없음
_forwardEvents(source, events) {
  for (const event of events) {
    source.on(event, (payload) => {
      this.emit(event, payload);
    });
  }
}
```

**영향**: 테스트 시 MaxListenersExceeded 경고, 프로덕션에서는 낮은 위험
**수정 방안**: named 함수로 변경 + `destroy()` 메서드에서 제거 가능하게 구현, 또는 `once` 패턴이 아닌 이상 현재 싱글턴 패턴에서는 constructor에서 한 번만 등록하므로 실제 누수는 아님 → LOW로 재분류 가능

**구현 난이도**: 쉬움 | **예상 시간**: 20분

---

### R14-BE-07: OrderManager `_symbolLocks` 메모리 누적 [HIGH]

**파일**: `backend/src/services/orderManager.js:179-204`
**현상**: `submitOrder()`에서 per-symbol 잠금을 구현할 때, `finally` 블록에서 `this._symbolLocks.get(symbol) === current`일 때만 삭제한다. 하지만 lock timeout이 발생하면 `releaseLock()`은 호출되지만 Map에 남아있는 Promise는 resolved 상태로 계속 존재할 수 있다. 장기 운영 시 수백 개 심볼의 lock이 쌓일 수 있다.

```js
// orderManager.js:200-204
} finally {
  releaseLock();
  if (this._symbolLocks.get(symbol) === current) {
    this._symbolLocks.delete(symbol);
  }
}
```

**영향**: 메모리 누적 (미미하지만 원칙적으로 정리 필요)
**수정 방안**: 주기적 cleanup 또는 `WeakRef` 사용 불가능하므로, `BotService.stop()`에서 `orderManager._symbolLocks.clear()` 호출 추가

**구현 난이도**: 쉬움 | **예상 시간**: 10분

---

### R14-BE-08: Backtest 라우트 입력 검증 미흡 — startTime/endTime [MEDIUM]

**파일**: `backend/src/api/backtestRoutes.js:63-66`
**현상**: `startTime`과 `endTime`이 숫자인지, startTime < endTime인지, 미래 날짜가 아닌지 검증하지 않음. 또한 `initialCapital`, `makerFee`, `takerFee`, `slippage` 값의 범위 검증이 없다.

```js
// backtestRoutes.js:63-66 — 타입/범위 검증 없음
if (!strategyName || !symbol || !interval || !startTime || !endTime) {
  return res.json({ success: false, error: '...' });
}
```

**영향**: 음수 자본, 역순 시간 범위 등으로 백테스트 엔진 예외 또는 무한 루프
**수정 방안**: 다음 검증 추가:
- `startTime`, `endTime`: 양수 정수, `startTime < endTime`, 최대 365일 범위
- `initialCapital`: `'100'` 이상 `'10000000'` 이하
- `makerFee`, `takerFee`: `'0'` ~ `'0.01'` 범위
- `slippage`: `'0'` ~ `'0.01'` 범위
- `interval`: 허용 목록 (`'1m','5m','15m','30m','1H','4H','1D'`) 검증

**구현 난이도**: 쉬움 | **예상 시간**: 30분

---

### R14-BE-09: botRoutes custom-strategies POST — `__proto__` 프로토타입 오염 방어 미비 [MEDIUM]

**파일**: `backend/src/api/botRoutes.js:326-361`
**현상**: POST `/custom-strategies` 엔드포인트에서 `req.body`를 그대로 `customStrategyStore.save(def)`에 전달하고, `save()` 내부에서 `{ ...def, id, createdAt, updatedAt }`로 spread한다. 만약 `def`에 `__proto__` 또는 `constructor` 속성이 있으면 spread 시 프로토타입 오염은 발생하지 않지만(ES2018+ spread는 own enumerable만 복사), `JSON.parse(JSON.stringify(...))`를 거치는 persistence 경로에서 `__proto__` 키가 복원될 수 있다.

또한 `def.indicators`, `def.rules`의 깊은 구조를 검증하지 않으므로 악의적으로 중첩된 객체를 통해 DoS (스택 오버플로) 공격이 가능하다.

**영향**: 보안 취약점 (낮은 확률이나 원칙적 방어 필요)
**수정 방안**:
- `JSON.stringify`/`parse` 대신 안전한 직렬화 사용
- 입력 깊이 제한 (최대 5 depth)
- `indicators` 배열 크기 제한 (최대 10)
- `rules.conditions` 배열 크기 제한 (최대 20)
- 금지 키 필터링 (`__proto__`, `constructor`, `prototype`)

**구현 난이도**: 중간 | **예상 시간**: 45분

---

### R14-BE-10: PaperEngine SL/TP 주문에 stale cleanup 미적용 [MEDIUM]

**파일**: `backend/src/services/paperEngine.js:266-318, 332-388`
**현상**: `_pendingSLOrders`와 `_pendingTPOrders`에는 `_cleanupStaleOrders()`가 적용되지 않는다. 포지션이 외부(수동 청산, 전략 비활성화 등)에서 닫혀도 SL/TP 주문이 Map에 남아있어, 나중에 동일 심볼:posSide로 새 포지션이 열리면 이전의 SL/TP가 잘못 트리거될 수 있다.

```js
// paperEngine.js:205 — _pendingOrders만 정리
this._cleanupStaleOrders();
// _pendingSLOrders, _pendingTPOrders는 정리하지 않음
```

**영향**: 잘못된 SL/TP 트리거 → paper 모드에서 의도치 않은 청산
**수정 방안**:
- `_checkStopLossTriggers`와 `_checkTakeProfitTriggers`에서 `createdAt` 기반 stale 체크 추가 (30분 이상 된 SL/TP 자동 제거)
- 또는 `PaperPositionManager.onFill()`에서 포지션 종료 시 관련 SL/TP 정리 호출

**구현 난이도**: 쉬움 | **예상 시간**: 30분

---

### R14-BE-11: PositionManager `_checkDailyReset` 타임존 불일치 [MEDIUM]

**파일**: `backend/src/services/positionManager.js:362-376`
**현상**: `_checkDailyReset()`에서 `utcHour` 변수를 선언하지만 사용하지 않고, `todayDate`는 UTC 기준이므로 실제로는 UTC 자정에 리셋된다. 이 자체는 올바르지만, 변수 `utcHour`가 dead code이며, 한국 시간(KST=UTC+9) 기준으로 자정 리셋을 원하는 경우 의도와 불일치할 수 있다.

```js
const utcHour = now.getUTCHours(); // ← 사용되지 않음 (dead code)
const todayDate = now.toISOString().slice(0, 10);
```

**영향**: Dead code (코드 품질), KST 자정 리셋 의도와 불일치 가능
**수정 방안**: 사용하지 않는 `utcHour` 변수 제거. 리셋 시간을 환경 변수로 설정 가능하게 (`DAILY_RESET_HOUR_UTC=15` → KST 자정)

**구현 난이도**: 쉬움 | **예상 시간**: 15분

---

### R14-BE-12: SignalFilter `_recentSignals` 배열 무제한 증가 가능 [MEDIUM]

**파일**: `backend/src/services/signalFilter.js:345-348`
**현상**: `_pass()` 메서드에서 `_recentSignals`에 push하고, `_cleanup()`에서 `DUPLICATE_WINDOW_MS * 2` (10초) 이전 것을 필터링한다. 그러나 `_cleanup()`은 `filter()` 호출에서만 실행되므로, 시그널이 매우 빈번하게 발생하면 10초 내에 수백 개가 쌓일 수 있고, 그 자체는 문제가 되지 않지만 `_cleanup()`의 `filter()`가 매번 전체 배열을 순회하므로 O(n) 비용이 발생한다.

**영향**: 성능 저하 (시그널 폭주 시)
**수정 방안**: `_recentSignals`를 원형 버퍼 또는 최대 크기 제한(예: 500개)으로 변경

**구현 난이도**: 쉬움 | **예상 시간**: 20분

---

### R14-BE-13: app.js 이벤트 리스너가 봇 라이프사이클과 독립적 [MEDIUM]

**파일**: `backend/src/app.js:357-476`
**현상**: `app.js`에서 `orderManager`, `positionManager`, `marketData`, `riskEngine` 등에 Socket.io 전달용 리스너를 등록하는데, 이 리스너들은 `botService.stop()`에서 제거되지 않는다. `botService.stop()` → `botService.start()` 사이클에서 orderManager/positionManager의 `destroy()`가 호출되어 WS 리스너는 제거되지만, app.js에서 등록한 Socket.io 전달 리스너는 그대로 남아있다. 만약 `destroy()` 후 새로운 orderManager가 생성되면 app.js 리스너는 이전 인스턴스에 붙어있어 이벤트 전달 불가.

단, 현재 구조에서 orderManager/positionManager는 재생성되지 않으므로 당장 문제는 아니지만, 향후 hot-reload 기능 추가 시 문제가 됨.

**영향**: 현재는 무해하나 향후 확장 시 이벤트 누락 위험
**수정 방안**: 향후 참고 사항으로 기록. 지금은 app.js에 주석으로 "서비스 인스턴스가 bootstrap에서 한 번만 생성됨 — 재생성 시 리스너 재등록 필요" 명시

**구현 난이도**: 쉬움 | **예상 시간**: 10분

---

### R14-BE-14: backtestRoutes 검증 실패 시 HTTP 200 반환 [LOW]

**파일**: `backend/src/api/backtestRoutes.js:63-66, 70-75`
**현상**: 검증 실패 시 `res.json({ success: false, error: '...' })`으로 응답하는데 HTTP 상태 코드가 200이다. REST API 규약상 400을 반환해야 프론트엔드에서 에러 핸들링이 일관적이다.

```js
// backtestRoutes.js:63-65 — HTTP 200으로 에러 반환
return res.json({
  success: false,
  error: 'strategyName, symbol, interval, startTime, endTime 필수',
});
```

**영향**: 프론트엔드 에러 핸들링 불일치, 모니터링 시스템의 에러율 추적 불가
**수정 방안**: `res.status(400).json(...)` 또는 `res.status(404).json(...)` 등 적절한 HTTP 상태 코드 사용

**구현 난이도**: 쉬움 | **예상 시간**: 15분

---

### R14-BE-15: CustomRuleStrategy 내부 포지션 추적과 실제 포지션 불일치 [LOW]

**파일**: `backend/src/strategies/custom/CustomRuleStrategy.js:213-214, 381-385`
**현상**: `CustomRuleStrategy`가 `s.entryPrice`와 `s.positionSide`로 자체적으로 포지션 상태를 추적하는데, 주문이 실패하거나 RiskEngine에 의해 거부되어도 `emitSignal()` 호출 직전에 이미 state를 설정한다(라인 213-214: entryLong 시 `s.entryPrice = close; s.positionSide = 'long'`). 주문 거부 시 내부 상태와 실제 포지션이 불일치.

```js
// CustomRuleStrategy.js:213-214 — 시그널 emit 전에 상태 변경
s.entryPrice = close;
s.positionSide = 'long';
this.emitSignal({ action: SIGNAL_ACTIONS.OPEN_LONG, ... });
// 만약 주문이 거부되면 entryPrice/positionSide가 잘못 설정된 상태
```

**영향**: 주문 거부 후 전략이 "포지션 있음" 상태로 잠겨 새 진입 불가
**수정 방안**: `emitSignal` 후 주문 결과를 확인하여 state 설정하거나, `onFill()` 콜백에서만 state 변경. 단, 현재 아키텍처에서 전략은 주문 결과를 직접 수신하지 않으므로, 중기적으로 `ORDER_FILLED` 이벤트를 전략에 전달하는 피드백 루프가 필요.

**구현 난이도**: 높음 | **예상 시간**: 2시간

---

### R14-BE-16: DrawdownMonitor 경고 이벤트 반복 발사 [LOW]

**파일**: `backend/src/services/drawdownMonitor.js:113-127`
**현상**: `updateEquity()`가 호출될 때마다 drawdown이 warning threshold을 넘으면 `DRAWDOWN_WARNING` 이벤트를 발사한다. 포지션이 열려있는 동안 equity가 변할 때마다(매 ticker update → position sync) 경고가 반복적으로 발사되어 Socket.io를 통해 프론트엔드에 스팸성으로 전달된다.

**영향**: 프론트엔드 토스트 스팸, 로그 과다
**수정 방안**: `_lastWarningTime` 타임스탬프를 추가하여 최소 5분 간격으로만 경고 발사

**구현 난이도**: 쉬움 | **예상 시간**: 15분

---

## 제안 사항 (우선순위별 정렬)

| ID | 제목 | 우선순위 | 난이도 | 예상 시간 | 영역 |
|---|---|---|---|---|---|
| R14-BE-01 | CustomStrategyStore ID 충돌 + 보안 | CRITICAL | 쉬움 | 30분 | BE |
| R14-BE-02 | Custom Strategy 업데이트 시 활성 인스턴스 미반영 | CRITICAL | 중간 | 1시간 | BE |
| R14-BE-03 | Custom Strategy config 검증 미적용 | HIGH | 중간 | 45분 | BE |
| R14-BE-04 | CustomRuleStrategy parseFloat 정밀도 위반 | HIGH | 쉬움 | 30분 | BE |
| R14-BE-05 | _handleStrategySignal 비동기 에러 누락 | HIGH | 쉬움 | 15분 | BE |
| R14-BE-06 | RiskEngine 이벤트 포워딩 리스너 관리 | HIGH | 쉬움 | 20분 | BE |
| R14-BE-07 | OrderManager _symbolLocks 메모리 누적 | HIGH | 쉬움 | 10분 | BE |
| R14-BE-08 | Backtest 라우트 입력 검증 강화 | MEDIUM | 쉬움 | 30분 | BE |
| R14-BE-09 | Custom Strategy POST 프로토타입 오염 방어 | MEDIUM | 중간 | 45분 | BE |
| R14-BE-10 | PaperEngine SL/TP stale cleanup | MEDIUM | 쉬움 | 30분 | BE |
| R14-BE-11 | PositionManager dead code + 타임존 설정 | MEDIUM | 쉬움 | 15분 | BE |
| R14-BE-12 | SignalFilter _recentSignals 크기 제한 | MEDIUM | 쉬움 | 20분 | BE |
| R14-BE-13 | app.js 이벤트 리스너 라이프사이클 주석 | MEDIUM | 쉬움 | 10분 | BE |
| R14-BE-14 | backtestRoutes HTTP 상태 코드 수정 | LOW | 쉬움 | 15분 | BE |
| R14-BE-15 | CustomRuleStrategy 포지션 추적 불일치 | LOW | 높음 | 2시간 | BE |
| R14-BE-16 | DrawdownMonitor 경고 스팸 방지 | LOW | 쉬움 | 15분 | BE |

**총 예상 구현 시간**: ~8시간 (CRITICAL+HIGH만: ~3시간 30분)

---

## Deferred 항목 재평가

### 1. WS 재연결 후 재구독 (R4에서 deferred)
**재평가**: **구현 권장 (HIGH)**
**사유**: `exchangeClient.js:608-609`에서 reconnected 이벤트를 감지하고 fill reconciliation은 수행하지만, public WS 재연결 시 구독한 심볼의 ticker/kline 채널이 자동 재구독되는지는 bitget-api SDK의 내부 동작에 의존한다. SDK가 자동 재구독을 보장하지 않으면 재연결 후 market data가 끊어질 수 있다. `marketData.js`의 `_subscribedSymbols` Set을 이용한 재구독 로직이 필요하다.

### 2. API 라우트 입력 검증 (Zod) (R6에서 deferred)
**재평가**: **부분 구현 권장 (MEDIUM)**
**사유**: 전체 Zod 마이그레이션은 오버헤드가 크지만, R14-BE-08과 R14-BE-09에서 드러난 것처럼 최소한 backtest와 custom-strategies 엔드포인트에는 구조적 입력 검증이 필요하다. Zod 대신 수동 검증 함수로도 충분.

### 3. 테스트 커버리지 확대 (R8에서 deferred)
**재평가**: **구현 권장 (HIGH)**
**사유**: R13에서 추가된 `strategyConfigValidator`, `customStrategyStore`, `CustomRuleStrategy`에 대한 단위 테스트가 전무하다. 특히 R14-BE-01(ID 충돌), R14-BE-04(parseFloat 정밀도), R14-BE-15(포지션 추적 불일치) 같은 문제는 테스트가 있었다면 발견되었을 것이다. 최소 다음 테스트를 추가해야 한다:
- `strategyConfigValidator.test.js` — 타입별 검증, 커스텀 전략 검증
- `customStrategyStore.test.js` — CRUD, 동시 쓰기, ID 충돌
- `CustomRuleStrategy.test.js` — 규칙 평가, TP/SL, 포지션 추적

### 4. Bootstrap 중간 실패 복구 (R7에서 deferred)
**재평가**: **유지 (DEFERRED)**
**사유**: BotService.start()에 rollback 로직이 이미 R12에서 구현됨. bootstrap() 자체의 중간 실패(예: MongoDB 연결 실패 후 서비스 생성 시도)는 현재 `process.exit(1)`로 처리되며, 이는 프로덕션에서 프로세스 매니저(pm2/systemd)가 재시작하므로 충분.

### 5. MongoDB 커넥션 풀 모니터링 (R8에서 deferred)
**재평가**: **유지 (DEFERRED)**
**사유**: 현재 단일 서버 환경에서 커넥션 풀 이슈가 보고된 적 없음. 수평 확장 시 필요하지만 당장은 불필요.

### 6. Socket.io CORS + 인증 (R9에서 deferred)
**재평가**: **구현 권장 (MEDIUM)**
**사유**: `app.js:347-352`에서 Socket.io CORS가 `origin: '*'`로 설정되어 있고, Socket.io 연결에 인증이 없다. API Key 인증은 HTTP 라우트에만 적용되고 WebSocket에는 적용되지 않음. 공격자가 WebSocket으로 실시간 거래 데이터를 무인증으로 수신 가능.

### 7. RateLimiter 최적화 (R9에서 deferred)
**재평가**: **유지 (DEFERRED)**
**사유**: 현재 단일 사용자 시스템이므로 rate limiter 최적화는 불필요.

---

## 구현 우선순위 권장

### Sprint R14 — 1차 (CRITICAL + HIGH, ~3.5시간)
1. R14-BE-01: CustomStrategyStore ID 생성 + 보안 강화
2. R14-BE-02: Custom Strategy 업데이트 시 활성 인스턴스 재생성
3. R14-BE-05: _handleStrategySignal 비동기 에러 처리
4. R14-BE-04: CustomRuleStrategy mathUtils 전환
5. R14-BE-03: Custom Strategy config 검증 로직 추가
6. R14-BE-07: OrderManager _symbolLocks 정리
7. R14-BE-06: RiskEngine 리스너 정리 (테스트 환경 안전성)

### Sprint R14 — 2차 (MEDIUM, ~2.5시간)
8. R14-BE-08: Backtest 입력 검증 강화
9. R14-BE-09: Custom Strategy POST 입력 깊이/크기 제한
10. R14-BE-10: PaperEngine SL/TP stale cleanup
11. R14-BE-11: PositionManager dead code 제거
12. R14-BE-12: SignalFilter 배열 크기 제한
13. R14-BE-13: app.js 리스너 라이프사이클 주석

### Sprint R14 — 3차 (LOW + deferred, ~3시간)
14. R14-BE-14: backtestRoutes HTTP 상태 코드
15. R14-BE-16: DrawdownMonitor 경고 스팸 방지
16. Deferred: WS 재연결 후 재구독 검증
17. Deferred: Socket.io 인증 추가

### 별도 트랙: 테스트 커버리지
- `strategyConfigValidator.test.js` 신규 작성
- `customStrategyStore.test.js` 신규 작성
- `CustomRuleStrategy.test.js` 신규 작성

---

## 다른 에이전트에게 요청 사항

### Trader Agent에게
1. **CustomRuleStrategy 포지션 추적 불일치 (R14-BE-15)**: 전략이 주문 결과를 받지 못하는 근본적 아키텍처 문제. ORDER_FILLED 이벤트를 전략에 피드백하는 메커니즘 설계 제안 요청
2. **커스텀 전략 규칙 평가기 로버스트니스**: `_evaluateCondition`의 비교 연산자가 `parseFloat`에 의존하는 문제와 별도로, 크로스 감지(`crosses_above/below`)의 첫 번째 kline에서 `prevValues`가 빈 객체인 경우 항상 `false`를 반환하는 것이 의도된 동작인지 확인

### UI Agent에게
1. **커스텀 전략 업데이트 시 경고 UI**: R14-BE-02 수정 후, 봇 실행 중 커스텀 전략 수정 시 "재활성화 필요" 경고 배너를 StrategyConfigPanel에 추가
2. **Backtest 입력 폼 클라이언트 사이드 검증**: R14-BE-08에서 서버 측 검증을 강화하면, 프론트엔드 BacktestPage에서도 동일한 범위 제한을 적용하여 UX 향상
3. **DrawdownMonitor 경고 디바운싱**: R14-BE-16 수정 후에도 프론트엔드 측에서 동일 타입 토스트를 일정 시간 내 중복 표시하지 않는 디바운싱 로직 추가 권장
