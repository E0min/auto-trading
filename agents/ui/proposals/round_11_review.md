# Round 11 Cross-Review — Senior UI/UX Engineer

> 작성일: 2026-02-17
> 역할: Senior UI/UX Engineer (UX, 대시보드, 시각화, 프론트엔드, 접근성)
> 대상: Trader 제안서 (R11-T1~T11) + Engineer 제안서 (E11-1~E11-15)

---

## Trader 제안서 리뷰

### R11-T1. 트레일링 스탑 이중 구현 통합 (MaTrend, TurtleBreakout)

**판정: ✅ 동의**

이중 청산 시그널은 사용자에게 혼란스러운 거래 내역을 생성할 수 있고, SignalFeed 컴포넌트에서 동일 포지션에 대한 중복 close 시그널이 연속 표시되는 UX 문제를 유발한다. StrategyBase 단일 경로로 통합하면 프론트엔드에서 시그널 해석이 일관되어진다. 별도의 프론트엔드 변경은 불필요하다.

---

### R11-T2. RsiPivot/Supertrend _checkTrailingStop() 호출 추가

**판정: ✅ 동의**

순수 백엔드 수정이며, 프론트엔드 타입이나 API 응답에 영향 없다. 트레일링 스탑이 정상 작동하면 기존 close_long/close_short 시그널로 프론트엔드에 전달되므로 추가 UI 작업 불필요.

---

### R11-T3. BollingerReversion super.onFill() 호출 추가

**판정: ✅ 동의**

내부 로직 정합성 수정. 프론트엔드 영향 없음.

---

### R11-T4. MaTrend/Turtle _entryPrice 설정을 onFill()로 이동

**판정: ✅ 동의**

이 변경은 시그널 발행과 실제 체결 사이의 상태 불일치를 해소한다. 프론트엔드에서 Position 타입의 `entryPrice`는 거래소/positionManager로부터 채워지므로 직접적 영향은 없다. 다만, 만약 시그널의 `suggestedPrice`와 Position의 `entryPrice` 사이의 차이가 더 명확해진다면, 장기적으로 시그널 카드에 "예상 진입가 vs 실제 진입가" 비교 표시를 고려할 수 있다.

---

### R11-T5. SignalFilter 클로즈 바이패스 수정

**판정: ✅ 동의 (P0 최우선)**

이 버그는 사용자 관점에서 **가장 심각한 UX 영향**을 가진다. 정당한 청산 시그널이 필터링되면:
- SignalFeed에서 close 시그널이 `riskApproved: false`로 표시되어 사용자가 "왜 청산이 안 되지?"라는 혼란에 빠짐
- 포지션이 예상보다 오래 유지되어 손실 확대 가능
- 사용자가 수동으로 "청산" 버튼을 눌러야 하는 상황 발생

`action.startsWith('close')` 방식이 가장 간결하며, 향후 새로운 close 액션 타입이 추가되더라도 대응 가능. 현재 프론트엔드 `SignalAction` 타입도 `'close_long' | 'close_short'`이므로 타입 일관성 확인됨.

---

### R11-T6. 백테스트 getEquity 미실현 PnL 포함

**판정: ⚠️ 조건부 동의**

**보완 필요**: 백테스트 결과에서 equity curve가 달라지면, 프론트엔드 `BacktestEquityCurve` 컴포넌트와 `BacktestStatsPanel`에 표시되는 수치가 변한다. 현재 `BacktestEquityPoint` 타입에 `equity`와 `cash`가 분리되어 있는데(`types/backtest.ts` line 29-33), 미실현 PnL 포함 시:

1. `equity` 필드가 `cash + unrealizedPnl`로 바뀌면 기존 의미 변경 -- **`unrealizedPnl` 필드를 BacktestEquityPoint에 추가**하여 equity curve 차트에서 현금 vs 미실현 구분 표시를 가능하게 해야 한다.
2. `BacktestStatsPanel`의 면책 조항에 현재 "펀딩비 미반영"이 표시되어 있는데(`BacktestStatsPanel.tsx` line 160), equity 계산 방식 변경도 명시할 필요.

**프론트엔드 작업 예상**: `BacktestEquityPoint` 타입에 `unrealizedPnl?: string` 추가 + equity curve 차트에 점선 오버레이로 미실현 PnL 반영 전/후 비교 옵션.

---

### R11-T7. 백테스트 펀딩 비용 cash 반영

**판정: ⚠️ 조건부 동의**

**보완 필요**:
1. `BacktestMetrics` 타입에 `totalFundingCost: string` 필드 추가 필요 -- 현재 `totalFees`만 있는데, 펀딩비는 수수료와 성격이 다르므로 별도 표시가 적절.
2. `BacktestStatsPanel`에 "총 펀딩비" 통계 항목 추가 필요.
3. 현재 면책 조항의 **"펀딩비 미반영"** 문구(`BacktestStatsPanel.tsx` line 160)를 수정해야 함 -- 펀딩비 반영 시 "펀딩비 근사치 반영 (실제와 상이할 수 있음)"으로 변경.

Trader가 UI에게 요청한 "펀딩 반영 전/후 순이익 비교" 표시는 좋은 아이디어이나, Tier 1 단계에서는 `totalFundingCost` 단일 수치 표시만으로 충분하다. 비교 차트는 후속 라운드에서 고려.

---

### R11-T8. CoinSelector F7 volMomentum 수정

**판정: ✅ 동의**

프론트엔드의 `CoinFactorScores` 타입(`types/index.ts` line 329-337)에 `volMomentum`이 이미 정의되어 있으므로, 타입 변경 없이 값 의미만 변한다. `FactorBreakdown` 컴포넌트에서 Factor 레이더 차트나 바 차트로 표시 중인데, 값 범위가 절대 거래량 → 변화율로 바뀌면 스케일 표시가 달라질 수 있다. 다만 이미 정규화된 0~1 점수로 전달되고 있다면 문제없음.

---

### R11-T9. 변동성 기반 포지션 사이징 (ATR 모듈)

**판정: ⚠️ 조건부 동의**

**보완 필요**: 사용자가 포지션 사이징 방식의 변경을 인지해야 한다:

1. **전략 설정 UI에 사이징 모드 표시**: StrategyCard/StrategyDetail에서 "고정 비율 3%" vs "ATR 기반 2% 리스크" 같은 사이징 방식을 표시해야 함. 현재 `StrategyInfo.config`에 담길 수 있지만, 명확한 레이블이 필요.
2. **시그널 데이터에 사이징 근거 추가**: Signal 타입에 `positionSizePercent`와 `resolvedQty`가 이미 있는데(`types/index.ts` line 128-129), ATR 기반 사이징 시 `riskPerUnit`이나 `atrValue`도 포함되면 사용자가 왜 그 수량이 결정되었는지 이해할 수 있다.
3. **Tier 2 (2주)이면 프론트엔드 작업은 Phase 3 이후로 계획 가능** -- 급하지 않으나 구현 시 반드시 UI 반영 포함해야 함.

---

### R11-T10. StrategyBase maxHoldTime + 강제 청산

**판정: ⚠️ 조건부 동의**

**보완 필요**:
1. Trader가 UI에게 요청한 "포지션 보유 경과 시간 표시"는 **R11-T10 구현 전에도 가능**하고, 즉시 구현할 가치가 있다. Position 타입에 `openedAt` 또는 `entryTime` 타임스탬프가 필요하다. 현재 `Position` 타입(`types/index.ts` line 90-102)에는 시간 정보가 없다.
2. **필요한 백엔드 변경**: Position 응답에 `openedAt: string` 필드 추가.
3. **프론트엔드 변경**: PositionsTable에 "보유 시간" 컬럼 추가 (예: "2h 34m", "12h 05m"). 장기 보유(예: 6시간+)는 경고색으로 표시.
4. maxHoldTime 강제 청산 시, 사용자에게 "시간 초과 청산" 시그널임을 명시하는 UX가 필요 -- close 시그널의 `reason` 또는 `metadata`에 `timeExceeded: true` 포함 권장.

---

### R11-T11. PaperEngine TP 트리거 시뮬레이션

**판정: ✅ 동의**

페이퍼 모드에서 TP 미작동은 사용자가 "왜 수익이 확정되지 않지?"라고 혼란에 빠지는 심각한 UX 문제이다. 페이퍼 모드는 사용자가 실거래 전에 시스템을 검증하는 용도이므로, 실거래와의 동작 일관성이 핵심이다. 프론트엔드 변경 불필요.

---

## Engineer 제안서 리뷰

### E11-1. BotSession 상태 불일치 (peakEquity 복원 실패)

**판정: ✅ 동의 (P0 최우선)**

RiskStatusPanel에서 `drawdownMonitor.peakEquity`를 표시하고 있는데(`RiskStatusPanel.tsx` line 92), 봇 재시작마다 이 값이 0으로 리셋되면 사용자가 보는 드로다운 수치가 실제보다 낮게 표시된다. **사용자가 리스크가 낮다고 오인**할 수 있는 심각한 문제. 즉시 수정 동의.

수정 방식은 `findOne` 쿼리에서 `{ status: { $in: ['idle', 'stopped'] } }`가 더 안전하다 (기존 데이터와의 호환성).

---

### E11-2. SignalFilter close 바이패스 오류

**판정: ✅ 동의 (P0 — Trader의 R11-T5와 동일 이슈)**

Trader와 Engineer 모두 동일 버그를 독립적으로 발견했다는 점에서 이 버그의 심각성이 확인된다. 두 제안의 수정 방식 모두 적절하나, Engineer 제안의 `SIGNAL_ACTIONS.CLOSE_LONG || SIGNAL_ACTIONS.CLOSE_SHORT` 방식이 상수 참조로 더 안전하다.

---

### E11-3. Trailing Stop 전략 호출부 부재

**판정: ✅ 동의 (Option 1: strategyBase.onTick() 자동 호출 선호)**

Engineer의 Option 1 (기본 클래스에서 자동 호출)이 UX 관점에서도 올바르다. 개별 전략에 수동 호출을 맡기면 누락 위험이 다시 발생한다. **다만 Trader의 R11-T1 (이중 구현 제거)과 함께 진행**해야 MaTrend/Turtle의 자체 트레일링이 StrategyBase 자동 호출과 충돌하지 않는다.

**구현 순서 주의**: R11-T1 (자체 구현 제거) --> E11-3/R11-T2 (StrategyBase 자동 호출 활성화). 순서가 뒤바뀌면 이중 호출 문제가 악화됨.

---

### E11-4. 테스트 커버리지 전무

**판정: ✅ 동의 (P2 적절)**

테스트 코드 자체는 프론트엔드에 직접 영향이 없으나, 테스트 부재로 인해 R11의 다른 버그 수정(E11-2, R11-T5 등)이 회귀 없이 적용되었는지 검증할 수단이 없다. 우선 대상 5개(riskEngine, signalFilter, drawdownMonitor, orderManager, backtestEngine)는 적절하다.

프론트엔드 관점에서 추가 의견: API 응답 형식에 대한 **통합 테스트** (라우트 레벨)도 포함되면 좋다. 프론트엔드 타입과 실제 API 응답 간 불일치를 방지할 수 있다.

---

### E11-5. Signal 모델 인덱스 부재

**판정: ✅ 동의**

SignalFeed 컴포넌트가 시그널 목록을 폴링으로 가져오는데, 인덱스 추가로 응답 시간이 개선되면 대시보드 반응성이 향상된다. 특히 장기 운영 후 Signal 컬렉션이 수만 건 이상 쌓이면 체감 차이가 클 것이다. 프론트엔드 변경 불필요.

---

### E11-6. Trade 모델 TTL 부재

**판정: ⚠️ 조건부 동의**

**보완 필요**: TTL로 오래된 거래가 자동 삭제되면 사용자가 "이전 거래 내역이 사라졌다"고 느낄 수 있다.

1. **180일 TTL 적용 시 사용자 고지 필요**: TradesTable 또는 거래 내역 페이지에 "최근 180일 데이터만 표시됩니다" 안내 문구 추가.
2. **아카이브 우선 권장**: TTL 삭제보다 아카이브 컬렉션 이동이 UX 관점에서 더 나음 (사용자가 필요 시 이전 데이터 접근 가능). 다만 구현 복잡도가 높으므로, 초기에는 TTL + 안내 문구로 충분.
3. **analytics 페이지 영향**: `PerformanceTabs`, `DailyPerformance`, `StrategyPerformance` 등이 전체 거래 이력을 기반으로 통계를 산출하는데, TTL 삭제 시 장기 성과 분석이 불가능해진다. **최소한 집계 통계는 별도 보존**이 필요.

---

### E11-7. PaperEngine 미결 주문 무제한 축적

**판정: ✅ 동의**

페이퍼 모드에서 메모리 누수는 장시간 대시보드를 띄워놓는 사용자에게 성능 저하로 이어진다. 30분 TTL + 50건 제한은 합리적. 프론트엔드 변경 불필요.

---

### E11-8. WebSocket 재연결 후 재구독 누락

**판정: ⚠️ 조건부 동의**

**보완 필요**: 이 문제는 **프론트엔드 UX에 직접적 영향**이 있다.

1. **현재 상태**: 프론트엔드 Socket.io 클라이언트는 자체 reconnection 로직이 있고(`socket.ts` line 27-30), `useSocket`에서 `connected` 상태를 추적한다. 하지만 이는 프론트엔드 <-> 백엔드 Node.js 사이의 소켓이고, 문제는 백엔드 Node.js <-> Bitget WS 사이의 재연결이다.
2. **UX 영향**: 백엔드 WS가 재연결 후 토픽을 재구독하지 않으면, 백엔드가 틱/주문 데이터를 받지 못한다. 결과적으로 프론트엔드에 `market:ticker`, `trade:signal_generated` 등의 이벤트가 전달되지 않아, 대시보드가 **정지된 것처럼** 보인다.
3. **제안하는 UX 보완**:
   - 백엔드에서 WS 상태를 `/api/health/status`에 포함 (예: `wsPublic: 'connected'|'reconnecting'|'disconnected'`)
   - 프론트엔드 `SystemHealth` 컴포넌트에서 이 상태를 표시하여 사용자가 "데이터 갱신 중단"을 인지할 수 있도록
   - 향후: "데이터 소스 일시 중단" 배너를 대시보드 상단에 표시

---

### E11-9. 일일 리셋 타이밍 취약점

**판정: ✅ 동의**

날짜 변경 감지 방식으로의 전환이 더 견고하다. 프론트엔드 영향 없음. Trader 에이전트에게 KST 기준 리셋 시점 의견을 구하는 것도 적절한 판단.

---

### E11-10. API 라우트 입력 검증 부재

**판정: ✅ 동의**

프론트엔드에서 보내는 요청이 백엔드에서 검증 없이 통과되는 것은 보안 문제이기도 하지만, **사용자에게 불친절한 에러 메시지**를 유발한다. 예를 들어 잘못된 config로 봇을 시작하면, 실제 오류 지점이 아닌 깊은 서비스 레이어에서 예외가 발생하여 프론트엔드에 `"Internal Server Error"` 같은 모호한 메시지가 전달된다.

Zod 기반 검증으로 명확한 에러 응답(`{ success: false, error: "leverage must be between 1 and 125" }`)을 반환하면, 프론트엔드에서 구체적인 에러 메시지를 사용자에게 표시할 수 있다.

---

### E11-11. 환경변수 시작 시 검증

**판정: ✅ 동의**

순수 백엔드 DX 개선. 프론트엔드 영향 없음.

---

### E11-12. Bootstrap 중간 실패 시 복구 경로

**판정: ✅ 동의**

P2 적절. 프론트엔드 영향 없음.

---

### E11-13. mathUtils parseFloat 정밀도 한계

**판정: ⚠️ 조건부 동의**

**보완 필요**: 현재 BTC 가격 범위와 일반 수량에서는 문제가 없다는 Engineer의 분석에 동의하나, `big.js`/`decimal.js` 도입 시:

1. **API 응답 포맷 변경 가능성**: 현재 모든 금액이 String으로 프론트엔드에 전달되는데, 내부 연산 라이브러리 변경이 String 포맷(소수점 자릿수 등)에 영향을 줄 수 있다. 예: `"100.5"` → `"100.50000000"` 등.
2. **프론트엔드 `formatCurrency`가 `parseFloat` 기반**이므로, String 포맷이 변해도 표시에는 영향 없지만, **금액 비교 로직**(예: PnL 색상 판정 `getPnlColor`)은 영향받을 수 있다.
3. **P2 타이밍에서 진행하되, API 응답 포맷 변경 여부를 사전에 확인** 필요.

---

### E11-14. MongoDB 커넥션 풀 모니터링

**판정: ✅ 동의**

Prometheus 메트릭은 /metrics 엔드포인트로 노출되며, 프론트엔드 대시보드와는 별개. 향후 Grafana 등 외부 모니터링에서 활용.

---

### E11-15. 리스크 이벤트 Prometheus 메트릭

**판정: ✅ 동의**

Engineer가 UI에게 요청한 "리스크 현황 위젯" 관련: 현재 `RiskStatusPanel`에 서킷 브레이커 상태, 드로다운, 노출도가 이미 표시되어 있고, `useRiskEvents` 훅으로 리스크 이벤트를 수신하고 있다. Prometheus 메트릭은 외부 모니터링용이므로, 대시보드에는 기존 Socket.io 기반 리스크 이벤트로 충분하다.

다만, "최근 N건 거부 건수" 카운터를 RiskStatusPanel에 추가하는 것은 가치 있다. 이는 Prometheus 메트릭과 무관하게 기존 `riskEvents` 배열에서 집계 가능.

---

## 종합 의견

### 1. 양 제안서의 중복 발견 (합의 필요)

| Trader | Engineer | 이슈 | 합의 방향 |
|--------|----------|------|----------|
| R11-T5 | E11-2 | SignalFilter close 바이패스 오류 | Engineer의 상수 참조 방식 채택 |
| R11-T2 | E11-3 | Trailing Stop 호출부 부재 | Engineer의 Option 1 (StrategyBase 자동 호출) + Trader의 R11-T1 (이중 구현 제거) 순차 진행 |

### 2. 프론트엔드 영향 요약

| 우선순위 | 항목 | 프론트엔드 작업 |
|----------|------|----------------|
| 즉시 | R11-T5/E11-2 (SignalFilter) | 없음 (기존 UI로 정상 표시됨) |
| 즉시 | E11-1 (peakEquity) | 없음 (RiskStatusPanel이 정확한 값을 받게 됨) |
| 1주 내 | R11-T6 (getEquity) | `BacktestEquityPoint`에 `unrealizedPnl` 필드 추가 |
| 1주 내 | R11-T7 (펀딩비) | `BacktestMetrics`에 `totalFundingCost` 추가 + BacktestStatsPanel 항목 추가 + 면책 문구 수정 |
| 1주 내 | E11-6 (Trade TTL) | TradesTable에 "최근 180일" 안내 + analytics 집계 보존 확인 |
| 1주 내 | E11-8 (WS 재구독) | health 엔드포인트에 WS 상태 포함 시 SystemHealth 표시 추가 |
| 2주 내 | R11-T9 (ATR 사이징) | StrategyCard에 사이징 방식 표시 |
| 2주 내 | R11-T10 (maxHoldTime) | PositionsTable에 "보유 시간" 컬럼 추가 (Position 타입에 `openedAt` 필요) |

### 3. 구현 순서에 대한 UX 관점 권고

1. **Phase 1 (즉시)**: R11-T5/E11-2 (SignalFilter) --> E11-1 (peakEquity) --> R11-T1 (이중 트레일링 제거) --> E11-3 (StrategyBase 자동 호출)
   - 이유: 사용자가 체감하는 버그(청산 실패, 드로다운 오표시)를 최우선 해소
2. **Phase 2 (1주 내)**: R11-T7 (펀딩비) --> R11-T6 (getEquity) --> R11-T11 (PaperEngine TP)
   - 이유: 백테스트/페이퍼 모드의 신뢰도 향상은 신규 사용자 온보딩에 직결
3. **Phase 3 (2주 내)**: R11-T10 (maxHoldTime + 보유 시간 UI) --> R11-T9 (ATR 사이징)
   - 이유: 포지션 보유 시간 표시는 R11-T10 백엔드 구현 전에도 프론트엔드 선행 가능

### 4. 내가 추가로 담당할 프론트엔드 항목

Trader와 Engineer의 요청을 반영하여, 다음 프론트엔드 작업을 Round 11에서 진행할 수 있다:

- **FE-1**: BacktestStatsPanel 면책 문구 업데이트 (R11-T7 연동 시)
- **FE-2**: BacktestMetrics 타입에 `totalFundingCost` 추가 + 통계 항목 추가
- **FE-3**: BacktestEquityPoint 타입에 `unrealizedPnl` 추가
- **FE-4**: PositionsTable에 보유 경과 시간 컬럼 추가 (백엔드 `openedAt` 필드 추가 전제)
- **FE-5**: Trade TTL 적용 시 안내 문구 추가
