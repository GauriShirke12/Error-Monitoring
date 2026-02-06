import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ErrorMonitor } from "../src/index.js";

describe("ErrorMonitor", () => {
  const validConfig = {
    apiKey: "test-key",
    apiUrl: "https://example.com/errors"
  };
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requires init before captureError", () => {
    const monitor = new ErrorMonitor();
    expect(() => monitor.captureError(new Error("boom"))).toThrow(/init/);
  });

  it("stores config after init", () => {
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, environment: "staging" });

    const config = monitor.getConfig();
    expect(config.environment).toBe("staging");
    expect(config.apiKey).toBe(validConfig.apiKey);
    expect(config.tags).toEqual({});
  });

  it("respects disabled flag", () => {
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, enabled: false });

    const result = monitor.captureError(new Error("boom"));
    expect(result).toBeNull();
    expect(monitor.getBufferedEvents()).toHaveLength(0);
  });

  it("applies sampleRate", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, sampleRate: 0.1 });

    const skipped = monitor.captureError(new Error("ignored"));
    expect(skipped).toBeNull();

    Math.random.mockReturnValue(0.05);
    const accepted = monitor.captureError(new Error("accepted"));
    expect(accepted).not.toBeNull();
    expect(monitor.getBufferedEvents()).toHaveLength(1);
    expect(Array.isArray(accepted.error.stacktrace)).toBe(true);
  });

  it("sends roughly half of events when sampleRate is 0.5", () => {
    const sequence = [0.1, 0.6, 0.4, 0.7, 0.2, 0.8, 0.3, 0.9, 0.05, 0.95];
    let index = 0;
    jest.spyOn(Math, "random").mockImplementation(() => {
      const value = sequence[index % sequence.length];
      index += 1;
      return value;
    });

    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, sampleRate: 0.5 });

    let accepted = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      const result = monitor.captureError(new Error(`event-${i}`));
      if (result) {
        accepted += 1;
      }
    }

    expect(accepted).toBe(5);
    expect(monitor.getBufferedEvents()).toHaveLength(5);
  });

  it("invokes beforeSend hook", () => {
    const beforeSend = jest.fn((event) => ({ ...event, context: { tagged: true } }));
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, beforeSend });

    const result = monitor.captureError(new Error("boom"));
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(result.context).toEqual({ tagged: true });
    expect(Array.isArray(result.error.stacktrace)).toBe(true);
  });

  it("allows beforeSend to drop events", () => {
    const beforeSend = jest.fn(() => null);
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, beforeSend });

    const result = monitor.captureError(new Error("ignore me"));

    expect(result).toBeNull();
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(monitor.getBufferedEvents()).toHaveLength(0);
  });

  it("throws when beforeSend returns invalid value", () => {
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, beforeSend: () => "nope" });

    expect(() => monitor.captureError(new Error("boom"))).toThrow(/beforeSend/);
  });

  it("allows updating user context", () => {
    const monitor = new ErrorMonitor();
    monitor.init(validConfig);

    monitor.setUser({ id: "u-1" });
    const event = monitor.captureError(new Error("boom"));

    expect(event.user).toEqual({ id: "u-1" });
    expect(event.tags).toEqual({});
    expect(event.system).toHaveProperty("platform");
  });

  it("merges tags and breadcrumbs", () => {
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, tags: { release: "1.0.0" }, maxBreadcrumbs: 3 });

    monitor.setTag("feature", "onboarding");
    monitor.addBreadcrumb({ message: "User clicked button", category: "ui" });

    const event = monitor.captureError(new Error("boom"), {
      tags: { requestId: "req-1" },
      breadcrumbs: [{ message: "Promise rejected" }],
      route: "/checkout"
    });

    expect(event.tags).toEqual({ release: "1.0.0", feature: "onboarding", requestId: "req-1" });
    expect(event.context).toEqual({ route: "/checkout" });
    expect(event.breadcrumbs).toHaveLength(2);
    expect(event.breadcrumbs[0].message).toBe("User clicked button");
    expect(event.breadcrumbs[1].message).toBe("Promise rejected");
    expect(event.tags).toEqual({ release: "1.0.0", feature: "onboarding", requestId: "req-1" });
  });

  it("scrubs sensitive data from events", () => {
    const monitor = new ErrorMonitor();
    monitor.init(validConfig);

    monitor.setTags({ token: "abc123" });

    const event = monitor.captureError(new Error("boom"), {
      tags: { authorization: "Bearer secret-token" },
      password: "hunter2",
      note: "card 4111 1111 1111 1111",
      nested: { token: "nested-secret" }
    });

    expect(event.tags.token).toBe("[Filtered]");
    expect(event.tags.authorization).toBe("[Filtered]");
    expect(event.context.password).toBe("[Filtered]");
    expect(event.context.note).toContain("[Filtered]");
    expect(event.context.nested.token).toBe("[Filtered]");

    const buffered = monitor.getBufferedEvents()[0];
    expect(buffered.context.password).toBe("[Filtered]");
    expect(buffered.context.note).toContain("[Filtered]");
    expect(buffered.context.nested.token).toBe("[Filtered]");
  });

  it("scrubs data added inside beforeSend", () => {
    const monitor = new ErrorMonitor();
    monitor.init({
      ...validConfig,
      beforeSend: (event) => ({
        ...event,
        context: { ...event.context, token: "super-secret" }
      })
    });

    const result = monitor.captureError(new Error("boom"));

    expect(result.context.token).toBe("[Filtered]");
    expect(monitor.getBufferedEvents()[0].context.token).toBe("[Filtered]");
  });

  it("respects breadcrumb cap", () => {
    const monitor = new ErrorMonitor();
    monitor.init({ ...validConfig, maxBreadcrumbs: 2 });

    monitor.addBreadcrumb({ message: "First" });
    monitor.addBreadcrumb({ message: "Second" });
    monitor.addBreadcrumb({ message: "Third" });

    const event = monitor.captureError(new Error("boom"));
    expect(event.breadcrumbs).toHaveLength(2);
    expect(event.breadcrumbs[0].message).toBe("Second");
    expect(event.breadcrumbs[1].message).toBe("Third");
  });

  it("supports replacing tags", () => {
    const monitor = new ErrorMonitor();
    monitor.init(validConfig);

    monitor.setTags({ release: "1.0" });
    monitor.setTags({ release: "1.1", region: "us-east" }, { replace: true });

    const event = monitor.captureError(new Error("boom"));
    expect(event.tags).toEqual({ release: "1.1", region: "us-east" });
    expect(event.error.stacktrace).toEqual(expect.any(Array));
  });
});
