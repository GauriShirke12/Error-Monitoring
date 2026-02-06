/* eslint-disable no-console */
const fetch = (...args) => import('node-fetch').then(({ default: fn }) => fn(...args));

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
if (PROJECT_ID) headers['X-Project-Id'] = PROJECT_ID;

const samples = [
  'Card 4111 1111 1111 1111 failed',
  'SSN 123-45-6789 seen in payload',
  'key sk-1234567890abcd leaked',
  'pwd=supersecret and bearer abc.def.ghi',
];

(async () => {
  const payload = {
    message: samples.join(' | '),
    environment: 'production',
    stackTrace: [{ file: 'app.js', line: 1, column: 1, function: 'main' }],
  };
  const res = await fetch(`${API_BASE}/errors`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
})();
