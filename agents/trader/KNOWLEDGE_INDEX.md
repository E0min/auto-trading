# Trader Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 전략 18개 전수조사, 리스크엔진 감사, 백테스트 신뢰도 분석 | Round 1 | active |
| `proposals/round_1_review.md` | Engineer+UI 제안서 교차 리뷰, 3-Agent 공통 이슈 분류, 스프린트 우선순위 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-1~T0-9 구현 제안 (포지션 사이징, 심볼 라우팅, 기본전략) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |
| `proposals/round_3.md` | T1-1~T1-11 구현 제안 (백테스트 IndicatorCache, fill action, Sharpe 보정 등) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Engineer+UI 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |
| `proposals/round_4.md` | T2-1~T2-12 구현 제안 (RSI Wilder, confidence 필터, 포지션 사이징, funding 데이터, equity DI) | Round 4 | active |
| `proposals/round_4_review.md` | Round 4 교차 리뷰 (Engineer+UI 제안 검토) | Round 4 | active |
| `../shared/decisions/round_4.md` | Round 4 합의 결정문서 (T2-1~T2-12, AD-18~AD-24) — **구현 완료** | Round 4 | active |
| `proposals/round_5.md` | T3 Enhancement 6건 분석: exchange-side SL 최우선, 성과 귀인 API 미활용, 테스트 프레임워크 부재 | Round 5 | active |
| `proposals/round_5_review.md` | Round 5 교차 리뷰: Jest/Vitest 이중 체계 동의, SL 전략별 적합도 분류 검증, API 인증 시급성 | Round 5 | active |
| `../shared/decisions/round_5.md` | Round 5 합의 결정문서 (T3-1~T3-7, BUG-1, AD-25~AD-31) — **구현 완료** | Round 5 | active |
| `proposals/solo_1.md` | Post-R5 종합 트레이딩 품질 분석: HIGH 4건, MEDIUM 7건, LOW 4건. Overall 7.1/10 | Solo S1 | active |
| `proposals/round_6.md` | 실거래 준비도 강화: CRITICAL 1건(getAccountInfo crash), HIGH 4건, MEDIUM 1건 | Round 6 | active |
| `proposals/round_6_review.md` | Round 6 교차 리뷰 (Engineer+UI 제안 검토) | Round 6 | active |
| `../shared/decisions/round_6.md` | Round 6 합의 결정문서 (25개 항목, AD-32~AD-39) — **구현 완료** | Round 6 | active |
| `proposals/round_7.md` | 레짐 변경 빈도 문제 분석: hysteresisMinCandles=15 제안, 유예기간 설계, 고아 포지션 리스크 | Round 7 | active |
| `proposals/round_7_review.md` | Round 7 교차 리뷰: Engineer 8→12 절충, 쿨다운 5분 동의, 유예기간 카테고리별 차등 보완 | Round 7 | active |
| `../shared/decisions/round_7.md` | Round 7 합의 결정문서 (17건, AD-40~AD-45) — 삼중 보호 체계, 유예기간 — **구현 완료** | Round 7 | active |
| `proposals/round_8.md` | 코드베이스 재분석: 19개 발견 (CRITICAL 3/HIGH 6/MEDIUM 7/LOW 3) — reduceOnly bypass, 멀티심볼, 전략 warm-up | Round 8 | active |
| `proposals/round_8_review.md` | Round 8 교차 리뷰 (Engineer+UI 제안 검토) — decimal.js 이견, 캡슐화 동의, 접근성 동의 | Round 8 | active |
| `../shared/decisions/round_8.md` | Round 8 합의 결정문서 (46건, AD-46~AD-52) — reduceOnly bypass, severity toast, Snapshot 생성 — **구현 완료** | Round 8 | active |
| `proposals/round_9.md` | Tier 2 Quality 11건 분석: 멀티심볼 라우팅, warm-up, 펀딩비 PnL, 코인 재선정, InstrumentCache | Round 9 | active |
| `proposals/round_9_review.md` | Round 9 교차 리뷰 (Engineer+UI 제안 검토) | Round 9 | active |
| `../shared/decisions/round_9.md` | Round 9 합의 결정문서 (13건, AD-53~AD-57) — InstrumentCache, warm-up, 멀티심볼, 펀딩PnL, 재선정 — **구현 완료** | Round 9 | active |
| `proposals/round_10.md` | Tier 3 Enhancement 8건 분석: trailing stop, peakEquity 영속성, 멀티포지션 백테스트, Sortino/Calmar | Round 10 | active |
| `proposals/round_10_review.md` | Round 10 교차 리뷰 (Engineer+UI 제안 검토) — ATR 연기 동의, percent 모드 선행 | Round 10 | active |
| `../shared/decisions/round_10.md` | Round 10 합의 결정문서 (8건, AD-58~AD-62) — peakEquity 영속성, trailing stop, 멀티포지션, Sortino/Calmar, EquityCurveBase — **구현 완료** | Round 10 | active |
| `proposals/round_11.md` | 코드베이스 재분석 11건: SignalFilter close bypass, trailing stop opt-in 6전략, entryPrice→onFill, volMomentum 수정, PaperEngine TP, 백테스트 equity+funding | Round 11 | active |
| `proposals/round_11_review.md` | Round 11 교차 리뷰 (Engineer+UI 제안 검토) | Round 11 | active |
| `../shared/decisions/round_11.md` | Round 11 합의 결정문서 (26건, AD-63~AD-68) — SignalFilter bypass, peakEquity 쿼리, trailing opt-in, 백테스트 equity+funding, PaperEngine TP — **구현 완료** | Round 11 | active |
| `proposals/round_12.md` | 코드베이스 재분석 Round 3: 9건 (trailing stop dead code 8전략, reduceOnly 14전략, 레버리지 백테스트, Calmar 연율화, 절대 비용 필터) | Round 12 | active |
| `proposals/round_12_review.md` | Round 12 교차 리뷰 (Engineer+UI 제안 검토) — trailing dead code 정정, reduceOnly 동의, 레버리지 마진 기반 | Round 12 | active |
| `../shared/decisions/round_12.md` | Round 12 합의 결정문서 (31건, AD-69~AD-73) — trailing metadata 정리, reduceOnly 일괄, 레버리지 백테스트, Calmar 연율화, WS deep check, fill reconciliation — **구현 완료** | Round 12 | active |

## Round 1 Key Findings Summary
- **C1**: multi-symbol 라우팅 버그 — `_symbol` 단일 값이라 마지막 심볼만 유효
- **C2**: ExposureGuard가 qty를 percentage로 해석 — 주문 크기 10,000x 오류
- **C3**: 백테스트 fill에 `action` 누락 — 전략 포지션 추적 불가
- **C4**: 백테스트에 IndicatorCache 미제공 — 14/18 전략 크래시
- **C5**: 기본 전략명이 실존하지 않는 이름 — 전략 0개로 봇 실행
- 14/18 전략이 IndicatorCache에 의존하지만 backtest에서 미제공
- Sharpe ratio가 ~10x 과대평가 (일간 아닌 캔들간 수익률 사용)
- FundingRateStrategy는 데이터 소스 없어 신호 불가
- GridStrategy의 equity 주입 버그 — qty 항상 0

## Round 5 Key Findings Summary
- **T3-3**: 18개 전략 전체가 소프트웨어 SL만 사용 — `presetStopLossPrice` 배관은 있으나 전략 미사용. 봇 장애 시 SL 미실행 리스크
- **T3-6**: 백엔드 `by-strategy`/`by-symbol` API 존재하나 프론트엔드 미소비. profitFactor/Sharpe/maxDD 전략별 미제공
- **T3-1**: 테스트 인프라 전무 — 32건 코드가 무검증 운영. 트레이딩 핵심 테스트 대상: RiskEngine > 전략 시그널 > 포지션 사이징 > PnL 계산
- **BUG-1**: performanceTracker Map 직렬화 버그 — 3개 에이전트 독립 발견

## Round 7 Key Findings Summary
- **신호 손실**: hysteresisMinCandles=3 (3분) → 전략의 최소 유효 매매 사이클(10~120분) 대비 지나치게 짧아 진입 기회 상실
- **고아 포지션**: strategyRouter.deactivate()가 포지션 청산 없이 `_active=false` 설정 → SL/TP 관리 중단 리스크
- **삼중 보호 합의**: hysteresis 10캔들 + 쿨다운 5분 + 유예기간 3~15분 = 최소 18분 버퍼. 80% 전략이 1 사이클 완료 가능
- **유예 중 시그널 필터링**: OPEN 차단 + CLOSE(SL/TP) 허용 — 기존 포지션 보호와 신규 진입 방지 양립

## Round 8 Key Findings Summary
- **reduceOnly bypass (AD-46)**: RiskEngine이 SL/TP/CLOSE 주문까지 차단 — CircuitBreaker/DrawdownMonitor bypass 조건 추가로 청산 실행 보장
- **SignalFilter CLOSE bypass**: 쿨다운이 청산 시그널도 차단하는 설계 결함 → CLOSE/SL/TP 시그널은 쿨다운 무시
- **Snapshot 주기적 생성 (AD-52)**: 주식 곡선 60초 간격 스냅샷 — equity/cash/unrealizedPnl 추적, paper/live 자동 전환
- **BotSession 실시간 통계**: ORDER_FILLED 이벤트 수신 → totalTrades/wins/losses/totalPnl/peakEquity/maxDrawdown 즉시 반영

## Round 9 Key Findings Summary
- **InstrumentCache (AD-53)**: 심볼별 lotStep/minQty/maxQty 캐싱 — 하드코딩 '0.0001' 제거, 멀티심볼 전제조건
- **멀티심볼 라우팅 Phase 1 (AD-55)**: 전략마다 다른 단일 심볼 배정 — CoinSelector 스코어 기반, 이전 심볼 재배정 방지
- **전략 warm-up (AD-54)**: StrategyBase.emitSignal() 게이트 — 최초 N 캔들 무시, 지표 안정화 대기
- **펀딩비 PnL Phase 1 (AD-57)**: 라이브+Paper+백테스트 펀딩비 추적 — 실현 PnL에 펀딩 수수료 반영
- **코인 재선정 4h 주기 (AD-56)**: CoinSelector 4시간 고정 간격 재실행 — 시장 상황 변화 반영

## Round 10 Key Findings Summary
- **DrawdownMonitor peakEquity 영속성 (AD-58)**: 서버 재시작 시 peakEquity='0' 리셋 → drawdown 보호 무력화. loadState()/getState() + updateEquity() 패턴으로 BotSession에서 복원, 자동 halt 감지
- **Trailing Stop 6전략 (AD-59)**: StrategyBase opt-in, percent 모드만. 추세/모멘텀 6개 전략에 activationPercent+callbackPercent 설정. 고정 SL과 trailing 중 더 타이트한 것 적용
- **멀티포지션 백테스트 (AD-60)**: _position → _positions Map, incrementalId 키, FIFO 청산. maxConcurrentPositions=1 전략은 동작 변경 없음
- **Sortino + Calmar Ratio (AD-61)**: Sortino(하방 편차 기반), Calmar(수익/최대낙폭). meanReturn 스코프 수정으로 정확한 계산

## Round 11 Key Findings Summary
- **SignalFilter close bypass 수정 (AD-63)**: `action === 'CLOSE'`가 실제 시그널 값(`close_long`, `close_short`)과 불일치 → `action.startsWith('close') || signal.reduceOnly`로 수정. 모든 전략의 청산 시그널이 쿨다운/중복 필터를 정상 바이패스
- **Trailing Stop opt-in 활성화 (AD-65)**: strategyBase.onTick()에서 `metadata.trailingStop.enabled === true`인 전략만 자동 호출. 6전략 활성화: MaTrend, Turtle, SwingStructure, Supertrend, Breakout, AdaptiveRegime. Grid/Funding/RSIPivot/Bollinger/Vwap/QuietRangeScalp은 부적합
- **entryPrice → onFill() 이동**: MaTrend/Turtle이 시그널 emit 시 entryPrice/highestSinceEntry/lowestSinceEntry 설정 → onFill()로 이동. 실제 체결 후 상태 초기화로 데이터 정합성 향상
- **BollingerReversion super.onFill() 추가**: onFill() 오버라이드에서 super.onFill(fill) 호출 누락 → trailing stop 초기화가 작동하지 않던 문제 수정
- **CoinSelector F7 volMomentum 수정**: F7이 raw 거래량(F6과 중복)을 사용 → vol24h 대비 변화율로 수정. 7-factor 스코어링의 독립성 회복
- **PaperEngine TP 트리거 (AD-68)**: SL 트리거만 시뮬레이션하고 TP는 미구현 → `_checkTakeProfitTriggers()` 추가. Long: price >= tpPrice, Short: price <= tpPrice. SL+TP 동시 트리거 시 SL 우선
- **백테스트 getEquity 미실현 PnL 포함 (AD-66)**: `getEquity: () => this._cash` → `getEquity: () => this._calculateEquity(currentPrice)`. 전략 포지션 사이징이 미실현 손익 반영, 라이브와 백테스트 간 괴리 해소
- **백테스트 펀딩 비용 cash 반영 (AD-67)**: `_applyFundingIfDue()`에서 산출된 펀딩 비용을 `this._cash`에 실제 차감/가산. 8시간 간격, cash 음수 방어

## Round 12 Key Findings Summary
- **Trailing metadata dead code (AD-69)**: 8개 전략의 metadata.trailingStop.enabled=true가 실제로는 dead code — super.onTick() 미호출로 StrategyBase._checkTrailingStop() 실행 안됨. enabled=false로 명확화
- **close 시그널 reduceOnly 일괄 (14전략)**: MaTrend/AdaptiveRegime 외 14개 전략의 close 시그널에 reduceOnly:true 누락 → RiskEngine bypass 미적용 가능성. 일괄 추가
- **백테스트 레버리지 (AD-70)**: margin = cash * pct/100, positionValue = margin * leverage. cash에서 margin만 차감, 강제 청산 미시뮬레이션 경고
- **Calmar Ratio 연율화 (7일 guard)**: 기존 raw return/maxDD → annualizedReturn/maxDD. 7일 미만 백테스트는 raw ratio 유지
- **CoinSelector 절대 비용 필터 (P12-9)**: spread + taker commission > 0.15% 심볼 제외 — 스프레드 넓은 저유동성 심볼 방지

## Accumulated Insights
- **전략 품질 진화**: R1 14/18 전략 IndicatorCache 미제공 크래시 → R2 백테스트 수정 → R5 exchange-side SL 제안 → R7 유예기간으로 전략 활성 시간 보장 → R8 reduceOnly bypass로 SL/TP 실행 보장 → R11 SignalFilter close bypass 수정 + entryPrice onFill 이동 + Bollinger super.onFill 추가 → R12 trailing metadata enabled=false(8전략 dead code 정리) + close 시그널 reduceOnly:true(14전략 일괄). 현재 상태: 전략 시그널 경로 완비, trailing dead code 제거, close 시그널 안전 경로 확보
- **리스크 관리 체계**: R1 ExposureGuard qty 10,000x 오류 → R2 수정 → R4 포지션 사이징 파이프라인 정비 → R7 유예기간으로 고아 포지션 방지 → R8 RiskEngine reduceOnly bypass + SignalFilter CLOSE bypass → R11 SignalFilter close startsWith 수정으로 실제 청산 바이패스 작동. 현재 상태: 리스크+시그널 필터 청산 경로 완전 검증
- **레짐 시스템 성숙**: R1 레짐 분류 구축 → R4 7-factor 코인 선정 강화 → R7 삼중 보호 체계(hysteresis+cooldown+grace)로 안정화 → R11 F7 volMomentum 변화율 수정으로 7-factor 독립성 회복. 현재 상태: 노이즈 내성 확보, 코인 선정 스코어링 정확성 개선
- **수익성 인프라**: R1 Sharpe ~10x 과대평가 → R3 보정 → R5 성과 귀인 → R6 실거래 준비도 → R8 Snapshot 60초 주기 → R9 펀딩비 PnL 추적 → R10 Sortino+Calmar Ratio 추가 → R11 백테스트 equity에 미실현 PnL 포함 + 펀딩비 cash 반영 → R12 Calmar 연율화(7일 guard) + 백테스트 레버리지(margin 기반 사이징 AD-70) + equityCurve 샘플링(max 10K). 현재 상태: Calmar 연율화 정확, 레버리지 백테스트 지원, 메모리 효율화
- **포지션 관리 진화**: R1 단일 심볼 → R8 PositionManager 전략 매핑 → R9 멀티심볼 라우팅 Phase 1 + InstrumentCache → R10 백테스트 멀티포지션(FIFO). 현재 상태: 전략별 독립 심볼+포지션 관리 체계, 백테스트 멀티포지션 지원
- **Trailing Stop 도입**: R5 exchange-side SL(presetStopLossPrice) → R10 StrategyBase trailing stop opt-in(6개 추세/모멘텀 전략) → R11 strategyBase.onTick() 자동 호출 활성화 + Breakout/AdaptiveRegime trailingStop metadata 추가. 현재 상태: 6전략 trailing stop 실제 작동, MaTrend/Turtle 자체 구현 통합은 R12 예정
- **PaperEngine 완성도**: R1 PaperEngine 리스너 누적 → R3 수정 → R11 TP 트리거 시뮬레이션 추가 + 미결 주문 30분 TTL/50건 cap. 현재 상태: SL+TP 양방향 트리거 시뮬레이션, 자원 관리 완비

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
