# Round 4 Proposal — Tier 2 Quality (12건)

> **Agent**: Senior Systems Engineer
> **Date**: 2026-02-15
> **Base commit**: 2f0b719 (Sprint R3: Tier 1 Reliability 11건 완료)
> **Scope**: T2-1 ~ T2-12 중 시스템 무결성 관점 분석

---

## 분석 요약

Round 3에서 Tier 1 Reliability 11건을 완료한 후, Tier 2 Quality 12건을 분석했다.
내가 직접 제안한 T2-7(API rate limiting)과 T2-9(CircuitBreaker rapidLosses 배열 크기 제한)을 최우선 분석하고,
T2-1~T2-5의 시스템 안정성/성능 관점 리뷰, T2-6/T2-8/T2-10/T2-11/T2-12 프론트엔드 항목의 시스템 영향도 평가를 수행했다.

**핵심 발견**:
1. **T2-9 (rapidLosses 배열)**: 배열이 무제한 성장하여 장기 운영 시 메모리 누수 발생. `recordTrade()` 호출 시 filter만 하고 원본 배열에서 삭제하지 않으므로, 모든 손실 타임스탬프가 영구 보관됨. **즉시 수정 필요**.
2. **T2-7 (API rate limiting)**: 현재 모든 엔드포인트에 rate limit 없음. DDoS/brute-force에 완전 노출. 특히 `/api/bot/start`, `/api/trades/order`, `/api/bot/emergency-stop`은 실제 주문/리소스 소비를 유발하므로 위험도 높음.
3. **T2-1 (RSI Wilder smoothing)**: 현재 RSI가 SMA 기반(Cutler's RSI)으로 구현되어 있어 전통적 Wilder RSI와 결과가 다름. 의사결정 정확도에 영향.
4. **T2-5 (GridStrategy equity)**: `this.config.equity`가 항상 `'0'`으로 fallback하여 suggestedQty가 `'0'`이 됨. RiskEngine이 최종 qty를 설정하지만, 로그/디버깅 시 혼란 유발.
5. **T2-4 (FundingRate 데이터 소스)**: 현재 fundingRate/OI가 ticker에 포함될 때만 수신 가능한데, Bitget Public WS에서 fundingRate는 별도 topic. 실질적으로 라이브에서 시그널이 거의 생성되지 않을 위험.

---

## 발견 사항 (코드 레벨 근거 포함)

---

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한 — **HIGH (메모리 누수)**

**파일**: `backend/src/services/circuitBreaker.js` (라인 42~91)

**현재 상태**: `rapidLosses` 배열은 `recordTrade()`에서 손실이 발생할 때마다 `Date.now()`를 push한다 (라인 60). 그러나 **기존 엔트리를 삭제하는 코드가 없다**.

```javascript
// circuitBreaker.js:56-91 — 현재 코드
recordTrade(trade) {
  if (isLessThan(trade.pnl, '0')) {
    this.consecutiveLosses += 1;
    this.rapidLosses.push(Date.now());   // ← 무조건 push, 삭제 없음

    // ...
    // Check 2: rapid loss cluster
    const windowMs = this.params.rapidLossWindow * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const recentLosses = this.rapidLosses.filter((ts) => ts >= cutoff);
    //                                    ^^^^^^ filter는 새 배열 반환, 원본 변경 없음

    if (recentLosses.length >= this.params.rapidLossThreshold) {
      this.trip(/* ... */);
    }
  } else {
    this.consecutiveLosses = 0;
    // ❌ rapidLosses는 리셋되지 않음 (승리해도 배열 유지)
  }
}
```

**문제 분석**:
- 라인 78: `this.rapidLosses.filter()` 는 필터링된 **새 배열**을 `recentLosses` 에 할당하지만, `this.rapidLosses` 원본은 그대로 유지
- 라인 87: 승리/손익분기점에서도 `this.rapidLosses`를 trim하지 않음
- `reset()` (라인 148-156)에서만 `this.rapidLosses = []`로 초기화
- 봇이 reset 없이 장기 운영되면 배열이 무한 성장

**영향 추정**:
- 1일 100건 손실 트레이드 가정 시, 1년 = 36,500개 타임스탬프 (약 292KB). 단독으로는 작지만:
  - 각 `recordTrade()` 호출마다 O(n) filter 비용 증가
  - GC pressure 누적 (매번 새 배열 생성)
  - 원칙적으로 unbounded growth는 프로덕션에서 zero tolerance

**해결 방안**:

```javascript
// circuitBreaker.js — recordTrade() 수정
recordTrade(trade) {
  if (isLessThan(trade.pnl, '0')) {
    this.consecutiveLosses += 1;
    const now = Date.now();
    this.rapidLosses.push(now);

    // ★ T2-9: 윈도우 밖의 오래된 항목 제거 (in-place trim)
    const windowMs = this.params.rapidLossWindow * 60 * 1000;
    const cutoff = now - windowMs;

    // splice로 오래된 항목 제거 (배열은 시간순 정렬이므로 앞에서부터)
    while (this.rapidLosses.length > 0 && this.rapidLosses[0] < cutoff) {
      this.rapidLosses.shift();
    }

    // 추가 안전장치: 절대 최대 크기 (500개)
    const MAX_RAPID_LOSSES = 500;
    if (this.rapidLosses.length > MAX_RAPID_LOSSES) {
      this.rapidLosses = this.rapidLosses.slice(-MAX_RAPID_LOSSES);
    }

    // Check 1: consecutive loss limit
    if (this.consecutiveLosses >= this.params.consecutiveLossLimit) {
      this.trip(/* ... */);
      return;
    }

    // Check 2: rapid loss cluster — now uses this.rapidLosses directly
    if (this.rapidLosses.length >= this.params.rapidLossThreshold) {
      this.trip(/* ... */);
    }
  } else {
    this.consecutiveLosses = 0;
  }
}
```

**구현 난이도**: Low (10줄 이내 수정)
**테스트**: `rapidLosses.length`가 `MAX_RAPID_LOSSES`를 초과하지 않는지, window 외 항목이 제거되는지 확인
**위험도**: None — 기존 동작 완전 보존, 성능만 개선

---

### T2-7: API Rate Limiting — **HIGH (보안)**

**파일**: `backend/src/app.js` (라인 216-246)

**현재 상태**: `app.use(express.json())`과 CORS 미들웨어만 존재. rate limiting 미들웨어 없음.

```javascript
// app.js:216-228 — 현재 미들웨어 스택
app.use(express.json());

// CORS middleware (no external cors package)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  // ...
  next();
});

// 라우트 마운트 (rate limit 없이 직접 노출)
app.use('/api/bot', createBotRoutes({ botService, riskEngine }));
app.use('/api/trades', createTradeRoutes({ traderService, positionManager: activePositionManager }));
// ... (모든 라우트 무방비)
```

**위험도 분석 (엔드포인트별)**:

| 엔드포인트 | 위험도 | 이유 |
|---|---|---|
| `POST /api/bot/start` | **Critical** | 봇 시작 = WS 연결 + 코인 스캔 + 전략 초기화. 반복 호출 시 리소스 소진 |
| `POST /api/bot/emergency-stop` | **Critical** | 무한 호출 시 세션 데이터 경합 |
| `POST /api/trades/order` | **Critical** | 실제 주문 제출 = 실제 자금 소비 |
| `DELETE /api/trades/order/:id` | **High** | 주문 취소 API 남용 |
| `PUT /api/bot/risk-params` | **High** | 리스크 파라미터 변경은 안전 제어 무력화 가능 |
| `POST /api/backtest/run` | **High** | CPU 집약적 작업 — 동시 다수 실행 시 서버 과부하 |
| `GET /api/bot/status` | **Medium** | 프론트엔드 5초 폴링이지만, 외부 공격 시 DB 부하 |
| `GET /api/trades/*` | **Medium** | DB 쿼리 부하 |
| `GET /api/health/*` | **Low** | 경량 응답 |

**해결 방안**:

```javascript
// backend/src/middleware/rateLimiter.js (신규 파일)
'use strict';

const { createLogger } = require('../utils/logger');
const log = createLogger('RateLimiter');

/**
 * In-memory sliding-window rate limiter.
 * 외부 의존성(Redis, express-rate-limit) 없이 순수 Node.js 구현.
 *
 * AD-18 (신규 결정): 단일 인스턴스 배포이므로 in-memory 충분.
 * 클러스터링 시 Redis 기반으로 전환 필요.
 */

/** @type {Map<string, { timestamps: number[], blocked: boolean }>} */
const _store = new Map();

// 1분마다 만료된 엔트리 정리
const CLEANUP_INTERVAL = 60_000;
let _cleanupTimer = null;

function startCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _store) {
      // 가장 최근 요청이 windowMs*2 이전이면 삭제
      if (entry.timestamps.length === 0 ||
          entry.timestamps[entry.timestamps.length - 1] < now - 120_000) {
        _store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  _cleanupTimer.unref();  // 프로세스 종료를 막지 않음
}

function stopCleanup() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

/**
 * Rate limiter 미들웨어 팩토리.
 *
 * @param {object} opts
 * @param {number} opts.windowMs — 윈도우 크기 (ms)
 * @param {number} opts.max — 윈도우 내 최대 요청 수
 * @param {string} [opts.keyPrefix='global'] — 키 접두사 (라우트 그룹별 분리)
 * @param {string} [opts.message] — 429 응답 메시지
 * @returns {Function} Express 미들웨어
 */
function createRateLimiter({
  windowMs = 60_000,
  max = 100,
  keyPrefix = 'global',
  message = '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
} = {}) {
  startCleanup();

  return (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${clientIp}`;
    const now = Date.now();

    let entry = _store.get(key);
    if (!entry) {
      entry = { timestamps: [], blocked: false };
      _store.set(key, entry);
    }

    // 윈도우 밖 타임스탬프 제거
    const cutoff = now - windowMs;
    while (entry.timestamps.length > 0 && entry.timestamps[0] <= cutoff) {
      entry.timestamps.shift();
    }

    if (entry.timestamps.length >= max) {
      log.warn('Rate limit exceeded', { key, count: entry.timestamps.length, max });
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    entry.timestamps.push(now);
    next();
  };
}

module.exports = { createRateLimiter, stopCleanup };
```

**app.js 적용 방안** (3 tier):

```javascript
// app.js — rate limiter 적용
const { createRateLimiter } = require('./middleware/rateLimiter');

// Tier 1: Critical (주문/봇 제어) — 분당 10회
const criticalLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  keyPrefix: 'critical',
  message: '봇 제어/주문 API는 분당 10회로 제한됩니다.',
});

// Tier 2: Standard (데이터 조회) — 분당 60회
const standardLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyPrefix: 'standard',
  message: '데이터 조회 API는 분당 60회로 제한됩니다.',
});

// Tier 3: Heavy (백테스트 실행) — 분당 3회
const heavyLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 3,
  keyPrefix: 'heavy',
  message: '백테스트 실행은 분당 3회로 제한됩니다.',
});

// 적용
app.use('/api/bot/start', criticalLimiter);
app.use('/api/bot/stop', criticalLimiter);
app.use('/api/bot/emergency-stop', criticalLimiter);
app.use('/api/bot/risk-params', criticalLimiter);
app.use('/api/trades/order', criticalLimiter);

app.use('/api/bot/status', standardLimiter);
app.use('/api/trades', standardLimiter);
app.use('/api/analytics', standardLimiter);
app.use('/api/risk', standardLimiter);

app.use('/api/backtest/run', heavyLimiter);
```

**구현 난이도**: Medium (신규 파일 1개 + app.js 미들웨어 적용)
**외부 의존성**: 없음 (express-rate-limit 불필요 — in-memory로 충분)
**위험도**: Low — 기존 기능에 영향 없음, 429 응답만 추가
**주의**: `stopCleanup()`을 graceful shutdown 시 호출해야 타이머 누수 방지

---

### T2-1: RSI Wilder Smoothing — **MEDIUM (정확도)**

**파일**: `backend/src/utils/indicators.js` (라인 130-155)

**현재 상태**: RSI가 "Cutler's RSI" (SMA 기반) 방식으로 구현되어 있다.

```javascript
// indicators.js:130-155 — 현재 RSI 구현
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;

  const startIdx = prices.length - period - 1;
  let sumGain = '0';
  let sumLoss = '0';

  for (let i = startIdx; i < prices.length - 1; i++) {
    const diff = subtract(prices[i + 1], prices[i]);
    if (isGreaterThan(diff, '0')) {
      sumGain = add(sumGain, diff);
    } else if (isLessThan(diff, '0')) {
      sumLoss = add(sumLoss, abs(diff));
    }
  }

  const avgGain = divide(sumGain, String(period));    // ← SMA 기반
  const avgLoss = divide(sumLoss, String(period));    // ← SMA 기반
  // ...
}
```

**문제 분석**:
1. **SMA 기반(Cutler's RSI)**: 최근 `period`개 가격 변동만 보고 단순 평균. 과거 데이터의 지수적 감쇠가 없음
2. **Wilder's RSI**: 첫 `period`개로 시드(SMA), 이후 `avgGain = (prevAvgGain * (period-1) + currentGain) / period` 재귀 적용
3. **영향**: RSI 값이 동일 데이터에서 다르게 나옴 — 전략(RsiPivotStrategy 등)의 overbought/oversold 판단이 달라짐
4. **주의**: 현재 `rsi()` 함수는 **마지막 period+1개 가격만 사용**하므로 Wilder smoothing을 완전히 적용하려면 전체 가격 이력이 필요

**해결 방안**:

```javascript
/**
 * Wilder RSI (full-history version).
 * 첫 period개로 SMA 시드, 이후 Wilder smoothing 적용.
 *
 * @param {string[]} prices — 전체 가격 이력 (최소 period + 1개)
 * @param {number}   period — default 14
 * @param {boolean}  [wilder=true] — true: Wilder smoothing, false: Cutler's (기존 호환)
 * @returns {string|null} RSI (0-100)
 */
function rsi(prices, period = 14, wilder = true) {
  if (prices.length < period + 1) return null;

  if (!wilder) {
    // 기존 Cutler's RSI (하위 호환)
    return _rsiCutler(prices, period);
  }

  // --- Wilder's RSI ---
  // 1. 첫 period개 변동의 SMA로 시드
  let avgGain = '0';
  let avgLoss = '0';

  for (let i = 0; i < period; i++) {
    const diff = subtract(prices[i + 1], prices[i]);
    if (isGreaterThan(diff, '0')) {
      avgGain = add(avgGain, diff);
    } else if (isLessThan(diff, '0')) {
      avgLoss = add(avgLoss, abs(diff));
    }
  }

  avgGain = divide(avgGain, String(period));
  avgLoss = divide(avgLoss, String(period));

  // 2. Wilder smoothing: avg = (prev * (period-1) + current) / period
  const pMinus1 = String(period - 1);
  const pStr = String(period);

  for (let i = period + 1; i < prices.length; i++) {
    const diff = subtract(prices[i], prices[i - 1]);
    let currentGain = '0';
    let currentLoss = '0';

    if (isGreaterThan(diff, '0')) {
      currentGain = diff;
    } else if (isLessThan(diff, '0')) {
      currentLoss = abs(diff);
    }

    avgGain = divide(add(multiply(avgGain, pMinus1), currentGain), pStr);
    avgLoss = divide(add(multiply(avgLoss, pMinus1), currentLoss), pStr);
  }

  if (!isGreaterThan(avgLoss, '0')) return '100';
  if (!isGreaterThan(avgGain, '0')) return '0';

  const rs = divide(avgGain, avgLoss);
  const rsiVal = subtract('100', divide('100', add('1', rs)));
  return toFixed(rsiVal, 4);
}
```

**구현 난이도**: Medium (기존 함수 시그니처 변경 — `wilder` 파라미터 추가로 하위 호환 유지)
**영향 범위**: `indicatorCache.js`의 `computeIndicator()` case 'rsi' 호출부, 모든 RSI 사용 전략
**위험**: 백테스트 결과가 달라질 수 있으므로 기존 결과와 비교 검증 필요

---

### T2-2: Confidence-Based Signal Filtering — **MEDIUM (품질)**

**파일**: `backend/src/services/signalFilter.js` (라인 113-153)

**현재 상태**: `filter()` 메서드는 cooldown, duplicate, max concurrent, symbol conflict만 검사. **confidence 기반 필터링 없음**.

```javascript
// signalFilter.js:113-153 — 현재 필터 파이프라인
filter(signal) {
  this._stats.total++;
  const { strategy, symbol, action } = signal;
  const now = Date.now();
  this._cleanup(now);

  // Filter 1: Cooldown
  // Filter 2: Duplicate detection
  // Filter 3: Max concurrent positions
  // Filter 4: Same-symbol conflict
  // ❌ Filter 5: Confidence threshold — 없음
}
```

**문제 분석**:
- 전략들이 생성하는 시그널의 confidence 범위: 0.40 ~ 0.95 (전략마다 다름)
- 낮은 confidence 시그널도 무조건 통과 → 저확률 진입 → 승률 저하
- 전략별 최소 confidence 임계값을 설정할 수 있어야 함

**해결 방안**:

```javascript
// signalFilter.js — registerStrategy 확장
registerStrategy(name, meta = {}) {
  this._strategyMeta.set(name, {
    cooldownMs: meta.cooldownMs || DEFAULT_COOLDOWN_MS,
    maxConcurrentPositions: meta.maxConcurrentPositions || DEFAULT_MAX_CONCURRENT,
    minConfidence: meta.minConfidence || 0.50,  // ★ T2-2: 기본 50%
  });
}

// filter()에 5번째 체크 추가
_checkConfidence(strategy, confidence) {
  const meta = this._strategyMeta.get(strategy);
  const minConfidence = meta ? meta.minConfidence : 0.50;

  if (typeof confidence === 'number' && confidence < minConfidence) {
    return {
      passed: false,
      reason: `low_confidence: ${strategy} confidence ${(confidence * 100).toFixed(1)}% < threshold ${(minConfidence * 100).toFixed(1)}%`,
    };
  }
  return { passed: true, reason: null };
}
```

**전략별 권장 임계값**:

| 전략 | 현재 confidence 범위 | 권장 minConfidence |
|---|---|---|
| FundingRateStrategy | 0.50 ~ 0.95 | 0.55 |
| GridStrategy | 고정 0.70 | 0.60 |
| RsiPivotStrategy | 0.40 ~ 0.90 | 0.55 |
| CandlePatternStrategy | 0.50 ~ 0.85 | 0.55 |
| 기타 | 다양 | 0.50 (기본값) |

**구현 난이도**: Low (signalFilter.js에 1개 메서드 + filter()에 1개 체크 추가)
**주의**: `rejectReason`을 signal 객체에 포함해야 T2-8(프론트엔드 표시)과 연계됨

---

### T2-3: Backtest Default Position Size — **MEDIUM (정확도)**

**파일**: `backend/src/backtest/backtestEngine.js` (라인 37, 492)

**현재 상태**: 모든 전략에 대해 포지션 크기가 `DEFAULT_POSITION_SIZE_PCT = '95'` (95%) 고정.

```javascript
// backtestEngine.js:37
const DEFAULT_POSITION_SIZE_PCT = '95';

// backtestEngine.js:492 — 사용처
const positionValue = math.multiply(this._cash, math.divide(DEFAULT_POSITION_SIZE_PCT, '100'));
```

**문제 분석**:
- FundingRateStrategy는 `positionSizePercent: '5'`, GridStrategy는 `totalBudgetPercent: '20'`
- 백테스트에서 95% all-in은 실제 트레이딩과 완전히 다른 리스크 프로필
- 백테스트 결과가 실제 성과를 예측하지 못함

**해결 방안**:

```javascript
// backtestEngine.js — _createStrategy() 후 positionSizePct 결정
_getPositionSizePercent() {
  const metadata = registry.getMetadata(this.strategyName);
  if (!metadata) return DEFAULT_POSITION_SIZE_PCT;

  const config = metadata.defaultConfig || {};

  // 전략 메타데이터에서 포지션 크기 추출 (우선순위 순)
  if (config.positionSizePercent) return config.positionSizePercent;
  if (config.totalBudgetPercent) return config.totalBudgetPercent;

  // Fallback: 전략 riskLevel 기반
  switch (metadata.riskLevel) {
    case 'low':    return '10';
    case 'medium': return '15';
    case 'high':   return '25';
    default:       return DEFAULT_POSITION_SIZE_PCT;
  }
}
```

**구현 난이도**: Low (함수 1개 추가 + 4곳 호출 변경)
**위험**: 기존 백테스트 결과와 다른 수치 나옴 — 의도된 변경

---

### T2-4: FundingRateStrategy 데이터 소스 구축 — **HIGH (기능성)**

**파일**: `backend/src/strategies/indicator-light/fundingRateStrategy.js` (라인 125-167)

**현재 상태**: `onTick()`에서 `ticker.fundingRate`와 `ticker.openInterest`를 수신 대기. 그러나:

```javascript
// fundingRateStrategy.js:134-149
if (ticker.fundingRate !== undefined && ticker.fundingRate !== null) {
  this._fundingRateHistory.push({
    rate: String(ticker.fundingRate),
    timestamp: new Date(),
  });
  // ...
}
```

**문제 분석**:
1. Bitget Public WS `ticker` topic은 `fundingRate` 필드를 **포함하지 않음**
2. 펀딩비는 별도 REST API (`/api/v2/mix/market/current-fund-rate`)로 조회해야 함
3. OI도 별도 엔드포인트 (`/api/v2/mix/market/open-interest`)
4. 현재 구조에서는 **이 전략이 라이브에서 시그널을 생성할 수 없음**

**해결 방안**: `exchangeClient.js`에 펀딩비/OI REST 폴링 메서드 추가, `botService`에서 주기적으로 호출하여 전략에 피드.

```javascript
// exchangeClient.js에 추가
async getFundingRate(symbol) {
  return this._requestWithRetry('GET', '/api/v2/mix/market/current-fund-rate', {
    productType: 'USDT-FUTURES',
    symbol,
  });
}

async getOpenInterest(symbol) {
  return this._requestWithRetry('GET', '/api/v2/mix/market/open-interest', {
    productType: 'USDT-FUTURES',
    symbol,
  });
}

// botService.js — 주기적 폴링 (8시간 주기이므로 5분 간격 충분)
_startFundingPoll() {
  this._fundingPollTimer = setInterval(async () => {
    for (const symbol of this._activeSymbols) {
      try {
        const funding = await this.exchangeClient.getFundingRate(symbol);
        const oi = await this.exchangeClient.getOpenInterest(symbol);

        // 전략에 synthetic ticker 형태로 피드
        const syntheticTicker = {
          symbol,
          lastPrice: this.tickerAggregator.getLatestPrice(symbol),
          fundingRate: funding.fundingRate,
          openInterest: oi.amount,
        };

        for (const strategy of this.strategies) {
          if (strategy.name === 'FundingRateStrategy') {
            strategy.onTick(syntheticTicker);
          }
        }
      } catch (err) {
        this._log.error('Funding rate poll error', { symbol, error: err.message });
      }
    }
  }, 5 * 60 * 1000);  // 5분 간격
  this._fundingPollTimer.unref();
}
```

**구현 난이도**: Medium-High (exchangeClient 2개 메서드 + botService 폴링 로직 + shutdown 시 타이머 정리)
**의존성**: Bitget REST API 호출 필요 — rate limit 주의 (Bitget API는 20req/s)
**위험**: API 호출 실패 시 전략 비활성화만 될 뿐 시스템 전체 영향 없음

---

### T2-5: GridStrategy Equity 주입 — **MEDIUM (기능성)**

**파일**: `backend/src/strategies/indicator-light/gridStrategy.js` (라인 508-521)

**현재 상태**: `_calculatePerLevelQty()`에서 `this.config.equity`를 참조하지만, 이 값은 설정되지 않는다.

```javascript
// gridStrategy.js:508-521
_calculatePerLevelQty(price) {
  const equity = this.config.equity || '0';   // ← 항상 '0'
  if (equity === '0' || !price || price === '0') {
    return '0';                                // ← 항상 '0' 반환
  }
  // ... (도달하지 않는 코드)
}
```

**문제 분석**:
- `StrategyBase.constructor()`에서 `this.config = { ...config }`로 설정하지만, `config`에 `equity`는 없음
- `botService`가 전략에 equity를 주입하는 경로가 없음
- suggestedQty가 `'0'`이면 RiskEngine/OrderManager가 무시하거나 자체 크기를 적용하지만, 로깅/디버깅에서 의미 없는 값이 됨

**해결 방안**: DI context 패턴 — `StrategyBase`에 `setContext()` 메서드 추가.

```javascript
// strategyBase.js에 추가
/**
 * Set runtime context (equity, account state, etc.).
 * Called periodically by BotService when account state changes.
 *
 * @param {object} ctx
 * @param {string} ctx.equity — current account equity
 */
setContext(ctx) {
  if (ctx.equity !== undefined) {
    this.config.equity = ctx.equity;
  }
}

// botService.js — positionManager의 accountState 변경 시
_onAccountStateUpdate(state) {
  for (const strategy of this.strategies) {
    strategy.setContext({ equity: state.equity });
  }
}
```

**구현 난이도**: Low (strategyBase 1개 메서드 + botService 연동)
**영향**: GridStrategy뿐 아니라 향후 다른 전략도 equity 참조 가능

---

### T2-6: useSocket 목적별 분리 — **LOW (프론트엔드 성능)**

**파일**: `frontend/src/hooks/useSocket.ts`

**현재 상태**: 단일 `useSocket()` 훅이 13개 이벤트를 모두 수신하고, 하나의 거대한 `SocketState` 객체로 관리한다.

```typescript
// useSocket.ts — 13개 이벤트 핸들러
socket.on(SOCKET_EVENTS.SIGNAL_GENERATED, handleSignalGenerated);
socket.on(SOCKET_EVENTS.POSITION_UPDATED, handlePositionUpdated);
socket.on(SOCKET_EVENTS.REGIME_CHANGE, handleRegimeChange);
socket.on(SOCKET_EVENTS.SYMBOL_REGIME_UPDATE, handleSymbolRegimeUpdate);
socket.on(SOCKET_EVENTS.TICKER, handleTicker);
socket.on(SOCKET_EVENTS.CIRCUIT_BREAK, handleCircuitBreak);
socket.on(SOCKET_EVENTS.DRAWDOWN_WARNING, handleDrawdownWarning);
socket.on(SOCKET_EVENTS.DRAWDOWN_HALT, handleDrawdownHalt);
socket.on(SOCKET_EVENTS.CIRCUIT_RESET, handleCircuitReset);
socket.on(SOCKET_EVENTS.EXPOSURE_ADJUSTED, handleExposureAdjusted);
socket.on(SOCKET_EVENTS.UNHANDLED_ERROR, handleUnhandledError);
```

**시스템 관점 분석**:
- **렌더링 문제**: ticker 이벤트가 초당 수십 회 발생 → `setState` 호출 → 전체 `SocketState` 재생성 → 모든 소비 컴포넌트 리렌더링
- **메모리**: lastTicker Map이 모든 구독 심볼에 대해 계속 확장
- **분리 전략**:
  - `useTickerSocket()` — high-frequency ticker data (별도 상태로 격리)
  - `useSignalSocket()` — signal + position updates
  - `useRiskSocket()` — circuit break / drawdown / exposure events
  - `useRegimeSocket()` — regime change events (low frequency)

**구현 난이도**: Medium (훅 4개 분리 + 기존 `useSocket` 소비처 전체 변경)
**위험**: 기존 코드가 `useSocket()`의 반환값에 의존하므로 점진적 마이그레이션 필요
**권장**: 기존 `useSocket` 유지하되, 새 훅들은 점진적으로 추가. 기존 것은 deprecated 표시.

---

### T2-8: SignalFeed rejectReason 표시 — **LOW (UX)**

**파일**: `frontend/src/components/SignalFeed.tsx`

**현재 상태**: Signal 타입에 `rejectReason: string | null`이 있지만, 컴포넌트에서 표시하지 않는다.

```tsx
// SignalFeed.tsx:46-49
{signal.riskApproved !== null && (
  <Badge variant={signal.riskApproved ? 'success' : 'danger'} dot>
    {signal.riskApproved ? '승인' : '거부'}
  </Badge>
)}
// ❌ rejectReason 미표시
```

**해결 방안**: 거부 시 rejectReason을 툴팁이나 부가 텍스트로 표시.

```tsx
{signal.riskApproved === false && signal.rejectReason && (
  <span className="text-xs text-red-400 truncate max-w-[120px]" title={signal.rejectReason}>
    ({signal.rejectReason})
  </span>
)}
```

**시스템 관점 주의사항**:
- T2-2(confidence filtering) 구현 후 `rejectReason`에 `low_confidence` 등이 추가되므로, 이 두 항목은 함께 구현하는 것이 효율적
- `signal:blocked` Socket.io 이벤트의 payload에 `reason` 필드가 이미 포함되어 있으므로, 프론트엔드에서 수신 가능

**구현 난이도**: Low (컴포넌트 1개 수정)

---

### T2-10: Drawdown 시각화 차트 — **LOW (UX, 의존성: 백엔드 데이터 필요)**

**시스템 관점 분석**:
- DrawdownMonitor가 `updateEquity()` 호출 시 peak/current/daily 데이터를 내부에만 보관
- 시계열 히스토리가 없으므로 차트에 필요한 시간대별 drawdown 데이터를 프론트엔드에 전달할 수 없음
- **백엔드 전제조건**: DrawdownMonitor에 시계열 히스토리를 추가하거나, `/api/risk/status` 응답에 포함되는 `drawdownPercent`를 프론트엔드에서 수집하여 차트화

**권장**: 프론트엔드에서 `/api/risk/status` 폴링 결과의 drawdownPercent를 로컬 배열에 누적하여 차트화 (최대 100개 포인트). 백엔드 변경 불필요.

**구현 난이도**: Medium (신규 컴포넌트 + 로컬 히스토리 관리)

---

### T2-11: Risk Gauge 대시보드 — **LOW (UX)**

**시스템 관점 분석**:
- 필요한 데이터는 이미 `/api/risk/status`에서 제공:
  - `circuitBreaker.isTripped`, `consecutiveLosses`, `params.consecutiveLossLimit`
  - `drawdownMonitor.drawdownPercent`, `params.maxDrawdownPercent`
  - `exposureGuard.totalExposure`, `params.maxTotalExposurePercent`
- 게이지 컴포넌트는 순수 프론트엔드 작업
- **안전성 주의**: 게이지가 "안전" 표시를 할 때 사용자가 과신하지 않도록, 최대값 대비 현재 비율을 정확히 표시해야 함

**구현 난이도**: Medium (신규 컴포넌트 1개)

---

### T2-12: 적응형 폴링 — **LOW (성능 최적화)**

**파일**: `frontend/src/hooks/useBotStatus.ts`

**현재 상태**: `pollInterval`이 고정 5000ms (5초). 봇 상태와 무관하게 항상 동일 빈도로 폴링.

```typescript
// useBotStatus.ts:22
export function useBotStatus(pollInterval = 5000) {
```

**시스템 관점 분석**:
- 봇 `idle` 상태에서 5초 폴링은 과도 — 30초면 충분
- 봇 `running` 상태에서 5초는 적절하지만, `paused`에서는 10초 가능
- 에러 상태에서는 더 빈번한 확인(3초)이 유용할 수 있음

**해결 방안**:

```typescript
function getAdaptiveInterval(status: BotState): number {
  switch (status) {
    case 'running': return 5000;
    case 'paused':  return 10000;
    case 'error':   return 3000;
    case 'idle':
    default:        return 30000;
  }
}

export function useBotStatus() {
  const [status, setStatus] = useState<BotStatus>(DEFAULT_STATUS);
  const [pollInterval, setPollInterval] = useState(5000);

  // 상태 변경 시 폴링 간격 조정
  useEffect(() => {
    setPollInterval(getAdaptiveInterval(status.status));
  }, [status.status]);

  // ...
}
```

**구현 난이도**: Low (훅 1개 내부 수정)
**효과**: idle 상태에서 API 호출 6배 감소 (5초 → 30초)

---

## 제안 사항

### 우선순위 및 구현 순서

| 순서 | 항목 | 난이도 | 이유 |
|------|------|--------|------|
| 1 | **T2-9** (rapidLosses 크기 제한) | Low | 메모리 누수 — 즉시 수정. 10줄 이내 |
| 2 | **T2-7** (API rate limiting) | Medium | 보안 취약점 — 외부 노출 전 필수 |
| 3 | **T2-1** (RSI Wilder smoothing) | Medium | 트레이딩 정확도에 직접 영향 |
| 4 | **T2-2** (Confidence filtering) | Low | T2-8과 함께 구현 효율적 |
| 5 | **T2-5** (GridStrategy equity) | Low | T2-2와 함께 구현 가능 |
| 6 | **T2-3** (Backtest position size) | Low | 백테스트 정확도 개선 |
| 7 | **T2-4** (FundingRate 데이터 소스) | Medium-High | 가장 복잡하지만 전략 활성화에 필수 |
| 8 | **T2-8** (rejectReason 표시) | Low | T2-2 완료 후 진행 |
| 9 | **T2-12** (적응형 폴링) | Low | 빠른 성능 개선 |
| 10 | **T2-6** (useSocket 분리) | Medium | 가장 영향 범위 넓지만 점진적 적용 가능 |
| 11 | **T2-11** (Risk Gauge) | Medium | 신규 UI 컴포넌트 |
| 12 | **T2-10** (Drawdown 차트) | Medium | 신규 UI 컴포넌트 |

### 아키텍처 결정 제안

**AD-18: API Rate Limiting — In-Memory Sliding Window**
- 단일 인스턴스 배포이므로 외부 store(Redis) 불필요
- 3 tier 체계: Critical(10/min), Standard(60/min), Heavy(3/min)
- cleanup 타이머를 graceful shutdown에서 정리

**AD-19: RSI 구현 — Wilder Smoothing 기본값**
- 새로운 `wilder` 파라미터 기본값 true
- 기존 Cutler's RSI도 `wilder: false`로 사용 가능 (하위 호환)

**AD-20: Strategy Context Injection**
- `StrategyBase.setContext({ equity })` 패턴으로 런타임 데이터 주입
- `config` 객체에 직접 쓰기 대신 별도 `_context` 필드를 사용하는 것도 고려

---

## 다른 에이전트에게 요청 사항

### Trader Agent (전략 전문가)에게:

1. **T2-1 (RSI Wilder)**: Wilder RSI 전환 후 각 전략의 overbought/oversold 임계값 재조정이 필요한지 검증. 특히 RsiPivotStrategy의 `buyThreshold`/`sellThreshold` 기본값이 Wilder 기준으로 적절한지 확인
2. **T2-2 (Confidence filtering)**: 전략별 `minConfidence` 권장값 검증. 내 제안값(0.50~0.60)이 전략 특성에 맞는지 트레이딩 관점에서 평가
3. **T2-3 (Backtest position size)**: riskLevel별 fallback 비율(`low: 10%, medium: 15%, high: 25%`)이 현실적인지 검증
4. **T2-4 (FundingRate)**: REST polling 주기(5분)가 8시간 정산 주기 대비 적절한지, 그리고 시그널 생성 조건의 fundingRate 임계값(-0.01, +0.03)이 Bitget 실제 데이터 범위에서 현실적인지 확인

### UI Agent (프론트엔드 전문가)에게:

1. **T2-6 (useSocket 분리)**: 현재 `useSocket()` 소비처가 몇 개인지, 분리 시 마이그레이션 계획 수립. 특히 ticker 이벤트의 높은 빈도가 렌더링에 미치는 실제 영향 프로파일링
2. **T2-8 (rejectReason)**: `signal:blocked` 이벤트의 reason 필드를 한국어로 번역할 헬퍼가 `lib/utils.ts`에 필요한지 확인
3. **T2-10 (Drawdown 차트)**: Recharts 기반 drawdown 차트 컴포넌트 설계. 데이터 소스를 `/api/risk/status` 폴링 결과의 프론트엔드 축적으로 할지, 백엔드에 시계열 엔드포인트를 추가할지 결정 필요
4. **T2-11 (Risk Gauge)**: 게이지 컴포넌트 디자인 — circular gauge, bar gauge 등 형태 결정. 3개 지표(circuit breaker, drawdown, exposure)를 어떤 레이아웃으로 배치할지
5. **T2-12 (적응형 폴링)**: 내 제안(idle: 30s, running: 5s, paused: 10s, error: 3s) 외에 `usePositions`, `useTrades` 등 다른 훅에도 적응형 폴링 적용 여부 결정

---

## 부록: 파일별 변경 요약

| 파일 | T2 항목 | 변경 유형 |
|------|---------|-----------|
| `backend/src/services/circuitBreaker.js` | T2-9 | 수정 (recordTrade) |
| `backend/src/middleware/rateLimiter.js` | T2-7 | **신규** |
| `backend/src/app.js` | T2-7 | 수정 (미들웨어 추가) |
| `backend/src/utils/indicators.js` | T2-1 | 수정 (rsi 함수) |
| `backend/src/services/signalFilter.js` | T2-2 | 수정 (filter, registerStrategy) |
| `backend/src/backtest/backtestEngine.js` | T2-3 | 수정 (position size) |
| `backend/src/services/exchangeClient.js` | T2-4 | 수정 (2개 메서드 추가) |
| `backend/src/services/botService.js` | T2-4, T2-5 | 수정 (폴링 + context 주입) |
| `backend/src/services/strategyBase.js` | T2-5 | 수정 (setContext 추가) |
| `frontend/src/hooks/useSocket.ts` | T2-6 | 수정/분리 |
| `frontend/src/components/SignalFeed.tsx` | T2-8 | 수정 |
| `frontend/src/components/DrawdownChart.tsx` | T2-10 | **신규** |
| `frontend/src/components/RiskGauge.tsx` | T2-11 | **신규** |
| `frontend/src/hooks/useBotStatus.ts` | T2-12 | 수정 |
