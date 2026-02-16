# Round 11 합의 결정문서

> 생성일: 2026-02-17
> 주제: 코드베이스 재분석 — 새 개선과제 발굴
> 입력: 3개 제안서 (Trader 11건 + Engineer 15건 + UI/UX 13건) + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

### 이번 스프린트 실행 대상 (28건)

| ID | 이슈 | 합의 수준 | 담당 | Tier |
|----|------|----------|------|------|
| E11-1 | BotSession 상태 불일치 — peakEquity 복원 실패 | 3/3 ✅ | Backend | 0 |
| E11-2 / R11-T5 | SignalFilter close 바이패스 오류 | 3/3 ✅ | Backend | 0 |
| R11-T3 | BollingerReversion super.onFill() 누락 | 3/3 ✅ | Backend | 0 |
| E11-3 / R11-T2 | Trailing Stop opt-in 활성화 (6전략) | 2/3+조건부 | Backend | 0 |
| R11-T4 | MaTrend/Turtle entryPrice → onFill() 이동 (AD-37) | 2/3+조건부 | Backend | 0 |
| E11-9 | 일일 리셋 타이밍 — 날짜 변경 감지 전환 | 3/3 ✅ | Backend | 1 |
| R11-T8 | CoinSelector F7 volMomentum 거래량 변화율 수정 | 3/3 ✅ | Backend | 1 |
| R11-T11 | PaperEngine TP 트리거 시뮬레이션 추가 | 3/3 ✅ | Backend | 1 |
| E11-5 | Signal 모델 인덱스 3개 추가 | 3/3 ✅ | Backend | 1 |
| E11-7 | PaperEngine 미결 주문 30분 TTL + 50건 제한 | 3/3 ✅ | Backend | 1 |
| E11-11 | 환경변수 시작 시 검증 (fast-fail) | 3/3 ✅ | Backend | 1 |
| R11-T6 | 백테스트 getEquity 미실현 PnL 포함 | 3/3 ✅ | Backtest | 1 |
| R11-T7 | 백테스트 펀딩 비용 cash 반영 | 3/3 ✅ | Backtest | 1 |
| R11-FE-01 | MarketRegimeIndicator.tsx 삭제 | 3/3 ✅ | Frontend | 1 |
| R11-FE-02 | risk.ts any → RiskStatusExtended 타입 | 3/3 ✅ | Frontend | 1 |
| R11-FE-03 | as unknown as 캐스트 3건 → 제네릭 컴포넌트 | 3/3 ✅ | Frontend | 1 |
| R11-FE-04 | as never 캐스트 7건 → 공통 formatter | 2/3+조건부 | Frontend | 1 |
| R11-FE-05 | PaperModeGate 공통 컴포넌트 | 3/3 ✅ | Frontend | 1 |
| R11-FE-06 | CATEGORY_LABEL 통일 (translateStrategyCategory) | 3/3 ✅ | Frontend | 1 |
| R11-FE-07 | formatPnl 유틸 승격 | 3/3 ✅ | Frontend | 1 |
| R11-FE-10 | 백테스트 폼 유효성 검증 강화 | 3/3 ✅ | Frontend | 1 |
| R11-FE-11 | useStrategyDetail 적응형 폴링 전환 | 3/3 ✅ | Frontend | 1 |
| R11-FE-12 | PerformanceTabs lazy loading | 3/3 ✅ | Frontend | 1 |
| R11-FE-13 | 비활성화 다이얼로그 접근성 (focus trap + escape) | 3/3 ✅ | Frontend | 1 |
| R11-FE-BT1 | BacktestEquityPoint에 unrealizedPnl 필드 추가 | UI 보완 | Frontend | 1 |
| R11-FE-BT2 | BacktestMetrics에 totalFundingCost + StatsPanel 반영 | UI 보완 | Frontend | 1 |

### 보류 항목 (다음 라운드)

| ID | 이슈 | 사유 |
|----|------|------|
| R11-T1 | 트레일링 스탑 통합 (MaTrend/Turtle 자체 구현 제거) | 동작 매핑 복잡, 충분한 테스트 필요. Turtle ATR vs StrategyBase percent 근본 차이 |
| R11-T9 | 변동성 기반 포지션 사이징 (ATR 모듈) | 아키텍처 설계 선행 필요. opt-in riskPerUnit 방식 합의, 점진적 롤아웃 |
| R11-T10 | maxHoldTime 강제 청산 | 2단계(경고→강제) 설계, opt-out 지원 필요 |
| E11-4 | 테스트 커버리지 확대 (5개 핵심 서비스) | 8시간+. 별도 스프린트 권장 |
| E11-6 | Trade 모델 TTL/아카이브 | Trader: 365일 또는 아카이브, UI: 사용자 고지 필요. 설계 논의 필요 |
| E11-8 | WebSocket 재연결 후 재구독 | SDK 자동 재구독 여부 확인 선행 |
| E11-10 | API 라우트 입력 검증 (Zod) | 3시간. 다음 라운드로 |
| E11-12 | Bootstrap 중간 실패 복구 | 2시간. 다음 라운드로 |
| E11-13 | mathUtils big.js 마이그레이션 | 현재 정밀도 충분. T3-4와 통합 |
| E11-14 | MongoDB 커넥션 풀 모니터링 | P2, 1시간 |
| E11-15 | 리스크 이벤트 Prometheus 메트릭 | P2, 1시간 |
| R11-FE-08 | tournament/page.tsx 분할 | 구조 리팩토링. 급하지 않음 |
| R11-FE-09 | 백테스트 결과 비교 기능 | 복잡도 높음 (에쿼티 커브 오버레이 시간축 정렬 등). Phase 분리 필요 |

---

## 아키텍처 결정

### AD-63: SignalFilter close 바이패스 수정

- **결정**: `action === 'CLOSE'`를 `action.startsWith('close') || signal.reduceOnly`로 수정
- **근거**: SIGNAL_ACTIONS에 `'CLOSE'` 값이 없음. 실제 값은 `'close_long'`, `'close_short'`. 3/3 독립 발견.
- **null 방어**: `(action && action.startsWith('close')) || signal.reduceOnly`
- **영향**: 모든 전략의 청산 시그널이 쿨다운/중복 필터를 바이패스하게 됨. 의도된 동작.

### AD-64: BotSession peakEquity 복원 쿼리 수정

- **결정**: `findOne({ status: 'stopped' })`를 `findOne({ status: { $in: ['idle', 'stopped'] } })`로 수정
- **근거**: `stop()`이 `BOT_STATES.IDLE`('idle')로 저장하므로 `'stopped'` 쿼리는 항상 miss. Trader 보완: `stoppedAt` 7일 제한은 선택적.
- **영향**: peakEquity가 세션 간 정상 복원되어 DrawdownMonitor 연속성 보장.

### AD-65: Trailing Stop opt-in 활성화

- **결정**: `strategyBase.onTick()`에서 `metadata.trailingStop.enabled === true`인 전략만 `_checkTrailingStop(price)` 자동 호출
- **근거**: Trader가 6개 전략(Turtle, MaTrend, SwingStructure, Supertrend, Breakout, AdaptiveRegime)만 적합하다고 분석. Grid, Funding, RSIPivot, Bollinger, Vwap, QuietRangeScalp은 부적합. CandlePattern, SupportResistance, FibonacciRetracement, MacdDivergence는 별도 검토.
- **적용 방식**: 각 전략의 `static metadata`에 `trailingStop: { enabled: true, activationPercent, callbackPercent }` 설정. `enabled` 미설정 또는 `false`이면 호출 안 함.
- **적용 대상 (6전략)**:
  - RsiPivotStrategy — 이미 metadata 설정 있으나 호출 누락. 호출 연결.
  - SupertrendStrategy — 이미 metadata 설정 있으나 호출 누락. 호출 연결.
  - MaTrendStrategy — metadata `enabled: true` 추가 (자체 트레일링은 이번에 유지, 통합은 R12에서)
  - TurtleBreakoutStrategy — metadata `enabled: true` 추가 (자체 ATR 트레일링은 이번에 유지)
  - SwingStructureStrategy — metadata에 trailingStop 추가
  - BreakoutStrategy — metadata에 trailingStop 추가
- **R11-T1 (자체 구현 제거)는 보류**: MaTrend/Turtle의 자체 트레일링 제거는 동작 매핑이 필요하므로 R12에서 진행. 이번 라운드에서는 StrategyBase 호출만 추가하되, MaTrend/Turtle은 자체 트레일링이 먼저 작동하므로 이중 호출 방지 가드를 추가.

### AD-66: 백테스트 getEquity에 미실현 PnL 포함

- **결정**: `backtestEngine.js`의 `getEquity: () => this._cash`를 `getEquity: () => this._calculateEquity(currentPrice)`로 변경
- **근거**: 전략의 포지션 사이징이 현금만 기반으로 계산되어 미실현 이익/손실을 무시. 라이브와 백테스트 간 괴리.
- **성능**: Map 순회 O(n<=3), 무시 가능 (Engineer 확인).
- **FE 연동**: `BacktestEquityPoint` 타입에 `unrealizedPnl?: string` 필드 추가.

### AD-67: 백테스트 펀딩 비용 cash 반영

- **결정**: `_applyFundingIfDue()`에서 산출된 펀딩 비용을 `this._cash`에 실제 차감/가산
- **규칙**: 8시간 간격(0:00, 8:00, 16:00 UTC)에만 발생. cash가 음수가 되지 않도록 방어. 양수(지불)/음수(수취) 모두 처리.
- **FE 연동**: `BacktestMetrics`에 `totalFundingCost: string` 추가. BacktestStatsPanel 면책 문구 "펀딩비 미반영" → "펀딩비 근사치 반영" 수정.

### AD-68: PaperEngine TP 트리거 시뮬레이션

- **결정**: `_checkStopLossTriggers()` 패턴을 미러링하여 `_checkTakeProfitTriggers()` 추가
- **방향**: Long: price >= tpPrice, Short: price <= tpPrice. SL과 TP 동시 트리거 시 SL 우선 (보수적).
- **이벤트**: 체결 시 기존 `orderFilled` 이벤트 emit (SL과 동일 패턴).

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI/UX | 결정 |
|------|--------|----------|-------|------|
| E11-3 Trailing 적용 방식 | opt-in (6전략만) | Option 1 (전체 자동) → 리뷰에서 opt-in 동의 | Option 1 선호 → R11-T1과 순차 동의 | **opt-in: metadata.trailingStop.enabled** |
| E11-6 Trade TTL | 365일 또는 아카이브 | 180일 TTL | 사용자 고지 + 아카이브 권장 | **보류: 아키 설계 후 진행** |
| R11-T1 트레일링 통합 시점 | 이번 라운드 | 매핑 필수, 리스크 중 | R11-T1 → E11-3 순서 권고 | **보류: R12에서 매핑 후 통합** |
| R11-T9 ATR 사이징 방식 | StrategyBase 자동 ATR | opt-in riskPerUnit 시그널 필드 | 사이징 모드 UI 표시 필요 | **보류: opt-in riskPerUnit 방식으로 R12** |
| R11-T10 강제 청산 | 즉시 강제 | 2단계 경고→강제, opt-out | 보유 시간 UI 선행 가능 | **보류: 2단계 설계 후 R12** |
| R11-FE-04 Recharts 타입 | 동의 | 버전 확인 우선 | 제안자 | **진행: 버전 확인 후 래퍼 or 업데이트** |

---

## 트랙 배분 및 실행 순서

### Track A — Backend (13건)

**Phase 1 (Tier 0 — 즉시)**:
1. E11-1: BotSession 상태 불일치 수정 (AD-64) — 15분
2. E11-2/R11-T5: SignalFilter close 바이패스 수정 (AD-63) — 10분
3. R11-T3: BollingerReversion super.onFill() 추가 — 30분
4. E11-3/R11-T2: Trailing Stop opt-in 활성화 (AD-65) — 1시간
5. R11-T4: MaTrend/Turtle entryPrice → onFill() 이동 — 1시간

**Phase 2 (Tier 1)**:
6. E11-9: 일일 리셋 날짜 변경 감지 — 20분
7. E11-11: 환경변수 시작 시 검증 — 30분
8. E11-5: Signal 모델 인덱스 3개 — 15분
9. R11-T8: CoinSelector F7 volMomentum 수정 — 1시간
10. R11-T11: PaperEngine TP 트리거 (AD-68) — 1.5시간
11. E11-7: PaperEngine 미결 주문 제한 — 1시간

### Track B — Backtest (2건)

12. R11-T6: getEquity 미실현 PnL 포함 (AD-66) — 2시간
13. R11-T7: 펀딩 비용 cash 반영 (AD-67) — 2시간

### Track C — Frontend (14건)

**스킬 가이드라인 적용**:
- `frontend-design` + `ui-review` (Web Interface Guidelines) 스킬의 접근성/인터랙션 기준 적용
- `react-composition` (Compound Component, boolean prop 제거, 제네릭 인터페이스) 패턴 적용
- `react-perf` (bundle size, lazy loading, re-render 최적화) 기준 적용

**우선순위 A**:
14. R11-FE-01: MarketRegimeIndicator.tsx 삭제 — 5분
15. R11-FE-06: CATEGORY_LABEL 통일 — 15분
16. R11-FE-07: formatPnl 유틸 승격 — 10분
17. R11-FE-02: risk.ts any → RiskStatusExtended — 20분
18. R11-FE-03: EquityCurveBase 제네릭 + CoinScoreboard 캐스트 제거 — 15분
19. R11-FE-05: PaperModeGate 공통 컴포넌트 — 15분
20. R11-FE-10: 백테스트 폼 유효성 검증 — 25분
21. R11-FE-11: useStrategyDetail 적응형 폴링 — 15분
22. R11-FE-13: 비활성화 다이얼로그 접근성 — 20분

**우선순위 B**:
23. R11-FE-04: as never 캐스트 공통 formatter — 30분
24. R11-FE-12: PerformanceTabs lazy loading — 30분

**Track B 연동**:
25. R11-FE-BT1: BacktestEquityPoint.unrealizedPnl 타입 추가 — 10분
26. R11-FE-BT2: BacktestMetrics.totalFundingCost + StatsPanel + 면책 문구 수정 — 20분

---

## 의존성 DAG

```
E11-1 (peakEquity) ──────────────────→ 독립
E11-2/R11-T5 (SignalFilter) ─────────→ 독립
R11-T3 (Bollinger onFill) ──────────→ 독립
E11-3/R11-T2 (Trailing opt-in) ─────→ R11-T3 이후 (onFill 패턴 일관성)
R11-T4 (entryPrice) ────────────────→ 독립 (E11-3과 병렬 가능)
R11-T6 (getEquity) ─────────────────→ 독립
R11-T7 (funding cash) ──────────────→ 독립
R11-FE-BT1 ─────────────────────────→ R11-T6 이후 (타입 변경 반영)
R11-FE-BT2 ─────────────────────────→ R11-T7 이후 (타입 변경 반영)
```

---

## 다음 단계

1. **Phase 4**: Track A/B/C 병렬 구현 (master에서 직접)
2. **Phase 5**: KNOWLEDGE_INDEX 업데이트
3. **Phase 6**: md/ 문서 최신화 (backtest.md, architecture.md, trading-pipeline.md 등)
4. **Phase 7**: 커밋 & 푸시

### R12 예상 범위
- R11-T1: 트레일링 스탑 통합 (MaTrend/Turtle 자체 구현 제거 + StrategyBase 매핑)
- R11-T9: ATR 기반 포지션 사이징 (opt-in riskPerUnit)
- R11-T10: maxHoldTime 강제 청산 (2단계)
- E11-8: WS 재연결 재구독
- E11-10: API 입력 검증 (Zod)
- R11-FE-09: 백테스트 결과 비교 기능
