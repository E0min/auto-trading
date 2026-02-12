'use strict';

/**
 * Strategy index — imports all strategy modules to trigger their
 * self-registration with the StrategyRegistry, then re-exports
 * the registry singleton for convenient access.
 *
 * Each require is wrapped in try-catch so that a single strategy
 * failing to load does not crash the entire server.
 *
 * Usage:
 *   const registry = require('./strategies');
 *   const names = registry.list(); // → ['MomentumStrategy', ..., 'FundingRateStrategy']
 *   const s = registry.create('RsiPivotStrategy', { rsiOversold: 25 });
 */

const registry = require('../services/strategyRegistry');
const { createLogger } = require('../utils/logger');

const log = createLogger('StrategyIndex');

// ---- Helper: safe require with error logging ----
function safeRequire(path, name) {
  try {
    return require(path);
  } catch (err) {
    log.error(`Failed to load strategy: ${name}`, { path, error: err.message });
    return null;
  }
}

// ---- Import existing sample strategies (backward compatibility) ----
try {
  const { MomentumStrategy, MeanReversionStrategy } = require('../services/sampleStrategies');
  registry.register('MomentumStrategy', MomentumStrategy);
  registry.register('MeanReversionStrategy', MeanReversionStrategy);
} catch (err) {
  log.error('Failed to load legacy sample strategies', { error: err.message });
}

// ---- price-action (순수 가격행동) ----
safeRequire('./price-action/TurtleBreakoutStrategy', 'TurtleBreakoutStrategy');
safeRequire('./price-action/CandlePatternStrategy', 'CandlePatternStrategy');
safeRequire('./price-action/SupportResistanceStrategy', 'SupportResistanceStrategy');
safeRequire('./price-action/SwingStructureStrategy', 'SwingStructureStrategy');
safeRequire('./price-action/FibonacciRetracementStrategy', 'FibonacciRetracementStrategy');

// ---- indicator-light (1~2 지표) ----
safeRequire('./indicator-light/GridStrategy', 'GridStrategy');
safeRequire('./indicator-light/MaTrendStrategy', 'MaTrendStrategy');
safeRequire('./indicator-light/FundingRateStrategy', 'FundingRateStrategy');
safeRequire('./indicator-light/RsiPivotStrategy', 'RsiPivotStrategy');
safeRequire('./indicator-light/SupertrendStrategy', 'SupertrendStrategy');
safeRequire('./indicator-light/BollingerReversionStrategy', 'BollingerReversionStrategy');
safeRequire('./indicator-light/VwapReversionStrategy', 'VwapReversionStrategy');
safeRequire('./indicator-light/MacdDivergenceStrategy', 'MacdDivergenceStrategy');

// ---- indicator-heavy (3+ 지표) ----
safeRequire('./indicator-heavy/QuietRangeScalpStrategy', 'QuietRangeScalpStrategy');
safeRequire('./indicator-heavy/BreakoutStrategy', 'BreakoutStrategy');
safeRequire('./indicator-heavy/AdaptiveRegimeStrategy', 'AdaptiveRegimeStrategy');

log.info(`Strategy index loaded — ${registry.list().length} strategies registered`);

module.exports = registry;
