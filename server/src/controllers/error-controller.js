const mongoose = require('mongoose');
const {
  ingestError,
  listErrors,
  getErrorDetail,
  updateErrorStatus,
  deleteError,
  assignError,
  unassignError,
} = require('../services/error-service');
const logger = require('../utils/logger');

const ALLOWED_SORT_FIELDS = new Set(['lastSeen', 'firstSeen', 'count', 'message', 'environment']);

const parseDateParam = (value, { endOfDay = false } = {}) => {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
};

const CLEANED_SORT_FIELDS = new Map([
  ["lastSeen", "lastSeen"],
  ["firstSeen", "firstSeen"],
  ["count", "count"],
  ["message", "message"],
  ["environment", "environment"],
]);

const parseListQuery = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limitRaw = parseInt(query.limit, 10);
  const limit = Math.min(Math.max(limitRaw || 20, 1), 100);
  const environment = typeof query.environment === 'string' ? query.environment : undefined;
  const status = typeof query.status === 'string' ? query.status : undefined;
  const requestedSort = typeof query.sortBy === 'string' ? query.sortBy : undefined;
  const sortBy = requestedSort && CLEANED_SORT_FIELDS.has(requestedSort) ? requestedSort : 'lastSeen';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  let startDate = parseDateParam(query.startDate || query.start);
  let endDate = parseDateParam(query.endDate || query.end, { endOfDay: true });
  const search = typeof query.search === 'string' ? query.search.trim() : undefined;
  const sourceFileRaw = typeof query.sourceFile === 'string' ? query.sourceFile.trim() : undefined;
  const sourceFile = sourceFileRaw && sourceFileRaw.length ? sourceFileRaw : undefined;

  if (startDate && endDate && startDate > endDate) {
    const swap = startDate;
    startDate = new Date(endDate);
    endDate = new Date(swap);
  }

  return {
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
  };
};

const createError = async (req, res, next) => {
  try {
    const result = await ingestError(req.body, req.project);

    return res.status(201).json({
      data: {
        id: result.occurrence._id,
        errorId: result.errorEvent._id,
        fingerprint: result.fingerprint,
        count: result.errorEvent.count,
        status: result.errorEvent.status,
        isNew: result.isNew,
        lastSeen: result.errorEvent.lastSeen,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to ingest error event');

    if (
      error instanceof mongoose.Error ||
      (error && typeof error === 'object' && typeof error.name === 'string' && error.name.includes('Mongo'))
    ) {
      return res.status(202).json({
        data: {
          accepted: true,
        },
      });
    }

    return next(error);
  }
};

module.exports = {
  createError,
  listErrors: async (req, res, next) => {
    try {
      const options = parseListQuery(req.query || {});
      if (options.status && !['new', 'open', 'investigating', 'resolved', 'ignored', 'muted'].includes(options.status)) {
        return res.status(400).json({ error: { message: 'Invalid status filter' } });
      }

      const result = await listErrors(req.project, options);
      return res.status(200).json({ data: result.items, meta: result.meta });
    } catch (error) {
      return next(error);
    }
  },
  getError: async (req, res, next) => {
    try {
      const detail = await getErrorDetail(req.project, req.params.id);
      if (!detail) {
        return res.status(404).json({ error: { message: 'Error not found' } });
      }

      return res.status(200).json({ data: detail });
    } catch (error) {
      return next(error);
    }
  },
  updateError: async (req, res, next) => {
    try {
      const { status } = req.body || {};
      if (!status) {
        return res.status(400).json({ error: { message: 'Status is required' } });
      }

      const updated = await updateErrorStatus(req.project, req.params.id, status, {
        changedBy: req.body?.changedBy || null,
      });
      if (!updated) {
        return res.status(404).json({ error: { message: 'Error not found' } });
      }

      return res.status(200).json({ data: updated });
    } catch (error) {
      return next(error);
    }
  },
  updateAssignment: async (req, res, next) => {
    try {
      const memberId = req.body?.memberId;

      let result;
      if (memberId === undefined || memberId === null || memberId === '') {
        result = await unassignError(req.project, req.params.id);
      } else {
        result = await assignError(req.project, req.params.id, memberId);
      }

      if (!result) {
        return res.status(404).json({ error: { message: 'Error not found' } });
      }

      return res.status(200).json({ data: result });
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      return next(error);
    }
  },
  deleteError: async (req, res, next) => {
    try {
      const deleted = await deleteError(req.project, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: { message: 'Error not found' } });
      }

      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
};
