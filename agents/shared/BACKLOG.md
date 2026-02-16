# Shared Backlog — 누적 개선과제

> 라운드를 거치며 발견된 모든 개선과제가 여기에 누적된다.
> 합의된 항목은 `decisions/`로, 완료된 항목은 `[DONE]`으로 표시.

## Status Values
- `proposed` — 제안됨, 아직 합의 전
- `agreed` — 3명 합의됨, 실행 대기
- `in_progress` — 구현 중
- `done` — 완료
- `rejected` — 기각 (사유 기록)
- `deferred` — 보류 (사유 기록)

---

## Tier 0 — 실거래 전 필수 (Safety-Critical)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| T0-1 | P0 | Backend | 기본 전략 이름 수정 (MomentumStrategy→실존 이름) | T:C5, E:H-7 | R1 | done |
| T0-2 | P0 | Backend | Position sizing: percentage→quantity 변환 파이프라인 구축 | T:C2 | R1 | done |
| T0-3 | P0 | Backend | Multi-symbol routing: Set 기반 심볼 관리로 전환 | T:C1 | R1 | done |
| T0-4 | P0 | Backend | unhandledRejection/uncaughtException 핸들러 추가 | E:C-1 | R1 | done |
| T0-5 | P0 | Backend | orderManager.submitOrder() per-symbol mutex 추가 | E:C-2 | R1 | done |
| T0-6 | P0 | Backend | ExposureGuard equity=0 division by zero 방어 | E:C-3 | R1 | done |
| T0-7 | P0 | Frontend | Emergency Stop ConfirmDialog 추가 | UI:C1 | R1 | done |
| T0-8 | P0 | Frontend | Risk 이벤트(CB/DD) 실시간 UI 표시 + RiskAlertBanner | UI:C2 | R1 | done |
| T0-9 | P0 | Frontend | 실거래/가상거래 모드 시각적 경고 강화 | UI:C4 | R1 | done |
| T0-10 | P0 | Backend | riskEngine.getAccountState() 메서드 추가 (런타임 크래시) | E:R6-1 | R6 | done |
| T0-11 | P0 | Backend | getAccountInfo() 크래시 수정 → equity 캐시 활용 | T:R6-5, E:R6-2 | R6 | done |

## Tier 1 — 1주 내 수정 (Reliability)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| T1-1 | P1 | Backend | Backtest: IndicatorCache 주입 (14/18 전략 크래시 해결) | T:C4 | R1 | done |
| T1-2 | P1 | Backend | Backtest: _notifyFill() action 필드 추가 | T:C3 | R1 | done |
| T1-3 | P1 | Backend | Graceful shutdown 순서 수정 (DB write→WS close) | E:C-4 | R1 | done |
| T1-4 | P1 | Backend | PaperEngine 리스너 누적 제거 (removeAllListeners) | E:H-3 | R1 | done |
| T1-5 | P1 | Backend | SignalFilter.updatePositionCount() 연동 | E:4.11 | R1 | done |
| T1-6 | P1 | Backend | Sharpe ratio 연간화 정규화 (캔들간→일간 보정) | T:H1 | R1 | done |
| T1-7 | P1 | Frontend | Dashboard 레이아웃 재설계 (정보 우선순위 정상화) | UI:H1 | R1 | done |
| T1-8 | P1 | Frontend | PositionsTable 수동 청산 버튼 추가 | UI:H4, T:Review | R1 | done |
| T1-9 | P1 | Frontend | Socket.io ref-counted lifecycle 전환 | UI:C3 | R1 | done |
| T1-10 | P1 | Frontend | Error Boundary (app/error.tsx) + api-client 에러 래핑 | UI:FE3 | R1 | done |
| T1-11 | P1 | Backend | DrawdownMonitor 수동 리셋 API + UI 리셋 버튼 | T:H7 | R1 | done |
| T1-12 | P1 | Backend | ExposureGuard 시장가 주문 price 주입 + reject 방어 | T:R6-1, E:R6-3 | R6 | done |
| T1-13 | P1 | Backend | CLOSE 시그널 qty 퍼센트→실제수량 변환 | T:R6-7 | R6 | done |
| T1-14 | P1 | Backend | setLeverage 메커니즘 구현 (per-signal + 캐시) | T:R6-2, E:R6-4 | R6 | done |
| T1-15 | P1 | Backend | OrderManager/PositionManager destroy() 호출 추가 | E:R6-5 | R6 | done |
| T1-16 | P1 | Frontend | BacktestStatsPanel disclaimer 추가 | T:S1-3, UI:S1-3 | R6 | done |

## Tier 2 — 2주 내 수정 (Quality)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| T2-1 | P2 | Backend | RSI Wilder smoothing 구현 (smoothing param 추가) | T:H2 | R1 | done |
| T2-2 | P2 | Backend | Confidence-based signal filtering (전략별 임계값) | T:H3 | R1 | done |
| T2-3 | P2 | Backend | Backtest default position size 95%→전략 메타 기반 | T:H5 | R1 | done |
| T2-4 | P2 | Backend | FundingRateStrategy 데이터 소스 구축 (REST polling) | T:E6 | R1 | done |
| T2-5 | P2 | Backend | GridStrategy equity 주입 (DI context 패턴) | T:4.6 | R1 | done |
| T2-6 | P2 | Frontend | useSocket 목적별 분리 (tickers/signals/risk/regime) | UI:FE2 | R1 | done |
| T2-7 | P2 | Backend | API rate limiting (express-rate-limit) | E:E-2 | R1 | done |
| T2-8 | P2 | Frontend | SignalFeed rejectReason 표시 | UI:H5 | R1 | done |
| T2-9 | P2 | Backend | CircuitBreaker rapidLosses 배열 크기 제한 | E:H-4 | R1 | done |
| T2-10 | P2 | Frontend | Drawdown 시각화 차트 (신규 컴포넌트) | UI:V1 | R1 | done |
| T2-11 | P2 | Frontend | Risk Gauge 대시보드 (시각적 게이지) | UI:V3 | R1 | done |
| T2-12 | P2 | Frontend | 적응형 폴링 (봇 상태별 간격 조절) | UI:H8 | R1 | done |
| T2-13 | P2 | Backend | submitOrder await 추가 (fire-and-forget 제거) | T:R6-6 | R6 | done |
| T2-14 | P2 | Backend | SignalFilter _activeSignals stale 정리 (타임스탬프) | E:R6-6 | R6 | done |
| T2-15 | P2 | Backend | PaperEngine reset() 메서드 추가 | E:R6-9 | R6 | done |
| T2-16 | P2 | Backend | SignalFilter _strategyMeta.clear() 추가 | E:R6-11 | R6 | done |
| T2-17 | P2 | Backend | Socket.io ticker throttle (심볼당 1초) | E:R6-8 | R6 | done |
| T2-18 | P2 | Backend | positionSide 조기 설정 제거 — 파일럿 2전략 | T:R6-4 | R6 | done |
| T2-19 | P2 | Frontend | StrategyDetail 디자인 토큰 마이그레이션 | UI:R6-1 | R6 | done |
| T2-20 | P2 | Frontend | error.tsx 디자인 토큰 마이그레이션 | UI:R6-3 | R6 | done |
| T2-21 | P2 | Frontend | 백테스트 삭제 ConfirmDialog 추가 | UI:R6-4 | R6 | done |
| T2-22 | P2 | Frontend | AccountOverview 반응형 (grid-cols-2 md:grid-cols-4) | UI:R6-5 | R6 | done |
| T2-23 | P2 | Frontend | BacktestTradeList 마진 수정 (-mx-4→-mx-6) | UI:R6-6 | R6 | done |
| T2-24 | P2 | Frontend | Chart Tooltip 스타일 상수 통합 | UI:R6-7 | R6 | done |
| T2-25 | P2 | Frontend | 네비게이션 접근성 (aria-disabled, aria-label) | UI:R6-8 | R6 | done |
| T2-26 | P2 | Frontend | BotControlPanel Live 확인 → ConfirmDialog 재사용 | UI:R6-9 | R6 | done |
| T2-27 | P2 | Frontend | SignalFeed/TradesTable 높이 동기화 | UI:R6-11 | R6 | done |
| T2-28 | P2 | Frontend | StrategySymbolMap 테이블 스타일 정규화 | UI:R6-12 | R6 | done |
| T2-29 | P2 | Frontend | alert() → 인라인 에러 메시지 전환 | UI:R6-2 | R6 | done |

## Tier R7 — 레짐 안정화 + 유예기간 (Round 7)

### Backend (T0)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R7-A1 | T0 | Backend | hysteresisMinCandles 3→10 + Optimizer [5,20] | 3/3 동의 | R7 | done |
| R7-A2 | T0 | Backend | 레짐 전환 쿨다운 5분 (timestamp 비교) | 3/3 동의 | R7 | done |
| R7-A3 | T0 | Backend | 히스테리시스 가중치 0.10→0.15 | 3/3 동의 | R7 | done |
| R7-A4 | T0 | Backend | RegimeOptimizer 범위 확장 [5,20] + 쿨다운 [120K,600K] | 3/3 동의 | R7 | done |
| R7-B1 | T0 | Backend | StrategyRouter 유예기간 핵심 구조 (Map + setTimeout + unref) | 3/3 동의 | R7 | done |
| R7-B2 | T0 | Backend | 유예 중 OPEN 차단 / CLOSE 허용 | 3/3 동의 | R7 | done |
| R7-B4 | T0 | Backend | 유예 타이머 동시성 보호 (6개 레이스컨디션 방어) | 3/3 동의 | R7 | done |

### Backend (T1)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R7-B3 | T1 | Backend | 전략 metadata gracePeriodMs + 카테고리별 기본값 (17개 전략) | 2/3+조건부 | R7 | done |
| R7-B5 | T1 | Backend | disableStrategy ↔ grace period 통합 | 3/3 동의 | R7 | done |
| R7-C1 | T1 | Backend | 레짐 전환 빈도 메트릭 (transitionsLastHour, cooldownActive) | 3/3 동의 | R7 | done |
| R7-C2 | T1 | Backend | StrategyRouter getStatus() 확장 (gracePeriods) | 3/3 동의 | R7 | done |
| R7-C3 | T1 | Backend | Socket.io grace 이벤트 3종 | 2/3+조건부 | R7 | done |

### Frontend (T1~T2)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R7-FE1 | T1 | Frontend | 전략 3-way 배지 (active/grace/inactive) + amber 유예 표시 | 3/3 동의 | R7 | done |
| R7-FE2 | T1 | Frontend | 레짐 pending/cooldown 상태 표시 | 3/3 동의 | R7 | done |
| R7-FE3 | T1 | Frontend | Socket 이벤트 연동 (grace_started/cancelled/expired) | 3/3 동의 | R7 | done |
| R7-FE4 | T2 | Frontend | 유예기간 카운트다운 타이머 | 3/3 동의 | R7 | done |
| R7-FE5 | T2 | Frontend | 레짐 전환 빈도 경고 인디케이터 | 3/3 동의 | R7 | done |

---

## Tier 3 — 장기 (Enhancement)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| T3-1 | P3 | All | 테스트 프레임워크 구축 (Jest + mathUtils 51 tests) | E:E-1 | R5 | done |
| T3-2 | P3 | All | API 인증/인가 (Bearer API Key + FE 헤더) | E:E-3 | R5 | done |
| T3-3 | P3 | Backend | Exchange-side stop loss (16전략 presetSL + PaperEngine) | T:E4 | R5 | done |
| T3-4 | P3 | Backend | decimal.js 마이그레이션 (mathUtils 교체) | E:C-5 | R1 | deferred |
| T3-5 | P3 | Backend | Prometheus 메트릭 (14 metrics + /metrics endpoint) | E:E-7 | R5 | done |
| T3-6 | P3 | Frontend | 성과 귀인 대시보드 (PerformanceTabs 4탭 + BE 확장) | T:Review | R5 | done |
| T3-7 | P3 | Backend | Correlation ID (AsyncLocalStorage traceId 전파) | E:9.1 | R5 | done |
| BUG-1 | P0 | Backend | Map 직렬화 버그 수정 (performanceTracker) | R5 | R5 | done |
| T3-8 | P3 | Backend | EventEmitter maxListeners(20) 설정 | E:R6-12 | R6 | done |
| T3-9 | P3 | Backend | Socket.io CORS + 인증 (FE 동시 배포 필요) | E:R6-7 | R6 | deferred |
| T3-10 | P3 | Backend | InstrumentCache 심볼별 lot step | E:R6-14 | R6 | deferred |
| T3-11 | P3 | Frontend | Toast 알림 시스템 (full 구현) | UI:R6-2 | R6 | deferred |
| T3-12 | P3 | Frontend | 전략-레짐 호환성 매트릭스 | UI:S1-1 | R6 | deferred |
| T3-13 | P3 | Frontend | 백테스트 심볼 입력 프리셋 | UI:R6-10 | R6 | deferred |
| T3-14 | P3 | Frontend | 레버리지 표시 보완 (StrategyDetail, Tournament) | UI:S1-2 | R6 | deferred |
| T3-15 | P3 | Backend | positionSide 전체 리팩토링 (13개 전략) | T:R6-4 | R6 | deferred |

---

## 아키텍처 결정 참조
→ `decisions/round_1.md` — AD-1~AD-6 참조
→ `decisions/round_2.md` — AD-7~AD-12 참조 (T0-1~T0-9 구현 세부사항)
→ `decisions/round_3.md` — AD-13~AD-17 참조 (T1-1~T1-11 구현 세부사항)
→ `decisions/round_4.md` — AD-18~AD-24 참조 (T2-1~T2-12 구현 세부사항)
→ `decisions/round_5.md` — AD-25~AD-31 참조 (T3-1~T3-7 + BUG-1 구현 세부사항)
→ `decisions/round_6.md` — AD-32~AD-39 참조 (R6 실거래 준비도 강화)
→ `decisions/round_7.md` — AD-40~AD-45 참조 (R7 레짐 안정화 + 유예기간)
