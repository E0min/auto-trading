# Round 1 -- 시스템 엔지니어 제안서

> 분석 대상: `backend/src/` 전체 (34개 서비스, 6개 API 라우트, 4개 유틸리티, 4개 모델)
> 분석 기준: 프로덕션 환경에서 실제 자금을 다루는 자동매매 시스템의 안정성, 무결성, 보안

---

## 1. CRITICAL Issues (프로덕션 장애 위험)

### C-1. 미등록 unhandledRejection / uncaughtException 핸들러
- **파일**: `backend/src/app.js`
- **문제**: `process.on('SIGTERM')`, `process.on('SIGINT')`만 등록되어 있고, `process.on('unhandledRejection')`, `process.on('uncaughtException')` 핸들러가 없음.
- **영향**: 프로미스 체인 어딘가에서 catch 되지 않은 rejection이 발생하면 Node.js 18+에서는 프로세스가 즉시 종료됨 (--unhandled-rejections=throw가 기본값). 열린 포지션이 있는 상태에서 프로세스가 갑자기 죽으면 정리 작업 없이 포지션이 방치됨.
- **제안**:
```javascript
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection', { reason, promise });
  // 긴급 정지 후 graceful shutdown
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception', { error: err });
  gracefulShutdown('uncaughtException');
});
```

### C-2. 동시 주문 제출 시 레이스 컨디션 (Double-Spend Risk)
- **파일**: `backend/src/services/orderManager.js:167-434`
- **문제**: `submitOrder()`가 async이지만 동시성 제어가 없음. 동일 symbol에 대해 두 전략이 동시에 signal을 emit하면:
  1. 두 호출 모두 `riskEngine.validateOrder()` 통과 (동일 시점 accountState 기준)
  2. 두 호출 모두 거래소에 주문 제출
  3. ExposureGuard가 이미 제출된 첫 번째 주문의 노출을 인지하지 못하는 시점에 두 번째 주문이 통과
- **영향**: 의도한 최대 노출 한도를 초과하는 포지션이 열릴 수 있음. 실제 자금 손실 위험.
- **제안**: Symbol별 또는 전체 주문 파이프라인에 mutual exclusion (세마포어/뮤텍스) 적용:
```javascript
// per-symbol lock
this._orderLocks = new Map();

async submitOrder(signal) {
  const lockKey = signal.symbol;
  if (this._orderLocks.get(lockKey)) {
    log.warn('Order submission in progress for symbol', { symbol: lockKey });
    return null;
  }
  this._orderLocks.set(lockKey, true);
  try {
    // ... existing logic
  } finally {
    this._orderLocks.delete(lockKey);
  }
}
```

### C-3. ExposureGuard equity=0 시 Division by Zero
- **파일**: `backend/src/services/exposureGuard.js:107-109`
- **문제**: `positionSizePercent = multiply(divide(orderValue, equity), '100')` -- equity가 '0'이면 `mathUtils.divide`가 'division by zero' 에러를 throw함. 이 에러가 `riskEngine.validateOrder()`를 통해 위로 전파되어 주문이 실패하는데, 봇 시작 직후 (accountState 동기화 전) equity가 '0'인 상태에서 전략이 signal을 emit하면 발생 가능.
- **영향**: 전략 signal이 에러로 처리되어 주문이 제출되지 않음. 에러 핸들링은 존재하지만 (`orderManager.js:196-225`), 실질적으로 봇 시작 후 몇 초간 모든 주문이 거부됨.
- **제안**: ExposureGuard에서 equity가 0 또는 매우 작은 경우 조기 반환:
```javascript
if (isLessThan(equity, '1') || equity === '0') {
  return { approved: false, reason: 'insufficient_equity' };
}
```

### C-4. Graceful Shutdown에서 WebSocket 종료가 HTTP 서버 종료보다 늦음
- **파일**: `backend/src/app.js:386-424`
- **문제**: 현재 종료 순서:
  1. `botService.stop()` -- 전략 비활성화, 이벤트 정리
  2. `server.close()` -- HTTP 서버 종료
  3. `io.close()` -- Socket.io 종료
  4. `mongoose.disconnect()` -- DB 연결 종료
- **문제점**: `botService.stop()` 내부에서 `exchangeClient.closeWebsockets()`를 호출하는데 (`botService.js:498-502`), WS가 닫히면 비동기 주문 업데이트(ORDER_FILLED 등)가 누락될 수 있음. 또한, `server.close()`는 콜백 기반이지만 Promise로 대기하지 않아, DB disconnect가 서버 종료 전에 실행될 수 있음.
- **영향**: 마지막으로 체결된 주문의 DB 반영이 누락되어 데이터 불일치 발생.
- **제안**:
```javascript
const gracefulShutdown = async (signal) => {
  log.info(`Received ${signal}`);

  // 1. 봇 정지 (전략 비활성화, 포지션 동기화)
  await botService.stop('server_shutdown');

  // 2. 진행 중인 DB 쓰기 완료 대기 (짧은 딜레이)
  await new Promise(r => setTimeout(r, 2000));

  // 3. HTTP 서버 종료 (새 연결 거부)
  await new Promise(r => server.close(r));

  // 4. Socket.io 종료
  io.close();

  // 5. DB 연결 종료
  await mongoose.disconnect();

  // 6. 강제 종료 타이머 (10초 후)
  setTimeout(() => process.exit(1), 10000).unref();

  process.exit(0);
};
```

### C-5. mathUtils가 parseFloat 기반 -- 큰 수에서 정밀도 손실
- **파일**: `backend/src/utils/mathUtils.js:20-29`
- **문제**: `parse()` 함수가 내부적으로 `parseFloat()`를 사용함. JavaScript의 64비트 IEEE-754 부동소수점은 약 15-17자리까지만 정확함. BTC 가격이 $100,000 수준이고 8자리 소수점이면 총 14자리 -- 현재는 안전하지만, 대규모 notional 계산(가격 x 수량 x 수수료)에서 에지 케이스 존재.
- **영향**: 현재 규모에서는 대부분 안전하나, 누적 연산(수백 건의 거래 PnL 합산)에서 미세한 정밀도 차이 발생 가능.
- **제안**: 장기적으로 `decimal.js` 또는 `bignumber.js` 라이브러리로 교체. 단기적으로는 현재 구현이 실용적으로 충분하되, 큰 notional 연산에 대해 검증 테스트 필요.

---

## 2. HIGH-PRIORITY Improvements (안정성에 직접 영향)

### H-1. OrderManager의 WS 이벤트 리스너가 constructor에서 등록되나 destroy()가 호출되지 않음
- **파일**: `backend/src/services/orderManager.js:98-104, 1030-1034`
- **문제**: `OrderManager` constructor에서 `exchangeClient.on('ws:order')`, `exchangeClient.on('ws:fill')` 리스너를 등록하고, `destroy()` 메서드로 제거할 수 있게 되어 있으나, `botService.stop()`이나 `app.js`의 `gracefulShutdown()`에서 `orderManager.destroy()`를 호출하지 않음.
- **영향**: 이론상 GC가 참조 처리하지만, exchangeClient가 싱글턴이므로 리스너가 누적되지는 않음 (OrderManager도 1개 인스턴스). 그러나 명시적 정리가 없으면 봇 재시작 시 이전 리스너가 남아있을 위험.
- **제안**: `gracefulShutdown()`에서 `orderManager.destroy()`, `positionManager.destroy()` 호출 추가.

### H-2. PositionManager의 WS 이벤트 리스너도 동일한 문제
- **파일**: `backend/src/services/positionManager.js:77-83, 451-456`
- **문제**: H-1과 동일. constructor에서 리스너 등록, `destroy()` 존재하지만 호출되지 않음.

### H-3. PaperEngine 'paper:fill' 리스너 누적 위험
- **파일**: `backend/src/services/orderManager.js:126-132`
- **문제**: `setPaperMode()`가 호출될 때마다 `this._paperEngine.on('paper:fill', ...)` 새 리스너를 등록함. `setLiveMode()` (`orderManager.js:138-143`)에서 참조만 null로 만들 뿐 리스너를 제거하지 않음. paper <-> live 전환을 반복하면 리스너가 누적됨.
- **영향**: 메모리 누수 + 이전 PaperEngine 인스턴스의 fill 이벤트가 중복 처리될 수 있음.
- **제안**:
```javascript
setPaperMode(paperEngine, paperPositionManager) {
  // 이전 리스너 제거
  if (this._paperEngine && this._boundPaperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._boundPaperFillHandler);
  }

  this._paperMode = true;
  this._paperEngine = paperEngine;
  this._paperPositionManager = paperPositionManager;

  this._boundPaperFillHandler = (fill) => {
    this._handlePaperFill(fill).catch(err => log.error(...));
  };
  this._paperEngine.on('paper:fill', this._boundPaperFillHandler);
}

setLiveMode() {
  if (this._paperEngine && this._boundPaperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._boundPaperFillHandler);
  }
  this._paperMode = false;
  this._paperEngine = null;
  this._paperPositionManager = null;
  this._boundPaperFillHandler = null;
}
```

### H-4. CircuitBreaker의 rapidLosses 배열이 무한히 성장 가능
- **파일**: `backend/src/services/circuitBreaker.js:60`
- **문제**: `this.rapidLosses.push(Date.now())` -- 손실 거래마다 타임스탬프가 추가되지만, `check()` 내 `filter()`는 새 배열을 생성할 뿐 원본을 정리하지 않음. `reset()` 시에만 비워짐.
- **영향**: 장시간 운영 시 배열이 수천 개로 성장할 수 있음. 치명적이지는 않으나 불필요한 메모리 소비.
- **제안**: `recordTrade()`에서 window 밖의 항목을 정리:
```javascript
recordTrade(trade) {
  if (isLessThan(trade.pnl, '0')) {
    this.rapidLosses.push(Date.now());
    // 오래된 항목 정리
    const windowMs = this.params.rapidLossWindow * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    this.rapidLosses = this.rapidLosses.filter(ts => ts >= cutoff);
    // ...
  }
}
```

### H-5. SignalFilter의 _recentSignals 배열 -- O(n) 선형 스캔
- **파일**: `backend/src/services/signalFilter.js:188-190`
- **문제**: `_checkDuplicate()`가 `_recentSignals.some()`으로 전체 배열을 스캔함. `_cleanup()`은 `DUPLICATE_WINDOW_MS * 2 = 10초` 이상 된 항목만 제거하므로 고빈도 신호 환경에서 배열이 크게 성장 가능.
- **영향**: 18개 전략이 빈번하게 신호를 생성하면 선형 스캔이 성능 병목이 될 수 있음.
- **제안**: fingerprint 기반 Map으로 교체 (O(1) 검색):
```javascript
this._recentFingerprints = new Map(); // fingerprint -> timestamp
```

### H-6. StrategyRouter.updateSymbols()에서 전략을 deactivate 후 activate하면서 신호 손실 가능
- **파일**: `backend/src/services/strategyRouter.js:273-278`
- **문제**: `strategy.deactivate()` -> `strategy.activate()` 사이에 전략이 kline/ticker 이벤트를 놓칠 수 있음. deactivate가 내부 상태를 초기화한다면 (전략 구현에 따라 다름) 축적된 분석 데이터가 손실됨.
- **영향**: 코인 재선정 시 전략의 기술적 분석 버퍼가 리셋되어 잘못된 신호가 발생할 수 있음.
- **제안**: `deactivate()`를 호출하지 않고 symbol만 교체하는 soft-update 메서드 추가.

### H-7. BotService._createStrategies -- 기본 전략이 없는 경우
- **파일**: `backend/src/services/botService.js:896`
- **문제**: `const strategyNames = config.strategies || ['MomentumStrategy', 'MeanReversionStrategy']` -- 기본값이 `MomentumStrategy`, `MeanReversionStrategy`이지만, 실제 등록된 전략 목록에 이 이름들이 없을 수 있음 (현재 코드베이스에 이 이름의 전략 파일이 보이지 않음).
- **영향**: config 없이 시작하면 `registry.has(name)`이 false를 반환하고 경고만 로깅, 전략 0개로 봇이 실행됨. 거래가 전혀 발생하지 않음.
- **제안**: 등록된 전략 목록에서 실제 존재하는 이름으로 기본값 수정, 또는 0개 전략일 때 에러 발생.

### H-8. botRoutes.js -- 단일 Express Router 인스턴스 공유 위험
- **파일**: `backend/src/api/botRoutes.js:9`
- **문제**: `const router = require('express').Router()`가 모듈 최상위에 선언되어 있어 팩토리 함수 안이 아님. Node.js 모듈은 캐시되므로, 이 코드가 두 번 호출되면 같은 router 인스턴스에 라우트가 중복 등록됨.
- **영향**: 현재 `bootstrap()`이 1회만 호출되므로 문제 없으나, 테스트 환경에서 위험.
- **제안**: router 선언을 팩토리 함수 안으로 이동:
```javascript
module.exports = function createBotRoutes({ botService, riskEngine }) {
  const router = require('express').Router();
  // ...
  return router;
};
```

---

## 3. Enhancement Ideas (장기 개선)

### E-1. 테스트 프레임워크 도입
- 현재 테스트가 전혀 없음. 실제 자금을 다루는 시스템에서 이것은 매우 높은 위험.
- 최소한 단위 테스트 대상: `mathUtils`, `riskEngine.validateOrder()`, `orderManager.submitOrder()`, `circuitBreaker`, `exposureGuard`.
- 제안: Jest + mock으로 핵심 경로 테스트.

### E-2. 요청 속도 제한 (Rate Limiting) 미구현
- **파일**: `backend/src/app.js:217-227`
- 모든 API 엔드포인트가 속도 제한 없이 열려있음. `/api/bot/start`, `/api/bot/emergency-stop` 같은 위험한 엔드포인트도 무제한 호출 가능.
- 제안: `express-rate-limit` 패키지 적용.

### E-3. API 인증/인가 미구현
- 모든 API 엔드포인트가 인증 없이 접근 가능. 네트워크에 노출되면 누구나 봇을 제어할 수 있음.
- 제안: 최소한 API key 미들웨어 또는 JWT 인증.

### E-4. CORS가 와일드카드 (*)
- **파일**: `backend/src/app.js:222`
- `Access-Control-Allow-Origin: *` -- 모든 origin에서 API 호출 가능.
- 제안: 프로덕션에서는 프론트엔드 origin만 허용.

### E-5. 입력 검증 부재
- API 엔드포인트에서 `req.body` 검증이 최소한임. 예를 들어:
  - `POST /api/bot/start` (`botRoutes.js:24-33`): `req.body`가 그대로 `botService.start(config)`에 전달됨. 악의적 입력에 대한 방어가 없음.
  - `PUT /api/bot/risk-params` (`botRoutes.js:80-93`): `params` 객체 내용 검증 없이 `riskEngine.updateParams()`에 전달. 음수 값이나 극단적 값 설정 가능.
- 제안: `joi` 또는 `zod`로 스키마 기반 입력 검증.

### E-6. 구조화된 에러 클래스
- 현재 모든 에러가 generic `Error` 인스턴스. 에러 분류가 문자열 비교에 의존 (예: `err.message.includes('실행 중')`).
- 제안: `AppError`, `ValidationError`, `ExchangeError` 등 커스텀 에러 클래스 도입.

### E-7. 메트릭/모니터링 미구현
- Prometheus metrics, APM (Application Performance Monitoring) 없음.
- 제안: `prom-client`로 주요 메트릭 노출: 주문 수, 에러 율, WebSocket 재연결 횟수, 메모리 사용량.

### E-8. 로그 순환/외부 전송
- 현재 로그가 stdout/stderr으로만 출력됨. 디스크 저장이나 외부 로깅 서비스 연동 없음.
- 장시간 운영 시 로그 추적이 불가능.

---

## 4. 서비스별 상세 리뷰

### 4.1 ExchangeClient (`services/exchangeClient.js`)
| 항목 | 평가 |
|------|------|
| 재시도 로직 | **양호**. `_withRetry()` 3회 재시도, 지수 백오프, auth_error 즉시 실패 (line 107-151) |
| 에러 분류 | **양호**. `_classifyError()` 함수로 rate_limit/auth/network/api 분류 (line 45-73) |
| WS 라이프사이클 | **주의**. `connectWebsockets()` 다중호출 방지 있음 (line 535-538), 하지만 WS reconnect 시 재구독 로직이 SDK에 위임되어 있어 bitget-api SDK의 자동 재연결 동작에 의존 |
| 리소스 정리 | **양호**. `closeWebsockets()` (line 683-702)에서 양쪽 WS 모두 close 시도 |
| 이벤트 리스너 해제 | **미흡**. `connectWebsockets()`에서 등록한 wsPublic/wsPrivate 리스너가 `closeWebsockets()`에서 해제되지 않음 -- SDK가 내부적으로 처리한다고 가정 |

### 4.2 BotService (`services/botService.js`)
| 항목 | 평가 |
|------|------|
| 시작/정지 라이프사이클 | **양호**. `_eventCleanups` 배열로 리스너 추적 및 정리 (line 121, 264-266, 297-300) |
| 에러 복구 | **양호**. `start()` 실패 시 세션 상태를 ERROR로 업데이트 (line 384-394) |
| pause/resume | **주의**. `pause()` 후 `resume()` 시 전략을 다시 activate하지만, `_eventCleanups`에 새 리스너를 추가하지 않음. signal 이벤트가 start() 시점에 이미 등록되어 있으므로 정상 작동하나, 구조적으로 혼란 가능 |
| 전략 런타임 관리 | **양호**. `enableStrategy()`/`disableStrategy()` 함수 제공 (line 763-876) |

### 4.3 OrderManager (`services/orderManager.js`)
| 항목 | 평가 |
|------|------|
| Risk 게이트웨이 | **양호**. 모든 주문이 `riskEngine.validateOrder()` 통과 필수 (line 196-225) |
| 에러 핸들링 | **양호**. exchange 에러 시 FAILED 상태 Trade 저장 (line 313-363) |
| WS 핸들러 에러 격리 | **양호**. `_handleWsOrderUpdate`, `_handleWsFillUpdate` 모두 try/catch (line 726, 827) |
| DB 쓰기 실패 핸들링 | **양호**. 각 DB 쓰기에 catch, 부분 실패 허용 (line 390-416) |
| 동시성 제어 | **미흡**. C-2 참조 |

### 4.4 PositionManager (`services/positionManager.js`)
| 항목 | 평가 |
|------|------|
| 주기적 동기화 | **양호**. 30초 간격 REST reconciliation (line 122-129) |
| 일일 리셋 | **양호**. UTC 자정에 `riskEngine.resetDaily()` 호출 (line 360-374) |
| WS 업데이트 핸들러 | **양호**. try/catch 포장, 포지션 0이면 삭제 (line 268-305) |
| 정리 | **양호**. `stop()` + `destroy()` 메서드 제공 (line 150-168, 451-456) |
| 타이머 정리 | **양호**. `stop()`에서 두 interval 모두 clearInterval (line 156-164) |

### 4.5 RiskEngine (`services/riskEngine.js`)
| 항목 | 평가 |
|------|------|
| 3-tier 검증 | **양호**. CircuitBreaker -> DrawdownMonitor -> ExposureGuard 순서 (line 95-163) |
| 이벤트 전파 | **양호**. 서브엔진 이벤트를 re-emit (line 55-65) |
| accountState 초기값 | **주의**. equity: '0' 초기값 (line 49). 봇 시작 직후 equity=0 상태에서 ExposureGuard 검증 시 C-3 이슈 |
| 비동기 안전성 | **양호**. `validateOrder()`가 동기 함수이므로 레이스 컨디션 없음 (단, 호출자인 OrderManager가 비동기) |

### 4.6 MarketRegime (`services/marketRegime.js`)
| 항목 | 평가 |
|------|------|
| 버퍼 관리 | **양호**. 모든 버퍼에 최대 크기 제한 적용 (line 240-275) |
| 히스토리 제한 | **양호**. `MAX_HISTORY = 100`으로 regime 전환 기록 제한 (line 37, 746-748) |
| EMA 계산 | **주의**. `_updateEma9()` (line 323-337)에서 parseFloat 사용 -- mathUtils 대신 raw float 연산. 일관성 부족이지만 성능상 허용 가능 |
| 에러 격리 | **양호**. `_onBtcKline`, `_onAggregateUpdate` 모두 try/catch (line 229, 305-310) |

### 4.7 PaperEngine (`services/paperEngine.js`)
| 항목 | 평가 |
|------|------|
| 시장가 매칭 | **양호**. 슬리피지 적용, 가격 없으면 null 반환 (line 82-113) |
| 지정가 매칭 | **양호**. `onTickerUpdate()`에서 대기 주문 체크 (line 176-222) |
| 대기 주문 정리 | **미흡**. `_pendingOrders`에 TTL이 없어 체결되지 않는 지정가 주문이 영구적으로 남을 수 있음 |
| 메모리 관리 | **주의**. `_lastPrices` Map이 계속 성장 (삭제 로직 없음). 소수의 symbol이므로 실질적 문제는 아님 |

### 4.8 PaperPositionManager (`services/paperPositionManager.js`)
| 항목 | 평가 |
|------|------|
| PnL 계산 | **양호**. long/short 분기 정확 (line 195-201) |
| 잔액 관리 | **양호**. 수수료 차감 -> PnL 반영 순서 (line 80, 204) |
| 포지션 초과 종료 | **주의**. `_closePosition()`에서 closeQty > position.qty 검증이 미흡 -- `isLessThan(remainingQty, '0')` (line 209) 시 음수 잔량 허용 후 삭제. PnL은 closeQty 기준으로 계산되므로 과대 계산 가능 |

### 4.9 PaperAccountManager (`services/paperAccountManager.js`)
| 항목 | 평가 |
|------|------|
| 토너먼트 격리 | **양호**. 전략별 독립 PaperPositionManager 인스턴스 (line 87-101) |
| 이벤트 리스너 정리 | **양호**. `resetTournament()`에서 `removeAllListeners()` 호출 (line 134) |
| 자동 계정 생성 | **주의**. `_resolveAccount()` (line 388-401)에서 미등록 전략에 대해 자동 계정 생성 -- 의도된 동작이나 무한 계정 생성 방어 없음 |

### 4.10 IndicatorCache (`services/indicatorCache.js`)
| 항목 | 평가 |
|------|------|
| 캐시 무효화 | **양호**. 새 kline마다 `store.cache.clear()` (line 190) |
| 히스토리 제한 | **양호**. `MAX_HISTORY = 500` (line 33, 180-187) |
| 메모리 관리 | **양호**. `stop()`에서 `_data.clear()` (line 85) |
| 에러 격리 | **미흡**. `_compute()` 함수에 try/catch 없음 -- 지표 계산 실패 시 예외가 `get()` 호출자에게 전파됨 |

### 4.11 SignalFilter (`services/signalFilter.js`)
| 항목 | 평가 |
|------|------|
| 필터 체인 | **양호**. 4단계 필터 (cooldown, duplicate, concurrent, conflict) |
| 상태 리셋 | **양호**. `reset()` 메서드 제공 (line 380-388) |
| positionCount 동기화 | **미흡**. `_positionCounts`는 외부에서 `updatePositionCount()`로 업데이트해야 하지만, BotService나 OrderManager 어디에서도 이 메서드를 호출하지 않음. 따라서 max_concurrent 필터가 실질적으로 작동하지 않음 (항상 0) |

### 4.12 RegimeEvaluator (`services/regimeEvaluator.js`)
| 항목 | 평가 |
|------|------|
| 평가 지연 | **양호**. 4시간 후 평가, 1분 간격 체크 (line 20-23) |
| 메모리 관리 | **양호**. `MAX_RECORDS = 200` 제한 (line 26, 244-246), `_priceTracker` 정리 (line 249) |
| 타이머 정리 | **양호**. `stop()`에서 `clearInterval` (line 100-103) |

### 4.13 RegimeOptimizer (`services/regimeOptimizer.js`)
| 항목 | 평가 |
|------|------|
| 동시 실행 방지 | **양호**. `_optimizing` 플래그 (line 94-101, 128-131) |
| 에러 복구 | **양호**. 개별 variation 실패 시 skip (line 175-179), 전체 실패 시 `_optimizing = false` 리셋 (line 238) |
| 리소스 사용 | **주의**. 20개 variation x BacktestEngine 인스턴스 생성 -- 동기적 루프이므로 이벤트 루프 블로킹 가능. `_evaluateVariation()`이 async이지만 `engine.run()`이 동기 함수일 경우 문제 |

---

## 5. 예외 처리 매트릭스

| 크리티컬 패스 | 발생 가능 에러 | 현재 핸들링 | 권장 개선 |
|---|---|---|---|
| `orderManager.submitOrder()` | riskEngine.validateOrder() throw | try/catch -> Signal 저장, null 반환 (line 196-225) | **적절** |
| `orderManager.submitOrder()` | exchangeClient.placeOrder() throw | try/catch -> FAILED Trade 저장 (line 314-363) | **적절** |
| `orderManager.submitOrder()` | Trade.create() throw | try/catch -> null 반환 (line 390-393) | 주문은 거래소에 제출됐는데 DB 미반영 -- **데이터 불일치 위험**. 재조회 메커니즘 필요 |
| `positionManager.syncPositions()` | exchangeClient REST 실패 | try/catch 없음 -- throw 전파 | 호출자(`start()`)에서 catch (line 110-113). **적절** |
| `positionManager._handleWsPositionUpdate()` | 파싱 에러 | try/catch (line 269) | **적절** |
| `botService.start()` | coinSelector.selectCoins() 실패 | catch -> 세션 ERROR 상태 (line 384-394) | **적절** |
| `botService.start()` | BotSession.create() 실패 | catch 없음 -- throw 전파 | MongoDB 연결 문제 시 start() 자체 실패. **적절** |
| `marketRegime._onBtcKline()` | mathUtils 연산 에러 | try/catch (line 229, 255-258) | **적절** |
| `strategyBase.onTick()` | 전략 구현 에러 | BotService에서 try/catch (line 256-259) | **적절** |
| `paperEngine.matchMarketOrder()` | 가격 없음 | null 반환 (line 86-89) | **적절** |
| `drawdownMonitor.updateEquity()` | pctChange() division by zero | try/catch (line 76-81) | **적절** |
| `exposureGuard.validateOrder()` | equity=0 divide by zero | try/catch 없음 | **C-3 이슈**. 조기 반환 필요 |

---

## 6. 메모리/리소스 관리 개선안

### 6.1 EventEmitter 리스너 상한 설정
- Node.js 기본 EventEmitter 리스너 경고 임계값은 10개. 여러 서비스가 동일 이벤트에 리스너를 등록하면 경고 발생 가능.
- **제안**: exchangeClient, marketData에 `setMaxListeners(50)` 호출 (app.js 초기화 시).

### 6.2 WebSocket 재연결 모니터링
- **현재 상황**: WebSocket 재연결이 bitget-api SDK에 위임됨. `exchangeClient.js:551-553`에서 `reconnected` 이벤트 로깅만 수행.
- **개선**: 재연결 횟수 카운터 + 임계값 초과 시 알림. 빈번한 재연결은 네트워크 문제 또는 SDK 버그 징후.

### 6.3 MongoDB 연결 풀 모니터링
- **현재 상황**: Mongoose 기본 연결 풀 사용 (5 connections).
- **개선**: 연결 풀 크기 모니터링, 풀 고갈 시 경고. Trade/Signal 빈번 생성 시 풀 부족 가능.

### 6.4 IndicatorCache 계산 비용 프로파일링
- `_compute()` (indicatorCache.js:221-268)에서 지표 계산이 매 kline마다 발생. 18개 전략 x 10개 symbol = 최대 180회 cache miss 시 동기 계산.
- **제안**: 고비용 지표 (ADX, MACD)에 대한 실행 시간 측정 로깅 추가.

### 6.5 PaperEngine 대기 주문 TTL
- `_pendingOrders` Map에 TTL이 없어 체결 불가능한 지정가 주문이 영구 보류.
- **제안**: 24시간 TTL 적용, 만료 시 자동 취소.

---

## 7. 동시성/레이스 컨디션 분석

### 7.1 OrderManager.submitOrder() -- 다중 전략 동시 호출 (C-2 상세)
```
시나리오:
  t=0  StrategyA.emitSignal(BTCUSDT, open_long, qty=0.5)
  t=0  StrategyB.emitSignal(BTCUSDT, open_long, qty=0.5)

  두 호출 모두 동일 accountState 기준으로 riskEngine 검증 통과
  -> 총 1.0 BTC 포지션 생성 (의도: 최대 0.5)
```
- **근본 원인**: `validateOrder()`가 동기이지만 `submitOrder()`가 비동기. 검증 시점과 실행 시점 사이에 상태 변경이 반영되지 않음.
- **해결 방안**:
  - 옵션 A: 주문 제출을 직렬화 (큐 + 처리 루프)
  - 옵션 B: RiskEngine에 "pending exposure" 추적 추가 (주문 제출 전 예약, 완료/실패 후 해제)

### 7.2 PositionManager REST/WS 동기화 타이밍
- `syncPositions()` (REST)가 `_positions.clear()` 후 재구축하는 동안 (`positionManager.js:188`) WS 업데이트가 도착하면, clear 직후 WS 업데이트가 적용되었다가 REST 결과로 덮어씌워짐.
- **영향**: 30초 간격이므로 빈도가 낮고 다음 WS 업데이트로 복구되지만, 순간적으로 stale 데이터 노출 가능.

### 7.3 BotService.enableStrategy() -- 실행 중 전략 추가
- `enableStrategy()` (botService.js:763-843)가 `this.strategies.push(strategy)` 후에 signal 핸들러를 등록함.
- 이 사이에 `onTickerUpdate` 콜백이 `this.strategies` 배열을 순회하면 새 전략의 `onTick()`이 signal 핸들러 등록 전에 호출될 수 있음.
- **영향**: 극히 드문 타이밍. Node.js의 단일 스레드 특성상 실제 발생 가능성 매우 낮음 (배열 push와 이벤트 리스너 등록이 같은 동기 실행 블록).

### 7.4 MarketRegime 분류 vs 전략 활성화 순서
- `REGIME_CHANGE` 이벤트 emit -> StrategyRouter가 전략 activate/deactivate -> 그 사이에 ticker/kline 이벤트가 비활성 전략에 도달하면 무시됨 (isActive() 체크).
- **영향**: 정상 동작. 전략이 잠시 비활성인 동안 신호를 놓칠 수 있으나, 다음 tick에서 재평가됨.

---

## 8. 보안 개선안

### 8.1 API 키 노출 위험 (Priority: HIGH)
- **파일**: `backend/src/config/bitget.js:34-46`
- API 키가 환경 변수에서 읽히고 SDK 클라이언트 생성자에 전달됨. 환경 변수 자체는 안전하나:
  - 로그에 API 키가 노출될 수 있음 (현재는 없지만 향후 디버깅 시 실수 가능)
  - 에러 스택트레이스에 constructor 인자가 포함될 수 있음
- **제안**: getCredentials()에서 읽은 값을 log하지 않도록 명시적 주의 문구 추가. logger에서 `apiKey`, `apiSecret`, `apiPass` 키를 자동 마스킹하는 필터 추가.

### 8.2 CORS 와일드카드 (Priority: MEDIUM)
- **파일**: `backend/src/app.js:222`
- `Access-Control-Allow-Origin: *` + Socket.io CORS `origin: '*'` (line 252)
- 프로덕션에서는 프론트엔드 도메인으로 제한 필요.

### 8.3 MongoDB Injection 방어 (Priority: LOW)
- Mongoose 사용으로 대부분의 NoSQL injection은 차단됨.
- 그러나 `req.body`에서 `$gt`, `$ne` 같은 연산자가 포함된 객체가 전달되면 쿼리 조작 가능.
- **제안**: `mongo-sanitize` 미들웨어 적용.

### 8.4 HTTP 보안 헤더 미설정 (Priority: LOW)
- `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` 등 보안 헤더 없음.
- **제안**: `helmet` 미들웨어 적용.

### 8.5 express.json() 크기 제한 (Priority: MEDIUM)
- **파일**: `backend/src/app.js:218`
- `app.use(express.json())` -- 기본 크기 제한 100kb. 명시적 설정 없음.
- **제안**: `app.use(express.json({ limit: '1mb' }))` 명시적 설정. 너무 큰 요청 차단.

### 8.6 환경 변수 기본값 보안 (Priority: LOW)
- **파일**: `backend/src/config/db.js:8`
- `mongodb://localhost:27017/tradingBot` -- 기본 URI에 인증 없음. 프로덕션 환경에서 이 기본값이 사용되면 보안 위험.
- **제안**: `MONGO_URI` 미설정 시 경고 로그 출력 후 인증 없는 연결 명시적으로 표시.

---

## 9. 관찰성(Observability) 개선안

### 9.1 거래 라이프사이클 추적
현재 거래 추적 가능 경로:
```
Signal 생성 → Signal DB 저장 → Risk 검증 → 주문 제출 → Trade DB 저장 → WS 업데이트 → Trade 상태 변경 → PnL 계산
```
각 단계에 로그가 있으나, **correlation ID** (거래 고유 식별자)가 단계 간에 일관되지 않음.
- `clientOid`가 사용되지만, signal -> order -> fill 전체를 관통하는 단일 ID가 없음.
- **제안**: `traceId = uuid()` 생성 후 전체 파이프라인에 전달.

### 9.2 Health Check 부족한 영역
현재 체크: MongoDB, REST API, WebSocket, Position Sync, Memory.
누락된 체크:
- **전략 상태**: 활성 전략 수, 마지막 signal 시각
- **주문 큐 상태**: 미처리 주문 수
- **RiskEngine 상태**: circuit breaker 상태, drawdown 레벨
- **이벤트 루프 지연**: 이벤트 루프 lag 측정 (`perf_hooks`)

### 9.3 로그 구조 개선
- 현재 `error` 레벨에서 Error 객체 직렬화 (`logger.js:117-127`) 잘 구현되어 있음.
- 하지만 `{ error: err }` 패턴으로 전달할 때 Error가 아닌 plain object가 전달되면 stack trace가 누락됨.

---

## 10. 결론 및 우선순위 요약

### 즉시 수정 필요 (배포 전 필수)
1. **C-1**: unhandledRejection/uncaughtException 핸들러 추가
2. **C-2**: 주문 제출 동시성 제어 (뮤텍스/세마포어)
3. **C-3**: ExposureGuard equity=0 방어
4. **C-4**: graceful shutdown 순서 및 Promise화

### 1주 내 수정 권장
5. **H-1, H-2**: destroy() 호출 누락
6. **H-3**: PaperEngine 리스너 누적 방어
7. **H-4**: CircuitBreaker rapidLosses 정리
8. **H-7**: 기본 전략 이름 수정
9. **H-8**: Router 인스턴스 팩토리 내부 이동

### 2주 내 수정 권장
10. **4.11**: SignalFilter.updatePositionCount() 실제 연동
11. **E-2**: API rate limiting
12. **E-3**: API 인증
13. **E-5**: 입력 검증
14. **E-4**: CORS 제한

### 장기 개선 (1-3개월)
15. **E-1**: 테스트 프레임워크
16. **C-5**: Decimal.js 마이그레이션
17. **E-7**: Prometheus 메트릭
18. **9.1**: Correlation ID 전파
