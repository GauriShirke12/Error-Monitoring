const path = require('path');
const fs = require('fs');
const {
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
} = require('../services/report-service');
const logger = require('../utils/logger');

const parseFormat = (value) => {
  if (value === 'xlsx') {
    return 'xlsx';
  }
  return 'pdf';
};

const parseRange = (value) => {
  if (['24h', '7d', '30d'].includes(value)) {
    return value;
  }
  return '7d';
};

module.exports = {
  requestReport: async (req, res, next) => {
    try {
      const format = parseFormat(req.body?.format);
      const range = parseRange(req.body?.range || req.body?.rangeKey);
      const environment = typeof req.body?.environment === 'string' ? req.body.environment.trim() : null;
      const includeRecommendations = req.body?.includeRecommendations;

      const run = await generateReport(req.project, {
        format,
        range,
        environment,
        includeRecommendations,
        startDate: req.body?.startDate || null,
        endDate: req.body?.endDate || null,
      });

      return res.status(201).json({ data: run });
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate on-demand report');
      return next(error);
    }
  },
  listRuns: async (req, res, next) => {
    try {
      const runs = await listReportRuns(req.project, req.query);
      return res.status(200).json({ data: runs.items, meta: runs.meta });
    } catch (error) {
      return next(error);
    }
  },
  getRun: async (req, res, next) => {
    try {
      const run = await getReportRun(req.project, req.params.id);
      if (!run) {
        return res.status(404).json({ error: { message: 'Report run not found' } });
      }
      return res.status(200).json({ data: run });
    } catch (error) {
      return next(error);
    }
  },
  deleteRun: async (req, res, next) => {
    try {
      const deleted = await deleteReportRun(req.project, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: { message: 'Report run not found' } });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
  downloadRun: async (req, res, next) => {
    try {
      const run = await getReportRun(req.project, req.params.id);
      if (!run || run.status !== 'success' || !run.outputPath) {
        return res.status(404).json({ error: { message: 'Report file not available' } });
      }

      if (!run.outputPath.startsWith(path.resolve(run.outputPath))) {
        return res.status(400).json({ error: { message: 'Invalid report path' } });
      }

      const stream = fs.createReadStream(run.outputPath);
      stream.on('error', (streamError) => next(streamError));
      res.setHeader('Content-Type', run.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report-${run._id}.${run.format === 'xlsx' ? 'xlsx' : 'pdf'}"`);
      stream.pipe(res);
    } catch (error) {
      return next(error);
    }
  },
  createShareToken: async (req, res, next) => {
    try {
      const run = await getReportRun(req.project, req.params.id);
      if (!run) {
        return res.status(404).json({ error: { message: 'Report run not found' } });
      }

      const share = await createShareTokenForRun(req.project, run, {
        expiresInHours: req.body?.expiresInHours,
      });

      return res.status(201).json({ data: share });
    } catch (error) {
      return next(error);
    }
  },
  downloadShare: async (req, res, next) => {
    try {
      const share = await resolveSharedToken(req.params.token);
      if (!share) {
        return res.status(404).json({ error: { message: 'Share link expired or invalid' } });
      }

      const { run } = share;
      if (!run.outputPath) {
        return res.status(404).json({ error: { message: 'Report file missing' } });
      }

      const stream = fs.createReadStream(run.outputPath);
      stream.on('error', (streamError) => next(streamError));
      res.setHeader('Content-Type', run.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="shared-report-${run._id}.${run.format === 'xlsx' ? 'xlsx' : 'pdf'}"`);
      stream.pipe(res);
    } catch (error) {
      return next(error);
    }
  },
  listSchedules: async (req, res, next) => {
    try {
      const schedules = await listSchedules(req.project);
      return res.status(200).json({ data: schedules });
    } catch (error) {
      return next(error);
    }
  },
  createSchedule: async (req, res, next) => {
    try {
      const schedule = await createSchedule(req.project, req.body || {});
      return res.status(201).json({ data: schedule });
    } catch (error) {
      return next(error);
    }
  },
  updateSchedule: async (req, res, next) => {
    try {
      const schedule = await updateSchedule(req.project, req.params.id, req.body || {});
      if (!schedule) {
        return res.status(404).json({ error: { message: 'Schedule not found' } });
      }
      return res.status(200).json({ data: schedule });
    } catch (error) {
      return next(error);
    }
  },
  deleteSchedule: async (req, res, next) => {
    try {
      const deleted = await deleteSchedule(req.project, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: { message: 'Schedule not found' } });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
  runScheduleNow: async (req, res, next) => {
    try {
      const run = await runScheduleNow(req.project, req.params.id);
      if (!run) {
        return res.status(404).json({ error: { message: 'Schedule not found' } });
      }
      return res.status(201).json({ data: run });
    } catch (error) {
      return next(error);
    }
  },
};
