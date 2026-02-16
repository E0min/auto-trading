# Engineer Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 13개 서비스 프로덕션 준비도 감사, 예외처리 매트릭스, 동시성 분석 | Round 1 | active |
| `proposals/round_1_review.md` | Trader+UI 제안서 교차 리뷰, 의존성 DAG, 병렬 트랙 구현 계획 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-4~T0-6 구현 제안 (크래시핸들러, mutex, equity 방어) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |
| `proposals/round_3.md` | T1-1~T1-11 구현 제안 (graceful shutdown, 리스너 누적, SignalFilter 등) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Trader+UI 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |
| `proposals/round_4.md` | T2-1~T2-12 구현 제안 (CircuitBreaker 메모리, rate limiting, confidence 필터링, DI 패턴) | Round 4 | active |
| `proposals/round_4_review.md` | Round 4 교차 리뷰 (Trader+UI 제안 검토) | Round 4 | active |
| `../shared/decisions/round_4.md` | Round 4 합의 결정문서 (T2-1~T2-12, AD-18~AD-24) — **구현 완료** | Round 4 | active |
| `proposals/round_5.md` | T3 Enhancement 6건 시스템 분석: 테스트 전무, API 인증 없음, Prometheus 관측성 부재, traceId 없음 | Round 5 | active |
| `proposals/round_5_review.md` | Round 5 교차 리뷰: SL 전략별 적합도 분류 동의, Jest 단일 러너 주장, trigger order API 지적 | Round 5 | active |
| `../shared/decisions/round_5.md` | Round 5 합의 결정문서 (T3-1~T3-7, BUG-1, AD-25~AD-31) — **구현 완료** | Round 5 | active |
| `proposals/round_6.md` | 실거래 준비도 강화: 14개 이슈 (T0 2건, T1 3건, T2 5건, T3 4건) — 시스템 안정성/관측성 분석 | Round 6 | active |
| `proposals/round_6_review.md` | Round 6 교차 리뷰 (Trader+UI 제안 검토) | Round 6 | active |
| `../shared/decisions/round_6.md` | Round 6 합의 결정문서 (25개 항목, AD-32~AD-39) — **구현 완료** | Round 6 | active |
| `proposals/round_7.md` | 레짐 전환 안정화 설계: timestamp 쿨다운, Map+setTimeout+unref 유예기간, 6개 레이스컨디션 방어 | Round 7 | active |
| `proposals/round_7_review.md` | Round 7 교차 리뷰: hysteresis 8 제안(삼중 보호 감안), 쿨다운 pending 축적 확인, 동적 가중치 보류 | Round 7 | active |
| `../shared/decisions/round_7.md` | Round 7 합의 결정문서 (17건, AD-40~AD-45) — 삼중 보호 체계, 유예기간 — **구현 완료** | Round 7 | active |
| `proposals/round_8.md` | 코드베이스 재분석: 16개 발견 (CRITICAL 2/HIGH 6/MEDIUM 8) — Router singleton, timer unref, parseFloat 제거, BacktestStore 제한 | Round 8 | active |
| `proposals/round_8_review.md` | Round 8 교차 리뷰 (Trader+UI 제안 검토) — decimal.js deferred, 멀티심볼 Phase 1만, 모바일 MEDIUM | Round 8 | active |
| `../shared/decisions/round_8.md` | Round 8 합의 결정문서 (46건, AD-46~AD-52) — reduceOnly bypass, Snapshot 주기 생성, express limit — **25/27 구현 완료** | Round 8 | active |

## Round 1 Key Findings Summary
- **C-1**: unhandledRejection/uncaughtException 핸들러 누락 — 프로세스 즉시 종료 위험
- **C-2**: orderManager.submitOrder() 동시성 제어 없음 — double-spend 위험
- **C-3**: ExposureGuard equity=0 시 division by zero
- **C-4**: graceful shutdown 순서 문제 — DB 쓰기 전 WS 종료
- **C-5**: mathUtils parseFloat 정밀도 한계
- **H-3**: PaperEngine 리스너 누적 (paper↔live 전환 시)
- **H-4**: CircuitBreaker rapidLosses 배열 무한 성장
- **H-7**: 기본 전략 이름 불일치 (MomentumStrategy 미존재)
- **H-8**: botRoutes.js router가 팩토리 밖에 선언
- SignalFilter.updatePositionCount() 실제 호출되지 않음

## Round 5 Key Findings Summary
- **T3-1**: `backend/package.json` test 스크립트가 `echo "Error"` — 테스트 인프라 전무. 32건 코드 무검증 운영
- **T3-2**: 9개 라우트 파일 전체에 인증 미들웨어 없음 — `/api/bot/start`, `/api/trades/order` 등 누구나 호출 가능
- **T3-5**: 관측 수단이 JSON 로그 + `/api/health`뿐 — latency/주문 성공률/메모리 추세 실시간 수집 불가
- **T3-7**: 로거에 traceId 없음 — botService→strategyRouter→signalFilter→orderManager→riskEngine 체인 추적 불가
- **T3-3**: `presetStopLossPrice`는 주문 생성 시 preset SL — 독립 trigger order API가 실질적 server-side SL

## Round 7 Key Findings Summary
- **타이머 안전성**: setTimeout + `unref()` — 프로세스 종료를 차단하지 않는 유예 타이머. `stop()` 시 전체 `clearTimeout` 필수
- **timestamp 쿨다운**: `Date.now() - lastTransitionTs < cooldownMs` — 타이머 누수 없는 순수 비교 방식. pending 캔들은 쿨다운 중에도 축적
- **6개 레이스컨디션 방어**: grace Map 조작의 원자성 보장 (has→get→set 패턴, 중복 타이머 방지, 레짐 복귀 시 즉시 취소)
- **AD-40 삼중 보호**: Hysteresis(10캔들) + Cooldown(5분) + Grace Period(5~15분) — 3개 독립 레이어로 노이즈 내성 확보

## Round 8 Key Findings Summary
- **Router Singleton 패턴 정비**: 8개 라우트 파일에서 `Router()` 호출이 팩토리 함수 외부에 위치 — 테스트/재사용 불가. 팩토리 내부로 이동
- **Timer unref() 전면 적용**: OrphanOrderCleanup, TickerAggregator, PositionManager의 setInterval 타이머가 프로세스 종료 차단. `.unref()` 일괄 추가
- **parseFloat 직접 사용 제거**: tradeRoutes, tournamentRoutes, tickerAggregator에서 parseFloat → mathUtils 함수로 교체. 정밀도 일관성 확보
- **BacktestStore 무제한 성장**: FIFO 50제한 추가 — 메모리 O.O.M 방지
- **_lastTickerEmit Map cleanup**: 10분 stale 기준 5분 주기 정리 — 장기 운영 시 Map 누수 방지
- **TournamentRoutes 캡슐화**: `_initialBalance`, `_accounts.get()` 직접 접근 → 공개 메서드(`setInitialBalance()`, `getStrategyPositions()`) 사용

## Accumulated Insights
- **에러 핸들링 진화**: R1 unhandledRejection 핸들러 누락 → R2 crashHandler 추가 → R3 graceful shutdown 순서 정비 → R6 getAccountInfo 크래시 수정 → R8 getStatus()/getSignal() try-catch 추가. 현재 상태: 프로세스 안정성 확보, 미처리 예외 없음
- **리소스 관리 패턴**: R1 CircuitBreaker rapidLosses 무한 성장 → R4 window 기반 정리 → R7 setTimeout+unref() 패턴 도입 → R8 전 타이머 unref() 적용 + _lastTickerEmit 5분 주기 정리 + BacktestStore FIFO 50제한. 현재 상태: 타이머/Map/배열 누수 방지 패턴 확립, 무제한 성장 경로 제거
- **DI 패턴 안정화**: R1 DI 체계 구축 → R2 orderManager/positionManager 분리 → R4 equity DI 개선 → R6 서비스 간 참조 정리 → R8 Router singleton 팩토리 내부 이동. 현재 상태: app.js bootstrap 순서 안정, 라우트 팩토리 일관성 확보
- **동시성 제어**: R1 orderManager 동시성 미제어 → R2 mutex 도입 → R7 grace Map 원자적 조작. 현재 상태: 핵심 경로에 동시성 보호 적용 완료
- **캡슐화 준수**: R8 TournamentRoutes에서 paperAccountManager 내부 필드 직접 접근 제거 → 공개 API 메서드 패턴으로 전환. 현재 상태: 서비스 경계 깨끗

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
