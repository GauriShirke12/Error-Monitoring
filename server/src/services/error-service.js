const mongoose = require('mongoose');
const ErrorEvent = require('../models/Error');
const ErrorOccurrence = require('../models/Occurrence');
const TeamMember = require('../models/TeamMember');
const { createFingerprint } = require('../utils/fingerprint');
const { sanitizeErrorPayload } = require('../utils/sanitize');
const { formatStackTraceForHighlight } = require('../utils/stack-formatter');
const logger = require('../utils/logger');
const analyticsCache = require('../utils/analytics-cache');
const { enqueueAnalyticsWarmup } = require('../queues/analytics-queue');
const { evaluateAndDispatchAlerts } = require('./alert-trigger-service');

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeRegex = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeMetadata = (base = {}, incoming = {}) => {
  const result = {
    tags: {},
    context: {},
    breadcrumbs: [],
    ...base,
  };

  const incomingTags = incoming.tags && typeof incoming.tags === 'object' ? incoming.tags : {};
  const incomingContext = incoming.context && typeof incoming.context === 'object' ? incoming.context : {};
  const incomingBreadcrumbs = Array.isArray(incoming.breadcrumbs) ? incoming.breadcrumbs : undefined;

  result.tags = { ...(result.tags || {}), ...incomingTags };
  result.context = { ...(result.context || {}), ...incomingContext };
  if (incomingBreadcrumbs !== undefined) {
    result.breadcrumbs = incomingBreadcrumbs;
  }

  Object.entries(incoming).forEach(([key, value]) => {
    if (key === 'tags' || key === 'context' || key === 'breadcrumbs') {
      return;
    }
    if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
};

const ingestError = async (payload, project) => {
  const scrubbingOptions = project?.scrubbing || {};
  const sanitizedPayload = sanitizeErrorPayload(payload, scrubbingOptions);
  const {
    message,
    stackTrace,
    environment,
    metadata,
    userContext,
    timestamp,
    __hasMetadata,
    __hasUserContext,
  } = sanitizedPayload;

  const occurrenceTimestamp = timestamp ? new Date(timestamp) : new Date();
  const retentionDays = Number(project?.retentionDays || 0);
  const expiresAt =
    Number.isFinite(retentionDays) && retentionDays > 0
      ? new Date(occurrenceTimestamp.getTime() + retentionDays * DAY_MS)
      : null;
  const fingerprint = createFingerprint(message, stackTrace);
  const occurrenceMetadata = metadata ?? {};
  const normalizedMetadata = normalizeMetadata({}, occurrenceMetadata);
  const occurrenceUserContext = userContext ?? {};

  let errorEvent = await ErrorEvent.findOne({ fingerprint, projectId: project._id });
  let isNew = false;

  if (errorEvent) {
    errorEvent.count += 1;
    errorEvent.lastSeen = occurrenceTimestamp;
    errorEvent.message = message;
    errorEvent.environment = environment;
    errorEvent.stackTrace = stackTrace;
    errorEvent.markModified('stackTrace');
    if (__hasMetadata) {
      errorEvent.metadata = normalizeMetadata(errorEvent.metadata || {}, normalizedMetadata);
      errorEvent.markModified('metadata');
    }
    if (__hasUserContext) {
      errorEvent.userContext = occurrenceUserContext;
      errorEvent.markModified('userContext');
    }
    errorEvent.expiresAt = expiresAt || null;
    await errorEvent.save();
  } else {
    isNew = true;
    try {
      errorEvent = await ErrorEvent.create({
        message,
        stackTrace,
        fingerprint,
        environment,
        projectId: project._id,
        metadata: normalizedMetadata,
        userContext: occurrenceUserContext,
        firstSeen: occurrenceTimestamp,
        lastSeen: occurrenceTimestamp,
        statusHistory: [
          {
            status: 'new',
            changedAt: occurrenceTimestamp,
          },
        ],
        lastStatusChange: occurrenceTimestamp,
        ...(expiresAt ? { expiresAt } : {}),
      });
    } catch (error) {
      if (error && error.code === 11000) {
        logger.warn({ fingerprint, projectId: project._id.toString() }, 'Duplicate fingerprint on create');
        errorEvent = await ErrorEvent.findOne({ fingerprint, projectId: project._id });
        if (errorEvent) {
          errorEvent.count += 1;
          errorEvent.lastSeen = occurrenceTimestamp;
          errorEvent.message = message;
          errorEvent.environment = environment;
          errorEvent.stackTrace = stackTrace;
          errorEvent.markModified('stackTrace');
          if (__hasMetadata) {
            errorEvent.metadata = occurrenceMetadata;
            errorEvent.markModified('metadata');
          }
          if (__hasUserContext) {
            errorEvent.userContext = occurrenceUserContext;
            errorEvent.markModified('userContext');
          }
          errorEvent.expiresAt = expiresAt || null;
          await errorEvent.save();
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  const occurrence = await ErrorOccurrence.create({
    errorId: errorEvent._id,
    fingerprint,
    message,
    stackTrace,
    environment,
    projectId: project._id,
    metadata: normalizedMetadata,
    userContext: occurrenceUserContext,
    timestamp: occurrenceTimestamp,
    ...(expiresAt ? { expiresAt } : {}),
  });

  logger.info(
    {
      projectId: project._id.toString(),
      fingerprint,
      isNew,
    },
    'Ingested error event'
  );

  analyticsCache.invalidateProject(project._id);

  enqueueAnalyticsWarmup({ projectId: project._id.toString(), environment }).catch((error) => {
    logger.error({ err: error, projectId: project._id.toString() }, 'Failed to queue analytics warmup');
  });

  try {
    await evaluateAndDispatchAlerts({
      project,
      errorEvent,
      occurrence,
      isNew,
      payload: sanitizedPayload,
    });
  } catch (error) {
    logger.error({ err: error, projectId: project?._id?.toString?.() || null }, 'Alert evaluation pipeline failed after ingestion');
  }

  return {
    errorEvent,
    occurrence,
    fingerprint,
    isNew,
  };
};

const sortableFields = new Map([
  ["lastSeen", "lastSeen"],
  ["firstSeen", "firstSeen"],
  ["count", "count"],
  ["message", "message"],
  ["environment", "environment"],
]);

const listErrors = async (project, options) => {
  const {
    page,
    limit,
    environment,
    status,
    sortBy,
    sortOrder,
    startDate,
    endDate,
    search,
    sourceFile,
  } = options;

  const filter = { projectId: project._id };
  if (environment) {
    filter.environment = environment;
  }
  if (status) {
    filter.status = status;
  }
  if (search) {
    filter.message = { $regex: search, $options: "i" };
  }
  if (sourceFile) {
    const pattern = escapeRegex(sourceFile);
    filter['stackTrace.file'] = { $regex: pattern, $options: 'i' };
  }
  if (startDate || endDate) {
    filter.lastSeen = {};
    if (startDate) {
      filter.lastSeen.$gte = startDate;
    }
    if (endDate) {
      filter.lastSeen.$lte = endDate;
    }
  }

  const skip = (page - 1) * limit;
  const sortField = sortableFields.get(sortBy) || "lastSeen";
  const sort = { [sortField]: sortOrder === 'asc' ? 1 : -1, _id: -1 };

  const [items, total] = await Promise.all([
    ErrorEvent.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    ErrorEvent.countDocuments(filter),
  ]);

  return {
    items: items.map((error) => ({
      id: error._id.toString(),
      message: error.message,
      status: error.status,
      environment: error.environment,
      count: error.count,
      firstSeen: error.firstSeen,
      lastSeen: error.lastSeen,
      fingerprint: error.fingerprint,
      assignedTo: error.assignedTo ? error.assignedTo.toString() : null,
      topStackFrame: error.stackTrace && error.stackTrace.length ? error.stackTrace[0] : null,
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        environment: environment || null,
        status: status || null,
        startDate: startDate || null,
        endDate: endDate || null,
        sourceFile: sourceFile || null,
      },
      sort: {
        field: sortField,
        order: sortOrder,
      },
      search: search || null,
    },
  };
};

const getErrorDetail = async (project, errorId, options = {}) => {
  if (!mongoose.Types.ObjectId.isValid(errorId)) {
    return null;
  }

  const occurrenceLimit = options.occurrenceLimit ?? 50;

  const error = await ErrorEvent.findOne({ _id: errorId, projectId: project._id }).lean();
  if (!error) {
    return null;
  }

  const [occurrences, occurrenceTotal] = await Promise.all([
    ErrorOccurrence.find({ errorId: error._id, projectId: project._id })
      .sort({ timestamp: -1 })
      .limit(occurrenceLimit)
      .lean(),
    ErrorOccurrence.countDocuments({ errorId: error._id, projectId: project._id }),
  ]);

  const stackTraceHighlighted = formatStackTraceForHighlight(error.stackTrace || []);

  const assignmentHistory = Array.isArray(error.assignmentHistory)
    ? error.assignmentHistory.map((entry) => ({
        memberId: entry.memberId?.toString?.() || null,
        assignedAt: entry.assignedAt || null,
        unassignedAt: entry.unassignedAt || null,
      }))
    : [];

  const statusHistory = Array.isArray(error.statusHistory)
    ? error.statusHistory.map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        changedBy: entry.changedBy?.toString?.() || null,
      }))
    : [];

  return {
    id: error._id.toString(),
    message: error.message,
    status: error.status,
    environment: error.environment,
    count: error.count,
    firstSeen: error.firstSeen,
    lastSeen: error.lastSeen,
    fingerprint: error.fingerprint,
    metadata: error.metadata || {},
    userContext: error.userContext || {},
    stackTrace: error.stackTrace || [],
    stackTraceHighlighted,
    assignedTo: error.assignedTo ? error.assignedTo.toString() : null,
    assignmentHistory,
    statusHistory,
    occurrences: occurrences.map((occurrence) => ({
      id: occurrence._id.toString(),
      timestamp: occurrence.timestamp,
      environment: occurrence.environment,
      metadata: occurrence.metadata || {},
      userContext: occurrence.userContext || {},
    })),
    occurrencesReturned: occurrences.length,
    occurrencesTotal: occurrenceTotal,
  };
};

const VALID_STATUSES = new Set(['new', 'open', 'investigating', 'resolved', 'ignored', 'muted']);

const normalizeStatus = (status) => {
  if (!status || typeof status !== 'string') {
    return null;
  }

  const normalized = status.toLowerCase();
  if (normalized === 'open' || normalized === 'resolved' || normalized === 'ignored') {
    return normalized;
  }
  if (normalized === 'investigating' || normalized === 'muted' || normalized === 'new') {
    return normalized;
  }

  return null;
};

const updateErrorStatus = async (project, errorId, status, options = {}) => {
  const normalizedStatus = normalizeStatus(status);
  if (!normalizedStatus) {
    const error = new Error('Invalid status value');
    error.status = 400;
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(errorId)) {
    return null;
  }

  const event = await ErrorEvent.findOne({ _id: errorId, projectId: project._id });
  if (!event) {
    return null;
  }

  let changedByRef = null;
  if (options.changedBy) {
    if (!mongoose.Types.ObjectId.isValid(options.changedBy)) {
      const error = new Error('changedBy must be a valid team member id');
      error.status = 400;
      throw error;
    }
    const member = await TeamMember.findOne({ _id: options.changedBy, projectId: project._id, active: true })
      .select('_id')
      .lean();
    if (!member) {
      const error = new Error('Team member specified in changedBy was not found');
      error.status = 404;
      throw error;
    }
    changedByRef = member._id;
  }

  if (event.status === normalizedStatus) {
    return {
      id: event._id.toString(),
      status: event.status,
      message: event.message,
      count: event.count,
      lastSeen: event.lastSeen,
      assignedTo: event.assignedTo ? event.assignedTo.toString() : null,
    };
  }

  const now = new Date();
  event.status = normalizedStatus;
  event.lastStatusChange = now;

  if (!Array.isArray(event.statusHistory)) {
    event.statusHistory = [];
  }
  event.statusHistory.push({ status: normalizedStatus, changedAt: now, changedBy: changedByRef });

  if (normalizedStatus === 'resolved' && !event.resolvedAt) {
    event.resolvedAt = now;
  }

  await event.save();

  analyticsCache.invalidateProject(project._id);

  return {
    id: event._id.toString(),
    status: event.status,
    message: event.message,
    count: event.count,
    lastSeen: event.lastSeen,
    assignedTo: event.assignedTo ? event.assignedTo.toString() : null,
  };
};

const closeActiveAssignment = (event, timestamp) => {
  if (!Array.isArray(event.assignmentHistory)) {
    event.assignmentHistory = [];
    return;
  }
  for (let index = event.assignmentHistory.length - 1; index >= 0; index -= 1) {
    const entry = event.assignmentHistory[index];
    if (entry && !entry.unassignedAt) {
      entry.unassignedAt = timestamp;
      break;
    }
  }
};

const assignError = async (project, errorId, memberId) => {
  if (!mongoose.Types.ObjectId.isValid(errorId)) {
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    const error = new Error('memberId must be a valid team member id');
    error.status = 400;
    throw error;
  }

  const [event, member] = await Promise.all([
    ErrorEvent.findOne({ _id: errorId, projectId: project._id }),
    TeamMember.findOne({ _id: memberId, projectId: project._id, active: true }).select('_id'),
  ]);

  if (!event) {
    return null;
  }
  if (!member) {
    const error = new Error('Team member not found or inactive');
    error.status = 404;
    throw error;
  }

  if (event.assignedTo && event.assignedTo.toString() === member._id.toString()) {
    return {
      id: event._id.toString(),
      assignedTo: event.assignedTo.toString(),
      status: event.status,
      message: event.message,
      count: event.count,
      lastSeen: event.lastSeen,
    };
  }

  const now = new Date();
  closeActiveAssignment(event, now);

  event.assignedTo = member._id;
  if (!Array.isArray(event.assignmentHistory)) {
    event.assignmentHistory = [];
  }
  event.assignmentHistory.push({
    memberId: member._id,
    assignedAt: now,
    unassignedAt: null,
  });

  await event.save();
  analyticsCache.invalidateProject(project._id);

  return {
    id: event._id.toString(),
    assignedTo: member._id.toString(),
    status: event.status,
    message: event.message,
    count: event.count,
    lastSeen: event.lastSeen,
  };
};

const unassignError = async (project, errorId) => {
  if (!mongoose.Types.ObjectId.isValid(errorId)) {
    return null;
  }

  const event = await ErrorEvent.findOne({ _id: errorId, projectId: project._id });
  if (!event) {
    return null;
  }

  if (!event.assignedTo) {
    return {
      id: event._id.toString(),
      assignedTo: null,
      status: event.status,
      message: event.message,
      count: event.count,
      lastSeen: event.lastSeen,
    };
  }

  const now = new Date();
  closeActiveAssignment(event, now);
  event.assignedTo = null;
  await event.save();

  analyticsCache.invalidateProject(project._id);

  return {
    id: event._id.toString(),
    assignedTo: null,
    status: event.status,
    message: event.message,
    count: event.count,
    lastSeen: event.lastSeen,
  };
};

const deleteError = async (project, errorId) => {
  if (!mongoose.Types.ObjectId.isValid(errorId)) {
    return false;
  }

  const deletion = await ErrorEvent.deleteOne({ _id: errorId, projectId: project._id });
  if (!deletion.deletedCount) {
    return false;
  }

  await ErrorOccurrence.deleteMany({ errorId, projectId: project._id });
  analyticsCache.invalidateProject(project._id);
  return true;
};

module.exports = {
  ingestError,
  listErrors,
  getErrorDetail,
  updateErrorStatus,
   assignError,
   unassignError,
  deleteError,
};
