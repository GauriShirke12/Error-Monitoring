import { nanoid } from "nanoid";
import { resolveConfig } from "./config.js";
import { parseStackTrace } from "./stack-trace.js";
import { collectSystemInfo } from "./system-info.js";
import { SDK_VERSION } from "./version.js";
import { isPlainObject } from "./utils.js";
export { EventQueue } from "./event-queue.js";

const SYSTEM_INFO = collectSystemInfo();
const FILTERED_PLACEHOLDER = "[Filtered]";

function coerceToError(input) {
  if (input instanceof Error) {
    return input;
  }

  if (typeof input === "string") {
    const error = new Error(input);
    error.name = "Error";
    return error;
  }

  if (isPlainObject(input)) {
    const message = typeof input.message === "string" ? input.message : "Unknown error";
    const name = typeof input.name === "string" ? input.name : "Error";
    const error = new Error(message);
    error.name = name;
    if (typeof input.stack === "string") {
      error.stack = input.stack;
    }
    return error;
  }

  return new Error("Unknown error");
}

function normalizeError(input) {
  const error = coerceToError(input);
  const stack = typeof error.stack === "string" ? error.stack : new Error(error.message || "Error").stack || "";

  return {
    name: error.name || "Error",
    message: error.message || "Unknown error",
    stack,
    stacktrace: parseStackTrace(stack)
  };
}

const TAG_VALUE_TYPES = new Set(["string", "number", "boolean"]);

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }
  if (isPlainObject(value)) {
    const cloned = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = deepClone(entry);
    }
    return cloned;
  }
  return value;
}

function cloneEventPayload(event) {
  return deepClone(event);
}

function scrubString(value, patterns) {
  if (typeof value !== "string") {
    return value;
  }
  let scrubbed = value;
  for (const pattern of patterns) {
    scrubbed = scrubbed.replace(pattern, FILTERED_PLACEHOLDER);
  }
  return scrubbed;
}

function scrubValue(value, options) {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, options));
  }
  if (value && typeof value === "object") {
    const scrubbed = {};
    for (const [key, entry] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (options.scrubFields.has(lowerKey)) {
        scrubbed[key] = FILTERED_PLACEHOLDER;
        continue;
      }
      scrubbed[key] = scrubValue(entry, options);
    }
    return scrubbed;
  }
  return scrubString(value, options.scrubPatterns);
}

function scrubEventData(event, config) {
  const payload = cloneEventPayload(event);
  const scrubFields = Array.isArray(config?.scrubFields)
    ? new Set(config.scrubFields.map((name) => (typeof name === "string" ? name.toLowerCase() : "")))
    : new Set();
  const scrubPatterns = Array.isArray(config?.scrubPatterns) ? config.scrubPatterns : [];
  const options = { scrubFields, scrubPatterns };
  return scrubValue(payload, options);
}

function sanitizeContext(context) {
  if (!isPlainObject(context)) {
    return {
      context: {},
      tags: {},
      breadcrumbs: []
    };
  }

  const working = { ...context };
  const tagsValue = working.tags;
  const breadcrumbsValue = working.breadcrumbs;

  delete working.tags;
  delete working.breadcrumbs;

  const tags = isPlainObject(tagsValue) ? { ...tagsValue } : {};
  const breadcrumbs = Array.isArray(breadcrumbsValue) ? [...breadcrumbsValue] : [];

  const nestedContext = isPlainObject(working.context) ? { ...working.context } : {};
  if (working.context) {
    delete working.context;
  }

  return {
    context: { ...nestedContext, ...working },
    tags,
    breadcrumbs
  };
}

function validateTagValue(value) {
  return TAG_VALUE_TYPES.has(typeof value);
}

function normalizeBreadcrumb(input) {
  if (!isPlainObject(input)) {
    throw new TypeError("breadcrumb must be an object");
  }

  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) {
    throw new TypeError("breadcrumb.message must be a non-empty string");
  }

  const category = typeof input.category === "string" ? input.category : "general";
  const level = typeof input.level === "string" ? input.level : "info";
  const timestamp = typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString();
  const data = isPlainObject(input.data) ? { ...input.data } : undefined;

  return data
    ? { message, category, level, timestamp, data }
    : { message, category, level, timestamp };
}

/**
 * Core SDK surface that normalizes errors, enriches them with context, and buffers
 * events for delivery through the configured transport layer.
 */
export class ErrorMonitor {
  constructor(initialConfig) {
    this._config = null;
    this._queue = [];
    this._user = null;
    this._tags = {};
    this._breadcrumbs = [];
    this._initialized = false;
    this._sessionId = nanoid(10);

    if (initialConfig) {
      this.init(initialConfig);
    }
  }

  /**
   * Resolve and persist configuration defaults, resetting runtime state.
   * @param {object} config Partial configuration supplied by the SDK consumer.
   * @returns {ErrorMonitor}
   */
  init(config) {
    const resolved = resolveConfig(config);
    this._config = resolved;
    this._queue = [];
    this._user = resolved.user ? { ...resolved.user } : null;
    this._tags = { ...resolved.tags };
    this._breadcrumbs = [];
    this._initialized = true;
    return this;
  }

  isInitialized() {
    return this._initialized;
  }

  isEnabled() {
    return this._initialized && this._config.enabled !== false;
  }

  getConfig() {
    if (!this._config) {
      return null;
    }
    return {
      ...this._config,
      autoCapture: { ...this._config.autoCapture },
       scrubFields: Array.isArray(this._config.scrubFields) ? [...this._config.scrubFields] : [],
       scrubPatterns: Array.isArray(this._config.scrubPatterns) ? [...this._config.scrubPatterns] : [],
      tags: { ...this._tags },
      user: this._user ? { ...this._user } : null
    };
  }

  /**
   * Attach user metadata to subsequent error payloads.
   * @param {object|null} user
   * @returns {object|null}
   */
  setUser(user) {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before setUser");
    }
    if (user == null) {
      this._user = null;
      return null;
    }
    if (!isPlainObject(user)) {
      throw new TypeError("user must be an object or null");
    }
    this._user = { ...user };
    return this._user;
  }

  /**
   * Merge user-provided tags into the global tag collection.
   * @param {object} tags
   * @param {{replace?: boolean}} [options]
   * @returns {object}
   */
  setTags(tags, { replace = false } = {}) {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before setTags");
    }
    if (!isPlainObject(tags)) {
      throw new TypeError("tags must be an object");
    }

    const next = replace ? {} : { ...this._tags };
    for (const [key, value] of Object.entries(tags)) {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new TypeError("tag keys must be non-empty strings");
      }
      if (!validateTagValue(value)) {
        throw new TypeError("tag values must be string, number, or boolean");
      }
      next[key] = value;
    }

    this._tags = next;
    return { ...this._tags };
  }

  setTag(key, value) {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before setTag");
    }
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new TypeError("tag key must be a non-empty string");
    }
    if (!validateTagValue(value)) {
      throw new TypeError("tag values must be string, number, or boolean");
    }
    this._tags = { ...this._tags, [key]: value };
    return value;
  }

  clearTags() {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before clearTags");
    }
    this._tags = {};
  }

  /**
   * Append a breadcrumb describing a user action or notable event.
   * @param {object} breadcrumb
   * @returns {object}
   */
  addBreadcrumb(breadcrumb) {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before addBreadcrumb");
    }
    const normalized = normalizeBreadcrumb(breadcrumb);
    this._breadcrumbs = [...this._breadcrumbs, normalized].slice(-this._config.maxBreadcrumbs);
    return normalized;
  }

  clearBreadcrumbs() {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before clearBreadcrumbs");
    }
    this._breadcrumbs = [];
  }

  /**
   * Normalize and queue an error event, honoring sampling rules and hooks.
   * @param {*} error
   * @param {object} [context]
   * @returns {object|null}
   */
  captureError(error, context = {}) {
    if (!this._initialized) {
      throw new Error("ErrorMonitor.init must be called before captureError");
    }

    if (!this.isEnabled()) {
      return null;
    }

    if (this._config.sampleRate < 1 && Math.random() > this._config.sampleRate) {
      return null;
    }

    const { context: extraContext, tags: contextTags, breadcrumbs: contextBreadcrumbs } = sanitizeContext(context);

    const eventTags = { ...this._tags, ...contextTags };
    const mergedBreadcrumbs = [
      ...this._breadcrumbs.map((crumb) => ({
        ...crumb,
        data: isPlainObject(crumb.data) ? { ...crumb.data } : crumb.data
      }))
    ];

    for (const crumb of contextBreadcrumbs) {
      mergedBreadcrumbs.push(normalizeBreadcrumb(crumb));
    }

    const finalBreadcrumbs = mergedBreadcrumbs.slice(-this._config.maxBreadcrumbs);

    const event = {
      id: nanoid(),
      apiKey: this._config.apiKey,
      timestamp: new Date().toISOString(),
      environment: this._config.environment,
      sdkVersion: SDK_VERSION,
      system: { ...SYSTEM_INFO },
      sessionId: this._sessionId,
      user: this._user ? { ...this._user } : null,
      context: extraContext,
      tags: eventTags,
      breadcrumbs: finalBreadcrumbs,
      error: normalizeError(error)
    };

    const sanitizedEvent = scrubEventData(event, this._config);
    const hook = this._config.beforeSend;
    if (typeof hook === "function") {
      const result = hook(sanitizedEvent);
      if (result == null) {
        return null;
      }
      if (!isPlainObject(result)) {
        throw new TypeError("beforeSend must return an event object or null");
      }
      const scrubbedResult = scrubEventData(result, this._config);
      const cloned = cloneEventPayload(scrubbedResult);
      this._queue.push(cloned);
      return scrubbedResult;
    }

    const clonedEvent = cloneEventPayload(sanitizedEvent);
    this._queue.push(clonedEvent);
    return sanitizedEvent;
  }

  getBufferedEvents() {
    return this._queue.map((entry) => cloneEventPayload(entry));
  }

  clearQueue() {
    this._queue = [];
  }
}

export const errorMonitor = new ErrorMonitor();

export default ErrorMonitor;
