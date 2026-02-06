const logger = require('../utils/logger');
const { processAlertDigests } = require('./alert-digest-service');

const DEFAULT_INTERVAL_MS = Number(process.env.ALERT_DIGEST_INTERVAL_MS || 15 * 60 * 1000);

let intervalHandle = null;

const tick = async () => {
  try {
    const deliveries = await processAlertDigests();
    if (deliveries.length) {
      logger.info({ deliveries }, 'Alert digest cycle delivered batches');
    }
  } catch (error) {
    logger.error({ err: error }, 'Alert digest scheduler tick failed');
  }
};

const startAlertDigestScheduler = () => {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(tick, DEFAULT_INTERVAL_MS);
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }
  tick();
  logger.info({ intervalMs: DEFAULT_INTERVAL_MS }, 'Alert digest scheduler started');
};

const stopAlertDigestScheduler = () => {
  if (!intervalHandle) {
    return;
  }
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Alert digest scheduler stopped');
};

module.exports = {
  startAlertDigestScheduler,
  stopAlertDigestScheduler,
};
