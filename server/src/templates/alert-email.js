const formatDateTime = (value) => {
  if (!value) {
    return 'Unknown time';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toUTCString();
};

const escapeHtml = (unsafe = '') =>
  String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const bullet = (label, value) => `
  <tr>
    <td style="padding:4px 0;color:#64748b;font-size:14px;width:160px;vertical-align:top;">${label}</td>
    <td style="padding:4px 0;color:#0f172a;font-size:14px;">${value}</td>
  </tr>`;

const buildActionButton = (href, label, background = '#2563eb') => {
  if (!href) {
    return '';
  }
  return `
    <a href="${href}" style="display:inline-block;padding:12px 20px;margin-right:12px;margin-top:16px;border-radius:10px;background:${background};color:#ffffff;text-decoration:none;font-weight:600;">
      ${label}
    </a>
  `;
};

const buildHtmlBody = (context) => {
  const {
    projectName,
    alertTitle,
    summary,
    severity,
    environment,
    occurrences,
    affectedUsers,
    firstDetectedAt,
    lastDetectedAt,
    windowMinutes,
    links = {},
    ruleName,
    whyItMatters,
    nextSteps,
    context: contextualInsights = {},
  } = context;

  const insights = contextualInsights && typeof contextualInsights === 'object' ? contextualInsights : {};

  const detailRows = [
    bullet('Project', escapeHtml(projectName || '—')),
    bullet('Rule', escapeHtml(ruleName || '—')),
    bullet('Severity', escapeHtml((severity || 'info').toString().toUpperCase())),
    bullet('Environment', escapeHtml(environment || 'All')),
    bullet('Occurrences', escapeHtml(typeof occurrences === 'number' ? occurrences.toString() : 'Unknown')),
    bullet('Affected users', escapeHtml(affectedUsers != null ? affectedUsers.toString() : 'Unknown')),
    bullet('Window', escapeHtml(windowMinutes ? `${windowMinutes} minutes` : 'Rolling window')),
    bullet('First detected', escapeHtml(formatDateTime(firstDetectedAt))),
    bullet('Last detected', escapeHtml(formatDateTime(lastDetectedAt))),
  ].join('');

  const contextSections = [];
  if (whyItMatters) {
    contextSections.push(`
      <div style="margin-top:24px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#0f172a;">Why this matters</h3>
        <p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">${escapeHtml(whyItMatters)}</p>
      </div>
    `);
  }

  const deploymentItems = Array.isArray(insights.recentDeployments)
    ? insights.recentDeployments
    : [];
  if (deploymentItems.length) {
    const deploymentsList = deploymentItems
      .map((deployment) => {
        const when = formatDateTime(deployment.timestamp);
        return `<li style="margin:4px 0;">${escapeHtml(deployment.label || 'Deployment')} — ${escapeHtml(when)}</li>`;
      })
      .join('');
    contextSections.push(`
      <div style="margin-top:24px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#0f172a;">Recent deployments</h3>
        <ul style="padding-left:20px;margin:0;color:#334155;font-size:14px;">${deploymentsList}</ul>
      </div>
    `);
  }

  const incidentItems = Array.isArray(insights.similarIncidents)
    ? insights.similarIncidents
    : [];
  if (incidentItems.length) {
    const incidentsList = incidentItems
      .map((incident) => {
        const when = formatDateTime(incident.lastSeen);
        return `<li style="margin:4px 0;">${escapeHtml(incident.message || 'Incident')} — last seen ${escapeHtml(when)}</li>`;
      })
      .join('');
    contextSections.push(`
      <div style="margin-top:24px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#0f172a;">Similar incidents</h3>
        <ul style="padding-left:20px;margin:0;color:#334155;font-size:14px;">${incidentsList}</ul>
      </div>
    `);
  }

  const steps = Array.isArray(nextSteps) && nextSteps.length ? nextSteps : insights.suggestedFixes;
  if (Array.isArray(steps) && steps.length) {
    const stepsList = steps
      .map((step) => `<li style="margin:4px 0;">${escapeHtml(step)}</li>`)
      .join('');
    contextSections.push(`
      <div style="margin-top:24px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#0f172a;">Next steps</h3>
        <ol style="padding-left:20px;margin:0;color:#334155;font-size:14px;">${stepsList}</ol>
      </div>
    `);
  }

  const acknowledgeButton = buildActionButton(links.acknowledgeUrl, 'Acknowledge Alert', '#16a34a');
  const investigateButton = buildActionButton(links.dashboardUrl, 'Open in Dashboard');
  const unsubscribeLink = links.unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#94a3b8;">If you no longer wish to receive these alerts, you can <a style="color:#2563eb;" href="${links.unsubscribeUrl}">unsubscribe here</a>.</p>`
    : '';

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
      <tr>
        <td>
          <table cellpadding="0" cellspacing="0" align="center" style="width:600px;max-width:90%;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 20px 45px -24px rgba(15,23,42,0.4);overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 24px 32px;background:#0f172a;color:#ffffff;">
                <h1 style="margin:0;font-size:24px;">${escapeHtml(alertTitle)}</h1>
                <p style="margin:12px 0 0;font-size:14px;color:#cbd5f5;">${escapeHtml(summary || 'An alert from your monitoring workspace.')}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 16px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${detailRows}
                </table>
                ${contextSections.join('')}
                <div style="margin-top:24px;">
                  ${investigateButton}
                  ${acknowledgeButton}
                </div>
                ${unsubscribeLink}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
};

const buildTextBody = (context) => {
  const {
    projectName,
    ruleName,
    alertTitle,
    summary,
    severity,
    environment,
    occurrences,
    affectedUsers,
    windowMinutes,
    firstDetectedAt,
    lastDetectedAt,
    links = {},
    whyItMatters,
    nextSteps,
    context: contextualInsights = {},
  } = context;

  const insights = contextualInsights && typeof contextualInsights === 'object' ? contextualInsights : {};

  const lines = [
    `Alert: ${alertTitle}`,
    `Project: ${projectName || 'Unknown project'}`,
    `Rule: ${ruleName || '—'}`,
    `Severity: ${(severity || 'info').toString().toUpperCase()}`,
    `Environment: ${environment || 'All'}`,
    `Occurrences: ${occurrences != null ? occurrences : 'Unknown'}`,
    `Affected users: ${affectedUsers != null ? affectedUsers : 'Unknown'}`,
    `Window: ${windowMinutes ? `${windowMinutes} minutes` : 'Rolling window'}`,
    `First detected: ${formatDateTime(firstDetectedAt)}`,
    `Last detected: ${formatDateTime(lastDetectedAt)}`,
    '',
    summary || 'Investigate the issue in your dashboard.',
  ];

  if (whyItMatters) {
    lines.push('', `Why this matters: ${whyItMatters}`);
  }

  const deploymentItems = Array.isArray(insights.recentDeployments)
    ? insights.recentDeployments
    : [];
  if (deploymentItems.length) {
    lines.push('', 'Recent deployments:');
    deploymentItems.forEach((deployment) => {
      const when = formatDateTime(deployment.timestamp);
      lines.push(`  - ${deployment.label || 'Deployment'} — ${when}`);
    });
  }

  const incidentItems = Array.isArray(insights.similarIncidents)
    ? insights.similarIncidents
    : [];
  if (incidentItems.length) {
    lines.push('', 'Similar incidents:');
    incidentItems.forEach((incident) => {
      const when = formatDateTime(incident.lastSeen);
      lines.push(`  - ${incident.message || 'Incident'} — last seen ${when}`);
    });
  }

  const steps = Array.isArray(nextSteps) && nextSteps.length ? nextSteps : insights.suggestedFixes;
  if (Array.isArray(steps) && steps.length) {
    lines.push('', 'Next steps:');
    steps.forEach((step, idx) => {
      lines.push(`  ${idx + 1}. ${step}`);
    });
  }

  if (links.dashboardUrl) {
    lines.push(`Dashboard: ${links.dashboardUrl}`);
  }
  if (links.acknowledgeUrl) {
    lines.push(`Acknowledge: ${links.acknowledgeUrl}`);
  }
  if (links.unsubscribeUrl) {
    lines.push(`Unsubscribe: ${links.unsubscribeUrl}`);
  }

  return lines.join('\n');
};

const buildSubject = (context) => {
  const parts = [];
  if (context.projectName) {
    parts.push(`[${context.projectName}]`);
  }
  parts.push(context.alertTitle || 'Alert Notification');
  if (context.environment) {
    parts.push(`(${context.environment})`);
  }
  return parts.join(' ');
};

const buildAlertEmail = (context) => {
  const subject = buildSubject(context);
  const html = buildHtmlBody(context);
  const text = buildTextBody(context);

  return { subject, html, text };
};

module.exports = {
  buildAlertEmail,
};
