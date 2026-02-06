const getQueueConfig = () => {
  const redisUrl =
    process.env.REDIS_URL || process.env.BULL_REDIS_URL || process.env.QUEUE_REDIS_URL || null;

  const disabled = process.env.JOB_QUEUE_DISABLED === 'true';
  const inline = process.env.JOB_QUEUE_INLINE === 'true' || process.env.NODE_ENV === 'test' || !redisUrl;

  const defaultAttempts = Number(process.env.QUEUE_JOB_ATTEMPTS || 3);
  const defaultBackoffMs = Number(process.env.QUEUE_JOB_BACKOFF_MS || 5000);
  const defaultConcurrency = Number(process.env.QUEUE_CONCURRENCY || 5);

  return {
    prefix: process.env.BULL_PREFIX || 'error-monitor',
    redisUrl,
    enabled: !disabled && Boolean(redisUrl),
    inline,
    defaultAttempts,
    defaultBackoffMs,
    defaultConcurrency,
  };
};

module.exports = { getQueueConfig };
