# Round 13 교차 리뷰 — Engineer

**Reviewer**: Senior Systems Engineer
**Date**: 2026-02-17
**Review Scope**: 시스템 무결성, 런타임 안전성, API 설계 일관성, 파일 I/O 안정성, 모듈화 아키텍처

---

## Trader 제안서 리뷰

### P13-1: 전략 설명 메타데이터 구조 확장
- **판정**: ✅ 동의
- **사유**: `docs` 객체를 `static metadata`에 위치시키는 설계는 코드-문서 동기화 관점에서 최선이다. 내 P-1 제안과 구조가 거의 동일하며, Trader 제안이 `entry.long`/`entry.short`를 배열로 정의한 점은 프론트엔드 렌더링에 더 유리하다. 내 제안의 문자열 형태(`entry.long: '조건 설명'`)보다 배열 형태(`entry.long: ['조건1', '조건2']`)를 채택하는 것을 권장한다. `riskReward`, `strengths`, `weaknesses`, `suitableFor` 필드도 유용하다.

### P13-2: 전략 요약 카드 + 동작 시각화 UI
- **판정**: ⚠️ 조건부 동의
- **보완 사항**:
  1. "현재 어떤 조건이 충족/미충족인지 실시간" 표시(항목 2)는 전략 내부 상태를 외부로 노출하는 새 API가 필요하다. 이는 P13-8과 범위가 겹치므로, Round 13에서는 **정적 설명**만 먼저 구현하고, 실시간 조건 체크는 Round 14로 분리하는 것이 안전하다.
  2. "리스크 파라미터 요약"(항목 3)에서 "현재가 기준 SL/TP 가격"을 계산하려면 전략의 `currentConfig`와 현재 포지션의 entryPrice가 필요하다. GET /strategies 응답에 `runtime.currentConfig`를 포함하는 내 P-3 제안이 선행되어야 한다.
  3. 이 항목의 예상 시간(6h)은 정적 설명 렌더링만이면 적절하지만, 실시간 조건 체크까지 포함하면 12h+ 소요될 것이다.

### P13-3: 하드코딩된 레버리지 제거 + config 참조로 통일
- **판정**: ✅ 동의 (즉시 수정 필요)
- **사유**: 코드를 직접 확인한 결과, 다음 전략에서 시그널에 레버리지가 **리터럴 문자열로 하드코딩**되어 있다:
  - `maTrendStrategy.js:348,394` — `leverage: '3'`
  - `bollingerReversionStrategy.js:319,358` — `leverage: '3'`
  - `SupertrendStrategy.js:705,751` — `leverage: '5'`
  - `fundingRateStrategy.js:233,280,468,508` — `leverage: '3'`
  - 반면 `RsiPivotStrategy`는 시그널에 leverage 필드 자체를 포함하지 않음 (defaultConfig에만 존재)
- **추가 고려**: 수정 시 `leverage: String(this.config.leverage) || '3'` 형태로 해야 한다. `this.config.leverage`가 숫자(3)일 수도 있고 문자열('3')일 수도 있으므로 `String()` 변환을 반드시 적용해야 하며, 모든 금액 관련 값은 String 타입이라는 프로젝트 규약에 부합해야 한다. 또한 `RsiPivotStrategy`처럼 시그널에 leverage를 아예 포함하지 않는 전략도 있으므로, OrderManager가 leverage를 어떻게 결정하는지 (시그널 우선 vs config 폴백) 경로를 통일하는 것이 선행되어야 한다.

### P13-4: 글로벌 리스크 파라미터 UI
- **판정**: ✅ 동의
- **사유**: `PUT /api/bot/risk-params` 엔드포인트가 이미 존재하며 (`botRoutes.js:82-96`), `riskEngine.updateParams()`가 파라미터를 CircuitBreaker/ExposureGuard/DrawdownMonitor에 라우팅한다. 프론트엔드 UI만 추가하면 된다. 단, **현재 이 엔드포인트도 입력 검증이 없다** — `maxPositionSizePercent: '999'` 같은 값이 그대로 적용될 수 있다. 내 P-2a 검증 로직과 병행 적용이 필요하다.

### P13-5: 전략 프리셋 시스템
- **판정**: ⚠️ 조건부 동의
- **보완 사항**:
  1. **런타임 안전성**: 프리셋 적용 시 `globalOverrides`가 riskEngine에, `strategyOverrides`가 각 전략의 updateConfig에 적용되는데, 이 두 작업이 원자적이어야 한다. 전략 config만 업데이트되고 riskEngine 파라미터 업데이트가 실패하면 불일치 상태가 된다. 프리셋 적용은 하나의 트랜잭션으로 처리하고, 부분 실패 시 전체 롤백하는 메커니즘이 필요하다.
  2. **aggressive 프리셋의 `maxTotalExposurePercent: '50'`은 위험**하다. 현재 기본값(30%)의 거의 2배이며, 5~7개 전략이 동시에 포지션을 열면 총 자본의 절반이 노출된다. 이 값은 최대 40%로 제한하거나, 적용 시 사용자에게 명시적 경고를 표시해야 한다.
  3. **프리셋 데이터 위치**: `backend/src/services/strategyPresets.js`를 신규 파일로 생성하는 것은 괜찮으나, 이 파일이 DI 그래프에 어떻게 주입되는지 명확히 해야 한다. BotService에 직접 require하면 결합도가 높아지므로, botRoutes에서 import하여 API 레벨에서 처리하는 것을 권장한다.

### P13-6: MaTrend 타임프레임 버그 수정
- **판정**: ✅ 동의 (Critical — 최우선 수정)
- **사유**: 코드를 직접 확인했다.
  - `marketData.js:157`에서 `candle1m`(1분봉)만 구독
  - `maTrendStrategy.js:234` 주석에 "Aggregates 1h candles into 4h/daily"라고 되어 있지만, 실제로 수신하는 것은 **1분봉**
  - `h1Count`가 4마다 h4로 집계하고 24마다 daily로 집계 → 실제로는 **4분봉을 4시간봉으로, 24분봉을 일봉으로 오인**하는 심각한 버그
  - 변수명(`h1Closes`, `h1Count`)은 1시간봉을 의미하지만 실제 데이터는 1분봉
  - 백테스트에서는 kline 데이터가 별도 타임프레임으로 공급되므로 이 버그가 드러나지 않을 수 있음 (라이브와 백테스트 결과 괴리)
- **권장 해결책**: Trader가 제안한 **(A) 타임스탬프 기반 집계**에 동의한다. `kline.ts` (또는 `kline.timestamp`)를 활용하여 UTC 시간 경계를 판단하는 유틸리티를 `utils/` 에 추가하고, MaTrend 외에도 향후 멀티 타임프레임이 필요한 전략에서 재사용할 수 있게 한다. 방법 (B)는 WebSocket 구독 수를 증가시켜 rate limit 위험이 있으므로 피하는 것이 맞다.

### P13-7: StrategyParamMeta에 카테고리/그룹 추가
- **판정**: ✅ 동의
- **사유**: `group` 필드 추가는 기존 스키마에 비파괴적이며, 프론트엔드 렌더링을 즉시 개선한다. UI Agent의 P4, P8 제안과 완전히 정렬된다. `'signal'`, `'indicator'`, `'risk'`, `'sizing'` 4개 그룹은 적절하다. 다만 그룹명을 내 P-1과 UI Agent P8이 모두 사용하므로, 먼저 그룹 enum을 `constants.js`에 정의하여 일관성을 보장하는 것을 권장한다.

### P13-8: 실시간 전략 상태 대시보드
- **판정**: ⚠️ 조건부 동의 (Round 14 연기 권장)
- **보완 사항**:
  1. **보안**: 전략 내부 상태(Donchian 채널, EMA 값, 트레일링 스탑 위치)를 API로 노출하면, 봇의 정확한 진입/청산 지점이 외부에 유출될 수 있다. API_KEY 인증이 필수이며, 응답에 캐시 헤더(`no-store`)를 설정해야 한다.
  2. **성능**: 18개 전략 x N개 심볼의 내부 상태를 실시간 API로 제공하면, 매 폴링마다 상당한 직렬화 비용이 발생한다. Socket.io 이벤트로 변경분만 전달하는 것이 효율적이나, 이벤트 설계가 복잡해진다.
  3. **복잡도**: 각 전략의 `_s()` (내부 상태 객체)를 외부로 노출하는 것은 캡슐화 위반이다. 대신 각 전략에 `getPublicState()` 메서드를 StrategyBase에 정의하고, 전략별로 오버라이드하는 패턴이 적절하다.
  4. **Round 13 범위 초과**: P13-1 ~ P13-7만으로도 32h 소요가 예상되며, P13-8은 독립적으로 구현 가능하므로 Round 14로 연기하는 것이 현실적이다.

---

## UI/UX 제안서 리뷰

### P1: 전략 인포 카드 리디자인 (Strategy Info Card)
- **판정**: ✅ 동의
- **사유**: Quick Stats Bar (`Lev 3x | Size 3% | TP 3% | SL 2% | Max 2포지션`)는 정보 밀도를 크게 높이면서도 카드 면적을 최소한으로 사용하는 좋은 디자인이다. 레버리지별 색상 규칙(1~3x 안전, 4~10x 주의, 11~20x 위험)도 적절하다.
- **백엔드 변경**: `botRoutes.js`에서 `maxConcurrentPositions`, `cooldownMs`, `warmupCandles`, `volatilityPreference`, `maxSymbolsPerStrategy`를 추가 전달하는 것은 간단하며, 기존 `registry.listWithMetadata()`가 이 정보를 이미 반환하므로 코드 변경량이 적다. 승인.

### P2: 전략 설명 패널 (Strategy Explainer)
- **판정**: ⚠️ 조건부 동의
- **보완 사항**:
  1. **데이터 소스**: `explainer` 객체와 Trader 제안의 `docs` 객체가 거의 동일한 구조이나 필드명이 다르다 (`explainer.entryConditions` vs `docs.entry`). 백엔드에서 하나의 통합 스키마로 정의해야 한다. 내 제안의 `docs` 키와 Trader 제안의 `docs` 키를 채택하고, UI 에이전트는 이 스키마를 그대로 소비하는 것이 혼선을 방지한다.
  2. **예상 시간**: 10h는 적절하다. 단 P9(백엔드 데이터 추가)가 완료되어야 하므로, 의존성 관리가 중요하다.
  3. **StrategyDetail.tsx에 "개요" 탭 추가**는 매우 적절하다. 현재 3개 탭(포지션/거래/시그널)이 모두 "과거 실적"인데, "이 전략이 무엇인가"를 설명하는 탭이 첫 번째에 오는 것은 사용자 동선에 부합한다.

### P3: 모듈형 파이프라인 시각화 (Pipeline Visualizer)
- **판정**: ⚠️ 조건부 동의
- **보완 사항**:
  1. **데이터 가용성**: "별도 API 불필요 — 기존 botStatus, regime, riskStatus에서 추출 가능"이라고 했는데, 현재 `GET /api/bot/status`에 **코인 선정 목록**이 포함되어 있는지 확인이 필요하다. `coinSelector`의 선정 결과는 `botService.getStatus()`에 `assignedSymbols` 등으로 있을 수 있지만, 5개 모듈 블록 중 "코인 선정" 단계의 상세 정보(스코어, 필터링 이유)는 현재 API에 없을 가능성이 높다. 간소화하여 심볼 이름 목록만 표시하는 것이 현실적이다.
  2. **클릭 시 스크롤 연동**: 좋은 UX이지만, 각 섹션의 DOM 앵커 관리가 필요하다. `id` 속성을 각 패널에 부여하고 `scrollIntoView`를 사용하면 된다. 복잡도 낮음.
  3. **수평 파이프라인의 반응형**: 5블록 수평 배치는 1280px 이하에서 overflow가 발생할 수 있다. 1024px 이하에서는 수직 스택으로 전환하는 것이 안전하다.

### P4: 모듈별 설정 패널 재구성 (Modular Config Panels)
- **판정**: ✅ 동의
- **사유**: 현재 `StrategyConfigPanel.tsx`의 flat 리스트 → 아코디언 그룹 전환은 UX 개선 효과가 크다. `strategyParamMeta.js`에 `group` 필드를 추가하는 것은 Trader P13-7과 완전히 일치하며, `description` 필드 추가도 내 관점에서 필요하다.
- **추가 사항**: 파라미터 그룹화 규칙 테이블에서 `group: 'entry'` / `'exit'` / `'risk'` / `'execution'` 4개 그룹을 제안했는데, Trader의 `'signal'` / `'indicator'` / `'risk'` / `'sizing'`과 다르다. **하나로 통일해야 한다.** 실용적으로는 4개면 충분하며, 제안: `'signal'` (진입+청산 조건), `'indicator'` (지표 기간 등), `'risk'` (SL/TP/트레일링), `'sizing'` (포지션 크기/레버리지). UI Agent의 `'entry'`/`'exit'` 분리는 과도할 수 있고, Trader의 분류가 파라미터 수 분포상 더 균등하다.

### P5: 프리셋 시스템 (Risk Preset Selector)
- **판정**: ⚠️ 조건부 동의
- **보완 사항**:
  1. **UI Agent 제안은 전략별 프리셋**이고, **Trader 제안(P13-5)은 글로벌 프리셋**(어떤 전략을 활성화할지 + 글로벌 리스크 파라미터)이다. 두 접근이 상호 배타적이지 않으나, **동시에 적용하면 충돌**한다. 예: 글로벌 프리셋이 "보수적"인데 개별 전략 프리셋이 "공격적"이면?
  2. **권장**: Round 13에서는 Trader의 **글로벌 프리셋만** 구현하고, 전략별 프리셋은 Round 14로 미룬다. 글로벌 프리셋이 사용자에게 더 직관적이고, 구현 복잡도도 낮다.
  3. **프리셋 적용 시 기존 설정 백업**: 프리셋을 적용하기 전에 현재 설정을 "커스텀" 슬롯에 자동 저장하여, 사용자가 원래 설정으로 복귀할 수 있어야 한다.

### P6: 전략 비교 뷰 (Strategy Comparison Matrix)
- **판정**: ✅ 동의
- **사유**: 18개 전략 비교는 사용자가 명백히 필요로 하는 기능이다. 디자인이 명확하고 구현 가능하다.
- **성능 고려**: "여러 전략의 stats를 병렬 fetch"할 때, `/api/trades/strategy-stats/:name`을 전략 수만큼 호출하면 N개의 HTTP 요청이 발생한다. 배치 API (`GET /api/trades/strategy-stats?names=MaTrend,Supertrend,...`)를 추가하거나, 비교 뷰에서 최초 진입 시 한 번에 모든 전략 stats를 반환하는 엔드포인트가 효율적이다. 단 이것은 선택적 최적화이며, 초기에는 병렬 fetch로 충분하다.

### P7: 파라미터 효과 시각화 (Parameter Impact Hints)
- **판정**: ⚠️ 조건부 동의 (Round 14+ 연기 권장)
- **보완 사항**:
  1. **정확성 문제**: "청산가 거리: ~33%"는 레버리지 3x일 때의 교차 마진 기준이며, 격리 마진에서는 다르다. Bitget UTA 모드에서의 정확한 청산가 계산은 유지보증금율, 미실현 PnL 등을 고려해야 하므로 프론트엔드 단독 계산이 부정확할 수 있다.
  2. **우선순위**: 다른 항목(P1~P5)이 더 직접적인 UX 개선을 가져오므로, 이 항목은 낮은 우선순위가 적절하다. UI Agent 자체 평가도 LOW이므로 일치한다.

### P8: 파라미터 설명 데이터 추가 (Backend paramMeta 확장)
- **판정**: ✅ 동의
- **사유**: 가장 적은 노력(3h)으로 가장 큰 UX 개선을 가져오는 작업이라는 평가에 동의한다. `description`과 `group` 필드 추가는 기존 스키마에 비파괴적이며, 프론트엔드가 이 필드를 활용하지 않더라도 API 응답 크기만 약간 증가할 뿐 부작용이 없다. 내 P-2a (서버측 config 검증)와도 시너지가 있다 — paramMeta에 description이 있으면, 검증 에러 메시지에 파라미터 설명을 포함할 수 있다.

### P9: 전략 Explainer 정적 데이터 추가 (Backend)
- **판정**: ✅ 동의
- **사유**: Trader 제안의 P13-1과 동일 목적이다. 필드명과 구조를 Trader P13-1의 `docs` 형식으로 통일하면 된다. UI Agent가 `explainer`라는 별도 키를 제안했지만, `docs`로 통일하는 것이 간결하다 (`metadata.docs`).

### P10: 모바일 반응형 설계 고려
- **판정**: ✅ 동의
- **사유**: P1~P6 완료 후 진행하는 것이 적절하며, "Desktop First"라는 디자인 원칙에 동의한다. 트레이딩 플랫폼은 복잡한 설정을 데스크톱에서 하고, 모바일에서는 모니터링 위주로 사용하는 것이 현실적이다.

---

## 종합 의견

### 3개 에이전트 간 합의 지점

1. **전략 docs/explainer 메타데이터** — 모든 에이전트가 동의. 구조와 키 이름을 `docs`로 통일해야 함.
2. **paramMeta에 group/description 추가** — 모든 에이전트가 동의. 그룹명을 `'signal'`/`'indicator'`/`'risk'`/`'sizing'`으로 확정해야 함.
3. **하드코딩 레버리지 수정 (P13-3)** — Critical 버그. 즉시 수정.
4. **MaTrend 타임프레임 버그 (P13-6)** — Critical 버그. 타임스탬프 기반 집계로 수정.
5. **프리셋 시스템** — 방향 동의. 글로벌 프리셋 우선.

### 필수 사전 합의 사항

| 항목 | Trader 제안 | UI 제안 | Engineer 권장 |
|------|-----------|---------|--------------|
| 메타데이터 키 | `docs` | `explainer` | **`docs`** (간결) |
| 진입 조건 형식 | 배열 (`['조건1', '조건2']`) | 배열 | **배열** (렌더링 유리) |
| 파라미터 그룹명 | `signal/indicator/risk/sizing` | `entry/exit/risk/execution` | **`signal/indicator/risk/sizing`** (파라미터 분포 균등) |
| 프리셋 범위 | 글로벌 (전략 선택 + 리스크 파라미터) | 전략별 (개별 파라미터 오버라이드) | **글로벌 우선**, 전략별은 R14 |

### 권장 구현 순서 (Round 13)

**Phase 1 — Critical 버그 수정 (5h)**
1. P13-6: MaTrend 타임프레임 버그 (3h) — 라이브 환경 정확성 직결
2. P13-3: 하드코딩 레버리지 제거 (2h) — 사용자 설정 무시 방지

**Phase 2 — 백엔드 데이터 계층 (8h)**
3. P-2a/2b/2c: config 검증 + atomic replace (2.5h) — 안전한 파라미터 변경 기반
4. P8(UI) + P13-7(Trader): paramMeta에 group/description 추가 (2h)
5. P13-1(Trader) + P9(UI): 전략 docs 메타데이터 18개 작성 (4h)
6. P-3(Engineer): 통합 전략 정보 API (botRoutes.js 응답 확장) (1.5h)

**Phase 3 — 프론트엔드 UI (16h)**
7. P1(UI): 전략 카드 Quick Stats Bar (6h)
8. P2(UI): 전략 설명 패널 "개요" 탭 (10h → 정적 설명만)

**Phase 4 — 추가 기능 (Round 14 연기 가능)**
9. P3(UI): 파이프라인 시각화
10. P4(UI): 모듈별 설정 패널 그룹화
11. P13-4(Trader): 글로벌 리스크 파라미터 UI
12. P13-5(Trader) / P5(UI): 프리셋 시스템

### 시스템 안정성 관점 핵심 경고

1. **P-2(config 검증)를 P13-4(리스크 파라미터 UI)보다 반드시 먼저 구현해야 한다.** 검증 없이 UI를 열면 사용자가 위험한 값을 입력할 수 있다.
2. **P13-5의 aggressive 프리셋에서 `maxTotalExposurePercent: '50'`은 반드시 제한하거나 경고해야 한다.**
3. **P13-8(실시간 전략 상태)는 보안/성능 검토 후 Round 14에서 진행해야 한다.** 전략 내부 상태 노출은 캡슐화와 보안에 영향을 미친다.
4. **P-4(CustomStrategyStore 비동기 전환)는 독립적으로 진행 가능하며, 다른 작업에 의존하지 않으므로 Phase 2와 병렬 처리 가능하다.**
