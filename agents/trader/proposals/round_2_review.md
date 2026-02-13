# Round 2 Review -- Senior Quant Trader

> 리뷰어: Senior Quant Trader Agent
> 날짜: 2026-02-14
> 대상: Engineer Round 2 제안서 (`agents/engineer/proposals/round_2.md`), UI Round 2 제안서 (`agents/ui/proposals/round_2.md`)
> 관점: 트레이딩 수익성, 리스크 관리, 포지션 사이징 정확성

---

## Engineer 제안서 리뷰

---

### T0-1: 기본 전략 이름 수정

**✅ 동의**

Engineer가 제안한 기본 5개 전략(RsiPivot, MaTrend, BollingerReversion, Supertrend, TurtleBreakout)은 내 제안서에서 선정한 5개와 동일하다. 선정 근거도 일치:
- 5개 레짐 모두 커버
- indicator-light 4개 + price-action 1개로 지표 과밀 방지
- 전략 간 상관관계가 낮음

레거시 전략(`sampleStrategies.js`)을 제거하지 않는 결정도 올바르다.

---

### T0-2: Position Sizing (percentage -> quantity 변환)

**⚠️ 조건부 동의**

핵심 로직(`_resolveSignalQuantity()`)은 올바르다. equity 조회, percentage -> notional -> qty 변환 파이프라인이 정확하다.

**보완 필요 사항 3건**:

#### 1. 거래소 lot precision (floor) 누락

`math.divide(allocatedValue, price)` 결과가 `'0.00833333'`처럼 거래소가 허용하지 않는 소수점을 포함할 수 있다. Bitget USDT-FUTURES의 BTC 최소 단위는 0.001, ETH는 0.01.

**반드시 추가해야 할 코드**:
```javascript
const qtyFloat = parseFloat(qty);
qty = String(Math.floor(qtyFloat * 10000) / 10000); // 임시: 4자리 floor
```

floor 사용 이유: round-up하면 잔고 초과 주문 발생 가능. **반드시 floor**.

#### 2. close 주문(reduceOnly)에 대한 예외 처리 부재

현재 제안에서는 모든 시그널에 `_resolveSignalQuantity()`를 적용한다. 그러나 close_long/close_short 시그널의 `suggestedQty`는 percentage가 아니라 "보유 중인 포지션 수량"이어야 한다. 전략이 close 시그널을 발행할 때도 `positionSizePercent`를 넣으면, 보유량의 5%만 청산하게 되어 포지션이 점진적으로만 줄어드는 문제 발생.

**추가 필요 로직**:
```javascript
if (signal.action === 'close_long' || signal.action === 'close_short') {
  return signal.suggestedQty || signal.qty; // 전략이 명시한 수량 사용
}
```

#### 3. `positionSizing` 메타데이터 필드는 불필요

18개 전략 중 `positionSizing: 'absolute'`를 사용하는 전략은 0개. 모두 `positionSizePercent`를 `suggestedQty`에 넣고 있으므로, 불필요한 분기를 추가할 필요 없다. **단순하게 모든 open 시그널에 percentage 변환을 적용**.

---

### T0-3: Multi-symbol Routing (Set 기반)

**⚠️ 조건부 동의**

Set 기반 설계는 올바르며, API는 깔끔하다. `_currentProcessingSymbol`을 try-finally로 관리하는 패턴도 적절하다.

**보완 필요 사항 2건**:

#### 1. 전략 내부 상태(priceHistory, entryPrice) 심볼 혼재 위험

현재 18개 전략 중 다수가 `this._entryPrice`, `this._highestHigh`, `this._lowestLow`, `this._priceHistory` 같은 스칼라 상태를 유지. 한 전략 인스턴스가 여러 심볼의 데이터를 받으면, BTC의 priceHistory에 ETH 가격이 섞이는 문제 발생.

**권장**:
- Phase 1에서는 **전략당 1심볼만 허용**하여 기존 스칼라 상태가 안전하게 동작하도록 보장
- Phase 2에서 `Map<symbol, state>` 패턴으로 상태 분리

#### 2. `emitSignal()`의 symbol 폴백 체인

Engineer 제안: `symbol: signalData.symbol || this._currentProcessingSymbol || this._symbol`
이 순서는 적절하다. 동의.

---

### T0-4: unhandledRejection / uncaughtException 핸들러

**✅ 동의**

Engineer 제안이 내 제안보다 개선된 부분:
1. `isShuttingDown` 중복 shutdown 방지 플래그
2. `safeShutdown()`으로 SIGTERM/SIGINT도 통합
3. `forceExitTimer.unref()`
4. riskEngine에 RISK_EVENTS.ORDER_REJECTED 발행

크립토 시장은 24/7이므로 프로세스 재시작 중 포지션이 방치되는 것이 unhandledRejection보다 위험하다.

---

### T0-5: OrderManager per-symbol Mutex

**✅ 동의**

Promise 체인 기반 직렬화가 내 while 루프 방식보다 정교하다. **Engineer 방식을 채택하는 것이 올바르다**.

---

### T0-6: ExposureGuard equity=0 Division by Zero

**✅ 동의**

내 제안과 동일. defense-in-depth 접근(ExposureGuard + RiskEngine 양쪽 방어)은 올바르다.

---

### RiskEvent 모델 스키마 설계

**⚠️ 조건부 동의**

스키마 설계는 포괄적이고 잘 구성됨.

**보완 필요 사항**:
- `riskSnapshot`에 `openPositionCount: Number` 추가 필요 -- 사후 분석에 필수
- `riskSnapshot`에 `peakEquity: String` 추가 필요 -- drawdown 계산 기준 고점

TTL 30일 적절. `acknowledged` 패턴은 트레이딩 관점에서 중요.

---

## UI 제안서 리뷰

---

### T0-7: Emergency Stop ConfirmDialog

**⚠️ 조건부 동의**

기존 `ConfirmDialog` 재사용은 올바르다.

**보완 필요 사항 2건**:

#### 1. 메시지 내용 수정 필요

현재 제안 메시지의 "열린 포지션은 유지되지만"은 편한 게 아니라 **위험한 것**이다.

수정 권장:
> "모든 미체결 주문이 취소되고 봇이 즉시 정지됩니다. **열린 포지션은 자동 청산되지 않으며, 수동으로 관리해야 합니다.** 리스크 관리(서킷 브레이커, 드로다운 모니터)가 중단됩니다."

"수동으로 관리해야 합니다"가 핵심. 리스크 엔진 없이 열린 포지션이 방치되면 무한 손실 가능.

#### 2. 현재 포지션 정보 표시 추가

ConfirmDialog에 표시 필요:
- 현재 열린 포지션 수 (예: "현재 3개 포지션 오픈 중")
- 총 미실현 PnL (예: "미실현 손익: -$234.50")

---

### T0-8: Risk 이벤트 실시간 UI 표시 + RiskAlertBanner

**✅ 동의**

잘 설계되었다. 이벤트 유형별 분류, 최대 5개 표시 제한, aria-live 적용 모두 적절하다.

**보충 의견**: `exposure_adjusted` 이벤트도 배너에 표시 권장 (severity: info, 5초 자동 닫기). ExposureGuard 개입을 트레이더가 인지해야 한다.

---

### T0-9: 실거래/가상거래 모드 시각적 경고 강화

**⚠️ 조건부 동의**

3단계 시각적 신호는 올바른 접근이다.

**보완 필요 사항 2건**:

#### 1. Paper 모드 색상 변경

주황(amber) → 초록(emerald) 변경 권장. 주황색은 "경고"의 의미. Paper 모드는 안전한 상태이므로 빨강(위험/LIVE)과 초록(안전/PAPER)의 대비가 직관적이다.

#### 2. LIVE 모드 봇 시작 시 추가 확인 필요

시각적 구분만으로는 실수 방지 불충분. BotControlPanel의 "시작" 버튼에서 `tradingMode === 'live'`일 때:
> "실거래(LIVE) 모드에서 봇을 시작합니다. 실제 자금이 사용됩니다. 계속하시겠습니까?"

---

### 타입 변경 사항

**✅ 동의**

- `StrategyInfo.symbols: string[]` 추가: 프론트엔드에서 전략 관리 심볼 수 표시 가능
- `Signal.positionSizePercent`, `resolvedQty` 추가: 디버깅과 전략 튜닝에 큰 도움
- `RiskEvent` 타입: Engineer의 `severity`, `eventType`, `source` 필드 포함 권장

---

## 종합 의견

### 최우선 보완 사항 (반드시 반영)

| 순위 | 항목 | 대상 | 사유 |
|------|------|------|------|
| 1 | T0-2: close 시그널에 percentage 변환 적용하면 안 됨 | Engineer | 포지션 청산 불완전 → 무한 잔여 포지션 |
| 2 | T0-2: qty를 lot precision으로 floor 처리 | Engineer | 거래소 거부 또는 잔고 초과 주문 |
| 3 | T0-3: 전략 내부 스칼라 상태 심볼 혼재 대책 | Engineer | 시그널 품질 오염 → 잘못된 매매 |
| 4 | T0-7: ConfirmDialog 메시지에 "수동 관리 필요" 명시 | UI | 트레이더가 포지션 방치 위험 미인지 |
| 5 | T0-9: LIVE 모드 봇 시작 시 별도 확인 다이얼로그 | UI | 시각적 구분만으로는 실수 방지 불충분 |

### 낮은 우선순위 보완 (권장)

| 항목 | 대상 | 사유 |
|------|------|------|
| RiskEvent riskSnapshot에 openPositionCount, peakEquity 추가 | Engineer | 사후 분석 완성도 향상 |
| T0-9 Paper 모드 색상을 amber → emerald로 변경 | UI | 경고/안전 색상 직관성 |
| T0-8 exposure_adjusted 이벤트도 배너 표시 | UI | ExposureGuard 개입 인지 |
| T0-2 positionSizing 메타데이터 분기 제거 (단순화) | Engineer | 불필요한 복잡성 제거 |

---

*본 리뷰는 Senior Quant Trader Agent가 트레이딩 수익성과 리스크 관리 관점에서 작성하였다. 양 제안서 모두 전반적으로 견실하며, 위에 명시된 보완사항만 반영하면 Tier 0 구현을 진행해도 된다.*
