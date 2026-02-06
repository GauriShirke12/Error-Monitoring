import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { configureNodeAutoCapture, teardownNodeAutoCapture } from "../src/auto-capture.js";

describe("configureNodeAutoCapture", () => {
  let ErrorMonitor;
  let monitor;

  beforeAll(async () => {
    ({ ErrorMonitor } = await import("../../core/src/index.js"));
  });

  beforeEach(() => {
    monitor = new ErrorMonitor();
    monitor.init({ apiKey: "key", apiUrl: "https://example.com/errors" });
  });

  afterEach(() => {
    teardownNodeAutoCapture();
    monitor.clearQueue();
  });

  afterAll(() => {
    ErrorMonitor = undefined;
  });

  it("captures uncaught exceptions", () => {
    configureNodeAutoCapture(monitor, { exitOnError: false });

    const error = new Error("Boom");
    process.emit("uncaughtException", error);

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].tags).toMatchObject({ handledBy: "process.uncaughtException" });
  });

  it("captures unhandled rejections", () => {
    configureNodeAutoCapture(monitor, { exitOnError: false });

    const reason = new Error("Rejected");
    const fakePromise = { constructor: { name: "Promise" } };
    process.emit("unhandledRejection", reason, fakePromise);

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].tags).toMatchObject({ handledBy: "process.unhandledRejection" });
  });

  it("tears down listeners", () => {
    const initialCounts = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection")
    };

    const teardown = configureNodeAutoCapture(monitor, { exitOnError: false });

    expect(process.listenerCount("uncaughtException")).toBe(initialCounts.uncaught + 1);
    expect(process.listenerCount("unhandledRejection")).toBe(initialCounts.rejection + 1);

    teardown();

    expect(process.listenerCount("uncaughtException")).toBe(initialCounts.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(initialCounts.rejection);
  });

  it("deduplicates repeated errors", () => {
    configureNodeAutoCapture(monitor, { exitOnError: false });

    const error = new Error("Boom");
    process.emit("uncaughtException", error);
    process.emit("uncaughtException", error);

    const events = monitor.getBufferedEvents();
    expect(events).toHaveLength(1);
  });
});
