jest.mock('../src/services/alert-channel-service', () => ({
  dispatchAlertChannels: jest.fn().mockResolvedValue({ delivered: true }),
}));

process.env.ALERT_STATE_DRIVER = 'memory';

const { dispatchAlertChannels } = require('../src/services/alert-channel-service');
const {
  processTriggeredAlert,
  acknowledgeAlert,
  configureAlertNotifications,
  __testing: { resetState, aggregationBuckets, escalationEntries },
} = require('../src/services/alert-notification-service');

const baseProject = { _id: 'proj-1', name: 'Demo Project' };

const withRule = (overrides = {}) => ({
  _id: 'rule-1',
  name: 'High error volume',
  type: 'threshold',
  cooldownMinutes: 0,
  channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
  escalation: {
    enabled: false,
    channels: [],
    levels: [],
  },
  ...overrides,
});

const alertPayload = (overrides = {}) => ({
  id: overrides.id,
  title: overrides.title || 'Spike detected',
  summary: overrides.summary || 'Error rate increased',
  severity: overrides.severity || 'high',
  environment: overrides.environment || 'production',
  occurrences: overrides.occurrences || 10,
  lastDetectedAt: overrides.lastDetectedAt || new Date().toISOString(),
  ...overrides,
});

beforeEach(async () => {
  jest.useFakeTimers();
  dispatchAlertChannels.mockClear();
  await resetState();
  configureAlertNotifications({
    aggregationWindowMs: 200,
    defaultCooldownMinutes: 0,
    defaultEscalationMinutes: 120,
  });
});

afterEach(async () => {
  jest.clearAllTimers();
  jest.useRealTimers();
  await resetState();
});

describe('alert notification service', () => {
  it('respects cooldown between dispatches', async () => {
    configureAlertNotifications({ aggregationWindowMs: 50, defaultCooldownMinutes: 0.1 });
    const rule = withRule({ cooldownMinutes: 0.1 });

    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'a1' }) });
    await jest.advanceTimersByTimeAsync(60);

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);

    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'a2' }) });
    await jest.advanceTimersByTimeAsync(60);

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(6000);
    await Promise.resolve();

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(2);
  });

  it('aggregates multiple alerts within window', async () => {
    configureAlertNotifications({ aggregationWindowMs: 100, defaultCooldownMinutes: 0 });
    const rule = withRule();

    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'agg-1' }) });
    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'agg-2' }) });
    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'agg-3' }) });

    expect(aggregationBuckets.size).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(150);
    await Promise.resolve();

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    const [{ alert }] = dispatchAlertChannels.mock.calls[0];
    expect(alert.metadata?.aggregation?.count).toBe(3);
    expect(alert.title).toContain('3 alerts');
  });

  it('triggers escalation when alert remains unresolved', async () => {
    configureAlertNotifications({ aggregationWindowMs: 0, defaultCooldownMinutes: 0, defaultEscalationMinutes: 0.05 });
    const rule = withRule({
      escalation: {
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/manager' }],
        levels: [{ afterMinutes: 0.05, channels: [{ type: 'webhook', target: 'https://example.com/manager' }] }],
      },
    });

    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'esc-1' }) });
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    expect(escalationEntries.size).toBe(1);

    await jest.advanceTimersByTimeAsync(4000);
    await Promise.resolve();

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(2);
    const escalationArgs = dispatchAlertChannels.mock.calls[1][0];
    expect(escalationArgs.alert.metadata.escalation).toBe(true);
    expect(escalationArgs.rule.channels[0].target).toBe('https://example.com/manager');
  });

  it('cancels escalation when acknowledged', async () => {
    configureAlertNotifications({ aggregationWindowMs: 0, defaultCooldownMinutes: 0, defaultEscalationMinutes: 0.05 });
    const rule = withRule({
      escalation: {
        enabled: true,
        levels: [{ afterMinutes: 0.05, channels: [{ type: 'webhook', target: 'https://example.com/manager' }] }],
      },
    });

    await processTriggeredAlert({ project: baseProject, rule, alert: alertPayload({ id: 'esc-ack' }) });
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);

    const firstArgs = dispatchAlertChannels.mock.calls[0][0];
    const acknowledged = await acknowledgeAlert(firstArgs.alert.id);
    expect(acknowledged).toBe(true);

    await jest.advanceTimersByTimeAsync(4000);
    await Promise.resolve();

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
  });
});
