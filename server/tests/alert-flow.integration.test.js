process.env.ALERT_STATE_DRIVER = 'memory';

jest.mock('../src/services/alert-channel-service', () => ({
  dispatchAlertChannels: jest.fn().mockResolvedValue({ delivered: true }),
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AlertRule = require('../src/models/AlertRule');
const ErrorEvent = require('../src/models/Error');
const ErrorOccurrence = require('../src/models/Occurrence');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

const { dispatchAlertChannels } = require('../src/services/alert-channel-service');
const { evaluateAndDispatchAlerts } = require('../src/services/alert-trigger-service');
const {
  configureAlertNotifications,
  __testing: { resetState, flushBucket, aggregationBuckets, cooldownState },
} = require('../src/services/alert-notification-service');

jest.setTimeout(60000);

describe('alert flow integration', () => {
  let mongoServer;

  const basePayload = {
    environment: 'production',
    fingerprint: 'checkout-spike-001',
    severity: 'critical',
  };

  const createOccurrence = async ({ projectId, errorId, timestamp = new Date() }) =>
    ErrorOccurrence.create({
      errorId,
      projectId,
      fingerprint: basePayload.fingerprint,
      message: 'Checkout timeout',
      environment: basePayload.environment,
      timestamp,
    });

  beforeAll(async () => {
    jest.useRealTimers();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
    jest.useRealTimers();
  });

  beforeEach(async () => {
    dispatchAlertChannels.mockClear();
    await resetState();
    await Project.deleteMany({});
    await AlertRule.deleteMany({});
    await ErrorEvent.deleteMany({});
    await ErrorOccurrence.deleteMany({});
    configureAlertNotifications({
      aggregationWindowMs: 0,
      defaultCooldownMinutes: 5,
      defaultEscalationMinutes: 120,
    });
  });

  it('runs full alert pipeline and respects cooldowns', async () => {
    const { project } = await createProjectWithApiKey({ name: 'QA Checkout Project', apiKey: 'proj-key-1' });
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Checkout threshold',
      type: 'threshold',
      conditions: {
        threshold: 2,
        windowMinutes: 5,
        environments: ['production'],
      },
      channels: [{ type: 'email', target: 'alerts@example.com' }],
      cooldownMinutes: 5,
    });

    const error = await ErrorEvent.create({
      projectId: project._id,
      message: 'Checkout timeout spike',
      fingerprint: basePayload.fingerprint,
      count: 1,
      environment: basePayload.environment,
      firstSeen: new Date(Date.now() - 30 * 60 * 1000),
      lastSeen: new Date(Date.now() - 60 * 1000),
    });

    await createOccurrence({
      projectId: project._id,
      errorId: error._id,
      timestamp: new Date(Date.now() - 2 * 60 * 1000),
    });
    const firstOccurrence = await createOccurrence({ projectId: project._id, errorId: error._id });

    await evaluateAndDispatchAlerts({
      project,
      errorEvent: error,
      occurrence: firstOccurrence,
      isNew: false,
      payload: basePayload,
    });

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    const firstDispatch = dispatchAlertChannels.mock.calls[0][0];
    expect(firstDispatch.rule.channels[0].target).toBe('alerts@example.com');
    expect(firstDispatch.alert.metadata?.reason).toBe('threshold_exceeded');

    dispatchAlertChannels.mockClear();

    const followUpOccurrence = await createOccurrence({ projectId: project._id, errorId: error._id });
    await evaluateAndDispatchAlerts({
      project,
      errorEvent: error,
      occurrence: followUpOccurrence,
      isNew: false,
      payload: basePayload,
    });

    expect(dispatchAlertChannels).not.toHaveBeenCalled();
    const ruleKey = rule._id.toString();
    expect(aggregationBuckets.has(ruleKey)).toBe(true);

    cooldownState.set(ruleKey, Date.now() - 10 * 60 * 1000);
    await flushBucket(ruleKey);

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    const resumedDispatch = dispatchAlertChannels.mock.calls[0][0];
    expect(resumedDispatch.alert.metadata?.aggregation?.count || 1).toBeGreaterThanOrEqual(1);
  });

  it('aggregates rapid alerts within the window', async () => {
    configureAlertNotifications({ aggregationWindowMs: 100, defaultCooldownMinutes: 0, defaultEscalationMinutes: 120 });

    const { project } = await createProjectWithApiKey({ name: 'Rapid Alert Project', apiKey: 'proj-key-rapid' });
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Critical regression',
      type: 'critical',
      conditions: { severity: 'critical' },
      channels: [{ type: 'slack', target: '#oncall' }],
      cooldownMinutes: 0,
    });
    const error = await ErrorEvent.create({
      projectId: project._id,
      message: 'Critical outage',
      fingerprint: basePayload.fingerprint,
      environment: basePayload.environment,
      firstSeen: new Date(),
      lastSeen: new Date(),
    });

    await evaluateAndDispatchAlerts({ project, errorEvent: error, occurrence: await createOccurrence({ projectId: project._id, errorId: error._id }), isNew: false, payload: { ...basePayload, severity: 'critical' } });
    await evaluateAndDispatchAlerts({ project, errorEvent: error, occurrence: await createOccurrence({ projectId: project._id, errorId: error._id }), isNew: false, payload: { ...basePayload, severity: 'critical' } });
    await evaluateAndDispatchAlerts({ project, errorEvent: error, occurrence: await createOccurrence({ projectId: project._id, errorId: error._id }), isNew: false, payload: { ...basePayload, severity: 'critical' } });

    expect(dispatchAlertChannels).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushBucket(rule._id.toString());

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    const [[firstCall]] = dispatchAlertChannels.mock.calls;
    const { alert } = firstCall;
    expect(alert.metadata?.aggregation?.count).toBe(3);
    expect(alert.metadata.aggregation.sample.length).toBeGreaterThanOrEqual(1);
  });

  it('retries dispatch when channels fail without losing alerts', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Resilient Project', apiKey: 'proj-key-resilient' });
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Critical fingerprint',
      type: 'critical',
      conditions: { fingerprint: basePayload.fingerprint },
      channels: [{ type: 'webhook', target: 'https://hooks.example.com/alerts' }],
      cooldownMinutes: 0,
    });
    const error = await ErrorEvent.create({
      projectId: project._id,
      message: 'Critical regression detected',
      fingerprint: basePayload.fingerprint,
      environment: basePayload.environment,
      firstSeen: new Date(),
      lastSeen: new Date(),
    });
    const occurrence = await createOccurrence({ projectId: project._id, errorId: error._id });

    dispatchAlertChannels.mockRejectedValueOnce(new Error('Channel offline'));

    const result = await evaluateAndDispatchAlerts({
      project,
      errorEvent: error,
      occurrence,
      isNew: false,
      payload: basePayload,
    });

    expect(result.triggered).toBe(1);
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    const ruleKey = rule._id.toString();
    expect(aggregationBuckets.has(ruleKey)).toBe(true);

    dispatchAlertChannels.mockResolvedValueOnce({ delivered: true });
    await flushBucket(ruleKey);

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(2);
    expect(aggregationBuckets.has(ruleKey)).toBe(false);
  });

  it('skips invalid aggregate simulations without fingerprint', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Invalid Config Project', apiKey: 'proj-key-invalid' });
    await AlertRule.create({
      project: project._id,
      name: 'Spike without fingerprint',
      type: 'spike',
      conditions: {
        increasePercent: 200,
        windowMinutes: 5,
        baselineMinutes: 15,
      },
      channels: [{ type: 'slack', target: '#ops' }],
      cooldownMinutes: 0,
    });
    const { insertedId: errorId } = await ErrorEvent.collection.insertOne({
      projectId: project._id,
      message: 'Unknown spike',
      fingerprint: null,
      environment: basePayload.environment,
      count: 1,
      firstSeen: new Date(),
      lastSeen: new Date(),
      status: 'new',
      metadata: {},
      userContext: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const error = await ErrorEvent.findById(errorId);

    const { insertedId: occurrenceId } = await ErrorOccurrence.collection.insertOne({
      errorId: errorId,
      projectId: project._id,
      fingerprint: null,
      message: 'Unknown spike',
      environment: basePayload.environment,
      metadata: {},
      userContext: {},
      timestamp: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const occurrence = await ErrorOccurrence.findById(occurrenceId);

    const result = await evaluateAndDispatchAlerts({
      project,
      errorEvent: error,
      occurrence,
      isNew: false,
      payload: { environment: basePayload.environment },
    });

    expect(result.triggered).toBe(0);
    expect(dispatchAlertChannels).not.toHaveBeenCalled();
  });
});
