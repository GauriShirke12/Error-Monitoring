const Bull = require('bull');
const logger = require('../utils/logger');
const { getQueueConfig } = require('../config/queue');

const DEFAULT_NAME = 'default';

class InlineQueue {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.handlers = new Map();
    this.counter = 0;
  }

  process(nameOrHandler, maybeConcurrency, maybeHandler) {
    let jobName = DEFAULT_NAME;
    let handler = nameOrHandler;

    if (typeof nameOrHandler === 'string') {
      jobName = nameOrHandler;
      if (typeof maybeConcurrency === 'function') {
        handler = maybeConcurrency;
      } else {
        handler = maybeHandler;
      }
    }

    if (typeof handler !== 'function') {
      throw new Error('Queue processor must be a function');
    }

    this.handlers.set(jobName, handler);
  }

  async add(nameOrData, maybeData, maybeOptions) {
    const jobName = typeof nameOrData === 'string' ? nameOrData : DEFAULT_NAME;
    const data = typeof nameOrData === 'string' ? maybeData : nameOrData;
    const opts = (typeof nameOrData === 'string' ? maybeOptions : maybeData) || {};

    const jobId = `${this.name}:${jobName}:${Date.now()}:${this.counter += 1}`;
    const job = {
      id: jobId,
      name: jobName,
      data,
      opts,
      attemptsMade: 0,
      returnvalue: undefined,
    };

    const handler = this.handlers.get(jobName) || this.handlers.get(DEFAULT_NAME);
    if (handler) {
      try {
        job.returnvalue = await handler(job);
      } catch (error) {
        logger.error({ err: error, queue: this.name, job: jobName }, 'Inline queue handler failed');
        throw error;
      }
    }

    return {
      id: jobId,
      name: jobName,
      data,
      opts,
      returnvalue: job.returnvalue,
      finished: async () => job.returnvalue,
    };
  }

  on() {
    // no-op for inline queue
  }
}

const createQueue = (name, options = {}) => {
  const config = getQueueConfig();
  const defaultJobOptions = {
    attempts: config.defaultAttempts,
    backoff: { type: 'fixed', delay: config.defaultBackoffMs },
    removeOnComplete: true,
    removeOnFail: false,
    ...options.defaultJobOptions,
  };

  if (!config.enabled || config.inline) {
    return new InlineQueue(name, { defaultJobOptions });
  }

  const queue = new Bull(name, {
    prefix: config.prefix,
    redis: config.redisUrl,
    defaultJobOptions,
  });

  queue.on('error', (err) => {
    logger.error({ err, queue: name }, 'Queue error');
  });

  queue.on('failed', (job, err) => {
    logger.warn({ err, queue: name, jobId: job?.id }, 'Queue job failed');
  });

  return queue;
};

const isQueueAvailable = () => {
  const config = getQueueConfig();
  return config.enabled && !config.inline;
};

module.exports = {
  createQueue,
  isQueueAvailable,
  getQueueConfig,
};
