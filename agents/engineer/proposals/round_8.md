# Round 8 Engineer Proposal — 코드베이스 재분석: 새 개선과제 발굴

> 작성: Senior Systems Engineer
> 날짜: 2026-02-16
> 범위: 전체 backend/ 코드베이스 재분석 (7라운드 누적 이후)
> 분석 파일 수: 45+ 파일 (services/, api/, models/, utils/, backtest/, config/, middleware/)

---

## 분석 요약

7라운드에 걸쳐 89개 백로그 중 81개가 완료(91%)되었다. 프로세스 안정성(crashHandler, graceful shutdown), 동시성(mutex), 리소스 관리(timer unref, 배열 cap), 인증(API key), 관측성(Prometheus, traceId)의 기초가 확립되었다.

이번 Round 8 재분석에서는 이전에 발견되지 않았거나, 이전 라운드 구현 과정에서 새로 생겨난 이슈에 집중했다. **CRITICAL 2건, HIGH 6건, MEDIUM 8건**의 신규 발견사항과 **deferred 4건 재평가**를 보고한다.

---

## 발견 사항

### CRITICAL (실거래 전 반드시 수정)

#### C-1: Module-level Router Singleton — 모든 API 라우트 파일에 공유 인스턴스

**파일**: `backend/src/api/botRoutes.js:9`, `tradeRoutes.js:9`, `analyticsRoutes.js:9`, `healthRoutes.js:9`, `paperRoutes.js:9`, `tournamentRoutes.js:9`, `regimeRoutes.js`, `riskRoutes.js`

```javascript
// botRoutes.js:9 (팩토리 함수 밖에 선언됨)
const router = require('express').Router();

module.exports = function createBotRoutes({ botService, riskEngine }) {
  router.post('/start', async (req, res) => { ... });
  // ...
  return router;
};
```

**문제**: `require('express').Router()`가 팩토리 함수 **밖**에서 호출되므로, `createBotRoutes()`를 여러 번 호출하면 동일한 router 인스턴스에 핸들러가 **중복 등록**된다. 현재 `app.js`에서는 1번만 호출하므로 당장 문제가 없지만:

1. **테스트 환경**: `createBotRoutes()`를 테스트별로 호출하면 라우트 핸들러가 누적되어 이전 테스트의 deps로 핸들러가 실행됨
2. **Hot reload / 재시작**: Node.js 모듈 캐시로 인해 서버 재시작 없이 bootstrap을 재실행하면 핸들러가 2x 등록됨
3. **설계 의도 위반**: 팩토리 패턴인데 실질적으로 싱글턴으로 동작. CLAUDE.md에 명시된 "팩토리 함수를 export" 규약과 불일치

**R1 H-8에서 이미 지적**되었으나 8개 파일 모두에서 여전히 존재. 이전 라운드에서는 "당장 문제 없음"으로 넘어갔으나, 테스트 프레임워크(T3-1)가 도입된 지금 실질적 블로커이다.

**수정**: 모든 라우트 파일에서 `const router = require('express').Router()`를 팩토리 함수 **안**으로 이동.

---

#### C-2: BacktestStore 무제한 메모리 성장 — OOM 위험

**파일**: `backend/src/backtest/backtestStore.js`

```javascript
class BacktestStore {
  constructor() {
    this._results = new Map(); // 크기 제한 없음
  }
  save(id, result) {
    this._results.set(id, { ...result, id, createdAt: result.createdAt || Date.now() });
  }
}
module.exports = new BacktestStore(); // 싱글턴
```

**문제**:
- 백테스트 결과에는 `equityCurve`(수천~수만 개 포인트), `trades`(수백~수천 건) 배열이 포함됨
- 1회 백테스트 결과 ≈ 1~50MB (심볼/기간에 따라)
- 20회 실행 시 1GB 이상 가능 → **프로세스 OOM crash**
- `backtestRoutes.js`에서 POST `/run`은 rate limit(분당 3회)이 있지만, 누적 결과에는 TTL/LRU 없음
- API에서 `DELETE /:id`로 개별 삭제 가능하나 자동 정리 메커니즘 없음

**수정**:
- `MAX_STORED_RESULTS` 상수 (예: 50) + LRU 교체 정책
- `save()` 시 제한 초과하면 가장 오래된 결과 자동 삭제
- 선택: equityCurve/trades를 MongoDB로 이관하고 인메모리는 summary만 유지

---

### HIGH (1주 내 수정 필요)

#### H-1: `_lastTickerEmit` Map — 심볼 제거 시 정리 없음

**파일**: `backend/src/app.js:383-391`

```javascript
const _lastTickerEmit = new Map();
marketData.on(MARKET_EVENTS.TICKER_UPDATE, (data) => {
  const now = Date.now();
  const lastEmit = _lastTickerEmit.get(data.symbol) || 0;
  if (now - lastEmit < TICKER_THROTTLE_MS) return;
  _lastTickerEmit.set(data.symbol, now);
  io.emit('market:ticker', data);
});
```

**문제**:
- CoinSelector가 매 사이클(기본 30분)마다 다른 심볼 세트를 선택할 수 있음
- 이전에 구독된 심볼의 타임스탬프 엔트리가 Map에 영원히 남음
- 장기 운영 시(100+ 심볼 순환) Map 크기가 무한 성장
- `graceful shutdown`에서도 정리하지 않음 (프로세스 종료로 해소되지만, hot restart 시 문제)

**수정**: CoinSelector `COIN_SELECTED` 이벤트 시점에 이전 심볼 세트를 비교하여 제거된 심볼의 엔트리 삭제. 또는 주기적 cleanup (5분마다 1분 이상 오래된 엔트리 제거).

---

#### H-2: `resume()` — StrategyRouter 우회, 레짐 무시 활성화

**파일**: `backend/src/services/botService.js:670-705`

```javascript
async resume() {
  // ...
  for (const strategy of this.strategies) {
    for (const symbol of this._selectedSymbols) {
      try {
        strategy.activate(symbol, category);  // 레짐 무관하게 전부 활성화
      } catch (err) { ... }
    }
  }
  this._running = true;
  // ...
}
```

**문제**: `start()`에서는 StrategyRouter가 레짐 기반으로 전략을 선택적 활성화하지만, `resume()`에서는 StrategyRouter를 무시하고 **모든 전략을 모든 심볼에** 활성화한다. 이는:

1. 현재 레짐에 맞지 않는 전략이 활성화됨 (예: quiet 레짐에서 TurtleBreakout 활성화)
2. StrategyRouter의 `_running` 상태와 BotService `_running` 상태가 불일치할 수 있음
3. Grace period 상태가 resume 후 무시됨

**수정**: `resume()`에서 StrategyRouter가 존재하면 `strategyRouter.refresh()`를 호출하여 레짐 기반 라우팅을 재실행.

---

#### H-3: OrphanOrderCleanup `setInterval` — `unref()` 미사용

**파일**: `backend/src/services/orphanOrderCleanup.js:80`

```javascript
this._interval = setInterval(async () => {
  try { await this.cleanup(this._category); }
  catch (err) { log.error('periodic cleanup — failed', { error: err }); }
}, this._cleanupIntervalMs);
```

**문제**: `setInterval`에 `.unref()`가 없다. 이 타이머가 프로세스 종료를 **차단**할 수 있다. 다른 서비스(fundingDataService, rateLimiter, strategyRouter)는 `unref()` 패턴을 준수하고 있으나, OrphanOrderCleanup은 예외.

또한 `start()` 메서드가 `app.js bootstrap()`에서 호출되지 않고 있다. OrphanOrderCleanup은 생성만 되고 `start()`는 호출되지 않아 실제로 실행되지 않고 있다 (dead code).

**수정**:
1. `setInterval` 후 `.unref()` 추가
2. `app.js`의 `botService.start()` 내에서 OrphanOrderCleanup을 시작하거나, BotService DI에 추가

---

#### H-4: TickerAggregator `_recalcTimer` — `unref()` 미사용

**파일**: `backend/src/services/tickerAggregator.js:119`

```javascript
this._recalcTimer = setTimeout(() => {
  this._recalcTimer = null;
  this._lastRecalcTs = Date.now();
  this._doRecalculate();
}, delay);
// unref() 없음
```

**문제**: TickerAggregator의 debounce setTimeout에 `.unref()` 미사용. graceful shutdown 시 `stop()`에서 `clearTimeout()`은 하지만, `stop()` 호출 전에 shutdown이 시작되면 이 타이머가 프로세스 종료를 지연시킬 수 있다.

**수정**: `setTimeout` 후 `if (this._recalcTimer.unref) this._recalcTimer.unref();` 추가.

---

#### H-5: TournamentRoutes — 내부 프로퍼티 직접 접근

**파일**: `backend/src/api/tournamentRoutes.js:39, 154`

```javascript
// 라우트 핸들러에서 private 프로퍼티 직접 접근
paperAccountManager._initialBalance = initialBalance;  // line 39
const account = paperAccountManager._accounts.get(name); // line 154
```

**문제**:
- API 라우트에서 서비스의 `_` prefixed private 프로퍼티를 직접 수정/접근
- 캡슐화 위반: PaperAccountManager 내부 구조 변경 시 라우트도 동시 수정 필요
- `_initialBalance` 직접 수정은 검증 로직 우회 (음수, 0 등 설정 가능)
- `_accounts.get(name)` 접근은 Map 내부 구현에 종속

**수정**: PaperAccountManager에 `setInitialBalance(val)`, `getStrategyAccount(name)` public 메서드 추가.

---

#### H-6: `getStatus()` 내 `s.getSignal()` — 추상 메서드 호출로 throw 가능

**파일**: `backend/src/services/botService.js:791`

```javascript
strategies: this.strategies.map((s) => ({
  name: s.name,
  active: s.isActive(),
  symbol: s._symbol,
  config: s.getConfig(),
  lastSignal: s.getSignal(),  // ← strategyBase.getSignal()은 abstract → throw
  targetRegimes: s.getTargetRegimes(),
})),
```

**문제**: `strategyBase.js:94-98`에서 `getSignal()`은 throw를 하는 추상 메서드:
```javascript
getSignal() {
  throw new Error(`${this.name}: getSignal() is abstract...`);
}
```
대부분의 전략이 이를 override하지만, override가 누락된 전략이 있으면 `GET /api/bot/status`가 500 에러를 반환한다. status 엔드포인트는 진단용이므로 절대 실패해서는 안 된다.

**수정**: `getStatus()` 내에서 `s.getSignal()` 호출을 `try-catch`로 감싸고 실패 시 `null` 반환.

---

### MEDIUM (2주 내 수정)

#### M-1: `_resolveSignalQuantity` — 하드코딩된 lot step `'0.0001'`

**파일**: `backend/src/services/botService.js:1176`

```javascript
qty = math.floorToStep(qty, '0.0001'); // Phase 2 will use per-symbol lot info
```

**문제**: 모든 심볼에 동일한 lot step 0.0001 적용. 실제 Bitget에서:
- BTCUSDT: lot step = 0.001
- DOGEUSDT: lot step = 1
- SHIBUSDT: lot step = 100

잘못된 lot step으로 주문하면 거래소에서 reject 된다. 이는 deferred T3-10 (InstrumentCache)과 직결되며, 실거래에서 반드시 수정 필요.

---

#### M-2: `apiKeyAuth` — Paper 모드에서 인증 무조건 비활성화

**파일**: `backend/src/middleware/apiKeyAuth.js:16-21`

```javascript
if (!API_KEY) {
  if (process.env.PAPER_TRADING !== 'true') {
    log.error('API_KEY is required in live trading mode.');
  }
  log.warn('API_KEY not configured — authentication is DISABLED');
  return (_req, _res, next) => next();
}
```

**문제**: `API_KEY` 환경변수가 비어있으면 인증이 완전히 비활성화된다. Paper 모드에서도 외부 접근이 가능하면 공격자가:
1. `POST /api/bot/trading-mode` → live 모드로 전환
2. `POST /api/bot/start` → 실거래 시작

Paper 모드에서도 API 인증을 강제하거나, 최소한 trading-mode 전환 API에는 별도 보호가 필요하다.

**수정**: Paper 모드에서도 API_KEY 미설정 시 `POST /api/bot/trading-mode`에 대해 경고 또는 차단.

---

#### M-3: StateRecovery / OrphanOrderCleanup — BotService에서 미활용

**파일**: `backend/src/app.js:157-163`, `backend/src/services/botService.js`

```javascript
// app.js에서 생성
const stateRecovery = new StateRecovery({ exchangeClient, orderManager });
const orphanOrderCleanup = new OrphanOrderCleanup({ exchangeClient });
```

**문제**:
- `StateRecovery`는 생성만 되고 `recover()`가 어디에서도 호출되지 않음
- `OrphanOrderCleanup`은 생성만 되고 `start()`가 호출되지 않음
- BotService DI에도 주입되지 않음
- 크래시 복구와 고아 주문 정리가 실질적으로 **비활성 상태**

**수정**: BotService `start()`에서:
1. `stateRecovery.recover()` 호출 (WS 연결 후, 전략 활성화 전)
2. `orphanOrderCleanup.start()` 호출 (주기적 정리 시작)
3. `stop()`에서 `orphanOrderCleanup.stop()` 호출

---

#### M-4: `tradeRoutes.js` — `parseFloat` 직접 사용

**파일**: `backend/src/api/tradeRoutes.js` (strategy-stats endpoint)

```javascript
// 코드에서 parseFloat 직접 사용 (mathUtils 미사용)
const wins = closedTrades.filter((t) => parseFloat(t.pnl) > 0).length;
```

**문제**: CLAUDE.md 규약: "모든 금전적 값은 String 타입으로 처리. mathUtils로 산술 연산." `parseFloat` 직접 사용은 정밀도 한계(15자리)로 인해 큰 PnL 값에서 부정확한 결과를 만들 수 있다. 동일 패턴이 `tournamentRoutes.js:147`에도 존재.

**수정**: `parseFloat(t.pnl) > 0` → `math.isGreaterThan(t.pnl, '0')` 교체.

---

#### M-5: TickerAggregator `getTopMovers` — `parseFloat` 직접 사용

**파일**: `backend/src/services/tickerAggregator.js:303-304`

```javascript
tickers.sort((a, b) => {
  const absA = parseFloat(abs(a.change24h || '0'));
  const absB = parseFloat(abs(b.change24h || '0'));
  return absB - absA;
});
```

**문제**: mathUtils의 `abs()`를 호출한 결과를 다시 `parseFloat`로 변환. 비교 자체를 `isGreaterThan`으로 수행해야 함.

**수정**: mathUtils의 비교 함수 사용.

---

#### M-6: `express.json()` 바디 크기 제한 없음

**파일**: `backend/src/app.js:227`

```javascript
app.use(express.json());
```

**문제**: Express `json()` 미들웨어의 기본 `limit`은 `'100kb'`. 이는 합리적이나 명시적으로 설정되어 있지 않다. 백테스트 실행 요청은 설정 데이터를 포함할 수 있으므로, 의도적인 제한값을 명시하는 것이 좋다.

**수정**: `app.use(express.json({ limit: '1mb' }))` 명시적 설정.

---

#### M-7: BotSession stats — 업데이트 안 됨

**파일**: `backend/src/models/BotSession.js`, `backend/src/services/botService.js`

```javascript
const statsSubSchema = new mongoose.Schema({
  totalTrades: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  totalPnl: { type: String, default: '0' },
  maxDrawdown: { type: String, default: '0' },
  peakEquity: { type: String, default: '0' },
});
```

**문제**: BotSession에 `stats` 서브도큐먼트가 정의되어 있으나, BotService 어디에서도 이 stats를 **실시간 업데이트하지 않음**. `stop()` 시에도 stats 없이 저장. 결과적으로 analytics 페이지에서 세션별 통계가 항상 0으로 표시됨.

**수정**:
- OrderManager `ORDER_FILLED` 이벤트에서 session stats 증분 업데이트
- `stop()` 시 최종 stats 저장
- 또는 TrackerService가 세션 stats를 별도 산출 (현재 그렇게 동작하는지 확인 필요)

---

#### M-8: Snapshot 생성 로직 미구현

**파일**: `backend/src/models/Snapshot.js`

```javascript
// 모델만 존재, 생성 로직 없음
const Snapshot = mongoose.model('Snapshot', snapshotSchema);
```

**문제**: Snapshot 모델은 정의되어 있지만, 주기적으로 Snapshot을 **생성하는 코드가 어디에도 없음**. 이는 equity curve 기능이 실거래에서 작동하지 않는다는 것을 의미:
- `analyticsRoutes.js` `/equity-curve/:sessionId`가 빈 결과 반환
- `trackerService.getEquityCurve()`가 Snapshot을 조회하지만 데이터 없음

**수정**: BotService `start()` 후 주기적 (30초~1분) Snapshot 생성 타이머 추가. `stop()` 시 타이머 정리.

---

## 제안 사항

| ID | 이슈 | 우선순위 | 구현 난이도 | 예상 시간 | Tier |
|----|------|---------|-----------|----------|------|
| R8-C1 | Module-level Router → 팩토리 내부 이동 (8개 파일) | CRITICAL | 낮음 | 30분 | T0 |
| R8-C2 | BacktestStore LRU 제한 (MAX_STORED=50) | CRITICAL | 중간 | 45분 | T0 |
| R8-H1 | `_lastTickerEmit` Map cleanup | HIGH | 낮음 | 15분 | T1 |
| R8-H2 | `resume()` StrategyRouter 연동 | HIGH | 중간 | 30분 | T1 |
| R8-H3 | OrphanOrderCleanup `unref()` + 활성화 | HIGH | 낮음 | 20분 | T1 |
| R8-H4 | TickerAggregator timer `unref()` | HIGH | 낮음 | 5분 | T1 |
| R8-H5 | TournamentRoutes 캡슐화 위반 수정 | HIGH | 중간 | 30분 | T1 |
| R8-H6 | `getStatus()` getSignal() try-catch | HIGH | 낮음 | 10분 | T1 |
| R8-M1 | lot step 하드코딩 제거 → InstrumentCache 연동 | MEDIUM | 높음 | 2시간 | T2 |
| R8-M2 | Paper 모드 trading-mode 전환 보호 | MEDIUM | 중간 | 30분 | T2 |
| R8-M3 | StateRecovery + OrphanOrderCleanup 활성화 | MEDIUM | 중간 | 45분 | T2 |
| R8-M4 | parseFloat 직접 사용 제거 (3곳) | MEDIUM | 낮음 | 15분 | T2 |
| R8-M5 | getTopMovers parseFloat → mathUtils | MEDIUM | 낮음 | 10분 | T2 |
| R8-M6 | express.json() limit 명시 | MEDIUM | 낮음 | 5분 | T2 |
| R8-M7 | BotSession stats 업데이트 구현 | MEDIUM | 높음 | 1.5시간 | T2 |
| R8-M8 | Snapshot 주기적 생성 구현 | MEDIUM | 높음 | 1.5시간 | T2 |

---

## Deferred 항목 재평가

### T3-4: decimal.js 마이그레이션 (mathUtils 교체) — R1 deferred

**현재 판단: 유지 (deferred)**

- mathUtils는 내부적으로 `parseFloat`을 사용하지만, 암호화폐 거래에서 다루는 금액 범위(0.0001 ~ 999999)는 IEEE 754 double의 유효 범위 내
- 실거래에서 정밀도 문제가 발생하려면 10^15 이상의 값이 필요
- decimal.js 도입은 모든 서비스 파일 수정이 필요하여 영향 범위가 매우 크다
- **판정: 실거래 운영 후 정밀도 이슈 보고 시 도입. 현재는 불필요.**

### T3-9: Socket.io CORS + 인증 — R6 deferred

**현재 판단: 실거래 전 필수 (deferred → T1 승격)**

- Socket.io `cors: { origin: '*' }`는 운영 환경에서 위험
- 인증된 사용자만 실시간 데이터를 수신해야 함 (equity, position 정보 포함)
- `apiKeyAuth`가 HTTP에만 적용되고 WS에는 적용 안 됨
- **제안**: Socket.io `connection` 이벤트에서 auth token 검증 + CORS_ORIGIN 환경변수 반영

### T3-10: InstrumentCache 심볼별 lot step — R6 deferred

**현재 판단: 실거래 전 필수 (deferred → T1 승격)**

- R8-M1에서 재확인: `floorToStep(qty, '0.0001')` 하드코딩은 대부분의 심볼에서 주문 reject를 유발
- Bitget REST `/api/v2/mix/market/contracts` 에서 심볼별 `sizeMultiplier`, `minTradeNum` 조회 가능
- 캐시 TTL 24시간이면 충분 (계약 스펙은 자주 변하지 않음)
- **제안**: R8에서 R8-M1로 통합 구현

### T3-15: positionSide 전체 리팩토링 (13개 전략) — R6 deferred

**현재 판단: 유지 (deferred)**

- R6에서 파일럿 2전략(T2-18)으로 검증 완료
- 나머지 13개 전략 리팩토링은 기능적 변화 없이 코드 정리 수준
- 실거래에 직접 영향 없음
- **판정: 실거래 안정화 후 코드 품질 개선 라운드에서 진행.**

---

## 다른 에이전트에게 요청 사항

### Trader에게

1. **R8-M1 (lot step)**: 심볼별 lot step/min trade qty 정보가 전략 시그널 생성 시점에도 필요한지 확인. 현재는 BotService `_resolveSignalQuantity`에서만 사용하지만, 전략 내부에서도 qty를 계산하는 경우가 있는지 검토 요청.

2. **R8-M7 (BotSession stats)**: TrackerService가 세션별 통계를 별도 산출하는지, 아니면 BotSession.stats가 유일한 통계 소스인지 확인. PerformanceTracker와의 역할 분담 명확화 필요.

3. **R8-M8 (Snapshot)**: 백테스트에서는 equityCurve가 생성되지만, 실거래에서는 Snapshot이 없어 equity curve가 빈 상태. Snapshot 생성 주기(30초 vs 1분 vs 5분)에 대한 Trader 관점의 의견 요청.

### UI에게

1. **R8-C1 (Router 수정)**: 라우트 팩토리 수정 시 API 응답 형식이 변경되지는 않으므로 FE 영향 없음. 확인 요청.

2. **R8-H6 (getStatus)**: 현재 `GET /api/bot/status`에서 `lastSignal` 필드가 사용되는 FE 컴포넌트가 있는지 확인. 에러 시 `null`로 fallback하면 FE에서 어떻게 처리되는지 검토 요청.

3. **T3-9 (Socket.io 인증)**: Socket.io 인증 추가 시 FE socket 연결 코드에서 auth token을 함께 전송해야 함. 현재 `useSocket` 훅이 인증 토큰을 지원하는지 확인 필요. FE 동시 수정 범위 추정 요청.
