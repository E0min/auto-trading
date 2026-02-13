---
description: 마지막 체크포인트에서 작업 재개 — 다음 할 일 표시
argument-hint: [특정 트랙: a|b|c (선택)]
---

마지막 체크포인트를 로드하고 재개할 작업을 안내하라.

## 수행 단계

### 1. 체크포인트 로드
- `agents/shared/checkpoint.md`를 읽는다.
- 파일이 없으면: BACKLOG.md를 직접 읽어 현재 상태를 파악하고 "체크포인트 없음 — BACKLOG에서 직접 로드" 안내.

### 2. 현재 상태 확인
- `git worktree list`로 활성 워크트리 확인
- `git status`로 미커밋 변경 확인
- `git log --oneline -3`으로 최근 작업 확인

### 3. BACKLOG 최신 상태 대조
- `agents/shared/BACKLOG.md`를 읽어 체크포인트 이후 변경된 항목 확인
- 상태가 변한 항목이 있으면 알림

### 4. 의존성 분석
- `agents/shared/decisions/round_1.md`의 의존성 DAG 참조
- done 항목이 unblock하는 다음 항목 계산
- $ARGUMENTS 로 특정 트랙(a/b/c)이 지정되면 해당 트랙만 필터

### 5. 출력 형식

```
=== 작업 재개 ===
마지막 체크포인트: {날짜시간}
전체 진행률: {done}/{total} ({퍼센트}%)

--- Track A (Backend) ---
  완료: T0-1, T0-6
  진행중: T0-3 (multi-symbol routing)
  다음: T0-2 → T0-3 완료 시 unblock

--- Track B (Backtest) ---
  완료: (없음)
  즉시 시작 가능: T1-1 (IndicatorCache)

--- Track C (Frontend) ---
  완료: T0-7
  진행중: T0-8 (risk events UI)
  다음: T0-9 → 독립, 즉시 시작 가능

--- 추천 다음 액션 ---
  1. [Track A] T0-2: Position sizing pipeline — T0-3 완료 후 시작
  2. [Track C] T0-9: 실거래/가상 시각 구분 — 즉시 시작 가능
  3. [Track B] T1-1: Backtest IndicatorCache — 즉시 시작 가능

미커밋 변경: {n}개 파일
워크트리: {목록}
```

### 6. 트랙 지정 시
- `$ARGUMENTS`가 `a`, `b`, `c` 중 하나면 해당 트랙의 상세 정보만 표시
- 해당 트랙의 다음 작업에 대해 구체적 구현 파일 경로와 변경 범위도 함께 안내
- 관련 에이전트의 proposals (round_1.md, round_1_review.md)에서 해당 작업의 구체적 구현 가이드 발췌

### 7. 워크트리 미생성 시
- 워크트리가 아직 없으면 생성 명령어 안내:
```
git branch track-a && git worktree add ../auto-trading-track-a track-a
git branch track-b && git worktree add ../auto-trading-track-b track-b
git branch track-c && git worktree add ../auto-trading-track-c track-c
```
