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

// ---- Import new strategy modules (each self-registers on require) ----
require('./RsiPivotStrategy');
require('./SupertrendStrategy');
require('./GridStrategy');
require('./BollingerReversionStrategy');
require('./MaTrendStrategy');
require('./FundingRateStrategy');
require('./AdaptiveRegimeStrategy');
require('./VwapReversionStrategy');
require('./MacdDivergenceStrategy');
require('./BreakoutStrategy');
require('./QuietRangeScalpStrategy');

module.exports = registry;
