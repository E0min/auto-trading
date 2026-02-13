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
const registry = require('../strategies');

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
    strategyRouter,
    signalFilter,
    paperEngine,
    paperPositionManager,
    paperMode,
    indicatorCache,
    regimeEvaluator,
    regimeOptimizer,
    symbolRegimeManager,
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

    /** @type {import('./strategyRouter')|null} */
    this.strategyRouter = strategyRouter || null;

    /** @type {import('./signalFilter')|null} */
    this.signalFilter = signalFilter || null;

    /** @type {import('./paperEngine')|null} */
    this.paperEngine = paperEngine || null;

    /** @type {import('./paperPositionManager')|null} */
    this.paperPositionManager = paperPositionManager || null;

    /** @type {boolean} */
    this.paperMode = paperMode || false;

    /** @type {import('./indicatorCache')|null} */
    this.indicatorCache = indicatorCache || null;

    /** @type {import('./regimeEvaluator')|null} */
    this.regimeEvaluator = regimeEvaluator || null;

    /** @type {import('./regimeOptimizer')|null} */
    this.regimeOptimizer = regimeOptimizer || null;

    /** @type {import('./symbolRegimeManager')|null} */
    this.symbolRegimeManager = symbolRegimeManager || null;

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

    log.info('BotService initialised', { paperMode: this.paperMode });
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

      // 5. Start marketData, indicatorCache, tickerAggregator, marketRegime
      this.marketData.start();
      if (this.indicatorCache) {
        this.indicatorCache.start();
      }
      this.tickerAggregator.start();
      this.marketRegime.start();

      // 5b. Start regimeEvaluator and regimeOptimizer
      if (this.regimeEvaluator) {
        this.regimeEvaluator.start();
      }
      if (this.regimeOptimizer) {
        this.regimeOptimizer.start();
      }

      // 6. Select coins via coinSelector
      const selectedCoins = await this.coinSelector.selectCoins(category);
      this._selectedSymbols = selectedCoins.map((c) => c.symbol);

      log.info('start — coins selected', { symbols: this._selectedSymbols });

      // 7. Subscribe to selected symbols' market data
      //    Always include BTCUSDT — MarketRegime depends on BTC kline data
      if (!this._selectedSymbols.includes('BTCUSDT')) {
        this._selectedSymbols.unshift('BTCUSDT');
      }
      this.marketData.subscribeSymbols(this._selectedSymbols, category);

      // 8. Initialize strategies from config
      this.strategies = this._createStrategies(config);

      // 9. Register strategies with SignalFilter (metadata for cooldown/maxConcurrent)
      if (this.signalFilter) {
        this.signalFilter.reset();
        for (const strategy of this.strategies) {
          const meta = strategy.getMetadata();
          this.signalFilter.registerStrategy(strategy.name, {
            cooldownMs: meta.cooldownMs,
            maxConcurrentPositions: meta.maxConcurrentPositions,
          });
        }
      }

      // 10. Start StrategyRouter — handles regime-based activate/deactivate
      //     If no router, fall back to activating all strategies immediately
      if (this.strategyRouter) {
        this.strategyRouter.start(this.strategies, this._selectedSymbols, category);
        this._eventCleanups.push(() => {
          this.strategyRouter.stop();
        });
      } else {
        // Legacy: activate all strategies on all symbols
        for (const strategy of this.strategies) {
          for (const symbol of this._selectedSymbols) {
            strategy.activate(symbol, category);
          }
        }
      }

      // 10b. Start SymbolRegimeManager for per-symbol regime tracking
      if (this.symbolRegimeManager) {
        const nonBtcSymbols = this._selectedSymbols.filter((s) => s !== 'BTCUSDT');
        this.symbolRegimeManager.start(nonBtcSymbols);

        const onSymbolRegimeChange = (payload) => {
          for (const strategy of this.strategies) {
            strategy.setSymbolRegime(payload.symbol, payload.current);
          }
        };
        this.symbolRegimeManager.on('symbol:regime_change', onSymbolRegimeChange);
        this._eventCleanups.push(() => {
          this.symbolRegimeManager.removeListener('symbol:regime_change', onSymbolRegimeChange);
        });
      }

      // 11. Wire up: marketData TICKER_UPDATE -> strategy.onTick
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

      // 11b. Wire up: marketData KLINE_UPDATE -> strategy.onKline
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

      // 11c. Paper mode: wire ticker -> paperEngine + paperPositionManager
      if (this.paperMode && this.paperEngine) {
        const onPaperTicker = (ticker) => {
          const sym = ticker.symbol;
          const price = ticker.lastPrice || ticker.last || ticker.price;
          if (!sym || !price) return;

          this.paperEngine.onTickerUpdate(sym, ticker);
          if (this.paperPositionManager) {
            this.paperPositionManager.updateMarkPrice(sym, String(price));
          }
        };
        this.marketData.on(MARKET_EVENTS.TICKER_UPDATE, onPaperTicker);
        this._eventCleanups.push(() => {
          this.marketData.removeListener(MARKET_EVENTS.TICKER_UPDATE, onPaperTicker);
        });
      }

      // 12. Wire up: strategy SIGNAL_GENERATED -> SignalFilter -> OrderManager
      for (const strategy of this.strategies) {
        const onSignal = (signal) => {
          // Pass through SignalFilter first (if available)
          if (this.signalFilter) {
            const result = this.signalFilter.filter(signal);
            if (!result.passed) {
              log.debug('Signal filtered out', {
                strategy: strategy.name,
                symbol: signal.symbol,
                action: signal.action,
                reason: result.reason,
              });
              return;
            }
          }

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

      // 13. If no StrategyRouter, use legacy regime change handler
      if (!this.strategyRouter) {
        const onRegimeChange = (context) => {
          log.info('Regime changed — updating strategies (legacy)', {
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
      }

      // 14. Update session with strategies and symbols
      const strategyNames = this.strategies.map((s) => s.name);
      this.currentSession.strategies = strategyNames;
      this.currentSession.symbols = this._selectedSymbols;
      await this.currentSession.save();

      // 14b. Auto-start tournament if paperPositionManager supports it
      if (this.paperMode && this.paperPositionManager && typeof this.paperPositionManager.startTournament === 'function') {
        this.paperPositionManager.startTournament(strategyNames);
      }

      // 14c. Paper mode: sync initial balance to RiskEngine so ExposureGuard has equity > 0
      if (this.paperMode && this.paperPositionManager) {
        this.riskEngine.updateAccountState({
          equity: this.paperPositionManager.getEquity(),
          positions: this.paperPositionManager.getPositions(),
        });
      }

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

    // 3b. Stop regimeOptimizer and regimeEvaluator
    if (this.regimeOptimizer) {
      try {
        this.regimeOptimizer.stop();
      } catch (err) {
        log.error('stop — error stopping regimeOptimizer', { error: err });
      }
    }

    if (this.regimeEvaluator) {
      try {
        this.regimeEvaluator.stop();
      } catch (err) {
        log.error('stop — error stopping regimeEvaluator', { error: err });
      }
    }

    // 3c. Stop symbolRegimeManager
    if (this.symbolRegimeManager) {
      try {
        this.symbolRegimeManager.stop();
      } catch (err) {
        log.error('stop — error stopping symbolRegimeManager', { error: err });
      }
    }

    // 4. Stop indicatorCache, marketRegime, tickerAggregator, marketData
    if (this.indicatorCache) {
      try {
        this.indicatorCache.stop();
      } catch (err) {
        log.error('stop — error stopping indicatorCache', { error: err });
      }
    }

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

    // 7b. Auto-stop tournament if paperPositionManager supports it
    if (this.paperMode && this.paperPositionManager && typeof this.paperPositionManager.stopTournament === 'function') {
      this.paperPositionManager.stopTournament();
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
  // setTradingMode
  // =========================================================================

  /**
   * Switch between paper and live trading modes at runtime.
   * Bot must be stopped before switching.
   *
   * @param {'paper'|'live'} mode
   * @throws {Error} if bot is currently running
   */
  setTradingMode(mode) {
    if (this._running) {
      throw new Error('봇이 실행 중입니다. 먼저 정지해주세요.');
    }

    if (mode === 'paper') {
      if (this.paperEngine && this.paperPositionManager) {
        this.orderManager.setPaperMode(this.paperEngine, this.paperPositionManager);
      }
      this.paperMode = true;
      log.info('setTradingMode — switched to paper trading');
    } else if (mode === 'live') {
      this.orderManager.setLiveMode();
      this.paperMode = false;
      log.info('setTradingMode — switched to live trading');
    } else {
      throw new Error(`Invalid trading mode: ${mode}`);
    }
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
    const status = {
      running: this._running,
      sessionId: this.currentSession ? this.currentSession._id.toString() : null,
      status: this.currentSession ? this.currentSession.status : BOT_STATES.IDLE,
      strategies: this.strategies.map((s) => ({
        name: s.name,
        active: s.isActive(),
        symbol: s._symbol,
        config: s.getConfig(),
        lastSignal: s.getSignal(),
        targetRegimes: s.getTargetRegimes(),
      })),
      symbols: this._selectedSymbols,
      registeredStrategies: registry.list(),
      riskStatus: this.riskEngine.getStatus(),
      paperMode: this.paperMode,
      tradingMode: this.paperMode ? 'paper' : 'live',
      regime: {
        regime: this.marketRegime.getCurrentRegime(),
        confidence: this.marketRegime.getConfidence(),
        timestamp: Date.now(),
      },
    };

    // Include per-symbol regimes
    if (this.symbolRegimeManager) {
      status.symbolRegimes = this.symbolRegimeManager.getAllRegimes();
    }

    // Include StrategyRouter status
    if (this.strategyRouter) {
      status.router = this.strategyRouter.getStatus();
    }

    // Include SignalFilter stats
    if (this.signalFilter) {
      status.signalFilter = this.signalFilter.getStats();
    }

    // Include RegimeEvaluator accuracy
    if (this.regimeEvaluator) {
      status.regimeAccuracy = this.regimeEvaluator.getAccuracyMetrics();
    }

    // Include RegimeOptimizer status
    if (this.regimeOptimizer) {
      status.regimeOptimizer = this.regimeOptimizer.getStatus();
    }

    if (this.paperMode && this.paperPositionManager) {
      status.paperAccount = this.paperPositionManager.getAccountState();

      // Include tournament info if available
      if (typeof this.paperPositionManager.getTournamentInfo === 'function') {
        status.tournament = this.paperPositionManager.getTournamentInfo();
        status.leaderboard = this.paperPositionManager.getLeaderboard();
      }
    }

    return status;
  }

  // =========================================================================
  // enableStrategy / disableStrategy — runtime strategy management
  // =========================================================================

  /**
   * Enable a strategy by name at runtime. Creates a new instance and wires
   * it into the current event loop.
   *
   * @param {string} name — registered strategy name
   * @param {object} [config={}] — strategy-specific configuration
   * @returns {boolean} true if successfully enabled
   */
  enableStrategy(name, config = {}) {
    if (!this._running) {
      log.warn('enableStrategy — bot is not running');
      return false;
    }

    if (!registry.has(name)) {
      log.warn('enableStrategy — unknown strategy', { name });
      return false;
    }

    // Prevent duplicate
    if (this.strategies.some((s) => s.name === name)) {
      log.warn('enableStrategy — strategy already active', { name });
      return false;
    }

    try {
      const strategy = registry.create(name, config);
      if (this.indicatorCache) {
        strategy.setIndicatorCache(this.indicatorCache);
      }

      // Register with SignalFilter
      if (this.signalFilter) {
        const meta = strategy.getMetadata();
        this.signalFilter.registerStrategy(name, {
          cooldownMs: meta.cooldownMs,
          maxConcurrentPositions: meta.maxConcurrentPositions,
        });
      }

      // Add to strategy list
      this.strategies.push(strategy);

      // Let StrategyRouter decide activation based on regime
      if (this.strategyRouter) {
        this.strategyRouter.refresh();
      } else {
        // Legacy: activate immediately
        const category = this.currentSession?.config?.category || CATEGORIES.USDT_FUTURES;
        for (const symbol of this._selectedSymbols) {
          strategy.activate(symbol, category);
        }
        if (this.marketRegime._currentRegime) {
          strategy.setMarketRegime(this.marketRegime._currentRegime);
        }
      }

      // Wire signal handler (with filter)
      const sessionId = this.currentSession ? this.currentSession._id.toString() : null;
      const onSignal = (signal) => {
        if (this.signalFilter) {
          const result = this.signalFilter.filter(signal);
          if (!result.passed) return;
        }

        this.orderManager.submitOrder({
          ...signal,
          qty: signal.suggestedQty || signal.qty,
          price: signal.suggestedPrice || signal.price,
          sessionId,
        }).catch((err) => {
          log.error('orderManager.submitOrder error from strategy signal', {
            strategy: name,
            error: err,
          });
        });
      };
      strategy.on(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);
      this._eventCleanups.push(() => {
        strategy.removeListener(TRADE_EVENTS.SIGNAL_GENERATED, onSignal);
      });

      log.info('enableStrategy — strategy enabled', { name });
      return true;
    } catch (err) {
      log.error('enableStrategy — failed', { name, error: err });
      return false;
    }
  }

  /**
   * Disable a strategy by name at runtime. Deactivates and removes it
   * from the active strategy list.
   *
   * @param {string} name — strategy name to disable
   * @returns {boolean} true if successfully disabled
   */
  disableStrategy(name) {
    if (!this._running) {
      log.warn('disableStrategy — bot is not running');
      return false;
    }

    const idx = this.strategies.findIndex((s) => s.name === name);
    if (idx === -1) {
      log.warn('disableStrategy — strategy not found in active list', { name });
      return false;
    }

    try {
      const strategy = this.strategies[idx];
      strategy.deactivate();
      strategy.removeAllListeners(TRADE_EVENTS.SIGNAL_GENERATED);
      this.strategies.splice(idx, 1);

      log.info('disableStrategy — strategy disabled', { name });
      return true;
    } catch (err) {
      log.error('disableStrategy — failed', { name, error: err });
      return false;
    }
  }

  // =========================================================================
  // Internal — Strategy factory
  // =========================================================================

  /**
   * Create strategy instances based on config using the strategy registry.
   * Defaults to MomentumStrategy and MeanReversionStrategy when
   * config.strategies is not specified (backward compatibility).
   *
   * Per-strategy config can be passed as `config.<strategyName>Config`
   * (e.g. `config.rsiPivotConfig`) or using the camelCase form of the
   * strategy name.
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
        if (!registry.has(name)) {
          log.warn('_createStrategies — unknown strategy name, skipping', { name });
          continue;
        }

        // Resolve per-strategy config: try <name>Config, then <camelCase>Config
        const configKey = name.charAt(0).toLowerCase() + name.slice(1) + 'Config';
        const strategyConfig = config[configKey] || config[name + 'Config'] || {};

        const strategy = registry.create(name, strategyConfig);
        if (this.indicatorCache) {
          strategy.setIndicatorCache(this.indicatorCache);
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
