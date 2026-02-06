jest.mock('../src/models/AlertRule', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/services/alert-context-service', () => ({
  enrichAlertWithContext: jest.fn(),
}));

const AlertRule = require('../src/models/AlertRule');
const { enrichAlertWithContext } = require('../src/services/alert-context-service');
const { simulateAlertRule } = require('../src/services/alert-test-service');

const PROJECT = { _id: '507f1f77bcf86cd799439010', name: 'Demo Project' };

const mockFindOneLean = (rule) => {
  const lean = jest.fn().mockResolvedValue(rule);
  AlertRule.findOne.mockReturnValue({ lean });
  return lean;
};

describe('alert-test-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enrichAlertWithContext.mockImplementation(async ({ alert }) => ({
      ...alert,
      whyItMatters: 'Preview reason',
      nextSteps: ['Step 1'],
      context: {
        recentDeployments: [],
        similarIncidents: [],
        suggestedFixes: ['Check logs'],
      },
    }));
  });

  it('returns validation error when fingerprint missing for aggregate rules', async () => {
    mockFindOneLean({
      _id: '507f1f77bcf86cd799439011',
      project: PROJECT._id,
      name: 'High volume errors',
      type: 'threshold',
      conditions: { threshold: 10, windowMinutes: 5 },
      channels: [],
    });

    const result = await simulateAlertRule({
      project: PROJECT,
      ruleId: '507f1f77bcf86cd799439011',
      input: { windowCount: 12 },
    });

    expect(result.triggered).toBe(false);
    expect(result.error).toEqual({ message: expect.stringContaining('Fingerprint is required'), status: 422 });
    expect(result.evaluation.reason).toBe('missing_fingerprint');
  });

  it('simulates threshold rule and builds channel previews', async () => {
    mockFindOneLean({
      _id: '507f1f77bcf86cd799439012',
      project: PROJECT._id,
      name: 'Checkout failures',
      type: 'threshold',
      enabled: true,
      conditions: { threshold: 5, windowMinutes: 5 },
      channels: [
        { type: 'email', target: 'ops@example.com' },
        { type: 'slack', target: 'https://hooks.slack.com/services/test' },
      ],
    });

    const input = {
      fingerprint: 'fp-threshold',
      windowCount: 12,
      occurrences: 12,
      environment: 'production',
      severity: 'high',
      userSegments: ['premium'],
      links: { dashboardUrl: 'https://app.example.com/alerts/fp-threshold' },
    };

    const result = await simulateAlertRule({
      project: PROJECT,
      ruleId: '507f1f77bcf86cd799439012',
      input,
    });

    expect(result.triggered).toBe(true);
    expect(enrichAlertWithContext).toHaveBeenCalledTimes(1);
    expect(result.alert).toBeTruthy();
    expect(result.alert.whyItMatters).toBe('Preview reason');

    const emailPreview = result.channels.find((channel) => channel.type === 'email');
    expect(emailPreview).toBeTruthy();
    expect(emailPreview.preview.subject).toContain('Checkout failures');

    const slackPreview = result.channels.find((channel) => channel.type === 'slack');
    expect(slackPreview).toBeTruthy();
    expect(slackPreview.preview.message.text).toContain('Checkout failures');
  });
});
