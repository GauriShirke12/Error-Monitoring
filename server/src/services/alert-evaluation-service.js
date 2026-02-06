const FILTER_FIELDS = Object.freeze({
  environment: 'environment',
  file: 'file',
  userSegment: 'userSegment',
});

const toArray = (value) => {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
};

const normalizeValue = (value) => {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.toLowerCase();
  }
  return String(value).toLowerCase();
};

const collectFieldValues = (field, metrics) => {
  switch (field) {
    case FILTER_FIELDS.environment: {
      const environments = metrics.environment
        ? toArray(metrics.environment)
        : metrics.environments
        ? toArray(metrics.environments)
        : [];
      return environments
        .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
        .filter(Boolean);
    }
    case FILTER_FIELDS.file: {
      if (typeof metrics.file === 'string') {
        return [metrics.file.trim()];
      }
      if (typeof metrics.sourceFile === 'string') {
        return [metrics.sourceFile.trim()];
      }
      return [];
    }
    case FILTER_FIELDS.userSegment: {
      const segments = toArray(metrics.userSegments).concat(toArray(metrics.userSegment));
      return segments
        .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
        .filter(Boolean);
    }
    default:
      return [];
  }
};

const matchesLeafCondition = (clause, metrics) => {
  const fieldValues = collectFieldValues(clause.field, metrics).map((value) => ({
    raw: value,
    normalized: normalizeValue(value),
  }));

  if (!fieldValues.length) {
    return false;
  }

  const toNormalizedArray = (values) =>
    values
      .map((value) => normalizeValue(value))
      .filter((value) => value !== null);

  const operator = clause.operator;

  if (operator === 'equals') {
    const target = normalizeValue(clause.value);
    if (target === null) {
      return false;
    }
    return fieldValues.some((value) => value.normalized === target);
  }

  if (operator === 'not_equals') {
    const target = normalizeValue(clause.value);
    if (target === null) {
      return false;
    }
    return fieldValues.every((value) => value.normalized !== target);
  }

  if (operator === 'contains') {
    const target = normalizeValue(clause.value);
    if (target === null) {
      return false;
    }
    return fieldValues.some((value) => value.normalized.includes(target));
  }

  if (operator === 'not_contains') {
    const target = normalizeValue(clause.value);
    if (target === null) {
      return false;
    }
    return fieldValues.every((value) => !value.normalized.includes(target));
  }

  if (operator === 'in') {
    const candidates = toNormalizedArray(clause.values || []);
    if (!candidates.length) {
      return false;
    }
    return fieldValues.some((value) => candidates.includes(value.normalized));
  }

  if (operator === 'not_in') {
    const candidates = toNormalizedArray(clause.values || []);
    if (!candidates.length) {
      return false;
    }
    return fieldValues.every((value) => !candidates.includes(value.normalized));
  }

  return false;
};

const matchesFilterClause = (clause, metrics) => {
  if (!clause || typeof clause !== 'object') {
    return true;
  }

  if (clause.op) {
    const op = String(clause.op).toLowerCase();
    if (op === 'and') {
      return Array.isArray(clause.conditions)
        ? clause.conditions.every((child) => matchesFilterClause(child, metrics))
        : true;
    }
    if (op === 'or') {
      return Array.isArray(clause.conditions)
        ? clause.conditions.some((child) => matchesFilterClause(child, metrics))
        : false;
    }
    if (op === 'not') {
      return !matchesFilterClause(clause.condition, metrics);
    }
    return true;
  }

  return matchesLeafCondition(clause, metrics);
};
const isPositiveNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const normalizeSeverity = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const matchesEnvironment = (rule, metrics) => {
  const configured = Array.isArray(rule.conditions?.environments) ? rule.conditions.environments : [];
  if (!configured.length) {
    return true;
  }
  const environment = typeof metrics.environment === 'string' ? metrics.environment.trim().toLowerCase() : null;
  return environment ? configured.map((value) => value.toLowerCase()).includes(environment) : false;
};

const matchesFilter = (rule, metrics) => {
  const filter = rule?.conditions?.filter;
  if (!filter) {
    return true;
  }
  return matchesFilterClause(filter, metrics);
};

const evaluateThreshold = (rule, metrics) => {
  const threshold = Number(rule.conditions?.threshold);
  const windowMinutes = Number(rule.conditions?.windowMinutes);
  if (!isPositiveNumber(threshold) || !isPositiveNumber(windowMinutes)) {
    return { triggered: false };
  }

  const count = Number(metrics.windowCount || 0);
  const windowSize = Number(metrics.windowMinutes || windowMinutes);

  if (!isPositiveNumber(count) || !isPositiveNumber(windowSize)) {
    return { triggered: false };
  }

  const triggered = count >= threshold && windowSize <= windowMinutes + 0.5;

  return triggered
    ? {
        triggered: true,
        reason: 'threshold_exceeded',
        context: {
          windowCount: count,
          threshold,
          windowMinutes,
        },
      }
    : { triggered: false };
};

const evaluateSpike = (rule, metrics) => {
  const increasePercentTarget = Number(rule.conditions?.increasePercent);
  const windowMinutes = Number(rule.conditions?.windowMinutes);
  const baselineMinutes = Number(rule.conditions?.baselineMinutes || metrics.baselineMinutes);

  if (!isPositiveNumber(increasePercentTarget) || !isPositiveNumber(windowMinutes) || !isPositiveNumber(baselineMinutes)) {
    return { triggered: false };
  }

  const windowCount = Number(metrics.windowCount || 0);
  const baselineCount = Number(metrics.baselineCount || 0);
  const baselineRate = Number(metrics.baselineRate || (baselineCount && baselineMinutes ? baselineCount / baselineMinutes : 0));
  const currentRate = windowMinutes ? windowCount / windowMinutes : 0;

  if (!isPositiveNumber(currentRate) || !isPositiveNumber(baselineRate)) {
    return { triggered: false };
  }

  const increase = ((currentRate - baselineRate) / baselineRate) * 100;

  if (increase >= increasePercentTarget) {
    return {
      triggered: true,
      reason: 'spike_detected',
      context: {
        increasePercent: increase,
        targetPercent: increasePercentTarget,
        currentRate,
        baselineRate,
      },
    };
  }

  return { triggered: false };
};

const evaluateNewError = (rule, metrics) => {
  if (metrics.isNew) {
    return {
      triggered: true,
      reason: 'new_error',
      context: {
        fingerprint: metrics.fingerprint || null,
      },
    };
  }
  return { triggered: false };
};

const evaluateCritical = (rule, metrics) => {
  const severityCondition = normalizeSeverity(rule.conditions?.severity);
  const severity = normalizeSeverity(metrics.severity);

  if (severityCondition && severity === severityCondition) {
    return {
      triggered: true,
      reason: 'critical_severity',
    };
  }

  const fingerprintCondition = rule.conditions?.fingerprint;

  if (typeof fingerprintCondition === 'string' && fingerprintCondition.trim()) {
    if ((metrics.fingerprint || '').trim() === fingerprintCondition.trim()) {
      return {
        triggered: true,
        reason: 'critical_fingerprint',
      };
    }
  }

  const fingerprints = Array.isArray(fingerprintCondition) ? fingerprintCondition : [];
  if (fingerprints.length && typeof metrics.fingerprint === 'string') {
    if (fingerprints.some((value) => value === metrics.fingerprint)) {
      return {
        triggered: true,
        reason: 'critical_fingerprint',
      };
    }
  }

  return { triggered: false };
};

const evaluators = {
  threshold: evaluateThreshold,
  spike: evaluateSpike,
  new_error: evaluateNewError,
  critical: evaluateCritical,
};

const evaluateRule = (rule, metrics = {}) => {
  if (!rule || rule.enabled === false) {
    return { triggered: false };
  }

  const evaluator = evaluators[rule.type];
  if (!evaluator) {
    return { triggered: false };
  }

  if (!matchesEnvironment(rule, metrics)) {
    return { triggered: false };
  }

  if (!matchesFilter(rule, metrics)) {
    return { triggered: false };
  }

  const result = evaluator(rule, metrics);

  if (!result.triggered) {
    return { triggered: false };
  }

  const cooldownMinutes = Number(rule.cooldownMinutes);

  return {
    ...result,
    cooldownMinutes: Number.isFinite(cooldownMinutes) && cooldownMinutes >= 0 ? cooldownMinutes : null,
    ruleId: rule._id || null,
  };
};

module.exports = {
  evaluateRule,
  evaluateThreshold,
  evaluateSpike,
  evaluateNewError,
  evaluateCritical,
};
