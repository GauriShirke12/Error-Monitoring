import http from 'k6/http';
import { sleep } from 'k6';

const API_BASE = __ENV.API_BASE_URL || 'http://localhost:4000/api';
const API_KEY = __ENV.API_KEY;
const PROJECT_ID = __ENV.PROJECT_ID;

if (!API_KEY) {
  throw new Error('Set API_KEY environment variable (project API key)');
}

const headers = {
  'Content-Type': 'application/json',
  'X-Api-Key': API_KEY,
};

if (PROJECT_ID) {
  headers['X-Project-Id'] = PROJECT_ID;
}

export const options = {
  vus: 5,
  duration: '1m',
};

export default function () {
  // Hit dashboard endpoint (per-minute key limit: 100)
  http.get(`${API_BASE}/analytics/overview`, { headers });

  // Hit ingestion endpoint (per-hour key limit: 1000)
  const payload = JSON.stringify({
    message: 'Rate limit probe',
    environment: 'staging',
    fingerprint: `probe-${__ITER}`,
  });
  http.post(`${API_BASE}/errors`, payload, { headers });

  sleep(1);
}
