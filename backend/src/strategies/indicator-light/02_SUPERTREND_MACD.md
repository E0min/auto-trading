# 슈퍼트렌드 + MACD 추세추종 전략

> 원본: cth.release — 슈퍼트렌드 + GDAX + MACD + Volume Oscillator 조합
> 대상: Bitget USDT-FUTURES (BTC 및 메이저 알트)
> 포지션: 양방향 (Long & Short)
> 타임프레임: 1시간봉 기준

---

## 1. 진입 신호 (Entry Signal)

### 핵심 원리
슈퍼트렌드 지표로 추세 방향을 판단하고, MACD로 모멘텀을 확인한 뒤, Volume Oscillator로 **횡보장을 필터링**하여 거짓 신호를 제거한다.

### 슈퍼트렌드 (Supertrend) 계산
```
ATR = ATR(period=10)
기본 상단밴드 = (고가 + 저가) / 2 + (multiplier × ATR)
기본 하단밴드 = (고가 + 저가) / 2 - (multiplier × ATR)

multiplier = 3.0 (기본값)
period = 10

초록선 (상승추세): 가격이 상단밴드 위에 위치
빨간선 (하락추세): 가격이 하단밴드 아래에 위치
```

### MACD 계산
```
MACD Line = EMA(12) - EMA(26)
Signal Line = EMA(MACD Line, 9)
Histogram = MACD Line - Signal Line
```

### Volume Oscillator 계산
```
Volume Oscillator = ((단기 Volume EMA - 장기 Volume EMA) / 장기 Volume EMA) × 100
단기 EMA 기간 = 5
장기 EMA 기간 = 20
```

### 롱 진입 조건

| # | 조건 | 상세 |
|---|------|------|
| 1 | **슈퍼트렌드 초록선** | 현재 캔들이 슈퍼트렌드 상단밴드 위에 위치 (추세 전환) |
| 2 | **MACD 골든크로스** | MACD Line이 Signal Line을 상향 돌파 |
| 3 | **Volume Oscillator > 0** | 거래량 증가 확인 (횡보장 필터) |
| 4 | **MarketRegime 확인** | `TRENDING_UP` 또는 `VOLATILE` 상태 |

### 숏 진입 조건

| # | 조건 | 상세 |
|---|------|------|
| 1 | **슈퍼트렌드 빨간선** | 현재 캔들이 슈퍼트렌드 하단밴드 아래에 위치 (추세 전환) |
| 2 | **MACD 데드크로스** | MACD Line이 Signal Line을 하향 돌파 |
| 3 | **Volume Oscillator > 0** | 거래량 증가 확인 (횡보장 필터) |
| 4 | **MarketRegime 확인** | `TRENDING_DOWN` 또는 `VOLATILE` 상태 |

### 횡보장 필터 (핵심)
> "횡보장에서 거짓 신호 발생 — 골든크로스 3개가 횡보장에서 연속 발생"

**Volume Oscillator ≤ 0이면 모든 진입 신호 무시.** 이것이 이 전략의 핵심 필터이다.

---

## 2. 매수 조건 (Buy Conditions)

### 롱 포지션 개시 (OPEN_LONG)

```
IF  supertrend_direction == 'UP'           // 초록선 전환
AND supertrend_direction_prev == 'DOWN'     // 이전 봉은 빨간선 (전환 시점)
AND macd_line > signal_line                 // MACD 골든크로스
AND macd_histogram > 0                      // 히스토그램 양수 확인
AND volume_oscillator > 0                   // 거래량 증가
THEN → OPEN_LONG
```

### 숏 포지션 개시 (OPEN_SHORT)

```
IF  supertrend_direction == 'DOWN'          // 빨간선 전환
AND supertrend_direction_prev == 'UP'       // 이전 봉은 초록선 (전환 시점)
AND macd_line < signal_line                 // MACD 데드크로스
AND macd_histogram < 0                      // 히스토그램 음수 확인
AND volume_oscillator > 0                   // 거래량 증가
THEN → OPEN_SHORT
```

### 진입 방식
- 시장가(MARKET) 즉시 진입
- 진입과 동시에 TP/SL 자동 세팅
- 한 심볼당 동시 1포지션만 유지

### 수량 결정
```
positionSize = accountEquity × 5% / leverage(5x)
quantity = positionSize / currentPrice
```

---

## 3. 매도 조건 (Sell Conditions)

### 롱 포지션 청산 (CLOSE_LONG)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **TP 도달** | 진입가 대비 +3% (레버리지 5x 기준 실질 +15%) |
| 2 | **슈퍼트렌드 전환** | 초록선 → 빨간선 전환 시 즉시 청산 |
| 3 | **SL 도달** | 진입가 대비 -2% (레버리지 5x 기준 실질 -10%) |
| 4 | **MACD 역전** | MACD 데드크로스 발생 시 청산 |

### 숏 포지션 청산 (CLOSE_SHORT)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **TP 도달** | 진입가 대비 -3% (숏이므로 가격 하락 = 수익) |
| 2 | **슈퍼트렌드 전환** | 빨간선 → 초록선 전환 시 즉시 청산 |
| 3 | **SL 도달** | 진입가 대비 +2% (숏이므로 가격 상승 = 손실) |
| 4 | **MACD 역전** | MACD 골든크로스 발생 시 청산 |

### TP:SL 비율
- **1:1.5** (TP 3% : SL 2%)
- 손익비가 양수이므로 승률 40%만 유지해도 장기 수익 가능

---

## 4. 리스크 관리 (Risk Management)

### 포지션 관리

| 항목 | 값 | 근거 |
|------|-----|------|
| 레버리지 | 5x | cth.release 기본 설정, 커뮤니티 상한선 |
| 최대 포지션 비중 | 자산의 5% | 심볼당 1% 시드 노출 (5x 레버리지 적용 시) |
| TP:SL 비율 | 1:1.5 | TP +3%, SL -2% |
| 동시 포지션 수 | 최대 5개 | 총 노출 25% 이내 |
| 최대 일일 거래 횟수 | 20회 | 수수료 관리 |

### 횡보장 대응
- Volume Oscillator ≤ 0 시 **모든 신규 진입 차단**
- MarketRegime이 `RANGING` 또는 `QUIET`이면 진입 신호 무시
- 횡보 판정 시 기존 포지션은 유지하되 신규 진입 금지

### 수수료 관리
> "하루 거래량 증거금의 166배 → 수수료만 증거금의 5% 소진" (PCYT 사례)

- 일일 수수료 총액이 자산의 0.5%를 초과하지 않도록 거래 횟수 제한
- Bitget 메이커 수수료 활용: 지정가 주문으로 수수료 절감 검토

### RiskEngine 연동
```
validateOrder 통과 필수:
  1. CircuitBreaker — 연속 5회 손절 시 30분 쿨다운
  2. DrawdownMonitor — 일일 손실 3%, 총 MDD 10% 초과 시 중단
  3. ExposureGuard — 총 노출 30% 초과 시 신규 진입 거부
```

### ReduceOnly
- 모든 청산 주문(CLOSE_LONG, CLOSE_SHORT)에 `reduceOnly: true` 필수
- 헤지모드/원웨이모드 모두에서 포지션 폭발 방지

### 백테스트 기준 (구현 전 검증)
- 최소 **5년치** 1시간봉 데이터
- 슬리피지 + 수수료 **1% 오버헤드** 적용
- 1분봉이 TP/SL 양쪽에 걸치면 **손절로 판정** (보수적 해석)
- 6개월 단위 분할 테스트로 과최적화 방지

---

## 구현 매핑 (StrategyBase 연동)

```javascript
// onKline(kline) → 슈퍼트렌드, MACD, Volume Oscillator 계산
// onTick(ticker) → 실시간 가격으로 TP/SL 체크
// getSignal() → { action: 'open_long'|'open_short'|'close_long'|'close_short', confidence }
// setMarketRegime() → RANGING/QUIET 시 진입 차단
```

### 필요 외부 라이브러리
- `technicalindicators` 또는 `talib` — Supertrend, MACD, EMA, ATR 계산
- Volume Oscillator는 EMA 기반으로 자체 구현 가능
