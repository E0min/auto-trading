# Round 3 Cross-Review: UI/UX Engineer

> **Reviewer**: Senior UI/UX Engineer
> **Date**: 2026-02-14
> **Reviewed**: Trader 제안서 (round_3.md), Engineer 제안서 (round_3.md)
> **Perspective**: 트레이더 의사결정 지원, 정보 계층, 실시간성, 일관성, 접근성, 성능

---

## Trader 제안서 리뷰

### T1-1: Backtest IndicatorCache 주입 (CRITICAL)

**판정: ✅ 동의**

Trader의 분석은 정확하다. 8/18 전략이 백테스트에서 크래시하는 문제가 확인되었고, Option A (Lightweight Stub) 권장도 적절하다.

**프론트엔드 영향 분석**: 이 수정 자체는 프론트엔드 표시에 직접 영향을 주지 않는다. 백테스트 실행 API의 입출력 형식이 동일하게 유지되므로 `BacktestForm.tsx`, `BacktestStatsPanel.tsx`, `BacktestEquityCurve.tsx` 등 기존 컴포넌트 수정은 불필요하다. 다만 수정 후 백테스트 가능한 전략이 10개에서 18개로 늘어나므로, `BacktestForm.tsx`의 전략 선택 드롭다운에서 사용자가 이전에 크래시를 경험했던 전략도 정상적으로 선택할 수 있게 된다. 별도 UI 대응은 필요하지 않다.

---

### T1-2: Backtest _notifyFill() action 필드 추가 (CRITICAL)

**판정: ✅ 동의**

5줄 수정으로 16/18 전략의 백테스트 포지션 추적을 정상화하는 최고 ROI 수정이다.

**프론트엔드 영향 분석**: 이 수정 후 백테스트 결과의 PnL, 승률, 거래 횟수 등이 크게 달라질 수 있다. `BacktestStatsPanel.tsx`에서 표시하는 지표(승률, 총 수익, 샤프 비율 등)의 **값이** 바뀔 뿐, **형식은** 동일하다. 프론트엔드 수정 불필요.

한 가지 UX 고려: 수정 전 실행한 백테스트 결과와 수정 후 결과가 같은 전략에 대해 매우 다른 성과를 보여줄 수 있다. `BacktestListPanel.tsx`에서 과거 결과를 볼 때 혼란을 줄 수 있으나, 인메모리 저장소이므로 서버 재시작 시 초기화되어 문제가 되지 않는다.

---

### T1-5: SignalFilter.updatePositionCount() 연동 (MEDIUM)

**판정: ⚠️ 조건부 동의 -- 전략별 포지션 카운트를 Dashboard에 노출하는 것을 권장**

Trader의 분석과 해결 방안에 동의한다. `_positionCounts`가 항상 0인 현재 상태에서 `maxConcurrentPositions` 제한이 사실상 무효인 것은 확인된다.

**보완 요청 (Dashboard 노출)**:

Engineer 제안서에서도 언급했듯, SignalFilter 포지션 카운트가 활성화되면 봇 상태 API 응답에 per-strategy positionCount를 포함시킬 수 있다. 이 정보를 **StrategyHub의 각 StrategyCard에 표시**하면 운영 가시성이 향상된다.

현재 `StrategyCard.tsx`는 전략명, 활성 상태, 마지막 시그널을 표시하지만 "현재 열린 포지션 수 / 최대 허용 수"는 보여주지 않는다. 이 정보를 `StrategyCard`의 메타데이터 영역에 추가하면:
- 트레이더가 어떤 전략이 포지션 한도에 도달했는지 즉시 파악 가능
- 시그널이 거부되는 이유("maxConcurrent 초과")를 사전에 이해 가능

구현 제안:
```typescript
// StrategyCard에 표시할 추가 정보
<span className="text-xs text-zinc-500">
  포지션: {currentCount}/{maxConcurrentPositions}
</span>
```

이 데이터가 현재 `BotStatus.strategies[].config`에 포함되지 않으므로, 백엔드에서 `/api/bot/status` 응답에 `positionCount` 필드를 추가해야 한다. T1-5 구현과 함께 작업하는 것이 효율적이다.

---

### T1-6: Sharpe Ratio 연간화 정규화 (MEDIUM-HIGH)

**판정: ✅ 동의**

Sharpe 계산 오류 분석은 정확하며, interval별 periodsPerYear 매핑 해법이 깔끔하다. Sortino Ratio 추가 제안도 좋다.

**프론트엔드 영향 분석**: `BacktestStatsPanel.tsx`의 "샤프 비율" 항목은 `BacktestMetrics.sharpeRatio`를 단순 표시한다. 값만 바뀌고 형식은 동일하므로 프론트엔드 수정 불필요.

단, Sortino Ratio가 추가되면 `BacktestMetrics` 타입(`frontend/src/types/backtest.ts`)에 `sortinoRatio` 필드를 추가하고, `BacktestStatsPanel.tsx`의 `STATS` 배열에 해당 항목을 추가해야 한다. 이 작업은 간단하다 (타입 + STATS 배열에 1개 항목 추가).

---

### T1-11: DrawdownMonitor 수동 리셋 API + UI 리셋 버튼 (MEDIUM)

**판정: ⚠️ 조건부 동의 -- 확인 플로우를 강화하고, 리셋 버튼 위치와 상태 피드백을 구체화해야 함**

Trader의 백엔드 API 설계(`POST /api/risk/drawdown/reset`)와 보안 고려사항(확인 모달 + 리셋 사유 입력)에 동의한다.

**보완 필요 사항 (UI/UX 관점)**:

1. **리셋 버튼 위치**: `RiskStatusPanel.tsx`의 드로다운 할트 배지(`L74-L79`) 바로 아래에 배치한다. 할트 상태가 아닐 때는 버튼을 숨긴다(조건부 렌더링). 이 위치가 맥락적으로 가장 자연스럽다.

2. **확인 플로우 -- 2단계 확인 필수**: EmergencyStopDialog 패턴(체크박스 확인 + 실행 버튼)을 따라야 한다. 단순 ConfirmDialog보다 EmergencyStopDialog 수준의 확인이 필요한 이유:
   - 리스크 관리를 무력화하는 위험한 작업
   - 실수로 클릭 시 보호장치가 사라짐
   - 확인 다이얼로그 내용:
     - 현재 드로다운 퍼센트, 피크 에쿼티, 현재 에쿼티
     - "리셋하면 드로다운 추적이 현재 에쿼티 기준으로 재시작됩니다"
     - "위 내용을 확인하였습니다" 체크박스

3. **상태 피드백**: 리셋 성공 시 `RiskStatusPanel`의 드로다운 바가 즉시 0%로 변경되어야 한다. `useBotStatus`의 `refetch()`를 호출하여 riskStatus를 갱신한다. 로딩 중에는 버튼에 Spinner를 표시한다.

4. **리셋 사유 입력**: Trader가 제안한 "리셋 사유 입력"은 운영 로그 관점에서 좋지만, 이 라운드에서는 optional로 처리하자. RiskEvent 기록에 자동으로 "manual_reset"이 남으므로 최소한의 추적은 가능하다.

5. **CircuitBreaker 리셋도 함께 제공**: Trader가 제안한 `/api/risk/circuit-breaker/reset`도 동의한다. `RiskStatusPanel`의 서킷 브레이커 영역에도 동일한 패턴으로 리셋 버튼을 배치하면 일관성 있는 UX가 된다.

---

### T1-3: Graceful Shutdown 순서 수정 (LOW)

**판정: ✅ 동의**

Trader가 판단한 대로 실질적 위험은 낮다.

**프론트엔드 영향 -- 서버 종료 감지 UX**:

현재 Socket.io의 `reconnection: true, reconnectionAttempts: Infinity` 설정으로 인해, 서버가 종료되면 Socket.io가 무한히 재연결을 시도한다. `useSocket.ts`에서 `disconnect` 이벤트를 감지하여 `state.connected = false`로 설정하고, `SystemHealth` 컴포넌트에서 소켓 연결 상태를 표시하고 있다.

그러나 **서버 의도적 종료**와 **일시적 네트워크 끊김**을 구분하지 못한다. Engineer 제안서에서 shutdown 시 `io.emit(RISK_EVENTS.UNHANDLED_ERROR, { type: 'server_shutdown' })`를 전송하는 것을 포함하고 있는데, 이것이 프론트엔드에서 "서버 종료됨 -- 재연결 대기 중" 배너를 표시하는 데 활용될 수 있다. 다만 이 UX 개선은 T1-3의 범위를 넘으므로, 별도 후속 작업으로 분리하는 것이 적절하다.

---

### T1-4: PaperEngine 리스너 누적 제거 (LOW-MEDIUM)

**판정: ✅ 동의**

**프론트엔드 영향 -- paper/live 전환 시 UI 동기화 이슈**:

현재 `TradingModeToggle.tsx`에서 `botApi.setTradingMode(mode)`를 호출하여 모드를 전환한다. 전환 후 `refetchBotStatus()`를 호출하여 상태를 갱신하지만:

1. 리스너 누적 버그가 해결되면, 전환 후 `paper:fill` 이벤트가 정확히 1번만 발생하게 되어 프론트엔드 표시의 정합성이 개선된다.
2. 현재 N번 중복 실행되는 상황에서는 포지션 수, PnL이 일시적으로 비정상적인 값을 표시할 수 있다. 이 버그 수정으로 프론트엔드의 실시간 데이터 정확도도 간접적으로 개선된다.

별도 프론트엔드 수정은 불필요하다.

---

### T1-8: PositionsTable 수동 청산 버튼 (MEDIUM)

**판정: ⚠️ 조건부 동의 -- 청산 UX를 더 구체화해야 함**

Trader가 이것을 "운영 필수 기능"으로 평가한 데 동의한다. 그러나 제안에서 UX 세부사항이 충분히 다루어지지 않았다.

**내가 보완해야 할 UX 설계 사항**:

1. **확인 다이얼로그에 포함할 정보**:
   - 심볼 (예: BTCUSDT)
   - 방향 (롱/숏)
   - 수량 (현재 보유량 전체)
   - 현재가 (실시간)
   - 미실현 PnL (수익이면 emerald, 손실이면 red)
   - 진입가 대비 변동률
   - **중요 경고**: 손실 포지션인 경우 "이 포지션을 시장가로 청산하면 약 $XX의 손실이 확정됩니다" 문구 추가

2. **부분 청산**: 이 라운드에서는 전체 수량 청산만 지원한다. 부분 청산은 입력 필드 + 유효성 검증(최소/최대 수량) 등 추가 복잡도가 있으므로 후속 라운드로 분리. 단, 향후 확장을 위해 `onClosePosition` 콜백은 `qty` 파라미터를 받을 수 있게 설계한다.

3. **로딩 상태**: 청산 주문 제출 중에는 해당 행의 청산 버튼을 Spinner로 대체하고, 다른 행의 청산 버튼은 disabled로 처리한다 (동시 다중 청산 방지).

4. **에러 처리**: 청산 실패 시 인라인 에러 메시지를 확인 다이얼로그에 표시한다. 다이얼로그를 자동으로 닫지 않고, 사용자가 에러를 확인한 후 재시도하거나 취소할 수 있게 한다.

---

### Trader 우선순위 배정 평가

Trader의 11건 우선순위 배정에 전반적으로 동의한다. 특히 T1-1과 T1-2를 최우선으로 배치한 것은 적절하다. T1-7(Dashboard 레이아웃)을 최하위로 배치한 것도 기능적 영향이 없으므로 납득 가능하다. 다만, T1-8(수동 청산)은 6위보다 높아야 한다고 본다 -- 이는 운영 안전성 직결 항목이며, 포지션 손실이 확대되는 긴급 상황에서 EmergencyStop(전체 정지) 외에 개별 대응 수단이 없는 것은 심각한 UX 결함이다.

---

## Engineer 제안서 리뷰

### T1-1: Backtest IndicatorCache 주입 (CRITICAL)

**판정: ✅ 동의**

Engineer의 `BacktestIndicatorCache` 클래스 설계는 명확하다. Trader의 Option A와 동일한 접근이며, `feedKline(symbol, kline)` 인터페이스도 적절하다.

**추가 의견**: Engineer가 제안한 "IndicatorCache의 `_compute()` 로직을 static 메서드로 추출하여 공유"는 좋은 설계이지만, 이번 라운드의 범위를 넘길 수 있다. 인라인 캐시에서 `_compute()` 로직을 복제하더라도 기능적으로는 동일하게 동작한다. 리팩토링은 후속으로 분리하는 것이 구현 속도 측면에서 합리적이다.

---

### T1-2: Backtest _notifyFill() action 필드 누락

**판정: ✅ 동의**

Engineer가 `symbol` 필드도 함께 추가하자는 제안(`{ side, price, action, symbol: this.symbol }`)에 동의한다. 추가 비용이 0이고, multi-symbol 전략 대비가 된다.

---

### T1-3: Graceful Shutdown 순서 수정

**판정: ⚠️ 조건부 동의 -- Socket.io 종료 전에 프론트엔드에 "서버 종료" 알림을 보내는 것을 확실히 해야 함**

Engineer의 shutdown 순서 재정렬 제안에서 Phase 1(botService.stop) 전에 `io.emit(RISK_EVENTS.UNHANDLED_ERROR, { type: reason })` 를 보내는 것에 동의한다.

**보완 필요**: 이 emit이 실제로 프론트엔드에 도달하는지 확인해야 한다. `io.emit()`은 비동기이며, emit 직후 botService.stop()이 시작되면 메시지가 전달되기 전에 WebSocket이 닫힐 수 있다. `await`가 아닌 fire-and-forget이므로, emit 후 100ms 정도의 딜레이를 두거나, Socket.io의 `volatile.emit()`을 사용하는 것이 안전하다.

프론트엔드에서의 수신은 이미 `useSocket.ts` L119~L133에서 `UNHANDLED_ERROR` 이벤트를 처리하고 있다. `type: 'server_shutdown'` 을 받으면 `eventType: 'process_error'`로 변환되어 `RiskAlertBanner`에 표시된다. 이것으로 충분하다.

---

### T1-4: PaperEngine 리스너 누적 제거

**판정: ✅ 동의**

Engineer의 해결 방안(바인드된 핸들러를 프로퍼티에 저장 + `removeListener`로 제거)은 정확하고 깔끔하다. `setLiveMode()` 메서드 추가도 적절하다.

프론트엔드에서 paper/live 전환 시 `refetchBotStatus()`를 호출하면 최신 상태를 가져오므로, 리스너 정리 후 별도 프론트엔드 동기화 작업은 불필요하다.

---

### T1-5: SignalFilter 포지션 카운트 연동

**판정: ⚠️ 조건부 동의 -- Paper 모드에서 `pos.strategy` 필드 보장 여부를 사전에 확인해야 함**

Engineer의 이벤트 와이어링 방식(`ORDER_FILLED` + `ORDER_CANCELLED` 이벤트에서 `updateFilterCounts()` 호출)은 적절하다.

**보완 필요**:

1. **Paper 모드 호환성**: Engineer 자신도 언급한 대로, `paperPositionManager.getPositions()` 반환값에 `strategy` 필드가 포함되는지 반드시 사전 확인해야 한다. 이 필드가 없으면 모든 포지션이 `'unknown'`으로 집계되어 전략별 카운트가 의미 없어진다.

2. **Dashboard 노출** (Trader 리뷰에서도 언급): 포지션 카운트가 활성화되면, `/api/bot/status` 응답에 전략별 `currentPositions / maxConcurrentPositions`를 포함하여 `StrategyCard.tsx`에서 표시할 수 있게 해야 한다. 이 데이터가 없으면 트레이더는 포지션 제한이 작동하는지 확인할 방법이 없다.

---

### T1-6: Sharpe Ratio 연간화 정규화

**판정: ✅ 동의**

Engineer의 `CANDLES_PER_YEAR` 매핑과 interval 전달 방안이 Trader 제안과 일치한다. 두 에이전트가 독립적으로 동일한 해법에 도달했으므로 확신도가 높다.

---

### T1-9: Socket.io ref-counted lifecycle

**판정: ⚠️ 조건부 동의 -- `getSocket()` 의 동작 변경에 주의해야 함**

Engineer의 ref-count 제안에 동의하나, `getSocket()`의 의미 변경에 주의가 필요하다.

**보완 필요**:

1. **`getSocket()` 반환 타입 변경**: Engineer는 `getSocket(): Socket`을 `acquireSocket(): Socket`으로 대체했지만, `getSocket()`도 유지하면서 `return acquireSocket();`으로 위임했다. 이러면 `getSocket()` 호출마다 refCount가 증가한다. 나의 제안서에서는 `getSocket(): Socket | null`을 **읽기 전용 접근(refCount 미증가)**으로 정의했다. 이 방식이 더 안전하다.

   이유: 현재 codebase에서 `getSocket()`을 직접 호출하는 곳이 `useSocket.ts` 외에 있을 수 있고, 그런 곳에서 refCount가 의도치 않게 증가하면 소켓이 영원히 해제되지 않는다.

2. **리스너 명시적 해제**: ref-count로 전환하면, `useSocket.ts`의 cleanup에서 개별 `socket.off(event, handler)`를 호출해야 한다. 현재는 `disconnectSocket()`으로 소켓 자체를 파괴하므로 리스너가 자동 정리되지만, ref-count 방식에서는 소켓이 살아있는 상태에서 리스너만 제거해야 한다. 이 점은 나의 제안서에서 이미 상세히 다루었으며, Engineer도 동일하게 인식하고 있다.

---

### T1-10: Error Boundary + API Client 에러 래핑

**판정: ⚠️ 조건부 동의 -- Error Boundary에 긴급 정지 버튼을 반드시 포함해야 함**

Engineer의 분석(금융 대시보드에서 화면 크래시 = 시스템 관측성의 완전한 상실)에 강력히 동의한다.

**보완 필요**:

1. **Error Boundary에 EmergencyStop 버튼 필수**: Engineer가 `<EmergencyStopButton />`을 Error Boundary에 포함한 것에 동의한다. 그러나 이 버튼은 `api-client.ts`의 `request()` 함수를 사용하면 안 된다 -- Error Boundary가 표시되는 상황은 `request()` 자체가 에러를 던졌을 가능성이 있다. **직접 `fetch()`를 사용하는 독립적인 긴급 정지 호출**이 필요하다:

   ```typescript
   // Error Boundary 내부의 긴급 정지 -- api-client 우회
   const handleEmergencyStop = async () => {
     try {
       await fetch(`${API_BASE}/api/bot/emergency-stop`, { method: 'POST' });
     } catch {
       // 서버 연결 불가 시에도 UI 피드백
     }
   };
   ```

   Engineer의 리스크 분석 표에서 이 fallback을 언급한 것은 좋다.

2. **`ApiError` 클래스에 `endpoint` 필드 포함**: Engineer가 `endpoint` 필드를 포함한 것에 동의한다. 이 정보가 Error Boundary의 에러 메시지에 표시되면 디버깅이 용이하다.

3. **`global-error.tsx` 도 필요**: `app/error.tsx`는 page 레벨 에러만 잡는다. `layout.tsx`에서 발생하는 에러는 `global-error.tsx`가 필요하다. 나의 제안서에서 이미 이 파일을 포함했다.

---

### T1-11: DrawdownMonitor 수동 리셋 API

**판정: ⚠️ 조건부 동의 -- equity 파라미터 필수 vs 선택에 대한 의견 차이**

Engineer는 `equity`를 **필수**(`if (!equity) return 400`)로, Trader는 **선택**(없으면 `accountState.equity` 사용)으로 제안했다.

**나의 판단: Trader의 방식(선택)이 UX 관점에서 우수하다.**

이유:
- 프론트엔드에서 리셋 버튼을 누를 때 트레이더에게 equity 값을 직접 입력하게 하면 혼란을 유발한다
- 대부분의 경우 "현재 equity를 새 baseline으로 사용"이 의도이다
- equity 입력 필드를 추가하면 UI 복잡도가 불필요하게 증가한다
- API에서 equity가 생략되면 서버측에서 `accountState.equity`를 자동 사용하는 것이 깔끔하다

따라서 API는 `{ equity?: string }` (선택적)으로 설계하고, 프론트엔드에서는 equity를 보내지 않는 것을 기본으로 한다.

---

### Engineer 우선순위 배정 평가

Engineer의 우선순위에서 T1-4(PaperEngine 리스너)를 3위로, T1-10(Error Boundary)을 6위로 배치한 것에 **부분적으로 이의**를 제기한다.

T1-10(Error Boundary)은 대시보드 크래시 시 봇 제어 불가라는 안전 위험을 내포하고 있다. 이것은 T1-4(리스너 누적)보다 영향 범위가 넓다. T1-4는 paper 모드에서 봇 반복 재시작 시에만 발현되는 조건부 버그이지만, T1-10은 어떤 런타임 에러든 발생하면 즉시 대시보드가 사용 불능이 된다.

나의 권장 순서: T1-10을 T1-4보다 앞에 배치 (즉, 4위 이내).

---

### Track 분배 평가

Engineer의 Track 분배:
- Track A (Backend): T1-1, T1-2, T1-3, T1-4, T1-5, T1-11 (6건)
- Track C (Frontend): T1-7, T1-8, T1-9, T1-10 (4건)
- Track B (Backtest metrics): T1-6 (1건)

**동의한다.** Track A와 Track C가 독립적이어서 병렬 작업이 가능하다. T1-11의 프론트엔드 부분(리셋 UI)은 Track A의 API 구현 후에 Track C에서 연결하는 순서가 적절하다.

**구현 순서에 대한 의견**: Engineer가 Track A 내에서 T1-1을 마지막(6번째)으로 배치한 것은 이해하나, Trader가 주장한 대로 T1-1과 T1-2가 가장 중요하다. 복잡도가 높더라도 먼저 착수하여 다른 간단한 항목과 병렬로 진행하는 것이 전체 일정 관점에서 유리하다.

---

## 종합 의견

### 합의 사항 (두 에이전트 모두 동의)

| ID | 내용 | 상태 |
|----|------|------|
| T1-1 | BacktestIndicatorCache 경량 스텁 방식 (Option A) | 양측 완전 합의. 프론트 영향 없음. |
| T1-2 | _notifyFill action 필드 + symbol 추가 | 양측 완전 합의. 프론트 영향 없음. |
| T1-4 | PaperEngine 리스너 제거 (바인드 핸들러 저장 방식) | 양측 완전 합의. 프론트 영향 없음. |
| T1-6 | Sharpe ratio interval 기반 정규화 | 양측 완전 합의. 프론트 영향 미미 (Sortino 추가 시 타입+UI 항목 1개). |

### 조정 필요 사항

| ID | 쟁점 | 나의 판단 |
|----|------|----------|
| T1-5 | Dashboard에 전략별 포지션 카운트 노출 여부 | **노출 권장**. StrategyCard에 `n/max` 표시. 백엔드 status API 변경 필요. |
| T1-8 | 청산 UX 세부 설계 | **확인 다이얼로그 정보 풍부화** (PnL 경고, 손실 확정 문구). 부분 청산은 후속으로 분리. |
| T1-11 | equity 파라미터 필수 vs 선택 | **선택(Trader 방식)** 채택. 프론트에서 equity 입력 불필요. |
| T1-11 | 확인 플로우 강도 | **EmergencyStopDialog 수준** (체크박스 + 실행 버튼). 단순 ConfirmDialog 불충분. |
| T1-3 | shutdown 시 프론트엔드 알림 | emit 후 **100ms 딜레이** 추가하여 메시지 도달 보장. |
| T1-9 | getSocket() refCount 증가 여부 | **증가시키지 않음** (읽기 전용). acquireSocket/releaseSocket만 refCount 관리. |
| T1-10 | Error Boundary 긴급 정지 | **fetch() 직접 호출 방식 (api-client 우회)**. Engineer 리스크 분석과 합치. |
| 우선순위 | T1-10 위치 | T1-4보다 **앞에 배치** (4위 이내). 대시보드 안전망은 인프라급 중요도. |

### Track C (Frontend) 최종 권장 구현 순서

1. **T1-10** (Error Boundary + api-client 에러 래핑) -- 모든 작업의 안전망
2. **T1-9** (Socket.io ref-counted lifecycle) -- 인프라 안정화
3. **T1-8** (수동 청산 버튼) -- 운영 안전성 직결
4. **T1-7** (Dashboard 레이아웃 재설계) -- 정보 접근성 개선
5. **T1-11 UI** (DrawdownMonitor 리셋 버튼) -- Track A의 API 완성 후 연결

### 최종 리스크 정리

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| T1-1 수정 후 기존 백테스트 결과와 괴리 | 낮음 | 인메모리 저장소이므로 서버 재시작 시 초기화됨 |
| T1-8 청산 버튼 오클릭 | 중간 | 2단계 확인 다이얼로그 + PnL 경고 메시지 |
| T1-11 리셋 남용 시 리스크 관리 무력화 | 중간 | EmergencyStop 수준 확인 플로우 + RiskEvent 자동 기록 |
| T1-9 전환 중 이벤트 누락 | 낮음 | 명시적 off/on + 폴링이 백업 역할 (3~30초 간격) |
| T1-10 Error Boundary에서 emergencyStop 실패 | 높음 | fetch() 직접 호출 (api-client 우회) + 에러 시 "거래소 직접 접속" 안내 |
