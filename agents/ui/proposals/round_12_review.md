# Round 12 Cross-Review -- Senior UI/UX Engineer

> 작성일: 2026-02-17
> 리뷰어: Senior UI/UX Engineer
> 검증 방법: 제안서 참조 파일 직접 Read + 프론트엔드 소스 코드 교차 확인

---

## Trader 제안서 리뷰

### P12-1: 이중 트레일링 스탑 통합 -- ✅ 동의 (방안 B)

**코드 검증 완료**:
- `maTrendStrategy.js` L42: `trailingStop: { enabled: true, activationPercent: '1.5', callbackPercent: '1.0' }` 확인
- `maTrendStrategy.js` L74: `this._trailingStopPercent = merged.trailingStopPercent` ('2') 확인
- `maTrendStrategy.js` L152-177: 자체 트레일링 로직 (최고가 대비 2% 하락 시 발동) 확인
- `strategyBase.js` L103-131: StrategyBase의 `_checkTrailingStop()` 기반 자동 트레일링 확인
- `adaptiveRegimeStrategy.js` L49: `trailingStop: { enabled: true }` 확인

**UX 영향**: 이중 close 시그널은 프론트엔드 SignalFeed에 동일 포지션에 대한 연속 close 시그널이 짧은 간격으로 2건 표시될 수 있다. 사용자 혼란 유발 가능. 방안 B(metadata 비활성화)가 변경 최소화 측면에서 적합하다.

**FE 추가 조치 불필요**.

---

### P12-2: 전략 close 시그널 `reduceOnly` 일괄 추가 -- ✅ 동의

**코드 검증 완료**:
- `orderManager.js` L52-56: `ACTION_MAP`이 `CLOSE_LONG/SHORT`을 항상 `reduceOnly: true`로 매핑하는 것 확인
- `botService.js` L487: `trade.reduceOnly` 체크로 포지션 매핑 정리 확인

기능적 변경 아님. 코드 일관성 개선이므로 프론트엔드 영향 없음. 디버깅 시 SignalFeed의 시그널 상세 정보에서 `reduceOnly` 필드 유무가 일관되면 개발자 경험이 향상된다.

**FE 추가 조치 불필요**.

---

### P12-3: 백테스트 레버리지 반영 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `backtestEngine.js` L584-596: 레버리지 없이 `positionValue = cash * positionSizePct / 100` 확인
- `BacktestForm.tsx`: 현재 레버리지 입력 필드 없음 확인
- `BacktestStatsPanel.tsx` L168-172: "레버리지 미반영" 경고 문구가 이미 표시되어 있음 확인
- `backtest.ts` (타입): `BacktestConfig`에 `leverage` 필드 없음 확인

**FE 영향 -- 반드시 동기화 필요**:

1. **BacktestConfig 타입 확장**: `leverage?: string` 필드 추가 필요
2. **BacktestForm UI**: 레버리지 입력 컨트롤 추가 필요. Trader가 요청한 "슬라이더 또는 입력 필드, 범위 1~20x"에 대해 다음을 권장:
   - **드롭다운(select) 추천** -- 슬라이더보다 정확한 값 선택이 가능하고, 허용 값(1x, 2x, 3x, 5x, 10x, 20x)을 명시적으로 제한할 수 있음
   - 위치: "고급 설정" 섹션 내 기존 수수료/슬리피지 입력 옆
   - 기본값: 1x (백테스트의 기본 동작을 변경하지 않음)
   - 5x 이상 선택 시 경고 메시지 표시: "높은 레버리지는 손실을 크게 확대할 수 있습니다"
3. **BacktestStatsPanel 경고 문구 갱신**: 레버리지가 1x가 아닐 때는 "레버리지 미반영" 경고를 제거하고, 대신 "레버리지 Nx 적용 (강제 청산 미시뮬레이션)" 으로 변경
4. **BacktestMetrics에 leverage 표시**: 결과 패널에 적용된 레버리지 값을 표시하여 어떤 조건에서 테스트되었는지 명확히 함

**보완 요청**: 백엔드 API 응답의 `config` 객체에 `leverage` 값을 포함시켜 프론트엔드가 결과 표시 시 참조할 수 있도록 해야 한다.

---

### P12-4: ExposureGuard 레버리지 인지 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `exposureGuard.js` L120-155: 명목(notional) 기준 계산 확인. `orderValue = qty * effectivePrice`
- `RiskStatusPanel.tsx`: 현재 "노출도"를 `utilizationPercent` 하나의 수치로 표시 확인

**FE 영향 -- 데이터 구분 표시 필요**:

Trader가 요청한 "마진 사용률 vs 명목 노출률 구분 표시"는 타당하다. 현재 `RiskStatusPanel`의 "노출도" 섹션은 단일 퍼센트 바만 표시한다.

그러나 **한 스프린트 내 구현 범위를 제한**할 것을 권장:
- 이번 스프린트: ExposureGuard API 응답에 `marginUtilization`과 `notionalExposure`를 모두 포함 (백엔드)
- 프론트엔드: 노출도 섹션 하단에 "마진: X% / 명목: Y%" 텍스트 추가 (최소 변경)
- 별도 프로그레스 바 2개는 정보 과부하 우려가 있으므로, 기본 프로그레스 바는 명목 기준 유지하고 마진 수치는 보조 텍스트로 표시

**보완 요청**: 백엔드 `riskEngine.getStatus()` 응답 스키마에 `marginUtilization` 필드를 추가해야 프론트엔드에서 소비 가능.

---

### P12-5: 전략 간 방향성 집중도 모니터링 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `signalFilter.js`: `symbolConflictFilter`만 존재, 방향성 집중도 필터 없음 확인
- `PositionsTable.tsx`: 현재 포지션 목록에 방향 집중도 지표 없음 확인

**FE 영향 -- 표시 방식 제안**:

Trader가 요청한 "Long 3/3" 표시는 유용하지만, PositionsTable 내부가 아닌 **PositionsTable 상단 요약 영역**에 배치하는 것이 적절하다:

- 포지션 테이블은 이미 컬럼이 9~10개로 밀도가 높음
- 대신 Card 제목 옆 또는 테이블 위에 Badge 형태로 표시:
  - `Long 3 / Short 0` -- 집중도가 높으면 경고 색상(amber)
  - `Long 2 / Short 1` -- 균형 상태면 일반 색상
- 이 방향 집중도 데이터는 백엔드 API 응답에 포함되어야 함

**보완 요청**: 방향성 집중도 데이터를 어떤 API endpoint로 노출할 것인지 명확히 해야 한다. `/api/risk/status` 응답에 `directionalConcentration: { long: N, short: M, max: K }` 형태를 권장.

---

### P12-6: ATR 기반 동적 TP/SL 범용화 -- ✅ 동의

Tier 2 제안이며 백엔드 전략 로직 변경. 프론트엔드에 직접적 영향 없음. TP/SL 값이 동적으로 변경되더라도 현재 PositionsTable의 "SL 가격" 컬럼이 이미 실시간 갱신되므로 추가 FE 작업 불필요.

**FE 추가 조치 불필요**.

---

### P12-7: Calmar Ratio 연율화 -- ✅ 동의

**코드 검증 완료**:
- `backtestMetrics.js` L310-312: `totalReturn / maxDrawdownPercent` (연율화 미적용) 확인
- `BacktestStatsPanel.tsx` L49: "칼마 비율" 라벨만 표시, 연율화 여부 미표시 확인

**FE 보완 필요**:
- Trader가 요청한 "연율화 표시"에 동의. `BacktestStatsPanel`의 `STATS` 배열에서 `calmarRatio`의 `label`을 `'칼마 비율 (연율화)'`로 변경하면 충분
- 또는 값 옆에 작은 텍스트로 "(연율화)" 추가

매우 작은 변경이므로 이번 스프린트에 포함 가능.

---

### P12-8: 포트폴리오 백테스트 -- ✅ 동의 (Tier 3 유지)

Tier 3(장기 로드맵)으로 적절하다. 이번 스프린트 범위 외. 향후 구현 시 프론트엔드에 "포트폴리오 백테스트" 전용 폼과 결과 뷰가 필요하므로 상당한 FE 작업이 수반될 것이다.

**FE 추가 조치 불필요 (이번 스프린트)**.

---

### P12-9: CoinSelector 절대 비용 필터 -- ✅ 동의

백엔드 내부 로직 변경. 프론트엔드에 직접적 영향 없음. CoinScoreboard 컴포넌트가 이미 코인 스코어를 표시하고 있으므로, 비용 필터로 제외된 코인이 목록에서 빠지는 것은 자연스럽게 반영된다.

**FE 추가 조치 불필요**.

---

## Engineer 제안서 리뷰

### E12-1: MarketDataCache sweep 타이머 추가 -- ✅ 동의

**코드 검증 완료**:
- `marketDataCache.js`: `get()` 시에만 만료 항목 삭제, 주기적 sweep 없음 확인
- Map에 `stop()` 메서드도 없음 확인

프론트엔드 영향 없음. 순수 백엔드 메모리 관리 개선.

**FE 추가 조치 불필요**.

---

### E12-2: CoinSelector selectCoins() 재진입 가드 -- ✅ 동의

**코드 검증 완료**:
- `coinSelector.js`: `selectCoins()`가 async 함수이며 재진입 보호 없음 확인

프론트엔드 영향 없음.

**FE 추가 조치 불필요**.

---

### E12-3: TickerAggregator stale 심볼 정리 -- ✅ 동의

**코드 검증 완료**:
- `tickerAggregator.js` L108: `this._tickers.set(data.symbol, data)` -- 추가만 있고 삭제 없음 확인
- L148: `Array.from(this._tickers.values())` -- 매번 전체 배열 생성 확인

프론트엔드가 `tickerAggregator`의 aggregate 데이터를 소켓으로 수신하므로, stale 심볼 정리가 aggregate 통계의 정확도를 높인다. 간접적으로 대시보드 MarketIntelligence 컴포넌트의 데이터 품질이 향상됨.

**FE 추가 조치 불필요**.

---

### E12-4: BotService 코인 재선정 중첩 실행 방지 -- ✅ 동의

**코드 검증 완료**:
- `botService.js`: `_performCoinReselection()`에 중첩 실행 방지 없음 확인

프론트엔드 영향 없음. 다만 중첩 실행으로 인한 전략-심볼 매핑 불일치가 발생하면 StrategySymbolMap 컴포넌트에 잘못된 매핑이 표시될 수 있으므로, 이 수정은 FE 데이터 정확도에도 기여한다.

**FE 추가 조치 불필요**.

---

### E12-5: ExchangeClient rate limit 대응 강화 -- ✅ 동의

프론트엔드 영향 없음. 순수 백엔드 인프라 개선.

**FE 추가 조치 불필요**.

---

### E12-6: RateLimiter shift() 성능 최적화 -- ✅ 동의

**코드 검증 완료**:
- `rateLimiter.js` L80-83: `Array.shift()` O(n) 루프 확인

현재 단일 클라이언트 환경에서 실질적 영향은 낮으나, 원칙적으로 올바른 지적. T2 우선순위가 적절하다.

**FE 추가 조치 불필요**.

---

### E12-7: OrderManager WS 재연결 fill 보상 -- ⚠️ 조건부 동의

WS fill 누락 시 Trade DB 미반영은 프론트엔드 TradesTable과 analytics 데이터에 직접 영향을 미친다.

**FE 관점 보완 사항**:
- 누락된 fill이 reconciliation으로 뒤늦게 추가될 경우, 프론트엔드가 이를 인지할 수 있어야 함
- 현재 TradesTable은 폴링(3초)으로 갱신하므로 자동 반영되지만, **reconciliation 이벤트를 별도로 emit하여 프론트엔드에서 "데이터 동기화 완료" 토스트를 표시**하면 사용자 신뢰도가 향상됨
- 이는 이번 스프린트 범위 외로 두되, 구현 시 고려해달라는 의견

---

### E12-8: PaperEngine mark price 기반 SL/TP 트리거 -- ✅ 동의

프론트엔드에 직접적 영향 없음. PaperEngine의 체결 로직 개선이므로 페이퍼 트레이딩 결과의 정확도가 향상된다.

**FE 추가 조치 불필요**.

---

### E12-9: BotService.start() 실패 시 rollback -- ✅ 동의

프론트엔드 영향: 봇 시작 실패 시 현재 `BotControlPanel`이 에러를 표시하고 상태를 `IDLE`로 돌리는데, 백엔드에서 rollback이 정상 처리되면 FE의 에러 처리 흐름이 더 안정적이 된다.

**FE 추가 조치 불필요**.

---

### E12-10: PositionManager marginMode 삼항 수정 -- ✅ 동의

**코드 검증 완료**:
- `positionManager.js` L439: `marginMode: raw.marginMode || raw.marginCoin ? 'crossed' : 'crossed'` -- 양쪽 모두 `'crossed'` 확인

5분 수정. 프론트엔드 Position 타입에 `marginMode`가 없으므로 현재 직접적 FE 영향은 없지만, 향후 margin mode 표시 추가 시 정확한 데이터가 필요하다.

**FE 추가 조치 불필요**.

---

### E12-11: BacktestEngine equityCurve 샘플링 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `backtestEngine.js` L906-914: 매 kline마다 `_equityCurve.push()` 확인

**FE 영향 -- 정밀도 요구사항 답변**:

Engineer가 요청한 "프론트엔드 equity curve 정밀도 요구사항" 확인:

- `BacktestEquityCurve.tsx`와 `EquityCurveBase.tsx`는 Recharts 기반으로 렌더링
- Recharts가 수만 개 데이터 포인트를 렌더링하면 브라우저 성능이 저하됨
- 현재 **API 레벨(GET /api/backtest/:id)에서 이미 downsample이 적용**되고 있으므로, 엔진 레벨에서 추가 제한해도 FE에 부정적 영향 없음
- **권장**: 엔진 레벨에서 max 10,000 포인트로 제한 (API downsample이 1,000~2,000 포인트로 추가 축소). 차트 렌더링에 충분한 해상도

**보완 조건**: 엔진 레벨 샘플링은 **균등 간격 샘플링**(evenly spaced)이어야 한다. 랜덤 샘플링이나 앞부분만 자르는 방식은 차트의 시각적 왜곡을 초래한다. 또한 **첫 포인트와 마지막 포인트는 반드시 포함**해야 차트의 시작/종료가 정확하다.

---

### E12-12: HealthCheck WS 상태 검사 추가 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `healthCheck.js` L67: `checks.websocket = this._checkWebsocket()` 존재 확인
- 그러나 현재 WS 검사는 연결 상태(connected/disconnected)만 확인하고, 마지막 메시지 수신 시간이나 "좀비 연결" 감지는 없음
- `SystemHealth.tsx`: `WS` Badge가 소켓 연결 상태(`socketConnected`)만 표시 확인

**FE 영향 -- 대시보드 표시 개선 필요**:

Engineer가 요청한 "WebSocket 연결 상태 표시 컴포넌트" 검토 결과:

현재 `SystemHealth.tsx`는 이미 WS Badge를 표시하고 있지만, 이는 **프론트엔드 Socket.io 연결** 상태이지 백엔드의 Bitget WS 연결 상태가 아니다. 이 두 가지는 다른 정보:

- FE Socket.io: 브라우저 <-> 백엔드 서버 간 연결
- BE Bitget WS: 백엔드 서버 <-> Bitget 거래소 간 연결

**제안**: HealthCheck API 응답의 `websocket` 항목에 상세 정보(마지막 메시지 시간, 구독 심볼 수)가 추가되면:
- `SystemHealth.tsx`의 WS Badge를 **2개로 분리**: "FE WS" (현재) + "거래소 WS" (신규)
- 또는 기존 WS Badge의 tooltip에 상세 정보 표시
- 이 FE 변경은 백엔드 API 변경이 확정된 후 진행 가능

**보완 조건**: 백엔드 healthCheck 응답의 websocket 스키마를 명확히 정의해달라. 최소한 `{ status, publicWs: { connected, lastMessageAt, subscribedTopics }, privateWs: { connected, lastMessageAt } }` 형태를 권장.

---

### E12-13: Logger context 크기 제한 -- ✅ 동의

프론트엔드 영향 없음. 순수 백엔드 품질 개선.

**FE 추가 조치 불필요**.

---

### E12-14: BacktestRoutes 동시 실행 수 제한 -- ⚠️ 조건부 동의

**코드 검증 완료**:
- `backtestRoutes.js` L95: `setImmediate(async () => { ... })` -- 동시 실행 제한 없음 확인
- `useBacktest.ts`: 실행 중(`running=true`)에도 폼 제출 버튼이 `disabled`되어 있어 **단일 사용자 기준으로는 연속 실행이 차단**됨 (`BacktestForm.tsx` L151: `!running`)
- 그러나 브라우저 탭 2개 열면 동시 실행 가능

**FE 영향 -- UX 처리 제안**:

Engineer가 요청한 "프론트엔드에서 백테스트 실행 중 추가 실행 비활성화" 검토 결과:

현재 `BacktestForm`은 `running` prop으로 이미 비활성화된다. 문제는 **다른 브라우저 탭이나 API 직접 호출**을 통한 동시 실행이다. 이는 프론트엔드만으로는 완전히 차단 불가하므로 백엔드 제한이 맞다.

**추가 FE 보완**: 백엔드가 동시 실행 제한(MAX_CONCURRENT_BACKTESTS = 2)으로 요청을 거부할 경우:
- HTTP 응답에 적절한 에러 코드/메시지 포함 필요 (예: `{ success: false, error: 'max_concurrent_backtests_exceeded', message: '동시 백테스트 최대 2개까지 허용됩니다' }`)
- `useBacktest.ts`의 `runBacktest`에서 이 에러를 catch하여 사용자에게 토스트로 안내
- 현재 에러 처리 흐름이 이미 구현되어 있으므로 (`setError(...)`, L97), 백엔드 에러 메시지만 적절하면 FE는 추가 변경 없이 동작

---

### E12-15: InstrumentCache staleness 경고 -- ✅ 동의

프론트엔드 영향 없음. 백엔드 관측성 개선.

**FE 추가 조치 불필요**.

---

### E12-16: CoinSelector _prevVol24h 정리 -- ✅ 동의

프론트엔드 영향 없음. 미미한 메모리 누수 방지.

**FE 추가 조치 불필요**.

---

## 종합 의견 및 보완 제안

### 1. 전체 평가

두 제안서 모두 코드 근거가 정확하며, 실제 소스 코드를 확인한 결과 지적 사항의 신뢰도가 높다.

- **Trader 제안서**: 9건 중 5건 동의, 4건 조건부 동의. 전략 로직 품질 개선에 집중. P12-1(이중 트레일링)과 P12-3(백테스트 레버리지)이 가장 높은 가치.
- **Engineer 제안서**: 16건 중 12건 동의, 4건 조건부 동의. 운영 안정성과 메모리 관리에 집중. E12-1(캐시 sweep)과 E12-2(재진입 가드)가 가장 긴급.

### 2. 프론트엔드 작업 영향 요약

이번 라운드에서 **프론트엔드 변경이 필요한 백엔드 제안**:

| 제안 | FE 변경 내용 | 예상 시간 |
|------|-------------|-----------|
| P12-3 (백테스트 레버리지) | BacktestConfig 타입 + BacktestForm 레버리지 입력 + StatsPanel 경고 갱신 | 1시간 |
| P12-4 (ExposureGuard 레버리지) | RiskStatusPanel에 마진/명목 구분 텍스트 추가 | 30분 |
| P12-5 (방향성 집중도) | PositionsTable 상단에 방향 집중도 Badge 추가 | 30분 |
| P12-7 (Calmar 연율화) | BacktestStatsPanel 라벨 변경 | 5분 |
| E12-12 (WS 상태 검사) | SystemHealth 거래소 WS 상태 표시 | 45분 |
| E12-14 (백테스트 동시 제한) | 에러 메시지 표시 (기존 흐름 활용) | 10분 |

**총 FE 추가 작업**: 약 3시간

### 3. 누락 사항 지적

**A. 백엔드 API 스키마 변경 문서화 부재**

Trader P12-3, P12-4, P12-5와 Engineer E12-12의 백엔드 변경은 API 응답 스키마를 변경한다. 그러나 두 제안서 모두 **변경되는 API 응답의 구체적 스키마**를 명시하지 않았다. 프론트엔드 TypeScript 타입 업데이트를 위해 다음이 필요하다:

- P12-3: `POST /api/backtest/run` 요청 body의 `leverage` 필드 타입/기본값
- P12-4: `/api/risk/status` 응답의 ExposureGuard 객체에 추가되는 필드
- P12-5: `/api/risk/status` 또는 `/api/trades/positions` 응답에 추가되는 방향 집중도 필드
- E12-12: `/api/health/status` 응답의 websocket 객체 확장 스키마

**제안**: 구현 Phase에서 API 스키마 변경을 먼저 확정하고, 프론트엔드 타입 업데이트를 동기화할 것.

**B. P12-3과 E12-11의 상호 의존성**

백테스트 레버리지(P12-3) 도입 시 PnL 변동폭이 커져 equity curve의 변동이 증가한다. 이는 E12-11(equity curve 샘플링)의 샘플링 전략에 영향을 줄 수 있다. 두 제안을 함께 구현할 경우, 샘플링이 레버리지로 인한 급격한 equity 변동(특히 큰 손실)을 놓치지 않도록 **peak/valley preservation** 샘플링 알고리즘을 권장한다 (단순 균등 간격이 아닌, 극값을 보존하는 방식).

### 4. 스프린트 우선순위 제안 (FE 관점)

FE 변경이 필요한 항목의 구현 순서:

1. **P12-7** (Calmar 라벨) -- 5분, 즉시 가능
2. **P12-3** (백테스트 레버리지 UI) -- 백엔드 API 확정 후 진행, 1시간
3. **E12-14** (동시 실행 에러 표시) -- 백엔드 에러 응답 형식 확인 후, 10분
4. **P12-4** (마진/명목 구분) -- 백엔드 API 확정 후 진행, 30분
5. **P12-5** (방향 집중도) -- 백엔드 API 확정 후 진행, 30분
6. **E12-12** (거래소 WS 상태) -- 백엔드 API 확정 후 진행, 45분

항목 2~6은 모두 **백엔드 API 스키마 확정이 선행 조건**이므로, 구현 Phase에서 백엔드 작업을 먼저 완료하고 FE를 후속 진행하는 워크플로우를 권장한다.
