# Round 13 Proposal: 전략 모듈화 + 상세 파라미터 튜닝 + UX

**작성자**: Senior Quant Trader Agent
**날짜**: 2026-02-17
**우선순위**: Critical (사용자 직접 요청, 핵심 UX 개선)

---

## 분석 요약

18개 전략의 소스코드를 직접 분석한 결과, **기술적으로 모듈화는 이미 상당 수준 달성**되어 있으나 **사용자에게 보이지 않는 것이 핵심 문제**이다. 장세판단(MarketRegime), 전략(Strategy), 자금관리(RiskEngine/ExposureGuard), 레버리지(각 전략 defaultConfig) 모듈은 모두 분리되어 있지만, 사용자 관점에서:

1. **각 전략이 무엇을 하는지 설명이 전무** -- `description` 필드가 한 줄짜리 요약만 존재
2. **분봉(timeframe) 정보가 어디에도 명시되지 않음** -- 실제로는 모든 전략이 **1분봉(candle1m)** 을 수신하고, 전략 내부에서 자체 집계(MaTrend: 1h/4h/일봉, TrendlineBreakout: 15~240분봉 등)
3. **진입/청산 로직의 사람이 읽을 수 있는 설명이 없음** -- 코드의 JSDoc 주석에만 존재
4. **손절/익절 라인이 전략마다 다르게 구현**되어 있고, 이를 통합적으로 보여주는 뷰가 없음
5. **레버리지가 전략마다 하드코딩**(3x~5x)되어 있고, 일부 전략은 시그널에 leverage를 포함하지만 실제 적용 여부는 OrderManager 의존
6. **자금관리 모듈(ExposureGuard)의 2% 룰이 사용자에게 보이지 않음**

---

## 발견 사항 (코드 레벨 근거 포함)

### 1. 타임프레임(분봉) 현황

**치명적 발견**: `marketData.js:157`에서 모든 심볼에 대해 `candle1m`(1분봉)만 구독한다. 전략이 더 높은 타임프레임을 사용하려면 **자체적으로 집계**해야 한다.

| 전략 | 실제 사용 타임프레임 | 구현 방식 | 코드 근거 |
|------|---------------------|-----------|-----------|
| TurtleBreakout | 1분봉 (직접 사용) | klineHistory에 1분봉 누적, Donchian 20/10/50봉 계산 | `turtleBreakoutStrategy.js:257-278` |
| MaTrend | 1시간/4시간/일봉 | 1분봉을 **자체 집계** (4개=4h, 24개=daily) | `maTrendStrategy.js:261-280` |
| Supertrend | 1분봉 (직접 사용) | klineHistory에 1분봉 누적 | `SupertrendStrategy.js:172-183` |
| BollingerReversion | 1분봉 (IndicatorCache) | IndicatorCache에서 BB/RSI/Stoch 계산 | `bollingerReversionStrategy.js:207-224` |
| AdaptiveRegime | 1분봉 (IndicatorCache) | IndicatorCache에서 모든 지표 계산 | `adaptiveRegimeStrategy.js:260-284` |
| Grid | 1분봉 (ATR 계산) | onKline에서 ATR 산출 후 그리드 레벨 구축 | `gridStrategy.js:96-99` |
| FundingRate | 펀딩비 수신 기반 | onFundingUpdate()로 8시간 주기 펀딩비 활용 | `fundingRateStrategy.js:53-62` |
| TrendlineBreakout | 15~240분봉 (집계) | `aggregationMinutes` config로 분봉 자체 집계 | `strategyParamMeta.js:84` |

**문제**: MaTrend가 1분봉을 h1Count로 4/24개씩 집계하지만, **실제 WebSocket에서 들어오는 것은 1분봉**이므로 24개 = 24분이지 24시간이 아니다. 이는 **백테스트와 라이브의 동작이 다를 수 있는 심각한 문제**이다. (백테스트 엔진은 별도로 kline 데이터를 시간 기반으로 제공)

**사용자에게 이 정보가 전혀 노출되지 않음.**

### 2. 진입/청산 로직 분석 (5개 전략 심층 분석)

#### TurtleBreakoutStrategy
- **진입 Long**: 종가 > 20봉 최고가(Donchian Upper) AND 종가 > 50봉 중간선(Trend Filter)
- **진입 Short**: 종가 < 20봉 최저가(Donchian Lower) AND 종가 < 50봉 중간선
- **청산**: 10봉 Donchian Exit Channel 돌파 / ATR x2 Stop Loss / ATR x2 Trailing Stop
- **손절**: `ATR(20) x stopMultiplier(2)` = 진입가 기준 ATR의 2배
- **레버리지**: 3x (defaultConfig.leverage)
- **포지션 크기**: 4% (fallback, ExposureGuard의 2% rule이 실제 적용)
- **코드 근거**: `turtleBreakoutStrategy.js:362-398` (Long entry), `:301-316` (Donchian exit), `:186-203` (ATR stop)

#### MaTrendStrategy
- **진입 Long**: 일봉 EMA20>EMA60 + 4시간 EMA20>EMA50 + 1시간 EMA9>EMA21 + 가격이 EMA21 +-1% 범위 진입(pullback) + 양봉(close>open) + 거래량 > 20기간 평균
- **진입 Short**: 위 조건의 반대
- **청산**: TP +4% / SL -2% / Trailing Stop -2% from extreme / 1h EMA crossover / 4h trend break
- **레버리지**: 3x (하드코딩, `maTrendStrategy.js:349`)
- **포지션 크기**: 5%
- **코드 근거**: `maTrendStrategy.js:331-369` (Long entry), `:192-225` (TP/SL), `:636-671` (EMA exit)

#### BollingerReversionStrategy
- **진입 Long**: 직전 종가 < BB하단 AND 현재 종가 > BB하단 (밴드 재진입) + RSI 30 상향돌파 + Stoch %K > %D (과매도 구간) + 밴드폭 > 2%
- **청산**: BB중간선 도달시 50% 청산, BB반대편 도달시 나머지 청산, SL -4%
- **분할매수**: 최대 3회 (40%/30%/30%)
- **레버리지**: 3x (하드코딩, `:319`)
- **포지션 크기**: 5% (분할)
- **코드 근거**: `bollingerReversionStrategy.js:295-326` (Long), `:438-508` (TP logic)

#### SupertrendStrategy
- **진입 Long**: Supertrend 방향 전환 (DOWN->UP) + MACD 골든크로스 (MACD>Signal + Histogram>0) + Volume Oscillator > 0
- **청산**: Supertrend 역전환 / MACD 데드크로스 / TP +3% / SL -2%
- **레버리지**: 5x (하드코딩, `:706`)
- **포지션 크기**: 5%
- **코드 근거**: `SupertrendStrategy.js:688-727` (Long entry), `:616-641` (Long exit)

#### AdaptiveRegimeStrategy
- **TRENDING_UP 진입**: EMA9>EMA21 + RSI 40-50 pullback + ADX>25
- **RANGING 진입**: 가격 < BB하단 + RSI<35 (Long), 가격 > BB상단 + RSI>65 (Short)
- **VOLATILE 진입**: RSI<25 과매도 반등 + 거래량 급증 (Long), RSI>75 + 거래량 급증 (Short)
- **QUIET**: 진입하지 않음 (데이터 축적)
- **손절**: 추세장 ATR x1.5, 횡보/변동장 ATR x0.8
- **익절**: 추세장 ATR x2, 횡보/변동장 ATR x1
- **레버리지**: 추세 3x, 횡보 2x, 변동 3x (레짐별 차등)
- **포지션 크기**: 추세 3%, 횡보 2%, 변동 4% (레짐별 차등)
- **코드 근거**: `adaptiveRegimeStrategy.js:410-484` (Trend entries), `:490-545` (Ranging), `:551-606` (Volatile)

### 3. 손절/익절 라인 총정리

| 전략 | 손절(SL) | 익절(TP) | 트레일링 | 구현 위치 |
|------|---------|---------|----------|-----------|
| Turtle | ATR x2 (동적) | Donchian 10봉 Exit | ATR x2 활성 후 ATR x2 추적 | onTick + onKline |
| MaTrend | -2% (고정) | +4% (고정) | -2% from extreme | onTick |
| Bollinger | -4% (고정) | BB middle(50%) + BB opposite(100%) | 없음 | onTick + onKline |
| Supertrend | -2% (고정) | +3% (고정) | 없음 (Supertrend 반전으로 대체) | onTick |
| AdaptiveRegime | ATR x0.8~1.5 (동적) | ATR x1~2 (동적) | ATR x1 (추세장만) | onTick + onKline |
| Grid | -3% equity drawdown | 1 그리드 간격 | 없음 | onTick |
| FundingRate | -2% (고정) | +3% (고정) | 없음, 24시간 시간제한 | onTick |
| RSIPivot | configurable | configurable | 없음 | onTick |
| VWAP | ATR x slAtrMult | 없음 (시간제한) | 없음, maxHoldCandles 제한 | onKline |

**문제**: 사용자가 이 정보를 확인할 방법이 전무. metadata.description은 한 줄짜리이고, 이런 상세 정보가 프론트엔드에 표시되지 않음.

### 4. 레버리지 결정 구조

현재 레버리지는 **전략별 defaultConfig에 하드코딩**되어 있다:
- Turtle: 3x (`turtleBreakoutStrategy.js:80`)
- MaTrend: 3x (`maTrendStrategy.js:349` -- 시그널에 하드코딩)
- Supertrend: 5x (`SupertrendStrategy.js:706` -- 시그널에 하드코딩)
- Bollinger: 3x (`bollingerReversionStrategy.js:319` -- 시그널에 하드코딩)
- AdaptiveRegime: 2~3x (레짐별 동적, `adaptiveRegimeStrategy.js:63-65`)
- Grid: 2x (`gridStrategy.js:77`)

**문제**:
1. 일부 전략은 `this.config.leverage`를 참조하고, 일부는 시그널에 직접 문자열 리터럴로 하드코딩 (`leverage: '3'`, `leverage: '5'`)
2. `strategyParamMeta.js`에서 레버리지 파라미터가 정의되어 UI에서 변경 가능하지만, 변경한 값이 실제 시그널에 반영되지 않는 전략이 있음 (하드코딩된 경우)
3. **글로벌 레버리지 한도 설정이 없음** -- 사용자가 개별 전략에 20x를 설정할 수 있지만 이를 제한하는 상위 메커니즘이 없음

### 5. 자금관리(RiskEngine/ExposureGuard) 현황

**이미 잘 구현됨**:
- `ExposureGuard.validateOrder()` (`exposureGuard.js:76-185`):
  - **2% 룰**: `riskPerUnit` 제공 시 최대 손실이 equity의 2%를 초과하지 않도록 qty 조정
  - **단일 포지션 한도**: equity의 5% (DEFAULT_RISK_PARAMS.maxPositionSizePercent)
  - **총 노출 한도**: equity의 30% (DEFAULT_RISK_PARAMS.maxTotalExposurePercent)
- `DrawdownMonitor`: 최대 낙폭 10%, 일일 손실 3% 초과 시 거래 중단
- `CircuitBreaker`: 연속 5회 손실 시 30분 쿨다운

**문제**: 이 정보가 프론트엔드의 `RiskStatusPanel`에 부분적으로만 표시됨. 특히:
- 전략별 포지션 크기가 ExposureGuard에 의해 조정되었는지 여부가 사용자에게 보이지 않음
- 2% 룰이 적용된 경우 원래 qty와 조정된 qty의 차이가 표시되지 않음
- 글로벌 리스크 파라미터 수정 UI가 없음

### 6. 모듈화 수준 평가

| 모듈 | 현재 분리 수준 | 사용자 인지 수준 | 개선 필요 |
|------|--------------|----------------|----------|
| 장세판단 (MarketRegime) | 완전 분리 (6-Factor Scoring) | 부분적 (대시보드에 현재 레짐 표시) | 파라미터 튜닝 UI 필요 |
| 전략 (Strategy) | 완전 분리 (18개 독립 모듈) | 최소 (이름 + 한줄 설명) | 상세 설명 + 동작 시각화 |
| 자금관리 (RiskEngine) | 완전 분리 (3개 서브 엔진) | 최소 (리스크 상태만) | 파라미터 노출 + 적용 이력 |
| 레버리지 | 전략별 혼재 (config vs 하드코딩) | 없음 | 통합 레버리지 관리 필요 |
| 코인 선정 (CoinSelector) | 완전 분리 | 부분적 (심볼 맵 표시) | 선정 기준 + 스코어 노출 |
| 전략 라우팅 (StrategyRouter) | 완전 분리 | 없음 | 라우팅 로직 시각화 |

---

## 제안 사항

### P13-1. 전략 설명 메타데이터 구조 확장 (우선순위: Critical, 난이도: Medium, 예상: 4h)

**현재**: `static metadata.description`이 한 줄짜리 문자열
**제안**: 구조화된 설명 메타데이터 추가

```javascript
// 각 전략의 static metadata에 추가할 구조
static metadata = {
  // ... 기존 필드 유지

  // NEW: 구조화된 전략 설명
  docs: {
    summary: '터틀 트레이딩 — Donchian 채널 돌파 기반 추세추종',
    concept: '리차드 데니스의 클래식 터틀 트레이딩 시스템을 암호화폐 선물에 적용. 20봉 최고/최저 돌파로 진입, 10봉 채널로 청산.',

    timeframe: {
      primary: '1m',           // 실제 수신하는 분봉
      effective: '20-50 candles', // 실질적으로 참조하는 기간
      note: '1분봉을 수신하여 20~50봉 Donchian 채널 계산',
    },

    entry: {
      long: [
        '종가가 20봉 Donchian 상단(=20봉 최고가)을 돌파',
        '종가가 50봉 Donchian 중간선 위에 위치 (추세 필터)',
        '시장 레짐: TRENDING_UP, TRENDING_DOWN, 또는 VOLATILE',
      ],
      short: [
        '종가가 20봉 Donchian 하단(=20봉 최저가)을 하향 이탈',
        '종가가 50봉 Donchian 중간선 아래에 위치 (추세 필터)',
        '시장 레짐: TRENDING_UP, TRENDING_DOWN, 또는 VOLATILE',
      ],
    },

    exit: {
      takeProfit: '10봉 Donchian Exit Channel 돌파 (Long: 10봉 최저가 이탈, Short: 10봉 최고가 돌파)',
      stopLoss: 'ATR(20) x stopMultiplier(기본 2배) — 진입가에서 해당 거리만큼 역방향',
      trailing: 'ATR x trailingActivationAtr(기본 2배) 수익 달성 후 활성화, ATR x trailingDistanceAtr(기본 2배)만큼 추적',
      other: [],
    },

    riskReward: {
      typicalRR: '1:2~3', // 전형적 리스크:리워드 비율
      maxDrawdownPerTrade: 'ATR x2 (변동성 연동)',
      avgHoldingPeriod: '수일~수주 (추세 지속 기간)',
    },

    strengths: ['강한 추세에서 높은 수익', '명확한 진입/청산 기준', '변동성 기반 동적 손절'],
    weaknesses: ['횡보장에서 연속 손절', 'Warmup 51캔들 필요', '슬리피지에 민감'],

    suitableFor: '중급 이상 — 추세 장세에서 인내심을 갖고 포지션을 유지할 수 있는 트레이더',
  },
};
```

**구현 위치**: `backend/src/strategies/**/*.js` 각 전략 파일의 static metadata
**API 노출**: `/api/bot/strategies` 응답에 docs 필드 포함
**프론트엔드**: 전략 카드 확장 시 docs 기반 상세 설명 렌더링

### P13-2. 전략 요약 카드 + 동작 시각화 UI (우선순위: Critical, 난이도: High, 예상: 6h)

**제안**: 각 전략의 상세 페이지/패널에 다음 섹션 추가

1. **전략 개요 섹션**: concept + suitableFor + strengths/weaknesses
2. **진입 조건 카드**: entry.long / entry.short를 시각적 체크리스트로 표시 (현재 어떤 조건이 충족/미충족인지 실시간)
3. **리스크 파라미터 요약**: 현재 설정된 TP/SL/Trailing 값을 가격 기준으로 계산하여 표시 (예: "현재가 $67,000 기준, SL: $66,200 (-1.2%), TP: $69,680 (+4%)")
4. **레버리지/포지션 크기 명시**: "이 전략은 현재 3x 레버리지, equity의 4% 크기로 진입합니다"
5. **타임프레임 배지**: "1분봉 수신 / 20~50봉 Donchian" 형태로 표시

### P13-3. 하드코딩된 레버리지 제거 + config 참조로 통일 (우선순위: High, 난이도: Low, 예상: 2h)

**현재 문제**: MaTrend(`leverage: '3'`), Supertrend(`leverage: '5'`), Bollinger(`leverage: '3'`) 등에서 시그널 생성 시 레버리지가 **하드코딩 문자열**로 삽입됨.

**수정 방안**:
```javascript
// Before (maTrendStrategy.js:349)
leverage: '3',

// After
leverage: this.config.leverage || '3',
```

**대상 파일**: `maTrendStrategy.js`, `bollingerReversionStrategy.js`, `SupertrendStrategy.js`, `RsiPivotStrategy.js` 등 시그널에 `leverage: '숫자'` 리터럴을 사용하는 모든 전략.

**효과**: `strategyParamMeta.js`의 레버리지 슬라이더로 변경한 값이 실제 시그널에 반영됨.

### P13-4. 글로벌 리스크 파라미터 UI (우선순위: High, 난이도: Medium, 예상: 4h)

**제안**: `/api/risk/status`에 이미 노출되는 파라미터를 프론트엔드에서 수정할 수 있는 패널 추가.

| 파라미터 | 현재 기본값 | 설명 | 위치 |
|---------|-----------|------|------|
| maxPositionSizePercent | 5% | 단일 포지션 최대 크기 | ExposureGuard |
| maxTotalExposurePercent | 30% | 총 노출 최대 한도 | ExposureGuard |
| maxRiskPerTradePercent | 2% | 트레이드당 최대 손실 | ExposureGuard |
| maxDrawdownPercent | 10% | 최대 낙폭 한도 | DrawdownMonitor |
| maxDailyLossPercent | 3% | 일일 최대 손실 | DrawdownMonitor |
| consecutiveLossLimit | 5 | 연속 손실 제한 | CircuitBreaker |
| cooldownMinutes | 30 | 서킷브레이커 쿨다운 | CircuitBreaker |

**기존 API**: `PUT /api/bot/risk-params`가 이미 존재 (`riskEngine.updateParams()`)
**프론트엔드**: `RiskStatusPanel`에 "리스크 설정" 탭 추가

### P13-5. 전략 프리셋 시스템 (우선순위: Medium, 난이도: Medium, 예상: 5h)

**제안**: 초급/중급/고급 사용자를 위한 전략 프리셋 체계 도입

```javascript
// backend/src/services/strategyPresets.js (신규)
const PRESETS = {
  conservative: {
    label: '보수적 (초급)',
    description: '낮은 레버리지, 작은 포지션, 넓은 손절 — 자본 보존 최우선',
    activeStrategies: ['BollingerReversionStrategy', 'GridStrategy', 'FundingRateStrategy'],
    globalOverrides: {
      maxPositionSizePercent: '3',
      maxTotalExposurePercent: '15',
    },
    strategyOverrides: {
      BollingerReversionStrategy: { leverage: '1', positionSizePercent: '2', slPercent: '5' },
      GridStrategy: { leverage: 1, totalBudgetPercent: '10' },
      FundingRateStrategy: { positionSizePercent: '3', slPercent: '3' },
    },
  },
  balanced: {
    label: '균형 (중급)',
    description: '다양한 전략 조합, 적절한 레버리지 — 수익과 리스크 균형',
    activeStrategies: [
      'TurtleBreakoutStrategy', 'MaTrendStrategy', 'BollingerReversionStrategy',
      'SupertrendStrategy', 'AdaptiveRegimeStrategy', 'GridStrategy',
    ],
    globalOverrides: {
      maxPositionSizePercent: '5',
      maxTotalExposurePercent: '30',
    },
    strategyOverrides: {}, // 기본값 사용
  },
  aggressive: {
    label: '공격적 (고급)',
    description: '높은 레버리지, 넓은 노출, 적극적 진입 — 최대 수익 추구',
    activeStrategies: [
      'TurtleBreakoutStrategy', 'MaTrendStrategy', 'SupertrendStrategy',
      'MacdDivergenceStrategy', 'BreakoutStrategy', 'AdaptiveRegimeStrategy',
      'QuietRangeScalpStrategy',
    ],
    globalOverrides: {
      maxPositionSizePercent: '8',
      maxTotalExposurePercent: '50',
      maxRiskPerTradePercent: '3',
    },
    strategyOverrides: {
      TurtleBreakoutStrategy: { leverage: '5', positionSizePercent: '6' },
      SupertrendStrategy: { leverage: '7' },
    },
  },
};
```

**프론트엔드**: 봇 시작 전 프리셋 선택 다이얼로그, 또는 설정 패널에서 프리셋 적용 버튼

### P13-6. 타임프레임 문제 해결 — MaTrend 집계 버그 수정 (우선순위: Critical, 난이도: Medium, 예상: 3h)

**발견된 버그**: `maTrendStrategy.js`에서 `s.h1Count`가 0~23으로 순환하며 1분봉 24개를 "일봉"으로 집계하지만, **실제로는 24분 동안의 데이터**이다. WebSocket에서 `candle1m`을 수신하므로 4개 = 4분이지 4시간이 아니다.

**이 문제는 두 가지 해결 방안이 있음**:

**(A) 타임스탬프 기반 집계**: 1분봉의 타임스탬프를 확인하여 실제 시간 경계(1시간/4시간/일)에서만 집계

**(B) 멀티 타임프레임 구독**: `marketData.js`에서 `candle1H`, `candle4H` 등 추가 구독 후 별도 이벤트로 전략에 전달

**권장: (A)** -- 기존 아키텍처 변경을 최소화. 각 전략에 kline.timestamp를 확인하여 시간 경계를 판단하는 유틸리티 추가.

**주의**: 백테스트 엔진(`backtestEngine.js`)에서는 kline 데이터가 시간순으로 정렬되어 제공되므로 이 문제가 덜 드러남. 라이브 환경에서만 발생.

### P13-7. StrategyParamMeta에 카테고리/그룹 추가 (우선순위: Medium, 난이도: Low, 예상: 2h)

**현재**: `strategyParamMeta.js`의 각 파라미터가 flat array로 나열됨
**제안**: 파라미터를 논리적 그룹으로 분류

```javascript
TurtleBreakoutStrategy: [
  { field: 'entryChannel', label: '진입 채널 기간', type: 'integer', group: 'signal', ... },
  { field: 'exitChannel', label: '청산 채널 기간', type: 'integer', group: 'signal', ... },
  { field: 'trendFilter', label: '추세 필터 기간', type: 'integer', group: 'signal', ... },
  { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', group: 'indicator', ... },
  { field: 'stopMultiplier', label: '손절 ATR 배수', type: 'decimal', group: 'risk', ... },
  { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', group: 'risk', ... },
  { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', group: 'risk', ... },
  { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', group: 'sizing', ... },
  { field: 'leverage', label: '레버리지', type: 'integer', group: 'sizing', ... },
],
```

**프론트엔드**: StrategyConfigPanel에서 그룹별 섹션 분리 (진입 신호 / 지표 설정 / 리스크 관리 / 포지션 사이징)

### P13-8. 실시간 전략 상태 대시보드 (우선순위: Medium, 난이도: High, 예상: 6h)

**제안**: 각 활성 전략의 내부 상태를 실시간 표시

- **Turtle**: 현재 Donchian 채널 상/하단, 트레일링 스탑 위치, ATR 값
- **MaTrend**: 6개 EMA 값, 현재 pullback 거리
- **Bollinger**: BB 상/중/하단, RSI, Stochastic, 현재 진입 횟수(1/3)
- **Supertrend**: 방향 (UP/DOWN), MACD 히스토그램, Volume Oscillator
- **AdaptiveRegime**: 현재 모드(trend/range/volatile), 적용 중인 TP/SL 거리

**API**: `/api/bot/strategies/:name/state` 엔드포인트 신규 추가
**프론트엔드**: 전략 카드 내 "내부 상태" 탭

---

## 구현 우선순위 (Effort/Impact 매트릭스)

| 순위 | 항목 | Impact | Effort | 비고 |
|------|------|--------|--------|------|
| 1 | P13-3 하드코딩 레버리지 수정 | High | 2h | 즉시 가능, 버그 수정 성격 |
| 2 | P13-6 MaTrend 타임프레임 버그 | Critical | 3h | 라이브 환경 정확성 문제 |
| 3 | P13-1 전략 설명 메타데이터 | Critical | 4h | 사용자 요청의 핵심 |
| 4 | P13-4 글로벌 리스크 파라미터 UI | High | 4h | 자금관리 투명성 |
| 5 | P13-7 ParamMeta 그룹 추가 | Medium | 2h | UX 개선 |
| 6 | P13-2 전략 요약 카드 UI | Critical | 6h | FE 작업 대부분 |
| 7 | P13-5 전략 프리셋 시스템 | Medium | 5h | 초급 사용자 온보딩 |
| 8 | P13-8 실시간 전략 상태 | Medium | 6h | 고급 모니터링 |

**총 예상 소요: ~32h (Sprint 2-3 분량)**

---

## 다른 에이전트에게 요청 사항

### Engineer 에이전트에게

1. **P13-3**: 모든 전략 파일에서 시그널의 `leverage: '숫자'` 리터럴을 `leverage: this.config.leverage || '숫자'`로 교체. 대상: `maTrendStrategy.js:349,397`, `bollingerReversionStrategy.js:319,357`, `SupertrendStrategy.js:706,750`.

2. **P13-6**: `maTrendStrategy.js`의 `h1Count` 기반 집계를 타임스탬프 기반으로 변경. `kline.timestamp`(또는 `kline.ts`)를 확인하여 실제 1시간/4시간/일 경계에서만 집계하도록 수정.

3. **P13-1**: 18개 전략 각각에 `docs` 구조를 추가. 이 Proposal의 "발견 사항" 섹션에 정리한 진입/청산/손절/익절 정보를 기반으로 작성.

4. **P13-4**: `/api/bot/risk-params` (PUT) 엔드포인트가 이미 존재하는지 확인하고, 없으면 `riskEngine.updateParams()`를 호출하는 라우트 추가.

5. **P13-7**: `strategyParamMeta.js`의 각 항목에 `group` 필드 추가. 그룹: `'signal'`(진입/청산 조건), `'indicator'`(지표 설정), `'risk'`(손절/익절/트레일링), `'sizing'`(포지션 크기/레버리지).

### UI 에이전트에게

1. **P13-2**: `StrategyDetail.tsx`를 확장하여 전략 docs 메타데이터를 시각적으로 렌더링하는 컴포넌트 추가. 진입 조건은 체크리스트, 리스크 파라미터는 가격 기준 계산값 표시.

2. **P13-4**: `RiskStatusPanel.tsx`에 리스크 파라미터 편집 모드 추가. 슬라이더 + 숫자 입력 (StrategyConfigPanel과 유사한 패턴).

3. **P13-5**: 봇 시작 시 프리셋 선택 다이얼로그 또는 설정 페이지에 프리셋 카드 UI. 보수적/균형/공격적 3단계, 각각 설명과 활성화될 전략 목록 표시.

4. **P13-7**: `StrategyConfigPanel.tsx`에서 `group` 필드를 기반으로 파라미터를 섹션별로 분리 렌더링. 섹션 헤더: "진입 신호", "지표 설정", "리스크 관리", "포지션 사이징".

5. **P13-8**: 전략별 내부 상태 뷰어 컴포넌트 (`StrategyStateViewer.tsx`). 각 전략의 주요 지표 값, 현재 채널/밴드 위치, SL/TP 가격선을 간단한 미니 차트 또는 게이지로 표시.

---

## 전문가 의견: 수익률 관점 우선순위

퀀트 트레이더 관점에서 **P13-6(타임프레임 버그)가 가장 시급**하다. MaTrend가 24분 데이터를 일봉으로 오인하면 모든 EMA 계산이 무의미해지고, 백테스트 결과와 라이브 결과가 괴리된다. 이는 실제 자금 손실로 직결되는 문제이다.

**P13-3(레버리지 하드코딩 수정)도 즉시 수정 필요**하다. 사용자가 UI에서 레버리지를 2x로 줄였는데 전략이 여전히 5x로 주문을 넣으면 기대와 다른 리스크 노출이 발생한다.

나머지는 "보이는 것" 문제이므로 **사용성에는 크게 영향**을 주지만 수익률에 직접적 영향은 적다. 다만 사용자가 전략의 동작을 이해하지 못하면 부적절한 시점에 전략을 켜고 끄는 실수를 저지를 수 있으므로, **P13-1과 P13-2는 간접적으로 수익률에 영향**을 미친다.

프리셋(P13-5)은 초보자의 과도한 레버리지 사용을 방지하는 효과가 있어, **리스크 관리 관점에서 중요**하다.
