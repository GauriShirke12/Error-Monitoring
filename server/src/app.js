const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Bull = require('bull');
const { randomUUID } = require('crypto');

const errorRoutes = require('./routes/error-routes');
const analyticsRoutes = require('./routes/analytics-routes');
const reportRoutes = require('./routes/report-routes');
const teamRoutes = require('./routes/team-routes');
const alertRoutes = require('./routes/alert-routes');
const authRoutes = require('./routes/auth-routes');
const projectRoutes = require('./routes/project-routes');
const errorHandler = require('./middleware/error-handler');
const { getQueueConfig } = require('./config/queue');
const logger = require('./utils/logger');

const { ipKeyGenerator } = rateLimit;

const parseAllowedOrigins = () => {
  const raw = process.env.DASHBOARD_ORIGINS || process.env.CORS_ORIGINS;
  if (!raw) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();

const createApp = () => {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Project-Id'],
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Assign a request ID (honor inbound header) and log minimal request lifecycle without sensitive payloads.
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      logger.info(
        {
          reqId: requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs,
        },
        'request'
      );
    });

    next();
  });

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/db', async (req, res) => {
    try {
      const connection = mongoose.connection;
      if (!connection || connection.readyState !== 1) {
        throw new Error('Database not connected');
      }
      await connection.db.admin().command({ ping: 1 });
      res.status(200).json({ status: 'ok', state: connection.readyState });
    } catch (error) {
      logger.error({ err: error }, 'Database health check failed');
      res.status(503).json({ status: 'error', message: error.message });
    }
  });

  app.get('/health/cache', async (req, res) => {
    const config = getQueueConfig();
    if (!config.redisUrl) {
      return res.status(200).json({ status: 'degraded', inline: config.inline, message: 'Redis not configured; inline mode active' });
    }

    let queue;
    try {
      queue = new Bull('health-check', { prefix: config.prefix || 'error-monitor', redis: config.redisUrl });
      await queue.isReady();
      const client = await queue.client;
      await client.ping();
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      logger.error({ err: error }, 'Cache health check failed');
      res.status(503).json({ status: 'error', message: error.message });
    } finally {
      if (queue) {
        try {
          await queue.close();
        } catch (closeError) {
          logger.warn({ err: closeError }, 'Failed to close cache health queue');
        }
      }
    }
  });

  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
    handler: (req, res) => res.status(429).json({ error: { message: 'Too many auth attempts, please try later' } }),
  });

  // Apply rate limits to authenticated API routes; health stays unthrottled for monitoring/load checks
  app.use('/api', limiter);

  // Auth endpoints should remain accessible without API key middleware from other routers
  app.use('/api', authLimiter, authRoutes);
  app.use('/api/projects', projectRoutes);

  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', errorRoutes);
  app.use('/api', reportRoutes);
  app.use('/api', teamRoutes);
  app.use('/api', alertRoutes);

  app.use((req, res, next) => {
    res.status(404).json({ error: { message: 'Not found' } });
  });

  app.use(errorHandler);

  return app;
};

module.exports = createApp;
