'use strict';

/**
 * Strategy index — imports all strategy modules to trigger their
 * self-registration with the StrategyRegistry, then re-exports
 * the registry singleton for convenient access.
 *
 * Usage:
 *   const registry = require('./strategies');
 *   const names = registry.list(); // → ['MomentumStrategy', ..., 'FundingRateStrategy']
 *   const s = registry.create('RsiPivotStrategy', { rsiOversold: 25 });
 */

const registry = require('../services/strategyRegistry');

// ---- Import existing sample strategies (backward compatibility) ----
const { MomentumStrategy, MeanReversionStrategy } = require('../services/sampleStrategies');

// Register the two legacy strategies so they are available via the registry
registry.register('MomentumStrategy', MomentumStrategy);
registry.register('MeanReversionStrategy', MeanReversionStrategy);

// ---- price-action (순수 가격행동) ----
require('./price-action/TurtleBreakoutStrategy');
require('./price-action/CandlePatternStrategy');
require('./price-action/SupportResistanceStrategy');
require('./price-action/SwingStructureStrategy');
require('./price-action/FibonacciRetracementStrategy');

// ---- indicator-light (1~2 지표) ----
require('./indicator-light/GridStrategy');
require('./indicator-light/MaTrendStrategy');
require('./indicator-light/FundingRateStrategy');
require('./indicator-light/RsiPivotStrategy');
require('./indicator-light/SupertrendStrategy');
require('./indicator-light/BollingerReversionStrategy');
require('./indicator-light/VwapReversionStrategy');
require('./indicator-light/MacdDivergenceStrategy');

// ---- indicator-heavy (3+ 지표) ----
require('./indicator-heavy/QuietRangeScalpStrategy');
require('./indicator-heavy/BreakoutStrategy');
require('./indicator-heavy/AdaptiveRegimeStrategy');

module.exports = registry;
