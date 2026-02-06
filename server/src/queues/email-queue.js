const logger = require('../utils/logger');
const { createQueue, isQueueAvailable, getQueueConfig } = require('./queue-factory');

const EMAIL_QUEUE_NAME = 'email-delivery';
const EMAIL_JOB_NAME = 'send-email';

let emailQueue;

const getEmailQueue = () => {
  if (!emailQueue) {
    emailQueue = createQueue(EMAIL_QUEUE_NAME);
  }
  return emailQueue;
};

const isEmailQueueEnabled = () => isQueueAvailable();
const isInlineMode = () => getQueueConfig().inline;

const enqueueEmailJob = async (payload, options = {}) => {
  const queue = getEmailQueue();
  const job = await queue.add(EMAIL_JOB_NAME, payload, options);
  logger.debug({ jobId: job.id }, 'Queued email delivery job');
  return job;
};

const registerEmailProcessor = (handler) => {
  const queue = getEmailQueue();
  const concurrency = Math.max(1, getQueueConfig().defaultConcurrency || 1);

  queue.process(EMAIL_JOB_NAME, concurrency, async (job) => handler(job.data, job));
  logger.info({ queue: EMAIL_QUEUE_NAME, inline: isInlineMode() }, 'Email queue processor registered');
};

module.exports = {
  enqueueEmailJob,
  registerEmailProcessor,
  isEmailQueueEnabled,
  isInlineMode,
};
