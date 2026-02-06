const { processDueSchedules } = require('./report-service');
const logger = require('../utils/logger');

const DEFAULT_INTERVAL_MS = Number(process.env.REPORT_SCHEDULER_INTERVAL_MS || 60_000);

let intervalHandle = null;

const tick = async () => {
  try {
    await processDueSchedules();
  } catch (error) {
    logger.error({ err: error }, 'Report scheduler tick failed');
  }
};

const startReportScheduler = () => {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(tick, DEFAULT_INTERVAL_MS);
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }
  tick();
  logger.info({ intervalMs: DEFAULT_INTERVAL_MS }, 'Report scheduler started');
};

const stopReportScheduler = () => {
  if (!intervalHandle) {
    return;
  }
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Report scheduler stopped');
};

module.exports = {
  startReportScheduler,
  stopReportScheduler,
};
