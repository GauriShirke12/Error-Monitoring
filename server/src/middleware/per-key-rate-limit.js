const rateLimit = require('express-rate-limit');

const { ipKeyGenerator } = rateLimit;

const createPerKeyRateLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
      if (req.project) {
        const hash = req.project.apiKeyHash || req.project._id?.toString();
        if (hash) {
          return `key:${hash}`;
        }
      }
      return `ip:${ipKeyGenerator(req, res)}`;
    },
    handler: (req, res) => {
      res.status(429).json({ error: { message: message || 'Rate limit exceeded' } });
    },
  });

const perMinuteLimiter = createPerKeyRateLimiter({ windowMs: 60 * 1000, max: 100, message: 'Rate limit exceeded (per-minute limit)' });
const perHourLimiter = createPerKeyRateLimiter({ windowMs: 60 * 60 * 1000, max: 1000, message: 'Rate limit exceeded (per-hour limit)' });

module.exports = {
  createPerKeyRateLimiter,
  perMinuteLimiter,
  perHourLimiter,
};
