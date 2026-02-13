# Round 2 Review -- Senior UI/UX Engineer

> Author: Senior UI/UX Engineer Agent
> Date: 2026-02-14
> Target: Trader Agent Round 2 Proposal, Engineer Agent Round 2 Proposal
> Perspective: UX/Frontend Expert Review

---

## Trader Agent Proposal Review

### T0-1: Default Strategy Names Fix

**✅ 동의**

5개 기본 전략 선정과 `DEFAULT_STRATEGIES` 상수 방식은 합리적이다. 프론트엔드 관점에서 `StrategyPanel.tsx`와 `StrategyHub.tsx`는 백엔드 `/api/bot/strategies` 응답을 있는 그대로 렌더링하므로 추가 프론트엔드 변경은 불필요하다.

---

### T0-2: Position Sizing -- percentage -> quantity conversion

**⚠️ 조건부 동의**

변환 파이프라인 자체는 필수이며 방향이 올바르다. 그러나 UX 개선이 필요하다.

**보완 1 -- 시그널 피드에 변환 결과 표시**

현재 `SignalFeed.tsx`는 `suggestedQty`를 그대로 표시한다. T0-2 이후 사용자가 표시값이 퍼센트인지 실제 수량인지 혼동할 수 있다. 시그널 피드에 추가 표시 필요:
- **원래 요청**: `positionSizePercent: 5%`
- **변환된 수량**: `resolvedQty: 0.0083 BTC`
- **변환에 사용된 equity**: `equity: $10,000`

**보완 2 -- equity=0으로 인한 거부 시 사용자 알림**

`_resolveQuantity()`가 null을 반환하여 시그널이 스킵되면 사용자는 피드백을 전혀 받지 못한다. 최소한:
- `trade:signal_skipped` Socket.io 이벤트 emit → 프론트엔드 시그널 피드에 "Skipped" 상태 표시
- 또는 Signal DB에 `status: 'skipped'`, `skipReason: 'equity_zero'` 기록

---

### T0-3: Multi-symbol Routing -- Set-based symbol management

**⚠️ 조건부 동의**

Set 기반 전환은 아키텍처적으로 올바르다. 그러나 프론트엔드 영향 변경 보완 필요.

**보완 1 -- `StrategyInfo` 타입 변경 필수**

```typescript
export interface StrategyInfo {
  name: string;
  active: boolean;
  symbol: string;        // backward compat (마지막 심볼)
  symbols: string[];     // NEW: 모든 활성 심볼
  config: Record<string, unknown>;
  lastSignal: Signal | null;
}
```

백엔드 `/api/bot/status` 응답에서도 `strategy.getSymbols()`를 직렬화해야 한다.

**보완 2 -- 전략 카드의 멀티 심볼 표시**

`StrategyCard.tsx`와 `StrategyDetail.tsx`가 현재 단일 심볼을 표시하므로, 멀티 심볼 Badge 리스트로 변환 필요. T0-3 백엔드 완료 후 프론트엔드 작업.

---

### T0-4: unhandledRejection / uncaughtException handlers

**✅ 동의**

`io.emit('risk:unhandled_error', ...)`을 프론트엔드로 전파하는 것이 좋다. `useSocket.ts`에 리스너 추가 필요. T0-8 RiskAlertBanner 작업과 통합 가능. `SOCKET_EVENTS`에 `UNHANDLED_ERROR: 'risk:unhandled_error'` 추가.

---

### T0-5: orderManager.submitOrder() per-symbol mutex

**✅ 동의**

순수 백엔드 변경으로 프론트엔드 직접 영향 없음.

---

### T0-6: ExposureGuard equity=0 division by zero guard

**✅ 동의**

올바른 백엔드 방어 로직. equity=0으로 주문 거부 시 프론트엔드에도 "Equity not initialized" 상태를 명확히 표시해야 함. T0-8의 RiskAlertBanner에서 자연스럽게 해결됨.

---

### T0-7: Emergency Stop ConfirmDialog -- UX Review

**⚠️ 조건부 동의**

Trader의 권장사항 중:

1. **"열린 포지션 수 + 총 미실현 PnL 표시"** -- 동의. `usePositions()` 훅에서 이미 사용 가능.

2. **"모든 포지션이 시장가로 청산됩니다" 경고 텍스트** -- 동의.

3. **"2단계 확인 (체크박스 + 버튼)"** -- 조건부 동의. 단, **3초 카운트다운은 반대**:
   - Emergency Stop은 **긴급 상황**에서 사용
   - 3초 카운트다운은 긴급성과 모순
   - 대신 체크박스 ("모든 포지션이 즉시 시장가 청산됨을 확인합니다") 1개로 충분
   - 체크박스 체크 전까지 확인 버튼 비활성화로 실수 방지

**제안하는 Emergency Stop 다이얼로그 구조:**

```
[!] 긴급 정지
---
현재 열린 포지션: 3건
총 미실현 PnL: -$127.45

[ ] 모든 포지션이 즉시 시장가로 청산됨을 확인합니다

      [취소]  [긴급 정지 실행]  ← 체크박스 체크 전까지 비활성화
```

범용 `ConfirmDialog`를 오버로드하지 말고 별도 `EmergencyStopDialog` 컴포넌트 생성 권장.

---

### T0-8: Risk event real-time UI display + RiskAlertBanner

**⚠️ 조건부 동의**

Trader의 "배너 우선순위: HALT > BREAK > WARNING" 시스템에 동의. 상세 UX 설계 보완 필요.

**자동 해제 vs 수동 해제:**
- `critical` (HALT, CIRCUIT_BREAK): 수동 해제만. acknowledge API 호출 필요.
- `warning` (DRAWDOWN_WARNING, EXPOSURE_ADJUSTED): 30초 후 자동 축소. 클릭하면 다시 확장.
- `info` (CIRCUIT_RESET): 10초 후 자동 해제.

**스택킹**: 다수 리스크 이벤트 동시 발생 시 최고 심각도만 배너로 표시, 나머지는 "N건 더" 링크.

**RiskEvent 타입 확장** (Engineer의 MongoDB 스키마에 맞춤):

```typescript
export interface RiskEvent {
  _id: string;
  eventType: 'circuit_break' | 'circuit_reset' | 'drawdown_warning' | 'drawdown_halt' |
             'exposure_adjusted' | 'order_rejected' | 'equity_insufficient' | 'emergency_stop' |
             'process_error';
  severity: 'info' | 'warning' | 'critical';
  source: string;
  symbol?: string;
  reason: string;
  riskSnapshot?: {
    equity: string;
    drawdownPercent?: string;
    consecutiveLosses?: number;
    isCircuitBroken?: boolean;
    isDrawdownHalted?: boolean;
  };
  acknowledged: boolean;
  acknowledgedAt?: string;
  createdAt: string;
}
```

---

### T0-9: Live/Paper mode visual warning enhancement

**⚠️ 조건부 동의**

Trader의 배너 제안에 부분 동의, 현재 UI와의 일관성을 위해 조정.

**제안:**

1. **상시 전체 폭 배너**: Trader 제안대로 화면 상단 배너, 색상 조정:
   - LIVE: `bg-red-600/90` 배경 + "LIVE TRADING - 실제 자금 거래 중" 텍스트
   - PAPER: `bg-emerald-600/30 border-b border-emerald-500/20` 배경 + "PAPER TRADING" (덜 눈에 띄게)

   PAPER 모드는 밝은 초록 대신 은은한 에메랄드 사용. 초록은 "안전"을 강하게 암시하여 경고 의미를 약화시키고, PAPER 모드는 기본 상태이므로 과도하게 눈에 띌 필요 없음.

2. **LIVE 모드에서 봇 시작 시 이중 확인**: `TradingModeToggle`에서 LIVE 전환 시 확인은 이미 존재. 추가로 LIVE 모드에서 봇 시작 버튼도 확인 필요. `BotControlPanel.tsx`에서 `onStart` 호출 전 추가 확인 다이얼로그 삽입.

3. **배너 위치**: `layout.tsx`가 아닌 `page.tsx`의 헤더 바로 위. 백테스트/토너먼트 페이지에는 불필요.

---

## Engineer Agent Proposal Review

### T0-1 ~ T0-6: Backend Implementation Guide

**✅ 동의 (전 항목)**

Engineer의 구현 가이드는 Trader와 핵심 방향이 일치하며, 여러 부분에서 더 나은 설계를 제시:

1. **T0-2**: `sizingMode = meta.positionSizing || 'percentage'` -- 미래 확장성 좋음. 단, 실패 시 `'0'` 반환보다 Trader의 `null` 반환이 더 명시적. **Trader 방식 권장.**

2. **T0-3**: `_currentProcessingSymbol` + `getCurrentSymbol()` 패턴이 Trader의 직접 `strategy._symbol = ticker.symbol` 할당보다 깔끔. **Engineer 방식 권장.**

3. **T0-3 `emitSignal()` 수정**: `symbol: signalData.symbol || this._currentProcessingSymbol || this._symbol` 폴백 체인이 중요. Trader 제안에는 누락. 이것 없으면 프론트엔드 시그널 피드에 잘못된 심볼이 표시될 수 있음.

4. **T0-4**: `isShuttingDown` 중복 셧다운 방지 플래그 + 기존 SIGTERM/SIGINT를 `safeShutdown`으로 통합이 더 견고. **Engineer 방식 권장.**

---

### RiskEvent Model Schema Design

**⚠️ 조건부 동의**

스키마 자체는 잘 설계됨. 프론트엔드 보완 필요:

**보완 1 -- API 클라이언트 추가 필요**

`frontend/src/lib/api-client.ts`에 `riskApi` 네임스페이스 추가:

```typescript
export const riskApi = {
  getEvents: (params?) => request<RiskEvent[]>('/api/risk/events', { ... }),
  acknowledge: (id: string) => request<RiskEvent>(`/api/risk/events/${id}/acknowledge`, { method: 'PUT' }),
  getUnacknowledged: () => request<RiskEvent[]>('/api/risk/events/unacknowledged'),
};
```

**보완 2 -- 30일 TTL 인덱스 적절**

프론트엔드 히스토리 쿼리에 30일이면 충분.

---

### 구현 순서

**⚠️ 조건부 동의**

Engineer의 Phase 분류는 합리적이나 프론트엔드 작업이 누락됨. 통합 일정 제안:

```
Phase 1 (병렬):
  [Backend]  T0-6, T0-4, T0-1, RiskEvent 모델 생성
  [Frontend] T0-7 EmergencyStopDialog 컴포넌트
  [Frontend] T0-9 TradingModeBanner 컴포넌트

Phase 2 (Backend T0-6 완료 후):
  [Backend]  T0-3 Multi-symbol Set 기반
  [Frontend] StrategyInfo 타입 변경 (symbols: string[]) -- T0-3 백엔드 대기

Phase 3 (T0-3 완료 후):
  [Backend]  T0-2 Position sizing + T0-5 Mutex
  [Frontend] T0-8 RiskAlertBanner + useRiskEvents 훅 + riskApi 클라이언트

Phase 4 (통합):
  [Backend]  RiskEngine → RiskEvent 기록 통합 + Risk API 라우트
  [Frontend] LIVE 모드 봇 시작 확인 다이얼로그 (BotControlPanel)
  [통합 테스트]
```

---

## 종합 평가

### 두 제안서 간 충돌 지점

1. **T0-2 반환값**: Trader는 `null`, Engineer는 `'0'`. **Trader의 `null` 방식 권장.** `'0'`은 유효한 qty로 오해될 수 있음.

2. **T0-3 하위 호환**: Trader는 `strategy._symbol = ticker.symbol` 직접 할당, Engineer는 `_setCurrentProcessingSymbol()`으로 캡슐화. **Engineer 방식 권장.** `emitSignal()` 폴백 체인도 포함.

3. **T0-4 중복 셧다운**: Trader는 별도 가드 없음, Engineer는 `isShuttingDown` 플래그. **Engineer 방식 권장.**

### 양 제안서에 누락된 프론트엔드 작업

1. **`risk:unhandled_error` 소켓 이벤트 수신** -- `useSocket.ts`와 `socket.ts`에 이벤트 상수 및 리스너 추가
2. **시그널 스킵 피드백** -- equity=0 등으로 시그널 스킵 시 사용자 알림 메커니즘
3. **riskApi 클라이언트 네임스페이스** -- RiskEvent 조회/acknowledge 처리용 REST API
4. **접근성 (a11y)** -- EmergencyStopDialog에 `role="alertdialog"`, `aria-modal="true"`, 포커스 트래핑 필요. RiskAlertBanner에 `role="alert"`, `aria-live="assertive"` 필요.

---

*이 리뷰는 현재 프론트엔드 코드베이스 분석 및 양 에이전트 제안서 비교를 기반으로 작성되었다.*
