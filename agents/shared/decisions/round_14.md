# Round 14 합의 결정문서

> 생성일: 2026-02-18
> 주제: 코드베이스 재분석 Round 4 — 전체 BACKLOG 완료 후 새 개선과제 발굴
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R14-1 | CustomRuleStrategy onFill() 추가 — 포지션 상태 선행 설정 수정 | 3/3 동의 (Tier 0) | BE | 1h |
| R14-2 | CustomRuleStrategy parseFloat → mathUtils 전환 | 3/3 동의 (Tier 0) | BE | 30min |
| R14-3 | QuietRangeScalp entry leverage 필드 추가 | 3/3 동의 (Tier 0) | BE | 15min |
| R14-4 | CustomStrategyStore ID crypto.randomUUID + 입력 검증 | 3/3 동의 (Tier 0) | BE | 30min |
| R14-5 | Custom Strategy 업데이트 시 활성 인스턴스 처리 | 3/3 동의 (Tier 0) | BE | 45min |
| R14-6 | _handleStrategySignal 비동기 에러 .catch() 추가 | 3/3 동의 (Tier 0) | BE | 15min |
| R14-7 | Custom Strategy config 검증 — 공통 필드 하드코딩 규칙 | 3/3 동의 (Tier 1) | BE | 45min |
| R14-8 | CLOSE 시그널 suggestedQty '100' 수정 | 3/3 동의 (Tier 0) | BE | 10min |
| R14-9 | 커스텀 전략 서버 시작 시 레지스트리 자동 등록 (백테스트 지원) | 3/3 동의 (Tier 1) | BE | 30min |
| R14-10 | Custom Strategy POST 입력 방어 (깊이/크기 제한) | 3/3 동의 (Tier 1) | BE | 30min |
| R14-11 | Backtest 라우트 입력 검증 강화 + HTTP 상태 코드 수정 | 3/3 동의 (Tier 1) | BE | 30min |
| R14-12 | PaperEngine SL/TP stale cleanup 추가 | 3/3 동의 (Tier 1) | BE | 30min |
| R14-13 | SignalFilter _recentSignals 크기 제한 (500개) | 3/3 동의 (Tier 1) | BE | 15min |
| R14-14 | DrawdownMonitor 경고 디바운싱 (5분 간격) | 3/3 동의 (Tier 1) | BE | 15min |
| R14-15 | PositionManager utcHour dead code 제거 | 3/3 동의 (Tier 2) | BE | 10min |
| R14-16 | OrderManager _symbolLocks.clear() on stop | 3/3 동의 (Tier 2) | BE | 5min |
| R14-17 | StrategyConfigPanel 입력 유효성 검증 (FE) | 3/3 동의 (Tier 1) | FE | 30min |
| R14-18 | CustomStrategyBuilder 모달 접근성 (ESC, focus trap) | 3/3 동의 (Tier 1) | FE | 45min |
| R14-19 | PerformanceTabs stale-while-revalidate | 3/3 동의 (Tier 1) | FE | 40min |
| R14-20 | useAdaptivePolling 이중 리스너 통합 | 3/3 동의 (Tier 1) | FE | 15min |
| R14-21 | Quick Stats Bar 과밀 해소 | 3/3 동의 (Tier 2) | FE | 25min |
| R14-22 | StrategyExplainer 반응형 grid-cols-3 | 3/3 동의 (Tier 2) | FE | 10min |
| R14-23 | RiskStatusPanel aria-valuetext 추가 | 3/3 동의 (Tier 2) | FE | 15min |
| R14-24 | ConditionRow 전환 버튼 UX 개선 | 3/3 동의 (Tier 2) | FE | 15min |

**Round 14 총 합의: 24건 (BE 16건 ~6h, FE 8건 ~3.5h)**

### Round 15로 이관

| ID | 이슈 | 사유 |
|----|------|------|
| DEF-1 | 10개 전략 AD-37 위반 일괄 수정 (T:P14-1) | 6시간 규모, 독립 스프린트로 진행 필요 |
| DEF-2 | ATR 자체 계산 중복 제거 6개 전략 (T:P14-2) | 3시간 규모, 검증 테스트 병행 필요 |
| DEF-3 | onFill 패턴 통일 fill.action 기반 (T:P14-3) | DEF-1 선행 필수 |
| DEF-4 | GridStrategy 동시 entry/exit 시그널 분리 (T:P14-5) | T2 우선순위 |
| DEF-5 | FundingRate Kelly 승률 동적화 (T:P14-6) | T2 우선순위 |
| DEF-6 | CustomRuleStrategy confidence 동적 산출 (T:P14-T5) | 중간 난이도, R15에서 진행 |
| DEF-7 | CustomRuleStrategy 레짐 타겟 기본값 보수화 (T:P14-T8) | FE 연동 필요 |
| DEF-8 | Tabs ARIA 완전 준수 (UI:R14-6) | MEDIUM으로 분류, R15 진행 |
| DEF-9 | TradesTable 컬럼 정렬 (UI:R14-10) | 신규 기능, R15 |
| DEF-10 | 전략 비교 뷰 (UI:R14-15) | 90분 규모 신규 기능 |
| DEF-11 | Dashboard page.tsx 분할 (UI:R14-5) | 리팩토링 |
| DEF-12 | 전략 프리셋 시스템 (R13-D1) | 스키마 설계 필요 |
| DEF-13 | 모듈별 설정 아코디언 재구성 (R13-D5) | paramMeta group 기반 FE 작업 |
| DEF-14 | ExposureGuard 레버리지 인지 (R12-D4) | T1 격상 동의, R15 구현 |
| DEF-15 | maxHoldTime 강제 청산 (R11-D3) | T1 격상 동의, R15 구현 |

---

## 아키텍처 결정

### AD-14-1: CustomRuleStrategy onFill() 패턴

- **결정**: CustomRuleStrategy에 onFill() 오버라이드를 추가하여, entry 시그널 emit 전에 positionSide/entryPrice를 설정하지 않고, onFill()에서만 확정한다.
- **근거**: MaTrend/Turtle의 R11 수정(AD-37) 패턴과 동일. 3/3 동의. 10개 내장 전략의 동일 수정은 규모가 크므로 R15로 이관.
- **구현**: `s.entryPrice = close; s.positionSide = 'long';` 코드를 제거하고, `onFill(fill)` 메서드에서 `fill.action === OPEN_LONG`일 때 `s.entryPrice = fill.price; s.positionSide = 'long'` 설정. `super.onFill(fill)` 호출 포함.

### AD-14-2: CustomStrategyStore ID 생성

- **결정**: `Date.now()` → `crypto.randomUUID()`. 사용자 입력 `def.id`는 무시하고 서버에서만 생성. 기존 저장된 ID는 호환성 유지.
- **근거**: 3/3 동의. ID 충돌 방지 + 프로토타입 오염 방어.

### AD-14-3: Custom Strategy 활성 인스턴스 업데이트

- **결정**: PUT /custom-strategies/:id 응답에 `needsReactivation` 플래그 포함. 봇 실행 중이면 `needsReactivation: true`. 자동 재활성화는 하지 않음 (진행 중 포지션 보호).
- **근거**: 3/3 동의. hotReload보다 disable→enable이 안전하다는 Trader 의견 채택.

### AD-14-4: Custom Strategy config 공통 검증

- **결정**: strategyConfigValidator.js에서 `Custom_` prefix 전략에 대해 positionSizePercent(1~20), leverage(1~20), tpPercent(0.5~50), slPercent(0.5~20)의 하드코딩 검증 규칙 적용.
- **근거**: 3/3 동의. 동적 paramMeta 생성보다 공통 필드 하드코딩이 빠르고 안전.

### AD-14-5: 커스텀 전략 서버 시작 시 레지스트리 등록

- **결정**: app.js bootstrap에서 `customStrategyStore.list()` → `registry.register()` 루프. 실패 시 개별 에러 로깅하고 나머지 계속 등록 (safeRequire 패턴).
- **근거**: 3/3 동의. 서버 재시작 후 백테스트 불가 문제 해결.

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| R14-BE-06 우선순위 | LOW | HIGH | LOW | **LOW** (2/3) |
| R14-BE-07 우선순위 | LOW | HIGH | LOW | **LOW** (2/3) |
| R14-BE-15 우선순위 | CRITICAL | LOW | CRITICAL | **CRITICAL** → R14-1로 통합 |
| FE 접근성 HIGH 3건 | 2건 MEDIUM 제안 | 동의 | HIGH 유지 | R14-2(builder) HIGH 유지, R14-6(Tabs) MEDIUM으로 이관 |
| PerformanceTabs 우선순위 | HIGH 격상 | 동의 | 동의 | **HIGH** → R14-19 Tier 1 |
| 10개 전략 AD-37 수정 | 이번 스프린트 | 6h 적절 | 동의 | **R15로 이관** (규모 크므로 독립 스프린트) |
| confidence 동적 산출 | HIGH | 미언급 | 미언급 | **R15 이관** (1/3 제기) |

---

## 다음 단계

### 구현 순서 (의존성 기반)

**Phase A — CRITICAL 수정 (BE, ~3h, 선행 필수)**
1. R14-2: CustomRuleStrategy parseFloat → mathUtils
2. R14-1: CustomRuleStrategy onFill() 추가 + positionSide/entryPrice 이동
3. R14-8: CLOSE 시그널 suggestedQty '100'
4. R14-3: QuietRangeScalp leverage 필드 추가
5. R14-4: CustomStrategyStore ID 보안 강화
6. R14-5: Custom Strategy 업데이트 시 needsReactivation
7. R14-6: _handleStrategySignal .catch()

**Phase B — HIGH 수정 (BE, ~2.5h, Phase A 완료 후)**
8. R14-7: Custom Strategy config 공통 검증
9. R14-9: 서버 시작 시 커스텀 전략 레지스트리 등록
10. R14-10: Custom Strategy POST 입력 방어
11. R14-11: Backtest 입력 검증 + HTTP 상태 코드
12. R14-12: PaperEngine SL/TP stale cleanup
13. R14-13: SignalFilter 크기 제한
14. R14-14: DrawdownMonitor 디바운싱

**Phase C — MEDIUM/LOW (BE, ~15min)**
15. R14-15: PositionManager dead code
16. R14-16: OrderManager _symbolLocks.clear()

**Phase D — FE (Phase A 완료 후, ~3.5h)**
17. R14-17: StrategyConfigPanel 유효성 검증
18. R14-18: CustomStrategyBuilder 접근성
19. R14-19: PerformanceTabs stale-while-revalidate
20. R14-20: useAdaptivePolling 리스너 통합
21. R14-21: Quick Stats Bar 과밀
22. R14-22: StrategyExplainer 반응형
23. R14-23: RiskStatusPanel aria-valuetext
24. R14-24: ConditionRow 전환 버튼 UX

### 트랙 배정
- **Track A (Backend)**: R14-1 ~ R14-16 (BE 전체)
- **Track C (Frontend)**: R14-17 ~ R14-24 (FE 전체)
