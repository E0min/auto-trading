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
  SIGNAL_ACTIONS,
} = require('../utils/constants');
const math = require('../utils/mathUtils');
const BotSession = require('../models/BotSession');
const Snapshot = require('../models/Snapshot');
const registry = require('../strategies');

/** Snapshot generation interval (ms) — AD-52 */
const SNAPSHOT_INTERVAL_MS = 60_000;

/** Coin reselection interval (ms) — AD-56, R8-T2-4: 4 hours */
const COIN_RESELECTION_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
    instrumentCache,
    fundingDataService,
    stateRecovery,
    orphanOrderCleanup,
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

    /** @type {Set<string>} Strategies disabled in graceful mode — blocks new entries */
    this._gracefulDisabledStrategies = new Set();

    /** @type {import('./indicatorCache')|null} */
    this.indicatorCache = indicatorCache || null;

    /** @type {import('./regimeEvaluator')|null} */
    this.regimeEvaluator = regimeEvaluator || null;

    /** @type {import('./regimeOptimizer')|null} */
    this.regimeOptimizer = regimeOptimizer || null;

    /** @type {import('./symbolRegimeManager')|null} */
    this.symbolRegimeManager = symbolRegimeManager || null;

    /** @type {import('./instrumentCache')|null} */
    this.instrumentCache = instrumentCache || null;

    /** @type {import('./fundingDataService')|null} */
    this.fundingDataService = fundingDataService || null;

    /** @type {import('./stateRecovery')|null} R8-T2-6 */
    this.stateRecovery = stateRecovery || null;

    /** @type {import('./orphanOrderCleanup')|null} R8-T2-6 */
    this.orphanOrderCleanup = orphanOrderCleanup || null;

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

    /** @type {NodeJS.Timeout|null} Snapshot generation timer (AD-52, R8-T1-2) */
    this._snapshotInterval = null;

    /** @type {Map<string, string>} R8-T0-5: strategy-position mapping (key = `${symbol}:${side}`, value = strategyName) */
    this._strategyPositionMap = new Map();

    /** @type {Map<string, string>} R8-T2-3: cumulative funding PnL per position (key = `${symbol}:${side}`, value = total funding as String) */
    this._positionFundingMap = new Map();

    /** @type {NodeJS.Timeout|null} R8-T2-4: Coin reselection timer (AD-56) */
    this._reselectionTimer = null;

    /** @type {boolean} R8-T2-4: Guard flag to prevent concurrent reselections */
    this._reselectionInProgress = false;

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

    const startedServices = [];

    try {
      // 2. Connect exchangeClient WebSockets
      this.exchangeClient.connectWebsockets();
      startedServices.push('exchangeClient.ws');

      // 3. Subscribe to private channels (order, position, account, fill)
      this.exchangeClient.subscribePrivate([
        { topic: 'order', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'position', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'account', payload: { instType: WS_INST_TYPES.PRIVATE } },
        { topic: 'fill', payload: { instType: WS_INST_TYPES.PRIVATE } },
      ]);

      // 4. Start positionManager
      await this.positionManager.start(category);
      startedServices.push('positionManager');

      // 4b. Refresh InstrumentCache (R9-T1: per-symbol lot step)
      if (this.instrumentCache) {
        await this.instrumentCache.refresh(category);
        this.instrumentCache.startAutoRefresh(category);
        startedServices.push('instrumentCache');
      }

      // 4c. State recovery — reconcile DB vs exchange (R8-T2-6, live mode only)
      if (this.stateRecovery && !this.paperMode) {
        try {
          const recoveryResult = await this.stateRecovery.recover(category);
          log.info('State recovery completed', recoveryResult);
        } catch (err) {
          log.error('State recovery failed (non-fatal)', { error: err.message });
          // NOT fatal — continue startup
        }
      }

      // 5. Start marketData, indicatorCache, tickerAggregator, marketRegime
      this.marketData.start();
      startedServices.push('marketData');
      if (this.indicatorCache) {
        this.indicatorCache.start();
        startedServices.push('indicatorCache');
      }
      this.tickerAggregator.start();
      startedServices.push('tickerAggregator');
      this.marketRegime.start();
      startedServices.push('marketRegime');

      // 5b. Start regimeEvaluator and regimeOptimizer
      if (this.regimeEvaluator) {
        this.regimeEvaluator.start();
        startedServices.push('regimeEvaluator');
      }
      if (this.regimeOptimizer) {
        this.regimeOptimizer.start();
        startedServices.push('regimeOptimizer');
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

      // 9. Register strategies with SignalFilter (metadata for cooldown/maxConcurrent/confidence)
      if (this.signalFilter) {
        this.signalFilter.reset();
        for (const strategy of this.strategies) {
          const meta = strategy.getMetadata();
          this.signalFilter.registerStrategy(strategy.name, {
            cooldownMs: meta.cooldownMs,
            maxConcurrentPositions: meta.maxConcurrentPositions,
            riskLevel: meta.riskLevel,
            minConfidence: meta.minConfidence,
          });
        }
      }

      // 10. Start StrategyRouter — handles regime-based activate/deactivate
      //     If no router, fall back to activating all strategies immediately
      if (this.strategyRouter) {
        this.strategyRouter.start(this.strategies, this._selectedSymbols, category);
        startedServices.push('strategyRouter');
        this._eventCleanups.push(() => {
          this.strategyRouter.stop();
        });

        // AD-55: Assign per-strategy symbols after start — reassigns active strategies
        if (selectedCoins.length > 0) {
          this.strategyRouter.assignSymbols(
            this._selectedSymbols,
            selectedCoins,
            (strategyName) => this._strategyHasOpenPosition(strategyName),
          );
        }

        // Grace period events → socket.io (R7-C3, AD-45)
        const onGraceStarted = (data) => { this.emit('strategy:grace_started', data); };
        const onGraceCancelled = (data) => { this.emit('strategy:grace_cancelled', data); };
        const onStratDeactivated = (data) => { this.emit('strategy:deactivated', data); };

        this.strategyRouter.on('strategy:grace_started', onGraceStarted);
        this.strategyRouter.on('strategy:grace_cancelled', onGraceCancelled);
        this.strategyRouter.on('strategy:deactivated', onStratDeactivated);
        this._eventCleanups.push(() => {
          this.strategyRouter.removeListener('strategy:grace_started', onGraceStarted);
          this.strategyRouter.removeListener('strategy:grace_cancelled', onGraceCancelled);
          this.strategyRouter.removeListener('strategy:deactivated', onStratDeactivated);
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
        startedServices.push('symbolRegimeManager');

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

      // 10c. Start FundingDataService and wire funding updates to strategies (T2-4)
      if (this.fundingDataService) {
        this.fundingDataService.start(this._selectedSymbols);
        startedServices.push('fundingDataService');

        const onFundingUpdate = (data) => {
          for (const strategy of this.strategies) {
            if (typeof strategy.onFundingUpdate === 'function') {
              try {
                strategy.onFundingUpdate(data);
              } catch (err) {
                log.error('Strategy onFundingUpdate error', { strategy: strategy.name, error: err.message });
              }
            }
          }
        };
        this.fundingDataService.on(MARKET_EVENTS.FUNDING_UPDATE, onFundingUpdate);
        this._eventCleanups.push(() => {
          this.fundingDataService.removeListener(MARKET_EVENTS.FUNDING_UPDATE, onFundingUpdate);
        });
      }

      // 10d. Wire up: fundingDataService → funding PnL accumulation per position (R8-T2-3)
      if (this.fundingDataService) {
        const onFundingForPositions = (data) => {
          if (!data || !data.symbol || !data.fundingRate) return;
          const symbol = data.symbol;
          const fundingRate = data.fundingRate;

          if (this.paperMode && this.paperPositionManager) {
            // Paper mode: delegate to PaperPositionManager.applyFunding
            this.paperPositionManager.applyFunding(symbol, fundingRate);
          } else {
            // Live mode: accumulate in _positionFundingMap
            this._accumulateLiveFunding(symbol, fundingRate);
          }
        };
        this.fundingDataService.on(MARKET_EVENTS.FUNDING_UPDATE, onFundingForPositions);
        this._eventCleanups.push(() => {
          this.fundingDataService.removeListener(MARKET_EVENTS.FUNDING_UPDATE, onFundingForPositions);
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

      // 11b. Wire up: marketData KLINE_UPDATE -> strategy.trackKline + strategy.onKline
      const onKlineUpdate = (kline) => {
        for (const strategy of this.strategies) {
          if (strategy.isActive() && strategy._symbol === kline.symbol) {
            // R9-T2: Track kline for warm-up progress (before onKline)
            if (typeof strategy.trackKline === 'function') {
              strategy.trackKline();
            }
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

      // 11d. Wire up: ORDER_FILLED / ORDER_CANCELLED -> update SignalFilter position counts
      if (this.signalFilter) {
        const updateFilterCounts = () => {
          setImmediate(() => {
            const positions = this.paperMode && this.paperPositionManager
              ? this.paperPositionManager.getPositions()
              : this.positionManager.getPositions();

            // Count positions per strategy
            const countsByStrategy = {};
            for (const pos of positions) {
              const strat = pos.strategy || 'unknown';
              countsByStrategy[strat] = (countsByStrategy[strat] || 0) + 1;
            }

            // Update all registered strategies (set to 0 if no positions)
            for (const strategy of this.strategies) {
              const count = countsByStrategy[strategy.name] || 0;
              this.signalFilter.updatePositionCount(strategy.name, count);
            }
          });
        };

        const onOrderFilled = () => updateFilterCounts();
        const onOrderCancelled = () => updateFilterCounts();

        this.orderManager.on(TRADE_EVENTS.ORDER_FILLED, onOrderFilled);
        this.orderManager.on(TRADE_EVENTS.ORDER_CANCELLED, onOrderCancelled);
        this._eventCleanups.push(() => {
          this.orderManager.removeListener(TRADE_EVENTS.ORDER_FILLED, onOrderFilled);
          this.orderManager.removeListener(TRADE_EVENTS.ORDER_CANCELLED, onOrderCancelled);
        });

        // Initial count after strategy activation
        updateFilterCounts();
      }

      // 11e. Wire up: ORDER_FILLED -> BotSession stats update (R8-T1-3)
      const onOrderFilledStats = (data) => {
        this._updateSessionStats(data).catch((err) => {
          log.error('BotSession stats update failed', { error: err.message });
        });
      };
      this.orderManager.on(TRADE_EVENTS.ORDER_FILLED, onOrderFilledStats);
      this._eventCleanups.push(() => {
        this.orderManager.removeListener(TRADE_EVENTS.ORDER_FILLED, onOrderFilledStats);
      });

      // 11f. Wire up: ORDER_FILLED -> strategy-position mapping + funding removal (R8-T0-5, R8-T2-3)
      const onOrderFilledMapping = (data) => {
        if (!data || !data.trade) return;
        const trade = data.trade;
        // Remove mapping when a close/reduceOnly order fills
        if (trade.reduceOnly) {
          const side = trade.posSide || (trade.side === 'sell' ? 'long' : 'short');
          this._removeStrategyPositionMapping(trade.symbol, side);
          // R8-T2-3: Remove funding PnL tracking for closed position (live mode)
          if (!this.paperMode) {
            const funding = this._removePositionFunding(trade.symbol, side);
            if (!math.isZero(funding)) {
              log.info('Position funding PnL captured on close', {
                symbol: trade.symbol, side, fundingPnl: funding,
              });
            }
          }
        }
      };
      this.orderManager.on(TRADE_EVENTS.ORDER_FILLED, onOrderFilledMapping);
      this._eventCleanups.push(() => {
        this.orderManager.removeListener(TRADE_EVENTS.ORDER_FILLED, onOrderFilledMapping);
      });

      // 12. Wire up: strategy SIGNAL_GENERATED -> _handleStrategySignal (T0-2 qty resolution + filter + submit)
      for (const strategy of this.strategies) {
        const onSignal = (signal) => {
          this._handleStrategySignal(signal, sessionId);
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

      // 14c. R10 AD-58: Restore peakEquity from last stopped session
      try {
        const lastSession = await BotSession.findOne(
          { status: { $in: ['idle', 'stopped'] } },
          { stats: 1 },
          { sort: { stoppedAt: -1 } },
        );
        if (lastSession && lastSession.stats && lastSession.stats.peakEquity && lastSession.stats.peakEquity !== '0') {
          this.riskEngine.drawdownMonitor.loadState({
            peakEquity: lastSession.stats.peakEquity,
          });

          // Get current equity and feed it in so halt detection runs immediately
          let currentEquity;
          if (this.paperMode && this.paperPositionManager) {
            currentEquity = String(this.paperPositionManager.getEquity());
          } else {
            currentEquity = this.riskEngine.getAccountState().equity || '0';
          }
          if (currentEquity && currentEquity !== '0') {
            this.riskEngine.drawdownMonitor.updateEquity(currentEquity);
          }

          log.info('start — peakEquity restored from last session', {
            peakEquity: lastSession.stats.peakEquity,
            currentEquity,
          });
        }
      } catch (err) {
        log.error('start — peakEquity restoration failed (non-fatal)', { error: err.message });
        // NOT fatal — continue startup
      }

      // 14d. Paper mode: sync initial balance to RiskEngine so ExposureGuard has equity > 0
      if (this.paperMode && this.paperPositionManager) {
        this.riskEngine.updateAccountState({
          equity: this.paperPositionManager.getEquity(),
          positions: this.paperPositionManager.getPositions(),
        });
      }

      // 14e. Start orphan order cleanup (R8-T2-6, live mode only)
      if (this.orphanOrderCleanup && !this.paperMode) {
        this.orphanOrderCleanup.start(category);
        startedServices.push('orphanOrderCleanup');
        this._eventCleanups.push(() => {
          this.orphanOrderCleanup.stop();
        });
      }

      // 15. Set _running = true
      this._running = true;

      // 16. Start periodic Snapshot generation (AD-52, R8-T1-2)
      this._startSnapshotGeneration(sessionId);

      // 17. Start periodic coin reselection timer (AD-56, R8-T2-4)
      this._startCoinReselectionTimer(category);

      log.info('start — bot started successfully', {
        sessionId,
        strategies: strategyNames,
        symbols: this._selectedSymbols,
      });

      return this.currentSession;
    } catch (err) {
      log.error('start — failed to start bot, rolling back started services', {
        error: err,
        startedServices: [...startedServices],
      });

      // Rollback started services in REVERSE order
      const rollbackMap = {
        'orphanOrderCleanup': () => this.orphanOrderCleanup && this.orphanOrderCleanup.stop(),
        'fundingDataService': () => this.fundingDataService && this.fundingDataService.stop(),
        'symbolRegimeManager': () => this.symbolRegimeManager && this.symbolRegimeManager.stop(),
        'strategyRouter': () => this.strategyRouter && this.strategyRouter.stop(),
        'regimeOptimizer': () => this.regimeOptimizer && this.regimeOptimizer.stop(),
        'regimeEvaluator': () => this.regimeEvaluator && this.regimeEvaluator.stop(),
        'marketRegime': () => this.marketRegime.stop(),
        'tickerAggregator': () => this.tickerAggregator.stop(),
        'indicatorCache': () => this.indicatorCache && this.indicatorCache.stop(),
        'marketData': () => this.marketData.stop(),
        'instrumentCache': () => this.instrumentCache && this.instrumentCache.stop(),
        'positionManager': () => this.positionManager.stop(),
        'exchangeClient.ws': () => this.exchangeClient.closeWebsockets(),
      };

      for (let i = startedServices.length - 1; i >= 0; i--) {
        const svcName = startedServices[i];
        try {
          const rollbackFn = rollbackMap[svcName];
          if (rollbackFn) rollbackFn();
          log.info('start — rollback: stopped service', { service: svcName });
        } catch (rollbackErr) {
          log.error('start — rollback: failed to stop service', {
            service: svcName,
            error: rollbackErr.message,
          });
        }
      }

      // Clean up event wiring that may have been set up before failure
      for (const cleanup of this._eventCleanups) {
        try { cleanup(); } catch (_) { /* ignore */ }
      }
      this._eventCleanups = [];

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

    // 1b. Stop snapshot generation (R8-T1-2)
    this._stopSnapshotGeneration();

    // 1c. Stop coin reselection timer (R8-T2-4)
    this._stopCoinReselectionTimer();

    // 1d. Stop orphan order cleanup (R8-T2-6)
    if (this.orphanOrderCleanup) {
      try {
        this.orphanOrderCleanup.stop();
      } catch (err) {
        log.error('stop — error stopping orphanOrderCleanup', { error: err });
      }
    }

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
    this._gracefulDisabledStrategies.clear();

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

    // 3c. Stop fundingDataService (T2-4)
    if (this.fundingDataService) {
      try {
        this.fundingDataService.stop();
      } catch (err) {
        log.error('stop — error stopping fundingDataService', { error: err });
      }
    }

    // 3d. Stop symbolRegimeManager
    if (this.symbolRegimeManager) {
      try {
        this.symbolRegimeManager.stop();
      } catch (err) {
        log.error('stop — error stopping symbolRegimeManager', { error: err });
      }
    }

    // 3e. Stop instrumentCache (R9-T1)
    if (this.instrumentCache) {
      try {
        this.instrumentCache.stop();
      } catch (err) {
        log.error('stop — error stopping instrumentCache', { error: err });
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

    // 6. Save BotSession BEFORE closing WebSockets (ensures DB write completes)
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

    // 6b. AD-38: Destroy managers to remove WS listeners from singleton exchangeClient
    if (this.orderManager && typeof this.orderManager.destroy === 'function') {
      try {
        this.orderManager.destroy();
      } catch (err) {
        log.error('stop — error destroying orderManager', { error: err.message });
      }
    }
    if (!this.paperMode && this.positionManager && typeof this.positionManager.destroy === 'function') {
      try {
        this.positionManager.destroy();
      } catch (err) {
        log.error('stop — error destroying positionManager', { error: err.message });
      }
    }

    // 7. Close exchangeClient WebSockets
    try {
      this.exchangeClient.closeWebsockets();
    } catch (err) {
      log.error('stop — error closing WebSockets', { error: err });
    }

    // 7b. Reset PaperEngine to clear pending orders and cached state
    if (this.paperMode && this.paperEngine) {
      try { this.paperEngine.reset(); } catch (err) {
        log.error('stop — error resetting paperEngine', { error: err.message });
      }
    }

    // 7c. Auto-stop tournament if paperPositionManager supports it
    if (this.paperMode && this.paperPositionManager && typeof this.paperPositionManager.stopTournament === 'function') {
      this.paperPositionManager.stopTournament();
    }

    // 8. Clear strategy list and mappings
    this.strategies = [];
    this._selectedSymbols = [];
    this._strategyPositionMap.clear();
    this._positionFundingMap.clear();

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

    // R8-T0-6: Use StrategyRouter to resume with regime-aware activation
    if (this.strategyRouter) {
      try {
        this.strategyRouter.refresh();
        log.info('resume — StrategyRouter regime-aware refresh completed');
      } catch (err) {
        log.error('resume — StrategyRouter refresh failed, falling back to direct activation', { error: err });
        // Fallback: activate all strategies on all symbols
        for (const strategy of this.strategies) {
          for (const symbol of this._selectedSymbols) {
            try {
              strategy.activate(symbol, category);
            } catch (e) {
              log.error('resume — error activating strategy', { strategy: strategy.name, error: e });
            }
          }
        }
      }
    } else {
      // No StrategyRouter — direct activation (legacy path)
      for (const strategy of this.strategies) {
        for (const symbol of this._selectedSymbols) {
          try {
            strategy.activate(symbol, category);
          } catch (err) {
            log.error('resume — error activating strategy', { strategy: strategy.name, error: err });
          }
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
   * R8-T2-5: When switching from live → paper, warns if open positions exist
   * unless force=true is passed.
   *
   * @param {'paper'|'live'} mode
   * @param {object} [opts]
   * @param {boolean} [opts.force=false] — skip open-position warning
   * @throws {Error} if bot is currently running or open positions exist without force
   */
  setTradingMode(mode, { force = false } = {}) {
    if (this._running) {
      throw new Error('봇이 실행 중입니다. 먼저 정지해주세요.');
    }

    const prevMode = this.paperMode ? 'paper' : 'live';

    if (mode === 'paper') {
      // R8-T2-5: Warn if switching from live → paper with open positions
      if (!this.paperMode && !force) {
        const positions = this.positionManager ? this.positionManager.getPositions() : [];
        if (positions && positions.length > 0) {
          const symbols = positions.map(p => `${p.symbol}:${p.posSide}`).join(', ');
          throw new Error(
            `라이브 포지션이 ${positions.length}개 열려 있습니다 (${symbols}). ` +
            `Paper 모드로 전환하면 이 포지션은 수동 관리해야 합니다. ` +
            `force=true 파라미터로 강제 전환 가능합니다.`
          );
        }
      }

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

    // R8-T2-5: Emit mode change event
    this.emit('trading_mode_changed', { from: prevMode, to: mode });
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
        lastSignal: (() => { try { return s.getSignal(); } catch { return null; } })(),
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

    // R8-T0-5: Include strategy-position mapping
    if (this._strategyPositionMap.size > 0) {
      status.strategyPositionMap = Object.fromEntries(this._strategyPositionMap);
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
  // R8-T0-5: Strategy-Position mapping
  // =========================================================================

  /**
   * Get the strategy name that owns a position.
   *
   * @param {string} symbol — e.g. 'BTCUSDT'
   * @param {string} side   — 'long' | 'short'
   * @returns {string|null} strategy name or null if not mapped
   */
  getStrategyForPosition(symbol, side) {
    return this._strategyPositionMap.get(`${symbol}:${side}`) || null;
  }

  /**
   * Remove a strategy-position mapping entry (called on position close).
   *
   * @param {string} symbol
   * @param {string} side
   * @private
   */
  _removeStrategyPositionMapping(symbol, side) {
    const key = `${symbol}:${side}`;
    if (this._strategyPositionMap.has(key)) {
      log.debug('Strategy-position mapping removed', {
        key, strategy: this._strategyPositionMap.get(key),
      });
      this._strategyPositionMap.delete(key);
    }
  }

  /**
   * Check if a strategy has any open position (used by AD-55 symbol preservation).
   *
   * @param {string} strategyName
   * @returns {boolean}
   * @private
   */
  _strategyHasOpenPosition(strategyName) {
    for (const [, owner] of this._strategyPositionMap) {
      if (owner === strategyName) return true;
    }
    return false;
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

    // Clear graceful-disabled flag if re-enabling
    this._gracefulDisabledStrategies.delete(name);

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
      // Inject account context so strategies can access live equity (T2-5)
      strategy.setAccountContext({
        getEquity: () => this.riskEngine ? this.riskEngine.getAccountState().equity || '0' : '0',
      });

      // Register with SignalFilter
      if (this.signalFilter) {
        const meta = strategy.getMetadata();
        this.signalFilter.registerStrategy(name, {
          cooldownMs: meta.cooldownMs,
          maxConcurrentPositions: meta.maxConcurrentPositions,
          riskLevel: meta.riskLevel,
          minConfidence: meta.minConfidence,
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

      // Wire signal handler (T0-2: uses common _handleStrategySignal)
      const sessionId = this.currentSession ? this.currentSession._id.toString() : null;
      const onSignal = (signal) => {
        this._handleStrategySignal(signal, sessionId);
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
  /**
   * Disable a strategy by name at runtime.
   *
   * @param {string} name — strategy name to disable
   * @param {object} [opts]
   * @param {'immediate'|'graceful'} [opts.mode='immediate']
   *   - immediate: deactivate strategy + auto-close all its positions
   *   - graceful: deactivate strategy (no new entries) but let existing positions
   *               close naturally via SL/TP
   * @returns {boolean} true if successfully disabled
   */
  disableStrategy(name, opts = {}) {
    const mode = opts.mode || 'immediate';

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

      // Cancel any active grace period before disabling (R7-B5)
      if (this.strategyRouter) {
        this.strategyRouter.cancelGracePeriod(name, 'strategy_disabled');
      }

      strategy.deactivate();
      strategy.removeAllListeners(TRADE_EVENTS.SIGNAL_GENERATED);
      this.strategies.splice(idx, 1);

      if (mode === 'immediate') {
        // Close all positions opened by this strategy
        this._closeStrategyPositions(name);
      } else {
        // Graceful: block new entries but keep existing positions
        this._gracefulDisabledStrategies.add(name);
        log.info('disableStrategy — graceful mode, blocking new entries only', { name });
      }

      log.info('disableStrategy — strategy disabled', { name, mode });
      return true;
    } catch (err) {
      log.error('disableStrategy — failed', { name, error: err });
      return false;
    }
  }

  /**
   * Close all positions belonging to a strategy by placing market close orders.
   * Also cancels any pending limit orders and stop-loss triggers for the strategy.
   *
   * @param {string} strategyName
   * @private
   */
  _closeStrategyPositions(strategyName) {
    const positionManager = this.paperMode ? this.paperPositionManager : this.positionManager;
    if (!positionManager) return;

    const positions = positionManager.getPositions();
    const strategyPositions = positions.filter((p) => p.strategy === strategyName);

    if (strategyPositions.length === 0) {
      log.info('_closeStrategyPositions — no open positions for strategy', { strategyName });
      return;
    }

    log.info('_closeStrategyPositions — closing positions', {
      strategyName,
      count: strategyPositions.length,
    });

    // Cancel pending limit orders and SL triggers for this strategy (paper mode)
    if (this.paperMode && this.paperEngine) {
      for (const order of this.paperEngine.getPendingOrders()) {
        if (order.strategy === strategyName) {
          this.paperEngine.cancelOrder(order.clientOid);
        }
      }
      for (const pos of strategyPositions) {
        this.paperEngine.cancelStopLoss(pos.symbol, pos.posSide);
      }
    }

    // Place market close orders for each position
    for (const pos of strategyPositions) {
      const closeSide = pos.posSide === 'long' ? 'sell' : 'buy';
      const signal = {
        symbol: pos.symbol,
        action: pos.posSide === 'long' ? SIGNAL_ACTIONS.CLOSE_LONG : SIGNAL_ACTIONS.CLOSE_SHORT,
        side: closeSide,
        posSide: pos.posSide,
        qty: pos.qty,
        orderType: 'market',
        reduceOnly: true,
        strategy: strategyName,
        confidence: 1,
        reason: `Strategy "${strategyName}" disabled — auto-close`,
        sessionId: this.currentSession ? this.currentSession._id.toString() : null,
      };

      this.orderManager.submitOrder(signal).catch((err) => {
        log.error('_closeStrategyPositions — failed to close position', {
          strategyName,
          symbol: pos.symbol,
          posSide: pos.posSide,
          error: err.message,
        });
      });
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
    const DEFAULT_STRATEGIES = ['RsiPivot', 'MaTrend', 'BollingerReversion', 'Supertrend', 'TurtleBreakout'];
    const strategyNames = config.strategies || DEFAULT_STRATEGIES;
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
        // Inject account context so strategies can access live equity (T2-5)
        strategy.setAccountContext({
          getEquity: () => this.riskEngine ? this.riskEngine.getAccountState().equity || '0' : '0',
        });
        strategies.push(strategy);
        log.info('_createStrategies — strategy created', { name });
      } catch (err) {
        log.error('_createStrategies — failed to create strategy', { name, error: err });
      }
    }

    return strategies;
  }

  // =========================================================================
  // T0-2: Position sizing — percentage → absolute quantity conversion
  // =========================================================================

  /**
   * Convert a strategy's suggestedQty (percentage of equity) into an
   * absolute quantity suitable for the exchange. CLOSE signals bypass
   * this conversion and use the qty as-is.
   *
   * @param {object} signal — strategy signal
   * @returns {Promise<string|null>} resolved absolute qty, or null if conversion fails
   * @private
   */
  async _resolveSignalQuantity(signal) {
    // AD-35: Use actual position quantity for CLOSE signals
    if (signal.action === SIGNAL_ACTIONS.CLOSE_LONG || signal.action === SIGNAL_ACTIONS.CLOSE_SHORT) {
      const posSide = signal.action === SIGNAL_ACTIONS.CLOSE_LONG ? 'long' : 'short';
      if (this.paperMode && this.paperPositionManager) {
        const pos = this.paperPositionManager.getPosition(signal.symbol, posSide);
        if (pos) return pos.qty;
      } else if (this.positionManager) {
        const pos = this.positionManager.getPosition(signal.symbol, posSide);
        if (pos) return pos.qty;
      }
      // Fallback: use signal value as-is
      return signal.suggestedQty || signal.qty || null;
    }

    // Get equity
    let equity;
    if (this.paperMode && this.paperPositionManager) {
      equity = String(this.paperPositionManager.getEquity());
    } else {
      // AD-33: Cached first, REST fallback
      equity = this.riskEngine.getAccountState().equity;
      if (!equity || equity === '0') {
        try {
          const category = this.currentSession?.config?.category || CATEGORIES.USDT_FUTURES;
          const balanceResponse = await this.exchangeClient.getBalances(category);
          const rawAccounts = Array.isArray(balanceResponse?.data) ? balanceResponse.data : [];
          if (rawAccounts.length > 0) {
            const account = rawAccounts[0];
            equity = String(account.equity ?? account.accountEquity ?? account.usdtEquity ?? '0');
          }
        } catch (err) {
          log.error('_resolveSignalQuantity — fallback equity fetch failed', { error: err.message });
          return null;
        }
      }
    }

    if (!equity || math.isZero(equity)) {
      log.warn('_resolveSignalQuantity — equity is zero, skipping', { symbol: signal.symbol });
      return null;
    }

    const pct = signal.suggestedQty;
    if (!pct || math.isZero(pct)) return null;

    // percentage → notional value
    const allocatedValue = math.multiply(equity, math.divide(pct, '100'));

    // notional → quantity
    const price = signal.suggestedPrice || signal.price;
    if (!price || math.isZero(price)) return null;

    let qty = math.divide(allocatedValue, price);

    // Floor to per-symbol lot step from InstrumentCache (R9-T1)
    const lotStep = this.instrumentCache
      ? this.instrumentCache.getLotStep(signal.symbol)
      : '0.0001';
    qty = math.floorToStep(qty, lotStep);

    if (math.isZero(qty)) return null;

    // Validate against minimum order quantity (R9-T1)
    if (this.instrumentCache) {
      const minQty = this.instrumentCache.getMinQty(signal.symbol);
      if (minQty && !math.isZero(minQty) && math.isLessThan(qty, minQty)) {
        log.warn('_resolveSignalQuantity — qty below minQty', {
          symbol: signal.symbol,
          qty,
          minQty,
          lotStep,
        });
        return null;
      }
    }

    return qty;
  }

  // =========================================================================
  // BotSession stats update (R8-T1-3)
  // =========================================================================

  /**
   * Update BotSession stats when a trade is filled.
   * Increments totalTrades, wins/losses, totalPnl, and tracks peak equity / drawdown.
   *
   * @param {object} data — ORDER_FILLED event data { trade, pnl }
   * @private
   */
  async _updateSessionStats(data) {
    if (!this.currentSession) return;

    const session = this.currentSession;
    if (!session.stats) session.stats = {};

    // Increment trade count
    session.stats.totalTrades = (session.stats.totalTrades || 0) + 1;

    // Update PnL stats if available
    const pnl = data.pnl;
    if (pnl !== null && pnl !== undefined) {
      const pnlStr = String(pnl);
      session.stats.totalPnl = math.add(session.stats.totalPnl || '0', pnlStr);

      if (math.isGreaterThan(pnlStr, '0')) {
        session.stats.wins = (session.stats.wins || 0) + 1;
      } else if (math.isLessThan(pnlStr, '0')) {
        session.stats.losses = (session.stats.losses || 0) + 1;
      }
    }

    // Update peak equity and drawdown
    let currentEquity;
    if (this.paperMode && this.paperPositionManager) {
      currentEquity = String(this.paperPositionManager.getEquity());
    } else {
      currentEquity = this.positionManager.getAccountState().equity || '0';
    }

    if (!math.isZero(currentEquity)) {
      const peakEquity = session.stats.peakEquity || '0';
      if (math.isGreaterThan(currentEquity, peakEquity)) {
        session.stats.peakEquity = currentEquity;
      }

      // R10 AD-58: Sync DrawdownMonitor peakEquity → session stats
      const ddState = this.riskEngine.drawdownMonitor.getState();
      if (ddState.peakEquity && math.isGreaterThan(ddState.peakEquity, session.stats.peakEquity || '0')) {
        session.stats.peakEquity = ddState.peakEquity;
      }

      if (!math.isZero(session.stats.peakEquity)) {
        const drawdown = math.subtract(session.stats.peakEquity, currentEquity);
        const currentMaxDD = session.stats.maxDrawdown || '0';
        if (math.isGreaterThan(drawdown, currentMaxDD)) {
          session.stats.maxDrawdown = drawdown;
        }
      }
    }

    // Persist (mark modified to ensure Mongoose detects subdocument changes)
    session.markModified('stats');
    await session.save();
  }

  // =========================================================================
  // Snapshot generation (AD-52, R8-T1-2)
  // =========================================================================

  /**
   * Start periodic Snapshot generation at SNAPSHOT_INTERVAL_MS.
   * @param {string} sessionId
   * @private
   */
  _startSnapshotGeneration(sessionId) {
    this._stopSnapshotGeneration(); // Clear any existing timer

    this._snapshotInterval = setInterval(async () => {
      try {
        await this._generateSnapshot(sessionId);
      } catch (err) {
        log.error('Snapshot generation failed', { error: err.message });
      }
    }, SNAPSHOT_INTERVAL_MS);
    if (this._snapshotInterval.unref) this._snapshotInterval.unref();

    log.info('Snapshot generation started', { intervalMs: SNAPSHOT_INTERVAL_MS, sessionId });
  }

  /**
   * Stop the periodic Snapshot timer.
   * @private
   */
  _stopSnapshotGeneration() {
    if (this._snapshotInterval) {
      clearInterval(this._snapshotInterval);
      this._snapshotInterval = null;
    }
  }

  /**
   * Generate a single Snapshot — captures current equity, balance,
   * unrealizedPnl, and position state.
   * @param {string} sessionId
   * @private
   */
  async _generateSnapshot(sessionId) {
    let equity, availableBalance, unrealizedPnl, positions;

    if (this.paperMode && this.paperPositionManager) {
      const state = this.paperPositionManager.getAccountState();
      equity = state.equity || '0';
      availableBalance = state.availableBalance || '0';
      unrealizedPnl = state.unrealizedPnl || '0';
      positions = this.paperPositionManager.getPositions();
    } else {
      const state = this.positionManager.getAccountState();
      equity = state.equity || '0';
      availableBalance = state.availableBalance || '0';
      unrealizedPnl = state.unrealizedPnl || '0';
      positions = this.positionManager.getPositions();
    }

    // Skip if equity is still zero (not yet synced)
    if (math.isZero(equity)) {
      log.debug('Snapshot skipped — equity is zero');
      return;
    }

    await Snapshot.create({
      sessionId,
      equity,
      availableBalance,
      unrealizedPnl,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        posSide: p.posSide,
        qty: p.qty,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage,
      })),
    });

    log.debug('Snapshot generated', { sessionId, equity, positionCount: positions.length });
  }

  /**
   * Common signal handler for strategy SIGNAL_GENERATED events.
   * Resolves quantity, applies SignalFilter, and submits to OrderManager.
   * Used by both start() and enableStrategy() to avoid duplication.
   *
   * @param {object} signal — raw strategy signal
   * @param {string|null} sessionId
   * @private
   */
  async _handleStrategySignal(signal, sessionId) {
    // Block new entry signals from gracefully-disabled strategies
    if (this._gracefulDisabledStrategies.has(signal.strategy)) {
      const isEntry = signal.action === SIGNAL_ACTIONS.OPEN_LONG
        || signal.action === SIGNAL_ACTIONS.OPEN_SHORT;
      if (isEntry) {
        log.info('_handleStrategySignal — blocked new entry from gracefully-disabled strategy', {
          strategy: signal.strategy, symbol: signal.symbol, action: signal.action,
        });
        return;
      }
      // Allow close signals (SL/TP exits) to pass through
    }

    // Block OPEN signals during grace period (R7-B2, AD-43)
    if (this.strategyRouter) {
      const graceStrategies = this.strategyRouter.getGracePeriodStrategies();
      if (graceStrategies.includes(signal.strategy)) {
        const isEntry = signal.action === SIGNAL_ACTIONS.OPEN_LONG
          || signal.action === SIGNAL_ACTIONS.OPEN_SHORT;
        if (isEntry) {
          log.info('_handleStrategySignal — blocked OPEN from grace-period strategy', {
            strategy: signal.strategy, symbol: signal.symbol, action: signal.action,
          });
          return;
        }
        // CLOSE signals (SL/TP) pass through during grace
      }
    }

    // Pass through SignalFilter first
    if (this.signalFilter) {
      const result = this.signalFilter.filter(signal);
      if (!result.passed) {
        log.debug('Signal filtered out', {
          strategy: signal.strategy,
          symbol: signal.symbol,
          action: signal.action,
          reason: result.reason,
        });
        return;
      }
    }

    // Resolve quantity (T0-2)
    const resolvedQty = await this._resolveSignalQuantity(signal);
    if (!resolvedQty) {
      log.warn('Signal skipped — qty resolution failed', {
        symbol: signal.symbol,
        action: signal.action,
        suggestedQty: signal.suggestedQty,
      });
      // Emit skip event for frontend (T0-2 feedback)
      this.emit('signal_skipped', {
        symbol: signal.symbol,
        strategy: signal.strategy,
        reason: 'qty_resolution_failed',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Block signals during symbol reassignment (AD-55)
    if (this.strategyRouter && this.strategyRouter.isSymbolUpdateInProgress()) {
      log.debug('_handleStrategySignal — blocked during symbol reassignment', {
        strategy: signal.strategy, symbol: signal.symbol,
      });
      return;
    }

    // Submit with resolved qty
    try {
      const result = await this.orderManager.submitOrder({
        ...signal,
        qty: resolvedQty,
        price: signal.suggestedPrice || signal.price,
        positionSizePercent: signal.suggestedQty,
        resolvedQty,
        sessionId,
      });

      // R8-T0-5: Record strategy-position mapping on OPEN success
      if (result && (signal.action === SIGNAL_ACTIONS.OPEN_LONG || signal.action === SIGNAL_ACTIONS.OPEN_SHORT)) {
        const side = signal.action === SIGNAL_ACTIONS.OPEN_LONG ? 'long' : 'short';
        const mapKey = `${signal.symbol}:${side}`;
        const existing = this._strategyPositionMap.get(mapKey);
        if (existing && existing !== signal.strategy) {
          log.warn('_handleStrategySignal — strategy-position map overwrite', {
            key: mapKey, previous: existing, new: signal.strategy,
          });
        }
        this._strategyPositionMap.set(mapKey, signal.strategy);
        log.debug('Strategy-position mapping recorded', { key: mapKey, strategy: signal.strategy });
      }
    } catch (err) {
      log.error('orderManager.submitOrder error from strategy signal', {
        strategy: signal.strategy,
        error: err,
      });
    }
  }

  // =========================================================================
  // R8-T2-3: Live mode funding PnL accumulation
  // =========================================================================

  /**
   * Accumulate funding PnL for open positions in live mode.
   * Formula: fundingPnl = positionSize * fundingRate * -1
   *   (payer=negative, receiver=positive)
   *
   * Phase 1: data collection only — does NOT modify PnL calculations.
   *
   * @param {string} symbol
   * @param {string} fundingRate — funding rate as decimal string
   * @private
   */
  _accumulateLiveFunding(symbol, fundingRate) {
    if (!fundingRate || math.isZero(fundingRate)) return;

    const positions = this.positionManager ? this.positionManager.getPositions() : [];
    for (const pos of positions) {
      if (pos.symbol !== symbol) continue;

      const side = pos.posSide || 'long';
      const key = `${symbol}:${side}`;
      const posSize = math.multiply(pos.qty || '0', pos.markPrice || pos.entryPrice || '0');
      // fundingPnl = positionSize * fundingRate * -1
      const fundingPnl = math.multiply(math.multiply(posSize, fundingRate), '-1');

      const prev = this._positionFundingMap.get(key) || '0';
      this._positionFundingMap.set(key, math.add(prev, fundingPnl));

      log.debug('_accumulateLiveFunding — accumulated', {
        key,
        fundingRate,
        fundingPnl,
        total: this._positionFundingMap.get(key),
      });
    }
  }

  /**
   * Get accumulated funding PnL for a position in live mode.
   *
   * @param {string} symbol
   * @param {string} side — 'long' | 'short'
   * @returns {string} accumulated funding PnL
   */
  getPositionFunding(symbol, side) {
    return this._positionFundingMap.get(`${symbol}:${side}`) || '0';
  }

  /**
   * Remove funding PnL tracking for a closed position (called alongside strategy-position mapping removal).
   *
   * @param {string} symbol
   * @param {string} side
   * @returns {string} the accumulated funding at time of removal
   * @private
   */
  _removePositionFunding(symbol, side) {
    const key = `${symbol}:${side}`;
    const funding = this._positionFundingMap.get(key) || '0';
    this._positionFundingMap.delete(key);
    return funding;
  }

  // =========================================================================
  // R8-T2-4: Coin reselection timer (AD-56)
  // =========================================================================

  /**
   * Start the periodic coin reselection timer.
   * @param {string} category
   * @private
   */
  _startCoinReselectionTimer(category) {
    this._stopCoinReselectionTimer(); // Clear any existing timer

    this._reselectionTimer = setInterval(() => {
      this._performCoinReselection(category).catch((err) => {
        log.error('Coin reselection failed', { error: err.message });
      });
    }, COIN_RESELECTION_INTERVAL_MS);
    if (this._reselectionTimer.unref) this._reselectionTimer.unref();

    log.info('Coin reselection timer started', {
      intervalMs: COIN_RESELECTION_INTERVAL_MS,
      intervalHours: COIN_RESELECTION_INTERVAL_MS / (60 * 60 * 1000),
    });
  }

  /**
   * Stop the periodic coin reselection timer.
   * @private
   */
  _stopCoinReselectionTimer() {
    if (this._reselectionTimer) {
      clearInterval(this._reselectionTimer);
      this._reselectionTimer = null;
    }
  }

  /**
   * Perform a coin reselection cycle.
   *
   * Staged transition order (AD-56):
   *   1. Select new coins via coinSelector
   *   2. Compare with current symbols — if same set, skip
   *   3. Protect symbols with open positions (don't remove them)
   *   4. Subscribe new symbols first
   *   5. Reassign strategies
   *   6. THEN unsubscribe removed symbols
   *   7. Emit coins_reselected event
   *
   * @param {string} category
   * @private
   */
  async _performCoinReselection(category) {
    // Guard: bot must be running
    if (!this._running) return;

    // Guard: prevent concurrent reselections
    if (this._reselectionInProgress) {
      log.warn('_performCoinReselection — already in progress, skipping');
      return;
    }

    this._reselectionInProgress = true;

    try {
      log.info('_performCoinReselection — starting coin reselection');

      // 1. Select new coins
      const selectedCoins = await this.coinSelector.selectCoins(category);
      if (!this._running) return; // Bail if bot stopped during async call

      const newSymbols = selectedCoins.map((c) => c.symbol);

      // Always include BTCUSDT — MarketRegime depends on BTC kline data
      if (!newSymbols.includes('BTCUSDT')) {
        newSymbols.unshift('BTCUSDT');
      }

      // 2. Compare with current symbols — if same set, skip
      const currentSet = new Set(this._selectedSymbols);
      const newSet = new Set(newSymbols);
      const sameSet = currentSet.size === newSet.size && [...currentSet].every((s) => newSet.has(s));

      if (sameSet) {
        log.info('_performCoinReselection — same symbol set, skipping');
        return;
      }

      // 3. Identify added, removed, and kept symbols
      const added = newSymbols.filter((s) => !currentSet.has(s));
      const removed = this._selectedSymbols.filter((s) => !newSet.has(s));
      const kept = newSymbols.filter((s) => currentSet.has(s));

      // 3b. Protect symbols with open positions
      const positionManager = this.paperMode ? this.paperPositionManager : this.positionManager;
      const protectedSymbols = [];
      if (positionManager) {
        const openPositions = positionManager.getPositions();
        for (const pos of openPositions) {
          if (removed.includes(pos.symbol)) {
            protectedSymbols.push(pos.symbol);
          }
        }
      }

      // Remove protected symbols from the "removed" list
      const actualRemoved = removed.filter((s) => !protectedSymbols.includes(s));

      // Merge: new symbols + protected symbols that would have been removed
      const finalSymbols = [...newSymbols];
      for (const sym of protectedSymbols) {
        if (!finalSymbols.includes(sym)) {
          finalSymbols.push(sym);
        }
      }

      if (!this._running) return; // Bail if bot stopped

      // 4. Subscribe new symbols FIRST (staged transition)
      if (added.length > 0) {
        this.marketData.subscribeSymbols(added, category);
      }

      // 5. Reassign strategies
      if (this.strategyRouter && selectedCoins.length > 0) {
        this.strategyRouter.assignSymbols(
          finalSymbols,
          selectedCoins,
          (strategyName) => this._strategyHasOpenPosition(strategyName),
        );
      }

      // 6. THEN unsubscribe removed symbols (only those without open positions)
      if (actualRemoved.length > 0) {
        this.marketData.unsubscribeSymbols(actualRemoved, category);
      }

      // Update internal symbol list
      this._selectedSymbols = finalSymbols;

      // Update fundingDataService symbols
      if (this.fundingDataService) {
        this.fundingDataService.updateSymbols(finalSymbols);
      }

      // Update symbolRegimeManager
      if (this.symbolRegimeManager) {
        const nonBtcSymbols = finalSymbols.filter((s) => s !== 'BTCUSDT');
        this.symbolRegimeManager.start(nonBtcSymbols);
      }

      // Update session symbols
      if (this.currentSession) {
        this.currentSession.symbols = finalSymbols;
        await this.currentSession.save().catch((err) => {
          log.error('_performCoinReselection — session save failed', { error: err.message });
        });
      }

      // 7. Emit coins_reselected event (for Socket.io → FE toast)
      const eventPayload = {
        added,
        removed: actualRemoved,
        kept,
        protected: protectedSymbols,
        total: finalSymbols.length,
        timestamp: new Date().toISOString(),
      };
      this.emit('coins_reselected', eventPayload);

      log.info('_performCoinReselection — complete', {
        added: added.length,
        removed: actualRemoved.length,
        protected: protectedSymbols.length,
        kept: kept.length,
        total: finalSymbols.length,
      });
    } finally {
      this._reselectionInProgress = false;
    }
  }
}

module.exports = BotService;
