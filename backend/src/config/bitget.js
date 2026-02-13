'use strict';

/**
 * Bitget SDK client singleton factory.
 *
 * Creates and caches singleton instances of Bitget SDK clients.
 * All clients are lazily instantiated on first call to avoid unnecessary
 * connections and to ensure environment variables are loaded before use.
 *
 * Credentials are read from environment variables:
 *   - BITGET_API_KEY
 *   - BITGET_SECRET_KEY
 *   - BITGET_PASSPHRASE
 */

const {
  RestClientV2,
  WebsocketClientV2,
  WebsocketClientV3,
  WebsocketAPIClient,
  WS_KEY_MAP,
} = require('bitget-api');

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

/**
 * Build the credentials object from environment variables.
 * Throws if any required variable is missing.
 *
 * @returns {{ apiKey: string, apiSecret: string, apiPass: string }}
 */
function getCredentials() {
  const apiKey = process.env.BITGET_API_KEY;
  const apiSecret = process.env.BITGET_SECRET_KEY;
  const apiPass = process.env.BITGET_PASSPHRASE;

  if (!apiKey || !apiSecret || !apiPass) {
    throw new Error(
      'Missing Bitget API credentials. Ensure BITGET_API_KEY, BITGET_SECRET_KEY, and BITGET_PASSPHRASE are set in the environment.',
    );
  }

  return { apiKey, apiSecret, apiPass };
}

// ---------------------------------------------------------------------------
// Singleton cache
// ---------------------------------------------------------------------------

/** @type {RestClientV2 | null} */
let _restClient = null;

/** @type {WebsocketClientV2 | null} */
let _wsPublicClient = null;

/** @type {WebsocketClientV3 | null} */
let _wsPrivateClient = null;

/** @type {WebsocketAPIClient | null} */
let _wsApiClient = null;

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Returns a cached RestClientV2 singleton.
 * The client is created on the first invocation.
 *
 * @returns {RestClientV2}
 */
function getRestClient() {
  if (!_restClient) {
    const creds = getCredentials();
    _restClient = new RestClientV2({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiPass: creds.apiPass,
    });
  }
  return _restClient;
}

/**
 * Returns a cached WebsocketClientV2 singleton configured for public
 * (market data) channels.
 *
 * Uses V2 because V3 public WebSocket does not support kline/candle
 * topics for futures — only ticker works on V3.
 *
 * @returns {WebsocketClientV2}
 */
function getWsPublicClient() {
  if (!_wsPublicClient) {
    _wsPublicClient = new WebsocketClientV2({});
  }
  return _wsPublicClient;
}

/**
 * Returns a cached WebsocketClientV3 singleton configured for private
 * (account, order, position) channels.
 *
 * The private client requires valid API credentials because it
 * authenticates automatically when connecting to private endpoints.
 *
 * @returns {WebsocketClientV3}
 */
function getWsPrivateClient() {
  if (!_wsPrivateClient) {
    const creds = getCredentials();
    _wsPrivateClient = new WebsocketClientV3({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiPass: creds.apiPass,
    });
  }
  return _wsPrivateClient;
}

/**
 * Returns a cached WebsocketAPIClient singleton for executing orders
 * via the WebSocket API (lower latency than REST).
 *
 * @returns {WebsocketAPIClient}
 */
function getWsApiClient() {
  if (!_wsApiClient) {
    const creds = getCredentials();
    _wsApiClient = new WebsocketAPIClient({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      apiPass: creds.apiPass,
      attachEventListeners: false, // Managed by exchangeClient
    });
  }
  return _wsApiClient;
}

/**
 * Returns the WS_KEY_MAP constant from the bitget-api package.
 * Useful for specifying WebSocket key targets when subscribing.
 *
 * Keys include: v3Public, v3Private, v2Public, v2Private, spotv1, mixv1
 *
 * @returns {typeof WS_KEY_MAP}
 */
function getWsKeyMap() {
  return WS_KEY_MAP;
}

module.exports = {
  getRestClient,
  getWsPublicClient,
  getWsPrivateClient,
  getWsApiClient,
  getWsKeyMap,
};
