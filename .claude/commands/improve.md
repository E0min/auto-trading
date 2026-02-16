---
description: 에이전트 Knowledge Index 최신화 — 스프린트 히스토리 기반 지식 갱신
argument-hint: [특정 에이전트 (trader/engineer/ui) 또는 비우면 전체]
---

각 에이전트(Trader, Engineer, UI/UX)의 `KNOWLEDGE_INDEX.md`를 분석하고, 누락된 스프린트 라운드 정보와 누적 인사이트를 추가하라.

## 수행 단계

### 1. 현재 상태 수집

1. 모든 결정문서 스캔: `agents/shared/decisions/round_*.md`를 Glob으로 찾아 전체 라운드 번호 목록 수집
2. 각 에이전트의 proposals 스캔: `agents/{trader,engineer,ui}/proposals/round_*.md`를 Glob으로 찾아 존재하는 파일 목록 수집
3. 각 에이전트의 `KNOWLEDGE_INDEX.md`를 Read하여 현재 등록된 항목 파악

### 2. 갭 분석

각 에이전트에 대해:
1. 존재하는 proposals/round_N.md 와 round_N_review.md 중 KNOWLEDGE_INDEX에 **미등록**된 것을 식별
2. 공유 결정문서(round_N.md) 중 KNOWLEDGE_INDEX에 **미등록**된 것을 식별
3. 솔로 분석 파일(solo_*.md)이 있으면 마찬가지로 체크

### 3. 누락 항목 등록

각 에이전트의 KNOWLEDGE_INDEX.md를 Edit하여:

1. **Index 테이블**에 누락된 라운드의 proposals, reviews, decisions 행을 추가
   - 형식: `| proposals/round_N.md | {한줄 요약} | Round N | active |`
   - 한줄 요약은 해당 파일을 **직접 Read**하여 핵심 내용 파악 후 작성
2. 이미 구현 완료된 라운드의 결정문서에는 `— **구현 완료**` 표기 추가
3. 상태가 변한 항목이 있으면 `outdated`로 변경하거나 비고 추가

### 4. Key Findings 업데이트 (선택)

KNOWLEDGE_INDEX.md에 `Round 1 Key Findings Summary`만 있고 후속 라운드의 핵심 발견사항이 없으면:

각 라운드의 제안서와 결정문서에서 **해당 에이전트 영역**의 핵심 발견사항을 추출하여 섹션 추가:

```markdown
## Round {N} Key Findings Summary
- **항목1**: 설명
- **항목2**: 설명
```

**단, 모든 라운드를 다 추가하지 말고 가장 중요한 라운드 2~3개만 선별하라.**
기준: 아키텍처 결정(AD-*)이 많거나, 해당 에이전트의 전문 영역과 직결되는 변경이 큰 라운드.

### 5. 크로스 레퍼런스 인사이트

7라운드에 걸쳐 반복되거나 진화한 패턴이 있으면 `## Accumulated Insights` 섹션을 추가:

```markdown
## Accumulated Insights
- **패턴1**: R1에서 발견 → R3에서 해결 → R5에서 강화. 현재 상태: {요약}
- **패턴2**: ...
```

이 섹션은 에이전트별로 다르게 작성:
- **Trader**: 전략 품질, 리스크 관리, 수익성 관련 인사이트
- **Engineer**: 시스템 안정성, 에러 핸들링, 성능 관련 인사이트
- **UI/UX**: UX 패턴, 컴포넌트 구조, 실시간 데이터 표시 관련 인사이트

### 6. 에이전트 필터링

`$ARGUMENTS`가 `trader`, `engineer`, `ui` 중 하나이면 해당 에이전트만 처리.
비어있으면 3개 에이전트 전체 처리.

### 7. 완료 보고

```
=== Knowledge Improve 완료 ===

Trader KNOWLEDGE_INDEX:
  - 추가: {추가된 항목 수}건 (Round {목록})
  - Key Findings: {추가된 섹션 수}개
  - Insights: {추가 여부}

Engineer KNOWLEDGE_INDEX:
  - 추가: {추가된 항목 수}건 (Round {목록})
  - Key Findings: {추가된 섹션 수}개
  - Insights: {추가 여부}

UI KNOWLEDGE_INDEX:
  - 추가: {추가된 항목 수}건 (Round {목록})
  - Key Findings: {추가된 섹션 수}개
  - Insights: {추가 여부}
```

## 주의사항

- KNOWLEDGE_INDEX.md의 기존 구조와 형식을 유지하라 (테이블 컬럼, 상태 값 등)
- 한줄 요약은 파일을 직접 Read하여 작성 — 추측하지 않는다
- `Knowledge Management Rules` 섹션은 수정하지 않는다
- 기존 항목을 삭제하지 않는다 (상태 변경만 허용)
- 각 에이전트의 전문 영역에 맞는 관점으로 요약을 작성하라
