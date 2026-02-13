# Orchestrator Guide — 라운드 실행 방법

## Quick Start

사용자가 오케스트레이터(Claude Code 메인 세션)에게 말하면 됨:

### 1. 제안 라운드 실행
```
"라운드 2 제안 실행해줘"
```

오케스트레이터는 3개 에이전트를 **병렬** Task로 띄움. 각 에이전트 프롬프트:
```
[ROLE.md 전문] + [KNOWLEDGE_INDEX.md 전문] + [이번 라운드 태스크]
```

### 2. 상호 리뷰 실행
```
"라운드 2 리뷰 실행해줘"
```

각 에이전트가 다른 2명의 제안서를 읽고 자기 관점에서 코멘트.

### 3. 합의 도출
```
"라운드 2 합의 정리해줘"
```

오케스트레이터가 3개 제안 + 3개 리뷰를 읽고 합의/미합의 분류.

### 4. 코드 실행
```
"라운드 2 합의된 항목 중 [ID]번 구현해줘"
```

### 5. 특정 에이전트에게 지침 추가
```
"트레이더 에이전트에게: 펀딩비 전략을 더 공격적으로 만들어"
```

→ 오케스트레이터가 `agents/trader/ROLE.md`의 User Directives에 추가

---

## Agent Prompt Templates

### Propose Phase
```
You are [Role Name].

## Your Role
[ROLE.md 전문]

## Your Knowledge
[KNOWLEDGE_INDEX.md 전문]

## Task: Round N Proposal
이전 라운드 결정사항: [shared/decisions/round_N-1.md 경로 or "첫 라운드"]
BACKLOG: [shared/BACKLOG.md 경로]

분석 후 제안서를 작성하세요: [proposals/round_N.md]

새로운 발견이 있으면 knowledge/ 파일을 생성/수정하고 KNOWLEDGE_INDEX.md를 업데이트하세요.
중복 정보는 추가하지 마세요.
```

### Review Phase
```
You are [Role Name].

## Your Role
[ROLE.md 전문]

## Task: Review Round N
다른 에이전트 제안서를 읽고 당신의 관점에서 리뷰하세요:
- [다른 에이전트1 proposals/round_N.md 경로]
- [다른 에이전트2 proposals/round_N.md 경로]

리뷰를 작성하세요: [proposals/round_N_review.md]

각 제안에 대해:
- ✅ 동의 (사유)
- ⚠️ 조건부 동의 (보완 필요사항)
- ❌ 반대 (사유 + 대안)
```

---

## User Directive Injection

사용자가 "트레이더에게: XXX" 라고 하면:

1. `agents/trader/ROLE.md` 열기
2. `## User Directives` 섹션 찾기
3. `[Round N] XXX` 형식으로 추가
4. 다음 라운드에서 해당 에이전트가 이 지침을 따름

---

## Knowledge Update Flow

에이전트가 새 정보를 수신하면:

```
1. Read KNOWLEDGE_INDEX.md
2. 기존 항목에 관련 파일 있는지 확인
   ├─ YES → Read 해당 파일
   │        ├─ 완전히 동일 → 무시 (인덱스에 confirmed 표시)
   │        ├─ 부분 수정 필요 → Edit 파일 + Edit 인덱스
   │        └─ 대폭 변경 → Write 새 파일 + 기존 outdated 처리
   └─ NO → Write 새 파일 + 인덱스에 행 추가
```
