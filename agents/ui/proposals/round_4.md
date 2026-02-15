# Round 4 Proposal — Tier 2 Quality (UI/UX Engineer)

**Author**: UI/UX Engineer
**Date**: 2026-02-15
**Scope**: T2-6, T2-8, T2-10, T2-11, T2-12 (Frontend Track C) + T2-1~T2-5, T2-7, T2-9 (Backend 소비 관점 리뷰)

---

## 분석 요약

Round 3에서 Tier 1 Reliability 11건을 완료하여 Error Boundary, Socket ref-counted lifecycle, Dashboard 재설계 (정보 우선순위 기반), PositionsTable 수동 청산, DrawdownMonitor 리셋 UI가 모두 적용되었다. 현재 대시보드는 아래 레이아웃으로 안정화된 상태이다:

```
Row 0: TradingModeBanner + RiskAlertBanner
Row 1: BotControlPanel + AccountOverview
Row 2: PositionsTable (full width, above-the-fold)
Row 3: RiskStatusPanel(1/3) + EquityCurveChart(2/3)
Row 4: SignalFeed(1/3) + TradesTable(2/3)
Row 5: StrategyHub (full width)
Row 6: SymbolRegimeTable (full width)
```

이번 Round 4에서 Tier 2 Quality 12건 중 프론트엔드 담당 5건을 코드 레벨에서 분석한 결과, 아래의 핵심 개선 기회가 확인되었다:

1. **useSocket 모놀리식 상태 관리 (T2-6)**: 단일 `useSocket` 훅이 13개 이벤트를 구독하여 6개의 독립적 상태 조각(signals, positions, regime, symbolRegimes, riskEvents, lastTicker)을 하나의 `SocketState` 객체로 관리. ticker 업데이트(초당 다수)가 signals/regime 등 무관한 컴포넌트까지 리렌더링 유발
2. **SignalFeed rejectReason 미표시 (T2-8)**: 백엔드가 시그널 거부 시 `rejectReason`을 포함하여 `trade:signal_generated` 이벤트로 전송하나, `SignalFeed.tsx`에서 `signal.rejectReason` 필드를 렌더링하지 않음. 트레이더가 왜 시그널이 거부되었는지 파악 불가
3. **Drawdown 시각화 부재 (T2-10)**: `RiskStatusPanel`에 드로다운이 단순 progress bar + 숫자로만 표시됨. 시간에 따른 드로다운 추이(equity curve에서 peak 대비 하락)를 시각화하는 전용 차트가 없음
4. **Risk Gauge 부재 (T2-11)**: 리스크 상태가 텍스트 + progress bar로만 표시되어 "현재 전체 리스크가 얼마나 높은지"를 직관적으로 파악하기 어려움. 시각적 게이지(반원형 또는 원형)가 필요
5. **고정 폴링 간격 (T2-12)**: `useBotStatus`(5s), `usePositions`(5s), `useTrades`(10s), `useHealthCheck`(30s) 모두 봇 상태와 무관하게 동일 간격으로 폴링. 봇이 idle 상태인데도 5초마다 포지션을 조회하는 것은 불필요한 서버 부하

---

## 발견 사항 (코드 레벨 근거)

### T2-6: useSocket 목적별 분리

**현재 상태** (`frontend/src/hooks/useSocket.ts`):

`SocketState` 인터페이스가 6개의 독립적 상태 조각을 하나로 묶고 있다:

```typescript
// L8~L16
interface SocketState {
  connected: boolean;
  signals: Signal[];          // trade:signal_generated
  positions: Position[];      // trade:position_updated
  regime: MarketRegimeData;   // market:regime_change
  symbolRegimes: Record<...>; // market:symbol_regime_update
  riskEvents: RiskEvent[];    // risk:circuit_break, drawdown_warning, drawdown_halt, circuit_reset, exposure_adjusted, unhandled_error
  lastTicker: Record<...>;    // market:ticker
}
```

13개 이벤트 핸들러가 모두 `setState(prev => ({ ...prev, ... }))`로 전체 state를 갱신하므로, 아무 이벤트 하나만 발생해도 `useSocket`을 구독하는 모든 컴포넌트가 리렌더링된다.

**특히 문제가 되는 부분**:
- `handleTicker` (L72~L80): ticker는 구독 심볼 수 x 초당 여러 회 발생할 수 있는 고빈도 이벤트. 현재 대시보드에서 `lastTicker` 상태는 어디에도 사용되지 않음 (`page.tsx`에서 `useSocket()`의 구조분해 할당에 `lastTicker`가 없음 L54~L64). 즉, 사용되지 않는 상태가 불필요한 리렌더를 유발
- `handlePositionUpdated` (L50~L52): socket으로 들어오는 positions와 `usePositions` 훅의 REST 폴링 positions가 중복. 현재 `page.tsx`에서는 `usePositions()`의 결과만 사용 (L65~L69). socket의 positions도 미사용

**문제 영향**:
- ticker 이벤트마다 `signals`, `regime`, `riskEvents` 등을 구독하는 `SignalFeed`, `RiskAlertBanner`, `SymbolRegimeTable` 모두 리렌더
- 현재 `page.tsx`에서 구조분해로 사용하는 값은 `connected`, `signals`, `regime`, `socketSymbolRegimes`, `socketRiskEvents` 5개뿐

**제안 — 목적별 훅 분리**:

```
useSocket.ts (기존) → 아래 4개로 분리:

1. useSocketConnection.ts
   - connected 상태만 관리
   - acquireSocket/releaseSocket lifecycle

2. useSocketSignals.ts
   - SIGNAL_GENERATED 이벤트만 구독
   - signals[] 상태 관리 + clearSignals
   - 소비자: SignalFeed

3. useSocketRisk.ts
   - CIRCUIT_BREAK, DRAWDOWN_WARNING, DRAWDOWN_HALT,
     CIRCUIT_RESET, EXPOSURE_ADJUSTED, UNHANDLED_ERROR 구독
   - riskEvents[] 상태 관리 + clearRiskEvents
   - 소비자: RiskAlertBanner, (향후) Risk Gauge

4. useSocketMarket.ts
   - REGIME_CHANGE, SYMBOL_REGIME_UPDATE, TICKER 구독
   - regime, symbolRegimes, lastTicker 상태 관리
   - 소비자: SymbolRegimeTable, (향후) ticker display
```

**핵심 설계 원칙**:
- 모든 훅이 동일한 `acquireSocket()/releaseSocket()` 싱글턴 사용 (기존 ref-counted lifecycle 유지)
- 각 훅은 자신이 관심 있는 이벤트만 구독하여 해당 상태만 갱신
- `page.tsx`에서 기존 `useSocket()` 대신 필요한 훅만 개별 호출
- **기존 `useSocket.ts`는 유지하되 deprecated 주석 추가** (하위 호환성) 또는 facade로 전환하여 내부에서 분리된 훅 조합

**변경 파일**:
- `frontend/src/hooks/useSocketConnection.ts` — 신규 생성
- `frontend/src/hooks/useSocketSignals.ts` — 신규 생성
- `frontend/src/hooks/useSocketRisk.ts` — 신규 생성
- `frontend/src/hooks/useSocketMarket.ts` — 신규 생성
- `frontend/src/hooks/useSocket.ts` — facade로 전환 (기존 API 유지)
- `frontend/src/app/page.tsx` — 개별 훅 사용으로 전환

**구현 난이도**: 중
**예상 영향**: ticker 이벤트에 의한 불필요한 리렌더 제거. 고빈도 이벤트(ticker)가 저빈도 UI(signals, regime)를 리렌더하지 않음. 성능 체감 개선 (특히 다수 심볼 구독 시)

---

### T2-8: SignalFeed rejectReason 표시

**현재 상태** (`frontend/src/components/SignalFeed.tsx`):

L46~L49에서 `riskApproved` 상태만 표시하고, 거부 사유(`rejectReason`)는 무시됨:

```tsx
{signal.riskApproved !== null && (
  <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
    {signal.riskApproved ? '승인' : '거부'}
  </Badge>
)}
```

**백엔드 분석**:

`orderManager.js` L308~L312에서 거부된 시그널 이벤트에 `rejectReason`을 포함하여 emit:
```javascript
this.emit(TRADE_EVENTS.SIGNAL_GENERATED, {
  signal: rejectedSignal.toObject(),
  approved: false,
  rejectReason: riskResult.rejectReason,
});
```

`riskEngine.js`에서 반환하는 `rejectReason` 값들:
- `'equity_not_initialized'` (L98) — 자본금 미초기화
- `cbResult.reason` (L111) — 서킷 브레이커 활성 (예: `'circuit_breaker_active'`)
- `ddResult.reason` (L128) — 드로다운 한도 초과 (예: `'max_drawdown_exceeded'`, `'daily_loss_exceeded'`)
- `egResult.reason` (L146) — 노출도 한도 초과 (예: `'total_exposure_exceeded'`)
- `'Risk validation error: ...'` (L273) — 내부 오류
- `'Exchange error: ...'` (L410) — 거래소 통신 오류

`Signal` 타입 (`frontend/src/types/index.ts` L117):
```typescript
rejectReason: string | null;  // 이미 타입에 존재
```

`useSocket.ts` L43~L48의 `handleSignalGenerated`:
```typescript
const handleSignalGenerated = (signal: Signal) => {
  setState(prev => ({
    ...prev,
    signals: [signal, ...prev.signals].slice(0, 50),
  }));
};
```

이 핸들러는 서버에서 emit된 `data` 객체를 직접 `Signal`로 취급한다. 그런데 서버 emit 형태는 `{ signal: { ... }, approved, rejectReason }`이므로, `data.signal` 안에 DB 문서의 `rejectReason`이 포함되어 있다. 또한 최상위 `data.rejectReason`도 있다.

**주의**: `handleSignalGenerated`가 `(signal: Signal)` 타입으로 받지만 실제 payload는 `{ signal: Signal, approved: boolean, rejectReason?: string }` 형태일 수 있다. 이 부분을 정확히 처리해야 한다.

**제안 구현**:

1. **useSocket의 handleSignalGenerated 페이로드 정규화**:
```typescript
const handleSignalGenerated = (data: { signal?: Signal } & Partial<Signal>) => {
  // 서버가 { signal: {...}, approved, rejectReason } 또는 Signal 직접 전송
  const signal: Signal = data.signal || (data as Signal);
  setState(prev => ({
    ...prev,
    signals: [signal, ...prev.signals].slice(0, 50),
  }));
};
```

2. **SignalFeed에 rejectReason 표시 추가**:

```tsx
{signal.riskApproved !== null && (
  <div className="flex items-center gap-1.5">
    <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
      {signal.riskApproved ? '승인' : '거부'}
    </Badge>
    {!signal.riskApproved && signal.rejectReason && (
      <span className="text-[10px] text-red-400/70 max-w-[120px] truncate"
            title={translateRejectReason(signal.rejectReason)}>
        {translateRejectReason(signal.rejectReason)}
      </span>
    )}
  </div>
)}
```

3. **rejectReason 번역 함수** (`lib/utils.ts`에 추가):

```typescript
export function translateRejectReason(reason: string): string {
  const map: Record<string, string> = {
    equity_not_initialized: '자본금 미초기화',
    circuit_breaker_active: '서킷 브레이커 활성',
    max_drawdown_exceeded: '최대 드로다운 초과',
    daily_loss_exceeded: '일일 손실 한도 초과',
    total_exposure_exceeded: '총 노출도 한도 초과',
    qty_resolution_failed: '수량 산출 실패',
  };
  // Risk validation error: ..., Exchange error: ... 등 동적 메시지
  if (reason.startsWith('Risk validation error:')) return '리스크 검증 오류';
  if (reason.startsWith('Exchange error:')) return '거래소 오류';
  return map[reason] || reason;
}
```

4. **확장 UI — 클릭 시 상세 표시**: 거부된 시그널을 클릭하면 `rejectReason` 전문 + `marketContext` 일부를 인라인 드롭다운으로 표시

**변경 파일**:
- `frontend/src/components/SignalFeed.tsx` — rejectReason 렌더링 추가
- `frontend/src/lib/utils.ts` — `translateRejectReason()` 함수 추가
- `frontend/src/hooks/useSocket.ts` (또는 분리 후 `useSocketSignals.ts`) — signal payload 정규화

**구현 난이도**: 낮
**예상 영향**: 트레이더가 시그널 거부 사유를 즉시 파악 가능. 리스크 엔진의 의사결정 투명성 대폭 향상. "왜 거부되었지?" → 바로 원인 확인 가능

---

### T2-10: Drawdown 시각화 차트 (신규 컴포넌트)

**현재 상태**:

`RiskStatusPanel.tsx` L61~L78에서 드로다운을 단순 progress bar로 표시:
```tsx
<div className="w-full bg-zinc-800 rounded-full h-1.5">
  <div
    className={`h-1.5 rounded-full transition-all ${drawdownPct > 5 ? 'bg-red-500' : ...}`}
    style={{ width: `${Math.min(drawdownPct * 10, 100)}%` }}
  />
</div>
```

- 현재 드로다운 수치(%)와 peak equity만 표시
- **시간 축이 없음**: 드로다운이 어떻게 진행되어 왔는지 추이를 볼 수 없음
- 현재 EquityCurveChart는 equity 절대값만 표시하고, peak 대비 drawdown%는 표시하지 않음

**데이터 소스 분석**:

1. `EquityPoint` (`frontend/src/types/index.ts` L128~L132):
```typescript
interface EquityPoint {
  timestamp: string;
  equity: string;
  unrealizedPnl: string;
}
```
equity curve 데이터에서 drawdown을 계산 가능: 각 시점의 `equity`와 그 시점까지의 `max(equity)` 차이가 drawdown

2. `DrawdownMonitor.getStatus()` (`backend/src/services/drawdownMonitor.js` L239~L265):
```javascript
return {
  peakEquity, currentEquity, drawdownPercent,
  dailyStartEquity, dailyPnlPercent,
  isHalted, haltReason, dailyResetTime, params
};
```
현재 스냅샷만 반환하고, 히스토리 데이터는 없음

3. `Snapshot` 모델 (`backend/src/models/Snapshot.js`):
equity, availableBalance, unrealizedPnl, dailyPnl을 시점별로 저장. 이 데이터에서 drawdown 곡선을 파생 가능

**제안 구현 — DrawdownChart 컴포넌트**:

```
데이터 흐름:
equityCurve (EquityPoint[]) → 클라이언트 측 drawdown 계산 → DrawdownChart
```

클라이언트에서 equity curve 데이터로부터 drawdown%를 계산하는 방식이 가장 효율적이다 (추가 API 불필요):

```typescript
// lib/drawdown.ts
export function computeDrawdownSeries(
  equityPoints: EquityPoint[]
): { timestamp: string; drawdownPct: number; equity: number; peak: number }[] {
  let peak = 0;
  return equityPoints.map((point) => {
    const equity = parseFloat(point.equity) || 0;
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    return {
      timestamp: point.timestamp,
      drawdownPct,
      equity,
      peak,
    };
  });
}
```

**DrawdownChart 컴포넌트 설계**:

```
+-----------------------------------------------+
| 드로다운 추이                    최대: -5.23%  |
|                                                |
|  0% ─────────────────────────────────────      |
| -1%         ╲                                  |
| -2%          ╲     ╱╲                          |
| -3%           ╲   ╱  ╲                         |
| -4%            ╲_╱    ╲                        |
| -5%                    ╲_____                  |
| --- 경고선 (50%) ---- ---- ---- ---- ----      |
| --- 한도선 (100%) ---- ---- ---- ---- ---      |
|                                                |
|  10:00    11:00    12:00    13:00    14:00      |
+-----------------------------------------------+
```

- **Area chart** (Recharts AreaChart): 0%에서 아래로 내려가는 형태. 빨간색/주황색 그라데이션
- **경고선**: maxDrawdownPercent의 50% 지점에 점선 (DrawdownMonitor의 warningThreshold에 대응)
- **한도선**: maxDrawdownPercent 지점에 실선 (이 선을 넘으면 halt)
- **최대 드로다운 라벨**: 차트 우상단에 세션 내 최대 drawdown% 표시
- **색상 구간**: 0~3% emerald, 3~5% amber, 5%+ red (기존 RiskStatusPanel 색상 체계와 일치)
- **Tooltip**: 시간, drawdown%, equity, peak equity 표시

**배치 위치**:

현재 대시보드 Row 3에 `RiskStatusPanel(1/3) + EquityCurveChart(2/3)` 구성인데, DrawdownChart를 추가하면:

**Option A** — EquityCurveChart 내부 탭:
```
Row 3: RiskStatusPanel(1/3) + [Tab: 에쿼티 커브 | 드로다운](2/3)
```
장점: 추가 공간 불필요. 단점: 동시에 두 차트를 볼 수 없음

**Option B** — 새로운 Row 삽입:
```
Row 3: RiskStatusPanel(1/3) + EquityCurveChart(2/3)
Row 3.5: DrawdownChart (full width, 높이 200px)
```
장점: 동시 확인 가능. 단점: 페이지 길이 증가

**권장**: **Option A (탭 방식)**. EquityCurveChart를 감싸는 래퍼 컴포넌트에서 탭으로 전환. 대시보드 레이아웃 변경 최소화. 기존 `ui/Tabs.tsx` 재사용.

**변경 파일**:
- `frontend/src/components/DrawdownChart.tsx` — 신규 생성
- `frontend/src/lib/drawdown.ts` — 신규 생성 (drawdown 계산 유틸)
- `frontend/src/components/EquityChartSection.tsx` — 신규 생성 (에쿼티/드로다운 탭 래퍼)
- `frontend/src/app/page.tsx` — `EquityCurveChart` → `EquityChartSection`으로 교체

**구현 난이도**: 중
**예상 영향**: 드로다운 추이를 시각적으로 파악 가능. "드로다운이 점점 커지고 있는가?" → 즉시 시각적 확인. 리스크 경고선과 한도선으로 현재 위치의 위험도 직관적 인지

---

### T2-11: Risk Gauge 대시보드 (시각적 게이지)

**현재 상태** (`frontend/src/components/RiskStatusPanel.tsx`):

리스크 상태가 3개의 개별 progress bar + 텍스트로 표시:
1. 서킷 브레이커: Badge (정상/발동)
2. 드로다운: 수평 progress bar (h-1.5) + 수치
3. 노출도: 수평 progress bar (h-1.5) + 수치

**문제점**:
- **전체 리스크 수준이 한눈에 안 보임**: 3개 지표를 개별적으로 읽고 머릿속에서 종합해야 함
- **progress bar가 너무 작음**: h-1.5 (6px) 높이로 시각적 존재감이 미약
- **위험도 변화에 대한 직관적 반응 부족**: 숫자를 읽어야 위험 수준 파악 가능

**제안 구현 — 반원형 종합 Risk Gauge**:

```
           ╭────────╮
         ╱    GREEN   ╲
       ╱   ╱────────╲   ╲
     ╱   ╱   AMBER     ╲   ╲
   ╱   ╱   ╱────────╲     ╲   ╲
 ╱   ╱   ╱    RED      ╲     ╲   ╲
│   │   │                │     │   │
 ╲   ╲   ╲              ╱     ╱   ╱
                  ▲
                 42%
           종합 리스크
```

**종합 리스크 점수 계산 로직**:

```typescript
function computeRiskScore(riskStatus: RiskStatus): number {
  const { circuitBreaker, drawdownMonitor, exposureGuard } = riskStatus;

  // 서킷 브레이커: tripped이면 100%
  if (circuitBreaker.tripped) return 100;

  // 드로다운 비중 50%, 노출도 비중 50%
  const drawdownPct = Math.abs(parseFloat(drawdownMonitor.currentDrawdown) || 0);
  const exposurePct = parseFloat(exposureGuard.utilizationPercent) || 0;

  // 드로다운: maxDrawdownPercent 대비 비율 (0~100%)
  // 현재 maxDrawdownPercent는 riskStatus에 없으므로 기본값 10% 사용
  // 또는 백엔드에서 params를 포함하도록 요청 (다른 에이전트 요청 사항 참고)
  const MAX_DD = 10; // 기본 maxDrawdownPercent
  const ddNormalized = Math.min((drawdownPct / MAX_DD) * 100, 100);

  // 노출도: 이미 0~100% 범위
  const expNormalized = Math.min(exposurePct, 100);

  // 가중 평균 (드로다운이 더 위험하므로 60:40)
  return Math.round(ddNormalized * 0.6 + expNormalized * 0.4);
}
```

**Risk Gauge 컴포넌트 설계**:

SVG 기반 반원형 게이지 (외부 라이브러리 불필요):

```tsx
// components/RiskGauge.tsx
interface RiskGaugeProps {
  riskStatus: RiskStatus;
  size?: number; // default 160
}

export default function RiskGauge({ riskStatus, size = 160 }: RiskGaugeProps) {
  const score = computeRiskScore(riskStatus);
  const color = score > 70 ? '#ef4444' : score > 40 ? '#f59e0b' : '#10b981';
  const label = score > 70 ? '위험' : score > 40 ? '주의' : '안전';

  // SVG arc path 계산
  // 반원: 180도 = 0~100% 범위 매핑
  const angle = (score / 100) * 180;
  // ...
}
```

**시각 요소**:
- **배경 호**: 3색 구간 (emerald 0-40%, amber 40-70%, red 70-100%)
- **전경 호**: 현재 점수까지 채워진 호 (밝은 색상)
- **바늘**: 현재 점수 위치를 가리키는 얇은 삼각형 바늘
- **중앙 숫자**: 종합 리스크 점수 (%)
- **상태 라벨**: "안전" / "주의" / "위험"
- **애니메이션**: 값 변경 시 바늘이 부드럽게 이동 (CSS transition 또는 requestAnimationFrame)

**접근성 고려**:
- `aria-label="종합 리스크 42% — 주의"` 추가
- 색상만으로 상태를 구분하지 않도록 텍스트 라벨 병행
- `role="meter"` + `aria-valuemin="0"` + `aria-valuemax="100"` + `aria-valuenow={score}` 추가

**배치 위치**:

현재 `RiskStatusPanel` 상단에 종합 게이지 삽입:

```
RiskStatusPanel:
+---------------------------+
| 리스크 상태               |
|                           |
|     [Risk Gauge 반원]     |    ← 신규
|        42% 주의           |
|                           |
| 서킷 브레이커    ● 정상   |    ← 기존
| 드로다운      ──────  2.3%|    ← 기존
| 노출도        ──────  45% |    ← 기존
+---------------------------+
```

**변경 파일**:
- `frontend/src/components/RiskGauge.tsx` — 신규 생성 (SVG 기반 반원형 게이지)
- `frontend/src/components/RiskStatusPanel.tsx` — RiskGauge 삽입
- `frontend/src/lib/risk.ts` — 신규 생성 (computeRiskScore 유틸)

**구현 난이도**: 중~높 (SVG 호/바늘 계산 + 애니메이션)
**예상 영향**: 리스크 상태를 한눈에 직관적 파악 가능. Bloomberg Terminal, Binance의 리스크 대시보드와 유사한 프로페셔널 UX

---

### T2-12: 적응형 폴링 (봇 상태별 간격 조절)

**현재 상태**:

| 훅 | 기본 간격 | 파일 | 참고 |
|----|-----------|------|------|
| `useBotStatus` | 5,000ms | `hooks/useBotStatus.ts` L22 | `pollInterval` param 있으나 상수 사용 |
| `usePositions` | 5,000ms | `hooks/usePositions.ts` L13 | 동일 |
| `useTrades` | 10,000ms | `hooks/useTrades.ts` L7 | `pollInterval` param 있음 |
| `useHealthCheck` | 30,000ms | `hooks/useHealthCheck.ts` L7 | 동일 |
| `useAnalytics` | 없음 (1회) | `hooks/useAnalytics.ts` | sessionId 변경 시 1회 fetch |

모든 훅의 폴링 패턴이 동일하다 (`hooks/useBotStatus.ts` L39~L43):
```typescript
useEffect(() => {
  fetchStatus();
  const interval = setInterval(fetchStatus, pollInterval);
  return () => clearInterval(interval);
}, [fetchStatus, pollInterval]);
```

**문제점**:
- **봇 idle 시 과도한 폴링**: 봇이 `idle` 상태(포지션 0, 전략 비활성)인데도 5초마다 positions/status를 조회
- **봇 running 시 부족할 수 있음**: 활성 거래 중에는 positions를 3초마다 조회하고 싶을 수 있음
- **탭 비활성 시 낭비**: 사용자가 다른 탭을 보고 있을 때도 동일 간격으로 폴링
- **서버 부하**: 클라이언트가 다수 연결 시 불필요한 API 요청 증가

**제안 구현 — useAdaptivePolling 훅**:

```typescript
// hooks/useAdaptivePolling.ts

type BotPhase = 'idle' | 'active' | 'halted';

interface PollingConfig {
  idle: number;    // 봇 미실행: 긴 간격
  active: number;  // 봇 실행 중: 짧은 간격
  halted: number;  // 리스크 할트: 중간 간격
  hidden: number;  // 탭 비활성: 매우 긴 간격
}

const DEFAULT_CONFIGS: Record<string, PollingConfig> = {
  botStatus:  { idle: 15000, active: 5000,  halted: 10000, hidden: 30000 },
  positions:  { idle: 30000, active: 3000,  halted: 10000, hidden: 60000 },
  trades:     { idle: 30000, active: 10000, halted: 15000, hidden: 60000 },
  health:     { idle: 60000, active: 30000, halted: 30000, hidden: 120000 },
};

export function useAdaptivePolling(
  fetchFn: () => Promise<void>,
  configKey: keyof typeof DEFAULT_CONFIGS,
  botState: BotState,
  riskHalted: boolean = false,
) {
  const config = DEFAULT_CONFIGS[configKey];

  // Document visibility detection
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Determine current interval
  const interval = useMemo(() => {
    if (!isVisible) return config.hidden;
    if (riskHalted) return config.halted;
    if (botState === 'running') return config.active;
    return config.idle;
  }, [isVisible, riskHalted, botState, config]);

  // Dynamic interval with setInterval
  useEffect(() => {
    fetchFn();
    const id = setInterval(fetchFn, interval);
    return () => clearInterval(id);
  }, [fetchFn, interval]);
}
```

**폴링 간격 매트릭스**:

| 훅 | idle | active (running) | halted | hidden (탭 비활성) |
|----|------|-------------------|--------|---------------------|
| botStatus | 15s | 5s | 10s | 30s |
| positions | 30s | 3s | 10s | 60s |
| trades | 30s | 10s | 15s | 60s |
| health | 60s | 30s | 30s | 120s |

**적용 방법** — 기존 훅 수정:

```typescript
// hooks/useBotStatus.ts — 변경 후
export function useBotStatus() {
  // ... 기존 state/fetch 로직

  useAdaptivePolling(fetchStatus, 'botStatus', status.status, status.riskStatus.drawdownMonitor.halted);

  // ... 기존 action 함수들
}
```

**추가 최적화 — Page Visibility API**:
`document.hidden`이 `true`일 때 폴링 간격을 대폭 늘리거나 아예 중단. 탭 복귀 시 즉시 fetch 1회 실행 후 정상 간격으로 복귀.

```typescript
// 탭 복귀 시 즉시 데이터 갱신
useEffect(() => {
  const handler = () => {
    if (!document.hidden) {
      // 탭 복귀 — 즉시 최신 데이터 fetch
      fetchFn();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, [fetchFn]);
```

**변경 파일**:
- `frontend/src/hooks/useAdaptivePolling.ts` — 신규 생성
- `frontend/src/hooks/useBotStatus.ts` — `useAdaptivePolling` 적용
- `frontend/src/hooks/usePositions.ts` — `useAdaptivePolling` 적용
- `frontend/src/hooks/useTrades.ts` — `useAdaptivePolling` 적용
- `frontend/src/hooks/useHealthCheck.ts` — `useAdaptivePolling` 적용

**구현 난이도**: 중
**예상 영향**: idle 상태에서 API 호출 횟수 ~75% 감소 (5s→30s). 탭 비활성 시 ~90% 감소. 서버 부하 절감. 활성 거래 중에는 더 빠른 갱신(positions 3s)으로 UX 향상

---

## Backend 항목 — 프론트엔드 소비 관점 리뷰

### T2-1: RSI Wilder smoothing 구현

**프론트엔드 영향**: 없음. RSI 계산은 순수 백엔드 전략 내부 로직. 시그널 품질이 향상되면 SignalFeed에 표시되는 시그널의 정확도가 간접적으로 개선됨.

**요청 사항**: 없음.

### T2-2: Confidence-based signal filtering (전략별 임계값)

**프론트엔드 영향**: 간접적. confidence 임계값 미달 시그널이 필터링되면 SignalFeed에 표시되는 시그널 수가 줄어들 수 있음.

**요청 사항**: 필터링된 시그널도 `trade:signal_skipped` 이벤트로 전송된다면, SignalFeed에서 "필터링됨" 상태로 표시할 수 있음. `signal_skipped` 이벤트에 `reason: 'confidence_below_threshold'`와 함께 `confidence` 값을 포함해 달라.

### T2-3: Backtest default position size 95% → 전략 메타 기반

**프론트엔드 영향**: 없음. 백테스트 엔진 내부 로직.

### T2-4: FundingRateStrategy 데이터 소스 구축

**프론트엔드 영향**: 없음. 전략 내부 데이터 수집 로직.

### T2-5: GridStrategy equity 주입 (DI context 패턴)

**프론트엔드 영향**: 없음. 전략 내부 DI 패턴.

### T2-7: API rate limiting (express-rate-limit)

**프론트엔드 영향**: **직접적**. 적응형 폴링(T2-12) 구현 전에 rate limiting이 설정되면, 현재의 고빈도 폴링(5초)이 rate limit에 걸릴 수 있음.

**요청 사항**:
1. Rate limit 응답 형식이 `{ success: false, error: 'Too Many Requests' }` 규약을 준수하도록 `express-rate-limit`의 `handler` 커스터마이즈 필요
2. `api-client.ts`의 `ApiError`가 HTTP 429를 식별할 수 있도록 상태 코드 전달
3. Rate limit 설정값 공유 (예: 100 req/min): T2-12의 폴링 간격 산정에 필요
4. `/api/health/ping`은 rate limit에서 제외 권장 (헬스체크는 모니터링 목적)

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한

**프론트엔드 영향**: 없음. 백엔드 메모리 관리 로직.

---

## 제안 사항 (우선순위, 구현 난이도, 구현 가이드)

| 순위 | ID | 제목 | 난이도 | 영향도 | 비고 |
|------|----|------|--------|--------|------|
| 1 | T2-12 | 적응형 폴링 | 중 | 높음 | T2-7(rate limiting) 적용 전에 선행 필요. 성능+서버 부하 개선 |
| 2 | T2-6 | useSocket 목적별 분리 | 중 | 높음 | 성능 기반 인프라. ticker 이벤트 리렌더 제거 |
| 3 | T2-8 | SignalFeed rejectReason | 낮 | 중 | 빠른 구현. 트레이딩 의사결정 투명성 향상 |
| 4 | T2-11 | Risk Gauge | 중~높 | 중 | SVG 커스텀 컴포넌트. 시각적 UX 대폭 개선 |
| 5 | T2-10 | Drawdown 차트 | 중 | 중 | 추가 API 불필요(equity curve에서 파생). 리스크 분석 강화 |

### 구현 순서 권장

1. **Phase 1**: T2-12 (적응형 폴링) + T2-8 (rejectReason) — 병렬 작업 가능. T2-12는 인프라, T2-8은 독립적 UI 변경
2. **Phase 2**: T2-6 (useSocket 분리) — Phase 1 완료 후. 소켓 구조 변경이 다른 기능에 영향 가능
3. **Phase 3**: T2-11 (Risk Gauge) + T2-10 (Drawdown 차트) — 병렬 작업 가능. 둘 다 신규 컴포넌트

### 구현 가이드 요약

| ID | 신규 파일 | 수정 파일 | 핵심 기술 |
|----|-----------|-----------|-----------|
| T2-6 | `useSocketConnection.ts`, `useSocketSignals.ts`, `useSocketRisk.ts`, `useSocketMarket.ts` | `useSocket.ts`, `page.tsx` | React hooks, Socket.io, state 분리 |
| T2-8 | — | `SignalFeed.tsx`, `utils.ts`, `useSocket.ts` | 조건부 렌더링, 번역 함수 |
| T2-10 | `DrawdownChart.tsx`, `drawdown.ts`, `EquityChartSection.tsx` | `page.tsx` | Recharts AreaChart, 수학 계산, Tabs |
| T2-11 | `RiskGauge.tsx`, `risk.ts` | `RiskStatusPanel.tsx` | SVG path, arc 계산, CSS animation |
| T2-12 | `useAdaptivePolling.ts` | `useBotStatus.ts`, `usePositions.ts`, `useTrades.ts`, `useHealthCheck.ts` | Page Visibility API, dynamic interval |

---

## 다른 에이전트에게 요청 사항

### Trader 에이전트에게

1. **T2-11 종합 리스크 점수 가중치 검토**: 제안된 가중치(드로다운 60% + 노출도 40%)가 트레이딩 관점에서 적절한지. 서킷 브레이커 연속 손실 횟수도 점수에 반영해야 하는지. `consecutiveLosses` 값을 0~100%로 정규화하는 방법 제안 필요 (예: consecutiveLosses / consecutiveLossLimit * 100)

2. **T2-12 폴링 간격 검토**: 제안된 간격 매트릭스가 트레이딩 의사결정에 적절한지:
   - idle 시 positions 30초가 너무 긴지 (수동 주문 후 갱신 대기)
   - active 시 positions 3초가 충분한지 (급변 시장에서)
   - halted 시 10초가 적절한지 (리스크 상황 모니터링)

3. **T2-8 rejectReason 우선순위 검토**: 거부 사유별 심각도 분류가 필요한지. 예: `total_exposure_exceeded`는 "조건부 재시도 가능"이나 `circuit_breaker_active`는 "쿨다운 대기 필요". 시그널 피드에서 재시도 가능 여부를 힌트로 표시할지 여부

4. **T2-10 드로다운 경고/한도 기준값 확인**: 현재 DrawdownMonitor의 `maxDrawdownPercent`와 `maxDailyLossPercent` 기본값이 무엇인지. DrawdownChart의 경고선/한도선 위치 결정에 필요

### Engineer 에이전트에게

1. **T2-7 (rate limiting) 연동 요청**:
   - Rate limit 응답이 `{ success: false, error: '...', statusCode: 429 }` 형식을 따르도록 `express-rate-limit`의 커스텀 핸들러 구현 필요
   - `/api/health/ping`은 rate limit 제외 요청
   - Rate limit 한도값(requests/window) 공유 필요: T2-12의 폴링 간격 산정 근거

2. **T2-11 Risk Gauge 데이터 보강 요청**: `riskEngine.getStatus()` 반환값에 다음 필드 추가 필요:
   - `drawdownMonitor.params.maxDrawdownPercent` — 드로다운 한도(%). RiskGauge가 0~100% 정규화를 하려면 최대값을 알아야 함
   - `drawdownMonitor.params.maxDailyLossPercent` — 일일 손실 한도(%)
   - `circuitBreaker.consecutiveLossLimit` — 연속 손실 한도
   - 현재 `getStatus()`의 `circuitBreaker`에는 `params: { ... }`가 포함되어 있으나 (`circuitBreaker.js` L174~L182`), 프론트엔드 `RiskStatus` 타입에 반영되어 있지 않음. **타입 확장 또는 별도 endpoint(/api/risk/params) 필요**

3. **T2-2 (confidence filtering) 이벤트 전달 요청**: 필터링된 시그널을 `trade:signal_skipped` 이벤트로 emit 시, `{ reason: 'confidence_below_threshold', confidence: 0.35, threshold: 0.50, strategy, symbol }` 형태로 전송 요청. SignalFeed에서 필터링 상태를 표시하기 위함

4. **T2-6 socket 이벤트 구독 확인**: useSocket 분리 시, 현재 백엔드에서 `signal_generated` 이벤트가 `{ signal: Signal, approved: boolean, rejectReason?: string }` 형태로 emit되는지, 아니면 `Signal` 객체가 직접 emit되는지 확인 필요. `app.js` L273~L274를 보면 `data`를 그대로 릴레이하므로, `orderManager`의 emit 형태(`{ signal: rejectedSignal.toObject(), approved, rejectReason }`)가 최종 형태임. 이 페이로드 구조를 공식화하여 프론트엔드 타입과 정합성 확보 필요.

---

## 아키텍처 결정 제안

### AD-18: useSocket 분리 전략 (Proposed)

**결정**: 단일 `useSocket` 훅을 4개의 목적별 훅으로 분리하되, 기존 `useSocket`을 facade로 유지하여 하위 호환성 보장.

**근거**: 고빈도 이벤트(ticker)가 저빈도 UI(signals, risk)를 리렌더하는 성능 문제 해결. 각 훅이 독립적으로 상태를 관리하여 컴포넌트별 필요한 데이터만 구독.

**영향**: 모든 소켓 이벤트 구독 코드. 기존 API 유지로 마이그레이션 비용 최소.

### AD-19: 적응형 폴링 간격 표준 (Proposed)

**결정**: `useAdaptivePolling` 훅을 통해 봇 상태(idle/active/halted)와 탭 가시성(visible/hidden)에 따라 폴링 간격을 동적 조절.

**근거**: idle 시 불필요한 서버 요청 75% 감소, 탭 비활성 시 90% 감소. 반면 active 시에는 positions 갱신 빈도를 5s→3s로 높여 UX 향상.

**영향**: 모든 REST 폴링 훅. T2-7(rate limiting)과 시너지.

### AD-20: 클라이언트 측 Drawdown 계산 (Proposed)

**결정**: 드로다운 차트의 데이터를 추가 API 없이 기존 equity curve 데이터에서 클라이언트 측 계산으로 파생.

**근거**: Snapshot 모델에 equity 히스토리가 이미 존재하고, drawdown = peak - current 관계는 단순 수학 계산. 추가 백엔드 API 개발 없이 즉시 구현 가능.

**영향**: DrawdownChart 컴포넌트. equity curve 데이터가 충분히 작은 범위(세션 단위)이므로 클라이언트 계산 부하 무시 가능.
