# Multi-Agent Orchestration System

## Architecture
```
agents/
├── META.md                    ← 이 파일 (오케스트레이션 가이드)
├── trader/                    ← Agent 1: 트레이딩 전문가
│   ├── ROLE.md               ← 역할 정의 + 핵심 지침
│   ├── KNOWLEDGE_INDEX.md    ← 지식 파일 목록 + 요약 (메타 인덱스)
│   ├── knowledge/            ← 참고 자료 (필요할 때만 읽음)
│   └── proposals/            ← 라운드별 제안서
├── engineer/                  ← Agent 2: 시스템 엔지니어
│   ├── ROLE.md
│   ├── KNOWLEDGE_INDEX.md
│   ├── knowledge/
│   └── proposals/
├── ui/                        ← Agent 3: UI/UX 엔지니어
│   ├── ROLE.md
│   ├── KNOWLEDGE_INDEX.md
│   ├── knowledge/
│   └── proposals/
└── shared/                    ← IPC 공유 공간
    ├── rounds/               ← 라운드별 통합 결과
    ├── decisions/            ← 합의된 결정사항
    └── BACKLOG.md            ← 누적 개선과제 목록
```

## Agent Prompt Template

각 에이전트 호출 시 다음 구조로 프롬프트:

```
1. ROLE.md 전문 (핵심 정체성 + 지침)
2. KNOWLEDGE_INDEX.md 전문 (어디에 무슨 정보가 있는지)
3. 이번 라운드 태스크 설명
4. [선택] 다른 에이전트의 이전 제안서 경로 (상호 리뷰용)
```

에이전트는 KNOWLEDGE_INDEX를 읽고, 필요한 파일만 선택적으로 Read.

## Round Cycle

### Phase 1: Propose (병렬)
- 3 에이전트 동시 실행
- 각자 자기 영역 분석 → `proposals/round_N.md` 작성

### Phase 2: Cross-Review (병렬)
- 각 에이전트가 다른 2명의 제안서를 읽고 리뷰
- 자기 관점에서 동의/반대/보완 의견 → `proposals/round_N_review.md`

### Phase 3: Synthesize (오케스트레이터)
- 오케스트레이터가 3개 제안 + 3개 리뷰를 종합
- 합의 결정 → `shared/decisions/round_N.md`
- 미합의 항목 → `shared/BACKLOG.md`에 추가

### Phase 4: Execute (병렬/순차)
- 합의된 결정사항을 실제 코드에 반영
- 각 에이전트가 자기 영역의 코드 수정 담당

### Phase 5: Knowledge Update
- 각 에이전트가 이번 라운드에서 배운 것을 knowledge/에 저장
- KNOWLEDGE_INDEX.md 업데이트

## Knowledge Management Rules

에이전트가 새 정보를 받았을 때:
1. KNOWLEDGE_INDEX.md를 읽어서 기존 파일 목록 확인
2. 관련 기존 파일이 있으면 → 해당 파일을 Read
3. 판단:
   - **중복** → 무시 (인덱스에 "confirmed round N" 메모만 추가)
   - **수정 필요** → 기존 파일 Edit + 인덱스 업데이트
   - **신규** → 새 파일 Write + 인덱스에 추가
4. 인덱스의 각 항목에는: 파일명, 한줄요약, 최종수정라운드, 상태(active/outdated/merged)

## User Directives

사용자가 특정 에이전트에게 지침을 추가할 때:
- `ROLE.md`의 `## User Directives` 섹션에 추가
- 라운드 번호와 함께 기록
- 이전 지침과 충돌 시 최신 우선
