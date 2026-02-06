import { ErrorMonitor } from "@error-monitor/sdk-core";
import { configureAutoCapture, teardownAutoCapture } from "./auto-capture.js";

const singleton = new ErrorMonitor();

/**
 * Shared browser instance that coordinates automatic capture and manual reporting.
 */
export const ErrorMonitorInstance = singleton;

function applyAutoCapture() {
  if (typeof window === "undefined") {
    return;
  }

  const target = window;
  if (!target || typeof target.addEventListener !== "function") {
    return;
  }

  const config = singleton.getConfig();
  if (!config) {
    return;
  }

  configureAutoCapture(target, singleton, config.autoCapture);
}

/**
 * Initialize the browser SDK and register global auto-capture handlers when available.
 * @param {object} config
 * @returns {import("@error-monitor/sdk-core").ErrorMonitor}
 */
export function init(config) {
  const instance = singleton.init(config);
  applyAutoCapture();
  return instance;
}

/**
 * Forward error capture calls to the shared monitor instance.
 * @param {*} error
 * @param {object} [context]
 */
export function captureError(error, context) {
  return singleton.captureError(error, context);
}

/**
 * Set the active user for all subsequent browser events.
 */
export function setUser(user) {
  return singleton.setUser(user);
}

export function setTags(tags, options) {
  return singleton.setTags(tags, options);
}

export function setTag(key, value) {
  return singleton.setTag(key, value);
}

export function clearTags() {
  return singleton.clearTags();
}

/**
 * Record a breadcrumb describing a user interaction.
 */
export function addBreadcrumb(breadcrumb) {
  return singleton.addBreadcrumb(breadcrumb);
}

export function clearBreadcrumbs() {
  return singleton.clearBreadcrumbs();
}

export { ErrorMonitor, configureAutoCapture, teardownAutoCapture };

export default {
  init,
  captureError,
  setUser,
  setTags,
  setTag,
  clearTags,
  addBreadcrumb,
  clearBreadcrumbs,
  configureAutoCapture,
  teardownAutoCapture,
  instance: singleton
};
