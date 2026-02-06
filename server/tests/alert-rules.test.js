jest.mock('pdfkit', () => {
  return function MockPDFDocument() {
    return {
      pipe: jest.fn(),
      fontSize: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      addPage: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
  };
}, { virtual: true });

jest.mock('exceljs', () => ({
  Workbook: function MockWorkbook() {
    return {
      addWorksheet: jest.fn().mockReturnValue({
        columns: [],
        addRow: jest.fn(),
        getRow: jest.fn().mockReturnValue({ font: {}, alignment: {} }),
      }),
      xlsx: {
        writeBuffer: jest.fn().mockResolvedValue(Buffer.from([])),
      },
    };
  },
}), { virtual: true });

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const AlertRule = require('../src/models/AlertRule');
const Project = require('../src/models/Project');
const { createProjectWithApiKey } = require('./helpers/project');

jest.setTimeout(20000);

describe('Alert Rule API', () => {
  let app;
  let mongoServer;
  let project;
  let apiKey;

  const postRule = () => request(app).post('/api/alert-rules').set('X-Api-Key', apiKey);
  const getRules = () => request(app).get('/api/alert-rules').set('X-Api-Key', apiKey);
  const getRule = (id) => request(app).get(`/api/alert-rules/${id}`).set('X-Api-Key', apiKey);
  const putRule = (id) => request(app).put(`/api/alert-rules/${id}`).set('X-Api-Key', apiKey);
  const deleteRule = (id) => request(app).delete(`/api/alert-rules/${id}`).set('X-Api-Key', apiKey);

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await AlertRule.deleteMany({});
    await Project.deleteMany({});
    const created = await createProjectWithApiKey({ name: 'Alert Project' });
    apiKey = created.apiKey;
    project = created.project;
    app = createApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a threshold alert rule', async () => {
    const payload = {
      name: 'High error volume',
      type: 'threshold',
      conditions: {
        threshold: 200,
        windowMinutes: 5,
        environments: ['production'],
      },
      channels: [
        { type: 'email', target: 'alerts@example.com' },
        { type: 'slack', target: '#oncall' },
      ],
      enabled: true,
      cooldownMinutes: 30,
      description: 'Alert when checkout errors surge',
      tags: ['checkout', 'priority'],
    };

    const response = await postRule().send(payload);

    expect(response.status).toBe(201);
    expect(response.body?.data?.name).toBe(payload.name);
    expect(response.body?.data?.type).toBe('threshold');
    expect(response.body?.data?.conditions).toMatchObject({
      threshold: 200,
      windowMinutes: 5,
      environments: ['production'],
    });
    expect(response.body?.data?.channels).toHaveLength(2);
    expect(response.body?.data?.cooldownMinutes).toBe(30);
    expect(response.body?.data?.project.toString()).toBe(project._id.toString());
  });

  it('lists and retrieves alert rules for the project', async () => {
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Spike monitor',
      type: 'spike',
      conditions: {
        increasePercent: 300,
        windowMinutes: 10,
        baselineMinutes: 60,
      },
      channels: [{ type: 'email', target: 'ops@example.com' }],
    });

    const listResponse = await getRules();
    expect(listResponse.status).toBe(200);
    expect(listResponse.body?.data).toHaveLength(1);
    expect(listResponse.body.data[0]._id.toString()).toBe(rule._id.toString());

    const getResponse = await getRule(rule._id.toString());
    expect(getResponse.status).toBe(200);
    expect(getResponse.body?.data?.name).toBe('Spike monitor');
  });

  it('updates an alert rule and preserves type defaults', async () => {
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Threshold guard',
      type: 'threshold',
      conditions: {
        threshold: 100,
        windowMinutes: 10,
      },
      channels: [{ type: 'email', target: 'alerts@example.com' }],
      cooldownMinutes: 15,
    });

    const response = await putRule(rule._id.toString()).send({
      name: 'Threshold guard v2',
      enabled: false,
      conditions: {
        threshold: 150,
        windowMinutes: 8,
      },
      channels: [{ type: 'slack', target: '#alerts' }],
      cooldownMinutes: 20,
      tags: ['platform'],
    });

    expect(response.status).toBe(200);
    expect(response.body?.data?.name).toBe('Threshold guard v2');
    expect(response.body?.data?.enabled).toBe(false);
    expect(response.body?.data?.conditions).toMatchObject({
      threshold: 150,
      windowMinutes: 8,
    });
    expect(response.body?.data?.channels).toEqual([
      { type: 'slack', target: '#alerts' },
    ]);
    expect(response.body?.data?.cooldownMinutes).toBe(20);
    expect(response.body?.data?.tags).toEqual(['platform']);
  });

  it('deletes an alert rule', async () => {
    const rule = await AlertRule.create({
      project: project._id,
      name: 'Critical alert',
      type: 'critical',
      conditions: { severity: 'critical' },
    });

    const response = await deleteRule(rule._id.toString());
    expect(response.status).toBe(204);
    const remaining = await AlertRule.findById(rule._id);
    expect(remaining).toBeNull();
  });

  it('rejects invalid payloads', async () => {
    const response = await postRule().send({
      type: 'threshold',
      conditions: { threshold: 5, windowMinutes: 0 },
    });

    expect(response.status).toBe(422);
    expect(response.body?.error?.details?.length).toBeGreaterThan(0);
  });
});
