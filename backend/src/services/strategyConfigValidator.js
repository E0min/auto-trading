'use strict';

const { getParamMeta } = require('./strategyParamMeta');

/**
 * Validate strategy config values against paramMeta min/max/type constraints.
 * @param {string} strategyName
 * @param {object} newConfig — key-value pairs to validate
 * @returns {{ valid: boolean, errors: Array<{field, reason, min?, max?, value?}> }}
 */
function validateStrategyConfig(strategyName, newConfig) {
  const meta = getParamMeta(strategyName);

  if (!meta || meta.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors = [];

  for (const [key, value] of Object.entries(newConfig)) {
    const fieldMeta = meta.find(m => m.field === key);
    if (!fieldMeta) {
      errors.push({ field: key, reason: 'unknown_field' });
      continue;
    }

    if (fieldMeta.type === 'boolean') {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        errors.push({ field: key, reason: 'must_be_boolean', value });
      }
      continue;
    }

    const numVal = parseFloat(String(value));
    if (isNaN(numVal)) {
      errors.push({ field: key, reason: 'must_be_numeric', value });
      continue;
    }

    if (fieldMeta.type === 'integer' && !Number.isInteger(numVal)) {
      errors.push({ field: key, reason: 'must_be_integer', value });
      continue;
    }

    if (fieldMeta.min !== undefined && numVal < fieldMeta.min) {
      errors.push({ field: key, reason: 'below_minimum', min: fieldMeta.min, value });
    }
    if (fieldMeta.max !== undefined && numVal > fieldMeta.max) {
      errors.push({ field: key, reason: 'above_maximum', max: fieldMeta.max, value });
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateStrategyConfig };
