# RSI + Pivot 역추세 전략 (Always Long)

> 원본: 재입학 — $419 → $8,000 (약 20배), 피봇 + RSI 두 지표만 사용
> 대상: Bitget USDT-FUTURES (알트코인)
> 포지션: 롱 전용 (Long Only)
> 타임프레임: 15분봉 기준

---

## 1. 진입 신호 (Entry Signal)

### 핵심 원리
BTC 차트를 기준으로 알트코인 진입 타이밍을 판단한다. **BTC와 알트코인이 동시에 급락할 때만** 알트코인 롱 진입.

### 조건 체크리스트

| # | 조건 | 상세 |
|---|------|------|
| 1 | **BTC 급락 감지** | BTC 15분봉 종가가 Pivot S1 이하로 하락 |
| 2 | **알트코인 동반 하락** | 대상 알트코인도 동시에 하락 중 (BTC 하락과 상관계수 > 0.7) |
| 3 | **RSI 과매도** | 대상 알트코인 RSI(14, 15분봉) ≤ 30 |
| 4 | **MarketRegime 확인** | `TRENDING_DOWN` 또는 `VOLATILE` 상태에서만 진입 (급락 중이므로) |

### 비진입 조건 (필터)
- BTC가 하락하지만 알트코인이 단독 하락인 경우 → 진입 금지
- BTC가 멀쩡한데 알트만 하락 → 진입 금지 (개별 악재 가능성)
- RSI가 30 이상 → 아직 과매도 아님, 대기

### Pivot 계산
```
Pivot Point (PP) = (전일 고가 + 전일 저가 + 전일 종가) / 3
S1 = (2 × PP) - 전일 고가
S2 = PP - (전일 고가 - 전일 저가)
R1 = (2 × PP) - 전일 저가
R2 = PP + (전일 고가 - 전일 저가)
```

### RSI 커스터마이징
- 기본 RSI 기간: 14
- 15분봉에서 길이를 늘리면 RSI 변동이 없어지므로 **기본 14 유지**
- talib 라이브러리 사용 권장 (업비트 RSI와 99% 일치)

---

## 2. 매수 조건 (Buy Conditions)

### 롱 진입 (OPEN_LONG)

```
IF  btc_price < btc_pivot_S1
AND alt_rsi_14 <= 30
AND alt_price_change_15m < -2%
AND btc_price_change_15m < -1%
THEN → OPEN_LONG (알트코인)
```

### 진입 방식
- **1회 진입만** 허용 — 물타기(추가 매수) 금지
- 시장가(MARKET) 주문으로 즉시 진입
- 진입과 동시에 TP/SL 자동 세팅 (아래 리스크 관리 참조)

### 진입 가격 기록
- 진입 시점의 가격을 `entryPrice`로 저장
- TP/SL 가격을 진입 시점에 계산하여 즉시 주문

### 수량 결정
```
positionSize = accountEquity × maxPositionSizePercent(5%) / leverage
quantity = positionSize / currentPrice
```

---

## 3. 매도 조건 (Sell Conditions)

### 익절 (Take Profit) — CLOSE_LONG

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **TP 도달** | 진입가 대비 +2% 도달 시 전량 익절 |
| 2 | **RSI 과매수 반전** | RSI(14) ≥ 70 도달 시 전량 익절 |
| 3 | **Pivot R1 도달** | 가격이 Pivot R1에 도달하면 전량 익절 |

### 손절 (Stop Loss) — CLOSE_LONG

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **SL 도달** | 진입가 대비 -2% 도달 시 즉시 손절 |
| 2 | **Pivot S2 이탈** | BTC가 Pivot S2 아래로 추가 하락 시 즉시 손절 |
| 3 | **시간 손절** | 진입 후 2시간 경과 시 본절(±0) 부근에서 정리 |

### 핵심 원칙
> "빠른 포기와 짧먹" — 짧은 수익 실현, 손실 시 즉시 포기
> "물타는게 제가 원하는 전략의 방향이 아닌거 같아서" — 추가 매수 없이 바로 손절

---

## 4. 리스크 관리 (Risk Management)

### 포지션 관리

| 항목 | 값 | 근거 |
|------|-----|------|
| 레버리지 | 3x | 커뮤니티 권장 3~5x, 보수적 접근 |
| 최대 포지션 비중 | 자산의 5% | `DEFAULT_RISK_PARAMS.maxPositionSizePercent` |
| 물타기 | 금지 | 1회 진입 후 SL 또는 TP만 존재 |
| 동시 포지션 수 | 최대 3개 | 총 노출 15% 이내 |
| TP:SL 비율 | 1:1 | 목표 2%, 손절 2% |

### RiskEngine 연동
```
validateOrder 통과 필수:
  1. CircuitBreaker — 연속 5회 손절 시 30분 쿨다운
  2. DrawdownMonitor — 일일 손실 3% 초과 시 거래 중단
  3. ExposureGuard — 총 노출 30% 초과 시 신규 진입 거부
```

### ReduceOnly 활용
- 포지션 정리(CLOSE_LONG) 시 반드시 `reduceOnly: true` 설정
- 선물에서 포지션 폭발 방지 (커뮤니티에서 가장 강조된 리스크 관리 항목)

### 시간대별 주의사항
- **09:00 KST**: 매수량 50% 축소 (한국시장 오픈, 급등/급락 동시 가능)
- **자정 전후**: 변동성 주의
- **주말**: 알트 변동성이 높으나 추세가 짧음 — 역추세에 유리

### MDD 한도
- 전략별 MDD 한도: **-10%**
- 도달 시 해당 전략 자동 비활성화 (`deactivate()`)
- 수동 리뷰 후에만 재활성화

---

## 구현 매핑 (StrategyBase 연동)

```javascript
// onTick(ticker) → BTC 가격 모니터링, Pivot 계산
// onKline(kline) → RSI 계산, 15분봉 기반 시그널 생성
// getSignal() → { action: 'open_long', symbol, confidence, suggestedQty }
// emitSignal() → TRADE_EVENTS.SIGNAL_GENERATED 발행
// setMarketRegime() → TRENDING_DOWN, VOLATILE 시에만 활성
```

### 필요 외부 라이브러리
- `talib` 또는 `technicalindicators` — RSI 계산
- Pivot은 자체 수식 구현 (전일 OHLC 기반)
