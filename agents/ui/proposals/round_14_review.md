# Round 14 교차 리뷰 -- UI/UX

**작성자**: Senior UI/UX Engineer
**날짜**: 2026-02-18
**기준**: UX 일관성, 프론트엔드 성능, 접근성, 사용자 정보 정확성

---

## Trader 제안서 리뷰

### P14-1: AD-37 위반 10개 전략 positionSide→onFill 이동 [CRITICAL]

- **판정**: ✅ 동의
- **사유**: 포지션 상태가 실제와 불일치하면 프론트엔드에서 표시되는 정보도 불일치한다. PositionManager는 거래소 실제 상태를 반영하지만, 전략 내부 상태는 별도로 관리되므로, 두 데이터 소스가 다른 결과를 보여줄 수 있다. 이 불일치는 사용자 신뢰를 크게 떨어뜨린다.
- **FE 영향**: P14-1 수정 시 `pendingEntry` 상태가 추가되면, StrategyCard/StrategyHub에서 "체결 대기 중" 상태를 amber 배지로 표시하는 것이 필요하다. 기존 3-way 배지(active/grace/inactive)에 "pending" 상태 추가.

### P14-2: ATR 자체 계산 중복 [MEDIUM]

- **판정**: ✅ 동의
- **사유**: FE와 직접 관련 없지만, 일관된 ATR 계산은 전략 간 비교(R14-15 전략 비교 뷰)의 전제조건이다. 다른 ATR 값을 사용하는 전략 간 성과 비교는 공정하지 않다.

### P14-3: onFill 패턴 불일치 [MEDIUM]

- **판정**: ✅ 동의
- **사유**: fill 객체 스키마가 명확해지면 FE에서 트레이드 이벤트를 표시할 때도 일관된 필드를 참조할 수 있다.

### P14-4: CustomRuleStrategy parseFloat [HIGH]

- **판정**: ✅ 동의 — 정밀도 문제는 사용자가 설정한 TP/SL이 정확히 작동한다는 신뢰에 직결.

### P14-7: QuietRangeScalp leverage 누락 [HIGH]

- **판정**: ✅ 동의
- **사유**: FE의 StrategyConfigPanel에서 사용자가 leverage를 설정해도 실제로 적용되지 않으면 UI와 실제 동작의 불일치. 사용자 신뢰 측면에서 T0 동의.

### P14-5: GridStrategy 동시 시그널 [LOW-MEDIUM]

- **판정**: ✅ 동의 — SignalFeed에서 같은 시간에 entry + exit가 표시되면 혼란스러울 수 있으나, T2로 충분.

### P14-6, P14-8, P14-9, P14-10: 낮은 우선순위 항목

- **P14-6 (FundingRate Kelly)**: ✅ 동의 — T2. FE 영향 없음.
- **P14-8 (MacdDivergence trailing)**: ✅ 동의 — T3. FE 영향 없음.
- **P14-9 (VwapReversion 세션 길이)**: ✅ 동의 — T2. defaultConfig 변경은 paramMeta에 반영되므로 FE 자동 대응.
- **P14-10 (confidence parseFloat)**: ✅ 동의 — T3. FE 영향 없음.

### Trader Deferred 재평가 의견

- R13-D1 (프리셋 시스템) T2 실행: **강하게 동의** — conservative/balanced/aggressive 3단 프리셋 UI는 트레이딩 초보자의 진입 장벽을 크게 낮춘다. FE에서 프리셋 선택 드롭다운 + "현재 설정과 차이" 표시를 구현할 준비가 되어 있다.
- R13-D5 (아코디언 재구성) T1 격상: **강하게 동의** — R13의 paramMeta group(signal/indicator/risk/sizing)을 FE에서 4개 아코디언으로 표시하면 30+ 파라미터가 있는 전략의 UX가 크게 개선된다.
- R11-D3 (maxHoldTime) T1 격상: **동의** — FE에서 "장기 보유 경고" 배너를 표시하는 것이 자연스럽다.
- R12-D4 (ExposureGuard 레버리지 인지) T1 격상: **동의** — RiskStatusPanel에서 "실제 노출"을 표시하는 데 필요한 백엔드 데이터.

---

## Engineer 제안서 리뷰

### R14-BE-01: CustomStrategyStore ID 충돌 + Prototype Pollution [CRITICAL]

- **판정**: ✅ 동의
- **사유**: ID 충돌로 전략이 덮어씌워지면 CustomStrategyBuilder에서 사용자가 만든 전략이 사라진 것처럼 보인다. UX 관점에서 데이터 손실은 최악의 경험이다.

### R14-BE-02: Custom Strategy 업데이트 시 활성 인스턴스 미반영 [CRITICAL]

- **판정**: ✅ 동의
- **사유**: "저장 성공" 메시지를 보여주고 실제로는 반영되지 않는 것은 UX 신뢰도의 근본적 문제다. FE에서 봇 실행 중 수정 시 "변경사항은 전략 재활성화 후 적용됩니다" 경고 배너를 표시해야 한다.
- **FE 구현**: PUT 응답에 `{ needsReactivation: true }` 포함 시, CustomStrategyBuilder에서 노란 경고 배너 + "재활성화" 버튼을 표시.

### R14-BE-03: Custom Strategy config 검증 미적용 [HIGH]

- **판정**: ✅ 동의 — 서버측 검증은 FE 검증의 후방 방어선.

### R14-BE-04: parseFloat [HIGH]

- **판정**: ✅ 동의 — 3명 공통 발견.

### R14-BE-05: _handleStrategySignal 비동기 에러 [HIGH]

- **판정**: ✅ 동의 — 에러 발생 시 FE SignalFeed에 실패 시그널이 표시되면 사용자가 문제를 인지할 수 있다.

### R14-BE-06: RiskEngine 이벤트 포워딩 리스너 [HIGH]

- **판정**: ⚠️ 조건부 동의 — Trader 의견처럼 LOW로 분류 가능. FE 영향 없음.

### R14-BE-07: OrderManager _symbolLocks [HIGH]

- **판정**: ⚠️ 조건부 동의 — LOW로 분류 가능. FE 영향 없음.

### R14-BE-08: Backtest 입력 검증 [MEDIUM]

- **판정**: ✅ 동의 — 서버측 검증 강화와 병행하여 FE BacktestForm에서도 동일 범위 검증을 적용해야 한다. R11-FE-10에서 이미 일부 검증이 있으나 시간 범위/자본 범위 검증은 추가 필요.

### R14-BE-09: Custom Strategy POST 입력 방어 [MEDIUM]

- **판정**: ✅ 동의 — FE에서 indicators 10개/conditions 20개 제한을 CustomStrategyBuilder에 적용하면 서버 부하도 줄어든다.

### R14-BE-10: PaperEngine SL/TP stale [MEDIUM]

- **판정**: ✅ 동의 — Paper 모드에서 잘못된 청산이 발생하면 사용자가 Paper 모드의 정확성을 의심하게 된다.

### R14-BE-11 ~ BE-16: 나머지 항목

- **BE-11 (dead code)**: ✅ 동의.
- **BE-12 (SignalFilter 크기 제한)**: ✅ 동의.
- **BE-13 (app.js 주석)**: ✅ 동의.
- **BE-14 (HTTP 상태 코드)**: ✅ 동의 — FE api-client에서 에러 처리가 HTTP 상태 코드 기반이므로 중요.
- **BE-15 (CustomRuleStrategy 포지션 추적)**: ✅ 동의 — Trader 의견대로 CRITICAL 격상에 동의.
- **BE-16 (DrawdownMonitor 스팸)**: ✅ 동의 — FE 토스트 시스템에서도 동일 타입 토스트 디바운싱이 필요하나, 서버측에서 먼저 제어하는 것이 근본적.

---

## 종합 의견

1. **이번 스프린트 핵심**: (a) CustomRuleStrategy parseFloat 수정, (b) onFill 패턴 수정(P14-1), (c) 커스텀 전략 활성 인스턴스 미반영 수정. 이 3가지가 사용자 경험에 가장 큰 영향.
2. **FE 우선순위 재조정**: PerformanceTabs stale-while-revalidate를 HIGH로 격상하는 Trader 의견에 동의. 대신 Tabs ARIA(R14-6)는 MEDIUM으로.
3. **Deferred 실행 추천**: R13-D5(아코디언)와 R13-D1(프리셋)은 R13 인프라를 활용하는 자연스러운 확장이므로 R14에서 구현할 가치가 있다.
4. **FE 작업 추가**: CustomStrategyBuilder 관련 경고 배너(R14-BE-02), BacktestForm 범위 검증 강화(R14-BE-08), indicators/conditions 크기 제한(R14-BE-09)이 이번 스프린트 FE 범위에 포함되어야 한다.
