# Round 14 교차 리뷰 -- Engineer

**작성자**: Senior Systems Engineer
**날짜**: 2026-02-18
**기준**: 시스템 무결성, 에러 핸들링, 성능, 보안, 관측성

---

## Trader 제안서 리뷰

### P14-1: AD-37 위반 10개 전략 positionSide→onFill 이동 [CRITICAL]

- **판정**: ✅ 동의
- **사유**: 시그널 emit 전/후에 포지션 상태를 설정하는 것은 주문 거부 시 내부 상태와 실제 상태가 불일치하는 근본적 문제다. 내 R14-BE-15에서 CustomRuleStrategy만 분석했지만, Trader가 10개 전략에서 동일 패턴을 발견한 것은 체계적 수정이 필요함을 의미한다.
- **시스템 관점 보완**:
  1. `StrategyBase.onFill()`에서 공통 `pendingEntry` → 확정 전환 로직을 기본 구현으로 제공하면 10개 전략의 반복 코드를 줄일 수 있다.
  2. fill 객체가 `action` 필드를 반드시 포함하도록 OrderManager에서 보장해야 한다.
  3. 6시간 예상은 적절하다. 전략당 30~40분으로 onFill() 추가 + 기존 상태 설정 코드 이동이 필요하다.

### P14-2: ATR 자체 계산 중복 6개 전략 [MEDIUM]

- **판정**: ⚠️ 조건부 동의
- **사유**: 중복 제거는 시스템 유지보수 관점에서 동의하나, 일부 전략의 ATR period가 IndicatorCache 기본값(14)과 다를 수 있다. IndicatorCache.get(symbol, 'atr', { period: N })이 이미 파라미터를 지원하므로 전환 자체는 가능하지만, **각 전략의 ATR period를 개별 확인**해야 한다.
- **보완**: 전환 전에 각 전략의 자체 ATR 결과와 IndicatorCache ATR 결과를 비교하는 검증 테스트를 추가할 것을 권장.

### P14-3: onFill 패턴 불일치 fill.side vs fill.action [MEDIUM]

- **판정**: ✅ 동의
- **사유**: `fill.action` vs `fill.side` 혼용은 시스템 일관성 위반이다. OrderManager가 fill 이벤트를 emit할 때 `action` 필드를 항상 포함하도록 보장하고, StrategyBase의 JSDoc에 fill 객체 스키마를 명시해야 한다.
- **보완**: fill 객체의 인터페이스를 `@typedef` 또는 JSDoc `@param`으로 명확히 정의하여 전략 개발자가 참조할 수 있게 하자.

### P14-4: CustomRuleStrategy parseFloat [HIGH]

- **판정**: ✅ 동의 — 내 R14-BE-04와 동일 발견. T0 분류에도 동의.

### P14-5: GridStrategy 동시 entry+exit 시그널 [LOW-MEDIUM]

- **판정**: ✅ 동의
- **사유**: SignalFilter의 5ms DUPLICATE_WINDOW 내에서 동일 전략의 두 시그널이 연속 도착하면 두 번째가 차단될 수 있다. 단, entry와 exit의 action이 다르므로(open_long vs close_long) duplicate 필터는 통과한다. 문제는 OrderManager의 per-symbol lock에서 entry가 진행 중일 때 exit가 lock 대기하는 상황.
- **보완**: exchange-side TP를 활용하는 것이 시스템 복잡도 관점에서 더 깔끔하다. T2 분류에 동의.

### P14-6: FundingRate Kelly 승률 정적 [LOW]

- **판정**: ✅ 동의
- **사유**: 동적 Kelly는 흥미로운 개선이나, 통계적으로 유의미한 트레이드 수(최소 30건)가 필요하므로 초기 운영에서는 기본값이 불가피하다. T2 분류에 동의.

### P14-7: QuietRangeScalp leverage 누락 [HIGH]

- **판정**: ✅ 동의 — T0 분류에 동의. R13-2에서 4개 전략 수정 시 이 전략이 누락된 것은 확인이 필요하다.
- **검증**: QuietRangeScalpStrategy의 entry 시그널 emit 코드를 확인하여 leverage 필드 유무를 검증해야 한다.

### P14-8: MacdDivergence trailing 중복 코드 [LOW]

- **판정**: ✅ 동의 — T3 분류 적절. 코드 가독성 이슈.

### P14-9: VwapReversion 세션 길이 [LOW]

- **판정**: ⚠️ 조건부 동의
- **사유**: VWAP 세션 길이 96은 전략 defaultConfig에서 사용자가 변경 가능한 파라미터이다. R13에서 paramMeta에 이미 포함되어 있다면, 기본값을 변경하는 것이 사용자에게 의미가 있을 수 있다. 다만 이것은 전략 성능 튜닝의 영역이지 시스템 버그가 아니다.

### P14-10: AdaptiveRegime parseFloat in confidence [MEDIUM]

- **판정**: ⚠️ 조건부 동의
- **사유**: confidence 값은 금전적 값이 아니므로 mathUtils 전환의 실질적 이점이 없다. 0.5 + 0.25 + 0.15 같은 연산에서 부동소수점 오차가 최종 confidence에 미치는 영향은 무시할 수 있는 수준이다. T3으로 낮추기를 권장.

### Trader Deferred 재평가 의견

- R11-D3 (maxHoldTime) T1 격상: **동의** — 장기 보유 포지션의 펀딩비 누적은 실질적 리스크.
- R12-D4 (ExposureGuard 레버리지 인지) T1 격상: **강하게 동의** — 내 R14-BE-03(커스텀 전략 무검증)과 연관. 사용자가 20x 레버리지를 설정해도 ExposureGuard가 인지 못하면 위험.
- R13-D1 (프리셋 시스템) T2 실행: **동의** — paramMeta 인프라 완성 후 자연스러운 다음 단계.
- R13-D5 (아코디언 재구성) T1 격상: **동의** — FE 측에서도 유사한 제안(R14-1 StrategyConfigPanel 개선)이 있다.

---

## UI/UX 제안서 리뷰

### R14-1: StrategyConfigPanel 입력 유효성 검증 [HIGH]

- **판정**: ✅ 동의
- **사유**: 서버측 검증(R14-BE-03)과 클라이언트측 검증의 이중 방어는 모범 사례다. HTML5 `min/max` 속성만으로는 프로그래밍적 입력(API 직접 호출)을 방어할 수 없으므로 서버측이 반드시 선행되어야 한다.
- **보완**: meta.description tooltip 구현 시, 백엔드 paramMeta에 description이 실제로 채워져 있는지 확인 필요. R13-5에서 추가했으므로 데이터는 있을 것이다.

### R14-2: CustomStrategyBuilder 모달 접근성 [HIGH]

- **판정**: ✅ 동의
- **사유**: DisableModeDialog에서 이미 구현된 접근성 패턴(role="dialog", aria-modal, ESC, focus trap)이 있으므로, CustomStrategyBuilder에 동일 패턴 적용은 일관성 차원에서 필수다. 난이도도 낮다.

### R14-3: PerformanceTabs stale-while-revalidate [MEDIUM]

- **판정**: ✅ 동의
- **사유**: 한 번 로드 후 재조회하지 않는 것은 stale 데이터 문제다. 60초 간격 백그라운드 재조회는 합리적이며, 기존 useAdaptivePolling 패턴과 일관성 있다.

### R14-5: Dashboard page.tsx 분할 [MEDIUM]

- **판정**: ⚠️ 조건부 동의
- **사유**: 310줄은 리팩토링의 시급성이 높지 않다. 기능 추가 시 자연스럽게 분할하는 것을 권장. DEFERRED 유지.

### R14-6: Tabs ARIA 완전 준수 [HIGH]

- **판정**: ✅ 동의
- **사유**: WAI-ARIA Tabs 패턴은 웹 접근성의 기본 요소다. role="tablist" 누락은 명확한 미준수. useId()를 활용한 자동 ID 생성도 적절.

### R14-8: useAdaptivePolling 이중 리스너 [MEDIUM]

- **판정**: ✅ 동의
- **사유**: 동일 이벤트에 2개 리스너 등록은 불필요한 코드 복잡성이다. 단일 useEffect로 통합하는 것이 깔끔하며, fetchFn을 ref로 래핑하여 리스너 재등록을 방지하는 것도 적절.

### R14-10: TradesTable 컬럼 정렬 [MEDIUM]

- **판정**: ✅ 동의 — 정렬은 기본적인 테이블 UX.

### R14-12: Quick Stats Bar 과밀 [MEDIUM]

- **판정**: ✅ 동의 — flex-wrap + 구분자 문제는 실제 사용 시 보기 불편. 별도 줄 분리가 깔끔.

### R14-13: RiskStatusPanel 접근성 [HIGH]

- **판정**: ✅ 동의 — aria-valuetext 추가는 간단하고 효과적.

### R14-15: 전략 비교 뷰 [MEDIUM]

- **판정**: ⚠️ 조건부 동의
- **사유**: 90분 규모의 신규 기능은 이번 스프린트 범위를 초과한다. batch API가 선행되어야 하므로 DEFERRED로 유지하되, 다음 라운드에서 구현하는 것을 권장.

---

## 종합 의견

1. **3명 공통 핵심 이슈**: CustomRuleStrategy의 (a) parseFloat 사용, (b) 포지션 상태 선행 설정, (c) _handleStrategySignal .catch() 누락. 이 3가지는 이번 스프린트에서 반드시 수정해야 한다.
2. **Trader의 P14-1 (10개 전략 AD-37 위반)**은 가장 영향 범위가 큰 수정이다. 6시간 예상이지만 시스템 안정성 관점에서 필수.
3. **FE 접근성**: Tabs ARIA(R14-6)와 CustomStrategyBuilder(R14-2)는 동의하나, 트레이딩 봇의 핵심 가치는 매매 정확성이므로 PerformanceTabs stale 데이터(R14-3)를 HIGH로 격상하는 Trader 의견에 동의.
4. **BE 우선순위 조정**: R14-BE-06(RiskEngine 리스너)은 Trader 의견대로 LOW로 재분류. R14-BE-07(_symbolLocks)도 LOW로.
