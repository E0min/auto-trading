'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');

const log = createLogger('MongoDB');

const DEFAULT_URI = 'mongodb://localhost:27017/tradingBot';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Connect to MongoDB with automatic retry logic.
 *
 * Reads the connection URI from process.env.MONGO_URI, falling back to
 * the default local URI. Retries up to MAX_RETRIES times with a fixed
 * delay between attempts.
 *
 * @returns {Promise<mongoose.Connection>} The active mongoose connection.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI || DEFAULT_URI;
  let retries = 0;

  // ── Connection event listeners (registered once) ──────────────────
  mongoose.connection.on('connected', () => {
    log.info('Mongoose connected', { uri: uri.replace(/\/\/.*@/, '//<credentials>@') });
  });

  mongoose.connection.on('error', (err) => {
    log.error('Mongoose connection error', { error: err });
  });

  mongoose.connection.on('disconnected', () => {
    log.warn('Mongoose disconnected');
  });

  // ── Retry loop ────────────────────────────────────────────────────
  while (retries < MAX_RETRIES) {
    try {
      log.info(`Connecting to MongoDB (attempt ${retries + 1}/${MAX_RETRIES})`, {
        uri: uri.replace(/\/\/.*@/, '//<credentials>@'),
      });

      await mongoose.connect(uri, {
        // Mongoose 7+ uses the Node driver defaults; explicit options
        // are only needed when overriding.
        serverSelectionTimeoutMS: 10000,
        heartbeatFrequencyMS: 30000,
      });

      log.info('MongoDB connection established successfully');
      return mongoose.connection;
    } catch (err) {
      retries += 1;
      log.error(`MongoDB connection attempt ${retries} failed`, {
        error: { name: err.name, message: err.message },
        retriesLeft: MAX_RETRIES - retries,
      });

      if (retries >= MAX_RETRIES) {
        log.error('Max MongoDB connection retries reached — aborting');
        throw err;
      }

      log.info(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

module.exports = { connectDB };
