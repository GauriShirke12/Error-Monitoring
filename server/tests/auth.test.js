const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(20000);

describe('Auth API', () => {
  let app;
  let mongoServer;
  let project;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.JWT_SECRET = 'test-secret';
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Project.deleteMany({});
    ({ project } = await createProjectWithApiKey({ name: 'Auth Project', apiKey: 'auth-key-secret' }));
    app = createApp();
  });

  it('signs up and logs in a user', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'Passw0rd!', projectId: project._id, role: 'admin' });

    if (signup.status !== 201) {
      // eslint-disable-next-line no-console
      console.log('Signup response', signup.status, signup.body);
    }
    expect(signup.status).toBe(201);
    expect(signup.body?.data?.token).toBeTruthy();
    expect(signup.body?.data?.user?.memberships[0]?.projectId).toBe(project._id.toString());
    expect(signup.body?.data?.user?.memberships[0]?.role).toBe('admin');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'Passw0rd!' });

    expect(login.status).toBe(200);
    expect(login.body?.data?.token).toBeTruthy();

    const token = login.body.data.token;
    const profile = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(profile.status).toBe(200);
    expect(profile.body?.data?.user?.email).toBe('alice@example.com');
  });

  it('rejects invalid credentials', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'Passw0rd!', projectId: project._id });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
  });
});
