# Engineer Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 13개 서비스 프로덕션 준비도 감사, 예외처리 매트릭스, 동시성 분석 | Round 1 | active |
| `proposals/round_1_review.md` | Trader+UI 제안서 교차 리뷰, 의존성 DAG, 병렬 트랙 구현 계획 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-4~T0-6 구현 제안 (크래시핸들러, mutex, equity 방어) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |
| `proposals/round_3.md` | T1-1~T1-11 구현 제안 (graceful shutdown, 리스너 누적, SignalFilter 등) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Trader+UI 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |

## Round 1 Key Findings Summary
- **C-1**: unhandledRejection/uncaughtException 핸들러 누락 — 프로세스 즉시 종료 위험
- **C-2**: orderManager.submitOrder() 동시성 제어 없음 — double-spend 위험
- **C-3**: ExposureGuard equity=0 시 division by zero
- **C-4**: graceful shutdown 순서 문제 — DB 쓰기 전 WS 종료
- **C-5**: mathUtils parseFloat 정밀도 한계
- **H-3**: PaperEngine 리스너 누적 (paper↔live 전환 시)
- **H-4**: CircuitBreaker rapidLosses 배열 무한 성장
- **H-7**: 기본 전략 이름 불일치 (MomentumStrategy 미존재)
- **H-8**: botRoutes.js router가 팩토리 밖에 선언
- SignalFilter.updatePositionCount() 실제 호출되지 않음

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
