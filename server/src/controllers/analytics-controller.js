const {
  getOverviewAnalytics,
  getTrendsAnalytics,
  getTopErrorsAnalytics,
  getRelatedErrorsAnalytics,
  getUserImpactAnalytics,
  getResolutionAnalytics,
  getPatternsAnalytics,
  createDeploymentMarker,
  listDeploymentMarkers,
} = require('../services/analytics-service');

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_RANGES = new Set(['24h', '7d', '30d', 'custom']);

const parseRange = (value) => {
  if (!value) {
    return '24h';
  }
  if (VALID_RANGES.has(value)) {
    return value;
  }
  return null;
};

const parseEnvironment = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
};

const parseDateValue = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const parseBoolean = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
};

module.exports = {
  getOverview: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getOverviewAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getTrends: async (req, res, next) => {
    try {
      const range = parseRange(req.query?.range);
      if (!range) {
        return res.status(400).json({ error: { message: 'Invalid range. Allowed values: 24h, 7d, 30d' } });
      }

      const environment = parseEnvironment(req.query?.environment);
      let startDate;
      let endDate;

      if (range === 'custom') {
        startDate = parseDateValue(req.query?.startDate || req.query?.start);
        endDate = parseDateValue(req.query?.endDate || req.query?.end);

        if (!startDate || !endDate) {
          return res.status(400).json({ error: { message: 'Custom range requires valid startDate and endDate ISO strings' } });
        }

        if (startDate > endDate) {
          const temp = startDate;
          startDate = endDate;
          endDate = temp;
        }

        const diffMs = endDate.getTime() - startDate.getTime();
        if (diffMs < DAY_MS) {
          return res.status(400).json({ error: { message: 'Custom range must span at least 1 day' } });
        }
        if (diffMs > 90 * DAY_MS) {
          return res.status(400).json({ error: { message: 'Custom range cannot exceed 90 days' } });
        }
      }

      const compare = parseBoolean(req.query?.compare);
      const data = await getTrendsAnalytics(req.project, {
        rangeKey: range,
        environment,
        startDate,
        endDate,
        compare,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getTopErrors: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getTopErrorsAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getPatterns: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getPatternsAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getRelatedErrors: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getRelatedErrorsAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getUserImpact: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getUserImpactAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  getResolution: async (req, res, next) => {
    try {
      const environment = parseEnvironment(req.query?.environment);
      const data = await getResolutionAnalytics(req.project, {
        environment,
      });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  listDeployments: async (req, res, next) => {
    try {
      const limitRaw = parseInt(req.query?.limit, 10);
      const limit = Number.isNaN(limitRaw) ? undefined : limitRaw;
      const data = await listDeploymentMarkers(req.project, { limit });
      return res.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  },
  createDeployment: async (req, res, next) => {
    try {
      const { label, timestamp, metadata } = req.body || {};

      if (metadata && typeof metadata !== 'object') {
        return res.status(400).json({ error: { message: 'metadata must be an object when provided' } });
      }

      const marker = await createDeploymentMarker(req.project, {
        label,
        timestamp,
        metadata,
      });

      return res.status(201).json({ data: marker });
    } catch (error) {
      return next(error);
    }
  },
};
