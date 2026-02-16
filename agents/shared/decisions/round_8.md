# Round 8 합의 결정문서

> 생성일: 2026-02-16
> 주제: 코드베이스 재분석 — 새 개선과제 발굴
> 입력: 3개 제안서 (Trader 19건, Engineer 16건, UI 23건) + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

### Tier 0 — 실거래 전 필수 (10건)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T0-1 | Module-level Router Singleton → 팩토리 내부 이동 (8개 파일) | 3/3 | Backend | 30m |
| R8-T0-2 | BacktestStore LRU 제한 (MAX_STORED=50) | 3/3 | Backend | 45m |
| R8-T0-3 | RiskEngine reduceOnly 주문 bypass (SL/TP 실행 보장) | 3/3 | Backend | 1.5h |
| R8-T0-4 | SignalFilter CLOSE 쿨다운 bypass | 3/3 | Backend | 30m |
| R8-T0-5 | PositionManager 전략 메타데이터 주입 (orderId→strategy 매핑) | 3/3 | Backend | 3.5h |
| R8-T0-6 | resume() StrategyRouter 연동 (레짐 기반 재활성화) | 3/3 | Backend | 30m |
| R8-T0-7 | getStatus() getSignal() try-catch 방어 | 3/3 | Backend | 10m |
| R8-T0-8 | EmergencyStopDialog Escape 키 + 포커스 트랩 | 3/3 | Frontend | 1h |
| R8-T0-9 | 에러 토스트 severity 기반 persistent/auto-dismiss 분류 | 3/3 | Frontend | 30m |
| R8-T0-10 | 봇 중지 확인 다이얼로그 (열린 포지션 경고) | 3/3 | Frontend | 30m |

### Tier 1 — 1주 내 수정 (16건)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T1-1 | InstrumentCache 심볼별 lot step (T3-10 승격) | 3/3 | Backend | 2h |
| R8-T1-2 | Snapshot 주기적 생성 구현 (30초~1분) | 3/3 (UI 상향 지지) | Backend | 1.5h |
| R8-T1-3 | BotSession stats 실시간 업데이트 | 3/3 | Backend | 1.5h |
| R8-T1-4 | OrphanOrderCleanup unref() + 조건부 활성화 | 2/3+조건부 | Backend | 20m |
| R8-T1-5 | TickerAggregator timer unref() | 3/3 | Backend | 5m |
| R8-T1-6 | _lastTickerEmit Map cleanup | 3/3 | Backend | 15m |
| R8-T1-7 | parseFloat 직접 사용 제거 (tradeRoutes, tournamentRoutes, tickerAggregator) | 3/3 | Backend | 25m |
| R8-T1-8 | TournamentRoutes 캡슐화 위반 수정 | 3/3 | Backend | 30m |
| R8-T1-9 | useSocket state 분리 (signals/riskEvents 독립 useState) | 3/3 | Frontend | 1h |
| R8-T1-10 | useMarketIntelligence named handler 패턴 적용 | 3/3 | Frontend | 20m |
| R8-T1-11 | 폴링 표준화: usePerformanceAnalytics → useAdaptivePolling | 3/3 | Frontend | 20m |
| R8-T1-12 | 폴링 표준화: useTournament → useAdaptivePolling | 3/3 | Frontend | 20m |
| R8-T1-13 | useAnalytics 폴링 추가 (R8-T1-2와 연계) | 3/3 | Frontend | 20m |
| R8-T1-14 | SignalFeed 전략명 번역 | 3/3 | Frontend | 5m |
| R8-T1-15 | useTournament 에러 메시지 한국어 통일 | 3/3 | Frontend | 5m |
| R8-T1-16 | collapsible 섹션 aria-expanded 일괄 추가 | 3/3 | Frontend | 20m |

### Tier 2 — 2주 내 수정 (12건)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T2-1 | 멀티심볼 라우팅 Phase 1: 전략마다 다른 단일 심볼 배정 | 2/3+조건부 | Backend | 8h |
| R8-T2-2 | 전략 warm-up 기간 (warmupCandles 메타데이터) | 3/3 | Backend | 2h |
| R8-T2-3 | 펀딩비 PnL 반영 (WS account + 백테스트) | 3/3 | Backend | 4.5h |
| R8-T2-4 | 코인 재선정 주기 (4~8시간 고정 간격) | 2/3+조건부 | Backend | 3.5h |
| R8-T2-5 | Paper 모드 trading-mode 전환 경고 강화 | 2/3+조건부 | Backend | 30m |
| R8-T2-6 | StateRecovery + OrphanOrderCleanup 활성화 (Paper 검증 후) | 2/3+조건부 | Backend | 45m |
| R8-T2-7 | express.json() limit 명시 | 3/3 | Backend | 5m |
| R8-T2-8 | StrategyCard toggle 접근성 수정 | 3/3 | Frontend | 30m |
| R8-T2-9 | MarketRegimeIndicator 중복 코드 정리 (삭제) | 3/3 | Frontend | 15m |
| R8-T2-10 | 대시보드 헤더 모바일 반응형 | 2/3 (MEDIUM 합의) | Frontend | 45m |
| R8-T2-11 | AccountOverview 모바일 레이아웃 | 2/3 (MEDIUM 합의) | Frontend | 20m |
| R8-T2-12 | RegimeFlowMap 모바일 대응 | 3/3 | Frontend | 30m |

### Tier 3 — 장기 Enhancement (8건)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T3-1 | 백테스트 멀티포지션 지원 | 3/3 | Backtest | 7h |
| R8-T3-2 | Trailing Stop 구현 (Bitget API 확인 후) | 2/3+조건부 | Backend | 4.5h |
| R8-T3-3 | DrawdownMonitor peakEquity 영속성 | 3/3 | Backend | 1.5h |
| R8-T3-4 | Sortino Ratio 산출 | 3/3 | Backtest | 1h |
| R8-T3-5 | 데드 코드 삭제 (StrategyPanel, ClientGate) | 3/3 | Frontend | 7m |
| R8-T3-6 | EquityCurveChart 공통 추출 | 3/3 | Frontend | 45m |
| R8-T3-7 | th scope="col" 일괄 추가 | 3/3 | Frontend | 20m |
| R8-T3-8 | TOOLTIP_STYLE 통일 (chart-config.ts 사용) | 3/3 | Frontend | 10m |

### Deferred 유지 (5건)

| ID | 이슈 | 판정 | 사유 |
|----|------|------|------|
| T3-4 | decimal.js 마이그레이션 | deferred (모니터링 후 결정) | Trader=CRITICAL, Engineer=deferred → 타협: 실거래 1개월 후 drift 모니터링 결과로 판단 |
| T3-9 | Socket.io CORS + 인증 | deferred → 다음 라운드 T1 | 실거래 환경에서 필요하나 이번 라운드 범위 초과 |
| T3-12 | 전략-레짐 호환성 매트릭스 | deferred 유지 | MEDIUM 우선순위, 정보 과부하 우려 |
| T3-14 | 레버리지 표시 보완 | deferred 유지 | LOW 우선순위 |
| T3-15 | positionSide 전체 리팩토링 | deferred 유지 | regression 리스크, 기능적 변화 없음 |

---

## 아키텍처 결정

### AD-46: RiskEngine reduceOnly bypass 패턴
- **결정**: `reduceOnly: true` 주문은 CircuitBreaker, DrawdownMonitor 체크를 bypass. ExposureGuard의 position size 체크도 bypass. 단, AUDIT 로그 레벨로 모든 bypass를 기록.
- **근거**: 청산 주문이 리스크 체크에 막히면 손실이 확대됨. 청산은 노출을 줄이는 것이므로 리스크 증가가 아님.
- **제안자**: Trader H-5, Engineer/UI 전원 동의

### AD-47: 에러 severity 3단계 분류
- **결정**: 에러를 3단계로 분류하여 토스트 동작 차별화:
  - **Persistent (닫기 전까지)**: 주문 실패, API 연결 실패, 긴급 정지 실패, 포지션 청산 실패
  - **10초 auto-dismiss**: 데이터 조회 지연, WebSocket 재연결
  - **5초 auto-dismiss**: 성공 피드백 (주문 체결, 포지션 청산 완료)
- **근거**: 실거래 중 critical 에러가 자동으로 사라지면 조치를 놓칠 위험.
- **제안자**: UI C-2, Trader severity 분류 제공

### AD-48: PositionManager orderId→strategy 매핑 아키텍처
- **결정**: OrderManager에서 주문 제출 시 `orderId → strategy` 매핑을 메모리 Map에 저장. TTL 1시간 기반 cleanup. 서버 재시작 시 Trade 모델의 strategy 필드로 폴백 조회.
- **근거**: 거래소 REST/WS 응답에 전략 정보가 없으므로 자체 매핑 필요.
- **제안자**: Trader C-3, Engineer 구현 가이드

### AD-49: BacktestStore LRU 정책
- **결정**: MAX_STORED_RESULTS=50. FIFO 교체 (Trader 제안). equityCurve는 인메모리 유지 (MongoDB 미설치 환경 고려).
- **근거**: 백테스트 결과 1회당 1~50MB. 20회 초과 시 OOM 위험.
- **제안자**: Engineer C-2, Trader FIFO 제안

### AD-50: 멀티심볼 라우팅 단계적 접근
- **결정**: Phase 1 — 전략마다 다른 단일 심볼 배정 (코인 스코어 기반 라운드 로빈). Phase 2 — 전략당 멀티심볼 (상태 격리, 별도 라운드). 시간 추정 Phase 1만 8h.
- **근거**: Engineer의 "구현 난이도 과소평가" 우려 반영. Phase 1으로 즉각적 수익 개선 확보 후 Phase 2 진행.
- **제안자**: Trader C-1, Engineer 조건부 동의

### AD-51: decimal.js 이견 해소 — 모니터링 우선 접근
- **결정**: decimal.js 도입을 deferred로 유지하되, 실거래 시 "BE 계산 PnL vs 거래소 실제 PnL" drift 모니터링 로직을 추가. drift가 0.01% 이상이면 즉시 도입. UI에서 drift 비교 표시.
- **근거**: Trader(CRITICAL)와 Engineer(deferred)의 이견을 데이터 기반으로 해소. 현재 범위에서는 실용적으로 문제 없을 가능성 높으나 확인 필요.
- **제안자**: 타협안 (UI 중재)

### AD-52: Snapshot 생성 주기
- **결정**: BotService start() 후 60초 간격으로 Snapshot 생성. stop() 시 타이머 정리. Snapshot 모델에 sessionId + equity + unrealizedPnl + cash 저장.
- **근거**: EquityCurveChart가 실거래에서 빈 차트를 표시하는 것은 핵심 기능 미작동. 60초 간격은 DB I/O와 해상도의 적절한 타협.
- **제안자**: Engineer M-8, UI HIGH 상향 지지

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| decimal.js 도입 | CRITICAL — 장시간 누적 오차 | deferred — IEEE 754 범위 내 | 조건부 — drift 모니터링 제안 | **deferred + drift 모니터링** (AD-51) |
| 멀티심볼 라우팅 범위 | 8~12h 풀 구현 | Phase 1만 (16~20h 전체) | 동의 + FE 3h 추가 | **Phase 1만 이번 라운드** (AD-50) |
| 모바일 반응형 우선순위 | MEDIUM으로 하향 | MEDIUM 동의 | HIGH 유지 | **MEDIUM (Tier 2)** |
| Snapshot 주기 우선순위 | 동의 | MEDIUM | HIGH 상향 | **Tier 1 (HIGH)** |
| OrphanOrderCleanup | SL 보호 필요 | 활성화 필요 | Paper 검증 먼저 | **조건부 활성화 (Tier 2)** |

---

## 다음 단계 — 구현 순서

### Phase 4 실행 범위: Tier 0 (10건) + Tier 1 (16건) = 26건

#### Track A (Backend): 17건, ~13.5h
1. R8-T0-1: Router Singleton 수정 (30m)
2. R8-T0-2: BacktestStore LRU (45m)
3. R8-T0-3: reduceOnly bypass (1.5h)
4. R8-T0-4: SignalFilter CLOSE bypass (30m)
5. R8-T0-5: PositionManager 전략 매핑 (3.5h)
6. R8-T0-6: resume() StrategyRouter (30m)
7. R8-T0-7: getStatus() try-catch (10m)
8. R8-T1-1: InstrumentCache lot step (2h)
9. R8-T1-2: Snapshot 주기적 생성 (1.5h)
10. R8-T1-3: BotSession stats (1.5h)
11. R8-T1-4: OrphanOrderCleanup unref (20m)
12. R8-T1-5: TickerAggregator unref (5m)
13. R8-T1-6: _lastTickerEmit cleanup (15m)
14. R8-T1-7: parseFloat 제거 (25m)
15. R8-T1-8: TournamentRoutes 캡슐화 (30m)
16. R8-T2-7: express.json limit (5m)

#### Track C (Frontend): 11건, ~4.75h
1. R8-T0-8: EmergencyStopDialog Escape + 포커스 트랩 (1h)
2. R8-T0-9: 에러 토스트 persistent (30m)
3. R8-T0-10: 봇 중지 확인 다이얼로그 (30m)
4. R8-T1-9: useSocket state 분리 (1h)
5. R8-T1-10: useMarketIntelligence named handler (20m)
6. R8-T1-11: usePerformanceAnalytics 폴링 (20m)
7. R8-T1-12: useTournament 폴링 (20m)
8. R8-T1-13: useAnalytics 폴링 (20m)
9. R8-T1-14: SignalFeed 전략명 번역 (5m)
10. R8-T1-15: useTournament 에러 한국어 (5m)
11. R8-T1-16: collapsible aria-expanded (20m)

### 의존성
- R8-T1-2 (Snapshot 생성) ↔ R8-T1-13 (useAnalytics 폴링): BE 먼저, FE 후속
- R8-T1-1 (InstrumentCache) ← R8-T2-1 (멀티심볼): lot step이 선행 필요
- R8-T0-5 (PositionManager 전략 매핑) ← R8-T2-1 (멀티심볼): 전략별 포지션 추적이 선행 필요
