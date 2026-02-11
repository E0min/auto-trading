'use strict';

/**
 * BotService — Strategy orchestrator managing the full bot lifecycle.
 *
 * Coordinates all sub-systems (exchange, risk, market data, strategies)
 * and exposes start / stop / pause / resume / emergencyStop methods.
 *
 * Emits bot-level events that the Socket.io layer forwards to the dashboard.
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const {
  BOT_STATES,
  MARKET_EVENTS,
  TRADE_EVENTS,
  CATEGORIES,
  WS_INST_TYPES,
} = require('../utils/constants');
const BotSession = require('../models/BotSession');
const { MomentumStrategy, MeanReversionStrategy } = require('./sampleStrategies');

const log = createLogger('BotService');

// ---------------------------------------------------------------------------
// BotService class
// ---------------------------------------------------------------------------

class BotService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('./exchangeClient')} deps.exchangeClient
   * @param {import('./riskEngine')}     deps.riskEngine
   * @param {import('./orderManager')}   deps.orderManager
   * @param {import('./positionManager')} deps.positionManager
   * @param {import('./marketData')}     deps.marketData
   * @param {import('./tickerAggregator')} deps.tickerAggregator
   * @param {import('./coinSelector')}   deps.coinSelector
   * @param {import('./marketRegime')}   deps.marketRegime
   */
  constructor({
    exchangeClient,
    riskEngine,
    orderManager,
    positionManager,
    marketData,
    tickerAggregator,
    coinSelector,
    marketRegime,
  }) {
    super();

    if (!exchangeClient) throw new Error('BotService requires exchangeClient');
    if (!riskEngine) throw new Error('BotService requires riskEngine');
    if (!orderManager) throw new Error('BotService requires orderManager');
    if (!positionManager) throw new Error('BotService requires positionManager');
    if (!marketData) throw new Error('BotService requires marketData');
    if (!tickerAggregator) throw new Error('BotService requires tickerAggregator');
    if (!coinSelector) throw new Error('BotService requires coinSelector');
    if (!marketRegime) throw new Error('BotService requires marketRegime');

    this.exchangeClient = exchangeClient;
    this.riskEngine = riskEngine;
    this.orderManager = orderManager;
    this.positionManager = positionManager;
    this.marketData = marketData;
    this.tickerAggregator = tickerAggregator;
    this.coinSelector = coinSelector;
    this.marketRegime = marketRegime;

    /** @type {object|null} Current BotSession Mongoose document */
    this.currentSession = null;

    /** @type {Array<import('./strategyBase')>} Active strategy instances */
    this.strategies = [];

    /** @type {boolean} */
    this._running = false;

    /** @type {string[]} Currently selected symbols */
    this._selectedSymbols = [];

    /** @type {Function[]} Listener cleanup references */
    this._eventCleanups = [];

    log.info('BotService initialised');
  }

  // =========================================================================
  // start
  // =========================================================================

  /**
   * Start the trading bot.
   *
   * @param {object} [config={}] — optional startup configuration
   * @param {string[]} [config.strategies] — strategy names to enable
   * @param {string}   [config.category]   — product type
   * @returns {Promise<object>} The created BotSession document
   */
  async start(config = {}) {
    if (this._running) {
      log.warn('start — bot is already running');
      return this.currentSession;
    }

    log.info('start — starting bot', { config });

    const category = config.category || CATEGORIES.USDT_FUTURES;

    // 1. Create new BotSession document
    this.currentSession = await BotSession.create({
      status: BOT_STATES.RUNNING,
      config: { ...config },
      startedAt: new Date(),
      strategies: [],
      symbols: [],
    });

    const sessionId = this.currentSession._id.toString();
    log.info('start — session created', { sessionId });

    try {
      // 2. Connect exchangeClient WebSockets
      this.exchangeClient.connectWebsockets();

      // 3. Subscribe to private channels (order, position, account, fill)
      this.exchangeClient.subscribePrivate([
        { topic: 'order', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'position', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'account', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'fill', payload: { instType: WS_INST_TYPES.PRIVATE } },
      ]);

      // 4. Start positionManager
      await this.positionManager.start(category);

      // 5. Start marketData, tickerAggregator, marketRegime
      this.marketData.start();
      this.tickerAggregator.start();
      this.marketRegime.start();

      // 6. Select coins via coinSelector
      const selectedCoins = await this.coinSelector.selectCoins(category);
      this._selectedSymbols = selectedCoins.map((c) => c.symbol);

      log.info('start — coins selected', { symbols: this._selectedSymbols });

      // 7. Subscribe to selected symbols' market data
      if (this._selectedSymbols.length > 0) {
        this.marketData.subscribeSymbols(this._selectedSymbols, category);
      }

      // 8. Initialize strategies from config
      this.strategies = this._createStrategies(config);

      // 9. Activate strategies on selected symbols
      for (const strategy of this.strategies) {
        for (const symbol of this._selectedSymbols) {
          strategy.activate(symbol, category);
        }
      }

      // 10. Wire up: marketData TICKER_UPDATE -> strategy.onTick
      const onTickerUpdate = (ticker) => {
        for (const strategy of this.strategies) {
          if (strategy.isActive() && strategy._symbol === ticker.symbol) {
            try {
              strategy.onTick(ticker);
            } catch (err) {
              log.error('Strategy onTick error', { strategy: strategy.name, error: err });
            }
          }
        }
      };
      this.marketData.on(MARKET_EVENTS.TICKER_UPDATE, onTickerUpdate);
      this._eventCleanups.push(() => {
        this.marketData.removeListener(MARKET_EVENTS.TICKER_UPDATE, onTickerUpdate);
      });

      // 11. Wire up: marketData KLINE_UPDATE -> strategy.onKline
      const onKlineUpdate = (kline) => {
        for (const strategy of this.strategies) {
          if (strategy.isActive() && strategy._symbol === kline.symbol) {
            try {
              strategy.onKline(kline);
            } catch (err) {
              log.error('Strategy onKline error', { strategy: strategy.name, error: err });
            }
          }
        }
      };
      this.marketData.on(MARKET_EVENTS.KLINE_UPDATE, onKlineUpdate);
      this._eventCleanups.push(() => {
        this.marketData.removeListener(MARKET_EVENTS.KLINE_UPDATE, onKlineUpdate);
      });

      // 12. Wire up: strategy SIGNAL_GENERATED -> orderManager.submitOrder
      for (const strategy of this.strategies) {
        const onSignal = (signal) => {
          this.orderManager.submitOrder({
            ...signal,
            qty: signal.suggestedQty || signal.qty,
            price: signal.suggestedPrice || signal.price,
            sessionId,
          }).catch((err) => {
            log.error('orderManager.submitOrder error from strategy signal', {
              strategy: strategy.name,
              error: err,
            });
          });
        };
        strategy.on(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);
        this._eventCleanups.push(() => {
          strategy.removeListener(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);
        });
      }

      // 13. Wire up: marketRegime REGIME_CHANGE -> update all strategies' regime
      const onRegimeChange = (context) => {
        log.info('Regime changed — updating strategies', {
          from: context.previous,
          to: context.current,
        });
        for (const strategy of this.strategies) {
          strategy.setMarketRegime(context.current);
        }
      };
      this.marketRegime.on(MARKET_EVENTS.REGIME_CHANGE, onRegimeChange);
      this._eventCleanups.push(() => {
        this.marketRegime.removeListener(MARKET_EVENTS.REGIME_CHANGE, onRegimeChange);
      });

      // 14. Update session with strategies and symbols
      const strategyNames = this.strategies.map((s) => s.name);
      this.currentSession.strategies = strategyNames;
      this.currentSession.symbols = this._selectedSymbols;
      await this.currentSession.save();

      // 15. Set _running = true
      this._running = true;

      log.info('start — bot started successfully', {
        sessionId,
        strategies: strategyNames,
        symbols: this._selectedSymbols,
      });

      return this.currentSession;
    } catch (err) {
      log.error('start — failed to start bot', { error: err });

      // Clean up on failure
      this.currentSession.status = BOT_STATES.ERROR;
      this.currentSession.stoppedAt = new Date();
      this.currentSession.stopReason = `start_error: ${err.message}`;
      await this.currentSession.save().catch(() => {});

      throw err;
    }
  }

  // =========================================================================
  // stop
  // =========================================================================

  /**
   * Stop the trading bot gracefully.
   *
   * @param {string} [reason='user_stop'] — reason for stopping
   * @returns {Promise<object|null>} The updated BotSession document
   */
  async stop(reason = 'user_stop') {
    if (!this._running && !this.currentSession) {
      log.warn('stop — bot is not running');
      return null;
    }

    log.info('stop — stopping bot', { reason });

    // 1. Set _running = false
    this._running = false;

    // 2. Deactivate all strategies
    for (const strategy of this.strategies) {
      try {
        strategy.deactivate();
      } catch (err) {
        log.error('stop — error deactivating strategy', { strategy: strategy.name, error: err });
      }
    }

    // 3. Clean up event wiring
    for (const cleanup of this._eventCleanups) {
      try {
        cleanup();
      } catch (err) {
        log.error('stop — error cleaning up event listener', { error: err });
      }
    }
    this._eventCleanups = [];

    // 4. Stop marketRegime, tickerAggregator, marketData
    try {
      this.marketRegime.stop();
    } catch (err) {
      log.error('stop — error stopping marketRegime', { error: err });
    }

    try {
      this.tickerAggregator.stop();
    } catch (err) {
      log.error('stop — error stopping tickerAggregator', { error: err });
    }

    try {
      this.marketData.stop();
    } catch (err) {
      log.error('stop — error stopping marketData', { error: err });
    }

    // 5. Stop positionManager
    try {
      this.positionManager.stop();
    } catch (err) {
      log.error('stop — error stopping positionManager', { error: err });
    }

    // 6. Close exchangeClient WebSockets
    try {
      this.exchangeClient.closeWebsockets();
    } catch (err) {
      log.error('stop — error closing WebSockets', { error: err });
    }

    // 7. Update BotSession
    if (this.currentSession) {
      try {
        this.currentSession.status = BOT_STATES.IDLE;
        this.currentSession.stoppedAt = new Date();
        this.currentSession.stopReason = reason;
        await this.currentSession.save();
      } catch (err) {
        log.error('stop — error updating session', { error: err });
      }
    }

    // 8. Clear strategy list
    this.strategies = [];
    this._selectedSymbols = [];

    log.info('stop — bot stopped', { reason });

    const session = this.currentSession;
    this.currentSession = null;
    return session;
  }

  // =========================================================================
  // pause
  // =========================================================================

  /**
   * Pause the bot — deactivate strategies but keep data flowing.
   *
   * @returns {Promise<object|null>}
   */
  async pause() {
    if (!this._running) {
      log.warn('pause — bot is not running');
      return null;
    }

    log.info('pause — pausing bot');

    // Deactivate strategies but keep market data flowing
    for (const strategy of this.strategies) {
      try {
        strategy.deactivate();
      } catch (err) {
        log.error('pause — error deactivating strategy', { strategy: strategy.name, error: err });
      }
    }

    this._running = false;

    if (this.currentSession) {
      this.currentSession.status = BOT_STATES.PAUSED;
      await this.currentSession.save();
    }

    log.info('pause — bot paused');
    return this.currentSession;
  }

  // =========================================================================
  // resume
  // =========================================================================

  /**
   * Resume the bot — reactivate strategies.
   *
   * @returns {Promise<object|null>}
   */
  async resume() {
    if (this._running) {
      log.warn('resume — bot is already running');
      return this.currentSession;
    }

    if (!this.currentSession) {
      log.warn('resume — no active session to resume');
      return null;
    }

    log.info('resume — resuming bot');

    const category = this.currentSession.config?.category || CATEGORIES.USDT_FUTURES;

    // Reactivate strategies on selected symbols
    for (const strategy of this.strategies) {
      for (const symbol of this._selectedSymbols) {
        try {
          strategy.activate(symbol, category);
        } catch (err) {
          log.error('resume — error activating strategy', { strategy: strategy.name, error: err });
        }
      }
    }

    this._running = true;

    if (this.currentSession) {
      this.currentSession.status = BOT_STATES.RUNNING;
      await this.currentSession.save();
    }

    log.info('resume — bot resumed');
    return this.currentSession;
  }

  // =========================================================================
  // emergencyStop
  // =========================================================================

  /**
   * Emergency stop — halt risk engine, cancel all orders, stop the bot.
   *
   * @returns {Promise<object|null>}
   */
  async emergencyStop() {
    log.error('EMERGENCY STOP triggered');

    // 1. Call riskEngine.emergencyStop()
    try {
      this.riskEngine.emergencyStop();
    } catch (err) {
      log.error('emergencyStop — riskEngine.emergencyStop failed', { error: err });
    }

    // 2. Cancel all open orders
    try {
      const category = this.currentSession?.config?.category || CATEGORIES.USDT_FUTURES;
      await this.exchangeClient.cancelAllOrders({ category });
    } catch (err) {
      log.error('emergencyStop — cancelAllOrders failed', { error: err });
    }

    // 3. Stop bot with emergency reason
    const session = await this.stop('emergency_stop');

    return session;
  }

  // =========================================================================
  // getStatus
  // =========================================================================

  /**
   * Return a snapshot of the current bot status.
   *
   * @returns {object}
   */
  getStatus() {
    return {
      running: this._running,
      sessionId: this.currentSession ? this.currentSession._id.toString() : null,
      status: this.currentSession ? this.currentSession.status : BOT_STATES.IDLE,
      strategies: this.strategies.map((s) => ({
        name: s.name,
        active: s.isActive(),
        symbol: s._symbol,
      })),
      symbols: this._selectedSymbols,
      riskStatus: this.riskEngine.getStatus(),
    };
  }

  // =========================================================================
  // Internal — Strategy factory
  // =========================================================================

  /**
   * Create strategy instances based on config. Defaults to both
   * MomentumStrategy and MeanReversionStrategy.
   *
   * @param {object} config
   * @returns {Array<import('./strategyBase')>}
   * @private
   */
  _createStrategies(config) {
    const strategyNames = config.strategies || ['MomentumStrategy', 'MeanReversionStrategy'];
    const strategies = [];

    for (const name of strategyNames) {
      try {
        let strategy;
        switch (name) {
          case 'MomentumStrategy':
            strategy = new MomentumStrategy(config.momentumConfig || {});
            break;
          case 'MeanReversionStrategy':
            strategy = new MeanReversionStrategy(config.meanReversionConfig || {});
            break;
          default:
            log.warn('_createStrategies — unknown strategy name, skipping', { name });
            continue;
        }
        strategies.push(strategy);
        log.info('_createStrategies — strategy created', { name });
      } catch (err) {
        log.error('_createStrategies — failed to create strategy', { name, error: err });
      }
    }

    return strategies;
  }
}

module.exports = BotService;
