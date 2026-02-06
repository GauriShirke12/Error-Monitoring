const Project = require('../models/Project');
const AlertDigestEntry = require('../models/AlertDigestEntry');
const { sendDailyDigestEmails } = require('./email-service');
const logger = require('../utils/logger');

const processAlertDigests = async ({ now = new Date() } = {}) => {
  const projectIds = await AlertDigestEntry.distinct('projectId', { processed: false });
  if (!projectIds.length) {
    return [];
  }

  const projects = await Project.find({
    _id: { $in: projectIds },
    status: 'active',
  })
    .select('name')
    .lean();

  const deliveries = [];

  for (const project of projects) {
    try {
      const results = await sendDailyDigestEmails({ project, now });
      if (results.length) {
        deliveries.push({ projectId: project._id.toString(), deliveries: results.length });
      }
    } catch (error) {
      logger.error({ err: error, projectId: project._id.toString() }, 'Failed to deliver alert digest');
    }
  }

  return deliveries;
};

module.exports = {
  processAlertDigests,
};
