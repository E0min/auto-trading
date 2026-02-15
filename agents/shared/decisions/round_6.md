# Round 6 합의 결정문서

> 생성일: 2026-02-16
> 주제: 실거래 준비도 강화 — 핵심 결함 수정 스프린트
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중
> 제안 총건수: Trader 7건, Engineer 14건, UI 15건 (중복 제거 후 실질 ~30건)

---

## 합의 항목

### Backend (Track A)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 | Tier |
|----|------|----------|------|----------|------|
| R6-T0-1 | riskEngine.getAccountState() 메서드 추가 | **3/3 동의** | Engineer | 10분 | T0 |
| R6-T0-2 | getAccountInfo() 크래시 수정 (→ riskEngine.getAccountState().equity) | **3/3 동의** | Engineer | 15분 | T0 |
| R6-T1-1 | ExposureGuard 시장가 주문 price 주입 + reject 방어 | **3/3 동의** | Engineer | 30분 | T1 |
| R6-T1-2 | CLOSE 시그널 qty 퍼센트→실제수량 변환 | **3/3 동의** | Engineer | 30분 | T1 |
| R6-T1-3 | setLeverage 메커니즘 구현 (per-signal + 캐시) | **3/3 동의** (접근법 조율 완료) | Engineer | 1시간 | T1 |
| R6-T1-4 | OrderManager/PositionManager destroy() 호출 추가 | **3/3 동의** | Engineer | 45분 | T1 |
| R6-T2-1 | submitOrder await 추가 (fire-and-forget 제거) | **3/3 동의** | Engineer | 15분 | T2 |
| R6-T2-2 | SignalFilter _activeSignals 타임스탬프 기반 stale 정리 | **3/3 동의** | Engineer | 30분 | T2 |
| R6-T2-3 | PaperEngine reset() 메서드 추가 | **3/3 동의** | Engineer | 15분 | T2 |
| R6-T2-4 | SignalFilter _strategyMeta.clear() 추가 | **3/3 동의** | Engineer | 5분 | T2 |
| R6-T2-5 | Socket.io ticker throttle (심볼당 1초) | **3/3 동의** | Engineer | 15분 | T2 |
| R6-T3-1 | EventEmitter maxListeners(20) 설정 | **3/3 동의** | Engineer | 5분 | T3 |
| R6-T2-6 | positionSide 조기 설정 제거 — 파일럿 2개 전략 | **2/3+조건부** (아래 이견 해소 참조) | Engineer | 45분 | T2 |

### Frontend (Track C)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 | Tier |
|----|------|----------|------|----------|------|
| R6-FE-1 | BacktestStatsPanel disclaimer 추가 | **3/3 동의** | UI | 20분 | T1 |
| R6-FE-2 | StrategyDetail 디자인 토큰 마이그레이션 | **3/3 동의** | UI | 40분 | T2 |
| R6-FE-3 | error.tsx 디자인 토큰 마이그레이션 | **3/3 동의** | UI | 15분 | T2 |
| R6-FE-4 | 백테스트 삭제 ConfirmDialog 추가 | **3/3 동의** | UI | 15분 | T2 |
| R6-FE-5 | AccountOverview 반응형 (grid-cols-2 md:grid-cols-4) | **3/3 동의** | UI | 10분 | T2 |
| R6-FE-6 | BacktestTradeList 마진 수정 (-mx-4→-mx-6) | **3/3 동의** | UI | 5분 | T2 |
| R6-FE-7 | Chart Tooltip 스타일 상수 통합 (lib/chart-config.ts) | **3/3 동의** | UI | 30분 | T2 |
| R6-FE-8 | 네비게이션 접근성 (aria-disabled, aria-label) | **3/3 동의** | UI | 15분 | T2 |
| R6-FE-9 | BotControlPanel Live 확인 → ConfirmDialog 재사용 | **3/3 동의** | UI | 20분 | T2 |
| R6-FE-10 | SignalFeed/TradesTable 높이 동기화 | **3/3 동의** | UI | 20분 | T2 |
| R6-FE-11 | StrategySymbolMap 테이블 스타일 정규화 | **3/3 동의** | UI | 10분 | T2 |
| R6-FE-12 | alert() → 인라인 에러 메시지 전환 (Toast 임시 대체) | **2/3+조건부** | UI | 30분 | T2 |

---

## 이견 사항 해소

### 1. positionSide 조기 설정 제거 — 범위

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | 15+ 전략 전체 수정 (이번 라운드) | 별도 스프린트 (회귀 위험) | 조건부 동의 (테스트 필수) | **파일럿 접근** |

**결정**: RsiPivotStrategy + AdaptiveRegimeStrategy 2개만 이번 라운드에서 수정 (R6-T2-6). Paper 모드 검증 후 나머지 13개 전략은 Round 7에서 일괄 수정.

**근거**:
- Engineer 지적대로 15개 파일 동시 수정은 회귀 위험 높음
- 2개 전략으로 패턴을 확립하고 검증한 후 확장이 안전
- SupertrendStrategy의 onFill 패턴이 모범 사례로 확정됨

### 2. 레버리지 설정 접근법

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | 봇 시작 시 일괄 (최대값) | 주문 시점 per-signal + 캐시 | FE 타입/UI 보완 필요 | **per-signal + 캐시** |

**결정**: Engineer의 per-signal + 캐시 방식 채택.

**근거**:
- 같은 심볼에 Supertrend(5x) + Grid(2x) 동시 활성화 시, "최대값" 방식은 Grid가 의도보다 2.5배 높은 리스크 노출
- per-signal 방식 + `_leverageCache`로 동일 레버리지 재설정 시 API 호출 절약
- Paper 모드에서는 API 호출 없이 `PaperPositionManager`에서 leverage 반영

### 3. Socket.io 보안 (CORS + 인증)

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | 중요하지만 trading 버그 이후 | 이번 라운드 T2 | FE 동시 배포 필수 | **Round 7 이관** |

**결정**: Round 7로 이관. 이유:
1. FE/BE 동시 배포 조율이 필요하여 독립 실행 불가
2. T0/T1 크래시/리스크 버그가 더 긴급
3. API_KEY 인증(T3-2)이 이미 HTTP 경로를 보호하고 있어 즉각적 위협은 제한적

### 4. Toast 시스템 vs 임시 인라인 메시지

| 관점 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 입장 | Round 7 이관 | 자체 구현 시 접근성 주의 | 2시간 투자 | **인라인 임시 전환 (30분)** |

**결정**: 이번 라운드에서 `alert()` → 인라인 에러 메시지로 교체 (30분). 본격 Toast 시스템은 Round 7.

---

## 아키텍처 결정

### AD-32: RiskEngine Public API — getAccountState()

- **결정**: `RiskEngine`에 `getAccountState()` public 메서드 추가. `{ equity: string, positions: Position[] }` 반환.
- **근거**: `botService.js`에서 2곳(L838, L959), `_resolveSignalQuantity()`에서 1곳이 호출. REST API 대신 캐시된 값 사용으로 rate limit 방지.
- **패턴**: `this.accountState`의 shallow copy 반환. positions는 spread copy.

### AD-33: Live Mode Equity Resolution — Cached First, REST Fallback

- **결정**: `_resolveSignalQuantity()`에서 equity 조회 순서: ① `riskEngine.getAccountState().equity` → ② equity가 '0'이면 `exchangeClient.getBalances()` REST fallback → ③ 실패 시 null 반환.
- **근거**: positionManager가 30초마다 동기화하므로 캐시된 값으로 충분. 초기 시작 시 캐시가 비어있을 수 있어 fallback 필요.
- **영향**: 매 시그널마다의 REST 호출 제거 → rate limit 위험 해소.

### AD-34: ExposureGuard Market Order Price — Dual Defense

- **결정**: 2단계 방어 적용.
  - A) `OrderManager._submitOrderInternal()`에서 market order 시 `signal.suggestedPrice || signal.price`를 `riskPrice`로 주입.
  - B) `ExposureGuard.validateOrder()`에서 `price`가 falsy 또는 `'0'`이면 **reject** (`reason: 'no_price_for_exposure_check'`).
- **근거**: A는 정상 경로, B는 최후 방어선. 현재 모든 전략이 `suggestedPrice`를 포함하므로 A로 충분하지만, B가 safety net 역할.

### AD-35: CLOSE Signal Qty — Use Actual Position Quantity

- **결정**: `_resolveSignalQuantity()`에서 CLOSE 시그널 처리: `positionManager.getPosition(symbol, posSide).qty` 또는 `paperPositionManager.getPosition(symbol, posSide, strategy).qty` 사용.
- **근거**: 전략이 `suggestedQty`에 퍼센트 값('5')을 넣으면 Bitget에서 5 BTC로 해석. 실제 보유 수량을 사용해야 정확한 청산.
- **제약**: 심볼당 단일 포지션 가정. 같은 심볼에 다중 전략 포지션 시 수량 합산됨 (현재 아키텍처의 제약).

### AD-36: Leverage Management — Per-Signal with Cache

- **결정**:
  - `ExchangeClient`에 `setLeverage()` 메서드 추가 (Bitget `setFuturesLeverage` 래핑)
  - `OrderManager`에서 주문 전 `signal.leverage`로 레버리지 설정, `_leverageCache` Map으로 동일 값 재설정 방지
  - `PaperPositionManager`에서 `position.leverage = signal.leverage || '1'` 적용
  - Paper 모드에서는 `setLeverage()` API 호출 불필요
- **근거**: 다중 전략이 같은 심볼에 다른 레버리지를 요구할 때, per-signal 방식이 가장 정확한 리스크 계산을 보장.

### AD-37: positionSide State Management — onFill Only (Supertrend Pattern)

- **결정**: `SupertrendStrategy`의 `onFill()` 패턴을 표준으로 채택. 시그널 emit 시점에 `_positionSide`/`_entryPrice` 설정 금지. `onFill(fill)` 콜백에서만 설정.
- **적용 범위**: Round 6에서 RsiPivot + AdaptiveRegime 파일럿. Round 7에서 나머지 13개 전략.
- **근거**: SignalFilter 차단 시 "유령 포지션" 상태 방지. 전략이 재진입 기회를 잃지 않음.

### AD-38: Service Lifecycle — Explicit destroy() in stop()

- **결정**: `botService.stop()`에서 `orderManager.destroy()` + `positionManager.destroy()` 명시적 호출. 싱글톤 `exchangeClient`의 WS 리스너 누적 방지.
- **패턴**: stop → destroy → (다음 start에서 리스너 재등록). "idempotent registration" — `start()` 시 기존 리스너 제거 후 재등록.

### AD-39: Backtest Disclaimer — Mandatory UI Component

- **결정**: `BacktestStatsPanel` 하단에 고정 disclaimer 추가. 내용: "레버리지 미반영, 펀딩비 미반영, 슬리피지/수수료는 설정값 기준 근사치, 실거래 시 결과가 달라질 수 있습니다."
- **근거**: 과대 기대 방지 + 법적 보호. 투자 대비 효과가 가장 높은 항목 (20분 투자).

---

## 이번 라운드 제외 (Round 7 이관)

| 항목 | 사유 |
|------|------|
| positionSide 전체 리팩토링 (13개 전략) | 파일럿 검증 후 진행 |
| Socket.io CORS + 인증 (Eng R6-7) | FE/BE 동시 배포 조율 필요 |
| InstrumentCache (Eng R6-14) | 2시간 투자, 현재 영향 낮음 |
| Toast 시스템 (UI R6-2 full) | 인라인 메시지로 임시 대체 |
| 심볼 입력 프리셋 (UI R6-10) | 기능 추가, 버그 수정보다 후순위 |
| 전략-레짐 매트릭스 (UI S1-1) | 시각화 개선, T0/T1 이후 |
| 레버리지 표시 보완 (UI S1-2) | 백엔드 레버리지 구현 검증 후 |
| T3-4: decimal.js 마이그레이션 | R1에서 이미 deferred |

---

## 구현 순서 (의존성 DAG)

```
Phase 1: 크래시 수정 (25분) ← 최우선
  R6-T0-1: riskEngine.getAccountState() 추가
  R6-T0-2: getAccountInfo → riskEngine.getAccountState().equity + fallback
  (R6-T0-1 ← R6-T0-2 의존)

Phase 2: 리스크 정상화 (1시간 30분)
  R6-T1-1: ExposureGuard price 주입 + reject 방어  [독립]
  R6-T1-2: CLOSE qty 실제수량 변환               [R6-T0-2 의존]
  R6-T2-1: submitOrder await 추가                 [독립]

Phase 3: 리소스 관리 (1시간)
  R6-T1-4: destroy() 호출 추가                    [독립]
  R6-T2-3: PaperEngine reset()                    [독립]
  R6-T2-4: SignalFilter _strategyMeta clear        [독립]
  R6-T3-1: maxListeners(20)                        [독립]

Phase 4: 레버리지 (1시간)
  R6-T1-3: setLeverage (ExchangeClient + OrderManager + PaperPositionManager)
  (Phase 1-3 안정화 후)

Phase 5: 전략 파일럿 + SignalFilter (1시간 15분)
  R6-T2-6: positionSide 파일럿 (RsiPivot + AdaptiveRegime)  [Phase 1 의존]
  R6-T2-2: SignalFilter stale 정리                             [독립]
  R6-T2-5: ticker throttle                                     [독립]

Frontend (Phase 2-5와 병렬 진행):
  R6-FE-1: disclaimer (독립)
  R6-FE-2~12: 디자인/UX 개선 (독립)
```

---

## 다음 단계

Phase 4 (Execute) 진행 시:
- **Track A (Backend)**: Phase 1→2→3→4→5 순서. 총 ~5시간 15분.
- **Track C (Frontend)**: 전체 병렬 가능. 총 ~3시간 50분.
- **워크트리**: master에서 직접 작업 (항목 수가 많으나 모두 독립적 파일)

---

*3-agent 합의 기반. 합의 항목 25건, 아키텍처 결정 8건 (AD-32~AD-39), 이관 8건.*
