const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logDir = path.join(__dirname, '..', '..', 'logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const dateStamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const filePath = path.join(logDir, `app-${dateStamp}.log`);

const streams = [{ stream: pino.destination({ dest: filePath, mkdir: true, sync: false }) }];

if (process.env.NODE_ENV !== 'production') {
  streams.push({ stream: process.stdout });
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: null,
    formatters: {
      // Avoid logging sensitive data by default; only structured fields passed explicitly are kept.
      log(object) {
        return object;
      },
    },
  },
  pino.multistream(streams)
);

module.exports = logger;
