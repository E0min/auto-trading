# Round 8 Cross-Review — Engineer 관점

> Reviewer: Senior Systems Engineer
> Date: 2026-02-16
> 리뷰 대상: Trader 제안서 + UI 제안서

---

## Trader 제안서 리뷰

### CRITICAL-1: StrategyRouter 단일 심볼 할당
- **판정: ⚠️ 조건부 동의**
- 매매 기회 확대의 필요성에는 공감하지만, 구현 난이도를 **과소평가**하고 있음:
  1. 전략 내부 상태(klineHistory, indicators, signalState)가 심볼별로 격리되지 않으면 데이터 오염 발생
  2. `_symbol` 프로퍼티가 StrategyBase + 18개 전략에 하드코딩
  3. `signalFilter`의 포지션 카운트가 심볼을 구분하지 않음
  4. `riskEngine`의 ExposureGuard가 심볼별 노출 한도를 관리하지 않음
- **조건**:
  - Phase 1으로 "전략마다 다른 단일 심볼 배정" (라운드 로빈)을 먼저 구현하여 위험 최소화
  - Phase 2에서 전략당 멀티심볼 (상태 격리 포함) 진행
  - 예상 시간을 8~12h에서 **16~20h**으로 상향 (테스트 포함)
- **우선순위**: CRITICAL 동의하나 이번 라운드에서 Phase 1만 진행하는 것이 현실적.

### CRITICAL-2: mathUtils의 parseFloat 정밀도 한계
- **판정: ❌ 반대 (우선순위 과대평가)**
- IEEE 754 double의 유효 자릿수는 15~17자리. 실거래에서 다루는 값:
  - 최대 포지션: $1,000,000 × 20x leverage = $20,000,000 (8자리)
  - 최소 가격 단위: 0.00001 (5자리)
  - 합계: 13자리 → 안전 범위 내
- Trader의 예시 `multiply('99999999.12345678', '99999.9999')`는 실거래에서 발생하지 않는 극단적 케이스.
- `toFixed()` 보정이 대부분의 rounding error를 흡수.
- decimal.js 도입은 모든 서비스 파일에 영향 → regression 리스크가 정밀도 이익보다 큼.
- **대안**: 현재 mathUtils를 그대로 유지하되, PnL 검증용 cross-check (거래소 API 잔고와 비교) 로직을 추가하여 drift를 모니터링.
- **판정 변경 조건**: 실거래 1개월 운영 후 drift가 0.01% 이상이면 decimal.js 도입.

### CRITICAL-3: PositionManager 전략 메타데이터 주입
- **판정: ✅ 동의**
- `orderId → strategy` 매핑은 올바른 접근. 구현 시 주의점:
  1. Map 크기 관리: TTL 기반 cleanup (완료된 주문은 1시간 후 제거)
  2. 서버 재시작 시 Map 소실: Trade 모델의 strategy 필드로 폴백 조회
  3. 부분 체결(partial fill) 시 orderId가 유지되므로 매핑은 안정적
- 예상 시간 3~4h 동의.

### HIGH-1: Trailing Stop 라이브 미구현
- **판정: ⚠️ 조건부 동의**
- Bitget API에서 trailing stop order 지원 여부를 먼저 확인해야 함. 지원하지 않으면 software trailing stop을 구현해야 하는데, 이는 봇 프로세스 의존성을 만듦.
- **조건**: Bitget trailing stop API 지원 확인 후 구현 방식 결정. 미지원 시 우선순위를 MEDIUM으로 하향.

### HIGH-2: 백테스트 단일 포지션 제한
- **판정: ✅ 동의**
- 백테스트 현실성 개선에 필수. 구현 시 `Map<string, Position>` 패턴 사용 동의. 단, 멀티심볼 kline 병합은 별도 이슈로 분리 필요 (데이터 정렬/동기화 복잡도).

### HIGH-3: 코인 재선정 메커니즘
- **판정: ⚠️ 조건부 동의**
- 시스템 안정성 관점에서 우려:
  1. 재선정 시 기존 WebSocket 구독을 해제/재구독해야 함 → connection 불안정 위험
  2. 진행 중인 전략이 심볼 교체를 알아야 함 → 전략 상태 리셋 필요
  3. 4시간 간격은 합리적이나, 레짐 변경마다 트리거하면 빈번한 재선정 발생
- **조건**: 레짐 변경 트리거는 제외하고 고정 간격(4~8시간)만 적용. 기존 포지션이 있는 심볼은 반드시 유지.

### HIGH-4: 펀딩비 PnL 미반영
- **판정: ✅ 동의**
- 실거래에서 펀딩비는 실제 비용. PnL에 반영해야 정확한 성과 평가 가능.
- 구현 방안: Bitget WS의 `account` 채널에서 펀딩비 차감 이벤트 감지 가능. 이를 Trade 레코드의 `fee` 필드에 추가하거나 별도 `fundingFee` 필드.

### HIGH-5: RiskEngine reduceOnly bypass
- **판정: ✅ 동의 (이것은 내가 코드 리뷰에서 놓친 부분)**
- 청산 주문이 리스크 체크에 막히면 손실이 확대됨. 즉시 수정 필요.
- 구현이 단순(1~2h)하므로 이번 라운드에서 바로 처리.
- **추가**: 로깅은 반드시 유지. `AUDIT` 로그 레벨로 reduceOnly bypass를 기록.

### HIGH-6: 레버리지 관리 미흡
- **판정: ⚠️ 조건부 동의**
- CRITICAL-1(멀티심볼) 해결 전에는 잠재적 이슈. 현재 모든 전략이 같은 심볼을 사용하므로 실제 충돌은 발생하지 않음.
- **조건**: CRITICAL-1의 Phase 2(전략당 멀티심볼) 구현 시 함께 처리. 독립적으로 먼저 구현하면 불필요한 복잡성.

### MEDIUM-1~7: 중간 우선순위 항목들
- **M-1 (Sortino)**: ✅ 동의. 간단한 추가.
- **M-2 (SignalFilter CLOSE bypass)**: ✅ 동의. SL/TP 보장 필수.
- **M-3 (전략 warm-up)**: ✅ 동의. 초기 거짓 신호 방지.
- **M-4 (CoinSelector F7)**: ⚠️ 조건부. 데이터 소스(7일 평균 볼륨)가 추가 API 호출 필요. 비용 대비 효과 검증 필요.
- **M-5 (마켓 임팩트)**: ⚠️ 조건부. 동적 슬리피지 모델의 파라미터 캘리브레이션이 별도 연구 필요. 고정 비율 대비 "어느 정도" 개선인지 수치 근거 요청.
- **M-6 (DrawdownMonitor peakEquity 영속성)**: ✅ 동의. BotSession과 연계 가능.
- **M-7 (상관관계)**: ⚠️ 조건부. 복잡도 대비 현실적 효과 불명확. 나중에.

### LOW-1~3
- ✅ 전부 동의. 특히 LOW-1(resume StrategyRouter)은 내 H-2와 동일 — 우선순위 상향 필요.

### Deferred 재평가
- T3-4 (decimal.js): 내 제안서와 동일하게 **유지** 제안. Trader와 이견.
- T3-10 (InstrumentCache): **실거래 전 필수** 동의.

---

## UI 제안서 리뷰

### R8-C1: EmergencyStopDialog Escape + 포커스 트랩
- **판정: ✅ 동의**
- 안전성 관련 UI는 최고 우선순위. Escape 키 + 포커스 트랩은 웹 접근성 기본 요건. `@headlessui/react` Dialog 사용은 번들 크기 증가를 수반하므로, 자체 구현이 더 적절 (50줄 미만).

### R8-C2: 에러 토스트 persistent
- **판정: ✅ 동의**
- 에러 severity 분류가 필요하다는 점에 동의. 시스템 관점에서 추가:
  - **Persistent + 소리/진동**: API 연결 완전 실패 (서버 다운)
  - **Persistent**: 주문 실패, 포지션 청산 실패
  - **10초**: 데이터 조회 지연, WebSocket 재연결
  - **5초**: 성공 피드백

### R8-H1: useSocket state 분리
- **판정: ✅ 동의**
- React 성능 최적화의 기본. signals와 riskEvents를 별도 useState로 분리하는 방안(a)이 가장 단순하고 효과적.

### R8-H2: useMarketIntelligence named handler
- **판정: ✅ 동의 (시스템 안정성 관점에서 HIGH)**
- 이벤트 리스너 누수는 메모리 누수로 이어질 수 있음. named handler 패턴이 표준이 맞음.
- **답변**: 백엔드 Socket.io에서는 `socket.on(event, handler)` / `socket.off(event, handler)` 패턴을 사용. 이벤트명만으로 off하면 모든 리스너 제거이므로 위험.

### R8-H3: usePerformanceAnalytics 적응형 폴링
- **판정: ✅ 동의**
- useAdaptivePolling으로 통일하면 코드 일관성 + 불필요한 API 호출 감소. configKey 'analytics' 추가가 적절.

### R8-H4, H5: 대시보드 헤더/AccountOverview 모바일
- **판정: ✅ 동의 (단, 우선순위는 Trader와 동의하여 MEDIUM 수준)**
- 모바일 반응형은 좋지만, 실거래 시 데스크톱이 주 환경. 모니터링 목적으로 최소한의 반응형(header wrap, grid 조정)이면 충분.

### R8-H6: 봇 중지 확인 다이얼로그
- **판정: ✅ 동의**
- "전체 포지션 청산 후 정지" 옵션도 좋은 아이디어. 단, 이 기능은 BotService에 별도 API가 필요 (`POST /api/bot/stop?closePositions=true`). 현재 stop API에는 이 파라미터가 없으므로 BE 변경도 수반.

### R8-H7: SignalFeed 전략명 번역
- **판정: ✅ 동의**
- 5분 작업.

### R8-H8: useTournament 적응형 폴링
- **판정: ✅ 동의**
- 고정 3초 폴링은 rate limit 위험.

### R8-H9: useTournament 에러 한국어
- **판정: ✅ 동의**

### R8-H10: StrategyCard toggle 접근성
- **판정: ✅ 동의**
- HTML 규격 위반(interactive inside interactive) 수정은 필수.

### R8-H11: collapsible aria-expanded
- **판정: ✅ 동의**
- 접근성 기본.

### R8-H12: MarketRegimeIndicator 정리
- **판정: ✅ 동의**
- 답변: `GET /api/bot/status`에서 `lastSignal` 필드는 StrategyHub에서 사용됨. `null` fallback 시 "시그널 없음"으로 표시되므로 FE 영향 최소.

### MEDIUM 항목들
- **R8-M1, M2 (삭제)**: ✅ 동의. tree-shake되지만 코드 정리는 좋음.
- **R8-M3 (서버사이드 다운샘플링)**: ✅ 동의. BE에 이미 `maxPoints` 파라미터 있음.
- **R8-M4 (useAnalytics 폴링)**: ✅ 동의. Snapshot 생성 구현(내 M-8)과 연계하면 효과적.
- **R8-M5 (th scope)**: ✅ 동의.
- **R8-M6 (RegimeFlowMap 모바일)**: ✅ 동의.
- **R8-M7 (BacktestForm 심볼 프리셋)**: ✅ 동의. 답변: `GET /api/backtest/symbols` API 추가 가능. `exchangeClient.getSymbols()` 기반으로 USDT-Futures 심볼 목록 반환.
- **R8-M8 (EquityCurveChart 공통 추출)**: ✅ 동의.

### R8-L1: TOOLTIP_STYLE 통일
- **판정: ✅ 동의**

### T3-9 (Socket.io 인증) 답변
- 현재 `useSocket` 훅에는 auth 토큰 전달 메커니즘이 없음. Socket.io 인증 추가 시 FE 수정 필요:
  1. `socket.ts`의 `createSocketSingleton`에 `auth: { token: apiKey }` 옵션 추가
  2. `NEXT_PUBLIC_API_KEY`를 환경변수에서 읽어 전달
  3. 예상 수정 범위: `socket.ts` 1파일, 5줄 이내

---

## 종합 의견

1. **Trader와의 핵심 이견**: decimal.js 도입. 내 입장: 현재 parseFloat + toFixed가 실용적 범위에서 충분. 실거래 모니터링 후 판단.
2. **UI 제안 대부분 동의**: 접근성, 폴링 통일, 에러 처리 개선은 모두 타당. 모바일 우선순위만 MEDIUM으로.
3. **가장 높은 공감**: Trader C-3 (PositionManager 전략 매핑) + Engineer H-2 (resume StrategyRouter) + UI C-1 (EmergencyStop 접근성). 이 3건은 실거래 필수.
4. **우선순위 제안**:
   - 이번 라운드: Router singleton 수정, BacktestStore LRU, reduceOnly bypass, resume() 수정, EmergencyStop 접근성, PositionManager 전략 매핑
   - 다음 라운드: 멀티심볼 라우팅 (Phase 1), Trailing Stop, 펀딩비 반영
