# UI Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 25개 컴포넌트 줄단위 분석, 레이아웃 재설계안, 시각화 컴포넌트 제안 | Round 1 | active |
| `proposals/round_1_review.md` | Trader+Engineer 제안서 교차 리뷰, 프론트엔드 변경 요구사항 종합, 타입 변경 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-7~T0-9 구현 제안 (긴급정지 다이얼로그, 리스크배너, 모드배너) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |
| `proposals/round_3.md` | T1-7~T1-11 FE 구현 제안 (Dashboard 레이아웃, 청산 버튼, Socket ref-count, Error Boundary) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Trader+Engineer 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |
| `proposals/round_4.md` | T2-1~T2-12 구현 제안 (SignalFeed rejectReason, 적응형 폴링, Drawdown 차트, Risk 게이지) | Round 4 | active |
| `proposals/round_4_review.md` | Round 4 교차 리뷰 (Trader+Engineer 제안 검토) | Round 4 | active |
| `../shared/decisions/round_4.md` | Round 4 합의 결정문서 (T2-1~T2-12, AD-18~AD-24) — **구현 완료** | Round 4 | active |
| `proposals/round_5.md` | T3 Enhancement UI 분석: T3-6 성과 귀인 대시보드 탭 설계, exchange-side SL UX 영향, 레이아웃 확정 상태 | Round 5 | active |
| `proposals/round_5_review.md` | Round 5 교차 리뷰: SL 도입 시 PositionsTable 컬럼 추가, SL/청산가 혼동 방지 UX, Vitest→Jest 양보 | Round 5 | active |
| `../shared/decisions/round_5.md` | Round 5 합의 결정문서 (T3-1~T3-7, BUG-1, AD-25~AD-31) — **구현 완료** | Round 5 | active |
| `proposals/round_6.md` | 실거래 준비도 강화: 15개 UX 이슈 — 디자인 토큰, 접근성, ConfirmDialog, 반응형, tooltip | Round 6 | active |
| `proposals/round_6_review.md` | Round 6 교차 리뷰 (Trader+Engineer 제안 검토) | Round 6 | active |
| `../shared/decisions/round_6.md` | Round 6 합의 결정문서 (25개 항목, AD-32~AD-39) — **구현 완료** | Round 6 | active |
| `proposals/round_7.md` | 레짐 빈도 문제 FE 대응: 중간 상태(pending/grace) 시각화, 3-way 배지, 카운트다운 타이머 설계 | Round 7 | active |
| `proposals/round_7_review.md` | Round 7 교차 리뷰: hysteresis 15분 시 UX 반응성 우려, pending 캔들 카운트 표시 필수, 쿨다운 잔여 표시 | Round 7 | active |
| `../shared/decisions/round_7.md` | Round 7 합의 결정문서 (17건, AD-40~AD-45) — 삼중 보호 체계, 유예기간 — **구현 완료** | Round 7 | active |
| `proposals/round_8.md` | 코드베이스 재분석: 23개 발견 (CRITICAL 2/HIGH 11/MEDIUM 9/LOW 1) — 포커스 트랩, severity toast, state 분리, 적응형 폴링 | Round 8 | active |
| `proposals/round_8_review.md` | Round 8 교차 리뷰 (Trader+Engineer 제안 검토) — 모바일 반응형 동의, 토너먼트 캡슐화 동의, named handler 동의 | Round 8 | active |
| `../shared/decisions/round_8.md` | Round 8 합의 결정문서 (46건, AD-46~AD-52) — severity toast AD-47, Escape/포커스 트랩, aria-expanded — **구현 완료** | Round 8 | active |
| `proposals/round_9.md` | Tier 2 Quality FE 분석: StrategyCard toggle 접근성, 모바일 반응형 3개 컴포넌트, MarketRegimeIndicator 데드코드 | Round 9 | active |
| `proposals/round_9_review.md` | Round 9 교차 리뷰 (Trader+Engineer 제안 검토) | Round 9 | active |
| `../shared/decisions/round_9.md` | Round 9 합의 결정문서 (13건, AD-53~AD-57) — FE 5건: toggle 접근성, 데드코드 삭제, 모바일 반응형 3개 — **구현 완료** | Round 9 | active |
| `proposals/round_10.md` | Tier 3 Enhancement FE 분석: 데드코드(StrategyPanel/ClientGate) 삭제, TOOLTIP_STYLE 통일, th scope, EquityCurveBase 추출 | Round 10 | active |
| `proposals/round_10_review.md` | Round 10 교차 리뷰 (Trader+Engineer 제안 검토) — Config 객체 방식 주장, Card 래핑 wrapper에서, border-muted 통일 | Round 10 | active |
| `../shared/decisions/round_10.md` | Round 10 합의 결정문서 (8건, AD-58~AD-62) — FE 4건: 데드코드 삭제, TOOLTIP_STYLE, th scope, EquityCurveBase + Sortino/Calmar 표시 — **구현 완료** | Round 10 | active |

## Round 1 Key Findings Summary
- **C1**: Emergency Stop에 확인 다이얼로그 없음 — 실수로 전포지션 청산 위험
- **C2**: Risk 이벤트(서킷브레이커/드로다운) WebSocket으로 수신하지만 UI에 미표시
- **C3**: Socket.io 싱글턴 생명주기 문제 — React StrictMode에서 소켓 파괴
- **C4**: 실거래/가상거래 모드 시각적 구분 불충분
- **H1**: 대시보드 정보 우선순위 역전 — 전략 패널이 포지션/PnL을 밀어냄
- **H7**: 모바일 반응형 불완전 — 테이블 768px 미만에서 사용 불가
- **H8**: 폴링 간격 비효율 — 봇 정지 시에도 5초 폴링
- 레짐 색상 맵이 4개 파일에 중복 정의
- Recharts `as never` 타입 캐스팅 3곳
- Error Boundary 부재
- 토너먼트 페이지 영어/한국어 혼용

## Round 5 Key Findings Summary
- **T3-6**: 성과 귀인 대시보드 — 백엔드 `by-strategy`/`by-symbol` API 미소비. PerformanceTabs 탭 기반 통합 레이아웃 설계
- **SL UX**: exchange-side SL 도입 시 PositionsTable에 SL 가격 컬럼 추가 필요. 청산가(margin call)와 SL(전략 설정) 혼동 방지 UX 설계
- **레이아웃 확정**: R4 완료 후 대시보드 7-Row 구조 안정: Banner→Control→Positions→Risk/Equity/DD→Signal/Trades→Strategy→Symbol

## Round 7 Key Findings Summary
- **중간 상태 도입**: 이진 상태(active/inactive, confirmed/unknown) → 3-way 상태(active/grace/deactivated, confirmed/pending/cooldown). UI가 "왜 안 바뀌는지" 설명하는 것이 핵심
- **3-way 배지**: active(green) / grace(amber+카운트다운) / inactive(gray) — StrategyCard 컴포넌트에 상태별 시각 피드백
- **useCountdown 훅**: `graceExpiresAt` timestamp 기반 범용 카운트다운 — 1초 간격 갱신, 만료 시 자동 정리
- **레짐 상태 표시**: pending 캔들 카운트 (`3/10 캔들 확인`), 쿨다운 잔여 시간, 전환 빈도 경고(안정/빈번/과다)

## Round 8 Key Findings Summary
- **EmergencyStopDialog 접근성**: Escape 키 닫기, Tab 포커스 트랩, 배경 클릭 닫기, 포커스 저장/복원 — 모달 접근성 완비
- **Severity-based Error Toast (AD-47)**: 3-tier 분류 — critical(persistent), warning(10s), info(5s). `useToasts()` 훅으로 전역 관리
- **useSocket state 분리**: 단일 SocketState 객체 → 6개 독립 useState — 불필요한 리렌더 방지
- **적응형 폴링 확산**: usePerformanceAnalytics, useTournament, useAnalytics → `useAdaptivePolling` 훅 통합
- **aria-expanded 일괄 적용**: TradesTable, DrawdownChart, BacktestForm의 collapsible 버튼에 접근성 속성 추가

## Round 9 Key Findings Summary
- **StrategyCard toggle 접근성**: 기존 div onClick → button 분리 + aria-label, 키보드 내비게이션 지원
- **MarketRegimeIndicator 데드코드 삭제**: 사용처 없는 컴포넌트 제거 (RegimeFlowMap으로 대체 완료)
- **모바일 반응형 3개**: 대시보드 헤더(lg: 브레이크포인트), AccountOverview(총자산 분리), RegimeFlowMap(grid-cols-1 lg:)

## Round 10 Key Findings Summary
- **데드 코드 삭제 (StrategyPanel+ClientGate)**: StrategyPanel(297줄), ClientGate(22줄) — 사용처 없음 확인 후 삭제. StrategyListItem 타입은 3곳 사용 중이라 유지
- **TOOLTIP_STYLE 통일**: 4개 파일(DailyPerformance, StrategyPerformance, SymbolPerformance, CoinScoreboard)에서 로컬 → CHART_TOOLTIP_STYLE import. border-subtle → border-muted 통일
- **th scope="col" 일괄 추가**: 10개 파일, ~88개 th 태그에 접근성 속성 추가
- **EquityCurveBase 공통 추출 (AD-62)**: EquityCurveConfig 인터페이스 + EquityCurveBase 공통 컴포넌트. 기존 2개 차트를 얇은 래퍼로 전환. Card 래핑은 wrapper 담당
- **Sortino+Calmar FE 표시**: BacktestStatsPanel에 소르티노(Sharpe 옆) + 칼마(최대낙폭 옆) 배치

## Accumulated Insights
- **레이아웃 진화**: R1 정보 우선순위 역전 발견 → R3 대시보드 재배치 → R4 리스크 패널/드로다운 차트 추가 → R5 7-Row 구조 확정 → R7 grace 배지 추가. 현재 상태: 안정된 레이아웃, 정보 밀도 적정
- **실시간 상태 표현**: R1 Socket.io 싱글턴 문제 → R3 ref-count 해결 → R4 적응형 폴링(봇 상태별) → R7 3-way 상태 + 카운트다운 + pending/cooldown 표시 → R8 useSocket state 분리 + 3개 훅 적응형 폴링 전환. 현재 상태: 리렌더 최적화 + 전 훅 적응형 폴링 적용 완료
- **모드 인식 UX**: R2 TradingModeBanner(paper/live) → R4 RiskStatusPanel 게이지 → R7 레짐 pending/cooldown/grace 시각화 → R8 봇 정지 확인 다이얼로그 + severity toast. 현재 상태: 사용자가 시스템의 "왜"를 이해하고 실수를 방지할 수 있는 UI
- **컴포넌트 패턴**: R1 레짐 색상 4곳 중복 → R6 디자인 토큰 도입 → R7 상태별 색상 체계(green/amber/gray/blue) 표준화 → R8 ErrorToast 신규 컴포넌트 + aria-expanded 일괄 적용. 현재 상태: 색상/상태 매핑 일관성 확보, 접근성 기반 정비
- **접근성 진화**: R6 aria-disabled/aria-label → R8 포커스 트랩 + aria-expanded → R9 StrategyCard toggle button 분리 → R10 th scope="col" 88개 추가. 현재 상태: 테이블+모달+토글 접근성 완비
- **코드 정리 패턴**: R9 MarketRegimeIndicator 데드코드 삭제 → R10 StrategyPanel+ClientGate 삭제 + TOOLTIP_STYLE 4파일 통일 + EquityCurveBase 공통 추출. 현재 상태: 중복 코드 제거, 공통 컴포넌트 확립

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
