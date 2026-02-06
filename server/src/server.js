const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const createApp = require('./app');
const { connectDatabase } = require('./config/database');
const { startReportScheduler } = require('./services/report-scheduler');
const { startAlertDigestScheduler } = require('./services/alert-digest-scheduler');
const { startRetentionScheduler } = require('./services/retention-scheduler');
const { initializeAlertNotifications } = require('./services/alert-notification-service');
const { validateEnv } = require('./config/env');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 4000;

let server;
let shuttingDown = false;

const startServer = async () => {
  try {
    validateEnv();
    await connectDatabase();
    await initializeAlertNotifications();
    const app = createApp();

    server = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Server listening');
    });
    startReportScheduler();
    startAlertDigestScheduler();
    startRetentionScheduler();
  } catch (error) {
    logger.error({ err: error }, 'Failed to bootstrap server');
    process.exit(1);
  }
};

const shutdown = async (reason, code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Shutting down');

  const closeServer = () =>
    new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });

  const closeDb = async () => {
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (err) {
      logger.warn({ err }, 'Error closing DB connection');
    }
  };

  try {
    await Promise.all([closeServer(), closeDb()]);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    logger.info({ code }, 'Exiting process');
    process.exit(code);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

startServer();
