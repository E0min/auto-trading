# 설정 가이드

## 환경 변수

### 백엔드 (`backend/.env`)

#### 필수 설정

| 변수 | 설명 | 예시 |
|------|------|------|
| `BITGET_API_KEY` | Bitget API 키 | `bg_xxxxxxxxxxxx` |
| `BITGET_SECRET_KEY` | Bitget 시크릿 키 | `xxxxxxxxxxxxxxxx` |
| `BITGET_PASSPHRASE` | Bitget 패스프레이즈 | `your_passphrase` |

> **환경 변수 사전 검증 (Sprint R11)**: `app.js`의 `validateEnv()`가 `bootstrap()` 전에 실행됩니다. 페이퍼 모드(`PAPER_TRADING=true`)에서는 위 3개 변수가 필수가 아닙니다. 라이브 모드에서 누락 시 서버 시작 전 명확한 에러 메시지를 출력합니다.

#### 선택 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3001` | 서버 포트 |
| `MONGO_URI` | `mongodb://localhost:27017/tradingBot` | MongoDB 연결 URI |
| `LOG_LEVEL` | `INFO` | 로그 레벨 (DEBUG, INFO, TRADE, WARN, ERROR) |
| `PAPER_TRADING` | `false` | 페이퍼 트레이딩 모드 |
| `TOURNAMENT_MODE` | `false` | 토너먼트 모드 (PAPER_TRADING=true 필요) |
| `API_KEY` | (없음) | API 인증 키 (Sprint R5). 미설정 시 인증 비활성화 |
| `CORS_ORIGIN` | `*` | CORS 허용 오리진 (Sprint R5). 운영 환경에서 프론트엔드 URL로 제한 권장 |

#### .env 파일 예시

```env
# Bitget API 인증
BITGET_API_KEY=bg_your_api_key
BITGET_SECRET_KEY=your_secret_key
BITGET_PASSPHRASE=your_passphrase

# 서버
PORT=3001
MONGO_URI=mongodb://localhost:27017/tradingBot

# 로깅
LOG_LEVEL=INFO

# 모드
PAPER_TRADING=true
TOURNAMENT_MODE=false
```

### 프론트엔드 (`frontend/.env.local`)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | 백엔드 REST API URL |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:3001` | Socket.io URL |
| `NEXT_PUBLIC_API_KEY` | (없음) | API 인증 키 (Sprint R5). 백엔드 `API_KEY`와 동일 값 |

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_API_KEY=your_api_key_here
```

---

## 리스크 파라미터

런타임에 `PUT /api/bot/risk-params`로 변경 가능합니다.

### 기본값

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `maxPositionSizePercent` | `'5'` | 개별 포지션 최대 크기 (equity의 %) |
| `maxTotalExposurePercent` | `'30'` | 총 노출 최대 크기 (equity의 %) |
| `maxDailyLossPercent` | `'3'` | 일일 최대 손실 (%) |
| `maxDrawdownPercent` | `'10'` | 최대 낙폭 (%) |
| `maxRiskPerTradePercent` | `'2'` | 거래당 최대 리스크 (%) |
| `consecutiveLossLimit` | `5` | 서킷 브레이커 발동 연속 손실 수 |
| `cooldownMinutes` | `30` | 서킷 브레이커 쿨다운 (분) |

### 보수적 설정 예시

```json
{
  "params": {
    "maxPositionSizePercent": "2",
    "maxTotalExposurePercent": "15",
    "maxDailyLossPercent": "1.5",
    "maxDrawdownPercent": "5",
    "maxRiskPerTradePercent": "1",
    "consecutiveLossLimit": 3,
    "cooldownMinutes": 60
  }
}
```

### 공격적 설정 예시

```json
{
  "params": {
    "maxPositionSizePercent": "8",
    "maxTotalExposurePercent": "50",
    "maxDailyLossPercent": "5",
    "maxDrawdownPercent": "15",
    "maxRiskPerTradePercent": "3",
    "consecutiveLossLimit": 7,
    "cooldownMinutes": 15
  }
}
```

---

## 전략 설정

### 런타임 설정 변경

실행 중인 전략의 설정을 변경할 수 있습니다:

```
PUT /api/bot/strategies/:name/config
Body: { "positionSizePercent": "3", "leverage": "2" }
```

### 전략별 주요 설정 항목

#### 공통 설정

| 항목 | 설명 | 일반적인 범위 |
|------|------|-------------|
| `positionSizePercent` | 포지션 크기 (equity의 %) | '2' ~ '5' |
| `leverage` | 레버리지 | '1' ~ '5' |
| `tpPercent` | 이익 목표 (%) | '1' ~ '5' |
| `slPercent` | 손절 (%) | '1' ~ '3' |

#### ATR 기반 설정 (price-action 전략)

| 항목 | 설명 |
|------|------|
| `atrPeriod` | ATR 계산 기간 |
| `stopMultiplier` | ATR × N 스탑로스 |
| `trailingActivationAtr` | 트레일링 활성화 ATR 거리 |
| `trailingDistanceAtr` | 트레일링 스탑 ATR 거리 |

#### 지표 설정 (indicator 전략)

| 항목 | 설명 |
|------|------|
| `rsiPeriod` | RSI 기간 (보통 14) |
| `rsiOversold` / `rsiOverbought` | RSI 과매도/과매수 임계값 |
| `bbPeriod` / `bbStdDev` | 볼린저 밴드 기간/표준편차 |
| `macdFast` / `macdSlow` / `macdSignal` | MACD 파라미터 |
| `emaPeriod` | EMA 기간 |

---

## 로그 레벨

| 레벨 | 설명 | 용도 |
|------|------|------|
| `DEBUG` | 상세 디버그 정보 | 개발/디버깅 |
| `INFO` | 일반 정보 | 기본 운영 |
| `TRADE` | 매매 관련 정보 | 거래 모니터링 |
| `WARN` | 경고 | 주의 필요 상황 |
| `ERROR` | 오류 | 문제 발생 |

```env
# 개발 시
LOG_LEVEL=DEBUG

# 운영 시
LOG_LEVEL=TRADE
```

---

## Bitget API 설정 요구사항

### 계정 요구사항
- **UTA (Unified Trading Account)** 모드 활성화 필수
- USDT-M 선물 거래 권한

### API 키 권한
- 읽기 (Read) — 시장 데이터, 계정 정보
- 거래 (Trade) — 주문 생성/취소 (라이브 모드)
- 출금 불필요

### WebSocket 설정
```javascript
// 공개 채널 — instType: 'usdt-futures'
subscribePublic([
  { topic: 'ticker', payload: { instType: 'usdt-futures', symbol: 'BTCUSDT' } },
  { topic: 'candle1m', payload: { instType: 'usdt-futures', symbol: 'BTCUSDT' } }
])

// 비공개 채널 — instType: 'UTA'
subscribePrivate([
  { topic: 'orders', payload: { instType: 'UTA' } },
  { topic: 'positions', payload: { instType: 'UTA' } },
  { topic: 'account', payload: { instType: 'UTA' } }
])
```

### SDK 파라미터 매핑

| 일반 용어 | Bitget SDK 파라미터 |
|-----------|-------------------|
| category | `productType` |
| qty (수량) | `size` |
| posSide (방향) | `tradeSide` |

---

## MongoDB 설정

### 로컬 설치 (Windows)

```bash
winget install MongoDB.Server
```

### Atlas 클라우드

```env
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/tradingBot
```

### 미설치 시

MongoDB 미설치 상태에서 서버 시작 시:
```
MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017
```

> 페이퍼 모드 + 백테스트는 인메모리 저장소를 사용하므로 MongoDB 없이도 부분 동작 가능.
> 단, 거래 기록 영구 저장, 세션 관리 등은 MongoDB 필요.

---

## 페이퍼 트레이딩 설정

### 기본값

| 항목 | 값 | 설명 |
|------|-----|------|
| `initialBalance` | `'10000'` | 초기 가상 잔고 (USDT) |
| `feeRate` | `'0.0006'` | 테이커 수수료 (0.06%) |
| `slippageBps` | `'5'` | 슬리피지 (5 bps = 0.05%) |

### 리셋

```
POST /api/paper/reset
→ 잔고 초기화 + 포지션 청산 + 대기 주문 취소
```

---

## 봇 시작 설정

### POST /api/bot/start 요청

```json
{
  "strategies": ["MaTrendStrategy", "GridStrategy"],
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "maxConcurrentPositions": 5
}
```

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `strategies` | 전체 등록 전략 | 활성화할 전략 목록 |
| `symbols` | coinSelector 자동 선정 | 매매 대상 심볼 |

### 시작 시 내부 프로세스

```
1. MongoDB 세션 생성
2. 전략 인스턴스화 + 설정 주입
3. 시장 데이터 구독 시작
4. 코인 선정 실행
5. 시장 레짐 분류 시작
6. 전략 라우터 초기화 (레짐 기반 활성화)
7. 시그널 필터 초기화
8. 리스크 엔진 계정 상태 동기화
9. 매매 루프 시작
```
