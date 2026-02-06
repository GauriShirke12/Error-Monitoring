const ErrorEvent = require('../models/Error');
const ErrorOccurrence = require('../models/Occurrence');
const Deployment = require('../models/Deployment');
const analyticsCache = require('../utils/analytics-cache');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const SPIKE_LOOKBACK_BUCKETS = 6;
const SPIKE_THRESHOLD_MULTIPLIER = 2;
const MAX_SPIKES = 5;
const DEPLOYMENT_IMPACT_LIMIT = 6;
const DEPLOYMENT_IMPACT_WINDOW_BEFORE_MS = 2 * HOUR_MS;
const DEPLOYMENT_IMPACT_WINDOW_AFTER_MS = 2 * HOUR_MS;
const CORRELATION_WINDOW_MS = 5 * 60 * 1000;
const MAX_CORRELATION_GROUPS = 300;
const MAX_CORRELATION_EDGES = 25;
const MAX_CORRELATION_SAMPLES = 5;
const MAX_CORRELATION_GROUP_OUTPUT = 20;
const HOTSPOT_LOOKBACK_MS = 30 * DAY_MS;
const CORRELATION_LOOKBACK_MS = 14 * DAY_MS;
const USER_IMPACT_LOOKBACK_MS = 30 * DAY_MS;

const DEFAULT_AGGREGATION_OPTIONS = Object.freeze({
  allowDiskUse: true,
});

const runAggregation = async (Model, pipeline, options = {}) => {
  try {
    return await Model.aggregate(pipeline).option({ ...DEFAULT_AGGREGATION_OPTIONS, ...options });
  } catch (error) {
    if ((options && options.hint) && (error?.code === 2 || error?.codeName === 'BadValue')) {
      const { hint, ...rest } = options;
      return Model.aggregate(pipeline).option({ ...DEFAULT_AGGREGATION_OPTIONS, ...rest });
    }
    throw error;
  }
};

const buildOccurrenceHint = (filter = {}) => {
  if (filter.environment) {
    return { projectId: 1, environment: 1, timestamp: -1 };
  }
  return { projectId: 1, timestamp: -1 };
};

const buildErrorEventFirstSeenHint = (environment) => (
  environment ? { projectId: 1, environment: 1, firstSeen: 1 } : { projectId: 1, firstSeen: 1 }
);

const buildErrorEventStatusHint = (environment) => (
  environment
    ? { projectId: 1, environment: 1, status: 1, lastSeen: -1 }
    : { projectId: 1, status: 1, lastSeen: -1 }
);

const countDocumentsSafe = async (Model, filter, hint) => {
  try {
    if (hint) {
      return await Model.countDocuments(filter).hint(hint);
    }
    return await Model.countDocuments(filter);
  } catch (error) {
    if (error?.code === 2 || error?.codeName === 'BadValue') {
      // Fallback for in-memory MongoDB instances that do not support provided hints
      return Model.countDocuments(filter);
    }
    throw error;
  }
};

const RANGE_CONFIG = Object.freeze({
  '24h': {
    unit: 'hour',
    bucketSizeMs: HOUR_MS,
    bucketCount: 24,
  },
  '7d': {
    unit: 'day',
    bucketSizeMs: DAY_MS,
    bucketCount: 7,
  },
  '30d': {
    unit: 'day',
    bucketSizeMs: DAY_MS,
    bucketCount: 30,
  },
});

const alignDate = (input, unit) => {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }
  if (unit === 'hour') {
    date.setUTCMinutes(0, 0, 0);
    return date;
  }
  if (unit === 'day') {
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
  date.setUTCSeconds(0, 0);
  return date;
};

const buildTimeSeriesGroupId = (unit) => ({
  $dateTrunc: {
    date: '$timestamp',
    unit: unit === 'hour' ? 'hour' : 'day',
  },
});

const sortSpecForUnit = () => ({ _id: 1 });

const LABEL_FORMATTERS = {
  hour: new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  day: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
};

const formatLabel = (date, unit) => {
  const formatter = LABEL_FORMATTERS[unit] || LABEL_FORMATTERS.day;
  return formatter.format(date);
};

const fillTimeSeries = (rawSeries, unit, start, bucketSizeMs, bucketCount) => {
  const map = new Map();
  const globalUsers = new Set();
  let totalOccurrences = 0;

  rawSeries.forEach((entry) => {
    const bucketStart = entry._id instanceof Date ? new Date(entry._id.getTime()) : new Date(entry._id);
    if (Number.isNaN(bucketStart.getTime())) {
      return;
    }
    const key = bucketStart.getTime();
    const userSet = new Set(
      (entry.users || [])
        .filter((userId) => userId !== null && userId !== undefined)
        .map((userId) => userId.toString())
    );
    userSet.forEach((userId) => globalUsers.add(userId));
    map.set(key, {
      count: entry.count ?? 0,
      uniqueUsers: userSet.size,
    });
    totalOccurrences += entry.count ?? 0;
  });

  const data = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = new Date(start.getTime() + index * bucketSizeMs);
    const key = bucketStart.getTime();
    const value = map.get(key) || { count: 0, uniqueUsers: 0 };
    data.push({
      bucketStart: bucketStart.toISOString(),
      label: formatLabel(bucketStart, unit),
      count: value.count,
      uniqueUsers: value.uniqueUsers,
    });
  }

  return {
    buckets: data,
    totalOccurrences,
    totalUniqueUsers: globalUsers.size,
  };
};

const computeHotspots = async (project, options = {}) => {
  const { environment } = options;
  const match = { projectId: project._id };
  if (environment) {
    match.environment = environment;
  }

  const now = new Date();
  const last24h = new Date(now.getTime() - DAY_MS);
  const last7d = new Date(now.getTime() - WEEK_MS);
  const lookbackStart = new Date(now.getTime() - HOTSPOT_LOOKBACK_MS);
  match.timestamp = { $gte: lookbackStart };

  const hint = buildOccurrenceHint(match);

  const primaryFrameExpression = buildPrimaryFrameFileExpression();
  const hotspotSourceExpression = buildCoalesceExpression(
    [
      '$primarySourceFile',
      '$metadata.sourceFile',
      '$metadata.file',
      '$metadata.source',
      '$metadata.component',
      '$metadata.name',
    ],
    'unknown'
  );

  const docs = await runAggregation(
    ErrorOccurrence,
    [
      { $match: match },
      {
        $project: {
          errorId: 1,
          message: 1,
          timestamp: 1,
          metadata: 1,
          stackTrace: 1,
        },
      },
      {
        $addFields: {
          primarySourceFile: primaryFrameExpression,
        },
      },
      {
        $addFields: {
          hotspotSource: hotspotSourceExpression,
        },
      },
      {
        $addFields: {
          hotspotKey: {
            $toLower: {
              $ifNull: ['$hotspotSource', 'unknown'],
            },
          },
        },
      },
      {
        $group: {
          _id: '$hotspotKey',
          source: { $first: '$hotspotSource' },
          occurrences: { $sum: 1 },
          errorIds: { $addToSet: '$errorId' },
          lastSeen: { $max: '$timestamp' },
          recentOccurrences24h: {
            $sum: {
              $cond: [{ $gte: ['$timestamp', last24h] }, 1, 0],
            },
          },
          recentOccurrences7d: {
            $sum: {
              $cond: [{ $gte: ['$timestamp', last7d] }, 1, 0],
            },
          },
          samples: {
            $push: {
              errorId: '$errorId',
              message: '$message',
              timestamp: '$timestamp',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          source: '$source',
          occurrences: 1,
          errorIds: 1,
          lastSeen: 1,
          recentOccurrences24h: 1,
          recentOccurrences7d: 1,
          recentSamples: { $slice: ['$samples', 5] },
        },
      },
      {
        $addFields: {
          errorCount: { $size: '$errorIds' },
        },
      },
      { $sort: { occurrences: -1 } },
      { $limit: 10 },
    ],
    { hint }
  );

  return docs.map((doc) => ({
    filePath: normalizeHotspotLabel(doc.source),
    occurrenceCount: doc.occurrences,
    errorCount: doc.errorCount,
    lastSeen: doc.lastSeen,
    recentOccurrences24h: doc.recentOccurrences24h,
    recentOccurrences7d: doc.recentOccurrences7d,
    sampleErrors: (doc.recentSamples || []).slice(0, 3).map((sample) => ({
      errorId: sample.errorId?.toString?.() ?? null,
      message: sample.message,
      timestamp: sample.timestamp,
    })),
  }));
};

const computeSpikeContributors = async (project, spike, options = {}) => {
  const bucketStart = new Date(spike.bucketStart);
  const bucketEnd = new Date(bucketStart.getTime() + spike.bucketSizeMs);
  const match = {
    projectId: project._id,
    timestamp: {
      $gte: bucketStart,
      $lt: bucketEnd,
    },
  };
  if (options.environment) {
    match.environment = options.environment;
  }

  const docs = await runAggregation(
    ErrorOccurrence,
    [
      { $match: match },
      {
        $group: {
          _id: '$errorId',
          occurrences: { $sum: 1 },
        },
      },
      { $sort: { occurrences: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: 'errorevents',
          localField: '_id',
          foreignField: '_id',
          as: 'error',
        },
      },
      { $unwind: { path: '$error', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          errorId: { $toString: '$_id' },
          occurrences: 1,
          message: '$error.message',
          environment: '$error.environment',
        },
      },
    ],
    { hint: buildOccurrenceHint(match) }
  );

  return docs;
};

const computeErrorSpikes = async (project, options = {}) => {
  const { environment } = options;

  const trend = await computeTrends(project, {
    rangeKey: '24h',
    environment,
    compare: false,
  });

  const buckets = trend.timeSeries || [];
  const bucketSizeMs = trend.range?.bucketSizeMs ?? HOUR_MS;

  const timeline = [];
  const spikes = [];

  buckets.forEach((bucket, index) => {
    const previousBuckets = buckets.slice(Math.max(0, index - SPIKE_LOOKBACK_BUCKETS), index);
    const baselineTotal = previousBuckets.reduce((sum, entry) => sum + (entry.count ?? 0), 0);
    const baselineCount = previousBuckets.length || 1;
    const baselineAverage = baselineTotal / baselineCount;
    const multiplier = baselineAverage > 0 ? (bucket.count ?? 0) / baselineAverage : null;
    const isSpike =
      previousBuckets.length >= 1 &&
      baselineAverage > 0 &&
      (bucket.count ?? 0) >= baselineAverage * SPIKE_THRESHOLD_MULTIPLIER;

    const timelineEntry = {
      bucketStart: bucket.bucketStart,
      label: bucket.label,
      count: bucket.count ?? 0,
      uniqueUsers: bucket.uniqueUsers ?? 0,
      baseline: baselineAverage,
      multiplier,
      isSpike,
    };
    timeline.push(timelineEntry);

    if (isSpike) {
      spikes.push({
        ...timelineEntry,
        bucketSizeMs,
      });
    }
  });

  const rankedSpikes = spikes
    .sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0))
    .slice(0, MAX_SPIKES);

  const enrichedSpikes = await Promise.all(
    rankedSpikes.map(async (spike) => ({
      ...spike,
      contributors: await computeSpikeContributors(project, spike, { environment }),
    }))
  );

  return {
    timeline,
    spikes: enrichedSpikes,
    parameters: {
      lookbackBuckets: SPIKE_LOOKBACK_BUCKETS,
      thresholdMultiplier: SPIKE_THRESHOLD_MULTIPLIER,
    },
  };
};

const computeDeploymentImpact = async (project, options = {}) => {
  const { environment } = options;

  const deployments = await Deployment.find({ projectId: project._id })
    .sort({ timestamp: -1 })
    .limit(DEPLOYMENT_IMPACT_LIMIT)
    .lean();

  if (!deployments.length) {
    return {
      deployments: [],
      parameters: {
        windowBeforeMs: DEPLOYMENT_IMPACT_WINDOW_BEFORE_MS,
        windowAfterMs: DEPLOYMENT_IMPACT_WINDOW_AFTER_MS,
      },
    };
  }

  const results = [];

  for (const deployment of deployments) {
    const deploymentTimestamp = deployment.timestamp instanceof Date
      ? deployment.timestamp
      : new Date(deployment.timestamp);
    const beforeStart = new Date(deploymentTimestamp.getTime() - DEPLOYMENT_IMPACT_WINDOW_BEFORE_MS);
    const afterEnd = new Date(deploymentTimestamp.getTime() + DEPLOYMENT_IMPACT_WINDOW_AFTER_MS);

    const match = {
      projectId: project._id,
      timestamp: {
        $gte: beforeStart,
        $lt: afterEnd,
      },
    };
    if (environment) {
      match.environment = environment;
    }

    const impactDocs = await runAggregation(
      ErrorOccurrence,
      [
        { $match: match },
        {
          $project: {
            timestamp: 1,
            window: {
              $cond: [{ $lt: ['$timestamp', deploymentTimestamp] }, 'before', 'after'],
            },
            userId: { $ifNull: ['$userContext.userId', null] },
          },
        },
        {
          $group: {
            _id: '$window',
            occurrences: { $sum: 1 },
            users: { $addToSet: '$userId' },
          },
        },
      ],
      { hint: buildOccurrenceHint(match) }
    );

    const beforeDoc = impactDocs.find((doc) => doc._id === 'before');
    const afterDoc = impactDocs.find((doc) => doc._id === 'after');

    const beforeOccurrences = beforeDoc?.occurrences ?? 0;
    const afterOccurrences = afterDoc?.occurrences ?? 0;
    const beforeUsers = countUniqueUsers(beforeDoc?.users);
    const afterUsers = countUniqueUsers(afterDoc?.users);

    const changeAbsolute = afterOccurrences - beforeOccurrences;
    const changePercentage = beforeOccurrences === 0
      ? null
      : (changeAbsolute / Math.max(beforeOccurrences, 1)) * 100;

    const rollbackSuggested = beforeOccurrences > 0
      ? afterOccurrences >= beforeOccurrences * SPIKE_THRESHOLD_MULTIPLIER
      : afterOccurrences >= 10;

    results.push({
      id: deployment._id.toString(),
      label: deployment.label || null,
      timestamp: deploymentTimestamp,
      metadata: deployment.metadata || {},
      window: {
        beforeStart,
        afterEnd,
      },
      metrics: {
        before: {
          occurrences: beforeOccurrences,
          uniqueUsers: beforeUsers,
        },
        after: {
          occurrences: afterOccurrences,
          uniqueUsers: afterUsers,
        },
        changeAbsolute,
        changePercentage,
        rollbackSuggested,
      },
    });
  }

  return {
    deployments: results,
    parameters: {
      windowBeforeMs: DEPLOYMENT_IMPACT_WINDOW_BEFORE_MS,
      windowAfterMs: DEPLOYMENT_IMPACT_WINDOW_AFTER_MS,
    },
  };
};

const computeRelatedErrors = async (project, options = {}) => {
  const { environment } = options;
  const match = { projectId: project._id };
  if (environment) {
    match.environment = environment;
  }

  const lookbackStart = new Date(Date.now() - CORRELATION_LOOKBACK_MS);
  match.timestamp = { $gte: lookbackStart };

  const sessionExpression = buildSessionKeyExpression();

  const buildCorrelationPipeline = (useWindow) => {
    const pipeline = [
      { $match: match },
      {
        $project: {
          timestamp: 1,
          errorId: 1,
          message: 1,
          userContext: 1,
          metadata: 1,
        },
      },
      {
        $addFields: {
          correlationSession: sessionExpression,
        },
      },
    ];

    if (useWindow) {
      pipeline.push({
        $addFields: {
          correlationWindowStart: {
            $toDate: {
              $subtract: [
                { $toLong: '$timestamp' },
                { $mod: [{ $toLong: '$timestamp' }, CORRELATION_WINDOW_MS] },
              ],
            },
          },
        },
      });
    }

    pipeline.push({
      $group: {
        _id: useWindow
          ? { session: '$correlationSession', window: '$correlationWindowStart' }
          : { session: '$correlationSession' },
        errorIds: { $addToSet: '$errorId' },
        sampleErrors: {
          $push: {
            errorId: '$errorId',
            message: '$message',
            timestamp: '$timestamp',
            window: useWindow ? '$correlationWindowStart' : '$timestamp',
          },
        },
      },
    });

    pipeline.push({
      $addFields: {
        groupSize: { $size: '$errorIds' },
      },
    });

    pipeline.push({
      $match: {
        groupSize: { $gte: 2 },
      },
    });

    pipeline.push({ $sort: { groupSize: -1 } });
    pipeline.push({ $limit: MAX_CORRELATION_GROUPS });
    pipeline.push({
      $project: {
        _id: 0,
        session: '$_id.session',
        window: useWindow ? '$_id.window' : null,
        errorIds: 1,
        groupSize: 1,
        sampleErrors: { $slice: ['$sampleErrors', MAX_CORRELATION_SAMPLES] },
      },
    });

    return pipeline;
  };

  let groups = await runAggregation(
    ErrorOccurrence,
    buildCorrelationPipeline(true),
    { hint: buildOccurrenceHint(match) }
  );

  if (!groups.length) {
    groups = await runAggregation(
      ErrorOccurrence,
      buildCorrelationPipeline(false),
      { hint: buildOccurrenceHint(match) }
    );
  }

  if (!groups.length) {
    return {
      nodes: [],
      edges: [],
      groups: [],
      parameters: {
        windowMs: CORRELATION_WINDOW_MS,
      },
    };
  }

  const pairMap = new Map();
  const nodeStats = new Map();
  const sessionGroups = [];

  for (const group of groups) {
    const windowDate = group.window
      ? (group.window instanceof Date ? group.window : new Date(group.window))
      : null;
    const errorIds = (group.errorIds || []).map((id) => (id ? id.toString() : null)).filter(Boolean);

    if (errorIds.length < 2) {
      continue;
    }

    errorIds.sort();

    errorIds.forEach((errorId) => {
      if (!nodeStats.has(errorId)) {
        nodeStats.set(errorId, { groups: 0 });
      }
      const stats = nodeStats.get(errorId);
      stats.groups += 1;
    });

    for (let i = 0; i < errorIds.length - 1; i += 1) {
      for (let j = i + 1; j < errorIds.length; j += 1) {
        const source = errorIds[i];
        const target = errorIds[j];
        const pairKey = `${source}|${target}`;

        if (!pairMap.has(pairKey)) {
          pairMap.set(pairKey, {
            count: 0,
            samples: [],
          });
        }

        const entry = pairMap.get(pairKey);
        entry.count += 1;
        if (entry.samples.length < MAX_CORRELATION_SAMPLES) {
          entry.samples.push({
            session: group.session || 'unknown',
            window: windowDate,
            errorIds: [...errorIds],
          });
        }
      }
    }

    if (sessionGroups.length < MAX_CORRELATION_GROUP_OUTPUT) {
      sessionGroups.push({
        session: group.session || 'unknown',
        window: windowDate,
        errorIds: [...errorIds],
      });
    }
  }

  if (!pairMap.size) {
    return {
      nodes: [],
      edges: [],
      groups: [],
      parameters: {
        windowMs: CORRELATION_WINDOW_MS,
      },
    };
  }

  const sortedPairs = Array.from(pairMap.entries())
    .sort((a, b) => {
      if (b[1].count === a[1].count) {
        return a[0].localeCompare(b[0]);
      }
      return b[1].count - a[1].count;
    })
    .slice(0, MAX_CORRELATION_EDGES);

  const relatedIds = new Set();
  sortedPairs.forEach(([pairKey]) => {
    const [source, target] = pairKey.split('|');
    relatedIds.add(source);
    relatedIds.add(target);
  });

  sessionGroups.forEach((group) => {
    group.errorIds.forEach((id) => relatedIds.add(id));
  });

  const events = await ErrorEvent.find({
    _id: { $in: Array.from(relatedIds) },
    projectId: project._id,
  })
    .select('message environment status count lastSeen firstSeen')
    .lean();

  const eventMap = new Map();
  events.forEach((event) => {
    eventMap.set(event._id.toString(), event);
  });

  const nodes = Array.from(relatedIds)
    .map((id) => {
      const event = eventMap.get(id);
      const coStats = nodeStats.get(id) || { groups: 0 };
      return {
        id,
        message: event?.message || 'Unknown error',
        environment: event?.environment || null,
        status: event?.status || null,
        totalOccurrences: event?.count ?? 0,
        firstSeen: event?.firstSeen || null,
        lastSeen: event?.lastSeen || null,
        coOccurrenceGroups: coStats.groups,
      };
    })
    .sort((a, b) => {
      if (b.coOccurrenceGroups === a.coOccurrenceGroups) {
        return (b.totalOccurrences || 0) - (a.totalOccurrences || 0);
      }
      return b.coOccurrenceGroups - a.coOccurrenceGroups;
    });

  const edges = sortedPairs.map(([pairKey, value]) => {
    const [source, target] = pairKey.split('|');
    const samples = value.samples.map((sample) => ({
      session: sample.session,
      windowStart: sample.window
        ? (sample.window instanceof Date ? sample.window.toISOString() : new Date(sample.window).toISOString())
        : null,
      errors: sample.errorIds.map((errorId) => {
        const event = eventMap.get(errorId);
        return {
          id: errorId,
          message: event?.message || 'Unknown error',
          environment: event?.environment || null,
        };
      }),
    }));

    return {
      source,
      target,
      sharedWindows: value.count,
      samples,
    };
  });

  const enrichedGroups = sessionGroups.map((group) => ({
    session: group.session,
    windowStart: group.window
      ? (group.window instanceof Date ? group.window.toISOString() : new Date(group.window).toISOString())
      : null,
    size: group.errorIds.length,
    errors: group.errorIds.map((errorId) => {
      const event = eventMap.get(errorId);
      return {
        id: errorId,
        message: event?.message || 'Unknown error',
        environment: event?.environment || null,
        status: event?.status || null,
      };
    }),
  }));

  return {
    nodes,
    edges,
    groups: enrichedGroups,
    parameters: {
      windowMs: CORRELATION_WINDOW_MS,
    },
  };
};

const serializeErrorEvent = (event) => ({
  id: event._id.toString(),
  message: event.message,
  count: event.count,
  environment: event.environment,
  lastSeen: event.lastSeen,
  status: event.status,
});

const withCache = async (projectId, key, fetcher) => {
  const cached = analyticsCache.get(projectId, key);
  if (cached) {
    return cached;
  }
  const fresh = await fetcher();
  analyticsCache.set(projectId, key, fresh);
  return fresh;
};

const ACTIVE_STATUSES = ['new', 'open', 'investigating'];

const normalizeLabel = (value) => {
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : 'unknown';
  }
  if (typeof value === 'object') {
    if (value.name && typeof value.name === 'string') {
      return value.name.trim() || 'unknown';
    }
    if (value.label && typeof value.label === 'string') {
      return value.label.trim() || 'unknown';
    }
  }
  return String(value);
};

const countUniqueUsers = (usersArray) => {
  if (!Array.isArray(usersArray)) {
    return 0;
  }
  const set = new Set();
  usersArray.forEach((userId) => {
    if (userId === null || userId === undefined) {
      return;
    }
    set.add(userId.toString());
  });
  return set.size;
};

const buildCoalesceExpression = (expressions, fallback) => {
  if (!Array.isArray(expressions) || expressions.length === 0) {
    return fallback;
  }

  return expressions.reduceRight((acc, expression) => (
    {
      $cond: [
        {
          $and: [
            { $ne: [expression, null] },
            { $ne: [expression, ''] },
          ],
        },
        expression,
        acc,
      ],
    }
  ), fallback);
};

const buildSessionKeyExpression = () => ({
  $let: {
    vars: {
      raw: buildCoalesceExpression(
        [
          '$userContext.sessionId',
          '$userContext.session.id',
          '$userContext.sessionID',
          '$metadata.sessionId',
          '$metadata.session.id',
          '$userContext.userId',
        ],
        'unknown'
      ),
    },
    in: {
      $let: {
        vars: {
          str: { $trim: { input: { $toString: '$$raw' } } },
        },
        in: {
          $cond: [
            {
              $or: [
                { $eq: ['$$str', ''] },
                { $eq: [{ $toLower: '$$str' }, 'null'] },
                { $eq: [{ $toLower: '$$str' }, 'undefined'] },
              ],
            },
            'unknown',
            { $toLower: '$$str' },
          ],
        },
      },
    },
  },
});

const buildPrimaryFrameFileExpression = () => ({
  $let: {
    vars: {
      firstFrame: {
        $arrayElemAt: [
          {
            $filter: {
              input: { $ifNull: ['$stackTrace', []] },
              as: 'frame',
              cond: {
                $and: [
                  { $ne: ['$$frame', null] },
                  { $ne: ['$$frame.file', null] },
                  { $ne: ['$$frame.file', ''] },
                ],
              },
            },
          },
          0,
        ],
      },
    },
    in: {
      $cond: [
        {
          $and: [
            { $ne: ['$$firstFrame', null] },
            { $ne: ['$$firstFrame.file', null] },
            { $ne: ['$$firstFrame.file', ''] },
          ],
        },
        '$$firstFrame.file',
        null,
      ],
    },
  },
});

const normalizeHotspotLabel = (label) => {
  if (!label || typeof label !== 'string') {
    return 'unknown';
  }
  const trimmed = label.trim();
  return trimmed.length ? trimmed : 'unknown';
};

const buildLabelExpression = (fieldPaths) => {
  if (!Array.isArray(fieldPaths) || fieldPaths.length === 0) {
    return 'unknown';
  }

  let expression = `$${fieldPaths[0]}`;
  for (let index = 1; index < fieldPaths.length; index += 1) {
    expression = { $ifNull: [expression, `$${fieldPaths[index]}`] };
  }

  return { $ifNull: [expression, 'unknown'] };
};

const buildBreakdownFacet = (fieldPaths, limit = null) => {
  const pipeline = [
    {
      $group: {
        _id: buildLabelExpression(fieldPaths),
        occurrences: { $sum: 1 },
        users: { $addToSet: { $ifNull: ['$userContext.userId', null] } },
      },
    },
    { $sort: { occurrences: -1 } },
  ];

  if (typeof limit === 'number' && limit > 0) {
    pipeline.push({ $limit: limit });
  }

  return pipeline;
};

const computeDelta = (current, previous) => {
  const absolute = current - previous;
  const percentage = previous === 0 ? null : (absolute / previous) * 100;
  return { absolute, percentage };
};

const resolveRangeDefinition = (rangeKey, options = {}) => {
  if (rangeKey !== 'custom') {
    const config = RANGE_CONFIG[rangeKey];
    const now = new Date();
    const anchor = alignDate(now, config.unit);
    const matchEndExclusive = new Date(anchor.getTime() + config.bucketSizeMs);
    const matchStart = new Date(matchEndExclusive.getTime() - config.bucketCount * config.bucketSizeMs);
    return {
      unit: config.unit,
      bucketSizeMs: config.bucketSizeMs,
      bucketCount: config.bucketCount,
      matchStart,
      matchEndExclusive,
      displayStart: matchStart,
      displayEnd: new Date(matchEndExclusive.getTime() - 1),
    };
  }

  const providedStart = options.startDate ? new Date(options.startDate) : null;
  const providedEnd = options.endDate ? new Date(options.endDate) : null;

  let actualStart = providedStart || new Date();
  let actualEnd = providedEnd || new Date();

  if (actualEnd < actualStart) {
    const temp = actualStart;
    actualStart = actualEnd;
    actualEnd = temp;
  }

  const diffMs = actualEnd.getTime() - actualStart.getTime();
  const unit = diffMs <= 7 * DAY_MS ? 'hour' : 'day';
  const bucketSizeMs = unit === 'hour' ? HOUR_MS : DAY_MS;
  const matchStart = alignDate(actualStart, unit);
  const bucketCount = Math.max(1, Math.ceil((actualEnd.getTime() - matchStart.getTime()) / bucketSizeMs));
  const matchEndExclusive = new Date(matchStart.getTime() + bucketCount * bucketSizeMs);

  return {
    unit,
    bucketSizeMs,
    bucketCount,
    matchStart,
    matchEndExclusive,
    displayStart: actualStart,
    displayEnd: new Date(actualEnd.getTime() - 1),
  };
};

const buildTrendsAggregationPipeline = (matchFilter, unit) => [
  { $match: matchFilter },
  {
    $project: {
      timestamp: 1,
      environment: 1,
      metadata: {
        errorType: '$metadata.errorType',
        type: '$metadata.type',
        category: '$metadata.category',
        name: '$metadata.name',
        severity: '$metadata.severity',
        level: '$metadata.level',
        priority: '$metadata.priority',
        browser: '$metadata.browser',
        os: '$metadata.os',
        device: '$metadata.device',
        platform: '$metadata.platform',
      },
      userContext: {
        userId: '$userContext.userId',
        browser: '$userContext.browser',
        os: '$userContext.os',
        device: '$userContext.device',
        level: '$userContext.level',
      },
    },
  },
  {
    $facet: {
      timeSeries: [
        {
          $group: {
            _id: buildTimeSeriesGroupId(unit),
            count: { $sum: 1 },
            users: { $addToSet: { $ifNull: ['$userContext.userId', null] } },
          },
        },
        { $sort: sortSpecForUnit(unit) },
      ],
      environments: buildBreakdownFacet(['environment']),
      totals: [
        {
          $group: {
            _id: null,
            occurrences: { $sum: 1 },
            users: { $addToSet: { $ifNull: ['$userContext.userId', null] } },
          },
        },
      ],
      errorTypes: buildBreakdownFacet(
        ['metadata.errorType', 'metadata.type', 'metadata.category', 'metadata.name'],
        8
      ),
      severities: buildBreakdownFacet(
        ['metadata.severity', 'metadata.level', 'metadata.priority', 'userContext.level'],
        8
      ),
      browsers: buildBreakdownFacet(['userContext.browser', 'metadata.browser'], 10),
      operatingSystems: buildBreakdownFacet(['userContext.os', 'metadata.os'], 10),
      devices: buildBreakdownFacet(
        ['userContext.device', 'metadata.device', 'metadata.platform'],
        10
      ),
    },
  },
];

const computeOverview = async (project, options = {}) => {
  const environmentFilter = options.environment || null;
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * HOUR_MS);
  const previousWindowStart = new Date(last24h.getTime() - 24 * HOUR_MS);

  const alignedEnd = alignDate(now, 'hour');
  const alignedStart = new Date(alignedEnd.getTime() - (24 - 1) * HOUR_MS);

  const matchCurrentOccurrences = {
    projectId: project._id,
    timestamp: { $gte: last24h },
  };
  const matchPreviousOccurrences = {
    projectId: project._id,
    timestamp: { $gte: previousWindowStart, $lt: last24h },
  };

  if (environmentFilter) {
    matchCurrentOccurrences.environment = environmentFilter;
    matchPreviousOccurrences.environment = environmentFilter;
  }

  const baseErrorMatch = { projectId: project._id };
  const errorMatchWithEnv = environmentFilter
    ? { ...baseErrorMatch, environment: environmentFilter }
    : baseErrorMatch;

  const occurrenceHint = buildOccurrenceHint(matchCurrentOccurrences);
  const previousOccurrenceHint = buildOccurrenceHint(matchPreviousOccurrences);
  const firstSeenHint = buildErrorEventFirstSeenHint(environmentFilter);
  const statusHint = buildErrorEventStatusHint(environmentFilter);

  const [
    trendDocs,
    frequentDocs,
    totalErrorsCurrent,
    totalErrorsPrevious,
    newErrorsCurrent,
    newErrorsPrevious,
    activeCurrent,
    activePrevious,
    resolvedCurrent,
    resolvedPrevious,
    environmentDocs,
    statusDocs,
    clientBreakdownDocs,
  ] = await Promise.all([
    runAggregation(
      ErrorOccurrence,
      [
        { $match: matchCurrentOccurrences },
        {
          $project: {
            timestamp: 1,
            userContext: { userId: '$userContext.userId' },
          },
        },
        {
          $group: {
            _id: buildTimeSeriesGroupId('hour'),
            count: { $sum: 1 },
            users: { $addToSet: { $ifNull: ['$userContext.userId', null] } },
          },
        },
        { $sort: sortSpecForUnit('hour') },
      ],
      { hint: occurrenceHint }
    ),
    runAggregation(
      ErrorEvent,
      [
        { $match: errorMatchWithEnv },
        { $sort: { count: -1, lastSeen: -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 1,
            message: 1,
            count: 1,
            environment: 1,
            lastSeen: 1,
            status: 1,
          },
        },
      ]
    ),
    countDocumentsSafe(ErrorOccurrence, matchCurrentOccurrences, occurrenceHint),
    countDocumentsSafe(ErrorOccurrence, matchPreviousOccurrences, previousOccurrenceHint),
    countDocumentsSafe(ErrorEvent, { ...errorMatchWithEnv, firstSeen: { $gte: last24h } }, firstSeenHint),
    countDocumentsSafe(
      ErrorEvent,
      {
        ...errorMatchWithEnv,
        firstSeen: { $gte: previousWindowStart, $lt: last24h },
      },
      firstSeenHint
    ),
    countDocumentsSafe(
      ErrorEvent,
      {
        ...errorMatchWithEnv,
        status: { $in: ACTIVE_STATUSES },
        lastSeen: { $gte: last24h },
      },
      statusHint
    ),
    countDocumentsSafe(
      ErrorEvent,
      {
        ...errorMatchWithEnv,
        status: { $in: ACTIVE_STATUSES },
        lastSeen: { $gte: previousWindowStart, $lt: last24h },
      },
      statusHint
    ),
    countDocumentsSafe(
      ErrorEvent,
      {
        ...errorMatchWithEnv,
        status: 'resolved',
        lastSeen: { $gte: last24h },
      },
      statusHint
    ),
    countDocumentsSafe(
      ErrorEvent,
      {
        ...errorMatchWithEnv,
        status: 'resolved',
        lastSeen: { $gte: previousWindowStart, $lt: last24h },
      },
      statusHint
    ),
    runAggregation(
      ErrorOccurrence,
      [
        { $match: matchCurrentOccurrences },
        {
          $project: {
            environment: { $ifNull: ['$environment', 'unknown'] },
          },
        },
        {
          $group: {
            _id: '$environment',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ],
      { hint: occurrenceHint }
    ),
    runAggregation(
      ErrorEvent,
      [
        { $match: errorMatchWithEnv },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]
    ),
    runAggregation(
      ErrorOccurrence,
      [
        { $match: matchCurrentOccurrences },
        {
          $project: {
            userContext: 1,
            metadata: 1,
          },
        },
        {
          $facet: {
            browsers: [
              {
                $group: {
                  _id: {
                    $ifNull: [
                      '$userContext.browser',
                      {
                        $ifNull: ['$metadata.browser', 'unknown'],
                      },
                    ],
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 6 },
            ],
            operatingSystems: [
              {
                $group: {
                  _id: {
                    $ifNull: [
                      '$userContext.os',
                      {
                        $ifNull: ['$metadata.os', 'unknown'],
                      },
                    ],
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 6 },
            ],
            devices: [
              {
                $group: {
                  _id: {
                    $ifNull: [
                      '$userContext.device',
                      {
                        $ifNull: ['$metadata.device', 'unknown'],
                      },
                    ],
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 6 },
            ],
          },
        },
      ],
      { hint: occurrenceHint }
    ),
  ]);

  const trend = fillTimeSeries(trendDocs, 'hour', alignedStart, HOUR_MS, 24);

  const environmentBreakdown = environmentDocs.map((doc) => ({
    environment: normalizeLabel(doc._id),
    occurrences: doc.count,
  }));

  const statusBreakdown = statusDocs.map((doc) => ({
    status: normalizeLabel(doc._id),
    count: doc.count,
  }));

  const clientFacet = clientBreakdownDocs[0] || {};
  const clientBreakdown = {
    browsers: (clientFacet.browsers || []).map((doc) => ({
      name: normalizeLabel(doc._id),
      count: doc.count,
    })),
    operatingSystems: (clientFacet.operatingSystems || []).map((doc) => ({
      name: normalizeLabel(doc._id),
      count: doc.count,
    })),
    devices: (clientFacet.devices || []).map((doc) => ({
      name: normalizeLabel(doc._id),
      count: doc.count,
    })),
  };

  return {
    totals: {
      totalErrors: { current: totalErrorsCurrent, previous: totalErrorsPrevious },
      newErrors24h: { current: newErrorsCurrent, previous: newErrorsPrevious },
      activeErrors24h: { current: activeCurrent, previous: activePrevious },
      resolvedErrors24h: { current: resolvedCurrent, previous: resolvedPrevious },
      occurrences24h: trend.totalOccurrences,
      uniqueUsers24h: trend.totalUniqueUsers,
    },
    errorRateTrend: trend.buckets,
    mostFrequentErrors: frequentDocs.map((doc) => serializeErrorEvent(doc)),
    environmentBreakdown,
    statusBreakdown,
    clientBreakdown,
  };
};

const computeTrends = async (project, options) => {
  const { rangeKey, environment, startDate, endDate, compare } = options;
  const rangeDef = resolveRangeDefinition(rangeKey, { startDate, endDate });

  const matchFilter = {
    projectId: project._id,
    timestamp: {
      $gte: rangeDef.matchStart,
      $lt: rangeDef.matchEndExclusive,
    },
  };

  if (environment) {
    matchFilter.environment = environment;
  }

  const [result] = await runAggregation(
    ErrorOccurrence,
    buildTrendsAggregationPipeline(matchFilter, rangeDef.unit),
    { hint: buildOccurrenceHint(matchFilter) }
  );

  const trend = fillTimeSeries(
    result?.timeSeries || [],
    rangeDef.unit,
    rangeDef.matchStart,
    rangeDef.bucketSizeMs,
    rangeDef.bucketCount
  );

  const environmentBreakdown = (result?.environments || []).map((item) => ({
    environment: normalizeLabel(item._id),
    occurrences: item.occurrences ?? 0,
    uniqueUsers: countUniqueUsers(item.users || []),
  }));

  const mapCategoryBreakdown = (docs) =>
    (docs || []).map((item) => ({
      name: normalizeLabel(item._id),
      occurrences: item.occurrences ?? 0,
      uniqueUsers: countUniqueUsers(item.users || []),
    }));

  const totalOccurrences = result?.totals?.[0]?.occurrences || 0;
  const totalUsers = countUniqueUsers(result?.totals?.[0]?.users || []);

  let comparisonSection = null;

  if (compare) {
    const previousEndExclusive = rangeDef.matchStart;
    const previousStart = new Date(previousEndExclusive.getTime() - rangeDef.bucketCount * rangeDef.bucketSizeMs);

    const previousFilter = {
      projectId: project._id,
      timestamp: {
        $gte: previousStart,
        $lt: previousEndExclusive,
      },
    };

    if (environment) {
      previousFilter.environment = environment;
    }

    const [previousResult] = await runAggregation(
      ErrorOccurrence,
      buildTrendsAggregationPipeline(previousFilter, rangeDef.unit),
      { hint: buildOccurrenceHint(previousFilter) }
    );

    const previousTrend = fillTimeSeries(
      previousResult?.timeSeries || [],
      rangeDef.unit,
      previousStart,
      rangeDef.bucketSizeMs,
      rangeDef.bucketCount
    );

    const previousOccurrences = previousResult?.totals?.[0]?.occurrences || 0;
    const previousUsers = countUniqueUsers(previousResult?.totals?.[0]?.users || []);

    comparisonSection = {
      range: {
        start: previousStart.toISOString(),
        end: new Date(previousEndExclusive.getTime() - 1).toISOString(),
      },
      timeSeries: previousTrend.buckets,
      totals: {
        occurrences: previousOccurrences,
        uniqueUsers: previousUsers,
        deltas: {
          occurrences: computeDelta(totalOccurrences, previousOccurrences),
          uniqueUsers: computeDelta(totalUsers, previousUsers),
        },
      },
    };
  }

  return {
    range: {
      key: rangeKey,
      unit: rangeDef.unit,
      bucketSizeMs: rangeDef.bucketSizeMs,
      bucketCount: rangeDef.bucketCount,
      start: rangeDef.matchStart.toISOString(),
      end: new Date(rangeDef.matchEndExclusive.getTime() - 1).toISOString(),
      displayStart: rangeDef.displayStart.toISOString(),
      displayEnd: rangeDef.displayEnd.toISOString(),
    },
    totals: {
      occurrences: totalOccurrences,
      uniqueUsers: totalUsers,
    },
    timeSeries: trend.buckets,
    environmentBreakdown,
    errorTypeBreakdown: mapCategoryBreakdown(result?.errorTypes),
    severityBreakdown: mapCategoryBreakdown(result?.severities),
    clientBreakdown: {
      browsers: mapCategoryBreakdown(result?.browsers),
      operatingSystems: mapCategoryBreakdown(result?.operatingSystems),
      devices: mapCategoryBreakdown(result?.devices),
    },
    comparison: comparisonSection,
  };
};

const computeUserImpact = async (project, options = {}) => {
  const { environment } = options;
  const match = { projectId: project._id };
  if (environment) {
    match.environment = environment;
  }

  const impactLookbackStart = new Date(Date.now() - USER_IMPACT_LOOKBACK_MS);
  match.timestamp = { $gte: impactLookbackStart };

  const hint = buildOccurrenceHint(match);

  const sessionExpression = buildSessionKeyExpression();
  const userExpression = buildCoalesceExpression(
    [
      '$userContext.userId',
      '$userContext.user.id',
      '$metadata.userId',
      '$metadata.user.id',
      '$userContext.email',
      '$metadata.email',
    ],
    null
  );
  const pageExpression = buildCoalesceExpression(
    [
      '$metadata.pageUrl',
      '$metadata.url',
      '$metadata.route',
      '$metadata.path',
      '$metadata.screen',
      '$metadata.page',
    ],
    null
  );

  const grouped = await runAggregation(
    ErrorOccurrence,
    [
      { $match: match },
      {
        $project: {
          errorId: 1,
          timestamp: 1,
          userContext: 1,
          metadata: 1,
        },
      },
      {
        $group: {
          _id: '$errorId',
          totalOccurrences: { $sum: 1 },
          uniqueUsers: { $addToSet: userExpression },
          sessions: { $addToSet: sessionExpression },
          pages: { $addToSet: pageExpression },
          latestOccurrence: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          _id: 0,
          errorId: '$_id',
          totalOccurrences: 1,
          latestOccurrence: 1,
          uniqueUsersCount: {
            $size: {
              $filter: {
                input: '$uniqueUsers',
                as: 'user',
                cond: {
                  $and: [
                    { $ne: ['$$user', null] },
                    { $ne: [{ $toString: '$$user' }, ''] },
                  ],
                },
              },
            },
          },
          sessionCount: {
            $size: {
              $filter: {
                input: '$sessions',
                as: 'session',
                cond: {
                  $and: [
                    { $ne: ['$$session', null] },
                    { $ne: ['$$session', ''] },
                    { $ne: ['$$session', 'unknown'] },
                  ],
                },
              },
            },
          },
          pageViewCount: {
            $size: {
              $filter: {
                input: '$pages',
                as: 'page',
                cond: {
                  $and: [
                    { $ne: ['$$page', null] },
                    { $ne: [{ $toString: '$$page' }, ''] },
                  ],
                },
              },
            },
          },
        },
      },
      { $sort: { uniqueUsersCount: -1, totalOccurrences: -1 } },
      { $limit: 20 },
    ],
    { hint }
  );

  const summaryDocs = await runAggregation(
    ErrorOccurrence,
    [
      { $match: match },
      {
        $project: {
          userContext: 1,
          metadata: 1,
        },
      },
      {
        $group: {
          _id: null,
          totalOccurrences: { $sum: 1 },
          uniqueUsers: { $addToSet: userExpression },
          sessions: { $addToSet: sessionExpression },
        },
      },
      {
        $project: {
          _id: 0,
          totalOccurrences: 1,
          uniqueUsers: {
            $size: {
              $filter: {
                input: '$uniqueUsers',
                as: 'user',
                cond: {
                  $and: [
                    { $ne: ['$$user', null] },
                    { $ne: [{ $toString: '$$user' }, ''] },
                  ],
                },
              },
            },
          },
          sessions: {
            $size: {
              $filter: {
                input: '$sessions',
                as: 'session',
                cond: {
                  $and: [
                    { $ne: ['$$session', null] },
                    { $ne: ['$$session', ''] },
                    { $ne: ['$$session', 'unknown'] },
                  ],
                },
              },
            },
          },
        },
      },
    ],
    { hint }
  );

  const summary = summaryDocs[0] || { totalOccurrences: 0, uniqueUsers: 0, sessions: 0 };

  if (!grouped.length) {
    return {
      summary,
      topErrors: [],
    };
  }

  const topIds = grouped.slice(0, 10).map((doc) => doc.errorId);

  const events = await ErrorEvent.find({
    _id: { $in: topIds },
    projectId: project._id,
  })
    .select('message environment status count lastSeen firstSeen metadata')
    .lean();

  const eventMap = new Map();
  events.forEach((event) => {
    eventMap.set(event._id.toString(), event);
  });

  let journeyMap = new Map();
  if (topIds.length) {
    const previousExpression = buildCoalesceExpression(
      [
        '$metadata.previousRoute',
        '$metadata.previousPath',
        '$metadata.previousUrl',
        '$metadata.referrer',
        '$userContext.previousRoute',
        '$userContext.previousScreen',
      ],
      null
    );
    const actionExpression = buildCoalesceExpression(
      ['$metadata.action', '$metadata.event', '$userContext.lastAction'],
      null
    );

    const journeyMatch = {
      projectId: project._id,
      errorId: { $in: topIds },
      timestamp: { $gte: impactLookbackStart },
    };
    if (environment) {
      journeyMatch.environment = environment;
    }

    const journeyDocs = await runAggregation(
      ErrorOccurrence,
      [
        { $match: journeyMatch },
        { $sort: { timestamp: -1 } },
        {
          $project: {
            errorId: 1,
            timestamp: 1,
            metadata: 1,
            userContext: 1,
          },
        },
        {
          $group: {
            _id: '$errorId',
            events: {
              $push: {
                timestamp: '$timestamp',
                page: pageExpression,
                previous: previousExpression,
                action: actionExpression,
                session: sessionExpression,
                user: userExpression,
              },
            },
          },
        },
        {
          $project: {
            events: { $slice: ['$events', 50] },
          },
        },
      ],
      { hint: buildOccurrenceHint(journeyMatch) }
    );

    journeyMap = new Map(
      journeyDocs.map((doc) => [
        doc._id.toString(),
        (doc.events || []).map((event) => ({
          timestamp: event.timestamp,
          page: event.page,
          previous: event.previous,
          action: event.action,
          session: event.session,
          user: event.user,
        })),
      ])
    );
  }

  const topErrors = grouped.map((entry) => {
    const id = entry.errorId.toString();
    const event = eventMap.get(id);
    const journeyEvents = journeyMap.get(id) || [];

    const previousCounts = new Map();
    const actionCounts = new Map();
    const sessionSamples = new Map();

    journeyEvents.forEach((item) => {
      if (item.previous) {
        const key = item.previous;
        previousCounts.set(key, (previousCounts.get(key) || 0) + 1);
      }
      if (item.action) {
        const key = item.action;
        actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
      }
      if (item.session && !sessionSamples.has(item.session)) {
        sessionSamples.set(item.session, []);
      }
      if (item.session) {
        const samples = sessionSamples.get(item.session);
        if (samples && samples.length < 5) {
          samples.push(item);
        }
      }
    });

    const sortedPrevious = Array.from(previousCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    const sortedActions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    const sessionJourneys = Array.from(sessionSamples.entries())
      .slice(0, 3)
      .map(([session, events]) => ({
        session,
        events: events
          .slice()
          .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
          .map((eventEntry) => ({
            timestamp: eventEntry.timestamp,
            previous: eventEntry.previous,
            page: eventEntry.page,
            action: eventEntry.action,
            user: eventEntry.user,
          })),
      }));

    const impactScore = entry.uniqueUsersCount * 2 + entry.sessionCount + Math.min(entry.totalOccurrences, entry.uniqueUsersCount * 3);

    return {
      id,
      message: event?.message || 'Unknown error',
      environment: event?.environment || null,
      status: event?.status || null,
      totalOccurrences: entry.totalOccurrences,
      uniqueUsers: entry.uniqueUsersCount,
      sessions: entry.sessionCount,
      pageViews: entry.pageViewCount,
      impactScore,
      lastSeen: event?.lastSeen || entry.latestOccurrence || null,
      firstSeen: event?.firstSeen || null,
      journey: {
        topPrevious: sortedPrevious,
        topActions: sortedActions,
        sampleSessions: sessionJourneys,
      },
    };
  });

  topErrors.sort((a, b) => {
    if (b.impactScore === a.impactScore) {
      return b.uniqueUsers - a.uniqueUsers;
    }
    return b.impactScore - a.impactScore;
  });

  return {
    summary,
    topErrors,
  };
};

const computeResolutionMetrics = async (project, options = {}) => {
  const { environment } = options;
  const match = { projectId: project._id };
  if (environment) {
    match.environment = environment;
  }

  const events = await ErrorEvent.find(match)
    .select('message environment status metadata firstSeen lastSeen resolvedAt statusHistory count userContext')
    .lean();

  if (!events.length) {
    return {
      summary: {
        totalTracked: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
        averageResolveMs: null,
        averageVerifyMs: null,
        reopenedCount: 0,
      },
      byType: [],
      slowestResolved: [],
      unresolvedBacklog: [],
    };
  }

  const now = new Date();
  let resolvedCount = 0;
  let totalResolveMs = 0;
  let verifyCount = 0;
  let totalVerifyMs = 0;
  let reopenedCount = 0;

  const typeStats = new Map();
  const resolvedSeries = [];
  const unresolvedSeries = [];

  const resolveTypeLabel = (event) => {
    const metadata = event?.metadata || {};
    const typeCandidate =
      metadata.errorType ||
      metadata.type ||
      metadata.category ||
      metadata.name ||
      metadata.code;
    if (typeof typeCandidate === 'string' && typeCandidate.trim()) {
      return typeCandidate.trim();
    }
    return 'unknown';
  };

  events.forEach((event) => {
    const firstSeen = event.firstSeen ? new Date(event.firstSeen) : null;
    const lastSeen = event.lastSeen ? new Date(event.lastSeen) : null;
    const statusHistory = Array.isArray(event.statusHistory) ? event.statusHistory : [];
    const resolvedIndex = statusHistory.findIndex((entry) => entry.status === 'resolved');
    const resolvedEntry = resolvedIndex >= 0 ? statusHistory[resolvedIndex] : null;
    const resolvedAt = event.resolvedAt ? new Date(event.resolvedAt) : resolvedEntry?.changedAt ? new Date(resolvedEntry.changedAt) : null;

    let verifiedAt = null;
    if (resolvedIndex >= 0) {
      const postResolved = statusHistory.slice(resolvedIndex + 1);
      const verifiedEntry = postResolved.find((entry) => ['verified', 'closed', 'ignored', 'muted'].includes(entry.status));
      if (verifiedEntry?.changedAt) {
        verifiedAt = new Date(verifiedEntry.changedAt);
      } else if (event.status === 'resolved' && resolvedAt && lastSeen && lastSeen <= resolvedAt) {
        verifiedAt = resolvedAt;
      }
    }

    const wasReopened = statusHistory.some((entry, index) => {
      if (entry.status !== 'resolved') {
        return false;
      }
      const subsequent = statusHistory.slice(index + 1);
      return subsequent.some((next) => ['open', 'investigating', 'new', 'reopened', 'regressed'].includes(next.status));
    });

    if (wasReopened) {
      reopenedCount += 1;
    }

    const typeLabel = resolveTypeLabel(event);
    if (!typeStats.has(typeLabel)) {
      typeStats.set(typeLabel, {
        type: typeLabel,
        tracked: 0,
        resolved: 0,
        totalResolveMs: 0,
        verifyCount: 0,
        totalVerifyMs: 0,
        reopened: 0,
      });
    }
    const typeState = typeStats.get(typeLabel);
    typeState.tracked += 1;
    if (wasReopened) {
      typeState.reopened += 1;
    }

    if (resolvedAt && firstSeen) {
      const resolveMs = Math.max(0, resolvedAt.getTime() - firstSeen.getTime());
      resolvedCount += 1;
      totalResolveMs += resolveMs;
      typeState.resolved += 1;
      typeState.totalResolveMs += resolveMs;
      resolvedSeries.push({
        id: event._id.toString(),
        message: event.message || 'Unknown error',
        environment: event.environment || null,
        resolveMs,
        resolvedAt,
        firstSeen,
        status: event.status,
      });
    } else if (firstSeen) {
      unresolvedSeries.push({
        id: event._id.toString(),
        message: event.message || 'Unknown error',
        environment: event.environment || null,
        ageMs: Math.max(0, now.getTime() - firstSeen.getTime()),
        firstSeen,
        status: event.status,
      });
    }

    if (resolvedAt && verifiedAt && verifiedAt >= resolvedAt) {
      const verifyMs = Math.max(0, verifiedAt.getTime() - resolvedAt.getTime());
      verifyCount += 1;
      totalVerifyMs += verifyMs;
      typeState.verifyCount += 1;
      typeState.totalVerifyMs += verifyMs;
    }
  });

  const slowestResolved = resolvedSeries
    .sort((a, b) => b.resolveMs - a.resolveMs)
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      message: entry.message,
      environment: entry.environment,
      status: entry.status,
      resolveMs: entry.resolveMs,
      firstSeen: entry.firstSeen ? entry.firstSeen.toISOString() : null,
      resolvedAt: entry.resolvedAt ? entry.resolvedAt.toISOString() : null,
    }));

  const unresolvedBacklog = unresolvedSeries
    .sort((a, b) => b.ageMs - a.ageMs)
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      message: entry.message,
      environment: entry.environment,
      status: entry.status,
      ageMs: entry.ageMs,
      firstSeen: entry.firstSeen ? entry.firstSeen.toISOString() : null,
    }));

  const byType = Array.from(typeStats.values()).map((entry) => ({
    type: entry.type,
    tracked: entry.tracked,
    resolved: entry.resolved,
    averageResolveMs: entry.resolved ? entry.totalResolveMs / entry.resolved : null,
    verifyCount: entry.verifyCount,
    averageVerifyMs: entry.verifyCount ? entry.totalVerifyMs / entry.verifyCount : null,
    reopened: entry.reopened,
  }));

  byType.sort((a, b) => {
    const bValue = b.averageResolveMs ?? 0;
    const aValue = a.averageResolveMs ?? 0;
    if (bValue === aValue) {
      return b.tracked - a.tracked;
    }
    return bValue - aValue;
  });

  const summary = {
    totalTracked: events.length,
    resolvedCount,
    unresolvedCount: events.length - resolvedCount,
    averageResolveMs: resolvedCount ? totalResolveMs / resolvedCount : null,
    averageVerifyMs: verifyCount ? totalVerifyMs / verifyCount : null,
    reopenedCount,
  };

  return {
    summary,
    byType,
    slowestResolved,
    unresolvedBacklog,
  };
};

const computePatterns = async (project, options = {}) => {
  const { environment } = options;

  const [hotspots, spikes, deploymentImpact] = await Promise.all([
    computeHotspots(project, { environment }),
    computeErrorSpikes(project, { environment }),
    computeDeploymentImpact(project, { environment }),
  ]);

  return {
    environment: environment || null,
    hotspots,
    spikes,
    deployments: deploymentImpact,
  };
};

const computeTopErrors = async (project, options) => {
  const { environment } = options;
  const match = { projectId: project._id };
  if (environment) {
    match.environment = environment;
  }

  const [result] = await runAggregation(
    ErrorEvent,
    [
      { $match: match },
      {
        $facet: {
          topByCount: [
            { $sort: { count: -1, lastSeen: -1 } },
            { $limit: 10 },
            {
              $project: {
                _id: 1,
                message: 1,
                count: 1,
                environment: 1,
                lastSeen: 1,
                status: 1,
              },
            },
          ],
          recentErrors: [
            { $sort: { lastSeen: -1 } },
            { $limit: 10 },
            {
              $project: {
                _id: 1,
                message: 1,
                count: 1,
                environment: 1,
                lastSeen: 1,
                status: 1,
              },
            },
          ],
          criticalErrors: [
            { $match: { status: { $in: ['new', 'open', 'investigating'] } } },
            { $sort: { count: -1, lastSeen: -1 } },
            { $limit: 10 },
            {
              $project: {
                _id: 1,
                message: 1,
                count: 1,
                environment: 1,
                lastSeen: 1,
                status: 1,
              },
            },
          ],
          environmentBreakdown: [
            {
              $group: {
                _id: '$environment',
                count: { $sum: '$count' },
                uniqueErrors: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
        },
      },
    ]
  );

  return {
    topByCount: (result?.topByCount || []).map((item) => serializeErrorEvent(item)),
    recentErrors: (result?.recentErrors || []).map((item) => serializeErrorEvent(item)),
    criticalErrors: (result?.criticalErrors || []).map((item) => serializeErrorEvent(item)),
    environmentBreakdown: (result?.environmentBreakdown || []).map((item) => ({
      environment: item._id || 'unknown',
      totalOccurrences: item.count,
      uniqueErrors: item.uniqueErrors,
    })),
  };
};

const getOverviewAnalytics = async (project, options = {}) =>
  withCache(
    project._id,
    `overview:${options.environment || 'all'}`,
    () => computeOverview(project, options)
  );

const getTrendsAnalytics = async (project, options) => {
  const cacheKey = `trends:${JSON.stringify({
    range: options.rangeKey,
    environment: options.environment || null,
    startDate: options.startDate || null,
    endDate: options.endDate || null,
    compare: options.compare ? 1 : 0,
  })}`;
  return withCache(project._id, cacheKey, () => computeTrends(project, options));
};

const getTopErrorsAnalytics = async (project, options) => {
  const cacheKey = `top:${JSON.stringify({ environment: options.environment || null })}`;
  return withCache(project._id, cacheKey, () => computeTopErrors(project, options));
};

const getRelatedErrorsAnalytics = async (project, options = {}) => {
  const cacheKey = `related:${JSON.stringify({ environment: options.environment || null })}`;
  return withCache(project._id, cacheKey, () => computeRelatedErrors(project, options));
};

const getUserImpactAnalytics = async (project, options = {}) => {
  const cacheKey = `userImpact:${JSON.stringify({ environment: options.environment || null })}`;
  return withCache(project._id, cacheKey, () => computeUserImpact(project, options));
};

const getResolutionAnalytics = async (project, options = {}) => {
  const cacheKey = `resolution:${JSON.stringify({ environment: options.environment || null })}`;
  return withCache(project._id, cacheKey, () => computeResolutionMetrics(project, options));
};

const getPatternsAnalytics = async (project, options = {}) => {
  const cacheKey = `patterns:${JSON.stringify({ environment: options.environment || null })}`;
  return withCache(project._id, cacheKey, () => computePatterns(project, options));
};

const createDeploymentMarker = async (project, payload) => {
  const timestampInput = payload.timestamp ? new Date(payload.timestamp) : new Date();
  if (Number.isNaN(timestampInput.getTime())) {
    const error = new Error('Invalid deployment timestamp');
    error.status = 400;
    throw error;
  }

  const label = payload.label && typeof payload.label === 'string' ? payload.label.trim() : null;
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  const deployment = await Deployment.create({
    projectId: project._id,
    label,
    timestamp: timestampInput,
    metadata,
  });

  analyticsCache.invalidateProject(project._id);

  return {
    id: deployment._id.toString(),
    label: deployment.label || null,
    timestamp: deployment.timestamp,
    metadata: deployment.metadata || {},
  };
};

const listDeploymentMarkers = async (project, options = {}) => {
  const limit = Math.min(Math.max(options.limit || DEPLOYMENT_IMPACT_LIMIT, 1), 25);
  const deployments = await Deployment.find({ projectId: project._id })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  return deployments.map((deployment) => ({
    id: deployment._id.toString(),
    label: deployment.label || null,
    timestamp: deployment.timestamp,
    metadata: deployment.metadata || {},
  }));
};

module.exports = {
  getOverviewAnalytics,
  getTrendsAnalytics,
  getTopErrorsAnalytics,
  getRelatedErrorsAnalytics,
  getUserImpactAnalytics,
  getResolutionAnalytics,
  getPatternsAnalytics,
  createDeploymentMarker,
  listDeploymentMarkers,
};
