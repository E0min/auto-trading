# Round 6 교차 리뷰 -- Engineer 관점

**작성일**: 2026-02-16
**작성자**: Senior Systems Engineer (Claude Opus 4.6)
**기준**: 시스템 무결성, 장애 허용, 보안, 동시성, 메모리 관리, 관측성

---

## Trader 제안 리뷰

### R6-1: ExposureGuard 시장가 주문 가격 주입 -- ✅ 동의 (보완 사항 있음)

**분석 정확성**: Trader의 코드 분석이 정확하다. 직접 확인한 결과:
- `exposureGuard.js:85`에서 `order.price || '1'` 폴백이 존재
- `orderManager.js:257`에서 `price: price || '0'`으로 전달
- JavaScript에서 `'0'`은 truthy이므로 `'0' || '1'` = `'0'`이 맞다
- `multiply(qty, '0')` = `'0'` -> orderValue = 0 -> 모든 포지션 크기 검증 무력화

**제안된 수정의 안전성**: Trader의 2단계 방어(OrderManager에서 가격 주입 + ExposureGuard에서 reject) 접근이 올바르다. Engineer 자체 제안(R6-3)과도 일치한다.

**보완**: OrderManager의 가격 소스를 `signal.suggestedPrice || signal.price`로 한정하는 것에 동의하지만, `tickerAggregator`에서 최신 가격을 가져오는 추가 폴백이 있으면 더 견고하다. 이유: 전략이 suggestedPrice를 누락할 수 있고(특히 CLOSE 시그널), 이 경우 가격이 `'0'`으로 남는다. 그러나 ExposureGuard의 reject 방어가 2차 안전망이므로 현재 제안만으로도 충분하다.

**우선순위 동의**: HIGH. 실거래 시 리스크 관리 완전 무력화 문제이므로 T1(실거래 전 필수).

---

### R6-2: 레버리지 설정 메커니즘 구현 -- ⚠️ 조건부 동의

**문제 인식 정확**: `exchangeClient.js`에 `setLeverage()` 메서드가 없고, 전략 시그널의 `leverage` 필드가 완전히 무시되는 것은 사실이다. 이것은 Engineer 자체 제안(R6-4)과 동일한 발견이다.

**Trader 제안의 접근법에 대한 의견**:

1. **Step 1 (ExchangeClient.setLeverage)**: ✅ 동의. Bitget API `setFuturesLeverage`를 래핑하는 표준 패턴이며 `_withRetry`를 사용하여 일시적 장애에 대응한다. `holdSide` 옵션 포함도 적절하다.

2. **Step 2 (_setStrategyLeverages에서 "최대값" 전략)**: ⚠️ 우려. 여러 전략이 같은 심볼에 다른 레버리지를 요구할 때 **최대값**을 선택하는 것은 위험할 수 있다.

   예시: StrategyA는 `leverage: '2'`, StrategyB는 `leverage: '5'`로 같은 심볼을 거래. 최대값 5x가 설정됨. StrategyA의 포지션 크기 계산은 2x를 기준으로 했으므로, 실제 5x 레버리지에서 **의도한 것보다 2.5배 높은 리스크 노출**이 발생한다.

   **대안**: Trader 제안의 "주문 시점마다 레버리지 설정" 방식(Engineer R6-4 Step B에서 제안)이 더 안전하다. 다만 Bitget API 호출 빈도가 증가한다. 레버리지가 동일한 값이면 API 호출을 건너뛰는 캐시를 추가하면 해결 가능:

   ```javascript
   // 심볼별 현재 설정된 레버리지 캐시
   this._leverageCache = new Map(); // symbol -> leverage

   async _ensureLeverage(symbol, category, leverage) {
     if (this._leverageCache.get(symbol) === leverage) return;
     await this.exchangeClient.setLeverage({ symbol, category, leverage });
     this._leverageCache.set(symbol, leverage);
   }
   ```

3. **Step 3 (paperMode 제외)**: ✅ 동의. Paper 모드에서 레버리지 API를 호출할 필요 없음. 그러나 `PaperPositionManager`에서도 leverage 반영이 필요하다는 점은 Trader가 언급하지 않았다. PaperPositionManager의 수익 계산이 leverage를 무시하면 Paper 결과와 Live 결과에 괴리가 생긴다.

**결론**: 기본 구현(setLeverage 메서드 추가)은 진행하되, 봇 시작 시 "최대값 일괄 설정" 대신 "주문 시점 per-signal 설정 + 캐시"로 변경을 권장한다.

---

### R6-3: qty 표준화 레이어 및 getAccountInfo 크래시 수정 -- ✅ 동의

**분석 정확성**: 직접 확인 완료.
- `botService.js:996`에서 `this.exchangeClient.getAccountInfo()` 호출
- `exchangeClient.js`에 `getAccountInfo` 메서드 부재 (grep 결과 0건)
- 존재하는 메서드: `getBalances(category)` (줄 163)
- Paper mode 분기(줄 992-993)로 인해 이 버그가 마스킹됨

**수정 방안 평가**: Trader의 `positionManager.getAccountState().equity` 활용 + REST fallback 접근이 적절하다. Engineer 자체 제안(R6-2)에서도 동일한 접근을 제시했다.

**추가 고려사항**: `positionManager.getAccountState()`는 `_accountState`의 shallow copy를 반환한다 (줄 394-396 확인). equity가 `'0'`인 초기 상태에서 시그널이 발생하면 REST fallback이 동작해야 하므로 Trader의 fallback 패턴이 필수적이다.

**CLOSE 시그널 qty 문제**: Trader의 분석이 정확하다.
- `_resolveSignalQuantity()`에서 CLOSE는 bypass (줄 986-988)
- 전략들이 `suggestedQty`에 퍼센트 값을 넣음 (예: '5')
- Bitget에서 `size: '5'`는 5 BTC를 의미
- 거래소가 보유 초과 수량을 reject하므로 자금 손실은 없으나, **포지션이 청산되지 않는** 심각한 문제

**수정 방안**: `PositionManager.getPosition(symbol, posSide)`에서 실제 수량을 조회하는 Trader의 접근이 올바르다. 다만 `positionManager.getPosition()`은 `Map<symbol:posSide, position>`에서 조회하므로 전략명으로 필터링하지 않는다. 같은 심볼에 여러 전략이 포지션을 가질 경우 수량이 합산된다. 현재 시스템에서 심볼당 하나의 포지션만 유지하므로 문제 없지만 향후 확장 시 주의 필요.

---

### R6-4: 전략 positionSide 조기 설정 제거 -- ⚠️ 조건부 동의

**문제 인식 정확**: 직접 확인 완료.
- `RsiPivotStrategy.js:283-284`에서 `emitSignal()` 전에 `_positionSide = 'long'`, `_entryPrice = close` 설정
- `SupertrendStrategy.js:204-223`에서 `onFill()` 내부에서만 설정 (모범 패턴)
- SignalFilter 차단 시 전략이 "유령 포지션" 상태에 빠지는 시나리오가 실재함

**우려 사항 1 -- 작업 범위**: 15+ 전략 파일을 일괄 수정하는 것은 회귀 위험이 높다. 각 전략의 `onKline()` 내부에서 `_positionSide`와 `_entryPrice`를 참조하는 방식이 미묘하게 다르므로, 기계적 치환이 아니라 전략별 개별 검증이 필요하다.

예를 들어:
- `RsiPivotStrategy`는 `if (this._entryPrice !== null) return;` (줄 247)으로 중복 진입을 방지
- `AdaptiveRegimeStrategy`는 `_entryRegime`, `_highestSinceEntry`, `_lowestSinceEntry` 등 추가 상태가 있어 onFill에서의 설정이 더 복잡

**우려 사항 2 -- onFill 호출 보장**: `onFill()`이 반드시 호출된다는 전제가 필요하다. 현재 `BotService`에서 `onFill`을 호출하는 경로를 확인해야 한다. 만약 Paper 모드에서 `PaperEngine`의 fill이 전략의 `onFill()`에 올바르게 전달되지 않는 경우가 있다면, 이 리팩토링 후 전략이 영구적으로 "포지션 없음" 상태에 빠질 수 있다 (현재의 "유령 포지션"과 반대 문제).

**우려 사항 3 -- 구현 순서**: R6-4는 다른 모든 크리티컬 수정(R6-1, R6-3, R6-5)이 완료된 후에 진행해야 한다. 전략 15개를 동시에 수정하면서 다른 핵심 로직도 바뀌면 디버깅이 극도로 어려워진다.

**권장 접근**:
1. Phase 1: `RsiPivotStrategy`와 `AdaptiveRegimeStrategy` 2개만 먼저 수정 (가장 명확한 케이스)
2. Phase 2: Paper 모드에서 충분히 검증 후 나머지 전략으로 확장
3. 각 전략별로 "시그널 emit -> SignalFilter 차단 -> 다음 onKline에서 재진입 가능" 시나리오를 테스트

---

### R6-5: exchangeClient.getAccountInfo 미존재 메서드 호출 -- ✅ 동의

R6-3과 동일한 이슈를 별도 항목으로 분리한 것. 강조 자체에 동의한다. **CRITICAL** 심각도가 적절하다.

다만 Engineer 자체 분석에서 R6-1(`riskEngine.getAccountState()` 부재)과 R6-2(`exchangeClient.getAccountInfo()` 부재)를 이미 T0으로 분류했으므로, 3-agent 모두 이 이슈를 최우선으로 인식하고 있다.

---

### R6-6: BotService 실거래 모드 시그널 처리에 await 누락 -- ✅ 동의

**분석 정확성**: 직접 확인 완료 (`botService.js:1072-1084`).

```javascript
this.orderManager.submitOrder({ ... }).catch((err) => { ... });
```

`submitOrder`는 async이고 `.catch()`로 에러를 처리하지만, `_handleStrategySignal`에서 await하지 않는 fire-and-forget 패턴이다.

**동시성 위험 분석**:
- `OrderManager.submitOrder()`에는 per-symbol mutex가 있으므로 (줄 166-172), 같은 심볼에 대한 동시 주문은 직렬화된다.
- 그러나 `_resolveSignalQuantity()`는 mutex **외부**에서 실행되므로, 같은 전략이 빠르게 2개 시그널을 보내면 equity 기반 qty 계산이 동시에 실행되어 의도보다 큰 노출이 발생할 수 있다.

**수정의 안전성**: `await` 추가는 시그널 처리를 직렬화한다. 이로 인해 시그널 처리 지연이 발생할 수 있으나, 거래소 주문 실행 시간(100-500ms)을 고려하면 수용 가능하다. 한 전략이 초당 수십 개의 시그널을 보내는 것은 비정상이므로.

**우선순위**: MEDIUM이 적절. 실거래에서 즉각적 자금 손실보다는 "의도보다 큰 포지션" 수준의 위험이므로 T0/T1 수정 후 처리.

---

### R6-7: CLOSE 시그널 qty가 퍼센트 값으로 전달 -- ✅ 동의

R6-3에 포함된 내용의 별도 강조. 분석이 정확하며 수정 방안도 적절하다.

추가 검증: Bitget 거래소는 보유 수량 초과 청산 요청 시 에러를 반환한다는 Trader의 주장은 합리적이다. 따라서 자금 손실이 아닌 "청산 실패"가 실제 영향이다. 이것은 오히려 더 위험할 수 있다 -- 손절 시점에 포지션이 청산되지 않으면 손실이 확대된다.

---

## UI/UX 제안 리뷰

### S1-1: 전략별 레짐 호환성 매트릭스 표시 -- ✅ 동의

**백엔드 영향**: 없음. 기존 `GET /api/regime/strategy-routing` API의 `regimeBreakdown` 데이터를 활용하므로 추가 API 불필요.

**기술적 검토**:
- `regimeBreakdown[regime].active: string[]` 구조가 이미 존재
- 19개 전략 x 5개 레짐 = 95셀의 매트릭스는 렌더링 부담 없음
- `translateStrategyName`으로 한글 표시 가능

**우려**: 현재 레짐 강조와 활성 전략 강조를 동시에 표시하면 시각적으로 복잡해질 수 있다. 초기 구현은 단순 dot 매트릭스로 시작하고, 인터랙션(hover 시 상세 정보 등)은 후속 이터레이션으로 미루는 것을 권장.

---

### S1-2: 레버리지 값 표시 강화 -- ✅ 동의

**백엔드 영향**: 없음. 포지션 데이터에 이미 `leverage` 필드가 포함됨.

기존 PositionsTable에 이미 구현되어 있고, StrategyDetail과 Tournament의 포지션 탭에만 컬럼 추가하는 단순 작업이다. 30분 예상이 현실적이다.

---

### S1-3: 백테스트 결과에 disclaimer 추가 -- ✅ 동의

**백엔드 영향**: 없음. 순수 프론트엔드 작업.

**분석 검증**: `backend/src/backtest/` 디렉토리에서 `leverage`, `fundingFee` 관련 코드가 없음을 확인했다. 백테스트 엔진이 이 두 요소를 반영하지 않는 것이 사실이다.

**중요도**: 실거래 전환 시 사용자가 백테스트 결과를 과신하는 것은 심각한 리스크다. 특히 레버리지 미반영은 수익률을 실제보다 낮게 표시하고, 펀딩비 미반영은 수익률을 실제보다 높게 표시할 수 있어 오해의 소지가 크다.

**추가 권장**: disclaimer 텍스트에 "슬리피지/수수료는 설정값 기준 근사치"라는 문구가 포함된 것이 좋다. 현재 BacktestEngine에서 슬리피지/수수료를 적용하고 있으므로 이 부분은 정확히 "근사치"라고 표현하는 것이 맞다.

---

### R6-1 (UI): StrategyDetail 디자인 토큰 마이그레이션 -- ✅ 동의

**백엔드 영향**: 없음. 순수 CSS 클래스 교체.

디자인 시스템 일관성 복원은 유지보수성에 기여한다. `zinc-*` 직접 참조가 30곳 이상이라는 분석이 맞다면 40분 예상이 현실적이다. status color(`bg-emerald-500/20` 등)를 유지하는 판단도 적절하다.

---

### R6-2 (UI): Toast 알림 시스템 -- ⚠️ 조건부 동의

**백엔드 영향**: 없음. 순수 프론트엔드 작업.

**동의 사항**: `alert()`는 메인 스레드를 차단하고 UX가 불일치하므로 교체해야 한다.

**보완 사항**:
1. **자체 구현 vs 라이브러리**: Toast는 접근성(ARIA live region, focus management), 애니메이션, 중첩(stacking), 자동 해제 등 edge case가 많다. `sonner`는 0.4KB gzipped이고 이 모든 것을 처리한다. 프로덕션 시스템에서 자체 구현 Toast로 접근성 버그를 만들 것보다 검증된 라이브러리를 사용하는 것이 시스템 무결성 관점에서 더 안전하다. 다만 현재 프로젝트의 외부 의존성 최소화 방침에 따라 자체 구현을 우선하되, `role="alert"` + `aria-live="polite"` 적용은 필수.

2. **Portal 사용**: App Router에서 `createPortal`은 `useEffect` 내에서 `document.body`를 참조해야 한다. 간단한 `fixed` 포지셔닝으로 충분하며 Portal은 불필요하다.

3. **예상 시간**: 2시간은 접근성을 포함한 견고한 구현 기준으로 적절하다.

---

### R6-3 (UI): error.tsx 디자인 토큰 마이그레이션 -- ✅ 동의

15분으로 완료 가능한 단순 작업. 에러 바운더리는 사용자에게 보이는 중요한 화면이므로 디자인 일관성이 필요하다.

---

### R6-4 (UI): 백테스트 삭제 ConfirmDialog 추가 -- ✅ 동의

**시스템 안전성 관점**: 삭제는 비가역 작업이다. 토너먼트 페이지에서 이미 `ConfirmDialog`를 사용하고 있으므로 일관성을 위해 백테스트 삭제에도 적용해야 한다. `ConfirmDialog` 컴포넌트가 이미 존재하므로 재사용만 하면 된다.

---

### R6-5 (UI): AccountOverview 반응형 개선 -- ✅ 동의

`grid-cols-4`를 `grid-cols-2 md:grid-cols-4`로 변경하는 단순 작업. 모바일에서 금액이 잘리는 것은 트레이더에게 치명적 UX 문제이므로 즉시 수정이 적절하다.

---

### R6-6 (UI): BacktestTradeList 마진 수정 -- ✅ 동의

`-mx-4`를 `-mx-6`으로 변경하는 5분 작업. 시각적 일관성 개선.

---

### R6-7 (UI): Chart Tooltip 스타일 상수 통합 -- ✅ 동의

`borderRadius` 6px vs 8px, `fontSize` 11px vs 12px 불일치는 사소하지만, 공유 상수로 통합하면 향후 디자인 변경 시 일관성이 보장된다. Recharts의 `contentStyle`이 인라인 스타일 객체이므로 JS 상수(`lib/chart-config.ts`)가 적절하다는 판단에 동의.

---

### R6-8 (UI): 네비게이션 접근성 강화 -- ✅ 동의

`aria-disabled="true"` 추가는 접근성 표준 준수 사항이다. `title` 속성의 터치 디바이스 미지원 문제도 정확한 지적이다. `<span>`에 `role="link"` + `aria-disabled="true"`를 추가하고, `title` 대신 `aria-label`을 사용하는 것을 권장.

---

### R6-9 (UI): BotControlPanel Live 확인 ConfirmDialog 전환 -- ✅ 동의

인라인 다이얼로그를 `ConfirmDialog` 컴포넌트로 교체하는 것은 코드 중복 제거 + 일관성 강화. **실거래 시작**은 시스템에서 가장 중요한 사용자 액션이므로, 확인 다이얼로그의 안정성이 높아야 한다. 검증된 공유 컴포넌트를 사용하는 것이 옳다.

---

### R6-10 (UI): 백테스트 심볼 입력 개선 -- ⚠️ 조건부 동의

**옵션 A (프리셋 + 자유 입력)**: ✅ 동의. 백엔드 변경 없이 즉시 구현 가능.

**옵션 B (백엔드 API)**: ⚠️ 주의. 새 API 엔드포인트를 추가하면 인증, rate limiting, 에러 처리 등 추가 작업이 필요하다. 현재 스프린트에서는 옵션 A만 구현하는 것이 적절하다.

**보완**: 심볼 입력 후 백엔드에서 "해당 심볼의 kline 데이터 없음" 에러가 발생할 때, 현재 에러 메시지가 사용자에게 명확히 전달되는지 확인 필요. 프리셋을 제공하더라도 자유 입력을 허용하므로 클라이언트 측 입력 검증(대문자 강제, 공백 제거, "USDT" 접미사 확인)이 필요하다.

---

### R6-11 (UI): SignalFeed/TradesTable 높이 동기화 -- ✅ 동의

레이아웃 일관성 개선. `max-h-[400px]` 고정이 아닌 `max-h-[500px]` 또는 부모 높이에 맞춘 `flex` 기반 접근이 더 적절할 수 있다.

---

### R6-12 (UI): StrategySymbolMap 테이블 스타일 정규화 -- ✅ 동의

10분으로 완료 가능한 단순 작업. `<th>`에 `text-left`/`text-right` 명시적 추가.

---

## 3-Agent 공통 이슈 분류

| 이슈 | Trader | Engineer | UI | 합의 수준 |
|------|--------|----------|-----|-----------|
| `getAccountInfo()` 미존재 메서드 (런타임 크래시) | R6-3/R6-5 (CRITICAL) | R6-2 (T0) | -- | **3-agent 합의: 최우선 수정** |
| `riskEngine.getAccountState()` 미존재 메서드 | -- | R6-1 (T0) | -- | Engineer 단독 발견. Trader R6-3의 수정안이 이를 우회하지만, 근본 수정 필요 |
| ExposureGuard 시장가 가격 문제 | R6-1 (HIGH) | R6-3 (T1) | -- | **3-agent 합의: 실거래 전 필수** |
| 레버리지 관리 부재 | R6-2 (HIGH) | R6-4 (T1) | S1-2 (표시 보완) | **3-agent 합의: 구현 필요**. 접근법 차이 있음 (아래 참조) |
| CLOSE 시그널 qty 퍼센트 문제 | R6-7 (HIGH) | R6-14에서 부분 언급 | -- | Trader+Engineer 합의. UI 영향 없음 |
| positionSide 조기 설정 문제 | R6-4 (HIGH) | -- | -- | Trader 단독 발견. Engineer 검증 결과 문제 실재 확인 |
| submitOrder await 누락 | R6-6 (MEDIUM) | -- | -- | Trader 단독 발견. Engineer 검증 결과 동의 |
| destroy() 미호출 (WS 리스너 누수) | -- | R6-5 (T1) | -- | Engineer 단독 발견 |
| SignalFilter stale 누적 | -- | R6-6 (T2) | -- | Engineer 단독 발견. Trader R6-4와 간접 연관 |
| Socket.io CORS/인증 미적용 | -- | R6-7 (T2) | Engineer에게 요청 #1 | **Engineer+UI 합의: 보안 필수** |
| Socket.io ticker throttle | -- | R6-8 (T2) | Engineer에게 요청 #2 | Engineer 단독. UI에서 빈도 감소 영향 확인 필요 |
| 백테스트 disclaimer | Trader (UI 요청) | -- | S1-3 (높음) | **Trader+UI 합의** |
| 전략-레짐 매트릭스 | Trader (UI 요청) | -- | S1-1 (중간) | **Trader+UI 합의** |
| 디자인 토큰 불일치 | -- | -- | R6-1, R6-3 (UI) | UI 단독 발견 |
| Toast 시스템 | -- | -- | R6-2 (UI) | UI 단독 발견 |
| PaperEngine reset() 부재 | -- | R6-9 (T2) | -- | Engineer 단독 발견 |
| 심볼별 lot step 부재 | Trader (R6-3 부분) | R6-14 (T3) | -- | Trader+Engineer 합의, Phase 2로 미루기 적합 |

### 레버리지 구현 접근법 차이

- **Trader**: 봇 시작 시 전략별 최대 레버리지를 일괄 설정
- **Engineer (자체 R6-4)**: 주문 시점마다 signal.leverage로 설정, OrderManager에서 처리

**Engineer 권장**: 주문 시점 설정 + 캐시 방식. 이유:
1. 같은 심볼에 다른 레버리지의 전략이 동시에 활성화될 수 있음
2. 전략이 동적으로 활성화/비활성화될 때 레버리지가 자동 조정됨
3. API 호출 비용은 캐시로 최소화 가능

---

## 스프린트 우선순위 의견

### Phase 0: 런타임 크래시 수정 (30분) -- 즉시 실행

| 항목 | 근거 |
|------|------|
| Engineer R6-1: `riskEngine.getAccountState()` 추가 | T0. 전략 equity 주입 크래시 |
| Trader R6-5/Engineer R6-2: `getAccountInfo()` -> `getBalances()` | T0. 모든 OPEN 시그널 실패 |

이 두 건은 **실거래 모드를 완전히 무효화하는 크래시 버그**이다. 다른 모든 작업보다 선행해야 한다.

### Phase 1: 리스크 계산 정상화 (1.5시간) -- 크래시 수정 직후

| 항목 | 근거 |
|------|------|
| Trader R6-1/Engineer R6-3: ExposureGuard 가격 주입 | 리스크 관리 완전 무력화 방지 |
| Trader R6-7: CLOSE 시그널 qty 수정 | 포지션 청산 실패 방지 |
| Trader R6-6: submitOrder await 추가 | 동시성 안전 (15분으로 빠르게 처리 가능) |

### Phase 2: 리소스 관리 (1시간) -- Phase 1 직후

| 항목 | 근거 |
|------|------|
| Engineer R6-5: destroy() 호출 추가 | WS 리스너 누적 방지 |
| Engineer R6-9: PaperEngine reset() | 세션 간 stale 데이터 방지 |
| Engineer R6-11: SignalFilter _strategyMeta 정리 | 5분으로 빠르게 처리 |

### Phase 3: 보안 (30분) -- Phase 2 직후

| 항목 | 근거 |
|------|------|
| Engineer R6-7: Socket.io CORS + 인증 | 거래 데이터 도청 방지 |
| Engineer R6-8: ticker throttle | 서버 부하 절감 + 대역폭 절약 |

### Phase 4: 레버리지 (1.5시간) -- Phase 3 이후

| 항목 | 근거 |
|------|------|
| Trader R6-2/Engineer R6-4: setLeverage 구현 | 전략 의도대로 레버리지 설정 |

Phase 3까지의 안정화가 선행되어야 한다. 레버리지 설정은 거래소 API 호출이 추가되므로 시스템이 안정된 후 진행.

### Phase 5: 전략 상태 일관성 (별도 스프린트 권장)

| 항목 | 근거 |
|------|------|
| Trader R6-4: positionSide 조기 설정 제거 | 15+ 파일 변경. 회귀 위험 높음 |

이 작업은 **별도 스프린트**로 분리를 권장한다. 이유:
1. 15개 이상의 전략 파일을 동시에 수정하면 회귀 버그 발생 가능
2. 각 전략의 상태 관리 패턴이 미묘하게 다름
3. 충분한 Paper mode 검증 기간이 필요
4. Phase 0-4의 수정사항이 안정화된 후 진행해야 함

### Phase 6: UI 개선 (병렬 진행 가능)

UI 제안은 백엔드 변경과 독립적이므로 Phase 0-2와 병렬 진행 가능:

| 우선순위 | 항목 | 시간 |
|----------|------|------|
| 1 | S1-3: 백테스트 disclaimer | 20분 |
| 2 | R6-5 (UI): AccountOverview 반응형 | 10분 |
| 3 | R6-6 (UI): BacktestTradeList 마진 | 5분 |
| 4 | R6-4 (UI): 백테스트 삭제 ConfirmDialog | 15분 |
| 5 | R6-1 (UI): StrategyDetail 토큰 마이그레이션 | 40분 |
| 6 | R6-3 (UI): error.tsx 토큰 마이그레이션 | 15분 |
| 7 | S1-2: 레버리지 표시 보완 | 30분 |
| 8 | S1-1: 전략-레짐 매트릭스 | 1.5시간 |

단, **R6-7 (Socket.io CORS/인증)이 구현되면** 프론트엔드 Socket.io 클라이언트에도 `auth.token` 전달 수정이 필요하므로 이 부분은 Phase 3와 동기화해야 한다.

---

## 총평

### 핵심 판단

현재 시스템은 **Paper mode에서만 안전하게 동작하는 상태**이다. 실거래 모드에는 최소 2건의 런타임 크래시(R6-1/Eng, R6-2/Eng = R6-5/Trader), 1건의 리스크 관리 무력화(R6-1/Trader = R6-3/Eng), 1건의 청산 실패(R6-7/Trader) 문제가 있다.

Trader의 제안은 **실거래 경로의 결함**에 정확히 초점을 맞추고 있으며, 코드 레벨 분석의 정확도가 매우 높다. 특히 CLOSE 시그널 qty 문제(R6-7)와 positionSide 조기 설정(R6-4)은 Trader만이 발견한 실전적 관점의 이슈다.

UI의 제안은 **사용자 안전과 디자인 일관성**에 초점을 맞추고 있으며, 백엔드 영향이 거의 없어 병렬 진행에 적합하다. 특히 S1-3(disclaimer)은 법적 보호와 사용자 오해 방지 측면에서 높은 우선순위가 정당하다.

3-agent 모두 `getAccountInfo()` 크래시와 ExposureGuard 문제를 최우선으로 인식하고 있어 합의 수준이 높다. 레버리지 구현의 접근법 차이(일괄 vs 주문시점)는 추가 논의가 필요하나, "구현해야 한다"는 결론에는 이견이 없다.

### 총 예상 시간

- **Phase 0-4 (백엔드)**: ~5시간
- **Phase 5 (전략 리팩토링)**: ~2시간 (별도 스프린트 권장)
- **Phase 6 (프론트엔드)**: ~3.5시간 (병렬 진행)
- **실질 소요**: ~5시간 (백엔드) + ~3.5시간 (프론트엔드 병렬) = **5시간 벽시계 기준**

---

*End of Round 6 Cross-Review*
