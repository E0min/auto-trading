# React Composition Patterns 리뷰

사용자가 지정한 대상: $ARGUMENTS

## 지시사항

1. 먼저 아래 경로의 전체 가이드를 Read 도구로 읽어라:
   - `C:/Users/USER/.agents/skills/vercel-composition-patterns/AGENTS.md`

2. 사용자가 지정한 대상 파일/패턴($ARGUMENTS)을 Glob으로 찾고 Read로 읽어라.

3. 읽은 코드에 대해 AGENTS.md의 8개 규칙을 우선순위 순서대로 적용하여 리뷰하라:

   **HIGH — Component Architecture**
   - `architecture-avoid-boolean-props` — boolean prop 남발 대신 합성 사용
   - `architecture-compound-components` — 공유 context 기반 복합 컴포넌트

   **MEDIUM — State Management**
   - `state-decouple-implementation` — Provider만 상태 관리 방식을 알아야 함
   - `state-context-interface` — state/actions/meta 제네릭 인터페이스
   - `state-lift-state` — 형제 접근을 위한 상태 끌어올리기

   **MEDIUM — Implementation Patterns**
   - `patterns-explicit-variants` — boolean 모드 대신 명시적 변형 컴포넌트
   - `patterns-children-over-render-props` — renderX props 대신 children 합성

   **MEDIUM — React 19 APIs**
   - `react19-no-forwardref` — forwardRef 제거, use() 사용

4. 필요 시 `C:/Users/USER/.agents/skills/vercel-composition-patterns/rules/` 하위의 개별 규칙 파일도 참조하라.

## 출력 형식

한국어로 출력하라. 발견 사항을 아래 형식으로 정리:

```
## 리뷰 결과: [파일명]

### 🔴 HIGH (반드시 수정)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### 🟡 MEDIUM (권장)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### ✅ 잘 적용된 패턴
- 잘 적용된 합성 패턴이 있으면 언급
```

발견 사항이 없으면 "위반 사항 없음"으로 간략히 마무리하라.
