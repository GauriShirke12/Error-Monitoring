const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

const createApp = require('../src/app');
const Project = require('../src/models/Project');
const User = require('../src/models/User');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(30000);

describe('Project management API', () => {
  let app;
  let mongoServer;

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
    await Promise.all([Project.deleteMany({}), User.deleteMany({})]);
    app = createApp();
  });

  const createUserWithToken = async ({ role = 'admin', project } = {}) => {
    const memberships = [];
    if (project) {
      memberships.push({ projectId: project._id, role });
    }

    const user = await User.create({
      name: 'Test User',
      email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'hashed',
      memberships,
    });

    const token = jwt.sign({ sub: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { user, token };
  };

  it('returns projects for the authenticated user with role metadata', async () => {
    const { project, apiKey } = await createProjectWithApiKey({ name: 'Primary', apiKey: 'proj_primary_value' });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body?.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: project._id.toString(),
      name: 'Primary',
      role: 'admin',
      apiKeyPreview: apiKey.slice(-8),
    });
    expect(response.body.data[0].apiKey).toBeUndefined();
  });

  it('hides API keys for non-admin members', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Shared', apiKey: 'proj_shared_value' });
    const { token } = await createUserWithToken({ role: 'developer', project });

    const response = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body?.data?.[0]?.apiKey).toBeUndefined();
    expect(response.body?.data?.[0]?.role).toBe('developer');
    expect(response.body?.data?.[0]?.apiKeyPreview).toBeUndefined();
  });

  it('creates a new project and assigns membership to the creator', async () => {
    const { user, token } = await createUserWithToken();

    const response = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Project' });

    expect(response.status).toBe(201);
    expect(response.body?.data?.name).toBe('New Project');
    expect(response.body?.data?.apiKey).toEqual(expect.stringMatching(/^proj_/));
    expect(response.body?.data?.apiKeyPreview).toEqual(response.body.data.apiKey.slice(-8));

    const reloadedUser = await User.findById(user._id).lean();
    const membership = reloadedUser.memberships.find((entry) => entry.projectId.toString() === response.body.data.id);
    expect(membership).toBeTruthy();
    expect(membership.role).toBe('admin');
  });

  it('rotates the API key for an admin project member', async () => {
    const { project, apiKey } = await createProjectWithApiKey({ name: 'Rotate' });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .post(`/api/projects/${project._id.toString()}/rotate-key`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body?.data?.apiKey).toEqual(expect.stringMatching(/^proj_/));
    expect(response.body.data.apiKey).not.toBe(apiKey);
    expect(response.body?.data?.apiKeyPreview).toEqual(response.body.data.apiKey.slice(-8));

    const updated = await Project.findById(project._id).lean();
    expect(updated.apiKeyHash).toBeTruthy();
    expect(updated.apiKeyPreview).toBe(response.body.data.apiKeyPreview);
  });

  it('prevents non-admin members from rotating API keys', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Forbidden' });
    const { token } = await createUserWithToken({ role: 'viewer', project });

    const response = await request(app)
      .post(`/api/projects/${project._id.toString()}/rotate-key`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('allows admin users to rename projects', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Legacy' });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .patch(`/api/projects/${project._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Project' });

    expect(response.status).toBe(200);
    expect(response.body?.data?.name).toBe('Renamed Project');

    const updated = await Project.findById(project._id).lean();
    expect(updated.name).toBe('Renamed Project');
  });

  it('returns scrubbing and retention settings for admin members', async () => {
    const { project } = await createProjectWithApiKey({
      name: 'Privacy',
      scrubbing: { removeEmails: true, removePhones: false, removeIPs: true },
      retentionDays: 45,
    });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body?.data?.[0]?.scrubbing).toEqual({
      removeEmails: true,
      removePhones: false,
      removeIPs: true,
    });
    expect(response.body?.data?.[0]?.retentionDays).toBe(45);
  });

  it('hides scrubbing and retention for non-admin members', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Viewer Privacy' });
    const { token } = await createUserWithToken({ role: 'viewer', project });

    const response = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body?.data?.[0]?.scrubbing).toBeUndefined();
    expect(response.body?.data?.[0]?.retentionDays).toBeUndefined();
  });

  it('updates scrubbing flags and retention days', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Update Privacy' });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .patch(`/api/projects/${project._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Update Privacy',
        scrubbing: { removeEmails: true, removePhones: true },
        retentionDays: 30,
      });

    expect(response.status).toBe(200);
    expect(response.body?.data?.scrubbing).toEqual({
      removeEmails: true,
      removePhones: true,
      removeIPs: false,
    });
    expect(response.body?.data?.retentionDays).toBe(30);

    const updated = await Project.findById(project._id).lean();
    expect(updated.scrubbing).toEqual({ removeEmails: true, removePhones: true, removeIPs: false });
    expect(updated.retentionDays).toBe(30);
  });

  it('validates retention days bounds', async () => {
    const { project } = await createProjectWithApiKey({ name: 'Invalid Retention' });
    const { token } = await createUserWithToken({ role: 'admin', project });

    const response = await request(app)
      .patch(`/api/projects/${project._id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Invalid Retention', retentionDays: 0 });

    expect(response.status).toBe(422);
    expect(response.body?.error?.message).toMatch(/Retention/);
  });
});
