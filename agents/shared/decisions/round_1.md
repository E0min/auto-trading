# Round 1 합의 결정문서

> 생성일: 2026-02-13
> 입력: 3개 제안서 + 3개 교차 리뷰 (총 ~4,000줄 분석)
> 방법: 다수결 + 위험도 가중. 2+ 에이전트 동의 = 확정, 1 에이전트만 제기 = 교차 검증 후 확정/보류

---

## 최종 합의 항목 (Consensus Items)

### Tier 0 — 실거래 전 필수 수정 (Safety-Critical)

모든 에이전트가 동의했거나 2명이 Critical로 분류하고 나머지 1명이 교차 리뷰에서 동의한 항목.

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| **T0-1** | 기본 전략 이름 미존재 (`MomentumStrategy`/`MeanReversionStrategy`) → 전략 0개로 봇 실행 | 3/3 | Backend | 30분 |
| **T0-2** | Position sizing: percentage를 quantity로 해석 → 주문 크기 10,000x 오류 | 3/3 | Backend | 1일 |
| **T0-3** | Multi-symbol routing: `_symbol` 스칼라 덮어쓰기 → 마지막 심볼만 유효 | 3/3 | Backend | 1일 |
| **T0-4** | `unhandledRejection`/`uncaughtException` 핸들러 누락 → 프로세스 크래시 시 포지션 방치 | 3/3 | Backend | 2시간 |
| **T0-5** | `orderManager.submitOrder()` 동시성 제어 없음 → double-spend 위험 | 3/3 | Backend | 3시간 |
| **T0-6** | `ExposureGuard` equity=0 시 division by zero | 3/3 | Backend | 1시간 |
| **T0-7** | Emergency Stop 확인 다이얼로그 없음 → 실수로 전포지션 청산 | 3/3 | Frontend | 1시간 |
| **T0-8** | Risk 이벤트(서킷 브레이커/드로다운) UI에 미표시 | 3/3 | Frontend | 4시간 |
| **T0-9** | 실거래/가상거래 모드 시각적 구분 부족 | 3/3 | Frontend | 2시간 |

### Tier 1 — 1주 내 수정 (Reliability)

2명 이상이 HIGH 이상으로 분류한 항목.

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| **T1-1** | Backtest: IndicatorCache 미제공 → 14/18 전략 크래시 | 2/3 (T+E) | Backend | 4시간 |
| **T1-2** | Backtest: `_notifyFill()` action 필드 누락 → 포지션 추적 불가 | 2/3 (T+E) | Backend | 2시간 |
| **T1-3** | Graceful shutdown 순서 문제 → DB 기록 누락 가능 | 2/3 (E+UI) | Backend | 3시간 |
| **T1-4** | PaperEngine 리스너 누적 → paper/live 전환 시 fill 중복 처리 | 2/3 (E+T) | Backend | 2시간 |
| **T1-5** | `SignalFilter.updatePositionCount()` 호출 안됨 → maxConcurrent 필터 비활성 | 2/3 (E+T) | Backend | 1시간 |
| **T1-6** | Sharpe ratio ~10x 과대평가 (캔들간 수익률을 일간으로 취급) | 2/3 (T+UI) | Backend | 1시간 |
| **T1-7** | Dashboard 레이아웃 정보 우선순위 역전 → 중요 정보 3~4 스크롤 아래 | 2/3 (T+UI) | Frontend | 1일 |
| **T1-8** | PositionsTable에 수동 청산 버튼 없음 → 개별 포지션 개입 불가 | 2/3 (T+UI) | Frontend | 4시간 |
| **T1-9** | Socket.io 싱글턴 생명주기 → React StrictMode에서 소켓 파괴 | 2/3 (UI+E) | Frontend | 2시간 |
| **T1-10** | Error Boundary 부재 → 네트워크 에러 시 앱 크래시 | 2/3 (UI+E) | Frontend | 3시간 |
| **T1-11** | DrawdownMonitor 수동 리셋 없음 → halt 후 재시작 불가 | 2/3 (T+UI) | Backend | 2시간 |

### Tier 2 — 2주 내 수정 (Quality)

1~2명이 제기하고 교차 리뷰에서 동의한 항목.

| ID | 이슈 | 합의 수준 | 담당 |
|----|------|----------|------|
| **T2-1** | RSI Wilder smoothing 미적용 → 6개 전략 시그널 품질 저하 | 1/3 (T) → E 조건부 동의 | Backend |
| **T2-2** | Confidence-based signal filtering 없음 | 1/3 (T) → E 조건부 동의 | Backend |
| **T2-3** | Backtest default position size 95% → 비현실적 | 2/3 (T+UI) | Backend |
| **T2-4** | FundingRateStrategy 데이터 소스 없음 → 전략 비기능 | 1/3 (T) → E 동의 | Backend |
| **T2-5** | GridStrategy equity 미주입 → qty 항상 0 | 1/3 (T) → E 동의 | Backend |
| **T2-6** | `useSocket` 모놀리식 → 모든 소켓 이벤트에 전체 리렌더링 | 2/3 (UI+E) | Frontend |
| **T2-7** | API rate limiting 미적용 | 1/3 (E) → T 조건부 동의 | Backend |
| **T2-8** | SignalFeed에서 rejectReason 미표시 | 2/3 (UI+T) | Frontend |
| **T2-9** | CircuitBreaker `rapidLosses` 배열 무한 성장 | 2/3 (E+T) | Backend |
| **T2-10** | Drawdown 시각화 차트 (신규) | 2/3 (UI+T) | Frontend |
| **T2-11** | Risk Gauge 대시보드 (신규) | 2/3 (UI+T) | Frontend |
| **T2-12** | 적응형 폴링 (봇 상태에 따른 간격 조절) | 2/3 (UI+T) | Frontend |

### Tier 3 — 장기 (Enhancement)

| ID | 이슈 | 합의 수준 |
|----|------|----------|
| **T3-1** | 테스트 프레임워크 구축 | 3/3 |
| **T3-2** | API 인증/인가 (JWT or API key) | 2/3 (E+UI) |
| **T3-3** | Exchange-side stop loss 주문 | 1/3 (T) |
| **T3-4** | decimal.js 마이그레이션 | 1/3 (E) → T 낮은 우선순위 동의 |
| **T3-5** | Prometheus 메트릭/모니터링 | 1/3 (E) |
| **T3-6** | 성과 귀인 대시보드 (by-strategy, by-symbol) | 1/3 (T) |
| **T3-7** | 거래 추적 (traceId 기반 시그널→주문→체결 추적) | 1/3 (E) |

---

## 구현 전략 (Implementation Strategy)

### 병렬 트랙 (Engineer 제안, Trader+UI 동의)

```
Track A — Backend Critical (3~5일)
  T0-1 → T0-6 → T0-4 → T0-3 → T0-2 → T0-5 → T1-3
  (기본 전략 → equity guard → crash handler → multi-symbol → sizing → mutex → shutdown)

Track B — Backtest Critical (2~3일)
  T1-1 → T1-2 → T1-6 → T2-3
  (IndicatorCache → fill action → Sharpe → default sizing)

Track C — Frontend Critical (2~3일)
  T0-7 → T0-8 → T0-9 → T1-10 → T1-9 → T1-7
  (Emergency dialog → Risk alerts → Mode indicator → Error boundary → Socket → Layout)
```

### 의존성 DAG (핵심)

```
T0-1 (전략이름) ────┐
                      ├─→ T0-3 (multi-symbol) ──→ T0-2 (position sizing) ──→ T0-5 (mutex)
T0-6 (equity guard) ─┘
T0-4 (crash handler) ──→ T1-3 (shutdown ordering)
T1-1 (backtest cache) ──→ T1-2 (fill action) ──→ T1-6 (Sharpe fix)
T0-7 (emergency dialog) → 독립
T0-8 (risk events UI) → 독립 (백엔드 RiskEvent 모델 추가 필요)
T1-9 (socket lifecycle) → T2-6 (useSocket 분리)
```

---

## 핵심 아키텍처 결정 (Key Architecture Decisions)

### AD-1: Multi-symbol 해결 방식
- **결정: Set 기반 심볼 관리 (Engineer 제안)** — 전략당 1개 인스턴스, 내부에 `_symbols: Set` 유지
- Trader의 "인스턴스 per symbol" 방식은 O(전략×심볼) 메모리/CPU 문제
- Engineer의 Set 방식이 메모리 효율적이면서 라우팅 정확

### AD-2: Position sizing 해결 위치
- **결정: `botService.js`에서 해결** (signal filter 이후, orderManager 이전)
- riskEngine은 절대 수량만 받아야 함 (Engineer 동의)
- 거래소 lot precision 반올림 포함 (Engineer 추가)

### AD-3: Crash handler 동작
- **결정: unhandledRejection → 로그만 + risk alert, uncaughtException → graceful shutdown**
- Trader의 "exchange-side SL 배치 후 종료" 제안은 장기 과제(T3-3)로 분류
- Engineer의 "unhandledRejection에서는 종료하지 않음" 원칙 채택

### AD-4: Risk 이벤트 저장
- **결정: MongoDB RiskEvent 모델 추가** (Engineer 제안)
- 실시간 Socket.io + REST API 조회 모두 지원
- 페이지 새로고침 시에도 최근 이벤트 조회 가능

### AD-5: RSI 구현 변경 시 전략 임계값
- **결정: Wilder RSI 적용 시 `smoothing` 파라미터 추가** (backward compat)
- 기존 전략은 기본 'wilder'로 전환하되, 임계값 재튜닝은 별도 패스 (Engineer 제안)

### AD-6: DrawdownMonitor 리셋
- **결정: 수동 리셋만 허용** (Engineer 제안, Trader 동의)
- 자동 복구는 위험 (손실 확대 가능)
- 인증된 API 엔드포인트로만 리셋 가능 + 감사 로그

---

## 이견 사항 (Disagreements Resolved)

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| C-5 mathUtils 정밀도 | LOW | LONG-TERM | -- | **Tier 3** (현재 규모에서 안전) |
| 모바일 반응형 | LOW | -- | H7 | **Tier 3** (트레이딩은 데스크톱 주) |
| Radar chart vs Bar chart | -- | -- | V4 | **Bar chart** (Trader: 레이더는 읽기 어려움) |
| Auto-recover drawdown | 수동 리셋 | 수동만 + 감사 | 리셋 버튼 | **수동 only + API + 감사 로그** |
| ExposureGuard C-3 심각도 | HIGH (CRITICAL 아님) | CRITICAL | CRITICAL | **CRITICAL** (fix trivial, risk high) |
| API 인증 우선순위 | LOW (localhost) | HIGH | P2 | **Tier 3** (localhost 전제, 네트워크 노출 시 즉시 필요) |

---

## 프론트엔드 변경 요약 (UI Agent 종합)

### 신규 컴포넌트
| 컴포넌트 | Tier | 사유 |
|----------|------|------|
| `RiskAlertBanner` | T0 | Risk 이벤트 실시간 표시 |
| `ConnectionStatusBanner` | T1 | 서버 연결 상태/재연결 |
| `app/error.tsx` | T1 | Next.js Error Boundary |
| `DrawdownChart` | T2 | 드로다운 시각화 |

### 기존 컴포넌트 수정
| 컴포넌트 | Tier | 변경 내용 |
|----------|------|-----------|
| `BotControlPanel.tsx` | T0 | Emergency Stop ConfirmDialog; 전략 0개 경고 |
| `page.tsx` | T0+T1 | 실거래 시각 경고; 레이아웃 재설계 |
| `RiskStatusPanel.tsx` | T0 | risk 이벤트 렌더링; CB/DD 리셋 버튼 |
| `PositionsTable.tsx` | T1 | 수동 청산 버튼; SL/TP 표시 |
| `SignalFeed.tsx` | T2 | rejectReason 표시; confidence 강화 |
| `socket.ts` | T1 | ref-counted lifecycle |
| `useSocket.ts` | T2 | 목적별 분리 (tickers, signals, risk, regime) |
| `api-client.ts` | T1 | 네트워크 에러 래핑; 429 처리 |
| `types/index.ts` | T0 | StrategyInfo.symbols[]; Signal.resolvedQty 등 |

### 타입 변경
```typescript
// Tier 0 필수 타입 변경
interface StrategyInfo {
  symbols: string[];     // 기존 symbol: string → 배열
}

interface Signal {
  positionSizePercent?: string;  // 추가
  resolvedQty?: string;          // 추가
}

interface StrategyListItem {
  riskLevel?: 'low' | 'medium' | 'high';  // 이미 추가됨
}
```

---

## 다음 단계 (Next Steps)

1. **이 문서를 기반으로 BACKLOG.md 업데이트** — Tier 0~3 항목을 백로그에 반영
2. **Sprint 1 착수**: Track A (T0-1~T0-6), Track B (T1-1~T1-2), Track C (T0-7~T0-9) 동시 진행
3. **라운드 2 준비**: Sprint 1 완료 후 각 에이전트가 자기 담당 수정사항 구현 결과 검토
4. **지식 업데이트**: 각 에이전트의 KNOWLEDGE_INDEX.md에 Round 1 결정사항 반영

---

*이 문서는 3명의 전문 에이전트(Trader, Engineer, UI/UX)의 독립 분석과 교차 리뷰를 기반으로 합성되었다. 총 47개 이슈가 식별되었으며, 9개 Tier 0(필수), 11개 Tier 1(1주), 12개 Tier 2(2주), 7개 Tier 3(장기)으로 분류되었다.*
