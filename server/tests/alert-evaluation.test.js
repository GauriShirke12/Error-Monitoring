const {
  evaluateRule,
  evaluateThreshold,
  evaluateSpike,
  evaluateNewError,
  evaluateCritical,
} = require('../src/services/alert-evaluation-service');

describe('Alert evaluation engine', () => {
  it('triggers threshold rule when count exceeds target', () => {
    const rule = {
      _id: 'rule-threshold',
      type: 'threshold',
      enabled: true,
      cooldownMinutes: 30,
      conditions: {
        threshold: 50,
        windowMinutes: 10,
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 75,
      windowMinutes: 10,
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('threshold_exceeded');
    expect(result.context.threshold).toBe(50);
    expect(result.cooldownMinutes).toBe(30);
  });

  it('does not trigger threshold rule when below target', () => {
    const rule = {
      type: 'threshold',
      enabled: true,
      conditions: {
        threshold: 100,
        windowMinutes: 5,
      },
    };

    const result = evaluateThreshold(rule, {
      windowCount: 80,
      windowMinutes: 5,
    });

    expect(result.triggered).toBe(false);
  });

  it('triggers spike rule when rate increases beyond threshold', () => {
    const rule = {
      _id: 'rule-spike',
      type: 'spike',
      enabled: true,
      cooldownMinutes: 15,
      conditions: {
        increasePercent: 150,
        windowMinutes: 5,
        baselineMinutes: 30,
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 100,
      windowMinutes: 5,
      baselineCount: 50,
      baselineMinutes: 30,
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('spike_detected');
    expect(result.context.increasePercent).toBeGreaterThanOrEqual(150);
  });

  it('marks new errors immediately', () => {
    const rule = {
      type: 'new_error',
      enabled: true,
      cooldownMinutes: 0,
      conditions: {},
    };

    const result = evaluateNewError(rule, {
      isNew: true,
      fingerprint: 'err::123',
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('new_error');
  });

  it('triggers critical severity alerts', () => {
    const rule = {
      type: 'critical',
      enabled: true,
      conditions: {
        severity: 'critical',
      },
    };

    const result = evaluateCritical(rule, {
      severity: 'critical',
      fingerprint: 'api::timeout',
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('critical_severity');
  });

  it('skips rules when environment filter does not match', () => {
    const rule = {
      type: 'threshold',
      enabled: true,
      conditions: {
        threshold: 10,
        windowMinutes: 5,
        environments: ['production'],
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 20,
      windowMinutes: 5,
      environment: 'staging',
    });

    expect(result.triggered).toBe(false);
  });

  it('evaluates advanced filter using logical operators', () => {
    const rule = {
      type: 'threshold',
      enabled: true,
      conditions: {
        threshold: 50,
        windowMinutes: 10,
        filter: {
          op: 'and',
          conditions: [
            { field: 'environment', operator: 'equals', value: 'production' },
            {
              op: 'or',
              conditions: [
                { field: 'userSegment', operator: 'equals', value: 'premium' },
                { field: 'userSegment', operator: 'equals', value: 'enterprise' },
              ],
            },
            { field: 'file', operator: 'contains', value: 'checkout' },
          ],
        },
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 120,
      windowMinutes: 10,
      environment: 'production',
      userSegments: ['beta', 'premium'],
      file: '/src/services/checkout-handler.js',
    });

    expect(result.triggered).toBe(true);
  });

  it('fails advanced filter when conditions are not satisfied', () => {
    const rule = {
      type: 'threshold',
      enabled: true,
      conditions: {
        threshold: 20,
        windowMinutes: 5,
        filter: {
          op: 'and',
          conditions: [
            { field: 'environment', operator: 'equals', value: 'production' },
            { field: 'userSegment', operator: 'equals', value: 'premium' },
          ],
        },
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 30,
      windowMinutes: 5,
      environment: 'production',
      userSegments: ['standard'],
    });

    expect(result.triggered).toBe(false);
  });

  it('ignores disabled rules', () => {
    const rule = {
      type: 'threshold',
      enabled: false,
      conditions: {
        threshold: 1,
        windowMinutes: 1,
      },
    };

    const result = evaluateRule(rule, {
      windowCount: 100,
      windowMinutes: 1,
    });

    expect(result.triggered).toBe(false);
  });
});
