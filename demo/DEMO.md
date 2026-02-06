# Error Monitor Demo Runbook

## 1) Run the stack locally
- From repo root:
```bash
docker compose up -d --build
```
- Health: `curl http://localhost:4000/health` → expect `{ status: "ok" }`.
- Services: `docker compose ps` (api, worker, web, mongo, redis). Logs: `docker compose logs -f api web`.

## 2) Create an API key (X-Api-Key)
- Ensure server/.env has a Mongo URI (default compose works).
- Create a project and key:
```bash
cd server
node scripts/create-project.js demo-local
```
- Copy the printed API Key (store it; the hash only is stored in DB).

## 3) SDK deps (once)
```bash
cd sdk
npm install
```

## 4) Browser demo
- File: [demo/browser-demo.html](demo/browser-demo.html). Open via a local file or serve:
```bash
cd demo
npx serve . --listen 4173
```
- In the page, paste your API key and ensure API URL is `http://localhost:4000/api/errors`.
- Buttons:
  - Throw JS Error → uncaught error
  - Unhandled Promise → rejection
  - Capture Handled Error → manual capture
  - Flush Queue → sends any queued (when offline toggle was on)
- Status updates show send/queue results. API responses should be 201/202.

## 5) Node demo
- File: [demo/node-demo.mjs](demo/node-demo.mjs).
- Run with your key:
```bash
cd demo
ERROR_MONITOR_API_KEY=PASTE_KEY node node-demo.mjs
```
- Behavior: queues one offline event, flips online, batches sends, and exits after flush. Watch console for batch sends.
- Customize endpoint if needed: set ERROR_MONITOR_API_URL (default http://localhost:4000/api/errors).

## 6) Verify ingestion and grouping
- List recent errors (requires X-Api-Key):
```bash
curl -H "X-Api-Key: PASTE_KEY" "http://localhost:4000/api/errors?limit=5"
```
- Expect 200 with an array; repeated same message should show `count` increment and same fingerprint.

## 7) Analytics endpoints
- Overview:
```bash
curl -H "X-Api-Key: PASTE_KEY" "http://localhost:4000/api/analytics/overview"
```
- Trends/top errors/patterns/user-impact/resolution are under `/api/analytics/*` and need the same header.
- Success: JSON aggregates reflecting the demo events (counts rise after each batch).

## 8) Inspect MongoDB
```bash
docker compose exec mongo mongosh
use error_monitor_dev
db.errorevents.find().sort({ lastSeen: -1 }).limit(3)
db.erroroccurrences.find().sort({ timestamp: -1 }).limit(3)
```
- Expect messages matching your demo errors; `count` on errorevents should reflect grouping; occurrences show per-event metadata.

## 9) Offline, batching, retries (hands-on)
- Browser: toggle "Force offline", trigger errors, then untoggle → queued events flush.
- Node: already simulates offline/online; batch size 5 with backoff [0.5s, 1s, 2s].
- Watch `docker compose logs -f api` to see ingestion lines; 202 indicates accepted during transient DB issues.

## 10) Recruiter demo flow (suggested)
1) Start fresh: `docker compose down -v && docker compose up -d --build`
2) Create API key (step 2).
3) Run browser demo: show a crash → Network request (201/202) → API log line → Mongo doc.
4) Run node demo: show batching and offline retry.
5) Open dashboard at http://localhost:3000: show group counts and analytics updating.

## 11) If something looks wrong
- 4xx from API: confirm X-Api-Key matches DB project; CORS allowlist includes your origin (null/file:// allowed by default).
- 5xx: check `docker compose logs -f api`; DB down? verify mongo container and MONGODB_URI.
- No grouping: ensure repeated errors share the same message/stack; fingerprints differ if stack frames differ.
- Empty analytics: ensure events exist in time window; remove filters.

Happy testing! Keep the API key safe; generate a fresh one per demo if needed.
