const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const ErrorEvent = require('../src/models/Error');
const ErrorOccurrence = require('../src/models/Occurrence');
const Project = require('../src/models/Project');
const Deployment = require('../src/models/Deployment');
const analyticsCache = require('../src/utils/analytics-cache');
const { createProjectWithApiKey } = require('./helpers/project');

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

jest.setTimeout(30000);

describe('Analytics API', () => {
  let app;
  let mongoServer;
  let project;
  let apiKey;

  const baseStack = [
    { file: 'App.jsx', line: 12, column: 4, function: 'render', inApp: true },
    { file: 'index.js', line: 5, column: 2, function: '<init>' },
  ];

  const postError = () => request(app).post('/api/errors').set('X-Api-Key', apiKey);
  const getOverview = () => request(app).get('/api/analytics/overview').set('X-Api-Key', apiKey);
  const getTrends = (query = {}) =>
    request(app)
      .get('/api/analytics/trends')
      .set('X-Api-Key', apiKey)
      .query(query);
  const getTopErrors = (query = {}) =>
    request(app)
      .get('/api/analytics/top-errors')
      .set('X-Api-Key', apiKey)
      .query(query);
  const getPatterns = (query = {}) =>
    request(app)
      .get('/api/analytics/patterns')
      .set('X-Api-Key', apiKey)
      .query(query);
  const getRelatedErrors = (query = {}) =>
    request(app)
      .get('/api/analytics/related-errors')
      .set('X-Api-Key', apiKey)
      .query(query);
  const getUserImpact = (query = {}) =>
    request(app)
      .get('/api/analytics/user-impact')
      .set('X-Api-Key', apiKey)
      .query(query);
  const getResolution = (query = {}) =>
    request(app)
      .get('/api/analytics/resolution')
      .set('X-Api-Key', apiKey)
      .query(query);

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
    analyticsCache.invalidateAll();
    await Promise.all([
      ErrorEvent.deleteMany({}),
      ErrorOccurrence.deleteMany({}),
      Deployment.deleteMany({}),
      Project.deleteMany({}),
    ]);
    const created = await createProjectWithApiKey({ name: 'Analytics Project' });
    project = created.project;
    apiKey = created.apiKey;
    app = createApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns overview analytics with cached invalidation on new data', async () => {
    const now = Date.now();

    // Error within last 24h with multiple occurrences
    const payload = {
      message: 'ReferenceError: foo is not defined',
      stackTrace: baseStack,
      environment: 'production',
      metadata: { release: '1.0.0' },
    };

    await postError().send({ ...payload, userContext: { userId: 'user-1' }, timestamp: new Date(now).toISOString() });
    await postError().send({ ...payload, userContext: { userId: 'user-2' }, timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString() });
    await postError().send({ ...payload, userContext: { userId: 'user-1' }, timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString() });

    // Error older than 24h
    await postError().send({
      message: 'TypeError: Cannot read properties of undefined',
      stackTrace: baseStack,
      environment: 'production',
      timestamp: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    });

    // Another recent error in staging
    await postError().send({
      message: 'SyntaxError: Unexpected token',
      stackTrace: baseStack,
      environment: 'staging',
      userContext: { userId: 'user-3' },
    });

    const firstResponse = await getOverview();
    expect(firstResponse.status).toBe(200);
    const initialTotals = firstResponse.body.data.totals.totalErrors.current;
    expect(initialTotals).toBeGreaterThanOrEqual(3);
    expect(typeof firstResponse.body.data.totals.totalErrors.previous).toBe('number');
    expect(firstResponse.body.data.totals.newErrors24h.current).toBeGreaterThanOrEqual(2);
    expect(firstResponse.body.data.totals.occurrences24h).toBeGreaterThanOrEqual(3);
    expect(firstResponse.body.data.errorRateTrend).toHaveLength(24);
    expect(firstResponse.body.data.mostFrequentErrors.length).toBeGreaterThan(0);

    const cachedResponse = await getOverview();
    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.body.data.totals.totalErrors.current).toBe(initialTotals);

    // Ingest new error to invalidate cache
    await postError().send({
      message: 'RangeError: Maximum call stack size exceeded',
      stackTrace: baseStack,
      environment: 'production',
      userContext: { userId: 'user-4' },
    });

    const updatedResponse = await getOverview();
    expect(updatedResponse.status).toBe(200);
    expect(updatedResponse.body.data.totals.totalErrors.current).toBeGreaterThan(initialTotals);
  });

  it('returns trends analytics for 7 day range with environment filter support', async () => {
    const now = Date.now();

    // Populate occurrences across 7 days for two environments
    for (let day = 0; day < 7; day += 1) {
      await postError().send({
        message: `Prod failure day ${day}`,
        stackTrace: baseStack,
        environment: 'production',
        userContext: { userId: `user-${day % 3}` },
        timestamp: new Date(now - day * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    for (let day = 0; day < 3; day += 1) {
      await postError().send({
        message: `Stage failure day ${day}`,
        stackTrace: baseStack,
        environment: 'staging',
        userContext: { userId: `stage-user-${day}` },
        timestamp: new Date(now - day * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    const response = await getTrends({ range: '7d' });
    expect(response.status).toBe(200);
    expect(response.body.data.range.key).toBe('7d');
    expect(response.body.data.range.unit).toBe('day');
    expect(response.body.data.timeSeries).toHaveLength(7);
    expect(response.body.data.totals.occurrences).toBe(10);
    expect(response.body.data.environmentBreakdown.some((item) => item.environment === 'production')).toBe(true);

    const stagingOnly = await getTrends({ range: '7d', environment: 'staging' });
    expect(stagingOnly.status).toBe(200);
    expect(stagingOnly.body.data.totals.occurrences).toBe(3);
    expect(stagingOnly.body.data.environmentBreakdown).toHaveLength(1);
    expect(stagingOnly.body.data.environmentBreakdown[0].environment).toBe('staging');
  });

  it('rejects invalid range for trends', async () => {
    const response = await getTrends({ range: 'invalid' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('Invalid range');
  });

  it('returns top error analytics with environment filtering', async () => {
    const createError = async ({ message, environment, occurrences = 1, status }) => {
      const payload = {
        message,
        stackTrace: baseStack,
        environment,
      };
      let lastResponse;
      for (let i = 0; i < occurrences; i += 1) {
        lastResponse = await postError().send(payload);
      }
      if (status) {
        await ErrorEvent.updateOne({ _id: lastResponse.body.data.errorId }, { status });
      }
      return lastResponse.body.data.errorId;
    };

    const criticalId = await createError({ message: 'Critical failure', environment: 'production', occurrences: 5, status: 'open' });
    await createError({ message: 'Minor warning', environment: 'staging', occurrences: 2, status: 'resolved' });
    await createError({ message: 'Another active bug', environment: 'production', occurrences: 3, status: 'investigating' });

    const response = await getTopErrors();
    expect(response.status).toBe(200);
    expect(response.body.data.topByCount[0].id).toBe(criticalId);
    expect(response.body.data.criticalErrors.every((item) => ['new', 'open', 'investigating'].includes(item.status))).toBe(true);
    expect(response.body.data.environmentBreakdown.length).toBeGreaterThanOrEqual(1);

    const stagingOnly = await getTopErrors({ environment: 'staging' });
    expect(stagingOnly.status).toBe(200);
    expect(stagingOnly.body.data.topByCount.every((item) => item.environment === 'staging')).toBe(true);
    expect(stagingOnly.body.data.environmentBreakdown).toHaveLength(1);
  });
  
  it('returns resolution analytics with reopen tracking and verification averages', async () => {
    const HOUR_MS = 60 * 60 * 1000;
    const anchor = new Date();
    const hoursAgo = (hours) => new Date(anchor.getTime() - hours * HOUR_MS);

    const resolvedFast = await ErrorEvent.create({
      projectId: project._id,
      message: 'Checkout step failure',
      stackTrace: baseStack,
      fingerprint: `res-${Date.now()}-${Math.random()}`,
      count: 12,
      environment: 'production',
      status: 'muted',
      firstSeen: hoursAgo(6),
      lastSeen: hoursAgo(1.2),
      resolvedAt: hoursAgo(1),
      statusHistory: [
        { status: 'new', changedAt: hoursAgo(6) },
        { status: 'resolved', changedAt: hoursAgo(1) },
        { status: 'muted', changedAt: hoursAgo(0.5) },
      ],
      metadata: { errorType: 'api' },
    });

    const reopened = await ErrorEvent.create({
      projectId: project._id,
      message: 'Payment timeout spike',
      stackTrace: baseStack,
      fingerprint: `res-${Date.now()}-${Math.random()}`,
      count: 7,
      environment: 'production',
      status: 'investigating',
      firstSeen: hoursAgo(48),
      lastSeen: hoursAgo(6),
      resolvedAt: hoursAgo(30),
      statusHistory: [
        { status: 'new', changedAt: hoursAgo(48) },
        { status: 'resolved', changedAt: hoursAgo(30) },
        { status: 'open', changedAt: hoursAgo(18) },
        { status: 'investigating', changedAt: hoursAgo(6) },
      ],
      metadata: { category: 'frontend' },
    });

    const unresolved = await ErrorEvent.create({
      projectId: project._id,
      message: 'Sync worker crash',
      stackTrace: baseStack,
      fingerprint: `res-${Date.now()}-${Math.random()}`,
      count: 9,
      environment: 'staging',
      status: 'open',
      firstSeen: hoursAgo(72),
      lastSeen: hoursAgo(3),
      statusHistory: [
        { status: 'new', changedAt: hoursAgo(72) },
        { status: 'open', changedAt: hoursAgo(48) },
      ],
      metadata: { type: 'backend' },
    });

    const response = await getResolution();
    expect(response.status).toBe(200);

    const payload = response.body.data;
    expect(payload).toBeDefined();
    expect(payload.summary.totalTracked).toBe(3);
    expect(payload.summary.resolvedCount).toBe(2);
    expect(payload.summary.unresolvedCount).toBe(1);
    expect(payload.summary.reopenedCount).toBe(1);

    const expectedAverageResolveMs = ((hoursAgo(1).getTime() - hoursAgo(6).getTime()) + (hoursAgo(30).getTime() - hoursAgo(48).getTime())) / 2;
    expect(Math.abs(payload.summary.averageResolveMs - expectedAverageResolveMs)).toBeLessThan(1000);

    const expectedVerifyMs = hoursAgo(0.5).getTime() - hoursAgo(1).getTime();
    expect(Math.abs(payload.summary.averageVerifyMs - expectedVerifyMs)).toBeLessThan(1000);

    const apiType = payload.byType.find((entry) => entry.type === 'api');
    expect(apiType).toBeDefined();
    expect(apiType.resolved).toBe(1);
    expect(apiType.tracked).toBe(1);
    expect(Math.abs(apiType.averageResolveMs - (hoursAgo(1).getTime() - hoursAgo(6).getTime()))).toBeLessThan(1000);
    expect(Math.abs(apiType.averageVerifyMs - expectedVerifyMs)).toBeLessThan(1000);

    const frontendType = payload.byType.find((entry) => entry.type === 'frontend');
    expect(frontendType).toBeDefined();
    expect(frontendType.reopened).toBe(1);
    expect(frontendType.resolved).toBe(1);

    const slowest = payload.slowestResolved[0];
    expect(slowest).toBeDefined();
    expect(slowest.id).toBe(reopened._id.toString());
    expect(Math.abs(slowest.resolveMs - (hoursAgo(30).getTime() - hoursAgo(48).getTime()))).toBeLessThan(1000);

    const backlogItem = payload.unresolvedBacklog[0];
    expect(backlogItem).toBeDefined();
    expect(backlogItem.id).toBe(unresolved._id.toString());
    const expectedAgeMs = new Date().getTime() - unresolved.firstSeen.getTime();
    expect(Math.abs(backlogItem.ageMs - expectedAgeMs)).toBeLessThan(2 * 60 * 1000);

    expect(payload.summary.averageVerifyMs).toBeGreaterThanOrEqual(0);
    expect(payload.summary.averageResolveMs).toBeGreaterThan(0);
    expect(payload.unresolvedBacklog.length).toBeGreaterThanOrEqual(1);
    expect(payload.slowestResolved.length).toBeGreaterThanOrEqual(1);
    expect(payload.byType.length).toBeGreaterThanOrEqual(3);

    // Silence linter warnings for unused variables in case expectations change.
    expect(resolvedFast).toBeDefined();
  });

  it('returns patterns analytics with hotspots, spikes, and deployment impact', async () => {
    const HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();

    const checkoutStack = [
      { file: 'src/components/CheckoutButton.jsx', line: 42, column: 10, function: 'handleCheckout', inApp: true },
      { file: 'App.jsx', line: 12, column: 4, function: 'render' },
    ];

    for (let hour = 0; hour < 7; hour += 1) {
      const bucketStart = new Date(now - (6 - hour) * HOUR_MS);
      const occurrences = hour === 6 ? 6 : 1;
      for (let index = 0; index < occurrences; index += 1) {
        await postError().send({
          message: 'Checkout surge during release',
          stackTrace: checkoutStack,
          environment: 'production',
          metadata: { sourceFile: 'src/components/CheckoutButton.jsx' },
          userContext: {
            userId: `checkout-user-${hour}-${index}`,
            sessionId: `checkout-session-${hour}`,
          },
          timestamp: new Date(bucketStart.getTime() + index * 5000).toISOString(),
        });
      }
    }

    const searchStack = [
      { file: 'src/components/SearchBox.jsx', line: 18, column: 6, function: 'renderInput', inApp: true },
      { file: 'App.jsx', line: 12, column: 4, function: 'render' },
    ];

    for (let index = 0; index < 3; index += 1) {
      await postError().send({
        message: `Search API warning ${index}`,
        stackTrace: searchStack,
        environment: 'production',
        metadata: { sourceFile: 'src/components/SearchBox.jsx' },
        userContext: { userId: `search-user-${index}`, sessionId: `search-session-${index}` },
      });
    }

    const deploymentTimestamp = new Date(now - 12 * HOUR_MS);
    await Deployment.create({
      projectId: project._id,
      label: 'Release 104',
      timestamp: deploymentTimestamp,
      metadata: { version: '104.0.0' },
    });

    const beforeTimestamp = new Date(deploymentTimestamp.getTime() - 30 * 60 * 1000);
    for (let index = 0; index < 2; index += 1) {
      await postError().send({
        message: 'Regression candidate',
        stackTrace: checkoutStack,
        environment: 'production',
        metadata: { sourceFile: 'src/components/ReleaseBanner.jsx' },
        userContext: { userId: `before-user-${index}`, sessionId: 'deployment-session-before' },
        timestamp: new Date(beforeTimestamp.getTime() + index * 10 * 1000).toISOString(),
      });
    }

    const afterTimestamp = new Date(deploymentTimestamp.getTime() + 20 * 60 * 1000);
    for (let index = 0; index < 5; index += 1) {
      await postError().send({
        message: 'Regression candidate',
        stackTrace: checkoutStack,
        environment: 'production',
        metadata: { sourceFile: 'src/components/ReleaseBanner.jsx' },
        userContext: { userId: `after-user-${index}`, sessionId: 'deployment-session-after' },
        timestamp: new Date(afterTimestamp.getTime() + index * 15 * 1000).toISOString(),
      });
    }

    const response = await getPatterns();
    expect(response.status).toBe(200);

    const payload = response.body.data;
    expect(payload).toBeDefined();
    expect(Array.isArray(payload.hotspots)).toBe(true);
    expect(payload.hotspots.length).toBeGreaterThanOrEqual(1);
    expect(payload.hotspots[0].filePath).toBe('src/components/CheckoutButton.jsx');

    expect(payload.spikes.timeline.length).toBeGreaterThan(0);
    expect(payload.spikes.spikes.length).toBeGreaterThan(0);
    const topSpike = payload.spikes.spikes[0];
    expect(topSpike.multiplier).toBeGreaterThanOrEqual(2);
    expect(topSpike.contributors.length).toBeGreaterThan(0);
    expect(
      topSpike.contributors.some((entry) =>
        ['Checkout surge during release', 'Regression candidate'].includes(entry.message)
      )
    ).toBe(true);

    expect(payload.deployments.deployments.length).toBeGreaterThan(0);
    const deploymentImpact = payload.deployments.deployments[0];
    expect(deploymentImpact.metrics.before.occurrences).toBe(2);
    expect(deploymentImpact.metrics.after.occurrences).toBe(5);
    expect(deploymentImpact.metrics.changeAbsolute).toBe(3);
    expect(deploymentImpact.metrics.rollbackSuggested).toBe(true);
  });

  it('returns user impact analytics with journeys and unique counts', async () => {
    const now = Date.now();
    const baseStack = [
      { file: 'src/pages/Checkout.jsx', line: 56, column: 12, function: 'submitOrder', inApp: true },
      { file: 'App.jsx', line: 12, column: 4, function: 'render' },
    ];

    const basePayload = {
      stackTrace: baseStack,
      environment: 'production',
      metadata: {
        pageUrl: '/checkout',
        previousRoute: '/cart',
        action: 'submit-order',
      },
    };

    await postError().send({
      ...basePayload,
      message: 'Checkout failed: payment declined',
      userContext: { userId: 'user-1', sessionId: 'session-1' },
      timestamp: new Date(now - 60 * 1000).toISOString(),
    });
    await postError().send({
      ...basePayload,
      message: 'Checkout failed: payment declined',
      userContext: { userId: 'user-2', sessionId: 'session-2' },
      timestamp: new Date(now - 30 * 1000).toISOString(),
    });
    await postError().send({
      ...basePayload,
      message: 'Checkout failed: payment declined',
      userContext: { userId: 'user-1', sessionId: 'session-1' },
      timestamp: new Date(now - 10 * 1000).toISOString(),
    });

    await postError().send({
      message: 'Search results timed out',
      stackTrace: baseStack,
      environment: 'production',
      metadata: {
        pageUrl: '/search',
        previousRoute: '/home',
        action: 'submit-search',
      },
      userContext: { userId: 'user-3', sessionId: 'session-3' },
      timestamp: new Date(now - 20 * 1000).toISOString(),
    });

    const response = await getUserImpact();
    expect(response.status).toBe(200);

    const payload = response.body.data;
    expect(payload.summary.totalOccurrences).toBe(4);
    expect(payload.summary.uniqueUsers).toBe(3);
    expect(payload.summary.sessions).toBeGreaterThanOrEqual(3);

    expect(payload.topErrors.length).toBeGreaterThan(0);
    const topError = payload.topErrors[0];
    expect(topError.message).toBe('Checkout failed: payment declined');
    expect(topError.uniqueUsers).toBe(2);
    expect(topError.sessions).toBeGreaterThanOrEqual(2);
    expect(topError.pageViews).toBeGreaterThanOrEqual(1);
    expect(topError.journey.topPrevious[0].value).toBe('/cart');
    expect(topError.journey.topActions[0].value).toBe('submit-order');
    expect(topError.journey.sampleSessions.length).toBeGreaterThan(0);
  });

  it('returns related error correlations grouped by session', async () => {
    const now = Date.now();
    const correlatedStack = [
      { file: 'src/components/Dashboard.jsx', line: 21, column: 8, function: 'renderCharts', inApp: true },
      { file: 'App.jsx', line: 12, column: 4, function: 'render' },
    ];

    const basePayload = {
      stackTrace: correlatedStack,
      environment: 'production',
      userContext: { userId: 'rel-user', sessionId: 'session-rel-1' },
    };

    await postError().send({
      ...basePayload,
      message: 'API request timeout',
      timestamp: new Date(now - 2 * 60 * 1000).toISOString(),
    });

    await postError().send({
      ...basePayload,
      message: 'UI failed to render',
      timestamp: new Date(now - 2 * 60 * 1000 + 30 * 1000).toISOString(),
    });

    await postError().send({
      ...basePayload,
      message: 'UI failed to render',
      timestamp: new Date(now - 2 * 60 * 1000 + 50 * 1000).toISOString(),
    });

    const response = await getRelatedErrors();
    expect(response.status).toBe(200);

    const payload = response.body.data;
    expect(payload.nodes.length).toBeGreaterThanOrEqual(2);
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.groups.length).toBeGreaterThan(0);
    expect(payload.edges[0].samples.length).toBeGreaterThan(0);

    const filtered = await getRelatedErrors({ environment: 'staging' });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.nodes).toHaveLength(0);
    expect(filtered.body.data.edges).toHaveLength(0);
  });
});
