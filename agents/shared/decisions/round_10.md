# Round 10 합의 결정문서

> 생성일: 2026-02-17
> 주제: Tier 3 Enhancement — R8 미구현 agreed 항목 (8건)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T3-3 | DrawdownMonitor peakEquity 영속성 | 3/3 동의 (Tier 0) | Backend | 1h |
| R8-T3-2 | Trailing Stop 구현 (6개 전략, percent 모드) | 3/3 동의+조건부 (Tier 0) | Backend | 2h |
| R8-T3-4 | Sortino + Calmar Ratio 산출 | 3/3 동의 (Tier 0) | Backtest | 30m |
| R8-T3-1 | 백테스트 멀티포지션 (FIFO, incrementalId) | 3/3 동의+조건부 (Tier 0) | Backtest | 2.5h |
| R8-T3-5 | 데드 코드 삭제 (StrategyPanel, ClientGate) | 3/3 동의 (Tier 0) | Frontend | 5m |
| R8-T3-8 | TOOLTIP_STYLE 통일 (4파일) | 3/3 동의 (Tier 0) | Frontend | 15m |
| R8-T3-7 | th scope="col" 일괄 추가 (~88개) | 3/3 동의 (Tier 0) | Frontend | 30m |
| R8-T3-6 | EquityCurveChart 공통 추출 | 3/3 동의+조건부 (Tier 0) | Frontend | 45m |

**총 8건, 전체 즉시 실행. 예상 총 시간: ~7.5h (BE ~6h + FE ~1.5h)**

---

## 아키텍처 결정

### AD-58: DrawdownMonitor 상태 영속성 — loadState() + updateEquity() 패턴

- **결정**: DrawdownMonitor에 `loadState({ peakEquity, dailyStartEquity })` / `getState()` 메서드를 추가하고, botService.start() 시 마지막 BotSession에서 peakEquity를 복원한 뒤 즉시 `updateEquity(currentEquity)`를 호출하여 drawdown을 재계산한다.
- **근거**:
  - 서버 재시작 시 peakEquity='0' 리셋 → drawdown 보호 완전 무력화 (3/3 최우선 합의)
  - BotSession.stats.peakEquity 필드가 이미 존재하나 DrawdownMonitor에 피드백 경로 없음
  - Engineer 핵심 제안: loadState() 후 updateEquity() 호출 시 drawdown 한도 초과면 자동 halt 트리거 → isHalted 별도 영속화 불필요
  - Trader 동의: "hydrate 시 peakEquity가 현재 equity보다 낮으면 현재 equity를 사용" 방어 로직 정확
- **변경 파일**:
  - `backend/src/services/drawdownMonitor.js` — loadState()/getState() 추가
  - `backend/src/services/botService.js` — start()에서 복원, _updateSessionStats()에서 영속화
- **isHalted 복원 전략**: BotSession 스키마 확장 없이, loadState() → updateEquity() 순서로 자동 감지

### AD-59: Trailing Stop — StrategyBase opt-in, 6개 전략, percent 모드

- **결정**: StrategyBase에 `_checkTrailingStop(price)` 공통 메서드를 추가하고, 6개 추세/모멘텀 전략에만 `trailingEnabled: true`를 설정한다. percent 모드만 구현하고, ATR 모드는 향후 라운드로 연기한다.
- **근거**:
  - 3/3 동의: StrategyBase opt-in 방식, 기존 동작 100% 보존
  - Engineer scope 축소 제안 (2/3 동의): 전략 6개만 전환, 나머지 12개는 기존 코드 유지
  - Trader ATR 모드 요청은 유효하나, 이번 라운드에서 percent + ATR 동시 구현은 scope 초과
  - UI: API 응답에 `trailingActive`/`trailingStopPrice` 필드 추가 요청 → R10에서 BE 인터페이스 확정
- **Trailing 대상 전략** (6개):
  - 추세: TurtleBreakout, Supertrend, MaTrend, SwingStructure
  - 모멘텀: RSIPivot, MacdDivergence
- **비활성 전략** (12개): Grid, Bollinger, Vwap, QuietRangeScalp, Breakout, FibonacciRetracement, CandlePattern, SupportResistance, AdaptiveRegime(자체 구현), Funding
- **핵심 안전 규칙**:
  1. activation 전에는 기존 고정 SL 유지 (Trader 요구)
  2. trailing SL과 고정 SL 중 더 타이트한 것 적용 (Trader 요구)
  3. onFill() CLOSE 분기에서 trailing state 리셋 (Engineer 요구)
  4. `_checkTrailingStop()`을 try-catch로 감싸 fail-safe (Engineer 요구)
  5. AdaptiveRegimeStrategy는 `trailingStop.enabled: false`로 충돌 방지
- **변경 파일**:
  - `backend/src/services/strategyBase.js` — trailing stop 인프라
  - 6개 전략 파일 — metadata에 trailingStop 설정 추가

### AD-60: 백테스트 멀티포지션 — Map + incrementalId + FIFO

- **결정**: backtestEngine의 `_position` (단일)을 `_positions` (Map)으로 전환한다. key는 `pos_${autoIncrementId}` 방식, 청산은 FIFO 전용으로 구현한다.
- **근거**:
  - Engineer의 `'long'|'short'` key 설계에 Trader+UI 모두 반대 (2/3): Grid 전략의 같은 방향 다중 진입 불가
  - Trader+UI: `pos_${incrementalId}` 방식이 피라미딩/다중 그리드 모두 지원
  - Engineer: FIFO 전용 (현재 signal 스펙에 positionId 없음), 향후 positionId 기반 매칭 확장
  - Engineer: Map hard cap 10 포지션
- **핵심 구현 규칙**:
  1. `maxConcurrentPositions`는 전략 metadata에서 읽음 (기존 1인 전략은 동작 변경 없음)
  2. cash 마이너스 방지: `_openLong`/`_openShort`에서 잔여 cash 확인 (Trader 필수 요구)
  3. `_calculateEquity()`: 모든 열린 포지션의 MTM 합산
  4. `_forceClosePosition()`: 모든 포지션 순회 청산
  5. `_applyFundingIfDue()`: 포지션별 개별 적용
  6. 회귀 방지: `maxConcurrentPositions=1` 전략의 결과가 변경 전과 동일해야 함
- **변경 파일**:
  - `backend/src/backtest/backtestEngine.js` — 핵심 변경

### AD-61: Sortino + Calmar Ratio — backtestMetrics 확장

- **결정**: backtestMetrics.computeMetrics()에 Sortino Ratio와 Calmar Ratio를 추가한다.
- **근거**:
  - 3/3 동의: Sharpe만으로는 비대칭 수익률 평가 부족
  - Calmar은 1줄 추가 (Trader 강력 권장, Engineer 동의)
  - meanReturn 스코프 수정 필수 (Engineer 발견: L258에서 if 블록 내부 선언)
- **구현 세부**:
  - Sortino: downside deviation 분모 = 전체 period 수 (표준 정의)
  - Calmar: `totalReturn / maxDrawdownPercent`
  - edge case: downside=0 → '999.99', zero trades → '0.00'
  - FE: BacktestStatsPanel에 Sortino(Sharpe 옆) + Calmar(최대낙폭 옆) 배치
  - 타입: BacktestMetrics에 `sortinoRatio`, `calmarRatio` 추가
- **변경 파일**:
  - `backend/src/backtest/backtestMetrics.js` — Sortino + Calmar 추가
  - `frontend/src/types/backtest.ts` — 타입 확장
  - `frontend/src/components/backtest/BacktestStatsPanel.tsx` — 표시 추가

### AD-62: EquityCurveChart 공통 추출 — Config 기반 패턴

- **결정**: `EquityCurveConfig` 인터페이스 + `EquityCurveBase` 공통 컴포넌트를 만들고, 기존 2개 파일은 얇은 래퍼로 유지한다.
- **근거**:
  - UI 설계안에 3/3 동의
  - Card 래핑은 wrapper에서 담당 (base에 포함하지 않음 — PerformanceTabs 중첩 방지)
  - Engineer의 dataMapper 함수 방식보다 UI의 config 객체 방식이 타입 안전성에 유리 (UI+Trader 동의)
- **변경 파일**:
  - 신규: `frontend/src/components/charts/EquityCurveBase.tsx`
  - 수정: `frontend/src/lib/chart-config.ts` — config 타입 + 2개 상수
  - 수정: `frontend/src/components/EquityCurveChart.tsx` — 래퍼
  - 수정: `frontend/src/components/backtest/BacktestEquityCurve.tsx` — 래퍼

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|-----|------|
| 멀티포지션 key 설계 | `pos_${incrementalId}` | `'long'\|'short'` | `pos_${incrementalId}` 동의 | **incrementalId** (2/3) |
| Trailing Stop scope | 18개 전략 일괄 | 6개만 (scope 축소) | 6개 동의 | **6개 전략만** (2/3) |
| Trailing ATR 모드 | 추세 4개에 ATR 필수 | percent만 구현 | 무관 | **percent만** (scope 한정, ATR은 다음 라운드) |
| Calmar Ratio 추가 | 강력 권장 | 누락 (동의) | 배치 설계 완료 | **추가** (3/3) |
| EquityCurve props | - | dataMapper 함수 | EquityCurveConfig 객체 | **Config 객체** (UI+Trader) |
| Card 래핑 위치 | - | base에 포함 가능 | wrapper에서 (중첩 방지) | **wrapper** (UI 주장) |
| CoinScoreboard border-subtle | - | 확인 요청 | 비의도적, muted로 통일 | **border-muted 통일** |
| StrategyListItem 타입 | - | 삭제 전 확인 | 3곳 사용 중, 유지 | **타입 유지, 파일만 삭제** |

---

## 다음 단계

### 구현 순서 (의존성 순)

```
BE Phase 1 (안전 최우선):
  R8-T3-3  DrawdownMonitor peakEquity 영속성   [AD-58, 1h]
  R8-T3-4  Sortino + Calmar Ratio              [AD-61, 30m]

BE Phase 2 (핵심 기능):
  R8-T3-2  Trailing Stop (6개 전략)            [AD-59, 2h]

BE Phase 3 (구조적 리팩토링):
  R8-T3-1  멀티포지션 백테스트 (FIFO)          [AD-60, 2.5h]

FE (BE와 병렬 진행):
  R8-T3-5  데드 코드 삭제                       [5m]
  R8-T3-8  TOOLTIP_STYLE 통일                   [15m]
  R8-T3-7  th scope="col" 일괄 추가             [30m]
  R8-T3-6  EquityCurveChart 공통 추출           [AD-62, 45m]
  R8-T3-4  BacktestStatsPanel Sortino+Calmar    [AD-61 FE, 15m]
```

### 트랙 배정
- **Track A (Backend)**: R8-T3-3, R8-T3-2 → 순서대로
- **Track B (Backtest)**: R8-T3-4, R8-T3-1 → 순서대로
- **Track C (Frontend)**: R8-T3-5, R8-T3-8, R8-T3-7, R8-T3-6, R8-T3-4(FE) → 순서대로

Track A와 B와 C는 **병렬 진행 가능** (의존성 없음).
단, R8-T3-4 FE 파트는 BE 파트 완료 후 진행.

---

## 향후 백로그 (이번 라운드 scope 밖)

| 항목 | 사유 |
|------|------|
| Trailing Stop ATR 모드 | Trader 요청, 추세 전략 4개에 ATR 기반 trailing. percent 모드 안정화 후 진행 |
| 나머지 12개 전략 TP/SL 공통화 | Engineer 제안, 6개 전략 성공 후 확대 |
| 멀티포지션 positionId 매칭 | FIFO 안정화 후 signal 스펙에 positionId 추가 |
| BacktestPriceChart 멀티포지션 마커 최적화 | UI 제안, 겹침 마커 오프셋 처리 |
| BacktestMetrics maxConcurrentPositionsUsed | Trader+UI 제안, 멀티포지션 통계 지표 추가 |
