const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]+/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]?){13,19}\b/g;
const SSN_REGEX = /\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/g;
const GENERIC_KEY_REGEX = /\b(sk|pk|api|key|token)[_-]?([a-z0-9]{6,})([a-z0-9]{2})\b/gi;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}/g;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

const stripHtmlTags = (value) => value.replace(/<[^>]*>/g, '');

const clampLength = (value, max = 2000) => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
};

const applyPIIScrubbing = (value, options = {}) => {
  let scrubbed = value;

  if (options.removeEmails) {
    scrubbed = scrubbed.replace(EMAIL_REGEX, '[REDACTED:EMAIL]');
  }
  if (options.removePhones) {
    scrubbed = scrubbed.replace(PHONE_REGEX, '[REDACTED:PHONE]');
  }
  if (options.removeIPs) {
    scrubbed = scrubbed.replace(IPV4_REGEX, '[REDACTED:IP]');
  }

  return scrubbed;
};

const maskSensitivePatterns = (value, options = {}) => {
  let sanitized = value;
  const patterns = [
    {
      regex: CREDIT_CARD_REGEX,
      replace: '[REDACTED:CARD]',
    },
    {
      regex: SSN_REGEX,
      replace: (_, a, b, c) => `${a}-**-${c}`,
    },
    {
      regex: /(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*([^\s]+)/gi,
      replace: (_, key) => `${key}=[REDACTED]`,
    },
    {
      regex: /(bearer\s+)[a-z0-9._-]+/gi,
      replace: (_, prefix) => `${prefix}[REDACTED]`,
    },
    {
      regex: GENERIC_KEY_REGEX,
      replace: (_, prefix, body, suffix) => `${prefix}-${'*'.repeat(Math.max(body.length - 2, 4))}${suffix}`,
    },
  ];

  patterns.forEach(({ regex, replace }) => {
    sanitized = sanitized.replace(regex, replace);
  });

  sanitized = applyPIIScrubbing(sanitized, options);

  return sanitized;
};

const sanitizeString = (value, options = {}) => {
  if (typeof value !== 'string') {
    return value;
  }

  const noControl = value.replace(CONTROL_CHAR_REGEX, '');
  const noHtml = stripHtmlTags(noControl);
  const masked = maskSensitivePatterns(noHtml, options);
  return clampLength(masked, 2000);
};

const sanitizeValue = (value, options = {}) => {
  if (typeof value === 'string') {
    return sanitizeString(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, options));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nested]) => {
      acc[key] = sanitizeValue(nested, options);
      return acc;
    }, {});
  }

  return value;
};

const sanitizeStackTrace = (stackTrace = [], options = {}) =>
  stackTrace.map((frame) => {
    if (!frame || typeof frame !== 'object') {
      return frame;
    }
    return Object.entries(frame).reduce((acc, [key, value]) => {
      acc[key] = sanitizeValue(value, options);
      return acc;
    }, {});
  });

const sanitizeErrorPayload = (payload, options = {}) => {
  const sanitized = { ...payload };
  const hasMetadata = Object.prototype.hasOwnProperty.call(payload, 'metadata');
  const hasUserContext = Object.prototype.hasOwnProperty.call(payload, 'userContext');

  sanitized.message = sanitizeString(payload.message, options);
  sanitized.environment = sanitizeString(payload.environment, options);
  sanitized.stackTrace = sanitizeStackTrace(payload.stackTrace || [], options);

  if (hasMetadata) {
    sanitized.metadata = sanitizeValue(payload.metadata, options);
  }

  if (hasUserContext) {
    sanitized.userContext = sanitizeValue(payload.userContext, options);
  }

  if (payload.request) {
    sanitized.request = sanitizeValue(payload.request, options);
  }
  if (payload.context) {
    sanitized.context = sanitizeValue(payload.context, options);
  }

  sanitized.__hasMetadata = hasMetadata;
  sanitized.__hasUserContext = hasUserContext;

  return sanitized;
};

module.exports = {
  sanitizeErrorPayload,
  sanitizeString,
  sanitizeValue,
};
