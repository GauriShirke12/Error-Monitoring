const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const ErrorEvent = require('../src/models/Error');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(20000);

describe('Role-based access control', () => {
  let app;
  let mongoServer;
  let project;
  let errorEvent;

  const signupAndGetToken = async ({ name, email, role }) => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name,
        email,
        password: 'Passw0rd!',
        projectId: project._id.toString(),
        role,
      });

    if (!response.body?.data?.token) {
      throw new Error(`Failed to create ${role} user: ${response.status} ${JSON.stringify(response.body)}`);
    }

    return response.body.data.token;
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.JWT_SECRET = 'test-secret';
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Project.deleteMany({}), ErrorEvent.deleteMany({})]);
    ({ project } = await createProjectWithApiKey({ name: 'RBAC Project', apiKey: 'rbac-key-secret' }));
    errorEvent = await ErrorEvent.create({
      projectId: project._id,
      message: 'ReferenceError: foo is not defined',
      fingerprint: 'ref-error',
      environment: 'production',
    });
    app = createApp();
  });

  it('allows viewers to read errors but blocks mutations', async () => {
    const viewerToken = await signupAndGetToken({ name: 'Viewer', email: 'viewer@example.com', role: 'viewer' });

    const listResponse = await request(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body?.data)).toBe(true);

    const updateResponse = await request(app)
      .patch(`/api/errors/${errorEvent._id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'resolved' });

    expect(updateResponse.status).toBe(403);
  });

  it('allows developers to resolve errors but not delete them', async () => {
    const developerToken = await signupAndGetToken({ name: 'Dev', email: 'dev@example.com', role: 'developer' });

    const resolveResponse = await request(app)
      .patch(`/api/errors/${errorEvent._id}`)
      .set('Authorization', `Bearer ${developerToken}`)
      .send({ status: 'resolved' });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body?.data?.status).toBe('resolved');

    const deleteResponse = await request(app)
      .delete(`/api/errors/${errorEvent._id}`)
      .set('Authorization', `Bearer ${developerToken}`);

    expect(deleteResponse.status).toBe(403);
  });

  it('grants admins full access', async () => {
    const adminToken = await signupAndGetToken({ name: 'Admin', email: 'admin@example.com', role: 'admin' });

    const deleteResponse = await request(app)
      .delete(`/api/errors/${errorEvent._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteResponse.status).toBe(204);

    const remaining = await ErrorEvent.findById(errorEvent._id);
    expect(remaining).toBeNull();
  });
});
