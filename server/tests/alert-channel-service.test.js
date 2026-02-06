jest.mock('../src/config/email', () => ({
  getEmailConfig: jest.fn(() => ({
    dashboardUrl: 'https://app.example.com',
    unsubscribeBaseUrl: 'https://app.example.com/unsubscribe',
    from: 'alerts@example.com',
  })),
}));

jest.mock('../src/services/email-service', () => ({
  sendAlertEmail: jest.fn().mockResolvedValue({ delivered: true }),
}));

const { getEmailConfig } = require('../src/config/email');
const { sendAlertEmail } = require('../src/services/email-service');
const {
  dispatchAlertChannels,
  __testing: {
    sendGenericWebhook,
    sendSlackNotification,
    sendDiscordNotification,
    sendTeamsNotification,
    buildBaseAlertPayload,
  },
} = require('../src/services/alert-channel-service');

const buildContext = () => ({
  project: { _id: 'p1', name: 'Demo Project' },
  rule: { _id: 'r1', name: 'High error volume', type: 'threshold', channels: [] },
  alert: {
    id: 'alert-123',
    title: 'Spike detected',
    summary: 'Error rate increased by 200%',
    severity: 'high',
    environment: 'production',
    occurrences: 42,
    affectedUsers: 15,
    fingerprint: 'error::hash',
    lastDetectedAt: new Date().toISOString(),
    metadata: { sample: true },
  },
});

describe('alert channel service', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
  });

  it('builds webhook payload with rule and alert context', () => {
    const context = buildContext();
    const payload = buildBaseAlertPayload(context);
    expect(payload.project.name).toBe('Demo Project');
    expect(payload.rule.name).toBe('High error volume');
    expect(payload.alert.title).toBe('Spike detected');
    expect(payload.links.dashboard).toBe('https://app.example.com/alerts/alert-123');
  });

  it('sends generic webhook payload', async () => {
    const context = buildContext();
    const payload = buildBaseAlertPayload(context);
    await sendGenericWebhook({ url: 'https://example.com/webhook', payload });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).alert.title).toBe('Spike detected');
  });

  it('formats Slack notifications with blocks', async () => {
    const context = buildContext();
    const payload = buildBaseAlertPayload(context);
    await sendSlackNotification({ url: 'https://hooks.slack.com/123', payload });
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.blocks).toHaveLength(4);
    expect(body.blocks[0].text.text).toContain('Spike detected');
    expect(body.blocks[3].elements[0].url).toBe('https://app.example.com/alerts/alert-123');
  });

  it('formats Discord embeds with alert data', async () => {
    const context = buildContext();
    const payload = buildBaseAlertPayload(context);
    await sendDiscordNotification({ url: 'https://discordapp.com/api/webhooks/abc', payload });
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.embeds[0].title).toBe('Spike detected');
    expect(body.embeds[0].url).toBe('https://app.example.com/alerts/alert-123');
  });

  it('formats Microsoft Teams card payload', async () => {
    const context = buildContext();
    const payload = buildBaseAlertPayload(context);
    await sendTeamsNotification({ url: 'https://teams.microsoft.com/webhook/123', payload });
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body['@type']).toBe('MessageCard');
    expect(body.potentialAction[0].targets[0].uri).toBe('https://app.example.com/alerts/alert-123');
  });

  it('dispatches all configured channels', async () => {
    const context = buildContext();
    context.rule.channels = [
      { type: 'email', target: 'alerts@example.com' },
      { type: 'slack', target: 'https://hooks.slack.com/123' },
      { type: 'discord', target: 'https://discordapp.com/api/webhooks/abc' },
      { type: 'teams', target: 'https://teams.microsoft.com/webhook/123' },
      { type: 'webhook', target: 'https://example.com/webhook' },
    ];

    const results = await dispatchAlertChannels(context);

    expect(sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(results).toHaveLength(5);
  });
});
