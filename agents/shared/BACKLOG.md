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

## Tier 3 — 장기 (Enhancement)

| ID | 우선도 | 담당 | 제목 | 제안자 | 라운드 | 상태 |
|----|--------|------|------|--------|--------|------|
| T3-1 | P3 | All | 테스트 프레임워크 구축 (Jest/Vitest) | E:E-1 | R1 | agreed |
| T3-2 | P3 | All | API 인증/인가 (1단계: API key, 2단계: JWT) | E:E-3 | R1 | agreed |
| T3-3 | P3 | Backend | Exchange-side stop loss 주문 | T:E4 | R1 | agreed |
| T3-4 | P3 | Backend | decimal.js 마이그레이션 (mathUtils 교체) | E:C-5 | R1 | deferred |
| T3-5 | P3 | Backend | Prometheus 메트릭/모니터링 | E:E-7 | R1 | agreed |
| T3-6 | P3 | Frontend | 성과 귀인 대시보드 (by-strategy, by-symbol) | T:Review | R1 | agreed |
| T3-7 | P3 | Backend | Correlation ID (traceId) 전파 | E:9.1 | R1 | agreed |

---

## 아키텍처 결정 참조
→ `decisions/round_1.md` — AD-1~AD-6 참조
→ `decisions/round_2.md` — AD-7~AD-12 참조 (T0-1~T0-9 구현 세부사항)
→ `decisions/round_3.md` — AD-13~AD-17 참조 (T1-1~T1-11 구현 세부사항)
→ `decisions/round_4.md` — AD-18~AD-24 참조 (T2-1~T2-12 구현 세부사항)
