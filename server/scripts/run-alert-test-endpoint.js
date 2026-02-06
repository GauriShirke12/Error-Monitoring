const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const createApp = require('../src/app');
const { connectDatabase } = require('../src/config/database');
const AlertRule = require('../src/models/AlertRule');

const loadConfig = () => {
  const explicitPath = process.argv[2];
  const envPath = process.env.ALERT_TEST_CONFIG;
  const defaultPath = path.join(__dirname, 'alert-test-config.json');
  const candidate = explicitPath || envPath || (fs.existsSync(defaultPath) ? defaultPath : null);

  if (!candidate) {
    console.error('Usage: node scripts/run-alert-test-endpoint.js <config.json>');
    console.error('   or set ALERT_TEST_CONFIG=/path/to/config.json');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), candidate);
  if (!fs.existsSync(resolved)) {
    console.error(`Config file not found at ${resolved}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return { path: resolved, data: parsed };
  } catch (error) {
    console.error('Failed to read config file', error);
    process.exit(1);
  }
};

const buildMissingFingerprintPayload = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  delete clone.fingerprint;
  if (clone.metadata) {
    delete clone.metadata.fingerprint;
  }
  return clone;
};

const run = async () => {
  const envPath = path.join(__dirname, '..', '.env');
  dotenv.config({ path: envPath, override: false });

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required in .env to run this script against a persistent database.');
    process.exit(1);
  }

  const { path: configPath, data: config } = loadConfig();

  const apiKey = config.apiKey || process.env.ALERT_TEST_API_KEY;
  const ruleId = config.ruleId || process.env.ALERT_TEST_RULE_ID;
  const triggerPayload = config.triggerPayload;
  const missingPayload = config.missingFingerprintPayload || buildMissingFingerprintPayload(triggerPayload);

  if (!apiKey) {
    console.error('Config must include apiKey or set ALERT_TEST_API_KEY.');
    process.exit(1);
  }

  if (!ruleId) {
    console.error('Config must include ruleId or set ALERT_TEST_RULE_ID.');
    process.exit(1);
  }

  if (!triggerPayload || typeof triggerPayload !== 'object') {
    console.error('Config must include triggerPayload with simulation fields.');
    process.exit(1);
  }

  await connectDatabase();

  const existingRule = await AlertRule.findById(ruleId).lean();
  if (!existingRule) {
    console.error(`No alert rule found for id ${ruleId}. Double-check the config at ${configPath}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/alert-rules/${ruleId}/test`;

  const request = async (label, payload) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload || {}),
    });
    let json;
    try {
      json = await response.json();
    } catch (error) {
      console.error(`${label} responded with invalid JSON`, error);
      throw error;
    }
    return { label, response, json };
  };

  try {
    const triggeredResult = await request('Triggered simulation', triggerPayload);
    console.log('--- Triggered simulation ---');
    console.log('Status:', triggeredResult.response.status);
    console.log('Evaluation:', triggeredResult.json?.data?.evaluation);
    console.log('Triggered:', triggeredResult.json?.data?.triggered);
    console.log('Why it matters:', triggeredResult.json?.data?.alert?.whyItMatters);
    console.log('Next steps:', triggeredResult.json?.data?.alert?.nextSteps);
    console.log('Channel previews:', triggeredResult.json?.data?.channels);

    if (triggeredResult.response.status !== 200) {
      throw new Error('Triggered scenario did not return HTTP 200');
    }
    if (!triggeredResult.json?.data?.evaluation) {
      throw new Error('Triggered scenario missing evaluation payload');
    }

    const missingResult = await request('Missing fingerprint scenario', missingPayload);
    console.log('--- Missing fingerprint scenario ---');
    console.log('Status:', missingResult.response.status);
    console.log('Body:', missingResult.json);

    if (missingResult.response.status !== 422) {
      throw new Error('Missing fingerprint scenario expected HTTP 422');
    }
    if ((missingResult.json?.error?.message || '').toLowerCase().includes('fingerprint') === false) {
      throw new Error('Missing fingerprint scenario did not surface validation guidance');
    }

    console.log('QA check passed for alert rule simulation.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error('Alert rule simulation QA failed', error);
  process.exitCode = 1;
});
