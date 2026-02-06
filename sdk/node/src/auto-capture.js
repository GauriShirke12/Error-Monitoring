const noop = () => {};

let teardown = noop;
let seenErrors = new WeakSet();
let seenReasons = new WeakSet();

function resetCaches() {
  seenErrors = new WeakSet();
  seenReasons = new WeakSet();
}

function scheduleRethrow(error) {
  // Preserve default Node.js crash semantics.
  process.nextTick(() => {
    throw error;
  });
}

export function teardownNodeAutoCapture() {
  teardown();
  teardown = noop;
  resetCaches();
}

export function configureNodeAutoCapture(monitor, options = {}) {
  teardownNodeAutoCapture();

  if (!monitor) {
    return noop;
  }

  const {
    uncaughtException = true,
    unhandledRejection = true,
    exitOnError = true
  } = options;

  const detachFns = [];

  if (uncaughtException) {
    const handler = (error) => {
      if (error && seenErrors.has(error)) {
        return;
      }

      const captured = error instanceof Error ? error : new Error(String(error || "Unknown error"));
      monitor.captureError(captured, {
        tags: {
          handledBy: "process.uncaughtException"
        }
      });

      if (error && typeof error === "object") {
        seenErrors.add(error);
      }

      if (exitOnError) {
        scheduleRethrow(error instanceof Error ? error : captured);
      }
    };

    process.on("uncaughtException", handler);
    detachFns.push(() => process.removeListener("uncaughtException", handler));
  }

  if (unhandledRejection) {
    const handler = (reason, promise) => {
      if (reason && typeof reason === "object" && seenReasons.has(reason)) {
        return;
      }

      const captured = reason instanceof Error ? reason : new Error(String(reason || "Unhandled rejection"));
      monitor.captureError(captured, {
        tags: {
          handledBy: "process.unhandledRejection"
        },
        reason: reason instanceof Error ? null : reason,
        promiseType: promise?.constructor?.name || null
      });

      if (reason && typeof reason === "object") {
        seenReasons.add(reason);
      }
    };

    process.on("unhandledRejection", handler);
    detachFns.push(() => process.removeListener("unhandledRejection", handler));
  }

  teardown = () => {
    while (detachFns.length) {
      const detach = detachFns.pop();
      try {
        detach();
      } catch (error) {
        // ignore teardown errors
      }
    }
    resetCaches();
  };

  return teardown;
}
