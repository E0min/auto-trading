# Round 2 합의 결정문서

> 생성일: 2026-02-14
> 주제: Tier 0 Safety-Critical (9건)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중. 전 항목 3/3 동의 또는 조건부 동의

---

## 합의 요약

| ID | 이슈 | 합의 수준 | 담당 | 핵심 보완사항 |
|----|------|----------|------|--------------|
| T0-1 | 기본 전략 이름 수정 | 3/3 ✅ | Backend | -- |
| T0-2 | Position sizing 변환 파이프라인 | 3/3 ⚠️ | Backend | CLOSE 시그널 스킵, floorToStep, null 반환 |
| T0-3 | Multi-symbol Set 기반 전환 | 3/3 ⚠️ | Backend | Phase 1: 전략당 1심볼 제한 |
| T0-4 | Crash handler 추가 | 2✅+1⚠️ | Backend | io.emit try-catch, constants.js 등록 |
| T0-5 | Per-symbol mutex 추가 | 2✅+1⚠️ | Backend | Promise 체이닝, 30초 타임아웃 |
| T0-6 | Equity=0 division guard | 3/3 ✅ | Backend | riskEngine 레벨 조기 차단 추가 |
| T0-7 | Emergency Stop 확인 다이얼로그 | 1✅+2⚠️ | Frontend | 체크박스 확인, 포지션 정보 표시 |
| T0-8 | Risk Alert Banner | 1✅+2⚠️ | Frontend | 자동 해제 규칙, CIRCUIT_RESET 처리 |
| T0-9 | Live/Paper 모드 배너 | 1✅+2⚠️ | Frontend | emerald/red, LIVE 봇 시작 확인 |

---

## 항목별 상세 합의

### T0-1: 기본 전략 이름 수정

**합의: 3/3 동의 — 즉시 실행**

- `botService.js`의 `DEFAULT_STRATEGIES`를 `['RsiPivot', 'MaTrend', 'BollingerReversion', 'Supertrend', 'TurtleBreakout']`으로 교체
- 5개 레짐 커버, indicator-light 4개 + price-action 1개, 전략 간 상관관계 낮음
- `sampleStrategies.js` 삭제하지 않음 (backward compat)

---

### T0-2: Position Sizing 변환 파이프라인

**합의: 3/3 조건부 동의 — 보완 후 즉시 실행**

핵심 구현:
1. `botService.js`에 `_resolveSignalQuantity(signal)` 메서드 추가
2. equity 조회 → percentage → notional → qty 변환 파이프라인

**합의된 보완사항 (5건)**:

| # | 내용 | 제기자 | 동의 |
|---|------|--------|------|
| 1 | **CLOSE 시그널은 percentage 변환 스킵** — close_long/close_short는 보유 수량 기반으로 처리 | Trader+Engineer | 3/3 |
| 2 | **parseFloat 금지** — `mathUtils.floorToStep(value, step)` 추가하여 문자열 연산으로 lot precision 처리 | Engineer | 3/3 |
| 3 | **반환값은 null** (qty 계산 불가 시) — '0'이 아닌 null로 반환하여 명시적 스킵 | Trader+UI | 3/3 |
| 4 | **signal handler 공통화** — `_handleStrategySignal()` 메서드로 추출하여 start()와 enableStrategy() 중복 방지 | Engineer | 2/3 |
| 5 | **시그널 피드에 변환 결과 표시** — positionSizePercent, resolvedQty, equity를 시그널 데이터에 포함 | UI | 2/3 |

**`positionSizing` 메타데이터 분기 제거** — 현재 18개 전략 모두 percentage 방식이므로 불필요한 분기 없이 단순하게 모든 OPEN 시그널에 변환 적용 (Trader 제안, 3/3 동의)

---

### T0-3: Multi-symbol Routing (Set 기반)

**합의: 3/3 조건부 동의 — 보완 후 즉시 실행**

핵심 구현:
1. `strategyBase.js`의 `_symbol` → `_symbols: Set` 전환
2. `addSymbol()`, `removeSymbol()`, `hasSymbol()`, `getSymbols()` API
3. `emitSignal()` symbol 폴백 체인: `signalData.symbol || this._currentProcessingSymbol || this._symbol`

**합의된 보완사항 (4건)**:

| # | 내용 | 제기자 | 동의 |
|---|------|--------|------|
| 1 | **Phase 1: 전략당 1심볼만 허용** — priceHistory/indicatorState 심볼 혼재 방지. Phase 2에서 Map\<symbol, state\> 패턴으로 분리 | Trader+Engineer | 3/3 |
| 2 | **Engineer의 `_currentProcessingSymbol` 패턴 채택** — `_setCurrentProcessingSymbol()` + `getCurrentSymbol()` 캡슐화. Trader의 직접 할당보다 안전 | Engineer+UI | 3/3 |
| 3 | **`getSymbolRegime(symbol)` 파라미터 오버로드 추가** — 명시적 symbol 전달 가능하도록 | Engineer | 2/3 |
| 4 | **StrategyInfo 타입에 `symbols: string[]` 추가** — 프론트엔드 동기화, `symbol: string`도 backward compat 유지 | UI | 3/3 |

---

### T0-4: Crash Handler (unhandledRejection/uncaughtException)

**합의: 2/3 동의 + 1 조건부 — 즉시 실행**

핵심 구현 (Engineer 방식 채택):
1. `isShuttingDown` 플래그로 중복 shutdown 방지
2. `safeShutdown()`으로 SIGTERM/SIGINT/uncaughtException 통합
3. `unhandledRejection`: 로그 + risk alert (프로세스 유지)
4. `uncaughtException`: graceful shutdown + 강제 exit 타이머
5. `forceExitTimer.unref()`

**합의된 보완사항 (2건)**:

| # | 내용 | 제기자 | 동의 |
|---|------|--------|------|
| 1 | **unhandledRejection에서도 io.emit을 try-catch로 감싸기** | Engineer | 3/3 |
| 2 | **`risk:unhandled_error`를 constants.js RISK_EVENTS에 등록** + 프론트엔드 SOCKET_EVENTS 동기화 | Engineer+UI | 3/3 |

---

### T0-5: OrderManager Per-symbol Mutex

**합의: 2/3 동의 + 1 조건부 — 즉시 실행**

핵심 구현 (Engineer Promise 체이닝 방식 채택):
```javascript
async submitOrder(signal) {
  const { symbol } = signal;
  const prev = this._symbolLocks.get(symbol) || Promise.resolve();
  let releaseLock;
  const current = new Promise(resolve => { releaseLock = resolve; });
  this._symbolLocks.set(symbol, current);
  try {
    await prev;
    return await this._submitOrderInternal(signal);
  } finally {
    releaseLock();
    if (this._symbolLocks.get(symbol) === current) {
      this._symbolLocks.delete(symbol);
    }
  }
}
```

**합의된 보완사항 (1건)**:

| # | 내용 | 제기자 | 동의 |
|---|------|--------|------|
| 1 | **30초 타임아웃 가드 추가** — API hang 시 무한 대기 방지. `Promise.race` 사용 | Engineer | 3/3 |

---

### T0-6: ExposureGuard Equity=0 Division Guard

**합의: 3/3 동의 — 즉시 실행**

핵심 구현:
1. `exposureGuard.js`: equity=0/null/undefined early return guard
2. `riskEngine.validateOrder()` 최상단에도 equity=0 조기 차단 (defense-in-depth)

```javascript
// riskEngine.validateOrder() 최상단
if (!this.accountState.equity || this.accountState.equity === '0') {
  return { approved: false, reason: 'equity_not_initialized' };
}
```

---

### T0-7: Emergency Stop ConfirmDialog

**합의: 1/3 동의 + 2 조건부 — 보완 후 즉시 실행**

핵심 구현:
1. **별도 `EmergencyStopDialog` 컴포넌트 생성** (범용 ConfirmDialog 오버로드 X)
2. **체크박스 확인 방식** — "모든 미체결 주문이 취소되고 리스크 관리가 중단됨을 확인합니다"
3. **3초 카운트다운 없음** (UI 반대: 긴급성과 모순)

**다이얼로그 구조 (합의)**:
```
[!] 긴급 정지
---
현재 열린 포지션: {N}건
총 미실현 PnL: {금액}

"모든 미체결 주문이 취소되고 봇이 즉시 정지됩니다.
열린 포지션은 자동 청산되지 않으며, 수동으로 관리해야 합니다.
리스크 관리(서킷 브레이커, 드로다운 모니터)가 중단됩니다."

[ ] 위 내용을 확인하였습니다

      [취소]  [긴급 정지 실행]  ← 체크 전 비활성화
```

- `role="alertdialog"`, `aria-modal="true"`, 포커스 트래핑 (UI)
- 포지션 데이터: `usePositions()` 훅에서 조회 (UI)

---

### T0-8: Risk Alert Banner

**합의: 1/3 동의 + 2 조건부 — 보완 후 즉시 실행**

핵심 구현:
1. `RiskAlertBanner` 신규 컴포넌트 (severity 기반 스타일링)
2. `useRiskEvents` 훅 + `riskApi` 클라이언트 네임스페이스

**합의된 자동 해제 규칙**:

| 심각도 | 이벤트 유형 | 해제 방식 |
|--------|-----------|----------|
| critical | HALT, CIRCUIT_BREAK | 수동 해제만 (acknowledge API) |
| warning | DRAWDOWN_WARNING, EXPOSURE_ADJUSTED | 30초 후 자동 축소, 클릭 시 재확장 |
| info | CIRCUIT_RESET | 10초 후 자동 해제 |

**추가 합의사항**:
- CIRCUIT_RESET 수신 시 기존 circuit_break 배너 자동 dismiss (Engineer)
- `exposure_adjusted` 이벤트도 배너 표시 (Trader)
- 스택킹: 최고 심각도만 배너, 나머지 "N건 더" 링크 (UI)
- `role="alert"`, `aria-live="assertive"` (UI)
- RiskEvent 타입은 Engineer의 MongoDB 스키마에 맞춤

**RiskEvent MongoDB 스키마 보완**:
- `riskSnapshot`에 `openPositionCount: Number` 추가 (Trader)
- `riskSnapshot`에 `peakEquity: String` 추가 (Trader)
- `{ sessionId: 1, createdAt: -1 }` 인덱스 추가 (Engineer)

---

### T0-9: Live/Paper 모드 시각적 경고

**합의: 1/3 동의 + 2 조건부 — 보완 후 즉시 실행**

핵심 구현:
1. `TradingModeBanner` 신규 컴포넌트

**합의된 색상 체계**:

| 모드 | 배경 | 텍스트 | 강도 |
|------|------|--------|------|
| LIVE | `bg-red-600/90` | "LIVE TRADING - 실제 자금 거래 중" | 강 (animate-ping dot) |
| PAPER | `bg-emerald-600/30 border-b border-emerald-500/20` | "PAPER TRADING" | 약 (기본 상태) |

**추가 합의사항**:
- LIVE 모드 봇 시작 시 별도 확인 다이얼로그 필요 (Trader + UI)
- 로딩 중 기본값 `paper` (안전 방향 fallback) (Engineer)
- 배너 위치: `page.tsx` 헤더 위 (layout.tsx 아님, 백테스트/토너먼트 불필요) (UI)

---

## 아키텍처 결정 (Round 2)

### AD-7: Position Sizing 세부 설계
- **결정**: CLOSE 시그널은 percentage 변환 스킵, OPEN 시그널만 equity-based 변환 적용
- **반환값**: 변환 실패 시 `null` 반환 ('0'은 유효 qty로 오해 가능)
- **parseFloat 금지**: `mathUtils.floorToStep(value, step)` 추가로 문자열 연산 유지
- **근거**: Trader(CLOSE 예외) + Engineer(parseFloat 금지) + UI(null 반환 권장)

### AD-8: Multi-symbol Phase 1 제한
- **결정**: Phase 1에서 **전략당 1심볼만 허용**
- **Phase 2 과제**: `Map<symbol, state>` 패턴으로 전략 내부 상태 심볼별 분리
- **근거**: 기존 전략의 스칼라 상태(priceHistory, entryPrice 등)가 심볼 혼재 시 오염 (Trader+Engineer 동의)

### AD-9: Mutex 구현 패턴
- **결정**: Promise 체이닝 방식 (Engineer 제안)
- **Trader의 while-loop 방식 기각**: ABA 문제 + 무한 대기 위험
- **30초 타임아웃 필수**: API hang 대비
- **근거**: 체이닝 기반은 순서 보장 + race condition 없음

### AD-10: Emergency Stop UX
- **결정**: 체크박스 확인 방식 (UI 제안)
- **Trader의 3초 카운트다운 기각**: Emergency Stop은 긴급 상황, 대기 시간은 긴급성과 모순
- **별도 컴포넌트**: `EmergencyStopDialog` (범용 ConfirmDialog 오버로드 X)
- **필수 정보**: 포지션 수 + 미실현 PnL + "수동 관리 필요" 명시

### AD-11: Risk Alert 자동 해제 규칙
- **결정**: 심각도 3단계 (critical=수동, warning=30초, info=10초)
- **CIRCUIT_RESET 연동**: circuit_break 배너 자동 dismiss
- **근거**: critical 이벤트는 트레이더의 명시적 인지 필요, info는 자동 정리

### AD-12: Mode Banner 디자인
- **결정**: LIVE=red 강조, PAPER=emerald 은은
- **Trader의 amber 기각**: amber는 "경고" 의미, Paper는 안전 상태이므로 부적절
- **기본값 paper**: 로딩 중 "LIVE" 오표시 방지 (Engineer)
- **위치**: page.tsx 헤더 위 (백테스트/토너먼트 페이지 불필요)

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| T0-2 반환값 (null vs '0') | null | '0' | null 권장 | **null** |
| T0-3 심볼 설정 패턴 | _symbol 직접 할당 | _currentProcessingSymbol | Engineer 권장 | **Engineer 패턴** |
| T0-4 중복 셧다운 가드 | 별도 없음 | isShuttingDown | Engineer 동의 | **isShuttingDown** |
| T0-5 Mutex 패턴 | while-loop | Promise 체이닝 | - | **Promise 체이닝** |
| T0-7 확인 방식 | 3초 카운트다운 | - | 체크박스 | **체크박스** |
| T0-9 Paper 색상 | amber | - | emerald | **emerald** |

---

## 구현 순서 (통합)

UI 제안의 Phase 분류를 기반으로, 의존성 DAG를 반영한 통합 일정:

```
Phase 1 (병렬, 의존성 없음):
  [Backend]  T0-6 ExposureGuard guard + riskEngine 조기 차단
  [Backend]  T0-4 Crash handler (isShuttingDown + safeShutdown)
  [Backend]  T0-1 DEFAULT_STRATEGIES 상수 교체
  [Backend]  RiskEvent MongoDB 모델 + API 라우트 생성
  [Frontend] T0-7 EmergencyStopDialog 컴포넌트
  [Frontend] T0-9 TradingModeBanner 컴포넌트

Phase 2 (Phase 1 완료 후):
  [Backend]  T0-3 Multi-symbol Set 기반 (전략당 1심볼 제한)
  [Backend]  mathUtils.floorToStep() + isZero() 추가
  [Frontend] StrategyInfo 타입 변경 (symbols: string[])

Phase 3 (Phase 2 완료 후):
  [Backend]  T0-2 Position sizing (_resolveSignalQuantity + _handleStrategySignal)
  [Backend]  T0-5 Mutex (Promise 체이닝 + 30초 타임아웃)
  [Frontend] T0-8 RiskAlertBanner + useRiskEvents + riskApi

Phase 4 (통합):
  [Backend]  RiskEngine → RiskEvent 기록 통합
  [Frontend] LIVE 모드 봇 시작 확인 다이얼로그 (BotControlPanel)
  [Frontend] constants.js ↔ SOCKET_EVENTS 동기화
```

### 트랙 배정
- **Track A (Backend)**: T0-1, T0-2, T0-3, T0-4, T0-5, T0-6 + RiskEvent 모델 + mathUtils 추가 + Risk API
- **Track C (Frontend)**: T0-7, T0-8, T0-9 + 타입 변경 + riskApi + LIVE 확인 다이얼로그

---

## 양 제안서에 누락되었으나 리뷰에서 추가된 사항

| 항목 | 제기자 | 통합 대상 |
|------|--------|----------|
| `risk:unhandled_error` 소켓 이벤트 상수 등록 | Engineer+UI | T0-4 |
| 시그널 스킵 피드백 (`signal_skipped` 이벤트 or DB status) | UI | T0-2 |
| `riskApi` 클라이언트 네임스페이스 | UI | T0-8 |
| EmergencyStopDialog 접근성 (role, aria, focus trap) | UI | T0-7 |
| RiskAlertBanner 접근성 (role, aria-live) | UI | T0-8 |
| RiskEvent riskSnapshot에 openPositionCount, peakEquity 추가 | Trader | T0-8 모델 |
| RiskEvent sessionId 인덱스 추가 | Engineer | T0-8 모델 |
| mathUtils.isZero() 존재 확인/추가 | Engineer | T0-2 |
| paperPositionManager.getEquity() 반환 타입 확인 | Engineer | T0-2 |

---

*이 문서는 3명의 전문 에이전트(Trader, Engineer, UI/UX)의 Round 2 제안서와 교차 리뷰를 기반으로 합성되었다. 전 9건 Tier 0 항목에 대해 3/3 동의(또는 조건부 동의)가 달성되었으며, 6건의 아키텍처 결정(AD-7~AD-12)이 추가되었다.*
