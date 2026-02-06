jest.useFakeTimers();

describe('alert-notification-service integration', () => {
  let service;
  let dispatchAlertChannels;

  const project = { _id: 'proj-1', name: 'QA Project' };
  const baseRule = {
    _id: 'rule-agg',
    name: 'Aggregating rule',
    type: 'spike',
    channels: [{ type: 'email', target: 'ops@example.com' }],
  };

  const makeAlert = (idSuffix, overrides = {}) => ({
    id: `alert-${idSuffix}`,
    title: `Alert ${idSuffix}`,
    summary: 'Example alert',
    severity: 'high',
    environment: 'production',
    occurrences: 10,
    fingerprint: 'fp-1',
    ...overrides,
  });

  const loadService = async () => {
    jest.resetModules();
    process.env.ALERT_STATE_DRIVER = 'memory';

    jest.doMock('../src/services/alert-channel-service', () => ({
      dispatchAlertChannels: jest.fn().mockResolvedValue([]),
    }));

    service = require('../src/services/alert-notification-service');
    dispatchAlertChannels = require('../src/services/alert-channel-service').dispatchAlertChannels;

    await service.__testing.resetState();
    service.configureAlertNotifications({ aggregationWindowMs: 50, defaultCooldownMinutes: 30 });
  };

  beforeEach(async () => {
    await loadService();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await service.__testing.resetState();
  });

  afterAll(() => {
    // Ensure fake timers from this suite do not leak into others
    jest.useRealTimers();
  });

  it('aggregates multiple alerts within the window and dispatches once', async () => {
    const rule = { ...baseRule, _id: 'rule-agg', cooldownMinutes: 0 };
    const now = new Date('2026-02-05T00:00:00Z');

    await service.processTriggeredAlert({ project, rule, alert: makeAlert('a1'), now });
    await service.processTriggeredAlert({ project, rule, alert: makeAlert('a2'), now });

    const { aggregationBuckets, flushBucket } = service.__testing;
    const bucket = aggregationBuckets.get(rule._id);
    expect(bucket).toBeDefined();
    expect(bucket.alerts).toHaveLength(2);

    const aggregated = await flushBucket(rule._id);
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
    expect(aggregated.metadata?.aggregated).toBe(true);
    expect(aggregated.metadata?.aggregation?.count).toBe(2);
  });

  it('respects cooldown and defers dispatch when still cooling down', async () => {
    const rule = { ...baseRule, _id: 'rule-cooldown', cooldownMinutes: 30 };
    const now = new Date('2026-02-05T01:00:00Z');

    await service.processTriggeredAlert({ project, rule, alert: makeAlert('c1'), now });
    await service.__testing.flushBucket(rule._id);

    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);

    const later = new Date(now.getTime() + 60 * 1000); // within cooldown
    await service.processTriggeredAlert({ project, rule, alert: makeAlert('c2'), now: later });

    const result = await service.__testing.flushBucket(rule._id);
    expect(result).toBeNull();
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
  });

  it('aggregates bursts (5+ alerts) and preserves sample count', async () => {
    const rule = { ...baseRule, _id: 'rule-burst', cooldownMinutes: 0 };
    const now = new Date('2026-02-05T02:00:00Z');

    for (let i = 0; i < 5; i += 1) {
      await service.processTriggeredAlert({ project, rule, alert: makeAlert(`b${i + 1}`), now });
    }

    const aggregated = await service.__testing.flushBucket(rule._id);
    expect(aggregated.metadata?.aggregation?.count).toBe(5);
    expect(Array.isArray(aggregated.metadata?.aggregation?.sample)).toBe(true);
    expect(aggregated.metadata.aggregation.sample.length).toBeGreaterThan(0);
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(1);
  });

  it('logs and reschedules when channel dispatch fails (offline/misconfig)', async () => {
    const rule = { ...baseRule, _id: 'rule-offline', cooldownMinutes: 0 };
    const now = new Date('2026-02-05T03:00:00Z');

    dispatchAlertChannels.mockRejectedValueOnce(new Error('channel offline'));

    await service.processTriggeredAlert({ project, rule, alert: makeAlert('off1'), now });

    await expect(service.__testing.flushBucket(rule._id)).rejects.toThrow('channel offline');

    // Rewire channel to succeed and ensure retry will dispatch next flush.
    dispatchAlertChannels.mockResolvedValueOnce([]);
    await service.__testing.flushBucket(rule._id);
    expect(dispatchAlertChannels).toHaveBeenCalledTimes(2);
  });
});
