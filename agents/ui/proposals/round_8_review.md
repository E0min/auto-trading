# Round 8 Cross-Review — UI/UX 관점

> Reviewer: Senior UI/UX Engineer
> Date: 2026-02-16
> 리뷰 대상: Trader 제안서 + Engineer 제안서

---

## Trader 제안서 리뷰

### CRITICAL-1: StrategyRouter 단일 심볼 할당
- **판정: ✅ 동의**
- 매매 기회 확대는 수익률에 직접적 영향. UI 관점에서 추가 고려:
  1. **대시보드 영향**: 현재 PositionsTable, StrategySymbolMap, RegimeFlowMap이 전략-심볼 매핑을 표시. 멀티심볼 시 이 컴포넌트들의 데이터 구조가 변경될 수 있음.
  2. **전략별 활성 심볼 표시**: Trader 요청대로 StrategyCard에 현재 할당된 심볼(들)을 표시하는 UI 추가 필요.
  3. **StrategySymbolMap 진화**: 현재 `Strategy × Symbol` 매트릭스가 "어떤 전략이 어떤 심볼에서 작동하는가"를 보여주는데, 멀티심볼이면 이 뷰가 더 중요해짐.
- **FE 예상 작업**: StrategyCard에 `activeSymbols: string[]` 표시 (chips), StrategySymbolMap 데이터 소스 변경. 약 2~3h 추가.

### CRITICAL-2: mathUtils decimal.js 마이그레이션
- **판정: ⚠️ 조건부 동의**
- UI 관점에서 직접적 영향은 없으나 (FE는 문자열로 받아 표시만 함), 데이터 정확성이 모든 시각화의 기반이므로 간접적 이해관계가 있음.
- **Engineer와 Trader의 이견**: Engineer의 "실용적 범위에서 충분" 논거가 일리 있지만, Trader의 "장시간 누적 오차 우려"도 타당.
- **UI 제안**: 실거래 후 "BE 계산 PnL"과 "거래소 실제 PnL"을 대시보드에 병렬 표시하여 drift를 모니터링하는 UX를 먼저 구현하면, decimal.js 도입 필요성을 데이터로 판단 가능.

### CRITICAL-3: PositionManager 전략 메타데이터 주입
- **판정: ✅ 동의**
- FE에서 이미 PositionsTable에 `strategy` 컬럼이 있으나, 실거래 모드에서는 이 필드가 비어있을 수 있었음. 이 수정으로 실거래에서도 전략별 포지션 구분이 가능해짐.
- **FE 추가 작업 없음** — 이미 `pos.strategy`를 표시하는 코드가 있음.

### HIGH-1: Trailing Stop 라이브 미구현
- **판정: ⚠️ 조건부 동의**
- FE 관점: trailing stop이 활성화된 포지션에 대해 "T/S" 아이콘 또는 trailing distance를 PositionsTable에 표시해야 함.
- **조건**: Engineer의 의견대로 Bitget API 지원 확인 후 진행.

### HIGH-2: 백테스트 단일 포지션 제한
- **판정: ✅ 동의**
- FE BacktestStatsPanel에서 동시 포지션 수 관련 메트릭이 추가될 수 있음. BacktestTradeList에서 overlapping 포지션을 시각적으로 구분하는 UI 필요할 수 있음.
- 현재 BacktestPriceChart의 entry/exit 마커가 단일 포지션 가정. 멀티포지션이면 마커 색상/형태 분리 필요.

### HIGH-3: 코인 재선정 메커니즘
- **판정: ✅ 동의**
- FE에서 "마지막 코인 재선정 시간"을 표시하면 사용자가 시스템 상태를 이해하는 데 도움. 현재 MarketIntelligence 헤더에 "레짐 변경 시각"은 표시하지만 "코인 재선정 시각"은 없음.
- **FE 작업**: MarketIntelligence 또는 CoinScoreboard에 "마지막 갱신: 3h 12m 전" 타임스탬프 추가. 약 15분.

### HIGH-4: 펀딩비 PnL 미반영
- **판정: ✅ 동의**
- Trader 요청대로 PnL 표시에 "펀딩비 차감 전/후" 구분 추가. AccountOverview의 미실현 PnL 옆에 `(펀딩비: -$12.34)` 표시.
- 또는 hover tooltip으로 세부 구성 표시: "미실현 PnL: +$150 / 펀딩비 누적: -$12 / 순 PnL: +$138"

### HIGH-5: RiskEngine reduceOnly bypass
- **판정: ✅ 동의**
- FE에 직접 영향 없지만, SL 실행 보장은 사용자 신뢰 핵심. 현재 RiskAlertBanner에서 circuit breaker 상태를 표시하는데, bypass 로그가 추가되면 "SL은 정상 실행됨" 상태를 명시할 수 있음.

### HIGH-6: 레버리지 관리 미흡
- **판정: ⚠️ 조건부 동의**
- Engineer와 동의: CRITICAL-1 해결 후 함께 처리가 효율적.

### MEDIUM 항목들
- **M-1 (Sortino)**: ✅ 동의. BacktestStatsPanel에 Sortino 표시 추가 (UI 작업 15분).
- **M-2 (SignalFilter CLOSE bypass)**: ✅ 동의. 안전성 필수.
- **M-3 (warm-up)**: ✅ 동의. 전략이 warm-up 중임을 StrategyCard에 표시하면 UX 향상. "준비 중 (42/100 캔들)" 표시.
- **M-4 (CoinSelector F7)**: ✅ 동의하지만 LOW 우선순위로 동의.
- **M-5 (마켓 임팩트)**: ⚠️ 조건부. Engineer와 동의: 파라미터 캘리브레이션 필요.
- **M-6 (DrawdownMonitor peakEquity 영속성)**: ✅ 동의. DrawdownChart에 "기록 최고치" 라인 표시에 활용 가능.
- **M-7 (상관관계)**: ⚠️ 조건부. 향후 라운드로 이관 적절. UI에서 히트맵 구현은 recharts로 가능하지만 복잡도 높음.

### LOW 항목들
- ✅ 전부 동의. 특히 LOW-1(resume StrategyRouter)은 Engineer H-2와 동일하므로 HIGH로 상향.

---

## Engineer 제안서 리뷰

### C-1: Module-level Router Singleton
- **판정: ✅ 동의**
- FE에 직접 영향 없음 (API 응답 형식 불변). 테스트 안정성 개선에 동의.
- Engineer 질문에 답변: 라우트 팩토리 수정 시 FE 영향 없음 확인.

### C-2: BacktestStore 무제한 메모리 성장
- **판정: ✅ 동의**
- BacktestListPanel에서 결과 목록을 표시하는데, 자동 삭제 시 사용자에게 알림이 필요. "최대 50개 결과 보관. 오래된 결과는 자동 삭제됩니다." 안내 문구 추가.
- **FE 추가 작업**: BacktestListPanel에 경고 배너 (조건부, 결과가 45개 이상일 때). 약 15분.

### H-1: _lastTickerEmit Map cleanup
- **판정: ✅ 동의**
- FE 영향 없음.

### H-2: resume() StrategyRouter 연동
- **판정: ✅ 동의 (Trader와 동일하게 HIGH 이상으로 상향 지지)**
- FE BotControlPanel의 resume 버튼이 호출하는 API의 동작이 변경됨. 사용자 입장에서는 "resume 후 레짐에 맞는 전략만 활성화됨"이 더 올바른 동작.

### H-3: OrphanOrderCleanup unref() + 활성화
- **판정: ⚠️ 조건부 동의**
- Trader와 동의: SL/TP 주문 보호 화이트리스트 필요. 또한 활성화 시 FE에서 "고아 주문 정리됨" 로그가 RiskAlertBanner 또는 토스트로 표시되어야 사용자가 인지 가능.

### H-4: TickerAggregator timer unref()
- **판정: ✅ 동의**
- FE 영향 없음.

### H-5: TournamentRoutes 캡슐화 위반
- **판정: ✅ 동의**
- FE 영향 없음.

### H-6: getStatus() getSignal() try-catch
- **판정: ✅ 동의 (FE 관점에서 중요)**
- `GET /api/bot/status`가 500을 반환하면 대시보드 전체가 에러 상태. useBotStatus 훅이 에러를 잡지만, 사용자에게 "상태 조회 실패" 표시.
- Engineer 질문에 답변: `lastSignal` 필드는 StrategyHub의 StrategyCard에서 사용됨. `null` fallback 시 "최근 시그널 없음"으로 표시되므로 문제 없음.

### M-1: lot step 하드코딩 제거
- **판정: ✅ 동의**
- 실거래 필수. FE에서 주문 UI(수동 주문 기능이 있다면)에 lot step 정보가 필요할 수 있으나, 현재는 수동 주문 UI가 없으므로 FE 영향 없음.

### M-2: Paper 모드 trading-mode 전환 보호
- **판정: ✅ 동의**
- FE TradingModeToggle에서 live 전환 시 이미 ConfirmDialog가 있음. BE에서도 이중 보호는 좋은 방어 깊이(defense in depth).

### M-3: StateRecovery + OrphanOrderCleanup 활성화
- **판정: ⚠️ 조건부 동의**
- Trader와 동의: Paper 모드 검증 먼저. FE에서 "이전 세션에서 복구된 포지션" 알림이 있으면 UX 향상.

### M-4~M-6: parseFloat 제거, express.json limit
- **판정: ✅ 동의**
- FE 영향 없음.

### M-7: BotSession stats 업데이트
- **판정: ✅ 동의**
- FE PerformanceTabs에서 세션 통계를 표시하는데, 현재 데이터가 빈 상태로 표시됨. 이 수정으로 analytics 페이지가 실질적으로 작동하게 됨.

### M-8: Snapshot 주기적 생성
- **판정: ✅ 동의 (FE 관점에서 HIGH)**
- EquityCurveChart가 실거래에서 빈 차트를 표시하는 것은 심각한 UX 문제. 사용자가 "에쿼티 커브가 안 나옴"이라고 인식하면 시스템 신뢰도 하락.
- Snapshot 주기: 30초가 이상적이나, 1분도 괜찮음. FE `useAnalytics` 폴링(내 R8-M4)과 연계하면 실시간 에쿼티 커브 표시 가능.
- **우선순위 상향 요청**: M-8 → HIGH. EquityCurveChart는 대시보드의 핵심 컴포넌트.

### Deferred 재평가
- T3-9 (Socket.io 인증): T1 승격 동의. FE 수정은 socket.ts 1파일, 5줄 미만.
- T3-10 (InstrumentCache): T1 승격 동의.
- T3-15 (positionSide): deferred 유지 동의.

---

## 종합 의견

### 3-way 합의 가능 항목 (3/3 동의)
1. **resume() StrategyRouter 연동** — Trader LOW-1 + Engineer H-2 + UI 동의
2. **RiskEngine reduceOnly bypass** — Trader H-5 + Engineer 동의 + UI 동의
3. **EmergencyStopDialog Escape + 포커스 트랩** — UI C-1 + Trader/Engineer 동의
4. **에러 토스트 persistent** — UI C-2 + Trader 동의 + Engineer 동의
5. **PositionManager 전략 매핑** — Trader C-3 + Engineer 동의 + UI 동의
6. **Router Singleton 수정** — Engineer C-1 + Trader/UI 동의
7. **BacktestStore LRU** — Engineer C-2 + Trader/UI 동의
8. **getStatus() try-catch** — Engineer H-6 + Trader/UI 동의
9. **SignalFilter CLOSE bypass** — Trader M-2 + Engineer/UI 동의
10. **useSocket state 분리** — UI H-1 + Trader/Engineer 동의
11. **폴링 표준화** — UI H-3, H-8 + 전원 동의

### 2/3 동의 항목 (이견 존재)
1. **decimal.js 마이그레이션** — Trader: CRITICAL / Engineer: deferred / UI: 조건부 → 모니터링 우선 접근으로 타협 가능
2. **멀티심볼 라우팅** — Trader: CRITICAL / Engineer: 조건부 (Phase 1만) / UI: 동의 → Phase 1 접근으로 타협
3. **Snapshot 생성** — Engineer: MEDIUM / UI: HIGH 상향 요청 / Trader: 동의 → HIGH로 상향 타협 가능

### FE 총 예상 작업량
- 내 R8 제안 23개: ~8.5h
- Trader 제안 대응 FE 작업: ~3h (전략별 심볼 표시, 펀딩비 표시, Sortino 표시)
- Engineer 제안 대응 FE 작업: ~0.5h (BacktestStore 경고, getStatus fallback)
- **총: ~12h**
