const mongoose = require('mongoose');
const AlertRule = require('../models/AlertRule');
const { evaluateRule } = require('./alert-evaluation-service');
const { buildAlertPayload, extractPrimaryFile, extractUserSegments } = require('./alert-trigger-service');
const { enrichAlertWithContext } = require('./alert-context-service');
const { buildChannelPreviews } = require('./alert-channel-service');
const logger = require('../utils/logger');

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
};

const toPositiveNumberOrNull = (value) => {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  return numeric >= 0 ? numeric : null;
};

const toDateOrNull = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizeSegments = (value) => {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
    .filter(Boolean);
};

const normalizeStackTrace = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((frame) => frame && typeof frame === 'object')
    .map((frame) => ({
      file: typeof frame.file === 'string' ? frame.file : frame.filename || frame.source || null,
      line: toNumberOrNull(frame.line),
      column: toNumberOrNull(frame.column),
      function: typeof frame.function === 'string' ? frame.function : frame.func || null,
      inApp: typeof frame.inApp === 'boolean' ? frame.inApp : Boolean(frame.in_app),
    }));
};

const buildSimulationMetrics = ({ rule, input, occurrence, payload }) => {
  const ruleType = rule?.type;
  const primaryFile = extractPrimaryFile(occurrence, payload);

  const metrics = {
    environment: occurrence.environment || null,
    severity: typeof input.severity === 'string' ? input.severity : payload?.severity || null,
    fingerprint: typeof input.fingerprint === 'string' && input.fingerprint ? input.fingerprint : payload?.fingerprint || null,
    file: primaryFile,
    sourceFile: primaryFile,
    userSegments: normalizeSegments(input.userSegments || payload?.metadata?.userSegments || occurrence?.userSegments),
    isNew: Boolean(input.isNew),
  };

  if (ruleType === 'threshold' || ruleType === 'spike') {
    const windowMinutes = toPositiveNumberOrNull(input.windowMinutes) || toPositiveNumberOrNull(rule?.conditions?.windowMinutes) || 5;
    const windowCount = toPositiveNumberOrNull(input.windowCount);
    metrics.windowMinutes = windowMinutes;
    metrics.windowCount = windowCount != null ? windowCount : toPositiveNumberOrNull(input.occurrences);
  }

  if (ruleType === 'spike') {
    const baselineMinutes =
      toPositiveNumberOrNull(input.baselineMinutes) ||
      toPositiveNumberOrNull(rule?.conditions?.baselineMinutes) ||
      (metrics.windowMinutes ? metrics.windowMinutes * 3 : null);

    let baselineCount = toPositiveNumberOrNull(input.baselineCount);
    if (baselineCount === null && metrics.windowCount != null) {
      baselineCount = Math.max(0, Math.round(metrics.windowCount * 0.4));
    }

    metrics.baselineMinutes = baselineMinutes;
    metrics.baselineCount = baselineCount;

    if (baselineCount != null && baselineMinutes) {
      metrics.baselineRate = baselineMinutes > 0 ? baselineCount / baselineMinutes : null;
    }
    if (metrics.windowCount != null && metrics.windowMinutes) {
      metrics.currentRate = metrics.windowMinutes > 0 ? metrics.windowCount / metrics.windowMinutes : null;
    }
  }

  if (ruleType === 'threshold') {
    if (metrics.windowCount == null) {
      metrics.windowCount = toPositiveNumberOrNull(input.occurrences) || 0;
    }
  }

  if (ruleType === 'critical') {
    if (!metrics.fingerprint && typeof rule?.conditions?.fingerprint === 'string') {
      metrics.fingerprint = rule.conditions.fingerprint;
    }
  }

  if (Array.isArray(metrics.userSegments) && !metrics.userSegments.length) {
    metrics.userSegments = extractUserSegments(payload);
  }

  return metrics;
};

const buildSimulationPayload = ({ input }) => ({
  severity: input.severity || null,
  fingerprint: input.fingerprint || null,
  environment: input.environment || null,
  metadata: {
    severity: input.severity || null,
    sourceFile: input.sourceFile || null,
    userSegments: normalizeSegments(input.userSegments),
  },
  stackTrace: normalizeStackTrace(input.stackTrace),
  userContext: input.userContext || {},
  links: input.links || {},
});

const buildOccurrence = ({ input }) => {
  const timestamp = toDateOrNull(input.lastDetectedAt, new Date());
  return {
    _id: 'simulated-occurrence',
    environment: input.environment || null,
    fingerprint: input.fingerprint || null,
    timestamp,
    stackTrace: normalizeStackTrace(input.stackTrace),
    userSegments: normalizeSegments(input.userSegments),
  };
};

const buildErrorEvent = ({ input, occurrence }) => {
  const firstSeen = toDateOrNull(input.firstDetectedAt, occurrence.timestamp);
  const lastSeen = occurrence.timestamp;
  return {
    _id: 'simulated-error',
    message: input.errorMessage || input.message || 'Simulated alert testing event',
    fingerprint: input.fingerprint || null,
    count: toPositiveNumberOrNull(input.occurrences) || null,
    firstSeen,
    lastSeen,
    environment: occurrence.environment || null,
  };
};

const simulateAlertRule = async ({ project, ruleId, input = {} }) => {
  if (!mongoose.Types.ObjectId.isValid(ruleId)) {
    return { error: { message: 'Invalid rule id' } };
  }

  const rule = await AlertRule.findOne({ _id: ruleId, project: project._id }).lean();
  if (!rule) {
    return { error: { message: 'Alert rule not found', status: 404 } };
  }

  const payload = buildSimulationPayload({ input });
  const occurrence = buildOccurrence({ input });
  const errorEvent = buildErrorEvent({ input, occurrence });
  const metrics = buildSimulationMetrics({ rule, input, occurrence, payload });

  if ((rule.type === 'threshold' || rule.type === 'spike') && !metrics.fingerprint) {
    return {
      rule,
      metrics,
      evaluation: { triggered: false, reason: 'missing_fingerprint', message: 'Fingerprint is required for aggregate simulations.' },
      error: { message: 'Fingerprint is required for aggregate simulations.', status: 422 },
      triggered: false,
    };
  }

  const evaluation = evaluateRule(rule, metrics);

  const response = {
    rule,
    metrics,
    evaluation,
    triggered: Boolean(evaluation?.triggered),
  };

  if (!evaluation.triggered) {
    return response;
  }

  try {
    const alertPayload = buildAlertPayload({
      project,
      rule,
      errorEvent,
      occurrence,
      evaluation,
      metrics,
      metadata: {
        severity: metrics.severity,
        fingerprint: metrics.fingerprint,
        links: payload.links,
      },
    });

    const enrichedAlert = await enrichAlertWithContext({
      project,
      rule,
      alert: alertPayload,
      evaluation,
      metrics,
      links: alertPayload.links,
    });

    const channelPreviews = buildChannelPreviews({ project, rule, alert: enrichedAlert });

    return {
      ...response,
      alert: enrichedAlert,
      channels: channelPreviews,
    };
  } catch (error) {
    logger.error({ err: error, ruleId: rule?._id?.toString?.() || null }, 'Failed to build simulated alert preview');
    return {
      ...response,
      alert: null,
      channels: [],
      error: {
        message: 'Failed to build alert preview',
      },
    };
  }
};

module.exports = {
  simulateAlertRule,
};
