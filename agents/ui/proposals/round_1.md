# Round 1 -- UI/UX 엔지니어 제안서

**분석 대상**: `D:\LEEYOUNGMIN\Github\auto trading\frontend\src\`
**분석 범위**: 25개 컴포넌트, 8개 훅, 3개 페이지, 4개 UI 프리미티브, 2개 타입 파일, 3개 유틸리티 모듈
**총 코드 라인**: 약 2,800줄 (TSX/TS)

---

## CRITICAL ISSUES (사용성에 심각한 문제)

### C1. Emergency Stop 버튼에 확인 다이얼로그 없음
- **파일**: `frontend/src/components/BotControlPanel.tsx:89-97`
- **심각도**: 치명적 -- 실거래 모드에서 실수로 긴급 정지를 누르면 모든 포지션이 즉시 청산됨
- **현재 상태**: `onEmergencyStop`이 확인 없이 직접 호출됨. `TradingModeToggle.tsx`에서는 `ConfirmDialog`를 사용하고 있지만, 그보다 훨씬 더 위험한 긴급 정지에는 확인 단계가 없음
- **수정안**: `ConfirmDialog`를 variant="danger"로 적용, "모든 포지션이 즉시 시장가로 청산됩니다. 계속하시겠습니까?" 메시지 표시

### C2. Risk 이벤트(서킷 브레이커, 드로다운 경고)가 사용자에게 전달되지 않음
- **파일**: `frontend/src/hooks/useSocket.ts:84-103` -- `riskEvents` 데이터를 수집하고 있음
- **파일**: `frontend/src/app/page.tsx:62-67` -- `riskEvents`가 반환되지만 **어디에도 렌더링되지 않음**
- **심각도**: 치명적 -- 서킷 브레이커 발동, 드로다운 경고/정지가 WebSocket으로 실시간 전파되지만 사용자가 대시보드를 보고 있어도 알 수 없음. `RiskStatusPanel`은 REST 폴링 데이터만 표시
- **수정안**:
  - 화면 상단에 토스트/알림 배너로 risk 이벤트를 실시간 표시
  - 서킷 브레이커 발동 시 화면 전체에 경고 오버레이
  - 브라우저 Notification API 연동으로 탭이 비활성화 상태에서도 알림

### C3. Socket.io 연결 해제 시 데이터 불일치 가능성
- **파일**: `frontend/src/hooks/useSocket.ts:105-108` -- unmount 시 `disconnectSocket()` 호출
- **파일**: `frontend/src/lib/socket.ts:7-31` -- 싱글턴 소켓이 `disconnectSocket()`으로 null 설정됨
- **문제**: `useSocket`이 언마운트되면 글로벌 소켓 인스턴스가 파괴됨. 다른 컴포넌트가 소켓에 의존하는 경우 데이터 수신 중단. React Strict Mode에서 double mount/unmount 시 소켓이 완전 파괴됨
- **수정안**: ref-counted 소켓 관리 또는 Context Provider 패턴으로 전환

### C4. 실거래/가상거래 모드 구분이 시각적으로 불충분
- **파일**: `frontend/src/app/page.tsx:110-114`, `frontend/src/components/TradingModeToggle.tsx:46-102`
- **문제**: 실거래 모드에서도 배경색이 동일한 `bg-zinc-950`. 실거래 중 발생할 수 있는 실제 자금 손실에 대한 시각적 경고가 부족. 헤더의 작은 토글만으로는 현재 모드를 즉각적으로 인지하기 어려움
- **수정안**:
  - 실거래 모드: 헤더에 빨간 배경 스트라이프 또는 `border-top: 3px solid red`
  - 지속적으로 보이는 "LIVE TRADING" 배지 또는 "PAPER MODE" 배지를 화면 상단 고정
  - 실거래 모드 전환 후 첫 화면에 "실제 자금이 사용됩니다" 경고 배너 5초간 표시

### C5. 에쿼티 커브 차트에 시간 범위 표시 오류
- **파일**: `frontend/src/components/EquityCurveChart.tsx:18`
- **문제**: X축이 `toLocaleTimeString`으로 시간만 표시 (시:분). 세션이 24시간 이상 지속되면 같은 시간이 반복되어 날짜 구분 불가. 데이터 포인트가 많으면 X축 라벨이 겹침
- **수정안**: 데이터 범위에 따라 날짜+시간 또는 날짜만 표시하는 adaptive formatter 적용

---

## HIGH-PRIORITY IMPROVEMENTS (트레이더 경험에 직접 영향)

### H1. 대시보드 레이아웃의 정보 우선순위가 잘못됨

**현재 순서** (page.tsx:155-213):
1. 봇 제어 패널
2. 전략 관리 (18개 전략 목록 -- 매우 긴 영역)
3. 계정 개요 + 리스크
4. 시장 레짐
5. 심볼별 레짐
6. 레짐별 추천 전략
7. 에쿼티 커브
8. 포지션 + 시그널
9. 거래 내역

**문제**: 트레이더에게 가장 중요한 정보(활성 포지션, 미실현 PnL, 리스크 상태)가 스크롤 3~4배 아래에 위치. 전략 관리 패널이 18개 전략을 나열하여 화면의 절반 이상을 차지하면서 핵심 정보를 밀어냄.

**수정 레이아웃 제안**:
```
+--------------------------------------------------+
| [Header: 봇 상태 | 모드 | 시스템 헬스]           |
+--------------------------------------------------+
| [봇 제어: 시작/정지/긴급정지] [시장 레짐 미니]    |
+--------------------------------------------------+
| [계정 총자산] [가용잔고] [미실현PnL] [리스크 게이지] |
+--------------------------------------------------+
| [에쿼티 커브 차트 -------- 2/3 폭] | [리스크 상태] |
+--------------------------------------------------+
| [활성 포지션 테이블 -------------- 전체 폭]       |
+--------------------------------------------------+
| [실시간 시그널 ---- 1/2] | [최근 거래 ----- 1/2] |
+--------------------------------------------------+
| [전략 관리 (접이식)] [레짐별 추천] [심볼 레짐]    |
+--------------------------------------------------+
```

### H2. 전략 패널의 "봇 시작 전 전략 선택" 워크플로우가 직관적이지 않음
- **파일**: `frontend/src/components/StrategyPanel.tsx:204-207`
- **문제**: "봇 시작 시 활성화할 전략을 선택하세요"라는 작은 텍스트 하나로 설명. 사용자가 전략을 선택한 후 스크롤을 올려 "시작" 버튼을 눌러야 함. 선택한 전략 수가 시작 버튼 근처에 표시되지 않음
- **수정안**:
  - BotControlPanel에 선택된 전략 수를 Badge로 표시: "시작 (3개 전략 선택됨)"
  - 전략을 하나도 선택하지 않으면 시작 버튼 비활성화 + 툴팁

### H3. 에쿼티 커브가 불필요하게 단순
- **파일**: `frontend/src/components/EquityCurveChart.tsx`
- **현재**: Line 2개 (equity + unrealized PnL)만 표시
- **누락 기능**:
  - Recharts `Area` 또는 gradient fill로 equity 영역 강조
  - ReferenceLine으로 초기 자본 기준선 표시
  - Brush 컴포넌트로 시간 범위 선택
  - 드로다운 영역 시각화 (고점 대비 하락 구간을 빨간 음영으로)
  - 주문 실행 시점을 수직선 또는 마커로 표시
  - Legend 컴포넌트 추가
  - Y축 도메인 자동 조정 (auto domain with padding)

### H4. PositionsTable에 핵심 기능 부재
- **파일**: `frontend/src/components/PositionsTable.tsx`
- **누락 기능**:
  - 수동 포지션 청산 버튼 없음 (수동 개입 불가)
  - PnL 퍼센트 표시 없음 (절대값만 표시)
  - 진입가 대비 현재가 변동률 없음
  - ROE (Return on Equity) 없음
  - 마진 비율 없음
  - 각 포지션의 전략 출처 정보 없음
  - 실시간 가격 업데이트 애니메이션 없음 (가격 변동 시 깜빡임 없음)

### H5. SignalFeed가 순수 리스트형으로 정보 밀도 낮음
- **파일**: `frontend/src/components/SignalFeed.tsx`
- **문제**: 각 시그널이 한 줄에 (뱃지, 심볼, 전략명, 신뢰도, 승인여부, 시간) 나열. rejectReason이 있어도 표시하지 않음 (`signal.rejectReason` 미사용)
- **수정안**:
  - 거부된 시그널에 `rejectReason` 툴팁 또는 expandable row 추가
  - 시그널 통계 요약 (최근 50개 중 승인/거부 비율) 상단 표시
  - 시그널 필터링 (전략별, 방향별, 승인/거부별)

### H6. 번호 포맷팅 불일치
- **파일**: `frontend/src/lib/utils.ts:4-12` (`formatCurrency`)
- **문제**: `formatCurrency`가 `toLocaleString('en-US')` 사용하여 쉼표 구분자 적용. 한국어 UI인데 영어 숫자 포맷 사용
- **파일**: `frontend/src/app/tournament/page.tsx:9-13` (`formatPnl`) -- 토너먼트 페이지에서 `formatCurrency` 대신 자체 `formatPnl` 함수 사용. lib/utils.ts의 `getPnlSign`, `getPnlColor`와 중복
- **수정안**: 모든 통화 표시를 일관되게 통일 (USDT 단위 명시, 소수점 자릿수 통일)

### H7. 모바일 반응형이 불완전
- **파일**: `frontend/src/app/page.tsx:103` -- `max-w-[1600px]` 컨테이너는 있지만 모바일 최적화 부족
- **문제**:
  - 테이블 컴포넌트 (`PositionsTable`, `TradesTable`)가 모바일에서 overflow-x-auto로 수평 스크롤만 제공. 좁은 화면에서 8-9열 테이블은 사용 불가
  - 헤더 영역 (`page.tsx:105-153`)에서 모드 토글 + 내비게이션 링크 + SystemHealth가 한 줄에 있어 768px 미만에서 레이아웃 깨짐
  - 전략 패널의 3단 필터 버튼이 좁은 화면에서 줄바꿈되면 여백 부족
- **수정안**:
  - 테이블은 모바일에서 카드 리스트로 변환
  - 헤더를 모바일에서 2줄로 분리
  - 중요 정보를 모바일 first 순서로 재배치

### H8. 실시간 데이터 갱신 간격이 비효율적
- **파일들**: `useBotStatus.ts:22` (5초), `usePositions.ts:13` (5초), `useTrades.ts:7` (10초), `useHealthCheck.ts:7` (30초), `useTournament.ts:7` (3초)
- **문제**:
  - 봇이 중지 상태일 때도 5초마다 상태/포지션 폴링 -- 불필요한 네트워크 부하
  - Socket.io로 `POSITION_UPDATED` 이벤트를 이미 수신하는데 `usePositions`가 별도로 5초 폴링
  - `useAnalytics`는 폴링 없이 한 번만 fetch -- 세션 진행 중에도 equity curve가 갱신되지 않음
- **수정안**:
  - 봇 상태에 따라 adaptive polling: running 시 3초, idle 시 30초
  - Socket 이벤트 수신 시 REST 폴링 스킵 (dedup)
  - `useAnalytics`에 30초 폴링 추가 (세션 활성 시)

---

## ENHANCEMENT IDEAS (장기 개선)

### E1. 누락된 시각화 컴포넌트

| 시각화 | 설명 | 우선순위 |
|--------|------|----------|
| Drawdown Chart | 고점 대비 하락률을 시간축으로 표시하는 Area 차트 (빨간 음영) | 높음 |
| P&L Heatmap | 일별/시간별 수익을 색상 매트릭스로 표시 (GitHub 잔디밭 스타일) | 중간 |
| Strategy Correlation | 전략 간 수익 상관관계 히트맵 | 낮음 |
| Win/Loss Streak Chart | 연속 승패를 막대 차트로 시각화 | 중간 |
| Position Size History | 시간에 따른 포지션 크기 변화 추적 | 낮음 |
| Risk Gauge Dashboard | 서킷 브레이커, 드로다운, 노출도를 게이지 차트로 통합 표시 | 높음 |
| Volume Profile | 심볼별 거래량 히스토그램 | 낮음 |
| Strategy Performance Comparison | 레이더/스파이더 차트로 전략별 (승률, 샤프, PF 등) 비교 | 중간 |

### E2. 키보드 단축키 시스템
- 현재: 키보드 단축키 전무 (ConfirmDialog의 ESC만 유일)
- 제안:
  - `Space` -- 봇 시작/정지 토글
  - `P` -- 일시정지/재개
  - `Ctrl+E` -- 긴급 정지 (2단계 확인)
  - `1/2/3` -- 대시보드/백테스트/토너먼트 페이지 전환
  - `F` -- 필터 패널 토글
  - `R` -- 데이터 새로고침
  - 화면 하단에 `?` 키로 단축키 안내 모달

### E3. 알림/노티피케이션 센터
- 현재: 어떤 형태의 알림도 없음
- 제안:
  - 화면 우상단에 벨 아이콘 + 뱃지 카운터
  - 알림 유형: 시그널 생성, 주문 체결, 리스크 경고, 서킷 브레이커, 레짐 변경
  - 알림 히스토리 드로어 (슬라이드 패널)
  - 브라우저 Notification API + Web Audio API (경고 사운드)
  - 중요도별 분류: Critical (빨강), Warning (주황), Info (파랑)

### E4. 설정/환경설정 페이지
- 현재: 없음
- 제안 항목:
  - 폴링 간격 커스터마이즈
  - 알림 on/off (유형별)
  - 차트 기본 설정 (기간, 표시 항목)
  - 통화 표시 형식 (USDT/USD)
  - 다크/라이트 테마 (현재 다크 only)
  - 리스크 파라미터 수정 UI (현재 `botApi.updateRiskParams` API는 있으나 UI 없음)

### E5. 다중 세션 비교 기능
- 현재: `useAnalytics`가 단일 sessionId만 지원
- 제안: 여러 세션의 에쿼티 커브를 겹쳐 비교하는 뷰 (세션 셀렉터 + 오버레이 차트)

### E6. 백테스트 페이지 개선
- **전략 파라미터 커스터마이즈**: `BacktestForm.tsx:74`에서 `selectedStrategy?.defaultConfig`를 그대로 전송. 사용자가 전략별 파라미터를 수정할 UI 없음
- **결과 비교**: 여러 백테스트 결과를 나란히 비교하는 뷰 없음
- **Monte Carlo 시뮬레이션** 결과 시각화
- **최적화 파라미터 그리드** 시각화

### E7. 토너먼트 페이지 한국어 불일치
- **파일**: `frontend/src/app/tournament/page.tsx`
- 대시보드/백테스트 페이지는 완전 한국어 UI인데, 토너먼트 페이지는 영어 혼용:
  - "Strategy Tournament" (L110), "TOURNAMENT MODE" (L112)
  - "Start"/"Stop"/"Reset" (L133-147)
  - "Status", "Strategies", "Initial Balance", "Started" (L154-158)
  - "Leaderboard" (L171), "Equity", "PnL", "Unrealized", "Positions" (L187-191)
  - "Open Positions", "Recent Trades" (L237, L274)
  - "No data available" (L313)
- 일관성을 위해 모두 한국어로 통일 필요

---

## 페이지별 상세 리뷰

### 1. 대시보드 (`app/page.tsx`)

#### Layout & Architecture
- **L103**: `max-w-[1600px]`은 4K 모니터에서 좌우 여백이 과도. 트레이딩 터미널은 보통 화면 전체 사용 (max-w-full 또는 max-w-[1920px])
- **L91-100**: 초기 로딩 조건이 `botLoading && positionsLoading`으로 AND 조건 -- 둘 중 하나만 완료되어도 불완전한 데이터로 렌더링 시작. OR 조건이 더 안전
- **L155**: `space-y-4` 단일 열 레이아웃으로 모든 컴포넌트가 수직 스택됨. 2-3열 그리드 레이아웃이 정보 밀도를 높일 수 있음
- **L186**: MarketRegimeIndicator가 REST 폴링 + Socket 데이터를 `??` 연산자로 fallback. 우선순위가 명확하지만, Socket 데이터가 한 번도 안 온 경우 null이므로 항상 REST로 fallback

#### Data Flow Issues
- **L31-34**: `allStrategies`를 `useEffect`에서 한 번만 fetch. 봇이 실행 중일 때 전략 목록이 변경되면 반영되지 않음
- **L37**: `.catch(() => {})` -- 에러 무시. 최소한 console.error 또는 에러 상태 설정 필요
- **L53-55**: `handleStartBot`이 `selectedStrategiesRef.current`를 사용. ref이므로 사용자가 전략을 선택해도 "시작" 버튼의 UI가 업데이트되지 않음 (선택 수 표시 불가)

### 2. BotControlPanel (`components/BotControlPanel.tsx`)

- **L50-98**: 카드 높이가 내용에 비해 작음 (한 줄). 봇 상태 정보 (업타임, 활성 전략 수, 현재 세션 ID)를 추가 표시하면 좋음
- **L75**: pause/resume 토글이 단일 버튼에 상태에 따라 라벨 변경 -- `loadingAction === 'pause'`가 resume 동작에도 사용되어 의미적 불일치
- **L89-97**: Emergency stop 버튼이 다른 버튼들과 같은 크기(`size="sm"`)로 시각적 차별화 부족. 더 크거나 경고색 강화 필요
- **L94**: `disabled={!running}` -- 봇이 실행 중이 아니면 비활성화는 맞지만, 비활성화된 상태에서도 빨간 배경이 유지되어 시각적 혼란

### 3. AccountOverview (`components/AccountOverview.tsx`)

- **L15-24**: 4개 카드가 하드코딩된 배열. 각 카드에 변화량(delta) 표시 없음 (이전 값 대비 증감)
- **L17**: "$" 기호를 하드코딩. USDT 거래소인데 "$" 표시는 혼란 유발 가능 -- "USDT" 접미사가 더 정확
- **L22**: unrealized PnL의 퍼센트 표시 없음 (총 자산 대비 미실현 손익 비율)
- 미포함 정보: 일간 수익, 오늘의 거래 수, 승/패 카운트

### 4. RiskStatusPanel (`components/RiskStatusPanel.tsx`)

- **L15-16**: `parseFloat`로 문자열을 숫자로 변환 -- String 기반 아키텍처와 일관적이지만, 변환 실패 시 0으로 fallback하여 "정상" 표시 가능
- **L38**: 드로다운 임계치가 하드코딩 (5%, 3%). 이 값은 서버의 `DrawdownMonitor` 설정과 동기화되어야 하지만 클라이언트에 하드코딩
- **L45**: `drawdownPct * 10`으로 프로그레스바 폭 계산 -- 10%가 100%로 표시됨. 실제 maxDrawdown 설정값 기반으로 비율 계산이 정확
- **L76-79**: 드로다운 halt 상태가 Badge 하나로만 표시. 이것은 "거래가 완전히 중단된" 상태이므로 훨씬 더 큰 시각적 경고 (전체 패널 빨간 테두리, 깜빡임 등) 필요

### 5. StrategyPanel (`components/StrategyPanel.tsx`)

- **L59-73**: 3단 필터 (카테고리, 방향, 변동성)가 동시에 적용. AND 논리이므로 "가격행동 + 상승장 + 고변동성"처럼 조합하면 결과 0개가 빈번. 필터링 결과가 비어있을 때의 UX가 부족
- **L137-202**: 필터 버튼 3줄이 시각적으로 반복적이고, 각 줄의 역할 구분이 불명확 (색상으로만 구분: 파랑, 주황, 보라). 라벨 접두사 ("카테고리:", "방향:", "변동성:")를 추가해야 함
- **L219-285**: 전략 목록이 스크롤 제한 없이 전부 표시. 18개 전략이 모두 보이면 약 600px 이상의 높이 차지. max-height + overflow-y-auto 적용 필요
- **L253**: 전략명이 영문 클래스명 그대로 표시 (`strategy.name`). 한 줄 아래에 한국어 번역 (`translateStrategyName`)이 있지만, 주/부 텍스트가 반대로 되어야 함 -- 한국어 UI에서는 한국어 이름이 주, 영문이 부
- **L265**: `regimes.slice(0, 3)` -- 4개 이상의 target regime이 있으면 잘림. 잘린다는 표시 (+N) 없음

### 6. MarketRegimeIndicator (`components/MarketRegimeIndicator.tsx`)

- **L16-41**: 매우 단순. 현재 레짐만 배지로 표시하고 이전 레짐 히스토리가 없음
- 추가 제안: 최근 N시간의 레짐 변화 타임라인, 현재 레짐 지속 시간, 레짐 변경 이벤트 로그
- **L21-28**: `animate-pulse-dot` 클래스가 항상 적용되어 도트가 항상 깜빡임. "unknown" 상태에서만 깜빡이고 확정 레짐에서는 안정적으로 표시하는 것이 적절

### 7. EquityCurveChart (`components/EquityCurveChart.tsx`)

- **L34-77**: Recharts LineChart 기본 설정. 전문 트레이딩 차트와 비교하면 기능 부족:
  - Recharts `Legend` 컴포넌트 미사용 -- 어떤 색이 equity이고 어떤 색이 PnL인지 설명 없음
  - `Brush` 컴포넌트 미사용 -- 시간 범위 선택 불가
  - `ReferenceLine` 미사용 -- 초기 자본 기준선 없음
  - 커스텀 커서 없음
- **L56-59**: Tooltip formatter에 `as never` 타입 캐스팅 -- 타입 안전성 포기
- **L32**: 차트 높이 300px 고정. 반응형으로 화면 크기에 따라 조절하거나 사용자가 리사이즈 가능하게 해야 함

### 8. PositionsTable (`components/PositionsTable.tsx`)

- **L17-28**: `<table>` 태그에 `className`이 없음 -- globals.css의 전역 table 스타일에 의존
- **L44**: 키가 `${pos.symbol}-${pos.posSide}-${idx}` -- idx 포함은 안정적이지만, 동일 심볼+방향 포지션이 두 개 있을 때 순서 변경 시 잘못된 DOM 업데이트 가능
- 정렬 기능 없음 -- PnL 기준 정렬, 심볼 기준 정렬 불가
- 필터링 없음 -- 롱/숏 필터, 수익/손실 필터

### 9. TradesTable (`components/TradesTable.tsx`)

- **L37-93**: PositionsTable과 동일한 구조적 문제
- **L85**: `trade.strategy || '-'` -- 전략명이 영문 클래스명 그대로. `translateStrategyName` 미적용
- 페이지네이션 없음 -- 50개 제한은 useTrades에서 적용하지만, UI에서 "더 보기" 없음
- 거래 상세 보기 없음 -- 행 클릭 시 주문 상세 (TP/SL 가격, 수수료, 메타데이터) 표시

### 10. SystemHealth (`components/SystemHealth.tsx`)

- **L35-50**: 매우 최소한 -- Badge 2개와 latency 숫자만 표시
- 서비스별 상태 (`health.services`)를 표시하지 않음 -- HealthReport에 서비스별 상태와 latency가 포함되지만 미사용
- latency 임계치 색상 코딩 없음 -- 50ms는 녹색, 200ms는 노랑, 500ms+는 빨강 등
- 연결 상태 히스토리 없음 -- 최근 연결 끊김 시간/횟수

### 11. 백테스트 페이지 (`app/backtest/page.tsx`)

- **L42-54**: equityCurve 다운샘플링이 클라이언트에서 수행. 500 포인트 이상이면 균등 간격으로 샘플링하지만, 최대/최소 포인트를 보존하지 않아 드로다운 피크가 누락될 수 있음
- **L106-125**: 진행률 표시가 단순 프로그레스 바 -- 예상 완료 시간, 처리된 캔들 수, 현재 날짜 등 추가 정보 없음
- BacktestPriceChart: 실제 가격 선 없이 진입/청산 포인트만 scatter로 표시 -- 가격 움직임의 맥락 이해 불가. 실제 kline/candlestick 차트 위에 매매 포인트를 오버레이하는 것이 표준

### 12. 토너먼트 페이지 (`app/tournament/page.tsx`)

- **L72**: `confirm()` 사용 -- 브라우저 기본 confirm 대화상자는 커스텀 다크 테마 UI와 불일치. `ConfirmDialog` 사용해야 함
- **L154-158**: InfoCard 4개가 너무 제네릭. 토너먼트 진행률, 남은 시간, 현재 라운드 등 토너먼트 특화 정보 부족
- **L341-371**: LeaderboardRow에서 전략명이 영문 클래스명 (`entry.strategy`). `translateStrategyName` 미적용

---

## 시각화 개선안

### V1. 드로다운 차트 (신규 컴포넌트)
```
[에쿼티 커브]                    [드로다운 차트]
  |    /\   /\__/\                 |
  |   /  \ /      \               0%|________________
  |  /    \/        \            -2%|   \  /    \
  | /                \           -5%|    \/      \___
  |/                              -8%|
  +----time------->               +----time------->
```
- Recharts AreaChart, 빨간 gradient fill
- Y축: 0%에서 시작, 아래로 하락 표시
- 최대 드로다운 지점에 ReferenceDot + 라벨

### V2. P&L 히트맵 (일별)
```
     Mon  Tue  Wed  Thu  Fri  Sat  Sun
W1  [+2] [+1] [-1] [+3] [+2] [+1] [0 ]
W2  [-2] [+4] [+1] [-1] [+2] [+3] [+1]
W3  [+1] [-3] [+2] [+5] [-1] [+2] [+1]
```
- CSS Grid 기반, 셀 색상: 진한 초록(큰 수익) ~ 연한 초록 ~ 회색(0) ~ 연한 빨강 ~ 진한 빨강(큰 손실)
- 호버 시 해당 날짜의 거래 수, 총 PnL, 승률 툴팁

### V3. 리스크 대시보드 게이지
```
   서킷 브레이커        드로다운            노출도
   [   OFF   ]      [|||||||----]        [||||-------]
   정상               4.2% / 10%          35% / 100%
```
- 반원형 게이지 차트 (Recharts RadialBarChart 활용)
- 색상 영역: 녹색(안전) -> 노랑(주의) -> 빨강(위험)
- 숫자는 게이지 중앙에 크게 표시

### V4. 전략 성과 레이더 차트
```
         승률
         /\
        /  \
  샤프 /    \ PF
      \    /
       \  /
        \/
      최대낙폭
```
- 다중 전략 오버레이 가능
- 5축: 승률, 수익 팩터, 샤프 비율, 최대 드로다운(역수), 수익률

---

## 레이아웃 재설계 제안

### 현재 레이아웃 (단일 열 스택)
```
+=============================================+
| Header: Title | Mode | NavLinks | Health    |
+=============================================+
| Bot Control Panel                           |
+=============================================+
| Strategy Panel (매우 길음 - ~600px)          |
|  [필터3줄] [전략18개]                        |
+=============================================+
| Account Overview (2/3) | Risk Status (1/3)  |
+=============================================+
| Market Regime                               |
+=============================================+
| Symbol Regime Table                         |
+=============================================+
| Regime Strategy Recommendation              |
+=============================================+
| Equity Curve Chart                          |
+=============================================+
| Positions (1/2) | Signals (1/2)            |
+=============================================+
| Trades Table                                |
+=============================================+
```

### 제안 레이아웃 (Professional Trading Terminal 스타일)
```
+=============================================+
| HEADER                                       |
| [Bot Status: Running] [Live/Paper] [Health]  |
| [Emergency Stop!] [Start] [Pause] [Stop]     |
+=============================================+
|                    |                          |
| ACCOUNT SUMMARY    | RISK DASHBOARD          |
| $$ Equity          | [CB: OK] [DD: 2.3%]    |
| $$ Balance         | [Exposure: 45%]         |
| $$ Unrealized PnL  | [게이지 차트]            |
| #  Positions       |                          |
|                    |                          |
+--------------------+--------------------------+
|                                               |
| EQUITY CURVE [시간 범위 선택] [Legend]         |
| [=====그래프 영역 (높이 350px)======]         |
| [=====Brush 영역===============]             |
|                                               |
+=============================================+
|                                               |
| ACTIVE POSITIONS [필터] [정렬]               |
| [실시간 업데이트 테이블 - 행 클릭 시 상세]   |
|                                               |
+=============================================+
|                    |                          |
| SIGNAL FEED        | RECENT TRADES            |
| [실시간 리스트]     | [거래 테이블]            |
| [필터: 승인/거부]   | [페이지네이션]           |
|                    |                          |
+--------------------+--------------------------+
| MARKET REGIME [현재] | SYMBOL REGIMES [테이블] |
+--------------------+--------------------------+
| STRATEGY MANAGEMENT (기본 접힘)              |
| [펼치기 >] 3/18 전략 활성                    |
| (펼치면: 필터 + 전략 리스트)                 |
+=============================================+
| REGIME RECOMMENDATIONS (기본 접힘)           |
+=============================================+
```

### 핵심 변경점:
1. **봇 제어 + 계정 요약 + 리스크를 최상단에 통합** -- 가장 중요한 정보가 스크롤 없이 즉시 보임
2. **전략 관리를 접이식(Collapsible)으로 변경** -- 기본 접힌 상태, 봇 시작 전에만 자동 펼침
3. **에쿼티 커브를 계정 요약 바로 아래에 배치** -- 자산 변동을 한눈에 파악
4. **활성 포지션을 에쿼티 커브 바로 아래** -- 현재 거래 현황 즉시 확인
5. **시장 레짐 + 추천 전략을 하단으로 이동** -- 참고 정보는 아래에

---

## 프론트엔드 엔지니어링 개선안

### FE1. 타입 안전성 문제

1. **`as never` 캐스팅** (EquityCurveChart.tsx:56-59, BacktestEquityCurve.tsx:69-72, BacktestPriceChart.tsx:147-149):
   - Recharts Tooltip `formatter` prop의 타입이 복잡하여 `as never`로 우회
   - 수정: 커스텀 Tooltip 컴포넌트 (`content` prop)를 사용하면 타입 안전하게 구현 가능

2. **`Record<string, unknown>` 남용** (types/index.ts 전반):
   - `StrategyInfo.config`, `Signal.marketContext`, `Trade.metadata` 등이 모두 `Record<string, unknown>`
   - 최소한 주요 필드를 정의하고 나머지만 unknown으로 처리

3. **`useSocket` 반환 타입에 spread** (useSocket.ts:118):
   - `return { ...state, clearSignals, clearRiskEvents }` -- spread가 타입 추론을 약화시킴
   - 명시적 반환 타입 인터페이스 정의 권장

### FE2. 불필요한 리렌더링

1. **useSocket의 setState 패턴** (useSocket.ts:34-103):
   - 모든 Socket 이벤트가 `setState(prev => ({ ...prev, ... }))` 패턴 사용
   - 각 이벤트가 전체 state 객체를 새로 생성하여, state의 한 필드만 변경되어도 useSocket을 사용하는 모든 컴포넌트가 리렌더링
   - 수정: `useReducer`로 전환하거나, 각 데이터 유형별 별도 state 분리 (signals, positions, regime 등)

2. **page.tsx의 거대한 컴포넌트** (page.tsx:29-216):
   - Dashboard가 모든 훅을 최상위에서 호출. 어떤 데이터든 변경되면 전체 페이지 리렌더링
   - 수정: 데이터별 섹션을 별도 컴포넌트로 분리하고, 각 컴포넌트가 필요한 훅만 호출

3. **StrategyPanel의 useEffect 체인** (StrategyPanel.tsx:47-57):
   - `strategies` 변경 -> `useEffect` -> `onSelectionChange` 호출 -> 부모의 ref 업데이트
   - strategies가 API에서 다시 fetch될 때마다 불필요하게 트리거

### FE3. 에러 처리 미흡

1. **API 클라이언트** (api-client.ts:26-36):
   - `request` 함수가 네트워크 에러(fetch 실패)를 catch하지 않음
   - `!res.ok` 상태 코드(4xx, 5xx) 처리 없음 -- `json.success`만 확인
   - 수정: try-catch로 네트워크 에러 래핑, HTTP 상태 코드 확인 추가

2. **에러 바운더리 부재**:
   - 전체 앱에 React Error Boundary가 없음
   - 차트 렌더링 에러, 소켓 에러 등이 전체 앱을 크래시시킬 수 있음
   - 수정: 최소한 `app/error.tsx` (Next.js 13+ 에러 바운더리) 추가

3. **폴링 에러 누적**:
   - `useBotStatus`, `usePositions` 등에서 폴링 에러가 발생하면 error state만 설정
   - 연속 에러 시 서버 다운 감지 및 사용자 알림이 없음
   - 수정: 연속 에러 카운트 추적, N회 이상 실패 시 폴링 중단 + 명시적 재연결 UI

### FE4. 메모리 누수 위험

1. **useBacktest의 setInterval** (useBacktest.ts:73-94):
   - `pollRef.current = setInterval(...)` -- 폴링 중 컴포넌트 unmount 시 `stopPolling`이 cleanup에서 호출되지만, 비동기 콜백 내부의 state 업데이트가 unmounted 컴포넌트에 시도될 수 있음
   - 수정: AbortController 또는 isMounted ref 추가

2. **useSocket의 소켓 리스너** (useSocket.ts:30-108):
   - cleanup에서 `disconnectSocket()`을 호출하지만, 개별 이벤트 리스너의 `socket.off()`를 명시적으로 호출하지 않음
   - `disconnectSocket()`이 소켓 인스턴스를 null로 설정하므로 리스너는 GC 대상이지만, 예외 경우 누수 가능

### FE5. 접근성(Accessibility) 부재

1. **ARIA 속성 없음**: 모든 컴포넌트에서 `role`, `aria-label`, `aria-live` 등 미사용
2. **키보드 탐색 불가**: 테이블, 전략 리스트 등에서 Tab/Enter 내비게이션 미구현
3. **색상 대비**:
   - `text-zinc-600` (L49, RiskStatusPanel.tsx) 위의 `text-[10px]` -- 대비 비율 WCAG AA 미달
   - 빨강/초록 PnL 색상만으로 수익/손실 구분 -- 색맹 사용자 배려 없음 (아이콘 또는 +/- 기호 필요. 현재 `getPnlSign`이 있지만 모든 곳에 적용되지 않음)
4. **포커스 관리**: ConfirmDialog가 열릴 때 포커스 트래핑 없음 -- Tab 키로 대화상자 밖의 요소에 접근 가능

### FE6. 코드 구조 개선

1. **상수 중복 정의**:
   - 레짐 색상 맵이 `utils.ts:132-141`, `StrategyPanel.tsx:20-26`, `SymbolRegimeTable.tsx:11-18`, `RegimeStrategyRecommendation.tsx:27-41`에 각각 정의
   - 하나의 공유 상수 파일로 통합 필요

2. **컴포넌트 파일 크기**:
   - `RegimeStrategyRecommendation.tsx` -- 297줄, 단일 파일에 2개 컴포넌트
   - `StrategyPanel.tsx` -- 291줄, 필터 로직 + 리스트 렌더링 + API 호출 혼합
   - 이들을 더 작은 단위로 분리하면 유지보수성 향상

3. **CSS 클래스 문자열 조합**:
   - `cn()` 유틸이 있지만 대부분 템플릿 리터럴로 클래스 조합 (StrategyPanel.tsx:148-152, TradingModeToggle.tsx:49-55)
   - `cn()` 또는 `clsx`로 통일하면 가독성 향상

### FE7. 빌드/번들 최적화

1. **Recharts 전체 import** (EquityCurveChart.tsx:4):
   - `import { LineChart, Line, XAxis, ... } from 'recharts'` -- named import이지만 recharts는 tree-shaking이 불완전한 패키지
   - 수정: `recharts/es6/chart/LineChart` 등 deep import 고려 또는 번들 분석 수행

2. **동적 import 미사용**:
   - 백테스트, 토너먼트 페이지의 차트 컴포넌트를 `next/dynamic`으로 lazy load하면 초기 번들 크기 감소
   - `BacktestPriceChart`, `BacktestEquityCurve` 등은 결과가 있을 때만 필요

3. **Socket.io 클라이언트**:
   - `socket.io-client`가 약 50KB. 모든 페이지에서 import됨 (`useSocket` -> `getSocket`)
   - 소켓이 필요 없는 백테스트/토너먼트 페이지에서도 로드됨

---

## 구현 우선순위 제안

### Phase 1 (즉시 수정 -- 안전 관련)
1. Emergency Stop 확인 다이얼로그 추가 (C1)
2. Risk 이벤트 실시간 알림 UI (C2)
3. 실거래 모드 시각적 경고 강화 (C4)
4. 에러 바운더리 추가 (FE3.2)

### Phase 2 (1~2주 -- 핵심 UX)
5. 대시보드 레이아웃 재설계 (H1)
6. 전략 패널 접이식 + 시작 버튼 연동 (H2)
7. PositionsTable 기능 강화 (H4)
8. Adaptive 폴링 (H8)
9. useSocket 리렌더링 최적화 (FE2.1)
10. 토너먼트 한국어 통일 (E7)

### Phase 3 (2~4주 -- 시각화 강화)
11. 에쿼티 커브 고급 기능 (H3)
12. 드로다운 차트 추가 (V1)
13. 리스크 게이지 대시보드 (V3)
14. SignalFeed 개선 (H5)
15. 모바일 반응형 (H7)

### Phase 4 (1~2개월 -- 프로급 기능)
16. P&L 히트맵 (V2)
17. 전략 성과 레이더 차트 (V4)
18. 키보드 단축키 (E2)
19. 알림 센터 (E3)
20. 설정 페이지 (E4)
21. 백테스트 전략 파라미터 커스터마이즈 (E6)
22. 다중 세션 비교 (E5)

---

*이 제안서는 전체 프론트엔드 코드베이스의 25개 컴포넌트, 8개 훅, 3개 페이지를 줄 단위로 분석한 결과입니다. 프로페셔널 트레이딩 터미널(Binance Futures, TradingView, Bloomberg Terminal)의 UX 패턴을 기준으로 평가했습니다.*
