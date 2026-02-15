# Round 6 교차 리뷰 -- UI/UX 관점

**작성일**: 2026-02-16
**작성자**: Senior UI/UX Engineer (Claude Opus 4.6)
**리뷰 대상**: Trader Round 6 Proposal (7건), Engineer Round 6 Proposal (14건)

---

## Trader 제안 리뷰

### R6-1. ExposureGuard 시장가 주문 가격 주입 -- ✅ 동의

**프론트엔드 영향**: 없음. 순수 백엔드 로직 수정.

ExposureGuard가 시장가 주문에서 `effectivePrice = '0'`으로 계산되어 모든 포지션 사이즈 제한을 우회하는 문제는 실거래에서 재앙적 결과를 초래할 수 있다. 수정 방안의 이중 방어(OrderManager에서 가격 주입 + ExposureGuard에서 `price='0'` reject)는 합리적이다.

다만 ExposureGuard가 주문을 reject할 때 `reason: 'no_price_for_exposure_check'`를 반환하는데, 이 reject 사유가 프론트엔드 UI의 리스크 이벤트 피드에 표시될 수 있다. 현재 리스크 이벤트 목록(`useSocket.ts`)에서 reason 필드를 그대로 렌더링하므로, **한국어 번역 매핑**이 필요할 수 있다. 그러나 이것은 엣지 케이스(정상 작동 시 도달하지 않는 방어 경로)이므로 후순위로 처리 가능하다.

---

### R6-2. 레버리지 설정 메커니즘 구현 -- ⚠️ 조건부 동의

**프론트엔드 영향**: 있음 -- 전략 카드 UI, 백테스트 결과 UI.

레버리지 미적용은 실거래에서 치명적이므로 백엔드 구현은 당연히 필요하다. 그러나 프론트엔드 관점에서 보완이 필요하다:

**1) 전략 카드에 레버리지 표시 추가**

현재 `StrategyListItem` 타입에 `leverage` 필드가 없다:
```typescript
// frontend/src/types/index.ts:173-180
export interface StrategyListItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  targetRegimes: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  active: boolean;
}
```

`GET /api/bot/strategies` 응답에 `leverage` 필드가 포함되면, 타입에 추가하고 `StrategyCard.tsx`에서 레버리지 배지를 표시해야 한다. 트레이더가 전략을 활성화/비활성화할 때 "이 전략은 5x 레버리지를 사용합니다"라는 정보가 시각적으로 명확해야 한다.

**구체적 UI 변경 제안**:
```typescript
// types/index.ts 변경
export interface StrategyListItem {
  name: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  targetRegimes: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  leverage?: string;  // 추가
  active: boolean;
}
```

```tsx
// StrategyCard.tsx — 리스크 배지 옆에 레버리지 배지 추가
{strategy.leverage && (
  <span className="text-xs text-[var(--text-muted)]">
    {strategy.leverage}x
  </span>
)}
```

**2) 백테스트 disclaimer**

Trader 제안에서 "백테스트는 레버리지를 반영하지 않습니다" 안내를 권장했는데, 이것은 사용자의 의사결정에 직접 영향을 미치는 중요한 정보다. `BacktestStatsPanel.tsx` 하단에 소형 경고 배너를 추가하는 것을 권장한다:

```tsx
// BacktestStatsPanel.tsx 하단
<p className="text-xs text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border-subtle)]">
  * 백테스트 결과는 레버리지, 슬리피지 변동, 유동성 제한을 완전히 반영하지 않습니다.
  실거래 성과와 차이가 있을 수 있습니다.
</p>
```

**보완 사항**: 백엔드 API(`GET /api/bot/strategies`)에서 각 전략의 `leverage` 값을 반환하도록 Engineer에게 요청 필요.

---

### R6-3. qty 표준화 및 getAccountInfo 크래시 수정 -- ✅ 동의

**프론트엔드 영향**: 없음. 순수 백엔드 로직.

`getAccountInfo()` 메서드 미존재로 인한 실거래 모드 전면 크래시는 가장 긴급한 수정 사항이다. `positionManager.getAccountState().equity` 활용 + `getBalances()` fallback 전략은 견고하다.

CLOSE 시그널의 qty 퍼센트 문제도 중요하다. `suggestedQty = '5'`가 5 BTC로 해석되는 것은 거래소가 reject하더라도 주문 실패 -> 포지션 미청산이라는 사용자 경험 문제를 야기한다. PositionManager에서 실제 보유 수량을 조회하는 수정 방안이 올바르다.

---

### R6-4. 전략 positionSide 조기 설정 제거 -- ⚠️ 조건부 동의

**프론트엔드 영향**: 간접적 -- 시그널 표시 정확도에 영향.

15+ 전략 파일의 대규모 변경이므로 회귀 리스크가 높다. 그러나 SignalFilter 차단 후 전략이 영구적으로 진입 불가 상태에 빠지는 문제는 실거래에서 매우 심각하다.

**보완 요청**:

1. **전략별 단위 테스트 필수**: "시그널 emit -> SignalFilter 차단 -> 다음 기회에 재진입 가능" 시나리오를 각 전략에 대해 검증해야 한다. 15개 전략을 일괄 수정하면서 테스트 없이 진행하면 더 큰 문제를 만들 수 있다.

2. **프론트엔드 시그널 피드 영향**: 현재 대시보드의 시그널 목록(`useSocket.ts`의 `handleSignalGenerated`)은 emit된 시그널을 모두 표시한다. 시그널이 emit되었지만 onFill이 호출되지 않은 경우, 사용자는 "시그널은 보이는데 포지션이 안 열린다"고 인식할 수 있다. 이것은 기존에도 동일한 행동이므로 새로운 문제는 아니지만, 시그널 상태(`passed`/`blocked`/`filled`)를 UI에서 구분할 수 있으면 더 좋다. 이것은 별도 개선 사항으로 분류.

3. **구현 순서**: Trader 제안의 Phase 4에 위치하지만, 시간이 오래 걸리고 회귀 리스크가 있으므로 R6-5, R6-1, R6-3 이후 별도 테스트 세션을 잡아서 진행하는 것이 안전하다. 이 부분은 Trader의 제안과 일치한다.

---

### R6-5. getAccountInfo 미존재 메서드 호출 (CRITICAL) -- ✅ 동의

**프론트엔드 영향**: 없음. R6-3에 포함된 내용의 강조 분리.

즉시 수정 동의. 이 버그가 수정되지 않으면 실거래 모드에서 주문이 0건 실행된다. Paper 모드에서 발견되지 않은 이유도 명확히 설명되어 있다.

---

### R6-6. submitOrder await 누락 -- ✅ 동의

**프론트엔드 영향**: 간접적 -- 주문 처리 순서 보장으로 UI의 포지션/주문 상태 일관성이 향상된다.

fire-and-forget 패턴에서 await 패턴으로 변경하면, 동일 전략의 연속 시그널이 순차 처리되어 프론트엔드에 표시되는 포지션/주문 상태의 일관성이 개선된다. MEDIUM 우선순위에 동의한다.

---

### R6-7. CLOSE 시그널 qty 퍼센트 문제 -- ✅ 동의

**프론트엔드 영향**: 없음. R6-3의 CLOSE 시그널 부분을 별도 항목으로 분리한 것.

PositionManager에서 실제 보유 수량을 가져와 CLOSE 시그널의 qty로 사용하는 것은 올바른 해결책이다.

---

## Engineer 제안 리뷰

### R6-1. riskEngine.getAccountState() 메서드 부재 -- ✅ 동의

**프론트엔드 영향**: 없음.

Trader의 R6-5/R6-3과 동일 문제의 다른 발현점이다. `riskEngine`에 `getAccountState()` public 메서드를 추가하는 것은 10분 작업이고, Trader 제안의 `positionManager.getAccountState()` 활용과 상호보완적이다. 두 접근 모두 적용해야 한다(riskEngine에 메서드 추가 + botService에서 활용).

---

### R6-2. exchangeClient.getAccountInfo() 부재 -- ✅ 동의

**프론트엔드 영향**: 없음.

Trader R6-5와 동일 이슈. Engineer는 `getBalances()` 사용 또는 `riskEngine.getAccountState().equity` 활용(R6-1 수정 후)을 제안하는데, 후자가 API 호출을 줄이므로 더 효율적이다. Trader도 동일한 결론에 도달했다.

---

### R6-3. ExposureGuard 마켓오더 price 문제 -- ✅ 동의

**프론트엔드 영향**: 없음.

Trader R6-1과 동일 이슈. 두 에이전트의 수정 방안이 거의 동일하다(OrderManager에서 가격 주입 + ExposureGuard에서 방어적 reject). 양측의 합의가 있으므로 즉시 구현 가능하다.

---

### R6-4. 레버리지 관리 메커니즘 부재 -- ⚠️ 조건부 동의

**프론트엔드 영향**: 있음 -- 전략 UI, 포지션 테이블, 백테스트 결과.

Trader R6-2와 동일 이슈. Engineer는 추가로 `PaperPositionManager`에서 leverage 반영(`leverage: strategy?.leverage || '1'`)을 제안하는데, 이것은 중요한 보완이다. Paper/Tournament 모드에서 레버리지가 1x로 하드코딩되면 수익률이 과소 추정되어, 사용자가 잘못된 전략 평가를 하게 된다.

**프론트엔드 보완 사항**:

1. **포지션 테이블**: 현재 `PositionsTable.tsx`에서 `pos.leverage`를 `{pos.leverage}x`로 표시하고 있다 (`frontend/src/components/PositionsTable.tsx:99`). 타입 정의에도 `leverage: string`이 이미 포함되어 있다 (`frontend/src/types/index.ts:93`). 따라서 백엔드에서 올바른 leverage를 반환하면 UI는 자동으로 정확한 값을 표시한다. 추가 프론트엔드 작업 불필요.

2. **전략 카드**: Trader R6-2 리뷰에서 언급한 대로 `StrategyListItem` 타입에 `leverage` 필드 추가 필요.

3. **PaperEngine leverage 반영 시**: 토너먼트 리더보드에 표시되는 수익률이 변경된다. 기존 토너먼트 결과와의 비교가 불가능해지므로, 토너먼트 페이지에 "레버리지 반영 버전"임을 표시하거나, 리셋 시 경고를 줄 필요가 있다. 그러나 이것은 Minor UX 개선이므로 후순위.

---

### R6-5. OrderManager/PositionManager destroy() 미호출 -- ✅ 동의

**프론트엔드 영향**: 간접적 -- 봇 stop/start 반복 시 WebSocket 이벤트 중복 수신으로 UI에 동일 데이터가 여러 번 렌더링될 수 있다.

WS 리스너 누적은 장기 운영 시 프론트엔드에도 영향을 준다. Socket.io를 통해 서버 -> 클라이언트로 전달되는 이벤트가 중복되면, 대시보드의 시그널 목록이나 리스크 이벤트 피드에 동일 항목이 2-3번 표시될 수 있다. `useSocket.ts`에서 중복 제거 로직이 없으므로(시그널을 배열 앞에 push할 뿐), 백엔드 수정이 더 중요하다.

---

### R6-6. SignalFilter _activeSignals 영구 누적 -- ✅ 동의

**프론트엔드 영향**: 간접적 -- ghost 항목으로 인한 시그널 영구 차단은 사용자가 "전략이 시그널을 안 보낸다"고 인식하게 만든다.

30분 TTL 기반 정리는 합리적이다. `_lastSignalTime`도 동일하게 정리해야 한다는 점에 동의.

프론트엔드 관점에서, SignalFilter의 상태를 대시보드에 노출하는 것이 디버깅에 도움이 된다. 현재 `/api/bot/strategies` 응답에 SignalFilter 통계(`total`, `passed`, `blocked`)가 포함되는지 확인이 필요하다. 포함된다면 전략 카드에 "차단 비율" 지표를 표시하는 것을 향후 개선으로 고려할 수 있다.

---

### R6-7. Socket.io CORS + 인증 -- ⚠️ 조건부 동의 (프론트엔드 변경 필수)

**프론트엔드 영향**: **직접적이고 중요** -- Socket.io 클라이언트 코드 수정 필수.

보안 강화 자체에는 완전히 동의한다. 그러나 이 변경은 **프론트엔드와 백엔드가 동시에 배포되어야** 하며, 구현 시 다음 사항이 필요하다:

**1) 프론트엔드 Socket.io 클라이언트 변경**

현재 `frontend/src/lib/socket.ts`의 `acquireSocket()`:
```typescript
socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
```

수정 후:
```typescript
socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  auth: {
    token: process.env.NEXT_PUBLIC_API_KEY || '',
  },
});
```

**2) 인증 실패 시 UX 처리**

인증이 실패하면 Socket.io는 `connect_error`를 발생시킨다. 현재 `socket.ts`에서 `connect_error`를 콘솔에만 로깅하고 있다:
```typescript
socket.on('connect_error', (err) => {
  console.error('[Socket] 연결 오류:', err.message);
});
```

인증 실패 시 사용자에게 명확한 피드백을 주어야 한다:
```typescript
socket.on('connect_error', (err) => {
  console.error('[Socket] 연결 오류:', err.message);
  if (err.message === 'Authentication required' || err.message === 'Invalid API key') {
    // 인증 실패: 재연결 중단하고 사용자에게 알림
    socket.disconnect();
    // 상태 업데이트 -> UI에 인증 오류 표시
  }
});
```

**3) API_KEY 미설정 시 동작**

Engineer 제안의 백엔드 코드에서 `if (API_KEY)` 조건으로 인증 미들웨어를 등록하므로, API_KEY가 미설정이면 인증이 비활성화된다. 이 경우 프론트엔드에서 `auth.token`을 빈 문자열로 전달해도 문제없다. 이 동작은 정상이다.

**4) 배포 순서**

반드시 프론트엔드와 백엔드를 **동시에 배포**하거나, 백엔드를 먼저 배포할 때 인증 미들웨어를 처음에는 `warn-only` 모드로 두고, 프론트엔드 배포 후 `enforce` 모드로 전환하는 것을 권장한다. 그렇지 않으면 프론트엔드가 구 버전인 동안 Socket.io 연결이 끊어져 실시간 데이터가 중단된다.

**5) `timingSafeEqual` 길이 체크 주의**

Engineer 제안 코드에서:
```javascript
const keyBuffer = Buffer.from(API_KEY, 'utf-8');
const tokenBuffer = Buffer.from(token, 'utf-8');
if (keyBuffer.length !== tokenBuffer.length ||
    !crypto.timingSafeEqual(keyBuffer, tokenBuffer)) {
```

이 패턴은 올바르다. `timingSafeEqual`은 길이가 다르면 에러를 throw하므로 길이 체크가 선행되어야 한다. 기존 `apiKeyAuth.js`에서 동일한 패턴을 사용하고 있으므로 일관성도 확보된다.

---

### R6-8. Socket.io ticker throttle -- ✅ 동의

**프론트엔드 영향**: 직접적이지만 **긍정적**.

현재 프론트엔드의 `useSocket.ts`에서 ticker 이벤트를 `tickerRef`에 저장하여 불필요한 re-render를 방지하고 있다 (T2-6 주석 참조):
```typescript
// T2-6: Use ref for ticker to prevent re-renders on every tick
const handleTicker = (data: { symbol: string; lastPrice: string; volume24h: string }) => {
  tickerRef.current = {
    ...tickerRef.current,
    [data.symbol]: { lastPrice: data.lastPrice, volume24h: data.volume24h },
  };
};
```

이 최적화가 이미 적용되어 있어 UI 렉 문제는 프론트엔드 측에서 어느 정도 완화되었다. 그러나 서버 측 throttle은 여전히 필요하다:

1. **네트워크 대역폭 절감**: 초당 10-50개 이벤트 -> 초당 10개(심볼당 1회)
2. **서버 JSON 직렬화 부하 감소**
3. **모바일 환경**: 셀룰러 네트워크에서 불필요한 데이터 전송 방지

서버 측 1초 throttle이 적용되어도 프론트엔드 UX에는 영향이 없다. 트레이더가 초단위 가격 변동을 확인하는 것이 아닌 이상, 1초 간격은 충분하다. 기존 프론트엔드 대시보드에서 표시되는 가격은 폴링(3초 간격)으로도 업데이트되므로 1초 throttle은 오히려 과하게 빈번하다.

---

### R6-9. PaperEngine _pendingOrders 미정리 -- ✅ 동의

**프론트엔드 영향**: 간접적 -- Paper 모드 stop/start 시 유령 포지션이 생기면 사용자 혼란 초래.

`reset()` 메서드 추가는 간단하고 명확하다. 봇 stop 시 pending 오더를 정리하는 것은 Paper 모드 사용자의 기대에 부합한다.

---

### R6-10. IndicatorCache 심볼 데이터 영구 누적 -- ✅ 동의 (현재 수용 가능)

**프론트엔드 영향**: 없음.

Engineer 자체 분석에서 "현재 수준 수용 가능"으로 평가했고, 동의한다. 10개 심볼 x 500 klines의 메모리 사용은 미미하다. ring buffer 개선은 T3으로 적절하다.

---

### R6-11. SignalFilter _strategyMeta 미정리 -- ✅ 동의

**프론트엔드 영향**: 간접적 -- `getStatus()`에서 오래된 전략이 계속 표시되면 대시보드 전략 목록이 부정확해질 수 있다.

`reset()`에 `_strategyMeta.clear()` 한 줄 추가로 해결. 5분 작업.

---

### R6-12. EventEmitter maxListeners 미설정 -- ✅ 동의

**프론트엔드 영향**: 없음.

R6-5(destroy 미호출) 수정이 선행되면 이 문제는 자연 해소될 가능성이 높다. 그러나 방어적으로 `setMaxListeners(20)`을 설정하는 것은 비용이 거의 없으므로 동의.

---

### R6-13. _resolveSignalQuantity 비효율적 API 호출 -- ✅ 동의

**프론트엔드 영향**: 없음.

매 시그널마다 REST API를 호출하는 것은 불필요하다. `riskEngine.getAccountState().equity` 활용이 올바른 해결책이며, Trader R6-3/R6-5의 수정과 자연스럽게 통합된다.

---

### R6-14. InstrumentCache (심볼별 lot step) -- ⚠️ 조건부 동의

**프론트엔드 영향**: 잠재적 -- 주문 제출 UI가 추가될 경우 lot step 정보가 필요하다.

현재 프론트엔드에는 수동 주문 제출 폼이 없으므로 즉각적인 UI 영향은 없다. 그러나 향후 수동 거래 기능이 추가되면, 심볼별 최소 주문 수량과 step을 UI에서 검증해야 한다. InstrumentCache의 데이터를 API로 노출하는 엔드포인트(`GET /api/instruments/:symbol`)를 함께 계획하면 좋겠다.

2시간 소요 예상이므로 현재 스프린트에서는 T3로 배치하는 것에 동의한다.

---

## 3-Agent 공통 이슈 분류

| 이슈 | Trader | Engineer | UI | 합의 수준 |
|------|--------|----------|----|-----------|
| `getAccountInfo()` 크래시 | R6-5 (CRITICAL) | R6-2 (T0) | 동의 | **3자 합의** -- 즉시 수정 |
| `riskEngine.getAccountState()` 부재 | (R6-3에 포함) | R6-1 (T0) | 동의 | **3자 합의** -- 즉시 수정 |
| ExposureGuard 시장가 price | R6-1 (HIGH) | R6-3 (T1) | 동의 | **3자 합의** -- 실거래 전 필수 |
| 레버리지 미적용 | R6-2 (HIGH) | R6-4 (T1) | 조건부 동의 (FE 변경 필요) | **3자 합의** -- FE 타입/UI 보완 조건 |
| CLOSE qty 퍼센트 문제 | R6-7 (HIGH) | (미발견) | 동의 | **2자 합의** (Trader+UI) |
| positionSide 조기 설정 | R6-4 (HIGH) | (미발견) | 조건부 동의 (테스트 필수) | **2자 합의** (Trader+UI) |
| submitOrder await 누락 | R6-6 (MEDIUM) | (미발견) | 동의 | **2자 합의** (Trader+UI) |
| destroy() 미호출 (리소스 누수) | (미발견) | R6-5 (T1) | 동의 | **2자 합의** (Engineer+UI) |
| SignalFilter 누적 | (미발견) | R6-6 (T2) | 동의 | **2자 합의** (Engineer+UI) |
| Socket.io CORS/인증 | (미발견) | R6-7 (T2) | 조건부 동의 (FE 동시 변경) | **2자 합의** (Engineer+UI) |
| Socket.io ticker throttle | (미발견) | R6-8 (T2) | 동의 | **2자 합의** (Engineer+UI) |
| PaperEngine reset() | (미발견) | R6-9 (T2) | 동의 | **2자 합의** (Engineer+UI) |
| IndicatorCache 누적 | (미발견) | R6-10 (T2) | 동의 (수용 가능) | **2자 합의** (Engineer+UI) |
| _strategyMeta 미정리 | (미발견) | R6-11 (T2) | 동의 | **2자 합의** (Engineer+UI) |
| maxListeners 미설정 | (미발견) | R6-12 (T3) | 동의 | **2자 합의** (Engineer+UI) |
| API 호출 비효율 | (R6-3에 포함) | R6-13 (T3) | 동의 | **3자 합의** |
| InstrumentCache | (미발견) | R6-14 (T3) | 조건부 동의 | **2자 합의** (Engineer+UI) |

---

## 의존성 그래프

```
R6-Eng-1 (riskEngine.getAccountState)
  └──> R6-Eng-13 (equity 캐시 활용)
  └──> R6-Trader-3 (qty 표준화에서 riskEngine 활용)

R6-Eng-2 / R6-Trader-5 (getAccountInfo 크래시)
  └──> R6-Trader-3 (qty 표준화 전체)
  └──> R6-Eng-13 (API 호출 제거)

R6-Trader-1 / R6-Eng-3 (ExposureGuard price)
  └──> 독립적, 병렬 수정 가능

R6-Trader-2 / R6-Eng-4 (레버리지)
  └──> R6-UI (StrategyListItem 타입 변경, StrategyCard UI)
  └──> R6-UI (BacktestStatsPanel disclaimer)

R6-Eng-7 (Socket.io 인증)
  └──> R6-UI (socket.ts auth 토큰 추가)
  └──> R6-UI (connect_error 인증 실패 UX)

R6-Eng-5 (destroy 미호출)
  └──> R6-Eng-12 (maxListeners -- destroy 수정 시 자연 해소 가능)
```

---

## 스프린트 우선순위 의견

### Phase 1: 크래시 수정 (25분) -- **즉시 시작**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Eng R6-1: riskEngine.getAccountState() | 10분 | 없음 |
| Eng R6-2 / Trader R6-5: getAccountInfo 수정 | 15분 | 없음 |

### Phase 2: 리스크 정상화 (1시간 30분) -- **즉시 이어서**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Trader R6-1 / Eng R6-3: ExposureGuard price | 30분 | 없음 |
| Trader R6-7: CLOSE qty 수정 | 30분 | 없음 |
| Trader R6-6: submitOrder await | 15분 | 없음 |
| Eng R6-5: destroy() 호출 추가 | 15분 (기본) | 없음 |

### Phase 3: 레버리지 + 프론트엔드 (1시간 30분) -- **Phase 2 완료 후**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Trader R6-2 / Eng R6-4: setLeverage 구현 | 1시간 | **있음** |
| FE: StrategyListItem 타입 + StrategyCard 레버리지 표시 | 15분 | **직접 변경** |
| FE: BacktestStatsPanel disclaimer 추가 | 15분 | **직접 변경** |

### Phase 4: 전략 상태 일관성 (1시간 30분) -- **별도 세션**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Trader R6-4: positionSide 조기 설정 제거 (15+ 파일) | 1시간 30분 | 없음 (간접 영향만) |

### Phase 5: 메모리/안정성 (35분) -- **Phase 2-3과 병렬 가능**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Eng R6-8: Socket.io ticker throttle | 15분 | 없음 (긍정적 영향) |
| Eng R6-9: PaperEngine reset() | 15분 | 없음 |
| Eng R6-11: _strategyMeta clear | 5분 | 없음 |

### Phase 6: Socket.io 보안 (45분) -- **Phase 3 이후 (FE 동시 배포 필요)**

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Eng R6-7: Socket.io CORS + 인증 (백엔드) | 30분 | **있음** |
| FE: socket.ts auth 토큰 + connect_error 처리 | 15분 | **직접 변경** |

### Phase 7: 개선 (후속 스프린트)

| 항목 | 소요 | 프론트엔드 변경 |
|------|------|----------------|
| Eng R6-6: SignalFilter stale 정리 | 30분 | 없음 |
| Eng R6-12: maxListeners | 5분 | 없음 |
| Eng R6-13: API 호출 최적화 | 10분 | 없음 |
| Eng R6-14: InstrumentCache | 2시간 | 잠재적 |

---

## UI/UX 에이전트의 프론트엔드 구현 범위 요약

이번 라운드에서 UI 에이전트가 직접 구현해야 할 프론트엔드 변경 사항:

| 변경 | 파일 | 우선순위 | 의존성 |
|------|------|----------|--------|
| `StrategyListItem` 타입에 `leverage` 필드 추가 | `frontend/src/types/index.ts` | Phase 3 | Eng R6-4 백엔드 완료 후 |
| `StrategyCard`에 레버리지 배지 표시 | `frontend/src/components/strategy/StrategyCard.tsx` | Phase 3 | 타입 변경 후 |
| `BacktestStatsPanel`에 레버리지 미반영 disclaimer | `frontend/src/components/backtest/BacktestStatsPanel.tsx` | Phase 3 | 독립적 |
| `socket.ts`에 `auth.token` 추가 | `frontend/src/lib/socket.ts` | Phase 6 | Eng R6-7 백엔드 완료와 동시 |
| `socket.ts` connect_error 인증 실패 핸들링 | `frontend/src/lib/socket.ts` | Phase 6 | auth.token 추가와 동시 |

**총 프론트엔드 작업량**: 약 45분

---

*End of Round 6 Cross-Review (UI/UX Perspective)*
