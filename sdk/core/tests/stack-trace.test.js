import { describe, expect, it } from "@jest/globals";
import { parseStackTrace } from "../src/stack-trace.js";

describe("parseStackTrace", () => {
  it("parses V8 stack frames", () => {
    const stack = `Error: Boom\n    at Object.handler (/app/index.js:12:5)\n    at processTicksAndRejections (node:internal/process/task_queues:96:5)`;
    const frames = parseStackTrace(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      functionName: "Object.handler",
      fileName: "/app/index.js",
      lineNumber: 12,
      columnNumber: 5
    });
    expect(frames[1]).toMatchObject({
      functionName: "processTicksAndRejections",
      fileName: "node:internal/process/task_queues",
      lineNumber: 96,
      columnNumber: 5
    });
  });

  it("parses Firefox stack frames", () => {
    const stack = `handler@https://example.com/app.js:42:21\nhttps://example.com/vendor.js:10:5`;
    const frames = parseStackTrace(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      functionName: "handler",
      fileName: "https://example.com/app.js",
      lineNumber: 42,
      columnNumber: 21
    });
    expect(frames[1]).toMatchObject({
      functionName: null,
      fileName: "https://example.com/vendor.js",
      lineNumber: 10,
      columnNumber: 5
    });
  });

  it("parses Safari native frames", () => {
    const stack = `dispatchEvent@[native code]\nGlobal code`; 
    const frames = parseStackTrace(stack);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      functionName: "dispatchEvent",
      fileName: "[native code]",
      lineNumber: null,
      columnNumber: null
    });
    expect(frames[1]).toMatchObject({
      functionName: "Global code",
      fileName: null
    });
  });

  it("returns empty array for missing stack", () => {
    expect(parseStackTrace()).toEqual([]);
    expect(parseStackTrace(" ")).toEqual([]);
  });
});
