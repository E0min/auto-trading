# Round 11 Proposal — Senior Systems Engineer

> 생성일: 2026-02-17
> 역할: Senior Systems Engineer (시스템 무결성, 에러 핸들링, 성능, 보안, 관측성)
> 범위: 코드베이스 재분석 — R1~R10에서 다루지 않은 새 개선과제 발굴

---

## 분석 요약

전체 백엔드 소스(30+ 파일, ~12,000줄)와 모델/테스트/라우트/미들웨어를 정밀 분석한 결과, 총 **15건의 신규 개선과제**를 발견했다. 핵심 카테고리:

1. **데이터 무결성 버그** (2건) — 세션 상태 불일치, 시그널 필터 바이패스 오류
2. **미사용 인프라** (1건) — R10 Trailing Stop이 어떤 전략에서도 호출되지 않음
3. **테스트 커버리지 공백** (1건) — 전체 코드베이스에 테스트 파일 1개뿐
4. **DB 인덱스/TTL 누락** (2건) — Signal 모델 인덱스 없음, Trade 모델 TTL 없음
5. **리소스 관리 결함** (3건) — PaperEngine 미정리, WS 재구독 누락, 일일 리셋 타이밍 취약
6. **입력 검증 부재** (2건) — API 라우트 + 환경변수 시작 시 검증 없음
7. **정밀도 한계** (1건) — mathUtils의 parseFloat 기반 연산
8. **Bootstrap 복원력** (1건) — 서비스 생성 중간 실패 시 복구 경로 없음
9. **관측성 공백** (2건) — MongoDB 커넥션 풀 모니터링 없음, 리스크 이벤트 메트릭 미노출

---

## 발견 사항

### E11-1. BotSession 상태 불일치 — peakEquity 복원 실패 [BUG]

**파일**: `backend/src/services/botService.js`

**증거**:
- **Line 760**: `stop()` 메서드가 세션 상태를 `BOT_STATES.IDLE` (`'idle'`)로 설정
  ```js
  this.currentSession.status = BOT_STATES.IDLE;  // 'idle'
  ```
- **Line 547-548**: `start()`에서 peakEquity 복원 시 `status: 'stopped'`로 쿼리
  ```js
  const lastSession = await BotSession.findOne(
    { status: 'stopped' },  // ← 'idle'로 저장되므로 매칭 안 됨!
    { stats: 1 },
    { sort: { stoppedAt: -1 } },
  );
  ```

**영향**: R10 AD-58에서 구현한 peakEquity 교차 세션 복원이 **절대 작동하지 않음**. 봇 재시작마다 peakEquity가 0부터 시작하여, DrawdownMonitor가 실제 고점 대비 낙폭을 추적하지 못함. 사실상 drawdown 보호가 세션 단위로 리셋됨.

**수정**: `stop()`에서 `'stopped'`로 설정하거나, `findOne` 쿼리에서 `{ status: { $in: ['idle', 'stopped'] } }`로 변경.

---

### E11-2. SignalFilter close 시그널 바이패스 오류 [BUG]

**파일**: `backend/src/services/signalFilter.js`

**증거** (Line 136):
```js
const isClose = action === 'CLOSE' || signal.reduceOnly;
```

**문제**: `SIGNAL_ACTIONS`에 정의된 실제 close 액션은 `'close_long'`과 `'close_short'`이며, `'CLOSE'`라는 값은 존재하지 않음 (`constants.js` Line 40-45 참조).

따라서 `signal.reduceOnly`가 `false`인 일반 청산 시그널은 바이패스를 타지 못하고, 쿨다운/중복 필터에 걸려 **청산 기회를 놓칠 수 있음**.

**수정**:
```js
const isClose =
  action === SIGNAL_ACTIONS.CLOSE_LONG ||
  action === SIGNAL_ACTIONS.CLOSE_SHORT ||
  signal.reduceOnly;
```

---

### E11-3. Trailing Stop 인프라 미사용 — 전략 호출부 부재 [DEAD CODE]

**파일**: `backend/src/services/strategyBase.js` (Line 424-503)

**증거**:
- `strategyBase.js`에 `_checkTrailingStop(price)` 메서드가 R10 AD-59로 구현됨
- `onFill(fill)`이 trailing state를 관리 (entryPrice, positionSide, extremePrice)
- 그러나 `backend/src/strategies/` 하위 18개 전략 파일 어디에서도 `_checkTrailingStop()`을 **단 한 번도 호출하지 않음** (grep 결과 0건)

**영향**: trailing stop 인프라가 완전히 작동하지 않는 dead code 상태. 백테스트에서도 `onTick()`이 호출되지만, 개별 전략이 `_checkTrailingStop()`을 호출해야 작동하는 구조인데 아무 전략도 이를 수행하지 않음.

**수정 방향**: 두 가지 선택지:
1. `strategyBase.onTick()` 기본 구현에서 `_checkTrailingStop()` 자동 호출 → 모든 전략에 적용
2. trailing stop을 사용할 전략에만 수동으로 호출 추가 (opt-in)

Option 1이 더 안전함 (기본 클래스에서 처리하면 누락 위험 없음).

---

### E11-4. 테스트 커버리지 전무 — mathUtils.test.js 1개뿐 [CRITICAL GAP]

**파일**: `backend/__tests__/unit/utils/mathUtils.test.js` (277줄, 51 테스트)

**증거**:
```
backend/__tests__/
└── unit/
    └── utils/
        └── mathUtils.test.js   ← 유일한 테스트 파일
```

12,000줄 이상의 프로덕션 코드에 대해 테스트 파일 **1개**(유틸리티 함수만 커버). 주요 서비스(botService, riskEngine, orderManager, positionManager, signalFilter, drawdownMonitor, circuitBreaker, exposureGuard), 모델, API 라우트, 전략에 대한 테스트가 **전혀 없음**.

**우선 테스트 대상** (위험도 순):
1. `riskEngine.js` + 서브엔진 3개 — 주문 거부/승인 판정 로직
2. `signalFilter.js` — 시그널 필터링 결정 (E11-2 버그 재발 방지)
3. `drawdownMonitor.js` — 낙폭 계산 + halt 판정
4. `orderManager.js` — 뮤텍스 직렬화, 이중 주문 방지
5. `backtestEngine.js` — PnL 계산 정확성

---

### E11-5. Signal 모델 인덱스 부재 — 쿼리 성능 저하 [PERF]

**파일**: `backend/src/models/Signal.js`

**증거**: Signal 스키마에 **인덱스가 전혀 정의되어 있지 않음** (Line 14-64). 대비로 Trade 모델에는 `orderId`, `clientOid`, `symbol`, `status`, `{sessionId, createdAt}` 인덱스가 있음.

Signal은 API에서 `strategy`, `symbol`, `sessionId`, `createdAt`로 조회됨 (`tradeRoutes.js`의 signals 엔드포인트). 인덱스 없이 풀 컬렉션 스캔이 발생.

**추가 필요 인덱스**:
```js
signalSchema.index({ sessionId: 1, createdAt: -1 });
signalSchema.index({ strategy: 1, createdAt: -1 });
signalSchema.index({ symbol: 1, createdAt: -1 });
```

---

### E11-6. Trade 모델 TTL/아카이브 전략 부재 [DATA GROWTH]

**파일**: `backend/src/models/Trade.js`

**증거**: Trade 모델에 TTL 인덱스가 없음 (Line 111-116). Snapshot은 90일, RiskEvent는 30일 TTL이 있지만, Trade 레코드는 **영구 축적**.

장기 운영 시 컬렉션 크기가 무한 성장하여 쿼리 성능 저하 + MongoDB 스토리지 부담.

**수정**: 180일 TTL 인덱스 추가, 또는 아카이브 컬렉션으로 이동하는 cron job 구현.

---

### E11-7. PaperEngine 미결 주문 무제한 축적 [RESOURCE LEAK]

**파일**: `backend/src/services/paperEngine.js`

**증거**: `_pendingOrders` Map (`submitLimitOrder()`에서 추가, Line 161)에 TTL이나 최대 크기 제한이 없음. 시장가와 달리 리밋 주문은 조건 미충족 시 무한히 대기.

`onTickerUpdate()`에서 심볼 매칭 후 체결 여부만 확인하고, stale 주문 정리 로직이 없음. `cancelOrder()`로 수동 취소하거나 `reset()`으로 전체 초기화해야만 정리 가능.

**수정**: 30분 TTL 자동 만료 + 최대 50건 제한 (FIFO eviction).

---

### E11-8. WebSocket 재연결 후 토픽 재구독 누락 [RELIABILITY]

**파일**: `backend/src/services/exchangeClient.js`

**증거** (Line 584-585, 611-612):
```js
wsPublic.on('reconnected', (data) => {
  log.info('WS public — reconnected', { wsKey: data?.wsKey });
});
// ← 재구독 로직 없음

wsPrivate.on('reconnected', (data) => {
  log.info('WS private — reconnected', { wsKey: data?.wsKey });
});
// ← 재구독 로직 없음
```

`reconnected` 이벤트 핸들러가 로그만 남기고, 이전에 구독했던 토픽들을 **재구독하지 않음**. 네트워크 끊김 후 재연결 시 틱/주문 업데이트를 받지 못하는 사일런트 장애 발생 가능.

**참고**: bitget-api SDK (v3)의 `WebsocketClientV3`가 자동 재구독을 지원하는지 확인 필요. 미지원 시 구독 토픽 목록을 보관하고 `reconnected` 이벤트에서 재구독 실행.

---

### E11-9. 일일 리셋 타이밍 취약점 [EDGE CASE]

**파일**: `backend/src/services/positionManager.js`

**증거** (Line 362-376):
```js
_checkDailyReset() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const todayDate = now.toISOString().slice(0, 10);

  if (utcHour === 0 && this._lastResetDate !== todayDate) {
    this.riskEngine.resetDaily();
    this._lastResetDate = todayDate;
  }
}
```

체크 간격은 60초(`DAILY_RESET_CHECK_INTERVAL_MS`)인데, `utcHour === 0`은 정확히 00:00~00:59 UTC 사이에만 true. 만약:
1. 봇이 00:00~00:59 사이에 정지 상태였다가 01:00 이후에 시작하면 리셋 누락
2. `_lastResetDate`가 메모리에만 있어서 봇 재시작 시 초기화됨 (이중 리셋 가능)

**수정**: `utcHour === 0` 대신 날짜 변경 감지 방식으로 전환:
```js
if (this._lastResetDate !== todayDate) { ... }
```

---

### E11-10. API 라우트 입력 검증 부재 [SECURITY]

**파일**: `backend/src/api/botRoutes.js`

**증거**:
- `/api/bot/start` POST — `req.body`의 `config` 객체에 대한 **스키마 검증 없음** (Line ~20-30). 악의적이거나 잘못된 형식의 config가 그대로 botService.start()에 전달됨.
- `/api/bot/strategies/:name/config` PUT — 설정 변경 시 검증 없음.
- `/api/bot/risk-params` PUT — 부분적 타입 체크만 존재 (숫자 범위 미검증).

**수정**: Joi나 Zod 기반 스키마 검증 미들웨어 도입. 최소한:
- `config.leverage`: 1~125 범위 정수
- `config.maxPositionPercent`: "0.01"~"100" 문자열
- `strategyConfig`: 전략별 허용 키 화이트리스트

---

### E11-11. 환경변수 시작 시 검증 없음 [RELIABILITY]

**파일**: `backend/src/app.js`

**증거**: `bootstrap()` 함수 시작부에 환경변수 존재/형식 검증 로직이 없음 (Line 82~). `PAPER_TRADING=true`가 아닌 라이브 모드에서 `BITGET_API_KEY` 등이 없으면, 서비스 생성 중 `config/bitget.js`에서 throw되지만 에러 메시지가 불명확.

**수정**: bootstrap 시작 시 필수 환경변수 사전 검증:
```js
function validateEnv() {
  const required = PAPER_TRADING
    ? ['MONGO_URI']
    : ['MONGO_URI', 'BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_PASSPHRASE'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
```

---

### E11-12. Bootstrap 중간 실패 시 복구 경로 없음 [RELIABILITY]

**파일**: `backend/src/app.js`

**증거** (Line 82-221): `bootstrap()`에서 25개 이상의 서비스를 순차 생성하는데, 중간에 하나가 실패하면 이미 생성된 서비스들의 정리(cleanup) 없이 `process.exit(1)`로 종료 (Line 601-603).

```js
bootstrap().catch((err) => {
  log.error('Fatal error during bootstrap', { error: err });
  process.exit(1);  // ← 이미 생성된 서비스, WS 연결, interval 등 정리 안 됨
});
```

MarketData나 TickerAggregator가 WS 연결을 시작한 후, BotService 생성에서 실패하면 WS 연결이 dangling 상태로 남음.

**수정**: try-catch 블록으로 감싸고, 실패 시 이미 생성된 서비스들의 `destroy()`/`stop()` 호출 후 종료.

---

### E11-13. mathUtils parseFloat 정밀도 한계 [PRECISION]

**파일**: `backend/src/utils/mathUtils.js`

**증거**: "모든 금액은 String" 컨벤션이지만, 내부적으로 `parseFloat()`를 사용:
```js
function add(a, b) { return String(parseFloat(a) + parseFloat(b)); }
function multiply(a, b) { return String(parseFloat(a) * parseFloat(b)); }
```

IEEE 754 배정밀도 부동소수점의 유효숫자는 15-17자리. 거래량이 매우 크거나(`>= 10^15`), 정밀도가 높은 경우(`0.00000001` 단위) 정밀도 손실 가능.

**예시**: `parseFloat('9999999999999999')` → `10000000000000000` (16자리에서 이미 손실)

**수정 옵션**:
1. `big.js` 또는 `decimal.js` 라이브러리 도입 (완전 정밀)
2. 현재는 BTC 가격 범위(`~100000`)와 일반 수량에서 문제 없지만, 향후 대비 필요

---

### E11-14. MongoDB 커넥션 풀 모니터링 부재 [OBSERVABILITY]

**파일**: `backend/src/config/db.js`

**증거** (Line 1-73): `connected`, `error`, `disconnected` 이벤트 리스너는 있지만, 커넥션 풀 상태(활성 연결 수, 대기 큐 크기)를 모니터링하거나 Prometheus 메트릭으로 노출하지 않음.

MongoDB 커넥션 풀이 고갈되면 모든 DB 작업이 타임아웃되지만, 현재는 이를 감지하지 못함.

**수정**: `mongoose.connection.getClient().topology` 또는 Mongoose 6+ 이벤트로 풀 사용률을 Prometheus gauge 메트릭에 노출.

---

### E11-15. 리스크 이벤트 Prometheus 메트릭 미노출 [OBSERVABILITY]

**파일**: `backend/src/utils/metrics.js` (존재 여부 확인), `backend/src/services/riskEngine.js`

**증거**: `riskEngine`이 `ORDER_REJECTED`, `DRAWDOWN_WARNING`, `DRAWDOWN_HALT`, `CIRCUIT_OPEN` 이벤트를 emit하지만, 이들이 Prometheus Counter/Histogram으로 집계되지 않음. HTTP 요청 메트릭만 노출 중.

**수정**: 리스크 이벤트별 카운터 추가:
```js
const riskRejectCounter = new Counter({ name: 'risk_order_rejected_total', labelNames: ['reason'] });
const drawdownHaltCounter = new Counter({ name: 'risk_drawdown_halt_total', labelNames: ['reason'] });
const circuitBreakerCounter = new Counter({ name: 'risk_circuit_breaker_total', labelNames: ['state'] });
```

---

## 제안 사항

| ID | 이슈 | 우선순위 | 구현 난이도 | 예상 시간 |
|----|------|---------|-----------|----------|
| E11-1 | BotSession 상태 불일치 (peakEquity 복원 실패) | **P0 — 즉시** | 낮음 | 15분 |
| E11-2 | SignalFilter close 바이패스 오류 | **P0 — 즉시** | 낮음 | 10분 |
| E11-3 | Trailing Stop 전략 호출부 부재 | **P0 — 즉시** | 중간 | 1시간 |
| E11-9 | 일일 리셋 타이밍 취약점 | **P1 — 1주 내** | 낮음 | 20분 |
| E11-8 | WS 재연결 후 재구독 누락 | **P1 — 1주 내** | 중간 | 2시간 |
| E11-5 | Signal 모델 인덱스 부재 | **P1 — 1주 내** | 낮음 | 15분 |
| E11-6 | Trade 모델 TTL 부재 | **P1 — 1주 내** | 낮음 | 15분 |
| E11-7 | PaperEngine 미결 주문 무제한 축적 | **P1 — 1주 내** | 중간 | 1시간 |
| E11-10 | API 라우트 입력 검증 부재 | **P1 — 1주 내** | 중간 | 3시간 |
| E11-11 | 환경변수 시작 시 검증 없음 | **P1 — 1주 내** | 낮음 | 30분 |
| E11-12 | Bootstrap 중간 실패 시 복구 경로 없음 | **P2 — 2주 내** | 중간 | 2시간 |
| E11-4 | 테스트 커버리지 전무 (핵심 서비스) | **P2 — 2주 내** | 높음 | 8시간+ |
| E11-13 | mathUtils parseFloat 정밀도 한계 | **P2 — 2주 내** | 높음 | 4시간 |
| E11-14 | MongoDB 커넥션 풀 모니터링 | **P2 — 2주 내** | 낮음 | 1시간 |
| E11-15 | 리스크 이벤트 Prometheus 메트릭 | **P2 — 2주 내** | 낮음 | 1시간 |

### 구현 순서 권장

1. **Phase 1 (즉시)**: E11-1 → E11-2 → E11-3 (버그 3건 우선 수정)
2. **Phase 2 (1주 내)**: E11-9, E11-5, E11-6, E11-11, E11-7, E11-8, E11-10
3. **Phase 3 (2주 내)**: E11-4, E11-12, E11-13, E11-14, E11-15

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게
1. **E11-3 (Trailing Stop)**: 어떤 전략들이 trailing stop을 활용해야 하는지 결정 필요. 모든 전략에 기본 적용할지, 특정 전략(Turtle, SwingStructure 등 트렌드 추종형)에만 적용할지 전략 관점에서 판단 요청.
2. **E11-1 (peakEquity 복원)**: peakEquity가 세션 간 리셋되고 있었으므로, 이전 세션의 drawdown 보호가 정상 작동하지 않았음. 현재 리스크 파라미터(`maxDrawdownPercent: 10%`)가 세션 단위 리셋 기준으로 설정된 것인지, 아니면 누적 기준인지 확인 요청.
3. **E11-9 (일일 리셋)**: 일일 손실 한도 리셋 시점을 UTC 00:00에서 변경할 필요가 있는지 (예: 아시아 시장 기준 KST 09:00) 트레이딩 관점에서 의견 요청.

### UI/UX 에이전트에게
1. **E11-5, E11-6**: Signal/Trade 모델 변경 시 프론트엔드 시그널 목록/거래 내역 페이지의 쿼리 성능 개선 효과 확인 요청.
2. **E11-15 (Prometheus 메트릭)**: 리스크 이벤트 메트릭이 추가되면, 대시보드에 리스크 현황 위젯(Circuit Breaker 상태, 최근 거부 건수, drawdown 경고 이력) 추가 가능성 검토 요청.
3. **E11-8 (WS 재연결)**: WebSocket 재연결 시 프론트엔드에 "데이터 갱신 중" 알림을 표시하는 UX 플로우 검토 요청.
