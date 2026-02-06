const { enqueueEmailJob, registerEmailProcessor, isInlineMode } = require('../src/queues/email-queue');
const emailService = require('../src/services/email-service');
const logger = require('../src/utils/logger');

(async () => {
  const send = emailService.__testing && emailService.__testing.sendEmailDirect;
  if (!send) {
    throw new Error('sendEmailDirect not available');
  }

  registerEmailProcessor(async (data) => send(data));

  const total = 1000;
  const jobs = [];
  const start = Date.now();

  for (let i = 0; i < total; i += 1) {
    jobs.push(
      enqueueEmailJob(
        {
          to: `loadtest+${i}@example.com`,
          subject: 'Queue load test',
          text: 'This is a load test email.',
        },
        { removeOnComplete: true, removeOnFail: true }
      )
    );
  }

  await Promise.all(jobs);

  const durationMs = Date.now() - start;
  logger.info({ total, inline: isInlineMode(), durationMs }, 'Email queue load test complete');
})();
