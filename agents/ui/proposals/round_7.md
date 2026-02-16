# Round 7 UI Proposal: 레짐 변경 빈도 문제 대응 UI

**Author**: UI/UX Agent
**Date**: 2026-02-16
**Topic**: A+B 조합 (hysteresis 상향 + 전략 deactivate 유예기간) 프론트엔드 영향 분석

---

## 분석 요약

백엔드에서 레짐 변경 빈도 문제를 해결하기 위해 두 가지 메커니즘이 도입된다:

- **A**: `hysteresisMinCandles` 상향 + 레짐 전환 쿨다운 (MarketRegime 레이어)
- **B**: 전략 deactivate 유예기간 (StrategyRouter 레이어)

이 변경은 프론트엔드에 **중간 상태(intermediate states)** 를 도입한다. 현재 UI는 레짐이 "확정" 또는 "미확정", 전략이 "활성" 또는 "비활성"인 이진 상태만 표현한다. A+B 조합 이후에는:

1. 레짐: `confirmed` / `pending` (hysteresis 대기) / `cooldown` (전환 쿨다운 중)
2. 전략: `active` / `grace` (유예기간 - 신규 진입 차단, 기존 포지션 유지) / `deactivated`

이 세 가지 상태를 시각적으로 명확하게 구분하지 않으면, 트레이더는 "왜 전략이 시그널을 안 내는지", "레짐이 바뀌었는데 왜 전략이 아직 살아있는지" 혼란을 겪는다.

---

## 발견 사항

### 1. 현재 레짐 표시의 한계

**파일**: `frontend/src/components/MarketRegimeIndicator.tsx` (42줄)

현재 구현은 극히 단순하다:
```tsx
// Line 12-13
const currentRegime = regime?.regime || 'unknown';
const confidence = regime?.confidence ?? 0;
```
- 레짐 이름 + 신뢰도 % + 타임스탬프만 표시
- `pendingRegime` 필드가 `RegimeContext` 타입에 이미 존재하지만 (`types/index.ts:381`), 이 컴포넌트에서 사용하지 않음
- 쿨다운 상태 표시 없음
- 레짐이 "확정 전 대기 중"인지 알 수 없음

**파일**: `frontend/src/components/market-intel/MarketIntelligence.tsx`

- 시장 분석 패널 헤더에도 현재 레짐만 표시 (line 39: `regime = regimeContext?.regime`)
- `pendingRegime`이 있어도 무시됨

**파일**: `frontend/src/components/market-intel/FactorBreakdown.tsx`

- 팩터 분석 탭에서 현재 레짐 + 신뢰도만 표시
- 히스테리시스 상태(대기 중인 레짐, 확정까지 남은 캔들 수)를 표시할 공간이 없음

### 2. 전략 상태 표현의 이진성

**파일**: `frontend/src/components/strategy/StrategyCard.tsx` (180줄)

전략 상태는 완전한 이진:
```tsx
// Line 148-149: 활성/비활성 배지
<Badge variant={active ? 'success' : 'neutral'} dot>
  {active ? '활성' : '비활성'}
</Badge>
```
- "유예기간(grace)" 상태가 없음
- 유예기간 중에는 `active=true`이지만 신규 진입이 차단됨 -- 사용자에게 이 차이가 전혀 전달되지 않음

**파일**: `frontend/src/components/strategy/StrategyHub.tsx` (347줄)

- `isRecommended()` 함수 (line 106-112)는 `currentRegime`과 `targetRegimes`만 비교
- 유예기간 전략은 "추천되지 않지만 활성" 상태에 빠지고, 현재 UI에서 `opacity-50`으로만 표시됨 (StrategyCard line 76)
- 이 상태가 "레짐이 바뀌어서 곧 비활성화" vs "원래 비추천이지만 수동 활성화"인지 구분할 수 없음

### 3. 레짐 전환 히스토리의 빈도 정보 부재

**파일**: `frontend/src/components/market-intel/RegimeTimeline.tsx` (139줄)

- 타임라인 바와 로그 목록은 존재하지만, **전환 빈도 지표**가 없음
- 예: "최근 1시간 내 5회 전환" 같은 경고성 정보가 없음
- 레짐 분포(distribution)는 비율만 보여주고, 잦은 전환이 문제라는 것을 직관적으로 파악하기 어려움

### 4. 전략 라우팅 맵의 상태 단순성

**파일**: `frontend/src/components/market-intel/RegimeFlowMap.tsx` (126줄)

- 활성/비활성만 구분 (line 18-19)
- 유예기간 전략은 "활성" 목록에 남아 있을 것이나, 실질적으로 신규 진입이 차단된 상태를 시각적으로 구분 불가

### 5. Socket 이벤트 갭

**파일**: `frontend/src/lib/socket.ts` / `frontend/src/hooks/useSocket.ts`

현재 정의된 소켓 이벤트에 다음이 누락:
- `strategy:grace_started` — 유예기간 진입 이벤트
- `strategy:grace_expired` — 유예기간 만료 이벤트
- `regime:cooldown_active` — 레짐 전환 쿨다운 상태
- `regime:pending_change` — 히스테리시스 대기 중 레짐

`SOCKET_EVENTS`(`socket.ts:84-111`)에 이 이벤트들이 추가되어야 함.

### 6. 타입 정의 갭

**파일**: `frontend/src/types/index.ts`

- `StrategyListItem` (line 174-181)에 `status` 필드가 없음 -- `active: boolean`만 존재
- `StrategyRoutingEntry` (line 351-356)도 `active: boolean`만 존재
- `RegimeContext` (line 367-383)에 `pendingRegime`이 있지만, `cooldownRemaining`, `hysteresisProgress` 등이 없음
- `MarketRegimeData` (line 161-165)에 쿨다운/히스테리시스 정보가 없음

---

## 제안 사항

### P0: 필수 (백엔드 변경에 맞춰 반드시 구현)

#### P0-1. 전략 상태 3-way 배지 (grace 상태 추가)

| 항목 | 내용 |
|------|------|
| **우선순위** | P0 |
| **난이도** | Low |
| **예상 시간** | 1~2시간 |
| **영향 파일** | `StrategyCard.tsx`, `Badge.tsx`, `types/index.ts` |

**현황**: `active ? '활성' : '비활성'` 이진 표현
**변경**: 3-way 상태 (`active` / `grace` / `inactive`)

타입 변경:
```typescript
// types/index.ts — StrategyListItem 확장
export interface StrategyListItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  targetRegimes: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  active: boolean;
  // NEW: A+B 조합 추가 필드
  routerState?: 'active' | 'grace' | 'inactive';  // strategyRouter가 관리하는 상태
  graceExpiresAt?: string;  // 유예기간 만료 시각 (ISO)
  graceReason?: string;     // 유예기간 사유 (예: "regime_mismatch")
}
```

Badge 디자인:
- **활성 (active)**: 초록색 dot + "활성" (현재와 동일)
- **유예 (grace)**: 호박색(amber) dot + "유예 중" + 남은 시간 카운트다운
  - `bg-amber-500/20 text-amber-400` + pulsing dot
  - 툴팁: "레짐 변경으로 유예기간 진입 — 신규 진입 차단, 기존 포지션 SL/TP 청산 대기"
- **비활성 (inactive)**: 회색 dot + "비활성" (현재와 동일)

StrategyCard.tsx 변경:
```tsx
// Line 148 부근 대체
const stateVariant = strategy.routerState === 'grace' ? 'warning'
                   : active ? 'success' : 'neutral';
const stateLabel = strategy.routerState === 'grace' ? '유예 중'
                 : active ? '활성' : '비활성';

<Badge variant={stateVariant} dot>
  {stateLabel}
</Badge>
```

#### P0-2. 레짐 pending/cooldown 상태 표시

| 항목 | 내용 |
|------|------|
| **우선순위** | P0 |
| **난이도** | Low-Medium |
| **예상 시간** | 2~3시간 |
| **영향 파일** | `MarketRegimeIndicator.tsx`, `MarketIntelligence.tsx`, `FactorBreakdown.tsx`, `types/index.ts` |

**현황**: 확정된 레짐만 표시
**변경**: pending 레짐 + 확정까지 남은 캔들 수 + 쿨다운 상태 표시

타입 변경:
```typescript
// types/index.ts — MarketRegimeData 확장
export interface MarketRegimeData {
  regime: MarketRegime;
  confidence: number;
  timestamp: string;
  // NEW
  pendingRegime?: MarketRegime | null;
  pendingCount?: number;          // 현재까지 확인된 캔들 수
  hysteresisRequired?: number;    // 확정에 필요한 캔들 수
  cooldownActive?: boolean;       // 전환 쿨다운 활성 여부
  cooldownRemaining?: number;     // 남은 쿨다운 시간 (ms)
}

// types/index.ts — RegimeContext 확장
export interface RegimeContext {
  // ...기존 필드 유지
  pendingRegime?: string | null;
  pendingCount?: number;
  hysteresisRequired?: number;
  cooldownActive?: boolean;
  cooldownRemaining?: number;
}
```

MarketRegimeIndicator.tsx에 pending 표시:
```tsx
// 현재 레짐 옆에 pending 레짐 표시
{regime?.pendingRegime && (
  <span className="text-xs text-amber-400/60 flex items-center gap-1">
    <svg className="w-3 h-3 animate-spin" .../>
    {translateRegime(regime.pendingRegime)} 전환 대기
    ({regime.pendingCount}/{regime.hysteresisRequired} 캔들)
  </span>
)}
{regime?.cooldownActive && (
  <span className="text-xs text-blue-400/60">
    쿨다운 중
  </span>
)}
```

#### P0-3. Socket 이벤트 + 상태 연동

| 항목 | 내용 |
|------|------|
| **우선순위** | P0 |
| **난이도** | Medium |
| **예상 시간** | 2~3시간 |
| **영향 파일** | `socket.ts`, `useSocket.ts`, `useMarketIntelligence.ts` |

**변경**: 새 이벤트 수신 및 상태 업데이트

socket.ts 추가:
```typescript
export const SOCKET_EVENTS = {
  // ...기존 유지
  // NEW: Grace period events
  STRATEGY_GRACE_STARTED: 'strategy:grace_started',
  STRATEGY_GRACE_EXPIRED: 'strategy:grace_expired',
  // NEW: Regime stability events
  REGIME_PENDING: 'market:regime_pending',
  REGIME_COOLDOWN: 'market:regime_cooldown',
} as const;
```

useSocket.ts에서 grace 이벤트 수신 시 StrategyHub에 전달하여 UI 갱신 트리거.

---

### P1: 강력 추천 (UX 품질 향상)

#### P1-1. 유예기간 카운트다운 타이머

| 항목 | 내용 |
|------|------|
| **우선순위** | P1 |
| **난이도** | Low |
| **예상 시간** | 1시간 |
| **영향 파일** | `StrategyCard.tsx` (신규 훅 또는 인라인) |

유예기간 중인 전략 카드에 남은 시간 카운트다운:
```
[amber dot] 유예 중  02:34 남음
```
- `graceExpiresAt`으로부터 `setInterval`로 1초마다 갱신
- 0 도달 시 자동으로 배지가 '비활성'으로 전환 (다음 폴링에서 확정)

#### P1-2. 레짐 전환 빈도 경고 인디케이터

| 항목 | 내용 |
|------|------|
| **우선순위** | P1 |
| **난이도** | Medium |
| **예상 시간** | 2~3시간 |
| **영향 파일** | `RegimeTimeline.tsx`, `MarketIntelligence.tsx` |

RegimeTimeline에 "전환 빈도 지표" 추가:
```
최근 1시간: 2회 전환 (안정)    ← 녹색
최근 1시간: 5회 전환 (빈번)    ← 호박색
최근 1시간: 8회 전환 (과다)    ← 빨간색
```

계산 로직:
```typescript
const recentTransitions = segments.filter(s => Date.now() - s.ts < 3600_000).length;
const frequencyLevel = recentTransitions <= 3 ? 'stable'
                      : recentTransitions <= 6 ? 'frequent' : 'excessive';
```

MarketIntelligence 헤더에 소형 빈도 배지 추가 (닫힌 상태에서도 보이도록):
```
시장 분석  [상승 추세]  42%  |  전환 빈도: 안정
```

#### P1-3. 전략 상태 전이 히스토리 (StrategyCard 내부)

| 항목 | 내용 |
|------|------|
| **우선순위** | P1 |
| **난이도** | Medium |
| **예상 시간** | 2~3시간 |
| **영향 파일** | `StrategyDetail.tsx`, `useStrategyDetail.ts`, 타입 확장 |

StrategyDetail 탭에 "상태 변경" 탭 추가:
```
[포지션] [거래내역] [시그널] [상태 변경]
```

상태 변경 로그:
```
14:23  활성 → 유예   (레짐: 상승추세 → 횡보)
14:26  유예 → 비활성  (유예기간 만료)
14:45  비활성 → 활성   (레짐: 횡보 → 상승추세)
```

이를 위해 백엔드에서 `strategy:grace_started`, `strategy:activated`, `strategy:deactivated` 이벤트에 타임스탬프와 사유를 포함해야 하며, 프론트엔드에서 소켓 이벤트를 로컬 배열로 축적.

---

### P2: 선택적 (나중에 해도 됨)

#### P2-1. 전략-레짐 호환성 매트릭스 시각화 (기존 T3-12 연계)

| 항목 | 내용 |
|------|------|
| **우선순위** | P2 |
| **난이도** | High |
| **예상 시간** | 4~6시간 |
| **영향 파일** | 신규 컴포넌트 `StrategyRegimeMatrix.tsx` |

18개 전략 x 5개 레짐 매트릭스를 히트맵으로 시각화:
- 각 셀: 해당 레짐에서의 전략 승률/PnL (백테스트 데이터 기반)
- 현재 레짐 행 하이라이트
- 유예기간 전략 셀에 amber 테두리

이 기능은 기존 deferred T3-12 (전략-레짐 호환성 매트릭스)와 직결되며, Round 7에서는 스코프 밖으로 둔다.

#### P2-2. 레짐 파라미터 설정 UI

| 항목 | 내용 |
|------|------|
| **우선순위** | P2 |
| **난이도** | Medium-High |
| **예상 시간** | 3~5시간 |
| **영향 파일** | 신규 컴포넌트, `api-client.ts` 확장 |

운영자가 대시보드에서 직접 조정:
- `hysteresisMinCandles` (슬라이더: 1~10)
- 전환 쿨다운 시간 (분 단위)
- 유예기간 길이 (분 단위)

이 기능은 `regimeParamStore`가 이미 백엔드에 존재하므로 API만 연결하면 되지만, 잘못된 설정이 치명적일 수 있어 "고급 설정" 섹션에 경고와 함께 배치해야 한다.

#### P2-3. RegimeFlowMap에 grace 상태 레인 추가

| 항목 | 내용 |
|------|------|
| **우선순위** | P2 |
| **난이도** | Low-Medium |
| **예상 시간** | 1~2시간 |
| **영향 파일** | `RegimeFlowMap.tsx` |

현재 3-column 레이아웃(regime / active / inactive)을 4-column으로:
```
[현재 레짐] → [활성] / [유예 중] / [비활성]
```

유예 중 전략에 amber 배경 + 남은 시간 표시.

---

## 구현 우선순위 총괄

| ID | 제목 | 우선순위 | 난이도 | 시간 | 의존성 |
|----|------|---------|--------|------|--------|
| P0-1 | 전략 3-way 배지 | P0 | Low | 1-2h | BE: routerState 필드 |
| P0-2 | 레짐 pending/cooldown 표시 | P0 | Low-Med | 2-3h | BE: pending 데이터 |
| P0-3 | Socket 이벤트 연동 | P0 | Med | 2-3h | BE: 새 이벤트 emit |
| P1-1 | 유예기간 카운트다운 | P1 | Low | 1h | P0-1 |
| P1-2 | 전환 빈도 경고 | P1 | Med | 2-3h | 없음 (기존 데이터 활용) |
| P1-3 | 상태 전이 히스토리 | P1 | Med | 2-3h | P0-3 |
| P2-1 | 호환성 매트릭스 | P2 | High | 4-6h | 백테스트 데이터 |
| P2-2 | 파라미터 설정 UI | P2 | Med-High | 3-5h | BE: PUT API |
| P2-3 | FlowMap grace 레인 | P2 | Low-Med | 1-2h | P0-1 |

**P0 합계**: 5~8시간 (백엔드 API 준비 완료 기준)
**P0+P1 합계**: 10~15시간

---

## 다른 에이전트에게 요청 사항

### Engineer (Backend) 에이전트에게

1. **`StrategyRouter.getStatus()` 응답에 `routerState` 필드 추가**
   - 현재: `{ name, active, targetRegimes, matchesCurrentRegime }` (`strategyRouter.js:223-228`)
   - 요청: `routerState: 'active' | 'grace' | 'inactive'`, `graceExpiresAt: ISO string | null`, `graceReason: string | null` 추가
   - 이 데이터가 `/api/bot/strategies` 응답과 `/api/regime/strategy-routing` 응답 모두에 반영되어야 함

2. **`MarketRegime` 상태 API에 hysteresis/cooldown 정보 추가**
   - 현재 `RegimeContext` 응답: `{ regime, confidence, factorScores, ... }`
   - 요청: `pendingRegime`, `pendingCount`, `hysteresisRequired`, `cooldownActive`, `cooldownRemaining` 추가
   - `_pendingRegime`, `_pendingCount`는 이미 `marketRegime.js` 내부 상태로 존재 (line 162-165)

3. **새 Socket.io 이벤트 emit**
   - `strategy:grace_started` — `{ name, regime, graceExpiresAt, reason }`
   - `strategy:grace_expired` — `{ name, regime, finalAction: 'deactivated' | 'reactivated' }`
   - `market:regime_pending` — `{ pendingRegime, pendingCount, required }` (각 캔들마다)
   - `market:regime_cooldown` — `{ active: boolean, remaining: number }`

4. **레짐 전환 쿨다운 구현 시 쿨다운 시간 설정을 `regimeParamStore`에 포함**
   - 프론트엔드에서 향후 P2-2 설정 UI로 연결할 예정

### Trader (Trading Logic) 에이전트에게

1. **유예기간 동안의 전략 행동 명세 확인**
   - 유예기간 중 전략이 `getSignal()`을 호출해도 무시되는지, 아니면 호출 자체가 차단되는지?
   - 기존 포지션의 SL/TP는 그대로 유지되는지, 아니면 강화(tighter)되는지?
   - 유예기간 중 레짐이 다시 원래로 돌아오면 유예가 취소되고 재활성화되는지?

2. **유예기간 길이 파라미터 권장값**
   - 어떤 기준으로 유예기간을 설정할지 (예: 최근 레짐 평균 지속시간의 50%?)
   - 전략별로 유예기간이 달라야 하는지 (예: 스캘핑 전략은 짧게, 트렌드 전략은 길게)

3. **A안의 hysteresisMinCandles 권장값**
   - 현재 기본값: 3 (`marketRegime.js:67`)
   - 상향 목표: 몇 캔들로? 5? 7? 10?
   - 캔들 타임프레임 (현재 5m? 15m?)에 따라 체감 지연이 다르므로 명시 필요

4. **레짐 전환 쿨다운 시간 권장값**
   - 최소 몇 분? 최대 몇 분?
   - 쿨다운 중 강한 반대 시그널이 오면 쿨다운을 무시해야 하는 예외 조건이 있는지?

---

## 부록: 유예기간 상태 전이 다이어그램

```
                   레짐 변경
                   (mismatch)
    +---------+  ──────────►  +---------+  유예기간 만료  +------------+
    |  ACTIVE |               |  GRACE  | ──────────►  | DEACTIVATED|
    +---------+  ◄──────────  +---------+              +------------+
                   레짐 복귀                                  │
                   (match 재확인)                               │
                                                              │
    +---------+  ◄────────────────────────────────────────────┘
    |  ACTIVE |    레짐 변경 → match
    +---------+
```

**Grace 상태의 핵심**:
- `isActive() === true` (기존 포지션 관리 계속)
- `canOpenNewPosition() === false` (신규 진입 차단)
- UI에서 amber 색상으로 구분
- 카운트다운 타이머 표시
- 레짐이 원래로 돌아오면 즉시 `active`로 복귀 (유예 취소)

---

## 부록: 현재 컴포넌트-파일 매핑

| 컴포넌트 | 파일 경로 | Round 7 영향 |
|---------|----------|-------------|
| MarketRegimeIndicator | `components/MarketRegimeIndicator.tsx` | P0-2 |
| StrategyCard | `components/strategy/StrategyCard.tsx` | P0-1 |
| StrategyHub | `components/strategy/StrategyHub.tsx` | P0-1 |
| StrategyDetail | `components/strategy/StrategyDetail.tsx` | P1-3 |
| RegimeTimeline | `components/market-intel/RegimeTimeline.tsx` | P1-2 |
| RegimeFlowMap | `components/market-intel/RegimeFlowMap.tsx` | P2-3 |
| MarketIntelligence | `components/market-intel/MarketIntelligence.tsx` | P0-2, P1-2 |
| FactorBreakdown | `components/market-intel/FactorBreakdown.tsx` | P0-2 |
| Badge | `components/ui/Badge.tsx` | P0-1 (warning variant 이미 존재) |
| socket.ts | `lib/socket.ts` | P0-3 |
| useSocket.ts | `hooks/useSocket.ts` | P0-3 |
| useMarketIntelligence.ts | `hooks/useMarketIntelligence.ts` | P0-3 |
| types/index.ts | `types/index.ts` | P0-1, P0-2 |
| api-client.ts | `lib/api-client.ts` | P2-2 (향후) |
