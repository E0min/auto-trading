# Round 3 합의 결정문서

> 생성일: 2026-02-14
> 주제: Tier 1 Reliability (11건)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | Track |
|----|------|----------|------|-------|
| T1-1 | Backtest IndicatorCache 주입 (8/18 전략 크래시) | 3/3 동의 | Backend | A |
| T1-2 | Backtest _notifyFill() action+symbol 필드 추가 | 3/3 동의 | Backend | A |
| T1-3 | Graceful shutdown 순서 수정 (DB write→WS close) | 3/3 동의 | Backend | A |
| T1-4 | PaperEngine 리스너 누적 제거 (bind+removeListener) | 3/3 동의 | Backend | A |
| T1-5 | SignalFilter.updatePositionCount() 연동 + paper strategy 필드 | 3/3 조건부 동의 | Backend | A |
| T1-6 | Sharpe ratio 연간화 정규화 (interval 기반 periodsPerYear) | 3/3 동의 | Backend | A |
| T1-7 | Dashboard 레이아웃 재설계 (정보 우선순위 정상화) | 3/3 동의 | Frontend | C |
| T1-8 | PositionsTable 수동 청산 버튼 (시장가 전체 청산) | 3/3 동의 | Frontend | C |
| T1-9 | Socket.io ref-counted lifecycle 전환 | 3/3 동의 | Frontend | C |
| T1-10 | Error Boundary + api-client 에러 래핑 + EmergencyStop | 3/3 동의 | Frontend | C |
| T1-11 | DrawdownMonitor 수동 리셋 API + UI 버튼 | 3/3 동의 | Backend+Frontend | A+C |

---

## 구현 가이드

### T1-1: Backtest IndicatorCache 주입 — CRITICAL

**합의**: Option A (Lightweight Stub). `_compute()` 로직을 IndicatorCache에서 static 유틸 함수로 추출하여 BacktestIndicatorCache와 공유.

**구현 세부사항**:
1. `indicatorCache.js`에서 `_compute()` 로직(rsi, atr, bb, macd 등 11개 지표)을 static 메서드 또는 별도 유틸로 추출
2. `backtestEngine.js`에 `BacktestIndicatorCache` 클래스 생성:
   - `feedKline(symbol, kline)` — 매 kline마다 호출, symbol 자동 주입
   - `get(symbol, indicator, params)` — 추출된 `_compute()` 위임
   - `getHistory(symbol)` — `{ klines, closes, highs, lows, volumes }` 반환
   - MAX_HISTORY = 500 트리밍 (실제 IndicatorCache와 동일)
   - String 변환 필수 (`String(kline.close)` 등 — IndicatorCache._handleKline과 동일)
3. `_createStrategy()`에서 `strategy.setIndicatorCache(this._backtestCache)` 호출
4. 메인 루프에서 kline feed 순서: `feedKline() → onKline()`

**영향**: 8/18 전략 백테스트 정상화 (RsiPivot, Grid, Bollinger, Vwap, Macd, QuietRangeScalp, Breakout, AdaptiveRegime)

**파일**: `backend/src/backtest/backtestEngine.js`, `backend/src/services/indicatorCache.js`

---

### T1-2: Backtest _notifyFill() action+symbol 필드 추가 — CRITICAL

**합의**: 시그니처를 `_notifyFill(side, price, action)`으로 변경, fill 객체에 `{ side, price, action, symbol }` 포함.

**구현 세부사항**:
```javascript
// _notifyFill 시그니처 변경
_notifyFill(side, price, action) {
  if (typeof this._strategy.onFill === 'function') {
    try {
      this._strategy.onFill({ side, price, action, symbol: this.symbol });
    } catch (err) { ... }
  }
}

// 호출부 4곳 수정
// _openLong:   this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.OPEN_LONG);
// _openShort:  this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.OPEN_SHORT);
// _closeLong:  this._notifyFill('sell', fillPrice, SIGNAL_ACTIONS.CLOSE_LONG);
// _closeShort: this._notifyFill('buy', fillPrice, SIGNAL_ACTIONS.CLOSE_SHORT);
```

**영향**: 16/18 전략의 백테스트 포지션 추적 정상화 (TP/SL 작동)
**파일**: `backend/src/backtest/backtestEngine.js`

---

### T1-3: Graceful Shutdown 순서 수정

**합의**: BotSession DB write를 WS close보다 먼저 실행. 500ms flush 대기 추가.

**구현 세부사항**:
1. `botService.stop()` 내부: session save → exchangeClient.closeWebsockets() (순서 교체)
2. `app.js safeShutdown()` 순서 재정렬:
   - Phase 1: io.emit 서버 종료 알림 (fire-and-forget)
   - Phase 2: botService.stop() (DB writes 포함)
   - Phase 3: 500ms flush 대기
   - Phase 4: server.close() (HTTP)
   - Phase 5: mongoose.disconnect() (MongoDB)
   - Phase 6: io.close() (Socket.io — 마지막)
3. forceExit 타이머 10초 유지

**파일**: `backend/src/app.js`, `backend/src/services/botService.js`

---

### T1-4: PaperEngine 리스너 누적 제거

**합의**: 바인드된 핸들러를 인스턴스 프로퍼티에 저장, setPaperMode() 시 이전 리스너 제거.

**구현 세부사항**:
```javascript
// orderManager.js
setPaperMode(paperEngine, paperPositionManager) {
  // 이전 리스너 제거
  if (this._paperEngine && this._paperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
  }
  this._paperMode = true;
  this._paperEngine = paperEngine;
  this._paperPositionManager = paperPositionManager;
  this._paperFillHandler = (fill) => {
    this._handlePaperFill(fill).catch(err => { ... });
  };
  this._paperEngine.on('paper:fill', this._paperFillHandler);
}

setLiveMode() {
  if (this._paperEngine && this._paperFillHandler) {
    this._paperEngine.removeListener('paper:fill', this._paperFillHandler);
    this._paperFillHandler = null;
  }
  this._paperMode = false;
  this._paperEngine = null;
  this._paperPositionManager = null;
}
```

**영향**: paper↔live 전환 반복 시 CircuitBreaker 오동작 방지
**파일**: `backend/src/services/orderManager.js`

---

### T1-5: SignalFilter.updatePositionCount() 연동

**합의**: ORDER_FILLED 이벤트 기반, paper mode에서 strategy 필드 추가가 선행 조건.

**구현 세부사항**:
1. **선행 작업**: `paperPositionManager._openPosition()`에 `strategy` 필드 추가
   - position 객체에 `strategy: fill.strategy || 'unknown'` 포함
   - fill 체인에서 strategy 전달 보장 (botService → orderManager → paperEngine → fill)
2. botService.start()에서 이벤트 와이어링:
   - ORDER_FILLED, ORDER_CANCELLED 이벤트에서 `updateFilterCounts()` 호출
   - `process.nextTick()` 또는 `setImmediate()`로 한 틱 지연 (positionManager 상태 반영 보장)
   - 초기 카운트: 전략 활성화 완료 후 1회 호출
3. paper 모드에서는 `paperPositionManager.getPositions()` 사용

**영향**: maxConcurrentPositions 제한 실효성 확보
**파일**: `backend/src/services/botService.js`, `backend/src/services/paperPositionManager.js`

---

### T1-6: Sharpe Ratio 연간화 정규화

**합의**: interval 기반 periodsPerYear 매핑. Sortino Ratio는 이번 범위 밖 (후속 라운드).

**구현 세부사항**:
1. `computeMetrics()` 시그니처에 `interval` 파라미터 추가:
   ```javascript
   function computeMetrics({ trades, equityCurve, initialCapital, interval = '1D' })
   ```
2. `_getPeriodsPerYear(interval)` 매핑 함수 추가:
   ```javascript
   const CANDLES_PER_YEAR = {
     '1m': 525600, '3m': 175200, '5m': 105120, '15m': 35040,
     '30m': 17520, '1H': 8760, '4H': 2190, '6H': 1460,
     '12H': 730, '1D': 365, '1W': 52
   };
   ```
3. Sharpe 연간화: `sqrt(candlesPerYear)` 사용 (기존 `sqrt(365)` 대체)
4. 호출부 수정:
   - `backtestRoutes.js`: `interval: result.config.interval` 전달
   - `runAllBacktest.js`: 동일 처리

**파일**: `backend/src/backtest/backtestMetrics.js`, `backend/src/api/backtestRoutes.js`, `backend/scripts/runAllBacktest.js`

---

### T1-7: Dashboard 레이아웃 재설계

**합의**: 정보 우선순위 기반 재배치. 로직 변경 없음.

**새 레이아웃 순서**:
```
Row 0: TradingModeBanner + RiskAlertBanner (최상단 고정)
Row 1: BotControlPanel + AccountOverview (grid 1:1)
Row 2: PositionsTable (전체 너비 — above-the-fold)
Row 3: RiskStatusPanel + EquityCurveChart (grid 1:2)
Row 4: SignalFeed + TradesTable (grid 1:2)
Row 5: StrategyHub (전체 너비 — 설정성 정보)
Row 6: SymbolRegimeTable (전체 너비 — 참조 정보)
```

**파일**: `frontend/src/app/page.tsx`

---

### T1-8: PositionsTable 수동 청산 버튼

**합의**: 시장가 전체 청산. 부분 청산은 후속 라운드. ConfirmDialog에 PnL 경고 포함.

**구현 세부사항**:
1. PositionsTable에 "청산" 컬럼 추가 (9번째)
2. Props 확장: `onClosePosition?: (pos) => Promise<void>`, `closingSymbol?: string | null`
3. ConfirmDialog 내용:
   - 심볼, 방향, 수량, 미실현 PnL 표시
   - 손실 포지션: 빨간 배경 + "이 포지션을 시장가로 청산하면 약 $XX의 손실이 확정됩니다"
   - 수익 포지션: "약 $XX의 수익이 확정됩니다"
4. `tradeApi.submitOrder({ action: 'close_long'|'close_short', symbol, qty, orderType: 'market' })`
5. 청산 중 Spinner + 다른 행 disabled
6. 봇 상태 무관하게 청산 가능

**파일**: `frontend/src/components/PositionsTable.tsx`, `frontend/src/app/page.tsx`

---

### T1-9: Socket.io ref-counted lifecycle

**합의**: acquireSocket()/releaseSocket() 패턴. getSocket()은 read-only (refCount 미변경).

**구현 세부사항**:
1. `socket.ts`:
   - `acquireSocket()`: refCount++, 소켓 없으면 생성
   - `releaseSocket()`: refCount--, 0이면 disconnect
   - `getSocket()`: 현재 소켓 반환 (refCount 미변경, `Socket | null`)
2. `useSocket.ts`:
   - mount: `acquireSocket()` → 이벤트 리스너 등록 (named functions)
   - unmount: `socket.off(event, handler)` 개별 해제 → `releaseSocket()`
3. 개발 모드에서 refCount 로깅 (디버깅용)

**파일**: `frontend/src/lib/socket.ts`, `frontend/src/hooks/useSocket.ts`

---

### T1-10: Error Boundary + api-client 에러 래핑

**합의**: error.tsx + global-error.tsx 생성. ApiError 클래스. EmergencyStop 버튼은 raw fetch() 사용.

**구현 세부사항**:
1. `app/error.tsx`:
   - 에러 메시지 표시 + 재시도 버튼 + 대시보드 링크
   - **긴급 정지 버튼 필수** — `fetch('/api/bot/emergency-stop', { method: 'POST' })` 직접 호출
   - api-client 우회 (Error Boundary 상태에서 api-client가 에러 원인일 수 있음)
2. `app/global-error.tsx`: layout 레벨 에러 처리 (동일 패턴)
3. `api-client.ts` 리팩토링:
   ```typescript
   class ApiError extends Error {
     constructor(message: string, public statusCode: number, public endpoint: string, public isNetworkError: boolean = false) { ... }
   }
   ```
   - fetch() 실패 → ApiError(isNetworkError: true)
   - res.json() 실패 → ApiError(status)
   - !res.ok || !json.success → ApiError(status)

**파일**: `frontend/src/app/error.tsx` (신규), `frontend/src/app/global-error.tsx` (신규), `frontend/src/lib/api-client.ts`

---

### T1-11: DrawdownMonitor 수동 리셋 API + UI 버튼

**합의**: equity 선택적 (없으면 accountState.equity 자동 사용). resetDaily/resetAll 별도 분리. severity: warning.

**Backend 구현**:
1. `riskEngine.js`에 `resetDrawdown(equity)` 메서드:
   - equity 없으면 `this.accountState.equity` 사용
   - `this.drawdownMonitor.resetAll(equity)` 호출
   - RiskEvent 기록 (eventType: 'drawdown_reset', severity: 'warning')
   - `RISK_EVENTS.DRAWDOWN_RESET` emit
2. `riskRoutes.js`에 `POST /api/risk/drawdown/reset`:
   - body: `{ type: 'daily' | 'full' }`
   - type='daily': `riskEngine.resetDaily()`
   - type='full': `riskEngine.resetDrawdown()` (equity 자동 조회)
   - **resetAll은 봇 정지 상태에서만 허용** (botService.getState() !== 'stopped' → 400)
3. `constants.js`에 `DRAWDOWN_RESET` 이벤트 추가
4. `app.js` Socket.io forward에 DRAWDOWN_RESET 포함

**Frontend 구현**:
1. `RiskStatusPanel.tsx`: 드로다운 할트 시 "일일 한도 리셋" (주황) + "전체 리셋" (빨간) 2개 버튼
2. 전체 리셋: EmergencyStopDialog 수준 2단계 확인 (체크박스 + 실행)
3. 확인 다이얼로그에 현재 드로다운 수치 표시
4. `api-client.ts`에 `riskApi.resetDrawdown(type)` 추가

**파일**: `backend/src/services/riskEngine.js`, `backend/src/api/riskRoutes.js`, `backend/src/utils/constants.js`, `backend/src/app.js`, `frontend/src/components/RiskStatusPanel.tsx`, `frontend/src/lib/api-client.ts`

---

## 아키텍처 결정

### AD-13: BacktestIndicatorCache 코드 공유 전략
- **결정**: IndicatorCache의 `_compute()` 로직을 static 유틸 함수로 추출하여 BacktestIndicatorCache와 공유. 코드 중복을 방지하여 지표 계산 결과의 동일성 보장.
- **근거**: Trader — 백테스트와 실매매 간 1비트라도 다르면 전략 검증 근거 무효. Engineer — 유지보수 비용 방지.

### AD-14: Socket.io getSocket() 의미 규정
- **결정**: `getSocket()`은 refCount에 영향 없는 read-only 접근. `acquireSocket()`/`releaseSocket()`만 lifecycle 관리.
- **근거**: Engineer — getSocket()이 refCount를 증가시키면 대응하는 release가 없어 leak 발생. UI — 기존 코드 호환성.

### AD-15: Error Boundary 긴급 정지 패턴
- **결정**: Error Boundary(error.tsx, global-error.tsx) 내 긴급 정지 버튼은 api-client를 우회하여 `fetch()` 직접 호출.
- **근거**: Engineer + Trader — Error Boundary 상태는 api-client 자체가 에러 원인일 수 있으므로, 독립적 HTTP 호출이 안전.

### AD-16: DrawdownMonitor 리셋 안전장치
- **결정**: resetAll은 봇 정지 상태에서만 허용. equity는 서버측 자동 조회 (프론트에서 전송하지 않음). 리셋 행위는 RiskEvent(severity: warning)로 감사 기록.
- **근거**: Trader — 봇 활성 중 리셋 시 전략이 즉시 새 포지션 오픈 가능. UI — equity 입력 UX 복잡도 불필요.

### AD-17: Sortino Ratio 범위 결정
- **결정**: T1-6 범위는 Sharpe 정규화로 한정. Sortino Ratio는 후속 라운드(Tier 2+)에서 별도 추가.
- **근거**: Engineer — 범위 확대 방지. Trader — 필요성 인정하나 구현 우선순위 준수.

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| T1-1 방식 | Option A (Stub) | Option A (Stub) | 동의 | **Option A 채택** |
| T1-4 우선순위 | 7위 | 3위 | 동의(Engineer) | **상위 배치** (T1-2 직후) |
| T1-5 paper strategy 필드 | 경고 | 선행 조건 확인 | 보완 요청 | **T1-5 scope에 포함** |
| T1-6 Sortino 추가 | 필수 | 범위 밖 | 동의(Trader) | **후속 라운드로 분리** (AD-17) |
| T1-9 getSocket() | read-only 동의 | ⚠️ 원래 refCount 증가 | read-only | **read-only 채택** (AD-14) |
| T1-10 EmergencyStop | 필수 (fetch) | 필수 (fetch) | 리뷰 후 동의 | **fetch() 직접 호출** (AD-15) |
| T1-11 equity 파라미터 | 선택 (자동 조회) | 필수 | 선택 (Trader 방식) | **선택 채택** (AD-16) |
| T1-11 severity | warning | warning | info → warning 수정 | **warning** |

---

## 구현 순서

### Track A (Backend — 7건)
```
T1-2 (5분) → T1-4 (10분) → T1-1 (40분) → T1-5 (25분) → T1-3 (15분) → T1-6 (15분) → T1-11 BE (15분)
```
- T1-2: 가장 간단, 즉시 효과
- T1-4: 간단하지만 CircuitBreaker 오동작 방지
- T1-1: 복잡도 높으므로 조기 착수
- T1-5: T1-1 이후 (paper strategy 필드 추가 포함)
- T1-3: 독립적, 순서 무관
- T1-6: 독립적, interval 파라미터 전달
- T1-11: API + RiskEngine 메서드

### Track C (Frontend — 5건)
```
T1-10 (30분) → T1-9 (20분) → T1-8 (25분) → T1-7 (20분) → T1-11 FE (15분)
```
- T1-10: 안전망 확보 (다른 작업 중 에러 대비)
- T1-9: 인프라 안정화
- T1-8: 운영 안전성
- T1-7: 레이아웃 재배치 (로직 변경 없음)
- T1-11: Track A API 완성 후 연결

### 의존성
- T1-11 FE → T1-11 BE (API 선행)
- T1-5 → paper strategy 필드 추가 (T1-5 scope 내)
- Track A / Track C 간 의존성 없음 (병렬 실행 가능)

---

## 다음 단계

1. Phase 4: 사용자 승인 후 Track A + Track C 병렬 구현
2. T1-1 + T1-2 구현 후 백테스트 sanity check (RSI Pivot 1H 기준)
3. 모든 구현 완료 후 BACKLOG 상태를 `done`으로 업데이트
