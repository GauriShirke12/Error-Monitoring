const AlertRule = require('../models/AlertRule');
const ErrorOccurrence = require('../models/Occurrence');
const { evaluateRule } = require('./alert-evaluation-service');
const { processTriggeredAlert } = require('./alert-notification-service');
const { enrichAlertWithContext } = require('./alert-context-service');
const logger = require('../utils/logger');

const MS_IN_MINUTE = 60 * 1000;

const defaultSeverityByRule = new Map([
  ['threshold', 'high'],
  ['spike', 'high'],
  ['new_error', 'medium'],
  ['critical', 'critical'],
]);

const toNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const extractPrimaryFile = (occurrence, payload) => {
  const stackSources = Array.isArray(occurrence?.stackTrace) && occurrence.stackTrace.length
    ? occurrence.stackTrace
    : Array.isArray(payload?.stackTrace)
    ? payload.stackTrace
    : [];

  const firstFrame = stackSources.find((frame) => frame && typeof frame.file === 'string' && frame.file.trim())
    || stackSources.find((frame) => frame && typeof frame.filename === 'string' && frame.filename.trim())
    || stackSources[0];

  if (firstFrame) {
    if (typeof firstFrame.file === 'string' && firstFrame.file.trim()) {
      return firstFrame.file.trim();
    }
    if (typeof firstFrame.filename === 'string' && firstFrame.filename.trim()) {
      return firstFrame.filename.trim();
    }
    if (typeof firstFrame.source === 'string' && firstFrame.source.trim()) {
      return firstFrame.source.trim();
    }
  }

  const metadataSources = [
    payload?.metadata?.sourceFile,
    payload?.metadata?.file,
    payload?.metadata?.path,
  ];

  for (const candidate of metadataSources) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const extractUserSegments = (payload) => {
  const segments = new Set();
  const addSegment = (value) => {
    if (typeof value === 'string' && value.trim()) {
      segments.add(value.trim());
    }
  };

  const collectArray = (value) => {
    if (Array.isArray(value)) {
      value.forEach(addSegment);
    }
  };

  const context = payload?.userContext || {};
  collectArray(context.segments);
  collectArray(context.segmentIds);
  addSegment(context.segment);
  addSegment(context.plan);
  addSegment(context.tier);

  const metadata = payload?.metadata || {};
  collectArray(metadata.userSegments);
  addSegment(metadata.userSegment);

  return Array.from(segments);
};

const countOccurrences = async ({ projectId, fingerprint, environment, start, end }) => {
  const query = { projectId, fingerprint };

  if (environment) {
    query.environment = environment;
  }

  if (start || end) {
    query.timestamp = {};
    if (start) {
      query.timestamp.$gte = start;
    }
    if (end) {
      query.timestamp.$lt = end;
    }
  }

  return ErrorOccurrence.countDocuments(query).exec();
};

const loadActiveRules = async (projectId) => {
  const result = await AlertRule.find({ project: projectId, enabled: true })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return result || [];
};

const computeWindowMetrics = async ({ projectId, fingerprint, environment, windowMinutes, now }) => {
  const durationMs = Math.max(1, Number(windowMinutes) || 5) * MS_IN_MINUTE;
  const windowStart = new Date(now.getTime() - durationMs);
  const windowCount = await countOccurrences({ projectId, fingerprint, environment, start: windowStart });
  return {
    windowStart,
    windowMinutes: durationMs / MS_IN_MINUTE,
    windowCount,
  };
};

const computeBaselineMetrics = async ({ projectId, fingerprint, environment, windowStart, baselineMinutes }) => {
  const durationMs = Math.max(1, Number(baselineMinutes) || 30) * MS_IN_MINUTE;
  const baselineStart = new Date(windowStart.getTime() - durationMs);
  const baselineCount = await countOccurrences({
    projectId,
    fingerprint,
    environment,
    start: baselineStart,
    end: windowStart,
  });
  return {
    baselineStart,
    baselineMinutes: durationMs / MS_IN_MINUTE,
    baselineCount,
  };
};

const buildAlertPayload = ({ project, rule, errorEvent, occurrence, evaluation, metrics, metadata }) => {
  const { context = {}, reason } = evaluation;
  const baseTitle = rule?.name || errorEvent?.message || 'Alert triggered';
  const environment = occurrence?.environment || null;
  const fingerprint = errorEvent?.fingerprint || metadata?.fingerprint || null;
  const windowMinutes = toNumberOrNull(metrics?.windowMinutes);
  const occurrences = toNumberOrNull(metrics?.windowCount) ?? toNumberOrNull(errorEvent?.count);
  const severity = context.severity || metadata?.severity || defaultSeverityByRule.get(rule?.type) || 'info';
  const firstDetectedAt = errorEvent?.firstSeen instanceof Date ? errorEvent.firstSeen.toISOString() : null;
  const lastDetectedAt = occurrence?.timestamp instanceof Date ? occurrence.timestamp.toISOString() : new Date().toISOString();

  const summaryByType = {
    threshold: () => {
      const threshold = toNumberOrNull(rule?.conditions?.threshold);
      const minutes = windowMinutes ?? toNumberOrNull(rule?.conditions?.windowMinutes);
      if (threshold && minutes) {
        return `Detected ${metrics.windowCount} occurrences in the last ${minutes} minutes (threshold ${threshold}).`;
      }
      return 'Threshold alert triggered based on recent occurrence volume.';
    },
    spike: () => {
      const increase = context.increasePercent != null ? Math.round(context.increasePercent) : null;
      if (increase != null) {
        return `Error rate increased by ${increase}% compared to baseline.`;
      }
      return 'Spike alert triggered based on recent rate increase.';
    },
    new_error: () => `New fingerprint detected in ${environment || 'environment'}.`,
    critical: () => 'Critical alert triggered by configured severity or fingerprint.',
  };

  const summaryBuilder = summaryByType[rule?.type];
  const summary = summaryBuilder ? summaryBuilder() : 'Alert rule triggered.';

  return {
    title: baseTitle,
    summary,
    severity,
    environment,
    occurrences,
    windowMinutes,
    fingerprint,
    firstDetectedAt,
    lastDetectedAt,
    metadata: {
      ruleId: rule?._id?.toString?.() || null,
      ruleType: rule?.type || null,
      reason,
      context,
      fingerprint,
      occurrenceId: occurrence?._id?.toString?.() || null,
      sourceFile: metrics?.file || null,
      userSegments: Array.isArray(metrics?.userSegments) && metrics.userSegments.length ? metrics.userSegments : null,
    },
    links: metadata?.links || {},
  };
};

const evaluateRuleWithMetrics = async ({ project, rule, errorEvent, occurrence, isNew, payload }) => {
  const now = occurrence?.timestamp instanceof Date ? new Date(occurrence.timestamp) : new Date();
  const metadata = {
    severity: payload?.severity || payload?.metadata?.severity || null,
    fingerprint: errorEvent?.fingerprint || occurrence?.fingerprint || payload?.fingerprint || null,
    links: payload?.links || null,
  };

  const primaryFile = extractPrimaryFile(occurrence, payload);
  const userSegments = extractUserSegments(payload);

  const baseMetrics = {
    environment: occurrence?.environment || payload?.environment || null,
    severity: metadata.severity,
    fingerprint: metadata.fingerprint,
    isNew,
    file: primaryFile,
    sourceFile: primaryFile,
    userSegments,
  };

  if (!metadata.fingerprint && (rule.type === 'threshold' || rule.type === 'spike')) {
    logger.warn({ ruleId: rule?._id?.toString?.() || null }, 'Skipping aggregate evaluation – missing fingerprint');
    return null;
  }

  if (rule.type === 'threshold') {
    const windowMetrics = await computeWindowMetrics({
      projectId: project._id,
      fingerprint: metadata.fingerprint,
      environment: baseMetrics.environment,
      windowMinutes: rule.conditions?.windowMinutes,
      now,
    });
    const evaluationMetrics = { ...baseMetrics, ...windowMetrics };
    const evaluation = evaluateRule(rule, evaluationMetrics);
    return evaluation.triggered
      ? {
          evaluation,
          metrics: evaluationMetrics,
          alert: buildAlertPayload({ project, rule, errorEvent, occurrence, evaluation, metrics: evaluationMetrics, metadata }),
        }
      : null;
  }

  if (rule.type === 'spike') {
    const windowMetrics = await computeWindowMetrics({
      projectId: project._id,
      fingerprint: metadata.fingerprint,
      environment: baseMetrics.environment,
      windowMinutes: rule.conditions?.windowMinutes,
      now,
    });
    const baselineMetrics = await computeBaselineMetrics({
      projectId: project._id,
      fingerprint: metadata.fingerprint,
      environment: baseMetrics.environment,
      windowStart: windowMetrics.windowStart,
      baselineMinutes: rule.conditions?.baselineMinutes,
    });
    const metrics = {
      ...windowMetrics,
      ...baselineMetrics,
      ...baseMetrics,
    };
    const evaluation = evaluateRule(rule, metrics);
    return evaluation.triggered
      ? {
          evaluation,
          metrics,
          alert: buildAlertPayload({ project, rule, errorEvent, occurrence, evaluation, metrics, metadata }),
        }
      : null;
  }

  if (rule.type === 'new_error') {
    const metrics = { ...baseMetrics, isNew };
    const evaluation = evaluateRule(rule, metrics);
    return evaluation.triggered
      ? {
          evaluation,
          metrics,
          alert: buildAlertPayload({ project, rule, errorEvent, occurrence, evaluation, metrics, metadata }),
        }
      : null;
  }

  if (rule.type === 'critical') {
    const evaluation = evaluateRule(rule, baseMetrics);
    return evaluation.triggered
      ? {
          evaluation,
          metrics: baseMetrics,
          alert: buildAlertPayload({ project, rule, errorEvent, occurrence, evaluation, metrics: baseMetrics, metadata }),
        }
      : null;
  }

  return null;
};

const evaluateAndDispatchAlerts = async ({ project, errorEvent, occurrence, isNew, payload }) => {
  try {
    const rules = await loadActiveRules(project._id);
    if (!rules.length) {
      return { triggered: 0 };
    }

    const evaluations = [];
    for (const rule of rules) {
      try {
        const result = await evaluateRuleWithMetrics({ project, rule, errorEvent, occurrence, isNew, payload });
        if (result) {
          const enrichedAlert = await enrichAlertWithContext({
            project,
            rule,
            alert: result.alert,
            evaluation: result.evaluation,
            metrics: result.metrics,
            links: result.alert?.links,
          });
          evaluations.push({ rule, alert: enrichedAlert });
        }
      } catch (error) {
        logger.error({ err: error, ruleId: rule?._id?.toString?.() }, 'Alert rule evaluation failed');
      }
    }

    for (const item of evaluations) {
      try {
        await processTriggeredAlert({ project, rule: item.rule, alert: item.alert });
      } catch (error) {
        logger.error({ err: error, ruleId: item.rule?._id?.toString?.() }, 'Failed to dispatch triggered alert');
      }
    }

    return { triggered: evaluations.length };
  } catch (error) {
    logger.error({ err: error, projectId: project?._id?.toString?.() }, 'Alert evaluation pipeline failed');
    return { triggered: 0, error };
  }
};

module.exports = {
  evaluateAndDispatchAlerts,
  buildAlertPayload,
  extractPrimaryFile,
  extractUserSegments,
  __testing: {
    computeWindowMetrics,
    computeBaselineMetrics,
    buildAlertPayload,
    loadActiveRules,
    countOccurrences,
  },
};
