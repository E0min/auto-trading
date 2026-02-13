# 데이터베이스 — MongoDB 모델 스키마

## 개요

MongoDB + Mongoose ODM을 사용합니다. 4개의 모델이 정의되어 있습니다.

> **중요**: 모든 금액 필드는 **String 타입**입니다. 부동소수점 정밀도 문제를 방지하기 위해 `mathUtils`로 산술 연산합니다.

---

## 1. Trade — 거래 기록

파일: `backend/src/models/Trade.js`

### 스키마

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `orderId` | String | ✅ | - | 거래소 주문 ID (indexed) |
| `clientOid` | String | - | - | 클라이언트 생성 주문 ID (indexed) |
| `symbol` | String | ✅ | - | 심볼 (indexed) |
| `category` | String | - | - | 거래 카테고리 (enum) |
| `side` | String | - | - | `buy` / `sell` |
| `posSide` | String | - | - | `long` / `short` |
| `orderType` | String | - | - | `limit` / `market` |
| `qty` | String | ✅ | - | 주문 수량 |
| `price` | String | - | - | 주문 가격 |
| `filledQty` | String | - | `'0'` | 체결 수량 |
| `avgFilledPrice` | String | - | - | 평균 체결가 |
| `fee` | String | - | `'0'` | 수수료 |
| `status` | String | - | `PENDING` | 주문 상태 (indexed) |
| `signalId` | ObjectId | - | - | 관련 시그널 ID (ref: Signal) |
| `sessionId` | ObjectId | - | - | 봇 세션 ID (ref: BotSession) |
| `strategy` | String | - | - | 전략 이름 |
| `reduceOnly` | Boolean | - | `false` | 포지션 감소 전용 |
| `takeProfitPrice` | String | - | - | 이익 실현 가격 |
| `stopLossPrice` | String | - | - | 손절 가격 |
| `pnl` | String | - | - | 손익 |
| `metadata` | Mixed | - | - | 추가 메타데이터 |

### 인덱스
- `{ orderId: 1 }` — 단일
- `{ clientOid: 1 }` — 단일
- `{ symbol: 1 }` — 단일
- `{ status: 1 }` — 단일
- `{ sessionId: 1, createdAt: -1 }` — 복합 (세션 내 시간순 조회)

### 상태 enum
```
PENDING → OPEN → PARTIALLY_FILLED → FILLED
                                  → CANCELLED
                                  → REJECTED
                                  → FAILED
```

---

## 2. BotSession — 봇 세션

파일: `backend/src/models/BotSession.js`

### 스키마

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `status` | String | `IDLE` | 봇 상태 (enum: BOT_STATES) |
| `startedAt` | Date | - | 시작 시각 |
| `stoppedAt` | Date | - | 종료 시각 |
| `config` | Mixed | - | 시작 시 설정 |
| `strategies` | [String] | `[]` | 활성화된 전략 이름 목록 |
| `symbols` | [String] | `[]` | 매매 대상 심볼 목록 |
| `stats.totalTrades` | Number | `0` | 총 거래 수 |
| `stats.wins` | Number | `0` | 승리 수 |
| `stats.losses` | Number | `0` | 패배 수 |
| `stats.totalPnl` | String | `'0'` | 총 손익 |
| `stats.maxDrawdown` | String | `'0'` | 최대 낙폭 |
| `stats.peakEquity` | String | `'0'` | 최고 자산 |
| `stopReason` | String | - | 종료 사유 |

### 상태 enum
```
IDLE → RUNNING → PAUSED → RUNNING (resume)
                        → STOPPING → IDLE (stopped)
     → ERROR
```

---

## 3. Signal — 전략 시그널

파일: `backend/src/models/Signal.js`

### 스키마

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `strategy` | String | ✅ | 전략 이름 |
| `symbol` | String | ✅ | 심볼 |
| `action` | String | ✅ | 시그널 액션 (enum: SIGNAL_ACTIONS) |
| `category` | String | - | 거래 카테고리 |
| `suggestedQty` | String | - | 제안 수량 |
| `suggestedPrice` | String | - | 제안 가격 |
| `confidence` | Number | - | 신뢰도 (0~1) |
| `riskApproved` | Boolean | - | 리스크 승인 여부 |
| `rejectReason` | String | - | 거부 사유 |
| `marketContext` | Mixed | - | 시그널 시점 시장 상태 |
| `resultOrderId` | String | - | 결과 주문 ID |
| `sessionId` | ObjectId | - | 봇 세션 ID (ref: BotSession) |

### 액션 enum
```
OPEN_LONG    — 롱 포지션 진입
OPEN_SHORT   — 숏 포지션 진입
CLOSE_LONG   — 롱 포지션 청산
CLOSE_SHORT  — 숏 포지션 청산
```

### marketContext 예시
```json
{
  "rsi": "28.5",
  "sma": "65000",
  "atr": "500",
  "price": "64500",
  "regime": "trending_up"
}
```

---

## 4. Snapshot — 자산 스냅샷

파일: `backend/src/models/Snapshot.js`

### 스키마

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `sessionId` | ObjectId | - | 봇 세션 ID (indexed) |
| `equity` | String | ✅ | 총 자산 |
| `availableBalance` | String | - | 가용 잔고 |
| `unrealizedPnl` | String | - | 미실현 손익 |
| `positions` | [SubSchema] | - | 포지션 스냅샷 목록 |
| `positions[].symbol` | String | - | 심볼 |
| `positions[].posSide` | String | - | 방향 |
| `positions[].qty` | String | - | 수량 |
| `positions[].entryPrice` | String | - | 진입가 |
| `positions[].markPrice` | String | - | 현재가 |
| `positions[].unrealizedPnl` | String | - | 미실현 PnL |
| `positions[].leverage` | String | - | 레버리지 |
| `openOrderCount` | Number | - | 미체결 주문 수 |
| `dailyPnl` | String | - | 당일 손익 |
| `metadata` | Mixed | - | 추가 메타데이터 |

### 인덱스
- `{ sessionId: 1, createdAt: -1 }` — 복합 (세션 내 시간순 조회)
- `{ createdAt: 1 }` — TTL 인덱스 (90일 후 자동 삭제)

### 용도
- 자산 곡선(equity curve) 시각화 데이터
- 세션별 자산 추이 추적
- 주기적 스냅샷 기록 (수 분 간격)

---

## 데이터 흐름

```
전략 시그널 → Signal 모델 저장
         → riskEngine 검증
         → 승인 시: Signal.riskApproved = true
         → 주문 실행: Trade 모델 생성 (PENDING)
         → 체결: Trade.status = FILLED, Trade.pnl 갱신
         → BotSession.stats 갱신
         → Snapshot 기록 (주기적)
```

## 쿼리 패턴

```javascript
// 세션 내 최근 거래
Trade.find({ sessionId }).sort({ createdAt: -1 }).limit(50)

// 전략별 거래
Trade.find({ strategy: 'MaTrendStrategy' }).sort({ createdAt: -1 })

// 페이퍼 거래
Trade.find({ 'metadata.paperTrade': true })

// 자산 곡선
Snapshot.find({ sessionId }).sort({ createdAt: 1 })

// 오픈 주문
Trade.find({ status: { $in: ['pending', 'open', 'partially_filled'] } })
```
