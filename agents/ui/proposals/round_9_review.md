# Round 9 교차 리뷰 — UI/UX

> **Reviewer**: Senior UI/UX Engineer
> **Date**: 2026-02-17
> **Reviewed**: Trader 제안서 (860줄) + Engineer 제안서 (477줄)
> **기준**: UX 영향도, 프론트엔드 구현 가능성, 정보 계층 구조, 사용자 경험 일관성

---

## Trader 제안서 리뷰

### R8-T2-1: 멀티심볼 라우팅 Phase 1

**조건부 동의** — 트레이딩 관점의 분석이 매우 설득력 있다. 단일 심볼 집중 투자 문제(`symbols[0]` 하드코딩)를 정확히 진단했고, 전략별 선호도 기반 배정(Funding -> 펀딩비 높은 심볼, Trend -> 모멘텀 강한 심볼)은 합리적이다.

**UX 관점 보완 사항:**

1. **StrategySymbolMap 컴포넌트 영향**: 현재 `StrategySymbolMap.tsx`(줄 62~65)에서 이미 `s.symbol`과 `s.symbols` 배열을 모두 처리하고 있으므로, 백엔드가 전략별 다른 심볼을 배정해도 테이블 렌더링 자체는 즉시 동작한다. 단, 현재는 모든 전략이 동일 심볼을 가리키므로 "활성 심볼: BTC/USDT" 하나만 표시되지만, 멀티심볼 후에는 **헤더의 "활성 심볼" 표시를 "활성 심볼: N개"로 변경**해야 한다.

2. **StrategyCard에 배정 심볼 표시**: Trader가 요청한 대로, StrategyCard에서 현재 배정된 심볼을 보여주는 것이 필수적이다. 현재 StrategyCard에는 심볼 표시가 전혀 없으므로, 전략명 옆에 `formatSymbol(strategy.symbol)` 배지를 추가해야 한다. **예상 FE 추가 작업: 1h** (StrategyCard 심볼 배지 + StrategySymbolMap 헤더 수정).

3. **`getStatus()` 응답 API 계약 확인 필요**: 현재 `StrategyInfo` 타입에 `symbol: string`과 `symbols: string[]`이 이미 존재한다. BE에서 단일 심볼 배정이면 `symbol` 필드만 업데이트하면 되고, FE 타입 변경 불필요. 이 점은 Trader/Engineer 양쪽 모두 명시하지 않았으므로 확인 요청.

4. **BTCUSDT 전략 배정 제외**: Trader가 "BTCUSDT는 MarketRegime 전용으로 예약"을 제안했는데, 이는 UX 관점에서 좋다. StrategySymbolMap의 "감시 심볼" 섹션에 BTCUSDT가 자연스럽게 포함되므로 사용자 혼란이 없다.

---

### R8-T2-2: 전략 warm-up 기간

**동의** — warm-up 상태 표시는 UX 가치가 높다.

**UX 관점 분석:**

현재 사용자가 봇을 시작하면 전략이 "활성" 상태로 표시되지만, warm-up 기간 동안 시그널이 0건이다. 이는 "봇이 제대로 동작하는 건가?" 라는 불안감을 유발한다. warm-up 상태를 명시적으로 보여주면 이 문제가 해결된다.

**FE 구현 방안:**

StrategyCard에 warm-up 배지를 추가한다. 기존 `graceState` 패턴과 동일한 방식:

```
[워밍업 15/51] — sky-400 색상, progress 표시
```

BE에서 `warmupState: 'warming_up' | 'ready'`, `klineCount: number`, `warmupRequired: number` 필드를 `GET /api/bot/strategies` 응답에 포함하면, FE에서 진행률 표시가 가능하다. Trader가 제안한 `getStatus()` 확장(줄 204~209)이 정확히 이 필드들을 포함하므로 그대로 사용 가능.

**예상 FE 추가 작업: 20분** (StrategyCard 배지 + 타입 확장).

---

### R8-T2-3: 펀딩비 PnL 반영

**동의** — PnL 정확도는 트레이더 의사결정의 핵심이다.

**UX 관점 보완:**

1. **기존 PnL 표시 자동 반영**: Bitget equity에 이미 펀딩비가 포함되어 있으므로, AccountOverview의 "미실현 PnL"은 이미 정확하다. 별도 추적은 **관측성(observability)** 목적이며, 이 점을 사용자에게 혼동 없이 전달해야 한다.

2. **펀딩비 표시 위치**: Trader가 "포지션 카드에 `accumulatedFunding` 렌더링"을 요청했다. PositionsTable에 컬럼을 추가하면 되지만, 모바일에서 테이블 가로 스크롤이 이미 발생 중이므로 **선택적 표시(토글)** 또는 **포지션 상세 클릭 시 드릴다운**으로 표시하는 것을 권장한다.

3. **백테스트 결과의 펀딩비**: BacktestResult 화면에서 "총 PnL" 옆에 "(펀딩비 포함)" 라벨을 추가하면 사용자가 결과의 신뢰도를 판단할 수 있다.

---

### R8-T2-4: 코인 재선정 주기

**조건부 동의** — 4시간 간격 근거가 합리적이다.

**UX 관점 보완:**

1. **재선정 이벤트 알림**: Trader가 `coins_reselected` 이벤트 발행을 제안했다. FE에서 Socket.io로 이 이벤트를 수신하여 **토스트 알림**으로 표시하는 것이 적절하다. 토스트 내용: "코인 재선정: +ETHUSDT, -DOGEUSDT" (추가/제거 심볼 표시). 이는 24/7 시장에서 "왜 갑자기 다른 코인을 거래하는지" 사용자가 이해하는 데 중요하다.

2. **CoinScoreboard에 "다음 재선정" 카운트다운**: 내 제안서에서 언급한 것과 일치. Trader가 `coins_reselected` 이벤트에 `timestamp`를 포함시키므로, FE에서 `nextReselectAt = lastReselectTimestamp + intervalMs`로 계산 가능. `useCountdown` 훅 재활용.

3. **열린 포지션이 있는 심볼 보호**: Trader의 주의사항(줄 459)에 동의. 재선정으로 심볼이 변경되어도 열린 포지션 심볼은 유지해야 한다. UX 관점에서, StrategySymbolMap에서 "보호된 심볼" 상태를 시각적으로 구분하면 좋다 (예: 자물쇠 아이콘). 단, 이는 Phase 2로 미루어도 된다.

**예상 FE 추가 작업: 45분** (Socket.io 이벤트 수신 + 토스트 + CoinScoreboard 카운트다운).

---

### R8-T2-5: Paper 모드 전환 경고 강화

**조건부 동의** — 구현 방향은 좋으나, FE 통합 방식에 대한 보완이 필요하다.

**UX 관점 핵심 이슈:**

Trader가 제안한 `force` 파라미터 방식에는 동의하지만, **FE에서의 사용자 플로우**가 불명확하다:

1. **현재 TradingModeToggle**: 이미 ConfirmDialog가 있다 (live->paper, paper->live 각각). 문제는 BE에서 에러를 throw하면 FE의 `handleConfirm()`이 `catch` 블록에서 조용히 무시한다 (줄 32~33: `catch { // error is handled silently }`).

2. **제안하는 플로우 (2단계 확인)**:
   - **1단계**: 사용자가 live->paper 토글 -> FE가 `POST /trading-mode` 호출 (force=false)
   - **BE가 열린 포지션 에러 반환** -> FE가 에러 메시지를 파싱하여 **2차 ConfirmDialog 표시** ("라이브 포지션이 3개 열려 있습니다. 수동 관리해야 합니다. 강제 전환하시겠습니까?")
   - **2단계**: 사용자가 확인 -> FE가 `POST /trading-mode` 호출 (force=true)

   이 플로우가 Trader의 `force` 파라미터 설계와 자연스럽게 맞는다.

3. **대안 — 사전 검증 API**: 내 제안서에서 언급한 `GET /api/bot/mode-switch-check?targetMode=paper` API가 더 깔끔하다. 모드 전환 전에 먼저 체크하여 경고를 ConfirmDialog에 포함시킨다. 그러나 추가 API 엔드포인트는 구현 비용을 올리므로, **Trader의 force 파라미터 방식이 더 실용적**이다.

**결론**: Trader의 `force` 파라미터 방식 채택. FE에서는 에러 응답의 메시지를 2차 확인 다이얼로그에 표시하고, 확인 시 force=true로 재시도. 현재 `catch` 블록의 silent handling을 수정해야 한다.

**예상 FE 추가 작업: 30분** (TradingModeToggle 에러 핸들링 + 2차 ConfirmDialog).

---

### R8-T0-5 (Deferred 재활성화): PositionManager 전략 메타데이터 주입

**동의 — R8-T2-1과 함께 재활성화**

**UX 관점**: PositionsTable에서 `pos.strategy`가 `null`이면 "-"로 표시되는 현재 상태는, 멀티심볼 도입 후 "이 포지션이 어떤 전략에 의해 열렸는지" 알 수 없어 사용자 혼란이 심해진다. 전략 메타데이터 주입은 UX 관점에서도 필수적이다.

Trader가 제안한 Phase 1의 "last-write-wins" 방식(줄 668)에 동의. 완벽한 1:N 매핑보다 실용적이며, Phase 2에서 정교화할 수 있다.

---

### R8-T1-1 (Deferred 재활성화): InstrumentCache lot step

**동의 — R8-T2-1의 전제 조건**

UX 직접 영향 없음. BE 판단에 위임.

---

### Trader 제안서 — 의존성 및 구현 순서

**동의** — Phase 1(인프라) -> Phase 2(핵심) -> Phase 3(보강) -> Phase 4(경량) 순서가 합리적이다. 다만, **FE 항목을 Phase 1~2와 병렬로 진행**할 수 있으므로, BE가 Phase 2를 작업하는 동안 FE Phase(접근성 + 모바일 반응형)를 동시 진행하면 총 소요 시간을 줄일 수 있다.

---

## Engineer 제안서 리뷰

### R8-T2-1: 멀티심볼 라우팅 Phase 1

**동의** — 시스템 안전성 관점의 분석이 Trader 제안을 잘 보완한다.

**주요 동의 포인트:**
1. **핵심 불변량**: "하나의 전략 인스턴스 = 하나의 심볼" (줄 43~45) — UX 관점에서도 이 원칙이 명확해야 대시보드에서 전략-심볼 관계를 1:1로 표시할 수 있다.
2. **`_symbolAssignmentLock` guard** (줄 50) — 코인 재선정 중 시그널 발행 경합 방지. UX 관점에서 이 guard가 없으면 대시보드에 "전략 A가 심볼 X로 시그널 발행" 직후 "전략 A가 심볼 Y로 재배정"이 연속으로 표시되어 사용자 혼란 유발.
3. **심볼 < 전략 시 경고 로그** (줄 53) — FE에서도 이 상태를 감지하여 "일부 전략이 동일 심볼을 공유하고 있습니다" 안내를 표시하면 좋다 (Phase 2).

---

### R8-T2-2: 전략 warm-up 기간

**동의** — StrategyBase 레벨에서 시그널을 차단하는 `emitSignal()` 게이트(줄 92~98)가 Trader의 BotService 레벨 카운트보다 더 안전하다.

**UX 관점 선호**: Engineer의 접근이 더 깔끔하다. 전략 내부에서 시그널을 차단하면, 외부(BotService, SignalFilter)에서 warm-up 로직을 알 필요가 없다. FE는 `getStatus()`에서 warm-up 상태만 읽으면 되므로, 구현 위치가 StrategyBase든 BotService든 FE 영향은 동일하다.

**deactivate/reactivate 시 warm-up 리셋** (줄 102~105): Engineer의 "activate() 시 리셋 O — 안전 우선" 제안에 동의. 새 심볼로 변경되면 이전 심볼의 캔들 데이터는 무의미하므로 리셋이 올바르다. UX 관점에서는 "방금 활성화된 전략의 warm-up 진행률이 0으로 돌아가는 것"이 사용자에게 직관적이다.

---

### R8-T2-3: 펀딩비 PnL 반영

**동의** — "이중 계산 금지" 원칙(줄 136)이 핵심이다.

**UX 관점 보완:**

Engineer가 "equity에 이미 펀딩비 반영 -> 별도 cumulativeFundingPnl은 관측성 목적"이라고 명확히 했다. FE에서는:
- AccountOverview의 "미실현 PnL"은 변경 불필요 (이미 정확)
- 별도 `cumulativeFundingPnl`은 PositionsTable의 드릴다운 또는 StrategyDetail의 성과 탭에서 참고용으로 표시

Snapshot 모델에 `fundingPnl` 추가(줄 141) 시, 주식 곡선(equity curve) 차트에서 "펀딩비 영향" 레이어를 오버레이할 수 있으나, 이는 Phase 2 이후의 고급 시각화.

---

### R8-T2-4: 코인 재선정 주기

**조건부 동의** — 동시성 위험 분석(줄 191~197)이 매우 상세하다.

**UX 관점 보완:**

Engineer의 "단계적 재선정" 접근(줄 194~197: 새 심볼 구독 -> updateSymbols -> 이전 심볼 해제)에 동의. UX 관점에서 이 단계적 접근은 대시보드에서 "재선정 중..." 상태를 표시할 시간적 여유를 준다.

**`_reselectingCoins` 플래그** (줄 192): FE에서 이 플래그를 `GET /api/bot/status` 응답에 포함시키면, 대시보드에서 "코인 재선정 중..." 인디케이터를 표시할 수 있다. 단, 재선정은 수 초 이내에 완료되므로 사용자가 볼 확률이 낮아 Phase 2로 미루는 것이 적절하다.

---

### R8-T2-5: Paper 모드 전환 경고 강화

**동의** — 구현 방향이 실용적이다.

**UX 관점:**

Engineer의 "응답에 경고 메시지 포함" (줄 255~256) + "이벤트 발행" (줄 259) 접근에 동의. 특히 `trading_mode_changed` 이벤트 발행은, 여러 브라우저 탭에서 대시보드를 열고 있을 때 **모든 탭이 모드 변경을 감지**할 수 있어 UX 일관성이 향상된다.

**paper->live 전환 시 "exchange connectivity 검증"** (줄 263~266): 이는 매우 좋은 아이디어. FE에서 전환 실패 시 "거래소 연결을 확인할 수 없습니다" 에러를 명확히 표시할 수 있다.

---

### R8-T2-6: StateRecovery 활성화

**동의** — 구현 계획이 명확하다.

**UX 관점:**

내 제안서에서 언급한 "recovering" 상태 표시 필요성에 대해, Engineer는 "Paper 모드에서 불필요" (줄 297~299)를 정확히 지적했다. FE에서는:
- `BotState` 타입에 `'recovering'`을 추가하되, 이는 라이브 모드에서만 발생
- `translateBotState('recovering')` = "복구 중"
- 복구 실패 시(non-fatal) 봇은 정상 시작되므로 사용자에게 별도 알림 불필요

**false positive 방어** (줄 325~327): Engineer의 "최근 2분 이내 주문은 skip" 제안은 시스템 안정성 관점에서 중요. FE 영향 없음.

---

### R8-T0-5: PositionManager 전략 메타데이터 주입 (Deferred 재활성화)

**동의** — "조건부 재활성화 (T2-1과 함께)"에 동의.

**UX 관점:**

Engineer의 `clientOid` 인코딩 방식(줄 365~366) vs BotService 레벨 Map(줄 369): FE 관점에서는 어느 방식이든 `GET /api/bot/status`에 `strategy` 필드가 포함되면 동일하다. 구현 방식은 BE 결정에 위임.

---

### R8-T1-1: InstrumentCache lot step (Deferred 재활성화)

**동의** — "T2-1의 전제 조건"이라는 판단에 동의.

---

### Engineer 제안서 — FE 항목 코멘트

Engineer의 FE 항목 코멘트(줄 409~422)가 정확하다. 특히:
- **R8-T2-11**: "금액 precision 일관성 확인" (줄 419) — 내 제안에서 `text-2xl sm:text-3xl` 반응형 폰트를 적용했으므로, 금액이 잘리지 않도록 `formatCurrency()` 출력 길이를 고려해야 한다.
- **R8-T2-12**: "불필요한 리렌더 방지" (줄 422) — RegimeFlowMap은 MarketIntelligence 내부 탭에 있으므로, 탭 전환 시에만 렌더링되고 매 폴링마다 리렌더되지 않는다. 현재 구현이 이미 이 패턴을 따르고 있으므로 추가 성능 우려 없음.

---

## 핵심 이견 사항

### 1. R8-T2-2 warm-up 구현 위치: BotService vs StrategyBase

- **Trader**: BotService의 `onKlineUpdate` 핸들러에서 `strategy._klineCount++` 관리 (비침투적)
- **Engineer**: StrategyBase의 `emitSignal()` 내에서 warm-up 미완료 시 시그널 차단 (캡슐화)

**UI/UX 판정**: Engineer 방식 선호. 이유:
1. StrategyBase 캡슐화가 더 안전 — BotService가 warm-up 로직을 모르면 향후 리팩토링 시 누락 위험 감소
2. `emitSignal()` 게이트가 있으면, 전략이 잘못된 데이터로 시그널을 생성해도 외부로 나가지 않음
3. FE 관점에서는 두 방식 모두 `getStatus()` 응답에 warm-up 상태가 포함되므로 차이 없음

**합의 제안**: StrategyBase에 `_receivedCandles`, `_warmedUp` 필드 추가 + `emitSignal()` 게이트. `getStatus()`에서 상태 노출.

### 2. R8-T2-5 FE 통합 방식: force 파라미터 vs 사전 검증 API

- **Trader**: `setTradingMode(mode, { force })` + BE에서 에러 throw
- **Engineer**: 응답에 warning 필드 포함 + 이벤트 발행
- **UI/UX (나)**: 사전 검증 API 또는 force 파라미터

**합의 제안**: Trader의 force 파라미터 방식 채택. FE에서 첫 호출 실패 시 에러 메시지를 2차 ConfirmDialog에 표시하고, 확인 시 force=true로 재호출. Engineer의 `trading_mode_changed` 이벤트 발행도 함께 구현.

### 3. R8-T2-4 재선정 중 시그널 처리

- **Trader**: 명시적 처리 없음 (재선정 -> updateSymbols -> deactivate/activate 흐름으로 자연 해결)
- **Engineer**: `_reselectingCoins` 플래그 + 시그널 drop 또는 대기열

**UI/UX 판정**: Engineer 방식이 더 안전하지만, Phase 1에서는 Trader의 자연 해결 방식으로 충분하다. 재선정은 수 초 이내 완료되므로 경합 확률이 극히 낮다. 만약 문제가 발생하면 Phase 2에서 플래그 방식을 추가한다.

---

## FE 영향 분석

### Backend 변경으로 인한 Frontend 변경 필요 항목

| BE 항목 | FE 영향도 | 필요 변경 | 예상 시간 |
|---------|----------|----------|----------|
| **R8-T2-1** (멀티심볼) | **HIGH** | StrategyCard에 심볼 배지 추가, StrategySymbolMap 헤더 "활성 심볼: N개"로 변경, 다양한 심볼이 표시되므로 StrategyDetail에서 심볼별 필터링 고려 | 1h |
| **R8-T2-2** (warm-up) | **LOW** | StrategyCard에 warm-up 배지 추가 (`[워밍업 15/51]`), 타입에 `warmupState`, `klineCount`, `warmupRequired` 추가 | 20m |
| **R8-T2-3** (펀딩비) | **MEDIUM** | PositionsTable에 `fundingFee` 컬럼 (선택적), StrategyDetail 성과 탭에 "누적 펀딩비" 표시, 타입에 `fundingFee`/`accumulatedFunding` 추가 | 30m |
| **R8-T2-4** (코인 재선정) | **LOW** | `coins_reselected` Socket.io 이벤트 수신 -> 토스트 알림, CoinScoreboard에 "다음 재선정" 카운트다운 | 45m |
| **R8-T2-5** (Paper 경고) | **MEDIUM** | TradingModeToggle의 에러 핸들링 수정, 2차 ConfirmDialog (force 전환), `catch` 블록 silent handling 제거 | 30m |
| **R8-T2-6** (StateRecovery) | **NONE~LOW** | `BotState` 타입에 `'recovering'` 추가, `translateBotState()` 매핑 | 10m |
| **R8-T0-5** (전략 매핑) | **LOW** | PositionsTable에 전략 배지 + 색상 (이미 `pos.strategy` 필드 존재) | 15m |
| **R8-T1-1** (InstrumentCache) | **NONE** | FE 변경 없음 | 0m |

**총 FE 추가 작업 (BE 연동)**: ~3h 10m
**기존 FE 5건 (R8-T2-8~T2-12)**: ~2h 20m
**Round 9 FE 총 작업량**: ~5h 30m

### API 응답 형식 변경 정리

1. **`GET /api/bot/status`의 `strategies[]`**: `warmupState`, `klineCount`, `warmupRequired` 필드 추가 필요
2. **`GET /api/bot/status`의 `strategies[]`**: `symbol` 필드가 전략별로 다른 값을 가지게 됨 (현재는 모두 동일)
3. **`POST /api/bot/trading-mode`**: 에러 응답에 포지션 정보 포함, `force` 파라미터 지원
4. **Socket.io 이벤트**: `coins_reselected`, `trading_mode_changed` 이벤트 추가

### 타입 변경 필요 (`frontend/src/types/index.ts`)

```typescript
// StrategyInfo 확장
export interface StrategyInfo {
  // ... 기존 필드 ...
  warmupState?: 'warming_up' | 'ready';      // R8-T2-2
  klineCount?: number;                         // R8-T2-2
  warmupRequired?: number;                     // R8-T2-2
}

// BotState 확장
export type BotState = 'idle' | 'running' | 'paused' | 'stopping' | 'error' | 'recovering';  // R8-T2-6

// Position 확장 (이미 strategy 필드 있음, fundingFee 추가)
// accumulatedFunding?: string;                 // R8-T2-3
```

---

## 공통 확인 사항

### 3자 동의

| 항목 | Trader | Engineer | UI/UX | 최종 |
|------|--------|----------|-------|------|
| R8-T2-1 (멀티심볼) | 동의 (Phase 1 단일 심볼/전략) | 동의 (불변량 강조) | 조건부 동의 (FE 연동 확인) | **합의 — Phase 1 진행** |
| R8-T2-2 (warm-up) | 동의 (BotService 카운트) | 동의 (StrategyBase 게이트) | 동의 (Engineer 방식 선호) | **합의 — StrategyBase 방식** |
| R8-T2-3 (펀딩비 PnL) | 동의 (라이브+Paper+백테스트) | 동의 (이중 계산 금지) | 동의 | **합의** |
| R8-T2-4 (코인 재선정) | 동의 (4시간 간격) | 동의 (동시성 방어) | 조건부 동의 (토스트 알림) | **합의 — 4시간, 토스트 알림** |
| R8-T2-5 (Paper 경고) | 동의 (force 파라미터) | 동의 (warning 응답) | 조건부 동의 (2단계 확인) | **합의 — force 파라미터 + 2단계 FE** |
| R8-T2-6 (StateRecovery) | 동의 | 동의 | 동의 | **합의** |
| R8-T0-5 재활성화 | 재활성화 (T2-1과 함께) | 조건부 재활성화 | 재활성화 동의 | **합의 — T2-1과 동시 진행** |
| R8-T1-1 재활성화 | 재활성화 (T2-1 전제) | 재활성화 필수 | 재활성화 동의 | **합의 — Phase 1 선행** |
| R8-T2-8 (접근성) | 우선순위 높음 | 무영향 | 구현 담당 | **합의** |
| R8-T2-9 (삭제) | 구현 비용 최소 | import 확인 요청 | 구현 담당 | **합의** |
| R8-T2-10 (헤더 반응형) | 모바일 중요 | 무영향 | 구현 담당 | **합의** |
| R8-T2-11 (AccountOverview) | — | 금액 precision 주의 | 구현 담당 | **합의** |
| R8-T2-12 (RegimeFlowMap) | — | 리렌더 주의 | 구현 담당 | **합의** |

### 전체 구현 순서 합의안

```
Phase 1 (인프라 + FE 접근성, 병렬):
  BE: R8-T1-1 (InstrumentCache) + R8-T2-2 (warm-up)    [4h]
  FE: R8-T2-8 (접근성) + R8-T2-9 (삭제)                  [45m]

Phase 2 (핵심, 병렬):
  BE: R8-T0-5 + R8-T2-1 (멀티심볼 + 전략 매핑)            [11.5h]
  FE: R8-T2-10 + R8-T2-11 + R8-T2-12 (모바일 반응형)      [1h35m]

Phase 3 (보강):
  BE: R8-T2-3 (펀딩비) + R8-T2-4 (코인 재선정)             [8h]

Phase 4 (경량 + BE 연동 FE):
  BE: R8-T2-5 (Paper 경고) + R8-T2-6 (StateRecovery)     [1h15m]
  FE: BE 연동 작업 (심볼 배지, warm-up, 토스트, 경고)        [3h10m]
```

**총 예상 시간**: BE ~24.75h + FE ~5.5h = ~30.25h
