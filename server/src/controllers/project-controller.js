const mongoose = require('mongoose');
const {
  listProjectsForUser,
  createProjectForUser,
  updateProjectDetails,
  rotateProjectApiKey,
} = require('../services/project-service');
const logger = require('../utils/logger');

const parseProjectId = (value) => {
  if (!value) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(value)) {
    return value;
  }

  return null;
};

module.exports = {
  async list(req, res) {
    try {
      const projects = await listProjectsForUser(req.user);
      return res.status(200).json({ data: projects });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list projects');
      return res.status(500).json({ error: { message: 'Failed to load projects' } });
    }
  },

  async create(req, res) {
    try {
      const project = await createProjectForUser(req.user, req.body || {});
      return res.status(201).json({ data: project });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      logger.error({ err: error }, 'Failed to create project');
      return res.status(500).json({ error: { message: 'Failed to create project' } });
    }
  },

  async update(req, res) {
    try {
      const projectId = parseProjectId(req.params?.projectId);
      if (!projectId) {
        return res.status(400).json({ error: { message: 'Invalid project id' } });
      }
      const project = await updateProjectDetails(req.user, projectId, req.body || {});
      return res.status(200).json({ data: project });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      logger.error({ err: error }, 'Failed to update project');
      return res.status(500).json({ error: { message: 'Failed to update project' } });
    }
  },

  async rotateKey(req, res) {
    try {
      const projectId = parseProjectId(req.params?.projectId);
      if (!projectId) {
        return res.status(400).json({ error: { message: 'Invalid project id' } });
      }
      const project = await rotateProjectApiKey(req.user, projectId);
      return res.status(200).json({ data: project });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      logger.error({ err: error }, 'Failed to rotate project key');
      return res.status(500).json({ error: { message: 'Failed to rotate API key' } });
    }
  },
};
