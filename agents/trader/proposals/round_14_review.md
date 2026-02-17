# Round 14 교차 리뷰 -- Trader

**작성자**: Senior Quant Trader
**날짜**: 2026-02-18
**기준**: 매매 전략 정확성, 리스크 관리 건전성, 수익성 영향, 백테스트 현실성

---

## Engineer 제안서 리뷰

### R14-BE-01: CustomStrategyStore ID 충돌 + Prototype Pollution [CRITICAL]

- **판정**: ✅ 동의
- **사유**: `Date.now()` 기반 ID는 밀리초 정밀도로 충돌 가능하다. `crypto.randomUUID()`로 교체하는 것이 간단하고 안전하다. ID 충돌로 기존 전략이 덮어씌워지면 실행 중인 전략이 예상과 다른 규칙으로 매매하므로 CRITICAL 등급에 동의한다.
- **추가**: 사용자가 `def.id`를 직접 전달하는 것 자체를 차단하고 서버에서만 생성해야 한다.

### R14-BE-02: Custom Strategy 업데이트 시 활성 인스턴스 미반영 [CRITICAL]

- **판정**: ✅ 동의
- **사유**: 내 P14-T4와 동일한 발견이다. 트레이딩 관점에서 이것은 "사용자 의도 vs 실제 매매 동작의 불일치"라는 가장 위험한 유형의 버그다. CRITICAL에 강하게 동의한다.
- **보완**: hotReload 방식보다는 disable→enable 순환이 더 안전하다. hotReload 시 진행 중인 포지션 상태가 유실될 수 있기 때문이다.

### R14-BE-03: strategyConfigValidator Custom Strategy 검증 불가 [HIGH]

- **판정**: ✅ 동의
- **사유**: 커스텀 전략에 음수 레버리지나 1000% 포지션 사이즈를 설정하면 통과되는 것은 리스크 관리의 첫 번째 방어선 부재다. 하드코딩된 공통 필드 검증(positionSizePercent, leverage, tpPercent, slPercent)이 최소한 필요하다.

### R14-BE-04: CustomRuleStrategy parseFloat [HIGH]

- **판정**: ✅ 동의 — 내 P14-4와 동일 발견.

### R14-BE-05: BotService _handleStrategySignal 비동기 에러 [HIGH]

- **판정**: ✅ 동의 — 내 P14-T7와 동일 발견. 수익 관점에서 유효한 시그널이 조용히 사라지는 것은 기회비용 손실이다.

### R14-BE-06: RiskEngine 이벤트 포워딩 리스너 [HIGH]

- **판정**: ⚠️ 조건부 동의
- **사유**: Engineer가 직접 인정했듯이 현재 싱글턴 패턴에서는 실제 누수가 아니다. LOW로 재분류를 권장한다. 테스트 환경에서의 편의성 개선은 트레이딩 품질에 영향을 주지 않는다.

### R14-BE-07: OrderManager _symbolLocks 메모리 누적 [HIGH]

- **판정**: ⚠️ 조건부 동의 — 내 P14-T11에서 LOW로 분류했다. 심볼당 하나의 Promise 참조이므로 수백 개여도 KB 수준. botService.stop()에서 clear() 추가는 동의하나 HIGH보다는 LOW가 적절.

### R14-BE-08 ~ BE-16: MEDIUM/LOW 항목

- **BE-08 (Backtest 입력 검증)**: ✅ 동의 — startTime > endTime 등 기본적인 입력 검증은 필수.
- **BE-09 (Custom Strategy POST 입력 방어)**: ✅ 동의 — 중첩 깊이 제한과 배열 크기 제한 합리적.
- **BE-10 (PaperEngine SL/TP stale cleanup)**: ✅ 동의 — Paper 모드에서 stale SL/TP가 잘못 트리거되면 백테스트와 라이브 결과가 다르게 보여 혼란 유발.
- **BE-11 (PositionManager dead code)**: ✅ 동의 — dead code 제거는 항상 좋다.
- **BE-12 (SignalFilter _recentSignals 크기 제한)**: ✅ 동의 — 성능 방어.
- **BE-13 (app.js 리스너 라이프사이클)**: ✅ 동의 — 주석만으로 충분.
- **BE-14 (backtestRoutes HTTP 상태 코드)**: ✅ 동의.
- **BE-15 (CustomRuleStrategy 포지션 추적)**: ✅ 동의 — 내 P14-T1과 동일 발견. 이것이 LOW가 아닌 CRITICAL이라는 점 강조. Engineer의 분석은 정확하나 등급이 과소평가됨.
- **BE-16 (DrawdownMonitor 경고 스팸)**: ✅ 동의 — 내 P14-T12와 동일.

### Engineer Deferred 재평가

- WS 재연결 후 재구독: **동의** — SDK 동작에 의존하는 것은 위험.
- 테스트 커버리지 확대: **동의** — CustomRuleStrategy 테스트 특히 중요.
- Socket.io 인증: **동의** — 보안 항목이지만 트레이딩 데이터 노출은 직접적 위험.

---

## UI/UX 제안서 리뷰

### R14-1: StrategyConfigPanel 입력 유효성 검증 [HIGH]

- **판정**: ✅ 동의
- **사유**: 서버측 검증(R14-BE-03)과 클라이언트측 검증은 상호보완적이다. 사용자가 즉각적 피드백을 받으면 무효한 값을 서버에 보내는 빈도가 줄어든다. meta.description tooltip도 트레이딩 초보자에게 매우 유용.

### R14-2: CustomStrategyBuilder 모달 접근성 [HIGH]

- **판정**: ⚠️ 조건부 동의
- **사유**: 접근성 개선은 중요하지만, 트레이딩 관점에서 이 항목은 MEDIUM으로 분류해도 무방하다. 포커스 트랩과 ESC 처리는 UX 품질이며 매매 정확성에 직접 영향은 없다.

### R14-3: PerformanceTabs stale-while-revalidate [MEDIUM]

- **판정**: ✅ 동의
- **사유**: 봇이 장시간 실행 중일 때 전략별 성과 데이터가 갱신되지 않는 것은 트레이더의 의사결정을 방해한다. stale 데이터를 보고 전략을 비활성화/활성화하면 잘못된 판단을 내릴 수 있다. 60초 간격 백그라운드 재조회 + "업데이트됨: HH:MM" 표시에 강하게 동의.

### R14-6: Tabs ARIA 완전 준수 [HIGH]

- **판정**: ⚠️ 조건부 동의
- **사유**: WAI-ARIA 준수는 법적/윤리적으로 바람직하나, 이 트레이딩 봇의 사용자는 대부분 스크린 리더를 사용하지 않는 비장애인 트레이더일 가능성이 높다. MEDIUM으로 분류를 권장.

### R14-10: TradesTable 컬럼 정렬 [MEDIUM]

- **판정**: ✅ 동의
- **사유**: PnL 순 정렬은 "어느 전략이 가장 많이 벌었나/잃었나"를 즉시 확인하는 핵심 기능이다. 시간 역순 기본 정렬도 맞다. 트레이딩 분석에 직접적으로 유용한 UX 개선.

### R14-13: RiskStatusPanel 접근성 강화 [HIGH]

- **판정**: ⚠️ 조건부 동의
- **사유**: `aria-valuetext` 추가는 간단하므로 동의. 다만 색상 외 시각적 단서(아이콘)는 이미 "안전/주의/위험" 텍스트 라벨이 있으므로 중복. MEDIUM으로 충분.

### R14-15: 전략 비교 뷰 [MEDIUM]

- **판정**: ✅ 동의
- **사유**: 멀티전략 운영의 핵심 판단 도구다. 다만 90분 규모이므로 이번 스프린트보다는 다음에 진행하는 것을 권장. batch 조회 API(Engineer에게 요청한 `/api/analytics/compare`)가 선행되어야 효율적.

### R14-5: Dashboard page.tsx 분할 [MEDIUM]

- **판정**: ⚠️ 조건부 동의
- **사유**: 리팩토링이므로 트레이딩 기능에 영향 없음. 중요하나 기능 이슈들이 우선. DEFERRED 유지 권장.

---

## 종합 의견

1. **3명 공통 발견**: CustomRuleStrategy의 parseFloat 사용(T:P14-4, E:R14-BE-04), 포지션 상태 조기 설정(T:P14-1/T1, E:R14-BE-15), _handleStrategySignal .catch()(T:P14-T7, E:R14-BE-05), DrawdownMonitor 스팸(T:P14-T12, E:R14-BE-16)
2. **우선순위 조정 건의**: R14-BE-06(RiskEngine 리스너)은 LOW, R14-BE-07(_symbolLocks)은 LOW, R14-BE-15(CustomRuleStrategy 포지션 추적)은 CRITICAL로 격상
3. **FE 접근성 항목**: 접근성 중요하나 HIGH 3건 중 2건(R14-2, R14-6)은 MEDIUM으로 분류 가능. 대신 PerformanceTabs stale-while-revalidate(R14-3)를 HIGH로 격상 권장 — 트레이딩 의사결정에 직접 영향
