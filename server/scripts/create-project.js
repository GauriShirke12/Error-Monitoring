const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const { connectDatabase } = require('../src/config/database');
const Project = require('../src/models/Project');
const { createApiKey, hashApiKey, getApiKeyPreview } = require('../src/utils/api-key');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const createProject = async (name) => {
  await connectDatabase();
  const apiKey = createApiKey();
  const project = await Project.create({
    name,
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPreview: getApiKeyPreview(apiKey),
  });
  console.log('Created project:', project.name);
  console.log('API Key (store securely):', apiKey);
  console.log('Preview:', project.apiKeyPreview);
  await mongoose.disconnect();
};

const nameArg = process.argv[2];

if (!nameArg) {
  console.error('Usage: node scripts/create-project.js <project-name>');
  process.exit(1);
}

createProject(nameArg)
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Failed to create project', error);
    await mongoose.disconnect();
    process.exit(1);
  });
