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
| `proposals/round_3.md` | T1-1~T1-11 구현 제안 (백테스트 IndicatorCache, fill action, Sharpe 보정 등) | Round 3 | active |
| `proposals/round_3_review.md` | Round 3 교차 리뷰 (Engineer+UI 제안 검토) | Round 3 | active |
| `../shared/decisions/round_3.md` | Round 3 합의 결정문서 (T1-1~T1-11, AD-13~AD-17) — **구현 완료** | Round 3 | active |
| `proposals/round_4.md` | T2-1~T2-12 구현 제안 (RSI Wilder, confidence 필터, 포지션 사이징, funding 데이터, equity DI) | Round 4 | active |
| `proposals/round_4_review.md` | Round 4 교차 리뷰 (Engineer+UI 제안 검토) | Round 4 | active |
| `../shared/decisions/round_4.md` | Round 4 합의 결정문서 (T2-1~T2-12, AD-18~AD-24) — **구현 완료** | Round 4 | active |
| `proposals/round_5.md` | T3 Enhancement 6건 분석: exchange-side SL 최우선, 성과 귀인 API 미활용, 테스트 프레임워크 부재 | Round 5 | active |
| `proposals/round_5_review.md` | Round 5 교차 리뷰: Jest/Vitest 이중 체계 동의, SL 전략별 적합도 분류 검증, API 인증 시급성 | Round 5 | active |
| `../shared/decisions/round_5.md` | Round 5 합의 결정문서 (T3-1~T3-7, BUG-1, AD-25~AD-31) — **구현 완료** | Round 5 | active |
| `proposals/solo_1.md` | Post-R5 종합 트레이딩 품질 분석: HIGH 4건, MEDIUM 7건, LOW 4건. Overall 7.1/10 | Solo S1 | active |
| `proposals/round_6.md` | 실거래 준비도 강화: CRITICAL 1건(getAccountInfo crash), HIGH 4건, MEDIUM 1건 | Round 6 | active |
| `proposals/round_6_review.md` | Round 6 교차 리뷰 (Engineer+UI 제안 검토) | Round 6 | active |
| `../shared/decisions/round_6.md` | Round 6 합의 결정문서 (25개 항목, AD-32~AD-39) — **구현 완료** | Round 6 | active |
| `proposals/round_7.md` | 레짐 변경 빈도 문제 분석: hysteresisMinCandles=15 제안, 유예기간 설계, 고아 포지션 리스크 | Round 7 | active |
| `proposals/round_7_review.md` | Round 7 교차 리뷰: Engineer 8→12 절충, 쿨다운 5분 동의, 유예기간 카테고리별 차등 보완 | Round 7 | active |
| `../shared/decisions/round_7.md` | Round 7 합의 결정문서 (17건, AD-40~AD-45) — 삼중 보호 체계, 유예기간 — **구현 완료** | Round 7 | active |

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

## Round 5 Key Findings Summary
- **T3-3**: 18개 전략 전체가 소프트웨어 SL만 사용 — `presetStopLossPrice` 배관은 있으나 전략 미사용. 봇 장애 시 SL 미실행 리스크
- **T3-6**: 백엔드 `by-strategy`/`by-symbol` API 존재하나 프론트엔드 미소비. profitFactor/Sharpe/maxDD 전략별 미제공
- **T3-1**: 테스트 인프라 전무 — 32건 코드가 무검증 운영. 트레이딩 핵심 테스트 대상: RiskEngine > 전략 시그널 > 포지션 사이징 > PnL 계산
- **BUG-1**: performanceTracker Map 직렬화 버그 — 3개 에이전트 독립 발견

## Round 7 Key Findings Summary
- **신호 손실**: hysteresisMinCandles=3 (3분) → 전략의 최소 유효 매매 사이클(10~120분) 대비 지나치게 짧아 진입 기회 상실
- **고아 포지션**: strategyRouter.deactivate()가 포지션 청산 없이 `_active=false` 설정 → SL/TP 관리 중단 리스크
- **삼중 보호 합의**: hysteresis 10캔들 + 쿨다운 5분 + 유예기간 3~15분 = 최소 18분 버퍼. 80% 전략이 1 사이클 완료 가능
- **유예 중 시그널 필터링**: OPEN 차단 + CLOSE(SL/TP) 허용 — 기존 포지션 보호와 신규 진입 방지 양립

## Accumulated Insights
- **전략 품질 진화**: R1 14/18 전략 IndicatorCache 미제공 크래시 → R2 백테스트 수정 → R5 exchange-side SL 제안 → R7 유예기간으로 전략 활성 시간 보장. 현재 상태: 전략 안정성 대폭 개선, exchange-side SL은 향후 과제
- **리스크 관리 체계**: R1 ExposureGuard qty 10,000x 오류 → R2 수정 → R4 포지션 사이징 파이프라인 정비 → R7 유예기간으로 고아 포지션 방지. 현재 상태: 리스크 파이프라인 정상 작동
- **레짐 시스템 성숙**: R1 레짐 분류 구축 → R4 7-factor 코인 선정 강화 → R7 삼중 보호 체계(hysteresis+cooldown+grace)로 안정화. 현재 상태: 노이즈 내성 확보, 자동 최적화 범위 확장
- **수익성 인프라**: R1 Sharpe ratio ~10x 과대평가 발견 → R3 보정 → R5 성과 귀인 API → R6 실거래 준비도. 현재 상태: 백테스트 신뢰도 확보, 실거래 전환 가능 수준

## Knowledge Management Rules
1. 새 정보를 받으면 이 인덱스의 기존 항목과 비교
2. **중복** → 무시, 인덱스 비고에 "confirmed round N" 메모
3. **수정 필요** → 해당 knowledge/ 파일 수정 + 인덱스 업데이트
4. **신규** → knowledge/에 새 파일 생성 + 인덱스에 행 추가
5. 상태: `active` (현재 유효), `outdated` (구버전, 참고용), `merged` (다른 파일에 통합됨)
