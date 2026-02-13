# Round 1 Cross-Review -- UI/UX 엔지니어

> Reviewer: Agent 3 (Senior UI/UX Engineer)
> Date: 2026-02-13
> 리뷰 대상: Trader 제안서 (round_1.md) + Engineer 제안서 (round_1.md)
> 리뷰 기준: 모든 백엔드 변경이 사용자에게 어떻게 시각적으로 전달되어야 하는가

---

## Trader 제안서 리뷰

### Critical Issues의 UI 영향

#### C1. Multi-Symbol Support Is Fundamentally Broken

- **동의** -- 이 버그가 수정되면 프론트엔드에 직접적인 영향이 있다.

**필요한 UI 변경:**
- 현재 `StrategyPanel.tsx`의 `StrategyInfo` 타입에는 `symbol: string` (단일 심볼)만 있다 (`types/index.ts:22`). 수정 후 하나의 전략이 여러 심볼에 할당되거나, 심볼당 인스턴스가 생성되면 타입을 `symbols: string[]`로 변경하거나, 전략 목록 API 응답 구조가 완전히 달라져야 한다.
- `StrategyPanel.tsx:252-261`에서 현재 전략명만 표시하고 심볼 정보를 표시하지 않는다. 수정 후 "BollingerReversionStrategy (BTCUSDT, ETHUSDT, ...)" 형태로 활성 심볼을 표시해야 한다.
- `StrategyHub`의 전략별 상세 뷰에서 전략-심볼 매핑을 시각화하는 매트릭스 뷰가 필요할 수 있다.
- **SymbolRegimeTable** (`SymbolRegimeTable.tsx`)에서 각 심볼에 어떤 전략이 할당되었는지 추가 표시하면 트레이더의 상황 인지를 돕는다.

#### C2. Position Sizing Disconnect -- Percentage vs Quantity

- **동의** -- 이것은 가장 위험한 버그다. UX 관점에서도 중요하다.

**필요한 UI 변경:**
- 수정 후 시그널이 실제 quantity를 담게 되면, `SignalFeed.tsx`에서 `suggestedQty` 표시 포맷이 달라져야 한다. 현재는 퍼센트 문자열("5")이 그대로 표시되는데, 수정 후에는 실제 수량("0.0083 BTC")과 비율("5%") 모두를 표시해야 한다.
- `Signal` 타입 (`types/index.ts:112`)에 `positionSizePercent` 필드 추가를 고려. `suggestedQty`가 절대 수량으로 바뀌면 프론트엔드의 모든 시그널 관련 표시도 업데이트 필요.
- **AccountOverview** 또는 **RiskStatusPanel**에서 "주문 당 실제 투입 금액" 정보를 표시하면 사용자가 사이징이 올바른지 확인할 수 있다.

#### C3. Backtest Fill Notification Missing `action` Field

- **동의** -- 백테스트 결과의 신뢰성에 직접 영향.

**필요한 UI 변경:**
- 백테스트 결과 페이지(`backtest/page.tsx`)에서 각 거래의 `action` 필드를 표시해야 한다. 현재 `BacktestTrade` 타입에 `action`이 포함되는지 확인 필요.
- 수정 전후 백테스트 결과가 크게 달라질 수 있으므로, 백테스트 결과에 "엔진 버전" 또는 "호환성 표시"를 추가하여 이전 결과와 구분하는 것이 좋다.

#### C4. Backtest Ignores IndicatorCache -- Strategies Crash

- **동의** -- 14/18 전략이 백테스트에서 크래시하면 사용자 경험에 치명적.

**필요한 UI 변경:**
- 현재 백테스트 폼(`BacktestForm.tsx`)에서 사용자가 아무 전략이나 선택 가능한데, 실제로 대부분 크래시한다. 수정 전이라도 백테스트 가능한 전략에 "백테스트 호환" 뱃지를 표시하거나, 호환되지 않는 전략은 선택 불가하도록 비활성화해야 한다.
- 수정 후에도 백테스트 실행 중 전략 에러가 발생하면, 단순 "백테스트 실패" 대신 어떤 전략이 어떤 이유로 실패했는지 상세 에러 메시지를 표시해야 한다.

#### C5. Default Strategy Names Don't Exist

- **동의** -- 이것은 내 제안서의 H2와 겹친다.

**필요한 UI 변경:**
- `translateStrategyName` (`utils.ts:159-179`)에 `MomentumStrategy`와 `MeanReversionStrategy`가 이미 포함되어 있다 -- 이 이름들은 존재하지 않는 전략이므로 제거해야 한다.
- 봇이 전략 0개로 시작되어도 아무 경고 없이 "실행 중" 상태가 되면 사용자는 정상 작동으로 오인한다. **BotControlPanel**에서 활성 전략 0개 상태를 경고로 표시해야 한다: "활성 전략 없음 -- 거래가 발생하지 않습니다."

---

### 전략 수정의 UI 반영 필요사항

#### 전략별 리뷰 결과 (Section 4)의 UI 반영

Trader가 18개 전략 각각에 대해 상세 리뷰를 제공했다. 이 수정들이 프론트엔드에 미치는 영향:

1. **Confidence 기반 필터링 (H3)**: 최소 confidence 임계값이 추가되면, `SignalFeed`에서 필터링된 시그널의 이유를 `rejectReason: 'confidence_too_low'`로 표시해야 한다. 현재 `rejectReason`이 있어도 표시하지 않는 문제(내 제안서 H5)와 결합하여, 거부 사유를 반드시 보여줘야 한다.

2. **RSI 구현 변경 (H2)**: Wilder RSI로 변경되면 시그널 발생 패턴이 달라진다. 사용자에게 직접 표시할 UI 변경은 없지만, 백테스트 결과가 달라지므로 백테스트 결과 목록에서 "지표 버전"을 표기하는 것이 좋다.

3. **전략 메타데이터 강화**: 각 전략의 R:R 비율, 레버리지, TP/SL 설정 등이 수정될 때, `StrategyPanel`에서 이 정보를 표시해야 한다. 현재 `StrategyListItem.defaultConfig`가 `Record<string, unknown>`이므로 핵심 필드를 명시적으로 타입화해야 한다:
```typescript
interface StrategyConfig {
  leverage?: number;
  positionSizePercent?: string;
  takeProfitPercent?: string;
  stopLossPercent?: string;
  // ... 전략별 추가 필드
  [key: string]: unknown;
}
```

4. **GridStrategy equity 주입 (4.6)**: Grid 전략의 equity 주입이 수정되면, 전략별 상세 뷰에서 각 전략이 사용하는 equity 비율을 표시하면 좋다.

5. **FundingRateStrategy 데이터 소스 (E6)**: 펀딩비 데이터가 제대로 수집되기 시작하면, 대시보드에 "현재 펀딩비" 위젯을 추가하는 것이 유용하다. 특히 FundingRate 전략이 활성화된 경우.

#### 조건부 동의 사항

- **H5 (Backtest 95% Position Sizing)**: 수정에 동의하나, 백테스트 UI에서 포지션 사이징을 사용자가 설정할 수 있어야 한다. 현재 `BacktestForm`에 `positionSizePercent` 입력 필드가 없다. 이 값을 백테스트 설정에서 조절 가능하게 만들어야 한다.
- **E4 (Exchange-Side Stop Loss)**: 거래소 SL 주문이 추가되면, `PositionsTable`에 "거래소 SL 가격" 열을 추가해야 한다. 현재 SL/TP 정보가 포지션 테이블에 없다.

---

### 리스크 관리 개선의 UI 반영

#### RiskEngine 개선 (Section 5)

1. **Per-Trade Risk Calculation**: 현재 `RiskStatusPanel.tsx`에 per-trade risk가 표시되지 않는다. ExposureGuard에 `maxRiskPerTradePercent`가 활성화되면, 각 주문의 리스크 비율을 시그널 피드와 거래 상세에 표시해야 한다.

2. **Correlation Risk Management (E2)**: 상관관계 리스크 관리가 추가되면, **RiskStatusPanel**에 "상관 노출도" 게이지를 추가해야 한다. 5개 BTC 상관 코인에 동시 롱이면 "실질 노출도: 85% (상관 보정)" 같은 표시.

3. **Leverage-Aware Exposure**: ExposureGuard에 레버리지가 반영되면, 노출도 표시도 레버리지 보정 값을 사용해야 한다. 현재 `exposureGuard.utilizationPercent`는 레버리지 미반영 값이다.

4. **DrawdownMonitor 자동 복구 (H7)**: Trader의 `resetDrawdown()` 제안에 동의한다. UI 관점에서:
   - `RiskStatusPanel.tsx:75-79`의 드로다운 halt 표시에 "리셋" 버튼을 추가해야 한다.
   - 이 버튼은 `ConfirmDialog`를 거쳐야 한다 ("드로다운 한도 초과로 거래가 중단되었습니다. 수동으로 리셋하시겠습니까?").
   - 리셋 API 엔드포인트를 `botApi`에 추가해야 한다.

5. **CircuitBreaker 리셋**: 서킷 브레이커가 발동되면 현재 `RiskStatusPanel`에 "발동" 뱃지만 표시된다. "리셋" 버튼과 "발동 원인" 상세 표시가 필요하다.

#### ExposureGuard 개선 (5.4)

- **effectivePrice fallback = '1'** 문제 수정 시 UI 영향은 없으나, 시장가 주문의 예상 체결가를 주문 확인 화면에 표시하면 좋다. 현재 수동 주문 API (`tradeApi.submitOrder`)가 있지만 수동 주문 UI가 없다.

---

### Trader가 놓친 UX 포인트

1. **시그널 거부 사유 미표시**: Trader가 H3에서 confidence 필터링을 제안했지만, 프론트엔드에서 `rejectReason`이 표시되지 않는 문제를 언급하지 않았다. 필터링이 추가되면 거부 사유 표시가 더욱 중요해진다.

2. **전략 상태 히스토리**: 전략이 activate/deactivate를 반복하면서 상태가 변하는데 (레짐 변경에 의해), 이 이력이 사용자에게 전혀 보이지 않는다. "MaTrendStrategy: 11:32 활성화 -> 14:15 비활성화 (레짐: RANGING)" 같은 로그가 필요하다.

3. **백테스트 결과의 시각적 신뢰도 표시**: Trader가 H1 (Sharpe 과장), H5 (95% 사이징) 등을 지적했는데, 이 수정이 적용되기 전의 백테스트 결과에 "주의: 이 결과는 과장된 수치를 포함할 수 있습니다" 같은 경고를 백테스트 결과 UI에 표시하면 좋겠다.

4. **포지션 크기 시뮬레이터**: C2 (percentage vs quantity) 수정 후, 사용자가 전략 설정 변경 시 "이 설정으로 1 BTC가 $100,000일 때, 포지션 크기는 $500 (0.005 BTC)입니다" 같은 실시간 미리보기를 제공하면 사이징 오류를 방지할 수 있다.

---

## Engineer 제안서 리뷰

### Critical Issues의 UI 영향

#### C-1. 미등록 unhandledRejection / uncaughtException 핸들러

- **동의** -- 프로세스 갑작스런 종료는 사용자에게 최악의 경험이다.

**사용자에게 어떻게 보여야 하는가:**
- 서버가 갑자기 종료되면 프론트엔드의 Socket.io 연결이 끊어진다. 현재 `useSocket.ts:38-39`에서 `connected: false`로 설정되고, `SystemHealth` 컴포넌트에 연결 해제가 표시된다. 하지만 이것만으로는 부족하다.
- **필요한 UI 변경:**
  - Socket 연결 해제가 5초 이상 지속되면 화면 상단에 빨간 배너: "서버 연결이 끊어졌습니다. 포지션 상태를 확인할 수 없습니다."
  - 봇이 실행 중이었는데 서버가 죽으면: "경고: 서버가 예기치 않게 종료되었습니다. 거래소에서 직접 포지션을 확인하세요."
  - 자동 재연결 상태 표시: "재연결 시도 중... (3/10)" 카운터

#### C-2. 동시 주문 제출 시 레이스 컨디션

- **동의** -- 사용자에게 직접 보이지 않는 버그이지만 결과적으로 의도치 않은 포지션이 생긴다.

**사용자에게 어떻게 보여야 하는가:**
- 뮤텍스 적용 후 거부된 주문은 시그널 피드에서 `rejectReason: 'order_in_progress'`로 표시되어야 한다.
- 포지션 테이블에서 동일 심볼에 두 개의 포지션이 열리는 것이 발견되면 경고 표시가 필요하다.

#### C-3. ExposureGuard equity=0 시 Division by Zero

- **동의** -- 봇 시작 직후 모든 주문 거부는 사용자 혼란을 유발한다.

**사용자에게 어떻게 보여야 하는가:**
- `AccountOverview`에서 equity가 '0'일 때 "계정 잔고 동기화 중..." 상태를 표시해야 한다.
- `RiskStatusPanel`에서 equity=0이면 "리스크 검증 불가 (잔고 미동기화)" 경고 표시.
- 봇 시작 직후 2-3초간 "초기화 중..." 오버레이를 대시보드에 표시하여 주문이 거부되는 것을 사용자가 이해할 수 있게 해야 한다.

#### C-4. Graceful Shutdown 순서 문제

- **동의** -- 마지막 주문의 DB 반영 누락은 데이터 불일치를 만든다.

**사용자에게 어떻게 보여야 하는가:**
- 서버가 shutdown 중일 때 프론트엔드에 "서버가 종료 중입니다. 잠시만 기다려 주세요..." 메시지를 Socket.io를 통해 전달. Engineer의 graceful shutdown에 `io.emit('server:shutting_down')` 이벤트를 추가하고, 프론트엔드에서 이를 수신하여 배너 표시.
- 다시 연결될 때까지 모든 제어 버튼(시작/정지/주문)을 비활성화.

#### C-5. mathUtils parseFloat 정밀도 문제

- **조건부 동의** -- Engineer가 "현재 규모에서 대부분 안전"이라 평가한 것에 동의하나, 장기적으로 `decimal.js` 마이그레이션이 필요하다.

**UI 영향:**
- `formatCurrency` (`utils.ts:4-12`)도 `parseFloat`를 사용하므로, 정밀도 손실이 프론트엔드에서도 발생할 수 있다. 백엔드에서 Decimal.js로 전환하면 프론트엔드의 표시 로직도 검토 필요.
- 큰 PnL 값의 소수점 이하가 정확하게 표시되는지 검증 테스트 필요.

---

### 시스템 상태 변화의 시각화

#### Graceful Shutdown (C-4)

**시각화 제안:**
```
+----------------------------------------------------+
| [빨간 배너] 서버가 종료 중입니다...                |
|   단계: 포지션 동기화 완료 -> DB 기록 대기 중      |
|   예상 소요: ~10초                                 |
+----------------------------------------------------+
```
- 단계별 진행률 표시 (봇 정지 -> DB 기록 -> 서버 종료)
- 종료 후 자동 재연결 카운트다운

#### 에러 복구 (C-1 관련)

**시각화 제안:**
```
+----------------------------------------------------+
| [주황 배너] 서버 연결이 끊어졌습니다                |
|   원인: 예기치 않은 오류                           |
|   재연결 시도: 3회째 (5초 후 재시도)               |
|   [수동 재연결] [거래소 직접 확인]                  |
+----------------------------------------------------+
```
- 재연결 성공 시 "서버에 다시 연결되었습니다. 데이터를 갱신합니다." 녹색 배너 3초 표시
- 재연결 실패 횟수가 10회를 넘으면 "서버에 연결할 수 없습니다. 시스템 관리자에게 문의하세요."

#### 서킷 브레이커 / 드로다운 halt (H-4, RiskEngine 관련)

**시각화 제안:**
- **서킷 브레이커 발동:**
```
+----------------------------------------------------+
| [빨간 오버레이]                                     |
|   서킷 브레이커가 발동되었습니다                    |
|   원인: 연속 5회 손실                               |
|   발동 시각: 14:32:15                               |
|   새 주문이 차단됩니다                              |
|                                                     |
|   [리셋] [상세 보기]                                |
+----------------------------------------------------+
```
- 서킷 브레이커 발동 시 `CIRCUIT_BREAK` Socket 이벤트를 수신하는 코드는 이미 있다 (`useSocket.ts:84-88`). 이를 화면에 표시하는 컴포넌트만 추가하면 된다.

- **드로다운 halt:**
```
+----------------------------------------------------+
| [빨간 전체 화면 오버레이]                           |
|                                                     |
|   거래가 중단되었습니다                             |
|   최대 드로다운 한도 초과                           |
|                                                     |
|   현재 드로다운: -8.3%                              |
|   한도: -10.0%                                      |
|   피크 자산: $10,523.45                              |
|   현재 자산: $9,650.12                               |
|                                                     |
|   [수동 리셋] [봇 정지]                              |
+----------------------------------------------------+
```

---

### 보안 개선의 UX 영향

#### E-3. API 인증/인가

- **조건부 동의** -- 인증이 추가되면 프론트엔드에 대규모 변경이 필요하다.

**필요한 UI 변경:**
- 로그인 페이지 신규 구현 (`/login`)
- JWT 토큰 관리: `api-client.ts`의 `request` 함수에 Authorization 헤더 추가
- 토큰 만료 시 자동 리다이렉트 또는 갱신
- Socket.io 연결에도 인증 토큰 전달 (`socket.ts`의 `io()` 옵션에 `auth: { token }` 추가)
- **주의**: 이 변경은 프론트엔드 작업량이 매우 크므로, 단계적으로 진행해야 한다. 1단계에서는 단순 API key 미들웨어 (환경변수로 공유 키)로 시작하고, 2단계에서 JWT를 도입하는 것이 현실적.

#### E-2. 요청 속도 제한

- **동의** -- Rate limiting이 적용되면 사용자에게 적절한 피드백이 필요하다.

**필요한 UI 변경:**
- `api-client.ts`에서 429 응답 처리 추가: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
- 폴링 간격이 rate limit에 걸리지 않도록 조정 필요. 현재 `useBotStatus` (5초), `usePositions` (5초), `useTrades` (10초) 등 다수의 폴링이 동시에 실행되므로, rate limit이 10 req/s면 충분하지만 1 req/s면 문제.
- Rate limit 응답에 `Retry-After` 헤더가 있으면, 자동으로 해당 시간 후 재시도하는 로직을 `request` 함수에 추가.

#### E-5. 입력 검증

- **동의** -- 서버의 입력 검증은 필수지만, 프론트엔드에서도 1차 검증이 있어야 한다.

**필요한 UI 변경:**
- `botApi.updateRiskParams`에 전달되는 파라미터에 대해 프론트엔드 폼 검증 추가 (음수 불가, 최대값 제한 등). 현재 리스크 파라미터 수정 UI 자체가 없는 문제 (내 제안서 E4)와 연결.
- `backtestApi.run`의 설정값에 대해 날짜 범위, 전략명 유효성 등 클라이언트 검증 추가.

#### E-4. CORS 제한

- **동의** -- UX 영향은 미미하지만, 프론트엔드 `.env.local`에서 `NEXT_PUBLIC_API_URL`이 CORS 허용 origin과 일치하는지 확인 필요.

---

### Engineer가 놓친 UI 포인트

1. **H-3 (PaperEngine 리스너 누적)의 사용자 가시적 증상**: Paper <-> Live 전환을 반복하면 fill 이벤트가 중복 처리되어 `TradesTable`에 동일 거래가 중복 표시될 수 있다. 이것은 사용자가 직접 볼 수 있는 증상이므로 "중복 거래 표시" 여부를 TradesTable에서 clientOid 기반 dedup으로 방어해야 한다.

2. **H-7 (기본 전략이 없는 경우)**: Engineer와 Trader 모두 이 문제를 지적했지만, 프론트엔드에서의 방어는 언급하지 않았다. `BotControlPanel`에서 봇이 `running` 상태인데 활성 전략 수가 0이면 경고 뱃지를 표시해야 한다.

3. **H-8 (Router 인스턴스 공유)**: 이 문제는 순수 백엔드 이슈로 UI 영향 없다. 하지만 테스트 환경에서 라우트 중복 등록이 되면 API 응답이 예측 불가해질 수 있으므로, 프론트엔드 테스트에서 이 문제를 감지하기 어렵다는 점을 참고.

4. **E-7 (메트릭/모니터링)**: Prometheus 메트릭이 추가되면, `SystemHealth` 컴포넌트에서 이 메트릭을 시각화하는 확장을 고려할 수 있다. WebSocket 재연결 횟수, 주문 에러율, 이벤트 루프 지연 등을 개발자/운영자 대시보드로 제공.

5. **9.1 (Correlation ID)**: traceId가 전파되면, 프론트엔드의 `SignalFeed`와 `TradesTable`에서 시그널 -> 주문 -> 체결의 전체 흐름을 하나의 traceId로 추적할 수 있는 "거래 추적" 기능이 가능해진다. 사용자가 시그널을 클릭하면 해당 시그널에서 파생된 주문과 체결 결과를 한눈에 볼 수 있다.

6. **SignalFilter.updatePositionCount() 미연동 (4.11)**: `max_concurrent` 필터가 실질적으로 작동하지 않으면 예상보다 많은 시그널이 승인된다. 이것이 수정되면 갑자기 시그널 거부율이 증가하여 사용자가 혼란스러울 수 있다. 수정 배포 시 변경 로그에 명시하고, `SignalFeed`에서 `max_concurrent_exceeded` 거부 사유를 명확히 표시해야 한다.

---

## 프론트엔드 변경 요구사항 종합

두 에이전트의 백엔드 변경에 따라 프론트엔드에서 추가/수정 필요한 컴포넌트:

### 신규 컴포넌트 (필수)

| 컴포넌트 | 사유 | 관련 이슈 |
|----------|------|-----------|
| `RiskAlertBanner` | Risk 이벤트(서킷 브레이커, 드로다운) 실시간 표시 | 내 C2, Eng C-1 |
| `ConnectionStatusBanner` | 서버 연결 상태 (끊김, 재연결, shutdown) 표시 | Eng C-1, C-4 |
| `app/error.tsx` | Next.js Error Boundary | 내 FE3.2 |
| `DrawdownResetButton` | 드로다운 halt에서 수동 리셋 | Trader H7 |

### 기존 컴포넌트 수정 (필수)

| 컴포넌트 | 변경 내용 | 관련 이슈 |
|----------|-----------|-----------|
| `BotControlPanel.tsx` | Emergency Stop에 ConfirmDialog 추가; 활성 전략 수 표시; 전략 0개 경고 | 내 C1, Trader C5, Eng H-7 |
| `types/index.ts` | `StrategyInfo.symbol` -> `symbols: string[]`; Signal에 `positionSizePercent` 추가 | Trader C1, C2 |
| `SignalFeed.tsx` | `rejectReason` 표시; confidence 표시 강화; 필터 추가 | 내 H5, Trader H3 |
| `RiskStatusPanel.tsx` | 서킷 브레이커 리셋 버튼; 드로다운 리셋 버튼; 레버리지 보정 노출도 | Trader H7, 5.1 |
| `StrategyPanel.tsx` | 심볼 목록 표시; 한국어명 우선 표시; max-height 스크롤; 접이식 | Trader C1; 내 H1, H2 |
| `AccountOverview.tsx` | equity=0 시 "동기화 중" 표시; USDT 단위 표기 | Eng C-3 |
| `api-client.ts` | 429 응답 처리; 네트워크 에러 래핑; 인증 헤더 (향후) | Eng E-2, E-3; 내 FE3.1 |
| `useSocket.ts` | 연결 끊김 지속 시간 추적; 서버 shutdown 이벤트 수신 | Eng C-1, C-4 |
| `socket.ts` | ref-counted 관리 또는 Context Provider | 내 C3 |
| `page.tsx` (Dashboard) | 레이아웃 재설계; 봇 상태별 adaptive rendering | 내 H1 |
| `PositionsTable.tsx` | 수동 청산 버튼; SL/TP 가격 표시; 전략 출처 | 내 H4, Trader E4 |
| `TradesTable.tsx` | clientOid 기반 dedup; 전략명 한국어 번역 | Eng H-3; 내 Review |
| `utils.ts` | `MomentumStrategy`, `MeanReversionStrategy` 번역 제거 | Trader C5 |

### 기존 컴포넌트 수정 (권장)

| 컴포넌트 | 변경 내용 | 관련 이슈 |
|----------|-----------|-----------|
| `BacktestForm.tsx` | positionSizePercent 입력; 백테스트 호환 전략 뱃지 | Trader H5, C4 |
| `EquityCurveChart.tsx` | Brush, Legend, ReferenceLine 추가 | 내 H3 |
| `SystemHealth.tsx` | 서비스별 상태 표시; latency 색상 코딩 | 내 Review |
| `TradingModeToggle.tsx` | 실거래 모드 시각적 경고 강화 | 내 C4 |
| `tournament/page.tsx` | 한국어 통일; confirm() -> ConfirmDialog | 내 E7 |

### 타입 변경

```typescript
// types/index.ts 변경 필요 사항 종합

// 1. StrategyInfo.symbol -> symbols (Trader C1)
interface StrategyInfo {
  symbols: string[];  // 기존 symbol: string에서 변경
  // ...
}

// 2. Signal에 필드 추가 (Trader C2, H3)
interface Signal {
  positionSizePercent?: string;  // 추가
  resolvedQty?: string;          // 추가 (실제 수량)
  traceId?: string;              // 추가 (Eng 9.1)
  // ...
}

// 3. RiskStatus 확장 (Trader 5.1)
interface RiskStatus {
  // 기존 필드 유지
  correlationExposure?: string;    // 추가 (Trader E2)
  leveragedExposure?: string;      // 추가 (Trader 5.1)
}

// 4. ServerEvent 추가 (Eng C-4)
interface ServerShutdownEvent {
  reason: string;
  timestamp: string;
}
```

---

## 3명 교차 분석 -- 공통 Critical 이슈 정리

### 3명 모두 동의하는 Critical 이슈

| ID | 이슈 | Trader | Engineer | UI/UX | 우선순위 |
|----|------|--------|----------|-------|----------|
| **CC-1** | 기본 전략 이름 미존재 (봇이 전략 0개로 시작) | C5 | H-7 | H2 (워크플로우) | **P0** -- 사용자가 즉시 혼란 |
| **CC-2** | Risk 이벤트가 사용자에게 전달되지 않음 | (5.1 gaps) | (9.2 누락) | C2 | **P0** -- 안전 관련 |
| **CC-3** | Graceful shutdown / 프로세스 종료 문제 | (미언급) | C-1, C-4 | (C3 소켓) | **P0** -- 데이터 손실 |

### Trader + Engineer 공통 (UI 반영 필요)

| ID | 이슈 | Trader | Engineer | UI 반영 필요사항 |
|----|------|--------|----------|-----------------|
| **CE-1** | CircuitBreaker rapidLosses 메모리 누수 | 5.2 | H-4 | 없음 (순수 백엔드) |
| **CE-2** | StrategyRouter deactivate 시 상태 손실 | 8.1 | H-6 | 전략 상태 히스토리 UI 추가 |
| **CE-3** | SignalFilter 메모리 관련 문제 | H6 | H-5 | 없음 (순수 백엔드) |
| **CE-4** | ExposureGuard equity=0 문제 | 5.4 | C-3 | AccountOverview에 "동기화 중" 표시 |
| **CE-5** | OrderManager 동시성 문제 | (5.4 gaps) | C-2 | 시그널 피드에 거부 사유 표시 |

### Trader만 발견 (UI 엔지니어 평가)

| ID | 이슈 | UI 영향 | 우선순위 |
|----|------|---------|----------|
| C1 | Multi-symbol 라우팅 | 높음 -- StrategyInfo 타입 변경, 심볼 표시 | P0 |
| C2 | Position sizing disconnect | 높음 -- SignalFeed 표시 변경 | P0 |
| C3 | Backtest fill action 누락 | 중간 -- 백테스트 결과 정확성 | P1 |
| C4 | Backtest IndicatorCache 미제공 | 높음 -- 백테스트 UI에 호환 표시 | P1 |
| H1 | Sharpe ratio 과장 | 중간 -- 백테스트 결과 표시 | P1 |
| H2 | RSI 구현 비표준 | 낮음 -- 직접 UI 영향 없음 | P2 |

### Engineer만 발견 (UI 엔지니어 평가)

| ID | 이슈 | UI 영향 | 우선순위 |
|----|------|---------|----------|
| C-2 | 주문 동시성 레이스 컨디션 | 중간 -- 거부 사유 표시 필요 | P0 |
| H-1,2 | destroy() 미호출 | 없음 (순수 백엔드) | P1 |
| H-3 | PaperEngine 리스너 누적 | 중간 -- 중복 거래 표시 가능 | P1 |
| E-2 | Rate limiting | 높음 -- 429 응답 처리 UI 필요 | P1 |
| E-3 | API 인증 | 매우 높음 -- 로그인 페이지 신규 | P2 (장기) |
| E-5 | 입력 검증 | 중간 -- 프론트엔드 폼 검증 추가 | P1 |
| 9.1 | Correlation ID | 중간 -- 거래 추적 기능 가능 | P2 |

### UI 엔지니어만 발견 (다른 에이전트 추가 검토 필요)

| ID | 이슈 | 프론트엔드 위치 |
|----|------|----------------|
| C1 | Emergency Stop 확인 다이얼로그 | `BotControlPanel.tsx` |
| C3 | Socket.io 싱글턴 생명주기 | `socket.ts`, `useSocket.ts` |
| C4 | 실거래/가상거래 시각적 구분 | `page.tsx`, 전체 레이아웃 |
| H1 | 대시보드 정보 우선순위 역전 | `page.tsx` 레이아웃 |
| FE2 | useSocket 불필요한 리렌더링 | `useSocket.ts` |
| FE3 | Error Boundary 부재 | 전체 앱 |
| FE5 | 접근성 부재 (ARIA, 키보드 등) | 전체 컴포넌트 |

---

## 최종 통합 우선순위 (3명 합의 기반 추천)

### Tier 0 -- 실거래 전 반드시 수정 (안전 관련)

1. Multi-symbol 라우팅 수정 + 프론트엔드 타입 변경 (Trader C1)
2. Position sizing 해결 + 프론트엔드 표시 변경 (Trader C2)
3. Emergency Stop 확인 다이얼로그 (UI C1)
4. unhandledRejection 핸들러 + 서버 연결 상태 배너 (Eng C-1)
5. Risk 이벤트 실시간 UI 표시 (UI C2)
6. 주문 동시성 제어 (Eng C-2)
7. ExposureGuard equity=0 방어 + UI "동기화 중" 표시 (Eng C-3)
8. 실거래 모드 시각적 경고 강화 (UI C4)

### Tier 1 -- 1주 내 수정 (신뢰성 관련)

9. 기본 전략 이름 수정 + UI 전략 0개 경고 (Trader C5, Eng H-7)
10. 백테스트 IndicatorCache + fill action 수정 + 호환 표시 (Trader C3, C4)
11. Graceful shutdown 개선 + 프론트엔드 shutdown 이벤트 (Eng C-4)
12. SignalFeed 거부 사유 표시 (UI H5, Trader H3)
13. DrawdownMonitor 리셋 기능 + UI 리셋 버튼 (Trader H7)
14. Error Boundary 추가 (UI FE3.2)

### Tier 2 -- 2주 내 수정 (품질 관련)

15. 대시보드 레이아웃 재설계 (UI H1)
16. 전략 패널 접이식 + 시작 버튼 연동 (UI H2)
17. Sharpe ratio 정규화 + 백테스트 사이징 (Trader H1, H5)
18. RSI Wilder 구현 (Trader H2)
19. API rate limiting + 프론트엔드 429 처리 (Eng E-2)
20. 입력 검증 + 프론트엔드 폼 검증 (Eng E-5)
