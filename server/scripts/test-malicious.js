/* eslint-disable no-console */
const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000/api';
const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;

if (!API_KEY) {
  console.error('Set API_KEY env var (project API key)');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'X-Api-Key': API_KEY,
};
if (PROJECT_ID) {
  headers['X-Project-Id'] = PROJECT_ID;
}

const payload = {
  message: '<script>alert(1)</script> Massive attack \u0007 with card 4111 1111 1111 1111',
  environment: 'staging<script>steal()</script>',
  stackTrace: [
    { file: '/app/index.js', line: 10, column: 2, function: '<img src=x onerror=alert(1)>' },
  ],
  metadata: {
    tags: { source: '<svg onload=alert(2)>' },
    context: { note: 'DROP TABLE users; --' },
  },
  userContext: { email: 'attacker@example.com', role: '<b>h4x0r</b>' },
};

(async () => {
  const res = await fetch(`${API_BASE}/errors`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
})();
