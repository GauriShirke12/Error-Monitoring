const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  logger.error(
    {
      status,
      path: req.originalUrl,
      method: req.method,
      err,
    },
    'Unhandled error'
  );

  res.status(status).json({
    error: {
      message,
    },
  });
};

module.exports = errorHandler;
