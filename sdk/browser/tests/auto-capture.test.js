import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ErrorMonitor } from "../../core/src/index.js";
import { configureAutoCapture, teardownAutoCapture } from "../src/auto-capture.js";

function createMockWindow() {
  const listeners = new Map();
  return {
    addEventListener: jest.fn((type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    }),
    removeEventListener: jest.fn((type, handler) => {
      if (!listeners.has(type)) {
        return;
      }
      listeners.get(type).delete(handler);
    }),
    emit(type, event) {
      if (!listeners.has(type)) {
        return;
      }
      for (const handler of listeners.get(type)) {
        handler(event);
      }
    },
    listenerCount(type) {
      return listeners.has(type) ? listeners.get(type).size : 0;
    }
  };
}

describe("configureAutoCapture", () => {
  let monitor;
  let mockWindow;

  beforeEach(() => {
    monitor = new ErrorMonitor();
    monitor.init({ apiKey: "key", apiUrl: "https://example.com/ingest" });
    mockWindow = createMockWindow();
  });

  afterEach(() => {
    teardownAutoCapture();
    monitor.clearQueue();
  });

  it("captures window errors", () => {
    configureAutoCapture(mockWindow, monitor, { errors: true, promiseRejections: false });

    const error = new Error("Boom");
    mockWindow.emit("error", {
      error,
      message: error.message,
      filename: "app.js",
      lineno: 12,
      colno: 4
    });

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].tags).toMatchObject({ handledBy: "window.onerror" });
    expect(events[0].context).toMatchObject({ filename: "app.js", lineno: 12, colno: 4, message: "Boom" });
    expect(Array.isArray(events[0].error.stacktrace)).toBe(true);
  });

  it("captures unhandled rejections", () => {
    configureAutoCapture(mockWindow, monitor, { errors: false, promiseRejections: true });

    const reason = new Error("Rejected");
    mockWindow.emit("unhandledrejection", { reason });

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].tags).toMatchObject({ handledBy: "unhandledrejection" });
    expect(events[0].error.message).toBe("Rejected");
    expect(Array.isArray(events[0].error.stacktrace)).toBe(true);
  });

  it("tears down listeners", () => {
    const teardown = configureAutoCapture(mockWindow, monitor, { errors: true, promiseRejections: true });
    expect(mockWindow.listenerCount("error")).toBe(1);
    expect(mockWindow.listenerCount("unhandledrejection")).toBe(1);

    teardown();

    expect(mockWindow.listenerCount("error")).toBe(0);
    expect(mockWindow.listenerCount("unhandledrejection")).toBe(0);
  });

  it("honors disabled error capture", () => {
    configureAutoCapture(mockWindow, monitor, { errors: false, promiseRejections: false });

    mockWindow.emit("error", { message: "ignored" });
    mockWindow.emit("unhandledrejection", { reason: "nope" });

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(0);
  });
});
