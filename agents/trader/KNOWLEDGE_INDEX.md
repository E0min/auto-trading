# Trader Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 전략 18개 전수조사, 리스크엔진 감사, 백테스트 신뢰도 분석 | Round 1 | active |
| `proposals/round_1_review.md` | Engineer+UI 제안서 교차 리뷰, 3-Agent 공통 이슈 분류, 스프린트 우선순위 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-1~T0-9 구현 제안 (포지션 사이징, 심볼 라우팅, 기본전략) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |

## Round 1 Key Findings Summary
- **C1**: multi-symbol 라우팅 버그 — `_symbol` 단일 값이라 마지막 심볼만 유효
- **C2**: ExposureGuard가 qty를 percentage로 해석 — 주문 크기 10,000x 오류
- **C3**: 백테스트 fill에 `action` 누락 — 전략 포지션 추적 불가
- **C4**: 백테스트에 IndicatorCache 미제공 — 14/18 전략 크래시
- **C5**: 기본 전략명이 실존하지 않는 이름 — 전략 0개로 봇 실행
- 14/18 전략이 IndicatorCache에 의존하지만 backtest에서 미제공
- Sharpe ratio가 ~10x 과대평가 (일간 아닌 캔들간 수익률 사용)
- FundingRateStrategy는 데이터 소스 없어 신호 불가
- GridStrategy의 equity 주입 버그 — qty 항상 0

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
