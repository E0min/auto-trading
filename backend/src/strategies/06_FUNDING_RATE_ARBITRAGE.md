# 펀딩비 역발상 전략 (Funding Rate Contrarian)

> 원본: 재입학 (펀딩비 -0.01% 이하 롱 진입), 커뮤니티 숏스퀴즈 분석
> 대상: Bitget USDT-FUTURES (BTC 위주, 메이저 알트 보조)
> 포지션: 양방향 (롱 편향)
> 타임프레임: 8시간 주기 (펀딩비 정산 사이클)

---

## 1. 진입 신호 (Entry Signal)

### 핵심 원리
> "펀딩비율 값이 -0.01%라면 베팅을 시도해 볼 만한 좋은 기회"

선물 시장의 펀딩비(Funding Rate)는 롱/숏 포지션 간 균형을 맞추는 메커니즘이다. 펀딩비가 극단적으로 치우치면 **반대 방향으로의 회귀**가 발생할 확률이 높아진다. 이를 이용하여 극단적 펀딩비 시점에 반대 방향으로 진입한다.

### 펀딩비 기본 개념
```
펀딩비 > 0 (양수): 롱이 숏에게 수수료 지불 → 롱 과밀 상태
펀딩비 < 0 (음수): 숏이 롱에게 수수료 지불 → 숏 과밀 상태
정산 주기: 매 8시간 (00:00, 08:00, 16:00 UTC)
```

### 롱 진입 조건 (숏 과밀 → 숏스퀴즈 노림)

| # | 조건 | 상세 |
|---|------|------|
| 1 | **펀딩비 극단적 음수** | 현재 펀딩비 ≤ -0.01% |
| 2 | **연속 음수 펀딩비** | 최근 3회 연속 펀딩비 음수 (24시간 이상 숏 편향) |
| 3 | **OI 증가** | 미결제약정(OI)이 24시간 전 대비 5% 이상 증가 (포지션 축적 중) |
| 4 | **가격 지지선 확인** | BTC 가격이 일봉 SMA(20) 또는 Pivot S1 부근 |
| 5 | **MarketRegime** | `TRENDING_DOWN` 또는 `VOLATILE` (공포 극대 시점) |

### 숏 진입 조건 (롱 과밀 → 롱 청산 노림)

| # | 조건 | 상세 |
|---|------|------|
| 1 | **펀딩비 극단적 양수** | 현재 펀딩비 ≥ +0.03% |
| 2 | **연속 양수 펀딩비** | 최근 3회 연속 펀딩비 양수 (24시간 이상 롱 편향) |
| 3 | **OI 증가** | 미결제약정 24시간 전 대비 5% 이상 증가 |
| 4 | **가격 저항선 확인** | BTC 가격이 일봉 SMA(20) 또는 Pivot R1 부근 |
| 5 | **MarketRegime** | `TRENDING_UP` 또는 `VOLATILE` (탐욕 극대 시점) |

### 숏스퀴즈 / 롱스퀴즈 메커니즘
> "상승국면에서 비트코인이 순간적으로 15% 이상 급락 → 선물 트레이더들이 빠르게 숏 포지션 → 고래들이 공격적으로 매수 → 숏스퀴즈 연쇄 청산"

---

## 2. 매수 조건 (Buy Conditions)

### 롱 진입 (OPEN_LONG) — 숏스퀴즈 기대

```
IF  funding_rate <= -0.01
AND funding_rate_prev1 < 0 AND funding_rate_prev2 < 0  // 3회 연속 음수
AND oi_change_24h > 5%                                   // OI 증가
AND btc_price >= btc_daily_sma20 * 0.97                  // 지지선 부근 (3% 이내)
THEN → OPEN_LONG

// 신뢰도 가중치
confidence = base_confidence
IF funding_rate <= -0.03: confidence += 20  // 극단적 음수 시 신뢰도 상승
IF oi_change_24h > 10%: confidence += 10    // OI 급증 시
IF market_regime == 'volatile': confidence += 10
```

### 숏 진입 (OPEN_SHORT) — 롱스퀴즈 기대

```
IF  funding_rate >= +0.03
AND funding_rate_prev1 > 0 AND funding_rate_prev2 > 0  // 3회 연속 양수
AND oi_change_24h > 5%
AND btc_price <= btc_daily_sma20 * 1.03                  // 저항선 부근
THEN → OPEN_SHORT
```

### 진입 방식
- 펀딩비 정산 **1시간 전**에 진입 (정산 시점의 가격 변동 활용)
- 시장가(MARKET) 즉시 진입
- 진입과 동시에 TP/SL 세팅

### 수량 결정
```
// 켈리 공식 기반 포지션 사이징
kelly_fraction = (winRate × avgWin - (1 - winRate) × avgLoss) / avgWin
// 안전을 위해 half-kelly 적용
position_percent = min(kelly_fraction / 2, 5%)
positionSize = accountEquity × position_percent / leverage
quantity = positionSize / currentPrice
```

> "돈이 적던, 크던 결국 가진돈에서의 비중으로 투자하는 거기때문에" — 켈리 기준 적용 (해피)

### 펀딩비 수익 추가 확보
- 롱 진입 시 펀딩비가 음수 → 숏 포지션이 롱에게 수수료 지불 → **펀딩비 수익 자동 발생**
- 숏 진입 시 펀딩비가 양수 → 롱 포지션이 숏에게 수수료 지불 → **펀딩비 수익 자동 발생**
- 방향성 수익 + 펀딩비 수익 = 이중 수익원

---

## 3. 매도 조건 (Sell Conditions)

### 롱 포지션 청산 (CLOSE_LONG)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **펀딩비 정상화** | 펀딩비가 0% 이상으로 회복 시 50% 익절 |
| 2 | **TP 도달** | 진입가 대비 +3% 도달 시 전량 익절 |
| 3 | **다음 펀딩비 정산** | 다음 8시간 정산 시점에서 50% 추가 익절 |
| 4 | **SL 도달** | 진입가 대비 -2% 도달 시 즉시 전량 손절 |
| 5 | **24시간 시간 제한** | 진입 후 24시간(3회 정산) 경과 시 자동 청산 |

### 숏 포지션 청산 (CLOSE_SHORT)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **펀딩비 정상화** | 펀딩비가 0% 이하로 회복 시 50% 익절 |
| 2 | **TP 도달** | 진입가 대비 -3% (숏 수익) 도달 시 전량 익절 |
| 3 | **다음 펀딩비 정산** | 다음 정산 시점에서 50% 추가 익절 |
| 4 | **SL 도달** | 진입가 대비 +2% (숏 손실) 도달 시 즉시 전량 손절 |
| 5 | **24시간 시간 제한** | 진입 후 24시간 경과 시 자동 청산 |

### 분할 청산 전략
```
1단계: 펀딩비 정상화 시 50% 청산 (펀딩비 반전 수익 확보)
2단계: 다음 정산 시점에서 추가 25% 청산
3단계: 나머지 25%는 TP/SL로 관리
```

---

## 4. 리스크 관리 (Risk Management)

### 포지션 관리

| 항목 | 값 | 근거 |
|------|-----|------|
| 레버리지 | 3x | 8시간 이상 보유 가능 → 낮은 레버리지 |
| 최대 포지션 비중 | 자산의 5% (half-kelly) | 켈리 공식 기반 |
| 물타기 | 금지 | 1회 진입, 실패 시 손절 |
| 동시 포지션 | 최대 2심볼 | BTC 1개 + 알트 1개 |
| TP:SL 비율 | 1.5:1 | TP +3%, SL -2% |
| 최대 보유 시간 | 24시간 | 3회 펀딩비 정산 후 자동 청산 |

### 펀딩비 리스크

| 리스크 | 대응 |
|--------|------|
| 펀딩비가 더 극단적으로 이동 | SL -2%로 제한, 물타기 금지 |
| 정산 후에도 추세 지속 | 24시간 시간 제한으로 무한 보유 방지 |
| OI 급변 (대량 청산) | OI가 30분 내 10% 이상 급감 시 즉시 청산 |
| 거래소 서버 지연 | 정산 2시간 전 진입, 정산 직전 진입 금지 |

### 거래 빈도 관리
- 펀딩비 정산은 8시간 간격 → 일 최대 3회 진입 기회
- 모든 조건 충족 시에만 진입 → 실제 거래 빈도는 주 2~5회 예상
- 낮은 빈도 = 낮은 수수료 부담

### RiskEngine 연동
```
validateOrder 통과 필수:
  1. CircuitBreaker — 연속 5회 손절 시 30분 쿨다운
  2. DrawdownMonitor — 일일 손실 3%, 총 MDD 10% 초과 시 중단
  3. ExposureGuard — 총 노출 30% 초과 시 신규 진입 거부
```

### ReduceOnly
- 모든 청산/익절 주문에 `reduceOnly: true` 필수

### MDD 한도
- 전략별 MDD 한도: **-8%**
- 단기 보유 + 명확한 시간 제한으로 MDD가 낮을 것으로 기대

### 데이터 소스
- Bitget API: 현재 펀딩비, 다음 예상 펀딩비
- OI 데이터: Bitget WebSocket 또는 REST API
- 펀딩비 이력: 최소 7일치 보관 (패턴 분석용)

---

## 구현 매핑 (StrategyBase 연동)

```javascript
// onTick(ticker) → TP/SL 모니터링, OI 급변 감지
// onKline(kline) → SMA(20) 계산, 지지/저항 확인
// getSignal() → { action, symbol, confidence, suggestedQty, marketContext }
// setMarketRegime() → 극단적 공포/탐욕 시점 확인

// 추가 필요: 8시간 타이머 → 펀딩비 정산 사이클 관리
// 추가 필요: fundingRate 데이터 수집 (Bitget API 별도 호출)
```

### 필요 데이터 API
- `GET /api/v2/mix/market/current-fund-rate` — 현재 펀딩비
- `GET /api/v2/mix/market/history-fund-rate` — 펀딩비 이력
- `GET /api/v2/mix/market/open-interest` — 미결제약정
- WebSocket ticker → 실시간 가격 모니터링
