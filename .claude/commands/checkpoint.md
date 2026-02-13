---
description: 현재 스프린트 진행 상태를 체크포인트로 저장
argument-hint: [메모 (선택)]
---

현재 프로젝트의 스프린트 진행 상태를 체크포인트로 저장하라.

## 수집할 정보

1. **Git 상태**: 현재 브랜치, 최근 커밋 3개, 수정된 파일 수
2. **워크트리 상태**: `git worktree list` 실행하여 활성 워크트리 목록
3. **BACKLOG 파싱**: `agents/shared/BACKLOG.md`를 읽고 각 항목의 상태(agreed/in_progress/done) 집계
   - Tier별 진행률: done/total
   - in_progress 항목 목록
   - 다음 실행 가능한 항목 (의존성 충족된 항목)
4. **의존성 DAG**: `agents/shared/decisions/round_1.md`의 의존성 정보 참조하여 블로킹 관계 파악
5. **사용자 메모**: $ARGUMENTS 가 있으면 메모로 포함

## 저장 형식

`agents/shared/checkpoint.md`에 아래 형식으로 저장 (기존 내용 덮어쓰기):

```markdown
# Checkpoint — {현재 날짜시간}

## Git State
- Branch: {브랜치명}
- Last commit: {해시} {메시지}
- Modified files: {수}개
- Worktrees: {워크트리 목록 또는 "없음"}

## Sprint Progress
### Tier 0 (Safety-Critical)
- 완료: {n}/{total}
- 진행중: {항목 ID 목록}
- 대기: {항목 ID 목록}

### Tier 1 (Reliability)
- 완료: {n}/{total}
- 진행중: {항목 ID 목록}
- 대기: {항목 ID 목록}

### Tier 2 (Quality)
- 완료: {n}/{total}

### Tier 3 (Enhancement)
- 완료: {n}/{total}

## In-Progress Details
{진행중인 각 항목의 ID, 제목, 담당 트랙, 추정 진행률}

## Blocked Tasks
{의존성 때문에 시작할 수 없는 항목과 블로킹 원인}

## Next Available Actions
{의존성이 충족되어 즉시 시작 가능한 항목 목록}

## Notes
{사용자 메모 또는 "없음"}
```

저장 후 체크포인트 요약을 사용자에게 간결하게 출력하라.
