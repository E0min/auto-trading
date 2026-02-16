# Round 9 합의 결정문서

> 생성일: 2026-02-17
> 주제: Tier 2 Quality — R8 미구현 agreed 항목 (11건 + deferred 2건 재활성화)
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

---

## 합의 항목

### Backend — 재활성화 (2건, T0/T1에서 승격)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T1-1 | InstrumentCache 심볼별 lot step (T2-1 전제조건) | 3/3 필수 | Backend | 2h |
| R8-T0-5 | PositionManager 전략-포지션 매핑 (BotService Map 방식) | 3/3 동의 | Backend | 3.5h |

### Backend — Tier 2 (6건)

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T2-1 | 멀티심볼 라우팅 Phase 1: 전략마다 다른 단일 심볼 배정 | 3/3 조건부 | Backend | 8h |
| R8-T2-2 | 전략 warm-up 기간 (StrategyBase emitSignal 게이트) | 3/3 동의 | Backend | 2h |
| R8-T2-3 | 펀딩비 PnL 추적 (라이브 + Paper + 백테스트) | 3/3 조건부 | Backend | 4.5h |
| R8-T2-4 | 코인 재선정 주기 (4시간 고정 간격) | 3/3 조건부 | Backend | 3.5h |
| R8-T2-5 | Paper 모드 전환 경고 강화 (force 파라미터) | 3/3 동의 | Backend | 30m |
| R8-T2-6 | StateRecovery + OrphanOrderCleanup 활성화 (age 필터 포함) | 3/3 동의 | Backend | 1h |

### Frontend — 기존 5건

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R8-T2-8 | StrategyCard toggle 접근성 (button 분리 + aria) | 3/3 동의 | Frontend | 30m |
| R8-T2-9 | MarketRegimeIndicator 데드 코드 삭제 | 3/3 동의 | Frontend | 15m |
| R8-T2-10 | 대시보드 헤더 모바일 반응형 (lg: 브레이크포인트) | 3/3 동의 | Frontend | 45m |
| R8-T2-11 | AccountOverview 모바일 레이아웃 (총자산 분리) | 3/3 동의 | Frontend | 20m |
| R8-T2-12 | RegimeFlowMap 모바일 대응 (grid-cols-1 lg:) | 3/3 동의 | Frontend | 30m |

---

## 아키텍처 결정

### AD-53: InstrumentCache 서비스 신규 생성
- **결정**: `backend/src/services/instrumentCache.js` 신규 생성. `exchangeClient.getInstruments()` 호출하여 심볼별 lotStep/minQty/maxQty/tickSize 캐싱. 24시간 갱신 주기, 캐시 미스 시 보수적 기본값 `'1'` 폴백 + warn 로그.
- **근거**: 하드코딩 `'0.0001'` lot step은 멀티심볼에서 즉시 주문 실패 유발. Bitget 심볼별 lot step이 0.001~10 범위로 차이가 큼.
- **제안자**: Trader + Engineer 동시 제안, UI 동의
- **DI 주입**: exchangeClient → instrumentCache → botService

### AD-54: 전략 warm-up — StrategyBase emitSignal() 게이트
- **결정**: StrategyBase에 `_warmupCandles`, `_receivedCandles`, `_warmedUp` 필드 추가. `emitSignal()` 내부에서 warm-up 미완료 시 시그널 자동 차단. 각 전략 메타데이터에 `warmupCandles` 정의. `activate()` 시 전체 리셋.
- **근거**: 전략 내부에서 시그널을 차단하면 외부(BotService, SignalFilter)에서 warm-up 로직을 알 필요 없음. 캡슐화 원칙에 부합.
- **이견 해소**: Trader의 BotService 카운트 방식 vs Engineer의 StrategyBase 게이트 → 2/3(Engineer+UI) 합의로 StrategyBase 방식 채택.

### AD-55: 멀티심볼 라우팅 Phase 1 — 심볼 배정 규칙
- **결정**:
  1. 전략 메타데이터에 `volatilityPreference: 'high'|'low'|'neutral'` 추가
  2. coinSelector 스코어 기반 최소 매칭 (high→상위, low→하위, neutral→라운드 로빈)
  3. `maxStrategiesPerSymbol = Math.max(3, Math.ceil(strategies.length / symbols.length))`
  4. BTCUSDT는 배정 제외 **하지 않음** (자연 제한만 적용)
  5. `_symbolUpdateInProgress` 플래그로 배정 중 시그널 가드
  6. 포지션 보유 전략의 이전 심볼 매핑 보존 (clear 대신 덮어쓰기)
- **근거**: BTCUSDT 제외는 최고 유동성 심볼의 기회 손실 (Engineer). 최소 매칭은 10줄 추가로 수익 개선 효과 유의미 (Trader).
- **이견 해소**: BTCUSDT 제외 여부 → Engineer 의견 채택 (2/3). 배정 알고리즘 → Trader의 최소 매칭 채택 (합리적 비용 대비 수익).

### AD-56: 코인 재선정 — 4시간 주기 + 열린 포지션 보호
- **결정**:
  1. 4시간 고정 간격 (`setInterval` + `unref()`)
  2. `marketData.unsubscribeSymbols()` 즉시 사용 (이미 구현됨, Phase 2 미룸 X)
  3. 열린 포지션이 있는 심볼은 제거 대상에서 보호 (필수)
  4. 재선정 중 `_running` 가드 삽입 (봇 정지 경합 방어)
  5. 단계적 전환: 새 심볼 구독 → 전략 재배정 → 이전 심볼 해제
  6. `coins_reselected` 이벤트 발행 (Socket.io → FE 토스트)
- **이견 해소**: Trader가 `unsubscribeSymbols` 미지원으로 오인 → Engineer 확인으로 즉시 사용 결정. 재선정 중 시그널 처리 → Phase 1은 자연 해결, Phase 2에서 플래그 방식 추가.

### AD-57: 펀딩비 PnL — 데이터 수집 + Trade 기록
- **결정**:
  1. 라이브: WS account 토픽에서 funding 관련 필드 파싱 시도. 불가 시 fundingDataService 8시간 정산 감지로 대체.
  2. Paper: `FUNDING_UPDATE` 이벤트 수신 → 포지션별 `accumulatedFunding` 누적
  3. 백테스트: 상수 fundingRate(기본 0.01%, configurable) × 8시간 주기 정산
  4. **Trade 레코드에 `fundingPnl` 필드 추가** → 포지션 청산 시 `accumulatedFunding`을 기록
  5. PnL 계산식 반영은 Phase 2 (Phase 1은 데이터 수집만)
- **이견 해소**: Engineer "관측용만" vs Trader "Trade PnL 반영 필수" → 타협: Phase 1에서 데이터 수집(Trade 레코드에 기록), Phase 2에서 PnL 계산식에 반영. Trader의 "서로 다른 관측 레벨" 논리 수용.

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|-----|------|
| BTCUSDT 배정 제외 | 제외 (MarketRegime 전용) | 반대 (최고 유동성 손실) | 제외 찬성 | **배정 허용** (Engineer 논리 채택, 자연 제한) |
| 펀딩비 PnL 수준 | Trade 모델 반영 필수 | 관측용으로만 | 동의 | **Phase 1: 데이터 수집, Phase 2: PnL 반영** |
| warm-up 구현 위치 | BotService 카운트 | StrategyBase 게이트 | Engineer 선호 | **StrategyBase 게이트** (2/3 합의) |
| unsubscribeSymbols | Phase 2 (미지원 오인) | 즉시 사용 (이미 존재) | - | **즉시 사용** |
| 심볼 배정 알고리즘 | 최소 점수 매칭 | 라운드 로빈 기본 | - | **최소 매칭** (10줄 추가, 수익 개선) |
| OrphanCleanup dry-run | 초기 dry-run 필요 | age 필터만 | - | **age 필터(2분) 필수, dry-run은 옵션** |
| 전략 매핑 방식 | last-write-wins | Map 1:1 + warn 로그 | 위임 | **Map 1:1 + 덮어쓰기 warn 로그** |

---

## 구현 순서 (3자 합의)

```
Phase 1 (인프라, BE+FE 병렬):
  BE: R8-T1-1 (InstrumentCache) + R8-T2-2 (warm-up)    [4h]
  FE: R8-T2-8 (접근성) + R8-T2-9 (삭제)                  [45m]

Phase 2 (핵심, BE+FE 병렬):
  BE: R8-T0-5 + R8-T2-1 (전략 매핑 + 멀티심볼)            [11.5h]
  FE: R8-T2-10 + R8-T2-11 + R8-T2-12 (모바일 반응형)      [1h35m]

Phase 3 (보강):
  BE: R8-T2-3 (펀딩비) + R8-T2-4 (코인 재선정)             [8h]

Phase 4 (마무리):
  BE: R8-T2-5 (Paper 경고) + R8-T2-6 (StateRecovery)     [1h15m]
```

**크리티컬 패스**: R8-T1-1 → R8-T2-1 → R8-T2-4
**총 예상**: BE ~25h + FE ~2h20m = ~27h20m

---

## 다음 단계

1. Phase 4 실행 — 위 순서대로 구현
2. 구현 후 FE build + BE test 검증
3. BACKLOG 업데이트 (재활성화 2건 상태 변경)
4. Phase 5~7 (문서 최신화 + 커밋)
