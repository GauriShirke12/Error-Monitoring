const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const ErrorEvent = require('../src/models/Error');
const ErrorOccurrence = require('../src/models/Occurrence');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(30000);

describe('Error API integration', () => {
  let app;
  let mongoServer;
  let project;
  let apiKey;

  const postError = () => request(app).post('/api/errors').set('X-Api-Key', apiKey);
  const getErrors = (query = {}) => request(app).get('/api/errors').set('X-Api-Key', apiKey).query(query);
  const getErrorById = (id) => request(app).get(`/api/errors/${id}`).set('X-Api-Key', apiKey);
  const patchError = (id, body) => request(app)
    .patch(`/api/errors/${id}`)
    .set('X-Api-Key', apiKey)
    .send(body);
  const deleteErrorRequest = (id) => request(app).delete(`/api/errors/${id}`).set('X-Api-Key', apiKey);

  const baseStack = [
    { file: 'App.jsx', line: 12, column: 4, function: 'render', inApp: true },
    { file: 'index.js', line: 5, column: 2, function: '<init>' },
  ];

  beforeAll(async () => {
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
    const created = await createProjectWithApiKey({ name: 'Test Project' });
    project = created.project;
    apiKey = created.apiKey;
    app = createApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects payloads missing required fields', async () => {
    const response = await postError().send({});
    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe('Validation failed');
  });

  it('rejects malformed stack traces', async () => {
    const response = await postError().send({
      message: 'Oops',
      stackTrace: ['invalid'],
      environment: 'production',
    });
    expect(response.status).toBe(422);
  });

  it('requires an API key', async () => {
    const response = await request(app)
      .post('/api/errors')
      .send({ message: 'Oops', stackTrace: [{ file: 'a', line: 1 }], environment: 'prod' });
    expect(response.status).toBe(401);
  });

  it('groups identical errors by fingerprint', async () => {
    const payload = {
      message: 'TypeError: Cannot read properties of undefined',
      stackTrace: baseStack,
      environment: 'production',
      metadata: { release: '1.0.0' },
    };

    const first = await postError().send(payload);
    const second = await postError().send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.errorId).toBe(first.body.data.errorId);
    expect(second.body.data.count).toBe(2);
  });

  it('tracks occurrence documents when errors repeat', async () => {
    const payload = {
      message: 'ReferenceError: foo is not defined',
      stackTrace: baseStack,
      environment: 'production',
      metadata: { release: '1.0.0' },
    };

    for (let i = 0; i < 10; i += 1) {
      const response = await postError().send(payload);
      expect(response.status).toBe(201);
    }

    const errors = await ErrorEvent.countDocuments({ projectId: project._id });
    const occurrences = await ErrorOccurrence.countDocuments({ projectId: project._id });
    const aggregated = await ErrorEvent.findOne({ projectId: project._id });

    expect(errors).toBe(1);
    expect(occurrences).toBe(10);
    expect(aggregated.count).toBe(10);
  });

  it('sanitizes sensitive values before storage', async () => {
    const payload = {
      message: '<script>alert(1)</script> password=secret1234',
      stackTrace: baseStack,
      environment: 'production',
      metadata: { auth: { bearer: 'Bearer token-value' }, card: '4111 1111 1111 1111' },
    };

    const response = await postError().send(payload);
    expect(response.status).toBe(201);

    const stored = await ErrorEvent.findOne({ projectId: project._id });
    expect(stored.message).toContain('[REDACTED');
    expect(stored.message.includes('<')).toBe(false);

    stored.stackTrace.forEach((frame) => {
      Object.values(frame).forEach((value) => {
        if (typeof value === 'string') {
          expect(value.includes('<')).toBe(false);
        }
      });
    });

    expect(stored.metadata.auth.bearer.includes('[REDACTED]')).toBe(true);
    expect(stored.metadata.card).toBe('[REDACTED:CARD]');
  });

  it('applies project scrubbing rules for PII', async () => {
    await Project.updateOne(
      { _id: project._id },
      { scrubbing: { removeEmails: true, removePhones: true, removeIPs: true } }
    );

    const payload = {
      message: 'User test@example.com called from 203.0.113.5 at 555-123-4567',
      stackTrace: baseStack,
      environment: 'production',
      metadata: {
        contact: 'test@example.com',
        nested: {
          phone: '(415) 555-0101',
          ip: '198.51.100.23',
        },
      },
      userContext: {
        email: 'another@example.com',
        ip: '203.0.113.7',
        phone: '+1 212 555 0199',
      },
    };

    const response = await postError().send(payload);
    expect(response.status).toBe(201);

    const stored = await ErrorEvent.findOne({ projectId: project._id }).lean();
    expect(stored.message).toContain('[REDACTED:EMAIL]');
    expect(stored.message).not.toMatch(/test@example.com/);
    expect(stored.message).not.toMatch(/203\.0\.113\.5/);
    expect(stored.message).not.toMatch(/555-123-4567/);

    expect(stored.metadata.contact).toBe('[REDACTED:EMAIL]');
    expect(stored.metadata.nested.phone).toBe('[REDACTED:PHONE]');
    expect(stored.metadata.nested.ip).toBe('[REDACTED:IP]');

    expect(stored.userContext.email).toBe('[REDACTED:EMAIL]');
    expect(stored.userContext.ip).toBe('[REDACTED:IP]');
    expect(stored.userContext.phone).toBe('[REDACTED:PHONE]');
  });

  it('enforces per-key rate limits', async () => {
    const payload = {
      message: 'Rate limited',
      stackTrace: baseStack,
      environment: 'production',
    };

    let limited = false;
    for (let i = 0; i < 150; i += 1) {
      const response = await postError().send({ ...payload, metadata: { index: i } });
      if (response.status === 429) {
        limited = true;
        break;
      }

      expect(response.status).toBe(201);
    }

    expect(limited).toBe(true);
  });

  it('responds with 202 when write operations fail', async () => {
    const payload = {
      message: 'Simulated failure',
      stackTrace: baseStack,
      environment: 'production',
    };

    const findOneSpy = jest.spyOn(ErrorEvent, 'findOne').mockImplementation(() => {
      throw new mongoose.Error('Mock DB failure');
    });

    const response = await postError().send(payload);

    expect(response.status).toBe(202);
    expect(response.body.data.accepted).toBe(true);

    findOneSpy.mockRestore();
  });

  it('lists errors with pagination, filtering, and sorting', async () => {
    const createError = async (message, environment) => {
      const res = await postError().send({
        message,
        environment,
        stackTrace: baseStack,
      });
      expect(res.status).toBe(201);
      return res.body.data.errorId;
    };

    const productionIds = [];
    for (let i = 0; i < 15; i += 1) {
      productionIds.push(await createError(`Prod failure ${i}`, 'production'));
    }

    for (let i = 0; i < 5; i += 1) {
      await createError(`Stage failure ${i}`, 'staging');
    }

    await ErrorEvent.updateOne({ _id: productionIds[0] }, { status: 'resolved' });

    const response = await getErrors({ page: 2, limit: 10, environment: 'production', sortBy: 'lastSeen' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        page: 2,
        limit: 10,
        total: 15,
        totalPages: 2,
      })
    );
    response.body.data.forEach((item) => {
      expect(item.environment).toBe('production');
      expect(item.topStackFrame).toBeTruthy();
    });
  });

  it('rejects invalid status filters when listing errors', async () => {
    const response = await getErrors({ status: 'invalid-status' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Invalid status filter');
  });

  it('returns detailed error payload with recent occurrences', async () => {
    const basePayload = {
      message: 'OverflowError',
      environment: 'production',
      stackTrace: baseStack,
    };

    const first = await postError().send(basePayload);
    expect(first.status).toBe(201);
    const errorId = first.body.data.errorId;

    for (let i = 0; i < 54; i += 1) {
      await postError().send({ ...basePayload, metadata: { attempt: i } });
    }

    const response = await getErrorById(errorId);
    expect(response.status).toBe(200);

    const detail = response.body.data;
    expect(detail.id).toBe(errorId);
    expect(detail.occurrences.length).toBe(50);
    expect(detail.occurrencesTotal).toBe(55);
    expect(detail.stackTraceHighlighted[0].highlightHtml).toContain('frame-fn');
  });

  it('returns 404 when detail lookup misses', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString();
    const response = await getErrorById(unknownId);
    expect(response.status).toBe(404);
  });

  it('updates error status via PATCH', async () => {
    const payload = {
      message: 'Needs attention',
      environment: 'production',
      stackTrace: baseStack,
    };

    const res = await postError().send(payload);
    expect(res.status).toBe(201);
    const errorId = res.body.data.errorId;

    const patch = await patchError(errorId, { status: 'resolved' });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toEqual(
      expect.objectContaining({
        id: errorId,
        status: 'resolved',
      })
    );

    const detail = await getErrorById(errorId);
    expect(detail.body.data.status).toBe('resolved');
  });

  it('requires a status value when patching', async () => {
    const payload = {
      message: 'Missing status',
      environment: 'production',
      stackTrace: baseStack,
    };

    const res = await postError().send(payload);
    expect(res.status).toBe(201);
    const errorId = res.body.data.errorId;

    const response = await patchError(errorId, {});
    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe('Validation failed');
    expect(response.body.error.details.some((detail) => detail.field === 'status')).toBe(true);
  });

  it('rejects invalid status transitions', async () => {
    const payload = {
      message: 'Bad status',
      environment: 'production',
      stackTrace: baseStack,
    };

    const res = await postError().send(payload);
    expect(res.status).toBe(201);
    const errorId = res.body.data.errorId;

    const response = await patchError(errorId, { status: 'bogus' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Invalid status value');
  });

  it('returns 404 when updating unknown errors', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString();
    const response = await patchError(unknownId, { status: 'open' });
    expect(response.status).toBe(404);
  });

  it('deletes errors and related occurrences', async () => {
    const payload = {
      message: 'Removable error',
      environment: 'production',
      stackTrace: baseStack,
    };

    const res = await postError().send(payload);
    expect(res.status).toBe(201);
    const errorId = res.body.data.errorId;

    const del = await deleteErrorRequest(errorId);
    expect(del.status).toBe(204);

    const errors = await ErrorEvent.countDocuments({ _id: errorId });
    const occurrences = await ErrorOccurrence.countDocuments({ errorId });

    expect(errors).toBe(0);
    expect(occurrences).toBe(0);
  });

  it('returns 404 when deleting unknown errors', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString();
    const response = await deleteErrorRequest(unknownId);
    expect(response.status).toBe(404);
  });
});
