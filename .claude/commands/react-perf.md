# React/Next.js 성능 최적화 리뷰

사용자가 지정한 대상: $ARGUMENTS

## 지시사항

1. 먼저 아래 경로의 전체 가이드를 Read 도구로 읽어라:
   - `C:/Users/USER/.agents/skills/vercel-react-best-practices/AGENTS.md`

2. 사용자가 지정한 대상 파일/패턴($ARGUMENTS)을 Glob으로 찾고 Read로 읽어라.

3. 읽은 코드에 대해 AGENTS.md의 8개 카테고리 57개 규칙을 우선순위 순서대로 적용하여 리뷰하라:

   **CRITICAL — Eliminating Waterfalls** (`async-*`)
   - defer-await, parallel, dependencies, api-routes, suspense-boundaries

   **CRITICAL — Bundle Size Optimization** (`bundle-*`)
   - barrel-imports, dynamic-imports, defer-third-party, conditional, preload

   **HIGH — Server-Side Performance** (`server-*`)
   - auth-actions, cache-react, cache-lru, dedup-props, serialization, parallel-fetching, after-nonblocking

   **MEDIUM-HIGH — Client-Side Data Fetching** (`client-*`)
   - swr-dedup, event-listeners, passive-event-listeners, localstorage-schema

   **MEDIUM — Re-render Optimization** (`rerender-*`)
   - defer-reads, memo, memo-with-default-value, dependencies, derived-state, derived-state-no-effect, functional-setstate, lazy-state-init, simple-expression-in-memo, move-effect-to-event, transitions, use-ref-transient-values

   **MEDIUM — Rendering Performance** (`rendering-*`)
   - animate-svg-wrapper, content-visibility, hoist-jsx, svg-precision, hydration-no-flicker, hydration-suppress-warning, activity, conditional-render, usetransition-loading

   **LOW-MEDIUM — JavaScript Performance** (`js-*`)
   - batch-dom-css, index-maps, cache-property-access, cache-function-results, cache-storage, combine-iterations, length-check-first, early-exit, hoist-regexp, min-max-loop, set-map-lookups, tosorted-immutable

   **LOW — Advanced Patterns** (`advanced-*`)
   - event-handler-refs, init-once, use-latest

4. 필요 시 `C:/Users/USER/.agents/skills/vercel-react-best-practices/rules/` 하위의 개별 규칙 파일도 참조하라.

## 출력 형식

한국어로 출력하라. 발견 사항을 아래 형식으로 정리:

```
## 성능 리뷰 결과: [파일명]

### 🔴 CRITICAL (즉시 수정)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### 🟠 HIGH (우선 수정)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### 🟡 MEDIUM (권장)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### 🟢 LOW (개선 가능)
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### ✅ 잘 적용된 패턴
- 잘 적용된 성능 패턴이 있으면 언급
```

발견 사항이 없으면 "위반 사항 없음"으로 간략히 마무리하라.
CRITICAL/HIGH 항목이 있으면 구체적인 코드 수정 예시도 함께 제시하라.
