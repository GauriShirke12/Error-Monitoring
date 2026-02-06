const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ErrorEvent = require('../src/models/Error');
const ErrorOccurrence = require('../src/models/Occurrence');
const Project = require('../src/models/Project');
const { cleanupExpiredData } = require('../src/services/retention-service');
const { createProjectWithApiKey } = require('./helpers/project');

const DAY_MS = 24 * 60 * 60 * 1000;

jest.setTimeout(30000);

describe('Retention service', () => {
  let mongoServer;

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
  });

  it('removes occurrences and errors older than the project retention window', async () => {
    const { project: shortProject } = await createProjectWithApiKey({ name: 'Short', retentionDays: 7 });
    const oldDate = new Date(Date.now() - 10 * DAY_MS);
    const recentDate = new Date(Date.now() - 2 * DAY_MS);

    const staleError = await ErrorEvent.create({
      projectId: shortProject._id,
      message: 'Old error',
      stackTrace: [],
      fingerprint: 'stale',
      environment: 'production',
      firstSeen: oldDate,
      lastSeen: oldDate,
    });

    await ErrorOccurrence.create({
      errorId: staleError._id,
      projectId: shortProject._id,
      fingerprint: 'stale',
      message: 'Old error',
      stackTrace: [],
      environment: 'production',
      timestamp: oldDate,
    });

    const activeError = await ErrorEvent.create({
      projectId: shortProject._id,
      message: 'Active error',
      stackTrace: [],
      fingerprint: 'active',
      environment: 'production',
      firstSeen: recentDate,
      lastSeen: recentDate,
    });

    await ErrorOccurrence.create({
      errorId: activeError._id,
      projectId: shortProject._id,
      fingerprint: 'active',
      message: 'Old occurrence',
      stackTrace: [],
      environment: 'production',
      timestamp: oldDate,
    });

    await ErrorOccurrence.create({
      errorId: activeError._id,
      projectId: shortProject._id,
      fingerprint: 'active',
      message: 'Recent occurrence',
      stackTrace: [],
      environment: 'production',
      timestamp: recentDate,
    });

    const result = await cleanupExpiredData();

    expect(result.deletedOccurrences).toBe(2);
    expect(result.deletedEvents).toBe(1);

    const remainingOccurrences = await ErrorOccurrence.find({ projectId: shortProject._id }).lean();
    expect(remainingOccurrences).toHaveLength(1);
    expect(remainingOccurrences[0].timestamp.getTime()).toBeCloseTo(recentDate.getTime(), -2);

    const deletedError = await ErrorEvent.findOne({ projectId: shortProject._id, fingerprint: 'stale' });
    expect(deletedError).toBeNull();

    const active = await ErrorEvent.findOne({ projectId: shortProject._id, fingerprint: 'active' });
    expect(active).not.toBeNull();
  });

  it('honors per-project retention windows', async () => {
    const { project: shortProject } = await createProjectWithApiKey({ name: 'Short window', retentionDays: 5 });
    const { project: longProject } = await createProjectWithApiKey({ name: 'Long window', retentionDays: 30 });

    const oldDate = new Date(Date.now() - 8 * DAY_MS);

    const shortError = await ErrorEvent.create({
      projectId: shortProject._id,
      message: 'Short retention error',
      stackTrace: [],
      fingerprint: 'short',
      environment: 'production',
      firstSeen: oldDate,
      lastSeen: oldDate,
    });

    await ErrorOccurrence.create({
      errorId: shortError._id,
      projectId: shortProject._id,
      fingerprint: 'short',
      message: 'Old occurrence',
      stackTrace: [],
      environment: 'production',
      timestamp: oldDate,
    });

    const longError = await ErrorEvent.create({
      projectId: longProject._id,
      message: 'Long retention error',
      stackTrace: [],
      fingerprint: 'long',
      environment: 'production',
      firstSeen: oldDate,
      lastSeen: oldDate,
    });

    await ErrorOccurrence.create({
      errorId: longError._id,
      projectId: longProject._id,
      fingerprint: 'long',
      message: 'Old occurrence',
      stackTrace: [],
      environment: 'production',
      timestamp: oldDate,
    });

    await cleanupExpiredData();

    const shortRemaining = await ErrorOccurrence.countDocuments({ projectId: shortProject._id });
    const longRemaining = await ErrorOccurrence.countDocuments({ projectId: longProject._id });

    expect(shortRemaining).toBe(0);
    expect(longRemaining).toBe(1);
  });
});
