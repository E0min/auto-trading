# Web Interface Guidelines UI 리뷰

사용자가 지정한 대상: $ARGUMENTS

## 지시사항

1. 아래 URL에서 최신 Web Interface Guidelines를 WebFetch 도구로 가져와라:
   ```
   https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
   ```

2. 사용자가 지정한 대상 파일/패턴($ARGUMENTS)을 Glob으로 찾고 Read로 읽어라.

3. 가져온 guidelines의 모든 규칙을 대상 코드에 적용하여 리뷰하라.
   주요 검토 영역:
   - 접근성 (Accessibility / a11y)
   - 키보드 내비게이션
   - 반응형 디자인
   - 색상 대비 및 시각적 계층
   - 인터랙션 패턴 (hover, focus, active states)
   - 폼 UX (validation, error messages, labels)
   - 로딩/에러 상태 처리
   - 애니메이션 및 모션
   - 타이포그래피 및 간격

## 출력 형식

한국어로 출력하라. 발견 사항을 아래 형식으로 정리:

```
## UI 리뷰 결과: [파일명]

### 🔴 필수 수정
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### 🟡 권장 개선
- `파일:줄번호` — **규칙명** — 설명 및 수정 방안

### ✅ 잘 적용된 패턴
- 잘 적용된 UI 패턴이 있으면 언급
```

발견 사항이 없으면 "위반 사항 없음"으로 간략히 마무리하라.
필수 수정 항목이 있으면 구체적인 코드 수정 예시도 함께 제시하라.
