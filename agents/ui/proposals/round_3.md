# Round 3 Proposal — Tier 1 Reliability (UI/UX Engineer)

**Author**: UI/UX Engineer
**Date**: 2026-02-14
**Scope**: T1-7, T1-8, T1-9, T1-10, T1-11 (Frontend Track C + T1-11 UI 부분)

---

## 분석 요약

Round 2에서 Tier 0 Safety-Critical 9건을 완료하여 긴급정지 확인 다이얼로그(`EmergencyStopDialog`), 리스크 경고 배너(`RiskAlertBanner`), 트레이딩 모드 배너(`TradingModeBanner`)가 신규 추가되었다. 이번 Round 3에서는 Tier 1 Reliability 11건 중 프론트엔드 담당 5건을 분석한다.

현재 코드를 직접 읽고 분석한 결과, 아래의 핵심 문제가 확인되었다:

1. **정보 우선순위 역전** (T1-7): 대시보드에서 봇 제어 → 전략 허브 → 계정/리스크 → 심볼 레짐 → 에쿼티 → 포지션+시그널 → 거래 내역 순서로 배치되어 있으나, 트레이더에게 가장 중요한 포지션/PnL이 스크롤 하단에 위치
2. **수동 청산 불가** (T1-8): `PositionsTable`에 각 포지션에 대한 청산 버튼이 없어, 긴급 상황에서 개별 포지션 수동 관리가 불가능
3. **Socket.io 생명주기 문제** (T1-9): `useSocket` cleanup에서 `disconnectSocket()`을 호출하여 socket 인스턴스를 null로 만들기 때문에, React Strict Mode나 동시 마운트 시 연결이 끊어질 수 있음
4. **Error Boundary 부재** (T1-10): `app/error.tsx`, `app/global-error.tsx` 모두 없어서 컴포넌트 런타임 에러가 전체 화면 크래시로 이어짐. `api-client.ts`의 `request()` 함수는 네트워크 실패와 비즈니스 에러를 구분하지 않음
5. **DrawdownMonitor 리셋 UI 부재** (T1-11): `RiskStatusPanel`에서 드로다운 할트 상태를 표시하나 해제 방법이 없음. `DrawdownMonitor.resetDaily()`와 `resetAll()` 메서드는 백엔드에 존재하지만 API 엔드포인트가 없음

---

## 발견 사항 (코드 레벨 근거)

### T1-7: Dashboard 레이아웃 재설계

**현재 상태** (`frontend/src/app/page.tsx` L156~L212):
```
space-y-4 (수직 스택):
  1. BotControlPanel
  2. StrategyHub (대형 — 18개 카드, 필터, 확장형)
  3. AccountOverview + RiskStatusPanel (grid 3:1)
  4. SymbolRegimeTable
  5. EquityCurveChart
  6. PositionsTable + SignalFeed (grid 2:1)
  7. TradesTable
```

**문제점**:
- **StrategyHub이 2번째에 위치**: 전략 허브는 18개 전략 카드를 포함하여 높이가 매우 큼 (접힌 상태에서도 ~600px). 이 아래에 있는 AccountOverview, PositionsTable이 뷰포트 밖으로 밀려남
- **AccountOverview (자산 정보)가 3번째**: 트레이더에게 가장 중요한 총 자산/미실현 PnL이 전략 허브 아래에 위치
- **PositionsTable이 6번째**: 활성 포지션 = 즉시 행동이 필요한 핵심 정보인데 스크롤 없이 볼 수 없음
- **그리드 미활용**: 전체 레이아웃이 `space-y-4` 수직 스택으로만 구성되어 대형 모니터에서 공간 낭비

**제안 레이아웃 (정보 우선순위 기반)**:
```
Row 0: TradingModeBanner + RiskAlertBanner (현재와 동일 — 최상단 고정)
Row 1: BotControlPanel + AccountOverview (좌: 봇 제어, 우: 핵심 자산 KPI)
Row 2: PositionsTable (전체 너비 — 활성 포지션이 항상 above-the-fold)
Row 3: RiskStatusPanel + EquityCurveChart (좌 1/3: 리스크, 우 2/3: 에쿼티)
Row 4: SignalFeed + TradesTable (좌 1/3: 실시간 시그널, 우 2/3: 거래 내역)
Row 5: StrategyHub (전체 너비 — 전략 관리는 설정성 정보이므로 하단)
Row 6: SymbolRegimeTable (전체 너비 — 참조 정보)
```

**변경 파일**: `frontend/src/app/page.tsx`
**구현 난이도**: 중 (JSX 재배치 + 그리드 조정, 로직 변경 없음)
**예상 영향**: 트레이더의 핵심 정보 접근 시간 대폭 단축. above-the-fold에 봇 상태/자산/포지션이 모두 노출됨

---

### T1-8: PositionsTable 수동 청산 버튼 추가

**현재 상태** (`frontend/src/components/PositionsTable.tsx` L17~L68):
- 8개 컬럼: 심볼, 방향, 수량, 진입가, 현재가, 미실현 PnL, 레버리지, 청산가
- 행동 가능한 UI 요소 없음 — 읽기 전용 테이블
- `PositionsTable`은 `positions`와 `loading`만 props로 받음
- 부모(`page.tsx` L206)에서 청산 관련 콜백을 전달하지 않음

**백엔드 API 확인** (`backend/src/api/tradeRoutes.js` L55~L69):
- `POST /api/trades/order`가 이미 존재 — `{ symbol, action: 'close_long'|'close_short', qty }` 형태로 수동 주문 가능
- 프론트엔드의 `tradeApi.submitOrder()`도 이미 정의됨 (`lib/api-client.ts` L95~L96)

**제안 구현**:
1. `PositionsTable`에 "청산" 컬럼 추가 (9번째 컬럼)
2. 각 행에 `Button variant="danger" size="sm"` 청산 버튼 배치
3. 클릭 시 `ConfirmDialog`를 통한 2단계 확인 (기존 `ui/ConfirmDialog.tsx` 재사용)
4. 확인 후 `tradeApi.submitOrder({ symbol, action: pos.posSide === 'long' ? 'close_long' : 'close_short', qty: pos.qty })` 호출
5. 성공 시 `usePositions`의 `refetch` 트리거

**Props 변경**:
```typescript
interface PositionsTableProps {
  positions: Position[];
  loading: boolean;
  onClosePosition?: (pos: Position) => Promise<void>;  // 신규
  closingSymbol?: string | null;                         // 로딩 상태 표시용
}
```

**변경 파일**:
- `frontend/src/components/PositionsTable.tsx` — 청산 버튼 + 확인 다이얼로그
- `frontend/src/app/page.tsx` — `onClosePosition` 콜백 연결
- `frontend/src/hooks/usePositions.ts` — (변경 없음, 기존 `refetch` 사용)

**구현 난이도**: 중 (UI 컴포넌트 수정 + 콜백 연결)
**예상 영향**: 긴급 상황에서 개별 포지션 수동 청산 가능. EmergencyStop(전체 정지)과 보완적 관계

**접근성 고려**:
- 청산 버튼에 `aria-label="[심볼] [방향] 포지션 청산"` 추가
- 확인 다이얼로그에 심볼, 방향, 수량, 미실현 PnL 정보 표시
- 미실현 PnL이 손실인 경우 확인 메시지에서 "손실 확정" 경고 표시

---

### T1-9: Socket.io ref-counted lifecycle 전환

**현재 상태** (`frontend/src/lib/socket.ts` + `frontend/src/hooks/useSocket.ts`):

`socket.ts` 모듈 레벨 싱글턴 패턴:
```typescript
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { ... });  // 최초 호출 시 연결 생성
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;  // 참조 제거 — 다음 getSocket()이 새 인스턴스 생성
  }
}
```

`useSocket.ts` L135~L137:
```typescript
return () => {
  disconnectSocket();  // 컴포넌트 언마운트 시 소켓 완전 파괴
};
```

**문제점**:
1. **React Strict Mode**: 개발 모드에서 useEffect가 mount→unmount→mount로 실행됨. 첫 번째 언마운트에서 `disconnectSocket()`이 socket을 null로 만든 후, 두 번째 마운트에서 새 연결을 생성. 불필요한 연결 끊김/재연결 발생
2. **멀티 컴포넌트 공유 불가**: 현재는 `useSocket`이 `page.tsx`에서만 사용되지만, 향후 다른 페이지(backtest, tournament)에서도 socket을 사용할 경우 하나의 언마운트가 전체 연결을 파괴
3. **이벤트 리스너 누적**: `useSocket`의 useEffect에서 `socket.on()`으로 리스너를 등록하지만, cleanup에서 개별 `socket.off()`를 호출하지 않고 `disconnectSocket()`으로 소켓 자체를 파괴. 정상 동작하지만, ref-counted로 전환하면 리스너 제거를 명시적으로 해야 함

**제안 구현 — ref-counted 싱글턴**:

`socket.ts` 수정:
```typescript
let socket: Socket | null = null;
let refCount = 0;

export function acquireSocket(): Socket {
  refCount++;
  if (!socket) {
    socket = io(SOCKET_URL, { ... });
    // global handlers ...
  }
  return socket;
}

export function releaseSocket(): void {
  refCount--;
  if (refCount <= 0) {
    refCount = 0;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }
}

// getSocket() — read-only access without affecting refCount
export function getSocket(): Socket | null {
  return socket;
}
```

`useSocket.ts` 수정:
```typescript
useEffect(() => {
  const socket = acquireSocket();
  socketRef.current = socket;

  const onConnect = () => setState(prev => ({ ...prev, connected: true }));
  const onDisconnect = () => setState(prev => ({ ...prev, connected: false }));
  // ... 각 이벤트 핸들러를 named function으로 선언

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on(SOCKET_EVENTS.SIGNAL_GENERATED, onSignal);
  // ... etc

  return () => {
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off(SOCKET_EVENTS.SIGNAL_GENERATED, onSignal);
    // ... etc
    releaseSocket();
  };
}, []);
```

**변경 파일**:
- `frontend/src/lib/socket.ts` — ref-counted acquire/release 패턴
- `frontend/src/hooks/useSocket.ts` — 명시적 리스너 등록/해제 + releaseSocket

**구현 난이도**: 중 (패턴 전환이나 로직은 단순)
**예상 영향**: React Strict Mode에서 불필요한 재연결 제거. 향후 멀티 페이지 socket 공유 기반 마련

---

### T1-10: Error Boundary + api-client 에러 래핑

**현재 상태**:

1. **Error Boundary 부재**: `frontend/src/app/` 디렉토리에 `error.tsx`, `global-error.tsx`, `not-found.tsx` 모두 없음. 컴포넌트 렌더링 중 런타임 에러 발생 시 Next.js의 기본 에러 화면(흰 화면 + 스택트레이스)이 표시됨

2. **api-client 에러 처리** (`frontend/src/lib/api-client.ts` L29~L38):
```typescript
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, { ... });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || '요청 실패');  // 비즈니스 에러
  }
  return json.data;
}
```
- **네트워크 에러와 비즈니스 에러 구분 없음**: `fetch()` 자체가 실패하면 (서버 다운, 네트워크 끊김) `TypeError: Failed to fetch`가 발생하는데, 이것이 그대로 throw됨
- **HTTP 상태 코드 무시**: `res.ok`를 확인하지 않아 500 에러도 json 파싱 시도
- **res.json() 파싱 실패**: 서버가 JSON이 아닌 응답(예: nginx 502 HTML)을 반환하면 `SyntaxError` 발생

**제안 구현**:

#### A. Error Boundary (`app/error.tsx`)
```typescript
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="max-w-md w-full mx-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          {/* Warning icon */}
          <h2 className="text-lg font-bold text-red-400">오류 발생</h2>
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          대시보드에서 예기치 않은 오류가 발생했습니다.
        </p>
        <pre className="text-xs text-zinc-500 bg-zinc-800 rounded p-3 mb-4 overflow-auto max-h-32">
          {error.message}
        </pre>
        <button onClick={reset} className="...">
          다시 시도
        </button>
      </div>
    </div>
  );
}
```

#### B. api-client 에러 래핑
```typescript
class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public isNetworkError: boolean = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    // 네트워크 에러 (서버 다운, DNS 실패 등)
    throw new ApiError(
      '서버에 연결할 수 없습니다. 네트워크를 확인하세요.',
      0,
      true,
    );
  }

  let json: { success: boolean; data: T; error?: string };
  try {
    json = await res.json();
  } catch {
    // JSON 파싱 실패 (서버가 HTML 등 반환)
    throw new ApiError(
      `서버 응답 파싱 실패 (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok || !json.success) {
    throw new ApiError(
      json.error || `요청 실패 (HTTP ${res.status})`,
      res.status,
    );
  }

  return json.data;
}
```

**변경 파일**:
- `frontend/src/app/error.tsx` — 신규 생성
- `frontend/src/app/global-error.tsx` — 신규 생성 (layout 레벨 에러 처리)
- `frontend/src/lib/api-client.ts` — `ApiError` 클래스 + `request()` 리팩토링

**구현 난이도**: 낮~중 (Next.js 표준 패턴 적용)
**예상 영향**: 런타임 에러 시 사용자에게 의미 있는 에러 화면 + 재시도 버튼 제공. 서버 다운 시 네트워크 에러 메시지 표시

---

### T1-11: DrawdownMonitor 리셋 UI 버튼 (Frontend 부분)

**현재 상태**:

`RiskStatusPanel.tsx` L74~L79:
```tsx
{drawdownMonitor.halted && (
  <Badge variant="danger" dot className="w-full justify-center">
    드로다운 한도 초과 — 거래 중단됨
  </Badge>
)}
```
- 할트 상태를 표시하나, 해제(리셋) 방법이 없음
- 트레이더가 상황을 판단하고 수동으로 거래를 재개하고 싶어도 UI에서 불가능

**백엔드 확인** (`backend/src/services/drawdownMonitor.js`):
- `resetDaily()` (L194~L205): 일일 손실 기준 리셋. `daily_loss_exceeded` 할트만 해제
- `resetAll(equity)` (L212~L221): 전체 리셋 — peak, current, daily 모두 재설정 + 할트 해제
- **API 엔드포인트 없음**: `riskRoutes.js`에 리셋 관련 라우트가 존재하지 않음

**제안 구현 (Frontend 부분)**:

1. **RiskStatusPanel에 리셋 버튼 추가**: 드로다운 할트 상태일 때만 "리셋" 버튼 표시
2. **확인 다이얼로그**: `ConfirmDialog`를 통한 2단계 확인 (실수 방지)
3. **API 호출**: `riskApi.resetDrawdown()` → `POST /api/risk/drawdown/reset`
4. **성공 시**: `useBotStatus`의 `refetch`를 트리거하여 리스크 상태 갱신

**RiskStatusPanel 변경**:
```typescript
interface RiskStatusPanelProps {
  riskStatus: RiskStatus;
  onResetDrawdown?: () => Promise<void>;  // 신규
  resetLoading?: boolean;                   // 신규
}
```

할트 배지 영역 변경:
```tsx
{drawdownMonitor.halted && (
  <div className="space-y-2">
    <Badge variant="danger" dot className="w-full justify-center">
      드로다운 한도 초과 — 거래 중단됨
    </Badge>
    {onResetDrawdown && (
      <Button
        variant="warning"
        size="sm"
        className="w-full"
        onClick={() => setShowResetConfirm(true)}
        loading={resetLoading}
      >
        드로다운 모니터 리셋
      </Button>
    )}
  </div>
)}
```

**api-client.ts 추가**:
```typescript
export const riskApi = {
  // ... existing methods
  resetDrawdown: (type: 'daily' | 'full' = 'daily') =>
    request<{ message: string }>('/api/risk/drawdown/reset', {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
};
```

**변경 파일**:
- `frontend/src/components/RiskStatusPanel.tsx` — 리셋 버튼 + 확인 다이얼로그
- `frontend/src/lib/api-client.ts` — `riskApi.resetDrawdown()` 추가
- `frontend/src/app/page.tsx` — `onResetDrawdown` 콜백 연결

**구현 난이도**: 낮 (UI는 단순, 백엔드 API 의존)
**예상 영향**: 드로다운 할트 후 수동 거래 재개 가능. 안전장치(확인 다이얼로그) 포함

---

## 제안 사항 (우선순위, 구현 난이도, 예상 영향)

| 순위 | ID | 제목 | 난이도 | 영향도 | 비고 |
|------|----|------|--------|--------|------|
| 1 | T1-10 | Error Boundary + api-client 에러 래핑 | 낮~중 | 높음 | 모든 에러에 대한 기본 안전망. 다른 작업 전에 완료 권장 |
| 2 | T1-9 | Socket.io ref-counted lifecycle | 중 | 중~높 | 인프라 레벨 변경. 다른 socket 의존 기능에 영향 |
| 3 | T1-7 | Dashboard 레이아웃 재설계 | 중 | 높음 | 사용성 대폭 개선이나 JSX 구조 변경이 큼 |
| 4 | T1-8 | PositionsTable 수동 청산 버튼 | 중 | 높음 | 안전성 직결. T1-7과 병행 가능 |
| 5 | T1-11 | DrawdownMonitor 리셋 UI | 낮 | 중 | 백엔드 API 필요. 프론트는 버튼+다이얼로그만 |

### 구현 순서 권장

1. **Phase 1**: T1-10 (Error Boundary) — 다른 작업 중 런타임 에러 대비
2. **Phase 2**: T1-9 (Socket lifecycle) — 인프라 안정화
3. **Phase 3**: T1-7 + T1-8 (레이아웃 + 청산 버튼) — 동시 작업 가능. 레이아웃 변경 시 PositionsTable이 상단으로 이동하므로 청산 버튼 추가도 함께 적용
4. **Phase 4**: T1-11 (리셋 UI) — 백엔드 API 완성 후 연결

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게

1. **T1-8 청산 확인 메시지 검토**: 수동 청산 시 확인 다이얼로그에 표시할 정보와 경고 문구 검토 요청. 특히:
   - 손실 포지션 청산 시 추가 경고 필요 여부
   - 부분 청산 지원 필요 여부 (현재 제안은 전체 수량 청산만)
   - 청산 주문 유형 (market vs limit) 선택 옵션 필요 여부

2. **T1-7 레이아웃 정보 우선순위 검증**: 제안된 레이아웃 순서(봇 제어+자산 → 포지션 → 리스크+에쿼티 → 시그널+거래 → 전략 → 심볼 레짐)가 트레이딩 의사결정 흐름에 부합하는지 검토

3. **T1-11 리셋 조건 확인**: DrawdownMonitor 수동 리셋 시:
   - `resetDaily`(일일 리셋)만 제공할지, `resetAll`(전체 리셋)도 제공할지
   - 리셋 후 peak equity를 현재 equity로 갱신하는 것이 트레이딩 관점에서 적절한지
   - 리셋 가능 조건(예: 봇이 정지 상태일 때만 등) 필요 여부

### Engineer 에이전트에게

1. **T1-11 백엔드 API 구현 요청**: `POST /api/risk/drawdown/reset` 엔드포인트를 `riskRoutes.js`에 추가 필요:
   - Body: `{ type: 'daily' | 'full' }`
   - `type === 'daily'`: `riskEngine.resetDaily()` 호출
   - `type === 'full'`: `riskEngine.drawdownMonitor.resetAll(currentEquity)` 호출
   - RiskEvent 기록 (`eventType: 'drawdown_reset'`, `severity: 'info'`)
   - 응답: `{ success: true, data: { message: '...', newStatus: riskEngine.getStatus() } }`

2. **T1-8 수동 청산 백엔드 확인**: `POST /api/trades/order`에 `{ action: 'close_long', symbol, qty }` 전송 시 정상 동작하는지 확인. 특히:
   - `traderService.submitOrder()`가 close 액션을 올바르게 처리하는지
   - `reduceOnly` 플래그가 자동으로 설정되는지
   - 봇이 정지 상태에서도 수동 주문이 가능한지

3. **T1-3 (Graceful shutdown)과 T1-9 (Socket lifecycle)의 상호작용**: 서버 종료 시 Socket.io 연결 해제 순서가 프론트엔드의 ref-counted lifecycle과 충돌하지 않는지 확인

4. **T1-10 에러 타입 표준화**: 백엔드에서 반환하는 에러 응답 형식이 일관되는지 확인:
   - 모든 라우트가 `{ success: false, error: string }` 형식을 준수하는지
   - HTTP 상태 코드가 적절하게 설정되는지 (400 vs 500)
