const crypto = require('crypto');

const normalizeFrame = (frame = {}) => {
  const file = frame.file || frame.filename || '';
  const line = frame.line != null ? frame.line : frame.lineno;
  const column = frame.column != null ? frame.column : frame.colno;
  const fn = frame.function || frame.func || frame.method || '';

  return [file, line ?? '', column ?? '', fn].join(':');
};

const createFingerprint = (message, stackTrace = []) => {
  const normalizedMessage = message || '';
  const topFrames = stackTrace.slice(0, 3).map(normalizeFrame).join('|');
  const hash = crypto.createHash('md5');
  hash.update(`${normalizedMessage}|${topFrames}`);
  return hash.digest('hex');
};

module.exports = {
  createFingerprint,
};
