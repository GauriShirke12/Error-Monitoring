jest.mock('../src/models/Deployment', () => ({
  find: jest.fn(),
}));

jest.mock('../src/models/Error', () => ({
  find: jest.fn(),
}));

const Deployment = require('../src/models/Deployment');
const ErrorEvent = require('../src/models/Error');
const { buildAlertContext, enrichAlertWithContext } = require('../src/services/alert-context-service');

const buildQueryChain = () => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn(),
  };
  return chain;
};

describe('alert-context-service', () => {
  const project = { _id: '507f1f77bcf86cd799439011', name: 'Critical Service' };
  const alertBase = {
    id: 'alert-123',
    title: 'Spike in checkout errors',
    summary: 'Detected spike in checkout failures over baseline.',
    severity: 'high',
    environment: 'production',
    occurrences: 42,
    lastDetectedAt: new Date('2026-02-04T09:05:00Z'),
    metadata: {
      sourceFile: 'services/checkout.js',
      userSegments: ['premium'],
      fingerprint: 'fingerprint-123',
      other: 'value',
    },
    links: {
      investigate: 'https://dashboard.example.com/errors/alert-123',
      acknowledge: 'https://dashboard.example.com/errors/alert-123/ack',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    const deploymentChain = buildQueryChain();
    deploymentChain.lean.mockResolvedValue([
      {
        _id: { toString: () => 'dep-1' },
        label: 'Release 42',
        timestamp: new Date('2026-02-04T09:01:00Z'),
        metadata: { version: 'v1.2.3' },
      },
    ]);
    Deployment.find.mockReturnValue(deploymentChain);

    const incidentChain = buildQueryChain();
    incidentChain.lean.mockResolvedValue([
      {
        _id: { toString: () => 'err-1' },
        message: 'Checkout timed out',
        lastSeen: new Date('2026-02-04T08:55:00Z'),
        status: 'investigating',
        count: 17,
        environment: 'production',
      },
    ]);
    ErrorEvent.find.mockReturnValue(incidentChain);
  });

  it('builds contextual insights from deployments and incidents', async () => {
    const evaluation = { triggered: true, reason: 'spike_detected' };
    const metrics = { fingerprint: 'fingerprint-123' };

    const context = await buildAlertContext({
      project,
      rule: { type: 'spike' },
      alert: alertBase,
      evaluation,
      metrics,
      links: alertBase.links,
    });

    expect(Deployment.find).toHaveBeenCalledTimes(1);
    const deploymentQuery = Deployment.find.mock.calls[0][0];
    expect(deploymentQuery).toMatchObject({ projectId: project._id });

    expect(ErrorEvent.find).toHaveBeenCalledWith({ projectId: project._id, fingerprint: 'fingerprint-123' });

    expect(context.recentDeployments).toEqual([
      {
        id: 'dep-1',
        label: 'Release 42',
        timestamp: new Date('2026-02-04T09:01:00Z'),
        metadata: { version: 'v1.2.3' },
      },
    ]);

    expect(context.similarIncidents).toEqual([
      {
        id: 'err-1',
        message: 'Checkout timed out',
        lastSeen: new Date('2026-02-04T08:55:00Z'),
        status: 'investigating',
        count: 17,
        environment: 'production',
      },
    ]);

    const expectedWhy = 'Severity HIGH, production environment, affecting premium, 42 occurrences detected. Error rate spiked significantly over historical baseline.';
    expect(context.whyItMatters).toBe(expectedWhy);

    expect(context.suggestedFixes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Review deployment "Release 42"'),
        'Inspect recent changes in services/checkout.js.',
      ])
    );

    expect(context.nextSteps).toEqual(
      expect.arrayContaining([
        'Inspect services/checkout.js for recent changes.',
        'Rollback or hotfix deployment "Release 42" if necessary.',
        'Review stack traces and logs via the dashboard link.',
        'Acknowledge the alert once triage begins to pause escalations.',
      ])
    );
  });

  it('enriches alert payload with contextual insights', async () => {
    const evaluation = { triggered: true, reason: 'spike_detected' };
    const metrics = { fingerprint: 'fingerprint-123' };
    const originalAlert = { ...alertBase };

    const enriched = await enrichAlertWithContext({
      project,
      rule: { type: 'spike' },
      alert: originalAlert,
      evaluation,
      metrics,
      links: alertBase.links,
    });

    expect(enriched).not.toBe(originalAlert);
    expect(enriched.metadata.other).toBe('value');
    expect(enriched.whyItMatters).toMatch('Severity HIGH');
    expect(Array.isArray(enriched.nextSteps)).toBe(true);

    expect(enriched.context).toMatchObject({
      recentDeployments: expect.any(Array),
      similarIncidents: expect.any(Array),
      suggestedFixes: expect.any(Array),
    });

    expect(enriched.metadata.contextualInsights).toEqual({
      recentDeployments: enriched.context.recentDeployments,
      similarIncidents: enriched.context.similarIncidents,
      suggestedFixes: enriched.context.suggestedFixes,
      whyItMatters: enriched.whyItMatters,
      nextSteps: enriched.nextSteps,
    });

    expect(originalAlert.metadata.contextualInsights).toBeUndefined();
  });
});
