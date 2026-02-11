# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Bitget 거래소 기반 암호화폐 자동매매 플랫폼. 두 개의 독립 패키지로 구성된 모노레포:

- **`backend/`** — Node.js/Express API 서버 (디렉토리 구조만 존재, 구현 전)
- **`frontend/`** — Next.js 15 대시보드 앱 (보일러플레이트 단계)

## 명령어

### 프론트엔드 (`frontend/`)
```bash
npm run dev      # 개발 서버 실행 (localhost:3000)
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 서버 실행
npm run lint     # ESLint (next/core-web-vitals 규칙)
```

### 백엔드 (`backend/`)
```bash
node src/app.js  # 서버 실행 (포트 3001)
```

테스트 프레임워크는 아직 미구성. 각 패키지는 `node_modules`를 별도로 관리하므로 각 디렉토리에서 `npm install`을 개별 실행해야 함.

## 아키텍처

### 백엔드 서비스 레이어
Express 기반 서비스 지향 아키텍처:

| 레이어 | 파일 | 역할 |
|--------|------|------|
| API 라우트 | `src/api/botRoutes.js`, `tradeRoutes.js` | REST 엔드포인트 |
| 서비스 | `src/services/botService.js`, `traderService.js`, `scannerService.js`, `trackerService.js` | 봇 제어, 매매 실행, 시장 스캔, 거래 추적 비즈니스 로직 |
| 모델 | `src/models/Trade.js` | Mongoose 스키마 |
| 설정 | `src/config/bitget.js`, `db.js` | Bitget API 및 MongoDB 연결 설정 |
| 진입점 | `src/app.js` | Express + Socket.io 서버 초기화 |

### 프론트엔드
- Next.js 15 App Router (`src/app/`)
- TypeScript, `@/*` 경로 별칭이 `./src/*`에 매핑
- Tailwind CSS 4 스타일링
- Recharts 차트 라이브러리 (매매 데이터 시각화)
- Socket.io-client로 백엔드와 실시간 통신

### 실시간 통신
Socket.io로 프론트엔드(포트 3000)와 백엔드(포트 3001)를 연결하여 실시간 매매 데이터 전송.

## 주요 의존성
- **bitget-api** — Bitget 거래소 API 클라이언트
- **mongoose** — MongoDB ODM (기본 URI: `mongodb://localhost:27017/tradingBot`)
- **socket.io** / **socket.io-client** — WebSocket 통신 레이어
- **recharts** — 매매 데이터 시각화 차트 라이브러리

## 환경 변수
백엔드 `backend/.env` 파일에 다음 설정 필요:
- `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE` — 거래소 API 인증 정보
- `PORT` — 서버 포트 (기본값 3001)
- `MONGO_URI` — MongoDB 연결 문자열
