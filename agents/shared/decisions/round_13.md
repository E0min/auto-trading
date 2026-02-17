# Round 13 합의 결정문서

> 생성일: 2026-02-17
> 주제: 전략 모듈화 + 상세 파라미터 튜닝 + UX
> 입력: 3개 제안서 + 3개 교차 리뷰
> 방법: 다수결 + 위험도 가중

## 합의 항목

| ID | 이슈 | 합의 수준 | 담당 | 예상 시간 |
|----|------|----------|------|----------|
| R13-1 | MaTrend 타임프레임 버그 수정 | 3/3 동의 (Tier 0) | BE | 3h |
| R13-2 | 하드코딩 레버리지 제거 | 3/3 동의 (Tier 0) | BE | 2h |
| R13-3 | 서버측 config 검증 (strategyConfigValidator) | 3/3 동의 (Tier 0) | BE | 2.5h |
| R13-4 | updateConfig atomic replace + 이벤트 발행 | 3/3 동의 (Tier 0) | BE | 0.5h |
| R13-5 | paramMeta group + description 추가 | 3/3 동의 (Tier 0) | BE | 3h |
| R13-6 | 전략 docs 메타데이터 18개 작성 | 3/3 동의 (Tier 0) | BE | 4h |
| R13-7 | 통합 전략 정보 API (GET /strategies 확장) | 3/3 동의 (Tier 0) | BE | 2h |
| R13-8 | CustomStrategyStore 비동기 I/O 전환 | 3/3 동의 (Tier 1) | BE | 1.5h |
| R13-9 | Quick Stats Bar (StrategyCard 리디자인) | 3/3 동의 (Tier 0) | FE | 6h |
| R13-10 | 전략 설명 패널 ("개요" 탭) | 3/3 동의 (Tier 0) | FE | 10h |

**Round 13 총 합의: 10건 (BE 8건 ~18.5h, FE 2건 ~16h)**

### Round 14로 이관 (3/3 동의)

| ID | 이슈 | 사유 |
|----|------|------|
| DEF-1 | 전략 프리셋 시스템 | 글로벌 vs 전략별 스키마 합의 필요 |
| DEF-2 | 실시간 전략 상태 대시보드 | 18개 전략 getPublicState() 구현 필요, 보안/성능 검토 필요 |
| DEF-3 | SignalPipeline 추출 리팩토링 | 사용자 체감 변화 0, R13 범위 초과 |
| DEF-4 | 파이프라인 시각화 (TradingPipeline.tsx) | docs 완성 후 진행이 효과적 |
| DEF-5 | 모듈별 설정 패널 아코디언 재구성 | R13의 paramMeta group 완성 후 진행 |
| DEF-6 | 전략 비교 뷰 | 우선순위 낮음 |
| DEF-7 | 파라미터 효과 시각화 | 청산가 계산 정확성 문제, 우선순위 낮음 |
| DEF-8 | 모바일 반응형 | Desktop First, P1~P6 완료 후 |
| DEF-9 | 전략 숨김/표시 기능 | 낮은 우선순위, R14 초반에 간단 구현 가능 |

---

## 아키텍처 결정

### AD-13-1: 전략 설명 메타데이터 키 이름

- **결정**: `docs` (Trader/Engineer 제안 채택, UI의 `explainer` 불채택)
- **근거**: `metadata.docs`가 더 범용적이고 간결. 3명 중 2명이 `docs` 제안, UI도 최종 리뷰에서 `docs` 채택 동의.

### AD-13-2: docs 진입 조건 형식

- **결정**: 배열 형태 (`entry.long: ['조건1', '조건2']`)
- **근거**: Engineer 리뷰에서 "Trader의 배열 형태가 프론트엔드 렌더링에 더 유리" 확인. 체크리스트 UI 자동 생성 가능. 문자열은 파싱 필요.

### AD-13-3: paramMeta 그룹 분류

- **결정**: 4개 그룹 — `signal` / `indicator` / `risk` / `sizing`
- **근거**: Trader 제안 채택. Engineer가 "파라미터 분포상 Trader 분류가 더 균등" 판정. UI의 `entry/exit/risk/execution` 분류보다 실용적.
  - `signal`: 진입/청산 조건 파라미터 (rsiOversold, tpPercent, slPercent 등)
  - `indicator`: 지표 설정 파라미터 (rsiPeriod, bbPeriod, macdFast 등)
  - `risk`: 트레일링/최대손실 파라미터 (stopMultiplier, maxDrawdownPercent 등)
  - `sizing`: 포지션 크기/레버리지 (positionSizePercent, leverage 등)

### AD-13-4: 프리셋 범위

- **결정**: Round 13에서 구현하지 않음. Round 14에서 글로벌 프리셋 우선 구현.
- **근거**: Engineer/UI 모두 "글로벌 우선, 전략별은 R14" 동의. Trader의 aggressive 프리셋 `maxTotalExposurePercent: 50%` 위험성 지적. 스키마 합의 후 안전하게 진행.

### AD-13-5: MaTrend 타임프레임 버그 수정 방식

- **결정**: (A) 타임스탬프 기반 집계
- **근거**: 3/3 동의. 기존 아키텍처 변경 최소화. (B) 멀티 타임프레임 구독은 WebSocket rate limit 위험. `kline.ts`로 UTC 시간 경계 판단하는 유틸리티를 `utils/`에 추가하여 재사용 가능하게 구현.

### AD-13-6: 손실 공식

- **결정**: `예상 최대 손실 = equity * positionSizePercent * SL% * leverage` (마진 기준)
- **근거**: Trader가 Engineer P-7의 공식 오류를 지적. 이 프로젝트에서 positionSizePercent는 마진 기준이므로 leverage를 곱해야 정확. 자금관리 시각화 시 이 공식 적용 필수.

### AD-13-7: docs 최종 스키마

```javascript
docs: {
  summary: 'string',              // 2~3문장 개요
  timeframe: {
    primary: '1m',                 // 수신 분봉
    effective: 'string',           // 실질 참조 기간
    note: 'string',                // 보충 설명 (선택)
  },
  entry: {
    long: ['조건1', '조건2'],      // 배열
    short: ['조건1', '조건2'],
  },
  exit: {
    takeProfit: 'string',
    stopLoss: 'string',
    trailing: 'string | null',
    indicator: 'string | null',
  },
  indicators: ['RSI(14)', ...],    // 사용 지표 목록
  riskReward: {
    typicalRR: 'string',           // '1:2~3'
    maxDrawdownPerTrade: 'string',
    avgHoldingPeriod: 'string',
  },
  strengths: ['string'],           // 최대 3개
  weaknesses: ['string'],          // 최대 3개
  bestFor: 'string',
  warnings: ['string'],
  difficulty: 'beginner | intermediate | advanced',
}
```

---

## 이견 사항 해소

| 주제 | Trader | Engineer | UI | 결정 |
|------|--------|----------|----|------|
| 메타데이터 키 | `docs` | `docs` | `explainer` → `docs` 동의 | `docs` |
| 파라미터 그룹 | signal/indicator/risk/sizing | Trader안 지지 | entry/exit/risk/execution | Trader안 채택 |
| 프리셋 범위 | 글로벌+전략별 | 글로벌 우선 | 전략별 | R14로 이관 |
| P13-8 실시간 상태 | R13 포함 | R14 연기 | R14 연기 | R14 연기 (2/3) |
| P-5 SignalPipeline | Extract Method 충분 | 파이프라인 패턴 | R14 연기 | R14 연기 (Trader 대안 참고) |
| 전략 숨김(P-6) | 조건부 동의 | 3순위 | 동의 | R14 연기 (범위 조절) |
| 손실 공식 | equity*size*SL*leverage | equity*size*SL/leverage | N/A | Trader안 (마진 기준 정확) |
| P13-2 실시간 조건 | R13 포함 | R14 분리 | R14 분리 | R14 분리 (2/3) |

---

## 다음 단계

### 구현 순서 (의존성 기반)

**Phase A — Critical 버그 수정 (5h, 선행 필수)**
1. R13-1: MaTrend 타임프레임 버그 (timestamp 기반 집계 유틸 + 전략 수정)
2. R13-2: 하드코딩 레버리지 제거 (6개 전략 파일 수정)

**Phase B — 백엔드 데이터 계층 (10h, Phase A 완료 후)**
3. R13-3 + R13-4: Config 검증기 + atomic updateConfig
4. R13-5: paramMeta에 group + description 추가 (18개 전략)
5. R13-6: 전략 docs 메타데이터 작성 (18개 전략, Phase A 완료 후 정확한 내용 작성)
6. R13-7: GET /strategies 응답 확장 (docs + runtime + 추가 필드)
7. R13-8: CustomStrategyStore 비동기 I/O (독립, Phase B 내 병렬 가능)

**Phase C — 프론트엔드 UI (16h, Phase B 완료 후)**
8. R13-9: Quick Stats Bar (StrategyCard.tsx, types 확장 포함)
9. R13-10: 전략 설명 패널 (StrategyExplainer.tsx, "개요" 탭)

### 트랙 배정
- **Track A (Backend)**: R13-1 ~ R13-8 (BE 전체)
- **Track C (Frontend)**: R13-9 ~ R13-10 (FE 전체, Phase B 완료 후)
