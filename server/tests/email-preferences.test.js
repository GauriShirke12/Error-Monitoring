const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const TeamMember = require('../src/models/TeamMember');
const AlertDigestEntry = require('../src/models/AlertDigestEntry');
const { sendAlertEmail, sendDailyDigestEmails } = require('../src/services/email-service');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(20000);

const createRule = (email) => ({
  _id: new mongoose.Types.ObjectId(),
  name: 'High error volume',
  type: 'threshold',
  channels: [{ type: 'email', target: email }],
  conditions: { severity: 'high' },
});

const createAlertPayload = () => ({
  id: 'alert-1',
  title: 'Spike detected',
  summary: 'Error rate increased by 250%',
  severity: 'high',
  environment: 'production',
  occurrences: 42,
  affectedUsers: 9,
  windowMinutes: 5,
  lastDetectedAt: new Date(),
});

describe('Email notification preferences', () => {
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
    await Project.deleteMany({});
    await TeamMember.deleteMany({});
    await AlertDigestEntry.deleteMany({});
  });

  it('delivers alert emails immediately when preferences allow', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Immediate Project', apiKey: 'proj-key-secret' });
    const member = await TeamMember.create({
      projectId: project._id,
      name: 'Immediate User',
      email: 'immediate@example.com',
    });

    const result = await sendAlertEmail({
      project,
      rule: createRule(member.email),
      alert: createAlertPayload(),
    });

    expect(result.immediate).toHaveLength(1);
    expect(result.queuedForDigest).toHaveLength(0);

    const digestEntries = await AlertDigestEntry.find({});
    expect(digestEntries).toHaveLength(0);
    expect(result.immediate[0].info.accepted).toContain(member.email);
  });

  it('queues alerts when digest mode is enabled', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Digest Project', apiKey: 'digest-key-secret' });
    const member = await TeamMember.create({
      projectId: project._id,
      name: 'Digest User',
      email: 'digest@example.com',
      alertPreferences: {
        email: {
          mode: 'digest',
          quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
          digest: { cadence: 'daily', lastSentAt: null },
        },
      },
    });

    const result = await sendAlertEmail({
      project,
      rule: createRule(member.email),
      alert: createAlertPayload(),
    });

    expect(result.immediate).toHaveLength(0);
    expect(result.queuedForDigest).toEqual([member.email]);

    const digestEntries = await AlertDigestEntry.find({ memberId: member._id, processed: false });
    expect(digestEntries).toHaveLength(1);

    const digestResults = await sendDailyDigestEmails({ project });
    expect(digestResults).toHaveLength(1);
    expect(digestResults[0].memberId).toEqual(member._id.toString());

    const processedEntries = await AlertDigestEntry.find({ memberId: member._id, processed: true });
    expect(processedEntries).toHaveLength(1);
  });

  it('defers alerts to digest during quiet hours', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Quiet Project', apiKey: 'quiet-key-secret' });
    const member = await TeamMember.create({
      projectId: project._id,
      name: 'Quiet User',
      email: 'quiet@example.com',
      alertPreferences: {
        email: {
          mode: 'immediate',
          quietHours: { enabled: true, start: '00:00', end: '23:59', timezone: 'UTC' },
          digest: { cadence: 'daily', lastSentAt: null },
        },
      },
    });

    const result = await sendAlertEmail({
      project,
      rule: createRule(member.email),
      alert: createAlertPayload(),
    });

    expect(result.immediate).toHaveLength(0);
    expect(result.queuedForDigest).toEqual([member.email]);

    const digestEntries = await AlertDigestEntry.find({ memberId: member._id, processed: false });
    expect(digestEntries).toHaveLength(1);
  });

  it('waits for cadence window before sending digests', async () => {
    const now = new Date();
    const { project } = await createProjectWithApiKey({ name: 'Cadence Project', apiKey: 'cadence-key-secret' });
    const member = await TeamMember.create({
      projectId: project._id,
      name: 'Cadence User',
      email: 'cadence@example.com',
      alertPreferences: {
        email: {
          mode: 'digest',
          quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
          digest: { cadence: 'daily', lastSentAt: now },
        },
      },
    });

    await sendAlertEmail({
      project,
      rule: createRule(member.email),
      alert: createAlertPayload(),
    });

    const future = new Date(now.getTime() + 60 * 60 * 1000);
    const digestResults = await sendDailyDigestEmails({ project, now: future });

    expect(digestResults).toHaveLength(0);

    const pendingEntries = await AlertDigestEntry.find({ memberId: member._id, processed: false });
    expect(pendingEntries).toHaveLength(1);
  });
});
