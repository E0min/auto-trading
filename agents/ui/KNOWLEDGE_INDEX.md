# UI Agent — Knowledge Index

> 이 파일은 내가 보유한 지식 파일의 목록과 요약이다.
> 새 정보가 들어오면 이 인덱스를 먼저 확인하고 중복/수정/추가를 판단한다.

## Index

| 파일명 | 한줄 요약 | 최종 수정 | 상태 |
|--------|----------|-----------|------|
| `proposals/round_1.md` | 25개 컴포넌트 줄단위 분석, 레이아웃 재설계안, 시각화 컴포넌트 제안 | Round 1 | active |
| `proposals/round_1_review.md` | Trader+Engineer 제안서 교차 리뷰, 프론트엔드 변경 요구사항 종합, 타입 변경 | Round 1 | active |
| `../shared/decisions/round_1.md` | Round 1 합의 결정문서 (47개 이슈, Tier 0~3, 아키텍처 결정 AD-1~6) | Round 1 | active |
| `proposals/round_2.md` | T0-7~T0-9 구현 제안 (긴급정지 다이얼로그, 리스크배너, 모드배너) | Round 2 | active |
| `proposals/round_2_review.md` | Round 2 교차 리뷰 | Round 2 | active |
| `../shared/decisions/round_2.md` | Round 2 합의 결정문서 (T0-1~T0-9, AD-7~AD-12) — **구현 완료** | Round 2 | active |
| `proposals/round_3.md` | T1-7~T1-11 FE 구현 제안 (Dashboard 레이아웃, 청산 버튼, Socket ref-count, Error Boundary) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Trader+Engineer 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |

## Round 1 Key Findings Summary
- **C1**: Emergency Stop에 확인 다이얼로그 없음 — 실수로 전포지션 청산 위험
- **C2**: Risk 이벤트(서킷브레이커/드로다운) WebSocket으로 수신하지만 UI에 미표시
- **C3**: Socket.io 싱글턴 생명주기 문제 — React StrictMode에서 소켓 파괴
- **C4**: 실거래/가상거래 모드 시각적 구분 불충분
- **H1**: 대시보드 정보 우선순위 역전 — 전략 패널이 포지션/PnL을 밀어냄
- **H7**: 모바일 반응형 불완전 — 테이블 768px 미만에서 사용 불가
- **H8**: 폴링 간격 비효율 — 봇 정지 시에도 5초 폴링
- 레짐 색상 맵이 4개 파일에 중복 정의
- Recharts `as never` 타입 캐스팅 3곳
- Error Boundary 부재
- 토너먼트 페이지 영어/한국어 혼용

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
