# Round 7 합의 결정문서

> 생성일: 2026-02-16
> 주제: 레짐 변경 빈도 문제 — A+B 조합 (hysteresis 상향 + 전략 deactivate 유예기간)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중
> 제안 총건수: Trader 9건, Engineer 11건, UI 9건

---

## 합의 항목

### Backend (Track A)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 | Tier |
|----|------|----------|------|----------|------|
| R7-A1 | hysteresisMinCandles 3→10 + Optimizer [5,20] | **3/3 동의** (절충) | Engineer | 20분 | T0 |
| R7-A2 | 레짐 전환 쿨다운 5분 (timestamp 비교, 타이머 불필요) | **3/3 동의** | Engineer | 40분 | T0 |
| R7-A3 | 히스테리시스 가중치 0.10→0.15 + 나머지 factor -0.01씩 | **3/3 동의** | Engineer | 10분 | T0 |
| R7-A4 | RegimeOptimizer 범위 확장 [5,20] + 쿨다운 [120K,600K] | **3/3 동의** | Engineer | 10분 | T0 |
| R7-B1 | StrategyRouter 유예기간 핵심 구조 (Map + setTimeout + unref) | **3/3 동의** | Engineer | 90분 | T0 |
| R7-B2 | 유예 중 OPEN 차단 / CLOSE 허용 (StrategyRouter→BotService 방식) | **3/3 동의** | Engineer | (B1 포함) | T0 |
| R7-B3 | 전략 metadata gracePeriodMs + 카테고리별 기본값 (17개 전략) | **2/3+조건부** | Engineer | 35분 | T1 |
| R7-B4 | 유예 타이머 동시성 보호 (6개 레이스컨디션 방어) | **3/3 동의** | Engineer | (B1 내장) | T0 |
| R7-B5 | disableStrategy ↔ grace period 통합 + cancelGracePeriod public | **3/3 동의** | Engineer | 15분 | T1 |
| R7-C1 | 레짐 전환 빈도 메트릭 (transitionsLastHour, cooldownActive) | **3/3 동의** | Engineer | 20분 | T1 |
| R7-C2 | StrategyRouter getStatus() 확장 (gracePeriods, graceExpiresAt) | **3/3 동의** | Engineer | 15분 | T1 |
| R7-C3 | Socket.io grace 이벤트 3종 (조건부 emit) | **2/3+조건부** | Engineer | 15분 | T1 |

### Frontend (Track C)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 | Tier |
|----|------|----------|------|----------|------|
| R7-FE1 | 전략 3-way 배지 (active/grace/inactive) + amber 유예 표시 | **3/3 동의** | UI | 2시간 | T1 |
| R7-FE2 | 레짐 pending/cooldown 상태 표시 (캔들 카운트, 쿨다운 잔여) | **3/3 동의** | UI | 2시간 | T1 |
| R7-FE3 | Socket 이벤트 연동 (grace_started/cancelled/expired 수신) | **3/3 동의** | UI | 1시간 | T1 |
| R7-FE4 | 유예기간 카운트다운 타이머 (graceExpiresAt 기반) | **3/3 동의** | UI | 1.5시간 | T2 |
| R7-FE5 | 레짐 전환 빈도 경고 인디케이터 (안정/빈번/과다) | **3/3 동의** | UI | 1시간 | T2 |

---

## 이견 사항 해소

### 1. hysteresisMinCandles: 8 vs 15

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | 15 (보수적, 노이즈 제거) | 8 (빠른 반응, 삼중 보호) | 10 (UX 균형) | **10** |

**결정**: 기본값 **10**, Optimizer 범위 **[5, 20]**.
**근거**:
- 삼중 보호 체계 (hysteresis 10분 + cooldown 5분 + grace 5~15분)에서 hysteresis 단독으로 극단값 불필요
- 10분 pending은 FE에서 "확인 중" 표시로 수용 가능 (UI 판단)
- Optimizer가 [5,20] 범위에서 시장 데이터 기반 최적값 자동 탐색
- 초기 운영 시 보수적으로 12~15 사용 가능 (런타임 변경)

### 2. RegimeOptimizer 범위

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | [10, 30] | [5, 15] | [5, 20] | **[5, 20]** |

**결정**: **[5, 20]**
**근거**:
- [10, 30]은 과적합 위험 (Engineer 지적) — 옵티마이저가 "전환 안 하는 게 최선" 결론에 수렴할 수 있음
- [5, 15]는 Trader의 15가 범위 상한에 걸려 여유 없음
- [5, 20]으로 양방향 탐색 가능 + 과적합 방지

### 3. 유예기간 값: 고정 3분 vs 카테고리별 차별화

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | 카테고리별 (5/10/15분) | 고정 3분 (수용 가능) | 카테고리별 + fallback 5분 | **카테고리별 + fallback 5분** |

**결정**: 전략 metadata `gracePeriodMs` 우선, fallback **5분**.
**구현**:
```javascript
const graceMs = strategy.getMetadata().gracePeriodMs || this._graceMs; // default 300000
```
**카테고리별 기본값**:
- price-action (5개): 600,000ms (10분)
- indicator-light (7개, Grid 제외): 300,000ms (5분)
- Grid: 180,000ms (3분) — 짧은 사이클
- indicator-heavy (QuietRangeScalp, Breakout): 900,000ms (15분)
- AdaptiveRegime: 0ms (전 레짐 활성, 유예 불필요)

### 4. 유예 만료 감지: setInterval vs setTimeout

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | setInterval 10초 폴링 | setTimeout per strategy | setTimeout | **setTimeout** |

**결정**: **전략별 setTimeout + unref()** (Engineer 방식)
**근거**: setInterval 10초 폴링은 최대 10초 오차 + 타이머 누수 위험. setTimeout은 정확한 시점 발화 + FE 동기화 용이.

### 5. 유예 상태 소유권: strategyBase vs StrategyRouter

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | strategyBase (분산) | StrategyRouter (중앙) | StrategyRouter (중앙) | **StrategyRouter 중앙** |

**결정**: StrategyRouter `_gracePeriods` Map이 SSOT. 전략에는 `_inGracePeriod` 플래그만 전달.
**근거**: 타이머 lifecycle이 라우터 start/stop에 명확히 종속, 18개 서브클래스 수정 불필요.

---

## 아키텍처 결정

### AD-40: Regime Hysteresis Stabilization — Triple Protection

- **결정**: hysteresisMinCandles=10 + transitionCooldownMs=300000 + weight 0.15의 삼중 보호.
- **근거**: 단일 방어선 강화 대신 3개 레이어로 분산하여, 각 파라미터가 과도하지 않으면서 합산 보호가 충분.
- **영향**: 최소 전환 간격 = 10분(hysteresis) + 5분(cooldown) = 15분. 유예기간 합산 시 20~30분 버퍼.

### AD-41: StrategyRouter Grace Period — Central Management with setTimeout

- **결정**: StrategyRouter가 `_gracePeriods` Map으로 중앙 관리. 전략별 `setTimeout` + `unref()`. 만료 콜백에서 `Map.delete` 선행 + `_running` 체크.
- **근거**: SSOT 원칙, 타이머 누수 제로, 기존 `_gracefulDisabledStrategies` 패턴과 일관.
- **상태 머신**: `ACTIVE → GRACE_PERIOD → DEACTIVATED` (레짐 복귀 시 `GRACE_PERIOD → ACTIVE`)

### AD-42: Grace Period Duration — Strategy Metadata Priority

- **결정**: `strategy.getMetadata().gracePeriodMs` 우선, 없으면 `StrategyRouter._graceMs` (기본 300000ms=5분) fallback.
- **근거**: 전략 카테고리별 유효 매매 사이클이 10배 이상 차이 (Grid 30초 vs Breakout 120분). 단일값은 불가.
- **17개 전략에 gracePeriodMs 추가**: metadata에 static 필드로 선언.

### AD-43: Grace Period Signal Filtering — Router Query Pattern

- **결정**: BotService `_handleStrategySignal`에서 `strategyRouter.getGracePeriodStrategies()` 조회 후 OPEN 차단.
- **근거**: `_gracefulDisabledStrategies` 패턴 재사용, 전략 서브클래스 수정 불필요.
- **CLOSE 시그널은 항상 허용**: 소프트웨어 기반 SL/TP가 유예 중에도 작동.

### AD-44: Transition Cooldown — Timestamp Comparison (No Timer)

- **결정**: `Date.now() - this._lastTransitionTs < cooldownMs` 비교. setTimeout 미사용.
- **근거**: 타이머 누수 제로, GC 부담 제로, graceful shutdown 정리 불필요, 테스트 용이 (Date.now 모킹).
- **쿨다운 중 pending 축적**: 쿨다운 종료 시점에 이미 minCandles 충족이면 즉시 전환.

### AD-45: Socket Events for Grace States — Conditional Push

- **결정**: 3종 push 이벤트 (`strategy:grace_started`, `strategy:grace_cancelled`, `strategy:deactivated`). 상태 전이 시점에만 emit. `market:regime_pending`은 `_pendingRegime !== null`일 때만.
- **근거**: 이벤트 폭풍 방지, FE 카운트다운 시작점 정확도.

---

## 이번 라운드 제외 (Round 8 이관)

| 항목 | 사유 |
|------|------|
| 동적 히스테리시스 보너스 (decay) | A-3 정적 0.15 적용 후 효과 관찰. R8에서 필요 시 추가 |
| 전략-레짐 호환성 매트릭스 (FE) | P2, 4~6시간. 현재 스코프 과대 |
| 레짐 파라미터 설정 UI (FE) | P2, 보안 경고 + 확인 모달 필요. PATCH API 선행 필요 |
| FlowMap grace 레인 (FE) | P2, P0-1 구현 후 자연 확장 |
| 상태 전이 히스토리 로그 (FE) | P2→강등 (Trader 리뷰). 디버깅용, 실거래 중 열람 빈도 낮음 |
| 백테스트 레짐 시뮬레이션 | R8+ 과제. 현재 backtest에 레짐 전환 미포함 |
| Soft routing (방향 C) | A+B 적용 후 재평가 |

---

## 구현 순서 (의존성 DAG)

```
Phase 1: 레짐 안정화 (BE, 40분) ← 최우선
  R7-A1: hysteresisMinCandles=10, Optimizer [5,20]
  R7-A3: 히스테리시스 가중치 0.15
  R7-A4: Optimizer 범위 확장 + 쿨다운 범위 추가

Phase 2: 전환 쿨다운 (BE, 40분)
  R7-A2: transitionCooldownMs 5분 + timestamp 비교 로직

Phase 3: 유예기간 핵심 (BE, 90분) ← critical path
  R7-B1: StrategyRouter _gracePeriods Map + setTimeout + unref
  R7-B2: 진입 차단 (getGracePeriodStrategies → BotService)
  R7-B4: 동시성 보호 6시나리오 (B1 내장)

Phase 4: 전략 metadata + 통합 (BE, 50분)
  R7-B3: 17개 전략 gracePeriodMs 추가
  R7-B5: disableStrategy ↔ cancelGracePeriod
  R7-C1: 전환 빈도 메트릭
  R7-C2: getStatus() 확장

Phase 5: 이벤트 + FE (FE, 4~5시간) — Phase 4 완료 후
  R7-C3: Socket.io grace 이벤트 3종
  R7-FE1: 3-way 배지
  R7-FE2: pending/cooldown 표시
  R7-FE3: Socket 이벤트 연동

Phase 6: FE 개선 (FE, 2.5시간) — 독립
  R7-FE4: 카운트다운 타이머
  R7-FE5: 전환 빈도 경고
```

**총 예상**: BE ~4시간, FE ~6.5시간

---

## 다음 단계

Phase 4 (Execute) 진행 시:
- **Track A (Backend)**: Phase 1→2→3→4 순서. marketRegime.js, regimeParamStore.js, regimeOptimizer.js, strategyRouter.js, botService.js, strategyBase.js, 17개 전략 파일
- **Track C (Frontend)**: Phase 5→6 순서. BE API 완료 후 시작. MarketRegimeIndicator, StrategyCard, socket.ts, types/index.ts
- **배포 순서 필수**: BE(A1+A2) → BE(B1~B5+C1~C2) → FE(P0) → FE(P1)

---

*3-agent 합의 기반. 합의 항목 17건 (BE 12 + FE 5), 아키텍처 결정 6건 (AD-40~AD-45), 이관 7건.*
