const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

// Simple in-memory circuit breaker; resets on process restart.
const createCircuitBreaker = ({ name = 'breaker', failureThreshold = DEFAULT_THRESHOLD, cooldownMs = DEFAULT_COOLDOWN_MS, logger } = {}) => {
  let failureCount = 0;
  let nextAttemptAt = 0;

  const isOpen = () => Date.now() < nextAttemptAt;

  const reset = () => {
    failureCount = 0;
    nextAttemptAt = 0;
  };

  const recordFailure = (err) => {
    failureCount += 1;
    if (failureCount >= failureThreshold) {
      nextAttemptAt = Date.now() + cooldownMs;
      if (logger) {
        logger.warn({ name, failureCount, cooldownMs, err }, 'Circuit opened');
      }
    }
  };

  const execute = async (fn) => {
    if (isOpen()) {
      const error = new Error(`Circuit breaker open for ${name}`);
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }

    try {
      const result = await fn();
      reset();
      return result;
    } catch (err) {
      recordFailure(err);
      throw err;
    }
  };

  const getState = () => ({
    name,
    failureCount,
    failureThreshold,
    cooldownMs,
    nextAttemptAt,
    open: isOpen(),
  });

  return { execute, isOpen, reset, getState };
};

module.exports = { createCircuitBreaker };