# 전략 시스템

## 전략 기본 구조

모든 전략은 `StrategyBase` 클래스를 상속합니다.

### StrategyBase (`services/strategyBase.js`)

```javascript
class StrategyBase extends EventEmitter {
  // 필수 오버라이드
  onKline(kline)     // 캔들 데이터 수신 시 호출
  getSignal()        // 현재 시그널 반환

  // Concrete 메서드 (오버라이드 선택)
  onTick(ticker)     // R11: trailing stop 자동 체크 포함 (super.onTick 호출 권장)

  // 제공 메서드
  emitSignal(signal) // 시그널 방출 (이벤트)
  activate(symbols, category)  // 전략 활성화
  deactivate()       // 전략 비활성화
  updateConfig(cfg)  // 설정 업데이트
  getConfig()        // 현재 설정 반환
  getEffectiveRegime() // 현재 적용 레짐 반환
  getTargetRegimes() // 메타데이터의 targetRegimes 반환

  // Sprint R4 추가
  setAccountContext({ getEquity }) // equity DI 주입 (콜백 패턴)
  getEquity()        // 주입된 equity 조회 (fallback: config.equity || '0')
  onFundingUpdate(data) // 펀딩비 데이터 수신 (no-op, 오버라이드 가능)

  // Sprint R10 추가 — Trailing Stop
  _checkTrailingStop(price)  // trailing stop 체크 (try-catch fail-safe)
  _resetTrailingState()      // trailing 상태 초기화
  _initTrailingFromMetadata() // 전략 metadata에서 trailing 설정 읽기
  onFill(fill)               // OPEN 시 진입가 설정, CLOSE 시 trailing 리셋
}
```

### 전략 등록

각 전략 파일이 모듈 로드 시 `strategyRegistry`에 자동 등록됩니다:

```javascript
// 전략 파일 하단
registry.register(TurtleBreakoutStrategy);

// strategies/index.js — safeRequire()로 모든 전략 임포트
// 하나가 실패해도 나머지에 영향 없음
```

---

## 18개 전략 목록

### Price-Action 전략 (5개)

가격 움직임 패턴 자체를 분석하는 전략들입니다.

#### 1. TurtleBreakoutStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 300초 (5분) |

**로직**: N일 고점/저점 돌파 시 진입 (터틀 트레이딩 룰). ATR 기반 트레일링 스탑.

**핵심 설정**:
- `entryChannel: 20` — 진입 채널 기간
- `exitChannel: 10` — 청산 채널 기간
- `trendFilter: 50` — SMA 트렌드 필터
- `stopMultiplier: '2'` — ATR × 2 스탑로스
- `trailingActivationAtr: '2'` — 트레일링 활성화 거리
- `positionSizePercent: '4'`, `leverage: '3'`

---

#### 2. CandlePatternStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile, ranging |
| **리스크** | medium |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 60초 |

**로직**: 캔들 패턴 인식 (Engulfing, Hammer, Doji 등). ATR 기반 TP/SL.

**핵심 설정**:
- `tpMultiplier: '2'` — ATR × 2 이익 목표
- `slMultiplier: '1.5'` — ATR × 1.5 손절
- `minBodyRatio: '0.3'` — 최소 캔들 몸통 비율
- `positionSizePercent: '3'`, `leverage: '2'`

---

#### 3. SupportResistanceStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile, ranging |
| **리스크** | medium |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 120초 |

**로직**: 지지/저항 레벨 클러스터링 → 리테스트 감지 → 반등/이탈 진입.

**핵심 설정**:
- `lookback: 3` — 레벨 탐색 기간
- `clusterTolerance: '1.0'` — 레벨 클러스터링 허용 범위 (ATR%)
- `retestTolerance: '0.5'` — 리테스트 판정 허용 범위
- `minTouches: 1` — 최소 터치 횟수
- `maxLevels: 10` — 최대 레벨 수
- `positionSizePercent: '3'`, `leverage: '2'`

---

#### 4. SwingStructureStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 300초 (5분) |

**로직**: 스윙 고점/저점 구조 분석 → Higher High/Higher Low(상승) 또는 Lower High/Lower Low(하강) 패턴 인식.

**핵심 설정**:
- `swingLookback: 3` — 스윙 포인트 탐색 기간
- `slBuffer: '0.5'` — 스탑로스 버퍼 (ATR%)
- `positionSizePercent: '4'`, `leverage: '3'`

---

#### 5. FibonacciRetracementStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, ranging |
| **리스크** | low |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 180초 (3분) |

**로직**: 스윙 고점/저점 사이 피보나치 되돌림 레벨(38.2%~61.8%)에서 진입 → 127.2% 확장 목표.

**핵심 설정**:
- `swingPeriod: 50` — 스윙 탐색 기간
- `fibEntryLow: '0.382'`, `fibEntryHigh: '0.618'` — 진입 구간
- `fibInvalidation: '0.786'` — 무효화 레벨
- `fibExtension: '1.272'` — 이익 목표 확장
- `positionSizePercent: '3'`, `leverage: '2'`

---

### Indicator-Light 전략 (8개)

소수의 기술 지표를 사용하는 전략들입니다.

#### 6. GridStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | ranging |
| **리스크** | low |
| **최대 동시 포지션** | 3 |
| **쿨다운** | 30초 |

**로직**: 현재가 기준 ATR 간격의 그리드 주문 생성. 횡보장에서 작은 변동을 반복 수익화.

**핵심 설정**:
- `gridSpacingMultiplier: '0.3'` — ATR × 0.3 그리드 간격
- `gridLevels: 10` — 그리드 레벨 수
- `totalBudgetPercent: '20'` — 총 자금의 20% 사용
- `maxDrawdownPercent: '3'` — 그리드 최대 낙폭
- `leverage: 2`

---

#### 7. MaTrendStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 300초 (5분) |

**로직**: 다중 시간봉 이동평균선 정렬 (1H, 4H, Daily). 3개 시간대 모두 같은 방향이면 진입.

**핵심 설정**:
- `h1FastEma: 9`, `h1SlowEma: 21` — 1시간봉 EMA
- `h4FastEma: 20`, `h4SlowEma: 50` — 4시간봉 EMA
- `dailyFastEma: 20`, `dailySlowEma: 30` — 일봉 EMA
- `trailingStopPercent: '2'`
- `positionSizePercent: '5'`, `tpPercent: '4'`, `slPercent: '2'`

---

#### 8. FundingRateStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile |
| **리스크** | low |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 60초 |

**로직**: 펀딩비 극단값 감지 → 반대 포지션 진입 (과열 시 역방향).

**데이터 소스** (Sprint R4): `FundingDataService`가 REST polling (5분 간격)으로 펀딩비/OI 데이터를 수집하여 `onFundingUpdate(data)` 콜백으로 전달합니다.

**핵심 설정**:
- `longFundingThreshold: '-0.01'` — 롱 진입 펀딩비 임계값
- `shortFundingThreshold: '0.03'` — 숏 진입 펀딩비 임계값
- `consecutivePeriods: 3` — 연속 확인 기간
- `oiChangeThreshold: '5'` — 미결제약정 변화율 (%)
- `maxHoldHours: 24` — 최대 보유 시간
- `positionSizePercent: '5'`, `tpPercent: '3'`, `slPercent: '2'`

---

#### 9. RsiPivotStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile, ranging |
| **리스크** | medium |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 60초 |

**로직**: RSI 과매도/과매수 + 피봇 포인트 기반 진입.

**핵심 설정**:
- `rsiPeriod: 14`, `rsiOversold: 30`, `rsiOverbought: 70`
- `leverage: 3`
- `positionSizePercent: '5'`, `tpPercent: '2'`, `slPercent: '2'`

---

#### 10. SupertrendStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 180초 (3분) |

**로직**: Supertrend 지표 방향 전환 + MACD 필터 + 볼륨 확인.

**핵심 설정**:
- `atrPeriod: 10`, `supertrendMultiplier: 3`
- `macdFast: 12`, `macdSlow: 26`, `macdSignal: 9`
- `volOscShort: 5`, `volOscLong: 20`
- `positionSizePercent: '5'`, `tpPercent: '3'`, `slPercent: '2'`

---

#### 11. BollingerReversionStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | ranging, volatile |
| **리스크** | medium |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 60초 |

**로직**: 볼린저 밴드 이탈 + RSI + 스토캐스틱 확인 → 평균 회귀 진입.

**핵심 설정**:
- `bbPeriod: 20`, `bbStdDev: 2`
- `rsiPeriod: 14`, `stochPeriod: 14`, `stochSmooth: 3`
- `maxEntries: 3` — 분할 진입 최대 횟수
- `positionSizePercent: '5'`, `tpPercent: '4'`, `slPercent: '4'`

---

#### 12. VwapReversionStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | ranging, quiet |
| **리스크** | low |
| **최대 동시 포지션** | 2 |
| **쿨다운** | 60초 |

**로직**: VWAP 이탈 + 볼륨 확인 → VWAP 회귀 진입. 분할 진입(60% 초기, 40% 추가).

**핵심 설정**:
- `vwapDeviationMult: '1.5'` — VWAP 이탈 배수
- `volumeThresholdMult: '1.2'` — 볼륨 임계치
- `tp1Target: 'vwap'` — 1차 이익 목표 = VWAP
- `initialSizeRatio: '0.6'`, `addOnSizeRatio: '0.4'` — 분할 비율
- `maxHoldCandles: 48`
- `positionSizePercent: '3'`, `leverage: '2'`

---

#### 13. MacdDivergenceStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, volatile, ranging |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 120초 |

**로직**: MACD 다이버전스 감지 (가격은 신저점인데 MACD는 아닌 경우 등) + 피봇 포인트.

**핵심 설정**:
- `macdFast: 12`, `macdSlow: 26`, `macdSignal: 9`
- `rsiPeriod: 14`, `emaTpPeriod: 50`
- `pivotLeftBars: 3`, `pivotRightBars: 3`
- `maxCandlesForFailure: 5` — 실패 감지 캔들 수
- `positionSizePercent: '2'`, `leverage: '2'`

---

### Indicator-Heavy 전략 (3개)

다수의 기술 지표를 복합적으로 사용하는 전략들입니다.

#### 14. QuietRangeScalpStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | quiet |
| **리스크** | low |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 30초 |

**로직**: ATR이 평소보다 낮은 저변동성 구간에서 켈트너 채널 반등 스캘핑.

**핵심 설정**:
- `emaPeriod: 20`, `atrPeriod: 14`, `atrSmaPeriod: 20`
- `kcMultiplier: '1.5'` — 켈트너 배수
- `atrQuietThreshold: '0.7'` — ATR/평균 ATR 비율 (0.7 이하 = 저변동성)
- `positionSizePercent: '3'`, `tpPercent: '1.2'`, `slPercent: '0.8'`
- `leverage: 2`

---

#### 15. BreakoutStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | quiet, ranging |
| **리스크** | high |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 300초 (5분) |

**로직**: 볼린저 밴드 + 켈트너 채널 스퀴즈 감지 → 스퀴즈 해소 시 돌파 진입.

**핵심 설정**:
- `bbPeriod: 20`, `bbStdDev: 2`
- `kcEmaPeriod: 20`, `kcAtrPeriod: 10`, `kcMult: 1.5`
- `minSqueezeCandles: 6` — 최소 스퀴즈 지속 캔들
- `volumeBreakoutMult: '2'` — 돌파 시 볼륨 배수
- `atrBreakoutMult: '1.5'` — 돌파 ATR 배수
- `failureCandles: 3` — 실패 판정 캔들
- `positionSizePercent: '4'`, `leverage: '3'`

---

#### 16. AdaptiveRegimeStrategy
| 속성 | 값 |
|------|-----|
| **레짐** | trending_up, trending_down, ranging, volatile, quiet (전체) |
| **리스크** | medium |
| **최대 동시 포지션** | 1 |
| **쿨다운** | 120초 |

**로직**: 시장 레짐에 따라 내부 로직을 자동 전환하는 적응형 전략.
- 추세장: EMA 크로스 + ADX 필터
- 횡보장: BB 밴드 반등
- 고변동성: ATR 돌파

**핵심 설정**:
- `emaPeriodFast: 9`, `emaPeriodSlow: 21`
- `rsiPeriod: 14`, `atrPeriod: 14`, `adxPeriod: 14`
- `bbPeriod: 20`, `bbStdDev: 2`
- 레짐별 포지션 크기: `trendPositionSizePercent: '3'`, `rangePositionSizePercent: '2'`, `volatilePositionSizePercent: '4'`
- 레짐별 레버리지: `trendLeverage: '3'`, `rangeLeverage: '2'`, `volatileLeverage: '3'`

---

## 전략 메타데이터 요약표

| # | 전략 | 카테고리 | 레짐 | 리스크 | 동시포지션 | 쿨다운 | 유예기간 |
|---|------|----------|------|--------|-----------|--------|----------|
| 1 | TurtleBreakout | price-action | UP/DOWN/VOL | medium | 1 | 5분 | 10분 |
| 2 | CandlePattern | price-action | UP/DOWN/VOL/RANGE | medium | 2 | 1분 | 10분 |
| 3 | SupportResistance | price-action | UP/DOWN/VOL/RANGE | medium | 2 | 2분 | 10분 |
| 4 | SwingStructure | price-action | UP/DOWN/VOL | medium | 1 | 5분 | 10분 |
| 5 | FibonacciRetracement | price-action | UP/DOWN/RANGE | low | 2 | 3분 | 10분 |
| 6 | Grid | indicator-light | RANGE | low | 3 | 30초 | 3분 |
| 7 | MaTrend | indicator-light | UP/DOWN | medium | 1 | 5분 | 5분 |
| 8 | FundingRate | indicator-light | UP/DOWN/VOL | low | 2 | 1분 | 5분 |
| 9 | RsiPivot | indicator-light | UP/DOWN/VOL/RANGE | medium | 2 | 1분 | 5분 |
| 10 | Supertrend | indicator-light | UP/DOWN/VOL | medium | 1 | 3분 | 5분 |
| 11 | BollingerReversion | indicator-light | RANGE/VOL | medium | 2 | 1분 | 5분 |
| 12 | VwapReversion | indicator-light | RANGE/QUIET | low | 2 | 1분 | 5분 |
| 13 | MacdDivergence | indicator-light | UP/DOWN/VOL/RANGE | medium | 1 | 2분 | 5분 |
| 14 | QuietRangeScalp | indicator-heavy | QUIET | low | 1 | 30초 | 15분 |
| 15 | Breakout | indicator-heavy | QUIET/RANGE | high | 1 | 5분 | 15분 |
| 16 | AdaptiveRegime | indicator-heavy | ALL | medium | 1 | 2분 | 0 (없음) |

> **범례**: UP=trending_up, DOWN=trending_down, VOL=volatile, RANGE=ranging, QUIET=quiet
> **유예기간** (Sprint R7): 레짐 변경 시 전략 비활성화 전 OPEN 차단 / CLOSE 허용 기간. `gracePeriodMs` 메타데이터.

### Trailing Stop (Sprint R10, AD-59; R11 강화; R12 metadata 정리 AD-69)

StrategyBase에 opt-in 방식의 trailing stop이 내장되어 있습니다. 전략 메타데이터에 `trailingStop.enabled: true` 설정이 있으면 자동 활성화됩니다.

**R11 변경**: `onTick()`이 concrete 메서드로 전환되어, trailing stop이 활성화된 전략에서 매 틱마다 `_checkTrailingStop(price)`를 자동 호출합니다. 서브클래스가 별도로 trailing 로직을 호출할 필요 없이, `super.onTick(ticker)`만 호출하면 됩니다.

**R12 변경 (AD-69)**: 8개 전략(MaTrend, AdaptiveRegime, Turtle, SwingStructure, Breakout, Supertrend, RsiPivot, MacdDivergence)의 `metadata.trailingStop.enabled`를 `false`로 변경. 이유: 이 전략들은 모두 `onTick()`을 오버라이드하면서 `super.onTick()`을 호출하지 않으므로 StrategyBase의 `_checkTrailingStop()`이 실행되지 않음 (dead code). 자체 trailing/exit 로직을 가진 전략은 metadata가 혼동을 줄 수 있으므로 비활성화.

**대상 전략** (현재 StrategyBase trailing 활성 전략: 0개):
모든 전략이 `trailingStop.enabled: false`이거나 metadata에 trailingStop이 없음. 각 전략이 자체 exit 로직 관리.

**`super.onFill(fill)` 호출 전략** (R10~R11): TurtleBreakout, SwingStructure, MaTrend, Supertrend, RsiPivot, MacdDivergence, BollingerReversion, Breakout, AdaptiveRegime

**entryPrice 지연 설정 (R11)**: MaTrend, Turtle 전략은 진입가(`_entryPrice`)를 시그널 생성 시점이 아닌 `onFill()` 콜백에서 실제 체결가로 설정합니다. 이를 통해 시장가 주문의 슬리피지가 반영된 정확한 진입가를 기준으로 TP/SL을 계산합니다.

**안전 규칙**:
1. activation 전에는 기존 고정 SL 유지
2. trailing SL과 고정 SL 중 더 타이트한 것 적용
3. onFill() CLOSE 분기에서 trailing state 리셋
4. `_checkTrailingStop()`을 try-catch로 감싸 fail-safe

### Close 시그널 reduceOnly (Sprint R12, P12-2)

16개 전략의 close/exit 시그널에 `reduceOnly: true` 속성이 일괄 추가되었습니다. RiskEngine의 reduceOnly bypass (AD-46)와 결합하여, close 시그널이 CircuitBreaker/DrawdownMonitor에 의해 차단되지 않고 항상 실행됩니다.

**비활성 전략** (StrategyBase trailing 미사용): 전체 18개 전략 — 각자 자체 exit 로직 관리

---

## 레짐별 활성 전략

| 레짐 | 활성 전략 | 수 |
|------|----------|-----|
| **trending_up** | Turtle, Candle, S/R, Swing, Fibonacci, MaTrend, Funding, RsiPivot, Supertrend, MacdDivergence, Adaptive | 11 |
| **trending_down** | Turtle, Candle, S/R, Swing, Fibonacci, MaTrend, Funding, RsiPivot, Supertrend, MacdDivergence, Adaptive | 11 |
| **ranging** | Candle, S/R, Fibonacci, Grid, RsiPivot, Bollinger, VwapReversion, MacdDivergence, Breakout, Adaptive | 10 |
| **volatile** | Turtle, Candle, S/R, Swing, Funding, RsiPivot, Supertrend, Bollinger, MacdDivergence, Adaptive | 10 |
| **quiet** | VwapReversion, QuietRangeScalp, Breakout, Adaptive | 4 |

## 지표 캐싱 (indicatorCache)

18개 전략이 동일한 지표를 중복 계산하는 것을 방지합니다.

### 지원 지표

| 지표 | 파라미터 | 반환값 |
|------|---------|--------|
| `rsi` | `{ period: 14, smoothing: 'wilder' }` | number |
| `atr` | `{ period: 14 }` | string |
| `adx` | `{ period: 14 }` | number |
| `bb` | `{ period: 20, stdDev: 2 }` | { upper, middle, lower } |
| `ema` | `{ period: 9 }` | string |
| `sma` | `{ period: 20 }` | string |
| `macd` | `{ fast: 12, slow: 26, signal: 9 }` | { macd, signal, histogram } |
| `stochastic` | `{ period: 14, smooth: 3 }` | { k, d } |
| `vwap` | `{}` | string |
| `keltner` | `{ emaPeriod: 20, atrPeriod: 10, mult: 1.5 }` | { upper, middle, lower } |

- 심볼당 최대 500 캔들 히스토리 유지
- 새 캔들 도착 시 캐시 무효화 후 재계산
- 캐시 키: `indicator|param1=val1,param2=val2` (결정적)

### RSI Wilder Smoothing (Sprint R4)

RSI 계산에 Wilder smoothing이 기본 적용됩니다:
- `smoothing: 'wilder'` (기본): Wilder 평활화 — SMA seed 후 재귀적 평활 (업계 표준)
- `smoothing: 'sma'`: Cutler's RSI — 매 구간 SMA 기반 (레거시)

```javascript
// 사용 예
cache.get('BTCUSDT', 'rsi', { period: 14, smoothing: 'wilder' }); // Wilder (기본)
cache.get('BTCUSDT', 'rsi', { period: 14, smoothing: 'sma' });    // Cutler
```
