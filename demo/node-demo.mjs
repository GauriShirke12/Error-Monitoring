import { ErrorMonitor, EventQueue } from "../sdk/core/src/index.js";

const API_URL = process.env.ERROR_MONITOR_API_URL || "http://localhost:4000/api/errors";
const API_KEY = process.env.ERROR_MONITOR_API_KEY;
const ENVIRONMENT = process.env.ERROR_MONITOR_ENV || "local";

if (!API_KEY) {
  console.error("Set ERROR_MONITOR_API_KEY before running. Create one with: cd server && node scripts/create-project.js demo-local");
  process.exit(1);
}

function toStackFrame(frame) {
  if (!frame || typeof frame !== "object") {
    return { file: "unknown", line: null, column: null, function: null, inApp: false };
  }
  const file = frame.fileName || frame.raw || frame.file || "unknown";
  return {
    file,
    line: frame.lineNumber ?? frame.line ?? null,
    column: frame.columnNumber ?? frame.column ?? null,
    function: frame.functionName || frame.function || null,
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

async function sendPayload(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (response.status !== 201 && response.status !== 202) {
    const body = await response.text();
    throw new Error(`Ingest failed (${response.status}): ${body}`);
  }
}

const monitor = new ErrorMonitor();
monitor.init({
  apiKey: API_KEY,
  apiUrl: API_URL,
  environment: ENVIRONMENT,
  sampleRate: 1,
  maxBreadcrumbs: 20,
  autoCapture: { errors: true, promiseRejections: true },
  tags: { service: "demo-node" }
});

let online = true;
const queue = new EventQueue({
  flushIntervalMs: 500,
  maxBatchSize: 5,
  maxQueueSize: 200,
  retryDelays: [500, 1000, 2000],
  isOnline: () => online,
  sendBatch: async (batch) => {
    for (const event of batch) {
      const payload = buildPayload(event);
      await sendPayload(payload);
    }
    console.log(`Sent batch of ${batch.length}`);
  }
});

function enqueueError(error, context) {
  const event = monitor.captureError(error, context);
  if (event) {
    queue.enqueue(event);
  }
}

async function runDemo() {
  console.log("Starting node demo...");
  monitor.setUser({ id: "user-123", email: "demo@example.com" });
  monitor.addBreadcrumb({ message: "demo start", category: "demo", level: "info" });

  online = false;
  enqueueError(new Error("Offline crash simulation"), {
    tags: { phase: "offline" },
    breadcrumbs: [{ message: "socket dropped" }]
  });
  console.log("Queued offline event (will retry when back online)");

  setTimeout(() => {
    online = true;
    queue.flush({ force: true });
    console.log("Back online; flushing queue");
  }, 1500);

  const groupedMessage = "DemoError: grouped failure";
  enqueueError(new Error(groupedMessage), { tags: { attempt: 1 } });
  enqueueError(new Error(groupedMessage), { tags: { attempt: 2 } });

  enqueueError(new Error("Unique failure for analytics"), { tags: { severity: "high" } });

  setTimeout(async () => {
    await queue.flush({ force: true });
    console.log("Demo run complete. Check API logs, Mongo, and dashboard groups/analytics.");
    process.exit(0);
  }, 4000);
}

runDemo().catch((error) => {
  console.error(error);
  process.exit(1);
});
