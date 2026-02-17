'use strict';

/**
 * strategyParamMeta — UI-facing metadata for strategy defaultConfig fields.
 *
 * Each entry describes a tunable parameter: its label (Korean), type,
 * valid range and step. The frontend renders form controls automatically
 * from this metadata.
 *
 * Types:
 *   integer  — slider + number input (integer values)
 *   percent  — slider + number input (String values, 1 decimal)
 *   decimal  — number input (String values, variable decimals)
 *   boolean  — toggle switch
 */

const PARAM_META = {
  // ── Price-Action ──────────────────────────────────────────────────────────

  TurtleBreakoutStrategy: [
    { field: 'entryChannel', label: '진입 채널 기간', type: 'integer', min: 5, max: 100, step: 1, group: 'signal', description: '고가/저가 돌파 감지에 사용하는 채널 기간(캔들 수). 짧으면 빈번한 진입 시그널, 길면 큰 추세만 포착' },
    { field: 'exitChannel', label: '청산 채널 기간', type: 'integer', min: 3, max: 50, step: 1, group: 'signal', description: '포지션 청산에 사용하는 채널 기간. 진입 채널보다 짧게 설정하여 수익 확보 속도 조절' },
    { field: 'trendFilter', label: '추세 필터 기간', type: 'integer', min: 20, max: 200, step: 1, group: 'indicator', description: '장기 추세 방향 판단용 이동평균 기간. 길수록 큰 추세만 필터링하여 역추세 진입 방지' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 변동성 측정의 민감도를 결정' },
    { field: 'stopMultiplier', label: '손절 ATR 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '손절가를 ATR의 몇 배로 설정할지 결정. 높이면 넓은 손절로 휩쏘 방지, 낮추면 빠른 손절' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 높이면 충분한 수익 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
  ],

  CandlePatternStrategy: [
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 캔들 패턴의 유효성 판단 및 TP/SL 거리 산출에 사용' },
    { field: 'tpMultiplier', label: '익절 ATR 배수', type: 'decimal', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '익절 목표를 ATR의 몇 배로 설정. 높이면 큰 수익 목표이나 도달 확률 감소' },
    { field: 'slMultiplier', label: '손절 ATR 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '손절가를 ATR의 몇 배로 설정. 높이면 넓은 손절로 패턴 완성 여유 확보' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 충분한 수익 확보 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'minBodyRatio', label: '최소 몸통 비율', type: 'decimal', min: 0.1, max: 0.9, step: 0.05, group: 'signal', description: '캔들 전체 길이 대비 최소 몸통 비율. 높이면 강한 캔들만 시그널로 인식하여 정확도 증가' },
  ],

  SupportResistanceStrategy: [
    { field: 'lookback', label: '스윙 탐지 범위', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '지지/저항 레벨 탐지를 위한 스윙 포인트 좌우 비교 범위. 높이면 더 신뢰성 높은 레벨 감지' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 레벨 클러스터링 및 리테스트 허용 범위 산출에 사용' },
    { field: 'clusterTolerance', label: '클러스터 허용 ATR', type: 'decimal', min: 0.3, max: 3, step: 0.1, group: 'indicator', description: '유사 가격대의 레벨을 하나로 합치는 허용 범위(ATR 배수). 높이면 넓은 범위의 레벨이 병합' },
    { field: 'retestTolerance', label: '리테스트 허용 ATR', type: 'decimal', min: 0.1, max: 2, step: 0.1, group: 'signal', description: '가격이 지지/저항 레벨에 접근했다고 판단하는 허용 범위(ATR 배수). 높이면 넓은 범위에서 시그널 발생' },
    { field: 'minTouches', label: '최소 터치 횟수', type: 'integer', min: 1, max: 5, step: 1, group: 'signal', description: '지지/저항 레벨로 인정하기 위한 최소 터치 횟수. 높이면 신뢰도 높은 레벨만 사용' },
    { field: 'slMultiplier', label: '손절 ATR 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '손절가를 ATR의 몇 배로 설정. 레벨 이탈 시 손절 거리 결정' },
    { field: 'defaultTpMultiplier', label: '기본 익절 ATR 배수', type: 'decimal', min: 1, max: 10, step: 0.5, group: 'signal', description: '다음 레벨이 없을 때 사용하는 기본 익절 ATR 배수. 높이면 큰 수익 목표 설정' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 충분한 수익 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'maxLevels', label: '최대 레벨 수', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: '추적할 최대 지지/저항 레벨 수. 높이면 더 많은 레벨을 참조하지만 연산 증가' },
  ],

  SwingStructureStrategy: [
    { field: 'swingLookback', label: '스윙 탐지 범위', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '스윙 고점/저점 탐지를 위한 좌우 비교 범위. 높이면 더 큰 구조적 스윙만 감지' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 손절 버퍼 및 가격 필터링에 사용' },
    { field: 'slBuffer', label: '손절 버퍼 ATR', type: 'decimal', min: 0.1, max: 3, step: 0.1, group: 'risk', description: '스윙 포인트 기반 손절에 추가하는 버퍼(ATR 배수). 높이면 노이즈에 의한 손절 감소' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 충분한 수익 확보 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
  ],

  FibonacciRetracementStrategy: [
    { field: 'swingPeriod', label: '스윙 탐지 기간', type: 'integer', min: 20, max: 200, step: 5, group: 'indicator', description: '피보나치 되돌림 계산을 위한 스윙 탐지 기간. 길면 더 큰 파동의 되돌림을 포착' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 스윙 유효성 판단 및 손절 버퍼에 사용' },
    { field: 'minSwingAtr', label: '최소 스윙 ATR', type: 'decimal', min: 1, max: 10, step: 0.5, group: 'signal', description: '유효한 스윙으로 인정하기 위한 최소 크기(ATR 배수). 높이면 작은 파동 무시하고 큰 추세만 대상' },
    { field: 'fibEntryLow', label: '피보나치 진입 하한', type: 'decimal', min: 0.2, max: 0.5, step: 0.01, group: 'signal', description: '진입 가능한 피보나치 되돌림 하한값. 낮추면 깊은 되돌림에서도 진입 허용' },
    { field: 'fibEntryHigh', label: '피보나치 진입 상한', type: 'decimal', min: 0.5, max: 0.8, step: 0.01, group: 'signal', description: '진입 가능한 피보나치 되돌림 상한값. 높이면 얕은 되돌림에서도 진입 허용' },
    { field: 'fibInvalidation', label: '피보나치 무효화', type: 'decimal', min: 0.7, max: 1.0, step: 0.01, group: 'signal', description: '피보나치 패턴 무효화 레벨. 되돌림이 이 수준을 넘으면 패턴 폐기' },
    { field: 'fibExtension', label: '피보나치 확장', type: 'decimal', min: 1.0, max: 2.0, step: 0.01, group: 'signal', description: '익절 목표로 사용할 피보나치 확장 레벨. 높이면 더 큰 수익 목표 설정' },
    { field: 'slBuffer', label: '손절 버퍼 ATR', type: 'decimal', min: 0.1, max: 3, step: 0.1, group: 'risk', description: '피보나치 무효화 레벨 아래에 추가하는 손절 버퍼(ATR 배수). 노이즈 방지용' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 충분한 수익 확보 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
  ],

  TrendlineBreakoutStrategy: [
    { field: 'aggregationMinutes', label: '봉 집계 분', type: 'integer', min: 15, max: 240, step: 15, group: 'indicator', description: '캔들 집계 시간(분). 높이면 더 큰 시간대의 추세선을 형성하여 노이즈 감소' },
    { field: 'pivotLeftBars', label: '피봇 좌측 봉', type: 'integer', min: 2, max: 10, step: 1, group: 'indicator', description: '피봇 포인트 확인을 위한 좌측 비교 봉 수. 높이면 더 확실한 피봇만 인식' },
    { field: 'pivotRightBars', label: '피봇 우측 봉', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '피봇 포인트 확인을 위한 우측 비교 봉 수. 높이면 확인 지연이 커지지만 신뢰도 증가' },
    { field: 'minPivotDistance', label: '최소 피봇 간격', type: 'integer', min: 2, max: 20, step: 1, group: 'indicator', description: '추세선 형성에 필요한 피봇 간 최소 봉 간격. 높이면 의미 있는 추세선만 형성' },
    { field: 'maxPivotAge', label: '최대 피봇 수명', type: 'integer', min: 20, max: 300, step: 10, group: 'indicator', description: '피봇 포인트의 최대 유효 기간(봉 수). 오래된 피봇은 추세선 형성에서 제외' },
    { field: 'breakoutBufferAtr', label: '돌파 버퍼 ATR', type: 'decimal', min: 0.01, max: 1, step: 0.05, group: 'signal', description: '추세선 돌파 확인을 위한 버퍼(ATR 배수). 높이면 거짓 돌파 필터링 강화' },
    { field: 'slBufferAtr', label: '손절 버퍼 ATR', type: 'decimal', min: 0.3, max: 3, step: 0.1, group: 'risk', description: '추세선 기반 손절에 추가하는 버퍼(ATR 배수). 높이면 노이즈에 의한 손절 감소' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 돌파 버퍼 및 손절 거리 산출에 사용' },
    { field: 'trailingActivationAtr', label: '트레일링 활성 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '트레일링 스탑이 활성화되는 수익 ATR 배수. 충분한 수익 확보 후 트레일링 시작' },
    { field: 'trailingDistanceAtr', label: '트레일링 거리 ATR', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 스탑 거리(ATR 배수). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
  ],

  // ── Indicator-Light ───────────────────────────────────────────────────────

  GridStrategy: [
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 그리드 간격 산출의 기준이 되는 변동성 측정' },
    { field: 'gridSpacingMultiplier', label: '그리드 간격 ATR 배수', type: 'decimal', min: 0.1, max: 2, step: 0.1, group: 'signal', description: '그리드 간 간격을 ATR의 몇 배로 설정. 높이면 넓은 간격으로 거래 빈도 감소' },
    { field: 'gridLevels', label: '그리드 레벨 수', type: 'integer', min: 3, max: 30, step: 1, group: 'signal', description: '상하로 배치할 그리드 주문 수. 많으면 넓은 가격대를 커버하지만 개별 주문 크기 감소' },
    { field: 'totalBudgetPercent', label: '총 예산 (%)', type: 'percent', min: 5, max: 50, step: 1, group: 'sizing', description: '그리드 전체에 할당할 자본 비율(%). 높이면 그리드 주문 크기 증가' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'maxDrawdownPercent', label: '최대 낙폭 (%)', type: 'percent', min: 1, max: 10, step: 0.5, group: 'risk', description: '허용 최대 낙폭 비율(%). 초과 시 그리드 전체 청산. 낮추면 보수적 운용' },
  ],

  MaTrendStrategy: [
    { field: 'h1FastEma', label: '1시간 빠른 EMA', type: 'integer', min: 3, max: 50, step: 1, group: 'indicator', description: '1시간 봉 빠른 EMA 기간. 짧으면 가격 변화에 민감하게 반응하여 크로스 빈도 증가' },
    { field: 'h1SlowEma', label: '1시간 느린 EMA', type: 'integer', min: 10, max: 100, step: 1, group: 'indicator', description: '1시간 봉 느린 EMA 기간. 빠른 EMA와의 크로스로 단기 추세 전환 감지' },
    { field: 'h4FastEma', label: '4시간 빠른 EMA', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '4시간 봉 빠른 EMA 기간. 중기 추세 방향 확인용' },
    { field: 'h4SlowEma', label: '4시간 느린 EMA', type: 'integer', min: 20, max: 200, step: 1, group: 'indicator', description: '4시간 봉 느린 EMA 기간. 중기 추세 필터로 역추세 진입 방지' },
    { field: 'dailyFastEma', label: '일봉 빠른 EMA', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '일봉 빠른 EMA 기간. 장기 추세 방향 필터로 사용' },
    { field: 'dailySlowEma', label: '일봉 느린 EMA', type: 'integer', min: 10, max: 100, step: 1, group: 'indicator', description: '일봉 느린 EMA 기간. 장기 추세 확인으로 큰 방향성 판단' },
    { field: 'trailingStopPercent', label: '트레일링 손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'risk', description: '고점/저점 대비 트레일링 손절 비율(%). 좁으면 수익 보존력 높으나 조기 청산 가능' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 20, step: 0.5, group: 'signal', description: '익절 비율(%). 진입가 대비 해당 비율만큼 유리하게 이동 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 좁으면 빈번한 손절, 넓으면 큰 손실 가능' },
  ],

  FundingRateStrategy: [
    { field: 'longFundingThreshold', label: '롱 펀딩 임계값', type: 'decimal', min: -0.1, max: 0, step: 0.005, group: 'signal', description: '롱 진입 조건이 되는 펀딩 비율 임계값. 낮을수록(음수가 클수록) 강한 역발상 롱 시그널' },
    { field: 'shortFundingThreshold', label: '숏 펀딩 임계값', type: 'decimal', min: 0, max: 0.1, step: 0.005, group: 'signal', description: '숏 진입 조건이 되는 펀딩 비율 임계값. 높을수록 강한 역발상 숏 시그널' },
    { field: 'consecutivePeriods', label: '연속 기간', type: 'integer', min: 1, max: 10, step: 1, group: 'signal', description: '시그널 발생에 필요한 연속 펀딩 기간 수. 높이면 더 확실한 시그널만 포착' },
    { field: 'oiChangeThreshold', label: 'OI 변화 임계 (%)', type: 'percent', min: 1, max: 20, step: 1, group: 'signal', description: '미결제 약정(OI) 변화율 임계값(%). 높이면 큰 OI 변화가 있을 때만 시그널 발생' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 20, step: 0.5, group: 'signal', description: '익절 비율(%). 진입가 대비 해당 비율만큼 유리하게 이동 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 좁으면 빈번한 손절, 넓으면 큰 손실 가능' },
    { field: 'maxHoldHours', label: '최대 보유 시간', type: 'integer', min: 1, max: 72, step: 1, group: 'risk', description: '포지션 최대 보유 시간(시). 초과 시 강제 청산하여 장기 홀딩 리스크 제한' },
  ],

  RsiPivotStrategy: [
    { field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 100, step: 1, group: 'indicator', description: 'RSI 지표 계산 캔들 수. 짧으면 민감하게 반응하여 시그널 빈도 증가, 길면 안정적이나 지연' },
    { field: 'rsiOversold', label: 'RSI 과매도', type: 'integer', min: 5, max: 50, step: 1, group: 'signal', description: 'RSI 과매도 기준값. 낮추면 더 극단적인 과매도에서만 롱 시그널 발생하여 정확도 증가' },
    { field: 'rsiOverbought', label: 'RSI 과매수', type: 'integer', min: 50, max: 95, step: 1, group: 'signal', description: 'RSI 과매수 기준값. 높이면 더 극단적인 과매수에서만 숏 시그널 발생하여 정확도 증가' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 20, step: 0.5, group: 'signal', description: '익절 비율(%). 진입가 대비 해당 비율만큼 유리하게 이동 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 좁으면 빈번한 손절, 넓으면 큰 손실 가능' },
  ],

  SupertrendStrategy: [
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 슈퍼트렌드 밴드 폭에 직접 영향' },
    { field: 'supertrendMultiplier', label: '슈퍼트렌드 배수', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '슈퍼트렌드 ATR 배수. 높이면 밴드가 넓어져 추세 전환 감지가 느려지지만 휩쏘 감소' },
    { field: 'macdFast', label: 'MACD 빠른', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: 'MACD 빠른 이동평균 기간. 짧으면 가격 변화에 민감하게 반응' },
    { field: 'macdSlow', label: 'MACD 느린', type: 'integer', min: 10, max: 60, step: 1, group: 'indicator', description: 'MACD 느린 이동평균 기간. 빠른 선과의 차이로 모멘텀 측정' },
    { field: 'macdSignal', label: 'MACD 시그널', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: 'MACD 시그널 라인 기간. MACD 라인과의 크로스로 시그널 확인' },
    { field: 'volOscShort', label: '거래량 단기', type: 'integer', min: 2, max: 20, step: 1, group: 'indicator', description: '거래량 오실레이터 단기 이동평균 기간. 단기 거래량 변화 감지' },
    { field: 'volOscLong', label: '거래량 장기', type: 'integer', min: 10, max: 60, step: 1, group: 'indicator', description: '거래량 오실레이터 장기 이동평균 기간. 기준 거래량 대비 현재 거래량 비교' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 20, step: 0.5, group: 'signal', description: '익절 비율(%). 진입가 대비 해당 비율만큼 유리하게 이동 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 좁으면 빈번한 손절, 넓으면 큰 손실 가능' },
  ],

  BollingerReversionStrategy: [
    { field: 'bbPeriod', label: 'BB 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '볼린저 밴드 이동평균 기간. 짧으면 밴드가 민감하게 변동, 길면 안정적' },
    { field: 'bbStdDev', label: 'BB 표준편차', type: 'integer', min: 1, max: 4, step: 1, group: 'indicator', description: '볼린저 밴드 표준편차 배수. 높이면 밴드가 넓어져 시그널 빈도 감소하지만 신뢰도 증가' },
    { field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 50, step: 1, group: 'indicator', description: 'RSI 지표 계산 캔들 수. 볼린저 터치 시 확인 필터로 사용' },
    { field: 'stochPeriod', label: '스토캐스틱 기간', type: 'integer', min: 5, max: 30, step: 1, group: 'indicator', description: '스토캐스틱 오실레이터 기간. 과매수/과매도 확인용 보조 지표' },
    { field: 'stochSmooth', label: '스토캐스틱 스무딩', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '스토캐스틱 스무딩 기간. 높이면 노이즈 감소하지만 시그널 지연' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 20, step: 0.5, group: 'signal', description: '익절 비율(%). 진입가 대비 해당 비율만큼 유리하게 이동 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.5, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 좁으면 빈번한 손절, 넓으면 큰 손실 가능' },
    { field: 'maxEntries', label: '최대 진입 횟수', type: 'integer', min: 1, max: 10, step: 1, group: 'risk', description: '동시 허용 최대 진입 횟수. 높이면 물타기 가능하지만 리스크 증가' },
  ],

  VwapReversionStrategy: [
    { field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 50, step: 1, group: 'indicator', description: 'RSI 지표 계산 캔들 수. VWAP 이탈 시 과매수/과매도 확인 필터' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 손절 거리 산출에 사용' },
    { field: 'vwapDeviationMult', label: 'VWAP 이탈 배수', type: 'decimal', min: 0.5, max: 5, step: 0.1, group: 'signal', description: 'VWAP 대비 이탈 기준 배수. 높이면 큰 이탈에서만 시그널 발생하여 정확도 증가' },
    { field: 'volumeSmaPeriod', label: '거래량 SMA 기간', type: 'integer', min: 5, max: 60, step: 1, group: 'indicator', description: '거래량 이동평균 기간. 평균 거래량 대비 현재 거래량 비교 기준' },
    { field: 'volumeThresholdMult', label: '거래량 임계 배수', type: 'decimal', min: 0.5, max: 3, step: 0.1, group: 'signal', description: '시그널 발생에 필요한 거래량 배수. 높이면 높은 거래량 동반 시에만 진입' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'slAtrMult', label: '손절 ATR 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '손절가를 ATR의 몇 배로 설정. 높이면 넓은 손절로 휩쏘 방지' },
    { field: 'maxHoldCandles', label: '최대 보유 캔들', type: 'integer', min: 6, max: 120, step: 6, group: 'risk', description: '포지션 최대 보유 캔들 수. 초과 시 강제 청산하여 장기 홀딩 리스크 제한' },
  ],

  MacdDivergenceStrategy: [
    { field: 'macdFast', label: 'MACD 빠른', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: 'MACD 빠른 이동평균 기간. 짧으면 가격 변화에 민감하게 반응하여 다이버전스 빈도 증가' },
    { field: 'macdSlow', label: 'MACD 느린', type: 'integer', min: 10, max: 60, step: 1, group: 'indicator', description: 'MACD 느린 이동평균 기간. 빠른 선과의 차이로 모멘텀 측정' },
    { field: 'macdSignal', label: 'MACD 시그널', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: 'MACD 시그널 라인 기간. 다이버전스 확인 및 진입 타이밍에 사용' },
    { field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 50, step: 1, group: 'indicator', description: 'RSI 지표 계산 캔들 수. MACD 다이버전스 확인용 보조 필터' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 손절 거리 산출에 사용' },
    { field: 'emaTpPeriod', label: '익절 EMA 기간', type: 'integer', min: 10, max: 200, step: 5, group: 'signal', description: '익절 기준 EMA 기간. 가격이 이 EMA를 돌파하면 익절 시그널 발생' },
    { field: 'pivotLeftBars', label: '피봇 좌측 봉', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '피봇 포인트 확인을 위한 좌측 비교 봉 수. 높이면 더 확실한 피봇만 인식' },
    { field: 'pivotRightBars', label: '피봇 우측 봉', type: 'integer', min: 1, max: 10, step: 1, group: 'indicator', description: '피봇 포인트 확인을 위한 우측 비교 봉 수. 높이면 확인 지연이 커지지만 신뢰도 증가' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'slAtrMult', label: '손절 ATR 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'risk', description: '손절가를 ATR의 몇 배로 설정. 높이면 넓은 손절로 다이버전스 완성 여유 확보' },
    { field: 'maxCandlesForFailure', label: '실패 판단 캔들', type: 'integer', min: 2, max: 20, step: 1, group: 'signal', description: '다이버전스 후 기대 방향으로 움직이지 않을 때 실패로 판단하는 캔들 수. 짧으면 빠른 손절' },
  ],

  // ── Indicator-Heavy ───────────────────────────────────────────────────────

  QuietRangeScalpStrategy: [
    { field: 'emaPeriod', label: 'EMA 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '켈트너 채널 중심선 EMA 기간. 짧으면 채널이 가격에 더 밀착' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 채널 폭과 조용한 구간 판별에 사용' },
    { field: 'atrSmaPeriod', label: 'ATR SMA 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR 이동평균 기간. 현재 ATR과 비교하여 변동성이 낮은 구간(조용한 구간) 감지' },
    { field: 'kcMultiplier', label: 'KC 배수', type: 'decimal', min: 0.5, max: 4, step: 0.1, group: 'indicator', description: '켈트너 채널 ATR 배수. 높이면 채널이 넓어져 시그널 빈도 감소하지만 정확도 증가' },
    { field: 'atrQuietThreshold', label: 'ATR 조용 임계', type: 'decimal', min: 0.3, max: 1, step: 0.05, group: 'signal', description: '조용한 구간 판별 임계값(ATR/ATR_SMA 비율). 낮추면 더 조용한 구간에서만 진입' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'tpPercent', label: '익절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.1, group: 'signal', description: '익절 비율(%). 스캘핑이므로 낮은 값 권장. 진입가 대비 해당 비율 도달 시 익절' },
    { field: 'slPercent', label: '손절 (%)', type: 'percent', min: 0.5, max: 10, step: 0.1, group: 'signal', description: '손절 비율(%). 진입가 대비 해당 비율만큼 역행 시 손절. 스캘핑이므로 좁은 손절 권장' },
  ],

  BreakoutStrategy: [
    { field: 'bbPeriod', label: 'BB 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '볼린저 밴드 기간. 스퀴즈(볼린저가 켈트너 안으로 수렴) 감지에 사용' },
    { field: 'bbStdDev', label: 'BB 표준편차', type: 'integer', min: 1, max: 4, step: 1, group: 'indicator', description: '볼린저 밴드 표준편차 배수. 높이면 밴드가 넓어져 스퀴즈 조건이 까다로워짐' },
    { field: 'kcEmaPeriod', label: 'KC EMA 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '켈트너 채널 중심선 EMA 기간. 볼린저와 비교하여 스퀴즈 상태 판단' },
    { field: 'kcAtrPeriod', label: 'KC ATR 기간', type: 'integer', min: 5, max: 30, step: 1, group: 'indicator', description: '켈트너 채널 ATR 기간. 채널 폭 계산에 사용' },
    { field: 'kcMult', label: 'KC 배수', type: 'decimal', min: 0.5, max: 4, step: 0.1, group: 'indicator', description: '켈트너 채널 ATR 배수. 높이면 채널이 넓어져 스퀴즈 빈도 증가' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 돌파 확인 및 익절/손절 거리에 사용' },
    { field: 'emaSlopePeriod', label: 'EMA 기울기 기간', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: '돌파 방향 확인용 EMA 기울기 측정 기간. 짧으면 최근 방향에 민감' },
    { field: 'volumeSmaPeriod', label: '거래량 SMA 기간', type: 'integer', min: 5, max: 60, step: 1, group: 'indicator', description: '거래량 이동평균 기간. 돌파 시 거래량 급증 확인 기준' },
    { field: 'minSqueezeCandles', label: '최소 스퀴즈 캔들', type: 'integer', min: 2, max: 20, step: 1, group: 'signal', description: '돌파 시그널 발생에 필요한 최소 스퀴즈 지속 캔들 수. 높이면 충분히 압축된 후 돌파만 포착' },
    { field: 'volumeBreakoutMult', label: '거래량 돌파 배수', type: 'decimal', min: 1, max: 5, step: 0.5, group: 'signal', description: '돌파 확인에 필요한 거래량 배수. 높이면 강한 거래량 동반 돌파만 진입' },
    { field: 'atrBreakoutMult', label: 'ATR 돌파 배수', type: 'decimal', min: 0.5, max: 5, step: 0.5, group: 'signal', description: '가격 돌파 확인을 위한 ATR 배수. 높이면 큰 폭의 돌파에서만 시그널 발생' },
    { field: 'positionSizePercent', label: '포지션 크기 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '자기 자본 대비 포지션 크기(%). 높이면 수익 잠재력이 커지지만 리스크도 비례' },
    { field: 'leverage', label: '레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '레버리지 배수. 높이면 수익/손실이 비례하여 커짐. 과도한 레버리지는 청산 위험 증가' },
    { field: 'tpAtrMult', label: '익절 ATR 배수', type: 'decimal', min: 1, max: 10, step: 0.5, group: 'signal', description: '익절 목표를 ATR의 몇 배로 설정. 높이면 큰 수익 목표이나 도달 확률 감소' },
    { field: 'failureCandles', label: '실패 판단 캔들', type: 'integer', min: 1, max: 10, step: 1, group: 'signal', description: '돌파 후 기대 방향으로 움직이지 않을 때 실패로 판단하는 캔들 수. 짧으면 빠른 청산' },
  ],

  AdaptiveRegimeStrategy: [
    { field: 'emaPeriodFast', label: '빠른 EMA 기간', type: 'integer', min: 3, max: 30, step: 1, group: 'indicator', description: '빠른 EMA 기간. 레짐별 추세 방향 감지 및 크로스오버 시그널에 사용' },
    { field: 'emaPeriodSlow', label: '느린 EMA 기간', type: 'integer', min: 10, max: 60, step: 1, group: 'indicator', description: '느린 EMA 기간. 빠른 EMA와의 교차로 추세 전환 감지' },
    { field: 'rsiPeriod', label: 'RSI 기간', type: 'integer', min: 2, max: 50, step: 1, group: 'indicator', description: 'RSI 지표 계산 캔들 수. 횡보 레짐에서 과매수/과매도 반전 시그널에 사용' },
    { field: 'atrPeriod', label: 'ATR 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ATR(평균진폭) 계산 캔들 수. 레짐 판별 및 변동성 기반 파라미터 조정에 사용' },
    { field: 'adxPeriod', label: 'ADX 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: 'ADX(평균방향지수) 기간. 추세 강도 측정으로 레짐 분류에 핵심적 역할' },
    { field: 'bbPeriod', label: 'BB 기간', type: 'integer', min: 5, max: 50, step: 1, group: 'indicator', description: '볼린저 밴드 기간. 횡보 레짐에서 밴드 이탈 시그널에 사용' },
    { field: 'bbStdDev', label: 'BB 표준편차', type: 'integer', min: 1, max: 4, step: 1, group: 'indicator', description: '볼린저 밴드 표준편차 배수. 횡보 레짐 진입 조건의 민감도 결정' },
    { field: 'trendPositionSizePercent', label: '추세 포지션 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '추세 레짐에서의 포지션 크기(%). 추세가 명확할 때 적극적 운용 가능' },
    { field: 'rangePositionSizePercent', label: '횡보 포지션 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '횡보 레짐에서의 포지션 크기(%). 방향성이 불분명하므로 보수적 운용 권장' },
    { field: 'volatilePositionSizePercent', label: '변동 포지션 (%)', type: 'percent', min: 1, max: 20, step: 0.5, group: 'sizing', description: '변동성 레짐에서의 포지션 크기(%). 급등락 리스크가 높으므로 소규모 권장' },
    { field: 'trendLeverage', label: '추세 레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '추세 레짐 전용 레버리지 배수. 추세 방향 진입이므로 상대적으로 높게 설정 가능' },
    { field: 'rangeLeverage', label: '횡보 레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '횡보 레짐 전용 레버리지 배수. 반전 매매이므로 보수적 레버리지 권장' },
    { field: 'volatileLeverage', label: '변동 레버리지', type: 'integer', min: 1, max: 20, step: 1, group: 'sizing', description: '변동성 레짐 전용 레버리지 배수. 급변동 시 청산 위험이 높아 낮은 레버리지 권장' },
  ],
};

/**
 * Get parameter metadata for a given strategy name.
 * @param {string} strategyName
 * @returns {Array|null}
 */
function getParamMeta(strategyName) {
  return PARAM_META[strategyName] || null;
}

module.exports = { PARAM_META, getParamMeta };
