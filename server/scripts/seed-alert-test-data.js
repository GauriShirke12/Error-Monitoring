const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

const { connectDatabase } = require('../src/config/database');
const Project = require('../src/models/Project');
const AlertRule = require('../src/models/AlertRule');
const Deployment = require('../src/models/Deployment');
const ErrorEvent = require('../src/models/Error');

const ensureEnv = () => {
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing. Update server/.env before seeding.');
    process.exit(1);
  }
};

const run = async () => {
  ensureEnv();
  await connectDatabase();

  const apiKey = 'demo-api-key-42';

  let project = await Project.findOne({ apiKey });
  if (!project) {
    project = await Project.create({ name: 'QA Checkout Project', apiKey });
  }

  const now = new Date();
  await Deployment.deleteMany({ projectId: project._id });
  await Deployment.create([
    {
      projectId: project._id,
      label: 'Release QA1',
      timestamp: new Date(now.getTime() - 15 * 60 * 1000),
      metadata: { version: 'qa-1.0.0' },
    },
    {
      projectId: project._id,
      label: 'Release QA0',
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      metadata: { version: 'qa-0.9.0' },
    },
  ]);

  await ErrorEvent.deleteMany({ projectId: project._id, fingerprint: 'checkout-spike-001' });
  await ErrorEvent.create({
    projectId: project._id,
    message: 'Checkout timeout exceeded',
    fingerprint: 'checkout-spike-001',
    count: 85,
    firstSeen: new Date(now.getTime() - 6 * 60 * 60 * 1000),
    lastSeen: new Date(now.getTime() - 45 * 60 * 1000),
    environment: 'production',
    status: 'investigating',
    metadata: { service: 'checkout', component: 'payment-service' },
  });

  let rule = await AlertRule.findOne({ project: project._id, name: 'Checkout spike detector QA' });
  if (!rule) {
    rule = await AlertRule.create({
      project: project._id,
      name: 'Checkout spike detector QA',
      type: 'spike',
      conditions: {
        increasePercent: 250,
        windowMinutes: 5,
        baselineMinutes: 30,
        environments: ['production'],
      },
      channels: [
        { type: 'email', target: 'oncall@example.com' },
        { type: 'slack', target: '#checkout-alerts' },
        { type: 'webhook', target: 'https://hooks.example.com/alerts' },
      ],
      description: 'QA validation alert rule',
      tags: ['qa', 'checkout'],
    });
  }

  console.log('Seed complete');
  console.log('Project API key:', apiKey);
  console.log('Alert rule id:', rule._id.toString());

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed to seed alert test data', error);
  await mongoose.disconnect();
  process.exit(1);
});
