const logger = require('../utils/logger');
const { getEmailConfig } = require('../config/email');
const { createCircuitBreaker } = require('../utils/circuit-breaker');
const { sendAlertEmail, buildAlertEmailPreview } = require('./email-service');

const DEFAULT_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 7000);
const slackCircuit = createCircuitBreaker({ name: 'slack-webhook', logger });

const ensureFetch = () => {
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('Fetch API is not available in this runtime');
};

const toJsonSafe = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
};

const buildBaseAlertPayload = ({ project, rule, alert }) => {
  const config = getEmailConfig();
  const context = alert.context || alert.metadata?.contextualInsights || {};
  return {
    timestamp: new Date().toISOString(),
    project: {
      id: project?._id?.toString?.() || null,
      name: project?.name || 'Unknown project',
    },
    rule: {
      id: rule?._id?.toString?.() || null,
      name: rule?.name || 'Alert rule',
      type: rule?.type || null,
      description: rule?.description || null,
      tags: rule?.tags || [],
    },
    alert: {
      id: alert?.id || null,
      title: alert?.title || rule?.name || 'Alert notification',
      summary: alert?.summary || '',
      severity: alert?.severity || rule?.conditions?.severity || 'info',
      environment: alert?.environment || alert?.environments || null,
      occurrences: alert?.occurrences || null,
      affectedUsers: alert?.affectedUsers || null,
      fingerprint: alert?.fingerprint || null,
      firstDetectedAt: alert?.firstDetectedAt || null,
      lastDetectedAt: alert?.lastDetectedAt || null,
      metadata: toJsonSafe(alert?.metadata || {}),
      context,
      whyItMatters: alert?.whyItMatters || context?.whyItMatters || null,
      nextSteps: Array.isArray(alert?.nextSteps) ? alert.nextSteps : context?.nextSteps || [],
    },
    links: {
      dashboard: `${config.dashboardUrl.replace(/\/$/, '')}/alerts/${alert?.id || ''}`,
      acknowledge: alert?.links?.acknowledgeUrl || null,
    },
  };
};

const withTimeout = (promise, timeoutMs, onTimeout) => {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (onTimeout) {
        onTimeout();
      }
      reject(new Error('Request timed out'));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutHandle)),
    timeoutPromise,
  ]);
};

const postJson = async (url, body, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const fetchImpl = ensureFetch();
  const request = fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const response = await withTimeout(request, timeoutMs, () => {
    logger.warn({ url }, 'Webhook request timed out');
  });

  if (!response.ok) {
    const text = await response.text().catch(() => null);
    const error = new Error(`Webhook request failed with status ${response.status}`);
    error.status = response.status;
    error.response = text;
    throw error;
  }

  return response;
};

const sendGenericWebhook = async ({ url, payload }) => {
  if (!url) {
    throw new Error('Webhook url is required');
  }
  try {
    await postJson(url, payload);
    logger.info({ url }, 'Webhook notification delivered');
    return { delivered: true };
  } catch (error) {
    logger.error({ err: error, url }, 'Failed to deliver webhook notification');
    throw error;
  }
};

const buildSlackBlocks = ({ payload, config }) => {
  const { project, rule, alert, links } = payload;
  const dashboardUrl = links.dashboard;
  const acknowledgeUrl = links.acknowledge;
  const context = alert.context || {};

  const fields = [
    {
      type: 'mrkdwn',
      text: `*Severity:* ${String(alert.severity || 'info').toUpperCase()}`,
    },
    {
      type: 'mrkdwn',
      text: `*Environment:* ${Array.isArray(alert.environment) ? alert.environment.join(', ') : alert.environment || 'all'}`,
    },
  ];

  if (alert.occurrences != null) {
    fields.push({ type: 'mrkdwn', text: `*Occurrences:* ${alert.occurrences}` });
  }
  if (alert.affectedUsers != null) {
    fields.push({ type: 'mrkdwn', text: `*Affected users:* ${alert.affectedUsers}` });
  }

  const actionsElements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'View Error', emoji: true },
      url: dashboardUrl,
      style: 'primary',
    },
  ];

  if (acknowledgeUrl) {
    actionsElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
      url: acknowledgeUrl,
    });
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alert.title}*\n${alert.summary || ''}`.trim(),
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Project:* ${project.name}\n*Rule:* ${rule.name || 'Alert rule'}`,
        },
      ],
    },
    {
      type: 'section',
      fields,
    },
  ];

  if (alert.whyItMatters) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Why this matters*\n${alert.whyItMatters}`,
      },
    });
  }

  if (Array.isArray(context.recentDeployments) && context.recentDeployments.length) {
    const deploymentsText = context.recentDeployments
      .map((deployment) => {
        const when = deployment.timestamp ? new Date(deployment.timestamp).toUTCString() : 'unknown time';
        return `• ${deployment.label || 'Deployment'} — ${when}`;
      })
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recent deployments*\n${deploymentsText}`,
      },
    });
  }

  if (Array.isArray(context.similarIncidents) && context.similarIncidents.length) {
    const incidentsText = context.similarIncidents
      .map((incident) => {
        const when = incident.lastSeen ? new Date(incident.lastSeen).toUTCString() : 'unknown time';
        return `• ${incident.message || 'Incident'} — last seen ${when}`;
      })
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Similar incidents*\n${incidentsText}`,
      },
    });
  }

  const suggestedFixes = context.suggestedFixes || alert.nextSteps || [];
  if (Array.isArray(suggestedFixes) && suggestedFixes.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Next steps*\n${suggestedFixes.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: actionsElements,
  });

  return blocks;
};

const sendSlackNotification = async ({ url, payload }) => {
  const config = getEmailConfig();
  const blocks = buildSlackBlocks({ payload, config });
  const message = {
    text: `${payload.alert.title} – ${payload.alert.summary || 'Alert triggered'}`,
    blocks,
  };
  await slackCircuit.execute(() => postJson(url, message));
  logger.info({ url }, 'Slack notification delivered');
  return { delivered: true };
};

const buildDiscordPayload = ({ payload }) => {
  const { project, rule, alert, links } = payload;
  const context = alert.context || {};
  const fields = [];
  if (alert.environment) {
    fields.push({ name: 'Environment', value: Array.isArray(alert.environment) ? alert.environment.join(', ') : alert.environment, inline: true });
  }
  if (alert.severity) {
    fields.push({ name: 'Severity', value: String(alert.severity).toUpperCase(), inline: true });
  }
  if (alert.occurrences != null) {
    fields.push({ name: 'Occurrences', value: String(alert.occurrences), inline: true });
  }
  if (alert.affectedUsers != null) {
    fields.push({ name: 'Affected users', value: String(alert.affectedUsers), inline: true });
  }
  if (alert.whyItMatters) {
    fields.push({ name: 'Why this matters', value: alert.whyItMatters, inline: false });
  }
  if (Array.isArray(context.recentDeployments) && context.recentDeployments.length) {
    const deploymentsText = context.recentDeployments
      .map((deployment) => {
        const when = deployment.timestamp ? new Date(deployment.timestamp).toUTCString() : 'unknown time';
        return `${deployment.label || 'Deployment'} — ${when}`;
      })
      .join('\n');
    fields.push({ name: 'Recent deployments', value: deploymentsText.slice(0, 1024), inline: false });
  }
  if (Array.isArray(context.similarIncidents) && context.similarIncidents.length) {
    const incidentsText = context.similarIncidents
      .map((incident) => {
        const when = incident.lastSeen ? new Date(incident.lastSeen).toUTCString() : 'unknown time';
        return `${incident.message || 'Incident'} — last seen ${when}`;
      })
      .join('\n');
    fields.push({ name: 'Similar incidents', value: incidentsText.slice(0, 1024), inline: false });
  }
  const nextSteps = Array.isArray(alert.nextSteps) && alert.nextSteps.length ? alert.nextSteps : context.suggestedFixes;
  if (Array.isArray(nextSteps) && nextSteps.length) {
    const stepsText = nextSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
    fields.push({ name: 'Next steps', value: stepsText.slice(0, 1024), inline: false });
  }

  return {
    embeds: [
      {
        title: alert.title,
        description: alert.summary || 'An alert was triggered',
        url: links.dashboard,
        color: 0xff4d4f,
        timestamp: payload.timestamp,
        footer: {
          text: `${project.name} – ${rule.name || 'Alert rule'}`,
        },
        fields,
      },
    ],
  };
};

const sendDiscordNotification = async ({ url, payload }) => {
  const body = buildDiscordPayload({ payload });
  await postJson(url, body);
  logger.info({ url }, 'Discord notification delivered');
  return { delivered: true };
};

const buildTeamsPayload = ({ payload }) => {
  const { project, rule, alert, links } = payload;
  const context = alert.context || {};
  const facts = [];
  if (alert.environment) {
    facts.push({ name: 'Environment', value: Array.isArray(alert.environment) ? alert.environment.join(', ') : alert.environment });
  }
  if (alert.severity) {
    facts.push({ name: 'Severity', value: String(alert.severity).toUpperCase() });
  }
  if (alert.occurrences != null) {
    facts.push({ name: 'Occurrences', value: String(alert.occurrences) });
  }
  if (alert.affectedUsers != null) {
    facts.push({ name: 'Affected users', value: String(alert.affectedUsers) });
  }

  const sections = [
    {
      activitySubtitle: `${project.name} • ${rule.name || 'Alert rule'}`,
      text: alert.summary || 'An alert was triggered',
      facts,
    },
  ];

  if (alert.whyItMatters || (Array.isArray(context.recentDeployments) && context.recentDeployments.length)) {
    const lines = [];
    if (alert.whyItMatters) {
      lines.push(`**Why this matters**\n${alert.whyItMatters}`);
    }
    if (Array.isArray(context.recentDeployments) && context.recentDeployments.length) {
      const deploymentLines = context.recentDeployments
        .map((deployment) => {
          const when = deployment.timestamp ? new Date(deployment.timestamp).toUTCString() : 'unknown time';
          return `• ${deployment.label || 'Deployment'} — ${when}`;
        })
        .join('\n');
      lines.push(`**Recent deployments**\n${deploymentLines}`);
    }
    if (Array.isArray(context.similarIncidents) && context.similarIncidents.length) {
      const incidentLines = context.similarIncidents
        .map((incident) => {
          const when = incident.lastSeen ? new Date(incident.lastSeen).toUTCString() : 'unknown time';
          return `• ${incident.message || 'Incident'} — last seen ${when}`;
        })
        .join('\n');
      lines.push(`**Similar incidents**\n${incidentLines}`);
    }
    sections.push({ text: lines.join('\n\n') });
  }

  const nextSteps = Array.isArray(alert.nextSteps) && alert.nextSteps.length ? alert.nextSteps : context.suggestedFixes;
  if (Array.isArray(nextSteps) && nextSteps.length) {
    sections.push({ text: `**Next steps**\n${nextSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}` });
  }

  return {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: `${alert.title} – ${alert.summary || ''}`.trim(),
    themeColor: 'EA4C89',
    title: alert.title,
    sections,
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: 'View Error',
        targets: [
          {
            os: 'default',
            uri: links.dashboard,
          },
        ],
      },
    ],
  };
};

  const buildChannelPreviews = ({ project, rule, alert }) => {
    const channels = Array.isArray(rule?.channels) ? rule.channels : [];
    if (!channels.length) {
      return [];
    }

    const payload = buildBaseAlertPayload({ project, rule, alert });
    const config = getEmailConfig();

    return channels.map((channel) => {
      const type = String(channel?.type || '').toLowerCase();
      const target = channel?.target || null;

      if (type === 'email') {
        return {
          type,
          target,
          preview: buildAlertEmailPreview({ project, rule, alert, links: alert?.links }),
        };
      }

      if (type === 'webhook') {
        return {
          type,
          target,
          preview: { body: payload },
        };
      }

      if (type === 'slack') {
        const blocks = buildSlackBlocks({ payload, config });
        return {
          type,
          target,
          preview: {
            message: {
              text: `${payload.alert.title} – ${payload.alert.summary || 'Alert triggered'}`.trim(),
              blocks,
            },
          },
        };
      }

      if (type === 'discord') {
        return {
          type,
          target,
          preview: { body: buildDiscordPayload({ payload }) },
        };
      }

      if (type === 'teams') {
        return {
          type,
          target,
          preview: { body: buildTeamsPayload({ payload }) },
        };
      }

      return {
        type,
        target,
        preview: null,
        unsupported: true,
      };
    });
  };

const sendTeamsNotification = async ({ url, payload }) => {
  const body = buildTeamsPayload({ payload });
  await postJson(url, body, {
    headers: {
      'content-type': 'application/json',
    },
  });
  logger.info({ url }, 'Microsoft Teams notification delivered');
  return { delivered: true };
};

const dispatchChannel = async ({ channel, project, rule, alert }) => {
  const type = String(channel?.type || '').toLowerCase();
  const target = channel?.target;
  const payload = buildBaseAlertPayload({ project, rule, alert });

  if (type === 'email') {
    return sendAlertEmail({ project, rule, alert, recipients: [target], links: alert?.links });
  }

  if (type === 'webhook') {
    return sendGenericWebhook({ url: target, payload });
  }

  if (type === 'slack') {
    return sendSlackNotification({ url: target, payload });
  }

  if (type === 'discord') {
    return sendDiscordNotification({ url: target, payload });
  }

  if (type === 'teams') {
    return sendTeamsNotification({ url: target, payload });
  }

  logger.warn({ type }, 'Unsupported channel type');
  return { skipped: true };
};

const dispatchAlertChannels = async ({ project, rule, alert }) => {
  const channels = Array.isArray(rule?.channels) ? rule.channels : [];
  if (!channels.length) {
    return [];
  }
  const results = [];
  for (const channel of channels) {
    try {
      const result = await dispatchChannel({ channel, project, rule, alert });
      results.push({ type: channel.type, target: channel.target, result });
    } catch (error) {
      results.push({ type: channel.type, target: channel.target, error: error.message });
    }
  }
  return results;
};

module.exports = {
  dispatchAlertChannels,
  buildChannelPreviews,
  __testing: {
    buildBaseAlertPayload,
    sendGenericWebhook,
    sendSlackNotification,
    sendDiscordNotification,
    sendTeamsNotification,
    postJson,
  },
};
