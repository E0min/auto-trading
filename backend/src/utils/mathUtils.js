'use strict';

/**
 * String-based safe arithmetic utilities.
 *
 * All monetary values flow through the system as strings to avoid
 * floating-point representation issues in JavaScript. Internally we
 * use parseFloat for computation and return fixed-precision strings.
 *
 * Default precision is 8 decimal places (standard for crypto).
 */

const DEFAULT_PRECISION = 8;

/**
 * Parse a numeric string into a float. Throws on non-numeric input.
 * @param {string|number} val
 * @returns {number}
 */
function parse(val) {
  if (val === null || val === undefined || val === '') {
    return 0;
  }
  const n = parseFloat(val);
  if (Number.isNaN(n)) {
    throw new TypeError(`mathUtils: cannot parse "${val}" as a number`);
  }
  return n;
}

/**
 * Determine the appropriate precision based on the inputs.
 * Uses the maximum decimal places found in either operand,
 * capped at DEFAULT_PRECISION.
 * @param {string|number} a
 * @param {string|number} b
 * @returns {number}
 */
function inferPrecision(a, b) {
  const decA = (String(a).split('.')[1] || '').length;
  const decB = (String(b).split('.')[1] || '').length;
  return Math.min(Math.max(decA, decB, 2), DEFAULT_PRECISION);
}

/**
 * Add two values.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function add(a, b) {
  const precision = inferPrecision(a, b);
  return (parse(a) + parse(b)).toFixed(precision);
}

/**
 * Subtract b from a.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function subtract(a, b) {
  const precision = inferPrecision(a, b);
  return (parse(a) - parse(b)).toFixed(precision);
}

/**
 * Multiply two values.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function multiply(a, b) {
  const precision = inferPrecision(a, b);
  return (parse(a) * parse(b)).toFixed(precision);
}

/**
 * Divide a by b.
 * @param {string} a
 * @param {string} b
 * @param {number} [precision=8]
 * @returns {string}
 * @throws {Error} on division by zero
 */
function divide(a, b, precision = DEFAULT_PRECISION) {
  const divisor = parse(b);
  if (divisor === 0) {
    throw new Error('mathUtils.divide: division by zero');
  }
  return (parse(a) / divisor).toFixed(precision);
}

/**
 * Percentage change from oldVal to newVal.
 * Returns the result as a string with 4 decimal places.
 * Formula: ((newVal - oldVal) / |oldVal|) * 100
 * @param {string} oldVal
 * @param {string} newVal
 * @returns {string} — percentage (e.g. "5.2500" means +5.25%)
 */
function pctChange(oldVal, newVal) {
  const o = parse(oldVal);
  const n = parse(newVal);
  if (o === 0) {
    throw new Error('mathUtils.pctChange: oldVal is zero');
  }
  return (((n - o) / Math.abs(o)) * 100).toFixed(4);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isGreaterThan(a, b) {
  return parse(a) > parse(b);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isLessThan(a, b) {
  return parse(a) < parse(b);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isGreaterThanOrEqual(a, b) {
  return parse(a) >= parse(b);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isLessThanOrEqual(a, b) {
  return parse(a) <= parse(b);
}

/**
 * @param {string} a
 * @returns {boolean}
 */
function isZero(a) {
  return parse(a) === 0;
}

/**
 * Return the larger of two values as a string.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function max(a, b) {
  const precision = inferPrecision(a, b);
  return Math.max(parse(a), parse(b)).toFixed(precision);
}

/**
 * Return the smaller of two values as a string.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function min(a, b) {
  const precision = inferPrecision(a, b);
  return Math.min(parse(a), parse(b)).toFixed(precision);
}

/**
 * Format a value to a specific number of decimal places.
 * @param {string} val
 * @param {number} decimals
 * @returns {string}
 */
function toFixed(val, decimals) {
  return parse(val).toFixed(decimals);
}

/**
 * Return the absolute value as a string.
 * @param {string} val
 * @returns {string}
 */
function abs(val) {
  const decPlaces = (String(val).split('.')[1] || '').length || 2;
  const precision = Math.min(decPlaces, DEFAULT_PRECISION);
  return Math.abs(parse(val)).toFixed(precision);
}

/**
 * Return the number of decimal places in a numeric string.
 * @param {string|number} numStr
 * @returns {number}
 */
function getDecimalPlaces(numStr) {
  const str = String(numStr);
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) return 0;
  return str.length - dotIndex - 1;
}

/**
 * Floor a value to the nearest step (lot-size precision).
 * Uses floor (never round-up) to avoid exceeding balance/limits.
 * @param {string} value — the value to floor
 * @param {string} step  — lot step size (e.g. '0.001' for BTC)
 * @returns {string}
 */
function floorToStep(value, step) {
  const v = parse(value);
  const s = parse(step);
  if (s === 0) return value;
  const result = Math.floor(v / s) * s;
  const decimals = getDecimalPlaces(step);
  return result.toFixed(decimals);
}

module.exports = {
  add,
  subtract,
  multiply,
  divide,
  pctChange,
  isGreaterThan,
  isLessThan,
  isGreaterThanOrEqual,
  isLessThanOrEqual,
  isZero,
  max,
  min,
  toFixed,
  abs,
  floorToStep,
};
