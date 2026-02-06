const crypto = require('crypto');

const API_KEY_PREFIX = 'proj_';
const API_KEY_BYTES = 32;
const HASH_ALGORITHM = 'sha256';

function createApiKey() {
  const random = crypto.randomBytes(API_KEY_BYTES).toString('hex');
  return `${API_KEY_PREFIX}${random}`;
}

function hashApiKey(value) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError('Cannot hash API key: value must be a non-empty string');
  }
  return crypto.createHash(HASH_ALGORITHM).update(value).digest('hex');
}

function getApiKeyPreview(value, length = 8) {
  if (typeof value !== 'string' || !value.length) {
    return '';
  }
  return value.slice(-Math.max(4, length));
}

module.exports = {
  createApiKey,
  hashApiKey,
  getApiKeyPreview,
};
