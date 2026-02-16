# Round 11 Proposal — Senior Quant Trader

> 작성일: 2026-02-17
> 주제: 코드베이스 재분석 — 새 개선과제 발굴
> 분석 범위: 서비스 레이어, 전략 시스템, 백테스트 엔진, 리스크 엔진, 시그널 필터

---

## 분석 요약

R1~R10에서 150건 이상의 개선 항목(AD-1 ~ AD-62)을 구현했으나, 심층 코드 리뷰를 통해 **11건의 신규 개선과제**를 발굴했다. 핵심 문제는 세 가지 축으로 분류된다:

1. **R10 트레일링 스탑 통합 불완전** — 6개 전략에 트레일링 스탑을 도입했으나, 전략별 기존 구현과의 중복, 누락된 호출, super.onFill() 미호출 등 일관성 문제가 존재
2. **백테스트-라이브 실행 갭** — getEquity()가 미실현 PnL을 무시, 펀딩 비용 미적용, 시그널 필터 미반영 등으로 백테스트 결과의 신뢰도가 실거래와 괴리
3. **포지션 사이징 고도화 부재** — 18개 전략 중 TurtleBreakout만 riskPerUnit 기반 사이징 사용. 나머지는 고정 비율 방식으로 변동성 적응력 없음

---

## 발견 사항

### F-1. 트레일링 스탑 이중 구현 (MaTrend, TurtleBreakout)

**심각도: HIGH** | **영향: 이중 청산 시그널 발생 가능**

MaTrendStrategy는 자체 트레일링 스탑 로직(lines 142-177: `_highestSinceEntry`/`_lowestSinceEntry` + `_trailingStopPercent`)과 R10에서 추가된 StrategyBase 메타데이터 트레일링(`metadata.trailingStop`)을 **동시에** 보유한다.

```javascript
// MaTrendStrategy.js — 자체 구현 (lines 142-177)
if (this._trailingStopPercent && this._entryPrice) {
  if (this._positionSide === 'long') {
    this._highestSinceEntry = Math.max(this._highestSinceEntry || price, price);
    const trailingStop = this._highestSinceEntry * (1 - this._trailingStopPercent / 100);
    if (price <= trailingStop) { /* emit close signal */ }
  }
}

// StrategyBase.js — R10 메타데이터 구현 (line 424)
_checkTrailingStop(price) {
  if (!this._trailingState) return null;
  // activationPercent → callbackPercent 2단계 로직
}
```

TurtleBreakoutStrategy도 동일한 문제: ATR 기반 자체 트레일링(lines 195-230) + StrategyBase 메타데이터 트레일링 공존.

**위험**: 두 메커니즘이 동시에 작동하면 동일 포지션에 대해 2개의 close 시그널이 발생하여, orderManager에서 이미 청산된 포지션에 대한 주문을 시도할 수 있다.

---

### F-2. BollingerReversionStrategy super.onFill() 누락

**심각도: MEDIUM** | **영향: StrategyBase 트레일링 상태 미갱신**

BollingerReversionStrategy.onFill()은 `super.onFill(fill)`을 호출하지 않는다. 다른 전략(RsiPivot, MaTrend, Supertrend, Turtle)은 모두 호출한다.

```javascript
// BollingerReversionStrategy.js line 391 부근
onFill(fill) {
  // 자체 로직만 실행, super.onFill(fill) 없음
  this._updateSplitEntryState(fill);
}

// 비교: RsiPivotStrategy.js
onFill(fill) {
  super.onFill(fill);  // StrategyBase 트레일링 상태 업데이트
  this._updateLocalState(fill);
}
```

현재 Bollinger에는 트레일링 메타데이터가 없어 즉각적 문제는 없지만, 향후 트레일링 활성화 시 작동하지 않는 잠재적 결함이다. 또한 StrategyBase.onFill()의 다른 기능(포지션 상태 동기화 등)도 누락된다.

---

### F-3. RsiPivot/Supertrend — _checkTrailingStop() 미호출

**심각도: HIGH** | **영향: 트레일링 스탑 메타데이터 설정했으나 실제로 작동하지 않음**

RsiPivotStrategy는 `metadata.trailingStop = { activationPercent: '1.0', callbackPercent: '0.8' }`을 설정하고, onFill()에서 super.onFill()을 호출하여 `_trailingState`가 초기화된다. 그러나 **onTick()이나 _checkExitOnTick()에서 `this._checkTrailingStop(price)`를 한 번도 호출하지 않는다.**

```javascript
// RsiPivotStrategy.js — metadata에 트레일링 설정됨
static metadata = {
  trailingStop: { activationPercent: '1.0', callbackPercent: '0.8' },
  // ...
};

// _checkExitOnTick() — TP/SL만 체크, 트레일링 체크 없음
_checkExitOnTick(price) {
  // takeProfit 체크
  // stopLoss 체크
  // _checkTrailingStop(price) 호출 없음!
}
```

SupertrendStrategy도 동일: 메타데이터에 트레일링 설정은 있지만 _checkTpSl()에서 _checkTrailingStop()을 호출하지 않는다.

**결과**: R10에서 의도한 트레일링 스탑 기능이 이 2개 전략에서는 사실상 비활성 상태이다.

---

### F-4. _entryPrice 설정 시점 불일치 (AD-37 패턴 위반)

**심각도: MEDIUM** | **영향: 미체결 주문의 잘못된 상태 참조**

AD-37은 "OPEN 시그널 발행 시 _positionSide/_entryPrice를 설정하지 말고, onFill()에서 실제 체결 후 설정하라"는 결정이다. RsiPivotStrategy는 이를 준수하지만:

```javascript
// MaTrendStrategy.js lines 328-330 — onKline에서 시그널 발행 시 설정
this._entryPrice = close;
this._positionSide = 'long';
this.emitSignal({ action: 'open_long', ... });

// TurtleBreakoutStrategy.js lines 381-382 — 동일 패턴
this._entryPrice = close;
this._positionSide = 'long';
```

RsiPivot은 onFill()에서만 설정하고, MaTrend/Turtle은 시그널 발행 시점에 설정한다. 문제: 주문이 거부되거나 지연되면 잘못된 _entryPrice가 남아 TP/SL 계산이 틀어진다.

---

### F-5. 백테스트 getEquity()가 미실현 PnL 무시

**심각도: HIGH** | **영향: 포지션 사이징 왜곡**

BacktestEngine에서 전략에 주입하는 getEquity()가 현금(cash)만 반환하고 열린 포지션의 미실현 손익을 포함하지 않는다:

```javascript
// backtestEngine.js line 426
getEquity: () => this._cash,
```

전략이 `accountContext.getEquity()`를 사용하여 포지션 크기를 결정할 때, 큰 미실현 이익이 있어도 이를 반영하지 못한다. 반대로 미실현 손실 상태에서도 과대 포지션을 잡을 수 있다.

라이브 환경에서는 botService._resolveSignalQuantity()가 positionManager/exchangeClient로부터 실제 잔고(미실현 PnL 포함)를 가져오므로, **백테스트와 라이브 간 포지션 사이징 결과가 다르다.**

---

### F-6. 백테스트 펀딩 비용 미적용 (Phase 1 한계)

**심각도: MEDIUM** | **영향: 장기 보유 전략의 수익률 과대 추정**

BacktestEngine은 펀딩 비용을 시뮬레이션하지만(R10-T1-3), 실제로 cash/equity에 반영하지 않는다:

```javascript
// backtestEngine.js lines 985-986 부근
// Phase 1: funding PnL은 _fundingAccumulated에 누적만
// cash 차감은 TODO로 남아있음
```

8시간 간격 펀딩이 장기 포지션의 수익을 상당히 잠식하는데(연 10~30% 비용 가능), 백테스트 결과에서 이를 무시하면 과도하게 낙관적인 성과를 보고한다. 특히 GridStrategy, BollingerReversion 등 보유 기간이 긴 전략에 영향이 크다.

---

### F-7. SignalFilter 클로즈 바이패스 로직 오류

**심각도: HIGH** | **영향: 정당한 청산 시그널이 필터링될 수 있음**

SignalFilter.passAll() line 136에서:

```javascript
const isClose = action === 'CLOSE' || signal.reduceOnly;
```

그러나 SIGNAL_ACTIONS 상수에는 `'CLOSE'`가 없다. 실제 액션 값은 `'close_long'`, `'close_short'`이다:

```javascript
// constants.js
SIGNAL_ACTIONS: { OPEN_LONG: 'open_long', OPEN_SHORT: 'open_short',
                  CLOSE_LONG: 'close_long', CLOSE_SHORT: 'close_short' }
```

따라서 `action === 'CLOSE'`는 **항상 false**. 클로즈 바이패스는 오직 `signal.reduceOnly === true`인 경우에만 작동한다. 문제: TP/SL에 의한 청산 시그널이나 전략의 일반 청산 시그널은 `reduceOnly`를 반드시 설정하지 않는다. 이 경우 쿨다운, 중복, 최대 동시 포지션 필터에 의해 청산이 차단될 수 있다.

**검증 필요**: 실제로 어떤 전략이 close 시그널에 reduceOnly를 설정하는지 전수 조사 필요.

---

### F-8. CoinSelector F7(volMomentum) = F1(volume) 중복

**심각도: LOW** | **영향: 7-factor 스코어링에서 실질 6-factor만 활용**

```javascript
// coinSelector.js
// F1 — line 311
factorArrays.volume.push(c.vol24h);

// F7 — line 342
factorArrays.volMomentum.push(c.vol24h);  // 동일한 값!
```

F7 "volMomentum"은 24시간 거래량의 **변화율**(이전 대비 증감)을 추적해야 의미가 있지만, 현재 F1과 동일한 절대 거래량을 사용한다. 결과적으로 7-factor 중 2개가 동일하여, 거래량에 과도한 가중치가 부여되고 다른 요소(모멘텀 변화)를 놓친다.

---

### F-9. 변동성 기반 포지션 사이징 부재

**심각도: MEDIUM** | **영향: 전략 성과 편차 및 리스크 불균등**

18개 전략 중 TurtleBreakout만이 `riskPerUnit`(ATR 기반)를 ExposureGuard에 전달하여 2% 리스크 룰을 적용한다. 나머지 17개 전략은 고정 `positionSizePercent`(에퀴티의 3~5%)를 사용:

```javascript
// botService.js _resolveSignalQuantity()
const pct = signal.positionSizePercent || DEFAULT_POSITION_SIZE_PCT;
const notional = multiply(equityStr, String(pct / 100));
```

이는 변동성이 높은 코인(ATR 5% vs 1%)에 동일 비율을 할당하여:
- 고변동성 코인: 과대 리스크 → 손실 폭 확대
- 저변동성 코인: 과소 배분 → 수익 기회 미활용

Kelly Criterion이나 변동성 타겟팅을 도입하면 리스크 대비 수익률(Sharpe)을 유의하게 개선할 수 있다.

---

### F-10. 최대 보유 시간 제한 없음

**심각도: MEDIUM** | **영향: 자본 잠식 + 펀딩 비용 누적**

어떤 전략에도 `maxHoldTime` 또는 시간 기반 강제 청산 로직이 없다. TP/SL/트레일링/지표 청산이 모두 트리거되지 않으면 포지션이 무기한 유지된다.

실제 위험 시나리오:
- 횡보장에서 RSI가 중립 구간에 머무르면 RsiPivot 포지션이 청산 조건 미달
- Grid 전략의 그리드 밖 가격 이동 시 비정상 장기 보유
- 펀딩 비용이 누적되어 실현 PnL을 잠식

StrategyBase에 `maxHoldBars` 또는 `maxHoldMinutes` 메타데이터를 추가하고, onTick/onKline에서 경과 시간 체크 후 강제 청산하는 메커니즘이 필요하다.

---

### F-11. PaperEngine TP 트리거 시뮬레이션 없음

**심각도: MEDIUM** | **영향: 페이퍼 트레이딩에서 TP 미작동**

PaperEngine은 SL(Stop-Loss) 트리거 시뮬레이션은 구현되어 있으나, TP(Take-Profit) 트리거 시뮬레이션이 없다:

```javascript
// paperEngine.js — _checkStopLossTriggers() 존재
// _checkTakeProfitTriggers() 부재
```

페이퍼 모드에서 TP 주문이 실제로 체결되지 않으면, 수익 실현이 지연되거나 누락되어 페이퍼 트레이딩 성과가 라이브와 다르게 나타난다.

---

## 제안 사항

| ID | 이슈 | 우선순위 | 구현 난이도 | 예상 시간 | 담당 |
|----|------|---------|-----------|----------|------|
| R11-T1 | 트레일링 스탑 통합: 전략별 자체 구현 제거, StrategyBase 단일 경로로 통일 | Tier 0 | 중 | 3h | Backend |
| R11-T2 | RsiPivot/Supertrend: onTick에서 _checkTrailingStop() 호출 추가 | Tier 0 | 하 | 1h | Backend |
| R11-T3 | BollingerReversion: super.onFill(fill) 호출 추가 | Tier 0 | 하 | 0.5h | Backend |
| R11-T4 | MaTrend/Turtle: _entryPrice 설정을 onFill()로 이동 (AD-37 준수) | Tier 0 | 중 | 2h | Backend |
| R11-T5 | SignalFilter 클로즈 바이패스: action.startsWith('close') 패턴으로 수정 | Tier 0 | 하 | 0.5h | Backend |
| R11-T6 | 백테스트 getEquity: 미실현 PnL 포함하도록 수정 | Tier 1 | 중 | 2h | Backtest |
| R11-T7 | 백테스트 펀딩 비용 cash 반영 (Phase 2) | Tier 1 | 중 | 2h | Backtest |
| R11-T8 | CoinSelector F7 volMomentum: 거래량 변화율로 수정 | Tier 1 | 하 | 1h | Backend |
| R11-T9 | 변동성 기반 포지션 사이징 (ATR 사이징 모듈) | Tier 2 | 상 | 5h | Backend |
| R11-T10 | StrategyBase maxHoldTime 메타데이터 + 강제 청산 | Tier 2 | 중 | 3h | Backend |
| R11-T11 | PaperEngine TP 트리거 시뮬레이션 추가 | Tier 1 | 중 | 2h | Backend |

### 구현 순서 권장

```
Phase 1 (Tier 0 — 즉시): R11-T5, R11-T3, R11-T2, R11-T4, R11-T1
  → 시그널 필터 버그 수정 → Bollinger onFill → 트레일링 호출 추가 → entryPrice 이동 → 트레일링 통합

Phase 2 (Tier 1 — 1주 내): R11-T6, R11-T7, R11-T8, R11-T11
  → 백테스트 정확도 향상 + CoinSelector 개선 + PaperEngine 보완

Phase 3 (Tier 2 — 2주 내): R11-T9, R11-T10
  → ATR 사이징 모듈 + 최대 보유 시간
```

### 의존성 관계
- R11-T1 (트레일링 통합) 후에 R11-T2 (호출 추가)가 더 깔끔해짐 → 순서 주의
- R11-T6 (getEquity 수정)은 R11-T9 (ATR 사이징)의 선행 조건
- R11-T4 (entryPrice 이동)는 R11-T1 (트레일링 통합)과 독립 병렬 가능

---

## 다른 에이전트에게 요청 사항

### Engineer에게

1. **R11-T5 (SignalFilter 바이패스)**: 단순 문자열 비교 버그이지만 안전성이 최우선인 부분. `action === 'CLOSE'`를 `action.startsWith('close')` 또는 `['close_long', 'close_short'].includes(action)`으로 변경 시 사이드 이펙트 검토 부탁. reduceOnly와의 OR 조합이 모든 청산 경로를 커버하는지 확인 필요.

2. **R11-T1 (트레일링 통합)**: MaTrend의 자체 트레일링(`_highestSinceEntry` 방식)과 StrategyBase의 2단계 트레일링(`activationPercent → callbackPercent`)은 로직이 다름. 통합 시 기존 MaTrend 트레일링의 동작을 StrategyBase 파라미터로 매핑하는 방안 검토 부탁.

3. **R11-T6 (getEquity)**: 미실현 PnL 계산 시 Map 기반 다중 포지션의 합산 로직이 필요. 성능 영향(매 틱마다 Map 순회) 검토 부탁.

4. **R11-T9 (ATR 사이징)**: ExposureGuard의 기존 3-tier 구조(riskPerUnit → 단일 포지션 캡 → 총 노출 캡)에 ATR 사이징을 통합하는 아키텍처 설계 부탁. 가능하면 StrategyBase에서 ATR을 자동 계산하여 riskPerUnit을 시그널에 포함하는 방식 제안.

### UI/UX에게

1. **트레일링 스탑 상태 시각화**: R11-T1 통합 후 트레일링 활성 상태(activated vs not), 현재 트레일링 스탑 가격을 대시보드 포지션 카드에 표시하면 운영 가시성이 크게 향상됨.

2. **백테스트 결과에 펀딩 비용 표시**: R11-T7 구현 후 백테스트 결과 페이지에 총 펀딩 비용, 펀딩 반영 전/후 순이익 비교를 표시하면 전략 평가에 유용.

3. **포지션 보유 시간 표시**: R11-T10 구현 전이라도, 현재 열린 포지션의 보유 경과 시간을 포지션 목록에 추가하면 장기 보유 포지션을 수동 모니터링할 수 있음.
