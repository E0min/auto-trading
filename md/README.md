# 암호화폐 자동매매 시스템 가이드

Bitget 거래소 기반 암호화폐 선물 자동매매 플랫폼.
18개 전략 + 시장 레짐 자동 분류 + 리스크 관리 엔진을 통합한 풀스택 시스템.

## 시스템 구성

| 구성요소 | 기술 스택 | 포트 |
|----------|-----------|------|
| **백엔드** | Node.js + Express + Socket.io | 3001 |
| **프론트엔드** | Next.js 15 + TypeScript + Tailwind CSS | 3000 |
| **데이터베이스** | MongoDB (Mongoose ODM) | 27017 |
| **거래소** | Bitget V3 API (REST + WebSocket) | - |

## 문서 목차

| 문서 | 설명 |
|------|------|
| [architecture.md](./architecture.md) | 아키텍처 — DI, 서비스 의존성, 이벤트 시스템 |
| [trading-pipeline.md](./trading-pipeline.md) | 매매 파이프라인 — 8단계 실행 흐름 |
| [strategies.md](./strategies.md) | 전략 시스템 — 18개 전략 상세 메타데이터 |
| [risk-engine.md](./risk-engine.md) | 리스크 엔진 — CircuitBreaker, DrawdownMonitor, ExposureGuard |
| [market-regime.md](./market-regime.md) | 시장 레짐 — 6팩터 분류 + 자동 최적화 |
| [api-reference.md](./api-reference.md) | API 레퍼런스 — 전체 엔드포인트 목록 |
| [frontend.md](./frontend.md) | 프론트엔드 — 페이지, 컴포넌트, 훅, 타입 |
| [paper-trading.md](./paper-trading.md) | 페이퍼 트레이딩 & 토너먼트 모드 |
| [backtest.md](./backtest.md) | 백테스트 시스템 — 엔진, 메트릭, 데이터 페처 |
| [configuration.md](./configuration.md) | 설정 가이드 — 환경 변수, 리스크 파라미터 |
| [database.md](./database.md) | 데이터베이스 — MongoDB 모델 스키마 |

## 빠른 시작

### 1. 의존성 설치
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 환경 변수 설정
```bash
# backend/.env
BITGET_API_KEY=your_api_key
BITGET_SECRET_KEY=your_secret_key
BITGET_PASSPHRASE=your_passphrase
PORT=3001
MONGO_URI=mongodb://localhost:27017/tradingBot
PAPER_TRADING=true
```

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### 3. 서버 실행
```bash
# 백엔드 (MongoDB 실행 필요)
cd backend && node src/app.js

# 프론트엔드
cd frontend && npm run dev
```

### 4. 백테스트 실행
```bash
node backend/scripts/runAllBacktest.js
```

## 핵심 설계 원칙

1. **금액 값은 모두 String** — `mathUtils`로 산술 연산 (부동소수점 사용 금지)
2. **ExchangeClient 싱글턴** — SDK의 유일한 소비자 (다른 모듈에서 SDK 직접 import 금지)
3. **RiskEngine 필수 게이트웨이** — 모든 주문은 리스크 검증 통과 필수
4. **EventEmitter 기반 통신** — 서비스 간 느슨한 결합
5. **의존성 주입(DI)** — `app.js`에서 모든 서비스 생성/주입

## 프로젝트 구조

```
auto-trading/
├── backend/
│   ├── src/
│   │   ├── app.js                    # 엔트리 포인트 (Express + Socket.io)
│   │   ├── api/                      # REST 라우트 (7개 파일)
│   │   │   ├── botRoutes.js
│   │   │   ├── tradeRoutes.js
│   │   │   ├── analyticsRoutes.js
│   │   │   ├── backtestRoutes.js
│   │   │   ├── paperRoutes.js
│   │   │   ├── tournamentRoutes.js
│   │   │   └── regimeRoutes.js
│   │   ├── services/                 # 핵심 서비스 (13개)
│   │   │   ├── exchangeClient.js     # Bitget SDK 래퍼
│   │   │   ├── botService.js         # 오케스트레이터
│   │   │   ├── riskEngine.js         # 리스크 관리
│   │   │   ├── orderManager.js       # 주문 실행
│   │   │   ├── positionManager.js    # 포지션 동기화
│   │   │   ├── marketData.js         # WS 데이터 파이프라인
│   │   │   ├── tickerAggregator.js   # 시장 통계 집계
│   │   │   ├── coinSelector.js       # 7팩터 코인 선정
│   │   │   ├── marketRegime.js       # 6팩터 시장 분류
│   │   │   ├── strategyRouter.js     # 레짐 기반 전략 라우팅
│   │   │   ├── signalFilter.js       # 4단계 시그널 필터
│   │   │   ├── indicatorCache.js     # 지표 캐싱
│   │   │   ├── paperEngine.js        # 가상 주문 매칭
│   │   │   └── paperAccountManager.js # 토너먼트 계정 관리
│   │   ├── strategies/               # 18개 전략
│   │   │   ├── price-action/   (5개)
│   │   │   ├── indicator-light/ (8개)
│   │   │   └── indicator-heavy/ (3개)
│   │   ├── models/                   # MongoDB 모델 (4개)
│   │   ├── backtest/                 # 백테스트 엔진
│   │   └── utils/                    # 유틸리티
│   ├── scripts/                      # 배치 스크립트
│   └── data/                         # 캐시 데이터
├── frontend/
│   └── src/
│       ├── app/                      # Next.js 페이지 (3개)
│       ├── components/               # UI 컴포넌트 (25개)
│       ├── hooks/                    # 커스텀 훅 (8개)
│       ├── lib/                      # API 클라이언트, 유틸리티
│       └── types/                    # TypeScript 타입
└── md/                               # 이 문서 디렉토리
```
