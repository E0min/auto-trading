# Round 12 Engineer Proposal — 코드베이스 재분석 Round 3

> 작성일: 2026-02-17
> 작성자: Senior Systems Engineer
> 분석 범위: backend/src 전체 (30+ 파일 정밀 분석)
> 모드: 자유 발굴 (R1-R11 완료 항목 제외)

---

## 분석 요약

R1-R11을 거치며 핵심 안전성(T0), 안정성(T1), 품질(T2) 항목은 대부분 해결되었다. 이번 Round 3 분석에서는 **운영 안정성, 리소스 관리, 에러 복원력, 관측성 사각지대, 동시성 위험** 5개 축으로 재분석했다.

총 **16건** 신규 발견 사항:
- CRITICAL (T0): 2건
- HIGH (T1): 6건
- MEDIUM (T2): 5건
- LOW (T3): 3건

핵심 테마:
1. **메모리 누수 경로** — MarketDataCache, CoinSelector._prevVol24h, TickerAggregator._tickers가 무한 성장 가능
2. **동시성 레이스** — CoinSelector.selectCoins() 재진입, BotService._performCoinReselection() 중첩 실행
3. **장애 전파 차단 부재** — exchangeClient 단일 장애점에서 cascading failure 가능
4. **관측성 사각지대** — 주문 지연 시간, WS 연결 상태, 메모리 트렌드 미추적

---

## 발견 사항

### E12-1 [CRITICAL] MarketDataCache 만료 항목 미정리 — 무한 메모리 성장

**파일**: `backend/src/utils/marketDataCache.js`
**코드 근거** (line 23-30):
```js
get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.data;
}
```

만료된 항목은 `get()` 호출 시에만 삭제된다. `CoinSelector._enrichSymbol()`에서 `set()` 후 해당 key를 다시 `get()`하지 않으면 영원히 Map에 남는다. CoinSelector가 4시간마다 코인 재선정을 실행하고, 후보 심볼이 변경되면 이전 심볼의 캐시 항목은 절대 삭제되지 않는다.

**영향**: 장기 운영 시 수천 개의 만료 캐시 항목이 누적. OI/funding 데이터 객체가 각각 포함되므로 누적량이 의미 있다.

**제안**: 주기적 sweep 타이머를 MarketDataCache에 추가. 60초 간격으로 만료 항목 일괄 삭제. `stop()` 메서드를 추가하여 shutdown 시 타이머 정리.

---

### E12-2 [CRITICAL] CoinSelector.selectCoins() 재진입 — 동시 호출 시 _prevVol24h 손상

**파일**: `backend/src/services/coinSelector.js`
**코드 근거** (line 201-424):

`selectCoins()`는 async 함수이며 `await runWithConcurrency(enrichmentTasks, concurrency)`에서 외부 API를 호출한다. BotService의 코인 재선정(`_performCoinReselection()`)이 4시간 간격과 레짐 변경 시 모두 호출될 수 있다. 레짐 변경과 4시간 타이머가 동시에 발생하면 `selectCoins()`가 동시에 2번 실행된다.

두 호출이 동시에 실행되면:
1. 두 호출 모두 `_prevVol24h`를 읽고 (line 343)
2. 두 호출 모두 `_prevVol24h`를 쓴다 (line 401-403)
3. 결과적으로 volume momentum 계산이 부정확해짐

**영향**: 코인 선정 점수가 부정확해져 부적절한 심볼이 선정될 수 있다.

**제안**: selectCoins()에 mutex 또는 진입 가드 추가. `this._selecting` 플래그를 사용하여 중복 호출 차단.

---

### E12-3 [HIGH] TickerAggregator._tickers Map 무한 성장

**파일**: `backend/src/services/tickerAggregator.js`
**코드 근거** (line 108):
```js
this._tickers.set(data.symbol, data);
```

한번 추가된 심볼은 `stop()`이 호출되기 전까지 절대 제거되지 않는다. Bitget에서 상장 폐지되거나 이름이 변경된 심볼의 티커 데이터가 영원히 남는다. 또한 `_recalculate()`에서 매번 `Array.from(this._tickers.values())` (line 148)로 전체 배열을 생성하여 성능 부담이 증가한다.

**영향**: 장기 운영 시 Map 크기가 500+ 심볼까지 증가. 2초마다 전체 배열 생성. GC 압력 증가.

**제안**:
1. 마지막 업데이트로부터 N분(예: 30분) 경과한 심볼을 제거하는 주기적 정리
2. 또는 CoinSelector에서 선정된 심볼만 캐시하도록 범위 축소

---

### E12-4 [HIGH] BotService._performCoinReselection() 중첩 실행 방지 없음

**파일**: `backend/src/services/botService.js`
**코드 근거**: `_performCoinReselection()` 메서드

4시간 간격 타이머(`_coinReselectionTimer`)와 레짐 변경 이벤트 핸들러(`_handleRegimeChange`) 모두 이 메서드를 호출한다. async 함수이므로 첫 호출이 완료되기 전에 두 번째 호출이 진입할 수 있다.

내부에서 `coinSelector.selectCoins()` (네트워크 I/O), `_reAssignSymbols()`, `marketData.setSymbols()` 등을 순차 실행하는데, 중첩 실행 시 심볼 할당이 불일치하거나 WS 구독이 꼬일 수 있다.

**영향**: 레짐 변경과 4시간 타이머가 겹치면 전략-심볼 매핑이 불일치할 수 있다.

**제안**: `_isReselecting` 플래그 추가. 이미 실행 중이면 건너뛰고, 완료 후 재시도 필요 여부를 체크.

---

### E12-5 [HIGH] ExchangeClient._withRetry() — 무한 재시도 가능성

**파일**: `backend/src/services/exchangeClient.js`
**코드 근거**: `_withRetry()` 메서드

retry 횟수가 설정값(기본 3)으로 제한되지만, `rate_limit` 에러에 대해서도 동일한 backoff로 재시도한다. Bitget rate limit은 IP 기반이며, 429 응답 시 대기 시간이 명시되지 않으면 지수 backoff가 rate limit 해소와 무관하게 진행된다.

더 중요한 것은 `getKlines()`, `getTickers()` 등 bulk 호출이 재시도될 때 backoff 기간 동안 다른 API 호출도 차단되는 것은 아니므로, 동시에 여러 재시도가 rate limit을 악화시킬 수 있다.

**영향**: rate limit 상황에서 재시도가 오히려 상황을 악화시키는 "thundering herd" 패턴.

**제안**:
1. `rate_limit` 에러 시 Retry-After 헤더를 파싱하여 정확한 대기 시간 적용
2. 전역 rate limit 쿨다운 (모든 API 호출 일시 차단) 메커니즘 추가

---

### E12-6 [HIGH] RateLimiter timestamps 배열 — shift() 성능 문제

**파일**: `backend/src/middleware/rateLimiter.js`
**코드 근거** (line 80-83):
```js
while (entry.timestamps.length > 0 && entry.timestamps[0] <= cutoff) {
  entry.timestamps.shift();
}
```

`Array.shift()`는 O(n) 연산이다. 높은 트래픽에서 timestamps 배열이 클 경우 매 요청마다 O(n) 비용이 발생한다. 또한 모든 limiter 인스턴스(critical, standard, heavy)가 **동일한 전역 `_store` Map**을 공유한다 (line 16). keyPrefix로 구분하지만, cleanup 타이머도 전역 하나뿐이다.

**영향**: 높은 RPS에서 CPU spike. 실제 위험도는 낮으나 (현재 단일 클라이언트), 향후 다중 클라이언트 시 문제.

**제안**: timestamps를 circular buffer로 교체하거나, 고정 크기 window counter 알고리즘으로 전환.

---

### E12-7 [HIGH] OrderManager — WS fill 이벤트 누락 시 포지션 불일치

**파일**: `backend/src/services/orderManager.js`
**코드 근거**: `_handleWsFillUpdate()`, `_handleWsOrderUpdate()`

WS 연결이 일시적으로 끊겼다가 재연결되면, 그 사이에 발생한 fill/order 이벤트가 누락된다. OrderManager는 이를 감지하거나 보상하는 로직이 없다. PositionManager의 30초 REST 동기화가 포지션 자체는 보상하지만, Trade DB 레코드와 Signal 상태는 갱신되지 않는다.

참고: R11-D6(WS 재연결 후 재구독)이 deferred 상태이나, 이는 구독 자체의 문제이고 여기서 지적하는 것은 **fill 이벤트 누락에 대한 Trade DB 보상** 문제이다.

**영향**: WS 재연결 사이에 체결된 주문이 Trade DB에 미반영되어 analytics 부정확.

**제안**: WS 재연결 시 최근 N초(예: 60초) 간의 주문 이력을 REST로 조회하여 누락 fill을 보상하는 reconciliation 로직 추가.

---

### E12-8 [HIGH] PaperEngine — 미결 limit 주문의 mark price 기반 체결 미지원

**파일**: `backend/src/services/paperEngine.js`
**코드 근거**: `_checkPendingOrders()` 메서드

현재 limit 주문 체결은 `ticker.lastPrice`만 사용한다. 실제 거래소에서는 mark price와 last price의 차이가 존재하며, 특히 급변 시장에서 last price가 일시적으로 mark price를 크게 이탈할 수 있다. SL/TP 트리거도 `_checkPendingOrders()`의 `_shouldTriggerSLTP()`에서 `currentPrice` (lastPrice 기반)만 사용한다.

**영향**: 백테스트와 페이퍼 트레이딩 간 체결 결과 차이. 실거래 전환 시 예상치 못한 동작.

**제안**: TP/SL 트리거에 mark price를 참조하는 옵션 추가. PositionManager의 mark price 데이터를 PaperEngine에 전달.

---

### E12-9 [MEDIUM] BotService.start() — 17단계 중 중간 실패 시 부분 시작 상태

**파일**: `backend/src/services/botService.js`
**코드 근거**: `start()` 메서드

start()가 17단계로 구성되어 있고, 각 단계에서 실패 시 `catch` 블록에서 `this._state = BOT_STATES.IDLE`로 설정하고 에러를 throw한다. 그러나 10단계에서 실패하면 1-9단계에서 시작된 서비스들(marketData, positionManager, tickerAggregator 등)이 정리되지 않는다.

참고: R11-D8(Bootstrap 중간 실패 복구)이 deferred이나, 이는 app.js의 bootstrap() 함수에 대한 것이다. 여기서 지적하는 것은 **BotService.start()** 내부의 서비스 정리 문제이다.

**영향**: start() 실패 후 재시도 시 이전에 시작된 서비스가 이중으로 시작되거나 리소스가 누수.

**제안**: start()에 rollback 로직 추가. 실패 시 이미 시작된 서비스들을 역순으로 stop() 호출.

---

### E12-10 [MEDIUM] PositionManager._parsePositionEntry() — marginMode 항상 'crossed'

**파일**: `backend/src/services/positionManager.js`
**코드 근거** (line 439):
```js
marginMode: raw.marginMode || raw.marginCoin ? 'crossed' : 'crossed',
```

삼항 연산자의 양쪽 모두 `'crossed'`이므로 marginMode는 항상 'crossed'가 된다. 이는 의미 없는 코드이다. Bitget UTA 모드에서는 crossed가 기본이지만, isolated margin 포지션이 존재할 경우 이를 구분하지 못한다.

**영향**: isolated margin 포지션의 마진 모드가 잘못 표시. 현재 UTA 모드만 사용하므로 실질적 영향은 낮으나, 코드 정확성 문제.

**제안**: `marginMode: raw.marginMode || 'crossed'`로 수정. raw.marginMode가 있으면 그대로 사용, 없으면 기본값 'crossed'.

---

### E12-11 [MEDIUM] BacktestEngine — equityCurve 배열 크기 무제한

**파일**: `backend/src/backtest/backtestEngine.js`
**코드 근거** (line 906-914):
```js
_recordEquitySnapshot(kline) {
    const equity = this._calculateEquity(kline);
    this._equityCurve.push({
      ts: kline.ts,
      equity,
      cash: this._cash,
    });
}
```

매 kline마다 equity snapshot을 push한다. 1년치 1분봉 백테스트는 약 525,600개의 snapshot이 생성된다. BacktestStore에 최대 50건이 저장되므로, 동시에 여러 백테스트를 실행하면 메모리 사용량이 급증한다.

**영향**: 장기간 + 짧은 간격 백테스트 시 수백 MB 메모리 사용. BacktestStore의 50건 제한과 합쳐지면 최악의 경우 GB 단위.

**제안**:
1. BacktestEngine에서 N개 간격으로 샘플링 (예: max 5000 포인트)
2. 또는 BacktestStore 저장 시 downsample 적용 (현재는 GET API에서만 downsample)

---

### E12-12 [MEDIUM] HealthCheck — WebSocket 상태 검사 깊이 부족

**파일**: `backend/src/services/healthCheck.js`

현재 healthCheck는 MongoDB ping, REST API 도달 가능성, 메모리 사용량만 검사한다. WebSocket 연결 상태(public/private), 마지막 메시지 수신 시간, 구독 심볼 수, 메시지 처리 지연 등은 검사하지 않는다.

WS 연결이 살아있지만 데이터가 오지 않는 "좀비 연결" 상태를 감지할 수 없다.

**영향**: WS 데이터 중단 시 봇이 stale 데이터로 매매를 계속함.

**제안**: ExchangeClient에 `getWsStatus()` 메서드 추가 (연결 상태, 마지막 메시지 시간, 구독 토픽 수). HealthCheck에서 이를 참조하여 마지막 메시지가 N초(예: 60초) 전이면 warning, N분이면 error.

---

### E12-13 [MEDIUM] Logger — 대용량 객체 직렬화로 인한 I/O 부담

**파일**: `backend/src/utils/logger.js`

`log.info()`, `log.trade()` 등에 전달되는 context 객체가 JSON.stringify()를 통해 직렬화된다. BotService의 `_handleStrategySignal()`이나 OrderManager의 `_handleWsFillUpdate()`에서 전체 signal/order 객체를 로깅하면 한 줄당 수 KB가 될 수 있다.

또한 DEBUG 레벨에서 매 kline, 매 ticker에 대한 로그가 생성되면 초당 수백 줄의 stdout/stderr 출력이 발생한다.

**영향**: DEBUG 모드에서 I/O 병목. 프로덕션에서는 LOG_LEVEL=INFO로 완화되지만, 트러블슈팅 시 DEBUG 활성화하면 성능 저하.

**제안**:
1. 로그 context 객체의 크기 제한 (maxContextSize 설정, 초과 시 truncate)
2. DEBUG 레벨에 샘플링 옵션 추가 (매 N번째만 로깅)

---

### E12-14 [LOW] BacktestRoutes POST /run — 동시 실행 수 제한 없음

**파일**: `backend/src/api/backtestRoutes.js`
**코드 근거** (line 95):
```js
setImmediate(async () => {
```

POST /run은 ID를 즉시 반환하고 백테스트를 비동기 실행한다. 동시 실행 수에 제한이 없으므로, 프론트엔드에서 빠르게 여러 번 요청하면 CPU/메모리가 과부하된다. BacktestEngine.run()은 CPU-intensive 동기 루프(kline 순회)이므로 이벤트 루프를 블로킹한다.

**영향**: 동시 백테스트 5개 이상 시 API 응답 지연, 라이브 봇 영향 가능.

**제안**: 동시 실행 수 제한 (MAX_CONCURRENT_BACKTESTS = 2). 초과 시 큐잉 또는 거부.

---

### E12-15 [LOW] InstrumentCache — refresh() 실패 시 stale 데이터 무기한 사용

**파일**: `backend/src/services/instrumentCache.js`
**코드 근거** (line 101-107):
```js
} catch (err) {
      log.error('Instrument cache refresh failed', {
        category,
        error: err.message,
      });
      // Do not throw — cache retains stale data; callers fall back to defaults
}
```

24시간 auto-refresh가 연속 실패하면 초기 데이터가 무기한 사용된다. 거래소가 lot step이나 최소 수량을 변경했을 경우 잘못된 수량으로 주문이 나갈 수 있다.

**영향**: 장기 연속 실패 시 잘못된 lot step으로 주문 거부 발생 가능.

**제안**:
1. 연속 실패 횟수 추적. N회(예: 3회 = 72시간) 연속 실패 시 WARN 로그 + RiskEvent 발생
2. `_lastRefresh` 기반 staleness 경고: 48시간 이상 미갱신 시 healthCheck에 반영

---

### E12-16 [LOW] CoinSelector._prevVol24h — 무한 성장

**파일**: `backend/src/services/coinSelector.js`
**코드 근거** (line 401-403):
```js
for (const c of candidates) {
  this._prevVol24h.set(c.symbol, c.vol24h);
}
```

candidates 목록에 포함되었던 모든 심볼의 이전 거래량이 누적된다. 상장 폐지된 심볼이나 한번 후보였다가 제외된 심볼의 데이터가 영원히 남는다.

**영향**: 메모리 누수는 미미하지만(심볼당 문자열 하나), 원칙적으로 cleanup이 필요.

**제안**: `selectCoins()` 시작 시 `_prevVol24h`에서 현재 candidates에 없는 키를 삭제. 또는 Map 크기가 500을 초과하면 가장 오래된 항목 삭제.

---

## 제안 사항

| ID | 제목 | 우선순위 | 구현 난이도 | 예상 시간 | 담당 |
|----|------|----------|------------|----------|------|
| E12-1 | MarketDataCache sweep 타이머 추가 | T0 | 낮음 | 30분 | Backend |
| E12-2 | CoinSelector selectCoins() 재진입 가드 | T0 | 낮음 | 20분 | Backend |
| E12-3 | TickerAggregator stale 심볼 정리 | T1 | 낮음 | 30분 | Backend |
| E12-4 | BotService 코인 재선정 중첩 실행 방지 | T1 | 낮음 | 20분 | Backend |
| E12-5 | ExchangeClient rate limit 대응 강화 | T1 | 중간 | 1시간 | Backend |
| E12-6 | RateLimiter shift() 성능 최적화 | T2 | 중간 | 45분 | Backend |
| E12-7 | OrderManager WS 재연결 fill 보상 | T1 | 높음 | 2시간 | Backend |
| E12-8 | PaperEngine mark price 기반 SL/TP 트리거 | T1 | 중간 | 1시간 | Backend |
| E12-9 | BotService.start() 실패 시 rollback | T2 | 중간 | 1시간 | Backend |
| E12-10 | PositionManager marginMode 삼항 수정 | T1 | 낮음 | 5분 | Backend |
| E12-11 | BacktestEngine equityCurve 샘플링 | T2 | 낮음 | 30분 | Backtest |
| E12-12 | HealthCheck WS 상태 검사 추가 | T1 | 중간 | 1시간 | Backend |
| E12-13 | Logger context 크기 제한 | T2 | 낮음 | 30분 | Backend |
| E12-14 | BacktestRoutes 동시 실행 수 제한 | T2 | 낮음 | 30분 | Backend |
| E12-15 | InstrumentCache staleness 경고 | T2 | 낮음 | 30분 | Backend |
| E12-16 | CoinSelector _prevVol24h 정리 | T2 | 낮음 | 15분 | Backend |

### 총 예상 작업량: ~10시간 30분

### 트랙 배분 제안

**Track A (Backend Critical — T0+T1)**: E12-1, E12-2, E12-3, E12-4, E12-5, E12-7, E12-8, E12-10, E12-12
**Track B (Backtest)**: E12-11, E12-14
**Track C (Backend Quality — T2)**: E12-6, E12-9, E12-13, E12-15, E12-16

---

## 다른 에이전트에게 요청 사항

### Trader에게
1. **E12-5 (rate limit 대응)**: 실거래 시 Bitget API rate limit 경험이 있다면 공유 요청. 분당 몇 건까지 안전한지, 429 응답 시 권장 대기 시간이 있는지.
2. **E12-7 (WS fill 보상)**: WS 재연결 시 fill 누락으로 인한 포지션 불일치가 실거래에서 어느 정도 빈도로 발생하는지. REST 주문 이력 조회의 지연 시간(eventual consistency) 여부.
3. **E12-8 (mark price SL/TP)**: 실거래에서 last price vs mark price 차이가 SL/TP 트리거에 의미있는 영향을 미치는지 의견 요청.

### UI/UX에게
1. **E12-12 (WS 상태 검사)**: HealthCheck에 WS 상태가 추가되면, 대시보드에 WebSocket 연결 상태 표시 컴포넌트 추가 검토 요청. 현재 "연결 상태"가 REST 기반만 표시.
2. **E12-14 (백테스트 동시 실행 제한)**: 프론트엔드에서 백테스트 실행 중 추가 실행을 비활성화하는 UX 처리 검토 요청. 현재는 동시 실행이 가능한 UI.
3. **E12-11 (equity curve 샘플링)**: 현재 API에서 downsample하고 있으나, 엔진 레벨에서도 제한하면 프론트엔드에 영향이 있는지 확인 요청. 특히 equity curve의 정밀도 요구사항.
