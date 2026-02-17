'use strict';

const { getParamMeta } = require('./strategyParamMeta');

/**
 * R14-7 (AD-14-4): Hardcoded common config field validation rules for Custom_ strategies.
 * Applied when the strategy has no registered paramMeta (i.e. custom strategies).
 */
const CUSTOM_STRATEGY_COMMON_RULES = {
  positionSizePercent: { type: 'number', min: 1, max: 20 },
  leverage:           { type: 'number', min: 1, max: 20 },
  tpPercent:          { type: 'number', min: 0.5, max: 50 },
  slPercent:          { type: 'number', min: 0.5, max: 20 },
};

/**
 * Validate strategy config values against paramMeta min/max/type constraints.
 * For Custom_ strategies without paramMeta, uses hardcoded common field rules (R14-7).
 * @param {string} strategyName
 * @param {object} newConfig — key-value pairs to validate
 * @returns {{ valid: boolean, errors: Array<{field, reason, min?, max?, value?}> }}
 */
function validateStrategyConfig(strategyName, newConfig) {
  const meta = getParamMeta(strategyName);

  // R14-7: If no paramMeta and it's a Custom_ strategy, apply common rules
  if ((!meta || meta.length === 0) && strategyName.startsWith('Custom_')) {
    return _validateCustomStrategyConfig(newConfig);
  }

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

/**
 * R14-7: Validate common config fields for Custom_ strategies.
 * Only validates known fields; unknown fields are allowed (custom strategies may have arbitrary params).
 * @param {object} config
 * @returns {{ valid: boolean, errors: Array<{field, reason, min?, max?, value?}> }}
 * @private
 */
function _validateCustomStrategyConfig(config) {
  const errors = [];

  for (const [key, value] of Object.entries(config)) {
    const rule = CUSTOM_STRATEGY_COMMON_RULES[key];
    if (!rule) continue; // unknown fields are allowed for custom strategies

    const numVal = parseFloat(String(value));
    if (isNaN(numVal)) {
      errors.push({ field: key, reason: 'must_be_numeric', value });
      continue;
    }

    if (rule.min !== undefined && numVal < rule.min) {
      errors.push({ field: key, reason: 'below_minimum', min: rule.min, value });
    }
    if (rule.max !== undefined && numVal > rule.max) {
      errors.push({ field: key, reason: 'above_maximum', max: rule.max, value });
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateStrategyConfig };
