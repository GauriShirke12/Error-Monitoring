const Deployment = require('../models/Deployment');
const ErrorEvent = require('../models/Error');
const logger = require('../utils/logger');

const DEFAULT_DEPLOYMENT_LOOKBACK_MS = Number(process.env.ALERT_DEPLOYMENT_LOOKBACK_MS || 12 * 60 * 60 * 1000);
const SIMILAR_INCIDENT_LIMIT = 3;

const isValidObjectId = (value) => {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return /^[0-9a-fA-F]{24}$/.test(value);
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return /^[0-9a-fA-F]{24}$/.test(value.toString());
  }
  return false;
};

const safeDate = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const loadRecentDeployments = async ({ projectId, referenceDate, lookbackMs = DEFAULT_DEPLOYMENT_LOOKBACK_MS }) => {
  if (!isValidObjectId(projectId)) {
    return [];
  }
  try {
    const end = safeDate(referenceDate) || new Date();
    const start = new Date(end.getTime() - lookbackMs);
    const deployments = await Deployment.find({
      projectId,
      timestamp: { $lte: end, $gte: start },
    })
      .sort({ timestamp: -1 })
      .limit(3)
      .lean();

    return deployments.map((deployment) => ({
      id: deployment._id?.toString?.() || null,
      label: deployment.label || 'Deployment',
      timestamp: deployment.timestamp,
      metadata: deployment.metadata || {},
    }));
  } catch (error) {
    logger.error({ err: error, projectId: projectId?.toString?.() || null }, 'Failed to load recent deployments for alert context');
    return [];
  }
};

const loadSimilarIncidents = async ({ projectId, fingerprint, environment }) => {
  if (!isValidObjectId(projectId)) {
    return [];
  }

  const query = { projectId };
  if (fingerprint) {
    query.fingerprint = fingerprint;
  } else if (environment) {
    query.environment = environment;
  }

  try {
    const incidents = await ErrorEvent.find(query)
      .sort({ lastSeen: -1 })
      .limit(SIMILAR_INCIDENT_LIMIT)
      .lean();

    return incidents.map((incident) => ({
      id: incident._id?.toString?.() || null,
      message: incident.message,
      lastSeen: incident.lastSeen,
      status: incident.status,
      count: incident.count,
      environment: incident.environment,
    }));
  } catch (error) {
    logger.error({ err: error, projectId: projectId?.toString?.() || null }, 'Failed to fetch similar incidents for alert context');
    return [];
  }
};

const buildSuggestedFixes = ({ alert, similarIncidents, deployments }) => {
  const suggestions = new Set();

  if (deployments.length) {
    const recent = deployments[0];
    suggestions.add(`Review deployment "${recent.label}" from ${new Date(recent.timestamp).toUTCString()} for regressions.`);
  }

  if (alert.metadata?.sourceFile) {
    suggestions.add(`Inspect recent changes in ${alert.metadata.sourceFile}.`);
  }

  if (alert.ruleType === 'spike') {
    suggestions.add('Check for upstream traffic spikes or external dependency slowdowns.');
  }

  if (alert.ruleType === 'threshold') {
    suggestions.add('Verify error budget and rate limits for the affected service.');
  }

  if (alert.ruleType === 'critical') {
    suggestions.add('Escalate to on-call engineer and verify failover/rollback readiness.');
  }

  if (alert.metadata?.userSegments && alert.metadata.userSegments.length) {
    suggestions.add(`Notify customer success about impact to ${alert.metadata.userSegments.join(', ')} users.`);
  }

  if (!suggestions.size && similarIncidents.length) {
    suggestions.add('Review notes from prior similar incidents for remediation steps.');
  }

  return Array.from(suggestions).slice(0, 5);
};

const buildWhyItMatters = ({ alert, evaluation }) => {
  const parts = [];
  if (alert.severity) {
    parts.push(`Severity ${String(alert.severity).toUpperCase()}`);
  }
  if (alert.environment) {
    parts.push(`${alert.environment} environment`);
  }
  if (alert.metadata?.userSegments && alert.metadata.userSegments.length) {
    parts.push(`affecting ${alert.metadata.userSegments.join(', ')}`);
  }
  if (alert.occurrences) {
    parts.push(`${alert.occurrences} occurrences detected`);
  }

  const base = parts.length ? parts.join(', ') : 'Key service impact detected';
  if (evaluation?.reason === 'spike_detected') {
    return `${base}. Error rate spiked significantly over historical baseline.`;
  }
  if (evaluation?.reason === 'threshold_exceeded') {
    return `${base}. Error volume surpassed the configured threshold window.`;
  }
  if (evaluation?.reason === 'new_error') {
    return `${base}. This is a new fingerprint, so prior remediation may not exist.`;
  }
  if (evaluation?.reason === 'critical_severity' || alert.severity === 'critical') {
    return `${base}. Critical severity requires immediate attention to prevent customer impact.`;
  }
  return `${base}. Investigate promptly to prevent escalation.`;
};

const buildNextSteps = ({ alert, deployments, contextLinks }) => {
  const steps = [];
  if (alert.metadata?.sourceFile) {
    steps.push(`Inspect ${alert.metadata.sourceFile} for recent changes.`);
  }
  if (deployments.length) {
    steps.push(`Rollback or hotfix deployment "${deployments[0].label}" if necessary.`);
  }
  if (contextLinks?.investigate) {
    steps.push('Review stack traces and logs via the dashboard link.');
  }
  if (contextLinks?.acknowledge) {
    steps.push('Acknowledge the alert once triage begins to pause escalations.');
  }
  if (alert.metadata?.userSegments && alert.metadata.userSegments.length) {
    steps.push(`Communicate status updates to impacted ${alert.metadata.userSegments.join(', ')} users.`);
  }
  if (!steps.length) {
    steps.push('Assign an owner, investigate root cause, and document findings.');
  }
  return steps.slice(0, 5);
};

const buildAlertContext = async ({ project, rule, alert, evaluation, metrics, links = {} }) => {
  const referenceDate = alert.lastDetectedAt || alert.metadata?.lastDetectedAt || new Date();
  const [recentDeployments, similarIncidents] = await Promise.all([
    loadRecentDeployments({ projectId: project._id, referenceDate }),
    loadSimilarIncidents({
      projectId: project._id,
      fingerprint: alert.metadata?.fingerprint || metrics?.fingerprint,
      environment: alert.environment,
    }),
  ]);

  const suggestedFixes = buildSuggestedFixes({ alert, similarIncidents, deployments: recentDeployments });
  const whyItMatters = buildWhyItMatters({ alert, evaluation, metrics });
  const nextSteps = buildNextSteps({ alert, deployments: recentDeployments, contextLinks: links });

  return {
    recentDeployments,
    similarIncidents,
    suggestedFixes,
    whyItMatters,
    nextSteps,
  };
};

const enrichAlertWithContext = async ({ project, rule, alert, evaluation, metrics, links }) => {
  const context = await buildAlertContext({ project, rule, alert, evaluation, metrics, links });
  const enrichedAlert = {
    ...alert,
    whyItMatters: context.whyItMatters,
    nextSteps: context.nextSteps,
    context: {
      recentDeployments: context.recentDeployments,
      similarIncidents: context.similarIncidents,
      suggestedFixes: context.suggestedFixes,
    },
    metadata: {
      ...alert.metadata,
      contextualInsights: context,
    },
  };
  return enrichedAlert;
};

module.exports = {
  buildAlertContext,
  enrichAlertWithContext,
};
