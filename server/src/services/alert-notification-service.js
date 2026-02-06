const crypto = require('crypto');
const logger = require('../utils/logger');
const { dispatchAlertChannels } = require('./alert-channel-service');
const alertState = require('./alert-state-service');

const MS_IN_MINUTE = 60 * 1000;

const severityPriority = new Map([
  ['critical', 5],
  ['high', 4],
  ['medium', 3],
  ['low', 2],
  ['info', 1],
]);

const generateId = () =>
  (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(18).toString('hex'));

const config = {
  aggregationWindowMs: Number(process.env.ALERT_AGGREGATION_WINDOW_MS || 5 * MS_IN_MINUTE),
  defaultCooldownMinutes: Number(process.env.ALERT_COOLDOWN_MINUTES || 30),
  defaultEscalationMinutes: Number(process.env.ALERT_ESCALATION_MINUTES || 120),
};

const cooldownState = new Map(); // ruleId -> timestamp (ms)
const aggregationBuckets = new Map(); // ruleId -> bucket state
const escalationEntries = new Map(); // alertId -> escalation state

const serializeEscalationLevel = (level) => ({
  name: level.name,
  afterMinutes: level.afterMinutes,
  channels: level.channels,
  triggerAt: level.triggerAt instanceof Date ? level.triggerAt.toISOString() : level.triggerAt,
});

const deserializeEscalationLevel = (level) => {
  if (!level) {
    return null;
  }
  return {
    name: level.name || null,
    afterMinutes: typeof level.afterMinutes === 'number' ? level.afterMinutes : Number(level.afterMinutes) || null,
    channels: Array.isArray(level.channels) ? level.channels : [],
    triggerAt: level.triggerAt ? new Date(level.triggerAt) : null,
  };
};

const serializeEscalationEntry = (entry) => ({
  id: entry.id,
  project: entry.project,
  rule: entry.rule,
  alert: entry.alert,
  sentAt: entry.sentAt instanceof Date ? entry.sentAt.toISOString() : entry.sentAt,
  acknowledged: Boolean(entry.acknowledged),
  resolved: Boolean(entry.resolved),
  pendingLevels: Array.isArray(entry.pendingLevels) ? entry.pendingLevels.map(serializeEscalationLevel) : [],
  currentLevel: entry.currentLevel ? serializeEscalationLevel(entry.currentLevel) : null,
});

const deserializeEscalationEntry = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const pendingLevels = Array.isArray(snapshot.pendingLevels)
    ? snapshot.pendingLevels
        .map(deserializeEscalationLevel)
        .filter((level) => level && level.triggerAt instanceof Date && !Number.isNaN(level.triggerAt.getTime()))
    : [];

  const currentLevel = deserializeEscalationLevel(snapshot.currentLevel);

  return {
    id: snapshot.id,
    project: snapshot.project,
    rule: snapshot.rule,
    alert: snapshot.alert,
    sentAt: snapshot.sentAt ? new Date(snapshot.sentAt) : new Date(),
    acknowledged: Boolean(snapshot.acknowledged),
    resolved: Boolean(snapshot.resolved),
    pendingLevels,
    currentLevel: currentLevel && currentLevel.triggerAt ? currentLevel : null,
    timer: null,
  };
};

const persistEscalationEntry = async (entry) => {
  try {
    await alertState.saveEscalation(serializeEscalationEntry(entry));
  } catch (error) {
    logger.error({ err: error, alertId: entry.id }, 'Failed to persist escalation entry');
  }
};

const removeEscalationEntry = async (alertId) => {
  try {
    await alertState.deleteEscalation(alertId);
  } catch (error) {
    logger.error({ err: error, alertId }, 'Failed to delete escalation entry from store');
  }
};

const sanitizeNumber = (value, fallback) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  return fallback;
};

const ensurePositiveMs = (value, fallback) => {
  const numeric = sanitizeNumber(value, fallback);
  return Math.max(0, numeric);
};

const updateConfig = (overrides = {}) => {
  if (overrides.aggregationWindowMs !== undefined) {
    config.aggregationWindowMs = ensurePositiveMs(overrides.aggregationWindowMs, config.aggregationWindowMs);
  }
  if (overrides.defaultCooldownMinutes !== undefined) {
    config.defaultCooldownMinutes = Math.max(0, sanitizeNumber(overrides.defaultCooldownMinutes, config.defaultCooldownMinutes));
  }
  if (overrides.defaultEscalationMinutes !== undefined) {
    config.defaultEscalationMinutes = Math.max(0, sanitizeNumber(overrides.defaultEscalationMinutes, config.defaultEscalationMinutes));
  }
};

const toJsonSafeCopy = (value) => {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
};

const normalizeId = (input) => {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'object') {
    if (typeof input.toString === 'function' && input.toString() !== '[object Object]') {
      return input.toString();
    }
    if (input._id) {
      return normalizeId(input._id);
    }
    if (input.id) {
      return normalizeId(input.id);
    }
  }
  return String(input);
};

const snapshotProject = (project = {}) => ({
  id: normalizeId(project._id || project.id),
  name: project.name || 'Project',
});

const snapshotChannel = (channel) => ({
  type: String(channel.type).toLowerCase(),
  target: channel.target,
});

const snapshotRule = (rule = {}) => ({
  id: normalizeId(rule._id || rule.id),
  name: rule.name || 'Alert rule',
  type: rule.type || null,
  cooldownMinutes: rule.cooldownMinutes != null ? Number(rule.cooldownMinutes) : null,
  channels: Array.isArray(rule.channels) ? rule.channels.map(snapshotChannel) : [],
  escalation: {
    enabled: Boolean(rule?.escalation?.enabled),
    channels: Array.isArray(rule?.escalation?.channels)
      ? rule.escalation.channels.map(snapshotChannel)
      : [],
    levels: Array.isArray(rule?.escalation?.levels)
      ? rule.escalation.levels
          .filter((level) => level && typeof level.afterMinutes === 'number' && level.afterMinutes > 0)
          .map((level) => ({
            name: level.name || null,
            afterMinutes: Number(level.afterMinutes),
            channels: Array.isArray(level.channels) ? level.channels.map(snapshotChannel) : [],
          }))
      : [],
  },
});

const snapshotAlert = (alert = {}) => ({
  id: normalizeId(alert.id || alert._id),
  title: alert.title || 'Alert',
  summary: alert.summary || '',
  severity: alert.severity || 'info',
  environment: alert.environment || alert.environments || null,
  occurrences: alert.occurrences != null ? Number(alert.occurrences) : null,
  affectedUsers: alert.affectedUsers != null ? Number(alert.affectedUsers) : null,
  windowMinutes: alert.windowMinutes != null ? Number(alert.windowMinutes) : null,
  firstDetectedAt: alert.firstDetectedAt || null,
  lastDetectedAt: alert.lastDetectedAt || null,
  fingerprint: alert.fingerprint || null,
  metadata: toJsonSafeCopy(alert.metadata || {}),
  links: toJsonSafeCopy(alert.links || {}),
});

const getCooldownMs = (rule) => {
  const minutes = rule?.cooldownMinutes != null ? Number(rule.cooldownMinutes) : config.defaultCooldownMinutes;
  return Math.max(0, minutes) * MS_IN_MINUTE;
};

const recordCooldown = async (ruleId, timestamp) => {
  const value = timestamp.getTime();
  cooldownState.set(ruleId, value);
  try {
    await alertState.saveCooldown(ruleId, value);
  } catch (error) {
    logger.error({ err: error, ruleId }, 'Failed to persist cooldown state');
  }
};

const isInCooldown = (ruleId, timestamp, cooldownMs) => {
  if (!cooldownMs) {
    return false;
  }
  const last = cooldownState.get(ruleId);
  if (!last) {
    return false;
  }
  return timestamp.getTime() - last < cooldownMs;
};

const highestSeverity = (alerts) => {
  let current = 'info';
  let currentRank = 0;
  alerts.forEach((alert) => {
    const severity = typeof alert.severity === 'string' ? alert.severity.toLowerCase() : 'info';
    const rank = severityPriority.get(severity) || 0;
    if (rank > currentRank) {
      currentRank = rank;
      current = severity;
    }
  });
  return current;
};

const collectEnvironments = (alerts) => {
  const set = new Set();
  alerts.forEach((alert) => {
    const { environment } = alert;
    if (Array.isArray(environment)) {
      environment.forEach((value) => set.add(value));
    } else if (environment) {
      set.add(environment);
    }
  });
  return Array.from(set);
};

const sumOccurrences = (alerts) =>
  alerts.reduce((total, alert) => (Number.isFinite(alert.occurrences) ? total + Number(alert.occurrences) : total), 0);

const sumAffectedUsers = (alerts) =>
  alerts.reduce((total, alert) => (Number.isFinite(alert.affectedUsers) ? total + Number(alert.affectedUsers) : total), 0);

const bucketKey = (rule) => {
  const id = normalizeId(rule?._id || rule?.id);
  if (!id) {
    throw new Error('Alert rule must have an identifier');
  }
  return id;
};

const buildAggregatedAlert = (bucket, now) => {
  const alerts = bucket.alerts.map((item) => snapshotAlert(item));
  const count = alerts.length;
  const severity = highestSeverity(alerts);
  const environments = collectEnvironments(alerts);
  const occurrences = sumOccurrences(alerts);
  const affectedUsers = sumAffectedUsers(alerts);
  const firstDetected = alerts.reduce((acc, alert) => {
    const candidate = alert.firstDetectedAt || alert.lastDetectedAt;
    if (!candidate) {
      return acc;
    }
    const candidateTime = new Date(candidate).getTime();
    if (!Number.isFinite(candidateTime)) {
      return acc;
    }
    if (acc === null || candidateTime < acc) {
      return candidateTime;
    }
    return acc;
  }, null);
  const lastDetected = alerts.reduce((acc, alert) => {
    const candidate = alert.lastDetectedAt || alert.firstDetectedAt;
    if (!candidate) {
      return acc;
    }
    const candidateTime = new Date(candidate).getTime();
    if (!Number.isFinite(candidateTime)) {
      return acc;
    }
    if (acc === null || candidateTime > acc) {
      return candidateTime;
    }
    return acc;
  }, null);

  const windowMs = now.getTime() - bucket.startedAt.getTime();
  const windowMinutes = Math.max(1, Math.round(windowMs / MS_IN_MINUTE));
  const formattedStart = new Date(bucket.startedAt).toUTCString();
  const formattedEnd = now.toUTCString();

  const firstAlert = alerts[0];

  if (count === 1) {
    const single = { ...firstAlert };
    single.metadata = {
      ...single.metadata,
      aggregation: {
        aggregated: false,
        count: 1,
        windowMinutes,
        startedAt: bucket.startedAt,
        endedAt: now,
      },
    };
    return single;
  }

  return {
    id: `agg-${bucket.rule.id}-${now.getTime()}`,
    title: `${count} alerts triggered for ${bucket.rule.name}`,
    summary: `${count} alerts detected between ${formattedStart} and ${formattedEnd}.`,
    severity,
    environment: environments.length ? environments : firstAlert.environment,
    occurrences: occurrences || null,
    affectedUsers: affectedUsers || null,
    windowMinutes,
    firstDetectedAt: firstDetected ? new Date(firstDetected).toISOString() : bucket.startedAt.toISOString(),
    lastDetectedAt: lastDetected ? new Date(lastDetected).toISOString() : now.toISOString(),
    metadata: {
      aggregated: true,
      aggregation: {
        count,
        windowMinutes,
        startedAt: bucket.startedAt,
        endedAt: now,
        sample: alerts.slice(0, 10).map((alert) => ({
          id: alert.id,
          title: alert.title,
          severity: alert.severity,
          environment: alert.environment,
          occurrences: alert.occurrences,
          lastDetectedAt: alert.lastDetectedAt,
        })),
      },
    },
    links: firstAlert.links || {},
  };
};

const clearBucketTimer = (bucket) => {
  if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = null;
  }
};

const scheduleBucketFlush = (key, bucket, delayMs) => {
  clearBucketTimer(bucket);
  const timeout = setTimeout(() => {
    flushBucket(key).catch((error) => {
      logger.error({ err: error, ruleId: key }, 'Failed to flush alert aggregation bucket');
    });
  }, Math.max(delayMs, 10));
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }
  bucket.timer = timeout;
};

const ensureBucket = ({ project, rule, now }) => {
  const key = bucketKey(rule);
  let bucket = aggregationBuckets.get(key);
  if (!bucket) {
    bucket = {
      project: snapshotProject(project),
      rule: snapshotRule(rule),
      alerts: [],
      startedAt: now,
      timer: null,
    };
    aggregationBuckets.set(key, bucket);
  }
  return { key, bucket };
};

const queueAggregation = ({ project, rule, alert, now }) => {
  const { key, bucket } = ensureBucket({ project, rule, now });
  bucket.alerts.push(snapshotAlert(alert));

  if (!bucket.timer) {
    const delay = config.aggregationWindowMs > 0 ? config.aggregationWindowMs : 0;
    if (delay === 0) {
      return flushBucket(key).catch((error) => {
        logger.error({ err: error, ruleId: key }, 'Failed immediate alert flush');
      });
    }
    scheduleBucketFlush(key, bucket, delay);
  }
  return Promise.resolve();
};

const getEscalationLevels = (rule, sendTime) => {
  const normalizedRule = snapshotRule(rule);
  if (!normalizedRule.escalation.enabled) {
    return [];
  }
  const levels = [...normalizedRule.escalation.levels];
  if (!levels.length) {
    levels.push({
      name: 'Manager escalation',
      afterMinutes: config.defaultEscalationMinutes,
      channels: normalizedRule.escalation.channels.length ? normalizedRule.escalation.channels : [],
    });
  }

  return levels
    .map((level, index) => ({
      name: level.name || `Level ${index + 1}`,
      afterMinutes: Math.max(0.01, Number(level.afterMinutes)),
      channels: Array.isArray(level.channels) && level.channels.length
        ? level.channels.map(snapshotChannel)
        : normalizedRule.escalation.channels.map(snapshotChannel),
    }))
    .sort((a, b) => a.afterMinutes - b.afterMinutes)
    .map((level) => ({
      ...level,
      triggerAt: new Date(sendTime.getTime() + level.afterMinutes * MS_IN_MINUTE),
    }));
};

const clearEscalationTimers = (entry) => {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
};

const scheduleNextEscalation = async (entry) => {
  clearEscalationTimers(entry);

  if (!entry.currentLevel) {
    if (!entry.pendingLevels.length) {
      escalationEntries.delete(entry.id);
      await removeEscalationEntry(entry.id);
      return;
    }
    entry.currentLevel = entry.pendingLevels.shift();
  }

  const triggerAt = entry.currentLevel?.triggerAt instanceof Date ? entry.currentLevel.triggerAt : new Date();
  const now = new Date();
  const delay = Math.max(triggerAt.getTime() - now.getTime(), 0);

  const scheduleEscalation = () => {
    escalateAlert(entry.id).catch((error) => {
      logger.error({ err: error, alertId: entry.id }, 'Alert escalation failed');
    });
  };

  if (delay <= 0) {
    setTimeout(scheduleEscalation, 10);
  } else {
    entry.timer = setTimeout(scheduleEscalation, Math.max(delay, 10));
    if (typeof entry.timer.unref === 'function') {
      entry.timer.unref();
    }
  }

  await persistEscalationEntry(entry);
};

const scheduleEscalationsIfNeeded = async ({ project, rule, alert, sentAt }) => {
  const levels = getEscalationLevels(rule, sentAt);
  if (!levels.length) {
    await removeEscalationEntry(alert.id);
    return;
  }
  const entry = {
    id: alert.id,
    project: snapshotProject(project),
    rule: snapshotRule(rule),
    alert: snapshotAlert(alert),
    sentAt,
    acknowledged: false,
    resolved: false,
    pendingLevels: levels,
    timer: null,
    currentLevel: null,
  };
  escalationEntries.set(entry.id, entry);
  await scheduleNextEscalation(entry);
};

const dispatchAlert = async ({ project, rule, alert, now }) => {
  const ruleId = bucketKey(rule);
  const cooldownMs = getCooldownMs(rule);
  const alertId = alert.id || generateId();
  alert.id = alertId;

  await dispatchAlertChannels({ project, rule, alert });
  await recordCooldown(ruleId, now);
  await scheduleEscalationsIfNeeded({ project, rule, alert, sentAt: now });

  logger.info({ ruleId, alertId }, 'Alert dispatch completed');
  return alertId;
};

const flushBucket = async (key) => {
  const bucket = aggregationBuckets.get(key);
  if (!bucket) {
    return null;
  }
  clearBucketTimer(bucket);

  const now = new Date();
  const cooldownMs = getCooldownMs(bucket.rule);
  if (isInCooldown(key, now, cooldownMs)) {
    const last = cooldownState.get(key);
    const remaining = cooldownMs - (now.getTime() - last);
    scheduleBucketFlush(key, bucket, Math.max(remaining, config.aggregationWindowMs));
    return null;
  }

  const aggregatedAlert = buildAggregatedAlert(bucket, now);
  try {
    await dispatchAlert({ project: bucket.project, rule: bucket.rule, alert: aggregatedAlert, now });
    aggregationBuckets.delete(key);
    return aggregatedAlert;
  } catch (error) {
    logger.error({ err: error, ruleId: key }, 'Failed to dispatch aggregated alert, scheduling retry');
    const retryDelay = Math.max(config.aggregationWindowMs || 0, 1000);
    scheduleBucketFlush(key, bucket, retryDelay);
    throw error;
  }
};

const processTriggeredAlert = async ({ project, rule, alert, now = new Date() }) => {
  await queueAggregation({ project, rule, alert, now });
  return { queued: true };
};

const acknowledgeAlert = async (alertId) => {
  const entry = escalationEntries.get(alertId);
  if (!entry) {
    return false;
  }
  entry.acknowledged = true;
  clearEscalationTimers(entry);
  escalationEntries.delete(alertId);
  await removeEscalationEntry(alertId);
  return true;
};

const resolveAlert = async (alertId) => {
  const entry = escalationEntries.get(alertId);
  if (!entry) {
    return false;
  }
  entry.resolved = true;
  clearEscalationTimers(entry);
  escalationEntries.delete(alertId);
  await removeEscalationEntry(alertId);
  return true;
};

const buildEscalationAlertPayload = (entry) => {
  const level = entry.currentLevel;
  const minutes = level.afterMinutes;
  const alert = {
    id: `${entry.alert.id}-escalation-${minutes}`,
    title: `Escalation: ${entry.alert.title}`,
    summary: `Alert unresolved for ${minutes} minutes.`,
    severity: 'critical',
    environment: entry.alert.environment,
    occurrences: entry.alert.occurrences,
    affectedUsers: entry.alert.affectedUsers,
    metadata: {
      escalation: true,
      originalAlertId: entry.alert.id,
      levelName: level.name,
      afterMinutes: minutes,
    },
    links: entry.alert.links,
  };
  return alert;
};

const escalateAlert = async (alertId) => {
  const entry = escalationEntries.get(alertId);
  if (!entry || entry.acknowledged || entry.resolved) {
    escalationEntries.delete(alertId);
    if (entry) {
      clearEscalationTimers(entry);
    }
    await removeEscalationEntry(alertId);
    return false;
  }

  const level = entry.currentLevel;
  if (!level) {
    await scheduleNextEscalation(entry);
    return false;
  }
  const escalationAlert = buildEscalationAlertPayload(entry);
  const ruleForEscalation = {
    ...entry.rule,
    channels: level.channels.length ? level.channels : entry.rule.channels,
  };

  await dispatchAlertChannels({ project: entry.project, rule: ruleForEscalation, alert: escalationAlert });
  logger.warn({ alertId: entry.alert.id, level: level.name }, 'Escalation notification dispatched');

  entry.currentLevel = null;
  await scheduleNextEscalation(entry);
  return true;
};

const resetState = async () => {
  cooldownState.clear();
  aggregationBuckets.forEach((bucket) => clearBucketTimer(bucket));
  aggregationBuckets.clear();
  escalationEntries.forEach((entry) => clearEscalationTimers(entry));
  escalationEntries.clear();
  await alertState.clearAll();
};

const initializeAlertNotifications = async () => {
  try {
    const [cooldowns, escalations] = await Promise.all([
      alertState.listCooldowns(),
      alertState.listEscalations(),
    ]);

    cooldownState.clear();
    (cooldowns || []).forEach((entry) => {
      if (entry && entry.timestampMs != null) {
        cooldownState.set(String(entry.key), Number(entry.timestampMs));
      }
    });

    escalationEntries.forEach((entry) => clearEscalationTimers(entry));
    escalationEntries.clear();

    const resumableEntries = [];

    for (const snapshot of escalations || []) {
      const entry = deserializeEscalationEntry(snapshot);
      if (!entry || !entry.id) {
        if (snapshot?.id) {
          await removeEscalationEntry(snapshot.id);
        }
        continue;
      }
      if (entry.acknowledged || entry.resolved) {
        await removeEscalationEntry(entry.id);
        continue;
      }
      escalationEntries.set(entry.id, entry);
      resumableEntries.push(entry);
    }

    for (const entry of resumableEntries) {
      await scheduleNextEscalation(entry);
    }
    if (resumableEntries.length || cooldownState.size) {
      logger.info(
        {
          resumedEscalations: resumableEntries.length,
          cachedCooldowns: cooldownState.size,
        },
        'Alert notification state restored'
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize alert notification state');
  }
};

module.exports = {
  processTriggeredAlert,
  acknowledgeAlert,
  resolveAlert,
  configureAlertNotifications: updateConfig,
  initializeAlertNotifications,
  __testing: {
    resetState,
    flushBucket,
    aggregationBuckets,
    escalationEntries,
    cooldownState,
    buildAggregatedAlert,
    dispatchAlert,
    scheduleEscalationsIfNeeded,
    buildEscalationAlertPayload,
  },
};
