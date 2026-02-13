# Round 3 Cross-Review: Tier 1 Reliability (11건)

> **Reviewer**: Senior Systems Engineer
> **Date**: 2026-02-14
> **Phase**: 2 (Cross-Review)
> **Review Targets**: Trader 제안서 + UI/UX 제안서
> **Review Perspective**: 시스템 무결성, 방어적 프로그래밍, Fail-safe, 관측성, 자원 관리, 점진적 열화

---

## Trader 제안서 리뷰

### T1-1: Backtest IndicatorCache 주입 — Option A vs Option B

**판정: ⚠️ 조건부 동의 (Option A 동의, 단 코드 중복 방지 필수)**

Trader의 분석은 정확하다. 8/18 전략 크래시, BreakoutStrategy의 무의미 결과 생성까지 상세히 파악했다. Option A(Lightweight Stub) 권장에 동의한다.

**Option B(Real IndicatorCache with Fake MarketData) 반대 이유**:
- IndicatorCache 생성자가 `if (!marketData) throw new Error(...)` 하므로, fake MarketData 객체 자체가 EventEmitter를 상속해야 하고 `on()` 메서드가 필요하다. 이것은 사소하지만 "실제 객체의 일부만 흉내내는" 패턴은 인터페이스 변경 시 조용히 깨진다.
- IndicatorCache의 `_handleKline()`은 `kline.symbol`이 필수이다 (라인 150: `if (!kline || !kline.symbol) return;`). 백테스트 kline 포맷은 `{ ts, open, high, low, close, volume }`으로 symbol이 없다. Option B는 매 kline에 symbol을 주입해야 하는데, 이러면 EventEmitter emit 시 symbol 삽입 + kline 원본 불변성 보장이라는 불필요한 복잡도가 추가된다.

**보완 요구사항**:
1. **코드 중복 방지**: BacktestIndicatorCache가 IndicatorCache의 `_compute()` 로직(rsi, atr, bb, macd 등 11개 지표 계산)을 통째로 복사하면 유지보수 비용이 급증한다. 내 제안서에서도 언급했듯이 `_compute()` 로직을 **static 메서드 또는 별도 유틸 함수**로 추출하여 양쪽이 공유해야 한다. 이것이 가장 중요한 보완 조건이다.
2. **MAX_HISTORY 상수 공유**: 실제 IndicatorCache는 500개 제한. BacktestIndicatorCache도 동일하게 적용해야 한다. 백테스트 데이터가 수천개 kline이 될 수 있으므로, 트리밍 미적용 시 메모리가 무제한 증가한다.
3. **feedKline() 시 String 변환**: IndicatorCache._handleKline()은 모든 값을 `String()`으로 변환한다 (라인 153-157). BacktestIndicatorCache.feedKline()도 동일한 변환을 해야 한다. 백테스트 kline 값이 이미 String인지, Number인지에 따라 결과가 달라질 수 있다.

---

### T1-2: _notifyFill() action 필드 추가

**판정: ✅ 동의**

분석이 완벽하다. 5줄 수정으로 16/18 전략의 백테스트 포지션 추적을 정상화할 수 있다. 구현 난이도 대비 효과가 가장 높은 항목이다.

**추가 확인 완료**:
- `_forceClosePosition()`은 `_closeLong()`/`_closeShort()`를 호출하므로 action이 자동 전달된다. 별도 수정 불필요.
- 시그니처 변경 `_notifyFill(side, price, action)`은 기존 호출부가 모두 `_notifyFill(side, price)`이고 이번에 4곳 전부 수정하므로 하위 호환 문제 없다. 이 메서드는 `BacktestEngine` 클래스 내부의 private 메서드이므로 외부 소비자가 없다.
- 내 제안서에서 언급한 `symbol` 필드 추가(`this._strategy.onFill({ side, price, action, symbol: this.symbol })`)도 함께 적용하는 것을 권장한다. 비용 0이고 전략의 multi-symbol 로직에 도움이 된다.

---

### T1-5: SignalFilter.updatePositionCount() 연동

**판정: ⚠️ 조건부 동의 (Paper 모드 strategy 필드 보장이 선행 조건)**

분석과 해결 방향 모두 정확하다. 실제로 코드베이스 전체에서 `updatePositionCount()` 호출이 0건임을 확인했다.

**보완 요구사항**:

1. **Paper 모드 strategy 필드 부재 확인됨**: `paperPositionManager.js`의 `_openPosition()` (라인 155-166)을 직접 확인한 결과, position 객체에 `strategy` 필드가 **없다**:
   ```javascript
   const position = {
     symbol, posSide, qty, entryPrice,
     markPrice: entryPrice, unrealizedPnl: '0',
     leverage: '1', marginMode: 'crossed',
     liquidationPrice: '0', updatedAt: new Date(),
     // strategy 필드 없음!
   };
   ```
   따라서 Trader가 경고한 대로, paper 모드에서 `pos.strategy`는 항상 `undefined`가 되어 모든 포지션이 `'unknown'` 전략으로 분류된다. **이것을 먼저 해결하지 않으면 T1-5는 paper 모드에서 무의미하다.**

   수정 방안: `paperPositionManager.onFill(fill)` 호출 시 fill 객체에 strategy 정보를 포함시키고, `_openPosition()`에서 position에 저장. 이를 위해 OrderManager가 paper fill을 보낼 때 strategy를 함께 전달해야 한다. 이 체인은 `botService._executeSignal() -> orderManager.submitOrder() -> paperEngine.submitOrder() -> paper:fill -> orderManager._handlePaperFill() -> paperPositionManager.onFill()` 경로를 따르는데, 현재 `submitOrder()` 시 strategy 정보가 전달되는지 확인 필요하다.

2. **이벤트 타이밍 주의**: Trader가 제안한 `POSITION_UPDATED` 이벤트 기반 접근과 내 제안서의 `ORDER_FILLED` 이벤트 기반 접근이 다르다. `ORDER_FILLED` 이벤트가 더 적절하다. `POSITION_UPDATED`는 가격 변동 시 markPrice 업데이트에서도 발생할 수 있어 불필요한 재계산이 발생할 수 있다. 반면 `ORDER_FILLED`는 실제 포지션 수 변동 시에만 발생하므로 더 정확하다.

3. **초기 카운트 설정**: 봇 재시작 시 이미 열려있는 포지션이 있을 수 있다. `start()` 시점에서 한 번 초기 카운트를 계산해야 한다. 내 제안서에서 `updateFilterCounts()` 초기 호출을 포함한 것이 이 이유다.

---

### T1-6: Sharpe Ratio 연간화 정규화

**판정: ✅ 동의**

수학적 분석이 정확하다. 1H 캔들에서 `sqrt(365/8760) = 1/sqrt(24) ~ 0.204` 배 과소평가라는 계산도 맞다. `_getPeriodsPerYear()` 매핑 테이블도 올바르다.

**추가 의견**:
- 3m 캔들의 값이 `365 * 24 * 20 = 175,200`인데, 1시간에 20개 3분 캔들이라는 뜻이다. 정확하다.
- Sortino Ratio 추가 제안은 좋지만 이번 스프린트 범위 밖이다. T1-6의 scope를 Sharpe 정규화로 한정하는 것이 바람직하다.
- `computeMetrics` 시그니처 변경은 호출부가 2곳(`backtestRoutes.js`, `runAllBacktest.js`)이므로 영향 범위가 작다.

---

### T1-11: DrawdownMonitor 수동 리셋 API

**판정: ⚠️ 조건부 동의 (보안 강화 필수)**

기능 필요성과 구현 방안에 동의한다. 서버 재시작 없이 halt를 해제할 수 있어야 한다.

**보완 요구사항**:

1. **equity 기본값 처리**: Trader의 제안에서 equity가 optional이고 미전달 시 `this.accountState.equity` 사용. 이것은 합리적이다. 반면 내 제안서에서는 equity를 required로 했다. Trader의 접근이 더 사용자 친화적이므로 optional + fallback 방식을 채택한다.

2. **RiskEvent 기록 필수**: Trader가 `RISK_EVENTS.DRAWDOWN_RESET` 이벤트 emit을 제안했는데, 이것만으로는 부족하다. **MongoDB에 RiskEvent 도큐먼트도 저장**해야 감사 추적(audit trail)이 가능하다:
   ```javascript
   await RiskEvent.create({
     eventType: 'drawdown_reset',
     severity: 'warning',
     source: 'manual',
     reason: `Manual drawdown reset (equity: ${equity})`,
   });
   ```

3. **CircuitBreaker 리셋 동시 제공**: Trader가 언급한 circuit-breaker 리셋 API 동시 추가에 동의한다. 실제 운영에서 drawdown halt와 circuit break가 동시에 발생하는 경우가 많다.

4. **리셋 후 이벤트 Socket.io 전달**: `app.js`의 Socket.io forward 로직에 `DRAWDOWN_RESET` 이벤트를 추가해야 프론트엔드가 리셋 상태를 즉시 반영할 수 있다.

---

### T1-3: Graceful Shutdown 순서

**판정: ✅ 동의 (Trader의 "LOW" 평가에도 동의)**

Trader의 관점이 균형 잡혀있다. 실질적 위험은 낮지만 정합성 차원에서 수정이 바람직하다.

**구체적 의견**:
- `botService.stop()` 내부에서 step 6(exchangeClient.closeWebsockets)과 step 7(session save)의 순서를 교체하자는 Trader의 제안은 타당하다. 단, 현재 코드에서 `botService.stop()`은 `await this.currentSession.save()`를 사용하고 있고, DB 연결은 `safeShutdown()`의 마지막 단계에서 닫히므로 실제 데이터 유실 가능성은 매우 낮다.
- 내 제안서에서 추가한 `await new Promise(resolve => setTimeout(resolve, 500))` (Phase 4: Flush pending DB writes)는 보수적이지만 안전한 접근이다. 500ms 추가 대기가 shutdown 시간에 큰 영향을 주지 않으면서 비동기 save 완료를 보장한다.
- **race condition 가능성**: `botService.stop()`이 매우 오래 걸려서(예: exchangeClient.closeWebsockets가 네트워크 타임아웃 대기) 10초 forceExit 타이머에 걸리면 DB write가 중단될 수 있다. 이 경우를 대비해 session save를 WS close보다 먼저 실행하는 것이 맞다.

---

### T1-4: PaperEngine 리스너 누적

**판정: ✅ 동의 (Trader 분석 추인)**

Trader가 발견한 `paper -> live -> paper` 전환 시 리스너 누적 문제를 추인한다. 이것은 내가 원래 발견한 항목(E:H-3)이며, Trader의 영향 분석(N배 중복 실행, CircuitBreaker 오동작)이 정확하다.

---

### T1-8: PositionsTable 수동 청산 버튼

**판정: ✅ 동의**

Trader 관점에서 운영 필수 기능이라는 평가에 동의한다. `POST /api/trades/order` API가 이미 존재하므로 프론트엔드 작업만 필요하다.

---

### 우선순위 배정

Trader의 우선순위 배정에 **대부분 동의**하되, T1-4(PaperEngine 리스너)의 순위를 올려야 한다. Trader는 7위로 두었지만, CircuitBreaker 오동작을 유발할 수 있다는 점에서 T1-5보다 앞서야 한다. 내 제안서에서 3위로 배정한 것이 타당하다.

---

## UI/UX 제안서 리뷰

### T1-7: Dashboard 레이아웃 재설계

**판정: ✅ 동의**

정보 우선순위 역전 분석이 정확하다. StrategyHub(높이 ~600px)가 2번째에 위치하여 핵심 정보(자산, 포지션)를 뷰포트 밖으로 밀어내는 문제를 잘 짚었다.

제안된 레이아웃 순서(봇 제어+자산 -> 포지션 -> 리스크+에쿼티 -> 시그널+거래 -> 전략 -> 심볼 레짐)가 트레이딩 워크플로우에 부합한다. PositionsTable이 Row 2에서 전체 너비로 배치되면 above-the-fold에 핵심 정보가 노출된다.

**시스템 관점 추가**: 레이아웃 변경은 순수 JSX 재배치이므로 로직 변경이 없다. 리그레션 위험이 매우 낮다.

---

### T1-8: PositionsTable 수동 청산 버튼

**판정: ⚠️ 조건부 동의 (에러 핸들링 강화 필요)**

기능 설계와 Props 변경이 잘 구성되어 있다. `ConfirmDialog` 재사용, `closingSymbol` 로딩 상태도 적절하다.

**보완 요구사항**:

1. **네트워크 에러 시 처리**: 청산 요청이 네트워크 에러로 실패했을 때, 사용자가 "이미 청산되었는지 아닌지" 확인할 수 없는 상태에 빠진다. 실패 시 position 목록을 즉시 refetch하여 현재 상태를 확인하는 로직이 필요하다.

2. **중복 클릭 방지**: `closingSymbol` 상태로 로딩 표시하는 것은 좋다. 단, 같은 심볼의 long과 short이 동시에 열려있을 수 있으므로, `closingSymbol` 대신 `closingKey` (symbol + posSide 조합)로 구분해야 한다.

3. **봇 정지 상태에서의 동작**: 현재 `POST /api/trades/order`는 봇이 정지 상태에서도 작동하는지 확인이 필요하다. 만약 봇이 idle일 때 OrderManager가 초기화되지 않았다면 청산이 실패할 수 있다. 이 경우 에러 메시지를 사용자에게 명확히 표시해야 한다.

---

### T1-9: Socket.io ref-counted lifecycle

**판정: ⚠️ 조건부 동의 (edge case 보완 필수)**

ref-count 패턴 자체는 올바르다. 현재 문제(React Strict Mode에서 불필요한 재연결)를 정확히 해결한다.

**보완 요구사항**:

1. **네트워크 끊김 시 ref 정리**: Socket.io의 `reconnection: true` 설정으로 자동 재연결이 활성화되어 있다. 네트워크가 끊겼다가 복구되면 socket 인스턴스는 자동으로 재연결을 시도한다. 이 과정에서 ref-count와 socket 인스턴스의 lifecycle이 꼬이지 않는다. socket.io-client의 reconnection은 같은 인스턴스를 재사용하므로 ref-count에 영향 없다. **이 부분은 문제없다.**

2. **`getSocket()` 하위 호환 문제**: UI 제안서에서 `getSocket()`을 "read-only access without affecting refCount"로 변경했다. 이것은 맞다. 단, 현재 `useSocket.ts`만 socket을 사용하고 있으므로, `getSocket()`의 하위 호환은 현재로서는 불필요한 복잡도다. `getSocket()`을 완전히 제거하고 `acquireSocket()`/`releaseSocket()`만 사용하는 것이 깔끔하다.

   다만, 내 제안서에서 `getSocket()`을 `acquireSocket()` 래퍼로 유지했는데, 이것은 **위험하다**: `getSocket()`을 호출하면 refCount가 증가하지만 대응하는 `releaseSocket()` 호출이 없으므로 leak이 발생한다. 따라서:
   - `getSocket()`은 refCount에 영향 없이 현재 socket 반환 (UI 제안서 방식) 또는
   - `getSocket()`을 완전히 제거
   둘 중 하나를 선택해야 한다. UI 제안서의 방식이 더 안전하다.

3. **리스너 명시적 해제 중요**: UI 제안서에서 cleanup 시 `socket.off(eventName, handler)`로 개별 리스너를 해제하는 것이 핵심이다. 현재 코드는 `disconnectSocket()`으로 소켓을 파괴하여 리스너가 암묵적으로 제거되지만, ref-counted 방식에서는 소켓이 살아있으므로 리스너를 명시적으로 제거해야 한다. UI 제안서의 named function + off() 패턴이 올바르다.

4. **refCount 디버깅 가능성**: 개발 모드에서 refCount 현황을 로깅하면 leak 디버깅에 도움이 된다:
   ```typescript
   export function acquireSocket(): Socket {
     refCount++;
     if (process.env.NODE_ENV === 'development') {
       console.debug(`[Socket] acquire — refCount: ${refCount}`);
     }
     // ...
   }
   ```

---

### T1-10: Error Boundary + api-client 에러 래핑

**판정: ⚠️ 조건부 동의 (긴급 정지 버튼 + ApiError 호환성)**

분석이 정확하고 구현 방향이 올바르다.

**보완 요구사항**:

1. **Error Boundary에 긴급 정지 버튼 필수**: 내 제안서에서 강조한 대로, Error Boundary 화면에서 **반드시 `botApi.emergencyStop()` 버튼을 노출**해야 한다. 대시보드가 크래시하면 봇 제어가 불가능해지는데, Error Boundary가 마지막 방어선이다. UI 제안서에는 "다시 시도" 버튼만 있고 긴급 정지 버튼이 없다.

   단, Error Boundary 내에서 `api-client.ts`의 `botApi.emergencyStop()`을 호출하면 api-client 자체가 에러 원인일 때 순환 실패할 수 있다. 따라서 **직접 `fetch()` fallback**을 사용해야 한다:
   ```typescript
   const handleEmergencyStop = async () => {
     try {
       await fetch(`${API_BASE}/api/bot/emergency-stop`, { method: 'POST' });
     } catch {
       // 최후의 수단이므로 실패해도 에러 무시
     }
   };
   ```

2. **ApiError 클래스와 기존 코드 호환성**: 현재 모든 커스텀 훅(`useBotStatus`, `usePositions` 등)에서 에러를 `catch (err)` 후 `err.message`로 사용한다. `ApiError`가 `Error`를 상속하므로 `message` 프로퍼티는 호환된다. 추가된 `statusCode`, `isNetworkError` 프로퍼티는 optional하게 사용 가능하므로 기존 코드가 깨지지 않는다.

3. **`res.ok` 체크 추가**: UI 제안서의 `if (!res.ok || !json.success)` 패턴이 올바르다. 현재 코드는 HTTP 500에서도 json 파싱을 시도하고 `json.success`만 확인하는데, 서버가 JSON을 반환하지 않는 경우(nginx 502 등)를 처리하지 못한다.

4. **global-error.tsx도 필수**: UI 제안서에서 `global-error.tsx` 생성을 포함한 것이 올바르다. `error.tsx`는 layout 아래의 에러만 잡고, layout 자체의 에러는 `global-error.tsx`가 잡는다.

---

### T1-11: DrawdownMonitor 리셋 UI 버튼

**판정: ✅ 동의**

UI 제안서의 접근이 간결하고 적절하다. `ConfirmDialog` 재사용, `onResetDrawdown` 콜백 패턴, halted 상태에서만 버튼 표시 모두 올바르다.

**추가 의견**:
- `riskApi.resetDrawdown(type)` 에서 `type: 'daily' | 'full'` 구분을 제공하는 것이 좋다. Daily loss halt와 max drawdown halt의 리셋 범위가 다르므로, UI에서 구분 가능하게 하는 것이 운영에 도움된다.
- 백엔드 API가 선행 조건이므로, Track A에서 API 구현 완료 후 연결해야 한다.

---

### 구현 순서

UI 제안서의 구현 순서(T1-10 -> T1-9 -> T1-7+T1-8 -> T1-11)에 동의한다.

T1-10(Error Boundary)을 가장 먼저 구현하는 것이 올바르다. 다른 작업 중 런타임 에러가 발생해도 대시보드가 완전히 크래시하지 않는 안전망을 먼저 확보해야 한다.

---

## 종합 의견

### 합의 사항 (3개 에이전트 일치)

| ID | 제목 | 합의 | 비고 |
|----|------|------|------|
| **T1-1** | IndicatorCache 백테스트 주입 | Option A (Lightweight Stub) | 코드 중복 방지를 위해 `_compute()` 유틸 추출 필수 |
| **T1-2** | _notifyFill action 필드 | 전원 동의 | 가장 높은 ROI. 5줄 수정, 16/18 전략 정상화 |
| **T1-6** | Sharpe 연간화 정규화 | 전원 동의 | interval 파라미터 전달 경로 수정 포함 |
| **T1-11** | DrawdownMonitor 리셋 | 전원 동의 | RiskEvent 감사 기록 + 확인 다이얼로그 필수 |
| **T1-3** | Shutdown 순서 | 전원 동의 | Low priority, session save를 WS close보다 먼저 |
| **T1-4** | PaperEngine 리스너 | 전원 동의 | bind된 핸들러 저장 + removeListener 패턴 |
| **T1-7** | Dashboard 레이아웃 | 전원 동의 | 정보 우선순위 기반 재배치 |
| **T1-8** | 수동 청산 버튼 | 전원 동의 | ConfirmDialog + 에러 핸들링 강화 |
| **T1-9** | Socket.io lifecycle | 전원 동의 | ref-count + 명시적 리스너 해제 |
| **T1-10** | Error Boundary | 전원 동의 | 긴급 정지 버튼 포함 필수 |

### 쟁점 사항 (조율 필요)

1. **T1-5 Paper 모드 strategy 필드**: paperPositionManager의 position 객체에 strategy 필드가 없음이 확인되었다. T1-5 구현 전에 이 필드를 추가하는 작업이 선행되어야 한다. 이것은 T1-5의 scope에 포함시킬지, 별도 작업으로 분리할지 결정 필요.

2. **T1-4 우선순위**: Trader(7위) vs Engineer(3위). CircuitBreaker 오동작 가능성을 고려하면 상위 배치가 맞다. T1-2 직후, T1-5 이전으로 제안.

3. **T1-10 긴급 정지 버튼**: UI 제안서에 없고, 내 제안서에서 강조한 사항. Error Boundary에 `fetch()` 직접 호출 기반 긴급 정지 버튼을 반드시 포함해야 한다.

### 최종 권장 구현 순서

**Track A (Backend)**: T1-2 -> T1-4 -> T1-1 -> T1-5 -> T1-3 -> T1-11 -> T1-6
**Track C (Frontend)**: T1-10 -> T1-9 -> T1-7 + T1-8 -> T1-11 (UI)

Track A에서 T1-1을 T1-5보다 먼저 배치한 이유: T1-1의 복잡도가 높으므로 조기 착수하여 리스크를 앞당긴다. T1-2는 5분이면 완료되므로 맨 앞에 배치하여 즉시 효과를 얻는다.

### 전체 리스크 평가

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| T1-1 `_compute()` 코드 중복 | 높음 | static 유틸 추출로 단일 소스 유지 |
| T1-5 paper 모드 strategy 필드 부재 | 높음 | paperPositionManager._openPosition()에 strategy 필드 추가 선행 |
| T1-9 getSocket() 하위 호환 | 중간 | getSocket()은 refCount 미변경 read-only로 유지 (UI 제안서 방식) |
| T1-10 Error Boundary에서 봇 제어 불가 | 높음 | fetch() 직접 호출 기반 긴급 정지 버튼 필수 |
| T1-11 무분별한 리셋으로 리스크 관리 무력화 | 중간 | 확인 다이얼로그 + RiskEvent 감사 기록 + 로깅 |
| T1-6 interval 미전달 시 fallback | 낮음 | `interval || '1D'` fallback으로 기존 동작 유지 |
