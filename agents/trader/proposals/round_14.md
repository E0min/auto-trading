# Round 14 Trader Proposal — 코드베이스 재분석 Round 4

> 작성자: Senior Quant Trader
> 날짜: 2026-02-17
> 범위: 전략 로직 버그/비효율, 멀티심볼 엣지케이스, 라이브/백테스트 괴리, 포지션 사이징, Deferred 재평가
> 분석 대상: 18개 전략 파일, 핵심 서비스(riskEngine, orderManager, positionManager, botService, signalFilter, strategyRouter, marketRegime, coinSelector), 백테스트/페이퍼 엔진, 커스텀 전략, R13 신규 코드

---

## 분석 요약

R1~R13의 12 라운드를 거치며 시스템 전반의 안정성이 크게 향상되었다. reduceOnly bypass(AD-46), SignalFilter close bypass(AD-63), trailing stop opt-in(AD-65), 백테스트 레버리지(AD-70), 전략 docs/paramMeta(R13) 등 핵심 인프라가 갖춰졌다.

이번 분석에서는 **전략 파일 내부 로직 수준**까지 깊이 파고들어 다음 범주의 이슈를 발견했다:

1. **AD-37 위반 (10개 전략)** — positionSide를 시그널 발생 시점에 설정하여 미체결 시 유령 상태 발생
2. **ATR 자체 계산 중복 (6개 전략)** — IndicatorCache를 사용하지 않고 자체 ATR 산출
3. **onFill 패턴 불일치 (4개 전략)** — fill.side vs fill.action 혼용으로 포지션 추적 오류 가능
4. **parseFloat 직접 사용 (2개 전략)** — mathUtils 우회하여 부동소수점 연산
5. **GridStrategy 동시 시그널** — entry + exit 즉시 발행으로 파이프라인 부하
6. **FundingRate 정적 Kelly** — 실적 기반 적응형이 아닌 하드코딩 승률
7. **QuietRangeScalp leverage 누락** — entry 시그널에 leverage 필드 없음

---

## 발견 사항 (코드 레벨 근거 포함)

### P14-1. AD-37 위반: 10개 전략 positionSide 조기 설정 [CRITICAL]

**현황**: AdaptiveRegimeStrategy만이 `pendingEntryRegime` 패턴으로 AD-37을 정확히 준수한다 (line 567-568). 나머지 10개 전략은 `emitSignal()` 호출 직후 (혹은 직전) `_s().positionSide`를 설정한다.

**위반 전략 목록 (10개)**:
| 전략 | 위반 위치 | 패턴 |
|------|----------|------|
| FundingRateStrategy | L295, L342 | `this._s().positionSide = 'long'/'short'` after emitSignal |
| VwapReversionStrategy | L526-530 | `this._s().entryPrice = close; this._s().positionSide = 'long'` before emitSignal |
| CandlePatternStrategy | L686-693, L725-732 | `s.entryPrice = price; s.positionSide = 'long'/'short'` before emitSignal |
| SupportResistanceStrategy | ~L520-530 | `s.entryPrice = price; s.positionSide = 'long'/'short'` |
| SwingStructureStrategy | ~L450-460 | 동일 패턴 |
| FibonacciRetracementStrategy | ~L500-510 | 동일 패턴 |
| TrendlineBreakoutStrategy | `_enterPosition()` + `onFill()` | **이중 설정**: 시그널 시 설정 + onFill에서 재설정 |
| QuietRangeScalpStrategy | L341-343 | `s.entryPrice = close; s.positionSide = 'short'` |
| MacdDivergenceStrategy | ~L460-470 | `_s().positionSide = 'long'/'short'` |
| GridStrategy | (간접) | grid level 상태로 관리하므로 직접 위반은 아니나, onFill이 fill.side 기반 |

**위험**: 시그널 발행 후 주문이 거절(RiskEngine reject, 거래소 에러, 잔고 부족)되면 전략은 포지션을 보유한 것으로 오인 → 이후 CLOSE 시그널을 유령 포지션에 대해 발행 → 불필요한 주문 시도 또는 실제 진입 기회 차단.

**제안**: AdaptiveRegimeStrategy의 `pendingEntryRegime/pendingEntrySide` 패턴을 참조하여 10개 전략을 일괄 수정. 시그널 emit 시 `_s().pendingEntry = { side, price, time }` 저장, `onFill()`에서만 `positionSide/entryPrice` 확정.

- **우선순위**: T0 (실거래 시 유령 포지션 발생 가능)
- **구현 난이도**: 중 (10개 파일 각각 수정, onFill 보완 필요)
- **예상 시간**: 6h (파일당 30~40분)

---

### P14-2. ATR 자체 계산 중복: price-action 6개 전략 [MEDIUM]

**현황**: price-action 카테고리의 6개 전략이 klineHistory에서 자체 ATR을 계산한다:

- CandlePatternStrategy: `_calcATR()` (klineHistory에서 직접 TR 계산)
- SupportResistanceStrategy: `_computeAtr()`
- SwingStructureStrategy: `_computeAtr()`
- FibonacciRetracementStrategy: `_computeAtr()`
- TrendlineBreakoutStrategy: `_computeAtr()`
- TurtleBreakoutStrategy: `_computeAtr()`

이들은 모두 `this._indicatorCache.getATR(sym)`로 대체 가능하다. IndicatorCache는 이미 모든 심볼에 대해 ATR을 계산하고 있다 (R1 T1-1에서 구축).

**위험**:
1. CPU 낭비 — 같은 데이터에 대해 6번 중복 계산
2. 결과 불일치 — IndicatorCache ATR과 자체 ATR 간 period/smoothing 차이로 전략 간 일관성 부재
3. 유지보수 부담 — ATR 알고리즘 수정 시 7곳 변경 필요

**제안**: 6개 전략의 자체 ATR 계산을 `this._indicatorCache.getATR(sym)` 호출로 대체. ATR period가 다른 경우 IndicatorCache에 period 파라미터 지원 추가.

- **우선순위**: T1
- **구현 난이도**: 중-저
- **예상 시간**: 3h

---

### P14-3. onFill 패턴 불일치: fill.side vs fill.action [MEDIUM]

**현황**: 전략별 onFill() 구현이 일관되지 않다:

| 패턴 | 사용 전략 |
|------|----------|
| `fill.action` 기반 (정확) | AdaptiveRegimeStrategy, MaTrendStrategy, TurtleBreakoutStrategy |
| `fill.side === 'buy'/'sell'` 기반 | QuietRangeScalpStrategy (L360-372), GridStrategy |
| `fill.side` 혼용 | MacdDivergenceStrategy (L523-542) |
| onFill 미구현 또는 최소 | VwapReversion, CandlePattern, SupportResistance 등 |

**위험**: `fill.side`는 주문의 매수/매도 방향이고, `fill.action`은 전략 의도(open_long/close_long 등)이다. short close 시 `fill.side === 'buy'`이므로, QuietRangeScalpStrategy의 `fill.side === 'buy' && s.entryPrice === null` (L360)은 short close를 새 long entry로 오인할 수 있다.

**제안**: 모든 전략의 onFill에서 `fill.action` 기반으로 통일. StrategyBase에 기본 onFill 패턴을 제공하고, 각 전략은 super.onFill() 호출 후 추가 로직만 구현.

- **우선순위**: T1 (포지션 추적 오류 시 실거래 손실)
- **구현 난이도**: 중
- **예상 시간**: 3h

---

### P14-4. CustomRuleStrategy parseFloat 직접 사용 [HIGH]

**현황**: `CustomRuleStrategy.js` L97-106에서 TP/SL 체크를 `parseFloat`로 수행:

```javascript
const entry = parseFloat(s.entryPrice);  // L97
const cur = parseFloat(price);            // L98
const pctChange = ((cur - entry) / entry) * 100;  // L101
if (effectivePct >= parseFloat(tpPercent)) {  // L106
```

이는 CLAUDE.md "모든 금액 값은 String 타입으로 처리. mathUtils로 산술 연산. 부동소수점 직접 사용 금지" 규칙에 명확히 위반된다.

**위험**: BTC 같은 고가 자산에서 `parseFloat` 정밀도 손실로 TP/SL 트리거 시점이 미세하게 빗나갈 수 있다. 특히 0.1% SL 같은 타이트한 설정에서 문제 발생 가능.

**제안**: mathUtils의 `pctChange()`, `isGreaterThanOrEqual()`, `isLessThanOrEqual()` 함수로 교체.

- **우선순위**: T0 (프로젝트 핵심 규칙 위반)
- **구현 난이도**: 저
- **예상 시간**: 1h

---

### P14-5. GridStrategy 동시 entry+exit 시그널 발행 [LOW-MEDIUM]

**현황**: `gridStrategy.js` L216-229에서 grid level hit 시 entry 시그널과 exit 시그널을 같은 tick에서 연속 발행:

```javascript
this.emitSignal(entrySignal);   // L218
// ... logging ...
this.emitSignal(exitSignal);    // L229
```

`break` (L238)로 tick당 1 레벨만 처리하지만, 두 시그널이 동일 tick에서 발행된다.

**위험**:
1. SignalFilter가 두 번째 시그널을 쿨다운으로 차단할 수 있음
2. OrderManager 큐에 entry와 exit가 동시 진입 → 실행 순서 보장 없음
3. Entry가 체결되기 전에 exit 주문이 거래소에 도달하면 reject

**제안**: exit 시그널은 entry의 `onFill()` 확인 후 발행하도록 변경. 또는 entry 시그널의 `takeProfitPrice` 필드에 exit 가격을 포함하여 단일 시그널로 처리 (exchange-side TP 활용).

- **우선순위**: T2
- **구현 난이도**: 중
- **예상 시간**: 2h

---

### P14-6. FundingRateStrategy 정적 Kelly 승률 [LOW]

**현황**: FundingRateStrategy의 `_calculatePositionSize()` 내부에서 Kelly 공식의 `winRate`가 `'0.55'`로 하드코딩되어 있다. 전략의 실제 승률과 무관하게 동일 사이즈를 산출한다.

**위험**: 실제 승률이 50% 이하인 경우 Kelly가 과대 사이징 → 과다 노출. 반대로 70% 이상이면 과소 사이징 → 수익 기회 상실.

**제안**: BotSession의 전략별 통계(wins/losses)를 참조하여 동적 winRate 산출. 최소 20건 이상 거래 데이터가 있을 때만 적응형 전환, 이전까지는 보수적 기본값(0.50) 사용.

- **우선순위**: T2 (수익 최적화, 안전성 이슈는 낮음)
- **구현 난이도**: 중
- **예상 시간**: 2h

---

### P14-7. QuietRangeScalpStrategy entry 시그널 leverage 누락 [HIGH]

**현황**: `QuietRangeScalpStrategy.js`의 entry 시그널에 `leverage` 필드가 없다. 다른 모든 전략은 `leverage: this.config.leverage` 또는 `leverage: String(...)` 형태로 포함한다.

R13-2에서 하드코딩 레버리지 제거 작업 시 이 전략이 누락된 것으로 보인다.

**위험**: OrderManager가 leverage 없이 주문 → setLeverage 미호출 → 거래소의 기존 레버리지 설정 그대로 사용 → 의도치 않은 고/저 레버리지 적용.

**제안**: entry 시그널 객체에 `leverage: this.config.leverage` 추가 (long/short 양쪽).

- **우선순위**: T0
- **구현 난이도**: 극저
- **예상 시간**: 15분

---

### P14-8. MacdDivergenceStrategy onTick 중복 highest/lowest 추적 [LOW]

**현황**: `MacdDivergenceStrategy.js` L233-242에서 trailing stop 체크 코드 *이후*에 highest/lowest 가격 업데이트가 또 실행된다. StrategyBase의 `_checkTrailingStop()`도 동일한 업데이트를 수행하므로 코드 중복이다.

또한 이 전략의 metadata에서 `trailingStop.enabled = false`이므로 trailing 관련 코드(L194-231의 자체 trailing 체크 포함)는 독립적으로 동작하는 것과 StrategyBase trailing이 혼재되어 있다.

**위험**: 즉각적 위험은 낮지만, 코드 가독성과 유지보수에 해로움.

**제안**: 자체 trailing 로직을 StrategyBase trailing과 통합하거나, 명확히 분리하여 중복 제거.

- **우선순위**: T3
- **구현 난이도**: 저
- **예상 시간**: 1h

---

### P14-9. VwapReversionStrategy 하드코딩 세션 리셋 [LOW]

**현황**: VwapReversionStrategy의 VWAP은 96캔들(1분봉 기준 약 1.6시간)마다 세션 리셋된다. 이 값은 `defaultConfig.sessionLength = 96`으로 설정되어 있으나, 실제 crypto 시장의 VWAP은 24시간(1440분) 또는 UTC 0시 기준 리셋이 일반적이다.

**위험**: 1.6시간 세션은 너무 짧아 VWAP의 anchor 의미가 약해짐. 짧은 세션 → 빈번한 리셋 → VWAP이 현재 가격에 너무 가깝게 수렴 → reversion 시그널 질 저하.

**제안**: 세션 길이를 1440(24시간)으로 변경하거나, UTC 자정 기준 리셋 옵션 추가.

- **우선순위**: T2 (전략 성능 개선)
- **구현 난이도**: 저
- **예상 시간**: 30분

---

### P14-10. AdaptiveRegimeStrategy _calcConfidence에서 parseFloat 사용 [MEDIUM]

**현황**: `adaptiveRegimeStrategy.js` L716에서 `let confidence = 0.5`로 JavaScript number를 사용하고, 이후 `confidence += 0.25` 등 부동소수점 연산을 수행한다. 최종적으로 `toFixed(String(confidence), 4)`로 변환하긴 하나, 중간 계산이 부동소수점이다.

동일 패턴이 VwapReversionStrategy의 `_calcConfidence`에서도 발견된다.

**위험**: confidence 값은 금전적 값은 아니지만, 0.1~1.0 범위의 값이므로 부동소수점 오차가 실질적 영향을 미칠 가능성은 매우 낮다. 다만 프로젝트 코딩 규약 일관성 차원의 이슈.

**제안**: confidence 계산도 mathUtils 기반으로 전환. 단, 이 항목은 낮은 우선순위.

- **우선순위**: T3
- **구현 난이도**: 저
- **예상 시간**: 1h

---

## 제안 사항 (우선순위별 정리)

### Tier 0 — 즉시 수정 (실거래 필수)

| ID | 제안 | 예상 시간 | 근거 |
|----|------|----------|------|
| P14-1 | AD-37 위반 10개 전략 positionSide→onFill 이동 | 6h | 유령 포지션 → 실거래 손실 리스크 |
| P14-4 | CustomRuleStrategy parseFloat→mathUtils 전환 | 1h | 프로젝트 핵심 규칙 위반, TP/SL 정밀도 |
| P14-7 | QuietRangeScalp entry leverage 필드 추가 | 15분 | 의도치 않은 레버리지 적용 |

### Tier 1 — 1주 내

| ID | 제안 | 예상 시간 | 근거 |
|----|------|----------|------|
| P14-2 | price-action 6개 전략 ATR→IndicatorCache 전환 | 3h | 중복 계산 제거, 일관성 |
| P14-3 | onFill 패턴 통일 (fill.action 기반) | 3h | 포지션 추적 오류 방지 |

### Tier 2 — 2주 내

| ID | 제안 | 예상 시간 | 근거 |
|----|------|----------|------|
| P14-5 | GridStrategy entry/exit 시그널 분리 | 2h | 시그널 파이프라인 안정성 |
| P14-6 | FundingRate Kelly 승률 동적화 | 2h | 포지션 사이징 최적화 |
| P14-9 | VwapReversion 세션 길이 최적화 | 30분 | 전략 시그널 품질 |

### Tier 3 — 장기

| ID | 제안 | 예상 시간 | 근거 |
|----|------|----------|------|
| P14-8 | MacdDivergence trailing 중복 코드 정리 | 1h | 코드 가독성 |
| P14-10 | confidence 계산 mathUtils 전환 | 1h | 코딩 규약 일관성 |

**총 예상: Tier 0 = 7h 15min, Tier 1 = 6h, Tier 2 = 4h 30min, Tier 3 = 2h**

---

## Deferred 항목 재평가

### R11~R13에서 이관된 항목 검토

| Deferred ID | 제목 | 현재 평가 | 추천 |
|-------------|------|----------|------|
| R11-D1 | 트레일링 스탑 통합 (MaTrend/Turtle→StrategyBase) | R12 AD-69에서 8개 전략 trailing metadata를 enabled=false로 정리. MaTrend/Turtle은 자체 구현이 잘 동작 중. 통합 시 regression 리스크 대비 이득이 적음 | **기각** — 현재 구조 유지가 안전 |
| R11-D2 | ATR 기반 포지션 사이징 (riskPerUnit) | CandlePattern/SupportResistance 등이 이미 ATR 기반 riskPerUnit을 자체 구현. 이를 StrategyBase 레벨로 올려 opt-in 가능하게 하면 일관성 향상. P14-1(AD-37 수정)과 연계하면 효과적 | **T2로 실행** — P14-1 완료 후 진행 |
| R11-D3 | maxHoldTime 강제 청산 | 실거래에서 장기 보유 포지션의 펀딩비 누적 리스크 관리에 필수. 2단계(경고→강제) 설계 유지. P14-1(onFill 수정) 완료 후 구현이 깔끔함 | **T1로 격상** — 펀딩비 누적 리스크 실질적 |
| R12-D3 | PaperEngine mark price SL/TP | PaperEngine이 last trade price 기반으로 SL/TP 트리거하므로 실거래(mark price 기반)와 괴리. 백테스트 정확도에 직접 영향 | **T2 유지** — 라이브 배포 전 구현 바람직 |
| R12-D4 | ExposureGuard 레버리지 인지 | 현재 ExposureGuard는 margin 기준으로만 노출을 계산. 같은 margin이라도 leverage에 따라 실제 노출이 다름. 10x leverage 포지션과 2x leverage 포지션의 리스크가 동일하게 취급됨 | **T1로 격상** — 실거래 리스크 관리 핵심 |
| R12-D5 | 방향성 집중도 모니터링 | 모든 전략이 같은 방향으로 몰릴 때 과도한 방향성 노출 감지. RiskEngine의 ExposureGuard에 directional concentration 한도 추가 | **T2 유지** — 멀티심볼 안정화 후 |
| R12-D6 | ATR 동적 TP/SL (파일럿) | P14-2(ATR→IndicatorCache)와 자연스럽게 연결. IndicatorCache ATR 사용으로 통일된 후 dynamic TP/SL 파일럿 가능 | **T2 유지** — P14-2 선행 필수 |
| R12-D7 | 포트폴리오 백테스트 | 멀티심볼 환경에서 전략 간 상관관계, 전체 포트폴리오 drawdown 시뮬레이션. 현재 BacktestEngine은 단일 전략 단일 심볼 구조 | **T3 유지** — 아키텍처 변경 큼 |
| R13-D1 | 전략 프리셋 시스템 | R13 paramMeta + docs 완성으로 프리셋 기반 데이터가 갖춰짐. conservative/balanced/aggressive 3단 프리셋 구현 시점 | **T2로 실행** — 데이터 레이어 준비 완료 |
| R13-D2 | 실시간 전략 상태 대시보드 (getPublicState) | 18개 전략의 내부 상태(현재 포지션, 시그널 대기, 지표 값 등)를 실시간 공개. P14-1(AD-37 정리) 후 상태가 정확해지면 의미있는 대시보드 가능 | **T2로 실행** — P14-1 후 진행 |
| R13-D3 | SignalPipeline 추출 리팩토링 | botService.js _processSignal()이 200줄 이상. 독립 클래스로 추출하면 테스트/유지보수 용이 | **T3 유지** — 사용자 체감 변화 0 |
| R13-D5 | 모듈별 설정 패널 아코디언 재구성 | R13 paramMeta group(signal/indicator/risk/sizing) 완성으로 그룹별 아코디언 구현 기반 마련 | **T1로 격상** — R13 paramMeta 활용 |

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **P14-1 구현 시 StrategyBase에 공통 onFill 템플릿 제공**: `super.onFill(fill)`에서 `pendingEntry` → 확정 전환 로직을 기본 구현으로 넣으면 10개 전략 각각의 수정량이 줄어든다
2. **P14-3 onFill 패턴 통일 시 fill 객체 스키마 문서화**: orderManager가 fill 이벤트에 포함하는 필드(action, side, symbol, price, qty, orderId 등)를 명확히 정의하여 전략 개발자가 참조할 수 있게
3. **P14-4 CustomRuleStrategy 전체 감사**: parseFloat 외에도 보안/입력 검증 관점에서 사용자 입력 룰 실행의 안전성 확인
4. **R12-D4 ExposureGuard 레버리지 인지 구현 방안**: notional exposure(margin * leverage) 기반으로 총 노출 계산 전환. 현재 margin 기준 maxTotalExposurePercent가 레버리지 차이를 무시함

### UI/UX에게

1. **P14-1 완료 후 전략 상태 표시 개선**: positionSide가 "pending"/"confirmed" 상태를 가지게 되므로, 대시보드에서 "체결 대기 중" 상태를 시각적으로 표시
2. **R13-D1 프리셋 시스템 UI**: conservative/balanced/aggressive 3단 프리셋 선택 UI + 현재 설정과 프리셋 차이 표시
3. **R13-D5 아코디언 재구성**: paramMeta group 기반으로 전략 설정 패널을 4개 그룹(signal/indicator/risk/sizing) 아코디언으로 재구성
4. **R13-D2 전략 상태 대시보드**: getPublicState() API가 구현되면 전략별 내부 상태(현재 포지션, 지표 snapshot, 최근 시그널)를 실시간 표시하는 패널

---

## 요약 통계

| 구분 | 건수 |
|------|------|
| 신규 발견 | 10건 (T0: 3, T1: 2, T2: 3, T3: 2) |
| Deferred 격상 | 3건 (T1로: D3/D4/D5, T2로: D2/D1/D2) |
| Deferred 기각 | 1건 (R11-D1 trailing 통합) |
| Deferred 유지 | 7건 |
| 총 예상 시간 | ~20h (신규 항목만) |
