const logger = require('../utils/logger');
const { getEmailConfig } = require('../config/email');
const TeamMember = require('../models/TeamMember');
const AlertDigestEntry = require('../models/AlertDigestEntry');
const { buildAlertEmail } = require('../templates/alert-email');
const { buildAlertDigestEmail } = require('../templates/alert-digest-email');
const { enqueueEmailJob, isEmailQueueEnabled, isInlineMode } = require('../queues/email-queue');
const { createCircuitBreaker } = require('../utils/circuit-breaker');

const emailCircuit = createCircuitBreaker({ name: 'email-service', logger });

let transportInstance;
let transportConfig;

const requireNodemailer = () => {
  try {
    // eslint-disable-next-line global-require
    return require('nodemailer');
  } catch (error) {
    return null;
  }
};

const ensureConfig = () => {
  if (!transportConfig) {
    transportConfig = getEmailConfig();
  }
  return transportConfig;
};

const buildStubTransport = () => ({
  async sendMail(payload) {
    logger.info({ payload }, 'Email delivery skipped (stub transport)');
    return {
      accepted: Array.isArray(payload.to) ? payload.to : [payload.to],
      rejected: [],
      envelope: { to: payload.to, from: payload.from },
      messageId: `stub-${Date.now()}`,
    };
  },
});

const getTransport = () => {
  if (transportInstance) {
    return transportInstance;
  }

  const config = ensureConfig();
  const nodemailer = requireNodemailer();

  if (!nodemailer) {
    logger.warn('Nodemailer dependency missing – using stub transport');
    transportInstance = buildStubTransport();
    return transportInstance;
  }

  transportInstance = nodemailer.createTransport(config.transport);
  return transportInstance;
};

const normalizeRecipients = (value) => {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : null))
      .filter(Boolean);
  }
  return [];
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parseTimeToMinutes = (value, fallbackMinutes) => {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value.trim())) {
    return fallbackMinutes;
  }
  const [hour, minute] = value.split(':').map((part) => parseInt(part, 10));
  return hour * 60 + minute;
};

const getMinutesForTimezone = (date, timezone = 'UTC') => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((part) => part.type === 'hour');
    const minutePart = parts.find((part) => part.type === 'minute');
    const hour = hourPart ? parseInt(hourPart.value, 10) : 0;
    const minute = minutePart ? parseInt(minutePart.value, 10) : 0;
    return hour * 60 + minute;
  } catch (error) {
    logger.warn({ timezone }, 'Failed to resolve timezone; defaulting to UTC');
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();
    return utcHour * 60 + utcMinute;
  }
};

const normalizeMemberPreferences = (memberDoc) => {
  const preferences = memberDoc?.alertPreferences || {};
  const email = preferences.email || {};
  const quietHours = email.quietHours || {};
  const digest = email.digest || {};

  return {
    email: {
      mode: ['immediate', 'digest', 'disabled'].includes(email.mode) ? email.mode : 'immediate',
      quietHours: {
        enabled: Boolean(quietHours.enabled),
        start: typeof quietHours.start === 'string' && TIME_PATTERN.test(quietHours.start) ? quietHours.start : '22:00',
        end: typeof quietHours.end === 'string' && TIME_PATTERN.test(quietHours.end) ? quietHours.end : '07:00',
        timezone:
          typeof quietHours.timezone === 'string' && quietHours.timezone.trim()
            ? quietHours.timezone.trim()
            : 'UTC',
      },
      digest: {
        cadence: typeof digest.cadence === 'string' && digest.cadence.trim() ? digest.cadence.trim() : 'daily',
        lastSentAt: digest.lastSentAt || null,
      },
      unsubscribeToken: typeof email.unsubscribeToken === 'string' && email.unsubscribeToken.length ? email.unsubscribeToken : null,
    },
  };
};

const isWithinQuietHours = (preferences, date = new Date()) => {
  const quietHours = preferences?.email?.quietHours;
  if (!quietHours?.enabled) {
    return false;
  }

  const timezone = quietHours.timezone || 'UTC';
  const startMinutes = parseTimeToMinutes(quietHours.start, 22 * 60);
  const endMinutes = parseTimeToMinutes(quietHours.end, 7 * 60);
  const currentMinutes = getMinutesForTimezone(date, timezone);

  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
};

const buildUnsubscribeUrl = (config, token, fallback) => {
  if (fallback) {
    return fallback;
  }
  if (!token) {
    return null;
  }
  const base = config.unsubscribeBaseUrl || config.dashboardUrl;
  const trimmed = base.replace(/\/$/, '');
  return `${trimmed}?token=${encodeURIComponent(token)}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const getCadenceWindowMs = (cadence = 'daily') => {
  if (cadence === 'weekly') {
    return 7 * DAY_MS;
  }
  return DAY_MS;
};

const fetchMembersByEmail = async (projectId, recipients = []) => {
  const unique = Array.from(
    new Set(
      recipients
        .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : null))
        .filter(Boolean)
    )
  );

  if (!unique.length) {
    return new Map();
  }

  const members = await TeamMember.find({ projectId, email: { $in: unique } })
    .select('email alertPreferences name')
    .lean();

  const map = new Map();
  members.forEach((member) => {
    if (member.email) {
      map.set(member.email, member);
    }
  });

  return map;
};

const queueDigestAlerts = async ({ projectId, ruleId, alertPayload, members = [] }) => {
  if (!members.length) {
    return [];
  }

  const documents = members.map((member) => ({
    projectId,
    memberId: member._id,
    ruleId: ruleId || null,
    alert: alertPayload,
  }));

  const created = await AlertDigestEntry.insertMany(documents, { ordered: false });
  return created.map((doc) => doc._id.toString());
};

const collectPendingDigestEntries = async ({ projectId, memberId, cadence = 'daily', before }) => {
  const now = before || new Date();
  const lookbackMs = cadence === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const earliest = new Date(now.getTime() - lookbackMs);

  const entries = await AlertDigestEntry.find({
    projectId,
    memberId,
    processed: false,
    createdAt: { $gte: earliest, $lte: now },
  })
    .sort({ createdAt: 1 })
    .lean();

  return entries;
};

const markDigestEntriesProcessed = async (entryIds, processedAt) => {
  if (!Array.isArray(entryIds) || !entryIds.length) {
    return;
  }
  await AlertDigestEntry.updateMany(
    { _id: { $in: entryIds } },
    { $set: { processed: true, processedAt: processedAt || new Date() } }
  );
};

const sendEmail = async ({ to, cc, bcc, subject, html, text, headers }) => {
  const config = ensureConfig();
  const toRecipients = normalizeRecipients(to);

  if (!toRecipients.length) {
    logger.warn({ subject }, 'Missing recipients for email send');
    return { skipped: true, accepted: [], rejected: [] };
  }

  const payload = {
    from: config.from,
    to: toRecipients.join(', '),
    subject: subject || 'Notification',
    html,
    text,
  };

  const ccRecipients = normalizeRecipients(cc);
  const bccRecipients = normalizeRecipients(bcc);
  if (ccRecipients.length) {
    payload.cc = ccRecipients.join(', ');
  }
  if (bccRecipients.length) {
    payload.bcc = bccRecipients.join(', ');
  }
  if (headers && typeof headers === 'object') {
    payload.headers = headers;
  }

  const transport = getTransport();

  try {
    const info = await emailCircuit.execute(() => transport.sendMail(payload));
    const accepted = Array.isArray(info?.accepted) && info.accepted.length ? info.accepted : toRecipients;
    logger.info({ to: toRecipients, subject: payload.subject }, 'Email dispatched');
    return { ...info, accepted };
  } catch (error) {
    logger.error({ err: error, to: toRecipients }, 'Failed to send email');
    throw error;
  }
};

const deliverEmail = async (payload) => {
  if (isEmailQueueEnabled() && !isInlineMode()) {
    try {
      const job = await enqueueEmailJob(payload, { removeOnComplete: true, removeOnFail: false });
      return { queued: true, jobId: job.id };
    } catch (error) {
      logger.error({ err: error }, 'Failed to enqueue email job – falling back to direct send');
    }
  }

  return sendEmail(payload);
};

const collectEmailRecipientsFromRule = (rule, overrides = []) => {
  const ruleRecipients = Array.isArray(rule?.channels)
    ? rule.channels
        .filter((channel) => channel?.type === 'email' && typeof channel.target === 'string')
        .map((channel) => channel.target)
    : [];
  return [...new Set([...ruleRecipients, ...normalizeRecipients(overrides)])];
};

const buildAlertEmailBase = ({ project, rule, alert, links, config: overrides }) => {
  const config = overrides || ensureConfig();

  const baseLinks = {
    dashboardUrl: links?.dashboardUrl || `${config.dashboardUrl}/alerts/${alert?.id || ''}`,
    acknowledgeUrl: links?.acknowledgeUrl || null,
    unsubscribeUrl: links?.unsubscribeUrl || null,
  };

  const baseContext = {
    projectName: project?.name,
    ruleName: rule?.name,
    alertTitle: alert?.title || rule?.name || 'Alert notification',
    summary: alert?.summary,
    severity: alert?.severity || rule?.conditions?.severity || 'info',
    environment: alert?.environment || (Array.isArray(alert?.environments) ? alert.environments.join(', ') : null),
    occurrences: alert?.occurrences,
    affectedUsers: alert?.affectedUsers,
    windowMinutes: alert?.windowMinutes,
    firstDetectedAt: alert?.firstDetectedAt,
    lastDetectedAt: alert?.lastDetectedAt,
    whyItMatters: alert?.whyItMatters,
    nextSteps: Array.isArray(alert?.nextSteps) ? alert.nextSteps : null,
    context: alert?.context || alert?.metadata?.contextualInsights || null,
  };

  return { config, baseLinks, baseContext };
};

const sendAlertEmail = async ({ project, rule, alert, recipients, links }) => {
  const { config, baseLinks, baseContext } = buildAlertEmailBase({ project, rule, alert, links });
  const rawRecipients = collectEmailRecipientsFromRule(rule, recipients);

  if (!rawRecipients.length) {
    logger.warn({ ruleId: rule?._id }, 'Skipping alert email – no email recipients configured');
    return { skipped: true };
  }

  const dedupedRecipients = [];
  const seen = new Set();
  rawRecipients.forEach((recipient) => {
    const normalized = recipient.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    dedupedRecipients.push({ original: recipient, normalized });
  });

  const memberIndex = await fetchMembersByEmail(project._id, dedupedRecipients.map((item) => item.normalized));
  const now = new Date();

  const immediatePlans = [];
  const digestPlans = new Map();
  const skippedPlans = [];

  dedupedRecipients.forEach((entry) => {
    const member = memberIndex.get(entry.normalized) || null;

    if (!member) {
      immediatePlans.push({ email: entry.original, member: null, preferences: null });
      return;
    }

    const preferences = normalizeMemberPreferences(member);
    if (preferences.email.mode === 'disabled') {
      skippedPlans.push({ email: entry.original, reason: 'disabled' });
      return;
    }

    if (preferences.email.mode === 'digest' || isWithinQuietHours(preferences, now)) {
      digestPlans.set(member._id.toString(), { member, preferences, email: entry.original });
      return;
    }

    immediatePlans.push({ email: entry.original, member, preferences });
  });

  const immediateResults = [];
  for (const plan of immediatePlans) {
    const unsubscribeUrl = plan.member
      ? buildUnsubscribeUrl(config, plan.preferences?.email?.unsubscribeToken, baseLinks.unsubscribeUrl)
      : baseLinks.unsubscribeUrl;

    const context = {
      ...baseContext,
      links: {
        ...baseLinks,
        unsubscribeUrl,
      },
    };

    const { subject, html, text } = buildAlertEmail(context);
    const info = await deliverEmail({ to: plan.email, subject, html, text });
    immediateResults.push({ email: plan.email, info });
  }

  const digestMembers = Array.from(digestPlans.values());
  const alertPayload = {
    title: baseContext.alertTitle,
    summary: baseContext.summary || '',
    severity: baseContext.severity || 'info',
    environment: baseContext.environment || 'all',
    occurrences: Number.isFinite(baseContext.occurrences) ? baseContext.occurrences : null,
    affectedUsers: Number.isFinite(baseContext.affectedUsers) ? baseContext.affectedUsers : null,
    windowMinutes: Number.isFinite(baseContext.windowMinutes) ? baseContext.windowMinutes : null,
    lastDetectedAt: alert?.lastDetectedAt ? new Date(alert.lastDetectedAt) : now,
    link: baseLinks.dashboardUrl,
  };

  if (digestMembers.length) {
    try {
      const members = digestMembers.map((entry) => entry.member);
      await queueDigestAlerts({ projectId: project._id, ruleId: rule?._id, alertPayload, members });
      logger.info({ count: digestMembers.length }, 'Queued alerts for digest delivery');
    } catch (error) {
      logger.error({ err: error }, 'Failed to queue digest alerts');
      throw error;
    }
  }

  return {
    immediate: immediateResults,
    queuedForDigest: digestMembers.map((entry) => entry.email),
    skipped: skippedPlans.map((entry) => entry.email),
  };
};

const buildAlertEmailPreview = ({ project, rule, alert, links }) => {
  const { baseLinks, baseContext } = buildAlertEmailBase({ project, rule, alert, links });
  const context = {
    ...baseContext,
    links: baseLinks,
  };

  return buildAlertEmail(context);
};

const sendReportEmail = async ({ project, schedule, run, shareLink }) => {
  if (!schedule?.recipients || !schedule.recipients.length) {
    logger.warn({ scheduleId: schedule?._id?.toString?.() || null }, 'Skipping report email – no recipients');
    return { skipped: true };
  }

  const config = ensureConfig();
  const primaryLink = shareLink || `${config.dashboardUrl}/reports/${run?._id || ''}`;

  const subject = `[${project?.name || 'Project'}] ${schedule?.name || 'Scheduled report'} ready`;
  const text = `Your scheduled report is ready.

Project: ${project?.name || 'Unknown project'}
Schedule: ${schedule?.name || 'Unnamed schedule'}
Format: ${run?.format || 'pdf'}
Status: ${run?.status || 'unknown'}
Download: ${primaryLink}
`;

  const html = `
    <p style="font-size:16px;color:#0f172a;margin:0 0 12px 0;">Hello,</p>
    <p style="font-size:14px;color:#475569;margin:0 0 16px 0;">
      Your scheduled report <strong>${schedule?.name || 'Report'}</strong> for <strong>${project?.name || 'your project'}</strong> is ready.
    </p>
    <ul style="padding-left:16px;font-size:14px;color:#334155;">
      <li>Format: ${run?.format || 'pdf'}</li>
      <li>Status: ${run?.status || 'unknown'}</li>
    </ul>
    <p style="margin:24px 0;">
      <a href="${primaryLink}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600;">Download report</a>
    </p>
  `;

  return deliverEmail({ to: schedule.recipients, subject, html, text });
};

const sendDailyDigestEmails = async ({ project, now = new Date() }) => {
  const config = ensureConfig();
  const pendingMemberIds = await AlertDigestEntry.distinct('memberId', {
    projectId: project._id,
    processed: false,
  });

  if (!pendingMemberIds.length) {
    return [];
  }

  const members = await TeamMember.find({ _id: { $in: pendingMemberIds } })
    .select('email name alertPreferences projectId')
    .lean();

  const results = [];

  for (const member of members) {
    if (!member.email) {
      continue;
    }
    const preferences = normalizeMemberPreferences(member);
    if (preferences.email.mode === 'disabled') {
      const entries = await collectPendingDigestEntries({
        projectId: project._id,
        memberId: member._id,
        cadence: preferences.email.digest.cadence,
        before: now,
      });
      await markDigestEntriesProcessed(entries.map((entry) => entry._id), now);
      continue;
    }

    const cadenceWindowMs = getCadenceWindowMs(preferences.email.digest.cadence);
    const lastSentAt = preferences.email.digest.lastSentAt
      ? new Date(preferences.email.digest.lastSentAt)
      : null;

    if (lastSentAt && now.getTime() - lastSentAt.getTime() < cadenceWindowMs) {
      logger.debug(
        {
          memberId: member._id.toString(),
          cadence: preferences.email.digest.cadence,
          lastSentAt,
        },
        'Skipping digest delivery – cadence window not elapsed'
      );
      continue;
    }

    const entries = await collectPendingDigestEntries({
      projectId: project._id,
      memberId: member._id,
      cadence: preferences.email.digest.cadence,
      before: now,
    });

    if (!entries.length) {
      continue;
    }

    const context = {
      projectName: project?.name,
      alerts: entries.map((entry) => ({
        title: entry.alert?.title || 'Alert',
        summary: entry.alert?.summary || '',
        severity: entry.alert?.severity || 'info',
        environment: entry.alert?.environment || 'all',
        occurrences: entry.alert?.occurrences,
        lastDetectedAt: entry.alert?.lastDetectedAt,
        link: entry.alert?.link || `${config.dashboardUrl}/alerts`,
      })),
      dashboardUrl: `${config.dashboardUrl}/alerts`,
      unsubscribeUrl: buildUnsubscribeUrl(config, preferences.email.unsubscribeToken, null),
    };

    const { subject, html, text } = buildAlertDigestEmail(context);
    const info = await deliverEmail({ to: member.email, subject, html, text });

    await markDigestEntriesProcessed(entries.map((entry) => entry._id), now);

    await TeamMember.updateOne(
      { _id: member._id },
      { $set: { 'alertPreferences.email.digest.lastSentAt': now, 'alertPreferences.email.updatedAt': now } }
    );

    results.push({ memberId: member._id.toString(), delivered: true, count: entries.length, info });
  }

  return results;
};

const sendTestEmail = async ({ to, subject = 'Alert system test email', message = 'This is a test from the alerting system.' }) => {
  const { dashboardUrl } = ensureConfig();
  const html = `
    <p style="font-size:16px;color:#0f172a;">Alerting system test</p>
    <p style="font-size:14px;color:#475569;">${message}</p>
    <p style="font-size:14px;color:#475569;">Return to dashboard: <a href="${dashboardUrl}">${dashboardUrl}</a></p>
  `;
  const text = `${message}\nDashboard: ${dashboardUrl}`;
  return deliverEmail({ to, subject, html, text });
};

module.exports = {
  sendAlertEmail,
  sendReportEmail,
  sendTestEmail,
  sendDailyDigestEmails,
  buildAlertEmailPreview,
  __testing: {
    ensureConfig,
    getTransport,
    normalizeRecipients,
    sendEmailDirect: sendEmail,
    deliverEmail,
  },
};
