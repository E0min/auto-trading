# Round 8 Proposal: 코드베이스 재분석 -- 새 개선과제 발굴

> **Author**: UI/UX Agent
> **Date**: 2026-02-16
> **Scope**: 프론트엔드 전체 코드베이스 재분석 (42개 파일, 14개 훅, 6개 라이브러리)
> **Context**: Round 7 완료 후 (81/89 done, 91%), 8건 deferred

---

## 분석 요약

Round 1~7에 걸쳐 프론트엔드는 매우 성숙한 상태에 도달했다. 디자인 토큰 체계, 적응형 폴링, 3-way 상태 시각화, 확인 다이얼로그, Socket ref-count 등 핵심 인프라가 갖춰져 있다. 그러나 코드베이스를 처음부터 재분석한 결과, 아래 **6개 카테고리**에서 **23개의 새로운 개선 과제**를 발견했다.

### 카테고리별 요약

| 카테고리 | 발견 수 | CRITICAL | HIGH | MEDIUM | LOW |
|---------|--------|----------|------|--------|-----|
| A. 데드 코드 / 미사용 코드 | 3 | 0 | 1 | 2 | 0 |
| B. 성능 / 메모이제이션 | 4 | 0 | 2 | 2 | 0 |
| C. 접근성 / 키보드 | 4 | 1 | 2 | 1 | 0 |
| D. 에러 처리 / 상태 | 3 | 1 | 1 | 1 | 0 |
| E. 반응형 / 모바일 | 3 | 0 | 2 | 1 | 0 |
| F. UX 완성도 / 일관성 | 6 | 0 | 3 | 2 | 1 |
| **합계** | **23** | **2** | **11** | **9** | **1** |

---

## 발견 사항

### A. 데드 코드 / 미사용 코드

#### A-1. StrategyPanel.tsx 완전 미사용 [MEDIUM]
- **파일**: `frontend/src/components/StrategyPanel.tsx` (298줄)
- **근거**: `page.tsx`에서 `import`하지 않음. StrategyHub가 R3에서 대체한 레거시 컴포넌트. `StrategyPanel`은 `StrategyHub + StrategyCard + StrategyDetail`로 분리 리팩토링되었으나, 원본 파일이 삭제되지 않았다.
- **영향**: 번들에는 포함되지 않지만(tree-shaken), 코드베이스를 탐색하는 개발자를 혼란시킴.
- **제안**: 파일 삭제 또는 `@deprecated` 주석 + 향후 정리.

#### A-2. ClientGate.tsx 미사용 [MEDIUM]
- **파일**: `frontend/src/components/ClientGate.tsx` (22줄)
- **근거**: `page.tsx`, `layout.tsx`, `backtest/page.tsx`, `tournament/page.tsx` 어디에서도 import 안 됨. 모든 페이지가 `'use client'`로 직접 선언.
- **영향**: 미미하지만 불필요한 파일.
- **제안**: 삭제 또는 필요 시점까지 보관.

#### A-3. MarketRegimeIndicator.tsx 대시보드에서 미사용 [HIGH]
- **파일**: `frontend/src/components/MarketRegimeIndicator.tsx` (86줄)
- **근거**: `page.tsx`에서 import 안 됨. `MarketIntelligence` 헤더에 동일한 레짐 표시 로직이 인라인으로 중복 구현됨 (pending badge, cooldown badge, transition badge -- MarketIntelligence.tsx 60~102줄과 MarketRegimeIndicator.tsx 59~82줄이 거의 동일).
- **영향**: 코드 중복. 두 곳에서 레짐 표시 로직을 별도 유지보수해야 함.
- **제안**: (1) MarketRegimeIndicator를 삭제하고 MarketIntelligence 헤더에 통합된 것으로 확정하거나, (2) 공통 레짐 상태 표시 서브컴포넌트를 추출해 둘 다 사용하게 리팩토링.

---

### B. 성능 / 메모이제이션

#### B-1. useSocket setState가 매 이벤트마다 새 객체 생성 [HIGH]
- **파일**: `frontend/src/hooks/useSocket.ts` 55~178줄
- **근거**: `handleSignalGenerated`, `handleCircuitBreak` 등 모든 핸들러가 `setState(prev => ({ ...prev, ... }))` 패턴을 사용. 각 이벤트가 새로운 전체 state 객체를 생성하므로, 빈번한 시그널/리스크 이벤트 시 의존 컴포넌트 전체 리렌더.
- **영향**: 봇이 활성 상태에서 시그널이 연속 발생하면 대시보드 전체가 리렌더될 수 있음. 특히 `signals` 배열과 `riskEvents` 배열은 서로 무관한데 하나가 바뀌면 전체 state가 바뀜.
- **제안**:
  - (a) `signals`와 `riskEvents`를 별도 `useState`로 분리하거나,
  - (b) `useReducer`로 전환하여 변경된 슬라이스만 업데이트하거나,
  - (c) `useSyncExternalStore` 패턴으로 세분화된 구독 제공.

#### B-2. useMarketIntelligence Socket 리스너에 named handler 미사용 [MEDIUM]
- **파일**: `frontend/src/hooks/useMarketIntelligence.ts` 68~118줄
- **근거**: cleanup에서 `socket.off(SOCKET_EVENTS.REGIME_CHANGE)` 등으로 **이벤트명만** 전달하여 해제함. 이는 해당 이벤트의 **모든** 리스너를 제거하므로, useSocket에서 같은 이벤트를 구독 중이면 **다른 훅의 리스너까지 제거**될 수 있음.
- **비교**: `useSocket.ts`에서는 named handler 패턴(`socket.off(EVENT, handler)`)으로 올바르게 구현됨.
- **영향**: 드물지만, MarketIntelligence가 unmount되면 useSocket의 `REGIME_CHANGE` 리스너도 함께 제거될 수 있음. 실제로는 single-page이므로 거의 발생하지 않지만, 향후 페이지 구조 변경 시 버그 유발.
- **제안**: `useSocket.ts`와 동일하게 named handler + off(event, handler) 패턴으로 수정.

#### B-3. BacktestPage equityCurve 500포인트 다운샘플링 -- 클라이언트 CPU 부담 [MEDIUM]
- **파일**: `frontend/src/app/backtest/page.tsx` 40~51줄
- **근거**: `useMemo`로 equityCurve가 500개 초과 시 클라이언트에서 다운샘플링. 백엔드 API (`backtestApi.getEquityCurve`)에 `maxPoints` 파라미터가 이미 있으므로 서버에서 처리 가능.
- **영향**: 대량 백테스트(수천 개 포인트) 시 불필요한 클라이언트 연산.
- **제안**: `backtestApi.getEquityCurve(id, 500)` 호출로 서버 사이드 다운샘플링 활용.

#### B-4. PerformanceAnalytics 폴링이 useAdaptivePolling을 사용하지 않음 [HIGH]
- **파일**: `frontend/src/hooks/usePerformanceAnalytics.ts` 62~71줄
- **근거**: 30초 고정 폴링(`setInterval(fetchData, 30000)`) 사용. `useAdaptivePolling`이 프로젝트 전체의 표준 폴링 패턴인데, 이 훅만 독자적으로 구현. 탭 비가시 시에도 30초마다 API 호출 발생.
- **영향**: 불필요한 API 호출, 배터리/네트워크 낭비. 다른 훅(botStatus, positions, trades, health, marketIntel)은 모두 적응형 폴링 사용.
- **제안**: `useAdaptivePolling(fetchData, 'marketIntel', botState)`로 전환. 또는 새 configKey 'analytics' 추가.

---

### C. 접근성 / 키보드

#### C-1. EmergencyStopDialog Escape 키 미지원 + 포커스 트랩 없음 [CRITICAL]
- **파일**: `frontend/src/components/EmergencyStopDialog.tsx` 33~105줄
- **근거**: `ConfirmDialog`는 Escape 키 핸들링을 갖추고 있지만 (`useEffect` + `handleKeyDown`), `EmergencyStopDialog`는 별도 구현이며 Escape 키 핸들링이 없다. 또한 두 다이얼로그 모두 **포커스 트랩**(focus trap)이 없어, Tab 키로 모달 바깥의 요소에 도달 가능.
- **영향**: 실거래 중 긴급 상황에서 키보드 사용자가 모달을 닫을 수 없음. 모달 뒤의 요소와 상호작용할 수 있어 의도하지 않은 동작 가능.
- **제안**:
  - EmergencyStopDialog에 Escape 키 핸들링 추가
  - 양쪽 다이얼로그에 포커스 트랩 구현 (모달 열릴 때 첫 번째 interactive 요소에 포커스, Tab 키가 모달 내부에서 순환)
  - 또는 `@headlessui/react`의 Dialog 사용 고려

#### C-2. StrategyCard 내부 div onClick -- 접근성 안티패턴 [HIGH]
- **파일**: `frontend/src/components/strategy/StrategyCard.tsx` 102~125줄
- **근거**: toggle 역할의 `<div>`에 `onClick`만 부여. `role="switch"`, `aria-checked` 속성은 있지만 `tabIndex`, `onKeyDown`(Enter/Space) 핸들러가 없음. 또한 `<div>`가 `<button>` 안에 중첩되어 있어 HTML 규격 위반 (interactive element inside interactive element).
- **영향**: 키보드 사용자가 전략 활성화/비활성화를 수행할 수 없음.
- **제안**: toggle을 별도 `<button>`으로 분리하고, 부모 `<button>`에서 `stopPropagation` 대신 구조적 분리. 또는 `<label>` + hidden checkbox 패턴.

#### C-3. 테이블 thead에 scope 속성 없음 [MEDIUM]
- **파일**: 모든 테이블 컴포넌트 (`PositionsTable`, `TradesTable`, `SymbolRegimeTable`, `StrategySymbolMap`, 토너먼트 테이블 등)
- **근거**: `<th>` 태그에 `scope="col"` 속성이 없음. 스크린리더가 셀과 헤더의 관계를 올바르게 파악하지 못함.
- **제안**: 글로벌 CSS에서 `th { scope: col; }`은 불가하므로, 각 `<th>`에 `scope="col"` 추가. 또는 공통 테이블 컴포넌트 추출 시 자동 적용.

#### C-4. DrawdownChart 접기/펼치기 버튼에 aria-expanded 없음 [HIGH]
- **파일**: `frontend/src/components/DrawdownChart.tsx` 52~57줄
- **근거**: 텍스트 기반 "접기"/"펼치기" 토글이지만 `aria-expanded` 속성이 없음. 동일한 패턴이 `MarketIntelligence`, `TradesTable`에서도 사용됨.
- **영향**: 스크린리더 사용자가 현재 섹션이 열려있는지 닫혀있는지 알 수 없음.
- **제안**: 모든 collapsible 섹션에 `aria-expanded={!collapsed}` + `aria-controls="panel-id"` 추가.

---

### D. 에러 처리 / 상태

#### D-1. 대시보드 에러 토스트가 5초 자동 소멸 -- 긴급 상황에서 정보 손실 [CRITICAL]
- **파일**: `frontend/src/app/page.tsx` 109줄, 126줄
- **근거**: `handleClosePosition`과 `handleResetDrawdown` 실패 시 `setTimeout(() => setErrorMsg(null), 5000)` -- 5초 후 자동 소멸. 실거래 중 포지션 청산 실패는 즉각적 후속 조치가 필요한데, 에러 메시지가 사라져 사용자가 놓칠 수 있음.
- **영향**: 실거래 중 포지션 청산 실패 에러를 놓칠 위험. 특히 모바일에서 화면 하단의 작은 토스트를 보지 못할 가능성.
- **제안**:
  - 에러 severity에 따라 자동 소멸 여부 결정 (주문 실패 = persistent until dismissed)
  - 토스트에 닫기 버튼 추가
  - 음향/진동 피드백 옵션 (선택적)
  - T3-11 (Toast 알림 시스템)과 통합 검토

#### D-2. useTournament 에러 메시지 영어 [HIGH]
- **파일**: `frontend/src/hooks/useTournament.ts` 20줄, 38줄, 49줄, 59줄
- **근거**: `'Failed to fetch leaderboard'`, `'Failed to start tournament'`, `'Failed to stop tournament'`, `'Failed to reset tournament'` -- 다른 모든 훅(`useBotStatus`, `usePositions`, `useTrades`)은 한국어 에러 메시지를 사용하는데 이 훅만 영어.
- **영향**: 사용자에게 표시될 수 있는 에러 메시지의 언어 불일치.
- **제안**: 한국어로 통일: `'리더보드 조회 실패'`, `'토너먼트 시작 실패'`, `'토너먼트 정지 실패'`, `'토너먼트 초기화 실패'`.

#### D-3. useAnalytics가 useAdaptivePolling을 사용하지 않음 [MEDIUM]
- **파일**: `frontend/src/hooks/useAnalytics.ts` 31~33줄
- **근거**: `useEffect` + `fetchAnalytics()`만 사용. sessionId가 바뀔 때만 데이터를 가져오고, 이후 폴링 없음. 봇이 실행 중이면 에쿼티 커브가 실시간으로 업데이트되어야 하는데, 수동 새로고침 없이는 갱신 안 됨.
- **영향**: 사용자가 에쿼티 커브/세션 통계를 보면서 실시간 변화를 확인할 수 없음.
- **제안**: botState를 파라미터로 받아 `useAdaptivePolling` 적용. running 시 10~30초 간격.

---

### E. 반응형 / 모바일

#### E-1. 대시보드 헤더 모바일에서 넘침 [HIGH]
- **파일**: `frontend/src/app/page.tsx` 155~225줄
- **근거**: 헤더가 `flex items-center justify-between`으로 한 줄에 배치되지만, 모바일(< 768px)에서는 좌측(로고 + 모드 토글 + 백테스트/토너먼트 링크)과 우측(SystemHealth + BotControlPanel)이 수평 공간을 초과하여 넘침.
- **영향**: 모바일에서 봇 제어 버튼이 화면 밖으로 밀려나거나 잘림.
- **제안**:
  - `flex-wrap` 또는 모바일에서 2줄 레이아웃으로 변경
  - `md:` breakpoint에서 수평 배치, 그 이하에서는 수직 스택

#### E-2. AccountOverview 4열 그리드 모바일에서 밀집 [HIGH]
- **파일**: `frontend/src/components/AccountOverview.tsx` 15줄
- **근거**: `grid grid-cols-2 md:grid-cols-4` -- 모바일에서 2열이지만, 총 자산의 `text-3xl` 숫자가 좁은 공간에서 잘릴 수 있음. 큰 금액($1,234,567.89)에서는 overflow 발생.
- **영향**: 가장 중요한 정보인 총 자산이 모바일에서 읽기 어려움.
- **제안**: 총 자산을 모바일에서 `col-span-2`로 전체 너비 차지. 또는 금액에 따른 동적 font-size.

#### E-3. RegimeFlowMap 4열 그리드 모바일에서 깨짐 [MEDIUM]
- **파일**: `frontend/src/components/market-intel/RegimeFlowMap.tsx` 25~29줄
- **근거**: `grid-cols-[140px_1fr_1fr_1fr]` 하드코딩. grace 전략이 있을 때 4열 고정 레이아웃이며, 모바일에서 `140px` 최소 너비 + 3개 `1fr`이 매우 좁아짐.
- **영향**: 전략 이름이 truncate되어 식별 불가. MarketIntelligence 내부 탭이라 모바일에서 접근 빈도는 낮지만, 사용 시 UX 저하.
- **제안**: 모바일에서 수직 스택 레이아웃으로 전환 (`lg:grid-cols-[140px_1fr_1fr_1fr]`).

---

### F. UX 완성도 / 일관성

#### F-1. 봇 중지 시 확인 다이얼로그 없음 [HIGH]
- **파일**: `frontend/src/components/BotControlPanel.tsx` 98~106줄
- **근거**: `onStart`(Live 모드일 때)에는 `ConfirmDialog`가 있지만, `onStop`에는 없음. 포지션이 열려 있는 상태에서 봇 정지는 신규 주문 중단 + 리스크 관리 중단을 의미하므로 확인이 필요.
- **영향**: 실수로 봇 정지 시 열린 포지션이 방치됨.
- **제안**: 포지션이 1개 이상일 때 "현재 {n}개 포지션이 열려있습니다. 봇을 정지하면 자동 관리가 중단됩니다." 확인 다이얼로그 표시.

#### F-2. SignalFeed에서 strategy 이름 미번역 [HIGH]
- **파일**: `frontend/src/components/SignalFeed.tsx` 42줄
- **근거**: `{signal.strategy}` -- 원시 전략 이름(예: `MaTrendStrategy`)을 그대로 표시. `translateStrategyName()`이 `lib/utils.ts`에 있는데 미사용.
- **영향**: 한국어 UI에서 영어 전략 이름이 표시되어 일관성 저하. 다른 컴포넌트(StrategyHub, StrategyCard, StrategySymbolMap, 토너먼트)에서는 모두 번역됨.
- **제안**: `{translateStrategyName(signal.strategy)}` 적용.

#### F-3. 토너먼트 폴링이 3초 고정 -- useAdaptivePolling 미사용 [HIGH]
- **파일**: `frontend/src/hooks/useTournament.ts` 26~30줄
- **근거**: `setInterval(fetchLeaderboard, pollInterval)` -- 3초 고정. 탭이 비활성화되어도 3초마다 API 호출. 모든 다른 데이터 소스는 `useAdaptivePolling`으로 탭 비가시/봇 상태에 따라 폴링 주기 조절.
- **영향**: 토너먼트 페이지 열어놓고 다른 탭 작업 시 불필요한 API 트래픽.
- **제안**: `useAdaptivePolling` 적용. 또는 최소한 `visibilitychange` 감지하여 비가시 시 폴링 중단.

#### F-4. BacktestForm 심볼 입력 -- 수동 텍스트 입력만 가능 [MEDIUM]
- **파일**: `frontend/src/components/backtest/BacktestForm.tsx` 116~124줄
- **근거**: `<input type="text">` -- 사용자가 "BTCUSDT" 같은 심볼을 직접 타이핑. 오타 시 백테스트가 실패하거나 잘못된 데이터를 사용. Deferred 항목 T3-13과 관련.
- **영향**: 사용자 경험 저하, 오타로 인한 실패.
- **제안**: 프리셋 드롭다운(BTC, ETH, SOL, XRP 등 주요 심볼) + 커스텀 입력 병행. 또는 `datalist` HTML 요소로 자동완성.

#### F-5. EquityCurveChart와 BacktestEquityCurve가 동일 패턴 중복 [MEDIUM]
- **파일**: `frontend/src/components/EquityCurveChart.tsx` vs `frontend/src/components/backtest/BacktestEquityCurve.tsx`
- **근거**: 두 컴포넌트 모두 `LineChart` + `ResponsiveContainer` + 동일 스타일의 에쿼티 라인. 차이점은 데이터 타입(`EquityPoint` vs `BacktestEquityPoint`)과 X축 포맷뿐. 코드 80% 중복.
- **영향**: 차트 스타일 변경 시 두 곳 수정 필요.
- **제안**: 공통 `BaseEquityChart` 컴포넌트 추출, 데이터 변환은 각 소비자에서 처리.

#### F-6. TOOLTIP_STYLE 상수 3곳 중복 정의 [LOW]
- **파일**: `StrategyPerformance.tsx` 18~24줄, `SymbolPerformance.tsx` 18~24줄, `DailyPerformance.tsx` 19~25줄
- **근거**: `CHART_TOOLTIP_STYLE`이 `lib/chart-config.ts`에 이미 정의되어 있는데, analytics 3개 컴포넌트가 자체 `TOOLTIP_STYLE` 상수를 각각 정의. 값도 거의 동일(borderRadius 8 vs 6, padding 차이).
- **영향**: 스타일 불일치 가능성.
- **제안**: `CHART_TOOLTIP_STYLE` 통일 사용.

---

## 제안 사항 (우선순위 + 구현 난이도 + 예상 시간)

### CRITICAL (즉시 수행)

| ID | 제목 | 난이도 | 예상 시간 | 관련 파일 |
|----|------|--------|----------|----------|
| R8-C1 | EmergencyStopDialog Escape + 포커스 트랩 | 중 | 1h | `EmergencyStopDialog.tsx`, `ConfirmDialog.tsx` |
| R8-C2 | 에러 토스트 persistent 모드 + 닫기 버튼 | 하 | 30m | `page.tsx` |

### HIGH (이번 라운드 필수)

| ID | 제목 | 난이도 | 예상 시간 | 관련 파일 |
|----|------|--------|----------|----------|
| R8-H1 | useSocket state 분리 (signals/riskEvents 독립) | 중 | 1h | `useSocket.ts` |
| R8-H2 | useMarketIntelligence named handler 패턴 적용 | 하 | 20m | `useMarketIntelligence.ts` |
| R8-H3 | usePerformanceAnalytics -> useAdaptivePolling 전환 | 하 | 20m | `usePerformanceAnalytics.ts` |
| R8-H4 | 대시보드 헤더 모바일 반응형 | 중 | 45m | `page.tsx` |
| R8-H5 | AccountOverview 모바일 레이아웃 | 하 | 20m | `AccountOverview.tsx` |
| R8-H6 | 봇 중지 확인 다이얼로그 | 하 | 30m | `BotControlPanel.tsx` |
| R8-H7 | SignalFeed 전략명 번역 | 하 | 5m | `SignalFeed.tsx` |
| R8-H8 | useTournament 적응형 폴링 | 하 | 20m | `useTournament.ts` |
| R8-H9 | useTournament 에러 메시지 한국어 통일 | 하 | 5m | `useTournament.ts` |
| R8-H10 | StrategyCard toggle 접근성 수정 | 중 | 30m | `StrategyCard.tsx` |
| R8-H11 | collapsible 섹션 aria-expanded 일괄 추가 | 하 | 20m | `DrawdownChart.tsx`, `MarketIntelligence.tsx`, `TradesTable.tsx` |
| R8-H12 | MarketRegimeIndicator 중복 코드 정리 | 하 | 15m | `MarketRegimeIndicator.tsx` |

### MEDIUM (다음 라운드 가능)

| ID | 제목 | 난이도 | 예상 시간 | 관련 파일 |
|----|------|--------|----------|----------|
| R8-M1 | StrategyPanel.tsx 레거시 삭제 | 하 | 5m | `StrategyPanel.tsx` |
| R8-M2 | ClientGate.tsx 삭제 | 하 | 2m | `ClientGate.tsx` |
| R8-M3 | BacktestPage equityCurve 서버사이드 다운샘플링 | 하 | 15m | `backtest/page.tsx` |
| R8-M4 | useAnalytics 폴링 추가 | 하 | 20m | `useAnalytics.ts` |
| R8-M5 | th scope="col" 일괄 추가 | 하 | 20m | 전체 테이블 컴포넌트 |
| R8-M6 | RegimeFlowMap 모바일 대응 | 중 | 30m | `RegimeFlowMap.tsx` |
| R8-M7 | BacktestForm 심볼 프리셋 (T3-13 통합) | 중 | 45m | `BacktestForm.tsx` |
| R8-M8 | EquityCurveChart 공통 추출 | 중 | 45m | `EquityCurveChart.tsx`, `BacktestEquityCurve.tsx` |

### LOW

| ID | 제목 | 난이도 | 예상 시간 | 관련 파일 |
|----|------|--------|----------|----------|
| R8-L1 | TOOLTIP_STYLE 통일 | 하 | 10m | analytics 3개 파일 |

---

## Deferred 항목 재평가 (UX 관점 우선순위)

### T3-11: Toast 알림 시스템 (full 구현)
- **현재 상태**: `page.tsx`에 인라인 에러 토스트(309~312줄)가 있으나 primitive함.
- **UX 관점 우선순위**: **HIGH** -- R8-C2와 직결. 실거래 시 에러/성공/경고를 구분하는 체계적 토스트 시스템 필요. 현재 에러만 표시하고 성공(주문 체결, 포지션 청산)은 시각적 피드백 없음.
- **제안**: R8-C2(에러 토스트 개선)를 T3-11의 첫 단계로 구현. 향후 `react-hot-toast` 또는 자체 Toast 컨텍스트 도입.

### T3-12: 전략-레짐 호환성 매트릭스
- **현재 상태**: `RegimeFlowMap`의 하단에 5열 레짐 breakdown이 있지만, 전략별 호환 여부를 매트릭스로 보여주지 않음.
- **UX 관점 우선순위**: **MEDIUM** -- 전략 선택 시 "이 전략이 어떤 시장에서 작동하는가"를 한눈에 보여주는 매트릭스. StrategyHub의 레짐 필터와 조합하면 강력하지만, 현재 18개 전략 x 5개 레짐 = 90개 셀은 정보 과부하 가능.
- **제안**: StrategyHub 내 `전략 비교` 탭으로 구현. 호환 레짐에 체크마크, 비호환에 대시.

### T3-13: 백테스트 심볼 입력 프리셋
- **현재 상태**: 텍스트 입력만 가능 (R8-M7에서 발견).
- **UX 관점 우선순위**: **HIGH** -- 오타 방지가 실거래 준비도와 직결. 백엔드에서 지원 심볼 목록을 가져올 수 있다면 드롭다운, 아니면 하드코딩 프리셋.
- **제안**: R8-M7로 이번 라운드에 구현 가능.

### T3-14: 레버리지 표시 보완 (StrategyDetail, Tournament)
- **현재 상태**: PositionsTable에서는 `pos.leverage`가 표시되지만, StrategyDetail의 포지션 탭과 토너먼트의 포지션 테이블에서는 레버리지 미표시.
- **UX 관점 우선순위**: **LOW** -- 현재 레버리지는 거래소 계정 설정이므로 전략별로 다르지 않음. 정보성이지만 의사결정에 직접 영향 없음.
- **제안**: 다음 라운드로 이관. StrategyDetail과 Tournament에 레버리지 컬럼 추가 (5분 작업).

---

## 다른 에이전트에게 요청 사항

### Trader Agent에게
1. **봇 정지 시 포지션 처리 정책 확인**: R8-H6(봇 중지 확인 다이얼로그)에서 "포지션이 방치됨" 경고를 표시하는데, 실제로 봇 정지 후 포지션이 어떻게 관리되는지 확인 필요. SL/TP가 거래소 사이드에 남아있는지, 완전히 방치되는지에 따라 경고 문구가 달라져야 함.
2. **에러 severity 분류 기준**: R8-C2에서 에러를 persistent/auto-dismiss로 나누려면, 어떤 에러가 즉각 조치가 필요한지(주문 실패, API 연결 실패) vs 정보성인지(데이터 조회 지연) Trader 관점의 분류 필요.
3. **토너먼트 상태 변경 이벤트**: useTournament가 3초 폴링 중인데, 토너먼트 관련 Socket.io 이벤트가 백엔드에서 발행되는지 확인. 발행된다면 폴링 대신 실시간 업데이트 가능.

### Engineer Agent에게
1. **백테스트 지원 심볼 목록 API**: R8-M7(심볼 프리셋)에서 하드코딩 대신 동적으로 가져올 수 있는 API 필요. `GET /api/backtest/symbols` 또는 기존 exchangeClient에서 거래 가능 심볼 목록 제공.
2. **useAnalytics 폴링 대상 확인**: R8-M4에서 에쿼티 커브가 봇 실행 중 실시간 갱신되어야 하는데, Snapshot 모델이 실시간으로 생성되는 주기 확인. 이에 맞춰 폴링 간격 결정.
3. **Socket 이벤트 리스너 정리**: R8-H2에서 useMarketIntelligence의 socket.off 패턴이 위험하다고 지적했는데, 백엔드 Socket.io 이벤트 구독/해제 패턴에 대한 가이드라인 필요. named handler가 표준인지 확인.
4. **토너먼트 Socket 이벤트**: useTournament 폴링을 줄이려면 토너먼트 관련 이벤트(리더보드 변경, 전략 거래 체결 등) Socket.io 지원 여부 확인.

---

## 구현 순서 제안 (Sprint Plan)

총 23개 항목, 예상 총 시간: ~8.5h

### Phase 1: 안전성 + 접근성 (CRITICAL + HIGH 핵심) -- 3h
1. R8-C1: EmergencyStopDialog Escape + 포커스 트랩
2. R8-C2: 에러 토스트 persistent 모드
3. R8-H6: 봇 중지 확인 다이얼로그
4. R8-H10: StrategyCard toggle 접근성
5. R8-H11: collapsible 섹션 aria-expanded

### Phase 2: 성능 + 폴링 최적화 -- 2h
6. R8-H1: useSocket state 분리
7. R8-H2: useMarketIntelligence named handler
8. R8-H3: usePerformanceAnalytics 적응형 폴링
9. R8-H8: useTournament 적응형 폴링
10. R8-M4: useAnalytics 폴링

### Phase 3: 반응형 + 일관성 -- 2h
11. R8-H4: 대시보드 헤더 모바일
12. R8-H5: AccountOverview 모바일
13. R8-H7: SignalFeed 전략명 번역
14. R8-H9: useTournament 에러 한국어
15. R8-H12: MarketRegimeIndicator 정리
16. R8-M6: RegimeFlowMap 모바일

### Phase 4: 코드 정리 + 부가 기능 -- 1.5h
17. R8-M1: StrategyPanel 삭제
18. R8-M2: ClientGate 삭제
19. R8-M3: equityCurve 서버사이드 다운샘플링
20. R8-M5: th scope 일괄 추가
21. R8-M8: EquityCurveChart 공통 추출
22. R8-L1: TOOLTIP_STYLE 통일
23. R8-M7: 심볼 프리셋 (BE API 필요, 독립 수행 가능하면)
