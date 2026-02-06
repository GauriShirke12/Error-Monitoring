const logger = require('../utils/logger');
const { cleanupExpiredData } = require('./retention-service');

const DEFAULT_INTERVAL_MS = Number(process.env.RETENTION_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);

let intervalHandle = null;

const tick = async () => {
  try {
    const result = await cleanupExpiredData();
    if (result.deletedEvents || result.deletedOccurrences) {
      logger.info(
        {
          deletedEvents: result.deletedEvents,
          deletedOccurrences: result.deletedOccurrences,
        },
        'Retention scheduler removed expired data'
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Retention scheduler tick failed');
  }
};

const startRetentionScheduler = () => {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(tick, DEFAULT_INTERVAL_MS);
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }
  tick();
  logger.info({ intervalMs: DEFAULT_INTERVAL_MS }, 'Retention scheduler started');
};

const stopRetentionScheduler = () => {
  if (!intervalHandle) {
    return;
  }
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Retention scheduler stopped');
};

module.exports = {
  startRetentionScheduler,
  stopRetentionScheduler,
};
