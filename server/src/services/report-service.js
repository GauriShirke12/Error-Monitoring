const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ReportRun = require('../models/ReportRun');
const ReportSchedule = require('../models/ReportSchedule');
const ShareToken = require('../models/ShareToken');
const Project = require('../models/Project');
const { renderReportToPdf, renderReportToXlsx } = require('../utils/report-renderer');
const {
  getOverviewAnalytics,
  getTrendsAnalytics,
  getTopErrorsAnalytics,
  getResolutionAnalytics,
  getUserImpactAnalytics,
} = require('./analytics-service');
const { sendReportEmail } = require('./email-service');
const logger = require('../utils/logger');

const REPORT_ROOT = process.env.REPORT_OUTPUT_ROOT || path.join(__dirname, '..', '..', 'logs', 'reports');
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_FORMATS = new Set(['pdf', 'xlsx']);
const VALID_RANGES = new Set(['24h', '7d', '30d']);

const ensureDirectory = async (targetPath) => {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
};

const formatDateLabel = (isoString) => {
  if (!isoString) {
    return 'unknown';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toISOString().slice(0, 10);
};

const buildRangeLabel = (range) => {
  if (!range) {
    return 'Custom range';
  }
  if (range.label) {
    return range.label;
  }
  if (range.start && range.end) {
    return `${formatDateLabel(range.start)} → ${formatDateLabel(range.end)}`;
  }
  return 'Custom range';
};

const parseRangeKey = (value) => {
  if (!value || typeof value !== 'string') {
    return '7d';
  }
  if (VALID_RANGES.has(value)) {
    return value;
  }
  return '7d';
};

const normalizeEnvironmentLabel = (environment) => {
  if (!environment) {
    return 'All environments';
  }
  const trimmed = environment.trim();
  if (!trimmed.length) {
    return 'All environments';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const buildRecommendations = (context) => {
  const recommendations = [];
  const metrics = context.metrics || {};
  const topErrors = Array.isArray(context.topErrors) ? context.topErrors : [];
  const userImpact = context.userImpact || {};
  const resolvedAverage = metrics.avgResolutionTimeMs || 0;
  const unresolvedCount = metrics.unresolvedCount || 0;
  const totalErrors = metrics.totalErrors || 0;

  if (metrics.activeErrors > metrics.resolvedErrors) {
    recommendations.push('Active errors outpace resolutions. Consider expanding on-call coverage or prioritising triage.');
  }

  if (resolvedAverage > 48 * 60 * 60 * 1000) {
    recommendations.push('Average time to resolve exceeds 48 hours. Review workflow bottlenecks and automate verification.');
  }

  if (topErrors.length) {
    const leading = topErrors[0];
    if (leading.count && totalErrors && leading.count / totalErrors >= 0.25) {
      recommendations.push('One error dominates incident volume. Dedicate a swarm session to the top recurring issue.');
    }
  }

  if (userImpact.summary?.uniqueUsers >= 100) {
    recommendations.push('High user impact detected. Communicate mitigation progress to customer-facing teams.');
  }

  if (unresolvedCount > 0 && !recommendations.length) {
    recommendations.push('Maintain steady follow-up on unresolved incidents to prevent backlog growth.');
  }

  if (!recommendations.length) {
    recommendations.push('Metrics look stable. Continue monitoring dashboards and automate anomaly alerts.');
  }

  return recommendations.slice(0, 5);
};

const buildReportPayload = async (project, options) => {
  const rangeKey = parseRangeKey(options.rangeKey);
  const environment = options.environment || null;
  const includeRecommendations = options.includeRecommendations !== false;
  const now = new Date();

  const [overview, trends, topErrorsDoc, resolution, userImpact] = await Promise.all([
    getOverviewAnalytics(project, { environment }),
    getTrendsAnalytics(project, {
      rangeKey,
      environment,
      startDate: options.startDate || null,
      endDate: options.endDate || null,
      compare: false,
    }),
    getTopErrorsAnalytics(project, { environment }),
    getResolutionAnalytics(project, { environment }),
    getUserImpactAnalytics(project, { environment }),
  ]);

  const metrics = {
    totalErrors: overview?.totals?.totalErrors?.current ?? 0,
    activeErrors: overview?.totals?.activeErrors24h?.current ?? 0,
    resolvedErrors: overview?.totals?.resolvedErrors24h?.current ?? 0,
    newErrors: overview?.totals?.newErrors24h?.current ?? 0,
    avgResolutionTimeMs: resolution?.summary?.averageResolveMs ?? 0,
    unresolvedCount: resolution?.summary?.unresolvedCount ?? 0,
  };

  const topErrors = (topErrorsDoc?.topByCount || []).map((entry) => ({
    id: entry.id,
    message: entry.message,
    count: entry.count,
    environment: entry.environment,
    status: entry.status,
    lastSeen: entry.lastSeen,
  }));

  const userImpactSegments = (userImpact?.topErrors || []).map((entry) => ({
    label: entry.message,
    count: entry.totalOccurrences,
    uniqueUsers: entry.uniqueUsers,
  }));

  const recommendations = includeRecommendations
    ? buildRecommendations({ metrics, topErrors, userImpact })
    : [];

  const range = {
    key: rangeKey,
    start: trends?.range?.displayStart ?? null,
    end: trends?.range?.displayEnd ?? null,
    label: buildRangeLabel({ start: trends?.range?.displayStart, end: trends?.range?.displayEnd }),
  };

  return {
    payload: {
      project: {
        id: project._id.toString(),
        name: project.name,
      },
      generatedAt: now.toISOString(),
      environment,
      environmentLabel: normalizeEnvironmentLabel(environment),
      range,
      metrics,
      topErrors,
      trends: trends?.timeSeries || [],
      userImpact: {
        summary: userImpact?.summary || { totalOccurrences: 0, uniqueUsers: 0, sessions: 0 },
        segments: userImpactSegments,
      },
      recommendations,
    },
    summary: {
      range,
      environment,
      environmentLabel: normalizeEnvironmentLabel(environment),
      metrics,
      totals: {
        occurrences: trends?.totals?.occurrences ?? 0,
        uniqueUsers: trends?.totals?.uniqueUsers ?? 0,
      },
      quickInsights: recommendations.slice(0, 3),
    },
  };
};

const writeReportFile = async (run, payload) => {
  const projectFolder = path.join(REPORT_ROOT, run.projectId.toString());
  await ensureDirectory(projectFolder);
  const extension = run.format === 'xlsx' ? 'xlsx' : 'pdf';
  const filePath = path.join(projectFolder, `${run._id.toString()}.${extension}`);

  if (run.format === 'xlsx') {
    await renderReportToXlsx(filePath, payload);
  } else {
    await renderReportToPdf(filePath, payload);
  }

  const stats = await fs.promises.stat(filePath);
  return {
    filePath,
    fileSize: stats.size,
  };
};

const generateReport = async (project, options = {}) => {
  const format = VALID_FORMATS.has(options.format) ? options.format : 'pdf';
  const requestedBy = options.requestedBy || null;
  const scheduleId = options.scheduleId || null;

  const { payload, summary } = await buildReportPayload(project, {
    environment: options.environment || null,
    rangeKey: options.range || options.rangeKey || '7d',
    startDate: options.startDate || null,
    endDate: options.endDate || null,
    includeRecommendations: options.includeRecommendations !== false,
  });

  const run = await ReportRun.create({
    projectId: project._id,
    scheduleId,
    requestedBy,
    range: {
      startDate: summary.range.start ? new Date(summary.range.start) : new Date(),
      endDate: summary.range.end ? new Date(summary.range.end) : new Date(),
      label: summary.range.label,
    },
    format,
    outputPath: '',
    fileSize: 0,
    summary,
    recommendations: payload.recommendations,
    status: 'pending',
  });

  try {
    const { filePath, fileSize } = await writeReportFile(run, payload);
    run.outputPath = filePath;
    run.fileSize = fileSize;
    run.status = 'success';
    await run.save();
  } catch (error) {
    logger.error({ err: error, runId: run._id.toString() }, 'Failed to render report');
    run.status = 'failed';
    run.error = error.message || 'Report generation failed';
    await run.save();
    throw error;
  }

  return ReportRun.findById(run._id).lean();
};

const listReportRuns = async (project, options = {}) => {
  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const limitRaw = parseInt(options.limit, 10);
  const limit = Math.min(Math.max(limitRaw || 10, 1), 50);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    ReportRun.find({ projectId: project._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReportRun.countDocuments({ projectId: project._id }),
  ]);

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

const getReportRun = async (project, runId) => {
  if (!mongoose.Types.ObjectId.isValid(runId)) {
    return null;
  }
  const run = await ReportRun.findOne({ _id: runId, projectId: project._id }).lean();
  return run || null;
};

const deleteReportRunFile = async (run) => {
  if (!run?.outputPath) {
    return;
  }
  try {
    await fs.promises.unlink(run.outputPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    logger.warn({ err: error, runId: run._id?.toString?.() }, 'Failed to delete report file');
  }
};

const deleteReportRun = async (project, runId) => {
  if (!mongoose.Types.ObjectId.isValid(runId)) {
    return false;
  }

  const run = await ReportRun.findOneAndDelete({ _id: runId, projectId: project._id });
  if (!run) {
    return false;
  }

  await deleteReportRunFile(run);
  return true;
};

const tokenToPath = (token) => `/api/reports/share/${token}`;

const createShareTokenForRun = async (project, run, options = {}) => {
  if (!run?.outputPath) {
    const error = new Error('Report file is not available for sharing');
    error.status = 409;
    throw error;
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expiresInHours = parseInt(options.expiresInHours, 10) || 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const shareDoc = await ShareToken.create({
    projectId: project._id,
    token,
    kind: 'report',
    format: run.format,
    parameters: {
      runId: run._id.toString(),
    },
    expiresAt,
    createdBy: options.createdBy || null,
    metadata: {
      fileName: path.basename(run.outputPath),
    },
  });

  return {
    token: shareDoc.token,
    expiresAt: shareDoc.expiresAt,
    path: tokenToPath(shareDoc.token),
  };
};

const resolveSharedToken = async (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const shareDoc = await ShareToken.findOne({ token }).lean();
  if (!shareDoc) {
    return null;
  }

  if (shareDoc.expiresAt && shareDoc.expiresAt < new Date()) {
    return null;
  }

  const runId = shareDoc.parameters?.runId;
  if (!runId || !mongoose.Types.ObjectId.isValid(runId)) {
    return null;
  }

  const run = await ReportRun.findById(runId).lean();
  if (!run || run.projectId.toString() !== shareDoc.projectId.toString()) {
    return null;
  }

  return {
    share: shareDoc,
    run,
  };
};

const listSchedules = async (project) => {
  const schedules = await ReportSchedule.find({ projectId: project._id })
    .sort({ createdAt: -1 })
    .lean();
  return schedules;
};

const parseTimeOfDay = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
};

const clampDayOfMonth = (year, month, requestedDay) => {
  const base = new Date(Date.UTC(year, month + 1, 0));
  const lastDay = base.getUTCDate();
  return Math.min(Math.max(requestedDay, 1), lastDay);
};

const computeNextRunAt = (schedule, reference = new Date()) => {
  const time = parseTimeOfDay(schedule.runAtUTC || '09:00');
  if (!time) {
    return null;
  }

  const base = new Date(reference.getTime());
  const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), time.hours, time.minutes, 0, 0));

  if (schedule.frequency === 'weekly') {
    const dayOfWeek = typeof schedule.dayOfWeek === 'number' ? schedule.dayOfWeek : 1;
    let daysAhead = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
    if (daysAhead === 0 && candidate <= reference) {
      daysAhead = 7;
    }
    candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
    return candidate;
  }

  if (schedule.frequency === 'monthly') {
    const requestedDay = typeof schedule.dayOfMonth === 'number' ? schedule.dayOfMonth : 1;
    let year = candidate.getUTCFullYear();
    let month = candidate.getUTCMonth();
    let day = clampDayOfMonth(year, month, requestedDay);
    let monthlyCandidate = new Date(Date.UTC(year, month, day, time.hours, time.minutes, 0, 0));
    if (monthlyCandidate <= reference) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      day = clampDayOfMonth(year, month, requestedDay);
      monthlyCandidate = new Date(Date.UTC(year, month, day, time.hours, time.minutes, 0, 0));
    }
    return monthlyCandidate;
  }

  if (schedule.frequency === 'custom') {
    const presetStart = schedule.parameters?.range?.startDate
      ? new Date(schedule.parameters.range.startDate)
      : null;
    if (presetStart && presetStart > reference) {
      return presetStart;
    }
    return null;
  }

  return null;
};

const createSchedule = async (project, payload) => {
  const frequency = payload.frequency;
  if (!['weekly', 'monthly', 'custom'].includes(frequency)) {
    const error = new Error('Invalid schedule frequency');
    error.status = 400;
    throw error;
  }

  const runTime = parseTimeOfDay(payload.runAtUTC || '09:00');
  if (!runTime) {
    const error = new Error('runAtUTC must be in HH:mm 24h format');
    error.status = 400;
    throw error;
  }

  const schedule = await ReportSchedule.create({
    projectId: project._id,
    name: (payload.name || 'Scheduled report').trim(),
    frequency,
    dayOfWeek: payload.dayOfWeek ?? null,
    dayOfMonth: payload.dayOfMonth ?? null,
    runAtUTC: payload.runAtUTC || '09:00',
    timezone: payload.timezone || 'UTC',
    format: VALID_FORMATS.has(payload.format) ? payload.format : 'pdf',
    parameters: {
      range: {
        preset: parseRangeKey(payload.parameters?.range?.preset || '7d'),
        startDate: payload.parameters?.range?.startDate || null,
        endDate: payload.parameters?.range?.endDate || null,
      },
      includeRecommendations: payload.parameters?.includeRecommendations !== false,
      environment: payload.parameters?.environment || null,
    },
    recipients: Array.isArray(payload.recipients)
      ? payload.recipients.filter((value) => typeof value === 'string' && value.includes('@')).map((value) => value.trim().toLowerCase())
      : [],
    active: payload.active !== false,
  });

  schedule.nextRunAt = computeNextRunAt(schedule);
  await schedule.save();
  return ReportSchedule.findById(schedule._id).lean();
};

const updateSchedule = async (project, scheduleId, payload) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
    return null;
  }

  const schedule = await ReportSchedule.findOne({ _id: scheduleId, projectId: project._id });
  if (!schedule) {
    return null;
  }

  if (payload.name) {
    schedule.name = String(payload.name).trim();
  }

  if (payload.frequency && ['weekly', 'monthly', 'custom'].includes(payload.frequency)) {
    schedule.frequency = payload.frequency;
  }

  if (payload.dayOfWeek !== undefined) {
    schedule.dayOfWeek = payload.dayOfWeek;
  }

  if (payload.dayOfMonth !== undefined) {
    schedule.dayOfMonth = payload.dayOfMonth;
  }

  if (payload.runAtUTC) {
    const time = parseTimeOfDay(payload.runAtUTC);
    if (!time) {
      const error = new Error('runAtUTC must be in HH:mm 24h format');
      error.status = 400;
      throw error;
    }
    schedule.runAtUTC = payload.runAtUTC;
  }

  if (payload.parameters) {
    schedule.parameters = {
      ...schedule.parameters,
      range: {
        preset: parseRangeKey(payload.parameters?.range?.preset || schedule.parameters?.range?.preset || '7d'),
        startDate: payload.parameters?.range?.startDate || schedule.parameters?.range?.startDate || null,
        endDate: payload.parameters?.range?.endDate || schedule.parameters?.range?.endDate || null,
      },
      includeRecommendations:
        payload.parameters?.includeRecommendations !== undefined
          ? payload.parameters.includeRecommendations
          : schedule.parameters?.includeRecommendations,
      environment:
        payload.parameters?.environment !== undefined
          ? payload.parameters.environment
          : schedule.parameters?.environment,
    };
  }

  if (payload.recipients) {
    schedule.recipients = Array.isArray(payload.recipients)
      ? payload.recipients.filter((value) => typeof value === 'string' && value.includes('@')).map((value) => value.trim().toLowerCase())
      : [];
  }

  if (payload.active !== undefined) {
    schedule.active = Boolean(payload.active);
  }

  schedule.nextRunAt = computeNextRunAt(schedule);
  await schedule.save();
  return ReportSchedule.findById(schedule._id).lean();
};

const deleteSchedule = async (project, scheduleId) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
    return false;
  }
  const deleted = await ReportSchedule.findOneAndDelete({ _id: scheduleId, projectId: project._id });
  return Boolean(deleted);
};

const runScheduleNow = async (project, scheduleId) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
    return null;
  }
  const schedule = await ReportSchedule.findOne({ _id: scheduleId, projectId: project._id });
  if (!schedule) {
    return null;
  }

  const run = await generateReport(project, {
    format: schedule.format,
    range: schedule.parameters?.range?.preset || '7d',
    environment: schedule.parameters?.environment || null,
    includeRecommendations: schedule.parameters?.includeRecommendations !== false,
    startDate: schedule.parameters?.range?.startDate || null,
    endDate: schedule.parameters?.range?.endDate || null,
    scheduleId: schedule._id,
  });

  schedule.lastRunAt = new Date();
  schedule.nextRunAt = computeNextRunAt(schedule, new Date(Date.now() + 60 * 1000));
  if (schedule.frequency === 'custom' && !schedule.nextRunAt) {
    schedule.active = false;
  }
  await schedule.save();

  return run;
};

const processDueSchedules = async () => {
  const now = new Date();
  const dueSchedules = await ReportSchedule.find({
    active: true,
    nextRunAt: { $ne: null, $lte: now },
  })
    .sort({ nextRunAt: 1 })
    .lean();

  if (!dueSchedules.length) {
    return;
  }

  for (const scheduleDoc of dueSchedules) {
    try {
      const project = await Project.findById(scheduleDoc.projectId).lean();
      if (!project) {
        await ReportSchedule.updateOne({ _id: scheduleDoc._id }, { active: false, nextRunAt: null });
        continue;
      }

      const schedule = await ReportSchedule.findById(scheduleDoc._id);
      if (!schedule || !schedule.active) {
        continue;
      }

      const run = await generateReport(project, {
        format: schedule.format,
        range: schedule.parameters?.range?.preset || '7d',
        environment: schedule.parameters?.environment || null,
        includeRecommendations: schedule.parameters?.includeRecommendations !== false,
        startDate: schedule.parameters?.range?.startDate || null,
        endDate: schedule.parameters?.range?.endDate || null,
        scheduleId: schedule._id,
      });

      schedule.lastRunAt = new Date();
      const next = computeNextRunAt(schedule, new Date(Date.now() + 60 * 1000));
      schedule.nextRunAt = next;
      if (schedule.frequency === 'custom' && !next) {
        schedule.active = false;
      }
      await schedule.save();

      if (Array.isArray(schedule.recipients) && schedule.recipients.length) {
        const share = await createShareTokenForRun(project, run, { expiresInHours: 168 });
        await sendReportEmail({ project, schedule, run, shareLink: share.path });
      }
    } catch (error) {
      logger.error({ err: error, scheduleId: scheduleDoc._id.toString() }, 'Failed to process report schedule');
      await ReportSchedule.updateOne(
        { _id: scheduleDoc._id },
        {
          $set: {
            lastErrorAt: new Date(),
            lastErrorMessage: error.message,
            nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        }
      );
    }
  }
};

module.exports = {
  generateReport,
  listReportRuns,
  getReportRun,
  deleteReportRun,
  createShareTokenForRun,
  resolveSharedToken,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  processDueSchedules,
};
