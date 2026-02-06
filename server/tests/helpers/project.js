const Project = require('../../src/models/Project');
const { createApiKey, hashApiKey, getApiKeyPreview } = require('../../src/utils/api-key');

async function createProjectWithApiKey({ name = 'Test Project', status = 'active', apiKey, scrubbing, retentionDays } = {}) {
  const key = typeof apiKey === 'string' && apiKey.length ? apiKey : createApiKey();

  const project = await Project.create({
    name,
    status,
    apiKeyHash: hashApiKey(key),
    apiKeyPreview: getApiKeyPreview(key),
    ...(scrubbing ? { scrubbing } : {}),
    ...(retentionDays ? { retentionDays } : {}),
  });

  return { project, apiKey: key };
}

module.exports = {
  createProjectWithApiKey,
};
