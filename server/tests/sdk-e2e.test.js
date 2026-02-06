const http = require('node:http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const ErrorEvent = require('../src/models/Error');
const ErrorOccurrence = require('../src/models/Occurrence');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(60000);

beforeAll(() => {
  // Ensure real timers for HTTP server and memory Mongo interactions
  jest.useRealTimers();
});

const waitFor = async (condition, { timeout = 3000, interval = 50, advanceTimers = false } = {}) => {
  const start = Date.now();

  const sleep = async (ms) => {
    if (advanceTimers && typeof jest !== 'undefined') {
      if (typeof jest.advanceTimersByTimeAsync === 'function') {
        await jest.advanceTimersByTimeAsync(ms);
        return;
      }
      if (typeof jest.advanceTimersByTime === 'function') {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await condition();
    if (result) {
      return result;
    }
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for condition');
    }
    await sleep(interval);
  }
};

const normalizeStackFrame = (frame) => ({
  file: frame.file || null,
  line: typeof frame.line === 'number' ? frame.line : null,
  column: typeof frame.column === 'number' ? frame.column : null,
  function: frame.function || null,
});

const toIngestionPayload = (event) => ({
  message: event.error.message,
  stackTrace: Array.isArray(event.error.stacktrace)
    ? event.error.stacktrace.map(normalizeStackFrame)
    : [],
  environment: event.environment,
  userContext: event.user || undefined,
  metadata: {
    tags: event.tags,
    context: event.context,
    breadcrumbs: event.breadcrumbs,
    sessionId: event.sessionId,
  },
  timestamp: event.timestamp,
});

let ErrorMonitor;
let EventQueue;

describe('SDK end-to-end integration', () => {
  let mongoServer;
  let serverInstance;
  let baseUrl;
  let apiKey;
  let project;

  beforeAll(async () => {
    ({ ErrorMonitor, EventQueue } = await import('../../sdk/core/src/index.js'));
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      ErrorEvent.deleteMany({}),
      ErrorOccurrence.deleteMany({}),
      Project.deleteMany({}),
    ]);
    const created = await createProjectWithApiKey({ name: 'SDK Integration' });
    project = created.project;
    apiKey = created.apiKey;

    const app = createApp();
    await new Promise((resolve) => {
      serverInstance = http.createServer(app).listen(0, resolve);
    });
    const address = serverInstance.address();
    baseUrl = `http://127.0.0.1:${address.port}/api/errors`;
  });

  afterEach(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
      serverInstance = null;
    }
  });

  const sendBatchToApi = async (batch) => {
    for (const event of batch) {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(toIngestionPayload(event)),
      });
      if (!response.ok) {
        throw new Error(`Failed to ingest event: ${response.status}`);
      }
    }
  };

  it('captures errors and stores occurrences through the ingestion API', async () => {
    const monitor = new ErrorMonitor();
    monitor.init({
      apiKey,
      apiUrl: baseUrl,
      environment: 'integration',
      sampleRate: 1,
    });

    const queue = new EventQueue({
      sendBatch: sendBatchToApi,
      flushIntervalMs: 25,
      maxBatchSize: 2,
      maxQueueSize: 10,
    });

    const first = monitor.captureError(new Error('Integration failure'), {
      tags: { release: '1.0.0' },
      context: { route: '/checkout' },
      breadcrumbs: [{ message: 'User clicked checkout' }],
    });
    const second = monitor.captureError(new Error('Integration failure'), {
      context: { route: '/checkout' },
    });

    queue.enqueue(first);
    queue.enqueue(second);

    await queue.flush({ force: true });

    const stored = await waitFor(async () => {
      const record = await ErrorEvent.findOne({ projectId: project._id });
      if (record && record.count === 2) {
        return record;
      }
      return null;
    });

    expect(stored.environment).toBe('integration');
    expect(stored.count).toBe(2);
    expect(stored.metadata.tags.release).toBe('1.0.0');
    expect(stored.metadata.context.route).toBe('/checkout');

    const occurrences = await ErrorOccurrence.countDocuments({ errorId: stored._id });
    expect(occurrences).toBe(2);

    queue.clear();
    monitor.clearQueue();
  });

  it('retries failed batches until a subsequent attempt succeeds', async () => {
    const monitor = new ErrorMonitor();
    monitor.init({ apiKey, apiUrl: baseUrl, environment: 'integration' });

    let attempts = 0;
    const queue = new EventQueue({
      sendBatch: async (batch) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Simulated network failure');
        }
        await sendBatchToApi(batch);
      },
      flushIntervalMs: 25,
      maxBatchSize: 1,
      maxQueueSize: 5,
      retryDelays: [25, 50, 100],
    });

    const event = monitor.captureError(new Error('Retry me'));
    queue.enqueue(event);

    await queue.flush({ force: true });
    expect(attempts).toBe(1);

    await waitFor(async () => {
      const record = await ErrorEvent.findOne({ projectId: project._id, message: 'Retry me' });
      return record ? record : null;
    });

    expect(attempts).toBeGreaterThanOrEqual(2);

    queue.clear();
    monitor.clearQueue();
  });

  it('defers flushing while offline', async () => {
    let online = false;
    const sendBatch = jest.fn().mockResolvedValue();
    const queue = new EventQueue({
      sendBatch,
      flushIntervalMs: 25,
      maxBatchSize: 1,
      maxQueueSize: 5,
      isOnline: () => online,
    });

    queue.enqueue({ id: 1 });
    await queue.flush({ force: true });
    expect(sendBatch).not.toHaveBeenCalled();

    online = true;
    await queue.flush({ force: true });
    expect(sendBatch).toHaveBeenCalledTimes(1);

    queue.clear();
  });
});
