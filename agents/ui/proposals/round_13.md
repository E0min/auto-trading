# Round 13 UI/UX Proposal: 전략 모듈화 + 상세 파라미터 튜닝 + UX

**Agent**: UI/UX Engineer
**Date**: 2026-02-17
**Scope**: 전략 정보 가시화, 모듈형 설정 UI, 프리셋 시스템, 전략 비교 뷰

---

## 분석 요약

### 핵심 문제

사용자가 정확히 짚은 문제: **"전략이 뭘 하는지 전혀 모른다."** 현재 UI는 전략의 이름과 활성/비활성 토글만 제공하고, 전략이 실제로 어떤 조건에서 진입하고, 어떻게 청산하며, 리스크를 어떻게 관리하는지에 대한 정보가 완전히 결여되어 있다.

이 문제는 단순히 "설명 텍스트가 없다"는 수준이 아니다. 트레이더에게 전략의 동작 원리를 이해시키지 못하면, 해당 전략을 신뢰하고 실거래에 투입할 수 없다. 이것은 전체 플랫폼의 신뢰성 문제이다.

### 현재 상태 코드 레벨 분석

| 파일 | 현재 상태 | 핵심 결핍 |
|------|-----------|-----------|
| `StrategyHub.tsx` | 카테고리/레짐 필터 + 카드 리스트 | 전략 설명, 동작 원리 없음 |
| `StrategyCard.tsx` | 이름 + 한글번역 + 리스크레벨 + 레짐태그 + 활성토글 | 분봉, 진입조건, 손절, 익절, 레버리지, 포지션크기 **전무** |
| `StrategyDetail.tsx` | 포지션/거래/시그널 탭 (성과 데이터) | 전략 로직 설명 없음. 순수 실적 데이터만 |
| `StrategyConfigPanel.tsx` | paramMeta 기반 슬라이더/숫자 입력 | 파라미터가 뭘 의미하는지 설명 없음. 맥락 없는 숫자 나열 |
| `CustomStrategyBuilder.tsx` | 지표 정의 + 조건 빌더 | 잘 구현되어 있으나 기본 18개 전략과 분리. 모듈 개념 부재 |
| `lib/utils.ts` (`translateStrategyName`) | 전략명 한글 번역만 | 1줄 설명이 전부. 동작 원리 설명 없음 |

### 백엔드에 이미 존재하는 메타데이터 (활용 가능)

백엔드 `static metadata`에는 프론트엔드가 아직 활용하지 않는 풍부한 정보가 있다:

```
// 예: RsiPivotStrategy.metadata
{
  name, targetRegimes, riskLevel,
  maxConcurrentPositions: 2,     // <-- FE 미노출
  cooldownMs: 60000,             // <-- FE 미노출
  gracePeriodMs: 300000,         // <-- FE 미노출
  warmupCandles: 15,             // <-- FE 미노출
  volatilityPreference: 'neutral', // <-- FE 미노출
  maxSymbolsPerStrategy: 3,     // <-- FE 미노출
  description: 'RSI + Pivot 역추세 (양방향)', // <-- FE에서 미사용!
  defaultConfig: {
    rsiPeriod: 14,
    leverage: 3,                 // <-- 핵심 정보인데 카드에 미표시
    positionSizePercent: '5',    // <-- 핵심 정보인데 카드에 미표시
    tpPercent: '2',              // <-- 핵심 정보인데 카드에 미표시
    slPercent: '2',              // <-- 핵심 정보인데 카드에 미표시
  }
}
```

**botRoutes.js 라인 152-160**: API에서 `description`, `defaultConfig`를 이미 전달하지만 프론트엔드에서 카드에 표시하지 않는다. `maxConcurrentPositions`, `cooldownMs`, `warmupCandles`, `volatilityPreference`, `maxSymbolsPerStrategy`는 API에서 아예 전달하지 않는다.

### 경쟁 플랫폼 벤치마크

**Binance Pro**: 전략 마켓플레이스에서 각 전략의 수익률, 최대 드로다운, 운영 기간, 코인 목록, 리스크 점수를 카드 형태로 일목요연하게 제공. "Copy Trade" 버튼이 핵심 CTA.

**TradingView**: Pine Script 전략에서 파라미터를 "Inputs" 탭에 그룹화하고, 각 파라미터마다 툴팁으로 설명을 제공. "Strategy Tester" 탭에서 설정 변경 즉시 백테스트 결과 시각화.

**Bloomberg Terminal**: 모듈형 "Component" 아키텍처. 시그널 생성, 포트폴리오 구성, 리스크 관리, 실행이 각각 독립 모듈로 분리. 파이프라인 시각화.

---

## 발견 사항

### F1. 전략 카드의 정보 밀도가 극히 낮음

**파일**: `frontend/src/components/strategy/StrategyCard.tsx` (라인 128-162)

현재 카드가 표시하는 정보:
- 전략 이름 (영문 + 한글 번역)
- 카테고리 (가격행동/경량지표/고급지표)
- 대상 레짐 태그 (최대 3개)
- 리스크 레벨 (Low/Med/High)
- 활성 상태 배지

**표시하지 않는 핵심 정보**:
- 분봉/타임프레임 (백엔드의 `warmupCandles`로 유추 가능하나 직접적 타임프레임 정보 부재)
- 진입 조건 (어떤 지표가 어떤 값일 때)
- 손절/익절 비율 (`defaultConfig.slPercent`, `tpPercent` 존재하나 미표시)
- 레버리지 (`defaultConfig.leverage` 존재하나 미표시)
- 포지션 크기 (`defaultConfig.positionSizePercent` 존재하나 미표시)
- 최대 동시 포지션 (`maxConcurrentPositions` 미전달)
- 쿨다운 시간 (`cooldownMs` 미전달)
- 워밍업 캔들 수 (`warmupCandles` 미전달)

### F2. StrategyDetail이 "실적"만 보여주고 "로직"은 보여주지 않음

**파일**: `frontend/src/components/strategy/StrategyDetail.tsx`

현재 3개 탭: 포지션, 거래내역, 시그널. 모두 과거 실적 데이터이다. "이 전략이 무엇을 하는가?"를 설명하는 탭이 존재하지 않는다.

### F3. StrategyConfigPanel이 맥락 없이 숫자만 나열

**파일**: `frontend/src/components/strategy/StrategyConfigPanel.tsx`

`paramMeta`에 `label`만 있고 `description`(설명)이 없다. 예를 들어 "KC 배수 1.5"라는 숫자가 무엇을 의미하는지, 이 값을 올리면 어떤 효과가 있는지 사용자가 알 수 없다.

**파일**: `backend/src/services/strategyParamMeta.js`

```js
{ field: 'kcMultiplier', label: 'KC 배수', type: 'decimal', min: 0.5, max: 4, step: 0.1 }
// description 필드 없음!
// 효과 설명 없음! ("높이면 더 넓은 채널 → 시그널 빈도 감소")
```

### F4. 모듈 개념의 부재

사용자가 요구한 "장세판단모듈 - 전략모듈 - 자금관리모듈 - 레버리지 설정"이 UI에서 시각적으로 분리되어 있지 않다.

현재 아키텍처에서 이 모듈들은 이미 백엔드에 존재한다:
- **장세판단**: `marketRegime.js` + `strategyRouter.js` (자동 레짐 분류 + 전략 라우팅)
- **전략**: 18개 전략 클래스 (진입/청산 로직)
- **자금관리**: `riskEngine.js` (ExposureGuard, DrawdownMonitor, CircuitBreaker)
- **레버리지**: 각 전략의 `defaultConfig.leverage` + `ExposureGuard`

하지만 프론트엔드에서 이 파이프라인이 하나의 흐름으로 시각화되지 않는다. 각 모듈이 어떤 역할을 하고, 어떻게 연결되는지 사용자가 이해할 수 없다.

### F5. 초급/중급/고급 사용자 경험 차별화 없음

모든 사용자에게 동일한 설정 UI가 제공된다. `paramMeta`에는 7~15개의 파라미터가 있는데, 초급 사용자에게는 압도적이다. 반대로 고급 사용자에게는 세부 제어가 부족하다 (예: 각 레짐별 레버리지를 다르게 설정하는 기능은 AdaptiveRegimeStrategy에만 있음).

### F6. StrategyListItem 타입에 누락된 필드

**파일**: `frontend/src/types/index.ts` (라인 194-206)

```ts
export interface StrategyListItem {
  name: string;
  description: string;       // 존재하지만 카드에 미표시!
  defaultConfig: Record<string, unknown>; // 레버리지/손절/익절 포함이나 미표시!
  targetRegimes: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  active: boolean;
  paramMeta?: ParamMeta[];
  // 아래 필드들 미포함:
  // maxConcurrentPositions, cooldownMs, warmupCandles,
  // volatilityPreference, maxSymbolsPerStrategy
}
```

### F7. 전략 비교 기능 부재

18개 전략을 나란히 비교할 수 있는 뷰가 없다. 사용자가 "어떤 전략을 활성화할까?"를 결정할 때, 각 카드를 하나씩 펼쳐봐야 한다.

---

## 제안 사항

### P1. 전략 인포 카드 리디자인 (Strategy Info Card) [HIGH / M / 6h]

**우선순위**: HIGH | **난이도**: Medium | **예상 시간**: 6h

현재 `StrategyCard.tsx`의 정보 밀도를 3배로 높인다. 카드를 펼치지 않고도 핵심 트레이딩 파라미터를 한눈에 파악 가능하게 한다.

#### 디자인 변경

**카드 헤더 영역 (접힌 상태에서 보이는 부분)**:

```
[Toggle] MaTrendStrategy                          추천  Med  [활성]  V
         멀티 이평선 추세
         상승추세 | 하락추세 | 횡보

         --- 현재 노출 정보 아래에 핵심 지표 행 추가 ---

         Lev 3x  |  Size 3%  |  TP 3%  |  SL 2%  |  Max 2포지션
```

핵심 지표 행 (`Quick Stats Bar`):
- **Lev**: defaultConfig.leverage (레버리지)
- **Size**: defaultConfig.positionSizePercent (포지션 크기 %)
- **TP**: defaultConfig.tpPercent (익절 %) -- 없는 전략은 "ATR 기반" 표시
- **SL**: defaultConfig.slPercent (손절 %) -- 없는 전략은 "ATR 기반" 표시
- **Max**: maxConcurrentPositions (최대 동시 포지션)

색상 규칙:
- 레버리지 1~3x: `text-[var(--text-muted)]` (안전)
- 레버리지 4~10x: `text-amber-400` (주의)
- 레버리지 11~20x: `text-[var(--loss)]` (위험)

#### 구현 세부사항

1. **백엔드 변경 필요**: `botRoutes.js` 라인 152-160에서 추가 필드 전달
   ```js
   const strategies = allStrategies.map((meta) => ({
     ...기존필드,
     maxConcurrentPositions: meta.maxConcurrentPositions || 1,
     cooldownMs: meta.cooldownMs || 0,
     warmupCandles: meta.warmupCandles || 0,
     volatilityPreference: meta.volatilityPreference || 'neutral',
     maxSymbolsPerStrategy: meta.maxSymbolsPerStrategy || 1,
   }));
   ```

2. **타입 변경**: `types/index.ts`의 `StrategyListItem`에 필드 추가

3. **StrategyCard.tsx**: Quick Stats Bar 컴포넌트 추가

---

### P2. 전략 설명 패널 (Strategy Explainer) [HIGH / H / 10h]

**우선순위**: HIGH | **난이도**: Hard | **예상 시간**: 10h

`StrategyDetail.tsx`에 새로운 탭 "개요"를 추가한다. 이 탭이 기본 선택이 되며, 전략이 무엇을 하는지를 구조화된 형태로 설명한다.

#### 디자인

```
[개요] [포지션] [거래내역] [시그널]

┌─────────────────────────────────────────────────┐
│  전략 개요                                        │
│  ─────────────────────────────────────────────── │
│  RSI + Pivot Point 역추세 전략                    │
│  가격이 피봇 지지선(S1)에 도달하고 RSI가 과매도    │
│  구간에 진입하면 롱 포지션을 잡고, 피봇 저항선(R1) │
│  에서 RSI 과매수 시 숏 포지션을 잡는 양방향 전략   │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 진입 조건  │  │ 청산 조건  │  │ 리스크    │       │
│  │           │  │           │  │           │       │
│  │ LONG:     │  │ TP: +2%   │  │ Lev: 3x  │       │
│  │ RSI ≤ 30  │  │ SL: -2%   │  │ Size: 5% │       │
│  │ Price ≤ S1│  │ RSI cross │  │ Max: 2pos │       │
│  │           │  │ Pivot hit │  │ CD: 60s   │       │
│  │ SHORT:    │  │           │  │           │       │
│  │ RSI ≥ 70  │  │           │  │           │       │
│  │ Price ≥ R1│  │           │  │           │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                   │
│  사용 지표: RSI(14), Pivot Points (일봉)          │
│  워밍업: 15 캔들 | 쿨다운: 60초 | 유예: 5분       │
│  변동성 선호: 중립 | 최대 심볼: 3개                │
└─────────────────────────────────────────────────┘
```

#### 구현 방법

이 설명 데이터는 **백엔드에 정적 데이터로 추가**해야 한다. 각 전략의 metadata에 `explainer` 객체를 추가:

```js
static metadata = {
  ...기존,
  explainer: {
    summary: '가격이 피봇 지지/저항선에 도달할 때 RSI 과매도/과매수와 결합하여 역추세 진입',
    timeframe: '5분봉 (kline)',
    entryConditions: {
      long: ['RSI <= 30 (과매도)', '가격 <= Pivot S1 (지지선)'],
      short: ['RSI >= 70 (과매수)', '가격 >= Pivot R1 (저항선)'],
    },
    exitConditions: ['TP: +2%', 'SL: -2%', 'RSI 반대 구간 진입', 'Pivot 레벨 도달'],
    indicators: ['RSI (14)', 'Pivot Points (일봉 기반)'],
    strengths: ['횡보/변동성 장세에서 높은 승률', '명확한 진입/청산 기준'],
    weaknesses: ['강한 추세에서 역추세 함정 위험', '피봇 레벨이 하루에 한번만 갱신'],
  },
}
```

프론트엔드에서는 새로운 `StrategyExplainer.tsx` 컴포넌트가 이 데이터를 받아 3-column 카드 레이아웃으로 시각화한다.

---

### P3. 모듈형 파이프라인 시각화 (Pipeline Visualizer) [HIGH / H / 8h]

**우선순위**: HIGH | **난이도**: Hard | **예상 시간**: 8h

사용자 요청의 핵심: "장세판단모듈 - 전략모듈 - 자금관리모듈 - 레버리지 설정"을 시각적 파이프라인으로 표현한다.

#### 디자인: 수평 파이프라인 (Desktop)

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌──────────┐    ┌──────────┐
│  장세 판단   │ -> │  코인 선정   │ -> │  전략 실행   │ -> │ 자금 관리  │ -> │  주문 실행  │
│             │    │             │    │             │    │           │    │           │
│ 현재: 상승추세│    │ BTC, ETH,   │    │ MaTrend     │    │ Size: 3%  │    │ Bitget    │
│ 신뢰: 85%   │    │ SOL, XRP    │    │ Supertrend  │    │ Lev: 3x   │    │ USDT-F    │
│             │    │ DOGE (5개)  │    │ RSIPivot    │    │ SL: 2%    │    │ 시장가     │
│             │    │             │    │ (3개 활성)   │    │ TP: 3%    │    │           │
└────────────┘    └────────────┘    └────────────┘    └──────────┘    └──────────┘
                                                         │
                                                    ┌──────────┐
                                                    │ 리스크 게이트│
                                                    │ CB: 정상   │
                                                    │ DD: 2.1%  │
                                                    │ 노출: 15% │
                                                    └──────────┘
```

#### 모바일: 수직 스택

```
[1] 장세 판단    상승추세 85%
        |
[2] 코인 선정    BTC, ETH +3
        |
[3] 전략 실행    MaTrend, Supertrend, RSIPivot
        |
[4] 자금 관리    3% / 3x / SL 2%
        |
[5] 주문 실행    Bitget USDT-F
```

#### 구현 위치

새 컴포넌트 `TradingPipeline.tsx`를 StrategyHub 상단 또는 MarketIntelligence 패널 내에 배치한다. 실시간 데이터는 기존 `botStatus`, `regime`, `riskStatus`에서 모두 추출 가능 -- 별도 API 불필요.

각 모듈 블록은 클릭하면 해당 섹션으로 스크롤 (장세판단 -> MarketIntelligence, 전략 -> StrategyHub, 리스크 -> RiskStatusPanel).

---

### P4. 모듈별 설정 패널 재구성 (Modular Config Panels) [HIGH / H / 12h]

**우선순위**: HIGH | **난이도**: Hard | **예상 시간**: 12h

현재 `StrategyConfigPanel.tsx`는 모든 파라미터를 flat 리스트로 나열한다. 이를 논리적 모듈로 그룹화하고, 각 그룹에 설명과 시각적 피드백을 추가한다.

#### 파라미터 그룹화 규칙

`strategyParamMeta.js`의 각 파라미터를 4개 모듈로 분류:

| 모듈 | 파라미터 패턴 | 아이콘 | 색상 |
|------|-------------|--------|------|
| **진입 조건** | `rsiPeriod`, `rsiOversold`, `rsiOverbought`, `bbPeriod`, `bbStdDev`, `macdFast/Slow/Signal`, `entryChannel`, `swingLookback`, `fibEntry*` 등 | Chart | `--accent` |
| **청산 조건** | `tpPercent`, `tpMultiplier`, `tpAtrMult`, `slPercent`, `slMultiplier`, `slAtrMult`, `exitChannel`, `maxHoldCandles`, `maxHoldHours`, `trailingActivation*`, `trailingDistance*`, `failureCandles` | Shield | `--profit` |
| **자금 관리** | `positionSizePercent`, `totalBudgetPercent`, `maxDrawdownPercent`, `maxEntries` | Wallet | amber |
| **레버리지/실행** | `leverage`, `trendLeverage`, `rangeLeverage`, `volatileLeverage` | Gauge | purple |

#### 구현

1. **ParamMeta 확장**: `strategyParamMeta.js`에 `group` 필드 추가
   ```js
   { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'execution' }
   ```

2. **파라미터 설명 추가**: `description` 필드
   ```js
   { field: 'kcMultiplier', label: 'KC 배수', description: '켈트너 채널 폭을 ATR의 몇 배로 설정할지. 높이면 채널이 넓어져 시그널 빈도 감소, 낮추면 좁은 채널에서 잦은 시그널', ... }
   ```

3. **프론트엔드**: `StrategyConfigPanel.tsx`를 아코디언 그룹으로 재구성
   ```
   ▼ 진입 조건 (4개 파라미터)
     RSI 기간 [14]  ──────●────── [14]
     RSI 과매도 [30] ────●──────── [30]
     ...

   ▼ 청산 조건 (3개 파라미터)
     익절 % [2.0] ──────●────── [2.0]
     손절 % [2.0] ────●──────── [2.0]
     ...

   ▼ 자금 관리 (2개 파라미터)
     포지션 크기 [5%] ──────●──── [5%]
     ...

   ▼ 레버리지 (1개 파라미터)
     레버리지 [3x] ────●──────── [3x]
   ```

4. **툴팁/인라인 설명**: 각 파라미터 옆에 `(i)` 아이콘. 호버 시 description 표시.

---

### P5. 프리셋 시스템 (Risk Preset Selector) [MEDIUM / M / 6h]

**우선순위**: MEDIUM | **난이도**: Medium | **예상 시간**: 6h

초급/중급/고급 사용자를 위한 원클릭 프리셋. StrategyConfigPanel 상단에 배치.

#### 디자인

```
┌─────────────────────────────────────────────┐
│  리스크 프리셋                                │
│                                               │
│  [  보수적  ]    [  균형  ]    [  공격적  ]    │
│   Lev 1~2x      Lev 2~3x      Lev 3~5x     │
│   Size 1~2%     Size 3~5%     Size 5~10%    │
│   SL 1~1.5%     SL 2~3%      SL 3~5%       │
│   낮은 위험       보통 위험      높은 위험       │
│                                               │
│  또는 직접 설정 (파라미터 그룹 열기)             │
└─────────────────────────────────────────────┘
```

프리셋 선택 시:
1. 해당 전략의 `defaultConfig`에서 `leverage`, `positionSizePercent`, `slPercent`, `tpPercent`만 프리셋 값으로 오버라이드
2. 나머지 파라미터는 기본값 유지
3. "직접 설정" 선택 시 전체 파라미터 그룹이 열림

#### 프리셋 정의

```ts
const PRESETS = {
  conservative: {
    label: '보수적',
    description: '낮은 레버리지와 작은 포지션으로 안정적 운영',
    overrides: { leverage: 1, positionSizePercent: '2', slPercent: '1.5', tpPercent: '2' },
    color: 'emerald',
    riskScore: 1,
  },
  balanced: {
    label: '균형',
    description: '리스크와 수익의 균형. 대부분의 사용자에게 추천',
    overrides: { leverage: 3, positionSizePercent: '4', slPercent: '2.5', tpPercent: '3' },
    color: 'blue',
    riskScore: 2,
  },
  aggressive: {
    label: '공격적',
    description: '높은 레버리지와 큰 포지션. 높은 수익 가능하지만 리스크도 비례',
    overrides: { leverage: 5, positionSizePercent: '8', slPercent: '4', tpPercent: '5' },
    color: 'red',
    riskScore: 3,
  },
};
```

---

### P6. 전략 비교 뷰 (Strategy Comparison Matrix) [MEDIUM / M / 6h]

**우선순위**: MEDIUM | **난이도**: Medium | **예상 시간**: 6h

`StrategyHub.tsx`에 "비교" 모드 추가. 여러 전략을 체크박스로 선택하면 나란히 비교하는 테이블이 나타남.

#### 디자인

```
[일반 뷰]  [비교 뷰]

체크된 전략: MaTrend, Supertrend, RSIPivot (3개)

┌──────────────┬──────────┬──────────────┬───────────┐
│              │ MaTrend  │ Supertrend   │ RSIPivot  │
├──────────────┼──────────┼──────────────┼───────────┤
│ 카테고리      │ 경량지표  │ 경량지표      │ 경량지표   │
│ 리스크 레벨   │ Medium   │ Medium       │ Medium    │
│ 대상 레짐     │ 상승,하락│ 상승,하락,횡보│ 상승,하락  │
│ 레버리지      │ 3x       │ -            │ 3x        │
│ 포지션 크기   │ 3%       │ 3%           │ 5%        │
│ 익절         │ 3%       │ 2.5%         │ 2%        │
│ 손절         │ 2%       │ 2%           │ 2%        │
│ 최대 포지션   │ 1        │ 2            │ 2         │
│ 쿨다운       │ 120초    │ 60초         │ 60초      │
│ 워밍업 캔들   │ 55       │ 30           │ 15        │
│ 변동성 선호   │ high     │ high         │ neutral   │
├──────────────┼──────────┼──────────────┼───────────┤
│ 성과 (실적)   │          │              │           │
│ 총 거래      │ 12       │ 8            │ 15        │
│ 승률         │ 66.7%    │ 62.5%        │ 53.3%     │
│ 총 PnL      │ +24.5    │ +15.2        │ +8.7      │
└──────────────┴──────────┴──────────────┴───────────┘
```

구현:
- `StrategyHub`에 비교 모드 토글 추가
- 비교 모드에서 카드 대신 체크박스 리스트 → 하단에 비교 테이블 렌더
- 성과 데이터는 `/api/trades/strategy-stats/:name`에서 각 전략별로 fetch

---

### P7. 파라미터 효과 시각화 (Parameter Impact Hints) [LOW / H / 8h]

**우선순위**: LOW | **난이도**: Hard | **예상 시간**: 8h

파라미터를 변경할 때, 변경이 전략 동작에 미치는 영향을 실시간 프리뷰로 보여준다.

예시:
```
레버리지  [3x] ──────●─────── [3x]
         1x                  20x

  ┌──────────────────────────────┐
  │  예상 영향:                   │
  │  • 수익/손실 배율: 3배         │
  │  • 청산가 거리: ~33%          │
  │  • 1% 가격 변동 → 3% 계좌 변동│
  └──────────────────────────────┘
```

이것은 프리셋 시스템과 연계하여, 초급 사용자가 "이 숫자를 바꾸면 어떻게 되지?"를 직관적으로 이해할 수 있게 한다. 순수 프론트엔드 계산 가능 (백엔드 불필요).

---

### P8. 파라미터 설명 데이터 추가 (Backend paramMeta 확장) [HIGH / L / 3h]

**우선순위**: HIGH | **난이도**: Low | **예상 시간**: 3h

`strategyParamMeta.js`의 각 항목에 `description`과 `group` 필드를 추가한다.

```js
// Before
{ field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 100, step: 1 }

// After
{
  field: 'rsiPeriod',
  label: 'RSI 기간',
  description: 'RSI 지표 계산에 사용할 캔들 수. 짧으면(7~9) 민감하게 반응, 길면(21+) 안정적이지만 시그널 지연',
  type: 'integer',
  min: 2, max: 100, step: 1,
  group: 'entry',  // 'entry' | 'exit' | 'risk' | 'execution'
}
```

이것은 P4의 선행 조건이자, 가장 적은 노력으로 가장 큰 UX 개선을 가져오는 작업이다.

---

### P9. 전략 Explainer 정적 데이터 추가 (Backend) [HIGH / M / 6h]

**우선순위**: HIGH | **난이도**: Medium | **예상 시간**: 6h

18개 전략 각각의 `static metadata`에 `explainer` 객체를 추가한다. P2의 선행 조건.

```js
explainer: {
  summary: '한 줄 요약',
  timeframe: '5분봉',
  entryConditions: { long: [...], short: [...] },
  exitConditions: [...],
  indicators: ['RSI(14)', 'Pivot Points'],
  strengths: ['...'],
  weaknesses: ['...'],
}
```

이 데이터는 API를 통해 프론트엔드에 전달된다.

---

### P10. 모바일 반응형 설계 고려 [MEDIUM / M / 4h]

**우선순위**: MEDIUM | **난이도**: Medium | **예상 시간**: 4h

복잡한 설정 UI를 모바일에서 간결하게:

1. **파이프라인 시각화**: 수평 -> 수직 스택 전환 (Tailwind `flex-col lg:flex-row`)
2. **전략 카드**: Quick Stats Bar를 2행으로 분할 (모바일에서 한 줄에 3개씩)
3. **비교 뷰**: 좌우 스크롤 가능한 고정 헤더 테이블
4. **설정 패널**: 아코디언 그룹은 모바일에서 기본 접힘 상태, 하나씩만 열림
5. **프리셋 버튼**: 풀 너비 세로 배치

---

## 구현 우선순위 요약

| # | 항목 | 우선순위 | 난이도 | 시간 | 의존성 |
|---|------|---------|--------|------|--------|
| P8 | paramMeta 확장 (description, group) | HIGH | L | 3h | Backend |
| P9 | 전략 explainer 정적 데이터 | HIGH | M | 6h | Backend |
| P1 | 전략 카드 Quick Stats Bar | HIGH | M | 6h | P8 (타입), Backend (추가 필드) |
| P2 | 전략 설명 패널 (Explainer) | HIGH | H | 10h | P9 |
| P4 | 모듈별 설정 패널 재구성 | HIGH | H | 12h | P8 |
| P3 | 파이프라인 시각화 | HIGH | H | 8h | 없음 |
| P5 | 프리셋 시스템 | MED | M | 6h | P4 |
| P6 | 전략 비교 뷰 | MED | M | 6h | P1 |
| P10 | 모바일 반응형 | MED | M | 4h | P1~P6 완료 후 |
| P7 | 파라미터 효과 시각화 | LOW | H | 8h | P4 |

**총 예상 시간: 약 69h** (Sprint 3~4회 분량)

### 권장 구현 순서 (4 Sprint)

**Sprint 13-A** (P8 + P9 + P1): 백엔드 데이터 확장 + 카드 리디자인 = **15h**
- 가장 빠르게 사용자에게 체감되는 변화
- 전략 카드에서 핵심 트레이딩 파라미터가 즉시 보임

**Sprint 13-B** (P2 + P4): 전략 설명 + 모듈별 설정 = **22h**
- 전략 로직의 완전한 가시화
- 파라미터 설정의 맥락 제공

**Sprint 13-C** (P3 + P5): 파이프라인 + 프리셋 = **14h**
- 전체 시스템 파이프라인 이해
- 초급 사용자를 위한 원클릭 설정

**Sprint 13-D** (P6 + P7 + P10): 비교 뷰 + 효과 시각화 + 모바일 = **18h**
- 고급 사용자 기능
- 모바일 최적화

---

## 다른 에이전트에게 요청 사항

### Trader Agent에게

1. **전략 Explainer 데이터 작성 (P9)**: 18개 전략 각각에 대해 `explainer` 객체 내용을 작성해 주세요. 특히:
   - `entryConditions`: 롱/숏 진입 조건을 일반 사용자가 이해할 수 있는 한국어로
   - `exitConditions`: 청산 조건 목록
   - `strengths` / `weaknesses`: 각 전략의 장단점 (2~3개씩)
   - `timeframe`: 실제 사용하는 봉 타임프레임

2. **프리셋 값 검증**: P5의 보수적/균형/공격적 프리셋이 각 전략에 맞는지 검증. 예를 들어 GridStrategy는 레버리지 5x가 위험할 수 있음. 전략별 프리셋 상한선이 필요할 수 있음.

3. **파라미터 설명 작성 (P8)**: `strategyParamMeta.js`의 각 파라미터에 대한 `description` 텍스트. "이 값을 높이면/낮추면 어떻게 되는지"를 포함한 1~2문장.

### Engineer Agent에게

1. **Backend API 확장 (P1, P8, P9)**:
   - `botRoutes.js`에서 `maxConcurrentPositions`, `cooldownMs`, `warmupCandles`, `volatilityPreference`, `maxSymbolsPerStrategy` 필드를 전략 목록 API에 추가
   - `strategyParamMeta.js`에 `description`, `group` 필드 추가 (스키마 변경)
   - 18개 전략의 `static metadata`에 `explainer` 객체 추가
   - 새 API 엔드포인트는 불필요 -- 기존 `GET /api/bot/strategies` 응답만 확장

2. **타입 동기화**: 프론트엔드 `types/index.ts`의 `StrategyListItem`, `ParamMeta` 인터페이스와 백엔드 응답의 일관성 보장

3. **성능 고려**: 전략 비교 뷰(P6)에서 여러 전략의 stats를 병렬 fetch할 때, `/api/trades/strategy-stats`를 배치 API로 확장하는 것이 좋을 수 있음 (선택적)

---

## 디자인 원칙 (이 Round 전체에 적용)

1. **Progressive Disclosure**: 카드 접힌 상태에서 Quick Stats → 펼치면 Explainer + 상세 설정 → 비교 뷰에서 풀 매트릭스
2. **Context Over Numbers**: 숫자만 보여주지 말고 "이것이 뭘 의미하는지" 항상 함께 제공
3. **Color as Signal**: 레버리지, 리스크 레벨에 일관된 색상 체계 (녹색=안전, 노란=주의, 빨강=위험)
4. **Mobile First is Wrong Here**: 이 플랫폼은 Desktop First. 모바일은 핵심 정보만 정확히 전달하되, 복잡한 설정은 데스크톱에서 하도록 유도
5. **Zero API Overhead**: 가능한 한 기존 데이터를 최대한 활용. 새 API 최소화
