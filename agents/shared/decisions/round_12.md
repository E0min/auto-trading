# Round 12 합의 결정문서

> 생성일: 2026-02-17
> 주제: 코드베이스 재분석 — 새 개선과제 발굴 Round 3
> 입력: 3개 제안서 (Trader 9건 + Engineer 16건 + UI/UX 13건) + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 핵심 리뷰 발견

1. **E12-4 (BotService 재선정 중첩 방지) — 이미 구현됨**: Trader가 `botService.js` L163-164, L1870-1872에 `_reselectionInProgress` 가드가 이미 존재함을 확인. **구현 대상에서 제외.**
2. **P12-1 진단 정정**: Engineer가 모든 전략이 `onTick()`을 override하고 `super.onTick()`을 호출하지 않음을 확인. StrategyBase trailing stop은 **dead code**. 이중 실행이 아닌 dead code 정리가 목적. 범위를 2개→**8개 전략**으로 확대.
3. **R12-FE-08 백엔드 선행 작업 필요**: Engineer가 `GET /api/trades/positions` 응답에 `strategy` 필드가 없음을 확인. BE에서 `_strategyPositionMap` merge 필요.
4. **E12-12 (WS 상태 검사) — Trader가 T0 상향 강력 권장**: 좀비 WS 연결이 실거래 손실에 직결.

---

## 합의 항목

### 이번 스프린트 실행 대상

#### Backend T0 (즉시)

| ID | 이슈 | 합의 수준 | 담당 | 시간 |
|----|------|----------|------|------|
| E12-1 | MarketDataCache sweep 타이머 (60초 주기 만료 항목 정리) | 3/3 ✅ | Backend | 30분 |
| E12-2 | CoinSelector selectCoins() 재진입 가드 (`_selecting` 플래그) | 3/3 ✅ | Backend | 20분 |
| P12-1 | Trailing Stop metadata 정리 — 8개 전략 `enabled: false` + dead code 명확화 (AD-69) | 2/3+조건부 | Backend | 1시간 |
| E12-12 | HealthCheck WS deep check — 좀비 연결 감지 (AD-71) | 2/3+조건부 | Backend | 1시간 |

#### Backend T1 (1주 내)

| ID | 이슈 | 합의 수준 | 담당 | 시간 |
|----|------|----------|------|------|
| E12-3 | TickerAggregator stale 심볼 정리 (30분 경과 제거) | 3/3 ✅ | Backend | 30분 |
| E12-5 | ExchangeClient rate limit 전역 cooldown (5초 고정 대기) | 2/3+조건부 | Backend | 1시간 |
| E12-7 | WS 재연결 fill 보상 — REST 60초 reconciliation (AD-72) | 3/3 ✅ | Backend | 2시간 |
| E12-10 | PositionManager marginMode 삼항 수정 (`raw.marginMode \|\| 'crossed'`) | 3/3 ✅ | Backend | 5분 |
| P12-2 | 14개 전략 close 시그널 `reduceOnly: true` 일괄 추가 | 3/3 ✅ | Backend | 1시간 |
| R12-FE-08-BE | positions API에 strategy 필드 merge (AD-73) | 2/3+조건부 | Backend | 30분 |

#### Backtest T1

| ID | 이슈 | 합의 수준 | 담당 | 시간 |
|----|------|----------|------|------|
| P12-3 | 백테스트 레버리지 반영 — margin 기반 사이징 + PnL (AD-70) | 2/3+조건부 | Backtest | 3시간 |
| P12-7 | Calmar Ratio 연율화 (최소 7일 guard) | 3/3 ✅ | Backtest | 30분 |

#### Backend T2 (품질)

| ID | 이슈 | 합의 수준 | 담당 | 시간 |
|----|------|----------|------|------|
| E12-9 | BotService.start() 실패 시 rollback (역순 stop) | 3/3 ✅ | Backend | 1시간 |
| E12-11 | equityCurve 샘플링 (max 10,000, 균등 간격 + 첫/마지막 보존) | 3/3 ✅ | Backtest | 30분 |
| E12-13 | Logger context 크기 제한 (maxContextSize) | 3/3 ✅ | Backend | 30분 |
| E12-14 | BacktestRoutes 동시 실행 제한 (MAX=2, 봇 RUNNING 시 1) | 3/3 ✅ | Backend | 30분 |
| E12-15 | InstrumentCache staleness 경고 (3회 연속 실패 → WARN) | 3/3 ✅ | Backend | 30분 |
| E12-16 | CoinSelector _prevVol24h 정리 (candidates 외 키 삭제) | 3/3 ✅ | Backend | 15분 |
| P12-9 | CoinSelector 절대 비용 필터 (maxEffectiveCost 0.15%) | 3/3 ✅ | Backend | 1시간 |

#### Frontend T1

| ID | 이슈 | 합의 수준 | 담당 | 시간 |
|----|------|----------|------|------|
| R12-FE-03 | addToast 의존성 배열 누락 수정 (2건) | 3/3 ✅ | Frontend | 10분 |
| R12-FE-04 | BacktestForm setInterval → timeframe 변수명 변경 | 3/3 ✅ | Frontend | 10분 |
| R12-FE-09 | TradingModeToggle 에러 표시 (onError prop) | 3/3 ✅ | Frontend | 15분 |
| R12-FE-11 | DrawdownChart gradientId useId() 적용 | 3/3 ✅ | Frontend | 10분 |
| R12-FE-05 | useBacktest Visibility API 적용 (백그라운드 폴링 중지) | 3/3 ✅ | Frontend | 30분 |
| R12-FE-06 | SignalFeed 모바일 2줄 레이아웃 | 2/3+조건부 | Frontend | 30분 |
| R12-FE-08 | PositionsTable 전략 컬럼 추가 (BE 선행 필요) (AD-73) | 2/3+조건부 | Frontend | 20분 |
| R12-FE-07 | AccountOverview value flash 효과 (임계치 0.1% 이상) | 2/3+조건부 | Frontend | 1시간 |
| R12-FE-01 | useSocket/useMarketIntelligence 이중 구독 정리 | 2/3+조건부 | Frontend | 1시간 |
| R12-FE-10 | SymbolRegimeTable 접기/펼치기 (기본 접힘) | 2/3+조건부 | Frontend | 30분 |
| P12-3-FE | BacktestForm 레버리지 드롭다운 + StatsPanel 경고 갱신 | UI 보완 | Frontend | 1시간 |
| P12-7-FE | BacktestStatsPanel Calmar 라벨 "연율화" 추가 | UI 보완 | Frontend | 5분 |

### 보류 항목

| ID | 이슈 | 사유 |
|----|------|------|
| E12-4 | BotService 재선정 중첩 방지 | **이미 구현됨** (L163-164, L1870-1872) |
| E12-6 | RateLimiter shift() 최적화 | 현재 병목 아님. T3 하향. 다중 클라이언트 시 재평가 |
| E12-8 | PaperEngine mark price SL/TP | T2 하향. 라이브 안정성 이후 개선 |
| P12-4 | ExposureGuard 레버리지 인지 | 설계 명확화 필요. 명목 통일 vs 이원화 논의 미결 |
| P12-5 | 방향성 집중도 모니터링 | SignalFilter 확장 아키텍처 설계 선행 필요 (4h+) |
| P12-6 | ATR 동적 TP/SL | 점진적 적용 필요. 2~3 전략 파일럿 후 확대 |
| P12-8 | 포트폴리오 백테스트 | Tier 3, 10h+. 별도 스프린트 |
| R12-FE-02 | PerformanceTabs 갱신 | stale-while-revalidate 설계 후 진행 |
| R12-FE-12 | tournament/page.tsx 분할 | 급하지 않음 |
| R12-FE-13 | 백테스트 결과 비교 기능 | Phase 분리 필요 |

---

## 아키텍처 결정

### AD-69: Trailing Stop metadata 정리 (8개 전략 dead code)

- **결정**: `metadata.trailingStop.enabled = false`로 설정하여 StrategyBase trailing 인프라를 비활성화
- **근거**: Engineer가 확인 — 모든 전략이 `onTick()`을 override하고 `super.onTick()`을 호출하지 않으므로 StrategyBase `_checkTrailingStop()`은 dead code. Trader의 "이중 실행" 진단은 부정확하나, 수정 방향은 동일.
- **대상 8개 전략**:
  - MaTrend (자체 trailing 있음 → metadata enabled=false)
  - AdaptiveRegime (자체 ATR TP/SL 있음 → metadata enabled=false)
  - Turtle (자체 ATR trailing 있음 → metadata enabled=false)
  - SwingStructure (metadata trailing 추가됨 → enabled=false로 변경)
  - Breakout (metadata trailing 추가됨 → enabled=false로 변경)
  - Supertrend (metadata trailing 있음 → enabled=false로 변경)
  - RsiPivot (metadata trailing 있음 → enabled=false로 변경)
  - MacdDivergence (해당되면 정리)
- **주의**: onTick()에서 super 호출하지 않는 한 실제 이중 실행은 없으나, dead code metadata를 남겨두면 향후 혼동 유발

### AD-70: 백테스트 레버리지 반영

- **결정**: backtestEngine.js에 레버리지 기반 마진 사이징 추가
- **포지션 오프닝**: `margin = cash * positionSizePct / 100`, `positionValue = margin * leverage`, `qty = positionValue / fillPrice`. 현금에서 margin만 차감.
- **PnL**: qty가 레버리지로 증폭되므로 PnL도 자동 반영. 추가 수정 불필요.
- **API 변경**: `POST /api/backtest/run` body에 `leverage` 파라미터 (기본 '1', 범위 1~20)
- **guard**: 레버리지 적용 후 cash < 0 방어, leverage 검증 (양의 정수)
- **강제 청산**: 이번 범위 외. StatsPanel 경고 "레버리지 Nx 적용 (강제 청산 미시뮬레이션)"
- **최소 기간 guard**: Calmar 연율화에 7일 미만 시 raw ratio 사용

### AD-71: HealthCheck WS deep check

- **결정**: ExchangeClient에 `getWsStatus()` 메서드 추가 + HealthCheck에서 참조
- **반환 스키마**: `{ publicWs: { connected, lastMessageAt, subscribedTopics }, privateWs: { connected, lastMessageAt } }`
- **임계치**: 마지막 메시지 60초 이상 → warning, 120초 이상 → error (자동 재연결은 이번 범위 외)
- **FE 연동**: SystemHealth에 거래소 WS 상태 Badge 추가 (tooltip에 상세 정보)

### AD-72: WS 재연결 fill 보상 (reconciliation)

- **결정**: WS 재연결 시 REST로 최근 60초 fill 조회, 누락분 Trade DB 보상
- **근거**: Trader 확인 — WS 재연결 10~30초, REST eventual consistency 1~2초. fill 누락 주 1~2회.
- **idempotency**: `clientOid` 또는 `tradeId` 기반 중복 방지
- **이벤트**: reconciliation 완료 시 이벤트 emit (FE는 이후 스프린트에서 대응)

### AD-73: Positions API strategy 필드 (BE+FE)

- **결정**: `GET /api/trades/positions` 응답에 `strategy` 필드 추가
- **구현**: tradeRoutes에서 `positionManager.getPositions()` + `botService._strategyPositionMap` merge
- **FE**: PositionsTable에 전략 컬럼 추가 (레버리지 컬럼 대체), `translateStrategyName()` 적용

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|-----|------|
| E12-4 실행 여부 | ❌ 이미 구현됨 | 실행 제안 | ✅ 동의 | **제외: 이미 구현됨** |
| P12-1 진단 | 이중 실행 | Dead code | FE 영향 없음 | **Dead code 정리, 8개 전략** |
| E12-2 심각도 | HIGH (BotService 가드 존재) | CRITICAL | ✅ | **HIGH (방어적 추가)** |
| E12-6 우선순위 | T3 하향 | T2 | T2 | **보류 (T3)** |
| E12-8 우선순위 | T2 하향 | T1 | T1 | **보류 (T2 이후)** |
| E12-12 우선순위 | T0 상향 강력 권장 | T2 | 조건부 | **T0 (좀비 WS = 실거래 리스크)** |
| R12-FE-04 변수명 | timeframe 권장 | backtestInterval 권장 | setIntervalValue 제안 | **timeframe (트레이딩 용어)** |
| R12-FE-06 1줄 배치 | confidence 포함 | 동의 | action+symbol+time | **1줄: action+symbol+confidence, 2줄: strategy+risk+time** |
| R12-FE-07 flash 임계치 | 미실현 PnL 우선 | 0.1% 임계치 | 미포함 | **0.1% 임계치 + 미실현 PnL 우선 적용** |
| R12-FE-08 BE 의존성 | FE만 제안 | BE 선행 필수 발견 | FE만 제안 | **BE+FE 동시 (AD-73)** |
| R12-FE-09 심각도 | HIGH 상향 | MEDIUM | MEDIUM | **HIGH (모드 전환 = 자금 리스크)** |
| R12-FE-10 통합 방식 | 접기/펼치기 (완전 통합 부적절) | 접기/펼치기 | 3가지 방법 제안 | **접기/펼치기 (기본 접힘)** |

---

## 트랙 배분 및 실행 순서

### Track A — Backend (20건)

**Phase 1 (Tier 0 — 즉시)**:
1. E12-1: MarketDataCache sweep 타이머 — 30분
2. E12-2: CoinSelector 재진입 가드 — 20분
3. P12-1: 8개 전략 trailing metadata `enabled: false` (AD-69) — 1시간
4. E12-12: HealthCheck WS deep check + getWsStatus() (AD-71) — 1시간

**Phase 2 (Tier 1)**:
5. E12-10: marginMode 삼항 수정 — 5분
6. E12-3: TickerAggregator stale 정리 — 30분
7. E12-5: rate limit 전역 cooldown — 1시간
8. E12-7: WS 재연결 fill reconciliation (AD-72) — 2시간
9. P12-2: 14개 전략 close reduceOnly 일괄 — 1시간
10. R12-FE-08-BE: positions API strategy merge (AD-73) — 30분

**Phase 3 (Tier 2)**:
11. E12-9: start() rollback — 1시간
12. E12-13: Logger context 크기 제한 — 30분
13. E12-14: Backtest 동시 실행 제한 — 30분
14. E12-15: InstrumentCache staleness 경고 — 30분
15. E12-16: _prevVol24h 정리 — 15분
16. P12-9: CoinSelector 절대 비용 필터 — 1시간

### Track B — Backtest (3건)

17. P12-3: 백테스트 레버리지 (AD-70) — 3시간
18. P12-7: Calmar Ratio 연율화 + 7일 guard — 30분
19. E12-11: equityCurve 샘플링 (max 10,000) — 30분

### Track C — Frontend (12건)

**Quick Fixes**:
20. R12-FE-03: addToast 의존성 수정 — 10분
21. R12-FE-04: setInterval → timeframe — 10분
22. R12-FE-09: TradingModeToggle onError — 15분
23. R12-FE-11: DrawdownChart useId() — 10분
24. R12-FE-05: useBacktest visibility — 30분
25. R12-FE-06: SignalFeed 모바일 2줄 — 30분

**BE 연동**:
26. R12-FE-08: PositionsTable 전략 컬럼 — 20분
27. P12-3-FE: BacktestForm 레버리지 드롭다운 + StatsPanel — 1시간
28. P12-7-FE: Calmar 라벨 "연율화" — 5분

**UX 개선**:
29. R12-FE-07: AccountOverview value flash — 1시간
30. R12-FE-01: useSocket 이중 구독 정리 — 1시간
31. R12-FE-10: SymbolRegimeTable 접기/펼치기 — 30분

---

## 의존성 DAG

```
E12-1 (cache sweep) ──────────────→ 독립
E12-2 (재진입 가드) ──────────────→ 독립
P12-1 (trailing metadata) ────────→ 독립
E12-12 (WS deep check) ──────────→ 독립
E12-3 (stale ticker) ─────────────→ 독립
E12-7 (fill reconciliation) ──────→ 독립
P12-2 (reduceOnly) ───────────────→ P12-1 이후 (트레일링 정리 먼저)
R12-FE-08-BE → R12-FE-08 (BE 선행 필수)
P12-3 → P12-3-FE (BE 선행 필수)
P12-7 → P12-7-FE (BE 선행 필수)
```

---

## 다음 단계

1. **Phase 4**: Track A/B/C 병렬 구현 (master에서 직접)
2. **Phase 5**: KNOWLEDGE_INDEX 업데이트
3. **Phase 6**: md/ 문서 최신화
4. **Phase 7**: 커밋 & 푸시

### Deferred → R13 예상 범위
- P12-4: ExposureGuard 레버리지 인지 (설계 확정 후)
- P12-5: 방향성 집중도 (SignalFilter 확장 아키텍처)
- P12-6: ATR 동적 TP/SL (2~3 전략 파일럿)
- E12-8: PaperEngine mark price
- R12-FE-02: PerformanceTabs stale-while-revalidate
- R12-FE-12: tournament 분할
- R12-FE-13: 백테스트 비교 기능
