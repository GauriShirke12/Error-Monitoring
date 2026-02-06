const noop = () => {};

let teardownCurrent = noop;
let errorCache = new WeakSet();
let rejectionCache = new WeakSet();

function resetCaches() {
  errorCache = new WeakSet();
  rejectionCache = new WeakSet();
}

function isCallable(fn) {
  return typeof fn === "function";
}

function asError(reason, fallbackMessage) {
  if (reason instanceof Error) {
    return reason;
  }
  const message = typeof reason === "string" ? reason : fallbackMessage;
  return new Error(message);
}

function formatErrorBreadcrumb(message, data, overrides = {}) {
  return {
    message,
    category: "uncaught",
    level: "error",
    data,
    ...overrides
  };
}

export function teardownAutoCapture() {
  teardownCurrent();
  teardownCurrent = noop;
  resetCaches();
}

export function configureAutoCapture(target, monitor, options = {}) {
  teardownAutoCapture();

  if (!target || !isCallable(target.addEventListener) || !monitor) {
    return teardownCurrent;
  }

  const config = monitor.getConfig();
  if (!config) {
    return teardownCurrent;
  }

  const mergedOptions = {
    errors: true,
    promiseRejections: true,
    ...(options || {})
  };

  const detachFns = [];

  if (mergedOptions.errors) {
    const errorListener = (event) => {
      if (!monitor.isInitialized()) {
        return;
      }
      if (event?.error && errorCache.has(event.error)) {
        return;
      }

      const capturedError = asError(event?.error, event?.message || "Uncaught error");
      const context = {
        tags: {
          handledBy: "window.onerror",
          source: event?.filename || "unknown"
        },
        breadcrumbs: [
          formatErrorBreadcrumb(event?.message || capturedError.message, {
            filename: event?.filename || null,
            lineno: event?.lineno ?? null,
            colno: event?.colno ?? null
          })
        ],
        message: event?.message || null,
        filename: event?.filename || null,
        lineno: event?.lineno ?? null,
        colno: event?.colno ?? null
      };

      monitor.captureError(capturedError, context);

      if (event?.error && typeof event.error === "object") {
        errorCache.add(event.error);
      }
    };

    target.addEventListener("error", errorListener);
    detachFns.push(() => target.removeEventListener("error", errorListener));
  }

  if (mergedOptions.promiseRejections) {
    const rejectionListener = (event) => {
      if (!monitor.isInitialized()) {
        return;
      }

      const reason = event?.reason;
      if (reason && typeof reason === "object" && rejectionCache.has(reason)) {
        return;
      }

      const capturedError = asError(reason, "Unhandled promise rejection");
      const context = {
        tags: {
          handledBy: "unhandledrejection"
        },
        breadcrumbs: [
          formatErrorBreadcrumb(capturedError.message, {
            reasonType: reason != null ? typeof reason : "undefined"
          })
        ],
        reason: reason instanceof Error ? null : reason
      };

      monitor.captureError(capturedError, context);

      if (reason && typeof reason === "object") {
        rejectionCache.add(reason);
      }
    };

    target.addEventListener("unhandledrejection", rejectionListener);
    detachFns.push(() => target.removeEventListener("unhandledrejection", rejectionListener));
  }

  teardownCurrent = () => {
    while (detachFns.length) {
      const detach = detachFns.pop();
      try {
        detach();
      } catch (error) {
        // swallow detach errors to avoid cascading issues
      }
    }
    resetCaches();
  };

  return teardownCurrent;
}
