const escapeHtml = (unsafe = '') =>
  String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatTimestamp = (value) => {
  if (!value) {
    return 'Unknown time';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toUTCString();
};

const buildHtml = (context) => {
  const { projectName, alerts = [], unsubscribeUrl, dashboardUrl } = context;

  const alertItems = alerts
    .map(
      (alert) => `
        <li style="margin-bottom:16px;padding:16px;border-radius:12px;background:#f1f5f9;list-style:none;">
          <h3 style="margin:0 0 8px 0;font-size:16px;color:#0f172a;">${escapeHtml(alert.title || 'Alert')}</h3>
          <p style="margin:0 0 8px 0;font-size:14px;color:#475569;">${escapeHtml(alert.summary || '')}</p>
          <p style="margin:0;font-size:13px;color:#64748b;">
            Severity: <strong>${escapeHtml((alert.severity || 'info').toUpperCase())}</strong>
            &bull; Environment: <strong>${escapeHtml(alert.environment || 'All')}</strong>
            &bull; Occurrences: <strong>${escapeHtml(alert.occurrences != null ? alert.occurrences : 'Unknown')}</strong>
          </p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#94a3b8;">Last seen: ${escapeHtml(formatTimestamp(alert.lastDetectedAt))}</p>
          ${alert.link ? `<p style="margin:12px 0 0 0;"><a style="color:#2563eb;font-weight:600;" href="${alert.link}">View in dashboard</a></p>` : ''}
        </li>`
    )
    .join('');

  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#94a3b8;">Manage your alert preferences or unsubscribe <a style="color:#2563eb;" href="${unsubscribeUrl}">here</a>.</p>`
    : '';

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
      <tr>
        <td>
          <table cellpadding="0" cellspacing="0" align="center" style="width:640px;max-width:90%;margin:0 auto;background:#ffffff;border-radius:18px;box-shadow:0 24px 48px -28px rgba(15,23,42,0.4);overflow:hidden;">
            <tr>
              <td style="padding:32px;background:#0f172a;color:#ffffff;">
                <h1 style="margin:0;font-size:24px;">Daily alert digest</h1>
                <p style="margin:12px 0 0;font-size:14px;color:#cbd5f5;">${escapeHtml(projectName || 'Your project')} – ${alerts.length} alerts</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0 0 16px 0;font-size:14px;color:#475569;">Here is a summary of alerts detected in the last 24 hours.</p>
                <ul style="padding:0;margin:0;">${alertItems}</ul>
                <p style="margin:24px 0 0 0;font-size:14px;color:#475569;">Visit the <a style="color:#2563eb;font-weight:600;" href="${dashboardUrl}">alert dashboard</a> for detailed insights.</p>
                ${unsubscribeBlock}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
};

const buildText = (context) => {
  const { projectName, alerts = [], dashboardUrl, unsubscribeUrl } = context;
  const lines = [`${projectName || 'Your project'} – Daily alert digest`, ''];

  alerts.forEach((alert, index) => {
    lines.push(`${index + 1}. ${alert.title || 'Alert'}`);
    if (alert.summary) {
      lines.push(`   ${alert.summary}`);
    }
    lines.push(`   Severity: ${(alert.severity || 'info').toUpperCase()} | Environment: ${alert.environment || 'All'}`);
    lines.push(`   Occurrences: ${alert.occurrences != null ? alert.occurrences : 'Unknown'} | Last seen: ${formatTimestamp(alert.lastDetectedAt)}`);
    if (alert.link) {
      lines.push(`   Dashboard: ${alert.link}`);
    }
    lines.push('');
  });

  lines.push(`Dashboard: ${dashboardUrl}`);
  if (unsubscribeUrl) {
    lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  }

  return lines.join('\n');
};

const buildSubject = (context) => {
  const count = Array.isArray(context.alerts) ? context.alerts.length : 0;
  return `[${context.projectName || 'Project'}] ${count} alert${count === 1 ? '' : 's'} in daily digest`;
};

const buildAlertDigestEmail = (context) => {
  const subject = buildSubject(context);
  const html = buildHtml(context);
  const text = buildText(context);
  return { subject, html, text };
};

module.exports = {
  buildAlertDigestEmail,
};
