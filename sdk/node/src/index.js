import { ErrorMonitor, errorMonitor } from "@error-monitor/sdk-core";
import { configureNodeAutoCapture, teardownNodeAutoCapture } from "./auto-capture.js";

const singleton = errorMonitor;

function shouldEnable(flag) {
  return typeof flag === "boolean" ? flag : true;
}

/**
 * Initialize monitoring for a Node.js process and optionally wire global handlers.
 * @param {object} config
 * @param {{autoCapture?: boolean, exitOnError?: boolean}} [options]
 * @returns {import("@error-monitor/sdk-core").ErrorMonitor}
 */
export function init(config, options = {}) {
  const instance = singleton.init(config);

  const autoCaptureConfig = instance.getConfig()?.autoCapture || {};
  const enableErrors = shouldEnable(autoCaptureConfig.errors);
  const enableRejections = shouldEnable(autoCaptureConfig.promiseRejections);

  const {
    autoCapture = true,
    exitOnError = true
  } = options;

  if (autoCapture) {
    configureNodeAutoCapture(singleton, {
      uncaughtException: enableErrors,
      unhandledRejection: enableRejections,
      exitOnError
    });
  }

  return instance;
}

/**
 * Capture an error immediately using the shared Node.js instance.
 * @param {*} error
 * @param {object} [context]
 */
export function captureError(error, context) {
  return singleton.captureError(error, context);
}

export function setUser(user) {
  return singleton.setUser(user);
}

export function setTags(tags, opts) {
  return singleton.setTags(tags, opts);
}

export function setTag(key, value) {
  return singleton.setTag(key, value);
}

export function clearTags() {
  return singleton.clearTags();
}

/**
 * Append a breadcrumb relevant to upcoming events.
 * @param {object} breadcrumb
 */
export function addBreadcrumb(breadcrumb) {
  return singleton.addBreadcrumb(breadcrumb);
}

export function clearBreadcrumbs() {
  return singleton.clearBreadcrumbs();
}

export {
  ErrorMonitor,
  configureNodeAutoCapture,
  teardownNodeAutoCapture,
  singleton as errorMonitor
};

export default {
  init,
  captureError,
  setUser,
  setTags,
  setTag,
  clearTags,
  addBreadcrumb,
  clearBreadcrumbs,
  configureNodeAutoCapture,
  teardownNodeAutoCapture,
  instance: singleton
};
