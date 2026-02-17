'use strict';

/**
 * CustomStrategyStore — file-based persistence for custom strategy definitions.
 *
 * Stores JSON rule definitions in data/custom_strategies.json.
 * Max 20 custom strategies.
 */

const fs = require('fs');
const { writeFile, rename, mkdir } = require('fs/promises');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('CustomStrategyStore');

const DATA_DIR = path.resolve(__dirname, '../../data');
const FILE_PATH = path.join(DATA_DIR, 'custom_strategies.json');
const MAX_STRATEGIES = 20;

class CustomStrategyStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._strategies = new Map();
    /** @type {Promise<void>} serialization queue to prevent concurrent writes */
    this._writeQueue = Promise.resolve();
    this._load();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * List all saved custom strategy definitions.
   * @returns {object[]}
   */
  list() {
    return Array.from(this._strategies.values());
  }

  /**
   * Get a single strategy definition by ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this._strategies.get(id) || null;
  }

  /**
   * Save a new custom strategy definition.
   * @param {object} def — strategy definition (id is auto-generated if missing)
   * @returns {object} saved definition with id
   */
  save(def) {
    if (this._strategies.size >= MAX_STRATEGIES) {
      throw new Error(`최대 ${MAX_STRATEGIES}개의 커스텀 전략만 저장할 수 있습니다.`);
    }

    const id = def.id || `custom_${Date.now()}`;
    const entry = {
      ...def,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._strategies.set(id, entry);
    this._persistQueued();
    log.info('Custom strategy saved', { id, name: entry.name });
    return entry;
  }

  /**
   * Update an existing strategy definition.
   * @param {string} id
   * @param {object} def — updated definition
   * @returns {object} updated definition
   */
  update(id, def) {
    if (!this._strategies.has(id)) {
      throw new Error(`커스텀 전략 "${id}"을(를) 찾을 수 없습니다.`);
    }

    const existing = this._strategies.get(id);
    const updated = {
      ...existing,
      ...def,
      id, // keep original id
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this._strategies.set(id, updated);
    this._persistQueued();
    log.info('Custom strategy updated', { id, name: updated.name });
    return updated;
  }

  /**
   * Delete a custom strategy definition.
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    if (!this._strategies.has(id)) {
      return false;
    }

    this._strategies.delete(id);
    this._persistQueued();
    log.info('Custom strategy deleted', { id });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internal — file I/O
  // ---------------------------------------------------------------------------

  _load() {
    try {
      if (fs.existsSync(FILE_PATH)) {
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && item.id) {
              this._strategies.set(item.id, item);
            }
          }
        }
        log.info(`Loaded ${this._strategies.size} custom strategies from disk`);
      }
    } catch (err) {
      log.error('Failed to load custom strategies file', { error: err.message });
    }
  }

  /**
   * Enqueue a persist operation. Prevents concurrent writes by chaining
   * each write onto the previous one.
   */
  _persistQueued() {
    this._writeQueue = this._writeQueue
      .then(() => this._persist())
      .catch(err => log.error('Queued persist failed', { error: err.message }));
  }

  /**
   * Async atomic write: write to tmp file then rename for crash safety.
   * Errors are propagated (not silently caught) so the queue can log them.
   */
  async _persist() {
    if (!fs.existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    const arr = Array.from(this._strategies.values());
    const json = JSON.stringify(arr, null, 2);
    const tmpPath = FILE_PATH + '.tmp';
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, FILE_PATH);
  }
}

module.exports = CustomStrategyStore;
