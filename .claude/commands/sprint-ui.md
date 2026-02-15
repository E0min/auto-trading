---
description: UI/UX 에이전트 독립 분석 — 대시보드/시각화/프론트엔드 관점
argument-hint: [분석 주제, 예: "대시보드 UX 개선" | "모바일 반응형 점검" | "T1-8 분석"]
---

Senior UI/UX Engineer 에이전트를 소환하여 **$ARGUMENTS** 주제로 독립 분석을 실행하라.

---

## 0. 사전 준비

### 분석 번호 결정
1. `agents/ui/proposals/` 디렉토리를 Glob으로 스캔하여 기존 `solo_*.md` 파일 목록 확인
2. 가장 높은 번호 + 1 = **이번 분석 번호 (S)**
3. 번호가 없으면 S = 1

### 컨텍스트 수집
1. `agents/ui/KNOWLEDGE_INDEX.md` 읽기
2. `agents/shared/BACKLOG.md` 읽기
3. `agents/shared/decisions/` 최신 결정문서 읽기
4. `git log --oneline -5`로 최근 커밋 확인

---

## 1. UI/UX 에이전트 실행

Task 서브에이전트 1개를 `subagent_type: "general-purpose"`로 실행하라.

### 프롬프트
```
You are Senior UI/UX Engineer.

## Your Role
{agents/ui/ROLE.md 전문}

## Your Knowledge Index
{agents/ui/KNOWLEDGE_INDEX.md 전문}

## Task: Solo Analysis S{S} — "{$ARGUMENTS}"

### Context
- 최신 결정문서: {agents/shared/decisions/ 최신 파일 내용 요약}
- 현재 BACKLOG: {agents/shared/BACKLOG.md 내용}
- 최근 커밋: {git log 결과}

### Instructions
1. 주제 "{$ARGUMENTS}"에 대해 당신의 전문 영역(UX, 대시보드, 시각화, 프론트엔드)에서 **심층 분석**하라
2. 관련 소스 코드를 직접 Read하여 현재 상태를 정확히 파악하라
3. 코드 레벨의 구체적 근거를 포함하라 (파일 경로, 라인 번호, 코드 스니펫)
4. 발견한 문제점과 개선안을 구분하여 제시하라
5. 각 제안에 우선순위(Critical/High/Medium/Low), 구현 난이도, UX 영향도를 명시하라
6. 분석 결과를 `agents/ui/proposals/solo_{S}.md`에 Write하라

### Output Format
`agents/ui/proposals/solo_{S}.md`에 마크다운으로:
- ## 분석 주제 및 범위
- ## 현재 상태 요약 (스크린샷/코드 레벨)
- ## 발견 사항 (코드 근거 포함, 심각도별 정렬)
  - 각 항목: 컴포넌트/파일:라인, 문제 설명, 사용자 영향
- ## 개선 제안 (우선순위, 난이도, UX 영향도)
  - 각 항목: 구체적 변경 내용, 레이아웃/컴포넌트 설계
- ## BACKLOG 추가 후보 (신규 이슈가 있으면)
- ## Trader/Engineer에게 전달 사항 (API 변경/데이터 요구 등)
```

---

## 2. 결과 보고

에이전트 완료 후 사용자에게 보고:

```
=== UI/UX Solo Analysis S{S} 완료 ===
주제: {$ARGUMENTS}
결과: agents/ui/proposals/solo_{S}.md

발견 사항 요약:
  - Critical: {n}건
  - High: {n}건
  - Medium: {n}건
  - Low: {n}건

BACKLOG 추가 후보: {n}건

다음 액션:
  - /sprint-trader {주제} — Trader 관점 독립 분석
  - /sprint-engineer {주제} — Engineer 관점 독립 분석
  - /sprint {주제} — 3 에이전트 풀 스프린트
```

---

## 3. KNOWLEDGE_INDEX 업데이트

`agents/ui/KNOWLEDGE_INDEX.md`의 Index 테이블에 새 행을 추가:
```
| `proposals/solo_{S}.md` | {1줄 요약} | Solo S{S} | active |
```
