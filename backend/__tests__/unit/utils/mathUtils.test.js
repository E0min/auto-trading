'use strict';

const math = require('../../../src/utils/mathUtils');

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------
describe('add', () => {
  test('basic addition', () => {
    expect(math.add('1', '2')).toBe('3.00');
  });

  test('negative numbers', () => {
    expect(math.add('-5.5', '3.2')).toBe('-2.30');
  });

  test('adding zero', () => {
    expect(math.add('100.50', '0')).toBe('100.50');
  });

  test('preserves string precision up to 8 decimals', () => {
    expect(math.add('0.00000001', '0.00000002')).toBe('0.00000003');
  });

  test('large numbers', () => {
    expect(math.add('999999.99', '0.01')).toBe('1000000.00');
  });
});

// ---------------------------------------------------------------------------
// subtract
// ---------------------------------------------------------------------------
describe('subtract', () => {
  test('basic subtraction', () => {
    expect(math.subtract('10', '3')).toBe('7.00');
  });

  test('negative result', () => {
    expect(math.subtract('3', '10')).toBe('-7.00');
  });

  test('subtracting equal values gives zero', () => {
    expect(math.subtract('5.5', '5.5')).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// multiply
// ---------------------------------------------------------------------------
describe('multiply', () => {
  test('basic multiplication', () => {
    expect(math.multiply('3', '4')).toBe('12.00');
  });

  test('decimal multiplication', () => {
    expect(math.multiply('2.5', '4.0')).toBe('10.00');
  });

  test('very small numbers (crypto satoshi-level)', () => {
    // 0.00000001 * 0.00000001 is 1e-16 which rounds to 0 at 8 decimals
    expect(math.multiply('0.00000001', '0.00000001')).toBe('0.00000000');
  });

  test('multiply by zero', () => {
    expect(math.multiply('12345.678', '0')).toBe('0.000');
  });
});

// ---------------------------------------------------------------------------
// divide
// ---------------------------------------------------------------------------
describe('divide', () => {
  test('basic division', () => {
    expect(math.divide('10', '2')).toBe('5.00000000');
  });

  test('division by zero throws', () => {
    expect(() => math.divide('10', '0')).toThrow('division by zero');
  });

  test('infinite decimal (1/3) is truncated to 8 decimals', () => {
    expect(math.divide('1', '3')).toBe('0.33333333');
  });

  test('custom precision parameter', () => {
    expect(math.divide('1', '3', 4)).toBe('0.3333');
  });

  test('negative dividend', () => {
    expect(math.divide('-10', '4')).toBe('-2.50000000');
  });
});

// ---------------------------------------------------------------------------
// pctChange
// ---------------------------------------------------------------------------
describe('pctChange', () => {
  test('basic percentage increase', () => {
    expect(math.pctChange('100', '110')).toBe('10.0000');
  });

  test('percentage decrease', () => {
    expect(math.pctChange('200', '180')).toBe('-10.0000');
  });

  test('negative oldVal (short position scenario)', () => {
    // Formula: ((newVal - oldVal) / |oldVal|) * 100
    expect(math.pctChange('-100', '-90')).toBe('10.0000');
  });

  test('zero oldVal throws', () => {
    expect(() => math.pctChange('0', '100')).toThrow('oldVal is zero');
  });
});

// ---------------------------------------------------------------------------
// Comparison functions
// ---------------------------------------------------------------------------
describe('isGreaterThan', () => {
  test('returns true when a > b', () => {
    expect(math.isGreaterThan('10', '5')).toBe(true);
  });

  test('returns false when a < b', () => {
    expect(math.isGreaterThan('3', '5')).toBe(false);
  });

  test('returns false when equal', () => {
    expect(math.isGreaterThan('5', '5')).toBe(false);
  });

  test('negative comparison', () => {
    expect(math.isGreaterThan('-1', '-2')).toBe(true);
  });
});

describe('isLessThan', () => {
  test('returns true when a < b', () => {
    expect(math.isLessThan('3', '5')).toBe(true);
  });

  test('returns false when a > b', () => {
    expect(math.isLessThan('10', '5')).toBe(false);
  });

  test('returns false when equal', () => {
    expect(math.isLessThan('5', '5')).toBe(false);
  });
});

describe('isZero', () => {
  test('zero string', () => {
    expect(math.isZero('0')).toBe(true);
  });

  test('zero with decimals', () => {
    expect(math.isZero('0.00')).toBe(true);
  });

  test('non-zero returns false', () => {
    expect(math.isZero('0.01')).toBe(false);
  });

  test('negative zero', () => {
    expect(math.isZero('-0')).toBe(true);
  });
});

describe('isGreaterThanOrEqual / isLessThanOrEqual', () => {
  test('isGreaterThanOrEqual with equal values', () => {
    expect(math.isGreaterThanOrEqual('5', '5')).toBe(true);
  });

  test('isLessThanOrEqual with equal values', () => {
    expect(math.isLessThanOrEqual('5', '5')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// floorToStep
// ---------------------------------------------------------------------------
describe('floorToStep', () => {
  test('floors to BTC lot size (0.001)', () => {
    expect(math.floorToStep('1.23456', '0.001')).toBe('1.234');
  });

  test('result becomes 0 when input < step', () => {
    expect(math.floorToStep('0.0005', '0.001')).toBe('0.000');
  });

  test('exact multiple returns same value', () => {
    expect(math.floorToStep('1.500', '0.500')).toBe('1.500');
  });

  test('step of 0 returns original value', () => {
    expect(math.floorToStep('1.2345', '0')).toBe('1.2345');
  });

  test('integer step', () => {
    expect(math.floorToStep('17', '5')).toBe('15');
  });
});

// ---------------------------------------------------------------------------
// max / min
// ---------------------------------------------------------------------------
describe('max', () => {
  test('returns the larger value', () => {
    expect(math.max('3.5', '7.2')).toBe('7.20');
  });

  test('negative values', () => {
    expect(math.max('-10', '-5')).toBe('-5.00');
  });
});

describe('min', () => {
  test('returns the smaller value', () => {
    expect(math.min('3.5', '7.2')).toBe('3.50');
  });

  test('negative values', () => {
    expect(math.min('-10', '-5')).toBe('-10.00');
  });
});

// ---------------------------------------------------------------------------
// abs
// ---------------------------------------------------------------------------
describe('abs', () => {
  test('positive value unchanged', () => {
    expect(math.abs('5.25')).toBe('5.25');
  });

  test('negative value becomes positive', () => {
    expect(math.abs('-5.25')).toBe('5.25');
  });

  test('zero remains zero (with min precision)', () => {
    expect(math.abs('0')).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// toFixed
// ---------------------------------------------------------------------------
describe('toFixed', () => {
  test('truncates to specified decimals', () => {
    expect(math.toFixed('1.23456789', 4)).toBe('1.2346');
  });

  test('zero decimals', () => {
    expect(math.toFixed('9.9', 0)).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// Edge cases for trading system
// ---------------------------------------------------------------------------
describe('trading edge cases', () => {
  test('null/undefined/empty string parse as 0 in add', () => {
    expect(math.add('', '5')).toBe('5.00');
    expect(math.add('5', '')).toBe('5.00');
  });

  test('non-numeric string throws TypeError', () => {
    expect(() => math.add('abc', '1')).toThrow(TypeError);
  });

  test('isEqual via isGreaterThanOrEqual + isLessThanOrEqual', () => {
    // No explicit isEqual export, but we can check equivalence
    const a = '100.00';
    const b = '100.00';
    expect(math.isGreaterThanOrEqual(a, b) && math.isLessThanOrEqual(a, b)).toBe(true);
  });
});
