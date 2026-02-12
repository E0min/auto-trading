# Crypto MCP Server 활용 가이드

> 이 프로젝트(Bitget 기반 자동매매 플랫폼)에서 활용할 수 있는 MCP 서버 목록과 설정 방법, 활용 시나리오를 정리한 문서.

---

## 목차

1. [추천 MCP 서버 목록](#1-추천-mcp-서버-목록)
2. [설치 및 설정 방법](#2-설치-및-설정-방법)
3. [프로젝트 활용 시나리오](#3-프로젝트-활용-시나리오)
4. [추가 참고 MCP 서버](#4-추가-참고-mcp-서버)
5. [참고 링크](#5-참고-링크)

---

## 1. 추천 MCP 서버 목록

### 1-1. CCXT MCP Server (최우선 추천)

| 항목 | 내용 |
|------|------|
| GitHub | https://github.com/lazy-dinosaur/ccxt-mcp |
| npm | `@lazydino/ccxt-mcp` |
| 지원 거래소 | 100개+ (Bitget 포함 — CCXT 라이브러리 기반) |
| 언어 | TypeScript / Node.js |
| API 키 필요 | 거래 기능 사용 시 필요, 시세 조회만 할 경우 불필요 |

**주요 기능:**

- **시장 데이터**: 거래소 목록 조회, 시세 조회, 호가창(orderbook), OHLCV 히스토리
- **매매 실행**: 시장가/지정가 주문, 주문 취소, 포지션 관리
- **계정 관리**: 잔고 조회, 거래 이력 확인
- **고급 분석**: 승률 계산, 손익비 분석, 연속 승/패 추적, 기간별 수익률
- **리스크 관리**: 자본 비율 매매(예: 5%), 레버리지 설정(1-100x), 변동성 기반 포지션 사이징

**이 프로젝트와의 시너지:**
- `exchangeClient.js`가 하는 역할(Bitget API 호출)을 AI 대화 레벨에서 직접 수행 가능
- 전략 개발 시 실시간 OHLCV 데이터를 가져와 로직 검증
- 백테스트 데이터 수집 자동화

---

### 1-2. CoinGecko MCP Server

| 항목 | 내용 |
|------|------|
| 공식 문서 | https://docs.coingecko.com/reference/mcp-server |
| npm | `@coingecko/coingecko-mcp` |
| 지원 코인 | 15,000+ |
| API 키 필요 | 무료 티어 가능 (30회/분), Pro 키로 500회/분 |

**주요 기능 (76개+ 도구):**

- **실시간 시세**: 15,000개+ 코인 가격, 시가총액, 거래량
- **시장 분석**: 트렌딩 코인, 상승/하락 Top, 섹터별 분류(DeFi, L1, AI, Meme)
- **온체인 데이터**: GeckoTerminal 연동, 8M+ 토큰 DEX 가격/유동성
- **히스토리**: 가격 차트, OHLCV 데이터, 시장 트렌드
- **메타데이터**: 프로젝트 설명, 컨트랙트 주소, 보안 정보

**이 프로젝트와의 시너지:**
- `coinSelector.js`의 코인 스크리닝 로직 보완 (시총, 거래량, 트렌딩 데이터)
- 전략별 대상 코인 필터링 기준 수립
- 시장 전체 흐름 파악 (DeFi TVL, 섹터 로테이션 등)

---

### 1-3. Crypto.com MCP Server

| 항목 | 내용 |
|------|------|
| 공식 문서 | https://mcp.crypto.com/docs/getting-started |
| 엔드포인트 | `https://mcp.crypto.com/market-data/mcp` |
| API 키 필요 | 불필요 (완전 무료) |
| 설정 난이도 | 매우 쉬움 |

**주요 기능:**

- 실시간 암호화폐 가격 조회
- 시장 트렌드 분석
- 거래량 데이터
- 트렌딩 암호화폐 식별
- 코인 간 가격 비교

**이 프로젝트와의 시너지:**
- 가장 간단한 설정으로 실시간 시세 확인 가능
- 전략 디버깅 시 "지금 BTC 가격이 얼마인가?" 같은 빠른 확인
- API 키 불필요 → 즉시 사용 가능

---

## 2. 설치 및 설정 방법

### 2-1. Claude Code에서 MCP 서버 설정

프로젝트 루트에 `.mcp.json` 파일을 생성하여 설정합니다.

#### Crypto.com MCP (가장 간단 — API 키 불필요)

```json
{
  "mcpServers": {
    "crypto-market-data": {
      "type": "http",
      "url": "https://mcp.crypto.com/market-data/mcp"
    }
  }
}
```

#### CoinGecko MCP (무료 티어)

```json
{
  "mcpServers": {
    "coingecko": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.api.coingecko.com/mcp"]
    }
  }
}
```

#### CoinGecko MCP (Pro API 키 사용 시)

```json
{
  "mcpServers": {
    "coingecko": {
      "command": "npx",
      "args": ["@coingecko/coingecko-mcp"],
      "env": {
        "COINGECKO_API_KEY": "<YOUR_API_KEY>",
        "COINGECKO_API_TIER": "pro"
      }
    }
  }
}
```

#### CCXT MCP (시세 조회 전용 — API 키 없이)

```json
{
  "mcpServers": {
    "ccxt": {
      "command": "npx",
      "args": ["@lazydino/ccxt-mcp"]
    }
  }
}
```

#### CCXT MCP (Bitget 거래 연동)

```json
{
  "mcpServers": {
    "ccxt": {
      "command": "npx",
      "args": ["@lazydino/ccxt-mcp", "--config", "./ccxt-config.json"]
    }
  }
}
```

별도 `ccxt-config.json` 파일:

```json
{
  "accounts": [
    {
      "name": "bitget-main",
      "exchangeId": "bitget",
      "apiKey": "<BITGET_API_KEY>",
      "secret": "<BITGET_SECRET_KEY>",
      "password": "<BITGET_PASSPHRASE>",
      "defaultType": "swap"
    }
  ]
}
```

> **주의**: `ccxt-config.json`에 API 키가 포함되므로 반드시 `.gitignore`에 추가할 것.

---

### 2-2. 복수 MCP 서버 동시 사용

```json
{
  "mcpServers": {
    "crypto-market-data": {
      "type": "http",
      "url": "https://mcp.crypto.com/market-data/mcp"
    },
    "coingecko": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.api.coingecko.com/mcp"]
    },
    "ccxt": {
      "command": "npx",
      "args": ["@lazydino/ccxt-mcp"]
    }
  }
}
```

---

## 3. 프로젝트 활용 시나리오

### 3-1. 전략 개발 및 검증

| 시나리오 | 사용 MCP | 활용 방법 |
|----------|----------|-----------|
| 전략 파라미터 튜닝 | CCXT | "BTCUSDT 1시간봉 최근 500개 OHLCV 가져와서 ATR 14 평균값 확인해줘" |
| 캔들 패턴 전략 검증 | CCXT | "최근 100개 캔들에서 Engulfing 패턴 출현 횟수와 이후 수익률 분석해줘" |
| 피보나치 레벨 확인 | CCXT + Crypto.com | "ETHUSDT 최근 스윙 고/저점으로 피보나치 레벨 계산해줘" |
| 지지저항 레벨 검증 | CCXT | "BTCUSDT 4시간봉으로 최근 200캔들의 주요 S/R 레벨 찾아줘" |

### 3-2. 코인 선별 (coinSelector 보완)

| 시나리오 | 사용 MCP | 활용 방법 |
|----------|----------|-----------|
| 거래량 Top 코인 필터 | CoinGecko | "24시간 거래량 기준 USDT 선물 Top 30 코인 목록" |
| 트렌딩 코인 탐색 | CoinGecko | "최근 24시간 트렌딩 코인 중 시총 1억 달러 이상 필터" |
| 섹터 로테이션 분석 | CoinGecko | "DeFi vs L1 vs Meme 섹터별 주간 수익률 비교" |
| 펀딩비 기반 선별 | CCXT | "Bitget USDT 선물 전 종목 펀딩비 조회해서 극단값 필터" |

### 3-3. 리스크 관리 및 모니터링

| 시나리오 | 사용 MCP | 활용 방법 |
|----------|----------|-----------|
| 포지션 현황 확인 | CCXT (Bitget 연동) | "현재 Bitget 계정의 열린 포지션과 미실현 손익 보여줘" |
| 잔고 확인 | CCXT (Bitget 연동) | "Bitget USDT 잔고와 가용 마진 조회" |
| 시장 변동성 체크 | Crypto.com | "주요 코인 24시간 변동률 확인, 5% 이상 변동 코인 리스트" |
| 상관관계 분석 | CoinGecko | "BTC-ETH 상관계수, BTC 도미넌스 추이 확인" |

### 3-4. 백테스트 데이터 수집

| 시나리오 | 사용 MCP | 활용 방법 |
|----------|----------|-----------|
| 과거 OHLCV 데이터 수집 | CCXT | "BTCUSDT 15분봉 최근 3개월 데이터를 JSON으로 저장해줘" |
| 멀티 타임프레임 데이터 | CCXT | "ETHUSDT 1시간봉 + 4시간봉 동시 수집" |
| 백테스트 결과 비교 | CCXT + CoinGecko | "같은 기간 시장 전체 수익률 vs 전략 수익률 비교" |

### 3-5. 실시간 디버깅

```
예시 워크플로우:

1. 전략 코드 수정 중 "현재 BTCUSDT 가격이 얼마지?" → Crypto.com MCP
2. "최근 20개 캔들의 Donchian Channel 상하한은?" → CCXT MCP
3. "현재 Bitget 계정에 열린 주문 있어?" → CCXT MCP (Bitget 연동)
4. "이 전략이 지금 시그널을 낼 조건인지 확인해줘" → 코드 분석 + MCP 데이터
```

---

## 4. 추가 참고 MCP 서버

이 프로젝트와 직접적 관련은 낮지만 향후 확장 시 참고할 수 있는 MCP 서버들:

### 4-1. 기술적 분석 / 지표

| MCP 서버 | 설명 | 링크 |
|----------|------|------|
| crypto-indicators-mcp | 기술적 분석 도구 (RSI, MACD, BB 등) | kukapay/crypto-indicators-mcp |
| crypto-sentiment-mcp | 소셜미디어/뉴스 감성 분석 | kukapay/crypto-sentiment-mcp |
| funding-rates-mcp | 거래소별 펀딩비 차익거래 탐지 | kukapay/funding-rates-mcp |

### 4-2. 온체인 / DeFi

| MCP 서버 | 설명 | 링크 |
|----------|------|------|
| mcp-cryptowallet-evm | 이더리움 지갑 조작 + DeFi 연동 | dcSpark/mcp-cryptowallet-evm |
| uniswap-trader-mcp | 멀티체인 토큰 스왑 자동화 | kukapay/uniswap-trader-mcp |
| mcpsol | 솔라나 블록체인 AI 연동 | MCPxLabs/mcpsol |

### 4-3. 시장 데이터 (대체 소스)

| MCP 서버 | 설명 | 링크 |
|----------|------|------|
| coinmarketcap-mcp | CoinMarketCap API 연동 | shinzo-labs/coinmarketcap-mcp |
| mcp-crypto-price | CoinCap API 기반 실시간 분석 | truss44/mcp-crypto-price |
| binance-mcp | Binance Futures 모니터링 + 매매 | Todmy/binance-mcp |

### 4-4. 금융 일반

| MCP 서버 | 설명 | 링크 |
|----------|------|------|
| mcp-yahoo-finance | Yahoo Finance 데이터 조회 | leoncuhk/mcp-yahoo-finance |
| financial-markets-analyser | 주식+크립토 멀티소스 분석 | DuneRaccoon/financial-markets-analyser |

---

## 5. 참고 링크

- [CCXT MCP Server (GitHub)](https://github.com/lazy-dinosaur/ccxt-mcp)
- [CoinGecko MCP 공식 문서](https://docs.coingecko.com/reference/mcp-server)
- [Crypto.com MCP 공식 문서](https://mcp.crypto.com/docs/getting-started)
- [Crypto.com MCP Claude 설정](https://mcp.crypto.com/docs/claude)
- [Awesome MCP Servers - Finance/Crypto](https://github.com/TensorBlock/awesome-mcp-servers/blob/main/docs/finance--crypto.md)
- [Crypto Trading MCP (GitHub)](https://github.com/vkdnjznd/crypto-trading-mcp)
- [MCP 공식 사이트](https://modelcontextprotocol.io/)

---

> **Note**: 이 문서는 2026-02-12 기준으로 작성되었습니다. MCP 생태계는 빠르게 변화하므로 설치 전 각 프로젝트의 최신 README를 확인하세요.
