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
| T3-10 | P3 | Backend | InstrumentCache 심볼별 lot step | E:R6-14 | R6→R9 | done |
| T3-11 | P3 | Frontend | Toast 알림 시스템 (full 구현) | UI:R6-2 | R6 | deferred |
| T3-12 | P3 | Frontend | 전략-레짐 호환성 매트릭스 | UI:S1-1 | R6 | deferred |
| T3-13 | P3 | Frontend | 백테스트 심볼 입력 프리셋 | UI:R6-10 | R6 | deferred |
| T3-14 | P3 | Frontend | 레버리지 표시 보완 (StrategyDetail, Tournament) | UI:S1-2 | R6 | deferred |
| T3-15 | P3 | Backend | positionSide 전체 리팩토링 (13개 전략) | T:R6-4 | R6 | deferred |

## Tier R8 — 코드베이스 재분석 (Round 8)

### Backend T0 (실거래 전 필수)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R8-T0-1 | T0 | Backend | Router Singleton → 팩토리 내부 이동 (8개 파일) | E:C-1 | R8 | done |
| R8-T0-2 | T0 | Backend | BacktestStore LRU 제한 (MAX_STORED=50) | E:C-2 | R8 | done |
| R8-T0-3 | T0 | Backend | RiskEngine reduceOnly bypass (SL/TP 실행 보장) | T:H-5 | R8 | done |
| R8-T0-4 | T0 | Backend | SignalFilter CLOSE 쿨다운 bypass | T:M-2 | R8 | done |
| R8-T0-5 | T0 | Backend | PositionManager 전략-포지션 매핑 (Map 1:1) | T:C-3 | R8→R9 | done |
| R8-T0-6 | T0 | Backend | resume() StrategyRouter 연동 | T:L-1, E:H-2 | R8 | done |
| R8-T0-7 | T0 | Backend | getStatus() getSignal() try-catch | E:H-6 | R8 | done |
| R8-T0-8 | T0 | Frontend | EmergencyStopDialog Escape + 포커스 트랩 | UI:C-1 | R8 | done |
| R8-T0-9 | T0 | Frontend | 에러 토스트 severity 분류 (persistent/auto) | UI:C-2 | R8 | done |
| R8-T0-10 | T0 | Frontend | 봇 중지 확인 다이얼로그 | UI:H-6 | R8 | done |

### Backend/Frontend T1 (1주 내)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R8-T1-1 | T1 | Backend | InstrumentCache 심볼별 lot step (AD-53) | E:M-1 | R8→R9 | done |
| R8-T1-2 | T1 | Backend | Snapshot 주기적 생성 (60초) | E:M-8 | R8 | done |
| R8-T1-3 | T1 | Backend | BotSession stats 실시간 업데이트 | E:M-7 | R8 | done |
| R8-T1-4 | T1 | Backend | OrphanOrderCleanup unref() + 조건부 활성화 | E:H-3 | R8 | done |
| R8-T1-5 | T1 | Backend | TickerAggregator timer unref() | E:H-4 | R8 | done |
| R8-T1-6 | T1 | Backend | _lastTickerEmit Map cleanup | E:H-1 | R8 | done |
| R8-T1-7 | T1 | Backend | parseFloat 직접 사용 제거 (3곳) | E:M-4,M-5 | R8 | done |
| R8-T1-8 | T1 | Backend | TournamentRoutes 캡슐화 위반 수정 | E:H-5 | R8 | done |
| R8-T1-9 | T1 | Frontend | useSocket state 분리 | UI:H-1 | R8 | done |
| R8-T1-10 | T1 | Frontend | useMarketIntelligence named handler | UI:H-2 | R8 | done |
| R8-T1-11 | T1 | Frontend | usePerformanceAnalytics 적응형 폴링 | UI:H-3 | R8 | done |
| R8-T1-12 | T1 | Frontend | useTournament 적응형 폴링 | UI:H-8 | R8 | done |
| R8-T1-13 | T1 | Frontend | useAnalytics 폴링 추가 | UI:M-4 | R8 | done |
| R8-T1-14 | T1 | Frontend | SignalFeed 전략명 번역 | UI:H-7 | R8 | done |
| R8-T1-15 | T1 | Frontend | useTournament 에러 한국어 통일 | UI:H-9 | R8 | done |
| R8-T1-16 | T1 | Frontend | collapsible aria-expanded 일괄 추가 | UI:H-11 | R8 | done |

### Tier 2 (2주 내)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R8-T2-1 | T2 | Backend | 멀티심볼 라우팅 Phase 1 (AD-55) | T:C-1 | R8→R9 | done |
| R8-T2-2 | T2 | Backend | 전략 warm-up 기간 (AD-54) | T:M-3 | R8→R9 | done |
| R8-T2-3 | T2 | Backend | 펀딩비 PnL Phase 1 데이터 수집 (AD-57) | T:H-4 | R8→R9 | done |
| R8-T2-4 | T2 | Backend | 코인 재선정 4h 주기 (AD-56) | T:H-3 | R8→R9 | done |
| R8-T2-5 | T2 | Backend | Paper 모드 전환 경고 강화 (force 파라미터) | E:M-2 | R8→R9 | done |
| R8-T2-6 | T2 | Backend | StateRecovery + OrphanCleanup 활성화 (age 필터) | E:M-3 | R8→R9 | done |
| R8-T2-7 | T2 | Backend | express.json() limit 명시 | E:M-6 | R8 | done |
| R8-T2-8 | T2 | Frontend | StrategyCard toggle 접근성 (button 분리+aria) | UI:H-10 | R8→R9 | done |
| R8-T2-9 | T2 | Frontend | MarketRegimeIndicator 데드코드 검토 (사용처 없음 확인) | UI:H-12 | R8→R9 | done |
| R8-T2-10 | T2 | Frontend | 대시보드 헤더 모바일 반응형 (lg: 브레이크포인트) | UI:H-4 | R8→R9 | done |
| R8-T2-11 | T2 | Frontend | AccountOverview 모바일 레이아웃 (총자산 분리) | UI:H-5 | R8→R9 | done |
| R8-T2-12 | T2 | Frontend | RegimeFlowMap 모바일 대응 (grid-cols-1 lg:) | UI:M-6 | R8→R9 | done |

### Tier 3 (장기)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R8-T3-1 | T3 | Backtest | 백테스트 멀티포지션 지원 (AD-60) | T:H-2 | R8→R10 | done |
| R8-T3-2 | T3 | Backend | Trailing Stop 구현 (AD-59, 6전략 percent) | T:H-1 | R8→R10 | done |
| R8-T3-3 | T3 | Backend | DrawdownMonitor peakEquity 영속성 (AD-58) | T:M-6 | R8→R10 | done |
| R8-T3-4 | T3 | Backtest | Sortino + Calmar Ratio 산출 (AD-61) | T:M-1 | R8→R10 | done |
| R8-T3-5 | T3 | Frontend | 데드 코드 삭제 (StrategyPanel, ClientGate) | UI:A-1,A-2 | R8→R10 | done |
| R8-T3-6 | T3 | Frontend | EquityCurveChart 공통 추출 (AD-62) | UI:M-8 | R8→R10 | done |
| R8-T3-7 | T3 | Frontend | th scope="col" 일괄 추가 | UI:M-5 | R8→R10 | done |
| R8-T3-8 | T3 | Frontend | TOOLTIP_STYLE 통일 | UI:L-1 | R8→R10 | done |

---

## Tier R11 — 코드베이스 재분석 Round 2 (Round 11)

### Backend T0 (즉시 수정)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R11-BE-1 | T0 | Backend | BotSession 상태 불일치 — peakEquity 복원 쿼리 수정 (AD-64) | E:E11-1 | R11 | done |
| R11-BE-2 | T0 | Backend | SignalFilter close 바이패스 오류 수정 (AD-63) | T:R11-T5, E:E11-2 | R11 | done |
| R11-BE-3 | T0 | Backend | BollingerReversion super.onFill() 호출 추가 | T:R11-T3 | R11 | done |
| R11-BE-4 | T0 | Backend | Trailing Stop opt-in 활성화 — 6전략 metadata (AD-65) | T:R11-T2, E:E11-3 | R11 | done |
| R11-BE-5 | T0 | Backend | MaTrend/Turtle entryPrice → onFill() 이동 (AD-37 준수) | T:R11-T4 | R11 | done |

### Backend T1 (1주 내)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R11-BE-6 | T1 | Backend | 일일 리셋 날짜 변경 감지 전환 (utcHour===0 제거) | E:E11-9 | R11 | done |
| R11-BE-7 | T1 | Backend | 환경변수 시작 시 검증 (fast-fail) | E:E11-11 | R11 | done |
| R11-BE-8 | T1 | Backend | Signal 모델 인덱스 3개 추가 | E:E11-5 | R11 | done |
| R11-BE-9 | T1 | Backend | CoinSelector F7 volMomentum → 거래량 변화율 수정 | T:R11-T8 | R11 | done |
| R11-BE-10 | T1 | Backend | PaperEngine TP 트리거 시뮬레이션 (AD-68) | T:R11-T11 | R11 | done |
| R11-BE-11 | T1 | Backend | PaperEngine 미결 주문 30분 TTL + 50건 제한 | E:E11-7 | R11 | done |

### Backtest T1

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R11-BT-1 | T1 | Backtest | getEquity 미실현 PnL 포함 (AD-66) | T:R11-T6 | R11 | done |
| R11-BT-2 | T1 | Backtest | 펀딩 비용 cash 실제 반영 (AD-67) | T:R11-T7 | R11 | done |

### Frontend T1

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R11-FE-01 | T1 | Frontend | MarketRegimeIndicator.tsx 삭제 (데드 코드) | UI:R11-FE-01 | R11 | done |
| R11-FE-02 | T1 | Frontend | risk.ts any → RiskStatusExtended 타입 | UI:R11-FE-02 | R11 | done |
| R11-FE-03 | T1 | Frontend | EquityCurveBase 제네릭 + as unknown as 제거 | UI:R11-FE-03 | R11 | done |
| R11-FE-04 | T1 | Frontend | as never 7건 → createCurrencyFormatter 공통화 | UI:R11-FE-04 | R11 | done |
| R11-FE-05 | T1 | Frontend | PaperModeGate 공통 컴포넌트 | UI:R11-FE-05 | R11 | done |
| R11-FE-06 | T1 | Frontend | CATEGORY_LABEL 통일 (translateStrategyCategory) | UI:R11-FE-06 | R11 | done |
| R11-FE-07 | T1 | Frontend | formatPnl 유틸 승격 | UI:R11-FE-07 | R11 | done |
| R11-FE-10 | T1 | Frontend | 백테스트 폼 유효성 검증 강화 | UI:R11-FE-10 | R11 | done |
| R11-FE-11 | T1 | Frontend | useStrategyDetail 적응형 폴링 전환 | UI:R11-FE-11 | R11 | done |
| R11-FE-12 | T1 | Frontend | PerformanceTabs lazy loading | UI:R11-FE-12 | R11 | done |
| R11-FE-13 | T1 | Frontend | 비활성화 다이얼로그 접근성 (focus trap) | UI:R11-FE-13 | R11 | done |
| R11-FE-BT1 | T1 | Frontend | BacktestEquityPoint unrealizedPnl 필드 추가 | UI 보완 | R11 | done |
| R11-FE-BT2 | T1 | Frontend | BacktestMetrics totalFundingCost + StatsPanel 반영 | UI 보완 | R11 | done |

### 보류 (R12)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| R11-D1 | T2 | Backend | 트레일링 스탑 통합 (MaTrend/Turtle 자체 구현 → StrategyBase 매핑) | T:R11-T1 | R11 | deferred |
| R11-D2 | T2 | Backend | ATR 기반 포지션 사이징 (opt-in riskPerUnit) | T:R11-T9 | R11 | deferred |
| R11-D3 | T2 | Backend | maxHoldTime 강제 청산 (2단계 경고→강제) | T:R11-T10 | R11 | deferred |
| R11-D4 | T2 | Backend | 테스트 커버리지 확대 (riskEngine, signalFilter 등 5개) | E:E11-4 | R11 | deferred |
| R11-D5 | T2 | Backend | Trade 모델 TTL/아카이브 전략 | E:E11-6 | R11 | deferred |
| R11-D6 | T2 | Backend | WS 재연결 후 재구독 | E:E11-8 | R11 | deferred |
| R11-D7 | T2 | Backend | API 라우트 입력 검증 (Zod) | E:E11-10 | R11 | deferred |
| R11-D8 | T2 | Backend | Bootstrap 중간 실패 복구 | E:E11-12 | R11 | deferred |
| R11-D9 | T3 | Backend | MongoDB 커넥션 풀 모니터링 | E:E11-14 | R11 | deferred |
| R11-D10 | T3 | Backend | 리스크 이벤트 Prometheus 메트릭 확장 | E:E11-15 | R11 | deferred |
| R11-D11 | T2 | Frontend | tournament/page.tsx 분할 (478줄) | UI:R11-FE-08 | R11 | deferred |
| R11-D12 | T2 | Frontend | 백테스트 결과 비교 기능 | UI:R11-FE-09 | R11 | deferred |

---

## 아키텍처 결정 참조
→ `decisions/round_1.md` — AD-1~AD-6 참조
→ `decisions/round_2.md` — AD-7~AD-12 참조 (T0-1~T0-9 구현 세부사항)
→ `decisions/round_3.md` — AD-13~AD-17 참조 (T1-1~T1-11 구현 세부사항)
→ `decisions/round_4.md` — AD-18~AD-24 참조 (T2-1~T2-12 구현 세부사항)
→ `decisions/round_5.md` — AD-25~AD-31 참조 (T3-1~T3-7 + BUG-1 구현 세부사항)
→ `decisions/round_6.md` — AD-32~AD-39 참조 (R6 실거래 준비도 강화)
→ `decisions/round_7.md` — AD-40~AD-45 참조 (R7 레짐 안정화 + 유예기간)
→ `decisions/round_8.md` — AD-46~AD-52 참조 (R8 코드베이스 재분석)
→ `decisions/round_9.md` — AD-53~AD-57 참조 (R9 Tier 2 Quality)
→ `decisions/round_10.md` — AD-58~AD-62 참조 (R10 Tier 3 Enhancement)
→ `decisions/round_11.md` — AD-63~AD-68 참조 (R11 코드베이스 재분석 Round 2)
