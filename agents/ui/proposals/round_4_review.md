# Round 4 Review: Tier 2 Quality (12건) — UI/UX 관점

**Reviewer**: Senior UI/UX Engineer (U)
**Date**: 2026-02-15
**Reviewed**: Trader 제안서 (round_4.md) + Engineer 제안서 (round_4.md)
**Scope**: 사용자 경험(UX) 관점 전면 리뷰

---

## Trader 제안서 리뷰

### T2-1: RSI Wilder Smoothing 구현

**판정: ✅ 동의**

트레이딩 정확도 개선은 백테스트 결과의 신뢰성에 직결된다. 사용자가 백테스트 결과를 TradingView 등 외부 도구와 비교할 때 불일치가 없어야 하므로 Wilder 기본값 변경은 합당하다.

> **[특별 검토: `wilder` 파라미터의 백테스트 UI 노출 여부]**
>
> 결론: **고급 설정에 노출할 필요 없음**. 현재 `BacktestForm.tsx`의 "고급 설정" 영역에는 수수료/슬리피지만 있다. RSI smoothing은 전략 내부 구현 세부사항이며, 일반 사용자가 'wilder' vs 'sma'를 구분하여 결정을 내릴 상황이 아니다. 만약 노출한다면 사용자에게 불필요한 인지 부하를 추가한다. 다만, 백테스트 결과 상세 패널(`BacktestStatsPanel`)에 "RSI 방식: Wilder" 같은 **읽기 전용 메타데이터 표기**는 유용하다. 이렇게 하면 결과 비교 시 어떤 설정으로 돌렸는지 식별 가능하다.

---

### T2-2: Confidence-based Signal Filtering

**판정: ✅ 동의**

낮은 confidence 시그널의 무분별 통과는 트레이더가 SignalFeed에서 "왜 이렇게 시그널이 많은데 수익은 안 나지?"라고 혼란스러워하는 핵심 원인이 된다. UX 관점에서도 고품질 시그널만 보여주는 것이 정보 밀도를 높인다. `riskLevel` 기반 자동 매핑(low:0.50, medium:0.55, high:0.60) 제안은 합리적이다.

단, T2-8(rejectReason 표시)과 반드시 함께 구현해야 한다. confidence 필터링이 추가되면 거부 시그널이 급증할 텐데, 사용자가 "왜 거부되었는지" 모르면 오히려 불안감이 커진다.

---

### T2-3: Backtest Position Size 전략 메타 기반

**판정: ✅ 동의**

95% 고정 포지션이 4% 전략과 동일하게 백테스트되는 문제는 사용자에게 **거짓 기대**를 심는 심각한 UX 결함이다. 백테스트 결과의 PnL이 현실과 20배 이상 차이가 날 수 있다.

**UX 보완 제안**: 백테스트 결과 화면에 "포지션 크기: 전략 기본(5%)" 또는 "포지션 크기: 글로벌 기본(15%)" 같이 사용된 포지션 사이즈를 명시적으로 표시해야 한다. 이전 결과(95%)와 새 결과 사이의 불일치를 사용자가 이해할 수 있도록.

---

### T2-4: FundingRateStrategy 데이터 소스 구축

**판정: ✅ 동의**

전략이 완전히 비활성인 상태는 사용자 관점에서 "전략을 활성화했는데 왜 시그널이 안 나오지?"라는 최악의 UX이다. UI에서는 FundingRateStrategy가 정상적으로 활성화된 것으로 표시되지만 실제로는 아무것도 하지 않는 **침묵 실패(silent failure)** 패턴이다.

Trader의 REST polling 기반 제안은 안정적이다. 다만 폴링 상태를 UI에서 확인할 수 있어야 한다. 전략 상세 패널에서 "마지막 펀딩비 데이터 수신: 5분 전" 같은 데이터 freshness 표시를 권장한다.

---

### T2-5: GridStrategy Equity 주입

**판정: ✅ 동의**

T2-4와 동일한 침묵 실패 문제. `setAccountContext()` DI 패턴은 StrategyBase 레벨에서 해결하므로 확장성이 좋다.

---

### T2-7: API Rate Limiting (Trader의 의견)

**판정: ✅ 동의** (설정값에 대해)

Trader가 제안한 엔드포인트별 rate limit 설정값은 실제 프론트엔드 폴링 패턴과 부합한다. 특히 `/api/bot/*`에 분당 60회는 5초 폴링(분당 12회)의 5배 여유를 제공하여 합리적이다. `/api/backtest/run`에 분당 3회도 CPU 집약적 작업 특성에 맞다.

---

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한 (Trader의 의견)

**판정: ✅ 동의**

Trader의 제안(100개 이상일 때만 정리)은 빈번한 정리를 방지하면서도 배열 크기를 제한한다. UX에 직접 영향은 없으나, 장기 운영 안정성은 사용자 신뢰에 영향한다.

---

### T2-6: useSocket 목적별 분리

**판정: ⚠️ 조건부 동의**

**현재 상태 분석**: `useSocket()`의 소비처는 `frontend/src/app/page.tsx` 1곳뿐이다 (line 60). 여기서 `signals`, `regime`, `symbolRegimes`, `riskEvents`를 destructuring하되, `lastTicker`와 `positions`는 사용하지 않는다.

**문제 인식은 정확하다**: ticker 이벤트가 고빈도로 들어올 때 `setState`를 통해 전체 `SocketState` 객체를 재생성하면, `signals`나 `riskEvents`만 구독하는 컴포넌트까지 불필요하게 리렌더된다.

**보완 조건**:
1. 현재 소비처가 1곳이므로 **4개 훅 분리는 과도한 엔지니어링**이다. 대신 `useMemo` + `useRef`를 활용한 **선택적 리렌더링 패턴**으로 동일 효과를 얻을 수 있다. 구체적으로, `lastTicker`를 `useRef`로 관리하면 ticker 업데이트 시 리렌더가 발생하지 않는다.
2. 만약 향후 페이지가 3개 이상으로 늘어나고, 각 페이지가 다른 이벤트 서브셋만 필요하다면 그때 분리해도 늦지 않다.
3. 분리하는 경우에도 **기존 `useSocket`을 facade로 유지**하여 현재 소비처 코드 변경을 최소화해야 한다.

---

### T2-8: SignalFeed rejectReason 표시

**판정: ⚠️ 조건부 동의**

기본 방향(거부 시 사유 표시)은 필수적이다.

> **[특별 검토: `translateRejectReason()` 번역 키 목록 충분성]**
>
> Trader가 제안한 번역 키: `circuit_breaker_active`, `exposure_limit`, `confidence_too_low`.
>
> **불충분하다.** 실제 백엔드 코드를 분석한 결과, 다음 rejectReason 값들이 존재한다:
>
> | 소스 | rejectReason 값 | Trader 제안 번역 | 누락 여부 |
> |------|-----------------|-----------------|-----------|
> | RiskEngine | `equity_not_initialized` | - | **누락** |
> | CircuitBreaker | `circuit_breaker_active` | "서킷 브레이커" | 포함 |
> | DrawdownMonitor | `daily_loss_exceeded` | - | **누락** |
> | DrawdownMonitor | `max_drawdown_exceeded` | - | **누락** |
> | ExposureGuard | `equity_not_initialized` | - | **누락** |
> | ExposureGuard | `total_exposure_exceeded` | - | **누락** |
> | SignalFilter | `cooldown: ...` | - | **누락** |
> | SignalFilter | `duplicate: ...` | - | **누락** |
> | SignalFilter | `max_concurrent: ...` | - | **누락** |
> | SignalFilter | `conflict: ...` | - | **누락** |
> | T2-2 (신규) | `low_confidence: ...` (또는 `confidence_too_low`) | "신뢰도 부족" | 포함 |
> | OrderManager | `Risk validation error: ...` | - | **누락** |
> | OrderManager | `Exchange error: ...` | - | **누락** |
>
> **보완 필요**: `translateRejectReason()` 함수는 prefix 매칭 방식으로 구현해야 한다. SignalFilter의 reason은 `cooldown: MaTrendStrategy must wait 30s` 같은 동적 문자열이므로, `startsWith()` 기반 매칭이 필요하다.
>
> **제안하는 전체 번역 맵**:
> ```typescript
> export function translateRejectReason(reason: string): string {
>   if (reason.startsWith('cooldown:')) return '쿨다운 대기';
>   if (reason.startsWith('duplicate:')) return '중복 시그널';
>   if (reason.startsWith('max_concurrent:')) return '최대 동시 포지션 초과';
>   if (reason.startsWith('conflict:')) return '반대 시그널 충돌';
>   if (reason.startsWith('low_confidence:') || reason.startsWith('confidence_too_low')) return '신뢰도 부족';
>   const map: Record<string, string> = {
>     circuit_breaker_active: '서킷 브레이커 발동',
>     daily_loss_exceeded: '일일 손실 한도 초과',
>     max_drawdown_exceeded: '최대 드로다운 초과',
>     total_exposure_exceeded: '총 노출 한도 초과',
>     equity_not_initialized: '자산 미초기화',
>   };
>   return map[reason] || reason;
> }
> ```
>
> 또한 raw reason을 `title` 속성으로 유지하여, 번역이 부족하더라도 원문을 마우스 오버로 확인할 수 있게 해야 한다.

**추가 UX 제안**: 현재 SignalFeed의 최대 높이가 400px (`max-h-[400px]`)인데, rejectReason 텍스트가 추가되면 각 시그널 항목의 높이가 증가한다. `truncate`로 1줄로 제한하고 hover 시 풀텍스트 tooltip을 보여주는 방식이 적절하다. Engineer의 `truncate max-w-[120px]` 제안과 합치하되, 120px이 아닌 `max-w-[160px]` 정도가 한국어 4~6자를 표시하기에 적절하다.

---

### T2-10: Drawdown 시각화 차트

**판정: ⚠️ 조건부 동의**

> **[특별 검토: 수중곡선(underwater equity curve) UX 패턴 적절성]**
>
> **적절하다**, 하지만 단독 차트가 아닌 **기존 equity curve 아래 overlay** 방식을 권장한다.
>
> 근거:
> 1. 수중곡선은 전문 트레이더에게 익숙한 패턴이다. "현재 고점 대비 얼마나 빠져있는가"를 시각적으로 즉시 파악할 수 있다.
> 2. 다만 **독립 차트로 만들면** 대시보드에 카드가 하나 더 추가되어 스크롤이 길어진다. 현재 대시보드 레이아웃(`page.tsx`)은 이미 8개 이상의 섹션이 있다.
> 3. **권장 구현**: 기존 equity curve 차트 컴포넌트 아래에 **동기화된 축(synced x-axis)**으로 drawdown 영역 차트를 배치. Recharts의 `<ResponsiveContainer>` 2개를 세로로 쌓고, 동일한 x축 도메인을 공유. 이렇게 하면 equity curve의 하락 구간과 drawdown 깊이를 시각적으로 연결할 수 있다.
> 4. 색상: 0% 수평선 아래를 빨간 그라데이션(`fill: url(#drawdownGradient)`)으로 채워서 손실 심도를 직관적으로 표현.
>
> **데이터 소스 결정**: Engineer의 제안(프론트엔드에서 `/api/risk/status` 폴링 결과를 로컬 축적)은 **반대**한다. 이유:
> - 페이지 새로고침 시 모든 히스토리가 사라진다
> - 사용자가 기대하는 것은 세션 전체 기간의 drawdown 곡선이다
> - `/api/analytics/equity-curve/:sessionId` 데이터에서 프론트엔드 계산이 가장 현실적이다. peak tracking + drawdown % 계산은 클라이언트에서 O(n) 단일 패스로 가능하다

---

### T2-11: Risk Gauge 대시보드

**판정: ⚠️ 조건부 동의**

> **[특별 검토: Trader의 3개 게이지 vs UI의 종합 1개 비교]**
>
> **Trader의 3개 게이지(Drawdown/Exposure/Circuit Breaker)를 지지한다**, 하지만 형태를 재고해야 한다.
>
> **분석**:
> - 현재 `RiskStatusPanel.tsx`는 이미 3개 지표를 **바 형태(progress bar)**로 시각화하고 있다 (drawdown: h-1.5 bar, exposure: h-1.5 bar, circuit breaker: badge). 사실상 게이지 역할을 하고 있다.
> - "종합 1개 게이지"는 3가지 이질적 지표(%, %, boolean)를 하나의 수치로 합산해야 하는데, 이 합산 로직이 트레이더에게 직관적이지 않다. "종합 위험도 72%"라는 숫자가 drawdown 때문인지, exposure 때문인지 알 수 없다.
> - **3개 분리 게이지가 정보 투명성 면에서 우월**하다.
>
> **UI 형태 제안**:
> - 원형 게이지(circular gauge)는 3개를 나란히 놓으면 공간을 많이 차지한다. 현재 `RiskStatusPanel`이 카드 형태로 세로 배치되어 있으므로, **기존 progress bar를 강화하는 방향**이 더 효율적이다.
> - 구체적으로: progress bar의 높이를 `h-1.5`에서 `h-2.5`로 키우고, 숫자 라벨의 크기를 키우며, 색상 코딩을 3단계(green-yellow-red)로 적용하면 신규 컴포넌트 없이 기존 `RiskStatusPanel` 개선으로 충분하다.
> - 만약 반드시 새로운 시각적 형태를 원한다면, **반원형(semicircle) 게이지** 3개를 가로로 배치하는 것이 공간 효율적이다. 그러나 Recharts에는 이 패턴이 기본 제공되지 않으므로 SVG 직접 구현이 필요하다.
>
> **권장**: `RiskStatusPanel` 개선으로 진행하고, 별도 `RiskGauge.tsx` 컴포넌트 신규 생성은 보류. 기존 컴포넌트의 bar 높이/숫자 크기/색상 체계만 개선해도 게이지 효과를 달성할 수 있다.

---

### T2-12: 적응형 폴링

**판정: ✅ 동의**

봇 상태별 차등 폴링은 서버 부하 감소와 반응성 개선을 동시에 달성한다. Trader 제안의 간격(idle:30s, running+포지션:3s, running:10s, paused:15s, error:5s)은 합리적이다.

**UX 보완**:
- `useEffect` 의존성 배열에 `status.status`를 넣으면 상태 변경 시 interval이 즉시 바뀌어야 한다. `setInterval`을 동적으로 교체하는 패턴이 필요하다 (clearInterval + 새 setInterval).
- 현재 `useBotStatus`가 `pollInterval`을 prop으로 받는 인터페이스를 유지하되, 기본값을 adaptive로 변경하는 것이 좋다. 외부에서 강제 고정도 가능하게.
- Trader가 제안한 "포지션 유무"에 따른 분기(running+포지션:3s vs running:10s)는 `riskStatus.accountState.positionCount` 값으로 판단 가능하다. 이미 `useBotStatus`가 반환하는 `status` 객체에 포함되어 있어 추가 API 호출 불필요.

---

## Engineer 제안서 리뷰

### T2-9: CircuitBreaker rapidLosses 배열 크기 제한

**판정: ⚠️ 조건부 동의**

Engineer의 `shift()` 기반 in-place trim + 절대 최대 크기(500개) 안전장치는 깔끔하다. Trader의 `filter()` 기반 접근보다 메모리 효율이 좋다 (새 배열 미생성).

> **[특별 검토: trim 이벤트 로깅/모니터링 필요성]**
>
> **불필요하다.** 이유:
> 1. trim은 정상 운영의 일부이다. 윈도우 밖 타임스탬프 제거는 "이벤트"가 아니라 "유지보수"이다.
> 2. 로그에 trim 이벤트를 쓰면 DEBUG 레벨에서만 의미 있고, INFO 이상에서는 노이즈다.
> 3. 다만, **절대 최대(500개)에 의한 강제 trim**이 발생한 경우에만 WARN 로그를 남기는 것은 합리적이다. 이는 rapidLossWindow 설정이 현실에 맞지 않는다는 신호이기 때문이다.
>
> 요약: 윈도우 기반 정리 -> 로그 불필요. 절대 최대 초과 시 -> `log.warn('rapidLosses exceeded MAX_RAPID_LOSSES, forced trim', { count })` 1줄 추가 권장.

---

### T2-7: API Rate Limiting

**판정: ⚠️ 조건부 동의**

Engineer의 in-memory sliding window 구현은 단일 인스턴스에 적합하다. 코드 품질도 좋다 (`unref()`, cleanup 타이머 등).

> **[특별 검토: 429 응답 시 프론트엔드 UX 처리 방안]**
>
> **현재 `api-client.ts`의 `request()` 함수는 429를 일반 에러로 처리한다.** 사용자에게 "상태 조회 실패"라는 모호한 메시지가 표시된다. 이것은 나쁜 UX이다.
>
> **필요한 프론트엔드 보완**:
>
> 1. **`api-client.ts`에서 429 감지 및 자동 재시도**:
>    ```typescript
>    if (res.status === 429) {
>      const body = await res.json().catch(() => ({}));
>      const retryAfter = body.retryAfter || 60; // 서버가 보낸 retryAfter(초)
>      // 자동 재시도: retryAfter 후 1회 재시도
>      await new Promise(r => setTimeout(r, retryAfter * 1000));
>      return request<T>(endpoint, options); // 1회 재시도
>    }
>    ```
>    단, 무한 재시도 방지를 위해 재시도 횟수를 1회로 제한해야 한다.
>
> 2. **폴링 훅들의 자동 백오프**:
>    `useBotStatus`, `usePositions`, `useTrades` 등 폴링 훅에서 429 에러를 받으면 다음 폴링 간격을 2배로 늘리고, 성공 시 원래 간격으로 복귀하는 exponential backoff 패턴이 필요하다. 이렇게 하면 rate limit 상황에서 자연스럽게 요청 빈도가 줄어든다.
>
> 3. **사용자 알림**:
>    - 폴링 429: 사용자에게 알릴 필요 없음 (자동 백오프로 해결).
>    - 사용자 액션 429 (백테스트 실행, 주문 등): "요청이 너무 많습니다. {retryAfter}초 후 다시 시도하세요." 토스트 메시지를 표시해야 한다. 현재 Engineer의 응답 포맷에 `retryAfter` 필드가 있으므로 이를 활용.
>
> 4. **비정상 429 감지**:
>    - 정상 사용에서 429가 발생한다면 rate limit 설정이 너무 빡빡하다는 의미. Engineer의 critical limiter(분당 10회)는 프론트엔드에서 봇 시작/정지를 빠르게 반복하면 도달할 수 있다. Emergency stop이 rate limit에 걸리면 **안전 문제**이므로, emergency-stop 엔드포인트는 rate limit에서 제외하거나 별도 상한(분당 30회)을 적용해야 한다.
>
> **Engineer에게 요청**: emergency-stop 엔드포인트는 criticalLimiter(분당 10회) 대신 standardLimiter(분당 60회) 또는 별도 설정으로 변경 요청.

---

### T2-1: RSI Wilder Smoothing (Engineer 제안)

**판정: ✅ 동의**

Engineer와 Trader의 구현 방향이 동일하다. `wilder` 파라미터(boolean) vs `smoothing` 파라미터(string) 차이는 구현 디테일이므로 어느 쪽이든 무방하나, Engineer의 `wilder: boolean`이 단순하여 선호.

---

### T2-2: Confidence Filtering (Engineer 제안)

**판정: ✅ 동의**

Engineer의 `minConfidence` 기본값 0.50은 Trader의 제안(riskLevel별 0.50~0.60)보다 보수적이다. 초기에는 0.50으로 시작하고 운영 데이터를 보며 조정하는 것이 안전하다.

---

### T2-3: Backtest Position Size (Engineer 제안)

**판정: ✅ 동의**

Engineer의 `_getPositionSizePercent()` 구현에서 riskLevel별 fallback(low:10%, medium:15%, high:25%)이 Trader(low:10%, medium:15%, high:8%)와 차이가 있다. **Trader의 high:8%가 트레이딩 관점에서 더 합리적**이다 (고위험 전략은 작은 포지션으로 손실 제한). Engineer에게 Trader의 값으로 조정 요청.

---

### T2-4: FundingRate 데이터 소스 (Engineer 제안)

**판정: ✅ 동의**

Engineer의 `botService.js` 내 직접 폴링 방식은 Trader의 별도 `fundingDataService.js` 모듈 방식보다 단순하다. UX 관점에서는 어느 구현이든 결과가 같다. **다만 Trader의 별도 서비스 방식이 관심사 분리에 더 적합**하므로 Trader 안을 지지한다.

---

### T2-5: GridStrategy Equity (Engineer 제안)

**판정: ⚠️ 조건부 동의**

Engineer의 `setContext({ equity })` 방식은 Trader의 `setAccountContext({ getEquity: () => ... })` 콜백 방식과 다르다.

**Trader의 콜백 방식이 UX에 더 유리하다.** 이유: Engineer 방식은 botService가 `_onAccountStateUpdate`를 호출할 때만 equity가 갱신된다. 만약 이 이벤트 발생 주기가 길면 stale 데이터가 사용된다. Trader의 `getEquity()` 콜백 방식은 호출 시점에 항상 최신 값을 반환하므로 더 안정적이다. 사용자가 UI에서 보는 equity와 전략이 사용하는 equity가 일치해야 한다.

---

### T2-6: useSocket 분리 (Engineer 제안)

**판정: ⚠️ 조건부 동의** (Trader 리뷰에서 상세 기술)

Engineer가 점진적 마이그레이션과 기존 `useSocket` 유지를 권장한 것은 올바르다.

---

### T2-8: SignalFeed rejectReason (Engineer 제안)

**판정: ⚠️ 조건부 동의**

Engineer가 raw `signal.rejectReason`을 그대로 표시하는 것을 제안했으나, 한국어 UI에서 `cooldown: MaTrendStrategy must wait 30s` 같은 영문 문자열은 부조화스럽다. 반드시 `translateRejectReason()` 번역 함수를 거쳐야 한다. 단, `title` 속성으로 원문도 유지.

---

### T2-10: Drawdown 차트 (Engineer 제안)

**판정: ⚠️ 조건부 동의** (Trader 리뷰에서 데이터 소스 결정 기술)

Engineer의 "프론트엔드 로컬 축적" 제안은 반대. equity-curve API 기반 클라이언트 계산 방식을 권장.

---

### T2-11: Risk Gauge (Engineer 제안)

**판정: ⚠️ 조건부 동의** (Trader 리뷰에서 상세 기술)

신규 컴포넌트보다 기존 `RiskStatusPanel` 개선을 권장.

---

### T2-12: 적응형 폴링 (Engineer 제안)

**판정: ✅ 동의**

Engineer의 간격 제안(idle:30s, running:5s, paused:10s, error:3s)은 Trader 제안과 거의 동일. 합의 형성됨.

---

## 교차 이슈 (에이전트 간 중복/상충 발견사항)

### 1. T2-5 DI 패턴 상충

| 측면 | Trader 제안 | Engineer 제안 |
|------|------------|--------------|
| 메서드명 | `setAccountContext()` + `getEquity()` | `setContext()` + `config.equity` 직접 쓰기 |
| 데이터 접근 | 콜백 (`getEquity: () => ...`) | 이벤트 기반 (`_onAccountStateUpdate`) |
| Staleness | 항상 최신 (콜백 시점 조회) | 이벤트 발생 시점에 종속 |

**권장**: Trader의 콜백 방식을 채택하되, 메서드명은 Engineer의 `setContext()`가 더 일반적이므로 합성:
```javascript
setContext({ getEquity: () => this.riskEngine.accountState.equity })
```

### 2. T2-3 riskLevel별 fallback 값 상충

| riskLevel | Trader | Engineer |
|-----------|--------|----------|
| low | 10% | 10% |
| medium | 15% | 15% |
| high | **8%** | **25%** |

3배 차이. **Trader의 8%를 채택 권장**. 고위험 전략이 큰 포지션을 사용하면 drawdown이 급격히 커져 사용자 경험이 나빠진다.

### 3. T2-7 Emergency-stop rate limit 미합의

Engineer의 제안에서 emergency-stop이 criticalLimiter(분당 10회)에 포함되어 있다. 이것은 안전 기능이므로 rate limit를 더 관대하게 적용하거나 제외해야 한다. 두 에이전트 모두 이 점을 명시적으로 다루지 않았다.

### 4. T2-8 + T2-2 구현 순서

두 에이전트 모두 T2-2(confidence filtering)와 T2-8(rejectReason 표시)을 함께 구현하라고 권장. 합의됨. 단, **T2-2가 먼저 구현되어야** T2-8에서 `confidence_too_low` 사유가 생성된다.

### 5. T2-4 구현 방식 경합

| 측면 | Trader | Engineer |
|------|--------|----------|
| 구조 | 별도 `fundingDataService.js` 모듈 | `botService.js` 내 직접 폴링 |
| 이벤트 | `MARKET_EVENTS.FUNDING_UPDATE` | synthetic ticker → `onTick()` |

**권장**: Trader의 별도 모듈 방식. botService에 폴링 로직을 추가하면 이미 비대한 오케스트레이터가 더 커진다.

### 6. T2-1 파라미터 형식

| Trader | Engineer |
|--------|----------|
| `smoothing: 'wilder' \| 'sma'` (string) | `wilder: boolean` |

기능적으로 동일. **Engineer의 boolean이 더 단순하고 오류 가능성 낮음** (문자열 오타 위험 없음). 다만 향후 `'ema'` 등 추가 smoothing 방식이 필요할 수 있으므로, Trader의 string 방식이 확장성은 높다. 현 시점에서는 boolean으로 충분하다.

---

## 구현 순서 의견 (UX 영향도 기준)

UX 영향도 = "사용자가 체감하는 문제의 심각성" 기준으로 재배열한다.

### Phase 1: 침묵 실패 해소 (사용자 불신 해소)
| 순서 | 항목 | UX 영향도 | 사유 |
|------|------|-----------|------|
| 1 | **T2-4** (FundingRate 데이터) | **Critical** | 사용자가 전략을 활성화했는데 시그널이 안 나옴 = 신뢰 상실 |
| 2 | **T2-5** (GridStrategy equity) | **Critical** | 동일. 활성화 후 침묵 |

### Phase 2: 백테스트 신뢰성 (잘못된 의사결정 방지)
| 순서 | 항목 | UX 영향도 | 사유 |
|------|------|-----------|------|
| 3 | **T2-3** (Backtest position size) | **High** | 95% 포지션 백테스트 결과로 4% 전략 채택 = 거짓 기대 |
| 4 | **T2-1** (RSI Wilder) | **High** | 백테스트와 외부 도구 결과 불일치 |

### Phase 3: 시그널 품질 + 가시성 (정보 투명성)
| 순서 | 항목 | UX 영향도 | 사유 |
|------|------|-----------|------|
| 5 | **T2-2** (Confidence filtering) | **High** | 저질 시그널 범람 = 정보 과부하 |
| 6 | **T2-8** (rejectReason 표시) | **High** | T2-2와 반드시 동시 구현. 거부 사유 없는 거부 표시는 불안 유발 |

### Phase 4: 안전 + 성능 (인프라 보강)
| 순서 | 항목 | UX 영향도 | 사유 |
|------|------|-----------|------|
| 7 | **T2-7** (Rate limiting) | **Medium** | 사용자 직접 체감은 없지만, 보안 사고 시 전체 서비스 영향 |
| 8 | **T2-12** (적응형 폴링) | **Medium** | idle 상태에서 불필요한 서버 부하 6배 감소 |
| 9 | **T2-9** (rapidLosses 정리) | **Low** | 장기 운영 안정성. 단기 체감 없음 |

### Phase 5: UI 개선 (나이스투해브)
| 순서 | 항목 | UX 영향도 | 사유 |
|------|------|-----------|------|
| 10 | **T2-10** (Drawdown 차트) | **Medium** | 리스크 시각화 개선. 새 컴포넌트 필요 |
| 11 | **T2-11** (Risk Gauge) | **Low** | 기존 RiskStatusPanel 이미 역할 수행. 개선으로 충분 |
| 12 | **T2-6** (useSocket 분리) | **Low** | 소비처 1곳. useRef 패턴으로 ticker 격리만으로 충분 |

### Trader/Engineer 순서와의 차이점

- Trader는 T2-9(P3)와 T2-7(P2)을 Phase 3에 배치했으나, UX 관점에서는 사용자가 직접 체감하지 못하므로 Phase 4로 이동.
- Engineer는 T2-9를 1순위로 올렸으나(메모리 누수), 실제 영향은 수개월 후에나 발생하므로 Phase 4 유지.
- T2-8을 T2-2와 동일 Phase에 배치. Trader/Engineer 모두 T2-8을 Phase 3(후반)에 넣었으나, **T2-2 없는 T2-8은 반쪽짜리이고, T2-8 없는 T2-2는 사용자 혼란을 키우므로** 반드시 동시 배포해야 한다.

---

## 다른 에이전트에게 최종 요청

### Trader에게

1. `translateRejectReason()` 번역 키 목록을 위에서 제안한 전체 목록으로 확장해주세요. 특히 SignalFilter의 prefix 매칭 패턴이 중요합니다.
2. T2-10 수중곡선의 데이터 소스는 equity-curve API 기반으로 합의합시다. 프론트엔드 로컬 축적은 새로고침 시 데이터 손실 문제가 있습니다.
3. T2-11은 기존 `RiskStatusPanel` 개선 방향에 동의하시는지 확인 부탁합니다. 신규 컴포넌트(RiskGauge.tsx)를 만들면 기존 패널과의 정보 중복이 발생합니다.

### Engineer에게

1. T2-7: emergency-stop 엔드포인트를 criticalLimiter에서 제외하거나, 별도 상한(분당 30회 이상)을 적용해주세요. 안전 기능이 rate limit에 막히면 안 됩니다.
2. T2-7: 429 응답의 `retryAfter` 필드를 프론트엔드가 활용할 수 있도록 응답 형식을 유지해주세요. 프론트엔드에서 자동 재시도 + 토스트 메시지를 구현하겠습니다.
3. T2-5: `setContext()` 메서드에 Trader의 콜백 패턴(`getEquity: () => ...`)을 채택해주세요. `config.equity` 직접 쓰기는 staleness 위험이 있습니다.
4. T2-3: `riskLevel: 'high'`의 fallback을 25%에서 8%로 조정해주세요 (Trader 제안 기준).
5. T2-9: 절대 최대(500개) 초과 시에만 WARN 로그를 남기고, 일반적인 윈도우 기반 정리는 로그 불필요합니다.
6. T2-1: `wilder: boolean` 파라미터 방식으로 진행. 향후 확장 필요 시 그때 string으로 변경 가능합니다.
