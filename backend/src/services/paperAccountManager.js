'use strict';

/**
 * PaperAccountManager — Strategy-isolated paper trading account manager.
 *
 * In tournament mode each strategy gets its own independent PaperPositionManager
 * (with its own balance) so that one strategy's losses cannot affect another.
 *
 * Implements the same public interface as PaperPositionManager so that
 * OrderManager / BotService can use it as a drop-in replacement.
 *
 * In non-tournament mode all fills are routed to a single shared account
 * (identical to using PaperPositionManager directly).
 */

const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const math = require('../utils/mathUtils');
const { TRADE_EVENTS } = require('../utils/constants');
const PaperPositionManager = require('./paperPositionManager');

const log = createLogger('PaperAccountManager');

const DEFAULT_INITIAL_BALANCE = '10000';

class PaperAccountManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./riskEngine')} opts.riskEngine
   * @param {string} [opts.initialBalance]
   * @param {boolean} [opts.tournamentMode]
   */
  constructor({ riskEngine, initialBalance, tournamentMode } = {}) {
    super();

    this.riskEngine = riskEngine || null;
    this._initialBalance = initialBalance || DEFAULT_INITIAL_BALANCE;
    this._tournamentMode = tournamentMode || false;

    /** @type {Map<string, PaperPositionManager>} strategy → account */
    this._accounts = new Map();

    /** Shared fallback account for non-tournament mode */
    this._sharedAccount = new PaperPositionManager({
      riskEngine,
      initialBalance: this._initialBalance,
    });

    /** Tournament metadata */
    this._tournamentId = null;
    this._tournamentRunning = false;
    this._tournamentStartedAt = null;

    // Forward position events from shared account
    this._sharedAccount.on(TRADE_EVENTS.POSITION_UPDATED, (data) => {
      this.emit(TRADE_EVENTS.POSITION_UPDATED, data);
    });

    log.info('PaperAccountManager initialised', {
      tournamentMode: this._tournamentMode,
      initialBalance: this._initialBalance,
    });
  }

  // =========================================================================
  // Tournament lifecycle
  // =========================================================================

  /**
   * Start a tournament — create independent accounts for each strategy.
   * @param {string[]} strategyNames
   */
  startTournament(strategyNames) {
    if (this._tournamentRunning) {
      log.warn('startTournament — already running');
      return;
    }

    this._tournamentId = `tournament_${Date.now()}`;
    this._tournamentRunning = true;
    this._tournamentStartedAt = new Date();

    // Create per-strategy accounts
    for (const name of strategyNames) {
      if (this._accounts.has(name)) continue;

      const account = new PaperPositionManager({
        riskEngine: null, // each account is independent from risk engine
        initialBalance: this._initialBalance,
      });

      // Forward position update events
      account.on(TRADE_EVENTS.POSITION_UPDATED, () => {
        this.emit(TRADE_EVENTS.POSITION_UPDATED, {
          positions: this.getPositions(),
        });
      });

      this._accounts.set(name, account);
      log.info('startTournament — account created', { strategy: name });
    }

    log.info('startTournament — tournament started', {
      tournamentId: this._tournamentId,
      strategies: strategyNames.length,
    });
  }

  /**
   * Stop the tournament (data preserved for inspection).
   */
  stopTournament() {
    if (!this._tournamentRunning) {
      log.warn('stopTournament — not running');
      return;
    }

    this._tournamentRunning = false;
    log.info('stopTournament — tournament stopped', {
      tournamentId: this._tournamentId,
    });
  }

  /**
   * Reset the entire tournament — clear all accounts.
   * @param {string} [initialBalance]
   */
  resetTournament(initialBalance) {
    if (initialBalance) {
      this._initialBalance = initialBalance;
    }

    for (const [name, account] of this._accounts) {
      account.removeAllListeners();
      log.info('resetTournament — account removed', { strategy: name });
    }
    this._accounts.clear();

    this._tournamentId = null;
    this._tournamentRunning = false;
    this._tournamentStartedAt = null;

    log.info('resetTournament — tournament reset');
  }

  // =========================================================================
  // PaperPositionManager-compatible interface (drop-in replacement)
  // =========================================================================

  /**
   * Process a fill — route to correct strategy account.
   * @param {object} fill
   * @returns {{ pnl: string|null, position: object|null }}
   */
  onFill(fill) {
    const account = this._resolveAccount(fill.strategy);
    return account.onFill(fill);
  }

  /**
   * Get all positions across all accounts.
   * In tournament mode, each position gets a `strategy` field.
   * @returns {Array<object>}
   */
  getPositions() {
    if (!this._tournamentMode || this._accounts.size === 0) {
      return this._sharedAccount.getPositions();
    }

    const all = [];
    for (const [name, account] of this._accounts) {
      for (const pos of account.getPositions()) {
        all.push({ ...pos, strategy: name });
      }
    }
    return all;
  }

  /**
   * Get a specific position.
   * @param {string} symbol
   * @param {string} posSide
   * @param {string} [strategy] — required in tournament mode
   * @returns {object|null}
   */
  getPosition(symbol, posSide, strategy) {
    if (strategy && this._tournamentMode && this._accounts.has(strategy)) {
      return this._accounts.get(strategy).getPosition(symbol, posSide);
    }
    return this._sharedAccount.getPosition(symbol, posSide);
  }

  /**
   * Aggregate account state across all strategy accounts.
   * @returns {{ equity: string, availableBalance: string, unrealizedPnl: string }}
   */
  getAccountState() {
    if (!this._tournamentMode || this._accounts.size === 0) {
      return this._sharedAccount.getAccountState();
    }

    let totalEquity = '0';
    let totalBalance = '0';
    let totalUnrealizedPnl = '0';

    for (const account of this._accounts.values()) {
      const state = account.getAccountState();
      totalEquity = math.add(totalEquity, state.equity);
      totalBalance = math.add(totalBalance, state.availableBalance);
      totalUnrealizedPnl = math.add(totalUnrealizedPnl, state.unrealizedPnl);
    }

    return {
      equity: totalEquity,
      availableBalance: totalBalance,
      unrealizedPnl: totalUnrealizedPnl,
    };
  }

  /**
   * Set the initial balance for future accounts / resets.
   * @param {string} balance
   */
  setInitialBalance(balance) {
    if (balance) {
      this._initialBalance = balance;
    }
  }

  /**
   * Get positions for a specific strategy (tournament mode).
   * @param {string} name — strategy name
   * @returns {Array<object>}
   */
  getStrategyPositions(name) {
    const account = this._accounts.get(name);
    if (!account) return [];
    return account.getPositions().map((pos) => ({ ...pos, strategy: name }));
  }

  /**
   * Get a single strategy's account state.
   * @param {string} name — strategy name
   * @returns {{ equity: string, availableBalance: string, unrealizedPnl: string }|null}
   */
  getStrategyAccountState(name) {
    const account = this._accounts.get(name);
    if (!account) return null;
    return account.getAccountState();
  }

  /**
   * Get equity.
   * @returns {string}
   */
  getEquity() {
    if (!this._tournamentMode || this._accounts.size === 0) {
      return this._sharedAccount.getEquity();
    }

    let total = '0';
    for (const account of this._accounts.values()) {
      total = math.add(total, account.getEquity());
    }
    return total;
  }

  /**
   * Get balance.
   * @returns {string}
   */
  getBalance() {
    if (!this._tournamentMode || this._accounts.size === 0) {
      return this._sharedAccount.getBalance();
    }

    let total = '0';
    for (const account of this._accounts.values()) {
      total = math.add(total, account.getBalance());
    }
    return total;
  }

  /**
   * Update mark price across all accounts.
   * @param {string} symbol
   * @param {string} price
   */
  updateMarkPrice(symbol, price) {
    if (!this._tournamentMode || this._accounts.size === 0) {
      this._sharedAccount.updateMarkPrice(symbol, price);
      return;
    }

    for (const account of this._accounts.values()) {
      account.updateMarkPrice(symbol, price);
    }
  }

  /**
   * Reset — clear all accounts and restore initial balance.
   * @param {string} [initialBalance]
   */
  reset(initialBalance) {
    if (initialBalance) {
      this._initialBalance = initialBalance;
    }

    this._sharedAccount.reset(this._initialBalance);

    for (const account of this._accounts.values()) {
      account.reset(this._initialBalance);
    }

    this.emit(TRADE_EVENTS.POSITION_UPDATED, { positions: [] });
  }

  // =========================================================================
  // PositionManager lifecycle compatibility (no-op)
  // =========================================================================

  async start() {
    log.info('start — PaperAccountManager ready (no-op)');
  }

  stop() {
    log.info('stop — PaperAccountManager stopped (no-op)');
  }

  destroy() {
    log.info('destroy — PaperAccountManager destroyed (no-op)');
  }

  // =========================================================================
  // Leaderboard & info
  // =========================================================================

  /**
   * Get the leaderboard — strategy accounts sorted by equity (descending).
   * @returns {Array<{ rank: number, strategy: string, equity: string, pnl: string, pnlPercent: string, unrealizedPnl: string, positionCount: number }>}
   */
  getLeaderboard() {
    const entries = [];

    for (const [name, account] of this._accounts) {
      const state = account.getAccountState();
      const pnl = math.subtract(state.equity, this._initialBalance);
      const pnlPercent = math.isZero(this._initialBalance)
        ? '0'
        : math.multiply(math.divide(pnl, this._initialBalance), '100');

      entries.push({
        strategy: name,
        equity: state.equity,
        pnl,
        pnlPercent,
        unrealizedPnl: state.unrealizedPnl,
        positionCount: account.getPositions().length,
      });
    }

    // Sort by equity descending
    entries.sort((a, b) => {
      if (math.isGreaterThan(a.equity, b.equity)) return -1;
      if (math.isLessThan(a.equity, b.equity)) return 1;
      return 0;
    });

    // Assign ranks
    return entries.map((entry, idx) => ({ rank: idx + 1, ...entry }));
  }

  /**
   * Get tournament metadata.
   * @returns {{ tournamentId: string|null, running: boolean, startedAt: Date|null, strategyCount: number, initialBalance: string }}
   */
  getTournamentInfo() {
    return {
      tournamentId: this._tournamentId,
      running: this._tournamentRunning,
      startedAt: this._tournamentStartedAt,
      strategyCount: this._accounts.size,
      initialBalance: this._initialBalance,
    };
  }

  // =========================================================================
  // Internal
  // =========================================================================

  /**
   * Resolve the correct PaperPositionManager for a given strategy name.
   * Falls back to the shared account when not in tournament mode or when
   * the strategy account doesn't exist.
   *
   * @param {string} [strategyName]
   * @returns {PaperPositionManager}
   * @private
   */
  _resolveAccount(strategyName) {
    if (!this._tournamentMode || !strategyName) {
      return this._sharedAccount;
    }

    const account = this._accounts.get(strategyName);
    if (account) return account;

    // Auto-create account for unknown strategies during tournament
    if (this._tournamentRunning) {
      const newAccount = new PaperPositionManager({
        riskEngine: null,
        initialBalance: this._initialBalance,
      });

      newAccount.on(TRADE_EVENTS.POSITION_UPDATED, () => {
        this.emit(TRADE_EVENTS.POSITION_UPDATED, {
          positions: this.getPositions(),
        });
      });

      this._accounts.set(strategyName, newAccount);
      log.info('_resolveAccount — auto-created account', { strategy: strategyName });
      return newAccount;
    }

    return this._sharedAccount;
  }
}

module.exports = PaperAccountManager;
