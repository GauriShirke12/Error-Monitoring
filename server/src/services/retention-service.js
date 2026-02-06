const Project = require('../models/Project');
const ErrorEvent = require('../models/Error');
const ErrorOccurrence = require('../models/Occurrence');
const logger = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;

const cleanupProjectRetention = async (project) => {
  const retentionDays = Number(project?.retentionDays || 0);

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return {
      projectId: project?._id?.toString?.() || null,
      retentionDays: project?.retentionDays,
      deletedEvents: 0,
      deletedOccurrences: 0,
      skipped: true,
    };
  }

  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

  const [occResult, eventResult] = await Promise.all([
    ErrorOccurrence.deleteMany({ projectId: project._id, timestamp: { $lt: cutoff } }),
    ErrorEvent.deleteMany({ projectId: project._id, lastSeen: { $lt: cutoff } }),
  ]);

  return {
    projectId: project._id.toString(),
    retentionDays,
    cutoff,
    deletedEvents: eventResult?.deletedCount || 0,
    deletedOccurrences: occResult?.deletedCount || 0,
    skipped: false,
  };
};

const cleanupExpiredData = async () => {
  const projects = await Project.find({ retentionDays: { $gte: 1 } })
    .select({ _id: 1, retentionDays: 1, name: 1 })
    .lean();

  let deletedEvents = 0;
  let deletedOccurrences = 0;

  for (const project of projects) {
    try {
      const result = await cleanupProjectRetention(project);
      deletedEvents += result.deletedEvents;
      deletedOccurrences += result.deletedOccurrences;

      if (result.deletedEvents || result.deletedOccurrences) {
        logger.info(
          {
            projectId: result.projectId,
            retentionDays: result.retentionDays,
            deletedEvents: result.deletedEvents,
            deletedOccurrences: result.deletedOccurrences,
          },
          'Retention cleanup complete for project'
        );
      }
    } catch (error) {
      logger.error({ err: error, projectId: project?._id?.toString?.() || null }, 'Retention cleanup failed');
    }
  }

  return {
    projectsScanned: projects.length,
    deletedEvents,
    deletedOccurrences,
  };
};

module.exports = {
  cleanupExpiredData,
  cleanupProjectRetention,
};
