# Round 2 -- UI/UX 엔지니어 구현 제안서: Tier 0 Safety-Critical (T0-7, T0-8, T0-9)

**분석 대상**: `frontend/src/` 전체 (25개 컴포넌트, 8개 훅, UI 프리미티브, 타입 정의)
**라운드 1 참조**: `agents/shared/decisions/round_1.md`, `agents/shared/BACKLOG.md`
**작성일**: 2026-02-13

---

## 분석 요약

### 현재 상태 진단

| ID | 현재 상태 | 문제 심각도 | 구현 복잡도 |
|----|----------|-----------|-----------:|
| T0-7 | `BotControlPanel.tsx:89-97`에서 `onEmergencyStop`이 확인 없이 직접 호출됨. `ConfirmDialog` 컴포넌트가 있으나 미적용 | **CRITICAL** | 낮음 (1시간) |
| T0-8 | `useSocket.ts:84-103`에서 `riskEvents`를 수집하고 있으나, `page.tsx`에서 구조분해하지 않아 **어디에도 렌더링되지 않음** | **CRITICAL** | 중간 (4시간) |
| T0-9 | `TradingModeToggle.tsx`의 작은 토글 버튼만이 모드 구분 수단. 실거래 모드에서도 대시보드 배경/레이아웃이 동일 | **HIGH** | 낮음 (2시간) |

### 활용 가능한 기존 리소스

- **`ConfirmDialog`** (`components/ui/ConfirmDialog.tsx`): variant `danger` | `warning` 지원 -- T0-7에 즉시 재사용 가능
- **`Badge`** (`components/ui/Badge.tsx`): 5개 variant
- **`useSocket`의 `riskEvents` 상태**: 이미 이벤트를 수신/저장. 렌더링만 연결하면 됨
- **소켓 이벤트 상수**: `SOCKET_EVENTS`에 `CIRCUIT_BREAK`, `CIRCUIT_RESET`, `DRAWDOWN_WARNING`, `DRAWDOWN_HALT`, `EXPOSURE_ADJUSTED` 정의 완료

---

## T0-7 구현 가이드: Emergency Stop ConfirmDialog

### 문제 정의

`BotControlPanel.tsx:89-97`에서 "긴급 정지" 버튼이 클릭 즉시 `handleAction('emergency', onEmergencyStop)`을 호출한다. 백엔드 `botService.emergencyStop()`은 비가역적 작업이다. 실거래 모드에서 실수로 클릭하면 심각한 자금 손실이 발생할 수 있다.

### 상태 관리

```typescript
const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
```

### 구체적 코드 변경

**파일**: `frontend/src/components/BotControlPanel.tsx`

1. `ConfirmDialog` import 추가
2. `showEmergencyConfirm` 상태 추가
3. 긴급 정지 Button의 `onClick` 변경:

```typescript
// 기존:
onClick={() => handleAction('emergency', onEmergencyStop)}

// 변경:
onClick={() => setShowEmergencyConfirm(true)}
```

4. ConfirmDialog 추가:

```tsx
<ConfirmDialog
  open={showEmergencyConfirm}
  title="긴급 정지"
  message="모든 미체결 주문이 취소되고 봇이 즉시 정지됩니다. 열린 포지션은 유지되지만, 리스크 관리가 중단됩니다. 계속하시겠습니까?"
  confirmLabel="긴급 정지 실행"
  cancelLabel="취소"
  variant="danger"
  onConfirm={() => {
    setShowEmergencyConfirm(false);
    handleAction('emergency', onEmergencyStop);
  }}
  onCancel={() => setShowEmergencyConfirm(false)}
/>
```

### ConfirmDialog 메시지 설계 근거

현재 `botService.emergencyStop()`의 구현: (1) riskEngine 정지, (2) 미체결 주문 취소, (3) 봇 정지 — **열린 포지션의 시장가 청산은 포함되지 않는다**. 사실에 기반한 정확한 메시지를 제공한다.

### 스타일 변경

```tsx
<Button
  variant="danger"
  size="sm"
  loading={loadingAction === 'emergency'}
  onClick={() => setShowEmergencyConfirm(true)}
  disabled={!running}
  className="ring-1 ring-red-500/50 font-bold"
>
  긴급 정지
</Button>
```

### 접근성 고려사항
- ESC 키 핸들링 지원 (ConfirmDialog 내장)
- "긴급 정지 실행" 버튼에 autoFocus 추가하면 안 됨 -- 실수로 Enter 연타 시 확인이 되어버림

---

## T0-8 구현 가이드: Risk 이벤트 실시간 UI 표시 + RiskAlertBanner

### 설계 방향

두 가지 레이어로 구현:
1. **RiskAlertBanner** (신규 컴포넌트): 페이지 최상단 고정 위험 알림 배너
2. **RiskStatusPanel 보강**: 기존 패널에 최근 리스크 이벤트 히스토리 렌더링

### 1. RiskAlertBanner 컴포넌트

**신규 파일**: `frontend/src/components/RiskAlertBanner.tsx`

#### 이벤트 유형별 표시 방식

| 이벤트 유형 | 배경색 | 메시지 패턴 | 지속 시간 |
|------------|--------|------------|----------|
| `circuit_break` | `bg-red-900/90 border-red-500` | "서킷 브레이커 발동: {reason}" | 수동 닫기만 |
| `drawdown_warning` | `bg-amber-900/90 border-amber-500` | "드로다운 경고: {drawdownPercent}%" | 30초 자동 닫기 |
| `drawdown_halt` | `bg-red-900/95 border-red-600` | "거래 중단: {reason}" | 수동 닫기만 |

#### 렌더링 구조

```tsx
export default function RiskAlertBanner({ riskEvents, onDismiss, onDismissAll }: RiskAlertBannerProps) {
  if (riskEvents.length === 0) return null;

  return (
    <div className="sticky top-0 z-40 space-y-1">
      {riskEvents.slice(0, 5).map((event, idx) => {
        const type = classifyRiskEvent(event);
        return (
          <div
            key={`${event.timestamp}-${idx}`}
            className={cn(
              'flex items-center justify-between px-4 py-2.5 border-b text-sm font-medium animate-slideDown',
              type === 'drawdown_halt' && 'bg-red-900/95 border-red-600 text-red-100',
              type === 'circuit_break' && 'bg-red-900/90 border-red-500 text-red-200',
              type === 'drawdown_warning' && 'bg-amber-900/90 border-amber-500 text-amber-200',
            )}
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-center gap-2">
              <RiskIcon type={type} />
              <span>{formatRiskMessage(event, type)}</span>
              <span className="text-xs opacity-60 ml-2">
                {formatTime(event.timestamp)}
              </span>
            </div>
            <button
              onClick={() => onDismiss(idx)}
              className="text-current opacity-60 hover:opacity-100 p-1"
              aria-label="알림 닫기"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
      {riskEvents.length > 1 && (
        <button
          onClick={onDismissAll}
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
        >
          모든 알림 닫기 ({riskEvents.length}건)
        </button>
      )}
    </div>
  );
}
```

#### 애니메이션

`globals.css`에 추가:

```css
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.animate-slideDown {
  animation: slideDown 0.3s ease-out;
}
```

### 2. page.tsx 수정

```typescript
// riskEvents 구조분해 추가
const {
  connected: socketConnected,
  signals,
  regime,
  symbolRegimes: socketSymbolRegimes,
  riskEvents,
  clearRiskEvents,
} = useSocket();
```

RiskAlertBanner 배치: `<header>` 위에

### 3. RiskStatusPanel 보강

기존 드로다운 halt Badge 아래에 최근 이벤트 목록 추가.

### 4. RiskEvent 타입 확장

```typescript
export interface RiskEvent {
  reason: string;
  timestamp: string;
  consecutiveLosses?: number;
  cooldownMinutes?: number;
  currentDrawdown?: string;
  maxDrawdown?: string;
  drawdownPercent?: string;
  warningThreshold?: string;
  maxDrawdownPercent?: string;
  peakEquity?: string;
  currentEquity?: string;
  dailyStartEquity?: string;
  totalExposure?: string;
  maxExposure?: string;
}
```

### 접근성 고려사항
- `role="alert"` + `aria-live="assertive"` 적용
- 색상 + 아이콘 형태로 이벤트 유형 구분 (색약 사용자 지원)

---

## T0-9 구현 가이드: 실거래/가상거래 모드 시각적 경고 강화

### 설계 방향: 3단계 시각적 신호

| 레이어 | 위치 | 실거래 (Live) | 가상거래 (Paper) |
|--------|------|-------------|----------------|
| **L1: 상단 스트라이프** | 페이지 최상단 | 빨간 줄 + "LIVE TRADING" | 주황 줄 + "PAPER TRADING" |
| **L2: 헤더 뱃지** | 타이틀 옆 | 빨간 뱃지 "실거래" (깜빡임) | 주황 뱃지 "가상거래" |
| **L3: 기존 토글** | 헤더 좌측 | (유지) | (유지) |

### 1. TradingModeBanner 컴포넌트 (신규)

**신규 파일**: `frontend/src/components/TradingModeBanner.tsx`

```tsx
'use client';

export default function TradingModeBanner({ mode }: { mode: 'live' | 'paper' }) {
  const isLive = mode === 'live';

  return (
    <div
      className={cn(
        'w-full flex items-center justify-center gap-2 py-1 text-xs font-bold tracking-wider select-none',
        isLive
          ? 'bg-red-600/20 border-b-2 border-red-500 text-red-400'
          : 'bg-amber-600/10 border-b border-amber-500/30 text-amber-500/70',
      )}
      role="status"
      aria-label={isLive ? '실거래 모드 활성' : '가상거래 모드 활성'}
    >
      {isLive && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
      {isLive ? 'LIVE TRADING -- 실제 자금 거래 중' : 'PAPER TRADING'}
    </div>
  );
}
```

**핵심 설계 결정**:
- 실거래 모드: `animate-ping` dot + 진한 빨간 배경 + "실제 자금 거래 중" 한국어 부연
- 가상거래 모드: 얇은 주황 선 + 낮은 불투명도 텍스트
- 실거래의 시각적 강도를 가상거래보다 **3배 이상 강하게** 설정

### 2. page.tsx 수정

```tsx
<div className="min-h-screen p-4 md:p-6 max-w-[1600px] mx-auto">
  {/* Trading Mode Banner -- 최상단 */}
  <TradingModeBanner
    mode={botStatus.tradingMode ?? (botStatus.paperMode ? 'paper' : 'live')}
  />

  {/* Risk Alert Banner */}
  <RiskAlertBanner ... />

  {/* Header */}
  <header ...>
```

### 3. 헤더 타이틀 뱃지 추가

```tsx
<h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
  Bitget 자동매매
  {currentTradingMode === 'live' ? (
    <Badge variant="danger" dot>실거래</Badge>
  ) : (
    <Badge variant="warning" dot>가상거래</Badge>
  )}
</h1>
```

### 접근성 고려사항
- `role="status"` + `aria-label` 적용
- 색상 외에 텍스트로 모드를 명시하여 색각 이상 사용자 지원

---

## 타입 변경 사항 (types/index.ts)

### T0 필수 타입 변경

#### 1. StrategyInfo 변경 (T0-3)

```typescript
export interface StrategyInfo {
  name: string;
  active: boolean;
  symbol: string;           // 유지 (대표 심볼)
  symbols: string[];        // 추가: 전략이 관리하는 모든 심볼
  config: Record<string, unknown>;
  lastSignal: Signal | null;
}
```

#### 2. Signal 변경 (T0-2)

```typescript
export interface Signal {
  // ... 기존 필드 ...
  positionSizePercent?: string;   // 추가: 전략이 제안한 %
  resolvedQty?: string;           // 추가: botService가 계산한 절대 수량
}
```

#### 3. RiskEvent 확장 (T0-8)

위 T0-8 섹션 참조.

---

## 다른 에이전트에게 요청 사항

### Backend Engineer 요청

1. **리스크 이벤트 페이로드에 `timestamp` 추가** (T0-8 지원)
2. **RiskEvent REST API 엔드포인트** (AD-4 구현): `GET /api/risk/events`
3. **모든 리스크 이벤트 페이로드에 `eventType` 필드 추가** (선택)
4. **emergencyStop 동작 명세 확인** (T0-7 메시지 정확성): 열린 포지션 시장가 청산 포함 여부
5. **T0-1 전략 이름 확정 후 프론트 동기화 필요**: `translateStrategyName()`, `STRATEGY_CATEGORY_MAP`
6. **T0-3 완료 후 StrategyInfo 응답에 `symbols: string[]` 포함 여부** 확인

### Trader 에이전트 요청

1. **ConfirmDialog 메시지 검토**: 트레이더 관점에서 적절한지
2. **Risk 이벤트 심각도 분류 검증**: circuit_break=수동닫기, drawdown_warning=30초자동, drawdown_halt=수동닫기
3. **실거래 모드 경고 수준 검증**: 상단 빨간 바 + 펄스 애니메이션이 과한지/부족한지

---

## 구현 순서

```
Phase 1: 독립 구현 (병렬 가능)
  T0-7 (Emergency ConfirmDialog)  -- 1시간, 의존성 없음
  T0-9 (TradingModeBanner)        -- 2시간, 의존성 없음

Phase 2: 소켓 연동
  T0-8 (RiskAlertBanner)          -- 4시간, useSocket 수정 포함

Phase 3: 백엔드 동기화 (Backend T0 완료 후)
  types/index.ts 타입 업데이트
  translateStrategyName / STRATEGY_CATEGORY_MAP 맵 동기화
  (선택) riskApi REST 연동
```

### 파일 변경 목록

| 파일 | 변경 유형 | 관련 T0 |
|------|----------|---------|
| `components/BotControlPanel.tsx` | 수정 | T0-7 |
| `components/RiskAlertBanner.tsx` | **신규** | T0-8 |
| `components/RiskStatusPanel.tsx` | 수정 | T0-8 |
| `components/TradingModeBanner.tsx` | **신규** | T0-9 |
| `app/page.tsx` | 수정 | T0-7, T0-8, T0-9 |
| `hooks/useSocket.ts` | 수정 | T0-8 |
| `types/index.ts` | 수정 | T0-2, T0-3, T0-8 |
| `lib/utils.ts` | 수정 (대기) | T0-1 |
| `app/globals.css` | 수정 | T0-8 (slideDown) |
| `lib/api-client.ts` | 수정 (대기) | T0-8 (riskApi) |

---

*이 제안서는 Round 1에서 합의된 Tier 0 Safety-Critical 9건 중 프론트엔드 담당 3건(T0-7, T0-8, T0-9)의 구체적 구현 방안과, 백엔드 담당 6건(T0-1~T0-6)에 따른 프론트엔드 타입 변경 사항을 포함한다.*
