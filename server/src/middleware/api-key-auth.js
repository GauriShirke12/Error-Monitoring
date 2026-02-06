const Project = require('../models/Project');
const logger = require('../utils/logger');
const { hashApiKey, getApiKeyPreview } = require('../utils/api-key');
const { extractBearerToken, loadUserFromToken } = require('./auth');

const getProjectFromMembership = (user, projectId) => {
  if (!user?.memberships?.length) {
    return null;
  }
  if (!projectId && user.memberships.length === 1) {
    return user.memberships[0];
  }
  if (!projectId) {
    return null;
  }
  return user.memberships.find((membership) =>
    membership?.projectId?.toString() === projectId.toString()
  ) || null;
};

const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.header('x-api-key');

    if (apiKey) {
      const apiKeyHash = hashApiKey(apiKey);
      const project = await Project.findOne({ apiKeyHash, status: 'active' });

      if (!project) {
        logger.warn({ apiKeyPreview: getApiKeyPreview(apiKey) }, 'Invalid API key access attempt');
        return res.status(401).json({ error: { message: 'Invalid API key' } });
      }

      req.project = project;
      req.accessRole = 'admin';
      req.accessSource = 'api-key';
      return next();
    }

    const token = extractBearerToken(req.headers.authorization || '');
    if (!token) {
      return res.status(401).json({ error: { message: 'Authentication required' } });
    }

    const user = await loadUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    req.user = user;

    const projectIdHint =
      req.header('x-project-id') ||
      req.query?.projectId ||
      req.params?.projectId ||
      (req.body && typeof req.body === 'object' ? req.body.projectId : undefined);

    const membership = getProjectFromMembership(user, projectIdHint);

    if (!membership) {
      const errorMessage = user.memberships?.length > 1 ? 'Project context required' : 'Forbidden';
      return res.status(user.memberships?.length > 1 ? 400 : 403).json({ error: { message: errorMessage } });
    }

    const project = await Project.findOne({ _id: membership.projectId, status: 'active' });
    if (!project) {
      return res.status(404).json({ error: { message: 'Project not found' } });
    }

    req.project = project;
    req.projectMembership = membership;
    req.accessRole = membership.role || 'viewer';
    req.accessSource = 'user';

    return next();
  } catch (error) {
    logger.error({ err: error }, 'Project authorization failed');
    return res.status(401).json({ error: { message: 'Authentication failed' } });
  }
};

module.exports = apiKeyAuth;
