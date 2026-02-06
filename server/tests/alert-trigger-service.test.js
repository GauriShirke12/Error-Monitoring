jest.mock('../src/models/AlertRule', () => ({
  find: jest.fn(),
}));

jest.mock('../src/models/Occurrence', () => ({
  countDocuments: jest.fn(),
}));

jest.mock('../src/services/alert-notification-service', () => ({
  processTriggeredAlert: jest.fn().mockResolvedValue(null),
}));

const AlertRule = require('../src/models/AlertRule');
const ErrorOccurrence = require('../src/models/Occurrence');
const { processTriggeredAlert } = require('../src/services/alert-notification-service');
const { evaluateAndDispatchAlerts } = require('../src/services/alert-trigger-service');

const baseProject = { _id: 'proj-1', name: 'Demo Project' };
const baseEvent = {
  _id: 'error-1',
  message: 'Unhandled exception',
  fingerprint: 'fingerprint-123',
  count: 27,
  firstSeen: new Date('2026-02-04T08:00:00Z'),
};
const baseOccurrence = {
  _id: 'occ-1',
  fingerprint: 'fingerprint-123',
  environment: 'production',
  timestamp: new Date('2026-02-04T09:00:00Z'),
};

const mockRuleQuery = (rules) => {
  const exec = jest.fn().mockResolvedValue(rules);
  const chain = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec,
  };
  AlertRule.find.mockReturnValue(chain);
  return { exec, chain };
};

const mockCountDocumentsSequence = (values = []) => {
  let index = 0;
  ErrorOccurrence.countDocuments.mockImplementation(() => ({
    exec: jest.fn().mockImplementation(() => {
      const value = index < values.length ? values[index] : values[values.length - 1];
      index += 1;
      return Promise.resolve(value);
    }),
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCountDocumentsSequence([0]);
});

describe('alert-trigger-service', () => {
  it('dispatches threshold alerts when counts exceed the configured threshold', async () => {
    mockRuleQuery([
      {
        _id: 'rule-threshold',
        name: 'High error volume',
        type: 'threshold',
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
        conditions: { threshold: 10, windowMinutes: 15 },
      },
    ]);
    mockCountDocumentsSequence([12]);

    const result = await evaluateAndDispatchAlerts({
      project: baseProject,
      errorEvent: baseEvent,
      occurrence: baseOccurrence,
      isNew: false,
      payload: {},
    });

    expect(result.triggered).toBe(1);
    expect(processTriggeredAlert).toHaveBeenCalledTimes(1);
    const [{ alert }] = processTriggeredAlert.mock.calls[0];
    expect(alert.summary).toContain('12 occurrences');
    expect(alert.severity).toBe('high');
    expect(alert.environment).toBe('production');
  });

  it('emits new error alerts when first occurrences arrive', async () => {
    mockRuleQuery([
      {
        _id: 'rule-new',
        name: 'New error detected',
        type: 'new_error',
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
        conditions: {},
      },
    ]);

    const result = await evaluateAndDispatchAlerts({
      project: baseProject,
      errorEvent: baseEvent,
      occurrence: baseOccurrence,
      isNew: true,
      payload: {},
    });

    expect(result.triggered).toBe(1);
    expect(processTriggeredAlert).toHaveBeenCalledTimes(1);
    const [{ alert }] = processTriggeredAlert.mock.calls[0];
    expect(alert.summary.toLowerCase()).toContain('new fingerprint');
    expect(alert.severity).toBe('medium');
  });

  it('computes spike metrics using window and baseline counts', async () => {
    mockRuleQuery([
      {
        _id: 'rule-spike',
        name: 'Spike detected',
        type: 'spike',
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
        conditions: { increasePercent: 150, windowMinutes: 5, baselineMinutes: 30 },
      },
    ]);
    mockCountDocumentsSequence([40, 10]);

    await evaluateAndDispatchAlerts({
      project: baseProject,
      errorEvent: baseEvent,
      occurrence: baseOccurrence,
      isNew: false,
      payload: {},
    });

    expect(processTriggeredAlert).toHaveBeenCalledTimes(1);
    const [{ alert }] = processTriggeredAlert.mock.calls[0];
    expect(alert.summary.toLowerCase()).toContain('rate increased');
    expect(alert.severity).toBe('high');
  });

  it('respects advanced filter conditions before dispatching alerts', async () => {
    mockRuleQuery([
      {
        _id: 'rule-advanced',
        name: 'Premium checkout errors',
        type: 'threshold',
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
        conditions: {
          threshold: 5,
          windowMinutes: 15,
          filter: {
            op: 'and',
            conditions: [
              { field: 'environment', operator: 'equals', value: 'production' },
              { field: 'userSegment', operator: 'equals', value: 'premium' },
              { field: 'file', operator: 'contains', value: 'checkout' },
            ],
          },
        },
      },
    ]);
    mockCountDocumentsSequence([12]);

    const payload = {
      stackTrace: [{ file: '/app/routes/checkout.js' }],
      userContext: { segment: 'premium' },
    };

    await evaluateAndDispatchAlerts({
      project: baseProject,
      errorEvent: baseEvent,
      occurrence: { ...baseOccurrence, stackTrace: payload.stackTrace },
      isNew: false,
      payload,
    });

    expect(processTriggeredAlert).toHaveBeenCalledTimes(1);
  });

  it('skips alerts when advanced filter conditions fail', async () => {
    mockRuleQuery([
      {
        _id: 'rule-advanced-skip',
        name: 'Premium checkout errors',
        type: 'threshold',
        enabled: true,
        channels: [{ type: 'webhook', target: 'https://example.com/hook' }],
        conditions: {
          threshold: 5,
          windowMinutes: 15,
          filter: {
            op: 'and',
            conditions: [
              { field: 'environment', operator: 'equals', value: 'production' },
              { field: 'userSegment', operator: 'equals', value: 'premium' },
            ],
          },
        },
      },
    ]);
    mockCountDocumentsSequence([20]);

    await evaluateAndDispatchAlerts({
      project: baseProject,
      errorEvent: baseEvent,
      occurrence: baseOccurrence,
      isNew: false,
      payload: { userContext: { segment: 'standard' } },
    });

    expect(processTriggeredAlert).not.toHaveBeenCalled();
  });
});
