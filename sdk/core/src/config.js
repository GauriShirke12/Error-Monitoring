import { isPlainObject } from "./utils.js";

const AUTO_CAPTURE_DEFAULTS = Object.freeze({
  errors: true,
  promiseRejections: true
});

const DEFAULT_SCRUB_FIELDS = Object.freeze([
  "password",
  "secret",
  "token",
  "authorization",
  "apiKey",
  "cardNumber",
  "creditCard",
  "ssn"
]);

const DEFAULT_SCRUB_PATTERNS = Object.freeze([
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]?){13,19}\b/g
]);

const DEFAULTS = Object.freeze({
  apiUrl: "https://api.error-monitor.dev",
  environment: "production",
  enabled: true,
  sampleRate: 1,
  beforeSend: null,
  flushIntervalMs: 5000,
  maxBatchSize: 10,
  maxQueueSize: 1000,
  maxBreadcrumbs: 20,
  autoCapture: AUTO_CAPTURE_DEFAULTS,
  scrubFields: DEFAULT_SCRUB_FIELDS,
  scrubPatterns: DEFAULT_SCRUB_PATTERNS
});

const REQUIRED_FIELDS = ["apiKey", "apiUrl"];

function assertObjectLike(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validateSampleRate(sampleRate) {
  if (typeof sampleRate !== "number" || Number.isNaN(sampleRate)) {
    throw new TypeError("sampleRate must be a number between 0 and 1");
  }
  if (sampleRate < 0 || sampleRate > 1) {
    throw new RangeError("sampleRate must be between 0 and 1");
  }
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function normalizeAutoCapture(autoCapture) {
  if (autoCapture == null) {
    return { ...AUTO_CAPTURE_DEFAULTS };
  }

  assertObjectLike(autoCapture, "autoCapture");

  const normalized = { ...AUTO_CAPTURE_DEFAULTS };

  if ("errors" in autoCapture) {
    if (typeof autoCapture.errors !== "boolean") {
      throw new TypeError("autoCapture.errors must be a boolean");
    }
    normalized.errors = autoCapture.errors;
  }

  if ("promiseRejections" in autoCapture) {
    if (typeof autoCapture.promiseRejections !== "boolean") {
      throw new TypeError("autoCapture.promiseRejections must be a boolean");
    }
    normalized.promiseRejections = autoCapture.promiseRejections;
  }

  return normalized;
}

function normalizeTags(tags) {
  if (tags == null) {
    return {};
  }

  if (!isPlainObject(tags)) {
    throw new TypeError("tags must be an object");
  }

  const normalized = {};
  for (const [key, value] of Object.entries(tags)) {
    const valueType = typeof value;
    if (!("string" === valueType || "number" === valueType || "boolean" === valueType)) {
      throw new TypeError("tag values must be string, number, or boolean");
    }
    normalized[key] = value;
  }

  return normalized;
}

function normalizeScrubFields(fields) {
  if (fields == null) {
    return [...DEFAULT_SCRUB_FIELDS];
  }
  if (!Array.isArray(fields)) {
    throw new TypeError("scrubFields must be an array of strings");
  }
  const normalized = [];
  for (const entry of fields) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError("scrubFields must contain non-empty strings");
    }
    normalized.push(entry.trim().toLowerCase());
  }
  return Array.from(new Set(normalized));
}

function normalizeScrubPatterns(patterns) {
  if (patterns == null) {
    return [...DEFAULT_SCRUB_PATTERNS];
  }
  if (!Array.isArray(patterns)) {
    throw new TypeError("scrubPatterns must be an array of regular expressions");
  }
  const normalized = [];
  for (const entry of patterns) {
    if (!(entry instanceof RegExp)) {
      throw new TypeError("scrubPatterns entries must be regular expressions");
    }
    normalized.push(entry);
  }
  return normalized;
}

export function resolveConfig(input) {
  assertObjectLike(input, "config");

  const merged = {
    ...DEFAULTS,
    ...input
  };

  for (const field of REQUIRED_FIELDS) {
    if (!(field in merged)) {
      throw new Error(`${field} is required`);
    }
  }

  assertNonEmptyString(merged.apiKey, "apiKey");

  assertNonEmptyString(merged.apiUrl, "apiUrl");
  try {
    // eslint-disable-next-line no-new
    new URL(merged.apiUrl);
  } catch (error) {
    throw new TypeError("apiUrl must be a valid URL");
  }

  if (merged.environment != null) {
    assertNonEmptyString(merged.environment, "environment");
  } else {
    merged.environment = DEFAULTS.environment;
  }

  if (merged.enabled != null && typeof merged.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }

  if (merged.sampleRate != null) {
    validateSampleRate(merged.sampleRate);
  } else {
    merged.sampleRate = DEFAULTS.sampleRate;
  }

  if (merged.beforeSend != null && typeof merged.beforeSend !== "function") {
    throw new TypeError("beforeSend must be a function if provided");
  }

  if (merged.flushIntervalMs != null) {
    validatePositiveInteger(merged.flushIntervalMs, "flushIntervalMs");
  } else {
    merged.flushIntervalMs = DEFAULTS.flushIntervalMs;
  }

  if (merged.maxBatchSize != null) {
    validatePositiveInteger(merged.maxBatchSize, "maxBatchSize");
  } else {
    merged.maxBatchSize = DEFAULTS.maxBatchSize;
  }

  if (merged.maxQueueSize != null) {
    validatePositiveInteger(merged.maxQueueSize, "maxQueueSize");
  } else {
    merged.maxQueueSize = DEFAULTS.maxQueueSize;
  }

  if (merged.maxBreadcrumbs != null) {
    validatePositiveInteger(merged.maxBreadcrumbs, "maxBreadcrumbs");
  } else {
    merged.maxBreadcrumbs = DEFAULTS.maxBreadcrumbs;
  }

  if (merged.user != null) {
    assertObjectLike(merged.user, "user");
  }

  const autoCapture = normalizeAutoCapture(merged.autoCapture);
  const tags = normalizeTags(merged.tags);
  const scrubFields = normalizeScrubFields(merged.scrubFields);
  const scrubPatterns = normalizeScrubPatterns(merged.scrubPatterns);

  return {
    apiKey: merged.apiKey.trim(),
    apiUrl: merged.apiUrl.trim(),
    environment: merged.environment.trim(),
    enabled: merged.enabled ?? DEFAULTS.enabled,
    sampleRate: merged.sampleRate,
    beforeSend: merged.beforeSend || null,
    flushIntervalMs: merged.flushIntervalMs,
    maxBatchSize: merged.maxBatchSize,
    maxQueueSize: merged.maxQueueSize,
    maxBreadcrumbs: merged.maxBreadcrumbs,
    autoCapture,
    scrubFields,
    scrubPatterns,
    tags,
    user: merged.user ? { ...merged.user } : null
  };
}

export function getDefaultConfig() {
  return {
    ...DEFAULTS,
    beforeSend: null,
    autoCapture: { ...AUTO_CAPTURE_DEFAULTS },
    scrubFields: [...DEFAULT_SCRUB_FIELDS],
    scrubPatterns: [...DEFAULT_SCRUB_PATTERNS],
    tags: {}
  };
}
