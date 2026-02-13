# Round 3 Review — Senior Quant Trader 관점

> **Reviewer**: Senior Quant Trader
> **Date**: 2026-02-14
> **Reviewed**: Engineer 제안서 (T1-1~T1-6, T1-9~T1-11) + UI/UX 제안서 (T1-7~T1-11)
> **관점**: 수익률 극대화, 리스크 조정 수익률, 전략 간 상관관계, 과적합 경계, 거래 비용 반영

---

## Engineer 제안서 리뷰

### T1-1: Backtest IndicatorCache 주입 — ✅ 동의 (최우선)

Engineer의 진단이 정확하다. `_createStrategy()`에서 `setIndicatorCache()`를 호출하지 않아 8개 전략(RsiPivot, Bollinger, Grid, MacdDivergence, Vwap, QuietRangeScalp, Breakout, AdaptiveRegime)이 backtest에서 즉시 크래시한다. 실제 코드에서 8개 파일 모두 `this._indicatorCache`를 참조하는 것을 확인했다.

**Trader 관점 보완 사항**:

1. **`_compute()` 로직 동일성이 핵심이다.** BacktestIndicatorCache와 실제 IndicatorCache의 `_compute()` 결과가 1비트라도 다르면, 백테스트와 실매매 간 괴리가 발생하여 전략 선택의 근거 자체가 무너진다. Engineer가 제안한 "static 유틸 함수로 추출하여 공유" 방식에 강하게 동의한다. **별도 구현이 아닌 반드시 동일 코드 경로를 공유해야 한다.**

2. **`_handleKline()` 정규화 로직도 동일해야 한다.** 현재 IndicatorCache의 `_handleKline()`에서 `String(kline.close)`, `kline.high !== undefined ? String(kline.high) : close` 등의 정규화 처리가 있다. BacktestIndicatorCache의 `feedKline()`에서 동일한 정규화를 해야 한다. Engineer의 스케치 코드에서 `kline.high`, `kline.low`를 그대로 넣고 있는데, 실제 IndicatorCache처럼 `String()` 래핑과 undefined 체크를 반드시 적용해야 한다.

3. **MAX_HISTORY = 500 제한 공유.** 실매매에서 500캔들까지만 유지하므로, 백테스트에서도 동일하게 500캔들 트리밍을 적용해야 동일한 지표값이 나온다. Engineer 스케치에 `if (store.klines.length > 500) { /* trim */ }` 주석이 있으니, 반드시 실제 구현해야 한다.

4. **lookback 기간 검증.** 8개 전략이 최초 N캔들 동안은 지표값이 null을 반환할 것이다 (RSI 14봉, Bollinger 20봉, MACD 26+9봉 등). 실매매에서는 WebSocket이 먼저 이력을 채우므로 문제없지만, 백테스트에서는 첫 ~35캔들 정도가 의미없는 구간이다. 이 초기 구간의 null 반환을 각 전략이 graceful하게 처리하는지 확인 필요. 대부분 `if (!result) return;` 패턴을 쓰겠지만, 누락 전략이 있으면 크래시한다.

---

### T1-2: Backtest _notifyFill() action 필드 누락 — ✅ 동의

action 필드가 없으면 **백테스트 수익률 자체가 신뢰할 수 없다.** 확인한 코드에서 4곳의 `_notifyFill()` 호출이 모두 `(side, price)` 2개 인자만 전달하고 있다.

**Trader 관점 보완 사항**:

1. **`symbol` 필드 추가에 동의한다.** Engineer가 제안한 대로 `{ side, price, action, symbol: this.symbol }`로 확장해야 한다. 현재 BacktestEngine은 단일 심볼이지만, 향후 멀티 심볼 백테스트를 고려하면 지금 넣는 것이 맞다.

2. **`qty` 필드도 추가하라.** 일부 전략(특히 Grid)은 `onFill()`에서 `fill.qty`를 참조하여 포지션 사이징을 추적한다. 현재 `_openLong()`에서 계산된 `qty` 값을 `_notifyFill`에 함께 전달하면 전략의 내부 포지션 추적이 더 정확해진다.

3. **`entryPrice` vs `fillPrice` 구분.** 일부 전략의 `onFill()`은 open 시점의 fill을 받아 `entryPrice`를 기록하고, 이를 기준으로 TP/SL 가격을 계산한다. action 필드가 없는 현재 상태에서는 이 entry tracking이 완전히 실패하여, TP/SL이 무한히 트리거되지 않거나 잘못된 가격에 트리거되는 결과로 이어진다. **이것이 백테스트 수익률을 과대평가하는 가장 큰 원인 중 하나다.**

---

### T1-3: Graceful Shutdown 순서 수정 — ✅ 동의

**Trader 관점**: shutdown 중 마지막 세션 통계(PnL, 포지션 수 등)가 DB에 기록되지 않으면, 다음 시작 시 트레이딩 히스토리에 갭이 생긴다. 이는 전략 성과 분석의 연속성을 깨뜨린다.

Engineer의 순서 재정렬(Bot stop -> DB flush -> MongoDB disconnect -> Socket.io close)에 동의한다. 특히 Phase 4의 500ms 대기는 합리적이다.

**한 가지 보완**: `forceExit` 타이머 10초를 유지하되, shutdown 시작 전에 **새로운 주문 생성을 먼저 차단**해야 한다. 즉 `isShuttingDown = true` 설정과 동시에, `riskEngine.validateOrder()`에서 shutdown 상태를 체크하여 모든 신규 주문을 거절하는 것이 안전하다. 이미 열려 있는 포지션은 botService.stop()에서 처리되겠지만, shutdown 과정에서 전략이 추가 시그널을 생성할 여지를 차단해야 한다.

---

### T1-4: PaperEngine 리스너 누적 — ✅ 동의

리스너 N배 누적으로 인한 CircuitBreaker 오작동은 **리스크 관리 체계 전체를 무력화**하는 심각한 문제다. 하나의 fill에 N번 recordTrade가 호출되면:
- CircuitBreaker의 연속 손실 카운트가 N배로 폭증 -> 불필요한 거래 중단
- 또는 반대로, 수익 거래가 N번 기록되어 연속 손실 카운터가 리셋 -> 실제 위험 상황에서 트리거 안됨

Engineer의 해결 방안(이전 리스너 제거 후 새 리스너 등록, `_paperFillHandler` 참조 저장)이 정확하다. 추가 의견 없음.

---

### T1-5: SignalFilter.updatePositionCount() 연동 — ⚠️ 조건부 동의

문제 진단은 정확하다. `maxConcurrentPositions` 제한이 무효화된 상태는 리스크 관점에서 위험하다. RsiPivot이 max=2인데 무제한으로 포지션을 열 수 있다면, 하나의 전략이 자본을 과도하게 소진할 수 있다.

**보완 조건**:

1. **ORDER_FILLED만으로는 부족하다.** 포지션 클로즈도 ORDER_FILLED 이벤트로 들어올 수 있는데, 이 경우 positionManager.getPositions()가 이미 업데이트된 상태인지 타이밍에 의존한다. **이벤트 핸들러에서 `process.nextTick()` 또는 `setImmediate()`로 한 틱 지연시켜 positionManager의 상태가 반영된 후 집계**하는 것이 안전하다.

2. **Paper 모드에서의 `pos.strategy` 필드 보장.** Engineer가 지적한 대로 paperPositionManager의 반환 형식을 확인해야 한다. 만약 strategy 필드가 없으면 모든 포지션이 'unknown'으로 잡혀 per-strategy 제한이 무의미해진다. Paper 모드 전환 시에도 동일한 집계 로직이 동작해야 한다.

3. **초기 카운트 설정 시점.** Engineer가 `updateFilterCounts()` 초기 호출을 제안한 건 좋지만, `start()` 메서드 내에서 전략이 아직 활성화되지 않은 시점에 호출하면 빈 Map이 된다. **전략 활성화 완료 후(전략 루프 시작 직전)** 초기 카운트를 설정해야 한다.

---

### T1-6: Sharpe Ratio 연간화 정규화 — ⚠️ 조건부 동의

Engineer의 진단이 정확하다. 코드를 직접 확인했는데, `computeMetrics()`는 `{ trades, equityCurve, initialCapital }` 3개 인자만 받고 있으며, interval 정보가 없다. 한편 BacktestEngine의 반환 결과 `config` 객체에는 이미 `interval: this.interval`이 포함되어 있다. 따라서 호출부(`backtestRoutes.js:135`)에서 `interval: result.config.interval`을 추가 전달하면 된다.

**보완 조건 (반드시 적용)**:

1. **Sortino Ratio도 함께 추가해야 한다.** Sharpe는 상승 변동성과 하락 변동성을 동일하게 취급한다. 암호화폐 트레이딩에서는 상승 변동성이 큰 전략이 불이익을 받는다. **Sortino Ratio (downside deviation만 사용)가 전략 비교에 더 적합하다.** 구현은 Sharpe와 거의 동일하되, stdDev 계산에서 `max('0', subtract(meanReturn, r))` (하방 편차)만 합산하면 된다.

2. **interval 매핑 검증.** Engineer의 CANDLES_PER_YEAR 매핑이 정확한지 확인:
   - `1m`: 365 * 24 * 60 = 525,600 -- 정확
   - `5m`: 365 * 24 * 12 = 105,120 -- 정확
   - `1H`: 365 * 24 = 8,760 -- 정확
   - `4H`: 365 * 6 = 2,190 -- 정확
   - `1D`: 365 -- 정확
   - `1W`: 52 -- 정확 (52.14주이지만 관례적으로 52)
   매핑은 정확하다.

3. **Calmar Ratio 추가 권장.** 연간 수익률 / 최대 낙폭 비율로, 드로다운에 민감한 전략 비교에 유용하다. `computeMetrics()`에 이미 maxDrawdown과 수익률이 있으므로 1줄 추가로 구현 가능. 다만 이는 T1-6 범위를 초과하므로, 향후 개선 사항으로 기록해 둔다.

4. **equityCurve 포인트 간 시간 간격 불균등 문제.** 백테스트에서 equityCurve는 매 캔들마다 기록되므로 간격이 균등하지만, 캔들 누락(거래소 데이터 갭)이 있으면 불균등해진다. 현재는 인접 포인트 간 pctChange로 계산하므로 큰 문제는 아니지만, 주석으로 이 가정을 명시해 두면 좋다.

---

### T1-9: Socket.io Ref-counted Lifecycle — ✅ 동의

현재 1곳만 사용하므로 즉시 문제는 없지만, 확장성을 위해 ref-count 패턴은 합리적이다.

**Trader 관점 한 가지**: Socket 연결이 끊어지는 동안 **실시간 포지션 PnL 업데이트가 중단**된다. 트레이더 입장에서 이것은 "눈을 감은 채 운전하는 것"과 같다. ref-count 전환 시 **연결 복구 시간을 최소화**하고, 연결 끊김 상태를 UI에 명확히 표시하는 것이 중요하다 (이미 useSocket에서 connected 상태를 추적하고 있으니, 이를 활용하면 된다).

---

### T1-10: Error Boundary + API Client 에러 래핑 — ⚠️ 조건부 동의

Error Boundary 자체에는 동의한다. 금융 대시보드가 크래시하면 봇 관측/제어가 불가능하다는 Engineer의 지적이 정확하다.

**보완 조건**:

1. **Error Boundary 내 EmergencyStop 버튼은 반드시 `fetch()`를 직접 호출**해야 한다. api-client가 에러 상태일 수 있으므로, Emergency Stop만큼은 raw fetch로 `POST /api/bot/emergency-stop`을 호출하는 fallback 경로를 가져야 한다. Engineer 제안서 리스크 분석에서 이미 이 점을 언급했으므로, 실제 구현에서 반드시 반영해야 한다.

2. **ApiError의 `isNetworkError` 플래그가 유용하다.** 네트워크 에러일 때는 재시도(retry)가 의미 있고, 비즈니스 에러(400)일 때는 재시도가 무의미하다. UI에서 이 구분을 활용하여 "재시도" 버튼을 네트워크 에러 시에만 노출하면 UX가 개선된다.

---

### T1-11: DrawdownMonitor 수동 리셋 API — ⚠️ 조건부 동의

Drawdown halt 후 수동 해제 기능은 필요하다. 하지만 **이 기능은 양날의 검**이다. 잘못 사용하면 리스크 한도를 우회하여 추가 손실을 초래할 수 있다.

**보완 조건 (필수)**:

1. **`resetDaily` vs `resetAll` 범위를 명확히 구분하는 UI가 필요하다.**
   - `resetDaily`: 일일 손실 한도만 리셋. peak equity는 유지. **상대적으로 안전** -- 다음 날 거래를 조기에 시작하는 효과.
   - `resetAll(equity)`: peak equity를 현재 equity로 재설정. **위험** -- 이전 고점 대비 drawdown 기록이 사라짐. 마치 "새로 시작"하는 것과 동일.

2. **`resetAll` 시 equity 파라미터 검증.** Engineer의 제안에서 `req.body.equity`를 그대로 받는데, 이 값이 실제 현재 자산과 괴리되면 drawdown 모니터가 완전히 무의미해진다. **반드시 현재 실제 equity를 자동으로 조회하여 사용**해야 하며, 사용자가 임의 값을 입력하지 못하게 해야 한다. API 측에서 `equity` 파라미터를 받지 말고, 대신 `positionManager.getEquity()` 등으로 현재 equity를 내부적으로 조회하는 것이 안전하다.

3. **리셋 후 peak equity 처리.** `resetAll(equity)`를 호출하면 peak = current = equity가 된다. 이후 equity가 이 새 peak 아래로 떨어지면 즉시 drawdown이 다시 계산된다. 이 동작은 정상이지만, 트레이더가 "리셋했더니 바로 또 halt 걸렸다"고 혼란할 수 있다. **리셋 후 일정 유예 기간(grace period, 예: 5분) 동안 drawdown halt를 비활성화**하는 옵션을 고려할 수 있다. 다만 이는 복잡성을 높이므로 v1에서는 생략하고, 대신 UI에서 "리셋 후 즉시 모니터링이 재개됩니다" 경고를 표시하는 것으로 대체한다.

4. **RiskEvent 기록 필수.** 리셋 행위 자체를 `RiskEvent` (severity: 'warning', eventType: 'manual_drawdown_reset')로 기록해야 한다. 추후 감사(audit) 추적에 필수. UI 에이전트의 제안(severity: 'info')보다 **severity: 'warning'**이 적절하다 -- 리스크 한도를 수동으로 해제하는 것은 "정보"가 아닌 "경고" 수준의 행위다.

5. **봇 정지 상태 전제 조건.** `resetAll`은 봇이 정지(stopped) 상태일 때만 허용하는 것이 안전하다. 봇이 활성 상태에서 drawdown 리셋을 하면, 전략이 즉시 새 포지션을 열어 추가 손실을 유발할 수 있다. API에서 `botService.getState() !== 'stopped'`이면 400 에러를 반환하도록 한다. `resetDaily`는 봇 상태 무관하게 허용 가능.

---

## UI/UX 제안서 리뷰

### T1-7: Dashboard 레이아웃 재설계 — ✅ 동의

UI 에이전트의 정보 우선순위 분석이 **트레이딩 의사결정 흐름과 정확히 일치**한다.

트레이더의 시선 흐름:
1. **봇 상태 + 자산** (지금 돈이 얼마이고, 봇이 돌고 있는가?) → Row 1
2. **활성 포지션** (지금 무엇을 들고 있는가? 얼마나 벌고/잃고 있는가?) → Row 2
3. **리스크 상태 + 에쿼티 추이** (위험한 상황인가? 추세는 어떤가?) → Row 3
4. **시그널 + 거래 내역** (무슨 판단이 내려지고 있는가? 과거 거래는?) → Row 4
5. **전략 설정** (일상적으로 보지 않는 설정 정보) → Row 5
6. **심볼 레짐** (참조 정보) → Row 6

제안된 순서는 **"above-the-fold에 행동 가능한 정보를 배치"**하는 금융 대시보드의 기본 원칙에 부합한다. 특히 PositionsTable을 2번째로 올린 것은 올바른 판단이다.

**한 가지 제안**: Row 1에서 BotControlPanel과 AccountOverview를 나란히 배치할 때, **AccountOverview의 총 자산/미실현PnL 숫자를 크게 표시**해야 한다. 현재 AccountOverview가 다른 카드와 동일한 크기의 텍스트를 사용하고 있다면, 핵심 숫자(총 자산, 일일 PnL)를 2~3배 크게 표시하여 한눈에 파악할 수 있게 해야 한다.

---

### T1-8: PositionsTable 수동 청산 버튼 — ⚠️ 조건부 동의

수동 청산 기능 자체는 **반드시 필요**하다. Emergency Stop은 모든 포지션을 전부 정리하는 최후 수단이고, 개별 포지션 수동 관리는 일상 운영에 필수적이다.

**보완 조건**:

1. **부분 청산 지원이 필요하다.** UI 에이전트의 제안은 전체 수량 청산만 지원하는데, 실전에서는 "수익의 절반을 먼저 확보하고 나머지는 런(run)시키기" 패턴이 매우 흔하다. **v1에서는 전체 청산만, v2에서 부분 청산 추가**라는 단계적 접근이 현실적이다. 다만 UI에서 "전체 청산" 임을 명시해야 혼동이 없다.

2. **시장가(Market) 전용이 맞다.** 지정가 청산은 미체결 위험이 있어 긴급 수동 청산의 목적에 맞지 않는다. 수동 청산 버튼은 **시장가 주문만** 실행해야 한다. 지정가 청산이 필요한 경우는 별도의 고급 주문 UI를 만들면 되지만, 현재 Tier 1 범위에서는 시장가만으로 충분하다.

3. **확인 다이얼로그 내용.** UI 에이전트가 제안한 내용(심볼, 방향, 수량, 미실현 PnL)에 추가로:
   - **예상 슬리피지 경고**: "시장가 주문으로 체결되며, 슬리피지가 발생할 수 있습니다"
   - **손실 포지션 추가 경고**: 미실현 PnL이 음수일 경우 빨간 배경 + "이 포지션을 청산하면 약 ${Math.abs(unrealizedPnl)} USDT의 손실이 확정됩니다" 문구
   - **수익 포지션 안내**: 미실현 PnL이 양수일 경우 "약 ${unrealizedPnl} USDT의 수익이 확정됩니다" 문구
   - **전략명 표시**: 어떤 전략이 연 포지션인지 알아야 전략 성과와 연계하여 판단할 수 있다

4. **봇 상태 무관하게 청산 가능해야 한다.** 봇이 정지 상태여도 열려 있는 포지션이 있을 수 있다 (이전 실행에서 미정리). 수동 청산은 봇 상태와 독립적으로 작동해야 한다.

5. **청산 후 포지션 목록 자동 갱신.** UI 에이전트가 `usePositions`의 `refetch` 트리거를 언급했는데, 이것만으로는 부족할 수 있다. 청산 주문이 체결되기까지 수 초가 걸릴 수 있으므로, **청산 버튼 클릭 후 해당 행에 "청산 중..." 상태 표시 -> 체결 확인 후 행 제거/갱신**이 UX상 바람직하다. `closingSymbol` prop이 이 용도인 것으로 보이므로, 적절한 설계다.

---

### T1-9: Socket.io ref-counted lifecycle — ✅ 동의

Engineer 리뷰와 동일한 의견. UI 에이전트의 구현 방안이 깔끔하다. 특히 **cleanup에서 개별 이벤트 리스너를 명시적으로 off() 하는 것**이 중요하다. 현재는 socket 자체를 파괴하므로 리스너 정리가 불필요했지만, ref-count 전환 후에는 socket이 살아있으므로 반드시 명시적 off()가 필요하다.

UI 에이전트의 `getSocket()`이 refCount를 증가시키지 않는 read-only로 변경되는 것에 동의한다. 이 함수를 호출하는 다른 코드가 있다면 acquireSocket/releaseSocket 패턴으로 전환해야 한다.

---

### T1-10: Error Boundary + api-client 에러 래핑 — ⚠️ 조건부 동의

UI 에이전트의 에러 분류(네트워크 에러 / JSON 파싱 실패 / 비즈니스 에러)가 적절하다.

**보완 조건**:

1. **Error Boundary에서 Emergency Stop 버튼 노출이 필수.** Engineer가 이를 명시적으로 요청했고, UI 에이전트의 제안에는 이 부분이 빠져있다. `error.tsx`의 UI에 "긴급 정지" 버튼을 추가하고, **api-client를 우회하여 raw fetch로 호출**해야 한다. 에러 상태에서 api-client 자체가 문제일 수 있기 때문이다.

2. **global-error.tsx도 필요.** UI 에이전트가 언급한 대로 `global-error.tsx`도 생성해야 한다. `error.tsx`는 page 컴포넌트의 에러만 잡고, `layout.tsx` 레벨의 에러는 `global-error.tsx`가 잡는다. Next.js App Router의 에러 경계 계층 구조를 제대로 활용해야 한다.

3. **에러 발생 빈도 제한.** Error Boundary가 같은 에러를 반복해서 표시하면 화면이 깜빡이는 현상이 생길 수 있다. reset 후 동일 에러가 즉시 재발하면, 3회 이상 반복 시 "지속적인 오류가 발생하고 있습니다. 백엔드 서버 상태를 확인하세요." 메시지로 전환하는 것이 좋다.

---

### T1-11: DrawdownMonitor 리셋 UI — ⚠️ 조건부 동의

**보완 조건** (Engineer 리뷰의 T1-11 의견과 동일하며, UI 측에 추가):

1. **`resetDaily`와 `resetAll`을 별도 버튼으로 분리.** 하나의 "리셋" 버튼 + type 파라미터가 아니라, "일일 한도 리셋"과 "전체 리셋" 두 개의 버튼을 제공하되:
   - "일일 한도 리셋": 주황색 버튼, 간단한 확인 다이얼로그 ("일일 손실 한도를 리셋합니다")
   - "전체 리셋": 빨간색 버튼, **2단계 확인** (1단계: 경고 메시지, 2단계: "정말 리셋하시겠습니까? 이 작업은 드로다운 이력을 초기화합니다" + 확인 텍스트 입력 등)

2. **현재 drawdown 수치를 확인 다이얼로그에 표시.** 리셋 전에 "현재 최대 낙폭: X%, 일일 손실: Y USDT"를 보여주어 트레이더가 상황을 정확히 인지한 상태에서 결정하도록 한다.

3. **UI 에이전트의 `riskApi.resetDrawdown(type)` API 설계에서, `type: 'full'`일 때 equity를 프론트엔드에서 보내지 말 것.** (Engineer 리뷰 T1-11 보완 조건 #2 참조) 백엔드에서 현재 equity를 직접 조회하도록 해야 한다.

---

## 종합 의견

### 우선순위 재조정 (Trader 관점)

두 에이전트의 우선순위는 대체로 합리적이나, **Trader 관점에서 약간의 재조정을 제안**한다:

| 순위 | ID | 제목 | Trader 판정 | 사유 |
|------|-----|------|------------|------|
| **1** | **T1-1** | Backtest IndicatorCache 주입 | ✅ 최우선 | 8/18 전략 백테스트 불가 = 전략 검증 체계의 44% 마비 |
| **2** | **T1-2** | Backtest _notifyFill action | ✅ 즉시 | 백테스트 수익률 신뢰도 0. TP/SL 미작동 |
| **3** | **T1-4** | PaperEngine 리스너 누적 | ✅ 즉시 | CircuitBreaker 오작동 = 리스크 관리 무력화 |
| **4** | **T1-8** | 수동 청산 버튼 | ⚠️ 보완 후 | 개별 포지션 관리 불가는 운영 리스크 |
| **5** | **T1-5** | SignalFilter 포지션 카운트 | ⚠️ 보완 후 | 무제한 포지션 오픈 = 자본 과다 노출 |
| **6** | **T1-10** | Error Boundary | ⚠️ 보완 후 | 대시보드 크래시 = 봇 블라인드 운영 |
| **7** | **T1-7** | Dashboard 레이아웃 | ✅ 그대로 | 사용성 대폭 개선, 로직 변경 없음 |
| **8** | **T1-3** | Graceful shutdown | ✅ 그대로 | 데이터 무결성 보장 |
| **9** | **T1-11** | DrawdownMonitor 리셋 | ⚠️ 보완 후 | 필요하나 오남용 방지 장치 필수 |
| **10** | **T1-6** | Sharpe ratio 보정 | ⚠️ 보완 후 | Sortino 추가 필수, 표시 오류이므로 거래 무관 |
| **11** | **T1-9** | Socket ref-count | ✅ 그대로 | 현재 급하지 않으나 확장성 기반 |

### 핵심 메시지

1. **T1-1 + T1-2가 해결되지 않으면 백테스트 기반 전략 선택/비교가 불가능하다.** 이 두 건은 다른 모든 작업보다 선행되어야 한다. 백테스트 결과를 신뢰할 수 없는 상태에서 전략 파라미터를 튜닝하면 과적합(overfitting) 위험이 극도로 높아진다.

2. **T1-4는 paper 트레이딩 환경의 신뢰성을 결정한다.** Paper 모드에서 CircuitBreaker가 오작동하면, 실매매 전환 시 리스크 프로파일이 완전히 달라진다. "Paper에서는 잘 작동했는데 실매매에서 halt가 걸린다" 또는 그 반대 상황이 발생한다.

3. **T1-6의 Sortino Ratio 추가는 전략 비교에 실질적 가치가 있다.** 암호화폐 시장은 상방 변동성이 크므로, Sharpe만으로 전략을 평가하면 상승 추세 전략(TurtleBreakout, MaTrend 등)이 과소평가된다. Sortino와 함께 제시하면 더 균형 잡힌 전략 비교가 가능하다.

4. **T1-11의 resetAll은 반드시 안전장치를 갖춘 후 배포해야 한다.** 리스크 한도를 수동으로 해제하는 기능은 "비상구"이지 "일상 출입구"가 아니다. 봇 정지 상태 전제 조건, equity 자동 조회, RiskEvent 기록(severity: warning)을 모두 갖춘 후에만 배포해야 한다.

### Track 분배 의견

Engineer의 Track 분배 제안에 동의한다:
- **Track A (Backend)**: T1-1, T1-2, T1-3, T1-4, T1-5, T1-11
- **Track C (Frontend)**: T1-7, T1-8, T1-9, T1-10
- **Track B (Metrics)**: T1-6

T1-6의 Sortino Ratio 추가 검증은 내가 담당하겠다. 구현 후 8개 전략(1H, 4H 인터벌)에 대해 보정 전/후 Sharpe + Sortino 비교표를 생성하여 정상 범위 (-1 ~ +3) 내에 있는지 검증하겠다.
