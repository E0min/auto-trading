# Round 13 Proposal: 전략 모듈화 + 상세 파라미터 튜닝 + UX

**Author**: Senior Systems Engineer
**Date**: 2026-02-17
**Scope**: 시스템 무결성, 런타임 안전성, API 설계, 모듈 분리
**Priority**: Critical — 사용자가 자금을 운용하는 시스템의 투명성/제어성 직결

---

## 분석 요약

현재 시스템은 12라운드에 걸쳐 안정성, 리스크 관리, 관측성이 잘 구축되어 있다. 그러나 **전략이 "어떻게" 동작하는지** 사용자에게 전달하는 메커니즘이 불완전하며, **런타임 파라미터 변경의 안전성**에 구조적 취약점이 존재한다. 핵심 문제는 다음 5가지로 요약된다:

1. **전략 description이 1줄 텍스트** — 분봉, 진입 조건, 손절 로직, 레버리지, 자금관리 등의 설명이 전무
2. **updateConfig()가 원자성 없이 Object.assign** — 런타임 레이스 컨디션 위험
3. **customStrategyStore의 동기 파일 I/O** — writeFileSync가 이벤트 루프 차단
4. **모듈 간 결합도** — BotService가 15개 이상 의존성을 관리하는 God Object 경향
5. **API 입력 검증 부재** — PUT /strategies/:name/config에 범위/타입 검증 없음

---

## 발견 사항

### F-1: 전략 설명 메타데이터 부재 (심각도: HIGH)

**파일**: `backend/src/strategies/**/*.js` (전체 18+2 전략)

각 전략의 `static metadata`에 `description` 필드가 존재하지만, 1줄 요약에 불과하다:

```js
// RsiPivotStrategy (line 50)
description: 'RSI + Pivot 역추세 (양방향)',

// TurtleBreakoutStrategy (line 70)
description: '터틀 트레이딩 — Donchian 채널 돌파 + ATR 기반 2% 리스크 룰',

// AdaptiveRegimeStrategy (line 51)
description: '장세 적응형 멀티전략 — 시장 국면에 따라 자동으로 매매 모드 전환',
```

사용자에게 필요한 정보:
- **시간 프레임**: 몇 분봉을 사용하는지 (현재 모든 전략이 kline 이벤트를 받지만, MarketData의 구독 주기가 어떤 분봉인지 전략에서 명시하지 않음)
- **진입 조건**: 구체적 조건 (예: "RSI가 30 이하 + 가격이 Pivot S1 아래")
- **청산 조건**: TP/SL/트레일링/지표 기반 청산 방법
- **레버리지**: defaultConfig에 있지만 metadata에서 문서화되지 않음
- **포지션 크기**: 자기 자본 대비 비율
- **리스크 관리**: 전략 레벨의 리스크 (최대 동시 포지션, 쿨다운, 최대 손절 등)

**근거 코드** (RsiPivotStrategy):
```js
// line 256-283: Long entry 조건
// regime === TRENDING_DOWN | VOLATILE | RANGING
// belowS1 = price <= pivotData.s1
// rsiOversoldMet = rsi <= 30
// → OPEN_LONG

// line 377-437: _checkExitOnTick
// TP: price >= entry * (1 + tpPercent/100)
// SL: price <= entry * (1 - slPercent/100)
```

이 정보가 사용자에게 전달되지 않는다.

### F-2: updateConfig() 원자성 부재 (심각도: CRITICAL)

**파일**: `backend/src/services/strategyBase.js` (line 732-740)

```js
updateConfig(newConfig) {
  if (!newConfig || typeof newConfig !== 'object') {
    this._log.warn('updateConfig called with invalid argument', { newConfig });
    return;
  }
  Object.assign(this.config, newConfig);
  this._log.info('Configuration updated', { config: this.config });
}
```

**문제점**:

1. **타입/범위 검증 없음**: `positionSizePercent: '999'`나 `leverage: 100`이 그대로 적용됨
2. **레이스 컨디션**: `onKline()`이 `this.config.slPercent`를 읽는 도중 HTTP 요청으로 `updateConfig()`가 호출되면, 한 kline 처리 사이클 내에서 이전 값과 새 값이 혼재할 수 있음. Node.js는 싱글스레드이므로 `onKline` 실행 중에는 다른 코드가 끼어들지 않지만, `Object.assign`이 부분 적용 상태를 남길 수 있음
3. **롤백 불가**: 잘못된 값이 적용되면 되돌릴 방법이 없음
4. **이벤트 미발행**: config 변경 시 다른 서비스(SignalFilter, StrategyRouter)에 알리지 않음

**API 엔드포인트 검증 상태** (`botRoutes.js` line 232-255):
```js
router.put('/strategies/:name/config', (req, res) => {
  const newConfig = req.body;
  // 유일한 검증: typeof object 체크
  if (!newConfig || typeof newConfig !== 'object') { ... }
  strategy.updateConfig(newConfig);
  // 끝 — 범위/타입 검증 전무
});
```

`strategyParamMeta.js`에 min/max/type 정보가 이미 있지만 **서버측 검증에 전혀 사용되지 않음**.

### F-3: CustomStrategyStore의 동기 파일 I/O (심각도: MEDIUM)

**파일**: `backend/src/services/customStrategyStore.js` (line 137-147)

```js
_persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const arr = Array.from(this._strategies.values());
    fs.writeFileSync(FILE_PATH, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    log.error('Failed to persist custom strategies file', { error: err.message });
  }
}
```

**문제점**:

1. **`writeFileSync`가 이벤트 루프 차단** — 전략이 20개이고 JSON이 크면 수 ms 동안 모든 ticker/kline 처리가 멈춤
2. **원자성 부재** — 쓰기 도중 프로세스가 죽으면 파일이 손상됨. 표준 패턴은 임시 파일에 쓴 후 `rename()`
3. **동시 쓰기 보호 없음** — 두 HTTP 요청이 동시에 `save()`를 호출하면 후자가 전자를 덮어씀
4. **에러가 조용히 무시됨** — `catch` 블록이 로그만 남기고 호출자에게 전파하지 않음

### F-4: BotService God Object 패턴 (심각도: MEDIUM)

**파일**: `backend/src/services/botService.js`

BotService 생성자가 **18개의 의존성**을 받고, `start()` 메서드가 **682줄** 중 400줄 이상을 차지한다. `_handleStrategySignal()`, `_resolveSignalQuantity()`, `_accumulateLiveFunding()`, `_performCoinReselection()` 등이 모두 한 클래스에 있다.

분리 가능한 책임 단위:
- **SignalPipeline**: signal → filter → quantity resolution → order submission
- **PositionSizeResolver**: equity 조회 → percentage 변환 → lot step 적용
- **CoinReselectionManager**: 주기적 코인 재선정 + 심볼 보호 로직
- **SnapshotService**: 주기적 스냅샷 생성

현재는 기능상 문제없이 동작하지만, 전략 모듈화 요건이 추가되면 BotService에 더 많은 코드가 쌓일 위험이 있다.

### F-5: 전략 상태 관리의 불일치 (심각도: LOW-MEDIUM)

**파일**: `botRoutes.js` GET /strategies (line 147-186)

```js
const allStrategies = registry.listWithMetadata();
const activeNames = botService.strategies.map((s) => s.name);

const strategies = allStrategies.map((meta) => ({
  name: meta.name,
  description: meta.description || '',
  defaultConfig: meta.defaultConfig || {},
  targetRegimes: meta.targetRegimes || [],
  riskLevel: meta.riskLevel || 'medium',
  active: activeNames.includes(meta.name),
  paramMeta: getParamMeta(meta.name) || [],
}));
```

**문제점**:
- `active` 상태만 전달 — grace period, warming up, inactive 등의 세분화된 상태 미포함
- `currentConfig` 미전달 — 사용자가 현재 실행 중인 설정값을 알 수 없음
- `warmupProgress` 미전달 — 전략이 아직 준비 중인지 알 수 없음
- StrategyRouter의 `getStatus()`에 이 정보가 있지만 GET /strategies에서는 사용 안 함

**`botService.getStatus()` (line 1082-1090)**은 strategies 배열에 상세 정보를 포함하지만, **GET /strategies**와 **GET /status**가 서로 다른 구조로 동일 데이터를 반환하여 프론트엔드가 두 API를 모두 호출해야 함.

### F-6: 프론트엔드 전략 설명 UI 부재 (심각도: HIGH)

**파일**: `frontend/src/components/strategy/StrategyCard.tsx`

현재 카드에 표시되는 정보:
- 전략 이름 (영문)
- 한국어 번역 이름 (translateStrategyName)
- 카테고리 (price-action/indicator-light/indicator-heavy)
- targetRegimes 태그
- riskLevel (Low/Med/High)
- active/inactive/grace 상태

**표시되지 않는 정보**:
- 시간 프레임 (몇 분봉)
- 진입/청산 조건 설명
- 현재 설정값 (positionSizePercent, leverage, TP%, SL%)
- 포지션 크기/레버리지의 시각적 표현
- 전략 동작 원리의 다이어그램/플로우

`StrategyDetail.tsx`는 포지션/거래/시그널 탭만 있고, **전략 설명 탭이 없음**.

### F-7: strategyParamMeta.js와 전략 metadata의 이중 관리 (심각도: LOW)

**파일**: `backend/src/services/strategyParamMeta.js`

`strategyParamMeta.js`의 PARAM_META 키 이름은 `TurtleBreakoutStrategy`지만, 전략 클래스의 `static metadata.name`도 `TurtleBreakoutStrategy`. 두 곳에서 파라미터 정보를 별도로 관리하고 있어 동기화 실패 위험이 있다.

예를 들어 `GridStrategy`의 metadata.defaultConfig에는 `gridSpacingMultiplier`가 있지만, 이것이 strategyParamMeta에도 있는지는 수동으로 확인해야 한다. 새 전략 추가 시 양쪽을 모두 업데이트해야 한다.

---

## 제안 사항

### P-1: 전략 상세 설명 메타데이터 체계 구축 (우선순위: 1, 난이도: MEDIUM, 예상: 4h)

각 전략의 `static metadata`에 구조화된 설명 객체를 추가한다.

```js
static metadata = {
  name: 'RsiPivotStrategy',
  // 기존 필드...

  // NEW: 구조화된 상세 설명
  docs: {
    summary: 'RSI + Pivot Point 기반 역추세 전략. 과매도/과매수 구간에서 반전을 포착합니다.',
    timeframe: '15분봉 (kline 이벤트 기반, 일봉 피봇 산출)',
    entry: {
      long: 'RSI <= 30 (과매도) + 가격 <= 전일 Pivot S1 레벨',
      short: 'RSI >= 70 (과매수) + 가격 >= 전일 Pivot R1 레벨',
    },
    exit: {
      takeProfit: '진입가 대비 +2% (설정 가능)',
      stopLoss: '진입가 대비 -2% (설정 가능)',
      indicator: 'RSI 반대 극단 도달 또는 Pivot 레벨 도달',
    },
    riskManagement: {
      defaultLeverage: 3,
      defaultPositionSize: '자기 자본의 5%',
      maxConcurrentPositions: 2,
      cooldown: '1분 (60초)',
    },
    bestFor: '횡보/변동성 시장에서 반전 포착. 강한 추세장에서는 비효율적.',
    warnings: [
      '강한 추세 시장에서 역추세 매매로 연속 손실 가능',
      '피봇 레벨 미산출 시 (데이터 부족) 진입하지 않음',
    ],
  },
};
```

**API 전달**: GET /api/bot/strategies 응답에 `docs` 필드 포함.

**설계 원칙**:
- 전략 파일 자체에 문서를 위치시켜 코드-문서 동기화 강제
- 구조화된 JSON으로 프론트엔드가 자동으로 UI 렌더링 가능
- 모든 18개 전략 + CustomRuleStrategy에 적용

### P-2: 안전한 런타임 Config 변경 메커니즘 (우선순위: 1, 난이도: HIGH, 예상: 3h)

#### P-2a: 서버측 파라미터 검증 (MUST)

`strategyParamMeta.js`의 min/max/type 정보를 활용하여 updateConfig 전에 검증한다.

```js
// services/strategyConfigValidator.js (신규)
function validateStrategyConfig(strategyName, newConfig, paramMeta) {
  const errors = [];

  for (const [key, value] of Object.entries(newConfig)) {
    const meta = paramMeta.find(m => m.field === key);
    if (!meta) {
      errors.push({ field: key, reason: 'unknown_field' });
      continue;
    }

    // 타입 검증
    if (meta.type === 'integer' && !Number.isInteger(value)) {
      errors.push({ field: key, reason: 'must_be_integer', value });
      continue;
    }

    // 범위 검증
    const numVal = parseFloat(String(value));
    if (meta.min !== undefined && numVal < meta.min) {
      errors.push({ field: key, reason: 'below_minimum', min: meta.min, value });
    }
    if (meta.max !== undefined && numVal > meta.max) {
      errors.push({ field: key, reason: 'above_maximum', max: meta.max, value });
    }
  }

  return { valid: errors.length === 0, errors };
}
```

#### P-2b: Snapshot + Atomic Replace (SHOULD)

updateConfig를 snapshot 기반 atomic replace로 변경한다:

```js
// strategyBase.js 개선
updateConfig(newConfig) {
  if (!newConfig || typeof newConfig !== 'object') {
    this._log.warn('updateConfig called with invalid argument');
    return { success: false, reason: 'invalid_argument' };
  }

  // 1. 스냅샷 생성 (롤백용)
  const snapshot = { ...this.config };

  // 2. 새 config 병합 (불변 객체 생성)
  const merged = { ...this.config, ...newConfig };

  // 3. 원자적 교체
  this.config = merged;

  // 4. 변경 이벤트 발행
  this.emit('config_updated', {
    strategy: this.name,
    previous: snapshot,
    current: merged,
    changedKeys: Object.keys(newConfig),
  });

  this._log.info('Configuration updated atomically', {
    changedKeys: Object.keys(newConfig),
  });

  return { success: true, config: merged };
}
```

**핵심**: `Object.assign`(in-place mutation) 대신 새 객체 생성 + 참조 교체. Node.js 싱글스레드 특성상 `this.config = merged`는 원자적으로 동작하며, onKline 실행 중에는 HTTP 핸들러가 끼어들지 않으므로 실질적 레이스 컨디션은 발생하지 않지만, 객체 불변성을 보장하는 것이 방어적 프로그래밍에 부합한다.

#### P-2c: API 엔드포인트 강화

```js
// botRoutes.js PUT /strategies/:name/config 개선
router.put('/strategies/:name/config', (req, res) => {
  const { name } = req.params;
  const newConfig = req.body;

  // 1. 기본 검증
  if (!newConfig || typeof newConfig !== 'object') { ... }

  // 2. 전략 존재 확인
  const strategy = botService.strategies.find(s => s.name === name);
  if (!strategy) { return res.status(404)... }

  // 3. paramMeta 기반 검증 (NEW)
  const meta = getParamMeta(name);
  if (meta) {
    const { valid, errors } = validateStrategyConfig(name, newConfig, meta);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: 'Config validation failed',
        validationErrors: errors,
      });
    }
  }

  // 4. 안전한 업데이트
  const result = strategy.updateConfig(newConfig);
  res.json({ success: true, data: { name, config: strategy.getConfig() } });
});
```

### P-3: 통합 전략 정보 API 설계 (우선순위: 2, 난이도: MEDIUM, 예상: 2h)

현재 GET /strategies와 GET /status의 전략 정보가 분산되어 있다. 통합 응답 구조를 설계한다.

```js
// GET /api/bot/strategies 개선된 응답
{
  success: true,
  data: {
    strategies: [
      {
        name: 'RsiPivotStrategy',
        displayName: 'RSI + Pivot 역추세',
        category: 'indicator-light',
        description: 'RSI + Pivot 역추세 (양방향)',

        // NEW: 구조화된 문서
        docs: {
          summary: '...',
          timeframe: '15분봉',
          entry: { long: '...', short: '...' },
          exit: { takeProfit: '...', stopLoss: '...', indicator: '...' },
          riskManagement: { ... },
          bestFor: '...',
          warnings: ['...'],
        },

        // 기존: 정적 메타데이터
        targetRegimes: ['trending_up', 'trending_down', 'volatile', 'ranging'],
        riskLevel: 'medium',
        defaultConfig: { rsiPeriod: 14, ... },
        paramMeta: [...],

        // NEW: 런타임 상태 (봇 실행 중일 때만)
        runtime: {
          active: true,
          state: 'active',          // 'active' | 'inactive' | 'grace_period' | 'warming_up'
          currentConfig: { rsiPeriod: 14, leverage: 3, ... },
          assignedSymbols: ['ETHUSDT', 'SOLUSDT'],
          warmupProgress: { warmedUp: true, received: 20, required: 15 },
          graceExpiresAt: null,
          positionCount: 1,
        },
      },
      // ...
    ],
  },
}
```

**이점**: 프론트엔드가 단일 API 호출로 전략의 모든 정보를 얻을 수 있다.

### P-4: CustomStrategyStore 안전성 개선 (우선순위: 2, 난이도: LOW, 예상: 1.5h)

#### P-4a: 비동기 파일 I/O로 전환

```js
const { writeFile, readFile, rename, mkdir } = require('fs/promises');

async _persist() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const arr = Array.from(this._strategies.values());
    const json = JSON.stringify(arr, null, 2);

    // 원자적 쓰기: 임시파일 → rename
    const tmpPath = FILE_PATH + '.tmp';
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, FILE_PATH);
  } catch (err) {
    log.error('Failed to persist custom strategies', { error: err.message });
    throw err; // 호출자에게 전파
  }
}
```

#### P-4b: 직렬화 큐

동시 쓰기 방지를 위한 간단한 직렬화:

```js
constructor() {
  this._strategies = new Map();
  this._writeQueue = Promise.resolve();
  this._loadSync(); // 초기 로드는 동기 (서버 시작 시)
}

_persistQueued() {
  this._writeQueue = this._writeQueue
    .then(() => this._persist())
    .catch(err => log.error('Queued persist failed', { error: err.message }));
}
```

#### P-4c: 입력 스키마 검증

커스텀 전략 정의의 입력 검증 강화:

```js
// botRoutes.js POST /custom-strategies 개선
const MAX_NAME_LENGTH = 50;
const MAX_INDICATORS = 10;
const MAX_CONDITIONS = 20;

function validateCustomDef(def) {
  if (!def.name || typeof def.name !== 'string' || def.name.length > MAX_NAME_LENGTH) {
    return '전략 이름은 1~50자 문자열이어야 합니다.';
  }
  if (def.indicators.length > MAX_INDICATORS) {
    return `지표는 최대 ${MAX_INDICATORS}개까지 가능합니다.`;
  }
  // ... 추가 검증
  return null;
}
```

### P-5: 전략 모듈 간 의존성 정리 (우선순위: 3, 난이도: HIGH, 예상: 5h)

현재 BotService의 `_handleStrategySignal()`은 100줄이 넘는 메서드로, 다음 책임이 혼재:
- 유예 기간 중 OPEN 차단
- SignalFilter 적용
- 수량 변환 (_resolveSignalQuantity)
- 심볼 재배정 중 차단
- 주문 제출
- 전략-포지션 매핑 기록

#### P-5a: SignalPipeline 추출 (SHOULD)

```
// 현재: BotService._handleStrategySignal() — 모든 로직이 한 메서드
// 제안: 파이프라인 패턴으로 분리

class SignalPipeline {
  constructor({ signalFilter, strategyRouter, positionSizeResolver, orderManager }) {
    this._stages = [
      new GraceBlockStage(strategyRouter),
      new SignalFilterStage(signalFilter),
      new QuantityResolverStage(positionSizeResolver),
      new SymbolGuardStage(strategyRouter),
      new OrderSubmitStage(orderManager),
    ];
  }

  async process(signal, context) {
    for (const stage of this._stages) {
      const result = await stage.execute(signal, context);
      if (result.blocked) {
        return result;
      }
    }
  }
}
```

**단, 이 리팩토링은 현재 기능에 영향이 없는 순수 구조 개선**이므로, 전략 설명과 config 검증보다 우선순위가 낮다. Round 14에서 진행을 권장한다.

### P-6: 전략 숨김/표시 기능 (우선순위: 3, 난이도: LOW, 예상: 1h)

사용자가 사용하지 않는 전략을 UI에서 숨기는 기능.

**구현 방안**:
- `strategyParamMeta.js`에 `hidden: boolean` 플래그 추가 (또는 별도 JSON 파일)
- GET /strategies에 `?includeHidden=true` 쿼리 파라미터
- API: PUT /api/bot/strategies/:name/visibility { hidden: true/false }
- 프론트엔드: 카드에 숨김 버튼, "숨긴 전략 보기" 토글

**안전성 고려**:
- 숨겨진 전략이 활성 상태이면 숨길 수 없음 (또는 경고)
- 숨김 상태는 봇 재시작에도 유지 (파일 저장)

### P-7: 자금관리 모듈 시각화 (우선순위: 2, 난이도: MEDIUM, 예상: 3h — FE)

사용자 원문 요청의 핵심: "자금관리는 어떻게 되는지" 투명하게 표시.

**프론트엔드 컴포넌트 제안**:

```
StrategyCard (확장 시)
├── [설명] 탭 — 전략 동작 원리 (P-1의 docs 렌더링)
│   ├── 시간 프레임 배지
│   ├── 진입 조건 (Long/Short 분리)
│   ├── 청산 조건 (TP/SL/지표)
│   └── 주의사항
├── [설정] 탭 — 파라미터 튜닝 (기존 StrategyConfigPanel)
│   ├── 핵심 설정 (레버리지, 포지션 크기, TP%, SL%)
│   │   → 시각적 게이지/바로 표현
│   └── 상세 설정 (지표 기간 등)
├── [자금관리] 탭 — NEW
│   ├── 현재 자본 대비 포지션 크기 시각화
│   ├── 예상 최대 손실 금액 (equity * positionSize% * SL% / leverage)
│   ├── 리스크-리워드 비율 시각적 표현
│   └── 연속 손실 시 자본 감소 시뮬레이션 그래프
└── [성과] 탭 — 기존 StrategyDetail (포지션/거래/시그널)
```

---

## 구현 우선순위 정리

| ID | 항목 | 우선순위 | 난이도 | 시간 | 담당 |
|----|------|---------|--------|------|------|
| P-1 | 전략 docs 메타데이터 추가 (18개) | 1 | MED | 4h | BE (Trader) |
| P-2a | 서버측 config 검증 (strategyConfigValidator) | 1 | MED | 1.5h | BE (Engineer) |
| P-2b | updateConfig atomic replace | 1 | LOW | 0.5h | BE (Engineer) |
| P-2c | API 엔드포인트 검증 강화 | 1 | LOW | 0.5h | BE (Engineer) |
| P-3 | 통합 전략 정보 API | 2 | MED | 2h | BE (Engineer) |
| P-4a | CustomStrategyStore 비동기 I/O | 2 | LOW | 1h | BE (Engineer) |
| P-4b | CustomStrategyStore 직렬화 큐 | 2 | LOW | 0.5h | BE (Engineer) |
| P-7-FE | 전략 설명 탭 UI | 2 | MED | 3h | FE (UI) |
| P-7-FE2 | 자금관리 탭 UI | 2 | MED | 3h | FE (UI) |
| P-6 | 전략 숨김/표시 | 3 | LOW | 1h | BE+FE |
| P-5a | SignalPipeline 추출 | 3 | HIGH | 5h | BE (R14) |

**총 예상 소요: BE ~11h, FE ~6h**

---

## 다른 에이전트에게 요청 사항

### Trader Agent에게

1. **18개 전략 각각의 `docs` 객체 작성** (P-1)
   - 각 전략 파일을 읽고, 실제 코드에서 진입/청산 조건을 추출하여 구조화
   - `docs.entry.long`, `docs.entry.short`, `docs.exit.*`, `docs.riskManagement.*` 형식
   - 시간 프레임: MarketData의 kline 구독이 몇 분봉인지 확인 필요
   - `docs.warnings`: 전략별 주의사항 (예: 터틀은 횡보장에서 whipsaw 위험)

2. **AdaptiveRegimeStrategy의 레짐별 동작 표** 검증
   - 코드의 주석과 실제 로직이 일치하는지 확인
   - 각 레짐별 positionSize, leverage 기본값이 defaultConfig과 매치되는지

3. **전략 분류 체계 검토**
   - 현재 3카테고리(price-action, indicator-light, indicator-heavy)가 사용자 관점에서 직관적인지
   - 추가 분류 축(시간 프레임, 방향성, 리스크 수준)이 필요한지

### UI Agent에게

1. **전략 설명 탭 디자인** (P-7-FE)
   - `docs` 객체를 시각적으로 렌더링하는 `StrategyDocs.tsx` 컴포넌트
   - 진입/청산 조건을 Long/Short로 나눠서 시각적으로 명확하게
   - 주의사항은 경고 배지로 표시
   - 시간 프레임/레버리지/포지션 크기는 상단에 배지 형태로

2. **자금관리 시각화 탭** (P-7-FE2)
   - 현재 자본 대비 포지션 크기를 진행 바/게이지로
   - 예상 최대 손실 금액 계산 (equity * positionSize * SL / leverage)
   - 리스크-리워드 비율 시각적 표현 (TP% vs SL%)
   - 연속 손실 시 자본 감소 시뮬레이션 (간단한 테이블 또는 Recharts 차트)

3. **StrategyConfigPanel 개선**
   - 핵심 설정(레버리지, 포지션 크기, TP, SL)을 상단에 강조
   - 시각적 게이지/바로 현재 값 표현
   - 상세 설정(지표 기간 등)은 접힌 상태로 기본

4. **전략 숨김 UI** (P-6)
   - 카드 우측 상단에 눈/숨김 아이콘
   - 하단에 "숨긴 전략 N개 보기" 토글
   - 숨긴 전략은 반투명하게 표시

---

## 위험 요소 및 완화 전략

### Risk 1: 런타임 Config 변경 중 포지션 영향

**시나리오**: 사용자가 슬리피지가 높은 상황에서 slPercent를 0.5%로 줄이면, 기존 포지션에 즉시 적용되어 의도치 않은 손절 발생.

**완화**:
- Config 변경 시 "기존 포지션에 적용 / 새 포지션부터 적용" 선택 UI (Phase 2)
- Phase 1에서는 경고 메시지: "변경 사항은 기존 포지션에도 즉시 적용됩니다"
- 위험한 범위 변경(SL 50% 이상 축소)은 확인 다이얼로그

### Risk 2: 전략 docs 유지보수 비용

**시나리오**: 코드를 수정했는데 docs를 업데이트하지 않으면 사용자에게 잘못된 정보 전달.

**완화**:
- docs 객체를 전략 파일 내부에 위치시켜 코드와 가까이 유지
- Jest 테스트에서 docs 필수 필드 존재 여부 검증
- PR 리뷰 체크리스트에 "전략 docs 업데이트 여부" 항목 추가

### Risk 3: CustomStrategyStore 비동기 전환 시 초기화 순서

**시나리오**: `_load()`가 비동기가 되면 bootstrap에서 await 필요.

**완화**:
- 초기 로드(`_load()`)만 동기로 유지 (서버 시작 시 1회)
- `_persist()`만 비동기로 전환 (런타임 저장만)
- constructor에서 동기 로드, save/update/delete에서 비동기 저장

---

## 요약

Round 13의 핵심은 **"사용자가 각 전략이 자신의 돈을 어떻게 운용하는지 완전히 이해하고 제어할 수 있게 하는 것"**이다.

1. **전략 docs 메타데이터** (P-1) — 투명성: 무엇을 왜 하는지
2. **Config 검증 + 안전한 업데이트** (P-2) — 안전성: 잘못된 값 차단
3. **통합 API + UI 개선** (P-3, P-7) — 사용성: 한눈에 파악 가능
4. **CustomStrategyStore 개선** (P-4) — 안정성: I/O 안전
5. **모듈 분리 준비** (P-5) — 확장성: 미래 기능 추가 용이

Round 1~12에서 구축한 견고한 기반 위에, 사용자 경험의 마지막 퍼즐을 맞추는 라운드가 될 것이다.
