const http = require("node:http");
const { URL } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");
const mongoose = require("../../../server/node_modules/mongoose");
const { MongoMemoryServer } = require("../../../server/node_modules/mongodb-memory-server");

const createApp = require("../../../server/src/app");
const Project = require("../../../server/src/models/Project");
const ErrorEvent = require("../../../server/src/models/Error");
const ErrorOccurrence = require("../../../server/src/models/Occurrence");

jest.setTimeout(120000);

const WAIT_INTERVAL_MS = 50;

async function waitFor(predicate, { timeout = 5000, interval = WAIT_INTERVAL_MS } = {}) {
  const start = Date.now();
  /* eslint-disable no-await-in-loop */
  while (Date.now() - start < timeout) {
    if (await predicate()) {
      return true;
    }
    await delay(interval);
  }
  /* eslint-enable no-await-in-loop */
  return false;
}

async function postJson(url, payload, headers = {}) {
  const target = new URL(url);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const payloadText = Buffer.concat(chunks).toString("utf8");
          resolve({ status: response.statusCode, body: payloadText });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function toStackFrame(frame) {
  const file = frame.fileName || frame.raw || "unknown";
  return {
    file,
    line: frame.lineNumber ?? null,
    column: frame.columnNumber ?? null,
    function: frame.functionName || null,
    inApp: Boolean(file && file.includes("src"))
  };
}

function buildPayload(event) {
  const stackFrames = Array.isArray(event.error?.stacktrace) && event.error.stacktrace.length
    ? event.error.stacktrace.map(toStackFrame)
    : [{ file: "unknown", line: null, column: null, function: null, inApp: false }];

  return {
    message: `${event.error?.name || "Error"}: ${event.error?.message || "Unknown"}`,
    environment: event.environment,
    stackTrace: stackFrames,
    userContext: event.user || {},
    metadata: {
      tags: event.tags || {},
      context: event.context || {},
      breadcrumbs: event.breadcrumbs || []
    },
    timestamp: event.timestamp
  };
}

function makeError(message) {
  return new Error(message);
}

describe("SDK end-to-end integration", () => {
  let mongoServer;
  let server;
  let baseUrl;
  let apiKey;
  let EventQueue;
  let ErrorMonitor;
  let queue;
  let monitor;
  let online = true;
  let failNextBatch = true;
  const batchSizes = [];

  beforeAll(async () => {
    ({ EventQueue, ErrorMonitor } = await import("../../core/src/index.js"));

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const app = createApp();
    baseUrl = await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      ErrorEvent.deleteMany({}),
      ErrorOccurrence.deleteMany({}),
      Project.deleteMany({})
    ]);

    apiKey = `integration-${Date.now()}`;
    await Project.create({ name: "SDK Integration", apiKey });

    online = true;
    failNextBatch = true;
    batchSizes.length = 0;

    const sendPayload = async (payload) => {
      const response = await postJson(`${baseUrl}/api/errors`, payload, {
        "X-Api-Key": apiKey
      });

      if (response.status !== 201 && response.status !== 202) {
        throw new Error(`Unexpected response ${response.status}`);
      }
    };

    queue = new EventQueue({
      flushIntervalMs: 100,
      maxBatchSize: 2,
      maxQueueSize: 100,
      isOnline: () => online,
      sendBatch: async (batch) => {
        batchSizes.push(batch.length);
        if (failNextBatch) {
          failNextBatch = false;
          throw new Error("Simulated network failure");
        }
        for (const event of batch) {
          await sendPayload(buildPayload(event));
        }
      }
    });

    queue._backoffSchedule = [50, 100];

    monitor = new ErrorMonitor();
    monitor.init({
      apiKey: "sdk-test",
      apiUrl: `${baseUrl}/api/errors`,
      environment: "testing",
      sampleRate: 1,
      maxBreadcrumbs: 20
    });
  });

  afterEach(() => {
    if (queue) {
      queue.clear();
      queue = null;
    }
    monitor = null;
  });

  it("captures, batches, retries, and stores events", async () => {
    online = false;

    const offlineEvent = monitor.captureError(makeError("Offline failure"), {
      tags: { phase: "offline" },
      breadcrumbs: [{ message: "socket disconnected" }]
    });
    queue.enqueue(offlineEvent);

    const remainedQueued = await waitFor(async () => (await ErrorEvent.countDocuments({})) === 0, { timeout: 500 });
    expect(remainedQueued).toBe(true);

    online = true;
    await queue.flush({ force: true });
    expect(await waitFor(async () => (await ErrorEvent.countDocuments({ message: /Offline failure/ })) === 1)).toBe(true);

    failNextBatch = true;

    const groupedMessage = "IntegrationError: batched failure";
    const first = monitor.captureError(makeError(groupedMessage), {
      attempt: 1
    });
    const second = monitor.captureError(makeError(groupedMessage), {
      attempt: 2
    });
    const canonicalStack = Array.isArray(first?.error?.stacktrace)
      ? first.error.stacktrace.map((frame) => ({ ...frame }))
      : [];
    if (canonicalStack.length) {
      first.error.stacktrace = canonicalStack.map((frame) => ({ ...frame }));
      second.error.stacktrace = canonicalStack.map((frame) => ({ ...frame }));
    }
    queue.enqueue(first);
    queue.enqueue(second);

    const third = monitor.captureError(makeError("Unique failure"));
    queue.enqueue(third);

    expect(queue.size()).toBeGreaterThan(0);

    await waitFor(async () => queue.size() === 0, { timeout: 5000 });
    expect(batchSizes.some((size) => size === 2)).toBe(true);

    const groupedRecord = await ErrorEvent.findOne({ message: new RegExp(groupedMessage) });
    expect(groupedRecord).toBeTruthy();
    expect(groupedRecord.count).toBe(2);

    const offlineRecord = await ErrorEvent.findOne({ message: /Offline failure/ });
    expect(offlineRecord).toBeTruthy();
    expect(offlineRecord.metadata.tags.phase).toBe("offline");

    const occurrences = await ErrorOccurrence.find({ errorId: groupedRecord._id }).sort({ timestamp: 1 });
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].metadata.context.attempt).toBe(1);
    expect(occurrences[1].metadata.context.attempt).toBe(2);
  });
});
