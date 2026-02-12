# 그리드 트레이딩 전략 (Grid Trading)

> 원본: 월드 (수수료 리베이트 그리드, 일 1만건+), 캥글 (김프+그리드 병행)
> 대상: Bitget USDT-FUTURES
> 포지션: 양방향 헤지 (Long 100 : Short 100)
> 타임프레임: 틱 단위 (실시간)

---

## 1. 진입 신호 (Entry Signal)

### 핵심 원리
가격이 일정 범위 내에서 등락할 때, **사전에 설정한 가격 격자(Grid)마다 매수/매도 주문을 배치**하여 횡보장에서 꾸준히 수익을 추출한다. 롱/숏 양방향 헤지로 방향성 리스크를 최소화한다.

### 그리드 설정 계산

```
기준가격 (basePrice) = 현재 시장가
그리드 간격 (gridSpacing) = ATR(14, 1시간봉) × 0.3
그리드 단계 수 (gridLevels) = 위아래 각 10단계 (총 20단계)
상단 범위 = basePrice + (gridSpacing × gridLevels)
하단 범위 = basePrice - (gridSpacing × gridLevels)
```

### 진입 트리거

| # | 조건 | 상세 |
|---|------|------|
| 1 | **MarketRegime = RANGING** | 횡보장에서만 그리드 활성화 |
| 2 | **ATR 기반 간격** | 변동성에 따라 자동 간격 조절 |
| 3 | **BTC 급변 없음** | BTC 1시간 변동률 ±3% 이내 |
| 4 | **펀딩비 확인** | 펀딩비 절대값 < 0.03% (극단적 편향 없음) |

### 비활성 조건 (그리드 중단)
- MarketRegime이 `TRENDING_UP` 또는 `TRENDING_DOWN`으로 전환 시 → 그리드 전체 중단
- BTC 1시간 변동률 ±5% 초과 시 → 즉시 모든 미체결 주문 취소
- 총 미실현 손실이 자산의 -3% 초과 시 → 그리드 중단 및 포지션 정리

---

## 2. 매수 조건 (Buy Conditions)

### 롱 그리드 주문 (OPEN_LONG)

```
FOR level = 1 TO gridLevels:
    buyPrice = basePrice - (gridSpacing × level)

    IF 현재가격이 buyPrice에 도달
    THEN → 지정가 OPEN_LONG at buyPrice

    // 체결 즉시 해당 레벨의 익절 주문 배치
    sellPrice = buyPrice + gridSpacing
    → 지정가 CLOSE_LONG at sellPrice
```

### 숏 그리드 주문 (OPEN_SHORT)

```
FOR level = 1 TO gridLevels:
    sellPrice = basePrice + (gridSpacing × level)

    IF 현재가격이 sellPrice에 도달
    THEN → 지정가 OPEN_SHORT at sellPrice

    // 체결 즉시 해당 레벨의 익절 주문 배치
    coverPrice = sellPrice - gridSpacing
    → 지정가 CLOSE_SHORT at coverPrice
```

### 주문 방식
- **지정가(LIMIT) 주문만 사용** → 메이커 수수료 적용 (수수료 절감 핵심)
- 체결 시 즉시 반대 방향 익절 주문 자동 배치
- 그리드 레벨당 수량은 균등 배분

### 수량 결정 (레벨당)
```
totalGridBudget = accountEquity × 20%  // 전체 그리드에 배정할 자산 비율
perLevelQty = totalGridBudget / (gridLevels × 2) / currentPrice
// 롱 10레벨 + 숏 10레벨 = 20레벨
```

---

## 3. 매도 조건 (Sell Conditions)

### 개별 그리드 익절 (자동)

| 방향 | 조건 | 설명 |
|------|------|------|
| 롱 익절 | 매수가 + gridSpacing 도달 | 1그리드 간격 수익 실현 |
| 숏 익절 | 매도가 - gridSpacing 도달 | 1그리드 간격 수익 실현 |

### 전체 그리드 청산 (비상)

| 우선순위 | 조건 | 설명 |
|----------|------|------|
| 1 | **추세 전환** | MarketRegime → TRENDING_UP/DOWN 전환 시 전체 청산 |
| 2 | **급변동** | BTC 1시간 변동률 ±5% 초과 시 전체 청산 |
| 3 | **MDD 초과** | 그리드 전체 미실현 손실 > -3% 시 전체 청산 |
| 4 | **범위 이탈** | 가격이 그리드 상단/하단 범위를 벗어나 30분 이상 체류 시 리셋 |

### 그리드 리셋
- 가격이 그리드 범위를 이탈하면 새로운 기준가격으로 그리드를 재설정
- 기존 미체결 주문 전량 취소 → 새 그리드 배치
- 리셋 간 최소 간격: 1시간 (빈번한 리셋 방지)

---

## 4. 리스크 관리 (Risk Management)

### 포지션 관리

| 항목 | 값 | 근거 |
|------|-----|------|
| 레버리지 | 2x | 양방향 헤지이므로 낮은 레버리지로 충분 |
| 그리드 총 자산 배분 | 자산의 20% | 나머지 80%는 유동성 확보 |
| 레벨당 수량 | 균등 배분 | 총 배분 / 20레벨 |
| 최대 동시 체결 | 10개 | 롱 5개 + 숏 5개 |
| 그리드 간격 | ATR(14) × 0.3 | 변동성 연동 자동 조절 |

### 수수료 관리 (핵심)

> "하루 거래량 증거금의 166배 → 수수료만 증거금의 5% 소진"

| 항목 | 기준 |
|------|------|
| 일일 최대 거래 횟수 | 500회 (수수료 모니터링) |
| 지정가 주문만 사용 | 메이커 수수료 0.02% 적용 |
| 일일 수수료 상한 | 자산의 0.3% |
| 수수료 > 수익 시 | 그리드 간격 확대 또는 거래 중단 |

### 수수료 리베이트 활용
- Bitget 리베이트 프로그램 활용 (거래량 기반 수수료 환급)
- 높은 거래 빈도 → 리베이트 수익 극대화
- 그리드 수익 + 리베이트 수익 = 이중 수익원

### 양방향 헤지 리스크

```
순 포지션 노출 = |롱 포지션 합계 - 숏 포지션 합계|
최대 순 노출 허용 = 자산의 5%

IF 순 노출 > 5%:
    편향된 방향의 신규 진입 차단
    반대 방향 주문만 허용하여 균형 회복
```

### 추세 전환 대응
- MarketRegime 변화 감지 시:
  - `RANGING` → `TRENDING_*`: 미체결 주문 전량 취소, 기존 포지션은 TP/SL로 관리
  - `TRENDING_*` → `RANGING`: 새 기준가격으로 그리드 재배치
  - `VOLATILE`: 그리드 간격을 2배로 확대하여 유지

### ReduceOnly
- 모든 익절/손절 주문에 `reduceOnly: true` 필수
- 그리드 주문 취소 시 잔여 포지션 정리 주문도 `reduceOnly: true`

### MDD 한도
- 그리드 전략 MDD 한도: **-5%**
- 양방향 헤지 특성상 단방향 전략보다 낮은 MDD 설정
- MDD 초과 시 전체 그리드 중단 + 포지션 정리

---

## 구현 매핑 (StrategyBase 연동)

```javascript
// onTick(ticker) → 그리드 레벨 체결 감지, 반대 주문 배치
// onKline(kline) → ATR 계산, 그리드 간격 갱신, MarketRegime 확인
// getSignal() → 체결된 레벨의 반대 주문 시그널 반환
// setMarketRegime() → RANGING에서만 활성, TRENDING 시 중단
```

### 필요 내부 모듈
- `orderManager.js` — 다수의 지정가 주문 관리 (배치, 취소, 상태 추적)
- `positionManager.js` — 롱/숏 포지션 균형 모니터링
- `marketData.js` → ATR 계산용 kline 데이터 수신

### 특수 고려사항
- 주문 수가 많으므로 Bitget API rate limit 관리 필수
- 미체결 주문 관리: 주기적으로 미체결 주문 목록 동기화
- WebSocket으로 체결 알림 수신 (REST 폴링 대비 지연 최소화)
