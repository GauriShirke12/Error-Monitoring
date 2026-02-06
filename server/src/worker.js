const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { registerEmailProcessor } = require('./queues/email-queue');
const { registerAnalyticsProcessors } = require('./queues/analytics-queue');
const { getQueueConfig } = require('./config/queue');
const { validateEnv } = require('./config/env');
const emailService = require('./services/email-service');

const startWorker = async () => {
  validateEnv();
  await connectDatabase();

  registerEmailProcessor(async (payload) => {
    const sender = emailService.__testing?.sendEmailDirect || emailService.__internal?.sendEmailDirect;
    if (!sender) {
      throw new Error('Email sender is not available');
    }
    return sender(payload);
  });

  registerAnalyticsProcessors();

  logger.info({ inline: getQueueConfig().inline }, 'Queue worker started');
};

startWorker().catch((error) => {
  logger.error({ err: error }, 'Failed to start queue worker');
  process.exit(1);
});
