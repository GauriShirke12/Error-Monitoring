const logger = require('../utils/logger');
const { createQueue, getQueueConfig, isQueueAvailable } = require('./queue-factory');
const Project = require('../models/Project');
const { getOverviewAnalytics, getTrendsAnalytics } = require('../services/analytics-service');

const ANALYTICS_QUEUE_NAME = 'analytics-aggregation';
const WARM_OVERVIEW_JOB = 'warm-overview';

let analyticsQueue;

const getAnalyticsQueue = () => {
  if (!analyticsQueue) {
    analyticsQueue = createQueue(ANALYTICS_QUEUE_NAME);
  }
  return analyticsQueue;
};

const warmOverview = async (payload) => {
  const { projectId, environment = null } = payload || {};
  if (!projectId) {
    return;
  }
  const project = await Project.findById(projectId);
  if (!project) {
    logger.warn({ projectId }, 'Skipping analytics warmup – project not found');
    return;
  }

  await getOverviewAnalytics(project, { environment });
  await getTrendsAnalytics(project, { rangeKey: '24h', environment, compare: false });
};

const enqueueAnalyticsWarmup = async ({ projectId, environment = null }) => {
  const config = getQueueConfig();

  if (!isQueueAvailable() || config.inline) {
    // Fallback to inline async processing without Redis
    setImmediate(() => {
      warmOverview({ projectId, environment }).catch((err) => {
        logger.error({ err, projectId }, 'Failed to run inline analytics warmup');
      });
    });
    return { queued: false, inline: true };
  }

  const queue = getAnalyticsQueue();
  return queue.add(WARM_OVERVIEW_JOB, { projectId, environment }, {
    jobId: `${WARM_OVERVIEW_JOB}:${projectId}:${environment || 'all'}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
};

const registerAnalyticsProcessors = () => {
  const queue = getAnalyticsQueue();
  const concurrency = Math.max(1, getQueueConfig().defaultConcurrency || 1);

  queue.process(WARM_OVERVIEW_JOB, concurrency, async (job) => warmOverview(job.data));
  logger.info({ queue: ANALYTICS_QUEUE_NAME, inline: configInline() }, 'Analytics queue processor registered');
};

const configInline = () => getQueueConfig().inline;

module.exports = {
  enqueueAnalyticsWarmup,
  registerAnalyticsProcessors,
  configInline,
};
