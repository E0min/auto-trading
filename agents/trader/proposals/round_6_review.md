# Round 6 교차 리뷰 -- Trader 관점

> **Reviewer**: Senior Quant Trader (Claude Opus 4.6)
> **Date**: 2026-02-16
> **Reviewed**: Engineer proposal (14건) + UI/UX proposal (15건)
> **Base**: Solo S1 Analysis + Trader Round 6 Proposal (7건)

---

## 총평

**3개 에이전트 모두 동일한 핵심 결함 4개를 독립적으로 발견했다는 사실이 이번 라운드의 가장 큰 성과다.** `getAccountInfo` 크래시(Engineer R6-1/R6-2 = Trader R6-5/R6-3), ExposureGuard price='0' 문제(Engineer R6-3 = Trader R6-1), 레버리지 미적용(Engineer R6-4 = Trader R6-2)은 3개 에이전트 합의로 실거래 차단 이슈가 확정되었다.

Engineer의 제안서는 시스템 인프라 관점에서 매우 포괄적이다. 특히 WS 리스너 누적(R6-5), SignalFilter stale 정리(R6-6), PaperEngine reset(R6-9) 등 장기 운영 안정성에 초점을 맞춘 발견이 우수하다. 다만 Trader 제안서의 R6-4(positionSide 조기 설정 제거)와 R6-7(CLOSE qty 퍼센트 문제)에 대한 분석이 누락되어 있어 보완이 필요하다.

UI 제안서는 Trader S1 요청 3건에 대한 현황 파악이 정확하고, 디자인 토큰 마이그레이션/접근성/반응형 등 기술 부채를 체계적으로 발굴했다. 트레이더 의사결정 관점에서 S1-3(disclaimer)의 영향력을 정확히 평가한 것이 인상적이다.

**핵심 우려**: 3개 에이전트의 R6 항목을 합산하면 총 36건이다. 5.5시간(Trader) + 6시간(Engineer) + 8시간(UI) = ~20시간. 스프린트 범위 축소가 반드시 필요하며, T0/T1 + Trader 고유 발견(R6-4, R6-7)에 집중해야 한다.

---

## Engineer 제안 리뷰

### R6-1. `riskEngine.getAccountState()` 메서드 부재 -- ✅ 동의

Trader R6-5와 동일한 발견. **실거래 모드를 완전히 무력화하는 CRITICAL 버그**이므로 즉시 수정 필수.

수정 방안도 적절하다. 다만 한 가지 보완: `getAccountState()`에서 `positions` 배열을 spread (`[...this.accountState.positions]`)로 복사하는 것은 방어적 프로그래밍으로 좋지만, positions 배열 내부 객체도 shallow copy이므로 caller가 내부 객체를 변경하면 원본이 오염된다. 현재 사용처(botService)에서 읽기만 하므로 문제없지만, 향후를 위해 JSDoc에 "@returns {Readonly}" 또는 Object.freeze를 권장한다.

**예상 수익 영향**: 이 버그가 수정되지 않으면 실거래 수익 = 0 (주문 불가). 수정 후 정상 운영 가능.

---

### R6-2. `exchangeClient.getAccountInfo()` 메서드 부재 -- ✅ 동의

Trader R6-3/R6-5와 동일. Engineer의 두 가지 대안 중 **"riskEngine에서 캐시된 equity 사용"을 강력 권장**한다.

이유:
1. REST API 호출(`getBalances`)은 rate limit 소진 위험이 있다 (Trader R6-3에서 상세 분석)
2. `positionManager`가 30초마다 동기화하는 `_accountState.equity`는 충분히 최신이다
3. 시그널 발생 빈도가 분당 수십 건일 때 매번 REST 호출하면 429 에러 발생

Engineer R6-13(비효율적 API 호출)과 결합하여 한 번에 수정하는 것이 효율적이다.

**예상 수익 영향**: R6-1과 동일. 미수정 시 실거래 수익 = 0.

---

### R6-3. ExposureGuard 마켓 오더 price='1' 문제 -- ✅ 동의

Trader R6-1과 동일. Engineer의 양면 수정(A: OrderManager에서 가격 주입 + B: ExposureGuard에서 reject) 접근에 **강하게 동의**한다.

**추가 의견 -- 수치 시뮬레이션**:

현재 상태에서의 위험도를 구체적으로 제시한다:

| 시나리오 | 자본 | 전략 의도 | 실제 계산 | 결과 |
|----------|------|-----------|-----------|------|
| BTC 시장가 매수 | $10,000 | 3% ($300) | qty * 0 = $0 (0%) | **통과 -- 무제한 노출** |
| ETH 시장가 매수 | $10,000 | 5% ($500) | qty * 0 = $0 (0%) | **통과 -- 무제한 노출** |

ExposureGuard의 `maxPositionSizePercent = 5%`가 완전히 무효화된다. 만약 전략이 실수로 equity의 50%에 해당하는 qty를 계산하면 그대로 거래소에 제출된다. **이것은 리스크 관리 체계의 근본적 무력화**이며, T0 수준으로 상향해야 한다.

Engineer의 수정안 B에서 `price='0'`일 때 reject하는 것이 최후의 방어선으로 반드시 필요하다. 다만 signal에 `suggestedPrice`가 누락된 전략이 있을 수 있으므로, Engineer의 수정안 A에서 `tickerAggregator`를 추가 fallback으로 활용하는 것도 고려해야 한다:

```javascript
// OrderManager: price resolution chain
riskPrice = signal.suggestedPrice
          || signal.price
          || this.tickerAggregator?.getLastPrice(symbol)
          || '0';
```

이를 위해 OrderManager 생성자에 `tickerAggregator` 의존성 주입이 필요하다. DI 변경이 부담스러우면 signal.suggestedPrice만으로도 충분하다 (현재 모든 전략이 suggestedPrice를 포함하는지 확인 필요).

---

### R6-4. 레버리지 관리 메커니즘 부재 -- ⚠️ 조건부 동의

Trader R6-2와 동일. 구현 방향에 동의하지만 **레버리지 결정 로직에 중요한 보완이 필요**하다.

**문제 1: 다중 전략 동일 심볼 레버리지 충돌**

Engineer는 "최대값 사용"을 제안했고, 내 Trader 제안서에서도 동일하게 제안했다. 그러나 이것은 **리스크 증가 방향**이다:

- Supertrend(5x) + Grid(2x)가 BTCUSDT에 동시 활성 -> 심볼 레버리지 = 5x
- Grid 전략은 2x를 의도했지만 5x 환경에서 운영됨
- Grid의 ExposureGuard 계산은 2x 기준이므로 실제 노출이 2.5배 커짐

**보완안**: 레버리지를 심볼 단위가 아닌 **전략-포지션 단위로 관리하는 것이 이상적**이지만, Bitget은 심볼 단위 레버리지만 지원한다. 따라서 현실적 절충안으로:

1. 심볼당 레버리지는 **활성 전략 중 최소값**을 사용 (보수적 접근)
2. 또는 **ExposureGuard에서 전략별 레버리지를 반영**하여 포지션 사이즈를 조정

```javascript
// ExposureGuard: 레버리지 반영 노출 계산
const orderValue = multiply(qty, effectivePrice);
const leveragedValue = multiply(orderValue, signal.leverage || '1');
const positionSizePercent = divide(leveragedValue, equity);
```

이 방식이면 5x 레버리지 전략은 자동으로 더 작은 qty를 할당받아 실제 노출이 제한된다.

**문제 2: Paper 모드 레버리지 미반영**

Engineer가 지적했듯이 PaperPositionManager에서 leverage = '1' 하드코딩이다. Paper/토너먼트 결과가 실거래와 괴리되어 전략 선택의 신뢰도가 떨어진다. **Paper 모드에서도 반드시 레버리지를 반영해야 한다**. PnL = qty * priceDiff * leverage로 계산하면 간단히 해결된다.

**예상 수익 영향**: 수정 전 -- 전략 의도(2-5x)와 실제(거래소 기본값, 아마 20x)의 괴리로 청산 리스크 급증. 수정 후 -- 전략별 의도된 레버리지로 위험 조정 수익률 최적화.

---

### R6-5. OrderManager/PositionManager destroy() 미호출 -- ✅ 동의

**장기 운영 안정성에 직접적 영향**. 특히 중복 이벤트 처리가 위험하다:

- 3번 start/stop 사이클 후 WS order 이벤트가 3번 처리
- 같은 fill이 3번 기록 -> PnL 통계 왜곡 -> 전략 성과 평가 오류 -> 잘못된 전략 선택

수정 방안에 동의한다. 다만 `start()` 시 리스너 재등록 로직이 필요하다는 Engineer의 언급에 대해: **OrderManager/PositionManager의 `init()` 또는 `start()` 메서드에서 기존 리스너를 먼저 제거한 후 재등록하는 "idempotent registration" 패턴**이 가장 안전하다:

```javascript
start() {
  // Remove any existing listeners first (idempotent)
  this._removeListeners();
  // Then register fresh
  this._registerListeners();
}
```

**예상 수익 영향**: 중간. 봇 재시작 없이 장기 운영 시 성과 데이터 오염으로 잘못된 전략 의사결정 유발.

---

### R6-6. SignalFilter `_activeSignals` 영구 누적 -- ✅ 동의

Trader Solo S1의 S1-9(MEDIUM-4)에서 동일 이슈를 발견했다. Engineer의 타임스탬프 기반 정리 방안에 동의한다.

**트레이딩 관점 추가**: `MAX_ACTIVE_SIGNAL_AGE_MS = 30분`이 적절한가?

- 스캘핑 전략(QuietRangeScalp): 포지션 보유 시간 5-30분 -> 30분 적절
- 스윙 전략(TurtleBreakout, SwingStructure): 포지션 보유 시간 수시간-수일 -> **30분이면 stale로 판정되어 삭제 -> 동일 심볼에 중복 진입 허용**

따라서 전략 메타데이터의 `expectedHoldTimeMs` 또는 `maxHoldTimeMs`를 참조하여 전략별 TTL을 적용하는 것이 이상적이다. 현실적으로 첫 구현에서는 Engineer 제안대로 30분 고정으로 시작하되, **stale 제거 시 실제 positionManager에서 해당 심볼의 포지션 존재 여부를 확인하는 guard를 추가**하는 것을 권장한다:

```javascript
// 30분 초과 + 실제 포지션이 없는 경우에만 삭제
if (now - ts > MAX_ACTIVE_SIGNAL_AGE_MS) {
  const hasPosition = this._positionManager?.hasPosition(symbol);
  if (!hasPosition) {
    entries.delete(key);
    log.warn('Stale activeSignal removed', { symbol, key });
  }
}
```

**예상 수익 영향**: 높음. 장기 운영 시 새 진입 기회가 영구 차단되어 수익 기회 상실.

---

### R6-7. Socket.io CORS origin `'*'` 하드코딩 -- ✅ 동의

보안 이슈. 트레이딩 시스템에서 실시간 포지션/계좌 데이터가 무방비로 노출되는 것은 심각하다. 공격자가 포지션 정보를 실시간으로 확인하면 front-running이나 마켓 임팩트 공격이 가능하다.

Socket.io 인증 추가 시 프론트엔드 변경이 필수이므로 **UI 에이전트와 동시 작업이 필요**하다. Engineer 제안의 `timingSafeEqual` 사용은 Round 5 T3-2에서 합의한 패턴과 일관되어 좋다.

**예상 수익 영향**: 직접적 수익 영향은 없지만, 정보 유출로 인한 간접적 손실 위험 존재.

---

### R6-8. Socket.io ticker throttle -- ✅ 동의

심볼당 1초 throttle은 합리적이다. 대시보드에서 가격 업데이트 1초 지연은 트레이더 의사결정에 영향이 없다 (실제 주문 실행은 서버 측에서 실시간으로 처리되므로). 구현이 간단하고 서버 부하를 확실히 줄여준다.

---

### R6-9. PaperEngine `_pendingOrders` 미정리 -- ✅ 동의

**토너먼트 모드에서 특히 중요**. 토너먼트 리셋 후 이전 세션의 리밋 오더가 fill되면 토너먼트 결과가 오염된다. `reset()` 메서드 추가는 간단하고 효과적이다.

**추가 확인 필요**: `botService.stop()` 호출 시점에서 PaperEngine reset과 PaperPositionManager reset의 순서가 중요하다. PaperEngine reset이 먼저 실행되어야 pending 오더가 PaperPositionManager에 fill되는 것을 방지할 수 있다.

---

### R6-10. IndicatorCache 심볼 데이터 영구 누적 -- ✅ 동의 (현재 수용 가능)

Engineer 스스로도 "현재 수준 수용 가능"으로 평가한 것에 동의한다. 10개 심볼 x 500 klines의 메모리 사용량은 무시할 수준이다. `splice(0, excess)`의 O(n) 비용도 500개 배열에서는 실질적 성능 영향 없다. ring buffer 전환은 T3 이하로 분류하여 후순위 처리.

---

### R6-11. SignalFilter `_strategyMeta` 정리 안됨 -- ✅ 동의

5분 수정. `reset()`에 `this._strategyMeta.clear()` 한 줄 추가. 간단하지만 `getStatus()` 응답의 정확성에 영향을 미치므로 모니터링/디버깅에 도움이 된다.

---

### R6-12. EventEmitter maxListeners 미설정 -- ✅ 동의

R6-5(destroy 미호출) 수정 후에도 `setMaxListeners(20)`을 설정하는 것이 안전하다. 방어적 프로그래밍으로서 비용 대비 효과가 높다.

---

### R6-13. `_resolveSignalQuantity()` 비효율적 API 호출 -- ✅ 동의

R6-1/R6-2 수정과 결합하여 한 번에 처리. `riskEngine.getAccountState().equity`를 사용하면 REST 호출 제거 + 코드 간결화 동시 달성.

**트레이딩 관점 추가**: `positionManager`가 30초마다 동기화하므로 equity 값이 최대 30초 지연될 수 있다. 급격한 시장 변동 시 equity가 10% 이상 변할 수 있어, 실제 equity보다 높은 값으로 포지션 사이즈를 계산할 위험이 있다. 이를 완화하기 위해:

1. `drawdownMonitor`의 `currentDrawdownPercent`를 확인하여 큰 낙폭 시 보수적으로 사이징
2. 또는 equity에 안전 마진을 적용 (`equity * 0.95`)

현재 단계에서는 캐시된 equity 사용으로 충분하지만, 향후 고려 사항으로 남겨둔다.

---

### R6-14. InstrumentCache (심볼별 lot step) -- ⚠️ 조건부 동의

방향에 동의하지만 **이번 스프린트에서 구현하는 것은 범위 초과**이다. 이유:

1. 현재 `floorToStep('0.0001')`로 대부분의 주요 코인(BTC, ETH, SOL)에서는 문제없다
2. DOGE, SHIB 같은 소형 코인에서 qty 오류가 발생할 수 있지만, ExposureGuard가 과대 주문을 차단하고, 거래소도 invalid qty를 reject한다
3. T0/T1 이슈가 5건 이상 남아있는 상황에서 2시간을 InstrumentCache에 투자하는 것은 비효율적

**권장**: Round 7 이후로 이관. 단, 거래소 reject 시 에러 메시지에 "qty precision error"가 포함되면 해당 심볼을 로그로 기록하도록 경고 로직만 이번 라운드에서 추가.

---

## UI/UX 제안 리뷰

### F-1 / UI-R6-1. StrategyDetail 디자인 토큰 마이그레이션 -- ✅ 동의

디자인 일관성은 사용자 신뢰도에 영향. StrategyDetail은 전략별 포지션/시그널을 확인하는 핵심 뷰이므로 시각적 이질감이 의사결정을 방해할 수 있다. 40분 투자로 100% 토큰 커버리지 달성은 효율적이다.

---

### F-2 / UI-R6-3. error.tsx 디자인 토큰 마이그레이션 -- ✅ 동의

15분 수정. 에러 페이지가 디자인 시스템을 따르지 않으면 사용자가 "다른 사이트로 이동했나"라는 불안감을 느낄 수 있다. 실거래 중 에러 발생 시 이 페이지를 보게 되므로 심리적 안정감이 중요하다.

---

### F-3 / S1-2. 레버리지 표시 보완 -- ⚠️ 조건부 동의

PositionsTable에 이미 표시되어 있다는 확인에 감사한다. StrategyDetail과 TournamentPage에 추가하는 것에 동의하지만, **Engineer R6-4(레버리지 설정 메커니즘)이 먼저 구현되어야 의미가 있다**.

현재 Paper 모드에서 leverage = '1' 하드코딩이므로, 지금 UI에 표시해도 모든 포지션이 "1x"로 나온다. Engineer R6-4 구현 후에 UI 보완을 진행하는 것이 순서상 맞다.

**추가 제안**: AccountOverview에 "평균/최대 레버리지"를 표시하는 것은 좋은 아이디어이나, 단순 평균보다 **가중 평균 레버리지**(포지션 사이즈 가중)가 더 의미 있다:

```
effectiveLeverage = sum(positionValue * leverage) / totalExposure
```

이것은 포트폴리오 전체의 실질 레버리지를 한눈에 보여준다.

---

### F-4 / S1-3. 백테스트 disclaimer 추가 -- ✅ 동의 (최우선)

**이번 스프린트에서 가장 높은 ROI(투자 대비 효과)를 가진 항목이다.**

20분 투자로 다음 가치를 달성:
1. **과대 기대 방지**: 사용자가 백테스트 결과를 실거래 수익으로 오해하는 것 방지
2. **전략 선택 정확도 향상**: "이 결과는 1x 기준이며 레버리지 미반영"을 인지하면 전략 간 비교가 더 정확해진다
3. **법적 보호**: 투자 관련 소프트웨어의 기본 면책 조항

UI의 disclaimer 문구에 추가할 내용:

```
본 백테스트 결과는 과거 데이터 기반 시뮬레이션이며, 실제 수익을 보장하지 않습니다.
레버리지 미반영 (1x 기준), 펀딩비 미반영, 단일 포지션 제한.
슬리피지(0.05%)/수수료(taker 0.06%)는 설정값 기준 근사치입니다.
실거래 시 시장 유동성, 체결 지연, 펀딩비, 레버리지 효과 등으로 결과가 크게 달라질 수 있습니다.
```

"단일 포지션 제한"을 추가한 이유: 그리드 전략 등 멀티포지션 전략의 백테스트 결과가 과소 추정될 수 있음을 명시.

---

### F-5 / S1-1. 전략-레짐 호환성 매트릭스 -- ✅ 동의

Trader S1에서 요청한 핵심 시각화. UI의 설계(행: 전략, 열: 레짐, 현재 레짐 강조, 활성 전략 강조)가 정확히 내가 의도한 형태이다.

**트레이딩 의사결정 가치**:
- "현재 RANGING 레짐인데, 8개 전략 중 Grid와 QuietRangeScalp가 핵심이구나"
- "TRENDING_UP으로 전환되면 14개 전략이 활성화되니 상관 노출에 주의해야겠다"
- "QUIET 레짐에서는 AdaptiveRegime만 활성화되니 포트폴리오 다변화가 약하다"

이런 판단이 한눈에 가능해진다.

**보완 요청**: 매트릭스에 각 전략의 `riskLevel` (low/medium/high)도 함께 표시하면, 레짐별 위험 프로필을 파악할 수 있다. 예를 들어 TRENDING_UP에서 14개 전략 중 riskLevel=high가 3개라면, 고변동 시 연쇄 손실 위험을 사전에 인지할 수 있다.

---

### F-6. 백테스트 삭제 확인 다이얼로그 부재 -- ✅ 동의

15분 수정. 백테스트 결과는 전략 선택의 근거 데이터이므로 실수로 삭제하면 의사결정 기반이 사라진다. ConfirmDialog 재사용은 일관성 확보에도 도움.

---

### F-7 / UI-R6-5. AccountOverview 반응형 -- ✅ 동의

10분 수정. `grid-cols-2 md:grid-cols-4`로 변경. 모바일에서 equity/balance 값이 잘려서 보이면 즉각적인 판단이 어렵다. 트레이딩 대시보드에서 핵심 수치가 가독성 있게 표시되는 것은 기본이다.

---

### F-8 / UI-R6-8. 네비게이션 접근성 -- ✅ 동의

`aria-disabled="true"` 추가는 접근성 표준 준수. 트레이딩 수익에 직접 영향은 없지만, 소프트웨어 품질의 기본이다. 15분 투자로 해결 가능.

---

### F-9 / UI-R6-9. BotControlPanel Live 확인 ConfirmDialog 전환 -- ✅ 동의

Live 모드 시작은 실제 자금이 투입되는 순간이므로, 확인 다이얼로그의 UX가 중요하다. 기존 ConfirmDialog 재사용으로 일관성 확보. 20분 투자.

---

### F-10 / UI-R6-6. BacktestTradeList 마진 불일치 -- ✅ 동의

5분 수정. `-mx-4` -> `-mx-6`. 시각적 일관성 개선.

---

### F-11 / UI-R6-10. 백테스트 심볼 입력 개선 -- ⚠️ 조건부 동의

옵션 A(인기 심볼 프리셋)에 동의. 즉시 구현 가능하고 백엔드 변경 불필요.

**트레이딩 관점 보완**: 프리셋 심볼 목록은 시가총액/유동성 기준으로 선정해야 한다:

```javascript
// 유동성 Tier 1 (필수)
const TIER_1 = ['BTCUSDT', 'ETHUSDT'];
// 유동성 Tier 2 (주요 알트)
const TIER_2 = ['SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'];
// 유동성 Tier 3 (변동성 높은 알트 -- 전략 테스트에 유용)
const TIER_3 = ['AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'APTUSDT'];
```

옵션 B(API 연동)는 Round 7 이후. 다만, 자유 텍스트 입력에서 `.toUpperCase()` 변환과 "USDT" 자동 접미사 추가는 이번 라운드에서 가능하다:

```javascript
const normalizedSymbol = symbol.toUpperCase().endsWith('USDT')
  ? symbol.toUpperCase()
  : symbol.toUpperCase() + 'USDT';
```

---

### F-12 / UI-R6-2. Toast 알림 시스템 -- ⚠️ 조건부 동의

`alert()` 제거에는 동의하지만, **이번 스프린트에서 Toast 시스템 전체를 구현하는 것은 범위 초과**이다. 2시간은 T0/T1 수정에 투자해야 한다.

**대안**: 이번 라운드에서는 `alert()` 호출을 인라인 에러 메시지로 교체하는 것만 수행 (30분 이내):

```tsx
// alert() 대신 상태 변수 + 인라인 메시지
const [errorMsg, setErrorMsg] = useState<string | null>(null);
// ...
setErrorMsg('포지션 청산에 실패했습니다.');
setTimeout(() => setErrorMsg(null), 5000);
```

본격적인 Toast 시스템은 Round 7에서 구현.

---

### F-13 / UI-R6-11. SignalFeed 높이 고정 -- ✅ 동의

`max-h-[400px]` 고정은 Row 내 컴포넌트 간 높이 불일치를 야기한다. TradesTable과 동일한 높이 제한을 적용하거나, 둘 다 `max-h-[480px]`으로 통일하는 것을 권장.

---

### F-14 / UI-R6-12. StrategySymbolMap 테이블 스타일 -- ✅ 동의

10분 수정. 테이블 정렬 방향(`text-left`, `text-right font-mono`) 명시로 데이터 가독성 향상.

---

### F-15 / UI-R6-7. Chart Tooltip 스타일 통합 -- ✅ 동의

`borderRadius: 6px vs 8px`, `fontSize: 11px vs 12px` 불일치는 미세하지만 전문적인 대시보드에서는 해소해야 한다. `lib/chart-config.ts`에 공유 상수를 정의하는 것이 적절 (Recharts `contentStyle`은 JS 객체이므로 CSS 변수보다 JS 상수가 맞다).

---

## Engineer 제안에 누락된 Trader 고유 발견

Engineer 제안서에서 다루지 않은 Trader R6 항목이 2개 있다. 이들은 실거래 수익에 직접 영향을 미치므로 반드시 이번 스프린트에 포함되어야 한다:

### Trader R6-4: 전략 positionSide 조기 설정 제거 -- HIGH

15+ 전략에서 시그널 emit 시점에 `this._positionSide`를 설정하는 문제. SignalFilter가 차단하면 전략이 영구적으로 진입 불가 상태에 빠진다.

- **수익 영향**: 전략이 "포지션 있음"으로 인식하여 새 시그널을 발생시키지 않음 -> 수익 기회 완전 상실
- **발생 빈도**: 매 세션마다 복수 전략에서 발생 가능 (SignalFilter cooldown 60초, maxConcurrent 2)
- **난이도**: Low (반복 작업이지만 15+ 파일 수정 필요)

### Trader R6-7: CLOSE 시그널 qty 퍼센트 문제 -- HIGH

CLOSE 시그널의 `suggestedQty`가 퍼센트 값('5')인 채로 거래소에 제출되어 포지션 청산 실패.

- **수익 영향**: 포지션 청산 불가 -> 손실 확대, SL/TP 미작동 시 무제한 손실
- **구체 시나리오**: 0.002 BTC 보유 -> CLOSE qty='5' -> 거래소 reject (5 BTC 미보유) -> 포지션 미청산
- **난이도**: Medium (PositionManager에서 실제 수량 조회 로직 추가)

---

## 3-Agent 공통 이슈 분류

| 이슈 | Trader | Engineer | UI | 합의 수준 |
|------|--------|----------|----|-----------|
| `getAccountInfo` 크래시 | R6-5 (CRITICAL) | R6-1, R6-2 (T0) | -- | **3자 합의 (T/E)** -- 즉시 수정 |
| ExposureGuard price='0' | R6-1 (HIGH) | R6-3 (T1) | -- | **3자 합의 (T/E)** -- 실거래 전 필수 |
| 레버리지 미적용 | R6-2 (HIGH) | R6-4 (T1) | S1-2 (표시 보완) | **3자 합의** -- Engineer 구현 + UI 표시 |
| SignalFilter stale | S1-9 (MEDIUM) | R6-6 (T2) | -- | **2자 합의 (T/E)** -- 곧 수정 |
| Socket.io 보안 | -- | R6-7 (T2) | 연계 필요 | **2자 합의 (E/UI)** -- 동시 작업 필요 |
| 백테스트 disclaimer | S1 요청 (3) | -- | S1-3 (최우선) | **2자 합의 (T/UI)** -- 즉시 구현 |
| 전략-레짐 매트릭스 | S1 요청 (1) | -- | S1-1 (1.5시간) | **2자 합의 (T/UI)** -- Tier B |
| positionSide 조기 설정 | R6-4 (HIGH) | -- | -- | **Trader 단독** -- Engineer에 이관 |
| CLOSE qty 퍼센트 문제 | R6-7 (HIGH) | -- | -- | **Trader 단독** -- Engineer에 이관 |
| destroy() 미호출 | -- | R6-5 (T1) | -- | **Engineer 단독** -- 동의 |
| PaperEngine reset | -- | R6-9 (T2) | -- | **Engineer 단독** -- 동의 |
| 디자인 토큰 마이그레이션 | -- | -- | R6-1, R6-3 | **UI 단독** -- 동의 |
| Toast 시스템 | -- | -- | R6-2 (2시간) | **UI 단독** -- Round 7 이관 권장 |

---

## 스프린트 우선순위 의견

### 수익 영향도 기준 정렬 (Trader 관점)

| 순위 | 항목 | 수익 영향 | 담당 | 시간 |
|------|------|-----------|------|------|
| **1** | R6-1+R6-2 (getAccountInfo 크래시) | 실거래 불가 -> 수익 0 | Engineer | 25분 |
| **2** | R6-3 (ExposureGuard price) | 리스크 관리 무력화 -> 과대 손실 | Engineer | 30분 |
| **3** | Trader R6-7 (CLOSE qty %) | 포지션 청산 불가 -> 무제한 손실 | Engineer | 30분 |
| **4** | Trader R6-4 (positionSide) | 전략 영구 비활성 -> 기회 상실 | Engineer | 1.5시간 |
| **5** | R6-4 (레버리지) | 비의도적 고레버리지 -> 청산 위험 | Engineer | 1시간 |
| **6** | R6-5 (destroy) | 장기 운영 불안정 | Engineer | 45분 |
| **7** | S1-3 (disclaimer) | 과대 기대 방지 | UI | 20분 |
| **8** | S1-1 (레짐 매트릭스) | 전략 선택 정확도 향상 | UI | 1.5시간 |
| **9** | R6-6 (SignalFilter stale) | 장기 시그널 차단 | Engineer | 30분 |
| **10** | UI 디자인 토큰 (F-1, F-2) | UX 일관성 | UI | 55분 |

### 권장 스프린트 구성

```
Phase 1: CRITICAL 수정 (30분)
  Engineer: R6-1 + R6-2 (getAccountState/getBalances)

Phase 2: 리스크 정상화 (1시간 30분)
  Engineer: R6-3 (ExposureGuard) + Trader R6-7 (CLOSE qty)
  UI: S1-3 (disclaimer) -- 병렬 작업

Phase 3: 전략 상태 일관성 (2시간 30분)
  Engineer: Trader R6-4 (positionSide) + R6-5 (destroy)
  UI: UI-R6-1 (StrategyDetail 토큰) + UI-R6-3 (error.tsx) + 기타 quick fix -- 병렬 작업

Phase 4: 레버리지 + 시각화 (2시간 30분)
  Engineer: R6-4 (leverage) + R6-6 (SignalFilter)
  UI: S1-1 (레짐 매트릭스) -- 병렬 작업

총 예상 시간: ~6.5시간 (Engineer ~6시간, UI ~4시간 병렬)
```

### 이번 라운드에서 제외 권장 (Round 7 이관)

| 항목 | 사유 |
|------|------|
| Engineer R6-14 (InstrumentCache) | 2시간 투자 대비 현재 영향 낮음 |
| UI R6-2 (Toast 시스템) | 2시간 투자, alert() -> 인라인 메시지로 임시 처리 |
| UI R6-10 (심볼 입력 개선) | 1.5시간, 프리셋만 추가하면 됨 (옵션 A 축소 버전은 포함 가능) |
| Engineer R6-7 (Socket.io 보안) | 중요하지만 프론트엔드 동시 변경 필요, 별도 스프린트 |
| Engineer R6-8 (ticker throttle) | 15분이지만 UI 영향 테스트 필요 |

### Engineer에게 긴급 요청

**Trader R6-4(positionSide 조기 설정)와 R6-7(CLOSE qty 퍼센트)은 Engineer 제안서에 누락되어 있지만, 실거래 수익에 직접적 영향을 미치는 HIGH 이슈이다.** 이 두 건을 Engineer의 Phase 2-3에 반드시 포함시켜야 한다. 특히 R6-7은 포지션 청산 불가로 이어져 **무제한 손실** 위험이 있으므로 R6-3(ExposureGuard)과 함께 수정되어야 한다.

### UI에게 요청

1. **S1-3(disclaimer) 최우선 구현**: Phase 2에서 Engineer와 병렬로 20분이면 완료 가능
2. **S1-2(레버리지 표시)는 Engineer R6-4 완료 후로 지연**: 현재 Paper 모드에서 모든 포지션이 1x이므로 표시해도 의미 없음
3. **Toast 시스템은 Round 7 이관**: 이번 라운드에서는 `alert()` -> 인라인 메시지 임시 전환만 수행

---

*End of Round 6 Cross-Review*
