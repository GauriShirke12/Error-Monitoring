import { describe, expect, it } from "@jest/globals";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  const base = {
    apiKey: "project-key",
    apiUrl: "https://example.com/ingest"
  };

  it("returns sanitized config for valid input", () => {
    const result = resolveConfig({
      ...base,
      environment: "staging",
      enabled: false,
      sampleRate: 0.5,
      flushIntervalMs: 2500,
      maxBatchSize: 10,
      maxQueueSize: 500,
      maxBreadcrumbs: 10,
      tags: { feature: "checkout" },
      autoCapture: { errors: false },
      user: { id: "u-42" }
    });

    expect(result).toEqual({
      apiKey: "project-key",
      apiUrl: "https://example.com/ingest",
      environment: "staging",
      enabled: false,
      sampleRate: 0.5,
      beforeSend: null,
      flushIntervalMs: 2500,
      maxBatchSize: 10,
      maxQueueSize: 500,
      maxBreadcrumbs: 10,
      autoCapture: { errors: false, promiseRejections: true },
      scrubFields: ["password", "secret", "token", "authorization", "apikey", "cardnumber", "creditcard", "ssn"],
      scrubPatterns: [/\b\d{3}-\d{2}-\d{4}\b/g, /\b(?:\d[ -]?){13,19}\b/g],
      tags: { feature: "checkout" },
      user: { id: "u-42" }
    });
  });

  it("applies defaults when optional fields are omitted", () => {
    const result = resolveConfig(base);

    expect(result.environment).toBe("production");
    expect(result.enabled).toBe(true);
    expect(result.sampleRate).toBe(1);
    expect(result.beforeSend).toBeNull();
    expect(result.flushIntervalMs).toBe(5000);
    expect(result.maxBatchSize).toBe(10);
    expect(result.maxQueueSize).toBe(1000);
    expect(result.maxBreadcrumbs).toBe(20);
    expect(result.autoCapture).toEqual({ errors: true, promiseRejections: true });
    expect(result.scrubFields).toEqual(["password", "secret", "token", "authorization", "apikey", "cardnumber", "creditcard", "ssn"]);
    expect(result.scrubPatterns).toEqual([/\b\d{3}-\d{2}-\d{4}\b/g, /\b(?:\d[ -]?){13,19}\b/g]);
    expect(result.tags).toEqual({});
    expect(result.user).toBeNull();
  });

  it("throws when apiKey is missing", () => {
    expect(() => resolveConfig({ apiUrl: base.apiUrl })).toThrow(/apiKey/);
  });

  it("throws when apiUrl is invalid", () => {
    expect(() => resolveConfig({ ...base, apiUrl: "not-a-url" })).toThrow(/apiUrl/);
  });

  it("throws when config is not an object", () => {
    expect(() => resolveConfig(null)).toThrow(/config/);
  });

  it("enforces sampleRate bounds", () => {
    expect(() => resolveConfig({ ...base, sampleRate: -0.1 })).toThrow(/sampleRate/);
    expect(() => resolveConfig({ ...base, sampleRate: 1.5 })).toThrow(/sampleRate/);
  });

  it("requires beforeSend to be a function", () => {
    expect(() => resolveConfig({ ...base, beforeSend: "noop" })).toThrow(/beforeSend/);
  });

  it("requires user to be an object when provided", () => {
    expect(() => resolveConfig({ ...base, user: "invalid" })).toThrow(/user/);
  });

  it("validates autoCapture flags", () => {
    expect(() => resolveConfig({ ...base, autoCapture: { errors: "nope" } })).toThrow(/autoCapture/);
  });

  it("validates tag values", () => {
    expect(() => resolveConfig({ ...base, tags: { bad: {} } })).toThrow(/tag values/);
  });

  it("requires scrubFields to be an array of strings", () => {
    expect(() => resolveConfig({ ...base, scrubFields: "password" })).toThrow(/scrubFields/);
    expect(() => resolveConfig({ ...base, scrubFields: ["ok", 123] })).toThrow(/scrubFields/);
  });

  it("requires scrubPatterns to be regular expressions", () => {
    expect(() => resolveConfig({ ...base, scrubPatterns: "pattern" })).toThrow(/scrubPatterns/);
    expect(() => resolveConfig({ ...base, scrubPatterns: [/abc/, "def"] })).toThrow(/scrubPatterns/);
  });
});
