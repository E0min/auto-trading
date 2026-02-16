# Round 9 교차 리뷰 — Trader

> **Author**: Senior Quant Trader Agent
> **Date**: 2026-02-17
> **Reviewing**: Engineer proposal + UI/UX proposal
> **Reference**: Trader proposal (round_9.md)

---

## Engineer 제안서 리뷰

### R8-T2-1: 멀티심볼 라우팅 Phase 1

✅ **동의 — 구현 방향 정확, 트레이딩 관점에서 보완 1건**

Engineer의 분석이 정확하다. `_symbolAssignmentLock` boolean guard, deactivate-first 패턴, 심볼 < 전략 수 시 다수 전략 동일 심볼 공유 허용 등 모두 합리적이다.

**보완 사항**: Engineer는 "라운드 로빈 기본, 점수 매칭 확장 가능"이라고 했는데, 나는 **Phase 1에서부터 최소한의 점수 기반 매칭**을 권장한다. 순수 라운드 로빈은 Funding 전략을 변동성 높은 코인에 배정하거나, Grid 전략을 추세가 강한 코인에 배정하는 등 비효율적 조합이 발생한다. 최소한 아래 수준의 매칭이면 충분하다:

```
- preferHighVolatility: [Turtle, Breakout, SwingStructure] → coinSelector 스코어 상위
- preferLowVolatility: [Grid, QuietRangeScalp, Bollinger] → coinSelector 스코어 하위
- neutral: [나머지] → 라운드 로빈
```

이 정도는 `strategyRouter._assignSymbols()`에 10줄 내외 추가로 구현 가능하며, 기대 수익 개선 효과가 유의미하다.

**수익 기회 제한 우려 판단**: Engineer의 `maxStrategiesPerSymbol` 개념이 수익 기회를 과도하게 제한할 수 있냐는 질문에 대해 — 아니다. 심볼당 3개 전략은 충분하다. 동일 심볼에 5개 이상 전략이 배정되면 오히려 상충 시그널(동시 롱/숏)이 발생하여 수수료만 낭비된다. 단, 심볼이 극단적으로 적은 경우(2~3개)에는 상한을 탄력적으로 조정해야 하므로 `Math.max(3, Math.ceil(strategies.length / symbols.length))` 공식을 권장한다.

**의존성 동의**: Engineer가 T1-1(InstrumentCache)을 T2-1의 전제조건으로 판단한 것은 **절대적으로 옳다**. 하드코딩 `0.0001` lot step으로 DOGEUSDT(lot step=1) 등에 주문하면 즉시 거부당한다. T1-1 없이 T2-1을 구현하면 첫 번째 알트코인 주문에서 실패한다.

---

### R8-T2-2: 전략 warm-up 기간

✅ **동의 — 시그널 게이트 위치 + deactivate 리셋 방침 모두 적절**

Engineer의 `emitSignal()` 내 warm-up 차단 위치가 최적이다. 전략 내부에서 불완전한 데이터로 시그널을 생성하더라도 외부로 나가지 않으므로 방어적 프로그래밍 원칙에 부합한다.

**activate() 시 warm-up 리셋 O** 방침도 동의한다. 새 심볼로 변경될 수 있으므로 안전 우선이 맞다. 다만 **동일 심볼에서 레짐 변경으로 deactivate→reactivate되는 경우** warm-up 전체 리셋은 아까울 수 있다. 이 경우 50% 할인 리셋(klineCount를 절반으로) 같은 옵션도 고려할 수 있으나, Phase 1에서는 과도한 복잡성이므로 **전체 리셋으로 진행하고 Phase 2에서 재검토**하는 것이 맞다.

**내 제안서의 warmupCandles 테이블(18개 전략 수치)을 Engineer가 구현 시 참조 요청**. Engineer의 제안서에는 구체적 수치가 없으므로.

---

### R8-T2-3: 펀딩비 PnL 반영

⚠️ **조건부 동의 — "관측용으로만 추적"은 불충분, PnL 보고에 반드시 반영해야 함**

Engineer는 "Bitget equity 값이 이미 펀딩비를 반영 → 별도 `cumulativeFundingPnl`은 추적(관측성) 목적으로만 누적"이라고 했다. **equity 기반 총 PnL에서는 맞지만, 개별 트레이드 PnL에서는 틀리다.**

현재 `orderManager.js:1002-1024`에서 트레이드별 PnL = `(exitPrice - entryPrice) * qty - fee`로 계산한다. 여기에 **펀딩비가 빠져 있으므로 개별 트레이드 PnL이 부정확**하다. 이는 다음 문제를 야기한다:

1. **전략별 성과 비교 왜곡**: Funding 전략은 실제로는 펀딩비 수익이 핵심인데, 트레이드 PnL에 반영 안 되면 성과가 과소평가됨
2. **analytics by-strategy, by-symbol API 응답 부정확**: 이 API들이 트레이드 모델 기반으로 집계하므로 펀딩비 누락
3. **백테스트 vs 라이브 괴리**: 백테스트에 펀딩비를 넣으면서 라이브 트레이드 PnL에는 안 넣으면 비교 불가

**보완 요구사항**:
- Trade 모델에 `fundingPnl` 필드 추가 (String 타입)
- 포지션 청산(close) 시 `accumulatedFunding`을 Trade 레코드에 기록
- `orderManager._calculatePnl()`에서 `pnl = math.subtract(pnl, trade.fee)` 다음에 `pnl = math.subtract(pnl, trade.fundingPnl)` 추가
- 이것이 "이중 계산"이 아닌 이유: equity는 전체 계좌 수준이고, Trade PnL은 개별 거래 수준이다. 서로 다른 관측 레벨이므로 독립적.

**백테스트 펀딩비**: Engineer의 "상수 0.01% vs 히스토리 데이터" 질문에 대해 — **Phase 1은 상수 0.01%로 충분**하다. 히스토리 펀딩비 데이터를 페칭하려면 API 호출 추가 + 캐싱 인프라가 필요한데, 백테스트 정확도 개선 대비 비용이 과다하다. 다만 config에서 `backtestFundingRate`를 조절 가능하게 해두면 사용자가 시나리오 분석 가능.

---

### R8-T2-4: 코인 재선정 주기

✅ **동의 — 4시간 기본 + 단계적 전환 방식 적절**

Engineer의 단계적 재선정(새 심볼 구독 → 전략 재배정 → 이전 심볼 해제) 패턴이 안전하다. 특히 `_reselectingCoins` 플래그로 재선정 중 시그널을 drop하는 방안은 합리적이다. 재선정은 보통 수 초 내에 완료되므로 시그널 1~2개 drop은 허용 가능.

**4시간 간격 적절성**: 내 제안서와 일치한다. 보충 근거:
- 1시간: 너무 잦음 → warm-up 비용 과다 (TurtleBreakout은 51캔들 = 1분봉 기준 51분 warm-up)
- 8시간: 너무 느림 → 펀딩비 정산 주기(8h)와 동일하여 시장 환경 변화 대응 지연
- 4시간: 균형점. 레짐 변경 시 즉시 트리거는 **Phase 2**로 미룸 (레짐 변경이 잦을 수 있어 불안정)

**추가 요청**: Engineer에게 "열린 포지션이 있는 심볼은 재선정 시 제거 금지" 로직의 구현을 명시적으로 요청한다. 나의 제안서에서 언급한 내용이지만 Engineer 제안서에는 명시되지 않았다. 포지션이 열린 심볼이 재선정에서 탈락하면:
1. 구독 해제됨 → ticker 업데이트 중단 → SL/TP 미작동
2. 전략이 deactivate됨 → close 시그널 발행 불가
이는 치명적이므로 반드시 `_reselectCoins()`에서 보호해야 한다.

---

### R8-T2-5: Paper 모드 전환 경고 강화

✅ **동의 — 구현 비용 최소, 안전성 향상**

Engineer의 분석과 구현 방안에 전면 동의한다. 추가 코멘트 없음.

---

### R8-T2-6: StateRecovery + OrphanOrderCleanup 활성화

⚠️ **조건부 동의 — false positive 방어가 핵심**

Engineer가 지적한 "거짓 양성" 문제에 전적으로 동의한다. 봇이 방금 넣은 주문을 DB 동기화 전에 orphan으로 탐지 → 취소하면 **실거래 손실**이 발생한다.

**보완 요구사항**:
1. Engineer가 제안한 "최근 2분 이내 주문 skip"을 **반드시** 포함해야 한다. 이것 없이 활성화하면 안 된다.
2. OrphanOrderCleanup의 cleanup 주기를 5분에서 **10분**으로 늘릴 것을 권장. 5분은 DB 동기화 지연 + WS 지연을 고려하면 다소 빠르다. 10분이면 충분히 안전하면서도 고아 주문을 합리적 시간 내에 정리 가능.
3. **첫 실행은 dry-run으로**: OrphanOrderCleanup에 `dryRun` 옵션을 추가하여, 첫 N회(예: 3회)는 탐지만 하고 실제 취소는 안 하며 로그만 남기는 모드로 운영. 이후 로그를 확인하고 false positive가 없음을 확인 후 실제 취소 활성화.

---

### R8-T0-5: PositionManager 전략 메타데이터 주입 (Deferred 재활성화)

✅ **동의 — T2-1과 함께 재활성화**

Engineer의 "조건부 재활성화 (T2-1과 함께)" 판단에 동의한다. BotService 레벨의 `Map<symbolPosSide, strategyName>` 접근은 Phase 1으로 적절하다.

**clientOid 인코딩 방식**: Engineer가 `bot_{strategy}_{timestamp}` 형태를 제안했는데, Bitget clientOid 최대 길이는 64자이다. 전략 이름이 길 수 있으므로(예: `FibonacciRetracement` = 20자) **약어 매핑 테이블**을 사용해야 한다: `fib`, `turt`, `grid` 등. 다만 이것은 Phase 2에서 다루고, Phase 1은 BotService 내부 Map으로 충분하다.

---

### R8-T1-1: InstrumentCache 심볼별 lot step (Deferred 재활성화)

✅ **동의 — 재활성화 필수, T2-1의 전제조건**

Engineer의 분석이 정확하다. 하드코딩 `0.0001`은 멀티심볼에서 즉시 문제를 일으킨다. 24시간 갱신 주기, 캐시 미스 시 기본값 폴백, Map 기반 저장 모두 합리적이다.

**추가 사항**: `minQty` 검증도 반드시 포함해야 한다. 일부 소형 코인은 최소 주문 수량이 높아서(예: 10 DOGE) 리스크 엔진이 허용한 금액으로 최소 수량을 충족 못할 수 있다. 이 경우 시그널을 조용히 drop하고 로그를 남기는 것이 맞다.

---

### Engineer 제안서 구현 순서

✅ **동의 — Phase 순서 합리적**

Engineer의 4-Phase 순서(T1-1+T2-2 → T2-1+T0-5 → T2-4+T2-3 → T2-5+T2-6)는 의존성을 정확히 반영한다. 나의 제안서 순서와도 일치한다. BE 27h 예상은 합리적 범위이나, 실제 구현 시 T2-1이 예상보다 시간이 소요될 가능성이 있으므로 **T2-1에 8h → 10h 여유**를 권장한다.

---

## UI/UX 제안서 리뷰

### R8-T2-8: StrategyCard toggle 접근성 수정

✅ **동의 — HTML 규격 위반 해소 + 키보드 접근성은 라이브 운영에서 중요**

24/7 크립토 시장에서 긴급하게 전략을 비활성화해야 할 때, toggle이 키보드로 접근 불가하면 마우스가 없는 환경(원격 접속, 터미널 브라우저 등)에서 문제가 된다. `<button>` 중첩 해소 + `aria-label` 추가 + `focus-visible:ring-2` 모두 적절하다.

구조를 두 개의 독립 `<button>`으로 분리하는 UI/UX 에이전트의 접근이 깔끔하다. `stopPropagation()` 불필요해지는 부수적 이점도 있다.

---

### R8-T2-9: MarketRegimeIndicator 중복 코드 정리 (삭제)

✅ **동의 — 데드코드 제거, 위험 없음**

사용하지 않는 컴포넌트 삭제. grep으로 import 없음 확인 완료. 15분 작업. 반대 이유 없음.

---

### R8-T2-10: 대시보드 헤더 모바일 반응형

✅ **동의 — 24/7 크립토 모니터링에 실질적으로 도움됨**

UI/UX 에이전트의 브레이크포인트 전략(`lg:`에서 수평, 그 이하 2줄 스택)이 합리적이다.

**모바일 반응형이 24/7 크립토 모니터링에 도움이 되는가?** — **그렇다.** 트레이딩 봇 운용자는 외출 중에도 봇 상태를 확인해야 한다. 현재 976px 최소 너비는 모바일에서 사실상 사용 불가를 의미한다. 가장 중요한 정보는:

1. **봇 실행 상태** (running/stopped/error) — 즉시 확인 필요
2. **긴급 정지 버튼** — 위기 시 모바일에서도 누를 수 있어야 함
3. **PnL 요약** — 현재 손익 파악

UI/UX의 모바일 레이아웃에서 백테스트/토너먼트 링크를 480px 이하에서 숨기는 것은 적절하다. 모바일에서 백테스트를 돌릴 일은 거의 없다. 봇 제어와 상태 확인이 핵심이다.

---

### R8-T2-11: AccountOverview 모바일 레이아웃

✅ **동의 — 총 자산 전체 너비 분리가 트레이더 관점에서도 올바른 계층**

UI/UX 에이전트가 질문한 "총 자산을 별도 행으로 분리하는 것이 트레이더 관점에서 적절한지"에 대한 답변:

**적절하다.** 트레이더가 대시보드를 볼 때 가장 먼저 확인하는 것은 **총 자산(equity)**이다. 이것은 다른 3개 지표(가용 잔고, 미실현 PnL, 활성 포지션)보다 정보 계층에서 상위에 있다. 4개를 동급으로 한 줄에 배치하는 현재 레이아웃보다, 총 자산을 별도 행으로 강조하는 것이 인지적으로 올바르다.

다만 **데스크톱에서도** 동일하게 2행 배치를 적용하면 수직 공간 낭비가 발생할 수 있다. UI/UX 에이전트의 제안대로 모바일에서만 분리하고 데스크톱에서는... 사실 제안을 보면 데스크톱에서도 총 자산 전체 너비 + 3열 sub 구조인데, 이는 **수용 가능하다**. 총 자산이 강조되면서도 sub stats가 한 줄에 3개이므로 공간 효율은 유지된다.

**금액 precision 주의**: Engineer도 언급했듯이, 모바일에서 폰트 축소(`text-2xl sm:text-3xl`)로 금액이 잘리지 않도록 해야 한다. `formatCurrency()`가 큰 금액에서 `$1.23M` 같은 축약을 지원하는지 확인 필요.

---

### R8-T2-12: RegimeFlowMap 모바일 대응

✅ **동의 — 합리적 타협**

모바일에서 레짐 매트릭스를 `grid-cols-3 sm:grid-cols-5`로 변경하여 3+2 배치하는 것은 깔끔한 타협이다. 5개 레짐 중 상위 3개(trending_up, trending_down, ranging)가 1행에 오고 나머지 2개(volatile, quiet)가 2행에 오는 것은 사용 빈도 기반으로도 맞다(trending/ranging이 가장 빈번).

상단 전략 라우팅 그리드를 모바일에서 1열 스택으로 변경하는 것도 적절하다. 이 컴포넌트는 MarketIntelligence의 하위 탭이므로 모바일 접근 빈도가 낮고, 접근했을 때 정보가 읽을 수 없는 것보다 세로로 길어지는 것이 낫다.

---

## 핵심 이견 사항

### 1. R8-T2-3 펀딩비 PnL — "관측용" vs "PnL 반영"

**이견 대상**: Engineer는 "관측/기록 목적으로만 별도 추적"이라고 했고, Trader(나)는 "Trade 모델 PnL에 반드시 반영"이라고 주장한다.

**근거**: equity 수준에서는 Bitget이 자동 반영하므로 Engineer의 판단이 맞다. 그러나 **개별 트레이드 PnL**(전략별 성과 비교, analytics API)에서는 펀딩비가 누락되면 데이터가 부정확하다. 특히 Funding 전략은 펀딩비 수익이 거래 차익보다 클 수 있으므로, 이를 반영하지 않으면 전략 평가가 왜곡된다.

**제안**: Phase 1에서 "관측용 누적" + "Trade close 시 accumulatedFunding을 Trade 레코드에 기록" 두 가지를 동시에 구현. PnL 계산식에 반영은 Phase 2로 미루더라도 최소한 **데이터 수집**은 Phase 1에서 완료해야 한다.

### 2. R8-T2-4 열린 포지션 심볼 보호

**이견은 아니지만 강조**: Engineer 제안서에 명시적으로 언급되지 않은 부분이다. 코인 재선정 시 열린 포지션이 있는 심볼을 제거하면 SL/TP 미작동으로 무방비 노출이 발생한다. 이것은 **구현 필수 요구사항**으로 합의해야 한다.

---

## Trader-Engineer-UI 공통 확인 사항

### 3자 동의 사항

| 항목 | Trader | Engineer | UI/UX | 합의 |
|------|--------|----------|-------|------|
| R8-T0-5 재활성화 | YES (T2-1과 함께) | YES (조건부, T2-1과 함께) | YES (MEDIUM) | **3/3 재활성화** |
| R8-T1-1 재활성화 | YES (T2-1 전제) | YES (T2-1 전제, 필수) | 중립 (BE 위임) | **3/3 재활성화** |
| 구현 순서 T1-1 → T2-1 | 동의 | 동의 (Phase 1 → Phase 2) | N/A | **동의** |
| 4시간 재선정 간격 | 동의 | 동의 | N/A | **동의** |
| warm-up 리셋 on activate | 동의 | 동의 (안전 우선) | N/A | **동의** |
| FE 5건 모두 진행 | 동의 | 무영향 확인 | 제안자 | **동의** |

### 미합의/확인 필요 사항

| 항목 | 이견 내용 | 결론 필요 주체 |
|------|----------|--------------|
| T2-3 펀딩비 Trade PnL 반영 수준 | Engineer: 관측용 / Trader: Trade 모델 반영 | Engineer + Trader |
| T2-1 심볼 배정 알고리즘 | Engineer: 라운드 로빈 기본 / Trader: 최소 점수 매칭 | Engineer + Trader |
| T2-4 열린 포지션 심볼 보호 | Trader: 필수 / Engineer: 미명시 | Engineer 확인 필요 |
| T2-6 OrphanCleanup dry-run | Trader: 초기 dry-run 필요 / Engineer: 미제안 | Engineer 확인 필요 |

### BE-FE 인터페이스 합의 필요 사항

UI/UX 에이전트가 요청한 API 변경사항:
1. `GET /api/bot/strategies` 응답에 `warmupState`, `klineCount`, `warmupRequired` 추가 → **Trader 동의, Engineer 구현 필요**
2. `GET /api/bot/strategies` 응답에 `assignedSymbol` 추가 → **Trader 동의, Engineer 구현 필요**
3. `POST /api/bot/trading-mode` 응답에 `warnings[]` 추가 → **Trader 동의, Engineer 구현 필요**
4. 코인 재선정 이벤트 `coins_reselected` Socket.io 전달 → **Trader 동의, Engineer 구현 필요**
5. 포지션 응답에 `fundingFee`/`accumulatedFunding` 추가 → **Trader 동의 (Phase 2에서 FE 반영)**

---

## 총평

3자 제안서가 큰 방향에서 일치한다. Engineer의 시스템 안전성 분석이 매우 상세하고, UI/UX의 코드 레벨 분석도 구체적이다. 핵심 이견은 **펀딩비 PnL 반영 수준** 하나이며, 이는 Phase 분할로 해소 가능하다.

**Trader 관점 최종 우선순위 (수익 영향 기준)**:
1. R8-T1-1 (InstrumentCache) — 멀티심볼 전제, 블로커
2. R8-T2-1 (멀티심볼 라우팅) — 단일 최대 수익 향상 항목
3. R8-T2-3 (펀딩비 PnL) — PnL 정확도 핵심
4. R8-T2-4 (코인 재선정) — 기회 포착 + 레짐 적응
5. R8-T0-5 (전략 매핑) — T2-1과 동시 구현
6. R8-T2-2 (warm-up) — 리스크 감소
7. R8-T2-6 (StateRecovery) — 크래시 복구
8. R8-T2-5 (Paper 경고) — 안전장치
