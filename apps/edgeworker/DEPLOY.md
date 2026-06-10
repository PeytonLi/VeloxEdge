# VeloxEdge EdgeWorker deploy runbook

This directory builds a deployable Akamai EdgeWorkers bundle for the live
VeloxEdge value loop.

## Self-contained deployment (no EdgeWorkers required)

When Akamai EdgeWorkers access is unavailable, the Next.js web app runs the
full value loop locally via the built-in emulator. **No EdgeWorker activation
is required** — the emulator provides real pre-fetch, hit/miss measurement,
and reward computation identical to the EdgeWorker path.

1. **Leave `VELOX_EDGEWORKER_URL` unset** in `.env` (or omit it entirely).
2. **Deploy the Next.js app** to any Node.js host:
   - **Vercel:** `vercel deploy` (or connect the repo for auto-deploy)
   - **Akamai Connected Cloud (Linode):** standard Node.js 18+ deployment
   - **Railway / Render / Fly.io:** point at the `apps/web` directory
   - **Local dev:** `pnpm --filter web dev` → `http://localhost:3000`
3. All `/api/edge/*` routes automatically use the local emulator when no
   EdgeWorker URL is configured.
4. The mock origin at `/api/origin/[asset]` serves real asset payloads with
   cold-latency simulation, completing the real measured value loop.

### What runs where (self-contained mode)

```
Browser (dashboard UI)
  │ POST /api/edge/predict
  ▼
Next.js API route ──▶ edgeKvEmulator.predict()
  │                      ├─ LinUCB engine (in-memory)
  │                      ├─ fetch(/api/origin/[key]) → cache asset
  │                      └─ write pending prediction
  │
  │ POST /api/edge/resolve
  ▼
Next.js API route ──▶ edgeKvEmulator.resolve()
                         ├─ check in-memory asset cache → HIT/MISS
                         ├─ reward = rewardFromLatency(measuredMs, edgeMs, coldMs)
                         └─ engine.updateWeights(...) → sole bandit writer
```

### Optional: Akamai EdgeWorkers deployment

If EdgeWorkers access is restored, set `VELOX_EDGEWORKER_URL` in `.env` and
follow the deployment steps below. The API routes will automatically proxy to
the real EdgeWorker instead of the emulator.

---

## EdgeWorker deployment (requires EdgeWorkers + EdgeKV access)

The worker exposes:

- `GET /health` — health check
- `POST /predict` — read-only LinUCB prediction, origin prefetch, EdgeKV asset write, pending attribution write
- `POST /resolve` — real cache hit/miss measurement, latency-derived reward, and the only live bandit-state update
- `POST /update` — legacy/manual reward path retained for compatibility
- `POST /reset` — reset by writing fresh state; no EdgeKV delete is used

`/predict` does not mutate `A`/`b`. It only reads session state, prefetches the
predicted asset, and records a pending prediction. `/resolve` is the live writer:
it reads the requested asset from EdgeKV, falls back to origin on miss, computes
reward from measured latency, and persists the updated engine state.

## EdgeKV layout and TTLs

```text
namespace: veloxedge

group: sessions
item:  veloxedge_<sessionId>
ttl:   3600s

group: assets
item:  asset_<derived asset key, sanitized>
ttl:   60s

group: pending
item:  pending_<sessionId>_<step>
ttl:   300s
```

Namespace/group retention should be at least as long as the item TTLs above.
The worker still writes explicit item TTLs on EdgeKV PUTs so stale assets and
attribution records age out quickly.

## Security rules

Do not commit Akamai credentials. The real `edgekv_tokens.js` is gitignored.
Only `edgekv_tokens.example.js` is committed.

Set a shared secret for dashboard/API-route-to-worker calls. When
`VELOX_EDGE_SECRET` is configured in the worker environment, every POST request
must include:

```text
x-velox-edge-secret: <same secret>
```

Do not activate this worker from an automated agent. Activation is a human
operator step after reviewing the bundle and property association.

## Prerequisites

- Akamai CLI installed and authenticated with an `.edgerc` profile owned by the operator
- EdgeWorkers CLI package installed
- EdgeKV CLI package installed
- A Property Manager property where the EdgeWorker behavior can be associated
- A reachable origin endpoint that serves VeloxEdge assets at `/<encoded asset key>`
- Node.js and pnpm for local bundle generation

Install CLI packages if needed:

```sh
akamai install edgeworkers
akamai install edgekv
```

## 1. Create EdgeKV namespace, groups, and token

Initialize EdgeKV for the account or contract/group if it has not been enabled:

```sh
akamai edgekv initialize
```

Create the namespace and groups used by the worker:

```sh
akamai edgekv create namespace veloxedge
akamai edgekv create group veloxedge sessions
akamai edgekv create group veloxedge assets
akamai edgekv create group veloxedge pending
```

Create an access token for namespace `veloxedge` with read/write access:

```sh
akamai edgekv create token
```

Export the generated token file into this directory as the gitignored file
`edgekv_tokens.js`. It should export `edgekv_access_tokens`, matching
`edgekv_tokens.example.js`:

```js
export const edgekv_access_tokens = {
  "namespace-veloxedge": {
    name: "namespace-veloxedge",
    value: "...secret token value...",
  },
};

export default edgekv_access_tokens;
```

## 2. Configure origin and worker environment

The worker prefetches assets with `httpRequest` from:

```text
VELOX_ORIGIN_URL=https://<your-origin-hostname>/api/origin
VELOX_EDGE_SECRET=<shared random secret>
```

The origin must return a 2xx response for `GET /<encoded asset key>`. JSON
responses may include `coldOriginMs`; otherwise the worker uses the measured
subrequest duration (with a 100 ms default floor for reward normalization).

## 3. Build the EdgeWorker bundle

From the repository root:

```sh
pnpm --filter @veloxedge/edgeworker build
```

The build emits:

```text
apps/edgeworker/dist/main.js
apps/edgeworker/dist/bundle.json
apps/edgeworker/dist/edgekv.js
apps/edgeworker/dist/edgekv_tokens.js
apps/edgeworker/dist/bundle.tgz
```

For deployment, place the real generated token module at
`apps/edgeworker/edgekv_tokens.js` before building. The file is gitignored, and
`build.mjs` copies it into `dist/edgekv_tokens.js`. If the real file is absent,
the build writes a harmless placeholder so CI and local validation can run
without secrets.

Validate the archive contents before uploading:

```sh
tar -tzf apps/edgeworker/dist/bundle.tgz
```

Expected entries:

```text
bundle.json
main.js
edgekv.js
edgekv_tokens.js
```

## 4. Register, upload, and validate the EdgeWorker

Register a new EdgeWorker ID in Akamai Control Center or with the CLI:

```sh
akamai edgeworkers register VeloxEdgePredictor --resource-tier 200
```

Upload the generated bundle to the EdgeWorker ID returned by registration:

```sh
akamai edgeworkers upload <edgeworker-id> apps/edgeworker/dist/bundle.tgz
```

Validate the uploaded bundle if your CLI version supports validation:

```sh
akamai edgeworkers validate <edgeworker-id> apps/edgeworker/dist/bundle.tgz
```

## 5. Associate with a Property Manager property

In Property Manager, add or update an EdgeWorkers behavior on the route/path you
want to expose, for example `/veloxedge/*`, and select the uploaded EdgeWorker
ID/version. Save a new property version and activate it to staging first.

Do not activate to production until staging smoke tests pass.

## 6. Activate after human approval

Staging activation example:

```sh
akamai edgeworkers activate <edgeworker-id> <version> staging
```

Production activation example, only after review:

```sh
akamai edgeworkers activate <edgeworker-id> <version> production
```

## 7. Connect the web dashboard

Set the web app proxy target in `.env` or your hosting provider environment:

```sh
VELOX_EDGEWORKER_URL=https://<your-property-hostname>/veloxedge
VELOX_EDGE_SECRET=<shared random secret>
```

The dashboard's API routes proxy `/api/edge/predict` and `/api/edge/resolve` to
that origin when `VELOX_EDGEWORKER_URL` is present. Without it, the local web
emulator is used.

## Smoke test payloads

Use the same `sessionId`, `step`, context vector, and derived key between
`/predict` and `/resolve` so the worker can attribute the measured cache result
to the prediction.

Predict and prefetch:

```sh
curl -X POST https://<your-property-hostname>/veloxedge/predict \
  -H 'content-type: application/json' \
  -H 'x-velox-edge-secret: <shared random secret>' \
  -d '{"sessionId":"demo","step":1,"dimensions":12,"alpha":1,"actions":["TOOL_CONTEXT","EDGEKV_MEMORY","VECTOR_WEIGHTS","NO_OP"],"contextVector":[1,0,0,0,0,0,0,0,0,0,0,0]}'
```

Resolve the returned `predictedKey`:

```sh
curl -X POST https://<your-property-hostname>/veloxedge/resolve \
  -H 'content-type: application/json' \
  -H 'x-velox-edge-secret: <shared random secret>' \
  -d '{"sessionId":"demo","step":1,"requestedKey":"<predictedKey>","config":{"dimensions":12,"alpha":1,"actions":["TOOL_CONTEXT","EDGEKV_MEMORY","VECTOR_WEIGHTS","NO_OP"]},"contextVector":[1,0,0,0,0,0,0,0,0,0,0,0]}'
```

A successful prefetched resolve should return `cacheHit: true`, measured
`latencyMs`, reward from `rewardFromLatency`, and `computeMicros`. If the asset
was not present, `/resolve` fetches origin, writes the asset with TTL, and
returns `cacheHit: false` with a low reward.

## Concurrency note

EdgeKV does not provide a compare-and-swap primitive through this helper. The
worker uses best-effort read/modify/write and accepts last-write-wins for
concurrent resolves in the same session. Pending records are keyed by
`sessionId + step`, so clients should send monotonic steps to minimize lost
attribution.
