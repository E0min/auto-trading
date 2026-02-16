# Round 7 교차 리뷰 -- UI/UX

**작성자**: Senior UI/UX Engineer
**작성일**: 2026-02-16
**기준**: 내 제안서(UI Round 7)와 비교하여, Trader/Engineer 제안이 프론트엔드 구현 가능성과 사용자 경험에 미치는 영향을 평가

---

## Trader 제안서 리뷰

### A-1. hysteresisMinCandles 3 -> 15
- **판정**: ⚠️ 조건부 동의
- **사유**: 노이즈 필터링 관점에서 상향은 동의하나, **15는 UI 반응성 측면에서 과도하다**. 사용자가 대시보드에서 레짐 변경을 관찰할 때, 15분간 "대기 중(pending)" 상태가 지속되면 "시스템이 반응하지 않는다"는 인상을 준다. Engineer의 8분 제안이 UX와 안정성의 균형점에 더 가깝다. 다만, 이 값은 내부 로직이므로 **pending 상태를 시각적으로 잘 전달한다면** 15분도 수용 가능하다. 핵심은 "왜 아직 안 바뀌는지"를 사용자가 이해할 수 있어야 한다는 것이다.
- **보완**: pending 캔들 카운트 (`3/15 캔들 확인 중`)를 MarketRegimeIndicator에 표시하여, 대기가 의도된 동작임을 명시해야 한다. 내 P0-2 제안과 일치.

### A-2. 레짐 전환 쿨다운 5분
- **판정**: ✅ 동의
- **사유**: timestamp 기반 구현은 타이머 누수 위험이 없고, 프론트엔드에서 `cooldownRemaining`을 표시하기 쉽다. 5분은 합리적인 기본값이며, 사용자에게 "쿨다운 중"이라는 시각적 피드백(파란색 배지)을 제공하면 충분히 이해 가능하다.
- **FE 요구**: 쿨다운 상태를 API 응답에 포함해야 한다 (`cooldownActive: boolean`, `cooldownRemaining: number`). 내 P0-2에서 이미 설계 완료.

### A-3. hysteresis 가중치 0.10 -> 0.15
- **판정**: ✅ 동의
- **사유**: 순수 백엔드 로직 변경으로 FE에 직접 영향 없음. 레짐 전환 빈도 감소는 대시보드 안정성(UI 깜빡임 감소, 전략 상태 변경 빈도 감소)에 긍정적 영향. 전환이 줄어들면 사용자가 "전환이 의미 있다"고 신뢰할 수 있다.

### A-4. RegimeOptimizer 범위 확장 [10, 30]
- **판정**: ⚠️ 조건부 동의
- **사유**: 최적화 범위 확장 자체는 동의하나, 범위 하한 10은 A-1의 기본값 15와 가까워 최적화 여지가 제한적이다. Engineer의 [5, 15]와 Trader의 [10, 30]이 상충하므로, **합의 범위 [8, 25] 정도**가 적절해 보인다. 다만, 이 파라미터는 FE에 직접 노출되지 않으므로 UX 관점에서는 중요도 낮음.
- **보완**: 향후 P2-2(파라미터 설정 UI)에서 이 범위가 슬라이더 min/max를 결정하므로, 최종 합의 값을 명확히 해야 한다.

### B-1. 전략별 카테고리 기반 gracePeriod 차별화
- **판정**: ⚠️ 조건부 동의
- **사유**: 카테고리별 차별화된 유예기간(5분/10분/15분)은 트레이딩 로직으로는 타당하지만, **UI 복잡도를 증가**시킨다.
  - 사용자가 전략 카드를 볼 때, 유예기간 남은 시간이 전략마다 다르면 "왜 이 전략은 3분이고 저 전략은 12분이지?"라는 혼란이 발생한다.
  - **완화책**: 전략 카드의 유예 배지 툴팁에 "이 전략의 유예기간: 10분 (price-action 카테고리)"를 명시하면 해결 가능.
  - Engineer의 고정 3분 제안은 단순하지만, Trader 분석의 "최소 유효 매매 사이클" 근거가 설득력 있다.
- **보완**: 유예기간이 전략 metadata에 포함되어야 하고, API 응답에서 `gracePeriodMs`와 `graceExpiresAt`을 모두 내려줘야 한다. 사용자가 "총 유예기간"과 "남은 시간"을 동시에 파악해야 맥락이 형성된다.

### B-2. 유예기간 만료 타이머 (10초 폴링)
- **판정**: ❌ 반대
- **사유**: 10초 주기 `setInterval`로 유예 만료를 체크하는 방식은 **최대 10초 지연**을 유발한다. 유예기간이 만료되었는데 10초간 전략이 여전히 grace 상태로 표시되면 프론트엔드와 백엔드 상태가 불일치한다.
- **대안**: Engineer의 B-1 방식(`setTimeout` per strategy)이 정확도 면에서 우월하다. 전략별 타이머는 정확한 시점에 발화하므로 FE에서 `graceExpiresAt`을 기준으로 카운트다운할 때도 BE와 정확히 동기화된다. `timer.unref()`와 `stop()` 시 `clearTimeout()` 패턴으로 누수도 방지된다.

### B-3. 유예기간 중 레짐 복귀 시 취소
- **판정**: ✅ 동의
- **사유**: 이것은 UX 관점에서 매우 중요하다. 유예 중인 전략이 다시 활성으로 돌아갈 수 있다는 것은 사용자에게 "시스템이 상황에 적응한다"는 신뢰감을 준다. FE에서는 grace -> active 전이 시 짧은 성공 애니메이션(초록색 flash)으로 "복귀 완료"를 알려주면 좋다. `strategy:grace_cancelled` 소켓 이벤트를 수신하여 처리한다.

### 전략별 최소 유효 매매 사이클 분석 테이블
- **판정**: ✅ 동의
- **사유**: 이 테이블은 유예기간 값의 근거로서 매우 유용하다. FE 관점에서, 이 데이터를 StrategyDetail에 "최소 유효 사이클" 정보로 노출하면 사용자가 "왜 이 전략은 유예기간이 10분인지" 이해할 수 있다. 다만 R7 스코프에서는 P2 이하.

### 포지션 고아화 분석 (발견 사항 4)
- **판정**: ✅ 동의 (분석으로서)
- **사유**: 고아 포지션 문제는 트레이더에게 가장 위험한 상황이다. FE 관점에서, 유예기간 중인 전략의 열린 포지션을 대시보드에서 **특별 하이라이트** 해야 한다. "이 포지션은 유예기간 전략이 관리 중 -- SL/TP 정상 작동"이라는 안심 메시지가 필요하다. 이 부분은 내 P1-3(상태 전이 히스토리)과 연결된다.

### Trader -> UI 요청 사항 (3항목)
- **판정**: ✅ 동의
- **사유**: Trader가 요청한 3항목(3-way 배지, 쿨다운 표시, gracePeriodMs 표시)은 내 P0-1, P0-2, P1-1과 정확히 일치한다. 이미 설계 완료.

---

## Engineer 제안서 리뷰

### A-1. hysteresisMinCandles 3 -> 8 + RegimeOptimizer [5, 15]
- **판정**: ✅ 동의
- **사유**: 8분은 Trader의 15분보다 **FE 반응성에 유리**하다. 사용자 대시보드에서 레짐 pending 상태가 8분이면 수용 가능한 대기 시간이다. 15분은 "고장난 건 아닌가?" 우려를 유발할 수 있는 반면, 8분은 "잠시 확인 중"으로 인식된다. 다만, Trader의 근거(전략 최소 유효 사이클 중앙값 ~20분)도 타당하므로, **쿨다운 5분과 결합 시 총 13분(8+5) vs Trader의 20분(15+5)** 차이를 어떻게 해석하느냐의 문제다.
- **권장**: 기본값 8로 시작하되, RegimeOptimizer 범위를 [5, 20]으로 넓혀 자동 최적화가 Trader의 15에 도달할 수 있게 여지를 두는 것을 제안한다.

### A-2. 레짐 전환 쿨다운 (timestamp 기반)
- **판정**: ✅ 동의
- **사유**: Trader와 동일한 5분 쿨다운이지만, Engineer의 구현 설계가 더 구체적이다. 특히 **timestamp 비교 방식을 명시적으로 권장**한 점이 좋다. FE에서 `Date.now() - lastTransitionTs`를 받아 쿨다운 잔여 시간을 직접 계산할 수 있어 폴링 주기와 무관하게 정확한 표시가 가능하다.
- **FE 참고**: `lastTransitionTs`를 API에 노출해달라. `cooldownRemaining`만 내려주면 폴링 사이에 오차가 누적되지만, `lastTransitionTs`와 `transitionCooldownMs`를 함께 내려주면 FE에서 실시간 계산이 가능하다.

### A-3. 히스테리시스 동적 보너스 (decay)
- **판정**: ⚠️ 조건부 동의
- **사유**: 전환 직후 보너스를 2배로 올리는 아이디어는 ping-pong 방지에 효과적이나, **FE에서 이 동적 보너스를 어떻게 시각화할지**가 불명확하다. FactorBreakdown 컴포넌트에서 hysteresis factor의 실제 적용 가중치를 보여줘야 하는데, 동적 값이면 "왜 이 팩터가 0.20이다가 0.15로 내려갔지?"라는 혼란이 생길 수 있다.
- **보완**: API 응답에서 `effectiveHysteresisBonus`를 명시적으로 반환하고, FactorBreakdown에서 "히스테리시스 (동적 보너스: x1.5)" 형태로 현재 배율을 표시해야 한다. P2 우선순위는 적절하다.

### B-1. 유예기간 핵심 구조 (StrategyRouter 중심)
- **판정**: ⚠️ 조건부 동의
- **사유**: Engineer의 설계는 **StrategyRouter가 유예 상태를 완전히 관리**하는 구조다. 반면 Trader는 **strategyBase에 grace 상태를 내장**하는 방식이다. UX 관점에서:
  - Engineer 방식: `strategyRouter.getGracePeriodStrategies()` -> 한 곳에서 모든 grace 전략을 조회 가능. FE API 통합이 간단.
  - Trader 방식: `strategy.isInGracePeriod()` -> 각 전략이 자체 상태를 가짐. API 응답에서 전략별 `graceExpiresAt`을 직접 반환 가능.
  - **FE 선호**: API 응답 설계 관점에서는 **두 방식 모두** `routerState` + `graceExpiresAt` 필드를 제공할 수 있으므로 큰 차이 없다. 다만, **timer.unref()** 패턴과 **stop() 시 clearTimeout 보장**은 Engineer 설계가 더 견고하다.
- **보완**: 유예기간 기본값에 대한 Trader-Engineer 간 불일치를 해결해야 한다. Engineer는 고정 3분, Trader는 카테고리별 5~15분. 내 제안: **기본값은 전략 metadata의 `gracePeriodMs`를 따르되**, 전략에 값이 없으면 StrategyRouter의 기본값(3분)을 fallback으로 사용. 이렇게 하면 두 방식이 호환된다.

### B-2. 유예 중 진입 차단 (방법 1 vs 방법 2)
- **판정**: ✅ 동의 (방법 1 권장에 동의)
- **사유**: StrategyRouter가 grace 전략 목록을 제공하고 BotService가 진입을 차단하는 방식(방법 1)은 FE에서도 깔끔하다. `getGracePeriodStrategies()`의 결과를 API에 노출하면, FE에서 전략 리스트 렌더링 시 별도 호출 없이 grace 상태를 판별할 수 있다.
- **FE 참고**: 방법 2(strategyBase에 플래그)는 18개 전략 모두의 `isInGracePeriod()`를 순회해야 하지만, 방법 1은 Map 하나만 조회하면 된다. API 응답 크기도 작다.

### B-3. 유예 타이머 동시성 보호
- **판정**: ✅ 동의
- **사유**: 6가지 레이스 컨디션 시나리오 분석이 매우 체계적이다. 특히 "유예 중 사용자가 disableStrategy" 케이스는 FE에서 직접 트리거할 수 있는 시나리오이므로 반드시 보호해야 한다. 사용자가 대시보드에서 전략을 수동 비활성화할 때, 유예 타이머가 잔존하면 나중에 unexpected deactivation 이벤트가 발화되어 **UI가 실제 상태와 불일치**한다.
- **FE 참고**: grace_cancelled 소켓 이벤트와 deactivated 이벤트의 순서가 보장되어야 한다. 동시에 도착하면 FE 상태가 flickering한다. 이벤트에 `reason` 필드가 있으면 FE에서 적절히 처리 가능.

### B-4. BotService.disableStrategy 통합
- **판정**: ✅ 동의
- **사유**: public 메서드 `cancelGracePeriod(name)` 추가 방식이 더 깔끔하다. `_cancelGrace`는 private prefix이므로 외부 호출은 설계 위반이다. FE에서 `/api/bot/strategies/:name/disable` 호출 시 BE 내부적으로 grace 정리까지 완료되면, FE는 추가 처리 불필요.

### C-1. 레짐 전환 빈도 메트릭
- **판정**: ✅ 동의
- **사유**: `transitionsLastHour`, `totalTransitions`, `lastTransitionTs`, `cooldownActive` 필드는 내 P1-2(전환 빈도 경고 인디케이터)를 구현하는 데 **정확히 필요한 데이터**다. 이 4개 필드가 `getContext()` 응답에 포함되면 FE에서 별도 계산 없이 바로 시각화 가능.
- **FE 매핑**:
  - `transitionsLastHour` -> RegimeTimeline의 빈도 배지 (안정/빈번/과다)
  - `cooldownActive` -> MarketRegimeIndicator의 쿨다운 아이콘
  - `lastTransitionTs` -> 쿨다운 잔여 시간 계산

### C-2. StrategyRouter 유예 상태 노출 (getStatus 확장)
- **판정**: ✅ 동의
- **사유**: `gracePeriods` 배열에 `{ name, regime, startedAt, remainingMs }`를 포함하는 것은 FE에 이상적이다. 다만 `remainingMs`는 API 호출 시점 기준이므로 폴링 간격에 따라 오차가 있다.
- **보완**: `graceExpiresAt` (ISO timestamp)을 추가로 내려주면 FE에서 `setInterval`로 정확한 카운트다운이 가능하다. `remainingMs`보다 절대 시간이 FE 계산에 유리하다.

### C-3. Socket.io FE 이벤트
- **판정**: ⚠️ 조건부 동의
- **사유**: 3개 이벤트(`grace_started`, `grace_cancelled`, `grace_expired`) 자체는 좋으나, **이벤트 이름 규칙이 기존과 불일치**한다. 현재 `SOCKET_EVENTS`에는 `bot:status_update`, `market:regime_update` 등 `namespace:action` 형태를 사용한다. `strategy:grace_started`는 이 규칙을 따르고 있으나, Trader의 `router:regime_switch` 이벤트 내 `graceStarted[]` 배열과 중복된다.
- **보완**: 두 가지 접근 중 하나를 선택해야 한다:
  1. **개별 이벤트**: `strategy:grace_started` 등 -- 실시간 반응에 유리 (push)
  2. **통합 이벤트**: `router:regime_switch`에 grace 정보 포함 -- 폴링 기반 UI와 호환

  FE 관점에서는 **개별 이벤트(push)**가 카운트다운 시작점을 정확히 잡을 수 있어 우월하다. 통합 이벤트는 보조로 사용.

### D-1. 통합 파라미터 구조 + API 노출
- **판정**: ✅ 동의
- **사유**: `GET /api/bot/regime-params`와 `PATCH /api/bot/regime-params` 엔드포인트는 향후 P2-2(파라미터 설정 UI)의 기반이 된다. 현재 R7에서 GET만 구현하고, PATCH는 P2로 미루는 것이 안전하다. 잘못된 파라미터 변경은 시스템 안정성에 직결되므로 FE 설정 UI에 **강력한 경고 + 확인 모달**이 필수다.

### Engineer -> UI 요청 사항 (3항목)
- **판정**: ✅ 동의
- **사유**:
  1. 레짐 상태 표시 개선: 내 P0-2와 정확히 일치. 이미 설계 완료.
  2. 유예 상태 시각 표시: 내 P0-1의 amber 배지 + 카운트다운과 일치.
  3. 레짐 타임라인: 내 P1-2와 일치. `getRegimeHistory()` 데이터는 이미 FE에서 사용 중(RegimeTimeline 컴포넌트).

### Engineer 제안의 고정 유예기간 3분에 대한 UX 관점
- **판정**: ⚠️ 우려
- **사유**: 3분은 **대부분의 전략에 불충분**하다. Trader 분석에 따르면 최소 유효 매매 사이클이 10~120분 범위이며, 3분 유예는 SL/TP 정리에도 빡빡하다. 사용자가 유예 카운트다운이 3분인데 포지션 청산이 안 된 채 전략이 비활성화되면 "유예기간이 왜 이렇게 짧지?"라는 불만이 나온다.
- **권장**: 기본값 5분(최소), 전략 metadata 우선 적용 패턴. Engineer의 `_graceMs` 변수를 유지하되, 전략 metadata에 `gracePeriodMs`가 있으면 해당 값을 우선 사용하는 Trader 제안과 결합.

---

## 종합 의견

### 핵심 이견 사항

| 항목 | Trader | Engineer | UI 관점 권장 |
|------|--------|----------|------------|
| hysteresisMinCandles | 15 | 8 | **10** (절충. FE 반응성 + 노이즈 필터링 균형) |
| RegimeOptimizer 범위 | [10, 30] | [5, 15] | **[5, 20]** (자동 최적화 여지 확대) |
| 유예기간 기본값 | 카테고리별 5~15분 | 고정 3분 | **카테고리별 차별화 + StrategyRouter fallback 5분** |
| 유예 만료 감지 | 10초 polled setInterval | 전략별 setTimeout | **setTimeout** (정확도 우월, FE 동기화 용이) |
| 유예 상태 관리 위치 | strategyBase 내장 | StrategyRouter 중앙 관리 | **StrategyRouter 중앙 관리 + 전략 metadata 유예기간값** |

### 권장 절충안

1. **hysteresisMinCandles**: 기본값 **10**으로 시작. 8(Engineer)과 15(Trader) 사이이며, 10분 pending은 FE에서 "확인 중" 표시로 충분히 수용 가능. RegimeOptimizer 범위 [5, 20]으로 자동 탐색 허용.

2. **유예기간 구조**: Engineer의 StrategyRouter 중앙 관리 패턴(Map + setTimeout + clearTimeout)을 기본 골격으로 채택하되, **유예기간 길이는 전략 metadata의 `gracePeriodMs`를 우선 적용**. metadata에 값이 없으면 StrategyRouter의 기본값(5분)을 fallback.

3. **FE API 계약**: 아래 필드가 `/api/bot/strategies` 응답에 포함되어야 한다:
   ```json
   {
     "name": "MaTrend",
     "active": true,
     "routerState": "grace",
     "graceExpiresAt": "2026-02-16T14:26:00Z",
     "gracePeriodMs": 300000,
     "graceReason": "regime_mismatch"
   }
   ```

4. **FE API 계약 (레짐)**: `/api/bot/status` 또는 별도 엔드포인트에서:
   ```json
   {
     "regime": "ranging",
     "confidence": 0.72,
     "pendingRegime": "trending_up",
     "pendingCount": 4,
     "hysteresisRequired": 10,
     "cooldownActive": false,
     "lastTransitionTs": 1739712360000,
     "transitionCooldownMs": 300000,
     "transitionsLastHour": 2
   }
   ```

5. **Socket 이벤트 전략**: 개별 push 이벤트(`strategy:grace_started`, `strategy:grace_cancelled`, `strategy:deactivated`)를 주 채널로 사용하고, `router:regime_switch` 통합 이벤트는 보조(상태 동기화 fallback)로 유지.

### 구현 순서 권장 (FE 관점)

1. **BE 먼저**: A-1(hysteresis 상향) + A-2(쿨다운) -> B-1(유예기간 구조) + B-2(진입 차단) + C-1(메트릭) + C-2(상태 노출)
2. **FE 다음**: P0-3(소켓 이벤트 수신) -> P0-1(3-way 배지) -> P0-2(pending/cooldown 표시)
3. **FE 다음 다음**: P1-1(카운트다운) -> P1-2(빈도 경고) -> P1-3(상태 히스토리)

BE API가 준비되지 않으면 FE 구현이 시작될 수 없으므로, **BE P0 완료가 critical path**이다.

### 최종 판단

Trader와 Engineer의 분석은 모두 정확하고 보완적이다. Trader는 "왜 문제인지(트레이딩 영향)"를, Engineer는 "어떻게 해결할지(구현 설계)"를 잘 다루고 있다. UX 관점에서 가장 중요한 것은 **유예기간 동안 사용자에게 "무엇이 일어나고 있는지" 충분히 전달하는 것**이다. amber 배지, 카운트다운, pending 레짐 표시, 쿨다운 인디케이터 -- 이 4가지 시각 요소가 모두 구현되면, hysteresisMinCandles가 8이든 15이든 사용자 경험에 큰 차이가 없다. 투명하게 보여주면 대기 시간은 수용된다.
