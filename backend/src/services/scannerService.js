'use strict';

/**
 * ScannerService — wrapper around CoinSelector + MarketRegime.
 *
 * Provides a thin facade for the API routes to call without needing to
 * know about the underlying service instantiation details.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('ScannerService');

/** @type {import('./coinSelector')|null} */
let _coinSelector = null;

/** @type {import('./marketRegime')|null} */
let _marketRegime = null;

const scannerService = {
  /**
   * Initialize with dependency references.
   *
   * @param {object} deps
   * @param {import('./coinSelector')} deps.coinSelector
   * @param {import('./marketRegime')} deps.marketRegime
   */
  init({ coinSelector, marketRegime }) {
    if (!coinSelector) throw new Error('scannerService.init: coinSelector is required');
    if (!marketRegime) throw new Error('scannerService.init: marketRegime is required');

    _coinSelector = coinSelector;
    _marketRegime = marketRegime;

    log.info('ScannerService initialised');
  },

  /**
   * Scan for trading opportunities based on the given category.
   *
   * @param {string} [category] — product type filter
   * @returns {Promise<Array<object>>} Array of selected coin objects
   */
  async scanForOpportunities(category) {
    if (!_coinSelector) throw new Error('scannerService not initialised — call init() first');
    return _coinSelector.selectCoins(category);
  },

  /**
   * Get the current market regime label.
   *
   * @returns {string}
   */
  getMarketRegime() {
    if (!_marketRegime) throw new Error('scannerService not initialised — call init() first');
    return _marketRegime.getCurrentRegime();
  },

  /**
   * Get the full regime context for diagnostics.
   *
   * @returns {object}
   */
  getRegimeContext() {
    if (!_marketRegime) throw new Error('scannerService not initialised — call init() first');
    return _marketRegime.getContext();
  },
};

module.exports = scannerService;
