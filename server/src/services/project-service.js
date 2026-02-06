const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const { createApiKey, hashApiKey, getApiKeyPreview } = require('../utils/api-key');

async function generateUniqueKeyRecord() {
  let attempts = 0;

  while (attempts < 10) {
    attempts += 1;
    const rawKey = createApiKey();
    const keyHash = hashApiKey(rawKey);
    // eslint-disable-next-line no-await-in-loop
    const exists = await Project.exists({ apiKeyHash: keyHash });
    if (!exists) {
      return {
        rawKey,
        keyHash,
        preview: getApiKeyPreview(rawKey),
      };
    }
  }

  throw new Error('Unable to generate a unique project API key');
}

function sanitizeProject(projectDoc, role, { apiKey } = {}) {
  if (!projectDoc) {
    return null;
  }

  const isAdmin = role === 'admin';
  const result = {
    id: projectDoc._id.toString(),
    name: projectDoc.name,
    status: projectDoc.status,
    role,
    createdAt: projectDoc.createdAt,
    updatedAt: projectDoc.updatedAt,
  };

  if (isAdmin && projectDoc.apiKeyPreview) {
    result.apiKeyPreview = projectDoc.apiKeyPreview;
  }

  if (isAdmin && apiKey) {
    result.apiKey = apiKey;
  }

  if (isAdmin && projectDoc.scrubbing) {
    result.scrubbing = {
      removeEmails: !!projectDoc.scrubbing.removeEmails,
      removePhones: !!projectDoc.scrubbing.removePhones,
      removeIPs: !!projectDoc.scrubbing.removeIPs,
    };
  }

  if (isAdmin && projectDoc.retentionDays !== undefined) {
    result.retentionDays = projectDoc.retentionDays;
  }

  return result;
}

function parseScrubbingConfig(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const result = {};
  if (input.removeEmails !== undefined) {
    result.removeEmails = Boolean(input.removeEmails);
  }
  if (input.removePhones !== undefined) {
    result.removePhones = Boolean(input.removePhones);
  }
  if (input.removeIPs !== undefined) {
    result.removeIPs = Boolean(input.removeIPs);
  }

  return Object.keys(result).length ? result : null;
}

function validateRetentionDays(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error('Retention days must be a number');
    error.status = 422;
    throw error;
  }

  if (parsed < 1 || parsed > 365) {
    const error = new Error('Retention days must be between 1 and 365');
    error.status = 422;
    throw error;
  }

  return parsed;
}

async function listProjectsForUser(user) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  if (!memberships.length) {
    return [];
  }

  const projectIds = memberships
    .map((membership) => membership?.projectId)
    .filter((value) => !!value)
    .map((value) => new mongoose.Types.ObjectId(value));

  if (!projectIds.length) {
    return [];
  }

  const projects = await Project.find({ _id: { $in: projectIds } }).lean();
  const projectsById = new Map(projects.map((project) => [project._id.toString(), project]));

  return memberships
    .map((membership) => {
      const project = projectsById.get(membership.projectId?.toString?.());
      if (!project) {
        return null;
      }
      return sanitizeProject(project, membership.role || 'viewer');
    })
    .filter((entry) => entry !== null);
}

async function createProjectForUser(user, { name, scrubbing, retentionDays }) {
  if (!user?._id) {
    const error = new Error('User context is required to create a project');
    error.status = 401;
    throw error;
  }
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    const error = new Error('Project name is required');
    error.status = 422;
    throw error;
  }

  const keyRecord = await generateUniqueKeyRecord();
  const scrubbingConfig = parseScrubbingConfig(scrubbing);
  const validatedRetention = validateRetentionDays(retentionDays);

  const createdProject = await Project.create({
    name: trimmedName,
    apiKeyHash: keyRecord.keyHash,
    apiKeyPreview: keyRecord.preview,
    status: 'active',
    ...(scrubbingConfig
      ? {
          scrubbing: {
            removeEmails: !!scrubbingConfig.removeEmails,
            removePhones: !!scrubbingConfig.removePhones,
            removeIPs: !!scrubbingConfig.removeIPs,
          },
        }
      : {}),
    ...(validatedRetention !== null ? { retentionDays: validatedRetention } : {}),
  });

  await User.updateOne(
    { _id: user._id },
    {
      $addToSet: {
        memberships: {
          projectId: createdProject._id,
          role: 'admin',
        },
      },
    }
  );

  const createdDoc = createdProject.toObject ? createdProject.toObject() : createdProject;
  return sanitizeProject(createdDoc, 'admin', { apiKey: keyRecord.rawKey });
}

async function updateProjectDetails(user, projectId, { name, scrubbing, retentionDays }) {
  if (!projectId) {
    const error = new Error('Project id is required');
    error.status = 400;
    throw error;
  }

  const membership = (user?.memberships || []).find(
    (entry) => entry.projectId?.toString?.() === projectId.toString()
  );

  if (!membership || membership.role !== 'admin') {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const scrubbingConfig = parseScrubbingConfig(scrubbing);
  const validatedRetention = validateRetentionDays(retentionDays);

  const project = await Project.findById(projectId).lean();

  if (!project) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  if (name !== undefined && !trimmedName) {
    const error = new Error('Project name is required');
    error.status = 422;
    throw error;
  }

  if (!trimmedName && !scrubbingConfig && validatedRetention === null) {
    const error = new Error('At least one field is required to update');
    error.status = 422;
    throw error;
  }

  const update = {};
  if (trimmedName) {
    update.name = trimmedName;
  }
  if (scrubbingConfig) {
    const existing = project.scrubbing || {};
    update.scrubbing = {
      removeEmails:
        scrubbingConfig.removeEmails !== undefined
          ? scrubbingConfig.removeEmails
          : !!existing.removeEmails,
      removePhones:
        scrubbingConfig.removePhones !== undefined
          ? scrubbingConfig.removePhones
          : !!existing.removePhones,
      removeIPs:
        scrubbingConfig.removeIPs !== undefined
          ? scrubbingConfig.removeIPs
          : !!existing.removeIPs,
    };
  }
  if (validatedRetention !== null) {
    update.retentionDays = validatedRetention;
  }

  const updated = await Project.findOneAndUpdate({ _id: projectId }, update, { new: true }).lean();

  if (!updated) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  return sanitizeProject(updated, membership.role);
}

async function rotateProjectApiKey(user, projectId) {
  if (!projectId) {
    const error = new Error('Project id is required');
    error.status = 400;
    throw error;
  }

  const membership = (user?.memberships || []).find(
    (entry) => entry.projectId?.toString?.() === projectId.toString()
  );

  if (!membership || membership.role !== 'admin') {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  const keyRecord = await generateUniqueKeyRecord();
  const updated = await Project.findOneAndUpdate(
    { _id: projectId },
    { apiKeyHash: keyRecord.keyHash, apiKeyPreview: keyRecord.preview },
    { new: true }
  ).lean();

  if (!updated) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  return sanitizeProject(updated, membership.role, { apiKey: keyRecord.rawKey });
}

module.exports = {
  listProjectsForUser,
  createProjectForUser,
  updateProjectDetails,
  rotateProjectApiKey,
};
