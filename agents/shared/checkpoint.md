# Checkpoint — 2026-02-16 21:00 KST

## Git State
- Branch: master
- Last commit: 8253c75 대시보드 레이아웃: 시그널+거래내역 세로 배치 + 거래내역 접기/펼치기
- Pending changes: Sprint R7 전체 구현 (커밋 전)
- Worktrees: 없음 (master 단일)

## Sprint R7 Progress
- 합의: 17건, 실행: 17건, 보류: 0건
- 아키텍처 결정: AD-40~AD-45 (6건)

### BE 변경 (12건)
- marketRegime.js: hysteresisMinCandles=10, transitionCooldownMs=300s, weight=0.15, 전환 빈도 메트릭
- regimeParamStore.js: DEFAULT_PARAMS 동기화
- regimeOptimizer.js: PARAM_RANGES [5,20] + cooldown [120K,600K]
- strategyRouter.js: _gracePeriods Map, setTimeout+unref, getStatus() 확장
- botService.js: OPEN 차단/CLOSE 허용, disableStrategy 통합, socket 이벤트 3종
- 17개 전략: gracePeriodMs 메타데이터 추가

### FE 변경 (5건)
- types/index.ts: GraceState, 소켓 이벤트 타입
- socket.ts + useSocket.ts: 3종 grace 이벤트 핸들러
- useCountdown.ts: 신규 카운트다운 훅
- StrategyCard.tsx: 3-way 배지 + 카운트다운 타이머
- MarketIntelligence.tsx: pending/cooldown/전환 빈도 표시
- RegimeFlowMap.tsx: grace 컬럼 추가

## BACKLOG Summary
### Tier 0~2: 81/81 done (100%) ✅
### Tier 3: 8/15 done (53%) — 7 deferred
### R7: 17/17 done (100%) ✅
### Overall: 81/89 done (91%)
- deferred 8건 = T3-4, T3-9~T3-15

## Next Steps
- Phase 6: Docs 최신화 (md/ 문서 업데이트)
- Phase 7: Git commit & push
