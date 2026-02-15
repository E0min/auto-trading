'use strict';

const { createLogger } = require('../utils/logger');
const crypto = require('crypto');

const log = createLogger('ApiKeyAuth');

const API_KEY = process.env.API_KEY || '';

const PUBLIC_PATHS = [
  '/api/health',
  '/metrics',
];

function createApiKeyAuth() {
  if (!API_KEY) {
    if (process.env.PAPER_TRADING !== 'true') {
      log.error('API_KEY is required in live trading mode. Set API_KEY in .env or enable PAPER_TRADING.');
    }
    log.warn('API_KEY not configured — authentication is DISABLED');
    return (_req, _res, next) => next();
  }

  log.info('API key authentication enabled');

  return (req, res, next) => {
    for (const path of PUBLIC_PATHS) {
      if (req.path.startsWith(path)) {
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn('Missing or malformed Authorization header', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
      return res.status(401).json({
        success: false,
        error: '인증이 필요합니다. Authorization: Bearer <API_KEY> 헤더를 포함하세요.',
      });
    }

    const providedKey = authHeader.slice(7);

    const keyBuffer = Buffer.from(API_KEY, 'utf-8');
    const providedBuffer = Buffer.from(providedKey, 'utf-8');

    if (keyBuffer.length !== providedBuffer.length ||
        !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
      log.warn('Invalid API key', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({
        success: false,
        error: '유효하지 않은 API 키입니다.',
      });
    }

    next();
  };
}

module.exports = { createApiKeyAuth };
