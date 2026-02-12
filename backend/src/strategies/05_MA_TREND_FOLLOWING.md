# 이동평균선 추세추종 전략 (MA Trend Following)

> 원본: 시나이드 (25만원 → 1년 10배), 살구도하용 (멀티타임프레임 MA)
> 대상: Bitget USDT-FUTURES (BTC + 메이저 알트)
> 포지션: 양방향 (Long & Short)
> 타임프레임: 1시간봉 (진입), 4시간봉/일봉 (추세 확인)

---

## 1. 진입 신호 (Entry Signal)

### 핵심 원리
> "이동평균선만 가지고 자동매매돌려서 수익중에 있습니다. 단순지표를 이용하되 어떻게 사용하느냐가 더 중요한거 같습니다."

멀티타임프레임 이동평균선으로 **큰 추세를 확인한 뒤, 낮은 타임프레임에서 눌림목 진입**하는 전략. 단순한 골든/데드크로스가 아닌, 추세 확인 + 눌림목 + 거래량 확인의 3단계 필터를 사용한다.

### 이동평균선 설정

| 타임프레임 | 단기 MA | 장기 MA | 역할 |
|-----------|---------|---------|------|
| **일봉** | EMA(20) | EMA(60) | 대추세 방향 판단 |
| **4시간봉** | EMA(20) | EMA(50) | 중추세 방향 확인 |
| **1시간봉** | EMA(9) | EMA(21) | 진입 타이밍 |

### 롱 진입 조건 (멀티타임프레임)

| # | 타임프레임 | 조건 | 설명 |
|---|-----------|------|------|
| 1 | **일봉** | EMA(20) > EMA(60) | 대추세 상승 확인 |
| 2 | **4시간봉** | EMA(20) > EMA(50) | 중추세 상승 확인 |
| 3 | **1시간봉** | 가격이 EMA(21) 부근으로 눌림 | 눌림목 진입 포인트 |
| 4 | **1시간봉** | EMA(9)가 EMA(21) 위에 위치 | 단기 추세 유지 확인 |
| 5 | **1시간봉** | 거래량 > 20봉 평균 거래량 | 의미있는 반등 확인 |
| 6 | **MarketRegime** | `TRENDING_UP` | 상승 추세장 확인 |

### 숏 진입 조건 (멀티타임프레임)

| # | 타임프레임 | 조건 | 설명 |
|---|-----------|------|------|
| 1 | **일봉** | EMA(20) < EMA(60) | 대추세 하락 확인 |
| 2 | **4시간봉** | EMA(20) < EMA(50) | 중추세 하락 확인 |
| 3 | **1시간봉** | 가격이 EMA(21) 부근으로 반등 | 되돌림 진입 포인트 |
| 4 | **1시간봉** | EMA(9)가 EMA(21) 아래에 위치 | 단기 하락 추세 유지 |
| 5 | **1시간봉** | 거래량 > 20봉 평균 거래량 | 의미있는 하락 확인 |
| 6 | **MarketRegime** | `TRENDING_DOWN` | 하락 추세장 확인 |

### 눌림목 정의
```
롱 눌림목:
  가격 최저점이 EMA(21) × 0.995 ~ EMA(21) × 1.005 범위 안에 터치
  즉, EMA(21) ±0.5% 이내로 접근 후 반등 캔들 출현

숏 되돌림:
  가격 최고점이 EMA(21) × 0.995 ~ EMA(21) × 1.005 범위 안에 터치
  즉, EMA(21) ±0.5% 이내로 접근 후 하락 캔들 출현
```

---

## 2. 매수 조건 (Buy Conditions)

### 롱 진입 (OPEN_LONG)

```
// 대추세 확인 (일봉)
daily_trend = daily_ema20 > daily_ema60

// 중추세 확인 (4시간봉)
h4_trend = h4_ema20 > h4_ema50

// 눌림목 감지 (1시간봉)
pullback = (h1_low >= h1_ema21 * 0.995) AND (h1_low <= h1_ema21 * 1.005)
bounce = h1_close > h1_open  // 양봉 (반등 캔들)

// 단기 추세 유지
short_trend = h1_ema9 > h1_ema21

// 거래량 확인
volume_confirm = h1_volume > sma(h1_volume, 20)

IF  daily_trend AND h4_trend AND pullback AND bounce
AND short_trend AND volume_confirm
AND market_regime == 'trending_up'
THEN → OPEN_LONG
```

### 숏 진입 (OPEN_SHORT)

```
daily_trend = daily_ema20 < daily_ema60
h4_trend = h4_ema20 < h4_ema50
rally = (h1_high >= h1_ema21 * 0.995) AND (h1_high <= h1_ema21 * 1.005)
drop = h1_close < h1_open  // 음봉
short_trend = h1_ema9 < h1_ema21
volume_confirm = h1_volume > sma(h1_volume, 20)

IF  daily_trend AND h4_trend AND rally AND drop
AND short_trend AND volume_confirm
AND market_regime == 'trending_down'
THEN → OPEN_SHORT
```

### 진입 방식
- 시장가(MARKET) 즉시 진입 (눌림목 캔들 완성 후 다음 봉 시가)
- 물타기 없음 — 1회 진입, 실패 시 즉시 손절
- 진입과 동시에 TP/SL 자동 세팅

### 수량 결정
```
positionSize = accountEquity × 5% / leverage
quantity = positionSize / currentPrice
```

---

## 3. 매도 조건 (Sell Conditions)

### 롱 포지션 청산 (CLOSE_LONG)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **추세 전환** | 1시간봉 EMA(9)가 EMA(21) 하향 돌파 → 전량 청산 |
| 2 | **트레일링 스탑** | 최고점 대비 -2% 하락 시 청산 |
| 3 | **TP 도달** | 진입가 대비 +4% 도달 시 전량 청산 |
| 4 | **SL 도달** | 진입가 대비 -2% 도달 시 즉시 손절 |
| 5 | **4시간봉 추세 이탈** | 4시간봉 EMA(20) < EMA(50) 전환 시 청산 |

### 숏 포지션 청산 (CLOSE_SHORT)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **추세 전환** | 1시간봉 EMA(9)가 EMA(21) 상향 돌파 → 전량 청산 |
| 2 | **트레일링 스탑** | 최저점 대비 +2% 상승 시 청산 |
| 3 | **TP 도달** | 진입가 대비 -4% (숏 수익) 도달 시 전량 청산 |
| 4 | **SL 도달** | 진입가 대비 +2% (숏 손실) 도달 시 즉시 손절 |
| 5 | **4시간봉 추세 이탈** | 4시간봉 EMA(20) > EMA(50) 전환 시 청산 |

### 트레일링 스탑 로직
```
IF position == LONG:
    highestSinceEntry = max(highestSinceEntry, currentPrice)
    trailingStop = highestSinceEntry × (1 - 0.02)  // 최고점 대비 -2%
    IF currentPrice <= trailingStop → CLOSE_LONG

IF position == SHORT:
    lowestSinceEntry = min(lowestSinceEntry, currentPrice)
    trailingStop = lowestSinceEntry × (1 + 0.02)  // 최저점 대비 +2%
    IF currentPrice >= trailingStop → CLOSE_SHORT
```

### TP:SL 비율
- **2:1** (TP 4% : SL 2%)
- 추세추종 특성상 큰 수익, 작은 손실 지향
- 승률 35~40%에서도 양의 기대값

---

## 4. 리스크 관리 (Risk Management)

### 포지션 관리

| 항목 | 값 | 근거 |
|------|-----|------|
| 레버리지 | 3x | 추세추종은 보유 시간이 길어 낮은 레버리지 |
| 최대 포지션 비중 | 자산의 5% | 레버리지 3x 기준 15% 노출 |
| 물타기 | 금지 | 1회 진입, 실패 시 손절 |
| 동시 포지션 | 최대 5심볼 | 총 노출 25% 이내 |
| TP:SL 비율 | 2:1 | TP +4%, SL -2% |
| 트레일링 스탑 | 최고/최저점 -2% | 수익 보호 |

### 멀티타임프레임 정합성 체크
```
진입 허용 = 일봉 추세 == 4시간봉 추세 == 1시간봉 추세

3개 타임프레임 중 하나라도 방향이 다르면 → 진입 금지
"큰추세안에서 눌릴때들어가면 결국추세니깐요" (살구도하용)
```

### 횡보장 대응
- MarketRegime이 `RANGING` 또는 `QUIET`이면 **모든 신규 진입 차단**
- 추세추종 전략은 횡보장에서 연속 손절 발생 가능 → 반드시 필터링
- 기존 포지션은 트레일링 스탑으로 관리

### 연속 손절 대응
> "비정상적인 수익률이 연달아 찍히면 장기적으로는 거의 필패하는 전략" (곽철용)

- CircuitBreaker 연동: 연속 5회 손절 시 30분 쿨다운
- 연속 3회 손절 시 포지션 비중 50% 축소 (자산의 2.5%로)
- 쿨다운 후 복귀 시 최소 비중으로 1회 테스트 매매

### RiskEngine 연동
```
validateOrder 통과 필수:
  1. CircuitBreaker — 연속 5회 손절 시 30분 쿨다운
  2. DrawdownMonitor — 일일 손실 3%, 총 MDD 10% 초과 시 중단
  3. ExposureGuard — 총 노출 30% 초과 시 신규 진입 거부
```

### ReduceOnly
- 모든 청산 주문에 `reduceOnly: true` 필수

### MDD 한도
- 전략별 MDD 한도: **-10%**
- 백테스트 기준 MDD: -15% ~ -20% 예상 (추세추종 특성)
- 실제 MDD가 백테스트 MDD의 1.5배 초과 시 전략 재검토

### 백테스트 검증 기준
- 최소 5년치 1시간봉 데이터
- 슬리피지 + 수수료 1% 오버헤드
- 트레일링 스탑 포함 시 봉가정오류 주의 → 보수적 해석

---

## 구현 매핑 (StrategyBase 연동)

```javascript
// onKline(kline) → 멀티타임프레임 EMA 계산, 눌림목 감지
// onTick(ticker) → 트레일링 스탑 체크, TP/SL 모니터링
// getSignal() → { action, symbol, confidence, suggestedQty, marketContext }
// setMarketRegime() → TRENDING_UP/DOWN에서만 활성
```

### 멀티타임프레임 데이터 관리
```javascript
// 1시간봉 kline → 직접 수신
// 4시간봉 → 1시간봉 4개 집계 또는 별도 구독
// 일봉 → 1시간봉 24개 집계 또는 별도 구독
// 각 타임프레임별 EMA 버퍼 독립 관리
```

### 필요 외부 라이브러리
- `technicalindicators` 또는 자체 구현 — EMA, SMA, 거래량 이동평균
- EMA 계산은 간단하므로 자체 구현 권장
