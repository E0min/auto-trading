# Round 8 Cross-Review — Trader 관점

> Reviewer: Senior Quant Trader
> Date: 2026-02-16
> 리뷰 대상: Engineer 제안서 + UI 제안서

---

## Engineer 제안서 리뷰

### C-1: Module-level Router Singleton
- **판정: ✅ 동의**
- 시스템 안정성 관점에서 올바른 지적. 테스트 환경에서 특히 중요. 매매 로직에 직접 영향은 없지만, 테스트 인프라가 신뢰되어야 전략 검증도 신뢰 가능.

### C-2: BacktestStore 무제한 메모리 성장
- **판정: ✅ 동의 (HIGH 우선순위로)**
- 백테스트를 집중적으로 돌릴 때 (예: 18개 전략 × 3개 심볼 × 3개 기간 = 162회) OOM이 실제로 발생할 수 있음. MAX_STORED_RESULTS=50은 적절. LRU보다 **FIFO**가 단순하고 예측 가능하여 더 적합.
- **추가 제안**: equityCurve를 MongoDB로 이관하는 것은 좋지만, 현재 MongoDB가 미설치 상태에서도 백테스트가 작동해야 하므로 인메모리 LRU가 1차, MongoDB가 2차(선택) 옵션이어야 함.

### H-1: _lastTickerEmit Map cleanup
- **판정: ✅ 동의**
- 장기 운영 시 실제 문제. 다만 심볼 수가 최대 100개 수준이므로 Map 크기 자체는 위험하지 않으나, 정리하는 것이 맞음.

### H-2: resume() StrategyRouter 우회
- **판정: ✅ 동의 (트레이딩 관점에서 CRITICAL에 가까움)**
- 이것은 내 제안서 LOW-1과 동일한 이슈. 레짐에 맞지 않는 전략이 활성화되면 불필요한 손실 발생. 특히 QUIET 레짐에서 TurtleBreakout이 활성화되면 짧은 range에서 반복 진입/손절.
- **우선순위 상향 요청**: HIGH → CRITICAL-adjacent. 봇 pause/resume은 실거래에서 빈번히 사용되는 오퍼레이션.

### H-3: OrphanOrderCleanup unref() + 활성화
- **판정: ⚠️ 조건부 동의**
- `start()` 호출이 없어 dead code라는 점은 동의. 그러나 OrphanOrderCleanup이 실행되면 기존 포지션의 SL/TP 주문을 "고아 주문"으로 오인하여 취소할 위험. 정확한 판별 로직 확인 후 활성화해야 함.
- **조건**: 활성화 전에 SL/TP 주문을 보호하는 화이트리스트 패턴 적용.

### H-4: TickerAggregator timer unref()
- **판정: ✅ 동의**
- 5분짜리 작업. 즉시 수행.

### H-5: TournamentRoutes 캡슐화 위반
- **판정: ✅ 동의**
- private 프로퍼티 직접 접근은 유지보수 부담. 다만 토너먼트 기능 자체가 실거래 대비 낮은 우선순위이므로, 다른 CRITICAL/HIGH 이후 처리 가능.

### H-6: getStatus() getSignal() try-catch
- **판정: ✅ 동의**
- status 엔드포인트가 실패하면 대시보드 전체가 블랭크. 빈번한 상황은 아니지만 방어 코드가 필요. 10분이면 충분.

### M-1: lot step 하드코딩 제거
- **판정: ✅ 동의 (내 T3-10 재평가와 일치)**
- 실거래 필수. 내 CRITICAL-1(멀티심볼)과 함께 구현해야 효과적.

### M-2: Paper 모드 trading-mode 전환 보호
- **판정: ⚠️ 조건부 동의**
- 보안은 중요하지만, 로컬 개발 환경에서 API_KEY 없이 편하게 테스트하는 용례도 존재. 완전 차단보다는 경고 로깅 + 확인 프롬프트(FE에서)가 더 실용적.

### M-3: StateRecovery + OrphanOrderCleanup 활성화
- **판정: ⚠️ 조건부 동의**
- StateRecovery.recover()는 매우 위험한 오퍼레이션. 크래시 후 재시작 시 이전 상태를 복원하면 이미 청산된 포지션을 다시 열 수 있음. 철저한 테스트 없이 활성화하면 실거래에서 이중 포지션 위험.
- **조건**: Paper 모드에서 충분히 검증한 후 Live 모드 적용.

### M-4~M-6: parseFloat 제거, express.json limit
- **판정: ✅ 동의**
- 간단한 수정. 일괄 처리 가능.

### M-7: BotSession stats 업데이트
- **판정: ✅ 동의**
- analytics 페이지가 빈 데이터를 보여주는 것은 UX 문제이기도 하지만, 전략 성과 추적에도 필수.

### M-8: Snapshot 주기적 생성
- **판정: ✅ 동의**
- equity curve가 실거래에서 작동하지 않는 것은 중요한 결함. 30초 간격 제안에 동의. 다만 DB I/O 부담을 고려하여 1분도 괜찮음. 실거래에서는 분 단위 해상도면 충분.

### Deferred 재평가
- T3-4 (decimal.js): Engineer는 "유지(deferred)"로 판단했지만, 나는 "실거래 전 필수"로 판단함. **이견 존재**. IEEE 754의 유효 15자리가 일반적으로 충분하다는 Engineer의 논리는 이해하지만, 레버리지 × 큰 포지션 × 수수료 누적에서의 rounding error가 장시간 운영 시 diverge하는 경우를 우려함. 최소한 핵심 경로(PnL, 수수료)에 big.js 적용을 제안.
- T3-9 (Socket.io 인증): T1 승격 동의.
- T3-10 (InstrumentCache): T1 승격 동의.

---

## UI 제안서 리뷰

### R8-C1: EmergencyStopDialog Escape + 포커스 트랩
- **판정: ✅ 동의**
- 긴급 상황에서 키보드 접근성은 필수. 실거래 중 마우스가 먹통이 되는 상황도 있음 (노트북 트랙패드 오작동 등).

### R8-C2: 에러 토스트 5초 자동 소멸
- **판정: ✅ 동의 (트레이딩 관점에서 매우 중요)**
- 포지션 청산 실패 에러가 5초 후 사라지는 것은 심각한 문제. 에러 severity 분류에 대한 요청에 답변:
  - **Persistent (닫기 전까지 유지)**: 주문 실패, API 연결 실패, 긴급 정지 실패, 포지션 청산 실패
  - **10초 후 자동**: 데이터 조회 지연, 폴링 실패 (재시도 가능)
  - **5초 후 자동**: 성공 알림 (주문 체결, 포지션 청산 완료)

### R8-H1: useSocket state 분리
- **판정: ✅ 동의**
- 실시간 시그널이 빈번할 때 대시보드 전체 리렌더는 성능 이슈.

### R8-H2: useMarketIntelligence named handler
- **판정: ✅ 동의**
- socket.off 패턴 수정은 안전성 개선. Engineer에게도 답변: named handler가 표준이 맞음.

### R8-H3, H8: 폴링 표준화 (Performance, Tournament)
- **판정: ✅ 동의**
- 모든 훅이 useAdaptivePolling을 사용해야 함. 불필요한 API 트래픽은 rate limit에 걸릴 수 있어 매매 실행에도 간접 영향.

### R8-H4, H5: 모바일 반응형
- **판정: ⚠️ 조건부 동의**
- 모바일 UX는 중요하지만, 실거래 트레이딩은 데스크톱이 주 환경. 모바일은 "모니터링 전용"으로 우선순위를 제한하고, 봇 제어(시작/정지/긴급)만 모바일에서 작동하면 됨.
- **조건**: 모바일 반응형은 HIGH가 아닌 MEDIUM으로 조정 제안.

### R8-H6: 봇 중지 확인 다이얼로그
- **판정: ✅ 동의 (매우 중요)**
- 봇 중지 시 열린 포지션 처리 정책에 대한 답변:
  - exchange-side SL이 등록된 포지션: SL이 거래소에 남아있으므로 "안전하게 보호됨" 표시
  - software SL만 있는 포지션: "봇 정지 시 SL이 작동하지 않습니다" 경고
  - 현재 시스템에서는 exchange-side SL이 R5에서 구현되었으므로, SL이 거래소에 등록된 포지션은 보호됨을 명시
- **추가 제안**: 봇 정지 다이얼로그에 "전체 포지션 청산 후 정지" 옵션도 추가

### R8-H7: SignalFeed 전략명 번역
- **판정: ✅ 동의**
- 5분 작업. 즉시 수행.

### R8-H9: useTournament 에러 메시지 한국어
- **판정: ✅ 동의**
- 토너먼트 관련 Socket.io 이벤트 여부 답변: 현재 백엔드에서 토너먼트 전용 Socket 이벤트는 발행하지 않음. 폴링이 유일한 방법. 향후 `tournament:leaderboardUpdate` 이벤트 추가를 검토할 수 있지만, 토너먼트는 낮은 우선순위.

### R8-H10: StrategyCard toggle 접근성
- **판정: ✅ 동의**
- interactive 안의 interactive는 웹 표준 위반. 전략 활성화/비활성화는 실거래에서 중요한 오퍼레이션.

### R8-H11: collapsible aria-expanded
- **판정: ✅ 동의**
- 접근성 기본 요건.

### R8-H12: MarketRegimeIndicator 정리
- **판정: ✅ 동의**
- 코드 중복 제거. MarketIntelligence 헤더에 통합된 것으로 확정하고 MarketRegimeIndicator.tsx 삭제.

### R8-M1~M8: MEDIUM 항목들
- **판정: ✅ 동의**
- StrategyPanel, ClientGate 삭제 동의.
- BacktestForm 심볼 프리셋: 하드코딩 프리셋이 1차, API 연동이 2차.
- EquityCurveChart 공통 추출: 유지보수 개선에 좋음.

### R8-L1: TOOLTIP_STYLE 통일
- **판정: ✅ 동의**

---

## 종합 의견

1. **Engineer와의 이견**: decimal.js (T3-4) deferred vs 실거래 필수. 최소 타협안으로 핵심 경로(PnL 계산, ExposureGuard 비교)에만 big.js 적용을 제안.
2. **UI 모바일 우선순위**: H4, H5를 MEDIUM으로 하향 제안. 실거래는 데스크톱 중심.
3. **높은 시너지**: Engineer C-2(BacktestStore LRU)와 Trader H-2(멀티포지션 백테스트)는 함께 구현하면 효과적.
4. **Phase 간 의존성**: Trader C-1(멀티심볼) → Engineer M-1(lot step) → UI(전략별 심볼 표시) 순서 의존.
